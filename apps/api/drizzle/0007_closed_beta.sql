ALTER TABLE "users" ADD COLUMN "platform_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "closed_beta_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "closed_beta_changed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "organizations_closed_beta_status_created_at_idx" ON "organizations" USING btree ("closed_beta_status","created_at");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_closed_beta_status_check" CHECK ("organizations"."closed_beta_status" IN ('pending', 'approved', 'revoked'));