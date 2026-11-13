---
title: 'Story 4.1: Đối soát bù khi IPN trễ hoặc mất'
type: 'feature'
created: '2026-11-13'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '396c217564783b7c873433308a9b2725460b0ec3'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Vé chỉ phát khi IPN Tingee tới. Tingee chỉ gửi lại IPN 5 lần, nên IPN mất thì Người mua đã chuyển tiền mà không có Vé, và Đơn hết hạn theo trần cứng như chưa trả (FR-20, AD-8).

**Approach:** TX2 gắn link enqueue chuỗi job hoãn của `payment`. Mỗi job tra trạng thái đơn Gateway theo `orderId` bằng credential chụp ở `orders.payout_account_id`, rồi đưa kết quả vào đúng `IpnProcessor.process` với nguồn `reconciliation`. Lịch tra cố định theo `expires_at`, có trần lỗi liên tiếp kèm cảnh báo vận hành.

## Boundaries & Constraints

**Always:**
- **Lịch tra** (đồng hồ DB, neo vào cột của Đơn; `expires_at` = `payment_link_attempt_at` + 15 phút sau TX2):
  - Đơn `pending`: `payment_link_attempt_at` + 2, + 5, + 10 phút, rồi `expires_at`.
  - Đơn `expired` từng có link: `expires_at` + 30 phút, + 2 giờ, + 24 giờ. Bỏ các mốc `pending` còn lại.
  - Mỗi job xong thì enqueue mốc kế tiếp lớn hơn đồng hồ DB (mốc đã qua do worker chậm thì bỏ). Hết mốc thì dừng. Đơn không còn `pending`/`expired` thì dừng, không gọi Tingee.
- **TX2** (`PaymentLinks.attach`) enqueue job đầu bằng chính `tx`, `startAfter` = mốc đầu. Job id cố định theo (Đơn, mốc, số lần lỗi) để chạy lại không nhân đôi chuỗi.
- **Kết quả tra** đi qua `TingeeIpn.safeParse` (cùng whitelist) rồi `IpnProcessor.process(organizationId, ipn, 'reconciliation')`: cùng khóa unique `payment_events`, cùng thứ tự kiểm AD-7, cùng cách tạo `review_items`.
  - `success` → `markPaid` nguồn `reconciliation`. Đơn `pending` hoặc `expired` đi bước 3–7 như IPN (gồm bán lại có điều kiện khi tiền về muộn).
  - `expired`/`canceled` → `applyStatus` → `markExpired` khi Đơn còn `pending`, nhả chỗ.
  - Trạng thái "chưa trả, link còn" → không lưu gì, sang mốc kế.
- **`markPaid` nguồn `reconciliation`:** khóa như nguồn `ipn`. Sau khi khóa Đơn, Đơn không còn `pending`/`expired` → kết quả mới `already_settled`, không đổi Đơn, không tạo mục. Kết quả tra là lần hỏi lại cùng một khoản tiền, không bao giờ thành "Thanh toán trùng".
- **IPN và Đối soát bù cùng tới một giao dịch:** chỉ một bộ Vé, một job email Vé.
- **Lỗi khi tra** (Tingee tạm lỗi, timeout, mã lạ, không tìm thấy đơn, `MERCHANT_SUSPENDED`, kết quả không parse được, trạng thái lạ): tra lại cùng mốc sau 1, 2, 4 phút. Lỗi lần thứ 4 liên tiếp → dừng chuỗi và log `error` có `alert: 'payment_reconciliation_stopped'` kèm mã Đơn và lý do. Tra được thì đếm lỗi về 0.
- **`TINGEE_CREDENTIAL_INVALID`** (kể cả credential cũ đã gỡ mềm): dừng ngay, cảnh báo cùng marker, lý do `credential_invalid`. Không đụng trạng thái dịch vụ thanh toán (AD-32, chưa có cờ). Đơn hết hạn theo job (c) hiện có. Không đọc được credential (Đơn thiếu `payout_account_id`, giải mã lỗi) → dừng, lý do `credential_unreadable`.
- Gọi Tingee ngoài transaction, có timeout. Credential giải mã ngay trước lời gọi, không log, không vào payload. Payload job chỉ có id Đơn và số lần lỗi.
- Worker tra tuần tự (không song song trong lô) để giữ dưới giới hạn 20 request/10 giây của Tingee.
- **Quyết định của Mason (13/11):**
  - **Hợp đồng tạm + cờ.** Tingee chưa công bố API tra đơn Gateway (tài liệu công khai đọc 13/11 chỉ có `create-link`). 4.1 làm theo hợp đồng tạm ở Design Notes, Tingee fake giả lập đúng hợp đồng đó. Cờ worker `TINGEE_ORDER_STATUS_QUERY` (boolean, mặc định tắt; bật trong `.env.example` cho local và trong `workerConfig` của test). Cờ tắt: job tra xong ngay, không gọi Tingee, không enqueue mốc kế. TX2 vẫn enqueue mốc đầu. Khi Tingee trả lời: chỉ sửa `tingee.client.ts` và fake, rồi bật cờ ở staging.
  - **IPN `expired`/`canceled` vẫn nhả chỗ ngay** (retro B4, AD-4 (b)). `applyStatus` không đổi. Tiền về sát giờ được bắt bởi các mốc sau hết hạn và nhánh bán lại có điều kiện.
  - **Giữ spec đầy đủ** dù vượt ngưỡng 1.600 token (khoảng 4.700): lịch tra, nguồn `reconciliation` và bảng xử lý kết quả phải nằm chung một chỗ.

