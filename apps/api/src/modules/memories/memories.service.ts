import { createHash } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { memories, sources, memoryEntities, type Database, type Queryable } from '@twin/db';
import type { CreateMemoryRequest, UpdateMemoryRequest } from '@twin/contracts';
import { assertEntitiesOwnedByUser, type EntityRow } from '../entities/entities.service.js';

/**
 * Exact/near-exact duplicate detection — no embeddings, no fuzzy
 * matching. Normalizes whitespace/case before hashing so trivial
 * formatting differences still count as the same content.
 */
export function hashMemoryContent(content: string): string {
  const normalized = content.trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256').update(normalized).digest('hex');
}

/** Finds a non-archived memory with the same content hash, if one exists. Used by the ingestion pipeline's duplicate check. */
export async function findMemoryByContentHash(
  db: Queryable,
  userId: string,
  contentHash: string,
): Promise<MemoryWithRelations | undefined> {
  const result = await db.query.memories.findFirst({
    where: and(eq(memories.userId, userId), eq(memories.contentHash, contentHash), isNull(memories.deletedAt)),
    with: { source: true, entityLinks: { with: { entity: true } } },
  });
  return result as MemoryWithRelations | undefined;
}

export class MemoryError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export type MemoryRow = typeof memories.$inferSelect;
export type SourceRow = typeof sources.$inferSelect;
export type MemoryEntityRow = typeof memoryEntities.$inferSelect;

export interface MemoryWithRelations extends MemoryRow {
  source: SourceRow;
  entityLinks: (MemoryEntityRow & { entity: EntityRow })[];
}

export interface ListMemoriesFilter {
  memoryType?: string;
  includeArchived: boolean;
}

/**
 * Creates a memory, its source (if described inline rather than
 * referenced by id), and any entity links — all inside one
 * transaction. If any part fails (an inline source insert, the
 * memory insert, or an entity ownership check), nothing commits: you
 * never end up with an orphan source or a memory linked to an entity
 * that didn't pass ownership verification.
 */
export async function createMemory(db: Database, userId: string, input: CreateMemoryRequest): Promise<string> {
  return db.transaction((tx) => createMemoryTx(tx, userId, input));
}

/**
 * The actual insert logic behind createMemory, factored out so a
 * caller that's already inside its own transaction (e.g. the AI
 * extraction pipeline, which creates several memories plus entities
 * plus relationships as one atomic unit) can reuse it directly against
 * that transaction instead of opening a nested one.
 */
export async function createMemoryTx(tx: Queryable, userId: string, input: CreateMemoryRequest): Promise<string> {
  let sourceId: string;

    if (input.sourceId) {
      const [existing] = await tx
        .select({ id: sources.id })
        .from(sources)
        .where(and(eq(sources.id, input.sourceId), eq(sources.userId, userId)))
        .limit(1);
      if (!existing) {
        throw new MemoryError(`Source not found: ${input.sourceId}`, 404);
      }
      sourceId = existing.id;
    } else if (input.source) {
      const [created] = await tx
        .insert(sources)
        .values({
          userId,
          sourceType: input.source.sourceType,
          title: input.source.title,
          rawContent: input.source.rawContent,
          url: input.source.url,
          capturedAt: input.source.capturedAt ? new Date(input.source.capturedAt) : undefined,
          metadata: input.source.metadata ?? {},
        })
        .returning({ id: sources.id });
      if (!created) {
        throw new Error('Source insert returned no row.');
      }
      sourceId = created.id;
    } else {
      // Contracts enforce exactly one of sourceId/source at the
      // validation layer — this is unreachable in practice.
      throw new MemoryError('Provide exactly one of sourceId or source.', 400);
    }

    const [memory] = await tx
      .insert(memories)
      .values({
        userId,
        sourceId,
        memoryType: input.memoryType,
        content: input.content,
        contentHash: hashMemoryContent(input.content),
        epistemicStatus: input.epistemicStatus,
        confidence: input.confidence.toFixed(2),
        importance: input.importance,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
        metadata: input.metadata ?? {},
      })
      .returning({ id: memories.id });
    if (!memory) {
      throw new Error('Memory insert returned no row.');
    }

    if (input.entityLinks && input.entityLinks.length > 0) {
      await assertEntitiesOwnedByUser(
        tx,
        userId,
        input.entityLinks.map((link) => link.entityId),
      );
      await tx.insert(memoryEntities).values(
        input.entityLinks.map((link) => ({
          memoryId: memory.id,
          entityId: link.entityId,
          role: link.role ?? 'related',
        })),
      );
    }

  return memory.id;
}

