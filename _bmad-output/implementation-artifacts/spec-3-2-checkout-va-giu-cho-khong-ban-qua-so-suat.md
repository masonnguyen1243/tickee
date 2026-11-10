---
title: 'Story 3.2: Checkout và Giữ chỗ không bao giờ bán quá số suất'
type: 'feature'
created: '2026-11-10'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '916e6ba0cb587147e8d68124e77b94fa4e02bdf0'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-tickee-2026-10-27/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Checkout của 3.1 chỉ có tóm tắt Đơn. Chưa có form mua, chưa tạo Đơn, chưa Giữ chỗ, nên chưa có nền cho 3.3 (miễn phí) và 3.4 (link thanh toán). Checklist E2-6 cho 3.2 cũng chưa có code: kiểm lại `sellability` lúc đặt Đơn (khóa Sự kiện trước, giới hạn Vé/Đơn), bản chụp chính sách hoàn vé, xóa Hạng vé đã có Đơn, câu hỏi form cho Người mua, `serverNow`.

**Approach:** Checkout thành form một lần cho cả Đơn, nút "Gửi Đơn" ở `purchase-bar`. Gửi Đơn gọi `POST /v1/events/:slug/orders` (cần đăng nhập, header `Idempotency-Key`). API chạy TX1: khóa Sự kiện `FOR SHARE`, kiểm lại trạng thái bán và giới hạn, giữ chỗ có điều kiện theo `ticket_type_id` tăng dần, tạo Đơn `pending` với `expires_at = now() + 60s` cùng bản chụp, ghi `order_created`, và enqueue job hoãn hết hạn. Thêm trang `/orders/:code` tối thiểu; 3.4 và 3.7 sẽ mở rộng trang này.

## Boundaries & Constraints

**Always:**
- Giữ chỗ: `UPDATE ticket_type_inventory SET held = held + :n WHERE ticket_type_id = :id AND sold + held + :n <= capacity`, chạy theo `ticket_type_id` tăng dần. Một dòng trả 0 thì rollback cả Đơn và báo đúng Hạng vé hết. Thứ tự khóa: Sự kiện (`FOR SHARE`) rồi tới tồn kho. Không dùng cache hay Redis.
- Mọi Đơn trong 3.2, kể cả Đơn 0đ, đi cùng một đường: giữ chỗ rồi `pending`. Story 3.3 sẽ tách Đơn **tổng 0đ** sang đường bán ngay. Đơn có tổng > 0 đi đường có phí, và các dòng 0đ trong Đơn đó được giữ chỗ và thanh toán cùng Đơn. Trần 200 suất 0đ đã chặn từ lúc cấu hình Hạng vé (E2-3), Checkout không kiểm lại.
- TX1 không gọi Tingee, không gửi email, không `NOTIFY`. Job hết hạn được enqueue bằng chính `tx` của TX1.
- Bản chụp bất biến ghi trong TX1: `order_items` (tên Hạng vé, `unit_price`, số lượng), `total_amount` tính ở server, tên, SĐT (E.164 `+84…`), email, chính sách hoàn vé của Sự kiện, và câu trả lời form kèm nhãn và thứ tự câu hỏi. Câu chọn lưu nhãn phương án.
- Email lấy từ tài khoản, chỉ hiện, không sửa được. Tên và SĐT tự điền từ Đơn gần nhất của chính Người mua; không có Đơn nào thì tên lấy từ tài khoản (nếu có), SĐT để trống. Không thêm cột SĐT vào tài khoản.
- Mã Đơn: `TK` + 8 ký tự Crockford base32. Trùng thì sinh lại, tối đa 3 lần.
- Schema Zod trong contracts dùng chung cho web và API: ít nhất một dòng, số lượng là số nguyên ≥ 1, tổng ≤ `maxTicketsPerOrder` của Sự kiện, câu bắt buộc phải có trả lời, câu chọn phải chọn phương án có thật.
- Hết hạn (AD-4 (a)) chạy trong một transaction: `UPDATE orders SET status='expired' WHERE id=:id AND status='pending' AND payment_link IS NULL AND expires_at < now()`, rồi `held -= n` cho từng dòng.
- Response có hạn chót thì kèm `serverNow`.
- Phễu: "Mua" luôn đưa `f` sang Checkout. Checkout giữ `funnelId` để gửi kèm Đơn, rồi ghi `order_created` với `funnelId` đó. `login_completed` chỉ được ghi khi `buy_clicked` cùng `funnelId` có `login_required = true`.
- Xóa Hạng vé đã có `order_items` trả `409 TICKET_TYPE_IN_USE`. Không xóa mềm.

