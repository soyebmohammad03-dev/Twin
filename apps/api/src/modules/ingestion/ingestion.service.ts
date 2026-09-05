import { and, desc, eq } from 'drizzle-orm';
import { ingestionJobs, type Database } from '@twin/db';
import type {
  CreateIngestionRequest,
  IngestionStatus,
  ListIngestionJobsQuery,
  EpistemicStatus,
  SourceType,
} from '@twin/contracts';
import {
  createMemory,
  getMemoryDetail,
  hashMemoryContent,
  findMemoryByContentHash,
  type MemoryWithRelations,
} from '../memories/memories.service.js';
import { listEntities } from '../entities/entities.service.js';
import { getExtractionProvider } from './extraction/index.js';
import { fetchAndExtractText, WebFetchError } from './extraction/webFetch.js';
import { getAIProvider, AIProviderError, type AIProvider } from './ai/index.js';
import {
  parseStructuredExtraction,
  validateExtractionResult,
  storeExtractionResult,
  linkPrimaryMemoryToResolvedEntities,
  ExtractionParseError,
  type ExtractionStorageResult,
} from './extraction/pipeline.js';
import { embedMemory } from '../retrieval/embedding.service.js';
import type { EmbeddingProvider } from '../retrieval/embeddings/index.js';

export type IngestionJobRow = typeof ingestionJobs.$inferSelect;

export interface IngestionResult {
  job: IngestionJobRow;
  memory: MemoryWithRelations | null;
}

/**
 * The audit trail stored on ingestion_jobs.extraction_result — present
 * only when an AI provider was configured and attempted (never for the
 * default heuristic-only path, where it stays null). This is the
 * pipeline's RESULT stage output for the AI enrichment specifically:
 * what the model was asked, what survived validation, what was
 * dropped and why, and exactly what got resolved/created/stored.
 */
export type AIExtractionAudit =
  | { status: 'completed'; provider: string; storage: ExtractionStorageResult }
  | { status: 'failed'; provider: string; error: string };

interface ResolvedInput {
  content: string;
  sourceType: SourceType;
  sourceTitle?: string;
  sourceRawContent?: string;
  sourceUrl?: string;
  defaultEpistemicStatus: EpistemicStatus;
  defaultMemoryType: string;
}

/** Resolves the type-specific request shape into what a memory/source actually needs. May throw (e.g. WebFetchError) — the caller turns that into a failed job, not an HTTP error. */
async function resolveInput(input: CreateIngestionRequest): Promise<ResolvedInput> {
  switch (input.type) {
    case 'text':
      return {
        content: input.content,
        sourceType: 'manual',
        defaultEpistemicStatus: 'explicit',
        defaultMemoryType: 'note',
      };

    case 'voice_transcript':
      // Speech-to-text is assumed to have already happened — this
      // pipeline ingests the transcript text, it does not transcribe.
      return {
        content: input.transcript,
        sourceType: 'voice_note',
        sourceRawContent: input.transcript,
        defaultEpistemicStatus: 'explicit',
        defaultMemoryType: 'note',
      };

    case 'web_link': {
      const { title, text } = await fetchAndExtractText(input.url);
      if (!text) {
        throw new WebFetchError(`No readable text content found at ${input.url}.`);
      }
      return {
        content: text,
        sourceType: 'web_link',
        sourceTitle: title ?? undefined,
        sourceUrl: input.url,
        sourceRawContent: text,
        // The content came from an external page the user pointed
        // Twin at, not something the user is personally asserting.
        defaultEpistemicStatus: 'from_source',
        defaultMemoryType: 'research',
      };
    }

    case 'image':
      // No OCR is implemented — the description is the user's own
      // explicit account of what the image shows.
      return {
        content: input.description,
        sourceType: 'image',
        sourceTitle: input.title,
        defaultEpistemicStatus: 'explicit',
        defaultMemoryType: 'observation',
      };

    case 'document':
      // No document parsing is implemented — same reasoning as image.
      return {
        content: input.description,
        sourceType: 'document',
        sourceTitle: input.title,
        defaultEpistemicStatus: 'explicit',
        defaultMemoryType: 'document_excerpt',
      };
  }
}

/** Mirrors the metadata shape apps/web/src/services/memoryMapper.ts already expects from direct memory creation. */
function buildMemoryMetadata(input: CreateIngestionRequest): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {};
  if (input.title) metadata.title = input.title;
  if (input.tags && input.tags.length > 0) metadata.tags = input.tags;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

