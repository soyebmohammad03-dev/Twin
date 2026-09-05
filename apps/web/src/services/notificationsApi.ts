/**
 * Client for Phase 46/47's Notification endpoints
 * (apps/api/src/modules/notifications). See apiClient.ts for the
 * shared authenticated-fetch plumbing every Twin API client uses.
 */

import type {
  NotificationsResponse,
  NotificationActionResponse,
  MarkAllReadResponse,
  NotificationPreferencesDto,
  UpdateNotificationPreferencesRequest,
  VapidPublicKeyResponse,
} from '@twin/contracts';
import { authorizedFetch, parseOrThrow } from './apiClient';

export const notificationsApi = {
  async getNotifications(): Promise<NotificationsResponse> {
    const response = await authorizedFetch('/notifications');
    return parseOrThrow<NotificationsResponse>(response);
  },

  async getPreferences(): Promise<NotificationPreferencesDto> {
    const response = await authorizedFetch('/notifications/preferences');
    return parseOrThrow<NotificationPreferencesDto>(response);
  },

  async updatePreferences(patch: UpdateNotificationPreferencesRequest): Promise<NotificationPreferencesDto> {
    const response = await authorizedFetch('/notifications/preferences', { method: 'PUT', body: JSON.stringify(patch) });
    return parseOrThrow<NotificationPreferencesDto>(response);
  },

  async markRead(notificationId: string): Promise<NotificationActionResponse> {
    const response = await authorizedFetch(`/notifications/${notificationId}/read`, { method: 'POST' });
    return parseOrThrow<NotificationActionResponse>(response);
  },

  async markAllRead(): Promise<MarkAllReadResponse> {
    const response = await authorizedFetch('/notifications/read-all', { method: 'POST' });
    return parseOrThrow<MarkAllReadResponse>(response);
  },

  async markDelivered(notificationId: string): Promise<NotificationActionResponse> {
    const response = await authorizedFetch(`/notifications/${notificationId}/delivered`, { method: 'POST' });
    return parseOrThrow<NotificationActionResponse>(response);
  },

  async getVapidPublicKey(): Promise<VapidPublicKeyResponse> {
    const response = await authorizedFetch('/notifications/push/vapid-public-key');
    return parseOrThrow<VapidPublicKeyResponse>(response);
  },

  async registerPushSubscription(subscription: PushSubscriptionJSON): Promise<void> {
    if (!subscription.endpoint || !subscription.keys) throw new Error('Invalid push subscription.');
    const response = await authorizedFetch('/notifications/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint: subscription.endpoint, keys: subscription.keys }),
    });
    return parseOrThrow<void>(response);
  },

  async unregisterPushSubscription(endpoint: string): Promise<void> {
    const response = await authorizedFetch('/notifications/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) });
    return parseOrThrow<void>(response);
  },
};
