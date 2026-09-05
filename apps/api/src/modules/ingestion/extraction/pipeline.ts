import { and, eq } from 'drizzle-orm';
import {
  entities,
  memoryEntities,
  decisions as decisionsTable,
  people as peopleTable,
  projects as projectsTable,
  goals as goalsTable,
  events as eventsTable,
  type Queryable,
} from '@twin/db';
import type { EntityType } from '@twin/contracts';
import type { EntityRow } from '../../entities/entities.service.js';
import { createEntity } from '../../entities/entities.service.js';
import { createMemoryTx } from '../../memories/memories.service.js';
import { normalizeEntityName, planEntityResolution } from '../../graph/entityResolution.js';
import { upsertRelationshipWithEvidence } from '../../graph/relationships.service.js';
import {
  aiExtractionResultSchema,
  normalizeDate,
  type AIExtractionResult,
  type ExtractedEntity,
  type ExtractedMemory,
  type ExtractedRelationship,
} from '../ai/schema.js';

/**
 * The middle three stages of the pipeline documented in
 * ingestion.service.ts's `runAIExtraction`:
 *
 *   AI ANALYSIS -> [STRUCTURED EXTRACTION -> VALIDATION -> ENTITY
 *   RESOLUTION] -> MEMORY/RELATION STORAGE
 *
 * Deliberately split into small, independently testable functions
 * rather than one long procedure — malformed output, hallucination,
 * confidence handling, and entity resolution are each their own named
 * concern with their own unit tests (see test/ai-extraction.*.test.ts).
 */

// ---------------------------------------------------------------------------
// STRUCTURED EXTRACTION
// ---------------------------------------------------------------------------

export class ExtractionParseError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'ExtractionParseError';
  }
}

