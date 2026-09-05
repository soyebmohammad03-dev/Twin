# Twin

Personal intelligence and digital twin platform: a real, evidence-grounded
model of your memories, decisions, and relationships — not an AI pretending
to be you. Monorepo: a React web client, a Fastify backend, shared API
contracts, and the database layer.

See [`docs/architecture.md`](docs/architecture.md) for the Phase 1
foundational decisions (module layout, tooling choices) — it predates
most of the product surface described below, which was built in later
phases directly on that foundation. This README describes what the
system actually does today and how to run it.

## Layout

```
apps/web/          React + Vite frontend (Liquid Glass UI)
apps/api/           Fastify + TypeScript backend, plus a separate
                    background worker process (src/worker.ts)
packages/contracts/ shared Zod schemas — the API's request/response contract
packages/db/         Drizzle ORM schema, migrations, Postgres client
infra/               docker-compose for local Postgres + pgvector
```

## Prerequisites

- Node.js 20+ (developed against Node 24)
- npm 10+ (workspaces support)
- Docker, to run the API against a real Postgres database — needed
  for anything beyond the web app's sign-in screen (see below).

## Install

From the repo root (not inside a sub-package):

```bash
npm install
```

npm workspaces installs and links `apps/*` and `packages/*` together
from this one command.

## Running the web app

```bash
npm run dev:web
```

Opens the UI at `http://localhost:3000`. Sign-in, sign-up, and every
data-backed view (Memory, Explore, Personal Model, Insights, Decisions,
Twin Chat) call the real API — start the API too (below) for the app
to be usable beyond the sign-in screen. Only theme/appearance
preferences are still kept client-side in `localStorage`.

## Running the API

1. Copy the env template and fill in real values (dev placeholders are
   fine for local use):

   ```bash
   cp .env.example .env
   ```

2. Start Postgres (with the `pgvector` extension enabled) via Docker:

   ```bash
   docker compose -f infra/docker-compose.yml up -d
   ```

   No Docker available? The API will still start — `/health` doesn't
   need a database — but `/health/db` and every `/auth/*` route will
   honestly report a connection failure instead of pretending to work.

3. Apply migrations:

   ```bash
   npm run db:migrate
   ```

4. Start the API:

   ```bash
   npm run dev:api
   ```

   Listens on `http://localhost:4000`. Try:
   - `GET /health` — liveness, no database required.
   - `GET /health/db` — actually queries Postgres; reports the real
     result either way.
   - `GET /docs` — generated OpenAPI documentation.

## Running the background worker

A separate, optional process that generates scheduled notifications
(Morning Briefing, Evening Thought Synthesis) and real-time Pattern
Recurrence Alerts independently of any open browser tab:

```bash
npm run dev:worker   # from the repo root; tsx watch src/worker.ts
```

It connects to the same `DATABASE_URL` as the API and shares its
service-layer code — no separate deployment artifact beyond the one
`apps/api` build. It is a plain `setInterval` loop (`WORKER_INTERVAL_MS`,
default 60000ms in dev; use something like 15 minutes in production),
not a queue or cron system — the database's unique constraints (see
`notifications.dedupe_key` / `sourceInsightId`) are the actual
idempotency authority, so running zero, one, or several worker
instances simultaneously is always safe. If it's not running, nothing
breaks: Pattern Recurrence Alerts still fire on `POST /insights/rebuild`
(triggered whenever a signed-in user opens their Profile), and Morning
Briefing / Evening Thought Synthesis simply never fire, honestly.

Structured JSON logs only (counts, ids) — never notification bodies,
memory content, or secrets. Handles `SIGTERM`/`SIGINT` for graceful
shutdown (finishes any in-flight cycle, closes the DB pool).

## Database schema changes

```bash
npm run db:generate   # diff packages/db/src/schema/*.ts -> new SQL migration file
npm run db:migrate     # apply pending migrations to DATABASE_URL
```

Generated migrations land in `packages/db/migrations/` as plain SQL —
review them like any other code change before applying.

## Checks

