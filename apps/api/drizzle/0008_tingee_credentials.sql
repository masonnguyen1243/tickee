CREATE TABLE "payout_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tingee_credential_id" uuid NOT NULL,
	"va_account_number" text NOT NULL,
	"bank_bin" text NOT NULL,
	"bank_name" text NOT NULL,
	"account_type" text NOT NULL,
	"account_last4" text NOT NULL,
	"account_name" text NOT NULL,
	"tingee_shop_id" bigint,
	"created_by" uuid NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tingee_credentials" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"secret_token_ciphertext" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "tingee_credentials_secret_token_ciphertext_check" CHECK ("tingee_credentials"."secret_token_ciphertext" ~ '^v[1-9][0-9]*:')
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "tingee_ipn_key" text;--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_tingee_credential_id_tingee_credentials_id_fk" FOREIGN KEY ("tingee_credential_id") REFERENCES "public"."tingee_credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tingee_credentials" ADD CONSTRAINT "tingee_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tingee_credentials" ADD CONSTRAINT "tingee_credentials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payout_accounts_one_current_per_organization_key" ON "payout_accounts" USING btree ("organization_id") WHERE "payout_accounts"."retired_at" IS NULL;--> statement-breakpoint
CREATE INDEX "payout_accounts_organization_id_linked_at_idx" ON "payout_accounts" USING btree ("organization_id","linked_at");--> statement-breakpoint
CREATE INDEX "payout_accounts_tingee_credential_id_idx" ON "payout_accounts" USING btree ("tingee_credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tingee_credentials_one_current_per_organization_key" ON "tingee_credentials" USING btree ("organization_id") WHERE "tingee_credentials"."retired_at" IS NULL;--> statement-breakpoint
CREATE INDEX "tingee_credentials_organization_id_created_at_idx" ON "tingee_credentials" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_tingee_ipn_key_key" ON "organizations" USING btree ("tingee_ipn_key");