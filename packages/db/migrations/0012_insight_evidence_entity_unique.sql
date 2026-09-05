-- Phase 10 insight layer: real database-level duplicate protection for
-- an insight's single 'entity' evidence row, not just the
-- application-layer check-then-insert in insightsStore.ts's
-- writeInsightEvidence (which has a race window under two truly
-- concurrent rebuilds, e.g. a React StrictMode double effect-fire —
-- the exact bug class hit live in Phase 9's browser testing).
-- insight_evidence_insight_memory_unique(insight_id, memory_id) does
-- NOT cover this: Postgres treats NULL as distinct, and an 'entity'
-- evidence row's memory_id is always null. Mirrors migration 0008's
-- pattern of a hand-written partial unique index that isn't reflected
-- in the Drizzle schema DSL.
CREATE UNIQUE INDEX IF NOT EXISTS insight_evidence_insight_entity_unique
  ON insight_evidence (insight_id)
  WHERE evidence_type = 'entity';
