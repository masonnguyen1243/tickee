CREATE TABLE "event_image_presigns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_image_presigns" ADD CONSTRAINT "event_image_presigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_image_presigns_organization_id_created_at_idx" ON "event_image_presigns" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "event_image_presigns_user_id_created_at_idx" ON "event_image_presigns" USING btree ("user_id","created_at");