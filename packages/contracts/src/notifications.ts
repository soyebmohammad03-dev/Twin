import { z } from 'zod';

/**
 * Phase 46 — contracts for real, persisted notifications and the
 * server-side preferences that gate their generation. Only
 * 'pattern_recurrence' is emitted today (see
 * apps/api/src/modules/notifications/notifications.service.ts's
 * generatePatternNotifications) — an open string, matching
 * insightTypeSchema's own evolving-taxonomy convention, not a closed
 * enum that would need a contract change for the next real category.
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
 * masterEnabled gates every category. patternAlertsEnabled is the
 * only per-category flag that exists — see notification_preferences's
 * schema comment for why Morning Briefing / Evening Thought Synthesis
 * deliberately have no column: no real generation signal backs them
 * yet, so a toggle for them would control nothing.
 */
export const notificationPreferencesDtoSchema = z.object({
  masterEnabled: z.boolean(),
  patternAlertsEnabled: z.boolean(),
  updatedAt: z.string(),
});
export type NotificationPreferencesDto = z.infer<typeof notificationPreferencesDtoSchema>;

export const updateNotificationPreferencesRequestSchema = z
  .object({
    masterEnabled: z.boolean().optional(),
    patternAlertsEnabled: z.boolean().optional(),
  })
  .refine((data) => data.masterEnabled !== undefined || data.patternAlertsEnabled !== undefined, {
    message: 'At least one preference field must be provided.',
  });
export type UpdateNotificationPreferencesRequest = z.infer<typeof updateNotificationPreferencesRequestSchema>;
