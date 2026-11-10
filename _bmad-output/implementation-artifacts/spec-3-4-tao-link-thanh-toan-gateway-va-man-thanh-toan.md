---
title: 'Story 3.4: Tạo link thanh toán Gateway và màn thanh toán'
type: 'feature'
created: '2026-11-10'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'ddd9f40091d4f752ebeef32b27cc11d005a29ae7'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-tickee-2026-10-27/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-tickee-2026-10-27/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sau 3.2, Đơn có phí dừng ở `pending` mà không có link thanh toán. Người mua không trả tiền được, còn Trang Đơn chỉ ghi "Đang giữ chỗ". Adapter Tingee chưa có `create-link`, chưa ký được timestamp UNIX ms, và chưa phân biệt lỗi rõ ràng với kết quả mơ hồ.

**Approach:** Sau TX1, `ordering` lấy tài khoản nhận tiền mặc định cùng credential đã giải mã (qua `organizer`), rồi gọi `tingee.createPaymentLink()` ngoài transaction với timeout 5 giây. Sau đó TX2 lưu link bằng CAS và enqueue job hết hạn (c) trên queue sẵn có. `BuyerOrder` có thêm khối `payment`. Trang Đơn hiện màn thanh toán theo DESIGN/EXPERIENCE và redirect toàn trang sang Gateway. Thêm `POST /v1/me/orders/:code/payment-link` để thử lại.

## Boundaries & Constraints

**Always:**
- **Request `create-link`** theo tài liệu Tingee công khai (`developers.tingee.vn/docs/payment-gateway/create-payment-link`):
  - Body: `requestId` là UUID v4 sinh mới mỗi lần; `orderId` = mã Đơn; `amount` = `total_amount`; `vaAccountNumber` = VA của tài khoản mặc định; `expireInMinute` = 15; `returnUrl` = `{WEB_ORIGIN}/orders/:code`; `description` = `Thanh toán Đơn {code}`.
  - Không gửi `merchantId`, `customerEmail`.
  - Header `x-request-timestamp` là UNIX ms. Chữ ký HMAC-SHA512 như các API khác. Timeout 5 giây.
  - Thành công là `{ code: '00', data: <checkout URL> }`. Tingee không trả hạn link.
- **Phân loại kết quả** (chỉ `tingee` biết mã Tingee):
  - **ok**: `code = '00'` và `data` là URL.
  - **rõ ràng**: Tingee trả JSON có `code ≠ '00'`.
  - **mơ hồ**: timeout, lỗi mạng, HTTP ≠ 200, JSON hỏng, hoặc `'00'` mà `data` không phải URL.
- **Một lần gọi tại một thời điểm.** Trước khi gọi, CAS giành lượt bằng cột `payment_link_attempt_at`, điều kiện: `status='pending' AND payment_link IS NULL AND payment_link_attempt_at IS NULL AND expires_at > clock_timestamp()`. TX1 của Đơn có phí đặt sẵn lượt cho lần gọi đầu. Chỉ kết quả rõ ràng mới trả lượt (đặt NULL). Nếu lượt không được trả (vd. process chết giữa chừng) thì không bao giờ gọi lại `orderId` đó; job (a) cho Đơn hết hạn.
- **ok → TX2:**
  - `UPDATE orders SET payment_link, payout_account_id, expires_at = payment_link_attempt_at + 15 phút WHERE id AND status='pending' AND payment_link IS NULL`.
  - Enqueue job (c) bằng chính `tx`, `startAfter = expires_at + 5 phút`.
  - Cập nhật 0 dòng (job (a) đã thắng) → không trả URL.
- **Rõ ràng, mã nhóm tạm ngừng** (`MERCHANT_SUSPENDED`, `TINGEE_CREDENTIAL_INVALID`, `PAYMENT_ACCOUNT_NOT_ALLOWED`), hoặc BTC không còn tài khoản mặc định lúc tạo link → trong một transaction: CAS `pending → expired` (chưa có link), nhả `held`, đặt `payment_link_error = 'sales_paused'`.
  - `PAYMENT_ACCOUNT_NOT_ALLOWED` là mã miền mới cho Tingee `2023` (VA chưa được cho phép trên Gateway) và nhóm VA lỗi `1023`/`1045`/`1024`/`1072`. Mason chốt 10/11: các mã này đi nhánh tạm ngừng, không cho thử lại.
