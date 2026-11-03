CREATE TABLE "payout_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" text NOT NULL,
	"bank_bin" text NOT NULL,
	"account_type" text NOT NULL,
	"account_last4" text NOT NULL,
	"account_name" text NOT NULL,
	"va_account_number" text,
	"tingee_shop_id" bigint,
	"confirm_id" text,
	"failure_code" text,
	"created_by" uuid NOT NULL,
	"linked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_accounts_status_check" CHECK ("payout_accounts"."status" IN ('linking', 'awaiting_otp', 'linked', 'failed')),
	CONSTRAINT "payout_accounts_account_type_check" CHECK ("payout_accounts"."account_type" IN ('personal-account')),
	CONSTRAINT "payout_accounts_linked_check" CHECK (("payout_accounts"."status" = 'linked') = ("payout_accounts"."linked_at" IS NOT NULL AND "payout_accounts"."va_account_number" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "tingee_merchant_id" bigint;--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payout_accounts_one_linked_per_organization_key" ON "payout_accounts" USING btree ("organization_id") WHERE "payout_accounts"."status" = 'linked';--> statement-breakpoint
CREATE INDEX "payout_accounts_organization_id_created_at_idx" ON "payout_accounts" USING btree ("organization_id","created_at");