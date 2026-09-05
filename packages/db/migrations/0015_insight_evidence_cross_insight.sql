-- Phase 14: adds the ONE new column cross-insight synthesis genuinely
-- needs — insight_evidence had no way to point at ANOTHER insight row
-- (only at a memory/entity/relationship/personal_model_fact). Every
-- other Phase 14 concept (the 'cross_insight' insightType, the
-- 'inferred' statusClass, the 'emerging'/'stable' temporalStates) is
-- representable in the existing free-text taxonomy columns with zero
-- migration — this is the sole additive schema change this phase
-- required.
ALTER TABLE insight_evidence
  ADD COLUMN IF NOT EXISTS source_insight_id uuid REFERENCES insights(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS insight_evidence_source_insight_id_idx
  ON insight_evidence (source_insight_id);

-- Real database-level duplicate protection for a cross_insight's
-- 'insight' evidence rows, mirroring migrations 0012/0013/0014's exact
-- pattern. Keyed on (insight_id, source_insight_id), NOT just
-- insight_id: a cross_insight legitimately has 2+ 'insight' evidence
-- rows (one per contributing first-order insight), so uniqueness must
-- allow multiple DISTINCT source_insight_ids per insight while still
-- blocking an exact duplicate under a race (e.g. a React StrictMode
-- double effect-fire).
CREATE UNIQUE INDEX IF NOT EXISTS insight_evidence_insight_source_insight_unique
  ON insight_evidence (insight_id, source_insight_id)
  WHERE evidence_type = 'insight';