- **Rõ ràng, mã khác** → trả lượt, đặt `payment_link_error = 'provider_error'`, Đơn vẫn `pending`.
- **Mơ hồ** → giống nhánh tạm ngừng nhưng `payment_link_error = 'timeout'`.
- **Log cảnh báo** mỗi lần Tingee từ chối hoặc kết quả mơ hồ, gồm `organizationId`, mã Đơn, mã Tingee/loại lỗi. Không log credential, checkout URL, tên chủ tài khoản.
- **BTC chưa được báo ở 3.4** (Mason chốt 10/11): log cảnh báo là đủ. Banner cho Owner kèm câu nhắc cấp quyền "Cổng thanh toán" (`1133`) và cho phép VA trên portal (`2023`) làm cùng `payment_service_status` ở Story 4.2.
- **Hai điểm vào dùng chung một hàm "bảo đảm link":** `POST /v1/events/:slug/orders` (tạo mới hoặc gửi lại cùng khóa) và `POST /v1/me/orders/:code/payment-link`. Cả hai trả `BuyerOrder` (tạo mới 201, còn lại 200).
  - Gửi lại cùng khóa cho Đơn chưa có link mà còn lượt thì cũng thử tạo link.
  - Đơn không đủ điều kiện → không gọi Tingee, trả `BuyerOrder` hiện tại.
  - Đơn của người khác → 404 `ORDER_NOT_FOUND`.
- **Job hết hạn** dùng lại queue `ordering.expire-order`; payload thêm cờ để phân biệt (a) với (c).
  - (c) CAS `status='pending' AND payment_link IS NOT NULL AND expires_at + 5 phút < now()`, rồi nhả `held`.
  - `expireStalePending` trong `create()` xử lý cả Đơn loại (c).
- **`BuyerOrder.payment`** (null khi Đơn tổng 0đ):
  - `checkoutUrl`: chỉ có khi `pending` và đã có link.
  - `linkError`: `provider_error` | `sales_paused` | `timeout` | null.
  - `recipient { organizationName, accountName, bankName }`: lấy từ tài khoản đã chụp; chưa chụp thì lấy tài khoản mặc định hiện tại; không còn tài khoản thì hai trường sau là null.
- **Màn thanh toán** (`pending`), theo DESIGN.md `payment-summary` và EXPERIENCE.md "Niềm tin khi thanh toán". Thứ tự từ trên xuống:
  1. Tên Sự kiện.
  2. Stage: "Số tiền cần trả", số tiền, `countdown-chip`, "Mã Đơn" + mã.
  3. `recipient-trust-block`: icon khiên, "Tiền chuyển thẳng cho **{BTC}**", hai hàng "Chủ tài khoản" và "Ngân hàng".
  4. Link "Chính sách hoàn vé" mở `Sheet` (ẩn khi `refundPolicy` null).
  5. Dòng chờ "Đang chờ thanh toán — vé sẽ tự hiện khi BTC nhận được tiền."
  6. Nút.
  7. "Tickee không giữ tiền của bạn".
  8. Tóm tắt Đơn ở cuối.

  Mục 1–7 thấy được mà không cần cuộn ở 375×667. Không cuộn ngang ở 320px.
- **`countdown-chip`** "Giữ chỗ còn mm:ss":
  - Đếm tới `expiresAt`, bù lệch giữa `serverNow` và đồng hồ máy.
  - Chữ coral, viền `brand-border`, không đổi đỏ, không nhấp nháy.
  - Một vùng `aria-live="polite"` riêng chỉ đọc ở mốc 5 phút và 1 phút.
- **Đã có link:**
  - Nút `primary-on-light` "Thanh toán": hiện spinner rồi `window.location.assign(checkoutUrl)`, không popup.
  - Đồng hồ về 0 mà Đơn vẫn `pending`: chip ghi "Đang xác nhận thanh toán", dòng chờ đổi thành "Đang xác nhận thanh toán. Nếu bạn đã trả, vé sẽ tự hiện — đừng trả lại.", ẩn nút.
