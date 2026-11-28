ALTER TABLE "sheet_connections" ADD COLUMN "auth_revoked_at" timestamp with time zone;--> statement-breakpoint
-- Story 6.6: kết nối đã `auth_revoked` trước migration lấy `updated_at` (lần ghi trạng thái gần nhất) làm mốc mất quyền.
UPDATE "sheet_connections" SET "auth_revoked_at" = "updated_at" WHERE "status" = 'auth_revoked';--> statement-breakpoint
ALTER TABLE "sheet_connections" ADD CONSTRAINT "sheet_connections_auth_revoked_check" CHECK (("sheet_connections"."status" = 'auth_revoked') = ("sheet_connections"."auth_revoked_at" IS NOT NULL));
