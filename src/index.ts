import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, gt, sql } from "drizzle-orm";
import * as schema from "./db/schema";
import { shortId, token } from "./lib/id";
import type { CreateEventInput, SlotData, VoteChoice } from "./types";

/** Cloudflare Workers rate-limit binding. */
interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  RATE_LIMIT_API?: RateLimiter;
  RATE_LIMIT_CREATE?: RateLimiter;
};

const CHOICES: VoteChoice[] = ["yes", "maybe"];
const isChoice = (v: unknown): v is VoteChoice => CHOICES.includes(v as VoteChoice);

/** How recently someone must have polled to count as "here". */
const PRESENCE_WINDOW_MS = 2 * 60 * 1000;

/** Max events one IP may create per UTC day. */
const DAILY_CREATE_LIMIT = 100;

const app = new Hono<{ Bindings: Bindings }>();

// Best-effort per-IP rate limit on all API traffic (no-op if the binding is absent).
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/health") return next();
  const limiter = c.env.RATE_LIMIT_API;
  if (limiter) {
    const ip = c.req.header("cf-connecting-ip") ?? "anon";
    const { success } = await limiter.limit({ key: ip });
    if (!success) return c.json({ error: "Too many requests. Please slow down." }, 429);
  }
  await next();
});

app.get("/api/health", (c) => c.json({ ok: true }));

/** Create an event with its initial candidate slots. Returns the public id + admin token. */
app.post("/api/events", async (c) => {
  const db = drizzle(c.env.DB, { schema });

  let body: Partial<CreateEventInput>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  // Honeypot: hidden fields no real person fills. A bot that fills them is rejected.
  const honey = body as Record<string, unknown>;
  const tripped = (k: string) =>
    typeof honey[k] === "string" && (honey[k] as string).trim() !== "";
  if (tripped("website") || tripped("hp_url")) {
    return c.json({ error: "Submission rejected." }, 400);
  }

  // Stricter per-IP cap on creating events (the main spam vector).
  const createLimiter = c.env.RATE_LIMIT_CREATE;
  if (createLimiter) {
    const ip = c.req.header("cf-connecting-ip") ?? "anon";
    const { success } = await createLimiter.limit({ key: ip });
    if (!success) {
      return c.json({ error: "You're creating events too fast. Try again in a minute." }, 429);
    }
  }

  const name = (body.name ?? "").trim();
  const createdBy = (body.createdBy ?? "").trim();
  if (!name) return c.json({ error: "Event name is required" }, 400);
  if (!createdBy) return c.json({ error: "Your name is required" }, 400);

  // Events are full-day only for now.
  const allDay = true;
  const durationMinutes = 1440;

  const allowProposals = !!body.allowProposals;
  const slotStarts = Array.isArray(body.slots)
    ? body.slots.map(Number).filter((n) => Number.isFinite(n)).map(Math.round)
    : [];

  const id = shortId(10);
  const adminToken = token();
  const now = Date.now();

  // Daily per-IP volume cap. Atomically bump today's counter and reject past the limit.
  const ip = c.req.header("cf-connecting-ip") ?? "anon";
  const day = new Date(now).toISOString().slice(0, 10); // UTC YYYY-MM-DD
  const counted = await db
    .insert(schema.createCounts)
    .values({ ip, day, count: 1 })
    .onConflictDoUpdate({
      target: [schema.createCounts.ip, schema.createCounts.day],
      set: { count: sql`${schema.createCounts.count} + 1` },
    })
    .returning({ count: schema.createCounts.count });
  if ((counted[0]?.count ?? 1) > DAILY_CREATE_LIMIT) {
    return c.json({ error: "Daily event limit reached for your network. Try again tomorrow." }, 429);
  }

  await db.insert(schema.events).values({
    id,
    name,
    durationMinutes,
    allDay,
    allowProposals,
    createdBy,
    adminToken,
    createdAt: now,
  });

  if (slotStarts.length) {
    await db.insert(schema.slots).values(
      slotStarts.map((startsAt) => ({
        id: shortId(12),
        eventId: id,
        startsAt,
        createdBy,
        createdAt: now,
      })),
    );
  }

  return c.json({ id, adminToken });
});

