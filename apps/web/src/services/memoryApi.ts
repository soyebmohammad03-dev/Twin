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

  async create(input: CreateEntityRequest): Promise<EntityDto> {
    const response = await authorizedFetch('/entities', { method: 'POST', body: JSON.stringify(input) });
    return parseOrThrow<EntityDto>(response);
  },

  /** Reuses an existing entity with an exact (case-insensitive) name match, or creates one. */
  async findOrCreate(entityType: EntityType, name: string): Promise<EntityDto> {
    const matches = await entityApi.list({ entityType, name });
    const exact = matches.find((entity) => entity.name.toLowerCase() === name.toLowerCase());
    if (exact) return exact;
    return entityApi.create({ entityType, name });
  },
};
