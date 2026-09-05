/**
 * Item 8's conflict preservation, applied during model build to decide
 * stability/temporalState — never to pick a winner. Two independent,
 * narrow, deterministic detectors (mirrors the same "structural, not
 * semantic" philosophy as context/conflicts.ts from Phase 8):
 *
 *   - project conflicts: the same person entity linked to more than
 *     one project via the same relationship type (e.g. "works_on") —
 *     reuses the exact grouping rule Phase 8 already validated.
 *   - preference conflicts: the same normalized subject phrase
 *     (e.g. "dark mode") appearing with BOTH positive and negative
 *     sentiment among a user's preference observations.
 *
 * Both intentionally miss semantically-related-but-differently-worded
 * conflicts (e.g. "prefer working at night" vs "started working early
 * mornings" share no literal subject phrase) — documented as a known
 * limitation, not silently overclaimed.
 */

export interface RelationshipConflictInput {
  relationshipId: string;
  fromEntityId: string;
  relationshipType: string;
  toEntityId: string;
  lastObservedAt: Date;
}

export interface RelationshipConflictResult {
  /** relationshipId -> the OTHER relationshipIds it conflicts with (same fromEntity+type, different toEntity). */
  conflictsByRelationshipId: Map<string, string[]>;
  /** relationshipId -> true if a newer relationship in its conflict group supersedes it. */
  supersededByNewer: Map<string, boolean>;
}

export function detectRelationshipConflicts(relationships: RelationshipConflictInput[]): RelationshipConflictResult {
  const groups = new Map<string, RelationshipConflictInput[]>();
  for (const rel of relationships) {
    const key = `${rel.fromEntityId}::${rel.relationshipType}`;
    const group = groups.get(key) ?? [];
    group.push(rel);
    groups.set(key, group);
  }

  const conflictsByRelationshipId = new Map<string, string[]>();
  const supersededByNewer = new Map<string, boolean>();

  for (const group of groups.values()) {
    const distinctTargets = new Set(group.map((r) => r.toEntityId));
    if (distinctTargets.size < 2) continue;

    const sortedByRecency = [...group].sort((a, b) => b.lastObservedAt.getTime() - a.lastObservedAt.getTime());
    const newest = sortedByRecency[0];
    if (!newest) continue;
    for (const rel of group) {
      conflictsByRelationshipId.set(
        rel.relationshipId,
        group.filter((r) => r.relationshipId !== rel.relationshipId).map((r) => r.relationshipId),
      );
      supersededByNewer.set(rel.relationshipId, rel.relationshipId !== newest.relationshipId);
    }
  }

  return { conflictsByRelationshipId, supersededByNewer };
}

export interface PreferenceConflictInput {
  factSubjectKey: string; // e.g. "like:dark mode" — the persisted fact's own key
  subject: string; // e.g. "dark mode" — the conflict-grouping key, not persisted
  sentiment: 'positive' | 'negative';
}

/** factSubjectKey -> true if a fact with the opposite sentiment exists for the same subject. */
export function detectPreferenceConflicts(inputs: PreferenceConflictInput[]): Map<string, boolean> {
  const bySubject = new Map<string, Set<'positive' | 'negative'>>();
  for (const input of inputs) {
    const set = bySubject.get(input.subject) ?? new Set();
    set.add(input.sentiment);
    bySubject.set(input.subject, set);
  }

  const result = new Map<string, boolean>();
  for (const input of inputs) {
    const sentiments = bySubject.get(input.subject);
    result.set(input.factSubjectKey, Boolean(sentiments) && sentiments!.size > 1);
  }
  return result;
}
