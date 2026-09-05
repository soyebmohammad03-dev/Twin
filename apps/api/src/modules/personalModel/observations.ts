import type { EpistemicStatus } from '@twin/contracts';

/**
 * An "observation" is the atomic, evidence-tagged raw signal the model
 * engine aggregates into facts — one per (memory link | relationship
 * evidence | extracted phrase | user action). Never persisted under
 * this shape directly; personal_model_fact_evidence rows are written
 * from these after aggregation.
 */
export interface Observation {
  epistemicStatus: EpistemicStatus;
  confidence: number;
  observedAt: Date;
  evidenceSource: 'memory' | 'relationship' | 'user_confirmation' | 'user_correction' | 'user_dismissal';
  memoryId: string | null;
  relationshipId: string | null;
  entityId: string | null;
  evidenceText: string | null;
}

export interface FactCandidate {
  category: string;
  subjectKey: string;
  subjectEntityId: string | null;
  factText: string;
  observations: Observation[];
  /** In-memory-only grouping key for conflict detection (e.g. a preference's bare subject, or a project's linking-person id) — never persisted. */
  conflictGroupKey: string | null;
}

/** Dedupes observations that would double-count the same underlying evidence (e.g. a memory linked to an entity AND separately picked up by relationship evidence pointing at the same memory). */
export function distinctObservationCount(observations: Observation[]): number {
  const keys = new Set(
    observations.map((o) => o.memoryId ?? o.relationshipId ?? `${o.evidenceSource}:${o.observedAt.getTime()}:${o.evidenceText ?? ''}`),
  );
  return keys.size;
}
