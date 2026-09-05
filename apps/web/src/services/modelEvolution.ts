/**
 * Phase 23 — pure adapter from real Personal Model change-log rows
 * (PersonalModelChangeDto, from GET /twin/model/changes — fully built
 * server-side since Phase 9's rebuild engine, never before surfaced in
 * the frontend) to a display shape for ModelEvolutionSection. The
 * description text always comes verbatim from the backend (already a
 * real, deterministic sentence — see personalModelStore.ts /
 * personalModelService.ts); this module only adds an icon and a short
 * label per changeType, never inventing new wording.
 */

import type { PersonalModelChangeDto } from '@twin/contracts';

const CHANGE_TYPE_META: Record<string, { icon: string; label: string }> = {
  new_person: { icon: 'person_add', label: 'New person' },
  project_started: { icon: 'rocket_launch', label: 'New project' },
  new_goal: { icon: 'flag', label: 'New goal' },
  new_decision: { icon: 'gavel', label: 'New decision' },
  new_preference: { icon: 'favorite', label: 'New preference' },
  new_constraint: { icon: 'block', label: 'New constraint' },
  new_priority: { icon: 'priority_high', label: 'New priority' },
  interest_strengthened: { icon: 'trending_up', label: 'Confidence increased' },
  project_became_inactive: { icon: 'pause_circle', label: 'Project went quiet' },
  fact_became_historical: { icon: 'history', label: 'No longer current' },
  belief_became_uncertain: { icon: 'trending_down', label: 'Confidence decreased' },
  fact_corrected: { icon: 'edit', label: 'You corrected this' },
  fact_superseded: { icon: 'sync_alt', label: 'You replaced this' },
  fact_contradicted: { icon: 'cancel', label: 'You said this changed' },
  fact_weakened: { icon: 'trending_down', label: 'You expressed uncertainty' },
  fact_dismissed: { icon: 'visibility_off', label: 'You dismissed this' },
};

const DEFAULT_META = { icon: 'auto_awesome', label: 'Model updated' };

export interface EvolutionItem {
  id: string;
  icon: string;
  label: string;
  description: string;
  factId: string | null;
  createdAt: string;
}

export function toEvolutionItem(change: PersonalModelChangeDto): EvolutionItem {
  const meta = CHANGE_TYPE_META[change.changeType] ?? DEFAULT_META;
  return {
    id: change.id,
    icon: meta.icon,
    label: meta.label,
    description: change.description,
    factId: change.factId,
    createdAt: change.createdAt,
  };
}

export interface EvolutionGroup {
  dateLabel: string;
  items: EvolutionItem[];
}

/** Groups real change entries by calendar day (already in reverse-chronological order from the backend — see personalModelService.ts's listChanges) for a readable timeline, without inventing any missing days. */
export function groupEvolutionByDay(changes: PersonalModelChangeDto[]): EvolutionGroup[] {
  const groups: EvolutionGroup[] = [];
  const indexByLabel = new Map<string, number>();

  for (const change of changes) {
    const dateLabel = new Date(change.createdAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    let index = indexByLabel.get(dateLabel);
    if (index === undefined) {
      index = groups.length;
      groups.push({ dateLabel, items: [] });
      indexByLabel.set(dateLabel, index);
    }
    groups[index]!.items.push(toEvolutionItem(change));
  }

  return groups;
}
