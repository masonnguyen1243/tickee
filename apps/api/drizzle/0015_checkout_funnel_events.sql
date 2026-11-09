CREATE TABLE "checkout_funnel_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_id" uuid NOT NULL,
	"type" text NOT NULL,
	"funnel_id" uuid NOT NULL,
	"login_required" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkout_funnel_events_type_check" CHECK ("checkout_funnel_events"."type" IN ('buy_clicked', 'login_completed')),
	CONSTRAINT "checkout_funnel_events_login_required_check" CHECK (("checkout_funnel_events"."type" = 'buy_clicked') = ("checkout_funnel_events"."login_required" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "checkout_funnel_events" ADD CONSTRAINT "checkout_funnel_events_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_funnel_events_funnel_id_type_key" ON "checkout_funnel_events" USING btree ("funnel_id","type");--> statement-breakpoint
CREATE INDEX "checkout_funnel_events_event_id_created_at_idx" ON "checkout_funnel_events" USING btree ("event_id","created_at");