# Twin — Phase 1 Architecture

This document records the decisions made while converting the inherited
AI Studio export into a real platform foundation. It assumes the reader
has the Phase 0 assessment (the architectural handoff produced before
this phase) — this doc only covers what Phase 1 actually built and why.

## Scope of this phase

Phase 1 builds the **skeleton**, not the intelligence layer. Explicitly
out of scope here: AI orchestration, vector search, the knowledge
graph, multimodal ingestion, encryption-at-rest/KMS, and wiring the
existing frontend's sign-in/up screens to the new API. Those are later
phases (see the Phase 0 roadmap).

## Repository layout

```
Twin/
├─ apps/
│  ├─ web/        the inherited AI Studio frontend, moved intact
│  └─ api/        new Fastify backend
├─ packages/
│  ├─ contracts/  Zod schemas — the single source of truth for API shapes
│  └─ db/         Drizzle schema, migrations, typed Postgres client
├─ infra/         docker-compose for local Postgres + pgvector
└─ docs/          this file
```

`apps/web`'s internals (`src/`, `index.html`, `vite.config.ts`, …) were
moved with `git mv` and are otherwise untouched — same dependencies,
same components, same visual design, same `localStorage`-backed
prototype auth. Only its `package.json` `name` changed (to `@twin/web`,
for workspace clarity) and a `typecheck` script alias was added.

## Why a modular monolith, and why these specific tools

**One deployable API, organized as isolated modules.** `apps/api/src/modules/*`
(currently `health`, `auth`) are self-contained: routes, service logic,
and module-specific helpers live together. Nothing outside a module
reaches into its internals. This is deliberately not split into
separate services yet — there's no operational reason to run `auth`
and the future `ingestion`/`orchestration` work as separate deployments
at this size, and doing so now would be exactly the kind of premature
complexity the brief asked to avoid. The module boundary is what would
get extracted later, if a specific module's load or team ownership
ever justified it.

**Fastify over NestJS or Express.** Fastify's plugin encapsulation
model gives module isolation without a DI container or decorators —
less ceremony than Nest for a Phase 1 foundation, while still leaving
a clean extraction seam per module. Express was rejected as too
minimal: it would have required hand-building the same structure
Fastify already provides.

**Drizzle + node-postgres over Prisma.** Drizzle has first-class
`pgvector` column support, which matters the moment Phase 2 introduces
embeddings — Prisma's support there is weaker. Drizzle also generates
plain, reviewable SQL migration files rather than hiding schema changes
behind a proprietary engine, which matters for a product whose schema
will carry very sensitive personal data.

**bcryptjs over argon2.** Argon2id is the better long-term choice, but
its Node bindings require native compilation. `bcryptjs` is pure
JavaScript with zero build-toolchain risk, which was worth more than
the marginal security gain at this stage. Documented here as a
deliberate deferral, not an oversight — revisit before production.

## Database foundation and multi-user isolation

Two tables exist so far:

- **`users`** — the root identity table. Every future table that holds
  user data (memories, entities, documents, …) will carry a `user_id`
  foreign key back to this table. That convention — not an
  afterthought bolted on later — is the foundation of per-user
  isolation.
- **`sessions`** — one row per issued refresh token, storing only a
  SHA-256 hash of the token (never the plaintext), plus rotation
  metadata (`expires_at`, `revoked_at`).

**Row-Level Security is intentionally not enabled yet.** RLS enforces
isolation *between users' data rows* — with no user-data tables yet
(just identity and session bookkeeping), there's nothing for it to
protect. It's the correct enforcement mechanism to adopt the moment
Phase 2 adds the first real data table, and should be treated as a
requirement then, not a nice-to-have.

**pgvector is enabled, not used.** `infra/init/001-extensions.sql` runs
`CREATE EXTENSION IF NOT EXISTS vector;` on container init. No vector
columns exist yet — this just means Phase 2 doesn't need an
infrastructure change to start using it.

## Migrations

`drizzle-kit generate` (via `npm run db:generate`) diffs
`packages/db/src/schema/*.ts` against the existing migration history
and writes a new SQL file into `packages/db/migrations/`. Nothing is
applied automatically — `npm run db:migrate` runs
`packages/db/src/migrate.ts`, which applies pending migrations against
`DATABASE_URL` explicitly. Migrations are checked into git as plain
SQL; there is no "shadow database" or hidden diffing step to trust.

## Configuration

One root `.env` (gitignored; `.env.example` is the template) is read
by `infra/docker-compose.yml`, `packages/db` (migrations), and
`apps/api`, resolved via a path relative to each consuming file so it
works regardless of the working directory a script is invoked from.
Consolidating to one file was a deliberate Phase 1 simplification —
appropriate while everything runs as one deployable unit locally;
revisit per-service env separation once services actually deploy
independently.

`apps/api/src/config/env.ts` validates `process.env` against a Zod
schema at startup and **throws before the server starts** if anything
required is missing or malformed. There is no fallback to a default
secret for anything security-sensitive.

## Authentication architecture

Real, server-backed, and deliberately not production-complete.

**What's implemented:** Postgres-backed users, bcrypt password hashing
(12 rounds), a short-lived (15 min) JWT access token, and a rotating
opaque refresh token (30 day expiry, SHA-256-hashed at rest, revoked
and reissued on every use). `POST /auth/signup`, `POST /auth/login`,
`POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`.

**Designed for two client types from one implementation:** the refresh
token is set as an httpOnly, `SameSite=Lax` cookie (scoped to `/auth`)
*and* returned in the JSON response body. Web clients rely on the
cookie; a native iOS client (which has no cookie jar semantics worth
relying on) reads the token from the body and stores it in the
Keychain. Both call the same endpoints — no parallel "mobile auth API."

**What's explicitly missing, on purpose:**
- Email verification
- Password reset / account recovery
- Multi-factor authentication
- Rate limiting and account lockout on repeated failed logins
- Refresh-token reuse detection (a stolen-then-replayed old token is
  rotated away silently rather than raising an alert)
- Field-level encryption at rest (see the Phase 0 assessment's KMS
  recommendation — deferred, not forgotten)

None of this is wired to the existing frontend yet. `apps/web` keeps
its current `localStorage`-based prototype auth so it keeps running
with zero backend dependency — swapping it to call this API is a
Phase 2 integration task, not a Phase 1 one.

## API contracts, and the path to an iOS client

`packages/contracts` holds Zod schemas for every request/response
shape. `apps/api` uses them directly for runtime validation
(`fastify-type-provider-zod`); `apps/web` can import the inferred
TypeScript types once it starts calling the API. The API also serves a
generated OpenAPI document at `/docs` (via `@fastify/swagger` +
`@fastify/swagger-ui`, using the same Zod schemas as the source of
transformation). A future Swift client can be generated from that
OpenAPI document with `swift-openapi-generator` — one schema source
feeding both a TypeScript and a Swift consumer, rather than a
hand-maintained parallel contract.

## Known gap found during verification

Fastify's global `setErrorHandler` was registered as a catch-all, but
testing showed it doesn't reliably override the response for routes
that declare a Zod `response` schema map when the actual error status
code isn't one of the declared entries — Fastify appears to fall back
to its own default (unsanitized) error body in that case. Auth routes
now sanitize errors inline at the point they're caught, which is
proven correct by testing and is arguably better practice anyway. The
global handler is left in place as a backstop for routes that don't
handle their own errors, but this interaction is worth a proper
root-cause before more routes are added in Phase 2.