- **Chưa có link:**
  - Thay nút bằng "Chưa tạo được link thanh toán" + nút `secondary` "Thử lại". Nút này gọi endpoint thử lại, có spinner, chặn bấm lặp.
  - Trust block và đếm ngược vẫn hiện.
  - Đồng hồ về 0 thì ẩn "Thử lại" và chờ máy chủ báo `expired`.
- **Đơn `expired`:**
  - `linkError = 'sales_paused'`: "Sự kiện tạm ngừng bán. Bạn thử lại sau nhé." + nút về trang Sự kiện.
  - Các trường hợp `expired` khác giữ màn Hết hạn của 3.2.

**Never:**
- Không có HTTP trong `db.transaction`. Không trả checkout URL trước khi TX2 commit. Không gọi lại `create-link` cùng `orderId` sau kết quả mơ hồ hoặc khi lượt chưa được trả.
- Không bật `payment_service_status`, không tạm ngừng các Sự kiện khác của BTC (Epic 4).
- Không làm: IPN (3.5); realtime, `buyerStatus`, `reassurance-line`, dòng mất mạng (3.7); "Vé của tôi" (3.9). Không đổi luồng Đơn 0đ của 3.3.
- Không thêm queue pg-boss mới (gate E2-5 phần API). Worker không cần cấu hình Tingee.
- Không lưu credential đã giải mã. `tingee` vẫn là mô-đun duy nhất gọi Tingee.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Tạo link thành công | Đơn có phí; BTC có tài khoản mặc định; Tingee trả `00` | 201 `pending`, `payment.checkoutUrl` = `data`. DB có link, `payout_account_id`, `expires_at` ≈ lượt + 15 phút; có job (c). Fake nhận đúng body (không có `merchantId`), timestamp UNIX ms, chữ ký hợp lệ | — |
| Lỗi rõ ràng | Tingee trả mã thường (vd. `1006`) | 201 `pending`, `checkoutUrl` null, `linkError = 'provider_error'`, `held` giữ nguyên | Web: "Chưa tạo được link thanh toán" + "Thử lại" |
| Thử lại thành công | Như trên; gọi thử lại trong 60 giây, Tingee trả `00` | 200 `pending` có `checkoutUrl` | — |
| Thử lại song song | Hai request thử lại cùng lúc | Đúng một lời gọi `create-link`; cả hai trả 200 | — |
| Timeout | Tingee treo quá 5 giây | 201 `expired`, `linkError = 'timeout'`, đã nhả `held`; không gọi lại | Web: màn Hết hạn |
| Tạm ngừng | Tingee trả `1007`/`1033`/`1034`/`92`/`97`/`1009`/`1133`/`2023`/`1023`/`1045`/`1024`/`1072`, hoặc BTC vừa hủy liên kết hết tài khoản | 201 `expired`, `linkError = 'sales_paused'`, đã nhả `held` | Web: "Sự kiện tạm ngừng bán. Bạn thử lại sau nhé." |
| Thua job (a) | Đơn đã `expired` trước TX2 | `BuyerOrder` `expired`, không có URL | — |
| Gửi lại cùng khóa | Đơn đã có link | 200 cùng Đơn, cùng URL; không gọi Tingee | — |
| Hết hạn (c) | Đơn có link, đã quá `expires_at` + 5 phút | Job đặt `expired`, `held -= n` | Chạy sớm thì retry như (a) |
| Đơn của người khác | Gọi thử lại Đơn của Người mua khác | — | 404 `ORDER_NOT_FOUND` |
| Đồng hồ về 0 | Có link, Đơn vẫn `pending` | Chip và dòng chờ ghi "Đang xác nhận thanh toán…", ẩn "Thanh toán" | — |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/ordering/orders.service.ts`:
  - `create()` 187-231 chạy theo thứ tự: replay `byKey` 196 → `expireStalePending` 202 (định nghĩa 404-418, mới chỉ xử lý Đơn chưa có link) → `pendingOf` → `queues.ready()` 211 → `limiter.consume` 212 → TX1 216 → bắt unique 217-230.
  - `placeOrder` 250-328, nhánh có phí: `holdInventory` 269, `insertOrder` 272-288 (`expires_at` ở 287), `enqueueOrderExpiry` 319.
  - `view()` 433-468 dựng `BuyerOrder`.
- `apps/api/src/modules/ordering/orders.controller.ts`: `POST events/:slug/orders` 42-54 (`res.status` 201/200, header `Idempotency-Key`), `GET me/orders/:code` 60. Mọi route `no-store`.
- `apps/api/src/modules/ordering/order-jobs.ts`:
  - `ExpireOrderPayload` 38, `enqueueOrderExpiry` 50-55 (không có singleton key, nên thêm job (c) cho cùng Đơn vẫn được).
  - `expireOrder` 66-102 (CAS (a) có `payment_link IS NULL`, trả `not_yet`/`skipped`). `OrderQueues.ready()` 108-131.
  - `releaseHeld` ở `inventory.service.ts:161-168`.
- `apps/api/src/modules/ordering/schema.ts` 91-144: đã có `payment_link` 112, `expires_at` 113, `refund_policy` 108; chưa có `payout_account_id`. Migration kế tiếp là `drizzle/0018`. Có thể FK sang `payout_accounts` theo mẫu `organization_id`.
- `apps/api/src/modules/ordering/ordering.module.ts`: `forRoot(config)` mới chỉ nhận `BETTER_AUTH_SECRET`. Thêm `WEB_ORIGIN`, `TINGEE_CREDENTIAL_KEYS` (dựng `SecretBox` bằng `parseCredentialKeys` của `platform/crypto/secret-box.ts`). Gọi ở `api.module.ts`.
- `apps/api/src/modules/organizer/`:
  - `payout-account.service.ts:606-645`: `currentCredential`, `tingeeCredentialOf` là private, dùng làm mẫu.
  - Schema `payout_accounts` (`schema.ts:146-181`): `is_default`, `retired_at`, `va_account_number`, `bank_name`, `account_name` (PII), `tingee_credential_id`.
  - `index.ts` đã export `organizationNameOf`. `module-graph.cjs:11` cho phép `ordering → organizer, tingee`.
- `apps/api/src/modules/tingee/`:
  - `tingee.client.ts`: interface 44-50 mới có `listAccounts`. `post()` 142-185 ký bằng `tingeeTimestamp()` và timeout của instance (15 giây); lỗi gom hết về `PAYMENT_PROVIDER_UNAVAILABLE` 158-184.
  - `signing.ts` (định dạng `yyyyMMddHHmmssSSS`).
  - `errors.ts` (bảng mã): bổ sung `1033` → `MERCHANT_SUSPENDED`, `1009` → `TINGEE_CREDENTIAL_INVALID`, `2023`/`1023`/`1045`/`1024`/`1072` → `PAYMENT_ACCOUNT_NOT_ALLOWED` (thêm vào `TingeeDomainError` và `DOMAIN_ERROR_MESSAGES`). Bảng này dùng chung với bước kết nối của 2.6.
- `apps/api/test/tingee-fake/server.ts`: `route()` 116-129 mới có `/v1/get-va-paging`; kiểm timestamp 156-162; `behavior` theo merchant (`suspended`, `forbidden`, `error`, `hang`). Mẫu dùng fake ở `test/organizer/payout-account.test.ts:91-114`.
- `apps/api/test/ordering/order-fixtures.ts:29-49`: `paidReadyOrg` để `is_default = false` và ciphertext giả. Test 3.4 cần tài khoản mặc định, ciphertext niêm bằng `testCredentialKey`, và merchant tương ứng trên fake.
- `packages/contracts/src/order.ts` 252-265 (`BuyerOrder` đã có `expiresAt`, `serverNow`, `refundPolicy`), `orderPath` 23. `errors.ts`: đã có `MERCHANT_SUSPENDED` 409, `TINGEE_CREDENTIAL_INVALID` 422, `PAYMENT_PROVIDER_UNAVAILABLE` 503. Thêm mã mới thì sửa ba chỗ: `ErrorCode`, `app-error.ts` `DEFAULT_STATUS`, `error.filter.ts` `MESSAGES`.
- Web:
  - `apps/web/app/(buyer)/orders/[code]/order-view.tsx`: `StatusBlock` 21-40, polling 5 giây khi `pending` (20, 48-52), `aria-live` 96-98, tóm tắt 99-126.
  - `checkout-order-form.tsx` `onSuccess` 200-207 đã `setQueryData` rồi chuyển sang Trang Đơn (giữ nguyên).
  - `lib/order/api.ts` (`apiRequest`, `buyerOrderQueryKey`).
  - Dùng lại `components/tickee/{stage-block,status-banner}.tsx`, `components/ui/{sheet,button}.tsx`, `formatVnd` (`contracts/src/money.ts`). Token `text-amount`, `text-code`, `--brand-border` ở `globals.css:45` (kiểm alias `border-brand-border`).
  - Chưa có `countdown-chip`, `recipient-trust-block` hay hook đếm theo `serverNow`. `useSecondsUntil` ở `login-form.tsx:79-88` chỉ để tham khảo.
- `apps/web/e2e/purchase.spec.ts`: `buyerOrder(patch)` 130-144, `mockOrders` 185-218 (thêm route `payment-link`), `expectNoHorizontalScroll` 892, mẫu viewport 375×667 ở 674 và 1064. Layout buyer có `SiteHeader min-h-18` và `pb-section`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{order,errors}.ts` + test: `BuyerOrderPayment`, `PAYMENT_LINK_ERRORS`, đường dẫn thử lại, mã lỗi `PAYMENT_ACCOUNT_NOT_ALLOWED` (kéo theo `app-error.ts` `DEFAULT_STATUS` và `error.filter.ts` `MESSAGES`).
- [x] `apps/api/src/modules/tingee/{tingee.client,signing,errors,index}.ts` + `test/tingee-fake/server.ts`:
  - `createPaymentLink(credential, input)` trả URL hoặc ném lỗi phân rõ rõ ràng/mơ hồ, kèm mã Tingee.
  - Timestamp UNIX ms, timeout 5 giây theo từng lời gọi.
  - Fake có route `create-link`: kiểm UNIX ms và chữ ký, ghi lại body, hỗ trợ các `behavior`.
