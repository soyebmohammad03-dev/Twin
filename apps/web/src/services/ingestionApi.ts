/**
 * Client for the Twin ingestion API (apps/api/src/modules/ingestion) —
 * how raw Capture input (a note, a voice transcript) becomes a real
 * memory, with duplicate detection and (non-AI) entity linking. See
 * apiClient.ts for the shared authenticated-fetch/retry plumbing.
 */

import type { CreateIngestionRequest, IngestionJobDto, IngestionResultDto, IngestionStatus } from '@twin/contracts';
import { authorizedFetch, parseOrThrow } from './apiClient';

export const ingestionApi = {
  async ingest(input: CreateIngestionRequest): Promise<IngestionResultDto> {
    const response = await authorizedFetch('/ingestion', { method: 'POST', body: JSON.stringify(input) });
    return parseOrThrow<IngestionResultDto>(response);
  },

  async get(jobId: string): Promise<IngestionResultDto> {
    const response = await authorizedFetch(`/ingestion/${jobId}`);
    return parseOrThrow<IngestionResultDto>(response);
  },

  /** Phase 22 — the user's real ingestion job history (ProfileView's Ingestion Activity section). Was already fully built and tested server-side; simply never called from the frontend until now. */
  async list(params?: { status?: IngestionStatus }): Promise<IngestionJobDto[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    const qs = query.toString();
    const response = await authorizedFetch(`/ingestion${qs ? `?${qs}` : ''}`);
    return parseOrThrow<IngestionJobDto[]>(response);
  },
};
