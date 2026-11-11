---
title: 'Story 3.7: Trang Đơn tự chuyển "Thành công" theo thời gian thực'
type: 'feature'
created: '2026-11-11'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'bfd49bcd6eb336b152e097b7670abe46eab9789e'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Trang `/orders/:code` chỉ hỏi lại API mỗi 5 giây khi Đơn `pending` và rẽ nhánh theo `status` thô. Đơn `review`, `cancelled`, `refunded` cùng rơi vào câu "Đơn của bạn đang được xử lý.", không có kênh liên hệ BTC. Chưa có lớp realtime nào, trong khi 3.9 và 3.11 cần dùng lại lớp này.

**Approach:** Dựng `platform/realtime` theo AD-17: `NOTIFY` trong cùng transaction, mỗi instance api một kết nối `LISTEN`, SSE lọc theo phạm vi. Phát `order_changed` ở mọi chỗ đổi Đơn sau TX1. API trả `BuyerOrderView` có `buyerStatus` và kênh liên hệ BTC. Web có một hook `useLiveResource` dùng chung; Trang Đơn hiển thị theo `buyerStatus`.

## Boundaries & Constraints

**Always:**
- **`realtime.notify(tx, topic, ids)`** là hàm thuần như `audit.record`, dùng được ở cả vai api và worker. Nó chạy `pg_notify` trên một kênh cố định, trong `tx` của bên gọi: rollback thì không phát. Payload đúng `{type, id, organizationId, eventId}` (schema Zod trong contracts).
- **Danh mục topic** `REALTIME_TOPICS` trong `packages/contracts`, đủ 5 topic của bảng AD-17. 3.7 chỉ phát và cho đăng ký `order_changed`.
- **`RealtimeHub`** chỉ chạy ở vai api:
  - Một `pg.Client` riêng `LISTEN` trên `DATABASE_URL`. Mất kết nối thì tự nối lại có backoff. Nối lại xong, mọi người đang đăng ký nhận một tín hiệu để tải lại, vì tín hiệu trong khoảng mất kết nối đã mất.
  - Đẩy SSE sau khi lọc theo bộ lọc của từng người đăng ký. Heartbeat là dòng comment mỗi 25 giây. Header chống cache và chống buffer.
  - SIGTERM: từ chối SSE mới (503), đóng SSE đang mở, đóng `LISTEN`.
- **`/readyz`** trả 503 khi DB không trả lời hoặc `LISTEN` chưa sẵn sàng.
- **Phát `order_changed`** trong cùng `tx`, ở mọi chỗ đổi trạng thái hoặc link của Đơn sau TX1:
  - `pay` (trừ nguồn `free`: Đơn 0đ thành `paid` ngay trong TX1, response đã mang kết quả);
  - `moveToReview`, `markExpired`, `expireOrder`;
  - `PaymentLinks.attach`, `PaymentLinks.expire`.
  - Không `NOTIFY` trong TX1.
- **SSE `GET /v1/me/orders/:code/live`**: cùng phiên đăng nhập và cùng phép sở hữu với `GET /v1/me/orders/:code` (`buyerScope`). Đơn không có hoặc của người khác → 404 `ORDER_NOT_FOUND`, không mở stream. Chỉ đẩy `order_changed` có `id` trùng Đơn đó. Dữ liệu gửi trình duyệt chỉ `{type}`.
- **`BuyerOrderView`** thay `BuyerOrder` cho cả ba response đang dùng nó. `buyerStatus` thay `status`:

  | Đơn | Sự kiện | `buyerStatus` |
  |---|---|---|
  | `pending`, giờ máy chủ < `expires_at` | bất kỳ | `awaiting_payment` |
  | `pending`, giờ máy chủ ≥ `expires_at` | bất kỳ | `confirming` |
  | `expired` | bất kỳ | `expired` |
  | `paid`/`review`/`cancelled`/`refunded` | đã hủy | `event_cancelled` |
  | `paid` | chưa hủy | `paid` |
  | `review` | chưa hủy | `under_review` |
  | `cancelled`/`refunded` | chưa hủy | `cancelled_by_organizer` |

  `tickets` chỉ có khi `buyerStatus = paid`. View thêm `organizer: {name, contactPhone, contactEmail}`. Không lộ loại Cần xử lý hay số tiền lệch.
- **Hook `useLiveResource`** (`apps/web/lib/realtime/`), dùng chung, nhận query key, hàm tải, đường SSE, và chu kỳ polling theo dữ liệu.
  - Tải lại REST khi SSE mở, khi có tín hiệu, khi `visibilitychange` sang visible, khi có mạng lại.
  - Tín hiệu gom trong 1 giây: tải ngay ở tín hiệu đầu, các tín hiệu tới trong 1 giây sau gộp thành một lần tải.
  - SSE chưa kết nối thì polling theo chu kỳ trang chọn. Trang Đơn chọn 2 giây khi `awaiting_payment`/`confirming`, các trạng thái khác không polling. Stream bị đóng hẳn thì tự mở lại có backoff.
  - Không đọc tham số `returnUrl` hay search params nào để suy ra trạng thái.
