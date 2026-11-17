CREATE TABLE "ops_alert_marks" (
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ops_alert_marks_kind_subject_pk" PRIMARY KEY("kind","subject")
);
--> statement-breakpoint
CREATE INDEX "ops_alert_marks_raised_at_idx" ON "ops_alert_marks" USING btree ("raised_at");