export async function getMemoryDetail(
  db: Queryable,
  userId: string,
  memoryId: string,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<MemoryWithRelations | undefined> {
  const conditions = [eq(memories.id, memoryId), eq(memories.userId, userId)];
  if (!includeArchived) {
    conditions.push(isNull(memories.deletedAt));
  }

  const result = await db.query.memories.findFirst({
    where: and(...conditions),
    with: { source: true, entityLinks: { with: { entity: true } } },
  });
  return result as MemoryWithRelations | undefined;
}

export async function listMemories(
  db: Queryable,
  userId: string,
  filter: ListMemoriesFilter,
): Promise<MemoryWithRelations[]> {
  const conditions = [eq(memories.userId, userId)];
  if (!filter.includeArchived) {
    conditions.push(isNull(memories.deletedAt));
  }
  if (filter.memoryType) {
    conditions.push(eq(memories.memoryType, filter.memoryType));
  }

  const result = await db.query.memories.findMany({
    where: and(...conditions),
    with: { source: true, entityLinks: { with: { entity: true } } },
    orderBy: [desc(memories.occurredAt), desc(memories.createdAt)],
  });
  return result as MemoryWithRelations[];
}

export async function updateMemory(
  db: Queryable,
  userId: string,
  memoryId: string,
  patch: UpdateMemoryRequest,
): Promise<MemoryRow | undefined> {
  const updates: Partial<typeof memories.$inferInsert> = { updatedAt: new Date() };
  if (patch.content !== undefined) {
    updates.content = patch.content;
    // Phase 30: content changed, so both duplicate-detection and the
    // embedding pipeline need to see it as stale. embedding.service.ts's
    // embedMemory() compares this against embeddingContentHash to decide
    // whether to re-embed — leaving this unset here would make an
    // updated memory look "up to date" against its OLD embedding forever.
    updates.contentHash = hashMemoryContent(patch.content);
  }
  if (patch.memoryType !== undefined) updates.memoryType = patch.memoryType;
  if (patch.epistemicStatus !== undefined) updates.epistemicStatus = patch.epistemicStatus;
  if (patch.confidence !== undefined) updates.confidence = patch.confidence.toFixed(2);
  if (patch.importance !== undefined) updates.importance = patch.importance;
  if (patch.metadata !== undefined) updates.metadata = patch.metadata;
  if (patch.occurredAt !== undefined) {
    updates.occurredAt = patch.occurredAt === null ? null : new Date(patch.occurredAt);
  }

  const [updated] = await db
    .update(memories)
    .set(updates)
    .where(and(eq(memories.id, memoryId), eq(memories.userId, userId), isNull(memories.deletedAt)))
    .returning();
  return updated;
}

/** Soft-delete — sets deletedAt rather than removing the row. */
export async function archiveMemory(db: Queryable, userId: string, memoryId: string): Promise<MemoryRow | undefined> {
  const [archived] = await db
    .update(memories)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(memories.id, memoryId), eq(memories.userId, userId), isNull(memories.deletedAt)))
    .returning();
  return archived;
}

export async function linkMemoryToEntity(
  db: Database,
  userId: string,
  memoryId: string,
  entityId: string,
  role: string,
): Promise<MemoryEntityRow> {
  return db.transaction(async (tx) => {
    const [memory] = await tx
      .select({ id: memories.id })
      .from(memories)
      .where(and(eq(memories.id, memoryId), eq(memories.userId, userId), isNull(memories.deletedAt)))
      .limit(1);
    if (!memory) {
      throw new MemoryError(`Memory not found: ${memoryId}`, 404);
    }

    await assertEntitiesOwnedByUser(tx, userId, [entityId]);

    const [link] = await tx
      .insert(memoryEntities)
      .values({ memoryId, entityId, role })
      .onConflictDoNothing()
      .returning();

    if (link) return link;

    // Link already existed (unique constraint) — return the existing row.
    const [existing] = await tx
      .select()
      .from(memoryEntities)
      .where(and(eq(memoryEntities.memoryId, memoryId), eq(memoryEntities.entityId, entityId), eq(memoryEntities.role, role)))
      .limit(1);
    if (!existing) {
      throw new Error('Memory-entity link insert returned no row and no existing row was found.');
    }
    return existing;
  });
}
