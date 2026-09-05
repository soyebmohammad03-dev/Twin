/**
 * Client for Twin's Phase 6 hybrid memory retrieval endpoint
 * (apps/api/src/modules/retrieval). See apiClient.ts for the shared
 * authenticated-fetch plumbing every Twin API client uses.
 */

import type { SearchMemoriesRequest, SearchMemoriesResponse } from '@twin/contracts';
import { authorizedFetch, parseOrThrow } from './apiClient';

// SearchMemoriesRequest is the schema's *parsed* (post-.default()) output
// type, where limit/includeArchived are required — the server applies
// those defaults itself, so the client only needs to send what it
// actually has an opinion about.
type SearchInput = Pick<SearchMemoriesRequest, 'query'> & Partial<Omit<SearchMemoriesRequest, 'query'>>;

export const searchApi = {
  async search(input: SearchInput): Promise<SearchMemoriesResponse> {
    const response = await authorizedFetch('/search', { method: 'POST', body: JSON.stringify(input) });
    return parseOrThrow<SearchMemoriesResponse>(response);
  },
};
