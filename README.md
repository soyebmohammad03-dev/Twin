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
apps/api/           Fastify + TypeScript backend
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
  `/health` and `/health/db` endpoints; the generated OpenAPI doc.
- **Not yet:** OCR/image-based ingestion (PDFs need a real text
  layer); enforced session auto-lock (the setting exists in the UI but
  isn't backed by a real timer); a native mobile/desktop app. There is
  no client-side encryption or telemetry of any kind — data is stored
  server-side in Postgres, scoped to the signed-in user. AI extraction,
  embeddings, and reasoning (Twin Chat) require `GEMINI_API_KEY` and
  are otherwise disabled by design, not by omission — see the provider
  flags in `.env.example`.
