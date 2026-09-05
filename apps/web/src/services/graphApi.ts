/**
 * Client for Twin's Phase 7 knowledge graph API
 * (apps/api/src/modules/graph). See apiClient.ts for the shared
 * authenticated-fetch plumbing every Twin API client uses.
 */

import type { ConnectedRelationshipDto, CreateRelationshipRequest, EntityDetailResponse, RelatedEntitiesResponse, RelationshipEvidenceResponse } from '@twin/contracts';
import { authorizedFetch, parseOrThrow } from './apiClient';

export const graphApi = {
  async getEntityDetail(entityId: string): Promise<EntityDetailResponse> {
    const response = await authorizedFetch(`/graph/entities/${entityId}`);
    return parseOrThrow<EntityDetailResponse>(response);
  },

  async getRelatedEntities(entityId: string, hops: 1 | 2 = 1): Promise<RelatedEntitiesResponse> {
    const response = await authorizedFetch(`/graph/entities/${entityId}/related?hops=${hops}`);
    return parseOrThrow<RelatedEntitiesResponse>(response);
  },

  async getRelationshipEvidence(relationshipId: string): Promise<RelationshipEvidenceResponse> {
    const response = await authorizedFetch(`/graph/relationships/${relationshipId}/evidence`);
    return parseOrThrow<RelationshipEvidenceResponse>(response);
  },

  /** Phase 27: connects `fromEntityId` (the entity whose detail view this was opened from) to an existing `toEntityId`, with an open-vocabulary relationshipType. Never creates a new entity. */
  async createRelationship(fromEntityId: string, input: CreateRelationshipRequest): Promise<ConnectedRelationshipDto> {
    const response = await authorizedFetch(`/graph/entities/${fromEntityId}/relationships`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return parseOrThrow<ConnectedRelationshipDto>(response);
  },

  async deleteRelationship(relationshipId: string): Promise<void> {
    const response = await authorizedFetch(`/graph/relationships/${relationshipId}`, { method: 'DELETE' });
    await parseOrThrow<void>(response);
  },
};
