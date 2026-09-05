/**
 * Client for Twin's Phase 8 Context Engine endpoint
 * (apps/api/src/modules/context). See apiClient.ts for the shared
 * authenticated-fetch plumbing every Twin API client uses.
 */

import type { BuildContextRequest, ContextPacket } from '@twin/contracts';
import { authorizedFetch, parseOrThrow } from './apiClient';

type BuildContextInput = Pick<BuildContextRequest, 'query'> & Partial<Omit<BuildContextRequest, 'query'>>;

export const contextApi = {
  async build(input: BuildContextInput): Promise<ContextPacket> {
    const response = await authorizedFetch('/context', { method: 'POST', body: JSON.stringify(input) });
    return parseOrThrow<ContextPacket>(response);
  },
};
