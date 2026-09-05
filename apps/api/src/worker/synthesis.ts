import type { Queryable } from '@twin/db';
import { listChanges } from '../modules/personalModel/personalModelService.js';
import { getCurrentInsights } from '../modules/insights/insightsService.js';
import { createScheduled, type NotificationRow, type NotificationPreferencesRow } from '../modules/notifications/notificationsStore.js';
import { localHour, localDateKey } from './timezone.js';

export const EVENING_WINDOW_START_HOUR = 19;
export const EVENING_WINDOW_END_HOUR = 21;

interface ChangeLike {
  createdAt: Date;
  description: string;
}
interface InsightLike {
  createdAt: Date;
  dismissedAt: Date | null;
  title: string;
}

/**
 * Pure, deterministic content builder. `today` is the user's own
 * local calendar date (from localDateKey) and `timeZone` is used only
 * to re-derive each record's local date for comparison — no I/O, no
 * invented reflection just because the clock says evening. Returns
 * null when nothing genuinely new happened today, per Phase 47's rule
 * to prefer silence over low-value generated content.
 */
export function buildEveningSynthesis(
  changes: ChangeLike[],
  insights: InsightLike[],
  today: string,
  timeZone: string,
): { title: string; body: string } | null {
  const todaysChanges = changes.filter((c) => localDateKey(c.createdAt, timeZone) === today);
  const todaysInsights = insights.filter((i) => !i.dismissedAt && localDateKey(i.createdAt, timeZone) === today);

  if (todaysChanges.length === 0 && todaysInsights.length === 0) return null;

  const parts: string[] = [];
  if (todaysChanges.length > 0) {
    parts.push(`Today Twin recorded ${todaysChanges.length} change${todaysChanges.length === 1 ? '' : 's'} to your Personal Model.`);
  }
  if (todaysInsights.length > 0) {
    parts.push(`${todaysInsights.length} new insight${todaysInsights.length === 1 ? '' : 's'} today, including "${todaysInsights[0]!.title}".`);
  }

  return { title: 'Your Evening Synthesis', body: parts.join(' ') };
}

export type SynthesisOutcome =
  | { status: 'not_in_window' }
  | { status: 'suppressed_no_signal' }
  | { status: 'duplicate' }
  | { status: 'generated'; notification: NotificationRow };

export async function tryGenerateEveningSynthesis(db: Queryable, pref: NotificationPreferencesRow, now: Date): Promise<SynthesisOutcome> {
  const hour = localHour(now, pref.timezone);
  if (hour === null || hour < EVENING_WINDOW_START_HOUR || hour >= EVENING_WINDOW_END_HOUR) {
    return { status: 'not_in_window' };
  }
  const dateKey = localDateKey(now, pref.timezone);
  if (dateKey === null) return { status: 'not_in_window' };

  const [changes, insights] = await Promise.all([listChanges(db, pref.userId), getCurrentInsights(db, pref.userId)]);
  const content = buildEveningSynthesis(changes, insights, dateKey, pref.timezone);
  if (!content) return { status: 'suppressed_no_signal' };

  const row = await createScheduled(db, pref.userId, {
    category: 'evening_synthesis',
    title: content.title,
    body: content.body,
    dedupeKey: `${pref.userId}:evening_synthesis:${dateKey}`,
  });
  return row ? { status: 'generated', notification: row } : { status: 'duplicate' };
}