**Never:**
- Không tạo link Tingee, không làm màn thanh toán, không làm job (c) "quá `expires_at` + 5 phút" (thuộc 3.4). Không có `markPaid`, không phát Vé, không làm trần Vé mỗi Người mua cho Sự kiện miễn phí (thuộc 3.3). Không có realtime (thuộc 3.7). Không làm quét định kỳ lưới an toàn (thuộc 4.6).
- Không chặn sửa thông tin Sự kiện hay form sau khi mở bán. Bản chụp đã đủ để giữ đúng điều Người mua thấy lúc đặt.
- `ordering` không import `identity`. Email và tên lấy từ `req.user` của session. `orders.user_id` không có FK.
- Không lưu lựa chọn hay dữ liệu form vào localStorage hoặc cookie.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Đặt thành công | A=2 (còn 5), B=1, form hợp lệ, khóa K mới | 201 `BuyerOrder` (mã, `pending`, dòng, tổng, `expiresAt`, `serverNow`); `held` A +2, B +1; có job `startAfter = expires_at`; có `order_created`; web sang `/orders/:code` | — |
| Chỗ cuối | 2 Người mua cùng đặt chỗ còn lại duy nhất | Đúng một Đơn tạo được | Người kia nhận 409 `TICKET_TYPE_SOLD_OUT` `{ticketTypeId, ticketTypeName}`; web toast "Hạng vé {tên} vừa hết. Bạn chọn lại nhé." và về `/e/{slug}` với hạng đó = 0, các hạng khác giữ nguyên |
| Thiếu một hạng | A còn đủ, B thiếu | Không tạo Đơn, `held` của A không đổi | Như dòng trên, với tên của B |
| Hạng hoặc Sự kiện không bán | Hạng `paused`/`not_started`/`closed`; hoặc Sự kiện ẩn/khóa/hủy/đã kết thúc | Không tạo Đơn | 409 `NOT_ON_SALE` `{ticketTypeId?, reason}`; web toast + về `/e/{slug}` (hạng đó = 0) |
| Payload sai | 0 dòng, số lượng 0 hoặc 1.5, tổng > giới hạn, thiếu câu bắt buộc, phương án lạ, SĐT sai, thiếu/sai `Idempotency-Key` | Không tạo Đơn | 400 `VALIDATION_FAILED` kèm `issues`; web hiện lỗi tại trường |
| Gửi lại cùng khóa | Lần trước đã tạo Đơn (kể cả hai request song song) | 200 Đơn cũ với trạng thái hiện tại; không giữ thêm chỗ | — |
| Đã có Đơn chờ | Đơn `pending` khác của cùng Người mua, cùng Sự kiện | Không tạo Đơn | 409 `PENDING_ORDER_EXISTS` `{code}`; web sang `/orders/:code` + toast "Bạn đang có một Đơn chờ thanh toán cho Sự kiện này." |
| Đơn chờ cũ đã quá hạn | Đơn `pending` chưa có link, đã quá `expires_at`, job chưa chạy | Trước TX1, hết hạn Đơn cũ bằng chính hàm của job, rồi tạo Đơn mới | — |
| Gửi quá nhanh | Quá 10 lần/10 phút theo user (giới hạn chính), hoặc quá 600 lần/10 phút theo IP (lưới chặn cuối: CGNAT di động dồn nhiều người mua vào một IP) | Không tạo Đơn | 429 `ORDER_RATE_LIMITED` `{retryAfterSeconds}` |
| Lỗi mạng hoặc 5xx | Gửi Đơn không có phản hồi | "Chưa gửi được Đơn. Kiểm tra kết nối rồi thử lại." + "Thử lại" (cùng khóa); form giữ nguyên dữ liệu | — |
| Job hết hạn | Đơn `pending` chưa có link, quá `expires_at` | `expired`, `held -= n` | Đã có link, hoặc không còn `pending` → bỏ qua; chạy sớm → retry |
| Xem Đơn | `GET /v1/me/orders/:code` | Của mình: `BuyerOrder` + `serverNow` | Mã sai dạng, Đơn của người khác, không có → 404 `ORDER_NOT_FOUND` |
| Xóa Hạng vé | Hạng vé có `order_items` (kể cả Đơn đã hết hạn) | Không xóa | 409 `TICKET_TYPE_IN_USE` |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/checkout.ts:25-95` -- `TicketSelection`, `parseSelection`, `FUNNEL_EVENT_TYPES`, `FunnelEventInput`. Thêm `ORDER_CREATED` vào loại phễu nhưng **không** thêm vào `FunnelEventInput`. Test ở `test/checkout.test.ts:73`.
- `packages/contracts/src/form.ts:22,83,90` -- `FormQuestion` (`text`/`choice` chọn một, `options[{id,label}]`). Chưa có schema câu trả lời.
- `packages/contracts/src/organizer.ts:63-67` -- `ContactPhone` (`/^0\d{9}$/`). Dùng làm mẫu cho SĐT người mua dạng E.164.
- `packages/contracts/src/errors.ts` -- thêm mã lỗi mới thì TypeScript bắt sửa `apps/api/src/platform/http/app-error.ts:3` `DEFAULT_STATUS` và `error.filter.ts:7` `MESSAGES`. `jobs.ts` `JobQueue`, `pii.ts:5` `PII_COLUMNS` (thêm `ordering`).
- `apps/api/src/modules/ordering/sellability.ts:52` -- `sellabilityOf`. Tách phần luật thành hàm thuần dùng chung cho trang công khai và TX1, để tránh có hai bộ luật. `inventory.service.ts:84` `deleteInventory`: thêm điều kiện không có `order_items`.
- `apps/api/src/modules/ordering/schema.ts:46-66` -- CHECK `type` của `checkout_funnel_events` đang viết cứng, cần migration DROP rồi ADD. `funnel.service.ts:19` thêm luật `login_completed`.
- `apps/api/src/modules/event/public-event.ts:61-90`, `index.ts` -- `PublicEventRef` chưa có `slug`, `name`, `maxTicketsPerOrder`. Thêm hàm khóa Sự kiện `FOR SHARE` theo slug, không cần `AccessContext`. `form.service.ts:88` `questionsOf` đang private và cần ctx: thêm bản export đọc theo `eventId` cho Người mua.
- `apps/api/src/modules/event/public-page-jobs.ts:31-190`, `organizer/invitation-jobs.ts:29-55` -- mẫu queue: `createQueue`+`updateQueue`, `send` với `{db: fromDrizzle(tx, sql)}`, `ready()`, dead-letter, worker `perJobResults`. `startAfter` lấy từ `JobOptions` của pg-boss 12. Đăng ký ở `worker.module.ts:26`, vai api ở module miền.
- `apps/api/src/modules/identity/otp-rate-limit.ts:54-144` -- mẫu đếm trong Postgres: HMAC IP bằng `hkdfSync`, `pg_advisory_xact_lock`, `count … created_at > now() - interval`. `identity.controller.ts:21` `clientIp` dùng `req.ip`. `OrderingModule` cần `forRoot(config)` để có secret (`api.module.ts:44`).
- `apps/api/src/modules/identity/session.guard.ts:48` -- `req.user` là user Better Auth (`id`, `email`, `name`). Đọc như `memberships.controller.ts:6-12`. `module-graph.cjs:11` cấm `ordering → identity`.
- `apps/api/src/modules/event/event.service.ts:38-52` -- `isUniqueViolation(err, constraint)`, sinh mã ngẫu nhiên. `organizer/schema.ts:94` mẫu unique index một phần `.where(sql…)`. `platform/db/columns.ts`, `grants.ts:10,20` (`APPEND_ONLY_TABLES`, `UPDATE_PROTECTED_COLUMNS`). Migration kế tiếp là `0016`.
- `apps/api/test/identity/harness.ts:78,135` (`createHarness`, `signUp`), `test/ordering/sellability.test.ts:33-90` (`freeEventOnSale`, `paidEventOnSale`), `test/event/ticket-types.test.ts:162` (mẫu `Promise.all`), `test/organizer/admin-invitation-job.test.ts:153` (worker thật + `expect.poll`), `test/event/public-page-job.test.ts:81` (`findJobs`).
- `apps/web/app/(buyer)/e/[slug]/checkout/page.tsx`, `checkout-gate.tsx:32-60` -- server hợp lệ hóa `items`; gate có `me.data` và ghi `login_completed`, rồi `router.replace` bỏ `f`. Giữ `funnelId` bằng state, không lấy lại từ URL.
- `apps/web/app/(public)/e/[slug]/ticket-tiers.tsx:89-122` -- `useBuy`: `pending` không bao giờ về `false`, và `f` chỉ có khi phải đăng nhập. `lib/event/selection.ts:59,123` `withSelection`, `setQuantity` để về trang Sự kiện với một hạng = 0.
- `apps/web/components/tickee/purchase-form-preview.tsx` -- bố cục và `PURCHASE_FORM_DEFAULT_FIELDS`, `RequiredMark`, `ChoiceField`. `field-error.tsx`, `components/ui/input.tsx`. `ticket-types-editor.tsx:165` là mẫu `aria-invalid`/`aria-describedby`; `purchase-form-editor.tsx:184` là mẫu focus theo id. `purchase-bar.tsx` có `action`.
- `apps/web/lib/api/client.ts:91` `apiRequest` (header qua `init.headers`), `errors.ts:4` `ApiError` (lỗi mạng: `SERVICE_UNAVAILABLE`, `status` null), `lib/event/funnel.ts:12` `newFunnelId` (dùng sinh UUID cho khóa). `app/providers.tsx:31`: xử lý kết quả ở `useMutation`, không đặt trong `mutate(…, {})`. Toast bằng `sonner`, đặt ở layout gốc nên vẫn còn sau `router.push`.
- `apps/web/e2e/purchase.spec.ts:46-136,405` (`mockFunnel`, `mockAccount`, `expectSummary`), `identity-mock.ts:35` (CORS `allow-headers` phải thêm `idempotency-key`).

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/order.ts` (mới), `checkout.ts`, `errors.ts`, `jobs.ts`, `pii.ts`, `index.ts` + `test/order.test.ts` -- `ORDER_CODE_PATTERN`, `orderPath`, `BuyerPhone` (E.164), `CreateOrderRequest`, `orderRequestFor(event, questions)` (giới hạn + câu trả lời), `CheckoutForm`, `BuyerOrder`; mã lỗi `TICKET_TYPE_SOLD_OUT`, `NOT_ON_SALE`, `PENDING_ORDER_EXISTS`, `ORDER_RATE_LIMITED`, `ORDER_NOT_FOUND`; queue `ordering.expire-order` (+ dead-letter); `ORDER_CREATED` -- nguồn luật duy nhất cho web và API.
- [x] `apps/api/src/modules/event/{public-event,form.service,index}.ts` -- khóa Sự kiện `FOR SHARE` theo slug (trả cả `slug`, `name`, `maxTicketsPerOrder`, `refundPolicy`); đọc câu hỏi theo `eventId`.
- [x] `apps/api/src/modules/ordering/schema.ts` + migration `0016` + `platform/db/grants.ts` -- bảng `orders` (unique `code`, unique `(user_id, idempotency_key)`, unique một phần `(user_id, event_id) WHERE status='pending'`, CHECK `status`, `payment_link` null, `refund_policy`, `funnel_id`), `order_items`, `order_answers` (append-only), `order_create_attempts`; cột bản chụp của `orders` vào `UPDATE_PROTECTED_COLUMNS`; sửa CHECK phễu.
- [x] `apps/api/src/modules/ordering/{sellability,order-code,order-rate-limit,orders.service,orders.controller,order-jobs,inventory.service,funnel.service,ordering.module,index}.ts` -- luật bán dùng chung; TX1; idempotency (tra trước, bắt unique sau rollback); hết hạn Đơn chờ cũ trước TX1; 409/429; `GET /v1/events/:slug/checkout` (câu hỏi + tự điền); `GET /v1/me/orders/:code`; job hết hạn; `OrderingJobsModule` đăng ký ở `worker.module.ts`.
- [x] `apps/api/test/ordering/{orders,order-concurrency,order-expiry}.test.ts`, `test/event/ticket-types.test.ts`, `test/ordering/funnel.test.ts` -- mọi dòng Matrix; đua chỗ cuối; Đơn nhiều hạng thiếu chỗ không giữ hạng nào; 30 request song song cho 10 chỗ thì `sold + held ≤ capacity` và số Đơn đúng bằng số chỗ; job thật chuyển `expired` và nhả chỗ; bản chụp không đổi khi BTC sửa giá, tên, chính sách hoàn vé hay form.
- [x] `apps/web/app/(buyer)/e/[slug]/checkout/*` (+ `lib/order/*`) -- form (Tên, SĐT, Email chỉ đọc, câu hỏi), dòng "Thông tin trong form sẽ được chia sẻ cho {BTC}.", `purchase-bar` với tổng và nút "Gửi Đơn" (spinner, chặn bấm lặp); lỗi khi rời trường và khi gửi; cuộn rồi focus vào trường lỗi đầu tiên; `aria-describedby`; một `Idempotency-Key` cho mỗi lần mở Checkout; xử lý kết quả theo Matrix.
- [x] `apps/web/app/(buyer)/orders/[code]/page.tsx` (+ client) -- chặn chưa đăng nhập; tóm tắt, mã Đơn, trạng thái (`pending` "Đang giữ chỗ cho Đơn của bạn."; `expired` "Hết thời gian giữ chỗ. Chỗ đã được trả lại." + "Mua lại"); 404 có thông báo riêng.
- [x] `apps/web/app/(public)/e/[slug]/ticket-tiers.tsx` -- luôn đưa `f`; `pending` hết khi điều hướng xong, kể cả khi bị redirect về lại trang Sự kiện (deferred 3.1 #5).
- [x] `apps/web/e2e/purchase.spec.ts`, `identity-mock.ts` -- form, lỗi trường và focus, gửi thành công, hết chỗ, Đơn chờ, lỗi mạng rồi "Thử lại" cùng khóa, nút "Mua" không kẹt khi Checkout redirect về.

**Acceptance Criteria:**
- Given các TX1 đang chạy, when BTC cùng lúc sửa hoặc xóa Hạng vé, hoặc Ẩn/Kết thúc Sự kiện, then lệnh của BTC chờ TX1 xong rồi chạy; không có deadlock, không có lỗi 500.
- Given Checkout ở 375×667, when có lỗi trường lúc gửi, then trường lỗi đầu tiên được focus và không bị `purchase-bar` che.
- Given Đơn đã tạo, when BTC sửa giá, tên Hạng vé, chính sách hoàn vé hoặc câu hỏi form, then `GET /v1/me/orders/:code` vẫn trả đúng bản chụp lúc đặt.

## Implementation Notes

- Mason duyệt spec ngày 10/11, sửa mục giới hạn theo IP ("Duyệt, nới mục 4", chuyển qua session gốc): IP 60 → 600 lần/10 phút. Lý do: CGNAT của nhà mạng di động dồn nhiều người mua vào một IP, mà kịch bản NFR-3 là 5.000 người tranh 300 vé, mỗi lần bị báo hết vé vẫn bị đếm. Giới hạn theo user giữ 10 lần/10 phút.

- Quyết định ngoài spec (subagent triển khai):
  - "Sinh lại tối đa 3 lần" hiểu là tổng cộng 3 lần thử. Trùng cả 3 lần trả 500 và rollback cả TX1.
  - Hạng vé không thuộc Sự kiện trả `NOT_ON_SALE` với lý do `closed`.
  - Câu trả lời của id câu hỏi lạ bị bỏ qua, để Người mua không bị chặn khi BTC vừa xóa câu đó.
  - `order_created` được ghi khi có `funnelId`, không đòi phải có `buy_clicked` tương ứng.
  - CHECK `orders.status` nhận đủ 6 trạng thái, nên các story sau không cần migration chỉ để thêm trạng thái.
  - Checkout bỏ `f` khỏi URL bằng `history.replaceState` (không `router.replace`), để không mất `funnelId` nếu cây React dựng lại.
  - Trang Đơn hỏi lại máy chủ mỗi 5 giây khi Đơn đang `pending`. Đây là giải pháp tạm cho tới khi 3.7 có realtime.
- Deferred 3.1 #5 (nút "Mua" kẹt) không tái hiện được: sau khi redirect, App Router dựng lại `TicketPicker`. Code vẫn chuyển sang `useTransition` và có thêm e2e hồi quy. Ghi chú đã thêm vào `deferred-work.md`.
- `pnpm test:e2e` lần đầu: 649 qua, 1 lỗi ở `purchase-form.spec.ts:376`. Test này đã được ghi là chập chờn từ trước (E2-5, `deferred-work.md`) và story này không đụng tới.

## Spec Change Log

## Review Triage Log

Vòng 1 (review_loop_iteration 0). Nguồn: BH = Blind Hunter, EC = Edge Case Hunter, VG = Verification Gap.

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | BH, EC | Không chuẩn hóa chữ hoa/thường của uuid: cùng Hạng vé gửi hai lần (`ABC…`/`abc…`) lọt qua bước so trùng, giữ chỗ hai lần rồi vi phạm unique `order_items` → 500. Khóa câu hỏi viết hoa bị bỏ qua → 400 `required` sai | low | `z.uuid()` nhận chữ hoa; `TicketSelection` so chuỗi gốc (`checkout.ts:32`); `placeOrder` chỉ chuyển chữ thường bên trong TX1; `answerOf` tra khóa theo đúng chuỗi. Chỉ gặp khi client tự dựng request | patch |
| 2 | BH, EC | Mọi lần thử từ một IP xếp hàng trên một `pg_advisory_xact_lock`, mỗi lần giữ một kết nối pool, và đọc tới 600 dòng | medium | `order-rate-limit.ts:52-60`. Với CGNAT (lý do Mason nới lên 600), cả nghìn Người mua xếp hàng qua một khóa trong lúc pool chỉ có 10 kết nối | patch |
| 3 | BH, EC | `queues.ready()` chạy sau `limiter.consume()`, nên pg-boss lỗi vẫn tính một lần thử | low | `orders.service.ts:192-194`. Phần "không đếm lần lỗi 5xx" bị reject vì phải thêm nhánh và hiếm gặp | patch (chỉ đổi thứ tự) |
| 4 | VG | Hai request cùng khóa: TX1 đầu commit giữa `byKey` và `assertNoPending` của request sau → request sau nhận 409 cho chính Đơn của mình | low | `orders.service.ts:184-191`. Có thể xảy ra khi bấm "Thử lại" lúc request đầu còn đang chạy; web hiện toast sai rồi vẫn tới đúng Đơn | patch |
| 5 | EC | `expires_at = now() + 60s` lấy giờ bắt đầu transaction, nên chờ khóa lâu thì hạn Giữ chỗ ngắn đi | low | `orders.service.ts:308`: `now()` là giờ đầu transaction. Sửa thẳng bằng `clock_timestamp()` | patch |
| 6 | BH | Ba response có PII (`checkout`, tạo Đơn, xem Đơn) không có `cache-control: no-store` | low | Quy ước ở `admin/closed-beta.controller.ts:32` ("Response chứa PII … không cho cache"); Express tự đặt ETag nên trình duyệt có thể lưu response vào cache đĩa | patch |
| 7 | BH | Câu `TICKET_TYPE_IN_USE` nói "đã có người mua hoặc đang giữ chỗ", sai khi chỉ có Đơn đã hết hạn, và không chỉ BTC cách khác | low | `inventory.service.ts:96`, `error.filter.ts:43`, `ticket-types-editor.tsx:433`. Session gốc góp ý chỉ BTC cách ngừng bán; Hạng vé không có thao tác tạm dừng nên chỉ sang "giờ kết thúc bán" | patch |
| 8 | BH | Câu chọn không bắt buộc đã chọn thì không bỏ chọn được | low | `checkout-order-form.tsx` `choiceField` chỉ có radio. Bấm nhầm là chuyện thường ngày, Người mua bị buộc gửi một câu trả lời | patch |
| 9 | BH | Ô Tên `maxLength` 200, khác `BUYER_NAME_MAX` 100 | low | `checkout-order-form.tsx` | patch |
| 10 | VG, BH | Chưa có test TX1 kiểm lại `orderRequestFor` trên dữ liệu đã khóa (BTC hạ giới hạn hoặc thêm câu bắt buộc giữa lúc tiền kiểm và TX1) | medium | Gap đã được VG kiểm: đổi dòng 229 thành `CreateOrderRequest` thì mọi test vẫn qua | patch (thêm test) |
| 11 | VG, BH | Chưa có test một Người mua gửi song song hai Đơn khác khóa (nhánh `ONE_PENDING_KEY` → 409) | medium | Gap đã được VG kiểm: xóa `assertNoPending` ở dòng 205 thì bên thua nhận 500 mà không test nào lỗi | patch (thêm test) |
| 12 | VG | `OrderQueues.ready()` thử lại sau lỗi chưa có test như các lớp queue khác | medium | Gap đã được VG kiểm; mẫu có sẵn ở `public-page-queues.test.ts` | patch (thêm test) |
| 13 | VG | Tự điền "Đơn gần nhất" mới chỉ test với một Đơn | low | Gap đã được VG kiểm: đổi `desc` thành `asc` thì test vẫn qua | patch (thêm test) |
| 14 | VG | Không kiểm 409 `PENDING_ORDER_EXISTS` không bị tính vào giới hạn tốc độ | low | Gap đã được VG kiểm: đưa `consume` lên trước thì mọi test vẫn qua | patch (thêm assert) |
| 15 | VG | Nhánh 400 `VALIDATION_FAILED` và 429 của Checkout chưa có e2e | medium | Gap đã được VG kiểm: xóa hai nhánh này thì không test nào lỗi; quy ước repo là kiểm map lỗi server bằng e2e | patch (thêm e2e) |
| 16 | EC | TX1 chờ khóa không có `lock_timeout`, giữ kết nối pool; khi tải cao, request khác có thể lỗi sau 3 giây chờ kết nối | maybe-false | Mỗi TX1 chỉ giữ khóa vài ms; chưa đo được lúc tải cao. Cần kiểm thử tải NFR-3 (5.8) | defer (medium, chưa kiểm) |
| 17 | EC | Dòng TX1 `FOR SHARE` liên tục có thể bỏ đói lệnh `FOR UPDATE` của BTC (Ẩn/Kết thúc) trong flash sale | maybe-false | Postgres cho khóa tương thích vào trước người ghi đang chờ; chưa có test dòng khóa liên tục. Cần test giữ `FOR SHARE` chồng nhau liên tục rồi đo thời gian chờ của `FOR UPDATE` | defer (medium, chưa kiểm) |
| 18 | BH | `serverNow` lấy giờ Node, còn `expiresAt` lấy giờ Postgres | low | Máy chủ đồng bộ NTP nên lệch tính bằng ms, không đáng kể với đồng hồ đếm giây. Sửa phải thêm một truy vấn | reject |
| 19 | BH, EC | Tra `Idempotency-Key` không theo Sự kiện, dùng lại khóa ở Sự kiện khác trả Đơn cũ | low | Web sinh khóa mới mỗi lần mở Checkout; chỉ client tự dựng request mới gặp. Sửa phải thêm nhánh lỗi | reject |
| 20 | BH | Nhánh dead-letter khi payload job hỏng chưa có test | low | Payload chỉ do `enqueueOrderExpiry` dựng, có kiểu; nhánh này chỉ để phòng thủ | reject |
| 21 | BH | Trang Đơn không hiện hạn Giữ chỗ | low | Đúng là trang không hiện hạn, nhưng intent ghi trang `/orders/:code` tối thiểu, 3.4 làm màn thanh toán có `countdown-chip` | reject (ngoài phạm vi intent) |
| 22 | BH | `order_created` không đòi có `buy_clicked` tương ứng | low | Muốn ghi rác phải tạo Đơn thật (đăng nhập, bị giới hạn tốc độ, giữ chỗ). Đã ghi ở Implementation Notes | reject |
| 23 | BH | sprint-status (`in-progress`) lệch spec (`in-review`); `deferred-work.md` thêm mục mới thay vì đóng mục 3.1 #5 | false | Bước trình bày của workflow sẽ đồng bộ sprint-status; `deferred-work.md` chỉ được thêm mục, không sửa mục cũ | reject |
| 24 | EC | Lỗi 5xx sau `consume` vẫn tính lần thử, nên "Thử lại" lúc sự cố có thể chạm 429 | low | Phải gặp ≥10 lần 5xx trong 10 phút; sửa phải thêm nhánh hoàn lần thử. Phần đổi thứ tự `ready()` đã gộp vào #3 | reject |
| 25 | EC | Tải form hay tải Đơn trả 401 trong khi `me` còn cache → banner "Thử lại" không thoát được, không về màn đăng nhập | low | `staleTime` 30 giây; chỉ gặp khi phiên vừa bị hủy ở tab khác ngay lúc chuyển trang; sửa phải thêm nhánh | reject |
| 26 | EC | BTC xóa phương án giữa lúc Người mua đang điền: server báo lỗi tại câu đó, nhưng form không tải lại phương án | low | Hiếm (BTC sửa form sau khi mở bán, đúng lúc có người đang điền); câu báo "Kiểm tra lại câu trả lời này." vẫn chỉ đúng chỗ, chọn phương án khác thì qua | reject |
| 27 | EC | Đơn `pending` đã quá hạn khi worker chết vẫn hiện "Đang giữ chỗ" | low | Worker chết là sự cố vận hành; lần đặt sau tự hết hạn Đơn cũ; lưới an toàn thuộc 4.6; màn hết giờ thuộc 3.4/3.7 | reject |
| 28 | EC | BTC mất điều kiện bán Vé có phí đúng lúc TX1 đang chạy thì Đơn vẫn được tạo | low | Cửa sổ vài ms; 3.4 tạo link sẽ thất bại khi không còn tài khoản nhận tiền nên Đơn hết hạn; khóa BTC là stub của Epic 7 | reject |

## Design Notes

- Vì sao khóa Sự kiện `FOR SHARE`: các TX1 song song không phải chờ nhau trên dòng `events`. Mọi lệnh ghi của BTC (Hạng vé, Ẩn/Kết thúc, form) đều khóa `FOR UPDATE`, nên phải đợi các TX1 đang chạy xong, và TX1 luôn thấy một trạng thái đã commit. Lệnh của BTC và TX1 cùng khóa Sự kiện trước rồi mới tới tồn kho, nên không có deadlock.
- Idempotency: tra `(user_id, key)` trước, có thì trả 200. Hai request cùng khóa chạy song song thì bên thua dính unique violation, rollback cả phần giữ chỗ, đọc lại rồi trả Đơn của bên thắng. Đơn chờ cũ được hết hạn trong một transaction riêng trước TX1, vì nhả chỗ rồi giữ chỗ trong cùng TX1 là hai lượt khóa tồn kho, dễ deadlock.
- Giá đổi giữa lúc xem Checkout và lúc gửi: TX1 lấy giá đã chốt trong lúc khóa. Màn thanh toán của 3.4 hiện đúng số tiền trước khi Người mua trả, nên 3.2 không so tổng tiền với client.
- Rate limit đếm mọi lần thử tới được TX1 (không đếm lần trả lại Đơn cũ theo khóa). Dọn `order_create_attempts` cũ để vào deferred (4.6).

## Verification

**Commands:**
- `pnpm test` -- pass (contracts, api với Postgres thật, web vitest)
- `pnpm typecheck && pnpm lint:deps` -- pass, không có import chéo mô-đun mới
- `pnpm test:e2e` -- pass (`purchase.spec.ts` và các spec cũ)
