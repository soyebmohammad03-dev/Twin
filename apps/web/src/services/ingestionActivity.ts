/**
 * Phase 22 — pure, no-network adapter from the real ingestion job
 * state machine (IngestionJobDto, apps/api/src/modules/ingestion) to
 * ProfileView's Ingestion Activity display shape. Mirrors
 * graphMapper.ts's role for Explore: every field here traces back to
 * a real stored status/timestamp/error — nothing is invented.
 *
 * Deliberately does NOT fabricate a "processing" animation as if this
 * were a live background job: ingestion currently runs synchronously
 * within the request that created it (see ingestionJobs.ts's own doc
 * comment), so a job is realistically always observed already in a
 * terminal state (completed/failed) by the time this list is fetched.
 * pending/processing are still handled honestly (in case that ever
 * changes), just not presented as something actively happening now.
 */

import type { IngestionInputType, IngestionJobDto, IngestionStatus } from '@twin/contracts';

const INPUT_TYPE_LABEL: Record<IngestionInputType, string> = {
  text: 'Text capture',
  voice_transcript: 'Voice memo',
  web_link: 'Web link',
  document: 'Document',
  image: 'Image',
};

const INPUT_TYPE_ICON: Record<IngestionInputType, string> = {
  text: 'notes',
  voice_transcript: 'mic',
  web_link: 'link',
  document: 'description',
  image: 'image',
};

const STATUS_COLOR: Record<IngestionStatus, string> = {
  completed: '#34c759',
  failed: '#ff6b6b',
  processing: '#818cf8',
  pending: '#918f9f',
};

/** A stored error message is already a caught `Error.message` (see ingestion.service.ts), never a raw stack trace — this is a display-length bound only, not a sanitization step. */
const MAX_ERROR_CHARS = 140;

export interface IngestionActivityItem {
  id: string;
  icon: string;
  color: string;
  title: string;
  subtitle: string;
  status: IngestionStatus;
  isDuplicate: boolean;
  /** True only when this job actually produced (or matched) a real, still-referenceable memory. */
  canViewMemory: boolean;
  timestamp: string;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Phase 31: a real, honest one-line summary of what AI extraction
 * actually stored for this job — never a fabricated count or fake
 * confidence. `extractionResult.storage` is the loosely-typed audit
 * trail from ingestion/extraction/pipeline.ts's ExtractionStorageResult;
 * read defensively (every field optional/array-checked) since the
 * contract keeps this shape free to evolve without a version bump.
 */
function structuredKnowledgeSuffix(job: IngestionJobDto): string | null {
  const result = job.extractionResult;
  if (!result || result.status !== 'completed') return null;
  const storage = result.storage as
    | { entities?: unknown[]; relationships?: unknown[]; memoryIds?: unknown[] }
    | undefined;
  if (!storage) return null;

  const entityCount = Array.isArray(storage.entities) ? storage.entities.length : 0;
  const relationshipCount = Array.isArray(storage.relationships) ? storage.relationships.length : 0;
  const noteCount = Array.isArray(storage.memoryIds) ? storage.memoryIds.length : 0;
  if (entityCount === 0 && relationshipCount === 0 && noteCount === 0) return null;

  const parts: string[] = [];
  if (entityCount > 0) parts.push(`${entityCount} ${entityCount === 1 ? 'entity' : 'entities'}`);
  if (relationshipCount > 0) parts.push(`${relationshipCount} ${relationshipCount === 1 ? 'relationship' : 'relationships'}`);
  if (noteCount > 0) parts.push(`${noteCount} ${noteCount === 1 ? 'note' : 'notes'}`);
  return `Structured knowledge added — ${parts.join(', ')}`;
}

function subtitleFor(job: IngestionJobDto): string {
  if (job.status === 'failed') {
    return job.errorMessage ? `Failed — ${truncate(job.errorMessage, MAX_ERROR_CHARS)}` : 'Failed';
  }
  if (job.status === 'completed') {
    if (job.isDuplicate) return 'Duplicate — already in your vault';
    return structuredKnowledgeSuffix(job) ?? 'Captured';
  }
  if (job.status === 'processing') return 'Processing…';
  return 'Pending';
}

function formatJobDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function toIngestionActivityItem(job: IngestionJobDto): IngestionActivityItem {
  return {
    id: job.id,
    icon: INPUT_TYPE_ICON[job.inputType],
    color: STATUS_COLOR[job.status],
    title: INPUT_TYPE_LABEL[job.inputType],
    subtitle: subtitleFor(job),
    status: job.status,
    isDuplicate: job.isDuplicate,
    canViewMemory: job.resultMemoryId !== null,
    timestamp: formatJobDate(job.completedAt ?? job.createdAt),
  };
}
