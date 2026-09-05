/**
 * Phase 46 — thin, honest wrapper around the browser's native
 * Notification API. No service worker, no Web Push subscription: this
 * can only show a notification while this tab is open and the browser
 * process is running. That is a real, disclosed limitation, not a
 * placeholder — see AccountModal's Notifications tab copy.
 */

export type BrowserNotificationSupport = 'unsupported' | 'default' | 'granted' | 'denied';

export function getBrowserNotificationSupport(): BrowserNotificationSupport {
  if (typeof window === 'undefined' || typeof window.Notification === 'undefined') return 'unsupported';
  return window.Notification.permission;
}

/** Must only be called from an explicit user action (a click) — never automatically, and never repeatedly. */
export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationSupport> {
  if (typeof window === 'undefined' || typeof window.Notification === 'undefined') return 'unsupported';
  const result = await window.Notification.requestPermission();
  return result;
}

/** Fires a real, native OS-level notification. Only call this when getBrowserNotificationSupport() === 'granted'. */
export function showBrowserNotification(title: string, body: string): void {
  if (typeof window === 'undefined' || typeof window.Notification === 'undefined') return;
  if (window.Notification.permission !== 'granted') return;
  new window.Notification(title, { body });
}
