ALTER TABLE "review_items" DROP CONSTRAINT "review_items_refund_only_check";--> statement-breakpoint
CREATE INDEX "orders_match_candidates_idx" ON "orders" USING btree ("organization_id","total_amount") WHERE "orders"."status" IN ('expired', 'review');--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_refund_only_check" CHECK ("review_items"."type" NOT IN ('event_cancelled', 'duplicate_payment', 'unmatched') OR "review_items"."resolution" IS NULL OR "review_items"."resolution" IN ('refunded', 'dismissed') OR ("review_items"."type" = 'unmatched' AND "review_items"."resolution" = 'approved'));--> statement-breakpoint
-- Story 4.4-b: "Ghép với Đơn" gắn khoản tiền của mục `unmatched` vào Đơn (`payment_events.order_id`). `tickee_app` chỉ
-- được UPDATE cột này (`UPDATE_PROTECTED_COLUMNS`, DELETE vẫn bị thu); trigger chặn mọi lần đổi giá trị đã có và mọi lần
-- đổi cột khác, với mọi role: liên kết ghi một lần, phần còn lại của dòng vẫn bất biến.
CREATE FUNCTION "payment_events_link_order_once"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."order_id" IS NOT NULL THEN
    RAISE EXCEPTION 'payment_events.order_id đã gắn Đơn, không đổi được' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - 'order_id') IS DISTINCT FROM (to_jsonb(OLD) - 'order_id') THEN
    RAISE EXCEPTION 'payment_events chỉ được gắn order_id' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "payment_events_link_order_once" BEFORE UPDATE ON "payment_events"
  FOR EACH ROW EXECUTE FUNCTION "payment_events_link_order_once"();