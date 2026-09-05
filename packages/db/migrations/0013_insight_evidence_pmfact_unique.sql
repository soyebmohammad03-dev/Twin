-- Phase 11: real database-level duplicate protection for an insight's
-- 'personal_model_fact' evidence rows, mirroring migration 0012's
-- 'entity' index. Deliberately keyed on (insight_id,
-- personal_model_fact_id), NOT just insight_id: a priority_tension
-- insight legitimately has TWO personal_model_fact evidence rows (the
-- like: and dislike: facts), so uniqueness must allow two DISTINCT
-- fact ids per insight while still blocking an exact duplicate under
-- a race (e.g. a React StrictMode double effect-fire).
CREATE UNIQUE INDEX IF NOT EXISTS insight_evidence_insight_pmfact_unique
  ON insight_evidence (insight_id, personal_model_fact_id)
  WHERE evidence_type = 'personal_model_fact';
