CREATE TABLE "sheet_connections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"granted_by_user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"spreadsheet_id" text,
	"spreadsheet_url" text,
	"refresh_token" text NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sheet_connections_status_check" CHECK ("sheet_connections"."status" IN ('active', 'syncing', 'retrying', 'auth_revoked')),
	CONSTRAINT "sheet_connections_refresh_token_check" CHECK ("sheet_connections"."refresh_token" ~ '^v[1-9][0-9]*:'),
	CONSTRAINT "sheet_connections_spreadsheet_check" CHECK (("sheet_connections"."spreadsheet_id" IS NULL) = ("sheet_connections"."spreadsheet_url" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "sheet_oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"state_hash" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"code_verifier" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sheet_oauth_states_state_hash_check" CHECK ("sheet_oauth_states"."state_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "sheet_oauth_states_code_verifier_check" CHECK ("sheet_oauth_states"."code_verifier" ~ '^v[1-9][0-9]*:')
);
--> statement-breakpoint
ALTER TABLE "sheet_connections" ADD CONSTRAINT "sheet_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_connections" ADD CONSTRAINT "sheet_connections_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_connections" ADD CONSTRAINT "sheet_connections_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_oauth_states" ADD CONSTRAINT "sheet_oauth_states_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_oauth_states" ADD CONSTRAINT "sheet_oauth_states_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_oauth_states" ADD CONSTRAINT "sheet_oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_connections_event_id_key" ON "sheet_connections" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "sheet_connections_organization_id_idx" ON "sheet_connections" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_oauth_states_state_hash_key" ON "sheet_oauth_states" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "sheet_oauth_states_user_id_idx" ON "sheet_oauth_states" USING btree ("user_id");