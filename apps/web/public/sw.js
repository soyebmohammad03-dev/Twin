/**
 * Phase 47 — the minimum real service worker needed for Web Push
 * background delivery: no offline caching, no asset interception,
 * nothing beyond the two events push delivery actually requires. The
 * payload is exactly what apps/api/src/worker/push.ts sends —
 * { id, title, body } — never anything richer invented client-side.
 */
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }
  const { id, title, body } = payload;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: id,
      data: { notificationId: id },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    }),
  );
});
