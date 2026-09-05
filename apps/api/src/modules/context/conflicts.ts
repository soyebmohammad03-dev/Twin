import type { ContextConflict } from '@twin/contracts';

/**
 * Item 8/9's conflict preservation — deliberately narrow. This is NOT
 * contradiction resolution and does not read memory text at all (full
 * contradiction intelligence is explicitly out of scope this phase).
 * The only structural signal implemented: two or more DISTINCT
 * relationships sharing (fromEntityId, relationshipType) but pointing
 * at different toEntityId, both present in the same packet — exactly
 * the worked example ("Arjun works_on Project A" and "Arjun works_on
 * Project B" coexisting). Both relationships are left untouched in the
 * packet; this only adds a pointer so a caller can notice.
 */

interface RelationshipLike {
  relationshipId: string;
  fromEntityId: string;
  relationshipType: string;
  toEntityId: string;
}

export function detectRelationshipConflicts(relationships: RelationshipLike[]): ContextConflict[] {
  const groups = new Map<string, { fromEntityId: string; relationshipType: string; byToEntity: Map<string, string> }>();

  for (const rel of relationships) {
    const key = `${rel.fromEntityId}::${rel.relationshipType}`;
    let group = groups.get(key);
    if (!group) {
      group = { fromEntityId: rel.fromEntityId, relationshipType: rel.relationshipType, byToEntity: new Map() };
      groups.set(key, group);
    }
    // First relationship id seen for a given toEntityId wins — duplicate
    // (from, to, type) edges can't exist per the DB's unique constraint,
    // so this only dedupes if the same relationship appears twice in input.
    if (!group.byToEntity.has(rel.toEntityId)) {
      group.byToEntity.set(rel.toEntityId, rel.relationshipId);
    }
  }

  const conflicts: ContextConflict[] = [];
  for (const group of groups.values()) {
    if (group.byToEntity.size < 2) continue;
    const relationshipIds = [...group.byToEntity.values()].sort();
    conflicts.push({
      type: 'relationship_conflict',
      fromEntityId: group.fromEntityId,
      relationshipType: group.relationshipType,
      relationshipIds,
      description: `Found ${group.byToEntity.size} different "${group.relationshipType}" relationships from the same entity — this may represent a change over time or genuinely conflicting evidence. Both are preserved; neither was assumed correct.`,
    });
  }

  conflicts.sort((a, b) => (a.fromEntityId + a.relationshipType).localeCompare(b.fromEntityId + b.relationshipType));
  return conflicts;
}
