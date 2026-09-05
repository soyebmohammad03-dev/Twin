import { describe, expect, it } from 'vitest';
import { localHour, localDateKey, isValidTimeZone } from '../src/worker/timezone.js';
import { buildMorningBriefing } from '../src/worker/briefing.js';
import { buildEveningSynthesis } from '../src/worker/synthesis.js';

describe('worker timezone math', () => {
  it('computes the correct local hour for a known UTC instant in a non-UTC zone', () => {
    // 2026-06-01T13:00:00Z is 09:00 in America/New_York (EDT, UTC-4) mid-summer.
    expect(localHour(new Date('2026-06-01T13:00:00.000Z'), 'America/New_York')).toBe(9);
  });

  it('handles the US DST transition correctly (America/New_York, before vs. after spring-forward)', () => {
    // Early March: still EST (UTC-5) — 07:30 local is 12:30Z.
    expect(localHour(new Date('2026-03-01T12:30:00.000Z'), 'America/New_York')).toBe(7);
    // Late March: already EDT (UTC-4) — 07:30 local is 11:30Z, one hour earlier in UTC for the same local hour.
    expect(localHour(new Date('2026-03-20T11:30:00.000Z'), 'America/New_York')).toBe(7);
  });

  it('returns the correct local calendar date even when it differs from the UTC date', () => {
    // 2026-06-02T02:00:00Z is already 2026-06-02 14:00 in Pacific/Auckland (UTC+12 in June).
    expect(localDateKey(new Date('2026-06-02T02:00:00.000Z'), 'Pacific/Auckland')).toBe('2026-06-02');
    // 2026-06-01T23:30:00Z is still 2026-06-01 16:30 in America/Los_Angeles (UTC-7 in DST).
    expect(localDateKey(new Date('2026-06-01T23:30:00.000Z'), 'America/Los_Angeles')).toBe('2026-06-01');
  });

  it('returns null for an invalid IANA zone rather than throwing or defaulting to UTC', () => {
    expect(localHour(new Date(), 'Not/A_Real_Zone')).toBeNull();
    expect(localDateKey(new Date(), 'Not/A_Real_Zone')).toBeNull();
    expect(isValidTimeZone('Not/A_Real_Zone')).toBe(false);
    expect(isValidTimeZone('America/New_York')).toBe(true);
  });
});

describe('buildMorningBriefing (pure)', () => {
  it('returns null for a completely empty account — never a useless notification', () => {
    expect(buildMorningBriefing([], [])).toBeNull();
  });

  it('returns null when facts exist but none are current, and there are no insights', () => {
    const facts = [{ category: 'active_projects', temporalState: 'superseded', factText: 'Old project.' }];
    expect(buildMorningBriefing(facts, [])).toBeNull();
  });

  it('builds real content from a current priority fact, citing its actual text', () => {
    const facts = [{ category: 'current_priorities', temporalState: 'current', factText: 'Ship the Q3 redesign.' }];
    const result = buildMorningBriefing(facts, []);
    expect(result).not.toBeNull();
    expect(result!.body).toContain('Ship the Q3 redesign.');
  });

  it('counts current active projects and goals without fabricating any', () => {
    const facts = [
      { category: 'active_projects', temporalState: 'current', factText: 'Working on Zephyr.' },
      { category: 'active_projects', temporalState: 'current', factText: 'Working on Atlas.' },
      { category: 'goals', temporalState: 'current', factText: 'Learn Spanish.' },
    ];
    const result = buildMorningBriefing(facts, []);
    expect(result!.body).toContain('2 active projects');
    expect(result!.body).toContain('1 goal tracked');
  });

  it('includes a real open insight title but excludes dismissed ones', () => {
    const insights = [
      { dismissedAt: null, title: 'Zephyr comes up repeatedly.' },
      { dismissedAt: new Date(), title: 'Dismissed one.' },
    ];
    const result = buildMorningBriefing([], insights);
    expect(result!.body).toContain('1 open insight');
    expect(result!.body).toContain('Zephyr comes up repeatedly.');
    expect(result!.body).not.toContain('Dismissed one.');
  });
});

describe('buildEveningSynthesis (pure)', () => {
  const tz = 'UTC';
  const today = '2026-06-01';

  it('returns null when nothing happened today, even if older data exists', () => {
    const changes = [{ createdAt: new Date('2026-05-20T10:00:00.000Z'), description: 'Old change.' }];
    const insights = [{ createdAt: new Date('2026-05-20T10:00:00.000Z'), dismissedAt: null, title: 'Old insight.' }];
    expect(buildEveningSynthesis(changes, insights, today, tz)).toBeNull();
  });

  it('summarizes real Personal Model changes from today, with an accurate count', () => {
    const changes = [
      { createdAt: new Date('2026-06-01T09:00:00.000Z'), description: 'New project detected.' },
      { createdAt: new Date('2026-06-01T15:00:00.000Z'), description: 'Priority confirmed.' },
    ];
    const result = buildEveningSynthesis(changes, [], today, tz);
    expect(result!.body).toContain('2 changes');
  });

  it('includes a real insight title from today, excluding dismissed ones', () => {
    const insights = [
      { createdAt: new Date('2026-06-01T12:00:00.000Z'), dismissedAt: null, title: 'Recurring topic: Zephyr.' },
      { createdAt: new Date('2026-06-01T12:00:00.000Z'), dismissedAt: new Date(), title: 'Dismissed today.' },
    ];
    const result = buildEveningSynthesis([], insights, today, tz);
    expect(result!.body).toContain('1 new insight');
    expect(result!.body).toContain('Recurring topic: Zephyr.');
    expect(result!.body).not.toContain('Dismissed today.');
  });
});
