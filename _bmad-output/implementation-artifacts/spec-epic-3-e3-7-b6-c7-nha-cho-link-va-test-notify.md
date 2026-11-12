---
title: 'E3-7 (B6 + C7): PaymentLinks.expire nhả chỗ qua releaseOrderHeld; test TX1 không NOTIFY bảo vệ cả event_orders_changed'
type: 'refactor'
created: '2026-11-12'
status: 'done'
baseline_commit: 'd632ae9dc53aa0cb95b1b0a7c8f520d4c157eea3'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** (B6) `PaymentLinks.expire` (`ordering/payment-link.ts`) tự chép đoạn nhả chỗ (đọc `order_items` theo `ticket_type_id` tăng dần rồi `releaseHeld`) thay vì dùng `releaseOrderHeld` của `order-jobs.ts` như mọi đường hết hạn khác, và không test nào cho Đơn có nhiều Hạng vé. (C7) Từ Story 3.11, test "TX1 không `NOTIFY`" trong `test/ordering/order-live.test.ts` chỉ còn lọc `order_changed`, nên `NOTIFY` `event_orders_changed` lọt vào TX1 (vi phạm AD-17) không bị test nào bắt; test đếm của 3.11 cũng không bắt được trường hợp tín hiệu "Đơn mới" bị dời vào trong TX1.

**Approach:** `PaymentLinks.expire` gọi `releaseOrderHeld(tx, orderId)`, bỏ import thừa, hành vi không đổi; thêm test Đơn 2 Hạng vé đi nhánh tạm ngừng bán, kiểm `held` của cả hai Hạng vé về 0. Test TX1 bọc `realtime.notify` để ghi lại mọi lần phát tín hiệu về một Đơn và kiểm rằng lúc phát, Đơn đã commit (kết nối khác đọc thấy), áp cho cả `order_changed` lẫn `event_orders_changed`.

</frozen-after-approval>

## Implementation Notes

- B6 (`ordering/payment-link.ts`): `expire` gọi `releaseOrderHeld`. Import `asc`, `orderItems`, `releaseHeld` không còn dùng nên đã bỏ. `payment-link.ts` vốn đã import từ `order-jobs.js`, nên không tạo vòng import mới. Sau B6, `releaseHeld` chỉ còn một người gọi là `releaseOrderHeld`. Doc của `releaseOrderHeld` (`order-jobs.ts`) giờ ghi luật chung: mọi Đơn rời `pending` mà không bán đều nhả chỗ qua đây. Hàm `releaseHeld` vẫn tự sắp theo `ticket_type_id`.
- B6 test (`test/ordering/payment-link.test.ts`, `describe('tạo link khi gửi Đơn')`): Sự kiện có hai Hạng vé, 300.000đ và 500.000đ, mỗi hạng 5 suất. Đơn gồm 2 + 1 Vé (1.100.000đ). Tingee trả `1007` → `expired`, `sales_paused`, cả hai Hạng vé `{ capacity: 5, sold: 0, held: 0 }`, `expectInventoryConsistent`.
- C7 (`test/ordering/order-live.test.ts`): kiểm "Đơn đã commit lúc phát" thay cho đếm tín hiệu.
  - `recordNotifies()` dùng `vi.spyOn(realtime, 'notify')` bọc hàm gốc. Trước khi phát, nó đọc `orders` theo `ids.id` bằng một kết nối khác của `h.db.pool`, rồi ghi `{ topic, id, committed }`.
  - `expectNotifiesAfterCommit(calls, orderIds)` kiểm ba điều: không có tín hiệu về id ngoài các Đơn của test; không lần phát nào `committed: false`; mỗi Đơn có `event_orders_changed`.
  - Áp cho test TX1 (Đơn 0đ, Tingee từ chối `1006`, Đơn có link) và test `1007` (`PaymentLinks.expire`). `afterEach` gọi `vi.restoreAllMocks()`.
  - Không lặp lại thứ tự tín hiệu đã kiểm ở `test/reporting/event-overview.test.ts`.
- Kiểm bằng đột biến: dời `notifyEventOrdersChanged` vào TX1 (`orders.service.ts`) và bỏ `announceOrderCreated`. Hai test trên fail với `committed: false`, trong khi các test đếm của 3.11 không bắt được. Đã khôi phục file.

## Review Triage Log

Vòng 1 (12/11/2026). Một lớp: Blind Hunter (BH).

| # | Lớp | Phát hiện | Verdict | Bằng chứng | Route |
|---|-----|-----------|---------|------------|-------|
| 1 | BH | Tên test TX1 cũ ("Tingee từ chối → không NOTIFY") mâu thuẫn với phần kiểm mới (Đơn bị từ chối có `event_orders_changed` sau commit) | low | Tên chỉ đúng với `order_changed` | patch: đổi tên |
| 2 | BH | Bộ kiểm chỉ xét tín hiệu khóa theo id Đơn; `NOTIFY` trong TX1 khóa theo id khác sẽ lọt | low | `seen(orderId)` lọc theo id Đơn. `pg_notify` gọi thẳng, không qua `realtime.notify`, nằm ngoài quy ước AD-17 | patch: kiểm thêm không có tín hiệu về id lạ |
| 3 | BH | Test `1007` (đường `PaymentLinks.expire` mà B6 sửa) vẫn chỉ lọc `order_changed`; `event_orders_changed` của `expire` không test nào kiểm | low | `event-overview.test.ts` không có ca `expire` | patch: thêm `recordNotifies` vào test `1007` |
| 4 | BH | Danh sách thứ tự tín hiệu lặp lại `event-overview.test.ts:349-377` và lệch Implementation Notes ("ít nhất một") | low | Đúng | patch: chỉ kiểm `committed`, id lạ, có `event_orders_changed` |
| 5 | BH | Doc `releaseOrderHeld` liệt kê người gọi thiếu nhánh `no_default_payout_account` | low | `attempt()` gọi `expire(SALES_PAUSED)` khi không có tài khoản mặc định | patch: ghi luật chung thay cho danh sách |
| 6 | BH | Lý do "thứ tự khóa giống nhau ở mọi đường" gán nhầm: `releaseHeld` tự sắp; `releaseHeld` vẫn export; `releaseOrderHeld` nằm ở mô-đun job | low | `inventory.service.ts:161-168` (`byTicketTypeId`) | patch: sửa comment; defer: chuyển `releaseOrderHeld` sang `inventory.service.ts`, thôi export `releaseHeld` |
| 7 | BH | Test 2 Hạng vé không kiểm dòng DB, log, `linkCalls`, thử lại như `it.each(PAUSE_CODES)` | low | Hợp đồng đó của `expire` đã được 12 ca `PAUSE_CODES` kiểm, vẫn pass sau B6. Test mới chỉ thêm khía cạnh nhiều Hạng vé | reject |
| 8 | BH | Spec lệch code (giá Hạng vé, "ít nhất một"), thiếu `baseline_commit`; `sprint-status.yaml` vẫn ghi B6 + C7 còn lại | low | Đúng. Mục `deferred-work.md` cũ giữ nguyên theo luật append-only của workflow; việc đóng B6 + C7 ghi ở `sprint-status.yaml` | patch |

## Verification

**Commands:**
- `pnpm --filter @tickee/api exec vitest run` -- pass (63 file, 990 test).
- `pnpm typecheck && pnpm lint:deps` -- pass.
