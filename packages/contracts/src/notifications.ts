import { z } from 'zod';

/**
 * Phase 46/47 — contracts for real, persisted notifications, the
 * server-side preferences that gate their generation, and (Phase 47)
 * Web Push subscription management. Categories are an open string,
 * matching insightTypeSchema's own evolving-taxonomy convention:
 * 'pattern_recurrence' (Phase 46), 'morning_briefing' and
 * 'evening_synthesis' (Phase 47, see apps/api's worker/).
 */
export const notificationCategorySchema = z.string();
export type NotificationCategory = z.infer<typeof notificationCategorySchema>;

export const notificationDtoSchema = z.object({
  id: z.string().uuid(),
  category: notificationCategorySchema,
  title: z.string(),
  body: z.string(),
  sourceInsightId: z.string().uuid().nullable(),
  readAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationDto = z.infer<typeof notificationDtoSchema>;

export const notificationsResponseSchema = z.object({
  notifications: z.array(notificationDtoSchema),
  unreadCount: z.number().int().nonnegative(),
});
export type NotificationsResponse = z.infer<typeof notificationsResponseSchema>;

export const notificationActionResponseSchema = z.object({ notification: notificationDtoSchema });
export type NotificationActionResponse = z.infer<typeof notificationActionResponseSchema>;

export const markAllReadResponseSchema = z.object({ markedCount: z.number().int().nonnegative() });
export type MarkAllReadResponse = z.infer<typeof markAllReadResponseSchema>;

/**
 * masterEnabled gates every category. patternAlertsEnabled,
 * morningBriefingEnabled, and eveningSynthesisEnabled are the three
 * real per-category flags — every one of them backed by an actual
 * generation path (see apps/api's notifications.service.ts and
 * worker/). timezone is the IANA zone the worker uses to decide
 * whether "now" falls in this user's morning/evening window; it is
 * never guessed from the server's location.
 */
export const notificationPreferencesDtoSchema = z.object({
  masterEnabled: z.boolean(),
  patternAlertsEnabled: z.boolean(),
  morningBriefingEnabled: z.boolean(),
  eveningSynthesisEnabled: z.boolean(),
  timezone: z.string(),
  updatedAt: z.string(),
});
export type NotificationPreferencesDto = z.infer<typeof notificationPreferencesDtoSchema>;

export const updateNotificationPreferencesRequestSchema = z
  .object({
    masterEnabled: z.boolean().optional(),
    patternAlertsEnabled: z.boolean().optional(),
    morningBriefingEnabled: z.boolean().optional(),
    eveningSynthesisEnabled: z.boolean().optional(),
    timezone: z.string().min(1).optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'At least one preference field must be provided.',
  });
export type UpdateNotificationPreferencesRequest = z.infer<typeof updateNotificationPreferencesRequestSchema>;

/**
 * Phase 47 — Web Push. The subscription shape mirrors the browser's
 * own `PushSubscription.toJSON()` output exactly (endpoint + keys),
 * so the frontend can forward it unchanged. The public key endpoint
 * response is intentionally just the raw base64url string — it is
 * public by design (VAPID's whole point), never the private key.
 */
export const pushSubscriptionKeysSchema = z.object({
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});

export const subscribeToPushRequestSchema = z.object({
  endpoint: z.string().url(),
  keys: pushSubscriptionKeysSchema,
});
export type SubscribeToPushRequest = z.infer<typeof subscribeToPushRequestSchema>;

export const unsubscribeFromPushRequestSchema = z.object({
  endpoint: z.string().url(),
});
export type UnsubscribeFromPushRequest = z.infer<typeof unsubscribeFromPushRequestSchema>;

export const vapidPublicKeyResponseSchema = z.object({
  publicKey: z.string().nullable(),
});
export type VapidPublicKeyResponse = z.infer<typeof vapidPublicKeyResponseSchema>;
