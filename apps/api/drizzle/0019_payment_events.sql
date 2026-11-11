CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_id" uuid,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"provider_order_id" text NOT NULL,
	"provider_transaction_code" text,
	"amount" bigint,
	"paid_amount" bigint,
	"paid_at" timestamp with time zone,
	"status_code" text,
	"payment_method" text,
	"bill_id" text,
	"merchant_id" text,
	"request_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_events_kind_check" CHECK ("payment_events"."kind" IN ('payment', 'status')),
	CONSTRAINT "payment_events_kind_status_check" CHECK (("payment_events"."kind" = 'payment') = ("payment_events"."status" = 'success')),
	CONSTRAINT "payment_events_transaction_code_check" CHECK ("payment_events"."kind" <> 'payment' OR "payment_events"."provider_transaction_code" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_payment_transaction_key" ON "payment_events" USING btree ("organization_id","provider_transaction_code") WHERE "payment_events"."kind" = 'payment';--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_status_order_key" ON "payment_events" USING btree ("organization_id","provider_order_id","status") WHERE "payment_events"."kind" = 'status';--> statement-breakpoint
CREATE INDEX "payment_events_order_id_idx" ON "payment_events" USING btree ("order_id");