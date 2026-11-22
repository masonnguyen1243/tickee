CREATE TABLE "checker_invites" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checker_invites_token_hash_check" CHECK ("checker_invites"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "checker_invites" ADD CONSTRAINT "checker_invites_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checker_invites_token_hash_key" ON "checker_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "checker_invites_one_active_per_event_key" ON "checker_invites" USING btree ("event_id") WHERE "checker_invites"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "checker_invites_event_id_idx" ON "checker_invites" USING btree ("event_id");