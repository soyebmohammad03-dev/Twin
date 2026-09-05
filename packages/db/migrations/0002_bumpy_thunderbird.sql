CREATE TYPE "public"."ingestion_input_type" AS ENUM('text', 'image', 'document', 'voice_transcript', 'web_link');--> statement-breakpoint
CREATE TYPE "public"."ingestion_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "ingestion_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"input_type" "ingestion_input_type" NOT NULL,
	"status" "ingestion_status" DEFAULT 'pending' NOT NULL,
	"status_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_input" jsonb NOT NULL,
	"extraction_provider" text NOT NULL,
	"is_duplicate" boolean DEFAULT false NOT NULL,
	"result_memory_id" uuid,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_result_memory_id_memories_id_fk" FOREIGN KEY ("result_memory_id") REFERENCES "public"."memories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingestion_jobs_user_id_idx" ON "ingestion_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ingestion_jobs_user_id_status_idx" ON "ingestion_jobs" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "memories_user_id_content_hash_idx" ON "memories" USING btree ("user_id","content_hash");