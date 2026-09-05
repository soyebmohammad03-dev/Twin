CREATE TABLE "decision_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"previous_status" text NOT NULL,
	"new_status" text NOT NULL,
	"previous_outcome" text,
	"new_outcome" text,
	"previous_decided_at" timestamp with time zone,
	"new_decided_at" timestamp with time zone,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decision_history" ADD CONSTRAINT "decision_history_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decision_history_entity_id_changed_at_idx" ON "decision_history" USING btree ("entity_id","changed_at");