- **Trang Đơn theo `buyerStatus`:**
  - `awaiting_payment`: màn thanh toán của 3.4 với "Đang chờ thanh toán — vé sẽ tự hiện khi BTC nhận được tiền.".
  - `confirming` (server báo, hoặc đồng hồ về 0): "Đang xác nhận thanh toán" như 3.4.
  - `expired`: màn Hết hạn như 3.4 ("Mua lại", dòng phụ; `sales_paused` giữ câu riêng).
  - `under_review`: "BTC đang kiểm tra thanh toán" + kênh liên hệ BTC.
  - `cancelled_by_organizer`: badge "Đã hủy" + "BTC đã hủy Đơn này. Liên hệ BTC để được hoàn tiền nếu bạn đã chuyển." + kênh liên hệ BTC.
  - `event_cancelled`: "Sự kiện đã hủy — BTC sẽ liên hệ hoàn tiền." + kênh liên hệ BTC, không Mã QR vé.
  - `paid`: màn Thành công của 3.3, bố cục giữ nguyên (chưa có "Đã gửi Vé tới {email}", không biên nhận; xem Quyết định).
  - `buyerStatus` lạ: không làm hỏng parse; hiện "Chúng tôi đang cập nhật trạng thái Đơn." + kênh liên hệ BTC, không QR.
- **Chờ lâu:** sau 2 phút ở `awaiting_payment`/`confirming` trong lần mở trang, `reassurance-line` "Nếu bạn đã chuyển, vé sẽ về trong vài phút — đừng chuyển lại." thay dòng chờ, trong vùng `aria-live="polite"`.
- **Mất mạng:** trình duyệt báo offline, hoặc lần tải lại gần nhất lỗi mạng → dòng nhỏ "Mất kết nối — vé sẽ tự hiện khi có mạng lại." (copy tạm, xem Quyết định). Có mạng lại thì tải ngay.
- **"Khoảnh khắc" Thành công** (trượt lên + rung) chỉ chạy khi:
  - trang đang mở thấy Đơn chuyển sang `paid`; hoặc
  - vào trang lần đầu với cờ một lần trong `sessionStorage`, do Checkout (Đơn 0đ) hoặc nút "Thanh toán" (Đơn có phí) đặt.
  - Mở lại hay tải lại sau đó thì hiện ngay. Reduced motion giữ như 3.3.
- **Quyết định của Mason (11/11):**
  - **Test chia hai tầng.** Playwright giả API và giả luồng SSE (`page.route`) cho ca tab ở nền khi Đơn đổi, các màn `buyerStatus`, chờ lâu, mất mạng. Test tích hợp API (Vitest, Postgres thật, Tingee fake, server thật nghe cổng, client SSE thật) đo từ lúc gửi IPN tới khi stream của Người mua nhận tín hiệu < 1 giây, và stream của người khác không nhận. Ca Playwright full-stack với Tingee fake dời vào AI-6 (ghi `deferred-work.md`). CORS và cookie của SSE thật kiểm bằng tay với `pnpm dev`. Đây là điểm lệch có chủ đích so với câu "test Playwright với Tingee fake" trong AC.
  - **Hoãn câu hứa trước khi có tính năng.** Chưa hiện "Đã gửi Vé tới {email}" (3.8 thêm khi gửi email Vé). Dòng mất mạng dùng copy tạm ở trên; 3.8/3.9 đổi lại đúng copy AC "Mất kết nối — vé vẫn được gửi qua email và Vé của tôi." (ghi `deferred-work.md`). Cùng tiền lệ 3.3 hoãn nút "Xem Vé của tôi".
  - **Không thêm biên nhận** dưới thẻ Vé. Giữ bố cục Thành công đã chốt (stage + thẻ Vé + Mã Đơn). Biên nhận để 3.9 (Chi tiết Vé/Vé của tôi). Đóng mục deferred #19 của review 3.3 theo hướng này.
  - **Giữ spec đầy đủ** dù vượt ngưỡng 1.600 token (khoảng 6.000): một mục tiêu xuyên lớp; tách `platform/realtime` khỏi Trang Đơn sẽ để lớp realtime không có ai dùng.

