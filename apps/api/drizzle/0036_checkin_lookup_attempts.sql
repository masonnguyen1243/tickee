CREATE TABLE "checkin_lookup_attempts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"ip_hmac" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "checkin_lookup_attempts_user_id_created_at_idx" ON "checkin_lookup_attempts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "checkin_lookup_attempts_ip_hmac_created_at_idx" ON "checkin_lookup_attempts" USING btree ("ip_hmac","created_at");