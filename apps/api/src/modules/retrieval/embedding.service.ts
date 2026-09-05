import { and, eq } from 'drizzle-orm';
import { memories, EMBEDDING_DIMENSIONS, type Queryable } from '@twin/db';
import { hashMemoryContent } from '../memories/memories.service.js';
import { getEmbeddingProvider, EmbeddingProviderError, type EmbeddingProvider } from './embeddings/index.js';

export type EmbedMemoryStatus = 'embedded' | 'skipped_up_to_date' | 'skipped_no_provider' | 'failed';

export interface EmbedMemoryResult {
  status: EmbedMemoryStatus;
  provider?: string;
  error?: string;
}

/**
 * The single-memory unit of work behind Twin's embedding pipeline —
 * generate an embedding for one memory, validate it, and store it.
 * Deliberately memory-at-a-time and side-effect-free beyond that one
 * row, so this same function can be called:
 *   - inline, synchronously, right after a memory is created (what
 *     this phase actually does — see ingestion.service.ts and
 *     memories.routes.ts)
 *   - from a future queue/worker consumer processing one job per call
 *   - from a one-off backfill script over existing memories
 * without any of those callers needing to change if the *trigger*
 * moves from inline to async later.
 *
 * Guarantees:
 *   - idempotent: re-running this on an already-embedded, unchanged
 *     memory with the same provider is a no-op (status
 *     'skipped_up_to_date'), not a wasted API call or a duplicate write.
 *   - never overwrites a valid embedding with an invalid result: the
 *     `memories` row is only ever UPDATEd on the success path below —
 *     any failure (network, timeout, rate limit, wrong dimension,
 *     malformed response) is caught and reported, and the existing
 *     embedding/embeddingModel/embeddingGeneratedAt columns are left
 *     exactly as they were.
 *   - never creates a memory or duplicates one — it only ever UPDATEs
 *     the single existing row identified by (userId, memoryId).
 */
export async function embedMemory(
  db: Queryable,
  userId: string,
  memoryId: string,
  providerOverride?: EmbeddingProvider | null,
): Promise<EmbedMemoryResult> {
  const provider = providerOverride !== undefined ? providerOverride : getEmbeddingProvider();
  if (!provider) {
    return { status: 'skipped_no_provider' };
  }

  const [row] = await db
    .select({
      content: memories.content,
      contentHash: memories.contentHash,
      embedding: memories.embedding,
      embeddingModel: memories.embeddingModel,
      embeddingContentHash: memories.embeddingContentHash,
    })
    .from(memories)
    .where(and(eq(memories.id, memoryId), eq(memories.userId, userId)))
    .limit(1);

  if (!row) {
    throw new Error(`Memory not found for embedding: ${memoryId}`);
  }

  const currentContentHash = row.contentHash ?? hashMemoryContent(row.content);
  const alreadyUpToDate =
    row.embedding !== null &&
    row.embeddingModel === provider.name &&
    row.embeddingContentHash === currentContentHash;

  if (alreadyUpToDate) {
    return { status: 'skipped_up_to_date', provider: provider.name };
  }

  try {
    const result = await provider.embed(row.content);

    if (result.values.length !== EMBEDDING_DIMENSIONS || result.dimensions !== EMBEDDING_DIMENSIONS) {
      throw new EmbeddingProviderError(
        `Embedding provider "${provider.name}" returned ${result.values.length} dimensions; expected ${EMBEDDING_DIMENSIONS}.`,
        'wrong_dimension',
      );
    }

    await db
      .update(memories)
      .set({
        embedding: result.values,
        embeddingModel: provider.name,
        embeddingGeneratedAt: new Date(),
        embeddingContentHash: currentContentHash,
      })
      .where(and(eq(memories.id, memoryId), eq(memories.userId, userId)));

    return { status: 'embedded', provider: provider.name };
  } catch (err) {
    const message =
      err instanceof EmbeddingProviderError
        ? `Embedding provider error (${err.code}): ${err.message}`
        : err instanceof Error
          ? err.message
          : 'Unknown embedding error.';
    return { status: 'failed', provider: provider.name, error: message };
  }
}
