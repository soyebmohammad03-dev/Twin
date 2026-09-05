/**
 * Client for the Twin Memory API (apps/api/src/modules/memories,
 * apps/api/src/modules/entities). See apiClient.ts for the shared
 * authenticated-fetch/retry plumbing every Twin API client uses.
 */

import type {
  CreateEntityRequest,
  CreateMemoryRequest,
  EntityDto,
  EntityType,
  ListMemoryCorrectionsResponse,
  MemoryDetailDto,
  MemoryEntityLinkDto,
  UpdateMemoryRequest,
} from '@twin/contracts';
import { authorizedFetch, parseOrThrow } from './apiClient';

export const memoryApi = {
  async list(params?: { memoryType?: string; includeArchived?: boolean }): Promise<MemoryDetailDto[]> {
    const query = new URLSearchParams();
    if (params?.memoryType) query.set('memoryType', params.memoryType);
    if (params?.includeArchived) query.set('includeArchived', 'true');
    const qs = query.toString();
    const response = await authorizedFetch(`/memories${qs ? `?${qs}` : ''}`);
    return parseOrThrow<MemoryDetailDto[]>(response);
  },

  async get(id: string): Promise<MemoryDetailDto> {
    const response = await authorizedFetch(`/memories/${id}`);
    return parseOrThrow<MemoryDetailDto>(response);
  },

  async create(input: CreateMemoryRequest): Promise<MemoryDetailDto> {
    const response = await authorizedFetch('/memories', { method: 'POST', body: JSON.stringify(input) });
    return parseOrThrow<MemoryDetailDto>(response);
  },

  async update(id: string, patch: UpdateMemoryRequest): Promise<MemoryDetailDto> {
    const response = await authorizedFetch(`/memories/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    return parseOrThrow<MemoryDetailDto>(response);
  },

  async archive(id: string): Promise<void> {
    const response = await authorizedFetch(`/memories/${id}`, { method: 'DELETE' });
    await parseOrThrow<void>(response);
  },

  async getCorrections(id: string): Promise<ListMemoryCorrectionsResponse> {
    const response = await authorizedFetch(`/memories/${id}/corrections`);
    return parseOrThrow<ListMemoryCorrectionsResponse>(response);
  },

  async linkEntity(memoryId: string, entityId: string, role?: string): Promise<MemoryEntityLinkDto> {
    const response = await authorizedFetch(`/memories/${memoryId}/entities`, {
      method: 'POST',
      body: JSON.stringify({ entityId, role }),
    });
    return parseOrThrow<MemoryEntityLinkDto>(response);
  },
};

export const entityApi = {
  async list(params?: { entityType?: EntityType; name?: string }): Promise<EntityDto[]> {
    const query = new URLSearchParams();
    if (params?.entityType) query.set('entityType', params.entityType);
    if (params?.name) query.set('name', params.name);
    const qs = query.toString();
    const response = await authorizedFetch(`/entities${qs ? `?${qs}` : ''}`);
    return parseOrThrow<EntityDto[]>(response);
  },

  /**
   * POST /entities returns 201 for a genuinely new entity and 200 when
   * an exact (case/whitespace/punctuation-insensitive) match already
   * existed and was reused instead (see entities.service.ts's
   * findOrCreateEntity) — surfaced here as `wasCreated` so a caller
   * (Phase 34's CreateEntityModal) can tell a user their entity already
   * existed rather than silently treating a reuse as a fresh creation.
   */
  async create(input: CreateEntityRequest): Promise<{ entity: EntityDto; wasCreated: boolean }> {
    const response = await authorizedFetch('/entities', { method: 'POST', body: JSON.stringify(input) });
    const wasCreated = response.status === 201;
    const entity = await parseOrThrow<EntityDto>(response);
    return { entity, wasCreated };
  },

  /** Reuses an existing entity with an exact (case-insensitive) name match, or creates one. */
  async findOrCreate(entityType: EntityType, name: string): Promise<EntityDto> {
    const matches = await entityApi.list({ entityType, name });
    const exact = matches.find((entity) => entity.name.toLowerCase() === name.toLowerCase());
    if (exact) return exact;
    const { entity } = await entityApi.create({ entityType, name });
    return entity;
  },
};
