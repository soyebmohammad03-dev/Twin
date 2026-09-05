import type { PersonalModelCategory } from '@twin/contracts';

/**
 * Item 2's category taxonomy — deliberately limited to categories
 * groundable in what Phase 1-8 actually populate today:
 * entities/entity_relationships/relationship_evidence/memories. Two
 * categories the product brief names (communication_tendencies,
 * working_context) are NOT here: there is no communication-channel or
 * working-context signal anywhere in the schema, and inventing a
 * heuristic for them would produce confident-looking output with no
 * real evidence behind it — the one thing this system must never do.
 * If a future phase adds real signal for either, add it here.
 */
export const PERSONAL_MODEL_CATEGORIES: readonly PersonalModelCategory[] = [
  'important_people',
  'active_projects',
  'goals',
  'decisions',
  'knowledge_areas',
  'recurring_topics',
  'preferences',
  'constraints',
  'current_priorities',
];

/** Entity-grounded categories map 1:1 to an entities.entity_type. */
export const CATEGORY_TO_ENTITY_TYPE: Partial<Record<PersonalModelCategory, 'person' | 'project' | 'goal' | 'decision' | 'idea'>> = {
  important_people: 'person',
  active_projects: 'project',
  goals: 'goal',
  decisions: 'decision',
  knowledge_areas: 'idea',
};

/** A fact's confidence below this is surfaced under "uncertain / needs confirmation" regardless of category. Documented heuristic, not tuned. */
export const UNCERTAIN_CONFIDENCE_THRESHOLD = 0.5;
