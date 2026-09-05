/**
 * Client for Phase 10's Insight endpoints
 * (apps/api/src/modules/insights). See apiClient.ts for the shared
 * authenticated-fetch plumbing every Twin API client uses.
 */

import type { InsightsResponse, RebuildInsightsResponse, InsightEvidenceResponse, InsightContextResponse, InsightDto } from '@twin/contracts';
import { authorizedFetch, parseOrThrow } from './apiClient';

export const insightsApi = {
  async getInsights(): Promise<InsightsResponse> {
    const response = await authorizedFetch('/insights');
    return parseOrThrow<InsightsResponse>(response);
  },

  async rebuild(): Promise<RebuildInsightsResponse> {
    const response = await authorizedFetch('/insights/rebuild', { method: 'POST' });
    return parseOrThrow<RebuildInsightsResponse>(response);
  },

  async getInsightEvidence(insightId: string): Promise<InsightEvidenceResponse> {
    const response = await authorizedFetch(`/insights/${insightId}/evidence`);
    return parseOrThrow<InsightEvidenceResponse>(response);
  },

  async dismissInsight(insightId: string): Promise<{ insight: InsightDto }> {
    const response = await authorizedFetch(`/insights/${insightId}/dismiss`, { method: 'POST' });
    return parseOrThrow<{ insight: InsightDto }>(response);
  },

  /** Phase 16: how this insight connects to the user's Personal Model — see insightContextResponseSchema. */
  async getInsightContext(insightId: string): Promise<InsightContextResponse> {
    const response = await authorizedFetch(`/insights/${insightId}/context`);
    return parseOrThrow<InsightContextResponse>(response);
  },
};
