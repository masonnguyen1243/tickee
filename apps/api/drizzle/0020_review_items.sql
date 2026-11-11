CREATE TABLE "review_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_id" uuid,
	"payment_event_id" uuid NOT NULL,
	"type" text NOT NULL,
	"reason" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_items_type_check" CHECK ("review_items"."type" IN ('amount_mismatch', 'orphan', 'event_cancelled', 'duplicate_payment', 'unmatched')),
	CONSTRAINT "review_items_order_check" CHECK (("review_items"."type" = 'unmatched') = ("review_items"."order_id" IS NULL)),
	CONSTRAINT "review_items_reason_check" CHECK (("review_items"."type" = 'orphan') = ("review_items"."reason" IS NOT NULL) AND ("review_items"."reason" IS NULL OR "review_items"."reason" IN ('event_ended', 'event_locked', 'sold_out'))),
	CONSTRAINT "review_items_status_check" CHECK ("review_items"."status" IN ('open', 'resolved')),
	CONSTRAINT "review_items_resolution_check" CHECK (("review_items"."status" = 'resolved') = ("review_items"."resolution" IS NOT NULL) AND ("review_items"."resolution" IS NULL OR "review_items"."resolution" IN ('approved', 'rejected', 'refunded', 'dismissed'))),
	CONSTRAINT "review_items_refund_only_check" CHECK ("review_items"."type" NOT IN ('event_cancelled', 'duplicate_payment', 'unmatched') OR "review_items"."resolution" IS NULL OR "review_items"."resolution" IN ('refunded', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_payment_event_id_payment_events_id_fk" FOREIGN KEY ("payment_event_id") REFERENCES "public"."payment_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_items_payment_event_id_key" ON "review_items" USING btree ("payment_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_items_open_order_type_key" ON "review_items" USING btree ("order_id","type") WHERE "review_items"."status" = 'open' AND "review_items"."type" IN ('amount_mismatch', 'orphan');--> statement-breakpoint
CREATE INDEX "review_items_organization_id_status_created_at_idx" ON "review_items" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "review_items_order_id_idx" ON "review_items" USING btree ("order_id");