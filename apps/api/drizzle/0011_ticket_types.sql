CREATE TABLE "ticket_types" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" bigint NOT NULL,
	"sale_starts_at" timestamp with time zone,
	"sale_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_types_price_check" CHECK ("ticket_types"."price" = 0 OR "ticket_types"."price" >= 2000),
	CONSTRAINT "ticket_types_sale_window_check" CHECK ("ticket_types"."sale_starts_at" IS NULL OR "ticket_types"."sale_ends_at" IS NULL OR "ticket_types"."sale_ends_at" > "ticket_types"."sale_starts_at")
);
--> statement-breakpoint
CREATE TABLE "ticket_type_inventory" (
	"ticket_type_id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"capacity" integer NOT NULL,
	"sold" integer DEFAULT 0 NOT NULL,
	"held" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_type_inventory_counts_check" CHECK ("ticket_type_inventory"."held" >= 0 AND "ticket_type_inventory"."sold" >= 0 AND "ticket_type_inventory"."sold" + "ticket_type_inventory"."held" <= "ticket_type_inventory"."capacity")
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "max_tickets_per_order" smallint DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_type_inventory" ADD CONSTRAINT "ticket_type_inventory_ticket_type_id_ticket_types_id_fk" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."ticket_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_type_inventory" ADD CONSTRAINT "ticket_type_inventory_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_types_event_id_created_at_idx" ON "ticket_types" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE INDEX "ticket_type_inventory_event_id_idx" ON "ticket_type_inventory" USING btree ("event_id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_max_tickets_per_order_check" CHECK ("events"."max_tickets_per_order" BETWEEN 1 AND 50);