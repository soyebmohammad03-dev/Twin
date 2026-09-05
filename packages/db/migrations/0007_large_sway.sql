CREATE TABLE "relationship_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"relationship_id" uuid NOT NULL,
	"memory_id" uuid NOT NULL,
	"epistemic_status" "epistemic_status" NOT NULL,
	"confidence" numeric(3, 2) NOT NULL,
	"extraction_method" text NOT NULL,
	"evidence_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relationship_evidence_relationship_memory_unique" UNIQUE("relationship_id","memory_id"),
	CONSTRAINT "relationship_evidence_confidence_range" CHECK ("relationship_evidence"."confidence" >= 0 AND "relationship_evidence"."confidence" <= 1)
);
--> statement-breakpoint
ALTER TABLE "entity_relationships" DROP CONSTRAINT "entity_relationships_confidence_range";--> statement-breakpoint
ALTER TABLE "entity_relationships" ALTER COLUMN "confidence" SET DEFAULT '1.00';--> statement-breakpoint
ALTER TABLE "entity_relationships" ALTER COLUMN "confidence" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "entity_relationships" ADD COLUMN "epistemic_status" "epistemic_status" DEFAULT 'inferred' NOT NULL;--> statement-breakpoint
ALTER TABLE "entity_relationships" ADD COLUMN "extraction_method" text NOT NULL;--> statement-breakpoint
ALTER TABLE "entity_relationships" ADD COLUMN "source_memory_id" uuid;--> statement-breakpoint
ALTER TABLE "relationship_evidence" ADD CONSTRAINT "relationship_evidence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_evidence" ADD CONSTRAINT "relationship_evidence_relationship_id_entity_relationships_id_fk" FOREIGN KEY ("relationship_id") REFERENCES "public"."entity_relationships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_evidence" ADD CONSTRAINT "relationship_evidence_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "relationship_evidence_relationship_id_idx" ON "relationship_evidence" USING btree ("relationship_id");--> statement-breakpoint
CREATE INDEX "relationship_evidence_memory_id_idx" ON "relationship_evidence" USING btree ("memory_id");--> statement-breakpoint
CREATE INDEX "relationship_evidence_user_id_idx" ON "relationship_evidence" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "entity_relationships" ADD CONSTRAINT "entity_relationships_source_memory_id_memories_id_fk" FOREIGN KEY ("source_memory_id") REFERENCES "public"."memories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_relationships_source_memory_id_idx" ON "entity_relationships" USING btree ("source_memory_id");--> statement-breakpoint
ALTER TABLE "entity_relationships" ADD CONSTRAINT "entity_relationships_confidence_range" CHECK ("entity_relationships"."confidence" >= 0 AND "entity_relationships"."confidence" <= 1);