async function appendStatus(
  db: Database,
  jobId: string,
  status: IngestionStatus,
  patch: Partial<typeof ingestionJobs.$inferInsert> = {},
): Promise<IngestionJobRow> {
  const [current] = await db
    .select({ statusHistory: ingestionJobs.statusHistory })
    .from(ingestionJobs)
    .where(eq(ingestionJobs.id, jobId))
    .limit(1);

  const history = Array.isArray(current?.statusHistory) ? current.statusHistory : [];
  const nextHistory = [...history, { status, at: new Date().toISOString() }];

  const [updated] = await db
    .update(ingestionJobs)
    .set({ status, statusHistory: nextHistory, updatedAt: new Date(), ...patch })
    .where(eq(ingestionJobs.id, jobId))
    .returning();

  if (!updated) {
    throw new Error(`Ingestion job not found during status transition: ${jobId}`);
  }
  return updated;
}

/**
 * Runs one ingestion end to end: creates the job record, resolves the
 * raw input into content (fetching a URL for web_link, or taking the
 * text/transcript/description as-is), checks for an exact duplicate,
 * runs the configured extraction provider for entity linking, and
 * creates the resulting memory — reusing Phase 3's createMemory so
 * the transactional guarantees there (source + memory + entity links,
 * all-or-nothing) apply here too.
 *
 * Processing runs synchronously within this call — there is no
 * background worker yet. Every transition (pending → processing →
 * completed/failed) is still written to the job row as it happens, so
 * the state machine is real and auditable, not just a label.
 *
 * Never throws for processing failures (e.g. an unreachable URL) —
 * those become a job with status 'failed' and a real error message.
 * Only truly unexpected errors (the initial job insert failing) throw.
 */
/**
 * The AI half of the pipeline described in the module header:
 *
 *   AI ANALYSIS -> STRUCTURED EXTRACTION -> VALIDATION -> ENTITY
 *   RESOLUTION -> MEMORY/RELATION STORAGE -> RESULT
 *
 * Runs only when an AI provider is configured (getAIProvider() !==
 * null); returns null otherwise so the caller can tell "not
 * configured" apart from "configured but failed". Deliberately never
 * throws — any failure (network, timeout, rate limit, malformed
 * output, invalid structured output) is caught and reported as a
 * 'failed' AIExtractionAudit, because a hiccup in this optional
 * enrichment step must never take down the primary memory that Phase
 * 4's guarantee already saved.
 */
async function runAIExtraction(
  db: Database,
  userId: string,
  content: string,
  sourceId: string,
  primaryMemoryId: string,
  providerOverride?: AIProvider | null,
): Promise<AIExtractionAudit | null> {
  const provider: AIProvider | null = providerOverride !== undefined ? providerOverride : getAIProvider();
  if (!provider) return null;

  try {
    const existingEntities = await listEntities(db, userId, {});
    const raw = await provider.analyze({
      content,
      existingEntities: existingEntities.map((e) => ({ type: e.entityType, name: e.name })),
    });

    // STRUCTURED EXTRACTION + VALIDATION — pure, no DB access, so a
    // malformed/hallucinated response never reaches a write.
    const structured = parseStructuredExtraction(raw);
    const validated = validateExtractionResult(structured, content);

    // ENTITY RESOLUTION + MEMORY/RELATION STORAGE, atomically: either
    // the whole enrichment commits, or none of it does.
    const storage = await db.transaction(async (tx) => {
      const result = await storeExtractionResult(tx, userId, sourceId, primaryMemoryId, provider.name, validated);
      await linkPrimaryMemoryToResolvedEntities(tx, primaryMemoryId, result.entities);
      return result;
    });

    return { status: 'completed', provider: provider.name, storage };
  } catch (err) {
    const message =
      err instanceof AIProviderError
        ? `AI provider error (${err.code}): ${err.message}`
        : err instanceof ExtractionParseError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Unknown AI extraction error.';
    return { status: 'failed', provider: provider.name, error: message };
  }
}

export interface IngestOptions {
  /**
   * Test-only injection seam: overrides which AI provider
   * runAIExtraction uses instead of resolving one from env config.
   * `undefined` (the default, and the only value the real HTTP route
   * ever passes) means "resolve normally from EXTRACTION_PROVIDER".
   * Passing `null` explicitly means "run as if no AI provider were
   * configured". Never read from request input — a caller cannot
   * inject an arbitrary provider over HTTP.
   */
  aiProviderOverride?: AIProvider | null;
  /** Same test-only injection seam as aiProviderOverride, for embedMemory's provider resolution. */
  embeddingProviderOverride?: EmbeddingProvider | null;
}

