---
title: 'Story 3.5: Nhận IPN và phát Vé đúng một lần'
type: 'feature'
created: '2026-11-11'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: '511c91305ce6b77c913fab9c97abf09c301304db'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sau 3.4, Người mua trả tiền qua Gateway nhưng Tickee chưa có endpoint IPN. Vì vậy Đơn có phí không bao giờ thành `paid` và không có Vé. `markPaid` mới nhận nguồn `free`, mô-đun `payment` còn rỗng, và worker chưa có cấu hình Tingee cùng khóa QR (phần còn lại của checklist E2-6).

**Approach:**
- `payment` mở `POST /v1/payments/tingee/ipn/:ipnKey` (`@Public`, tự đọc raw body).
- Tra BTC theo `ipnKey` qua read model của `organizer`, rồi kiểm chữ ký bằng secret hiện hành, sau đó tới secret cũ.
- Trong một transaction: lưu `payment_events` (whitelist, khóa unique) rồi gọi `ordering.markPaid(…, 'ipn', …)` hoặc `ordering.markExpired`.
- Worker được cấu hình Tingee và khóa QR để Đối soát bù (4.1) đi cùng đường xử lý.

## Boundaries & Constraints

**Always:**
- **Đọc request:**
  - Tra BTC theo `ipnKey` (`organizations.tingee_ipn_key`) trước khi đọc body. `ipnKey` lạ → 404 `NOT_FOUND`, log warn.
  - Parser JSON toàn cục (`identity.module.ts`) bỏ qua mọi đường dẫn có tiền tố IPN. Hằng tiền tố đặt trong contracts, dùng chung với `tingeeIpnUrl`.
  - Handler tự đọc byte thô, tối đa 64 KB (vượt → 413).
- **Kiểm chữ ký:**
  - `x-request-timestamp` dạng `yyyyMMddHHmmssSSS` UTC+7 (`parseTingeeTimestamp`). Sai dạng, hoặc lệch đồng hồ server quá 10 phút theo cả hai chiều → từ chối.
  - `x-signature` kiểm bằng `verifySignature`: secret hiện hành trước, rồi các credential cũ, mới nhất trước.
  - Không khớp → 401 `IPN_SIGNATURE_INVALID` (mã mới), log warn `{organizationId, reason}`.
  - Không bao giờ log secret, chữ ký, raw body hay `customerEmail`.
- **Body** (sau khi chữ ký đúng): parse JSON rồi kiểm bằng schema Zod. Hỏng → 400 `VALIDATION_FAILED`, log error để Tingee gửi lại.
- **Thành công:** HTTP 200 với đúng body `{"code":"00","message":"Success"}`.
- **`payment_events`** (mới, chỉ INSERT/SELECT):
  - Cột: `organization_id` (BTC của `ipnKey`, NOT NULL); `order_id` (null khi không có Đơn hoặc Đơn thuộc BTC khác); `kind` (`payment` khi `status = success`, còn lại `status`); `status`, `provider_order_id`, `provider_transaction_code`, `amount`, `paid_amount`, `paid_at`, `status_code`, `payment_method`, `bill_id`, `merchant_id`, `request_id`; `received_at`.
  - Không lưu `description`, `orderInfo`, `customerEmail`.
  - `kind = payment` thì bắt buộc có `provider_transaction_code` (thiếu → 400).
  - Unique: `(organization_id, provider_transaction_code) WHERE kind='payment'` và `(organization_id, provider_order_id, status) WHERE kind='status'`.
- **Một transaction** cho mỗi IPN hợp lệ: `INSERT … ON CONFLICT DO NOTHING`. Trùng khóa → trả `00`, không làm gì thêm. Không trùng thì:
  - `success`, theo thứ tự:
    1. `orderId` sai `ORDER_CODE_PATTERN`, hoặc không có Đơn → chỉ lưu.
    2. Đơn thuộc BTC khác → chỉ lưu (`order_id` null).
    3. Đơn không `pending` → lưu, gắn `order_id`.
    4. Đơn `pending` → `markPaid(tx, orderId, 'ipn', paidAmount, { paidAt })`.

    Nhánh 1–3 và mọi kết quả `markPaid` khác `paid` đều log warn kèm tên nhánh. Story 3.6 sẽ thêm `review_item` cho các nhánh này.
  - `expired`/`canceled` cho Đơn `pending` của chính BTC đó → `markExpired(tx, orderId)`. Các trường hợp còn lại chỉ lưu.
  - `status` lạ → chỉ lưu, log warn.
- **`markPaid` nguồn `ipn`:**
  - Khóa Sự kiện `FOR SHARE`, rồi kiểm theo thứ tự:
    - Sự kiện đã hủy → `event_cancelled`.
    - `paidAmount ≠ total_amount` → `mismatch`.
    - `now() > effective_end_at` → `orphan`.

    Ba kết quả này không đổi gì trong DB.
  - Qua cả ba thì CAS `pending → paid`:
    - `paid_at` = `paidAt` Tingee báo (thiếu thì lấy đồng hồ DB), `paid_amount`, `paid_source='ipn'`.
    - `held -= n`, `sold += n` theo `ticket_type_id` tăng dần.
    - Phát N Vé (`issued_at` = đồng hồ DB), audit `order.paid`, phễu `paid`.
  - CAS 0 dòng → `lost_race`. Đơn của Sự kiện bị khóa vẫn được phát Vé.
  - Nhánh `free` giữ nguyên.
