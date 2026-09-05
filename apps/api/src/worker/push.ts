import webpush from 'web-push';
import type { Queryable } from '@twin/db';
import { env } from '../config/env.js';
import {
  listPushSubscriptionsForUser,
  markPushSubscriptionUsed,
  deletePushSubscriptionById,
  markDeliveredById,
  type PushSubscriptionRow,
} from '../modules/notifications/notificationsStore.js';

/**
 * True only when a full VAPID keypair + subject are configured. Push
 * delivery is entirely optional infrastructure — see env.ts's comment —
 * so every caller must check this before attempting a send, and treat
 * `false` as an honest "not configured," never a silent failure.
 */
export function isPushConfigured(): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

let vapidConfigured = false;
function ensureVapidConfigured(): void {
  if (vapidConfigured || !isPushConfigured()) return;
  webpush.setVapidDetails(env.VAPID_SUBJECT!, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
  vapidConfigured = true;
}

export interface PushDeliveryStats {
  attempted: number;
  delivered: number;
  failed: number;
  invalidRemoved: number;
}

function emptyStats(): PushDeliveryStats {
  return { attempted: 0, delivered: 0, failed: 0, invalidRemoved: 0 };
}

/**
 * Sends one real Web Push message to every subscription this user has
 * registered, using the actual `web-push` implementation of VAPID +
 * payload encryption — never a simulated success. The payload is
 * deliberately minimal (title, body, notificationId) so the service
 * worker can render a real native notification and deep-link back;
 * never logs the payload itself (see the worker's structured-logging
 * rule: no notification bodies in logs).
 *
 * A 404/410 from the push service is the standard "this endpoint no
 * longer exists" signal (the browser unregistered it, the user
 * cleared site data, etc.) — that subscription is deleted outright,
 * never left around as permanently-undeliverable. Any other failure
 * (network blip, malformed key) is logged and skipped; it does not
 * throw, so one bad subscription never blocks delivery to the user's
 * other devices or the rest of the worker cycle.
 */
export async function deliverPush(
  db: Queryable,
  userId: string,
  notification: { id: string; title: string; body: string },
): Promise<PushDeliveryStats> {
  const stats = emptyStats();
  if (!isPushConfigured()) return stats;
  ensureVapidConfigured();

  const subscriptions = await listPushSubscriptionsForUser(db, userId);
  if (subscriptions.length === 0) return stats;

  const payload = JSON.stringify({ id: notification.id, title: notification.title, body: notification.body });

  await Promise.all(
    subscriptions.map(async (sub: PushSubscriptionRow) => {
      stats.attempted += 1;
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.authKey } },
          payload,
        );
        stats.delivered += 1;
        await markPushSubscriptionUsed(db, sub.id);
        await markDeliveredById(db, notification.id);
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await deletePushSubscriptionById(db, sub.id);
          stats.invalidRemoved += 1;
        } else {
          stats.failed += 1;
        }
      }
    }),
  );

  return stats;
}
