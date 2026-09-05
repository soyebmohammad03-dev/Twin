/**
 * Phase 47 — timezone math for the scheduler. Deliberately built on
 * Node's built-in `Intl` (full ICU is bundled by default in modern
 * Node), not a date library: this is the smallest correct way to ask
 * "what is the local hour/calendar date for this IANA zone right now,"
 * including DST transitions, which Intl already handles correctly.
 */

/** Returns null for an invalid/unrecognized IANA zone name rather than throwing or silently falling back to UTC — the caller must treat that user as unschedulable this cycle, not guess. */
export function localHour(date: Date, timeZone: string): number | null {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' });
    const hourPart = formatter.formatToParts(date).find((p) => p.type === 'hour');
    if (!hourPart) return null;
    const hour = Number(hourPart.value);
    return Number.isFinite(hour) ? hour : null;
  } catch {
    return null;
  }
}

/** The user's own local calendar date as "YYYY-MM-DD" — the scheduling period key for once-per-day categories. Null on an invalid zone, same contract as localHour. */
export function localDateKey(date: Date, timeZone: string): string | null {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    // en-CA formats as YYYY-MM-DD directly — no manual part-reassembly.
    return formatter.format(date);
  } catch {
    return null;
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}
