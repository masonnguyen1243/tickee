CREATE TABLE "google_start_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"ip_hmac" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "google_start_events_ip_hmac_created_at_idx" ON "google_start_events" USING btree ("ip_hmac","created_at");