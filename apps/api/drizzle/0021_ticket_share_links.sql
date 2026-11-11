ALTER TABLE "tickets" ADD COLUMN "share_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "share_token_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_share_token_hash_key" ON "tickets" USING btree ("share_token_hash");--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_share_version_check" CHECK ("tickets"."share_version" >= 1);--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_share_token_hash_check" CHECK ("tickets"."share_token_hash" ~ '^[0-9a-f]{64}$');