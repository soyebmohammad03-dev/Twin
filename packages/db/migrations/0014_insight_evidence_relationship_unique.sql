-- Phase 12: real database-level duplicate protection for an insight's
-- 'relationship' evidence rows, mirroring migration 0013's pattern for
-- 'personal_model_fact'. Keyed on (insight_id, relationship_id), NOT
-- just insight_id: a relationship_tension insight legitimately has two
-- or more relationship-type evidence rows (the current relationship
-- plus one or more prior/conflicting ones), so uniqueness must allow
-- multiple DISTINCT relationship ids per insight while still blocking
-- an exact duplicate under a race (e.g. a React StrictMode double
-- effect-fire).
CREATE UNIQUE INDEX IF NOT EXISTS insight_evidence_insight_relationship_unique
  ON insight_evidence (insight_id, relationship_id)
  WHERE evidence_type = 'relationship';
