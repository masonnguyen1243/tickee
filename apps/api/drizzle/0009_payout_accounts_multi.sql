DROP INDEX "payout_accounts_one_current_per_organization_key";--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Viết tay: tài khoản hiện hành có sẵn (trước đây tối đa một mỗi BTC) thành mặc định, giữ luật "còn tài khoản thì có đúng một mặc định".
UPDATE "payout_accounts" SET "is_default" = true WHERE "retired_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payout_accounts_current_va_per_organization_key" ON "payout_accounts" USING btree ("organization_id","va_account_number") WHERE "payout_accounts"."retired_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payout_accounts_one_default_per_organization_key" ON "payout_accounts" USING btree ("organization_id") WHERE "payout_accounts"."is_default" AND "payout_accounts"."retired_at" IS NULL;
