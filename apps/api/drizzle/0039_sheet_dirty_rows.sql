CREATE TABLE "sheet_dirty_rows" (
	"connection_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sheet_dirty_rows_connection_id_order_id_pk" PRIMARY KEY("connection_id","order_id"),
	CONSTRAINT "sheet_dirty_rows_version_check" CHECK ("sheet_dirty_rows"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "sheet_connections" ADD COLUMN "sheet_tab_id" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "checkin_method" text;--> statement-breakpoint
ALTER TABLE "sheet_dirty_rows" ADD CONSTRAINT "sheet_dirty_rows_connection_id_sheet_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."sheet_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sheet_dirty_rows_connection_id_marked_at_idx" ON "sheet_dirty_rows" USING btree ("connection_id","marked_at");--> statement-breakpoint
ALTER TABLE "sheet_connections" ADD CONSTRAINT "sheet_connections_sheet_tab_id_check" CHECK ("sheet_connections"."sheet_tab_id" >= 0);--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_checkin_method_check" CHECK ("tickets"."checkin_method" IS NULL OR ("tickets"."checked_in_at" IS NOT NULL AND "tickets"."checkin_method" IN ('scan', 'manual')));