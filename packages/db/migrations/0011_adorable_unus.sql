CREATE TABLE "insight_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"insight_id" uuid NOT NULL,
	"evidence_type" text NOT NULL,
	"memory_id" uuid,
	"entity_id" uuid,
	"relationship_id" uuid,
	"personal_model_fact_id" uuid,
	"evidence_text" text,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "insight_evidence_insight_memory_unique" UNIQUE("insight_id","memory_id")
);
--> statement-breakpoint
CREATE TABLE "insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"insight_type" text NOT NULL,
	"subject_key" text NOT NULL,
	"status_class" text NOT NULL,
	"temporal_state" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"confidence" numeric(3, 2) NOT NULL,
	"subject_entity_id" uuid,
	"first_observed_at" timestamp with time zone NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"observation_count" integer DEFAULT 1 NOT NULL,
	"dismissed_at" timestamp with time zone,
	"superseded_by_insight_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insights_user_type_subject_unique" UNIQUE("user_id","insight_type","subject_key"),
	CONSTRAINT "insights_confidence_range" CHECK ("insights"."confidence" >= 0 AND "insights"."confidence" <= 1)
);
--> statement-breakpoint
ALTER TABLE "insight_evidence" ADD CONSTRAINT "insight_evidence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_evidence" ADD CONSTRAINT "insight_evidence_insight_id_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_evidence" ADD CONSTRAINT "insight_evidence_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_evidence" ADD CONSTRAINT "insight_evidence_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_evidence" ADD CONSTRAINT "insight_evidence_relationship_id_entity_relationships_id_fk" FOREIGN KEY ("relationship_id") REFERENCES "public"."entity_relationships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_evidence" ADD CONSTRAINT "insight_evidence_personal_model_fact_id_personal_model_facts_id_fk" FOREIGN KEY ("personal_model_fact_id") REFERENCES "public"."personal_model_facts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_subject_entity_id_entities_id_fk" FOREIGN KEY ("subject_entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_superseded_by_insight_id_insights_id_fk" FOREIGN KEY ("superseded_by_insight_id") REFERENCES "public"."insights"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "insight_evidence_insight_id_idx" ON "insight_evidence" USING btree ("insight_id");--> statement-breakpoint
CREATE INDEX "insight_evidence_memory_id_idx" ON "insight_evidence" USING btree ("memory_id");--> statement-breakpoint
CREATE INDEX "insight_evidence_user_id_idx" ON "insight_evidence" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "insights_user_id_idx" ON "insights" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "insights_user_id_insight_type_idx" ON "insights" USING btree ("user_id","insight_type");--> statement-breakpoint
CREATE INDEX "insights_subject_entity_id_idx" ON "insights" USING btree ("subject_entity_id");