- [x] `apps/api/src/modules/organizer/{payout-targets.ts,index.ts}`: `defaultPayoutTargetOf(db, secretBox, organizationId)` trả `{ payoutAccountId, vaAccountNumber, credential, accountName, bankName }` hoặc null; `payoutRecipientOf(db, { organizationId, payoutAccountId })` không có credential. `organizer` chỉ đọc, không giữ secret.
- [x] `apps/api/src/modules/ordering/{schema,payment-link,orders.service,orders.controller,order-jobs,ordering.module}.ts` + `drizzle/0018` + `api.module.ts`:
  - Cột `payout_account_id`, `payment_link_attempt_at`, `payment_link_error` (CHECK ba giá trị).
  - Hàm bảo đảm link; endpoint thử lại; TX1 đặt lượt; job (c); `expireStalePending` xử lý cả (c); `view()` trả `payment`.
- [x] `apps/api/test/ordering/{payment-link,payment-link-concurrency}.test.ts`, `order-fixtures.ts`, `test/tingee/*.test.ts`: mọi dòng Matrix; job (c) chạy sớm thì `not_yet`; đổi tài khoản mặc định giữa hai Đơn; bảng mã lỗi mới.
- [x] `apps/web/components/tickee/{countdown-chip,recipient-trust-block}.tsx`, `apps/web/lib/order/{api,use-server-countdown}.ts`, `app/(buyer)/orders/[code]/{order-view,order-payment}.tsx`: màn thanh toán, trạng thái lỗi link, trạng thái xác nhận, màn tạm ngừng, Sheet chính sách hoàn vé.
- [x] `apps/web/e2e/purchase.spec.ts`:
  - Ở 375×667, stage, trust block, link chính sách, dòng chờ, nút và chân đều nằm trong viewport.
  - "Thanh toán" điều hướng toàn trang tới `checkoutUrl`.
  - "Thử lại" gọi endpoint rồi hiện nút "Thanh toán".
  - Đồng hồ 0 (`page.clock`) hiện "Đang xác nhận thanh toán" và ẩn nút.
  - `sales_paused` hiện câu tạm ngừng. Không cuộn ngang ở 320px.