- **`markExpired(tx, orderId)`:** CAS `pending → expired`, không xét hạn, rồi `held -= n`. Trả `expired` hoặc `skipped`.
- **Worker:**
  - `workerConfigSchema` thêm `TINGEE_BASE_URL`, `TINGEE_CREDENTIAL_KEYS`, `TICKET_QR_KEYS`.
  - `WorkerModule` import `TingeeModule`, `TicketingModule` và phần lõi xử lý IPN của `payment` (không có controller). DI của worker resolve được bộ xử lý IPN cùng `OrderPayments`.
- **Ranh giới mô-đun:** `module-graph.cjs` thêm `payment → organizer`.
- **Tingee fake:** có hàm ký IPN bằng secret của từng merchant (header + raw body).
- **Quyết định của Mason (11/11):**
  - **Hai BTC dùng chung một merchant Tingee:** giữ AD-7. Đơn phải thuộc BTC sở hữu `ipnKey`, chữ ký chỉ kiểm bằng secret của BTC đó. IPN lạc sang BTC khác đi nhánh 2 (chỉ lưu, log), không tự phát Vé. Việc chặn trùng Client ID giữa các BTC ở bước kết nối ghi vào `deferred-work.md` (làm trước khi mở bán Vé có phí), không làm trong 3.5.
  - **Email Vé để 3.8:** 3.5 không enqueue email, không thêm queue. 3.8 thêm enqueue trong `markPaid` cho mọi nguồn, cùng lúc với nội dung email. Đây là điểm lệch có chủ đích so với câu "enqueue email Vé" trong AC 3.5 của epics.
  - **Giữ spec đầy đủ** dù vượt ngưỡng 1.600 token (khoảng 4.500): một mục tiêu xuyên lớp; phần cấu hình worker gộp vào đây theo checklist E2-6.
  - **Ràng secret cũ với Đơn** (chốt sau review vòng 1, phương án A):
    - Secret của credential hiện hành có hiệu lực với mọi IPN, như trên.
    - Secret của credential đã thay (`retired_at`) chỉ có hiệu lực với IPN có `orderId` là Đơn của chính BTC đó, khi `orders.payout_account_id` thuộc đúng credential cũ ấy (Đơn có link tạo trước lúc đổi key, AD-35). Đây là IPN `success` hay IPN trạng thái đều như nhau.
    - Chữ ký chỉ khớp secret cũ mà không ràng được (mã sai dạng, không có Đơn, Đơn thuộc BTC khác, Đơn chưa có link, Đơn gắn credential khác, hay body không đọc được) → 401 `IPN_SIGNATURE_INVALID`, không lưu, log warn với `reason` riêng.
    - Lý do: đổi key vì secret cũ bị lộ thì người giữ secret cũ không được ký giả IPN để lấy Vé cho Đơn mới.

**Never:**
- Không làm các việc của story khác:
  - 3.6: `review_items`, chuyển Đơn sang `review`, cảnh báo vận hành.
  - 4.1: job tra trạng thái và Đối soát bù.
  - 3.7: realtime.
  - 3.8: email Vé, queue email.
  - Không đổi web: Trang Đơn đã poll và hiện Thành công khi `paid`.
