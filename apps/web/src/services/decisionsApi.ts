/**
 * Client for Twin's Phase 25 Decision API (apps/api/src/modules/decisions).
 * See apiClient.ts for the shared authenticated-fetch plumbing every
 * Twin API client uses.
 */

import type {
  DecisionDto,
  DecisionDetailResponse,
  CreateDecisionRequest,
  UpdateDecisionRequest,
  GroundedResponse,
  ListDecisionHistoryResponse,
} from '@twin/contracts';
import { authorizedFetch, parseOrThrow } from './apiClient';

export const decisionsApi = {
  async list(): Promise<DecisionDto[]> {
    const response = await authorizedFetch('/decisions');
    return parseOrThrow<DecisionDto[]>(response);
  },

  async getDetail(id: string): Promise<DecisionDetailResponse> {
    const response = await authorizedFetch(`/decisions/${id}`);
    return parseOrThrow<DecisionDetailResponse>(response);
  },

  async create(input: CreateDecisionRequest): Promise<DecisionDto> {
    const response = await authorizedFetch('/decisions', { method: 'POST', body: JSON.stringify(input) });
    return parseOrThrow<DecisionDto>(response);
  },

  async update(id: string, patch: UpdateDecisionRequest): Promise<DecisionDto> {
    const response = await authorizedFetch(`/decisions/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    return parseOrThrow<DecisionDto>(response);
  },

  /**
   * The grounded "why" explanation — deliberately NOT a decision-specific
   * backend endpoint. Reuses the exact same POST /reason grounded
   * reasoning path Twin Chat uses, targeted at this decision's entity id
   * via decisionEntityId. No second reasoning system.
   */
  async explain(decisionEntityId: string): Promise<GroundedResponse> {
    const response = await authorizedFetch('/reason', {
      method: 'POST',
      body: JSON.stringify({
        query: 'Why was this decision made, and what evidence supports it?',
        decisionEntityId,
      }),
    });
    return parseOrThrow<GroundedResponse>(response);
  },

  async getHistory(id: string): Promise<ListDecisionHistoryResponse> {
    const response = await authorizedFetch(`/decisions/${id}/history`);
    return parseOrThrow<ListDecisionHistoryResponse>(response);
  },
};