export async function ingest(
  db: Database,
  userId: string,
  input: CreateIngestionRequest,
  options: IngestOptions = {},
): Promise<IngestionResult> {
  const [job] = await db
    .insert(ingestionJobs)
    .values({
      userId,
      inputType: input.type,
      status: 'pending',
      statusHistory: [{ status: 'pending', at: new Date().toISOString() }],
      rawInput: input,
      extractionProvider: 'unresolved', // updated once a provider actually runs
    })
    .returning();

  if (!job) {
    throw new Error('Ingestion job insert returned no row.');
  }

  let current = job;

  try {
    current = await appendStatus(db, current.id, 'processing');

    const resolved = await resolveInput(input);
    const contentHash = hashMemoryContent(resolved.content);
    const existing = await findMemoryByContentHash(db, userId, contentHash);
    const provider = getExtractionProvider();

    if (existing) {
      current = await appendStatus(db, current.id, 'completed', {
        resultMemoryId: existing.id,
        isDuplicate: true,
        extractionProvider: provider.name,
        completedAt: new Date(),
      });
      return { job: current, memory: existing };
    }

    const extraction = await provider.extract({ userId, content: resolved.content }, db);

    const memoryId = await createMemory(db, userId, {
      source: {
        // A caller-supplied title takes precedence over whatever the
        // resolver came up with (e.g. a fetched page's <title>).
        sourceType: resolved.sourceType,
        title: input.title ?? resolved.sourceTitle,
        rawContent: resolved.sourceRawContent,
        url: resolved.sourceUrl,
      },
      content: extraction.content,
      memoryType: input.memoryType ?? resolved.defaultMemoryType,
      epistemicStatus: input.epistemicStatus ?? resolved.defaultEpistemicStatus,
      confidence: 1,
      importance: input.importance ?? 3,
      occurredAt: input.occurredAt,
      metadata: buildMemoryMetadata(input),
      entityLinks: extraction.entityLinks.length > 0 ? extraction.entityLinks : undefined,
    });

    let memory = await getMemoryDetail(db, userId, memoryId);
    if (!memory) {
      throw new Error('Memory not found immediately after creation.');
    }

    // Optional AI enrichment layered on top of the now-guaranteed
    // primary memory — see runAIExtraction's own doc comment for why
    // this can never turn a successful capture into a failed job.
    const aiExtraction = await runAIExtraction(
      db,
      userId,
      resolved.content,
      memory.source.id,
      memory.id,
      options.aiProviderOverride,
    );

    // Phase 6: best-effort embedding for the primary memory and any
    // AI-extracted memories — same failure-safety contract as
    // runAIExtraction (embedMemory never throws for provider failures;
    // a missing embedding just means that memory won't surface via
    // semantic search until backfilled, not that ingestion failed).
    await embedMemory(db, userId, memory.id, options.embeddingProviderOverride);
    if (aiExtraction?.status === 'completed') {
      for (const extraMemoryId of aiExtraction.storage.memoryIds) {
        await embedMemory(db, userId, extraMemoryId, options.embeddingProviderOverride);
      }
    }

    // If AI enrichment linked the primary memory to any resolved
    // entities, the DTO snapshot taken above (before enrichment ran)
    // is now stale — re-fetch so the caller sees those links, not an
    // empty entityLinks array.
    if (aiExtraction?.status === 'completed' && aiExtraction.storage.entities.length > 0) {
      memory = (await getMemoryDetail(db, userId, memoryId)) ?? memory;
    }

    current = await appendStatus(db, current.id, 'completed', {
      resultMemoryId: memory.id,
      isDuplicate: false,
      extractionProvider: provider.name,
      extractionResult: aiExtraction,
      completedAt: new Date(),
    });
    return { job: current, memory };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown ingestion error.';
    current = await appendStatus(db, current.id, 'failed', {
      errorMessage: message,
      completedAt: new Date(),
    });
    return { job: current, memory: null };
  }
}

export async function getIngestionJob(db: Database, userId: string, jobId: string): Promise<IngestionResult | undefined> {
  const [job] = await db
    .select()
    .from(ingestionJobs)
    .where(eq(ingestionJobs.id, jobId))
    .limit(1);
  if (!job || job.userId !== userId) {
    return undefined;
  }

  const memory = job.resultMemoryId ? await getMemoryDetail(db, userId, job.resultMemoryId, { includeArchived: true }) : null;
  return { job, memory: memory ?? null };
}

export async function listIngestionJobs(
  db: Database,
  userId: string,
  filter: ListIngestionJobsQuery,
): Promise<IngestionJobRow[]> {
  const conditions = [eq(ingestionJobs.userId, userId)];
  if (filter.status) {
    conditions.push(eq(ingestionJobs.status, filter.status));
  }
  return db
    .select()
    .from(ingestionJobs)
    .where(and(...conditions))
    .orderBy(desc(ingestionJobs.createdAt));
}
