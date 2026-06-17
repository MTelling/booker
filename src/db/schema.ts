import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/sqlite-core";

/** An event being planned: a name + a fixed duration the organiser wants to find a date for. */
export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** Length of the event in minutes (0–1440). For all-day events this is 1440. */
  durationMinutes: integer("duration_minutes").notNull(),
  allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
  /** Whether invitees may add their own candidate slots. */
  allowProposals: integer("allow_proposals", { mode: "boolean" }).notNull().default(false),
  createdBy: text("created_by").notNull(),
  /** Secret held only by the organiser; grants delete/manage rights. */
  adminToken: text("admin_token").notNull(),
  createdAt: integer("created_at").notNull(),
});

/** A candidate start time people can vote on. Duration comes from the parent event. */
export const slots = sqliteTable(
  "slots",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** Start of the slot, epoch milliseconds (UTC). */
    startsAt: integer("starts_at").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("slots_event_idx").on(t.eventId)],
);

/** One person's availability for one slot. A person is identified purely by name. */
export const votes = sqliteTable(
  "votes",
  {
    id: text("id").primaryKey(),
    slotId: text("slot_id")
      .notNull()
      .references(() => slots.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    voterName: text("voter_name").notNull(),
    /** 'yes' | 'maybe' */
    choice: text("choice").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("votes_slot_voter_idx").on(t.slotId, t.voterName),
    index("votes_event_idx").on(t.eventId),
  ],
);

/** Per-IP daily event-creation counter, for abuse limiting. One row per IP per UTC day. */
export const createCounts = sqliteTable(
  "create_counts",
  {
    ip: text("ip").notNull(),
    day: text("day").notNull(), // UTC YYYY-MM-DD
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.ip, t.day] })],
);

/** Lightweight presence: who currently has an event open. Upserted by the sync poll. */
export const presence = sqliteTable(
  "presence",
  {
    eventId: text("event_id").notNull(),
    name: text("name").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.name] })],
);
