CREATE TABLE "organization_invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"email_sent_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"revoked_at" timestamp with time zone,
	"invited_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_invitations_accepted_check" CHECK (("organization_invitations"."accepted_at" IS NULL) = ("organization_invitations"."accepted_by" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_invitations_pending_email_key" ON "organization_invitations" USING btree ("organization_id","email") WHERE "organization_invitations"."accepted_at" IS NULL AND "organization_invitations"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_invitations_token_hash_key" ON "organization_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "organization_invitations_organization_id_created_at_idx" ON "organization_invitations" USING btree ("organization_id","created_at");