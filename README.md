# Booker

A no-nonsense tool for agreeing on a date with your friends. Name an event, give it
a duration (0–24 hours or all-day), drop some candidate times on a Google-Calendar-style
grid, and share a clean link. Friends mark **yes / maybe / no** on each option and — if you
allow it — propose their own. No accounts, no emails: your **name is your identity**.

## Stack

- **Frontend** — React + Vite (static SPA)
- **API** — [Hono](https://hono.dev) running on a Cloudflare Worker
- **Database** — Cloudflare D1 (SQLite) via Drizzle ORM
- **Tooling** — Wrangler for local dev + deploy

In production a single Worker serves the static assets *and* the `/api/*` routes.

## Project layout

```
src/            Worker / API (Hono + Drizzle)
  index.ts      routes
  db/schema.ts  Drizzle schema (events, slots, votes)
migrations/     generated SQL migrations (drizzle-kit)
web/            React + Vite frontend
wrangler.jsonc  Worker + D1 + static assets config
```

## Getting started

```bash
npm install
```

### 1. Create the local database & apply migrations

```bash
npm run db:generate        # generate SQL from the Drizzle schema (already committed)
npm run db:migrate:local   # apply to the local D1 SQLite db
```

### 2. Run it locally

```bash
npm run dev
```

This runs two processes:

- `wrangler dev` on **http://localhost:8787** (the Worker + local D1)
- Vite on **http://localhost:5173** (the React app, proxying `/api` → 8787)

Open **http://localhost:5173**.

> Prefer a single-process preview of the real production setup? Run
> `npm run build && npx wrangler dev` and open http://localhost:8787 — the Worker
> serves the built `web/dist` assets directly.

## Deploying to Cloudflare

1. Create a D1 database and copy its id into `wrangler.jsonc` (`database_id`):

   ```bash
   npx wrangler d1 create booker
   ```

2. Apply migrations to the remote db:

   ```bash
   npm run db:migrate:remote
   ```

3. Build and deploy:

   ```bash
   npm run deploy
   ```

## Notes

- **Identity** is just the name someone types, remembered in `localStorage`. There's no
  auth — the share link is the secret.
- The **organiser** keeps an admin token in `localStorage` (returned at creation). It lets
  them delete the event or any option. If they clear browser storage, that power is lost.
- Times are stored as UTC epoch-ms and rendered in each viewer's local timezone.