**Acceptance Criteria:**
- Given bất kỳ nhánh nào của hàm bảo đảm link, when nhánh đó kết thúc, then `sold + held ≤ capacity` và `held` của mỗi Hạng vé bằng tổng số Vé của các Đơn `pending` của Hạng vé đó.
- Given BTC đổi tài khoản mặc định sau khi Đơn A có link, when tạo Đơn B, then link của B ký bằng credential của tài khoản mới với VA mới, còn A giữ `payout_account_id` cũ.
- Given Tingee treo, when gửi Đơn, then API trả trong khoảng 6 giây và không có transaction nào mở trong lúc chờ Tingee.

## Implementation Notes

- Spec dài khoảng 2.700 từ, vượt ngưỡng 1.600 token. Mason chọn giữ nguyên ngày 10/11, vì đây là một mục tiêu xuyên lớp.
- Quyết định ngoài spec (subagent triển khai):
  - Đọc nơi nhận tiền lỗi (vd. `SecretBoxError` khi thiếu khóa giải mã): trả lượt, `provider_error`, Đơn vẫn `pending`, vì chưa gửi gì tới Tingee.
  - Với `create-link`, mọi HTTP ≠ 200 là mơ hồ, kể cả khi body có mã đã biết (theo đúng spec).
  - Các test 3.2/3.3 tạo Đơn có phí chạy với stub Tingee `rejectingTingee` (luôn trả `1006`), để Đơn vẫn `pending` không link như trước. `paidReadyOrg` nay tạo tài khoản mặc định với credential niêm thật.
  - Lỗi riêng của `Button` (`variant="link"` cỡ mặc định cao 50px vì `h-control-height` và `h-auto` cùng tồn tại) chưa sửa; link "Chính sách hoàn vé" dùng `size="sm"`.
  - Fake Tingee có thêm `GET /checkout/:orderId` (trang thanh toán giả có link quay về `returnUrl`) để dùng khi chạy local.
