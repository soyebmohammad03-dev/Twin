/**
 * Client for Phase 9's Personal Model endpoints
 * (apps/api/src/modules/personalModel). See apiClient.ts for the
 * shared authenticated-fetch plumbing every Twin API client uses.
 */

import type {
  PersonalModelResponse,
  RebuildModelResponse,
  ModelChangesResponse,
  FactEvidenceResponse,
  PersonalModelFactDto,
  CorrectFactRequest,
} from '@twin/contracts';
import { authorizedFetch, parseOrThrow } from './apiClient';

export const personalModelApi = {
  async getModel(): Promise<PersonalModelResponse> {
    const response = await authorizedFetch('/twin/model');
    return parseOrThrow<PersonalModelResponse>(response);
  },

  async rebuild(): Promise<RebuildModelResponse> {
    const response = await authorizedFetch('/twin/model/rebuild', { method: 'POST' });
    return parseOrThrow<RebuildModelResponse>(response);
  },

  async getChanges(): Promise<ModelChangesResponse> {
    const response = await authorizedFetch('/twin/model/changes');
    return parseOrThrow<ModelChangesResponse>(response);
  },

  async getFactEvidence(factId: string): Promise<FactEvidenceResponse> {
    const response = await authorizedFetch(`/twin/facts/${factId}/evidence`);
    return parseOrThrow<FactEvidenceResponse>(response);
  },

  async confirmFact(factId: string): Promise<{ fact: PersonalModelFactDto }> {
    const response = await authorizedFetch(`/twin/facts/${factId}/confirm`, { method: 'POST' });
    return parseOrThrow<{ fact: PersonalModelFactDto }>(response);
  },

  async correctFact(factId: string, body: CorrectFactRequest): Promise<{ fact: PersonalModelFactDto }> {
    const response = await authorizedFetch(`/twin/facts/${factId}/correct`, { method: 'POST', body: JSON.stringify(body) });
    return parseOrThrow<{ fact: PersonalModelFactDto }>(response);
  },

  async dismissFact(factId: string): Promise<{ fact: PersonalModelFactDto }> {
    const response = await authorizedFetch(`/twin/facts/${factId}/dismiss`, { method: 'POST' });
    return parseOrThrow<{ fact: PersonalModelFactDto }>(response);
  },
};
