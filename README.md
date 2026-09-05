# Twin

Personal intelligence and digital twin platform. This repo is a
monorepo: the existing web client, a new backend foundation, shared
API contracts, and the database layer.

See [`docs/architecture.md`](docs/architecture.md) for what Phase 1
built and why. This README is just how to run it.

## Layout

```
apps/web/          the existing frontend (Liquid Glass UI, unmodified)
apps/api/           Fastify + TypeScript backend
packages/contracts/ shared Zod schemas — the API's request/response contract
packages/db/         Drizzle ORM schema, migrations, Postgres client
infra/               docker-compose for local Postgres + pgvector
```

## Prerequisites

- Node.js 20+ (developed against Node 24)
- npm 10+ (workspaces support)
- Docker, **if** you want to run the API against a real database.
  Without Docker (or another local Postgres), the web app still runs
  fine on its own — it doesn't talk to the API yet.

## Install

From the repo root (not inside a sub-package):

```bash
npm install
```

npm workspaces installs and links `apps/*` and `packages/*` together
from this one command.

## Running the web app (no backend required)

```bash
npm run dev:web
```

Opens the existing UI at `http://localhost:3000`, exactly as before —
it still runs entirely on `localStorage` and has no dependency on the
API.

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

- **Real:** the web UI (unchanged), the API process, request
  validation, Postgres schema + migrations, password hashing + JWT +
  refresh-token session issuance, the `/health` and `/health/db`
  endpoints, the generated OpenAPI doc.
- **Not yet:** the web UI does not call the API — it still uses its
  original local prototype auth. There's no AI/model integration, no
  vector search, no knowledge graph, no multimodal ingestion, and no
  encryption-at-rest. See `docs/architecture.md` for the full list of
  what's deliberately deferred and why.
