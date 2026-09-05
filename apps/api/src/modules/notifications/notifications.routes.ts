import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  notificationsResponseSchema,
  notificationActionResponseSchema,
  markAllReadResponseSchema,
  notificationPreferencesDtoSchema,
  updateNotificationPreferencesRequestSchema,
  subscribeToPushRequestSchema,
  unsubscribeFromPushRequestSchema,
  vapidPublicKeyResponseSchema,
  errorResponseSchema,
  type NotificationDto,
  type NotificationsResponse,
  type NotificationActionResponse,
  type MarkAllReadResponse,
  type NotificationPreferencesDto,
  type VapidPublicKeyResponse,
} from '@twin/contracts';
import { authenticate, getAuthenticatedUserId } from '../../plugins/authenticate.js';
import { env } from '../../config/env.js';
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  markNotificationDelivered,
  getPreferences,
  updateNotificationPreferences,
  subscribeToPush,
  unsubscribeFromPush,
  NotificationError,
} from './notificationsService.js';
import type { NotificationRow, NotificationPreferencesRow } from './notificationsStore.js';

function toDto(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    body: row.body,
    sourceInsightId: row.sourceInsightId,
    readAt: row.readAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toPreferencesDto(row: NotificationPreferencesRow): NotificationPreferencesDto {
  return {
    masterEnabled: row.masterEnabled,
    patternAlertsEnabled: row.patternAlertsEnabled,
    morningBriefingEnabled: row.morningBriefingEnabled,
    eveningSynthesisEnabled: row.eveningSynthesisEnabled,
    timezone: row.timezone,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function handleNotificationError(err: unknown): { statusCode: 404; body: { error: string; message: string } } {
  if (err instanceof NotificationError) {
    return { statusCode: 404, body: { error: 'notification_error', message: err.message } };
  }
  throw err;
}

/**
 * Phase 46's Notification API. userId comes ONLY from the
 * authenticated request in every handler — same isolation discipline
 * as insights.routes.ts/personalModel.routes.ts. No route here ever
 * generates a notification: generation happens exclusively as a side
 * effect of a real insight rebuild (see insights.routes.ts's
 * POST /rebuild -> generatePatternNotifications).
 */
export async function registerNotificationRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get(
    '/',
    { preHandler: authenticate, schema: { response: { 200: notificationsResponseSchema } } },
    async (request) => {
      const userId = getAuthenticatedUserId(request);
      const { notifications, unreadCount } = await getNotifications(app.db, userId);
      const response: NotificationsResponse = { notifications: notifications.map(toDto), unreadCount };
      return response;
    },
  );

  server.get(
    '/preferences',
    { preHandler: authenticate, schema: { response: { 200: notificationPreferencesDtoSchema } } },
    async (request) => {
      const userId = getAuthenticatedUserId(request);
      const prefs = await getPreferences(app.db, userId);
      return toPreferencesDto(prefs);
    },
  );

  server.put(
    '/preferences',
    {
      preHandler: authenticate,
      schema: { body: updateNotificationPreferencesRequestSchema, response: { 200: notificationPreferencesDtoSchema } },
    },
    async (request) => {
      const userId = getAuthenticatedUserId(request);
      const prefs = await updateNotificationPreferences(app.db, userId, request.body);
      return toPreferencesDto(prefs);
    },
  );

  server.post(
    '/:id/read',
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: notificationActionResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      try {
        const row = await markNotificationRead(app.db, userId, request.params.id);
        const response: NotificationActionResponse = { notification: toDto(row) };
        return response;
      } catch (err) {
        const handled = handleNotificationError(err);
        reply.code(handled.statusCode);
        return handled.body;
      }
    },
  );

  server.post(
    '/read-all',
    { preHandler: authenticate, schema: { response: { 200: markAllReadResponseSchema } } },
    async (request) => {
      const userId = getAuthenticatedUserId(request);
      const markedCount = await markAllNotificationsRead(app.db, userId);
      const response: MarkAllReadResponse = { markedCount };
      return response;
    },
  );

  server.post(
    '/:id/delivered',
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: notificationActionResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      try {
        const row = await markNotificationDelivered(app.db, userId, request.params.id);
        const response: NotificationActionResponse = { notification: toDto(row) };
        return response;
      } catch (err) {
        const handled = handleNotificationError(err);
        reply.code(handled.statusCode);
        return handled.body;
      }
    },
  );

  // --- Web Push (Phase 47) ---

  server.get(
    '/push/vapid-public-key',
    { preHandler: authenticate, schema: { response: { 200: vapidPublicKeyResponseSchema } } },
    async () => {
      // Public by design (VAPID's entire point) — the private key
      // never leaves apps/api/src/worker/push.ts. Null, honestly,
      // when this deployment hasn't configured a VAPID keypair — the
      // frontend must not attempt pushManager.subscribe() in that case.
      const response: VapidPublicKeyResponse = { publicKey: env.VAPID_PUBLIC_KEY ?? null };
      return response;
    },
  );

  server.post(
    '/push/subscribe',
    { preHandler: authenticate, schema: { body: subscribeToPushRequestSchema } },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      await subscribeToPush(app.db, userId, {
        endpoint: request.body.endpoint,
        p256dh: request.body.keys.p256dh,
        authKey: request.body.keys.auth,
      });
      reply.code(204);
    },
  );

  server.post(
    '/push/unsubscribe',
    { preHandler: authenticate, schema: { body: unsubscribeFromPushRequestSchema } },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      await unsubscribeFromPush(app.db, userId, request.body.endpoint);
      reply.code(204);
    },
  );
}
