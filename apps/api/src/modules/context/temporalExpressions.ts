/**
 * Phase 17's deterministic temporal query understanding — item 7's
 * explicit requirement: recognize obvious relative-date expressions
 * WITHOUT an LLM, and structure this as a clean seam so an LLM-backed
 * query planner could replace or augment it later without touching
 * retrieval.service.ts/contextEngine.ts's call sites.
 *
 * Scope, deliberately narrow: this module only ever produces a bounded
 * `[occurredAfter, occurredBefore)` DATE RANGE, and only for
 * expressions that genuinely mean one (today, yesterday, this/last
 * week, this/last month, "recently"). Three other temporal phrases the
 * Phase 17 brief names are NOT date-range expressions and are
 * deliberately NOT handled here, because building a fake range for
 * them would misrepresent what they actually mean:
 *
 *   - "latest"/"current"  -> already the job of ranking.ts's
 *     recencyScore signal (exponential recency decay) — a RANKING
 *     preference, not a filter. Adding a date-range for this would
 *     silently exclude genuinely relevant older memories instead of
 *     just ranking recent ones higher.
 *   - "originally"/"historical" -> same reasoning in reverse; there is
 *     no principled cutoff date for "originally", only a ranking
 *     preference for older evidence. Out of scope for a date-range
 *     parser; a future ranking-direction toggle could address it
 *     without this module's involvement.
 *   - "what changed" -> answered by already-existing structured data
 *     (personal_model_changes, insight temporalState transitions),
 *     not by filtering memories at all. A future phase could surface
 *     that data through this same retrieval/context surface, but it
 *     is a different query shape, not a date range.
 *
 * A caller-supplied explicit occurredAfter/occurredBefore ALWAYS wins —
 * this module is only ever consulted as a fallback when the caller
 * passed neither (see contextEngine.ts/retrieval.service.ts). Pure,
 * synchronous, and takes `now` as a parameter so it's fully
 * deterministic and testable without faking the system clock.
 */

export interface TemporalExpressionMatch {
  occurredAfter: Date;
  occurredBefore: Date;
  /** Deterministic, inspectable reason — never a free-text explanation invented after the fact. */
  signal: string;
}

/** How many days back "recently"/"recent" looks — a documented, initial heuristic (same spirit as ranking.ts's RECENCY_HALF_LIFE_DAYS), not tuned. Deliberately a plain window (not a decay curve) since this produces a hard filter, distinct from the recency RANKING signal that already exists. */
export const RECENTLY_WINDOW_DAYS = 14;

const DAY_MS = 1000 * 60 * 60 * 24;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
/** Monday-start week, matching common calendar convention — Sunday (0) rolls back 6 days rather than 0. */
function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  return startOfDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff));
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

/**
 * Ordered rule list — first match wins, most-specific first (checked
 * against the same "today" also matching a looser "recently"-style
 * pattern were one ever added). Each pattern is a plain, documented
 * regex; no NLP library, no fuzzy matching.
 */
const RULES: { pattern: RegExp; resolve: (now: Date) => { occurredAfter: Date; occurredBefore: Date }; signal: string }[] = [
  {
    pattern: /\btoday\b/i,
    resolve: (now) => ({ occurredAfter: startOfDay(now), occurredBefore: endOfDay(now) }),
    signal: "query contains 'today'",
  },
  {
    pattern: /\byesterday\b/i,
    resolve: (now) => {
      const y = new Date(now.getTime() - DAY_MS);
      return { occurredAfter: startOfDay(y), occurredBefore: endOfDay(y) };
    },
    signal: "query contains 'yesterday'",
  },
  {
    pattern: /\blast week\b/i,
    resolve: (now) => {
      const thisWeekStart = startOfWeek(now);
      const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * DAY_MS);
      const lastWeekEnd = new Date(thisWeekStart.getTime() - 1);
      return { occurredAfter: lastWeekStart, occurredBefore: lastWeekEnd };
    },
    signal: "query contains 'last week'",
  },
  {
    pattern: /\bthis week\b/i,
    resolve: (now) => ({ occurredAfter: startOfWeek(now), occurredBefore: endOfDay(now) }),
    signal: "query contains 'this week'",
  },
  {
    pattern: /\blast month\b/i,
    resolve: (now) => {
      const thisMonthStart = startOfMonth(now);
      const lastMonthStart = new Date(thisMonthStart.getFullYear(), thisMonthStart.getMonth() - 1, 1);
      return { occurredAfter: lastMonthStart, occurredBefore: endOfMonth(lastMonthStart) };
    },
    signal: "query contains 'last month'",
  },
  {
    pattern: /\bthis month\b/i,
    resolve: (now) => ({ occurredAfter: startOfMonth(now), occurredBefore: endOfDay(now) }),
    signal: "query contains 'this month'",
  },
  {
    pattern: /\b(recently|recent)\b/i,
    resolve: (now) => ({ occurredAfter: new Date(now.getTime() - RECENTLY_WINDOW_DAYS * DAY_MS), occurredBefore: endOfDay(now) }),
    signal: `query contains 'recently'/'recent' (last ${RECENTLY_WINDOW_DAYS} days)`,
  },
];

/**
 * Returns the first matching date-range expression in `query`, or null
 * if none of the recognized patterns fired — null is a legitimate,
 * common result (most queries have no temporal expression at all), not
 * a failure.
 */
export function parseTemporalExpression(query: string, now: Date = new Date()): TemporalExpressionMatch | null {
  for (const rule of RULES) {
    if (rule.pattern.test(query)) {
      const { occurredAfter, occurredBefore } = rule.resolve(now);
      return { occurredAfter, occurredBefore, signal: rule.signal };
    }
  }
  return null;
}
