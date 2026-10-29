CREATE TABLE "otp_verify_failures" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email_hmac" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "otp_verify_failures_email_hmac_created_at_idx" ON "otp_verify_failures" USING btree ("email_hmac","created_at");