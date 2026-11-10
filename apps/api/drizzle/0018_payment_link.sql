ALTER TABLE "orders" ADD COLUMN "payout_account_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_link_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_link_error" text;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_payout_account_id_payout_accounts_id_fk" FOREIGN KEY ("payout_account_id") REFERENCES "public"."payout_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_payment_link_error_check" CHECK ("orders"."payment_link_error" IS NULL OR "orders"."payment_link_error" IN ('provider_error', 'sales_paused', 'timeout'));