- Sau review vòng 1, đã vá 11 nhóm (triage #1–#11):
  - Trang Đơn có một vùng `aria-live` luôn gắn qua `pending → expired`.
  - Endpoint thử lại và gửi lại cùng khóa dùng chung bộ đếm `OrderRateLimiter` với tạo Đơn, chỉ khi Đơn đủ điều kiện gọi Tingee. Hệ quả: test 3.2 về gửi lại cùng khóa nay đếm 3 lượt.
  - Log kết quả mơ hồ có thêm `httpStatus` và mã Tingee.
  - `create-link` có `code` không phải chuỗi hay số → mơ hồ.
  - Web: hủy poll đang chạy trước khi "Thử lại"; đồng hồ không đọc mốc khi mount.
  - Thêm test cho nhánh credential không giải mã được, đua với job (a), và e2e Hết hạn do `timeout`.
- Kiểm chứng (session gốc chạy lại sau vòng vá): `pnpm test` pass (contracts 243, web 177, api 785); `pnpm typecheck`, `pnpm lint:deps` pass; `pnpm test:e2e` 688/688 pass. Lần chạy `pnpm test` song song với e2e có 2 test timeout ở `roles.process.test.ts` (CLI, không liên quan 3.4); chạy riêng file đó pass 21/21, chạy lại cả bộ một mình pass hết.

## Spec Change Log

## Review Triage Log

Vòng 1 (review_loop_iteration 0). Nguồn: BH = Blind Hunter, EC = Edge Case Hunter, VG = Verification Gap.

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | BH | Trình đọc màn hình không còn nghe `pending → expired`: nhánh `pending` không có vùng `aria-live` bao `StatusBlock`; poll đổi sang `expired` thì vùng live mới mount kèm sẵn nội dung | medium | `order-view.tsx`: nhánh `pending` trả `OrderPayment`, nhánh khác mới có `<div aria-live>`. Trước 3.4 vùng live mount sẵn cho cả hai trạng thái | patch |
| 2 | BH, EC | Endpoint thử lại và gửi lại cùng khóa không giới hạn tốc độ: mỗi lần Tingee từ chối thường thì lượt được trả, nên một Người mua gọi `create-link` liên tục bằng key của BTC suốt cửa sổ 60 giây | medium | `retryPaymentLink`, `withPaymentLink` không gọi `OrderRateLimiter`; `release()` đặt lượt về NULL ngay | patch |
| 3 | BH | Log kết quả mơ hồ chỉ có `reason`; HTTP status và mã trong body chỉ nằm trong `cause` | low | `payment-link.ts` log `{ reason }`; `CreateLinkError.ambiguous('http_status', 'HTTP …')`. Phần "HTTP 401 + 92 bị coi là mơ hồ" đúng spec (HTTP ≠ 200 là mơ hồ, Tingee luôn trả 200) | patch (chỉ phần log) |
| 4 | BH, VG | Nhánh đọc nơi nhận tiền lỗi (`SecretBoxError`) chưa có test; docstring `release()` sai ("mã thường") | medium | VG đã kiểm: không test nào tạo credential không giải mã được. Hành vi (giữ `pending`, `provider_error`, không gọi Tingee) là lựa chọn ghi lại của bước triển khai | patch (test + docstring) |
| 5 | BH, EC | Kiểu `OrderingConfig` có `WEB_ORIGIN`, `TINGEE_CREDENTIAL_KEYS` nhưng provider `ORDERING_CONFIG` chỉ có `BETTER_AUTH_SECRET` | low | `ordering.module.ts:39`; ai inject hai trường mới sẽ nhận `undefined` | patch |
| 6 | BH | Mã `1009`, `1033` trong bảng mã chỉ ghi "thêm ở Story 3.4", thiếu nghĩa | low | `tingee/errors.ts` | patch |
| 7 | EC | `code: null` (HTTP 200) bị coerce thành chuỗi `"null"` → `rejected` → trả lượt, có thể tạo link thứ hai cho cùng `orderId` | low | Đã chạy thử: `z.coerce.string()` cho `null` ra `"null"`; thiếu hẳn `code` thì envelope null → mơ hồ (đúng). Spec: JSON hỏng là mơ hồ | patch |
| 8 | EC | Poll 5 giây khởi chạy trước khi "Thử lại" xong có thể ghi đè kết quả thử lại bằng bản cũ chưa có link | low | `order-payment.tsx` `retry` không hủy query đang chạy; sửa bằng `cancelQueries` trong `onMutate` | patch |
| 9 | EC | Mount lại với dữ liệu cache cũ: khung đầu hiện số giây cũ và đọc nhầm mốc 5 phút | low | `useServerCountdown` `useState(() => receivedAt)`; ref `previous` của chip nhận giá trị cũ | patch |
| 10 | VG | Chưa test đua: job (a) hết hạn Đơn trước khi xử lý kết quả từ chối/mơ hồ/`1006` (đường 0 dòng của `expire()`/`release()`) | medium | VG đã kiểm: `afterNextLink` chỉ dùng với Tingee thành công | patch |
| 11 | VG, BH | Web chưa test Đơn `expired` + `linkError='timeout'` hiện màn Hết hạn thường (không phải màn tạm ngừng); chưa có e2e Checkout nhận `201 expired` | medium | VG đã kiểm: `purchase.spec.ts` chỉ có `linkError` null/`provider_error`/`sales_paused` | patch |
| 12 | BH | "Thử lại" không làm gì khi lượt đang bị giữ (`linkError` null, request khác đang gọi) và không báo gì khi thử lại vẫn lỗi | low | Chỉ gặp khi gửi lại cùng khóa song song hoặc process chết giữa lượt; sửa phải thêm trạng thái mới cho web | reject |
| 13 | BH | Thiếu CHECK cho cột mới (link ↔ `payout_account_id`, …) và index FK `payout_account_id` | low | Code luôn giữ các bất biến này; IPN tìm Đơn theo mã, không theo `payout_account_id`; thêm ràng buộc là thêm độ phức tạp | reject |
| 14 | BH | `recipient.accountName` (PII) trả cho mọi trạng thái, không chỉ `pending` | low | Tên chủ tài khoản được hiện có chủ đích cho mọi Người mua ở Checkout; giới hạn theo trạng thái phải đổi contract | reject |
| 15 | BH | Checkout URL chỉ kiểm http/https, không kiểm host | low | URL đến từ lời gọi HTTPS tới `TINGEE_BASE_URL` cấu hình sẵn; allowlist thêm cấu hình mới | reject |
| 16 | BH, EC | `expired` + `timeout` hiện "Hết thời gian giữ chỗ" dù giữ chỗ chưa hết | low | Đúng ý định đã chốt: EXPERIENCE.md:252 và khối frozen ("timeout → Hết hạn, mời mua lại"). Đổi câu chữ là quyết định UX | reject |
| 17 | BH | Quay về qua `returnUrl` vẫn thấy nút "Thanh toán" khi chưa có IPN | low | EXPERIENCE "Quay về từ Tingee" giữ màn Chờ thanh toán khi chưa có xác nhận; bán Vé có phí chưa mở trước 3.5 | reject |
| 18 | BH | spec `in-review` lệch sprint-status `in-progress`; 3-3 → `done`; task ghi `api.module.ts` nhưng không đổi | false | Sprint-status đồng bộ ở bước trình bày; 3.3 đã merge (PR #52); `api.module.ts` truyền nguyên `config` nên không cần đổi (sửa là sửa spec) | reject |
| 19 | BH | Định dạng timestamp cố định, không có công tắc cấu hình | low | Đã ghi vào kiểm tay UAT trước khi mở bán; công tắc là thêm cấu hình | reject |
| 20 | BH | `expire()` lặp CAS + `releaseHeld` của `expireOrder` | low | Hai hàm khác điều kiện (link NULL + ghi lý do); gộp là refactor, chưa chỉ ra chỗ nào sẽ lệch | reject |
| 21 | BH | Chú thích `grants.ts` cũ; `payout_account_id` UPDATE được; chú thích "gửi lại sau 2FA" chép nhầm | false | `grants.ts:28-29` đã ghi "(và cột thêm sau) ghi được"; TX2 phải UPDATE `payout_account_id` từ NULL; `Providers` gửi lại mọi request sau 2FA nên chú thích đúng | reject |
| 22 | EC | TX2/`release`/`expire` lỗi DB sau khi Tingee trả → 500, lượt không trả, link mồ côi | low | Lỗi DB hiếm; filter toàn cục log 500; lượt không trả là đúng thiết kế (không gọi lại), job (a) dọn sau 60 giây; URL chưa tới tay Người mua | reject |

## Design Notes

- **Vì sao `expires_at` = lượt + 15 phút:** Tingee không trả hạn link (`data` chỉ là URL). Lượt được đặt bằng đồng hồ DB trước khi gửi request, nên hạn của Tickee không bao giờ muộn hơn hạn thật của Tingee; job (c) còn cộng thêm 5 phút. Điều này lệch với câu "hạn link do Tingee trả" trong epics.
- **Vì sao trả `BuyerOrder` thay vì lỗi `ORDER_EXPIRED`/`MERCHANT_SUSPENDED`:** sau TX1 thì Đơn đã tồn tại, và gửi lại cùng khóa phải trả đúng Đơn đó. Dùng một kiểu phản hồi thì web chỉ cần chuyển tới Trang Đơn như hiện nay. `linkError` nằm trong DB, nên tải lại trang vẫn hiện đúng màn.
- **Vì sao lượt không có thời hạn:** Tingee chưa nói gọi trùng `orderId` thì sao (spine:541). Lượt bị kẹt chỉ làm mất một Đơn đang giữ chỗ 60 giây; còn gọi trùng có thể sinh hai link trả được tiền.
- **Mâu thuẫn trong tài liệu Tingee:** trang `create-link` ghi timestamp là UNIX ms, nhưng bảng lỗi (mã `90`) ghi `yyyyMMddHHmmssSSS`. Spec theo trang `create-link` và spine:179; phải kiểm lại trên UAT.

## Verification

**Commands:**
- `pnpm test`: pass (contracts, api với Postgres thật và Tingee fake, web vitest).
- `pnpm typecheck && pnpm lint:deps`: pass. `ordering` chỉ phụ thuộc `organizer` và `tingee` qua `index.ts`.
- `pnpm test:e2e`: pass (`purchase.spec.ts` và các spec cũ).

**Manual checks (if no CLI):**
- Trên UAT, bằng key thật có quyền "Cổng thanh toán": tạo Đơn có phí → `create-link` trả `00` (xác nhận timestamp UNIX ms) → "Thanh toán" mở trang Tingee. Tên người nhận trên trang Tingee khớp `recipient-trust-block`.
