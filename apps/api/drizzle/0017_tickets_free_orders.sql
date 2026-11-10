CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"ticket_type_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"order_ticket_count" integer NOT NULL,
	"holder_name" text NOT NULL,
	"ticket_type_name" text NOT NULL,
	"order_code" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"qr_key_version" integer NOT NULL,
	"status" text DEFAULT 'valid' NOT NULL,
	"cancel_reason" text,
	"checked_in_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_status_check" CHECK ("tickets"."status" IN ('valid', 'cancelled')),
	CONSTRAINT "tickets_seq_check" CHECK ("tickets"."seq" >= 1 AND "tickets"."seq" <= "tickets"."order_ticket_count"),
	CONSTRAINT "tickets_qr_key_version_check" CHECK ("tickets"."qr_key_version" >= 1),
	CONSTRAINT "tickets_cancel_reason_check" CHECK ("tickets"."status" = 'cancelled' OR "tickets"."cancel_reason" IS NULL),
	CONSTRAINT "tickets_order_code_check" CHECK ("tickets"."order_code" ~ '^TK[0-9A-HJKMNP-TV-Z]{8}$')
);
--> statement-breakpoint
ALTER TABLE "checkout_funnel_events" DROP CONSTRAINT "checkout_funnel_events_type_check";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "paid_amount" bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "paid_source" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_ticket_type_id_ticket_types_id_fk" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."ticket_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_order_id_seq_key" ON "tickets" USING btree ("order_id","seq");--> statement-breakpoint
CREATE INDEX "tickets_event_id_idx" ON "tickets" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "tickets_user_id_event_id_idx" ON "tickets" USING btree ("user_id","event_id");--> statement-breakpoint
CREATE INDEX "tickets_ticket_type_id_idx" ON "tickets" USING btree ("ticket_type_id");--> statement-breakpoint
ALTER TABLE "checkout_funnel_events" ADD CONSTRAINT "checkout_funnel_events_type_check" CHECK ("checkout_funnel_events"."type" IN ('buy_clicked', 'login_completed', 'order_created', 'paid'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_paid_source_check" CHECK ("orders"."paid_source" IS NULL OR "orders"."paid_source" IN ('ipn', 'reconciliation', 'manual', 'free'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_paid_check" CHECK (("orders"."paid_at" IS NULL) = ("orders"."paid_amount" IS NULL) AND ("orders"."paid_at" IS NULL) = ("orders"."paid_source" IS NULL) AND ("orders"."paid_amount" IS NULL OR "orders"."paid_amount" >= 0) AND ("orders"."status" <> 'paid' OR "orders"."paid_at" IS NOT NULL));