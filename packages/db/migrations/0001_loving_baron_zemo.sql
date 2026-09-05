CREATE TYPE "public"."entity_type" AS ENUM('person', 'project', 'goal', 'decision', 'idea', 'event');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('manual', 'voice_note', 'document', 'image', 'screen_capture', 'conversation', 'web_link', 'system_synthesis');--> statement-breakpoint
CREATE TYPE "public"."epistemic_status" AS ENUM('explicit', 'from_source', 'reported_by_other', 'inferred', 'probable');--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"entity_id" uuid PRIMARY KEY NOT NULL,
	"role" text,
	"relationship" text,
	"contact_info" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"entity_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"entity_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"target_date" timestamp with time zone,
	"achieved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"entity_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"outcome" text,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"entity_id" uuid PRIMARY KEY NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"location" text
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_type" "source_type" NOT NULL,
	"title" text,
	"raw_content" text,
	"url" text,
	"captured_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"memory_type" text DEFAULT 'note' NOT NULL,
	"content" text NOT NULL,
	"epistemic_status" "epistemic_status" DEFAULT 'explicit' NOT NULL,
	"confidence" numeric(3, 2) DEFAULT '1.00' NOT NULL,
	"importance" smallint DEFAULT 3 NOT NULL,
	"occurred_at" timestamp with time zone,
	"embedding" vector(1536),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memories_confidence_range" CHECK ("memories"."confidence" >= 0 AND "memories"."confidence" <= 1),
	CONSTRAINT "memories_importance_range" CHECK ("memories"."importance" >= 1 AND "memories"."importance" <= 5)
);
--> statement-breakpoint
CREATE TABLE "memory_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"memory_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"role" text DEFAULT 'related' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_entities_memory_entity_role_unique" UNIQUE("memory_id","entity_id","role")
);
--> statement-breakpoint
CREATE TABLE "entity_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"from_entity_id" uuid NOT NULL,
	"to_entity_id" uuid NOT NULL,
	"relationship_type" text NOT NULL,
	"confidence" numeric(3, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_relationships_from_to_type_unique" UNIQUE("from_entity_id","to_entity_id","relationship_type"),
	CONSTRAINT "entity_relationships_no_self_loop" CHECK ("entity_relationships"."from_entity_id" <> "entity_relationships"."to_entity_id"),
	CONSTRAINT "entity_relationships_confidence_range" CHECK ("entity_relationships"."confidence" IS NULL OR ("entity_relationships"."confidence" >= 0 AND "entity_relationships"."confidence" <= 1))
);
--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_entities" ADD CONSTRAINT "memory_entities_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_entities" ADD CONSTRAINT "memory_entities_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_relationships" ADD CONSTRAINT "entity_relationships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_relationships" ADD CONSTRAINT "entity_relationships_from_entity_id_entities_id_fk" FOREIGN KEY ("from_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_relationships" ADD CONSTRAINT "entity_relationships_to_entity_id_entities_id_fk" FOREIGN KEY ("to_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entities_user_id_idx" ON "entities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "entities_user_id_entity_type_idx" ON "entities" USING btree ("user_id","entity_type");--> statement-breakpoint
CREATE INDEX "sources_user_id_idx" ON "sources" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sources_user_id_source_type_idx" ON "sources" USING btree ("user_id","source_type");--> statement-breakpoint
CREATE INDEX "memories_user_id_idx" ON "memories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memories_source_id_idx" ON "memories" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "memories_user_id_occurred_at_idx" ON "memories" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "memories_user_id_memory_type_idx" ON "memories" USING btree ("user_id","memory_type");--> statement-breakpoint
CREATE INDEX "memories_deleted_at_idx" ON "memories" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "memory_entities_entity_id_idx" ON "memory_entities" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "entity_relationships_user_id_idx" ON "entity_relationships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "entity_relationships_to_entity_id_idx" ON "entity_relationships" USING btree ("to_entity_id");