- Không gọi Tingee trong IPN. Không phát Vé ngoài `markPaid`. Không đọc body trước khi tra `ipnKey`.
- Không xử lý `webhook-type: url-validation`; mục này vẫn để ở `deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| IPN đúng | Đơn `pending`, `success`, `paidAmount` = tổng, ký bằng secret hiện hành | 200 `00`. Đơn `paid` (`ipn`, `paid_at` = `paidAt`); `held -= n`, `sold += n`; có N Vé; 1 event gắn `order_id`; có audit và phễu | — |
| Ký bằng key cũ | Đơn có link tạo trước khi đổi key | Như IPN đúng | — |
| Key cũ cho Đơn mới | Ký bằng secret cũ; Đơn có link tạo sau khi đổi key (hoặc mã không ràng được Đơn của credential cũ), `success` hay `expired` | 401; không lưu; Đơn, tồn kho, Vé không đổi | log warn |
| `ipnKey` lạ | — | 404, không đọc body | log warn |
| Sai chữ ký | Ký sai, hoặc ký bằng secret của BTC khác | 401, không lưu | log warn |
| Lệch giờ | Timestamp sai dạng hoặc lệch > 10 phút | 401 | log warn |
| Lặp | Cùng `providerTransactionCode` | 200 `00`; không thêm event hay Vé | — |
| Đồng thời | Hai IPN cùng lúc cho một Đơn (cùng mã hoặc khác mã) | Đơn chỉ được phát Vé một lần; IPN khác mã được lưu và log nhánh | — |
| Hết hạn / hủy | `expired`/`canceled`, Đơn `pending` | Đơn `expired`, `held -= n`; IPN lặp `(orderId, status)` → no-op | — |
| Trạng thái muộn | `expired`/`canceled`, Đơn không còn `pending` | Chỉ lưu | — |
| Nhánh của 3.6 | `success` + lệch tiền, Sự kiện đã hủy, quá `effective_end_at`, Đơn không `pending`, thuộc BTC khác, không tồn tại hoặc sai định dạng | 200 `00`, lưu event; Đơn, tồn kho, Vé không đổi | log warn kèm nhánh |
| Body hỏng | Chữ ký đúng nhưng JSON hoặc schema sai | 400 | log error |
| Body quá lớn | > 64 KB | 413 | — |

</frozen-after-approval>

## Code Map

- **Bản triển khai vòng 1** (đã revert, qua toàn bộ test) ở nhánh `wip/3-5-ipn-vong-1` (`39d51c7`). Dùng lại mọi phần không đổi (xem Spec Change Log, mục KEEP); vòng 2 thêm ràng secret cũ và các bản vá trong Tasks. Xem bằng `git show wip/3-5-ipn-vong-1:<đường dẫn>` hoặc `git diff 511c913 wip/3-5-ipn-vong-1`.
- **Ràng secret cũ:**
  - `ipnRecipientOf` (vòng 1) chỉ trả mảng secret. Cần trả kèm id credential và cờ hiện hành.
  - Kiểm chữ ký phải cho biết credential nào khớp. Thử secret hiện hành trước, nên IPN ký bằng key hiện hành không bao giờ phải ràng.
  - Đơn → credential: `orders.payout_account_id` → `payout_accounts.tingee_credential_id` (`organizer/schema.ts:153`). `payment` đọc qua read model của `organizer` (đã cho `payment → organizer`); Đơn đọc qua `orderForPayment` (thêm `payoutAccountId`).
- `apps/api/src/modules/ordering/mark-paid.ts:32-93`:
  - `markPaid` hiện ném lỗi với nguồn khác `free`. Mẫu khóa Sự kiện → CAS → `issueTickets` → audit → phễu.
  - `lockEventByIdForShare` trả `status`, `lockedAt`, `effectiveEndAt` (`event/public-event.ts:54-65,101`).
- `apps/api/src/modules/ordering/inventory.service.ts`:
  - `releaseHeld` 161, `sellInventory` 140 (mẫu UPDATE theo `byTicketTypeId`).
  - Thêm `settleHeld` cho bước `held -= n`, `sold += n`.
- `apps/api/src/modules/ordering/order-jobs.ts:84-122`: `expireOrder` (CAS + `releaseHeld`) là mẫu cho `markExpired`. Không đổi hai job (a)/(c).
- `apps/api/src/modules/ordering/{index,ordering.module}.ts`:
  - `OrderPayments` mới được cung cấp trong `OrderingModule` (có controller, cần config api).
  - Tách ra module nhỏ (vd. `OrderPaymentsModule`) để worker import được.
- `apps/api/src/modules/ordering/schema.ts:74-76,150`: `PAID_SOURCES`; ràng buộc `orders_paid_check`; `ORDER_CODE_PATTERN` ở `contracts/src/order.ts:20`.
- `apps/api/src/modules/organizer/`:
  - `payout-targets.ts`: mẫu read model nhận `SecretBox` (`defaultPayoutTargetOf`). Thêm `ipnRecipientOf(db, secretBox, ipnKey)` → `{ organizationId, secrets[] }`: credential hiện hành trước, rồi các credential đã `retired_at`, mới nhất trước.
  - `schema.ts`: `tingee_ipn_key` 28, unique 38; `tingeeCredentials` 112-135 (credential cũ giữ ciphertext).
  - Export qua `index.ts`.
- `apps/api/src/modules/tingee/signing.ts`: `parseTingeeTimestamp`, `verifySignature` (hex, `timingSafeEqual`), đã export.
- `apps/api/src/modules/identity/identity.module.ts:45-50`:
  - `bodyParser` của `@thallesp/nestjs-better-auth` áp `express.json` cho mọi route ngoài `/v1/auth`.
  - Loại tiền tố IPN bằng tùy chọn `json.type` dạng hàm. `rawBody: true` chỉ để dành cho IPN: bỏ nếu không còn ai dùng `req.rawBody`.
- `packages/contracts/src/organizer.ts:254` `tingeeIpnUrl`. `errors.ts`: thêm mã mới thì sửa `ErrorCode`, `app-error.ts` `DEFAULT_STATUS`, `error.filter.ts` `MESSAGES`.
- `apps/api/src/modules/payment/index.ts` hiện rỗng.
  - Migration kế tiếp `drizzle/0019`. Bảng append-only khai báo ở `platform/db/grants.ts:11`.
  - `@Public` lấy từ `platform/http`.
  - Đăng ký `PaymentModule` ở `api.module.ts`.
- Worker:
  - `platform/config/config.schema.ts:98-115`, `worker.module.ts`.
  - Ghi chú env ở `.env.example:44-54` (các biến đã có, sửa ghi chú "vai api") và `README.md`.
  - Test: `test/helpers.ts:53` `workerConfig`, `test/config.test.ts`, `test/worker.test.ts`.
- `apps/api/module-graph.cjs:12`.
- Test:
  - `test/tingee-fake/server.ts` (merchant có `secretToken`, `verifySignature`).
  - `test/ordering/order-fixtures.ts` (`paidReadyOrg`, `linkPayoutAccount`, `testSecretBox`).
  - Mẫu Đơn có link ở `test/ordering/payment-link.test.ts`. Mẫu đổi key ở `test/organizer/` (2.13-b).
  - Harness `test/identity/harness.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{organizer,errors}.ts` + test -- hằng tiền tố IPN dùng trong `tingeeIpnUrl`; `IPN_SIGNATURE_INVALID` 401 (kéo theo `app-error.ts`, `error.filter.ts`).
- [x] `apps/api/src/modules/organizer/{payout-targets,index}.ts` -- `ipnRecipientOf` (đóng mục E2-6 "tra BTC theo `ipnKey`").
- [x] `apps/api/module-graph.cjs` -- `payment → organizer`.
- [x] `apps/api/src/modules/ordering/{mark-paid,inventory.service,order-jobs,ordering.module,index}.ts`:
  - `markPaid` nguồn `ipn` (tham số `paidAt`); `settleHeld`; `markExpired`.
  - Module `OrderPayments` dùng được ở cả api lẫn worker.
- [x] `apps/api/src/modules/payment/{schema,ipn.controller,ipn-processor,payment.module,index}.ts` + `drizzle/0019_payment_events.sql` + `platform/db/grants.ts` + `api.module.ts`:
  - Endpoint, đọc raw body, kiểm chữ ký, whitelist, transaction xử lý.
  - Lõi xử lý tách khỏi controller để worker dùng lại.
- [x] `apps/api/src/modules/identity/identity.module.ts` -- parser JSON toàn cục bỏ qua tiền tố IPN.
- [x] `apps/api/src/{platform/config/config.schema,worker.module}.ts`, `.env.example`, `README.md`, `test/{helpers,config.test,worker.test}.ts` -- cấu hình Tingee và khóa QR cho worker (đóng mục E2-6 "cấu hình Tingee cho worker").
- [x] `apps/api/test/tingee-fake/server.ts` -- ký IPN theo merchant.
- [x] `apps/api/test/payment/{ipn,ipn-concurrency}.test.ts`, `test/ordering/mark-paid-ipn.test.ts` -- mọi dòng Matrix; test chữ ký trên đúng byte gửi đi; IPN ký bằng secret BTC khác gửi vào URL của BTC này.
- [x] `_bmad-output/planning-artifacts/architecture/architecture-tickee-2026-10-28/ARCHITECTURE-SPINE.md` (AD-19) -- sửa câu "raw body lấy qua `AuthModule … rawBody`" theo cách mới.
- [x] Ràng secret cũ với Đơn (quyết định A trong khối frozen): `organizer/payout-targets.ts` (`ipnRecipientOf` kèm id credential; read model credential của một tài khoản nhận tiền), `ordering/mark-paid.ts` (`orderForPayment` có `payoutAccountId`), `payment/ipn.controller.ts` + test dòng Matrix "Key cũ cho Đơn mới" (cả `success` lẫn `expired`) và ca key cũ cho Đơn cũ vẫn nhận.
- [x] Bản vá từ review vòng 1 (Review Triage Log):
  - #9 `payment/ipn-processor.ts`: trường phụ (`paidAt`, `requestId`, `billId`, `statusCode`, `paymentMethod`, `merchantId`, `amount`) sai định dạng → `null` thay vì 400. Vẫn kiểm chặt `orderId`, `status`, và với `success` thì `providerTransactionCode` + `paidAmount`. Có test cho `paidAt` không offset.
  - #22 `identity/identity.module.ts`: `parsesAsJson` lấy `pathname` bằng `new URL(…, 'http://localhost')` để nhận cả request dạng absolute-form; có test.
  - #6 `ARCHITECTURE-SPINE.md` AD-7: câu khóa unique ghi theo từng BTC (`organization_id` + mã), như Design Notes.
  - #16 test: IPN `expired` ký đúng gửi vào URL BTC A với mã Đơn `pending` của BTC B → Đơn B vẫn `pending`, `held` không đổi, event lưu dưới A với `order_id` null.
  - #17 test: `markPaid` lỗi giữa chừng qua HTTP → 5xx, không có `payment_events`, Đơn vẫn `pending`; gỡ chỗ lỗi rồi gửi lại cùng mã giao dịch → 200, Đơn `paid`, một event.
  - #18 test: `UPDATE`/`DELETE`/`TRUNCATE` `payment_events` bằng `tickee_app` → 42501.
  - #19 test: cùng một payload (cùng `providerTransactionCode`) gửi vào URL BTC A (nhánh `other_organization`) rồi ký lại gửi vào URL BTC B → B vẫn `paid`.
  - #20 test: credential không giải mã được → IPN 500, không lưu, Đơn vẫn `pending`.

**Acceptance Criteria:**
- Given bất kỳ nhánh IPN nào, when xử lý xong, then `sold + held ≤ capacity`, `held` mỗi Hạng vé bằng tổng Vé của các Đơn `pending`, và mỗi Đơn có 0 Vé hoặc đủ N Vé.
- Given 10 IPN `success` hợp lệ gửi đồng thời cho một Đơn (lẫn cùng mã và khác mã), when xử lý, then đúng N Vé được phát một lần.
- Given body có khoảng trắng, thứ tự khóa và chuỗi `\uXXXX` khác `JSON.stringify` của chính nó, when ký trên đúng byte gửi đi, then được chấp nhận; ký trên bản serialize lại thì bị 401.
- Given worker khởi động với đủ env, when resolve DI, then có bộ xử lý IPN và `OrderPayments`; thiếu `TINGEE_*` hay `TICKET_QR_KEYS` thì `ConfigError`.

## Implementation Notes

Vòng 1 (đã revert sau review, code ở `wip/3-5-ipn-vong-1`):

- `markPaid`: nhánh `ipn` dùng `clock_timestamp()` một lần sau khi khóa Sự kiện cho cả mốc so `effective_end_at`, `issued_at` và `paid_at` khi Tingee không báo. `reconciliation`/`manual` vẫn ném "chưa hỗ trợ" (4.1/4.4 mở). `OrderPaymentsModule` (trong `mark-paid.ts`) cung cấp `OrderPayments` cho `OrderingModule`, `PaymentProcessingModule` và worker. `orderForPayment(db, code)` là read model để `payment` chọn nhánh mà không đọc bảng `orders`.
- Schema IPN (`TingeeIpn`): ngoài `providerTransactionCode`, `status = success` còn bắt buộc `paidAmount` (thiếu → 400); `paidAt` phải là ISO 8601 có múi giờ (tài liệu Tingee: `…Z`), sai → 400; chuỗi rỗng coi như `null`; `merchantId` (số) lưu dạng chuỗi.
- 413 dùng mã `VALIDATION_FAILED` với status 413 (không thêm mã mới). `error.filter.ts` không cần sửa: `IPN_SIGNATURE_INVALID` đi qua `AppError` với message riêng.
- Parser JSON toàn cục: `json.type` là `parsesAsJson` (trong `identity.module.ts`): `application/json` như mặc định, trừ đường dẫn có tiền tố `TINGEE_IPN_PATH`, so chữ thường vì router Express không phân biệt hoa thường. Bỏ `rawBody: true` (không còn ai dùng `req.rawBody`). Handler IPN: `ipnKey` sai dạng (không phải base64url ≤ 128 ký tự) → 404 không tra DB; body đã bị đọc trước handler → 500.
- `ipnRecipientOf` giải mã mọi credential của BTC một lần; ciphertext hỏng → `SecretBoxError` → 500 (Tingee gửi lại).
- Log: thêm `req.headers["x-signature"]` vào danh sách che của pino. Log xử lý IPN gồm `{organizationId, paymentEventId, orderCode (chỉ khi đúng định dạng Tickee), kind, status, branch}`; warn với nhánh 1–3, kết quả `markPaid` khác `paid` và `unknown_status`.
- Test fixture `linkPayoutAccount` giờ sinh `tingee_ipn_key` như luồng kết nối 2.6 (`ipnKeyOf` đọc lại). `roles.process.test.ts` (worker chạy thật) thêm ba biến mới.

Vòng 2 (ràng secret cũ và bản vá review vòng 1, dựng lại trên code vòng 1):

- Ràng secret cũ: `ipnRecipientOf` trả `credentials: {id, secretToken, current}[]`. `checkIpnSignature` trả `{ok, current: true}` khi khớp secret hiện hành (không ràng gì thêm), hoặc `{ok, current: false, retiredCredentialIds}` với **mọi** credential cũ khớp (BTC có thể từng nhập lại cùng Secret Token). Controller ràng bằng `orderForPayment` (`payoutAccountId`) → `payoutAccountCredentialOf` (organizer, mới). Ràng chạy ngoài transaction xử lý: `orders.payout_account_id` chỉ ghi một lần ở TX2 (CAS `payment_link IS NULL`) và `payout_accounts.tingee_credential_id` không bao giờ đổi, nên không có đua.
- `reason` khi không ràng được: `retired_key_unreadable_body` · `retired_key_invalid_order_code` · `retired_key_order_not_found` · `retired_key_other_organization` · `retired_key_order_without_link` · `retired_key_other_credential`. Body hỏng mà chỉ khớp key cũ → 401 (không phải 400): IPN chưa được xác thực thì không coi là "chữ ký đúng".
- #9: trường phụ dùng `.catch(null)`; `paidAmount`/`providerTransactionCode` đọc thô rồi kiểm ở `transform`: chặt với `success`, lỏng (sai → `null`) với IPN trạng thái. `paidAt` không có múi giờ → `null` (không đoán), `paid_at` của Đơn lấy đồng hồ DB.
- #22: `requestPath` lấy `pathname` bằng `new URL(raw, 'http://localhost')` (lỗi parse → cắt chuỗi như cũ).
- Spine AD-7: ngoài câu khóa unique theo BTC (#6), thêm câu ràng secret cũ với Đơn để spine khớp quyết định A.

Sau review vòng 2 (bản vá #25, #30–#33):

- #25: `markPaid` nguồn `ipn` khóa dòng Đơn ngay sau khi khóa Sự kiện và trả `lost_race` khi Đơn không còn `pending`, trước ba bước kiểm. Dùng `FOR NO KEY UPDATE`, không dùng `FOR UPDATE`: INSERT `payment_events` đã giữ `FOR KEY SHARE` trên Đơn qua khóa ngoại `order_id`, nên `FOR UPDATE` làm hai IPN cùng Đơn deadlock (test 10 IPN đồng thời đã gặp).
- #30: `payoutAccountCredentialOf` chỉ trả id credential. #31: đếm phiên chờ khóa lọc theo `datname = current_database()`. #32: `expectStoredOnly` bỏ tham số thừa. #33: test hai credential trùng Secret Token (hiện hành + cũ; hai credential cũ).
- Kiểm chứng cuối (DB `tickee_test_s35`): `pnpm typecheck`, `pnpm lint:deps` pass; `pnpm test` pass (contracts 247, web 177, api 854).

## Spec Change Log

- **11/11/2026, sau review vòng 1: ràng secret cũ với Đơn.**
  - **Phát hiện:** Triage #1 (BH, EC). Secret của credential cũ được nhận vô thời hạn cho mọi Đơn, nên người giữ secret bị lộ vẫn ký giả được IPN `success` để lấy Vé cho Đơn tạo sau khi đổi key.
  - **Sửa:** Mason chọn phương án A. Khối frozen thêm quyết định "Ràng secret cũ với Đơn" và dòng Matrix "Key cũ cho Đơn mới"; Code Map và Tasks thêm phần ràng và 8 bản vá của vòng 1.
  - **Trạng thái tránh được:** đổi key không chặn được secret cũ bị lộ.
  - **KEEP** (vòng 1 làm tốt, phải giữ khi làm lại):
    - đọc byte thô sau khi tra `ipnKey` với parser JSON bỏ qua tiền tố IPN;
    - `checkIpnSignature` (timestamp ±10 phút, secret hiện hành trước);
    - schema `payment_events` (khóa unique theo BTC, các CHECK) và migration;
    - `IpnProcessor` một transaction với `INSERT … ON CONFLICT DO NOTHING` và tên nhánh;
    - `markPaid` nguồn `ipn` (kiểm hủy / lệch tiền / kết thúc trước CAS, `settleHeld`, `issued_at` = đồng hồ DB);
    - `markExpired`, `OrderPaymentsModule`, `PaymentProcessingModule`;
    - cấu hình worker và test DI;
    - hàm ký IPN của Tingee fake;
    - che `x-signature` trong log;
    - bộ test vòng 1 (`ipn`, `ipn-concurrency`, `mark-paid-ipn`, `ipn-fixtures`).

## Review Triage Log

Vòng 1 (review_loop_iteration 0). Nguồn: BH = Blind Hunter, EC = Edge Case Hunter, VG = Verification Gap.

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | BH, EC | Secret của credential cũ được nhận vô thời hạn cho mọi Đơn, kể cả Đơn tạo link sau khi đổi key: ai giữ secret cũ (lý do thường gặp để đổi key) vẫn ký giả được IPN `success` và lấy Vé không trả tiền | medium | `ipnRecipientOf` trả mọi secret; `checkIpnSignature` nhận bất kỳ secret nào khớp; không gì ràng secret cũ với `orders.payout_account_id`. Khối frozen ghi "secret hiện hành trước, rồi các credential cũ" mà không giới hạn; AD-35 chỉ cần key cũ cho Đơn có link tạo trước khi đổi key. Có nhiều cách hiểu (401 hay chỉ lưu khi lệch credential; IPN trạng thái có ràng không) | intent_gap |
| 2 | BH, EC | Một credential cũ không giải mã được (bỏ phiên bản khóa khỏi `TINGEE_CREDENTIAL_KEYS`) làm mọi IPN của BTC trả 500, kể cả IPN ký bằng secret hiện hành | low | Có thật (`secretBox.open` cho mọi dòng). Quy ước `TINGEE_CREDENTIAL_KEYS` là giữ khóa cũ tới khi không còn dòng nào dùng, nên chỉ gặp khi vận hành làm sai; sửa phải thêm nhánh bỏ qua dòng lỗi | reject |
| 3 | BH | Endpoint công khai giải mã mọi credential mỗi request, không giới hạn tốc độ | low | `ipnKey` 128 bit chỉ BTC và Tingee biết; mỗi request vài phép AES-GCM, rẻ hơn truy vấn DB đi kèm | reject |
| 4 | BH, EC | Nhánh `orphan` so đồng hồ lúc xử lý thay vì `paidAt`, nên IPN gửi lại sau sự cố gần giờ kết thúc thành `orphan` | false | Khối frozen và AC 3.6 chốt `now() > effective_end_at`; tiền về sau giờ kết thúc là ca hoàn tiền theo ý định | reject |
| 5 | BH, EC | `paidAt` không kiểm hợp lý (ở tương lai, trước lúc tạo Đơn) mà ghi thẳng vào `orders.paid_at` | low | Giá trị đến từ IPN đã qua chữ ký; hậu quả chỉ là số liệu thời gian lệch; sửa phải thêm guard | reject |
| 6 | BH | Spine lệch code: AD-7 còn ghi khóa unique toàn cục; AD-7 cho Đơn `expired` đi `markPaid`; AD-1 định nghĩa `orphan` = hết chỗ | low | Phần khóa unique đúng (Design Notes đã ghi bản chặt hơn, spine chưa sửa). Hai phần còn lại sai: Đơn `expired` thuộc nhánh tiền về muộn của 3.6; AC 3.6 dùng `orphan` cho cả Sự kiện đã kết thúc | patch (câu khóa unique ở AD-7) |
| 7 | BH, EC | HMAC tính trên chuỗi đã giải mã UTF-8, không trên đúng byte nhận được | low | Byte UTF-8 hợp lệ giải mã rồi mã hóa lại y hệt; Tingee gửi JSON UTF-8; chỉ lệch với byte UTF-8 hỏng, mà khi đó JSON cũng hỏng. Sửa phải đổi chữ ký hàm `verifySignature` | reject |
| 8 | BH | Sau 413/404 server vẫn đọc tiếp body, không đóng kết nối, không có timeout đọc body riêng | low | Như mọi route khác, giới hạn bởi `requestTimeout` của Node; không có khuếch đại riêng cho IPN | reject |
| 9 | BH | IPN đúng chữ ký nhưng sai một trường phụ (`paidAt` không có offset, `requestId`/`billId` dài, `merchantId` lạ) bị 400 cả gói; Tingee gửi lại rồi bỏ, Người mua đã trả mà không có Vé | medium | `TingeeIpn` kiểm chặt cả trường phụ. Định dạng thật của Tingee từng khác tài liệu (timestamp `create-link`, Story 3.4) | patch |
| 10 | BH | Thiếu test: IPN trạng thái cho Đơn của BTC khác; `no_credential`; `x-signature` viết hoa; nhánh 500 khi body đã bị đọc | medium | Phần IPN trạng thái cho Đơn BTC khác trùng #16 (gộp). Ba phần còn lại low: BTC có `ipnKey` luôn có credential (sinh cùng lúc); hai nhánh kia là phòng thủ | patch (phần gộp #16); phần còn lại reject |
| 11 | BH | Test "đồng thời" success + expired không ép hai request chồng nhau | low | Đúng là chỉ `Promise.all`; bất biến được kiểm dù thứ tự nào thắng, CAS giống mẫu đã test ở 3.2/3.3 | reject |
| 12 | BH | Không có `lock_timeout`/`statement_timeout`; `FOR SHARE` trên Sự kiện chờ sau `FOR UPDATE` khi BTC sửa Sự kiện | low | Transaction sửa Sự kiện ngắn; chờ vài ms, không vô hạn | reject |
| 13 | BH | Local không hoàn tất được Đơn có phí: Tingee fake không gửi IPN | low | Có thật nhưng nằm ngoài phạm vi spec (công cụ dev); sửa là thêm tính năng | reject (đề xuất follow-up) |
| 14 | BH, EC | `status` khác hoa thường (`SUCCESS`, `cancelled`) thành `unknown_status`: tiền về mà không phát Vé; log IPN trạng thái gộp `stored` ở mức info | maybe-false | Tài liệu Tingee ghi `success`/`expired`/`canceled` chữ thường. Cần IPN thật từ Tingee UAT để biết; nếu đúng thì medium. Phần log gộp: low | defer |
| 15 | BH | Thiếu index `(organization_id, provider_order_id)` cho dòng `payment` | low | Chưa có truy vấn nào ngoài test; 3.6/4.1 thêm index khi có truy vấn | reject |
| 16 | VG | IPN trạng thái ký đúng gửi vào URL BTC A với mã Đơn `pending` của BTC B: không test nào khóa việc không được hết hạn Đơn của B | medium | Đã kiểm (VG): mọi `statusIpn` trong test dùng Đơn của chính BTC; đổi `own` thành `order` vẫn qua hết | patch |
| 17 | VG | Lỗi xử lý sau khi đã insert event chưa test ở biên IPN (5xx, rollback event, gửi lại thành công) | medium | Đã kiểm (VG): chỉ `mark-paid-ipn.test.ts` ép lỗi, gọi trực tiếp, không qua HTTP | patch |
| 18 | VG | Không test `payment_events` chỉ cho INSERT/SELECT với `tickee_app` | low | Đã kiểm (VG): bảng append-only khác đều có test 42501 | patch |
| 19 | VG | Không test khóa chống lặp tính theo BTC | medium | Đã kiểm (VG): không test nào gửi cùng `providerTransactionCode` tới hai BTC | patch |
| 20 | VG | Credential không giải mã được → 500 chưa có test ở đường IPN | low | Đã kiểm (VG): chỉ có ở đường `create-link` | patch |
| 21 | EC | Client ngắt kết nối trong lúc tra `ipnKey`: `readRawBody` gắn listener sau khi request đã hủy, promise không bao giờ kết thúc | low | Có thật (`close` đã phát trước khi gắn). Tra `ipnKey` mất vài ms nên hiếm gặp; sửa là thêm guard | reject |
| 22 | EC | Request dạng absolute-form (`POST http://host/v1/payments/…`) làm `parsesAsJson` không nhận ra tiền tố IPN, parser JSON đọc mất body, IPN trả 500 | low | `originalUrl` giữ nguyên URL tuyệt đối; router Express vẫn khớp. Sửa trực tiếp: lấy `pathname` bằng `new URL` | patch |
| 23 | EC | Test concurrency để client giữ khóa `FOR UPDATE` khi `expect.poll` lỗi | low | Chỉ xảy ra khi test đã fail | reject |
| 24 | EC | Task ghi kéo theo `error.filter.ts` nhưng file không đổi | false | Sau E2-5, `MESSAGES` chỉ còn 5 mã; `AppError` tự mang message, filter dùng `exception.status` | reject |