**Never:**
- Không làm việc của story khác: email Vé (3.8), "Vé của tôi" và nút "Xem Vé của tôi" (3.9), topic `event_orders_changed` và dashboard (3.11), `cancel_reason` và hủy Sự kiện (7.1), Duyệt/Từ chối (4.4).
- Không phát Vé hay đổi trạng thái từ request trình duyệt, SSE hay `returnUrl`. SSE không mang dữ liệu Đơn, chỉ là tín hiệu.
- Không thêm Redis hay pooler. Không giữ kết nối DB cho mỗi SSE.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| IPN đúng tiền, trang đang mở | Đơn `pending`, SSE mở | Tín hiệu tới stream của Người mua sau commit; web tải lại; Thành công + khoảnh khắc trong < 3 giây | — |
| Tab ở nền khi IPN tới | Tab hidden, Safari cắt SSE | Visible lại → tải ngay → Thành công | Không SSE → polling 2 giây |
| Đơn người khác | B mở `/live` của Đơn A | 404 `ORDER_NOT_FOUND`, không stream | — |
| Chưa đăng nhập | `/live` không cookie | 401 `UNAUTHENTICATED` | — |
| IPN lỗi, rollback | Lỗi sau khi Đơn đổi | Không tín hiệu nào tới stream | Tingee gửi lại |
| Đơn khác đổi | Người mua mở Đơn X, Đơn Y đổi | Stream của X không nhận gì | — |
| Hết hạn (job worker) | Đơn `pending` quá hạn | Tín hiệu; trang hiện Hết hạn | — |
| Lệch tiền | IPN `amount_mismatch` | `under_review` + liên hệ BTC, không số tiền, không loại | — |
| `LISTEN` rớt | Kết nối LISTEN đóng | `/readyz` 503; nối lại → tín hiệu tải lại tới mọi stream | log warn |
| Tắt máy | SIGTERM | SSE mới 503, SSE đang mở đóng; web polling rồi nối lại | — |
| `buyerStatus` lạ | Server trả giá trị mới | Màn an toàn + liên hệ BTC | Không ném lỗi parse |

</frozen-after-approval>

## Code Map

- **DB & vòng đời:**
  - `apps/api/src/platform/db/database.ts:20` -- `Database` (`pg.Pool` max 10, `transaction()` READ COMMITTED, `ping()`). Driver `pg` 8.23, không có `listen` sẵn: tự mở `pg.Client`, `query('LISTEN …')` + `on('notification')`. Kiểu `Tx`, `DbExecutor` từ `platform/db/index.ts`.
  - Mẫu module `@Global` + `forRoot` + `onApplicationShutdown`: `platform/jobs/jobs.module.ts:23-68`, `platform/db/db.module.ts`. Mẫu hàm thuần dùng `tx`: `platform/audit/audit.ts:112`.
  - `apps/api/src/platform/http/health.controller.ts:19` -- `readyz` chỉ `db.ping()`; thêm kiểm `LISTEN`. Chỉ đăng ký ở `api.module.ts:57`.
  - `apps/api/src/roles/api.ts:16-34`:
    - Express (`NestExpressApplication`), `bodyParser:false`.
    - CORS `WEB_ORIGIN` + credentials, nên SSE cross-origin dùng `EventSource(url, {withCredentials:true})`.
    - `enableShutdownHooks` SIGTERM/SIGINT.
  - Config: `platform/config/config.schema.ts:78` `DATABASE_URL`. Không thêm biến mới.
  - Dependency rule `.dependency-cruiser.cjs:71` (platform không import `modules/`). `module-graph.cjs:7-19` giữ nguyên.
- **Ordering:**
  - `apps/api/src/modules/ordering/mark-paid.ts`:
    - `pay:273`: RETURNING đã có `id`, `organizationId`, `eventId`; `input.source` cho biết `free`.
    - `moveToReview:128`: chỉ có `orderId`; mở rộng RETURNING `organizationId`, `eventId`.
  - `apps/api/src/modules/ordering/order-jobs.ts`:
    - `expireOrder:83` (tự mở tx, gọi từ worker `:181` và `orders.service.ts:476`);
    - `markExpired:142` (tx của `IpnProcessor.applyStatus`).
    - Cả hai RETURNING chỉ `id`: thêm org/event.
  - `apps/api/src/modules/ordering/payment-link.ts`:
    - `attach:189` (TX2), `expire:239`.
    - `release:227` không có tx, chỉ đổi `linkError`: bỏ qua, request của chính Người mua trả kết quả.
  - `apps/api/src/modules/ordering/orders.service.ts`:
    - `view:492` dựng `BuyerOrder`; `paymentOf:535`; `ownOrder:261` lọc `code` + `user_id` → `orderNotFound:94`.
    - Sự kiện đọc qua `saleEventById` (`event/public-event.ts:117`, có `status`).
    - Liên hệ BTC: cột `organizer/schema.ts:12-13` `contact_phone`/`contact_email`; thêm hàm đọc vào `organizer/index.ts` cạnh `organizationNameOf`.
  - `apps/api/src/modules/ordering/orders.controller.ts:61` -- `mine` (`no-store`, `buyerOf(req)`). Thêm route `live` cạnh đó, ghi thẳng vào `@Res()` của Express.
- **Contracts:**
  - `packages/contracts/src/order.ts:313` -- `BuyerOrder` → `BuyerOrderView` (+ `buyerStatus`, `organizer`; bỏ `status`).
  - `order.ts:64` `buyerOrderApiPath`: thêm `buyerOrderLiveApiPath`. `ORDER_STATUSES` là mẫu cho `BUYER_ORDER_STATUSES`.
  - File mới `realtime.ts` + `index.ts`.
