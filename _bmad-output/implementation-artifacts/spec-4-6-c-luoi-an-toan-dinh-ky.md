---
title: 'Story 4.6-c: Lưới an toàn định kỳ'
type: 'feature'
created: '2026-11-17'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '56c731a462275edbef1ad4f05430e0690183e1c9'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Job hoãn `ordering.expire-order` bỏ sót một Đơn (không được enqueue, hoặc lỗi) thì Đơn đó giữ chỗ mãi, Hạng vé có thể báo hết dù còn suất. Tồn kho `held`/`sold` lệch khỏi Đơn và Vé thực tế thì không ai biết (AD-2). Bảng `order_create_attempts` phình mãi vì không có gì dọn.

**Approach:** Thêm hai cron ở worker, do `ordering` sở hữu: (1) mỗi phút, cho hết hạn các Đơn `pending` đã quá hạn mà job hoãn bỏ sót, bằng chính `expireOrder`, rồi dọn bộ đếm tạo Đơn cũ; (2) mỗi 10 phút, đối chiếu tồn kho và báo lệch qua kênh `platform/alerts`, không tự sửa.

## Boundaries & Constraints

**Always:**
- **Quét Đơn quá hạn** (`ordering.safety-sweep`, `* * * * *`, `retryLimit: 0`, không dead-letter, theo mẫu `organizer/token-alert-jobs.ts`):
  - Chọn Đơn `pending` đã quá hạn thêm 120 giây: chưa có link thì quá `expires_at`; có link thì quá `expires_at + PAYMENT_LINK_GRACE_SECONDS`. Sắp theo `expires_at`, tối đa 200 Đơn mỗi lượt.
  - Mỗi Đơn gọi `expireOrder(db, id, 'hold' | 'link')`, mỗi Đơn một transaction. Một Đơn lỗi thì log `warn` rồi xử lý Đơn tiếp theo.
  - Mỗi Đơn thực sự chuyển `expired` thì log `warn` kèm mã Đơn và loại.
  - **Báo vận hành** (Mason chốt 17/11/2026, phương án (a)): lượt quét nào có Đơn thực sự chuyển `expired` thì gọi một `raise` loại mới `pending_order_overdue` (dedupe `once` theo mã Đơn), subjects là các mã Đơn đó, details `{ orders: n }`. Luật (4) `pending_order_overdue` của 4.6-e bị bỏ, vì lưới an toàn đã báo thay.
  - Điều kiện quá hạn dùng chung một hàm với `expireStalePending` (`orders.service.ts`), khác nhau ở số giây ân hạn thêm.
  - Cùng lượt: xóa dòng `order_create_attempts` cũ hơn `ORDER_RATE_LIMITS.windowSeconds`.
- **Đối chiếu tồn kho** (`ordering.inventory-check`, `*/10 * * * *`, cùng quy ước cron):
  - Đọc trong một transaction `REPEATABLE READ READ ONLY`: mọi dòng `ticket_type_inventory`, tổng `order_items.quantity` của Đơn `pending` theo Hạng vé, và số Vé đã phát theo Hạng vé.
  - Số Vé đã phát đếm **mọi** Vé, không lọc `status` (AD-2: `paid` → `cancelled` không trả chỗ). `ordering` lấy số này qua hàm đọc mới xuất từ `ticketing/index.ts`, không đọc bảng `tickets` trực tiếp.
  - Lệch khi `held` ≠ tổng `pending`, hoặc `sold` ≠ số Vé đã phát. Mỗi Hạng vé lệch log `error` kèm `ticketTypeId`, `eventId` và bốn con số.
  - Mọi Hạng vé lệch đi chung một `raise` loại mới `inventory_drift` (dedupe `once`), subject `<ticketTypeId>:held=<held>/<pending>:sold=<sold>/<issued>`. Số liệu đổi thì báo lại; giữ nguyên thì không.
- Partial index `orders (expires_at) WHERE status = 'pending'` (migration `0029`), sinh bằng drizzle-kit.

