import { relations } from 'drizzle-orm';
import { users } from './users.js';
import { sessions } from './sessions.js';
import { entities } from './entities.js';
import { people } from './people.js';
import { projects } from './projects.js';
import { goals } from './goals.js';
import { decisions } from './decisions.js';
import { events } from './events.js';
import { sources } from './sources.js';
import { memories } from './memories.js';
import { memoryEntities } from './memoryEntities.js';
import { entityRelationships, relationshipEvidence } from './entityRelationships.js';
import { ingestionJobs } from './ingestionJobs.js';

/**
 * Declarative relations for Drizzle's relational query API
 * (`db.query.memories.findMany({ with: { entityLinks: true } })`,
 * etc). These are metadata only — they don't affect migrations or the
 * actual SQL schema, just query ergonomics.
 */

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  entities: many(entities),
  sources: many(sources),
  memories: many(memories),
  entityRelationships: many(entityRelationships),
  relationshipEvidence: many(relationshipEvidence),
  ingestionJobs: many(ingestionJobs),
}));

export const entitiesRelations = relations(entities, ({ one, many }) => ({
  user: one(users, { fields: [entities.userId], references: [users.id] }),
  person: one(people, { fields: [entities.id], references: [people.entityId] }),
  project: one(projects, { fields: [entities.id], references: [projects.entityId] }),
  goal: one(goals, { fields: [entities.id], references: [goals.entityId] }),
  decision: one(decisions, { fields: [entities.id], references: [decisions.entityId] }),
  event: one(events, { fields: [entities.id], references: [events.entityId] }),
  memoryLinks: many(memoryEntities),
  relationshipsFrom: many(entityRelationships, { relationName: 'fromEntity' }),
  relationshipsTo: many(entityRelationships, { relationName: 'toEntity' }),
}));

export const peopleRelations = relations(people, ({ one }) => ({
  entity: one(entities, { fields: [people.entityId], references: [entities.id] }),
}));

export const projectsRelations = relations(projects, ({ one }) => ({
  entity: one(entities, { fields: [projects.entityId], references: [entities.id] }),
}));

export const goalsRelations = relations(goals, ({ one }) => ({
  entity: one(entities, { fields: [goals.entityId], references: [entities.id] }),
}));

export const decisionsRelations = relations(decisions, ({ one }) => ({
  entity: one(entities, { fields: [decisions.entityId], references: [entities.id] }),
}));

export const eventsRelations = relations(events, ({ one }) => ({
  entity: one(entities, { fields: [events.entityId], references: [entities.id] }),
}));

export const sourcesRelations = relations(sources, ({ one, many }) => ({
  user: one(users, { fields: [sources.userId], references: [users.id] }),
  memories: many(memories),
}));

export const memoriesRelations = relations(memories, ({ one, many }) => ({
  user: one(users, { fields: [memories.userId], references: [users.id] }),
  source: one(sources, { fields: [memories.sourceId], references: [sources.id] }),
  entityLinks: many(memoryEntities),
  relationshipEvidence: many(relationshipEvidence),
}));

export const memoryEntitiesRelations = relations(memoryEntities, ({ one }) => ({
  memory: one(memories, { fields: [memoryEntities.memoryId], references: [memories.id] }),
  entity: one(entities, { fields: [memoryEntities.entityId], references: [entities.id] }),
}));

export const entityRelationshipsRelations = relations(entityRelationships, ({ one, many }) => ({
  user: one(users, { fields: [entityRelationships.userId], references: [users.id] }),
  fromEntity: one(entities, {
    fields: [entityRelationships.fromEntityId],
    references: [entities.id],
    relationName: 'fromEntity',
  }),
  toEntity: one(entities, {
    fields: [entityRelationships.toEntityId],
    references: [entities.id],
    relationName: 'toEntity',
  }),
  sourceMemory: one(memories, { fields: [entityRelationships.sourceMemoryId], references: [memories.id] }),
  evidence: many(relationshipEvidence),
}));

export const relationshipEvidenceRelations = relations(relationshipEvidence, ({ one }) => ({
  user: one(users, { fields: [relationshipEvidence.userId], references: [users.id] }),
  relationship: one(entityRelationships, {
    fields: [relationshipEvidence.relationshipId],
    references: [entityRelationships.id],
  }),
  memory: one(memories, { fields: [relationshipEvidence.memoryId], references: [memories.id] }),
}));

export const ingestionJobsRelations = relations(ingestionJobs, ({ one }) => ({
  user: one(users, { fields: [ingestionJobs.userId], references: [users.id] }),
  resultMemory: one(memories, { fields: [ingestionJobs.resultMemoryId], references: [memories.id] }),
}));