/** JSON.parse + schema validation of the AI provider's raw text. Throws ExtractionParseError on anything that isn't a schema-conforming object — malformed/invalid output must fail loudly here, not get partially trusted. */
export function parseStructuredExtraction(raw: string): AIExtractionResult {
  let parsed: unknown;
  try {
    // Models occasionally wrap JSON in ```json fences despite instructions not to — strip them defensively.
    const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new ExtractionParseError('AI response was not valid JSON.', err);
  }

  const result = aiExtractionResultSchema.safeParse(parsed);
  if (!result.success) {
    throw new ExtractionParseError(`AI response did not match the required schema: ${result.error.message}`);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// VALIDATION — confidence floor + groundedness ("never invent")
// ---------------------------------------------------------------------------

/** Below this, an item is treated as "the model wasn't sure" and dropped — never stored as a guess. */
export const MIN_CONFIDENCE = 0.4;

export interface DroppedItem {
  kind: 'entity' | 'memory' | 'relationship';
  reason: 'low_confidence' | 'ungrounded_evidence' | 'unresolved_entity_reference' | 'invalid_event_no_date';
  name: string;
}

export interface ValidatedExtraction {
  entities: ExtractedEntity[];
  memories: ExtractedMemory[];
  relationships: ExtractedRelationship[];
  dropped: DroppedItem[];
}

function normalizeForGrounding(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True only if `evidence` is genuinely, verbatim (modulo case/punctuation/whitespace) present in `sourceContent` — the concrete anti-hallucination check. */
export function isGrounded(evidence: string, sourceContent: string): boolean {
  const needle = normalizeForGrounding(evidence);
  if (needle.length < 3) return false;
  return normalizeForGrounding(sourceContent).includes(needle);
}

/**
 * Filters the raw (schema-valid) extraction down to what's actually
 * trustworthy: every item must clear the confidence floor AND have
 * evidence that's really in the source text. Items that fail either
 * check are dropped (recorded, not silently discarded) rather than
 * stored — this is where "leave it unknown rather than guessing" is
 * mechanically enforced, not just requested via the prompt.
 */
export function validateExtractionResult(result: AIExtractionResult, sourceContent: string): ValidatedExtraction {
  const dropped: DroppedItem[] = [];

  const entities = result.entities.filter((e) => {
    if (e.confidence < MIN_CONFIDENCE) {
      dropped.push({ kind: 'entity', reason: 'low_confidence', name: e.name });
      return false;
    }
    if (!isGrounded(e.evidence, sourceContent)) {
      dropped.push({ kind: 'entity', reason: 'ungrounded_evidence', name: e.name });
      return false;
    }
    if (e.type === 'event' && !e.startsAt) {
      // An event entity with no confidently-known date is not enough
      // to create an event node (events.starts_at is NOT NULL, and we
      // will not invent a date to satisfy that column).
      dropped.push({ kind: 'entity', reason: 'invalid_event_no_date', name: e.name });
      return false;
    }
    return true;
  });

  const memories = result.memories.filter((m) => {
    if (m.confidence < MIN_CONFIDENCE) {
      dropped.push({ kind: 'memory', reason: 'low_confidence', name: m.content.slice(0, 60) });
      return false;
    }
    if (!isGrounded(m.evidence, sourceContent)) {
      dropped.push({ kind: 'memory', reason: 'ungrounded_evidence', name: m.content.slice(0, 60) });
      return false;
    }
    return true;
  });

  const relationships = result.relationships.filter((r) => {
    if (r.confidence < MIN_CONFIDENCE) {
      dropped.push({
        kind: 'relationship',
        reason: 'low_confidence',
        name: `${r.fromEntityName} -${r.relationshipType}-> ${r.toEntityName}`,
      });
      return false;
    }
    if (!isGrounded(r.evidence, sourceContent)) {
      dropped.push({
        kind: 'relationship',
        reason: 'ungrounded_evidence',
        name: `${r.fromEntityName} -${r.relationshipType}-> ${r.toEntityName}`,
      });
      return false;
    }
    return true;
  });

  return { entities, memories, relationships, dropped };
}

// ---------------------------------------------------------------------------
// ENTITY RESOLUTION — reuse-or-create, never fuzzy-merge
// ---------------------------------------------------------------------------
//
// planEntityResolution/normalizeEntityName now live in
// ../../graph/entityResolution.ts, shared with the direct POST
// /entities path (entities.service.ts's findOrCreateEntity) so both
// ways of creating an entity agree on exactly what counts as "the same
// name" — see that module's docs for what's normalized (case,
// whitespace, common punctuation) and, just as importantly, what
// isn't (no fuzzy/similarity matching).

// ---------------------------------------------------------------------------
// MEMORY / RELATION STORAGE
// ---------------------------------------------------------------------------

export interface StoredEntityAudit {
  name: string;
  type: EntityType;
  entityId: string;
  resolution: 'reused' | 'created';
  reasoning: string;
}

export interface StoredRelationshipAudit {
  relationshipId: string;
  fromEntityName: string;
  toEntityName: string;
  relationshipType: string;
}

export interface ExtractionStorageResult {
  entities: StoredEntityAudit[];
  memoryIds: string[];
  relationships: StoredRelationshipAudit[];
  dropped: DroppedItem[];
}

/**
 * Executes ENTITY RESOLUTION's decisions and MEMORY/RELATION STORAGE
 * inside the given transaction (the caller — ingestion.service.ts —
 * owns transaction boundaries, so this composes with primary-memory
 * creation atomically: either the whole enrichment commits, or none
 * of it does, satisfying "never create corrupted memory").
 */
export async function storeExtractionResult(
  tx: Queryable,
  userId: string,
  sourceId: string,
  primaryMemoryId: string,
  extractionMethod: string,
  validated: ValidatedExtraction,
): Promise<ExtractionStorageResult> {
  const resolutions = planEntityResolution(validated.entities, await getExistingEntities(tx, userId));

  const storedEntities: StoredEntityAudit[] = [];
  const nameToEntityId = new Map<string, string>();

  for (const resolution of resolutions) {
    if (resolution.action === 'reuse' && resolution.entityId) {
      storedEntities.push({
        name: resolution.mention.name,
        type: resolution.mention.type,
        entityId: resolution.entityId,
        resolution: 'reused',
        reasoning: resolution.reasoning,
      });
      nameToEntityId.set(normalizeEntityName(resolution.mention.name), resolution.entityId);
      // Phase 31: deliberately never touches an EXISTING decision's
      // status here — an LLM re-mentioning a decision in passing must
      // never silently flip it from open to decided (or vice versa).
      // Only a brand-new decision entity's initial status comes from
      // extraction (below); changing an existing one stays a fully
      // user-driven action via PATCH /decisions/:id.
      continue;
    }

    const created = await createEntity(tx, userId, {
      entityType: resolution.mention.type,
      name: resolution.mention.name,
      description: resolution.mention.description,
      metadata: {
        createdBy: 'ai-extraction',
        epistemicStatus: resolution.mention.epistemicStatus,
        confidence: resolution.mention.confidence,
        evidence: resolution.mention.evidence,
      },
    });

    // Phase 31/32: a brand-new entity of a type with a 1:1 subtype
    // table (decision/person/project/goal/event) also gets that
    // subtype row created here, so it isn't structurally
    // indistinguishable from a bare entity (see e.g. decisions.ts's
    // schema comment — every decision entity must have a decisions
    // row, or decisions.service.ts's getDecisionById 404s on it).
    // Only fields the extraction contract genuinely grounds in
    // evidence are ever set — everything else is left at the
    // subtype table's own column default (never guessed):
    //   - decision.status: 'decided' only when schema.ts's
    //     decisionStatus was explicitly classified as finalized
    //     language (Phase 31); otherwise the table's 'open' default.
    //   - goal.targetDate: only when a specific, resolvable date was
    //     stated (schema.ts's targetDate); otherwise left null.
    //   - event.startsAt: always set — validateExtractionResult
    //     already drops any 'event' entity with no confident date
    //     before it ever reaches here, so a surviving event mention
    //     is guaranteed to carry one.
    //   - person/project: no extraction field feeds any of their
    //     optional columns (role/relationship/contactInfo,
    //     status/startedAt/completedAt) — any such fact belongs in a
    //     "memory" linked to the entity (see prompt.ts's 5d/5e),
    //     never invented as an entity attribute. The row is still
    //     created (with the table's own defaults) so these entities
    //     are no longer structurally second-class next to decisions.
    // Idea entities have no subtype table (see entities.ts) — nothing
    // to do for them beyond the shared `entities` row.
    // This never touches an EXISTING entity's subtype row — see the
    // 'reuse' branch above; only first creation ever sets these.
    if (resolution.mention.type === 'decision') {
      const isDecided = resolution.mention.decisionStatus === 'decided';
      await tx.insert(decisionsTable).values({
        entityId: created.id,
        status: isDecided ? 'decided' : 'open',
        decidedAt: isDecided ? new Date() : undefined,
      });
    } else if (resolution.mention.type === 'person') {
      await tx.insert(peopleTable).values({ entityId: created.id });
    } else if (resolution.mention.type === 'project') {
      await tx.insert(projectsTable).values({ entityId: created.id });
    } else if (resolution.mention.type === 'goal') {
      await tx.insert(goalsTable).values({
        entityId: created.id,
        targetDate: resolution.mention.targetDate ? new Date(normalizeDate(resolution.mention.targetDate)) : undefined,
      });
    } else if (resolution.mention.type === 'event' && resolution.mention.startsAt) {
      await tx.insert(eventsTable).values({
        entityId: created.id,
        startsAt: new Date(normalizeDate(resolution.mention.startsAt)),
      });
    }

    storedEntities.push({
      name: resolution.mention.name,
      type: resolution.mention.type,
      entityId: created.id,
      resolution: 'created',
      reasoning: resolution.reasoning,
    });
    nameToEntityId.set(normalizeEntityName(resolution.mention.name), created.id);
  }

  const memoryIds: string[] = [];
  const dropped = [...validated.dropped];

  for (const extracted of validated.memories) {
    const entityLinks = extracted.relatedEntityNames
      .map((name) => nameToEntityId.get(normalizeEntityName(name)))
      .filter((id): id is string => Boolean(id))
      .map((entityId) => ({ entityId, role: 'about' }));

    const memoryId = await createMemoryTx(tx, userId, {
      sourceId,
      memoryType: extracted.kind,
      content: extracted.content,
      epistemicStatus: extracted.epistemicStatus,
      confidence: extracted.confidence,
      importance: extracted.importance,
      occurredAt: extracted.occurredAt ? normalizeDate(extracted.occurredAt) : undefined,
      metadata: { extractedBy: 'ai-extraction', evidence: extracted.evidence },
      entityLinks: entityLinks.length > 0 ? entityLinks : undefined,
    });
    memoryIds.push(memoryId);
  }

  const storedRelationships: StoredRelationshipAudit[] = [];
  for (const rel of validated.relationships) {
    const fromId = nameToEntityId.get(normalizeEntityName(rel.fromEntityName));
    const toId = nameToEntityId.get(normalizeEntityName(rel.toEntityName));
    if (!fromId || !toId || fromId === toId) {
      dropped.push({
        kind: 'relationship',
        reason: 'unresolved_entity_reference',
        name: `${rel.fromEntityName} -${rel.relationshipType}-> ${rel.toEntityName}`,
      });
      continue;
    }

    // Every relationship extracted alongside this content is evidenced
    // by the PRIMARY memory (the raw captured content) — the extra
    // memories created above are themselves distinct facts/preferences,
    // not the evidence source for the relationship graph.
    const result = await upsertRelationshipWithEvidence(tx, {
      userId,
      fromEntityId: fromId,
      toEntityId: toId,
      relationshipType: rel.relationshipType,
      epistemicStatus: rel.epistemicStatus,
      confidence: rel.confidence,
      extractionMethod,
      sourceMemoryId: primaryMemoryId,
      evidenceText: rel.evidence,
    });

    storedRelationships.push({
      relationshipId: result.relationshipId,
      fromEntityName: rel.fromEntityName,
      toEntityName: rel.toEntityName,
      relationshipType: rel.relationshipType,
    });
  }

  return { entities: storedEntities, memoryIds, relationships: storedRelationships, dropped };
}

async function getExistingEntities(db: Queryable, userId: string): Promise<EntityRow[]> {
  return db.select().from(entities).where(and(eq(entities.userId, userId)));
}

/** Links the primary (raw-content) memory to every resolved entity that's genuinely mentioned in it — role 'mentioned', same convention as the heuristic provider. */
export async function linkPrimaryMemoryToResolvedEntities(
  tx: Queryable,
  primaryMemoryId: string,
  storedEntities: StoredEntityAudit[],
): Promise<void> {
  if (storedEntities.length === 0) return;
  await tx
    .insert(memoryEntities)
    .values(
      storedEntities.map((e) => ({
        memoryId: primaryMemoryId,
        entityId: e.entityId,
        role: 'mentioned',
      })),
    )
    .onConflictDoNothing();
}
