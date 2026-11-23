CREATE TABLE "checkers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkers_status_check" CHECK ("checkers"."status" IN ('active', 'revoked'))
);
--> statement-breakpoint
ALTER TABLE "checkers" ADD CONSTRAINT "checkers_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkers_event_id_user_id_key" ON "checkers" USING btree ("event_id","user_id");