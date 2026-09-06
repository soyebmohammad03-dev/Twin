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
cache, or job-scheduling infrastructure beyond that. `apps/api/Dockerfile`
and `apps/web/Dockerfile` build the API/worker and web images
respectively (both build from the **repo root**, since npm workspaces
need the root lockfile and the sibling `packages/*` sources); use
whatever container host you like (a single VM running all three via
`docker compose`, or separate managed container services) — nothing
here is tied to one cloud provider.

1. **API** (`apps/api`) — `docker build -f apps/api/Dockerfile -t twin-api .`,
   then run it with the environment variables below. Binds to
   `0.0.0.0:$PORT` and shuts down gracefully on `SIGTERM` (finishes
   in-flight requests, closes the database pool) — safe to run more
   than one instance behind a load balancer; it's stateless.
2. **Worker** (`apps/api`, same image) — `docker run <image> node dist/worker.js`.
   **Run exactly one instance** for scheduled categories (Morning
   Briefing / Evening Thought Synthesis) to fire predictably once per
   window rather than being raced N ways — though correctness doesn't
   depend on this: the database's unique constraints
   (`notifications.dedupe_key` / `sourceInsightId`) are the actual
   authority, so even multiple instances can never create a duplicate
   notification, they'd just do redundant work. If you don't need
   scheduled/background notifications, don't run it — the rest of the
   product is unaffected.
3. **Web** (`apps/web`) — `docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=https://your-api-domain -t twin-web .`.
   `VITE_API_URL` is a **build-time** value (Vite bakes it into the
   static bundle) — there is no way to change it after the image is
   built, so it must already be the real, public API URL. The image
   serves the static bundle via nginx (`apps/web/nginx.conf`); any
   static host/CDN works just as well if you'd rather run
   `npm run build --workspace apps/web` and upload `apps/web/dist/`
   directly.
4. **Postgres** with the `pgvector` extension — see
   `infra/docker-compose.yml` for the reference config, or any managed
   Postgres with `pgvector` installed. `npm run db:migrate` creates the
   extension itself (`CREATE EXTENSION IF NOT EXISTS vector`) before
   applying migrations, so it works against a genuinely empty database —
   verified against a from-scratch Postgres container with no prior
   setup, not just the docker-compose dev database (whose own
   `infra/init/` scripts would otherwise mask this).

**Health checks.** `GET /health` is liveness (no database touched —
safe for a fast, frequent orchestrator probe); `GET /health/db` is
readiness (actually queries Postgres, reports the real result either
way) — use it for a startup/readiness probe, not a tight liveness loop.

### Environment variable contract

| Variable | Required | Secret | Consumed by | Purpose |
|---|---|---|---|---|
| `DATABASE_URL` | Yes | Yes | API, worker, migrations | Postgres connection string. Never reaches the browser. |
| `JWT_ACCESS_SECRET` | Yes | Yes | API | Signs access tokens (`openssl rand -hex 32`). Refresh tokens are opaque random bytes hashed at rest, not JWTs — there is no separate refresh secret. |
| `CORS_ORIGIN` | Yes | No | API | The web app's real public origin (e.g. `https://twin.example.com`). The API rejects cross-origin requests from anywhere else. |
| `PORT` | No (default `4000`) | No | API | Port the API binds to (`0.0.0.0`). Most container platforms set this for you. |
| `VITE_API_URL` | Yes (web build) | No | Web (build-time only) | The API's real public URL. Baked into the static bundle at `vite build` — safe to expose, it's just a URL. |
| `WORKER_INTERVAL_MS` | No (default `60000`) | No | Worker | How often the scheduler cycle runs; a real production value is more like 15 minutes (`900000`). |
| `EXTRACTION_PROVIDER` / `EMBEDDING_PROVIDER` / `REASONING_PROVIDER` | No (default `heuristic`/`none`/`none`) | No | API | Set to `gemini` to enable real AI extraction/embeddings/reasoning. |
| `GEMINI_API_KEY` | Only if any provider above is `gemini` | Yes | API | Google AI Studio key. Never reaches the browser; required at startup the moment any provider is set to `gemini`. |
| `GEMINI_MODEL` / `EMBEDDING_MODEL` / `REASONING_MODEL` | No | No | API | Model names, each independently configurable. |
| `VAPID_PUBLIC_KEY` | No | No | API (served to browser), Worker | Web Push public key — safe to expose, that's the point of VAPID. Generate with `npx web-push generate-vapid-keys`. |
| `VAPID_PRIVATE_KEY` | No (required together with the two other VAPID vars for push to work) | Yes | Worker only | Signs push payloads. Never sent to the frontend, never logged. |
| `VAPID_SUBJECT` | No | No | Worker | A `mailto:` address or URL identifying the sender, per the Web Push spec. |
| `NODE_ENV` | No (default `development`) | No | API | Standard Node environment flag. |

Leaving any *optional* Gemini/VAPID variable unset does not break the
app — see "What's real vs. not yet" below for exactly what's honestly
disabled in each case. No variable in this table is read by
`apps/web`'s runtime except the one build-time exception noted above;
everything else the frontend needs comes from the authenticated API.

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
- **Provider availability is never faked.** When `REASONING_PROVIDER=gemini`
  and the Gemini API returns a timeout, a rate-limit/quota error, or an
  unparseable response, Twin Chat reports that failure to the user
  honestly (with a retry action) instead of returning a fabricated or
  degraded-but-unlabeled answer — it never silently falls back to
  inventing an answer that looks real.
