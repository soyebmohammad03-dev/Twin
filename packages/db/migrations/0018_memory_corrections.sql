CREATE TABLE "memory_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"memory_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"previous_content" text NOT NULL,
	"new_content" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory_corrections" ADD CONSTRAINT "memory_corrections_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_corrections" ADD CONSTRAINT "memory_corrections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_corrections_memory_id_changed_at_idx" ON "memory_corrections" USING btree ("memory_id","changed_at");--> statement-breakpoint
CREATE INDEX "memory_corrections_user_id_idx" ON "memory_corrections" USING btree ("user_id");