**Never:**
- Không làm việc của story khác: cờ `payment_service_status`, tra khi mở lại dịch vụ (4.2); kênh cảnh báo thật, quét cấp phút (4.6); duyệt tay (4.4).
- Không thêm migration, cột hay bảng: trạng thái chuỗi nằm trong job pg-boss.
- Không đổi luồng IPN đẩy về (`ipn.controller.ts`), thứ tự kiểm 3–7 cho nguồn `ipn`, hay trần cứng job (c).
- Không phát Vé từ `returnUrl`; không gọi `get-paging`/`get-status-dynamic-qr` thay cho API tra đơn Gateway.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| IPN mất | Đơn `pending`, Tingee báo `success` đúng số tiền | `paid`, `paid_source='reconciliation'`, N Vé, một job email Vé; dừng chuỗi | N/A |
| IPN đã tới trước | Đơn `paid` lúc job chạy | Không gọi Tingee, dừng | N/A |
| Đua IPN | IPN và kết quả tra cùng `providerTransactionCode`, đồng thời | Một dòng `payment_events`, một bộ Vé | Bên thua nhánh `duplicate` |
| Đua khác mã | Đơn vừa `paid` qua IPN, kết quả tra mang mã khác | `already_settled`, không mục Cần xử lý | N/A |
| Link hết hạn chưa trả | Đơn `pending`, Tingee báo `expired` | `markExpired`, nhả chỗ; chuỗi sang `expires_at` + 30 phút | N/A |
| Tiền về muộn | Đơn `expired`, mốc +2 giờ, Tingee báo `success` | Bán lại có điều kiện: còn chỗ → `paid` + Vé; hết chỗ → `orphan` `sold_out` | N/A |
| Lệch tiền | Tingee báo `success`, `paidAmount ≠ total_amount` | Đơn `review`, mục `amount_mismatch` như IPN | N/A |
| Chưa trả | Tingee báo đơn còn mở | Không lưu gì, enqueue mốc kế | N/A |
| Key cũ bị thu hồi | Credential chụp trả `TINGEE_CREDENTIAL_INVALID` | Dừng chuỗi, log alert `credential_invalid` | Đơn hết hạn theo job (c) |
| Tingee lỗi liên tục | 4 lần liên tiếp `PAYMENT_PROVIDER_UNAVAILABLE` | Dừng chuỗi, log alert `failed` | Không lặp vô hạn |
| Hết mốc | Mốc +24 giờ xong, Tingee vẫn báo `expired` | Dừng, không enqueue | N/A |

</frozen-after-approval>

## Code Map

Gốc `apps/api/src` trừ khi ghi khác.