/** Build the public event detail (event + sorted slots with votes), or null if missing. */
async function loadEventDetail(d1: D1Database, id: string) {
  const db = drizzle(d1, { schema });
  const ev = await db.select().from(schema.events).where(eq(schema.events.id, id)).get();
  if (!ev) return null;

  const slotRows = await db.select().from(schema.slots).where(eq(schema.slots.eventId, id)).all();
  const voteRows = await db.select().from(schema.votes).where(eq(schema.votes.eventId, id)).all();

  const votesBySlot = new Map<string, SlotData["votes"]>();
  for (const v of voteRows) {
    const arr = votesBySlot.get(v.slotId) ?? [];
    arr.push({ voterName: v.voterName, choice: v.choice as VoteChoice });
    votesBySlot.set(v.slotId, arr);
  }

  const slots: SlotData[] = slotRows
    .sort((a, b) => a.startsAt - b.startsAt)
    .map((s) => ({
      id: s.id,
      startsAt: s.startsAt,
      createdBy: s.createdBy,
      votes: votesBySlot.get(s.id) ?? [],
    }));

  return {
    event: {
      id: ev.id,
      name: ev.name,
      durationMinutes: ev.durationMinutes,
      allDay: ev.allDay,
      allowProposals: ev.allowProposals,
      createdBy: ev.createdBy,
      createdAt: ev.createdAt,
    },
    slots,
  };
}

/** Public event detail: event + sorted slots with their votes. */
app.get("/api/events/:id", async (c) => {
  const detail = await loadEventDetail(c.env.DB, c.req.param("id"));
  if (!detail) return c.json({ error: "Event not found" }, 404);
  return c.json(detail);
});

/**
 * Live sync poll: record that this person is here (presence heartbeat) and return
 * the fresh snapshot plus everyone currently viewing within the presence window.
 */
app.post("/api/events/:id/sync", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const id = c.req.param("id");

  const body = await c.req.json().catch(() => ({}));
  const name = (body.name ?? "").trim();
  const now = Date.now();

  if (name) {
    await db
      .insert(schema.presence)
      .values({ eventId: id, name, lastSeenAt: now })
      .onConflictDoUpdate({
        target: [schema.presence.eventId, schema.presence.name],
        set: { lastSeenAt: now },
      });
  }

  const detail = await loadEventDetail(c.env.DB, id);
  if (!detail) return c.json({ error: "Event not found" }, 404);

  const here = await db
    .select()
    .from(schema.presence)
    .where(
      and(eq(schema.presence.eventId, id), gt(schema.presence.lastSeenAt, now - PRESENCE_WINDOW_MS)),
    )
    .all();

  return c.json({ ...detail, present: here.map((p) => p.name).sort() });
});

/**
 * Propose one or more candidate days. Accepts a single `startsAt` or a `startsAts`
 * array, and inserts them all in a single statement so it's atomic — all or nothing.
 * Allowed if the event permits proposals, or by the organiser.
 */
