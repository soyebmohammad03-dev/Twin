ALTER TABLE "insight_evidence" ADD COLUMN "decision_history_id" uuid;--> statement-breakpoint
ALTER TABLE "insight_evidence" ADD CONSTRAINT "insight_evidence_decision_history_id_decision_history_id_fk" FOREIGN KEY ("decision_history_id") REFERENCES "public"."decision_history"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Phase 37: real database-level duplicate protection for a
-- decision_evolution insight's 'decision_history' evidence rows,
-- mirroring migrations 0013/0014's pattern. Keyed on (insight_id,
-- decision_history_id), NOT just insight_id: a decision_evolution
-- insight legitimately has multiple decision_history evidence rows
-- (one per real transition), so uniqueness must allow multiple
-- DISTINCT decision_history ids per insight while still blocking an
-- exact duplicate under a race (e.g. a React StrictMode double
-- effect-fire).
CREATE UNIQUE INDEX IF NOT EXISTS insight_evidence_insight_decision_history_unique
  ON insight_evidence (insight_id, decision_history_id)
  WHERE evidence_type = 'decision_history';