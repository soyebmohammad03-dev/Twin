/**
 * Deterministic, regex-based extraction of preference/constraint
 * statements from memory content — item 16 prefers a deterministic
 * implementation where practical, and this is exactly the kind of
 * narrow, inspectable pattern-match that doesn't need an LLM. This is
 * NOT sentiment analysis: it only recognizes a small set of common
 * first-person phrasings, documented and honestly limited (see
 * PREFERENCE_PATTERNS below) — it will miss anything phrased
 * differently, and it does not understand semantic opposites (e.g. it
 * will not connect "I prefer working at night" with "I've started
 * working early mornings" as the same axis; it only detects conflict
 * when the SAME normalized subject phrase appears with both a
 * positive and a negative verb).
 */

export type PreferenceSentiment = 'positive' | 'negative';

export interface PreferenceMatch {
  /** The full matched clause, verb + subject (e.g. "love dark mode") — used as the persisted fact's subjectKey component, so "love dark mode" and "hate dark mode" remain distinct facts. Internal dedup key — not for display (see matchedText). */
  fullPhrase: string;
  /** Just the object of the verb, normalized (e.g. "dark mode") — used ONLY as an in-memory conflict-grouping key during model build, never persisted as a column. */
  subject: string;
  sentiment: PreferenceSentiment;
  /** True for hedged/uncertain phrasing ("might", "maybe", "possibly") — kept distinct from a flat statement so the caller can weight it down rather than treating "I might learn Rust" the same as "I am learning Rust". */
  hedged: boolean;
  /** The verbatim matched clause from the memory's own text (e.g. "love dark mode"), for display as evidence — never the internal fullPhrase key. */
  matchedText: string;
}

const POSITIVE_VERBS = ['really love', 'love', 'really like', 'like', 'prefer', 'enjoy'];
const NEGATIVE_VERBS = ["can't stand", 'cannot stand', 'hate', 'dislike'];
const CONSTRAINT_VERBS = ["don't have time for", 'do not have time for', "can't", 'cannot', "am unable to", 'is unable to'];
const HEDGE_WORDS = /\b(might|maybe|possibly|perhaps|may)\b/i;

/**
 * Phase 9.1: a negation word sitting between "I" and the verb ("I
 * don't really prefer X anymore") inverts the clause's meaning — left
 * undetected, the old regex would happily extract this as a POSITIVE
 * "prefer X" match, exactly backwards. `buildVerbPattern` now captures
 * this as the named `neg` group so callers can discard (rather than
 * misclassify) a negated match instead of silently getting the
 * polarity wrong.
 */
const NEGATION_WORDS = ["don't", 'do not', "doesn't", 'does not', "didn't", 'did not', 'no longer'];

function buildVerbPattern(verbs: string[]): RegExp {
  const escaped = verbs.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length);
  const negEscaped = [...new Set(NEGATION_WORDS)].sort((a, b) => b.length - a.length);
  // An optional negation word, then an optional filler ("really",
  // "actually"), then an optional hedge word, may sit between "I" and
  // the verb. Hedged ("I might prefer X") is still recognized as a
  // preference statement, just flagged `hedged: true` so the caller
  // can weight it down; negated ("I don't prefer X") is flagged `neg`
  // so the caller can discard it instead of extracting the opposite
  // meaning of what was said.
  // The neg/hedge groups are named AND implicitly numbered, which
  // shifts what used to be capture group 1 (the subject) further
  // along — the subject is captured by its own named group (`subj`)
  // instead so callers never depend on positional index.
  return new RegExp(
    `\\bI(?:'m| am)?\\s+(?<neg>${negEscaped.join('|')})?\\s*(?:really|actually|truly)?\\s*(?<hedge>might|maybe|possibly|perhaps|probably)?\\s*(?:${escaped.join('|')})\\s+(?<subj>[^.!?\\n]{2,80})`,
    'i',
  );
}

/**
 * Phase 9.1: deterministic cue phrases used by the correction flow to
 * classify how a corrected statement relates to the fact it's
 * correcting — never an LLM judgment, just a small, documented,
 * honestly-limited phrase list (same spirit as the preference/
 * constraint patterns above).
 *
 * REPLACEMENT_CUES: the correction both negates the old claim AND
 * states a new one ("I've switched to mornings", "I'm focused on the
 * Mobile app now") — the fact should reflect the new claim as current.
 *
 * PURE_NEGATION_CUES: the correction negates the old claim without
 * stating a replacement ("I don't really prefer dark mode anymore") —
 * the fact should be marked outdated with no assumed replacement.
 */