Vòng 2 (review_loop_iteration 1).

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 25 | BH, EC | `markPaid` nguồn `ipn` kiểm hủy / lệch tiền / kết thúc trước khi biết Đơn còn `pending`: hai IPN khác mã chồng nhau thì bên thua (lệch tiền) nhận `mismatch` thay vì `lost_race`, trái thứ tự kiểm (trả trùng đứng trước lệch tiền) mà 3.6 sẽ dựa vào | medium | `mark-paid.ts`: đọc Đơn không khóa, khóa Sự kiện `FOR SHARE`, rồi ba lệnh `return` trước CAS; `ipn-processor.ts` đọc `own.status` không khóa trước khi insert | patch |
| 26 | BH | Secret cũ có hiệu lực vô thời hạn với Đơn cũ: người giữ secret lộ gửi được vô số IPN `success` mã mới, mỗi cái thành một dòng `payment_events` (3.6 sẽ thành mục `duplicate_payment`) | low | Có thật nhưng đúng quyết định A (không giới hạn thời gian). Cần secret cũ bị lộ; hậu quả ở 3.5 chỉ là dòng lưu thêm; thêm cửa sổ thời gian là thêm luật. Xem lại khi 3.6 tạo `review_item` | reject |
| 27 | BH | `payment_events` và log xử lý không ghi credential nào đã xác thực IPN, nên sau khi lộ key không biết IPN nào được nhận bằng secret cũ | low | Có thật; muốn sửa phải thêm cột và tham số qua lõi xử lý. IPN chỉ nhận bằng secret cũ khi Đơn có link tạo bằng chính credential đó, nên suy ra được từ `orders.payout_account_id` | reject |
| 28 | BH | Spine: AD-1 vẫn định nghĩa `orphan` = hết chỗ; bảng AD-7 vẫn cho Đơn `expired` đi `markPaid` | false | carried #6: hai phần này đã xét là sai ở vòng 1 (Đơn `expired` thuộc nhánh tiền về muộn của 3.6; AC 3.6 dùng `orphan` cho cả Sự kiện đã kết thúc) | reject |
| 29 | BH, EC | Giải mã mọi credential mỗi request; một credential cũ không giải mã được làm mọi IPN của BTC trả 500 | low | carried #2, #3: code vẫn như vòng 1 mô tả | reject |
| 30 | BH | `payoutAccountCredentialOf` trả `organizationId` mà nơi gọi duy nhất không dùng | low | `ipn.controller.ts` chỉ đọc `credentialId`. `orders.payout_account_id` luôn lấy từ tài khoản mặc định của chính BTC của Đơn (TX2, 3.4), nên chỉ cần bỏ trường thừa | patch |
| 31 | BH | Test concurrency đếm phiên chờ khóa trên cả cụm Postgres (`application_name = 'tickee-api'`), không lọc theo DB hiện tại; worktree khác chạy test song song làm đếm sai | medium | `ipn-concurrency.test.ts` `waitingOnLocks` không có `datname = current_database()`; nhiều worktree dùng chung một Postgres (DB `tickee_test_s35` riêng) | patch |
| 32 | BH | Helper `expectStoredOnly` nhận `credential`, `key` nhưng luôn đọc theo `org.orgId` | low | Có thật trong `ipn.test.ts`; sửa trực tiếp bằng cách bỏ tham số thừa | patch |
| 33 | BH, VG | Không test hai credential trùng Secret Token (hiện hành + cũ trùng secret phải nhận như hiện hành; hai credential cũ trùng secret, Đơn gắn credential cũ hơn phải nhận). Thiếu test đơn vị `checkIpnSignature` (biên ±10 phút, `no_credential`) | medium | Đã kiểm (VG): mọi test dùng secret khác nhau; `replaceKey` không chặn nhập lại cùng key. Đổi `.filter` thành `.find` hay thử secret cũ trước vẫn qua hết test. Phần biên ±10 phút và `no_credential`: low (`no_credential` carried #10) | patch (phần trùng secret); phần còn lại reject |
| 34 | BH | `settleHeld`/`releaseHeld` không kiểm số dòng cập nhật; thiếu dòng tồn kho thì vẫn phát Vé mà `sold` không đổi | false | Trạng thái không xảy ra: dòng tồn kho tạo cùng Hạng vé trong flow `createTicketType`, chỉ xóa cùng Hạng vé, mà Hạng vé đã có `order_items` không xóa được (`409 TICKET_TYPE_IN_USE`) | reject |
| 35 | BH | `payment/index.ts` xuất cả chi tiết nội bộ (hằng số, schema, kiểu nhánh) ra ngoài mô-đun | low | Ngoài mô-đun chỉ dùng `PaymentModule`, `PaymentProcessingModule`, `IpnProcessor`; dependency-cruiser vẫn chặn hướng phụ thuộc sai. Chưa có tác hại cụ thể | reject |
| 36 | BH | Log từ chối thiếu ngữ cảnh: `unknown_ipn_key` không có dấu vết khóa; `retired_key_*` không có mã Đơn | low | Chỉ là log; thêm khi vận hành thật cần (Story 4.6 giám sát) | reject |
| 37 | BH | Kiểm cấu hình worker thiếu `TINGEE_*`/`TICKET_QR_KEYS` có ở cả `config.test.ts` lẫn `worker.test.ts` | low | Trùng nhưng vô hại | reject |
| 38 | EC | `orphan` so đồng hồ xử lý thay vì `paidAt` | false | carried #4 | reject |
| 39 | EC | `status` khác hoa thường thành `unknown_status` | maybe-false | carried #14: đã ghi `deferred-work.md`, không ghi lại | defer (đã ghi ở vòng 1) |
| 40 | EC | IPN ngoài Tickee có `orderId` dạng số, dài hơn 200 ký tự, hay `status` dài hơn 50 ký tự → 400 vĩnh viễn, không lưu | low | Tài liệu Tingee: `orderId` là chuỗi ≤ 100 ký tự (chữ, số, `-`, `_`); `status` là `success`/`expired`/`canceled` | reject |
| 41 | EC | HMAC tính trên chuỗi đã giải mã UTF-8 | low | carried #7 | reject |

## Design Notes

- **Khóa unique theo BTC:** mỗi BTC giữ secret của chính mình, nên có thể tự ký IPN với `providerTransactionCode` bất kỳ. Nếu khóa unique toàn cục, BTC A có thể "chiếm" trước mã giao dịch thật của BTC B, làm IPN thật của B bị coi là lặp. Thêm `organization_id` vào khóa chặn đường này. Đây là bản chặt hơn so với AC.
- **Nhánh 3.6 ở 3.5 chỉ lưu và log:** bất biến "không phát Vé khi lệch tiền, Sự kiện hủy, đã kết thúc" giữ ngay từ 3.5. Bất biến "không khoản tiền nào im lặng" do 3.6 đóng; bán Vé có phí ở Closed Beta vẫn bị chặn tới lúc đó.
- **`markPaid` tự kiểm hủy / lệch tiền / kết thúc:** đúng các kết quả của AD-1. Duyệt tay (4.4) và Đối soát bù (4.1) dùng lại mà không phải chép thứ tự kiểm.
- **Đọc body sau khi tra `ipnKey`:** parser toàn cục không chạm route IPN, nên `ipnKey` lạ trả 404 trước khi đọc một byte nào.

## Verification

**Môi trường test:** worktree này dùng DB riêng `tickee_test_s35` (đã tạo, cùng quyền như `tickee_test`) để không đụng test của worktree khác. Chạy mọi lệnh test kèm
`DATABASE_URL=postgresql://tickee_app:tickee_app@localhost:5432/tickee_test_s35 MIGRATION_DATABASE_URL=postgresql://tickee_migrator:tickee_migrator@localhost:5432/tickee_test_s35`.

**Commands:**
- `pnpm test` -- pass (contracts, api với Postgres thật và Tingee fake, web).
- `pnpm typecheck && pnpm lint:deps` -- pass; `payment` chỉ gọi `ordering`, `organizer`, `tingee` qua `index.ts`.
