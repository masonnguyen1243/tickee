CREATE TABLE "order_answers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"answer" text NOT NULL,
	"option_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_answers_kind_check" CHECK ("order_answers"."kind" IN ('text', 'choice')),
	CONSTRAINT "order_answers_option_check" CHECK (("order_answers"."kind" = 'choice') = ("order_answers"."option_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "order_create_attempts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"ip_hmac" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"ticket_type_id" uuid NOT NULL,
	"ticket_type_name" text NOT NULL,
	"unit_price" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_quantity_check" CHECK ("order_items"."quantity" > 0),
	CONSTRAINT "order_items_unit_price_check" CHECK ("order_items"."unit_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_amount" bigint NOT NULL,
	"buyer_name" text NOT NULL,
	"buyer_phone" text NOT NULL,
	"buyer_email" text NOT NULL,
	"refund_policy" text,
	"idempotency_key" uuid NOT NULL,
	"funnel_id" uuid,
	"payment_link" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_status_check" CHECK ("orders"."status" IN ('pending', 'paid', 'expired', 'review', 'cancelled', 'refunded')),
	CONSTRAINT "orders_code_check" CHECK ("orders"."code" ~ '^TK[0-9A-HJKMNP-TV-Z]{8}$'),
	CONSTRAINT "orders_total_amount_check" CHECK ("orders"."total_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "checkout_funnel_events" DROP CONSTRAINT "checkout_funnel_events_type_check";--> statement-breakpoint
ALTER TABLE "order_answers" ADD CONSTRAINT "order_answers_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_ticket_type_id_ticket_types_id_fk" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."ticket_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_answers_order_id_question_id_key" ON "order_answers" USING btree ("order_id","question_id");--> statement-breakpoint
CREATE INDEX "order_create_attempts_user_id_created_at_idx" ON "order_create_attempts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "order_create_attempts_ip_hmac_created_at_idx" ON "order_create_attempts" USING btree ("ip_hmac","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_order_id_ticket_type_id_key" ON "order_items" USING btree ("order_id","ticket_type_id");--> statement-breakpoint
CREATE INDEX "order_items_ticket_type_id_idx" ON "order_items" USING btree ("ticket_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_code_key" ON "orders" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_user_id_idempotency_key_key" ON "orders" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_one_pending_per_buyer_event_key" ON "orders" USING btree ("user_id","event_id") WHERE "orders"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "orders_user_id_created_at_idx" ON "orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_event_id_created_at_idx" ON "orders" USING btree ("event_id","created_at");--> statement-breakpoint
ALTER TABLE "checkout_funnel_events" ADD CONSTRAINT "checkout_funnel_events_type_check" CHECK ("checkout_funnel_events"."type" IN ('buy_clicked', 'login_completed', 'order_created'));