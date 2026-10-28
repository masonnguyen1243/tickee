-- Chạy bằng tickee_migrator. Bảng do tickee_migrator tạo về sau tự cấp DML cho tickee_app.
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tickee_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" GRANT USAGE, SELECT ON SEQUENCES TO tickee_app;--> statement-breakpoint
GRANT USAGE ON SCHEMA "public" TO tickee_app;--> statement-breakpoint
CREATE TABLE "_seed_checks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
