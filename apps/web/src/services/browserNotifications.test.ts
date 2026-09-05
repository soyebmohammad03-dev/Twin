import { describe, expect, it, afterEach, vi } from 'vitest';
import { getBrowserNotificationSupport, requestBrowserNotificationPermission, showBrowserNotification } from './browserNotifications';

/**
 * Phase 46: the test suite is node-environment only (see
 * vitest.config.ts), so these cover the pure browser-capability-
 * detection logic without a DOM — the same pattern
 * CaptureModal.speech.test.ts uses for the Web Speech API.
 */
describe('browserNotifications', () => {
  afterEach(() => {
    delete (globalThis as any).window;
  });

  it('reports unsupported when window is unavailable (SSR / no browser)', () => {
    expect(getBrowserNotificationSupport()).toBe('unsupported');
  });

  it('reports unsupported when the browser has no Notification constructor', () => {
    (globalThis as any).window = {};
    expect(getBrowserNotificationSupport()).toBe('unsupported');
  });

  it('reports the real Notification.permission value when supported', () => {
    (globalThis as any).window = { Notification: { permission: 'denied' } };
    expect(getBrowserNotificationSupport()).toBe('denied');
  });

  it('requestBrowserNotificationPermission resolves unsupported without calling anything when Notification is absent', async () => {
    (globalThis as any).window = {};
    await expect(requestBrowserNotificationPermission()).resolves.toBe('unsupported');
  });

  it('requestBrowserNotificationPermission calls the real API and returns its result', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted');
    (globalThis as any).window = { Notification: { permission: 'default', requestPermission } };
    await expect(requestBrowserNotificationPermission()).resolves.toBe('granted');
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it('showBrowserNotification never constructs a Notification when permission is not granted', () => {
    const ctor = vi.fn();
    (globalThis as any).window = { Notification: Object.assign(ctor, { permission: 'default' }) };
    showBrowserNotification('Title', 'Body');
    expect(ctor).not.toHaveBeenCalled();
  });

  it('showBrowserNotification constructs a real Notification with the given title/body when granted', () => {
    const ctor = vi.fn();
    (globalThis as any).window = { Notification: Object.assign(ctor, { permission: 'granted' }) };
    showBrowserNotification('Pattern detected', 'You keep mentioning Project Zephyr.');
    expect(ctor).toHaveBeenCalledWith('Pattern detected', { body: 'You keep mentioning Project Zephyr.' });
  });
});
