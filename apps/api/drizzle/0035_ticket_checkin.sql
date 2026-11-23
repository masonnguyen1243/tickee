ALTER TABLE "tickets" ADD COLUMN "checked_in_by" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "checkin_scan_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_checkin_check" CHECK ("tickets"."checked_in_at" IS NOT NULL OR ("tickets"."checked_in_by" IS NULL AND "tickets"."checkin_scan_id" IS NULL));