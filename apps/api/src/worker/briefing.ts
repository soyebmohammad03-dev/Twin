import type { Queryable } from '@twin/db';
import { getCurrentModel } from '../modules/personalModel/personalModelService.js';
import { getCurrentInsights } from '../modules/insights/insightsService.js';
import { createScheduled, type NotificationRow, type NotificationPreferencesRow } from '../modules/notifications/notificationsStore.js';
import { localHour, localDateKey } from './timezone.js';

/** Local hours during which a Morning Briefing may fire — a window, not an exact minute, so a worker cycle that runs every WORKER_INTERVAL_MS still catches it reliably (and a missed cycle from downtime is caught by the next one within the same window, per "reasonable missed-run behavior"). */
export const MORNING_WINDOW_START_HOUR = 7;
export const MORNING_WINDOW_END_HOUR = 9;

interface FactLike {
  category: string;
  temporalState: string;
  factText: string;
}
interface InsightLike {
  dismissedAt: Date | null;
  title: string;
}

/**
 * Pure, deterministic content builder — no I/O, directly unit
 * testable. Returns null when there is nothing real and current
 * enough to summarize, per Phase 47's explicit rule: "DO NOT CREATE A
 * USELESS NOTIFICATION." Every number and quoted title here is read
 * straight off already-persisted Personal Model facts / insights —
 * nothing is invented, no deadline or priority not already recorded.
 */
export function buildMorningBriefing(facts: FactLike[], insights: InsightLike[]): { title: string; body: string } | null {
  const current = facts.filter((f) => f.temporalState === 'current');
  const priorities = current.filter((f) => f.category === 'current_priorities');
  const projects = current.filter((f) => f.category === 'active_projects');
  const goals = current.filter((f) => f.category === 'goals');
  const openInsights = insights.filter((i) => !i.dismissedAt);

  if (priorities.length === 0 && projects.length === 0 && goals.length === 0 && openInsights.length === 0) {
    return null;
  }

  const parts: string[] = [];
  if (priorities.length > 0) parts.push(`Top priority: ${priorities[0]!.factText}.`);
  if (projects.length > 0) parts.push(`${projects.length} active project${projects.length === 1 ? '' : 's'}.`);
  if (goals.length > 0) parts.push(`${goals.length} goal${goals.length === 1 ? '' : 's'} tracked.`);
  if (openInsights.length > 0) {
    parts.push(`${openInsights.length} open insight${openInsights.length === 1 ? '' : 's'}, including "${openInsights[0]!.title}".`);
  }

  return { title: 'Your Morning Briefing', body: parts.join(' ') };
}

export type BriefingOutcome =
  | { status: 'not_in_window' }
  | { status: 'suppressed_no_signal' }
  | { status: 'duplicate' }
  | { status: 'generated'; notification: NotificationRow };

/**
 * DB-orchestration wrapper around buildMorningBriefing — calls the
 * SAME service functions the rest of the app uses (getCurrentModel,
 * getCurrentInsights), never a copy of their logic. Idempotency is
 * enforced by createScheduled's DB-level unique(dedupeKey), not by
 * this function checking-then-inserting.
 */
export async function tryGenerateMorningBriefing(db: Queryable, pref: NotificationPreferencesRow, now: Date): Promise<BriefingOutcome> {
  const hour = localHour(now, pref.timezone);
  if (hour === null || hour < MORNING_WINDOW_START_HOUR || hour >= MORNING_WINDOW_END_HOUR) {
    return { status: 'not_in_window' };
  }
  const dateKey = localDateKey(now, pref.timezone);
  if (dateKey === null) return { status: 'not_in_window' };

  const [facts, insights] = await Promise.all([getCurrentModel(db, pref.userId), getCurrentInsights(db, pref.userId)]);
  const content = buildMorningBriefing(facts, insights);
  if (!content) return { status: 'suppressed_no_signal' };

  const row = await createScheduled(db, pref.userId, {
    category: 'morning_briefing',
    title: content.title,
    body: content.body,
    dedupeKey: `${pref.userId}:morning_briefing:${dateKey}`,
  });
  return row ? { status: 'generated', notification: row } : { status: 'duplicate' };
}
