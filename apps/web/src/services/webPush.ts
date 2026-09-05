/**
 * Phase 47 — real Web Push subscription management. Every function
 * here does exactly what its name says against the real browser APIs
 * (ServiceWorkerContainer, PushManager) — no simulated subscription
 * object, no fake success. Callers must check `isWebPushSupported()`
 * before calling anything else; on an unsupported browser these
 * throw, and the UI is responsible for never reaching that call.
 */

export function isWebPushSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window;
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register('/sw.js');
}

/** Returns the browser's real current subscription for this origin, or null if none exists. */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isWebPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

/**
 * Registers the service worker and creates a real browser push
 * subscription against the given VAPID public key. Must only be
 * called after Notification permission is already 'granted' — the
 * browser rejects `pushManager.subscribe` otherwise.
 */
export async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscription> {
  const registration = await getRegistration();
  await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToUint8Array(vapidPublicKey),
  });
}

/** Real unsubscribe — tells the browser's push service to invalidate the endpoint, not just a local preference flip. */
export async function unsubscribeFromPush(): Promise<void> {
  const subscription = await getExistingSubscription();
  if (subscription) await subscription.unsubscribe();
}