export const REPLACEMENT_CUES = /\b(switched to|changed to|moved to|now prefer|now working|focused on|started)\b/i;
export const PURE_NEGATION_CUES = /\b(no longer|not\s+any\s*more|anymore|isn'?t|aren'?t|wasn'?t|weren'?t|doesn'?t|don'?t|didn'?t|stopped|paused)\b/i;

/** True when `text` contains a deterministic cue that it negates/contradicts a prior claim (either kind of cue above). */
export function hasNegationCue(text: string): boolean {
  return REPLACEMENT_CUES.test(text) || PURE_NEGATION_CUES.test(text);
}

/** True when `text` states a replacement rather than a bare retraction — see REPLACEMENT_CUES. */
export function hasReplacementCue(text: string): boolean {
  return REPLACEMENT_CUES.test(text);
}

/** True when `text` contains one of the same hedge words the preference/constraint extractors recognize ("might", "maybe", ...). */
export function hasHedgeCue(text: string): boolean {
  return HEDGE_WORDS.test(text);
}

const POSITIVE_PATTERN = buildVerbPattern(POSITIVE_VERBS);
const NEGATIVE_PATTERN = buildVerbPattern(NEGATIVE_VERBS);
const CONSTRAINT_PATTERN = buildVerbPattern(CONSTRAINT_VERBS);

function normalizeSubject(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^(to|the|a|an)\s+/i, '')
    .replace(/[,;:].*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extracts positive/negative preference statements from one memory's content. Returns [] when nothing matches — most memories won't contain a recognizable preference phrase, and that's expected, not an error. */
export function extractPreferenceMatches(content: string): PreferenceMatch[] {
  const matches: PreferenceMatch[] = [];

  // A leading negation ("I don't really prefer X anymore") inverts the
  // clause — skip rather than extract it as a false-positive positive
  // match. There's no positive claim to record; a correction/negation
  // like this is handled separately by the correction flow's own cue
  // detection (see hasNegationCue below), not by this extractor.
  const positive = POSITIVE_PATTERN.exec(content);
  if (positive && !positive.groups?.neg) {
    const subject = normalizeSubject(positive.groups?.subj ?? '');
    if (subject.length >= 2) {
      matches.push({
        fullPhrase: `like:${subject}`,
        subject,
        sentiment: 'positive',
        hedged:
          Boolean(positive.groups?.hedge) ||
          HEDGE_WORDS.test(content.slice(Math.max(0, positive.index - 20), positive.index + positive[0].length)),
        matchedText: positive[0].replace(/^I(?:'m| am)?\s+/i, '').trim(),
      });
    }
  }

  const negative = NEGATIVE_PATTERN.exec(content);
  if (negative && !negative.groups?.neg) {
    const subject = normalizeSubject(negative.groups?.subj ?? '');
    if (subject.length >= 2) {
      matches.push({
        fullPhrase: `dislike:${subject}`,
        subject,
        sentiment: 'negative',
        hedged:
          Boolean(negative.groups?.hedge) ||
          HEDGE_WORDS.test(content.slice(Math.max(0, negative.index - 20), negative.index + negative[0].length)),
        matchedText: negative[0].replace(/^I(?:'m| am)?\s+/i, '').trim(),
      });
    }
  }

  return matches;
}

export interface ConstraintMatch {
  fullPhrase: string;
  subject: string;
  hedged: boolean;
  /** The verbatim matched clause from the memory's own text, for display as evidence — never the internal fullPhrase key. */
  matchedText: string;
}

/** Extracts limitation/constraint statements ("I don't have time for X", "I can't Y") from one memory's content. */
export function extractConstraintMatches(content: string): ConstraintMatch[] {
  const match = CONSTRAINT_PATTERN.exec(content);
  if (!match) return [];
  const subject = normalizeSubject(match.groups?.subj ?? '');
  if (subject.length < 2) return [];
  return [
    {
      fullPhrase: `constraint:${subject}`,
      subject,
      hedged: HEDGE_WORDS.test(content.slice(Math.max(0, match.index - 20), match.index + match[0].length)),
      matchedText: match[0].replace(/^I(?:'m| am)?\s+/i, '').trim(),
    },
  ];
}