- `modules/payment/ipn-processor.ts` -- `IpnProcessor.process(organizationId, ipn)` (:191) là lõi chung. Nguồn `'ipn'` cố định ở `settlePayment` (:274). `settlementOf` ném khi `lost_race` (:166). Thêm tham số nguồn, nhánh `already_settled`, đưa nguồn vào log. Tái dùng `TingeeIpn` (:64), `IPN_EXPIRING_STATUSES`, `PAYMENT_UNMATCHED_ALERT` (mẫu marker).
- `modules/ordering/mark-paid.ts` -- `markPaid` chặn nguồn khác `free`/`ipn` (:194). `settleIpn` (:222) khóa Đơn `FOR NO KEY UPDATE`, gọi `pay(... source: 'ipn')` (:283). Mở cho `reconciliation` bằng cùng đường, thêm `already_settled`. `PaidSource` đã có `reconciliation` (`ordering/schema.ts:75`, CHECK DB đã cho phép).
- `modules/ordering/payment-link.ts` -- `attach` (:191) là TX2: enqueue job (c) và `notifyOrderChanged` bằng `tx`. Thêm enqueue job tra đầu. `ensure` gọi `queues.ready()` (:103) trước khi giành lượt.
- `modules/ordering/order-jobs.ts` -- `markExpired(tx, id)` (:134) đã có và đã export. `OrderQueues` (:151) là producer của vai api: phải ensure cả queue tra. Mẫu `defineQueue`/`OrderExpiryWorker`.
- `platform/jobs/queue.ts` -- `defineQueue` (:65), `enqueue(boss, tx, payload, {startAfter, id})`, `registerQueueWorker` (:178, mặc định tuần tự), `derivedJobId` (:222) cho id cố định.
- `packages/contracts/src/jobs.ts` -- thêm tên queue và dead-letter (mẫu `ORDERING_EXPIRE_ORDER`).
- `modules/organizer/payout-targets.ts` -- chưa có hàm trả credential đã giải mã theo `payout_account_id` gồm cả credential đã gỡ. Thêm hàm theo mẫu `defaultPayoutTargetOf`, export qua `organizer/index.ts`.
- `modules/tingee/tingee.client.ts` -- `TingeeClient` (:115) có `listAccounts`, `createPaymentLink`. `post()` (:265) trả `data` khi `code='00'`, ném `AppError` mã miền. Thêm `getGatewayOrder`. `errors.ts` ánh xạ mã.
- `worker.module.ts` (:35) -- đã import `PaymentProcessingModule` và `TingeeModule`. Worker config có `TINGEE_CREDENTIAL_KEYS` (`platform/config/config.schema.ts:123`, `workerConfigSchema` :106). Chưa có cờ boolean nào trong schema; zod v4 có `z.stringbool()`. Test dựng config qua `test/helpers.ts:58` (`workerConfig`).
- `modules/payment/payment.module.ts` -- `PaymentProcessingModule` chưa có queue/worker.
- `test/tingee-fake/server.ts` -- `route()` (:376) chỉ có `get-va-paging` và `create-link`. `FakeLink` (:247) chưa có trạng thái thanh toán. Checkout (:457) gửi IPN với mã giao dịch ngẫu nhiên mỗi lần (`fakeIpnPayload` :109).
- `apps/web/lib/order/live.ts` -- `orderPollInterval` (:19) chỉ poll khi đang chờ tiền. SSE Trang Đơn vẫn mở với Đơn `expired` và server có phát `order_changed` khi `expired → paid/review` (`mark-paid.ts:336`, `:134`), nên chỉ thiếu polling dự phòng.
- Test: `test/payment/ipn-fixtures.ts` (`postIpn`, `paymentEventsOf`, `reviewItemsOf`, `expectInvariants`), `test/ordering/order-fixtures.ts`, `test/ordering/order-expiry.test.ts` (mẫu chạy worker thật), `test/ordering/free-order-concurrency.test.ts:255` (đang kiểm `reconciliation` ném lỗi, phải sửa), `apps/web/test/order-live.test.ts:20`.
- Không đổi: `ipn.controller.ts`, `my-tickets.service.ts` (cửa sổ "Hết hạn" 30 phút giữ nguyên; SSE `liveOrderIds` đã gồm mọi Đơn nên Vé đến muộn vẫn hiện), `test/platform/db-clock-usage.test.ts` (đồng hồ DB chỉ qua `platform/db/clock.ts`).

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/jobs.ts` -- thêm `PAYMENT_RECONCILE_ORDER` + dead-letter -- tên queue dùng chung api/worker.
- [x] `apps/api/src/platform/config/config.schema.ts`, `.env.example`, `apps/api/test/helpers.ts` -- cờ `TINGEE_ORDER_STATUS_QUERY` ở `workerConfigSchema` (boolean từ chuỗi, mặc định tắt); bật trong `.env.example` và `workerConfig()` -- quyết định hợp đồng tạm + cờ.
- [x] `apps/api/src/modules/tingee/tingee.client.ts`, `index.ts` -- `getGatewayOrder(credential, orderId): Promise<unknown | null>`: `data` khi `code='00'`, `null` khi mã "không tìm thấy", còn lại ném lỗi miền như `post()` -- chỉ `tingee` biết đường dẫn và mã.
- [x] `apps/api/test/tingee-fake/server.ts` -- `FakeLink` giữ trạng thái (mở/`success`/`expired`, mã giao dịch ổn định, `paidAmount`, `paidAt`); checkout dùng lại đúng mã đó; endpoint tra; helper cho test đánh dấu đã trả mà không gửi IPN, và đánh dấu hết hạn -- AD-9 yêu cầu fake giả lập tra trạng thái.
- [x] `apps/api/src/modules/organizer/payout-targets.ts`, `index.ts` -- credential (đã giải mã) theo `payout_account_id`, kể cả đã gỡ -- AC credential đã chụp.
- [x] `apps/api/src/modules/ordering/mark-paid.ts` -- nhận `reconciliation`, `already_settled` -- bước 3–7 dùng chung.
- [x] `apps/api/src/modules/ordering/` (file queue mới, `payment-link.ts`, `order-jobs.ts`, `index.ts`) -- `defineQueue` của job tra (payload `{orderId, failures}`, retry cho lỗi DB, dead-letter), hàm thuần tính mốc kế, read model Đơn cho job tra; TX2 enqueue mốc đầu; `OrderQueues` ensure thêm queue tra -- `ordering` enqueue ở TX2 mà không import `payment`.
- [x] `apps/api/src/modules/payment/ipn-processor.ts` -- tham số nguồn, nhánh `already_settled`.
- [x] `apps/api/src/modules/payment/` (worker mới, `payment.module.ts`), `apps/api/src/worker.module.ts` -- worker tra: đọc Đơn, lấy credential, gọi Tingee, phân loại kết quả, enqueue mốc kế hoặc dừng kèm alert.
- [x] `apps/web/lib/order/live.ts` -- Đơn `expired` mà `serverNow < expiresAt` + 24 giờ: poll 30 giây khi SSE mất -- bàn giao C5.
- [x] Test API (fake, DB thật) cho mọi dòng của I/O Matrix; unit test hàm tính mốc; test `getGatewayOrder` (mã thành công, không tìm thấy, credential sai, timeout); sửa `free-order-concurrency.test.ts`; `apps/web/test/order-live.test.ts`.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- đóng B4, B5, C5 của 4.1; thêm mục: thay hợp đồng tạm bằng hợp đồng thật; rủi ro IPN đến sau mang mã khác → "Thanh toán trùng" giả; tải tra lên giới hạn Tingee cho 5.8.

**Acceptance Criteria:**
- Given TX2 vừa gắn link, when commit, then có đúng một job tra với `startAfter` = `payment_link_attempt_at` + 2 phút; TX2 rollback thì không có job.
- Given job tra chạy lại sau khi đã enqueue mốc kế, when chạy xong, then không có job trùng cho cùng mốc.
- Given cờ `TINGEE_ORDER_STATUS_QUERY` tắt, when job tra chạy, then không có request nào tới Tingee, không enqueue mốc kế, Đơn không đổi.
- Given Tingee fake không bao giờ gửi IPN, when chuỗi tra chạy, then Vé được phát qua Đối soát bù; IPN và Đối soát bù tới đồng thời thì chỉ một lần phát Vé và một job email.
- Given mọi nhánh, then bất biến `sold + held ≤ capacity`, `held` = tổng Vé của Đơn `pending`, mỗi Đơn 0 hoặc đủ N Vé (`expectInvariants`).
- Given `pnpm lint:deps`, then `ordering` không import `payment`, chỉ `tingee` gọi HTTP Tingee.

## Implementation Notes

- File mới: `apps/api/src/modules/ordering/reconciliation-jobs.ts` (queue, `reconcileCheckpoints`/`nextCheckAt`/`firstCheckAt`, read model `orderForReconciliation`, `scheduleNextReconciliation`/`scheduleReconciliationRetry`), `apps/api/src/modules/payment/reconciliation-worker.ts` (`ReconciliationWorker`, `PaymentJobsModule.forRoot` trong `payment.module.ts`), `test/payment/reconciliation.test.ts`, `test/ordering/reconcile-schedule.test.ts`.
- `reconcileCheckpoints` của Đơn `pending` gồm cả 3 mốc sau hết hạn: Đơn còn `pending` lúc mốc `expires_at` (job (c) chưa chạy) thì mốc kế là `expires_at` + 30 phút.
- Id job: mốc theo (Đơn, mốc); lần tra lại suy từ id job cha + số lần lỗi (payload không mang mốc), nên vẫn cố định theo (Đơn, mốc, số lần lỗi).
- `already_settled` kiểm ngay sau khi khóa Đơn, trước bước 3: kết quả tra cho Đơn đã chốt của Sự kiện đã hủy không tạo mục `event_cancelled`.
- Trạng thái Gateway lạ (khác `pending`/`success`/`expired`/`canceled`) và `data.orderId` khác mã Đơn tính là một lần tra lỗi (`unknown_status`, `invalid_result`), không lưu `payment_events`.
- `MERCHANT_SUSPENDED` và `PAYMENT_ACCOUNT_NOT_ALLOWED` tính là lỗi tạm (tra lại cùng mốc).
- `HttpTingeeClient.post()` tách thành `reply()` + `dataOf()` để `getGatewayOrder` nhận mã 2004 là "không tìm thấy" (kể cả kèm HTTP lỗi); `listAccounts` giữ hành vi.
- Tingee fake: link giữ trạng thái thanh toán và một mã giao dịch ổn định; checkout đánh dấu đã trả trước khi gửi IPN (giả lập IPN mất bằng URL IPN sai); "Hết hạn"/"Hủy" không đổi link đã `success`. Helper test: `markPaid`, `markExpired`, `order()`, `orderReplies`. Hai test cũ (`checkout-ipn.test.ts`, `ipn-dev-checkout.test.ts`) đổi kỳ vọng: bấm "Đã thanh toán" lần hai là IPN lặp, không phải khoản thứ hai.
- `workerConfig()` của test bật cờ, nên job tra sót từ lần chạy trước bị worker test nhặt và lỗi nhanh vào Tingee giả `127.0.0.1:1`; không ảnh hưởng suite nào.

## Spec Change Log

## Review Triage Log

Lượt 1 (13/11/2026). BH = blind-hunter, ECH = edge-case-hunter, VG = verification-gap.

| # | Nguồn | Phát hiện | Verdict | Route | Bằng chứng |
|---|-------|-----------|---------|-------|------------|
| 1 | VG (gap) | Timeout mặc định 5 giây của `getGatewayOrder` không có test chạy qua client không truyền `orderStatusTimeoutMs` | low | patch | Test chỉ kiểm hằng số và client có `orderStatusTimeoutMs: 300`; đổi fallback ở `tingee.client.ts:219` thành 15 giây vẫn pass. |
| 2 | VG, ECH | `credentialOf` bắt mọi lỗi, kể cả lỗi DB tạm thời, rồi coi là `credential_unreadable` và dừng hẳn chuỗi | medium | patch | `reconciliation-worker.ts:179-193` bọc cả `payoutCredentialOf` (truy vấn DB + giải mã) trong `catch` không lọc. Trái spec: lỗi DB → ném, pg-boss retry. |
| 3 | VG | e2e "trạng thái không chờ → không polling" pass mà không còn kiểm điều ở tiêu đề | low | patch | `e2e/order-live.spec.ts:276` dùng Đơn `expired` trong cửa sổ 24 giờ → giờ poll 30 giây; chờ 3 giây nên vẫn pass. |
| 4 | BH | Chặn nguồn ở `markPaid` đổi từ danh sách cho phép sang danh sách cấm | low | patch | `mark-paid.ts:208` chỉ chặn `manual`; một `PaidSource` mới sẽ rơi vào nhánh Đơn 0đ (giả định `sold += n` đã chạy ở TX1). |
| 5 | BH | Tài liệu `payment_events`/`review_items` và `IpnProcessor.process` còn ghi "mỗi khoản tiền không thành Vé đúng một mục" | low | patch | `already_settled` lưu dòng `payment` có `order_id` mà không mục, không Vé. `payment/schema.ts:16,71`, `ipn-processor.ts:191` chưa ghi ngoại lệ này. |
| 6 | BH | `already_settled` chỉ log mức info | low | patch | Kết quả tra cho Đơn đã chốt mang mã hoặc số tiền khác là tín hiệu duy nhất trả lời câu hỏi Tingee (mã có trùng không); hiện chỉ có log "Đã xử lý". |
| 7 | BH, ECH | Polling dự phòng của Trang Đơn dừng đúng lúc mốc tra cuối (+24 giờ) mới chạy | low | patch | `live.ts:37-42` dừng khi `serverNow ≥ expiresAt + 24h`; job mốc cuối chạy từ thời điểm đó, cộng tối đa 7 phút tra lại. |
| 8 | BH, ECH | Poll 30 giây cả với Đơn `expired` chưa từng có link | low | reject | Chỉ xảy ra khi SSE mất và trang mở; phân biệt cần thêm trường vào `BuyerOrderView` (thêm bề mặt công khai). |
| 9 | BH, ECH | Cờ tắt thì job tra bị tiêu thụ; bật cờ sau đó không tra Đơn đang dở | low | reject | Đúng quyết định đã chốt ("Cờ tắt: job tra xong ngay … TX2 vẫn enqueue mốc đầu"). Chưa có staging/production, lúc bật cờ chỉ hụt Đơn trong 24 giờ trước. |
| 10 | BH | Không gì ngăn bật cờ khi `TINGEE_BASE_URL` trỏ Tingee thật | low | reject | Phải cấu hình sai mới gặp; README và doc của schema ghi rõ chỉ bật ở local/test; chặn bằng `refine` thêm điều kiện mới. |
| 11 | BH | Đơn hết hạn sớm (IPN `expired` trước `expires_at`) vẫn gọi Tingee ở mốc `pending` đã xếp hàng | low | patch | `reconcile()` chỉ bỏ qua trạng thái khác `pending`/`expired`. Trái "bỏ các mốc `pending` còn lại"; gặp thường xuyên ở mốc `expires_at`. |
| 12 | BH, ECH | Lỗi lần thứ 4 liên tiếp dừng cả chuỗi, mất các mốc +2 giờ, +24 giờ | medium | defer | Đúng intent (AC epics và spec: "dừng chuỗi" kèm cảnh báo). Chuỗi dừng (gồm lúc `MERCHANT_SUSPENDED`) không tự chạy lại; giao 4.2/4.6. |
| 13 | BH, ECH | Dead-letter (lỗi DB sau 5 lần retry) kết thúc chuỗi mà không có marker `payment_reconciliation_stopped` | low | reject | Lỗi lặp chắc chắn từ `process` bị schema/khóa chặn; lỗi DB 5 lần liên tiếp hiếm; 4.6 đã có cảnh báo dead-letter theo epic. Sửa cần metadata `retryCount`. |
| 14 | BH | Comment khẳng định worker tuần tự giữ dưới 20 request/10 giây | low | patch | Tuần tự với phản hồi nhanh vẫn vượt; `reconciliation-jobs.ts:55`. Đo tải đã giao 5.8. |
| 15 | BH | Mã 1133 thành `credential_invalid`: nếu API tra thật cần quyền nhóm dịch vụ riêng, mọi Đơn dừng với cảnh báo như thu hồi key | maybe-false | defer | Phụ thuộc hợp đồng thật. Cần Tingee xác nhận API tra có cần cấp quyền nhóm dịch vụ riêng không. |
| 16 | BH | `credential_unreadable` gộp ba nguyên nhân, chỉ giải mã lỗi có log nguyên nhân | low | reject | Sau TX2 Đơn luôn có `payout_account_id` thuộc BTC; còn lại chỉ ca giải mã (có log). |
| 17 | BH | `process(..., source = 'ipn')` có giá trị mặc định | low | reject | Spec cấm đổi `ipn.controller.ts`; mặc định có doc. |
| 18 | BH | Trạng thái spec (`in-review`) và sprint-status (`in-progress`) lệch nhau | false | reject | Đang giữa luồng Build: step-05 và override `on_complete` đặt trạng thái cuối. |
| 19 | BH | `ordering/index.ts` xuất các hàm/hằng chỉ test dùng | low | patch | `payment` không dùng `RECONCILE_AFTER_*`, `RECONCILE_RETRY_DELAYS_MS`, `reconcileCheckpoints`, `nextCheckAt`, `firstCheckAt`, `reconcileJobId`, `reconcileRetryJobId`; chỉ `reconcile-schedule.test.ts` import qua `index.ts`. |
| 20 | ECH | Lỗi không rõ khi tra mất nguyên nhân gốc (`unexpected_error`) | low | patch | `lookup()` (`reconciliation-worker.ts:199-209`) không log `err`; cảnh báo dừng chỉ có `unexpected_error`. |
| 21 | ECH | Trạng thái Gateway lạ không lưu `payment_events` | false | reject | Spec: trạng thái lạ là một lần tra lỗi (tra lại cùng mốc); chỉ `success`/`expired`/`canceled` đi `process`. |

## Design Notes

**Hợp đồng tạm** (chờ Tingee xác nhận; mọi chi tiết Tingee chỉ nằm trong `tingee.client.ts` và fake):

```
POST /v1/payment-gateway/get-order   body {requestId: uuid v4, orderId}
→ {code:'00', data:{orderId, amount, paidAmount, status:'pending'|'success'|'expired'|'canceled',
                    providerTransactionCode, paidAt, statusCode, billId, paymentMethod, merchantId}}
