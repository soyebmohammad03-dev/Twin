/**
 * Adapts between the real Memory API's shape (MemoryDetailDto) and the
 * existing frontend's MemoryItem shape (types.ts), so MemoryView /
 * CaptureModal / MemoryDetailModal — none of which change — can keep
 * working exactly as designed while the data underneath becomes real.
 *
 * The mapping isn't 1:1: MemoryItem has no backend equivalent for
 * `title` (stored in metadata.title) or `tags` (metadata.tags), and
 * the API has no equivalent for imageUrl/personRole/statusBadge —
 * those were only ever populated by seed data, never by the capture
 * flow that's being wired up here, so they simply stay undefined for
 * real memories, matching how the prototype already behaved for
 * anything the user actually captured.
 */

import type { CreateIngestionRequest, MemoryDetailDto, SourceType } from '@twin/contracts';
import type { MemoryCategory, MemoryItem } from '../types';

const KNOWN_CATEGORIES: readonly MemoryCategory[] = ['people', 'projects', 'ideas', 'decisions'];

function toCategory(memoryType: string): MemoryCategory {
  return (KNOWN_CATEGORIES as readonly string[]).includes(memoryType)
    ? (memoryType as MemoryCategory)
    : 'ideas';
}

const SOURCE_TYPE_TO_LABEL: Record<SourceType, string> = {
  manual: 'Manual Entry',
  voice_note: 'Voice Note',
  document: 'Document',
  image: 'Image',
  screen_capture: 'Screen Capture',
  conversation: 'Conversation',
  web_link: 'Web Link',
  system_synthesis: 'System Synthesis',
};

const SOURCE_TYPE_TO_UI: Record<SourceType, MemoryItem['sourceType']> = {
  manual: 'manual',
  voice_note: 'voice',
  document: 'manual',
  image: 'manual',
  screen_capture: 'screen',
  conversation: 'manual',
  web_link: 'manual',
  system_synthesis: 'synthesis',
};

function formatMemoryDate(iso: string): string {
  const date = new Date(iso);
  const ageMs = Date.now() - date.getTime();
  if (ageMs >= 0 && ageMs < 2 * 60 * 1000) {
    return 'Just now';
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function toMemoryItem(dto: MemoryDetailDto): MemoryItem {
  const metadata = dto.metadata as { title?: string; tags?: string[] };
  const title = metadata.title?.trim() || dto.content.slice(0, 60) || 'Untitled Thought';

  return {
    id: dto.id,
    category: toCategory(dto.memoryType),
    title,
    description: dto.content,
    date: formatMemoryDate(dto.occurredAt ?? dto.createdAt),
    occurredAtIso: dto.occurredAt ?? dto.createdAt,
    source: SOURCE_TYPE_TO_LABEL[dto.source.sourceType],
    sourceType: SOURCE_TYPE_TO_UI[dto.source.sourceType],
    explicit: dto.epistemicStatus === 'explicit',
    tags: metadata.tags,
    linkedEntity: dto.entityLinks[0]?.entity.name,
    linkedEntityId: dto.entityLinks[0]?.entity.id,
  };
}

/**
 * Builds the ingestion request from what CaptureModal collects. Note
 * vs. Voice Memo becomes `text` vs. `voice_transcript` — CaptureModal
 * never produces the other three ingestion types (image/document/
 * web_link), since it has no UI for them.
 */
export function toCreateIngestionRequest(input: {
  title: string;
  description: string;
  category: MemoryCategory;
  sourceType: NonNullable<MemoryItem['sourceType']>;
  tags?: string[];
}): CreateIngestionRequest {
  const common = {
    title: input.title,
    memoryType: input.category,
    tags: input.tags && input.tags.length > 0 ? input.tags : undefined,
  };

  if (input.sourceType === 'voice') {
    return { type: 'voice_transcript', transcript: input.description, ...common };
  }
  return { type: 'text', content: input.description, ...common };
}
