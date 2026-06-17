import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import * as schema from "./db/schema";
import { shortId, token } from "./lib/id";
import type { CreateEventInput, SlotData, VoteChoice } from "./types";

type Bindings = { DB: D1Database; ASSETS: Fetcher };

const CHOICES: VoteChoice[] = ["yes", "maybe"];
const isChoice = (v: unknown): v is VoteChoice => CHOICES.includes(v as VoteChoice);

const app = new Hono<{ Bindings: Bindings }>();

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

/** Public event detail: event + sorted slots with their votes. */
app.get("/api/events/:id", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const id = c.req.param("id");

  const ev = await db.select().from(schema.events).where(eq(schema.events.id, id)).get();
  if (!ev) return c.json({ error: "Event not found" }, 404);

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

  return c.json({
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
  });
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
