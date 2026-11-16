ALTER TABLE "orders" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "review_items" ADD COLUMN "dismiss_reason" text;--> statement-breakpoint
-- Story 4.4: trước migration này không đường nào của ứng dụng ghi Đơn `cancelled`/`refunded` hay mục `dismissed`; dòng
-- như vậy chỉ có thể do SQL tay (DB dev/test). Điền lý do để CHECK mới không vỡ trên các dòng đó.
UPDATE "orders" SET "cancel_reason" = CASE
    WHEN EXISTS (SELECT 1 FROM "events" e WHERE e."id" = "orders"."event_id" AND e."status" = 'cancelled') THEN 'event_cancelled'
    ELSE 'rejected'
  END
  WHERE "status" IN ('cancelled', 'refunded') AND "cancel_reason" IS NULL;--> statement-breakpoint
UPDATE "review_items" SET "dismiss_reason" = 'Bỏ qua trước Story 4.4'
  WHERE "resolution" = 'dismissed' AND "dismiss_reason" IS NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancel_reason_check" CHECK (("orders"."status" IN ('cancelled', 'refunded')) = ("orders"."cancel_reason" IS NOT NULL) AND ("orders"."cancel_reason" IS NULL OR "orders"."cancel_reason" IN ('rejected', 'event_cancelled')));--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_dismiss_reason_check" CHECK (("review_items"."resolution" IS NOT DISTINCT FROM 'dismissed') = ("review_items"."dismiss_reason" IS NOT NULL) AND ("review_items"."dismiss_reason" IS NULL OR char_length("review_items"."dismiss_reason") BETWEEN 1 AND 300));
