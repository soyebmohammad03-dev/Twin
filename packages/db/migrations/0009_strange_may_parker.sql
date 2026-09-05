CREATE TABLE "personal_model_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fact_id" uuid,
	"snapshot_id" uuid,
	"change_type" text NOT NULL,
	"description" text NOT NULL,
	"evidence_memory_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personal_model_fact_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fact_id" uuid NOT NULL,
	"evidence_source" text NOT NULL,
	"memory_id" uuid,
	"relationship_id" uuid,
	"entity_id" uuid,
	"epistemic_status" "epistemic_status" NOT NULL,
	"confidence" numeric(3, 2) NOT NULL,
	"evidence_text" text,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_model_fact_evidence_fact_memory_unique" UNIQUE("fact_id","memory_id"),
	CONSTRAINT "personal_model_fact_evidence_confidence_range" CHECK ("personal_model_fact_evidence"."confidence" >= 0 AND "personal_model_fact_evidence"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "personal_model_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"subject_key" text NOT NULL,
	"subject_entity_id" uuid,
	"fact_text" text NOT NULL,
	"epistemic_status" "epistemic_status" NOT NULL,
	"confidence" numeric(3, 2) NOT NULL,
	"stability" text NOT NULL,
	"temporal_state" text NOT NULL,
	"first_observed_at" timestamp with time zone NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"observation_count" integer DEFAULT 1 NOT NULL,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_model_facts_user_category_subject_unique" UNIQUE("user_id","category","subject_key"),
	CONSTRAINT "personal_model_facts_confidence_range" CHECK ("personal_model_facts"."confidence" >= 0 AND "personal_model_facts"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "personal_model_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"facts_json" jsonb NOT NULL,
	"fact_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_model_snapshots_user_version_unique" UNIQUE("user_id","version")
);
--> statement-breakpoint
ALTER TABLE "personal_model_changes" ADD CONSTRAINT "personal_model_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_model_changes" ADD CONSTRAINT "personal_model_changes_fact_id_personal_model_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."personal_model_facts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_model_changes" ADD CONSTRAINT "personal_model_changes_snapshot_id_personal_model_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."personal_model_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_model_fact_evidence" ADD CONSTRAINT "personal_model_fact_evidence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_model_fact_evidence" ADD CONSTRAINT "personal_model_fact_evidence_fact_id_personal_model_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."personal_model_facts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_model_fact_evidence" ADD CONSTRAINT "personal_model_fact_evidence_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_model_fact_evidence" ADD CONSTRAINT "personal_model_fact_evidence_relationship_id_entity_relationships_id_fk" FOREIGN KEY ("relationship_id") REFERENCES "public"."entity_relationships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_model_fact_evidence" ADD CONSTRAINT "personal_model_fact_evidence_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_model_facts" ADD CONSTRAINT "personal_model_facts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_model_facts" ADD CONSTRAINT "personal_model_facts_subject_entity_id_entities_id_fk" FOREIGN KEY ("subject_entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_model_snapshots" ADD CONSTRAINT "personal_model_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "personal_model_changes_user_id_idx" ON "personal_model_changes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "personal_model_changes_fact_id_idx" ON "personal_model_changes" USING btree ("fact_id");--> statement-breakpoint
CREATE INDEX "personal_model_fact_evidence_fact_id_idx" ON "personal_model_fact_evidence" USING btree ("fact_id");--> statement-breakpoint
CREATE INDEX "personal_model_fact_evidence_memory_id_idx" ON "personal_model_fact_evidence" USING btree ("memory_id");--> statement-breakpoint
CREATE INDEX "personal_model_fact_evidence_user_id_idx" ON "personal_model_fact_evidence" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "personal_model_facts_user_id_idx" ON "personal_model_facts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "personal_model_facts_user_id_category_idx" ON "personal_model_facts" USING btree ("user_id","category");--> statement-breakpoint
CREATE INDEX "personal_model_facts_subject_entity_id_idx" ON "personal_model_facts" USING btree ("subject_entity_id");--> statement-breakpoint
CREATE INDEX "personal_model_snapshots_user_id_idx" ON "personal_model_snapshots" USING btree ("user_id");