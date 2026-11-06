CREATE TABLE "event_form_questions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_form_questions_kind_check" CHECK ("event_form_questions"."kind" IN ('text', 'choice')),
	CONSTRAINT "event_form_questions_position_check" CHECK ("event_form_questions"."position" >= 0),
	CONSTRAINT "event_form_questions_options_check" CHECK (jsonb_typeof("event_form_questions"."options") = 'array')
);
--> statement-breakpoint
ALTER TABLE "event_form_questions" ADD CONSTRAINT "event_form_questions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_form_questions" ADD CONSTRAINT "event_form_questions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_form_questions_event_id_position_idx" ON "event_form_questions" USING btree ("event_id","position");