**Never:**
- Không bao giờ UPDATE `ticket_type_inventory` khi lệch. Không gọi Tingee.
- Không đổi `expireOrder`, `markExpired`, job hoãn hay Đối soát bù.
- Không làm dead-letter ở `/admin` (4.6-d), luật IPN/p95/tỉ lệ phát Vé (4.6-e), hay cảnh báo giữ chỗ hàng loạt.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Job bỏ sót, chưa link | `pending`, không link, `expires_at` = now − 3 phút | Lượt quét: `expired`, `held` giảm n, có `order_changed`, log `warn`, một email `pending_order_overdue` nêu mã Đơn; lượt sau không gửi lại | N/A |
| Vừa quá hạn | Không link, `expires_at` = now − 30 giây | Không đụng (để job hoãn) | N/A |
| Có link, trong ân hạn | Có link, `expires_at` = now − 6 phút | Không đụng | N/A |
| Có link, quá ân hạn | Có link, `expires_at` = now − 8 phút | `expired` | N/A |
| Đua với IPN | IPN `paid` và lượt quét cùng lúc | Chỉ một bên thắng (CAS), chỗ nhả hoặc bán đúng một lần | N/A |
| Một Đơn lỗi | `expireOrder` ném với Đơn A | Đơn B vẫn hết hạn | log `warn` |
| Tồn kho khớp | Có Vé `cancelled`, Đơn `refunded` | Không báo | N/A |
| `held` lệch | `held` = 3, Đơn `pending` tổng 2 | Một email nêu `…:held=3/2:sold=…`; lượt sau cùng số liệu không gửi | N/A |
| Bộ đếm cũ | Dòng 11 phút trước và 5 phút trước | Xóa dòng 11 phút, giữ dòng 5 phút | N/A |

</frozen-after-approval>

## Code Map

Đường dẫn dưới `apps/api/` trừ khi ghi khác.

- **Hết hạn Đơn:**
  - `src/modules/ordering/order-jobs.ts`: `expireOrder` (:110-143) idempotent, an toàn với id bất kỳ; trả `expired` | `skipped` | `not_yet`. `deadlineOf` và `linkConditionOf` (:90-97). `OrderingJobsModule` (:213) là nơi lắp provider worker.
  - `orders.service.ts:239-258` (`expireStalePending`): điều kiện quá hạn hiện viết tay. Tách thành hàm dùng chung.
  - `PAYMENT_LINK_GRACE_SECONDS` = 300 (`packages/contracts/src/order.ts:42`). `ORDER_RATE_LIMITS.windowSeconds` = 600 (:460).
  - Đối soát bù chỉ cho hết hạn khi Tingee xác nhận (`payment/ipn-processor.ts:337-342`). Mọi đường đều compare-and-set trên `pending`.
- **Tồn kho:**
  - `ticket_type_inventory`: `ordering/schema.ts:14-38`. `order_items(order_id, ticket_type_id, quantity)`: :180-201. `order_create_attempts`: :230-246.
  - SQL bất biến mẫu, dùng lại được: `test/payment/ipn-fixtures.ts:102-130` (`expectInvariants`).
  - `tickets`: `ticketing/schema.ts:25-69`, có index `ticket_type_id`. `ticketing/index.ts` chưa xuất hàm đếm.
  - Mẫu transaction `REPEATABLE READ` chỉ đọc: `ordering/my-tickets.service.ts:32`.
- **Cron và cảnh báo:**
  - Mẫu cron: `organizer/token-alert-jobs.ts:138-173`: `defineQueue({ options: { retryLimit: 0 }, work: { batchSize: 1, perJobResults: true }, payload: z.unknown() })`, `registerQueueWorker` rồi `boss.schedule`.
  - Tên queue: `packages/contracts/src/jobs.ts`, có doc comment như các cron hiện có.
  - `OpsAlerts.raise` (`platform/alerts/ops-alerts.ts:80-117`) không bao giờ ném. Thêm loại vào `platform/alerts/kinds.ts` (`OpsAlertKind` và `OPS_ALERT_KINDS`). Module import qua `platform/alerts/index.js`, như `payment/reconciliation-worker.ts:4`.
  - Worker kết nối bằng `tickee_app`, có SELECT mọi bảng và DELETE trên `order_create_attempts` (`platform/db/grants.ts`). Không có RLS.