app.post("/api/events/:id/slots", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const id = c.req.param("id");

  const ev = await db.select().from(schema.events).where(eq(schema.events.id, id)).get();
  if (!ev) return c.json({ error: "Event not found" }, 404);

  const isAdmin = c.req.header("x-admin-token") === ev.adminToken;
  if (!ev.allowProposals && !isAdmin) {
    return c.json({ error: "New proposals are turned off for this event" }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const createdBy = (body.createdBy ?? "").trim();
  if (!createdBy) return c.json({ error: "Your name is required" }, 400);

  const input = Array.isArray(body.startsAts)
    ? body.startsAts
    : body.startsAt !== undefined
      ? [body.startsAt]
      : [];
  const startsAts: number[] = input.map(Number).filter((n: number) => Number.isFinite(n)).map(Math.round);
  if (startsAts.length === 0) return c.json({ error: "A day is required" }, 400);

  const now = Date.now();
  const rows = startsAts.map((startsAt) => ({
    id: shortId(12),
    eventId: id,
    startsAt,
    createdBy,
    createdAt: now,
  }));
  await db.insert(schema.slots).values(rows); // one statement → atomic

  const slots: SlotData[] = rows.map((r) => ({
    id: r.id,
    startsAt: r.startsAt,
    createdBy,
    votes: [],
  }));
  return c.json({ slots });
});

/** Delete a slot. Allowed for the organiser, or the person who proposed it (?name=...). */
app.delete("/api/events/:id/slots/:slotId", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const id = c.req.param("id");
  const slotId = c.req.param("slotId");

  const ev = await db.select().from(schema.events).where(eq(schema.events.id, id)).get();
  if (!ev) return c.json({ error: "Event not found" }, 404);

  const slot = await db.select().from(schema.slots).where(eq(schema.slots.id, slotId)).get();
  if (!slot || slot.eventId !== id) return c.json({ error: "Slot not found" }, 404);

  const isAdmin = c.req.header("x-admin-token") === ev.adminToken;
  const asName = (c.req.query("name") ?? "").trim();
  const isOwner = !!asName && asName === slot.createdBy;
  if (!isAdmin && !isOwner) return c.json({ error: "Not allowed to remove this slot" }, 403);

  await db.delete(schema.votes).where(eq(schema.votes.slotId, slotId));
  await db.delete(schema.slots).where(eq(schema.slots.id, slotId));
  return c.json({ ok: true });
});

/** Save one person's votes. Replaces all of that person's prior votes for the event. */
app.post("/api/events/:id/votes", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const id = c.req.param("id");

  const ev = await db.select().from(schema.events).where(eq(schema.events.id, id)).get();
  if (!ev) return c.json({ error: "Event not found" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const voterName = (body.voterName ?? "").trim();
  if (!voterName) return c.json({ error: "Your name is required" }, 400);

  const votesMap: Record<string, unknown> =
    body.votes && typeof body.votes === "object" ? body.votes : {};

  const slotRows = await db.select().from(schema.slots).where(eq(schema.slots.eventId, id)).all();
  const validIds = new Set(slotRows.map((s) => s.id));
  const now = Date.now();

  await db
    .delete(schema.votes)
    .where(and(eq(schema.votes.eventId, id), eq(schema.votes.voterName, voterName)));

  const toInsert = Object.entries(votesMap)
    .filter(([slotId, choice]) => validIds.has(slotId) && isChoice(choice))
    .map(([slotId, choice]) => ({
      id: shortId(14),
      slotId,
      eventId: id,
      voterName,
      choice: choice as string,
      createdAt: now,
    }));

  if (toInsert.length) await db.insert(schema.votes).values(toInsert);
  return c.json({ ok: true });
});

/** Delete an entire event. Organiser only. */
app.delete("/api/events/:id", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const id = c.req.param("id");

  const ev = await db.select().from(schema.events).where(eq(schema.events.id, id)).get();
  if (!ev) return c.json({ error: "Event not found" }, 404);
  if (c.req.header("x-admin-token") !== ev.adminToken) {
    return c.json({ error: "Not allowed" }, 403);
  }

  await db.delete(schema.votes).where(eq(schema.votes.eventId, id));
  await db.delete(schema.slots).where(eq(schema.slots.eventId, id));
  await db.delete(schema.events).where(eq(schema.events.id, id));
  return c.json({ ok: true });
});

// Static SPA assets handle everything else (only reached if not served directly).
app.all("*", (c) => {
  if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
  return c.json({ error: "Not found" }, 404);
});

export default app;
