import { describe, expect, it, afterEach } from 'vitest';
import { getSpeechRecognitionCtor } from './CaptureModal';

/**
 * Phase 45: this is the one piece of the real Web Speech API voice
 * capture that's pure enough to test without a DOM (the test suite is
 * node-environment only, see vitest.config.ts). It's also the exact
 * branch that decides between showing the user an honest "unsupported
 * browser" message and starting real recognition — get it wrong and
 * either a supported browser silently gets no voice feature, or an
 * unsupported one crashes instead of degrading gracefully.
 */
describe('getSpeechRecognitionCtor', () => {
  afterEach(() => {
    delete (globalThis as any).window;
  });

  it('returns null when window is unavailable (SSR / no browser)', () => {
    expect(getSpeechRecognitionCtor()).toBeNull();
  });

  it('returns null when the browser has neither SpeechRecognition nor webkitSpeechRecognition', () => {
    (globalThis as any).window = {};
    expect(getSpeechRecognitionCtor()).toBeNull();
  });

  it('returns the standard SpeechRecognition constructor when present', () => {
    class FakeSpeechRecognition {}
    (globalThis as any).window = { SpeechRecognition: FakeSpeechRecognition };
    expect(getSpeechRecognitionCtor()).toBe(FakeSpeechRecognition);
  });

  it('falls back to webkitSpeechRecognition when SpeechRecognition is absent', () => {
    class FakeWebkitSpeechRecognition {}
    (globalThis as any).window = { webkitSpeechRecognition: FakeWebkitSpeechRecognition };
    expect(getSpeechRecognitionCtor()).toBe(FakeWebkitSpeechRecognition);
  });
});
