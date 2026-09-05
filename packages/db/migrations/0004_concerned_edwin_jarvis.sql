ALTER TABLE "memories" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "embedding_generated_at" timestamp with time zone;