```bash
npm run typecheck   # tsc --noEmit across every workspace
npm run test         # vitest across every workspace that has tests
npm run build        # contracts + db -> api -> web, in dependency order
```

## Production deployment

Twin runs as three long-lived processes plus Postgres — no queue,
cache, or job-scheduling infrastructure beyond that:

1. **API** (`apps/api`) — `npm run build && npm start` (or
   `node dist/server.js`). Stateless; run as many instances as you
   like behind a load balancer.
2. **Worker** (`apps/api`) — `npm run worker` (`node dist/worker.js`),
   same build output as the API, same `DATABASE_URL`. Safe to run
   exactly one instance or several — see "Running the background
   worker" above for why duplicates never double-generate. If you
   don't need scheduled/background notifications, don't run it; the
   rest of the product is unaffected.
3. **Web** (`apps/web`) — `npm run build` produces static assets
   (`dist/`) to serve from any static host/CDN. `VITE_API_URL` must
   point at the API's real public URL at build time.
4. **Postgres** with the `pgvector` extension — see
   `infra/docker-compose.yml` for the reference config; any managed
   Postgres with `pgvector` installed works.

Required environment variables beyond local dev's placeholders (see
`.env.example` for the full list): real `JWT_ACCESS_SECRET`/
`JWT_REFRESH_SECRET` (`openssl rand -hex 32`), a real `DATABASE_URL`,
and `CORS_ORIGIN` set to the web app's real origin.

**Web Push (optional).** Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
and `VAPID_SUBJECT` (a `mailto:` address or URL) to enable real
background push delivery. Generate a keypair with
`npx web-push generate-vapid-keys` — these are self-generated, not a
third-party credential; no external account or paid service is
required, since Web Push itself is a free, standard protocol the
browser's own push service handles. Leave all three unset to run
without push: notifications are still generated and persisted, the
notification center still works, foreground browser notifications
(via the Notification API, while a tab is open) still work — only the
background delivery attempt is honestly skipped. **Requires HTTPS in
production** — the browser's PushManager and ServiceWorker APIs refuse
to register on a plain-HTTP origin (localhost is exempted for local
dev only).

**Timezone-aware scheduling.** Each user's `notification_preferences.timezone`
(an IANA zone name, auto-detected from their browser — never guessed
from server location) determines when their Morning Briefing / Evening
Thought Synthesis windows occur; the worker itself can run in any
server timezone, since all its date math is timezone-explicit
(`apps/api/src/worker/timezone.ts`, built on Node's built-in `Intl`).

## What's real vs. not yet, right now

- **Real:** email/password auth (bcrypt + JWT access/refresh tokens,
  rate-limited); ingestion of manual notes, real browser-based voice
  transcription, web links (SSRF-hardened against redirects), and PDF
  documents (real text extraction, no OCR); a knowledge graph built
  from ingested memories and entity mentions; a Personal Model of
  evidence-backed facts a user can confirm, correct, or dismiss, each
  traceable to its source memories; Insights and Decision tracking,
  both evidence-grounded rather than invented; Twin Chat, which
  answers only from a bounded, citation-validated context built from
  the user's own real data; pgvector-backed semantic search when
  `EMBEDDING_PROVIDER=gemini` is configured (falls back to lexical +
  entity-aware retrieval otherwise); Postgres schema + migrations; the
  `/health` and `/health/db` endpoints; the generated OpenAPI doc;
  real persisted notifications (Pattern Recurrence Alerts, Morning
  Briefing, Evening Thought Synthesis) generated by a background
  worker process from real Twin data, delivered via the browser
  Notification API in the foreground and real Web Push in the
  background when a VAPID keypair is configured.
- **Not yet:** OCR/image-based ingestion (PDFs need a real text
  layer); enforced session auto-lock (the setting exists in the UI but
  isn't backed by a real timer); a native mobile/desktop app. There is
  no client-side encryption or telemetry of any kind — data is stored
  server-side in Postgres, scoped to the signed-in user. AI extraction,
  embeddings, and reasoning (Twin Chat) require `GEMINI_API_KEY` and
  are otherwise disabled by design, not by omission — see the provider
  flags in `.env.example`.