→ {code:'2004'} không tìm thấy đơn
```

`data` dùng đúng tên field của IPN nên `TingeeIpn` parse được. `pending` là "chưa trả, link còn".

**Vì sao `already_settled` thay vì `duplicate_payment`:** tra theo `orderId` là hỏi lại khoản tiền của chính đơn Gateway đó, nên Đơn đã rời `pending`/`expired` nghĩa là khoản này đã được ghi nhận. Khoản trả thật lần hai vẫn tới bằng IPN đẩy về và đi bước 4 như cũ. Còn hở một ca: Đối soát bù phát Vé trước, IPN tới sau mang mã khác → IPN thành "Thanh toán trùng" giả. Ca này chỉ đóng được khi Tingee xác nhận mã trùng (ghi `deferred-work.md`).

**Hàm tính mốc** (thuần, test không cần DB):

```ts
nextCheckAt({ status, attemptAt, expiresAt }, now): Date | null
// pending: [attempt+2m, +5m, +10m, expiresAt, expiresAt+30m, +2h, +24h]; expired: 3 mốc cuối
// → mốc đầu tiên > now, không còn → null
```

## Verification

**Commands:**
- `pnpm typecheck` -- expected: không lỗi.
- `pnpm lint:deps` -- expected: không vi phạm ranh giới mô-đun.
- `pnpm --filter @tickee/api test` -- expected: toàn bộ pass (cần Postgres của `docker-compose.yml`).
- `pnpm --filter @tickee/web test` -- expected: toàn bộ pass.