- **Test:**
  - DB thật, dùng chung, không truncate: assert theo id của chính test.
  - Harness api không có worker, nên mọi Đơn `pending` mà test khác để lại đều đã quá hạn, và tồn kho do test ghi tay có thể lệch sẵn. Hàm quét nhận `limit` (mặc định 200) để test xả hết Đơn tồn. Test đối chiếu chỉ xét subject của Hạng vé mình tạo.
  - Lùi mốc bằng `UPDATE orders SET expires_at = now() - interval …`; giả link bằng `payment_link` đặt tay (`test/ordering/order-expiry.test.ts:89-106`).
  - Mẫu bắt cảnh báo: `test/platform/ops-alerts.test.ts:88-131`. Mẫu `getSchedules()`: `test/organizer/payment-service.test.ts:1398`.
  - Chỉ `platform/db/clock.ts` được viết `SELECT now()`; `now()` trong `WHERE` thì được.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/jobs.ts`: thêm `ordering.safety-sweep` và `ordering.inventory-check`.
- [x] `apps/api/src/modules/ordering/order-jobs.ts`, `orders.service.ts`: tách điều kiện quá hạn (có tham số giây ân hạn thêm) dùng chung.
- [x] `apps/api/src/modules/ordering/safety-net-jobs.ts` (mới): hai cron, gồm hàm quét, dọn và đối chiếu gọi trực tiếp được trong test. Lắp vào `OrderingJobsModule`.
- [x] `apps/api/src/modules/ticketing/*` và `index.ts`: hàm đếm Vé đã phát theo Hạng vé, nhận `tx`.
- [x] `apps/api/src/platform/alerts/kinds.ts`: loại `inventory_drift` và `pending_order_overdue`.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md`: thêm mục mới (không sửa mục cũ) ghi rằng 4.6-e bỏ luật (4) `pending_order_overdue` và partial index `orders (expires_at)` vì 4.6-c đã làm.
- [x] `apps/api/src/modules/ordering/schema.ts` và `apps/api/drizzle/0029_*.sql`: partial index.
- [x] `apps/api/test/ordering/safety-net.test.ts` (mới): mỗi dòng của I/O Matrix.

**Acceptance Criteria:**
- Given worker khởi động, then `getSchedules()` có `ordering.safety-sweep` (mỗi phút) và `ordering.inventory-check` (mỗi 10 phút).
- Given `pnpm turbo lint:deps`, then sạch. Nếu `ordering` đọc thẳng bảng `tickets` thì lệnh này phải báo lỗi.
- Given toàn bộ test hiện có, when chạy cùng hai cron mới trong worker, then pass.

## Implementation Notes

- `story_key`: `4-6-giám-sát-và-lưới-an-toàn-vận-hành`. 4.6-c xong thì story vẫn chưa xong (còn 4.6-d/e): giữ story ở `in-progress`, không đặt `done`.
- Nhánh `feat/4-6-c-luoi-an-toan-dinh-ky`, cắt từ `main` (`56c731a462275edbef1ad4f05430e0690183e1c9`).
- Lệch so với Code Map: `OrderingJobsModule` chuyển từ `order-jobs.ts` sang file mới `ordering/ordering-jobs.module.ts`, vì `safety-net-jobs.ts` import `expireOrder` từ `order-jobs.ts`, để nguyên chỗ cũ thì tạo vòng import mà `lint:deps` chặn. `ordering/index.ts` xuất lại nên không nơi nào bên ngoài phải đổi.
- Lựa chọn spec chưa chốt: log của lượt quét kèm thêm `organizationId`; details của `inventory_drift` là số Hạng vé đang lệch.

## Spec Change Log

## Review Triage Log

Lượt 1 (17/11/2026). BH = blind-hunter, ECH = edge-case-hunter, VG = verification-gap.

| # | Nguồn | Phát hiện | Verdict | Route | Bằng chứng |
|---|-------|-----------|---------|-------|------------|
| 1 | BH, ECH | Lượt quét và email `pending_order_overdue` khẳng định job "bỏ sót", trong khi Đơn có thể chỉ đang chờ job retry (5→10→20→40→80 giây) hoặc worker ngừng quá 120 giây | low | patch | `EXPIRE_ORDER_QUEUE` có `retryLimit: 10`, `retryDelay: 5`, backoff (`order-jobs.ts:42-48`). Khi đó email vẫn đúng (Đơn quá hạn chưa được xử lý), nhưng nguyên nhân nêu ra thì sai. Sửa trực tiếp nội dung: tiêu đề, summary, log. |
| 2 | BH | Details `{ ticketTypes: n }` của `inventory_drift` đếm mọi Hạng vé đang lệch, còn email ghi "N mục mới" cho subject mới, nên hai con số trông mâu thuẫn | low | patch | `ops-alert-email.ts:15-25` in `key: value` của details, và tiêu đề danh sách `${count} mục mới`. Đổi tên khóa cho rõ nghĩa và ghim giá trị trong test. |
| 3 | BH, VG | `limit` và thứ tự `expires_at` tăng dần của lượt quét chưa được test nào chạy | medium | patch | Gap VG đã kiểm: chỉ assert hằng `SAFETY_SWEEP_LIMIT`; mọi lần gọi dùng `DRAIN`. Bỏ `.limit` hay đảo `asc` thì test vẫn pass. |
| 4 | VG | Test "cùng số liệu không gửi lại" của `inventory_drift` vẫn pass nếu dedupe đổi thành `cooldown` | medium | patch | Gap VG đã kiểm: lần check thứ hai dùng cùng instance `OpsAlerts`, nên bộ nhớ "vừa raise" lọc mất subject ở cả hai kiểu dedupe. |
| 5 | BH | Test "đua với IPN" không bảo đảm nhánh lưới thắng trước (Đơn `expired` rồi tiền về muộn bán lại) có chạy | low | patch | Lượt quét xả cả DB dùng chung trước khi chạm Đơn của test, nên IPN gần như luôn thắng; assert chấp nhận `undefined`. Thêm hai ca có thứ tự cố định. |
| 6 | VG | Snapshot `REPEATABLE READ` (chống báo lệch giả khi có ghi xen giữa các câu đọc) chưa có test | medium | defer | Gap VG đã kiểm: bỏ `CHECK_TRANSACTION` hoặc truyền `db` thay `tx` thì test vẫn pass. Không có điểm chèn để ép commit vào giữa các câu đọc; test tải song song thì sẽ chập chờn. Ghi vào deferred-work. |
| 7 | BH, ECH | Subject `inventory_drift` mang số tuyệt đối, nên Hạng vé lệch mà vẫn đang bán thì mỗi lượt 10 phút ra subject mới và gửi email mới | low | reject | Đúng như khối frozen ("Số liệu đổi thì báo lại"). Chỉ xảy ra khi đã có lệch, tức có bug, và Hạng vé còn đang bán. Đổi sang subject theo độ lệch thì phải sửa intent, thêm cơ chế xóa dấu khi hết lệch (xem #8), tức nhiều hơn một sửa trực tiếp. Câu "không gửi lặp mỗi 30 phút" ở Design Notes chỉ đúng khi số liệu đứng yên. Đã nêu trong báo cáo Build. |
| 8 | ECH | Sửa tay hết lệch, rồi lệch lại với đúng bốn con số cũ trong 30 ngày thì không có email (dấu `once` còn) | low | reject | Cần lặp lại đúng cả bốn số tuyệt đối, gần như không xảy ra. Sửa phải thêm đường xóa dấu từ `ordering` sang `platform/alerts` (bề mặt mới). |
| 9 | BH, ECH | Đơn lỗi mãi không có cảnh báo, chỉ `warn`; từ 200 Đơn lỗi trở lên thì chặn các Đơn mới hơn | low | reject | Nguyên nhân lỗi thực tế là tồn kho lệch (vi phạm CHECK `held >= 0`), mà `inventory_drift` đã báo. 200 Đơn lỗi cùng lúc thì gần như chắc là DB hỏng. Sửa phải thêm loại cảnh báo và logic bỏ qua id. |
| 10 | BH | Job hết hạn hỏng hẳn thì mỗi phút một email `pending_order_overdue`, không giới hạn theo loại | low | reject | Chỉ khi job hỏng hẳn; lúc đó `queue_backlog` và `dead_letter` cũng báo. Giới hạn theo loại là thiết kế mới, giống #14 của 4.6-b. |
| 11 | BH | Hai cron mới `retryLimit: 0`, không dead-letter: lỗi mãi thì không ai biết | low | reject | Mục deferred-work của 4.6-b (luật báo job `failed` ở queue có `dead_letter IS NULL`) sẽ phủ cả hai queue này mà không cần liệt kê. Lượt kế chạy lại. |
| 12 | BH, ECH | Lệnh xóa `order_create_attempts` không chia lô, quét cả bảng; bỏ qua nếu lượt quét ném lỗi | low | reject | Bảng chỉ giữ 10 phút dữ liệu, và chưa có production (4.7) nên lần chạy đầu cũng nhỏ. Lượt quét chỉ ném khi câu SELECT lỗi, tức DB đang lỗi, nên DELETE cũng lỗi. |
| 13 | BH | Test worker không `unschedule`, nên lịch còn lại trong DB test dùng chung | false | reject | Mọi lần dựng `WorkerModule` đều `boss.schedule` lại hai lịch này trong `onApplicationBootstrap` (upsert), nên `unschedule` ở một file không đổi gì. |
| 14 | VG | Test (c) của `payment-link.test.ts:910-919` có thể pass nhờ cron quét thay vì handler (c) | low | reject | Cron chỉ chạy mỗi phút, còn job (c) chạy trong vài giây, nên hiếm khi trùng, và handler hỏng vẫn bị bắt ở hầu hết các lần chạy. Sửa phải đổi cách assert của test cũ. |
| 15 | BH | Đối chiếu đọc mọi Hạng vé, kể cả Sự kiện đã kết thúc; lệch không sửa thì log `error` mỗi 10 phút | low | reject | Đúng theo khối frozen (mọi dòng tồn kho, mỗi Hạng vé lệch log `error`). Chi phí đã ghi ở Design Notes cho 5.8 đo. |
| 16 | BH | Spec Change Log trống dù `OrderingJobsModule` đã đổi file; số dòng trong Code Map cũ | low | reject | Cách sửa là sửa spec. Đã ghi vào Implementation Notes. |
| 17 | ECH | AC "đọc thẳng `tickets` thì `lint:deps` báo lỗi" chỉ đúng với import; SQL thô thì lint không bắt | false | reject | Code của `ordering` không đọc `tickets` bằng SQL thô (grep `src/modules/ordering`). Lời văn của AC thuộc spec. |

## Design Notes

- **Ân hạn 120 giây:** job hoãn chạy đúng mốc. Lưới chạy ngay ở mốc thì sẽ đua với job, và log `warn` "bỏ sót" sẽ thành nhiễu sau mỗi lần deploy. Hai phút đủ để job (poll 2 giây, retry có backoff) chạy trước.
- **`REPEATABLE READ`:** cần hai câu đọc (`ordering` và `ticketing`) cùng nhìn một snapshot. Mỗi chuyển trạng thái đổi Đơn, tồn kho và Vé trong cùng transaction, nên snapshot nhất quán không bao giờ báo lệch giả.
- **Subject mang số liệu:** lệch dai dẳng không gửi lặp mỗi 30 phút, nhưng lệch nặng thêm thì báo lại, và email cho thấy ngay con số.
- **Chi phí:** đối chiếu quét toàn bộ `tickets` theo index `ticket_type_id`, nên chi phí tăng theo tổng số Vé. Ở quy mô MVP thì ổn; 5.8 đo lại.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: không lỗi.
- `pnpm turbo lint:deps` -- expected: không vi phạm.
- `pnpm --filter @tickee/api build && pnpm --filter @tickee/api test` -- expected: pass.