- **Test api:**
  - `test/identity/harness.ts:83` `createHarness` (supertest, không nghe cổng), `signUp:140`. Stream thật thì nghe cổng như `test/payment/ipn.test.ts:144`.
  - `test/ordering/order-fixtures.ts` (`paidReadyOrg`, `eventOnSale`, `postOrder`, `parseOrder:239`).
  - `test/payment/ipn-fixtures.ts` (`postIpn`, `orderState`). Fake ở `test/tingee-fake/server.ts` (`signIpn`, `fakeIpnPayload`). `place()` cục bộ ở `ipn.test.ts:93`: nâng lên fixtures nếu cần dùng lại.
  - `/readyz`: `test/http.test.ts:93,230`. SIGTERM: `test/roles.process.test.ts:134`.
  - Mọi test đọc `.status` từ response Đơn chuyển sang `buyerStatus`: `orders`, `free-order`, `payment-link*`, `ipn*`, `contracts/test/order.test.ts`.
- **Web:**
  - `apps/web/app/(buyer)/orders/[code]/order-view.tsx`:
    - `:111` `useQuery` + `refetchInterval` 5 giây (`PENDING_REFETCH_MS:21`), thay bằng hook.
    - `StatusBlock:23` và `statusAnnouncement:62` rẽ theo `status`.
    - Vùng live luôn gắn `data-slot="order-status-announcement"`.
  - `order-payment.tsx:80`: `confirming = timeUp && checkoutUrl`; nút `:150` `window.location.assign`. Đặt cờ khoảnh khắc ở đây.
  - `order-success.tsx:33`: `useSuccessVibration`, `animate-ticket-rise` chạy vô điều kiện.
  - `apps/web/lib/api/client.ts:16` `apiBaseUrl()`. `lib/order/api.ts:23,40` `buyerOrderQueryKey`, `fetchBuyerOrder` (parse bằng schema contracts).
  - Component: `components/tickee/{countdown-chip,stage-block,status-badge,status-banner,empty-state,ticket-card}.tsx`. Chưa có `reassurance-line`, chưa có khối liên hệ BTC.
  - Test:
    - Vitest web chạy `environment:'node'`, không jsdom (mẫu `test/server-countdown.test.ts`), nên tách logic thuần để test.
    - E2E `e2e/purchase.spec.ts`: `mockOrders:203`, `buyerOrder():146`, `switchTabAway:314`, `page.clock` `:1236`, hằng copy `:1065-1071`. Đăng nhập giả `e2e/identity-mock.ts:44`.
    - `playwright.config.ts`: ios-webkit + android-chromium, 375×667.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{realtime,order,index}.ts`, `packages/contracts/test/` -- `REALTIME_TOPICS`, `RealtimeSignal`; `BUYER_ORDER_STATUSES`, `BuyerOrderView`, `buyerOrderLiveApiPath` -- một danh mục dùng chung api/web.
- [x] `apps/api/src/platform/realtime/` (mới: `notify.ts`, `realtime-hub.ts`, `realtime.module.ts`, `index.ts`), `platform/http/health.controller.ts`, `api.module.ts` -- `notify`, hub LISTEN + SSE + heartbeat + nối lại + tắt máy, `/readyz` -- lõi AD-17 cho 3.9/3.11 dùng lại.
- [x] `apps/api/src/modules/ordering/{mark-paid,order-jobs,payment-link}.ts` -- phát `order_changed` ở các điểm trong Boundaries, RETURNING thêm org/event -- REST tải lại đúng lúc.
- [x] `apps/api/src/modules/ordering/{orders.service,orders.controller}.ts`, `modules/organizer/{index,…}.ts` -- `BuyerOrderView` (bảng `buyerStatus`, `tickets` chỉ khi `paid`, liên hệ BTC), route `GET /v1/me/orders/:code/live` -- phạm vi Người mua.
- [x] `apps/api/test/platform/realtime.test.ts`, `apps/api/test/ordering/order-live.test.ts` (mới), sửa các test đọc `status` -- phủ Matrix phía API; server nghe cổng + client SSE thật: gửi IPN qua Tingee fake → tín hiệu < 1 giây, stream khác không nhận.
- [x] `apps/web/lib/realtime/use-live-resource.ts` (+ phần logic thuần), `apps/web/test/` -- hook dùng chung, test gom 1 giây và chọn polling.
- [x] `apps/web/app/(buyer)/orders/[code]/*`, `apps/web/components/tickee/{reassurance-line,organizer-contact}.tsx`, Checkout (đặt cờ) -- màn theo `buyerStatus`, chờ lâu, mất mạng, khoảnh khắc một lần.
- [x] `apps/web/e2e/` (spec mới hoặc mở rộng `purchase.spec.ts`) -- API và luồng SSE giả bằng `page.route`: tab ở nền rồi visible khi Đơn đã `paid` → Thành công < 3 giây; tín hiệu SSE khi đang mở → Thành công + khoảnh khắc; các màn `buyerStatus`; chờ lâu (`page.clock`); mất mạng; `buyerStatus` lạ; không SSE → polling 2 giây.
- [x] `ARCHITECTURE-SPINE.md` (AD-17: đường SSE, tín hiệu nối lại; bảng `buyerStatus`), `epic-3-context.md`, `deferred-work.md` (đóng hai mục 3.7 từ review 3.3; thêm: Playwright full-stack cho AI-6, "Đã gửi Vé tới {email}" cho 3.8, copy mất mạng đúng AC cho 3.8/3.9) -- tài liệu khớp code.

**Acceptance Criteria:**
- Given một thay đổi Đơn sau TX1 commit, when có người đăng ký đúng Đơn, then tín hiệu tới trong < 1 giây; cùng thay đổi bị rollback thì không có tín hiệu.
- Given TX1 tạo Đơn (có phí hoặc 0đ), when commit, then không có `NOTIFY` nào.
- Given `pnpm test`, `pnpm typecheck`, `pnpm lint:deps`, `pnpm test:e2e`, when chạy, then pass; `platform/realtime` không import `modules/`.

## Implementation Notes

- **API:**
  - `platform/realtime`: `notify.ts` (`realtime.notify`, kênh `tickee_realtime`, payload kiểm bằng `RealtimeSignal`); `realtime-hub.ts` (`RealtimeHub.open(req, res, filter)`, `isReady()`, nối lại 1 giây gấp đôi tới 30 giây, `resync`); `realtime.module.ts` (`@Global`, chỉ trong `ApiModule`).
  - `ordering/order-changed.ts` (`notifyOrderChanged`, `orderSignalColumns`) dùng ở `pay` (trừ `free`), `moveToReview`, `expireOrder`, `markExpired`, `PaymentLinks.attach`, `PaymentLinks.expire`.
  - `ordering/buyer-status.ts` (`buyerStatusOf`) tính `buyerStatus` theo bảng. `organizer.organizerContactOf` cung cấp kênh liên hệ BTC.
  - Route `live` gọi `OrdersService.liveOrderId` (cùng `ownOrder`).
- **Contracts:**
  - `realtime.ts`: `RealtimeTopic` (5 topic), `RealtimeSignal` (strict), `REALTIME_RESYNC`, `RealtimeStreamMessage`, `REALTIME_HEARTBEAT_SECONDS`.
  - `order.ts`: `BuyerOrderStatus`, `isBuyerOrderStatus`, `BuyerOrderOrganizer`, `BuyerOrderView`, `buyerOrderLiveApiPath`. `buyerStatus` nhận cả chuỗi lạ để web không vỡ parse.
- **Web:**
  - `lib/realtime/live-signal.ts`: bộ gom 1 giây (chạy ngay ở lời nhắc đầu, gộp phần còn lại thành một lần cuối cửa sổ), chọn polling, độ trễ mở lại.
  - `lib/realtime/use-live-resource.ts`: hook; `EventSource` chỉ mở khi đã có dữ liệu.
  - `lib/order/live.ts`: chu kỳ polling theo `buyerStatus`, `LONG_WAIT_MS`, cờ "khoảnh khắc", `nextMoment`.
  - Component mới: `components/tickee/{reassurance-line,organizer-contact}.tsx`. `OrderSuccess` nhận `celebrate`.
- **Lựa chọn khi làm:**
  - Đơn `pending` quá hạn mà chưa có link vẫn hiện màn "Chưa tạo được link thanh toán" của 3.4, không hiện "Đang xác nhận thanh toán": Người mua không thể đã trả.
  - Dòng chờ lâu và dòng mất mạng chỉ nằm ở màn chờ có link.
  - `RealtimeSignal.eventId` bắt buộc. Topic cấp BTC sau này (`org_*`) không có Sự kiện, nên story dùng chúng phải nới schema.
- **Thay đổi test cũ:**
  - Mọi test api đọc `status` của response Đơn chuyển sang `buyerStatus`.
  - Test đồng hồ 3.4 trong `purchase.spec.ts` chạy quá 2 phút, nên giờ khẳng định `reassurance-line`. Dòng "Đang xác nhận…" trước mốc 2 phút có test riêng trong `order-live.spec.ts`.
  - `roles.process.test.ts` kiểm `/readyz` 200 ở vai api thật.
- **Kiểm chứng:**
  - Subagent đã chạy và báo pass: `pnpm test` (contracts 253, web 192, api 892), `pnpm typecheck`, `pnpm lint:deps`, `pnpm test:e2e` (720 pass, ios-webkit + android-chromium).
  - Đột biến: bỏ phần tải lại khi SSE mở hoặc có tín hiệu thì e2e "tín hiệu SSE khi đang mở" fail trên cả hai trình duyệt.
- **Sau review vòng 1 (nhóm A–M trong Review Triage Log):**
  - Hub: client `LISTEN` có `keepAliveInitialDelayMillis` 10 giây và `query_timeout` 3 giây; trần nối lại 5 giây; `open()` từ chối 503 khi chưa `LISTEN` (khớp `/readyz`); mỗi stream mở với `retry:` ngẫu nhiên 1–5 giây. Spine AD-17 cập nhật theo.
  - Web: `OrganizerContact` dùng `useId()`; dòng mất mạng hiện ở cả màn chờ chưa có link.
  - Test:
    - Test tắt máy đi qua `app.close()` với stream đang mở.
    - Test payload NOTIFY tự tạo tín hiệu.
    - Ca `PaymentLinks.expire` (mã `1007`).
    - E2E dùng `EventSource` giả điều khiển được: tin `data:` trên stream đã mở gây tải lại < 1,2 giây; không polling khi đang kết nối, rớt thì polling 2 giây lại.
    - Test reduced motion của `purchase.spec.ts` chạy với `celebrate` true.
  - `deferred-work.md`: thêm bàn giao cho 7.1 (phát tín hiệu khi hủy Sự kiện), mục #29 (lỗi tải lại không phải lỗi mạng), và test chập chờn `payout-default-job.test.ts` có từ trước 3.7 (baseline `bfd49bc` fail 2/6 khi chạy riêng).
  - Kiểm chứng lại sau patch: `pnpm typecheck`, `pnpm lint:deps`, `pnpm test` (contracts 253, web 192, api 893) và `pnpm test:e2e` (726 pass trên ios-webkit + android-chromium) đều pass.

## Spec Change Log

## Review Triage Log

Vòng 1 (review_loop_iteration 0). Nguồn: VG = Verification Gap (đã kiểm sẵn), BH = Blind Hunter, EC = Edge Case Hunter.

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | VG | Không test nào chứng minh tin `data:` trên stream đã mở gây tải lại: e2e "tín hiệu SSE khi đang mở" đổi Đơn sang `paid` trước khi mở stream, nên lần tải lại lúc `onopen` đã đủ để pass | medium | Khoảng trống đã kiểm. Bỏ `onmessage` (`use-live-resource.ts:113`) hoặc thêm dòng `event:` vào khung của hub thì test vẫn pass, mà Người mua đang mở trang không thấy Thành công | patch (nhóm J) |
| 2 | VG | Không test nào khẳng định không polling khi SSE đang kết nối | low | Khoảng trống đã kiểm. Đổi `refetchInterval` thành không xét `connected` thì mọi test vẫn pass; realtime cộng thêm tải thay vì thay polling (AD-17) | patch (nhóm K) |
| 3 | VG | Test reduced motion của màn Thành công (`purchase.spec.ts:1015`) giờ pass vô điều kiện vì mở thẳng Đơn không có cờ, `celebrate` false | low | Khoảng trống đã kiểm. Bỏ kiểm `matchMedia` ở `order-success.tsx:21` thì người bật reduced motion vẫn bị rung lúc khoảnh khắc mà test không bắt | patch (nhóm L) |
| 4 | VG | `PaymentLinks.expire` phát `order_changed` nhưng không test nào kiểm | low | Khoảng trống đã kiểm. Ca Tingee từ chối duy nhất trong `order-live.test.ts` dùng mã `1006` (đi `release`) | patch (nhóm M) |
| 5 | BH | SSE nửa mở không phát hiện được: heartbeat là comment, JS không thấy; `connected` vẫn true nên không polling | low | Có thật về cơ chế, nhưng heartbeat 25 giây giữ NAT/proxy sống; đổi mạng thì trình duyệt reset socket; tab ẩn rồi hiện có `visibilitychange`; quay về từ Tingee là tải trang mới. Sửa phải thêm watchdog phía client | reject |
| 6 | BH | Kết nối `LISTEN` không kiểm liveness; `keepAlive: true` không có `keepAliveInitialDelayMillis` nên theo mặc định OS (~2 giờ) | medium | `pg` 8.23 `client.js:96`: mặc định 0 → `setKeepAlive(true, 0)` dùng mặc định OS. Failover DB làm socket nửa mở thì `/readyz` vẫn 200 mà mọi tín hiệu mất, các stream không polling | patch (nhóm A) |
| 7 | BH | Không giới hạn số SSE mỗi user/instance, không thời hạn tối đa | low | Có thật, nhưng cần Người mua đã đăng nhập và sở hữu Đơn; REST cũng không giới hạn theo kiểu này. Sửa phải thêm đếm theo user + 429 | reject |
| 8 | BH | HTTP/1.1 giới hạn 6 kết nối mỗi origin: ~6 tab Trang Đơn chặn mọi REST tới api | low | Cần ≥ 6 tab Trang Đơn cùng mở trên HTTP/1.1; LB có TLS thường chạy HTTP/2. Sửa phải chia sẻ EventSource giữa tab hoặc ghi rủi ro vào spec | reject |
| 9 | BH | Tắt máy đóng mọi stream cùng lúc, không `retry:` có jitter: client cùng nối lại vào instance còn lại | low | Có thật lúc deploy; mỗi lần nối lại còn kéo một lần tải REST. Sửa trực tiếp: ghi `retry:` ngẫu nhiên khi mở stream | patch (nhóm D) |
| 10 | BH | Test tắt máy "không treo vì SSE" không chứng minh gì: `close()` của helper gọi `closeAllConnections`, còn hook gọi tay | low | Có thật: phép đo "< 5 giây" không thể fail vì SSE. Nest gọi `callDestroyHook` trước `dispose` (`nest-application-context.js:159-162`), nên đi qua `app.close()` mới kiểm đúng thứ tự | patch (nhóm E) |
| 11 | BH | Các điểm phát chưa có test: `PaymentLinks.expire`, `expireOrder` job (c), `moveToReview` từ `expired`, `markPaid` Đơn `expired` | low | Phần `PaymentLinks.expire`: như #4. Ba điểm còn lại dùng đúng dòng `notifyOrderChanged` đã được test qua nhánh khác của cùng hàm (`expireOrder` 'hold', `moveToReview` từ `pending`, `pay` từ `pending`) | patch (nhóm M, phần `expire`); phần còn lại false |
| 12 | BH | Không có ghi chú bàn giao cho 7.1: hủy Sự kiện đổi `buyerStatus` của mọi Đơn mà không Đơn nào đổi `status` (Đơn `review`/`paid`), nên stream `order_changed` theo id không nhận gì | low | Có thật: `buyerStatusOf` đọc `events.status`; Đơn `review` của Sự kiện hủy không qua CAS nào. Sửa trực tiếp: một mục `deferred-work.md` cho 7.1 | patch (nhóm I) |
| 13 | BH | Design Note "3.9 lọc theo tập Đơn của người xem" có lỗ: bộ lọc cố định lúc mở, Đơn mới không khớp | low | Sửa là sửa Design Notes của spec này; 3.9 có thể mở lại stream khi danh sách đổi | reject |
| 14 | BH | `buyerStatus: z.union([enum, z.string()])` thành `string`, `switch` không còn kiểm vét cạn; `isBuyerOrderStatus` chưa ai dùng | low | Đúng về kiểu, nhưng bảy trạng thái do spine chốt, ít khi thêm; nhánh `default` hiện màn an toàn. Sửa phải thêm thu hẹp + kiểm `never` ở nhiều chỗ | reject |
| 15 | BH | Khoảnh khắc chạy lại khi mở lại trang từ cache cũ (`awaiting_payment` trong cache, tải lại ra `paid`) | low | Cần điều hướng trong app quay lại Trang Đơn trong `gcTime`; 3.7 không có đường nào như vậy (quay về từ Tingee là tải trang mới). Sửa phải xét `isFetchedAfterMount` và làm vỡ khoảnh khắc của Đơn 0đ từ Checkout | reject |
| 16 | BH | Bộ lọc ném lỗi trong `dispatch` có thể làm sập tiến trình api | low | Bộ lọc hiện tại chỉ so chuỗi, không ném; `write` đã kiểm `destroyed`/`writableEnded`. Sửa phải thêm guard cho trạng thái chưa chỉ ra được | reject |
| 17 | BH | `RealtimeSignal.parse` trong `tx` có thể làm rollback thanh toán | false | Mọi bên gọi lấy id từ `RETURNING` của cột uuid và topic là hằng; parse không thể fail với đường hiện có. Fail ầm cho dữ liệu không thể tới là đúng | reject |
| 18 | BH | Màn Hết hạn vẫn hứa "kiểm tra Vé của tôi hoặc email", không có mục deferred | false | Câu này nằm nguyên văn trong AC 3.7 và có từ 3.4; quyết định của Mason chỉ hoãn "Đã gửi Vé tới {email}" và dòng mất mạng | reject |
| 19 | BH | Spec `in-review` mà sprint-status `in-progress` | false | Bước trình bày (step 5) đồng bộ sprint-status sang `review` | reject |
| 20 | BH | `OrganizerContact` dùng id cố định cho `aria-labelledby`, vẽ hai lần thì trùng id | low | Có thật khi tái dùng (3.9 order-card); sửa trực tiếp bằng `useId()` | patch (nhóm F) |
| 21 | BH | Test "payload NOTIFY đúng {type, id, organizationId, eventId}" phụ thuộc thứ tự test | low | Có thật: đọc mảng `notified` do test trước đổ vào; chạy riêng bằng `-t` thì fail. Sửa trực tiếp: test tự tạo một tín hiệu | patch (nhóm G) |
| 22 | EC | Mở stream lúc `LISTEN` đang rớt: client coi là đã kết nối, tắt polling, không nhận gì tới khi nối lại | low | Có thật: `open()` chỉ kiểm `closing`. `resync` tới khi nối lại, nhưng trong lúc chờ không polling. Sửa trực tiếp: từ chối 503 khi chưa `LISTEN`, khớp `/readyz` | patch (nhóm C) |
| 23 | EC | SSE nửa mở, `onerror` không bắn (như #5) | low | Như #5 | reject |
| 24 | EC | Backoff `LISTEN` lên 16–30 giây: DB hồi rồi mà mọi instance vẫn `/readyz` 503 tới 30 giây | medium | Có thật: mọi instance mất `LISTEN` cùng lúc khi DB chập, `failures` tăng tới trần 30 giây; LB rút mọi instance, REST và IPN ngừng sau khi DB đã hồi. Sửa trực tiếp: hạ trần nối lại | patch (nhóm B) |
| 25 | EC | `DATABASE_URL` trỏ vào pooler chế độ transaction thì `LISTEN` không bao giờ nhận gì | false | AD-23 bắt kết nối session trực tiếp cho `LISTEN` và pg-boss (pg-boss cũng hỏng dưới pooler đó); spec cấm thêm pooler | reject |
| 26 | EC | `LISTEN` không có timeout: DB nhận kết nối mà treo truy vấn thì `onModuleInit` chờ mãi, api không khởi động | low | `connectionTimeoutMillis` chỉ áp cho lúc nối; `query_timeout` của `pg` (`client.js:702`) chưa đặt. Sửa trực tiếp: một dòng cấu hình | patch (nhóm A) |
| 27 | EC | Một Người mua mở rất nhiều `/live` (như #7) | low | Như #7 | reject |
| 28 | EC | ≥ 6 tab trên HTTP/1.1 (như #8) | low | Như #8 | reject |
| 29 | EC | Tải lại lỗi 401/5xx/body sai khi đã có dữ liệu: màn chờ cũ hiện im lặng, polling lỗi mãi | low | Có từ 3.4: `order-view.tsx:227` chỉ báo lỗi khi chưa có dữ liệu, polling 5 giây cũ cũng vậy; 3.7 không đổi đường này | defer |
| 30 | EC | Màn chờ chưa có link (`provider_error`) không hiện dòng mất mạng | low | Có thật: dòng mất mạng nằm trong nhánh `checkoutUrl`; khối frozen không giới hạn dòng này ở màn có link. Sửa trực tiếp: đưa dòng ra ngoài nhánh | patch (nhóm H) |
| 31 | EC | Đơn `pending` của Sự kiện đã hủy vẫn `awaiting_payment`, nút "Thanh toán" còn | false | Bảng frozen ghi đúng như vậy; chưa có đường nào hủy Sự kiện (7.1), và AD-3 cho 7.1 chuyển `pending → cancelled`, khi đó bảng ra `event_cancelled` | reject |
| 32 | EC | Lệch đồng hồ app với DB làm `confirming` sớm/muộn | low | Cùng mẫu `serverNow` theo đồng hồ app có từ 3.4; NTP giữ lệch ở mức mili giây | reject |
| 33 | EC | `claim()`/`release()` đổi Đơn sau TX1 mà không phát tín hiệu | false | Khối frozen chỉ đòi phát khi đổi trạng thái hoặc link; `claim` chỉ ghi `payment_link_attempt_at` (không có trong view), `release` không đổi `payment_link`; Code Map đã ghi bỏ qua `release` | reject |

## Design Notes

- **SSE riêng theo tài nguyên, hub dùng chung:** `platform/realtime` không biết `buyerScope`. Mỗi mô-đun mở endpoint của mình, kiểm quyền, rồi đăng ký với hub bằng bộ lọc trên payload `{type, id, organizationId, eventId}`. 3.11 lọc `event_orders_changed` theo `eventId` sau khi kiểm Owner/Admin; 3.9 lọc theo tập Đơn của người xem. Payload không có `userId`, nên lọc theo id đã kiểm lúc mở stream.
- **Nối lại `LISTEN` → tín hiệu tải lại cho mọi stream,** thay vì đóng stream: không mất tín hiệu ở khoảng mất kết nối, không làm cả nghìn client cùng nối lại.
- **`confirming` tính ở server** (`pending` và giờ máy chủ ≥ `expires_at`) để mở lại trang sau hạn hiện đúng ngay. Web vẫn tự chuyển khi đồng hồ về 0, không chờ tải lại.
- **Không `NOTIFY` cho Đơn 0đ:** `pay` nguồn `free` chạy trong TX1 (AD-17 cấm). Người mua nhận `paid` ngay trong response. 3.11 tự quyết việc báo dashboard.
- **Rủi ro còn lại:** trình duyệt nào chặn cookie bên thứ ba sẽ không gửi cookie trên `EventSource` cross-origin khi web và api khác site. Hook rơi về polling, nên Đơn vẫn tự cập nhật, chỉ chậm hơn.

## Verification

**Commands:**
- `pnpm test` -- expected: pass (contracts, api với Postgres thật + Tingee fake, web).
- `pnpm typecheck && pnpm lint:deps` -- expected: pass.
- `pnpm test:e2e` -- expected: pass trên ios-webkit và android-chromium.

**Manual checks (if no CLI):**
- `pnpm dev`, mở một Đơn có phí, chuyển tab, bắn IPN từ Tingee fake: quay lại tab thấy Thành công; DevTools có một kết nối `live` với heartbeat 25 giây.
