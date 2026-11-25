---
title: 'Story 5.5: Tra tay và check-in tay'
type: 'feature'
created: '2026-11-25'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '50f9fc54f4249a67a25b476a5eb67b4f98613471'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Khách không mở được Mã QR vé thì ở cổng không có cách nào cho vào: nút "Tra tay" trên Màn quét (5.3-b) đang tắt với lý do "Tra tay sắp có". Chưa có API tra Vé theo SĐT/email Người mua, cũng chưa có check-in tay (FR-29, AD-31, AD-35, UX-DR32).

**Approach:**
- API: route tra tay nhận SĐT hoặc email **đầy đủ** và trả các Vé hợp lệ của Sự kiện có Đơn khớp. Route check-in tay nhận `Idempotency-Key` và đi qua cùng `ticketing.checkIn` như khi quét. Giới hạn tốc độ tra tay theo user và IP, đếm trong Postgres.
- Web: nút "Tra tay" mở `manual-lookup` (`Sheet` từ dưới lên). Kết quả check-in tay hiện bằng `scan-result-overlay`.

**Quyết định (Mason, 25/11/2026):**
- **Giữ một spec**, không tách API/web (khoảng 4.400 token, Mason chấp nhận rủi ro).
- **Sau check-in tay:** Sheet đóng khi overlay hiện, để overlay chạy đúng như lúc quét. Overlay đóng: kết quả còn Vé chưa check-in (khách đi nhóm) thì Sheet mở lại với ô tìm và kết quả cũ; hết thì về camera.
- **Vé đã hủy hoặc vô hiệu không hiện** trong kết quả, đúng hình kết quả của AD-35. Đơn chỉ còn Vé hủy → "Không tìm thấy Vé khớp."
- **Giới hạn tra tay:** cửa sổ trượt 10 phút, 60 lần mỗi tài khoản, 600 lần mỗi IP (WiFi sự kiện hoặc CGNAT dồn nhiều CTV vào một IP).

## Boundaries & Constraints

**Always:**
- **Đường đọc:** `checkin` và `ticketing` không được gọi `ordering` (`apps/api/module-graph.cjs`), nên tra tay nằm ở `flows`, giống quét (`checkin-scan.flow.ts`). Thứ tự: `ordering` (read model: id Đơn của Sự kiện có SĐT/email khớp), rồi `ticketing` (Vé `valid` của các Đơn đó, chỉ đọc bản chụp trên Vé). Mọi truy vấn đi qua `orgScope` và `event_id`.
- **Khớp:** khớp đầy đủ sau chuẩn hóa, không khớp một phần.
  - Có `@` → email: dùng `EmailAddress` (trim, chữ thường), so với `lower(orders.buyer_email)`.
  - Còn lại → SĐT: dùng `BuyerPhone` (về E.164, cùng luật với form mua), so với `orders.buyer_phone`.
  - Hàm phân loại `parseLookupQuery` đặt trong `packages/contracts`, web và api dùng chung.
- **Request:** tra tay là `POST` có body `{query}`, không đặt SĐT/email trên URL. Truy vấn sai dạng → `400 VALIDATION_FAILED`, không tính vào giới hạn. Giá trị đã tra không vào log, span hay `details` của lỗi.
- **Response:** `{tickets: [{ticketId, holderName, ticketTypeName, seq, count, checkedIn}]}`, sắp theo mã Đơn rồi `seq`. Không bao giờ có Mã QR vé, SĐT hay email.
- **Quyền:** cả hai route dùng `Permission.CHECKIN_LOOKUP` (Owner, Admin, CTV `active` của đúng Sự kiện). CTV ở Sự kiện khác → `403`.
- **Check-in tay:**
  - `POST`, header `Idempotency-Key` bắt buộc (UUID; thiếu hoặc sai → `400`);
  - khóa viết thường dùng làm `scanId` của `ticketing.checkIn`, nên gửi lại cùng khóa thì phát lại kết quả lần đầu;
  - `checked_in_by` = người bấm; response là `ScanResult` dựng bằng cùng hàm của quét;
  - không giới hạn tốc độ.
- **Giới hạn tra tay:** cửa sổ trượt, mẫu `OrderRateLimiter`. Bảng mới `checkin_lookup_attempts(user_id, ip_hmac, created_at)` chỉ lưu HMAC của IP, dọn dòng cũ ở job dọn định kỳ. Đếm mỗi lần tra đủ dạng tới server, theo con số ở Quyết định. Vượt → `429 CHECKIN_LOOKUP_RATE_LIMITED` kèm `retryAfterSeconds`.
- **Web `manual-lookup`:**
  - chạm vùng hiển thị:
    - `Sheet side="bottom"`, tiêu đề "Tra tay";
    - nhãn luôn hiện "SĐT hoặc email Người mua"; ô tìm tự focus;
  - gửi tra:
    - debounce ~200ms; chỉ gửi khi `parseLookupQuery` nhận ra giá trị;
    - ô có chữ mà chưa đủ dạng → dòng meta "Nhập đủ SĐT hoặc email để tra.";
    - kết quả cache theo giá trị đã chuẩn hóa; không tự thử lại; không refetch khi focus;
  - hiển thị kết quả:
    - dòng "N Vé khớp";
    - mỗi hàng có tên, "Hạng vé · Vé k/N", `status-badge` (Hợp lệ → success, Đã check-in → neutral), và nút "Check-in" khi chưa check-in;
    - không có Vé → "Không tìm thấy Vé khớp.";
    - `429` → "Tra quá nhiều lần. Thử lại sau N giây.";
    - lỗi mạng hoặc 5xx → dải lỗi kèm "Thử lại";
    - trình duyệt offline → dòng "Tra tay cần mạng.";
  - bấm "Check-in":
    - nút có spinner; mọi nút "Check-in" khác tắt trong lúc chờ;
    - mỗi lượt bấm một `Idempotency-Key`; lỗi mạng hoặc 5xx thì bấm lại dùng cùng khóa;
    - kết quả `ok`/`recent`/`already` đổi hàng thành "Đã check-in" ngay trong cache (không tra lại);
    - `ok` làm mới số đã check-in ở đỉnh Màn quét;
    - `401` và `403` xử lý như khi quét.
  - Màn quét: camera không giải mã khi Sheet đang mở. "Tra tay" bật ở mọi màn hiện nó (viewport, "Bật camera", camera bị từ chối, camera không mở được). Overlay của check-in tay hiện được ở cả các màn đó.

**Never:**
- Không thêm cột SĐT/email hay khóa tra lên `tickets`. Không đổi `ticketing.checkIn`, `markPaid` hay schema `orders`. Không thêm index cho `orders`, vì lọc theo `event_id` đã có index.
- Không khớp một phần, không tra theo tên hay vài số cuối (câu hỏi mở của epic, giữ mặc định). Không tra theo email tài khoản hiện tại (`identity`), chỉ theo bản chụp trên Đơn.
- Không check-in tay khi offline. Không có hàng đợi.
- Không làm: thu hồi CTV, màn hết quyền `EVENT_ENDED` (5.6); SSE số check-in (5.7); xóa tài khoản làm tra tay không còn khớp (7.6, ẩn danh bản chụp Đơn); audit tra tay (spine không yêu cầu).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tra theo SĐT | `0912 345 678`, Đơn `+84912345678` có 2 Vé hợp lệ (1 đã check-in) | 2 hàng; hàng đã check-in có `checkedIn: true` | N/A |
| Tra theo email | `  Minh@Gmail.com ` so với Đơn `minh@gmail.com` | Khớp | N/A |
| Khớp một phần | `0912345` hoặc `minh@` | Web không gửi; gửi tay → `400`, không tính lượt | N/A |
| Đơn của Sự kiện khác | SĐT có Đơn ở Sự kiện khác cùng BTC | `{tickets: []}` | N/A |
| Vé đã hủy | Đơn khớp, Vé `cancelled` | Không có trong kết quả | N/A |
| Check-in tay | Vé hợp lệ, khóa mới | `ok`, `checked_in_by` = người bấm, tín hiệu realtime | N/A |
| Gửi lại cùng khóa | Lần đầu đã ghi | `ok` như lần đầu | N/A |
| Người khác đã check-in | Hàng cũ trên Sheet | `already` kèm lúc và người | Overlay đỏ |
| Vượt giới hạn | Lượt tra vượt theo user hoặc IP | `429 CHECKIN_LOOKUP_RATE_LIMITED`, `retryAfterSeconds` | Dòng báo trong Sheet |
| CTV Sự kiện khác | Gọi API Sự kiện không được giao | `403` | Như quét |

</frozen-after-approval>

## Code Map

**API**
- `apps/api/src/flows/checkin-scan.flow.ts`: `toScanResult` (:88), `checkedByOf`, `scanTicket` (:117) bọc `measured`. Check-in tay dùng lại `toScanResult` (export hoặc chuyển chỗ). Controller mẫu: `checkin-scan.controller.ts` (`@EventAccess`, `no-store`, `parseRequest`). Đăng ký controller ở `flows/flows.module.ts:19`.
- `apps/api/src/modules/ticketing/check-in.ts:73` `checkIn(tx, {ticketId, eventId, organizationId, userId, scanId})`. Không sửa. `ticketId` lạ → `BAD_SIGNATURE`; Vé của Sự kiện khác → `OTHER_EVENT`. Từ UI không đi tới hai nhánh này; validate `ticketId` là uuid (sai → `400`).
- `orders.buyer_phone` (E.164) và `buyer_email` (email tài khoản lúc đặt; đường Google có thể chưa viết thường), không có index (`modules/ordering/schema.ts:102-160`). Mẫu read model: `modules/ordering/match-read.ts`, `event-overview-read.ts` (nhận `DbExecutor` + scope, xuất qua `index.ts`).
- `tickets`: `order_id`, `seq`, `order_ticket_count`, `holder_name`, `ticket_type_name`, `order_code`, `status`, `checked_in_at` (`modules/ticketing/schema.ts:37-85`).
- Giới hạn tốc độ: chép mẫu `modules/ordering/order-rate-limit.ts` (HKDF từ `BETTER_AUTH_SECRET`, info riêng `checkin.lookup-attempts`, khóa advisory theo user, `nth()`), sang `modules/checkin/`. Config tiêm như `ordering.module.ts:56`. Dọn dòng cũ như `order_create_attempts` ở `modules/ordering/safety-net-jobs.ts`. Migration kế tiếp: `apps/api/drizzle/0036_*.sql` (+ meta).
- Contracts:
  - `packages/contracts/src/checkin.ts`: path và schema mới, đặt cạnh `checkinScanApiPath` (:128);
  - `errors.ts` + `apps/api/src/platform/http/app-error.ts` `DEFAULT_STATUS` (`429`);
  - `IDEMPOTENCY_KEY_HEADER`, `IdempotencyKey`, `BuyerPhone`: `order.ts:78-100`;
  - `EmailAddress`: `identity.ts:18`;
  - kiểm header: mẫu `assertIdempotencyKey`, `modules/payment/review-actions.controller.ts:20`.
- IP: `req.ip ?? req.socket.remoteAddress ?? 'unknown'` (mẫu `ordering/orders.controller.ts:21`).
- Test:
  - fixtures trong `apps/api/test/checkin/scan.test.ts` (`user`, `freeEvent`, `checkerOf`, `issue`, `ticketRow`) và `test/ordering/order-fixtures.ts` (`buyerInput`, `resetOrderRateLimit` làm mẫu reset);
  - test cách ly: thêm route vào danh sách ở `test/organizer/isolation.test.ts:83-193`. POST check-in tay cần khóa: xem ca đặc biệt review-item (:287-321).

**Web**
- `components/tickee/scanner-viewport.tsx:21-34` `ManualLookupButton`: bỏ `disabled` và `MANUAL_LOOKUP_PENDING`, nhận `onClick`. Nút này dùng ở 4 chỗ: viewport (:122), `EnableCamera`, `CameraDenied`, `CameraUnavailable` (trong screen).
- `app/(checkin)/events/[eventId]/checkin-event-screen.tsx`:
  - `result` (:268) và `ScanFlow`: overlay chỉ render khi camera `starting`/`running` (:234), cần render cả khi đang ở các màn khác;
  - `paused` (:332): thêm điều kiện Sheet mở;
  - mở khóa gate qua effect khi `result` về `null` (:340); check-in tay không khóa gate;
  - nhánh `onError` của `submit` (:280-308) là mẫu cho 401/403;
  - `closeResult` (:334) làm mới `checkinEventQueryKey` khi `ok`.
- `lib/checkin/api.ts` (`submitScan` :97 là mẫu); `lib/api/client.ts:92` `apiRequest`. Gửi header như `lib/reporting/api.ts:128-140`. Sinh khóa bằng `newFunnelId()` (`lib/event/funnel.ts:12`). Mẫu báo `429`: `rateLimitedMessage` (`lib/order/checkout-form.ts:152`).
- UI:
  - `components/ui/sheet.tsx` (`side="bottom"`, mẫu `app/(buyer)/orders/[code]/order-payment.tsx:41-60`; Sheet có kiểm soát `open`: `can-xu-ly/review-queue.tsx:300-392`);
  - hàng kết quả theo `can-xu-ly/match-dialog.tsx`;
  - `status-badge.tsx`, `Button loading`, `Label` + `Input`, `EmptyState`.
  - Chưa có hook debounce: viết `lib/use-debounced-value.ts`.
- Mockup: `ux-designs/ux-tickee-2026-10-27/mockups/key-checkin.html` §4. Nút "Check-in" `primary-on-light`, cao 44px. Theo nhãn của DESIGN/EXPERIENCE, không theo nhãn giả định trong mock.
- e2e:
  - `e2e/checkin-mock.ts` (`mockCheckinApi`, đọc header trong handler);
  - `e2e/checkin-scan.spec.ts` (`openScanScreen`, `startCamera`, `overlay`, `manualLookup`). Các assert "Tra tay sắp có" + `toBeDisabled` (:181-183, 210-211, 785, 802, 816, ca 320px) phải đổi.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/checkin.ts`, `errors.ts` (+ `test/checkin.test.ts`) -- path tra tay và check-in tay, `CheckinLookupRequest`, `CheckinLookupResult`, `parseLookupQuery`, giới hạn, `CHECKIN_LOOKUP_RATE_LIMITED` + details -- hợp đồng dùng chung.
- [x] `apps/api/drizzle/0036_*.sql`, `modules/checkin/schema.ts`, `lookup-rate-limit.ts`, `checkin.module.ts`, `index.ts`, job dọn -- bộ đếm tra tay -- AD-31.
- [x] `modules/ordering/buyer-contact-read.ts` (mới) + `index.ts`, `modules/ticketing/lookup-read.ts` (mới) + `index.ts` -- read model id Đơn của Sự kiện khớp SĐT/email; Vé `valid` theo danh sách Đơn -- AD-35.
- [x] `apps/api/src/flows/checkin-lookup.flow.ts`, `checkin-lookup.controller.ts`, `flows.module.ts`, `app-error.ts` -- hai route theo Boundaries -- FR-29.
- [x] `apps/api/test/checkin/lookup.test.ts`, `test/organizer/isolation.test.ts` -- phủ mọi dòng Matrix phía API, `429` theo user và theo IP (reset bộ đếm giữa test), lỗi không chứa giá trị tra, hai request check-in tay song song khác khóa khác người → đúng 1 `ok`.
- [x] `apps/web/lib/checkin/api.ts`, `lib/use-debounced-value.ts` -- gọi hai route, debounce.
- [x] `apps/web/components/tickee/manual-lookup.tsx` (mới), `scanner-viewport.tsx`, `checkin-event-screen.tsx` -- `manual-lookup`, nối nút, overlay, tạm dừng giải mã.
- [x] `apps/web/e2e/checkin-lookup.spec.ts` (mới), `checkin-mock.ts`, `checkin-scan.spec.ts` -- phủ dòng Matrix phía web, giữ khóa khi gửi lại, ca 320px.

**Acceptance Criteria:**
- Given Màn quét, when bấm "Tra tay", then Sheet mở từ dưới, ô tìm có focus, nhãn "SĐT hoặc email Người mua" luôn hiện, và một mã QR đưa vào camera không tạo request quét.
- Given gõ lần lượt từng ký tự của một SĐT 10 số, when chạy e2e, then chỉ có đúng một request tra, gửi sau khi đủ số.
- Given response tra và response check-in tay, when kiểm body, then không chứa Mã QR vé, SĐT hay email.
- Given Sheet ở màn rộng 320px, then không cuộn ngang, và tên dài bị cắt mà không đẩy nút "Check-in" ra ngoài.

## Implementation Notes

- **Đã làm (25/11/2026):** đủ 8 task.
  - API: route `POST …/lookups` và `POST …/tickets/:ticketId/check-in`, cùng ở `flows/checkin-lookup.controller.ts`.
  - Migration `0036_checkin_lookup_attempts.sql`.
  - Job dọn `checkin.purge-lookup-attempts` (cron 10 phút) đặt trong `CheckinJobsModule` mới, đăng ký ở `worker.module.ts`, không gộp vào `ordering/safety-net-jobs.ts`.
  - Web mới: `components/tickee/manual-lookup.tsx`, `lib/checkin/manual-lookup.ts` (câu chữ và hàm thuần), `lib/use-debounced-value.ts`, `e2e/checkin-lookup.spec.ts`, `test/manual-lookup.test.ts`.
- **Chọn khi spec chưa nói rõ:**
  - Bộ đếm nằm trong `CheckinLookupLimitModule.forRoot(config)` (toàn cục), tách khỏi `CheckinModule`. `checkin-access.test.ts` thay `CheckinModule` theo định danh lớp, nên biến module đó thành module động sẽ làm test hỏng.
  - `ScanResultOverlay` render qua portal vào `body`. Nếu không, trong lúc Sheet đang đóng (animation), overlay nằm dưới Sheet và bị `aria-hidden`.
  - Sheet bỏ qua `pointerdown` bên ngoài khi nó bắt nguồn từ overlay. Trên WebKit, lượt chạm đóng overlay đỏ tới muộn và đóng luôn Sheet vừa mở lại.
  - Check-in tay ra `invalid`: hàng giữ nguyên, Sheet mở lại theo luật "còn Vé chưa check-in".
  - Lỗi mạng hay 5xx khi check-in tay: không có overlay; dải "Chưa check-in được…" hiện trong Sheet.
  - Bấm "Tra tay" từ màn quét luôn mở Sheet với ô tìm trống. Chỉ lần mở lại sau overlay mới giữ ô tìm cũ.
  - Camera không giải mã cả khi overlay đang phủ, vì check-in tay không khóa cổng quét.
- **Verification (25/11/2026):**
  - Subagent: contracts 360, toàn bộ API 1.762, web unit 449, `typecheck`, `lint:deps`. e2e `checkin-lookup` (28) và `checkin-scan` pass ở hai project.
  - Chạy lại ở phiên chính: contracts, web unit, `typecheck`, `lint:deps` pass. API `test/checkin test/ticketing test/organizer/isolation.test.ts`: 191/191.
  - Chưa làm: manual check trên điện thoại thật.
- **Sau review lượt 1 (P1–P13):**
  - Code:
    - tra tay và check-in tay có hạn 3 giây, dùng chung helper `withScanTimeout` với `submitScan`; hết hạn thì coi là lỗi mạng (check-in giữ khóa);
    - "Tra tay" mở mới thì xóa cache tra của Sự kiện (`checkinLookupQueryPrefix`), và Sheet mở với ô trống thì xóa lỗi check-in cũ;
    - phím Enter/Search làm ô tìm mất focus;
    - overlay có `pointer-events-auto`;
    - mock e2e dùng kiểu `CheckinLookupTicket`.
  - Test thêm:
    - e2e: gõ email từng ký tự; mở mới không hiện hàng cũ (MutationObserver) và tra lại gửi request mới; dải lỗi cũ mất khi mở mới; Enter; không giải mã sau overlay tay; quét tới khi Sheet mở; overlay không nằm trong `aria-hidden`;
    - unit: hạn chờ của hai hàm mới;
    - API: 3 lần tra song song ở lượt thứ `perUser` cho ra `[200, 429, 429]`.
- **Verification sau review (25/11/2026, phiên chính, chạy tuần tự):** contracts 360, API `test/checkin test/ticketing test/organizer/isolation.test.ts` 192, web unit 455, `typecheck`, `lint:deps`, build web, e2e `checkin-lookup` + `checkin-scan` 92/92 ở hai project.
  - Lần chạy e2e đầu (trước review) bị sập bộ chạy ở test 65/84, không test nào fail; chạy lại thì pass.

## Spec Change Log

## Review Triage Log

Lượt 1 (25/11/2026). VG = Verification Gap, BH = Blind Hunter, EC = Edge Case Hunter.

| # | Phát hiện | Verdict | Bằng chứng | Hướng |
|---|---|---|---|---|
| VG1 | Debounce không được kiểm: bỏ debounce thì test "một request" vẫn pass | medium | Lớp VG đã kiểm: không tiền tố nào của SĐT parse được; test email dùng `fill` | patch (P1) |
| VG2 | "Mở Tra tay mới không lộ hàng của khách trước" chỉ kiểm bằng `toHaveCount(0)` tự thử lại | medium | Lớp VG đã kiểm: đổi `query = settled` thì hàng cũ hiện ~200ms mà test vẫn pass | patch (P2) |
| VG3 | Camera không giải mã sau overlay check-in tay (`result !== null`) chưa có test | medium | Lớp VG đã kiểm: bỏ điều kiện thì một mã quét đè lên kết quả tay và mất cờ mở lại Sheet, không test nào hỏng | patch (P3) |
| VG4 | Kết quả quét tới khi Sheet đang mở (mở lại Sheet sau overlay) chưa có test | low | Lớp VG đã kiểm: đổi thành `showResult(scanned, false)` không test nào hỏng | patch (P4) |
| VG5 | Overlay qua portal (không nằm trong cây `aria-hidden` khi Sheet đang đóng) chưa có test | medium | Lớp VG đã kiểm: bỏ portal thì trình đọc màn hình mất thông báo, test vẫn pass | patch (P5) |
| VG6 | Khóa advisory theo tài khoản của bộ đếm tra tay chưa có test song song | low | Lớp VG đã kiểm: mọi test giới hạn đều tuần tự; lớp này đề xuất defer vì bộ đếm tạo Đơn cũng thiếu, nhưng khóa của tra tay là code mới và test chỉ thêm một ca | patch (P6) |
| BH1 | Tra tay và check-in tay không có hạn chờ: request treo làm hàng quay spinner, mọi nút "Check-in" khác tắt mãi | medium | Đúng: `apiRequest` không có timeout; chỉ `submitScan` có hạn 3 giây. Ở cổng sóng yếu (bối cảnh 5.4) dễ gặp | patch (P7) |
| BH2 | Kết quả tra cache `staleTime: Infinity` qua các lần mở Sheet: tra lại cùng số ra "Không tìm thấy" cũ khi khách vừa trả tiền | medium | Đúng: query giữ trong cache 5 phút sau khi không còn observer; spec chỉ cần cache trong một lần mở (gõ lại, mở lại sau overlay) | patch (P8) |
| BH3 | Kết quả `invalid` (hủy, vô hiệu, Sự kiện đã kết thúc) để hàng vẫn "Hợp lệ" và Sheet mở lại | low | Đúng, nhưng hiếm: Vé chỉ bị hủy hay vô hiệu qua 7.1/7.5 (chưa làm), và `EVENT_ENDED` cần Sự kiện kết thúc đúng lúc Sheet đang mở. Sửa phải thêm nhánh | reject |
| BH4 | Đóng Sheet khi check-in tay đang chờ: kết quả tới sau vẫn hiện overlay và mở lại Sheet | low | Đúng, nhưng overlay của một check-in đã ghi là thông tin có ích; phần dải lỗi bị giấu đã xử lý ở P9. Sửa phải theo dõi trạng thái mở | reject |
| BH5 | Dải "Chưa check-in được…" của lần trước còn trên Sheet mới của khách sau | low | Đúng: `openLookup` xóa chữ ở màn cha, không gọi `checkIn.reset()`. Gặp sau mọi lỗi mạng; sửa trực tiếp | patch (P9) |
| BH6 | Trạng thái `429` không có "Thử lại"; giá trị dự phòng 60 giây khác cửa sổ 600 giây | low | Đúng là phải sửa chữ trong ô mới tra lại được (TanStack tự tải lại query lỗi khi đổi khóa rồi quay về). 60 lần/10 phút hiếm chạm; dự phòng chỉ dùng khi thiếu `details`, mà api luôn gửi | reject |
| BH7 | Như VG6 | low | Trùng VG6 | patch (gộp P6) |
| BH8 | Thiếu test: quét tới khi Sheet mở; đóng Sheet khi đang check-in; unit test `useDebouncedValue` | low | Phần đầu trùng VG4. Phần hai thuộc hành vi đã bác ở BH4. Hook không unit test được (Vitest web chạy node, chỉ hàm thuần), đã phủ bằng e2e ở P1 | patch (gộp P4, P1) |
| BH9 | Không phân biệt check-in tay với quét (metric, span) | low | Không có hại cụ thể: metric NFR-2 chỉ đo quét; audit tra tay nằm ngoài phạm vi (Never). Thêm metric là bề mặt mới | reject |
| BH10 | Tra tay không có giới hạn số Đơn/Vé | low | Một liên hệ thực tế chỉ có tới vài trăm Đơn mỗi Sự kiện (giới hạn tạo Đơn 10 lần/10 phút mỗi tài khoản); trần 65.535 tham số của `inArray` không với tới. Sửa phải thêm trần và UI báo bị cắt | reject |
| BH11 | Focus rơi về `body` khi overlay đóng mà Sheet không mở lại | low | Overlay quét từ 5.3 cũng vậy (nút autoFocus rời DOM). Màn quét ưu tiên chạm; sửa phải thêm quản lý focus | reject |
| BH12 | Phím "Search" trên bàn phím điện thoại không làm gì, bàn phím che kết quả | low | Đúng: có `enterKeyHint="search"` nhưng không có xử lý. CTV hay bấm phím này; sửa trực tiếp (blur ô tìm) | patch (P10) |
| BH13 | Chưa test log ở đường lỗi DB (params có SĐT/email) | false | `error.filter.ts` ghi lỗi qua `loggableError`/`dbErrorSummary`, không ghi params; reviewer cũng nói đường này đang an toàn | reject |
| BH14 | Mock e2e tự khai báo lại kiểu `LookupTicket` | low | Đúng; các file e2e khác đã import `@tickee/contracts`. Sửa trực tiếp bằng alias kiểu | patch (P11) |
| BH15 | Dòng doc comment ở `scanner-viewport.tsx` vượt 120 cột | low | Đúng; sửa trực tiếp | patch (P12) |
| EC1 | Như BH5 | low | Trùng BH5 | patch (gộp P9) |
| EC2 | Như BH3 | low | Trùng BH3 | reject (gộp BH3) |
| EC3 | Kết quả quét và kết quả tay cùng tới thì cái sau đè overlay của cái trước | low | Cần một lần quét đang gửi lại (offline, 5.4) đúng lúc check-in tay thành công (cần mạng). Subagent cũng ghi là hiếm; sửa phải xếp hàng kết quả | reject |
| EC4 | Như BH4, thêm: quyết định mở lại theo khóa cũ khi đã gõ giá trị mới | low | Trùng BH4 | reject (gộp BH4) |
| EC5 | Radix đặt `body { pointer-events: none }` trong lúc Sheet đang đóng, nên lượt chạm overlay đỏ (portal vào `body`) bị nuốt ~200ms | low | Đúng: `DismissableLayer` với `disableOutsidePointerEvents` giữ style này tới khi layer gỡ hẳn sau animation. Sửa trực tiếp bằng `pointer-events-auto` | patch (P13) |
| EC6 | Gõ email có tiền tố hợp lệ (`minh@gmail.co`) thì tra thêm một lượt | low | Chỉ xảy ra khi dừng gõ ≥200ms ở tiền tố đó, đúng debounce spec chốt; kết quả là khớp đầy đủ email đó, không phải khớp một phần. Hành vi mặc định đã có test ở P1 | reject |
| EC7 | Như BH6 | low | Trùng BH6 | reject (gộp BH6) |
| EC8 | Như BH10, thêm: `inArray` vượt 65.535 tham số → 500 | low | Trùng BH10; cần hơn 65 nghìn Đơn cùng một liên hệ trong một Sự kiện | reject (gộp BH10) |

## Design Notes

- **Vì sao dùng khóa làm `scanId`:** `checkIn` đã phát lại theo (người, `scanId`), nên không cần bảng khóa riêng. Thử lại sau lỗi mạng ra đúng kết quả lần đầu, kể cả khi Sự kiện vừa đóng (5.4, BH1).
- **Vì sao tra tay là `POST`:** SĐT/email trên query string sẽ vào log truy cập và lịch sử. Request không đổi trạng thái nên không cần `Idempotency-Key`.

## Verification

**Commands:**
- `pnpm --filter @tickee/contracts test` -- expected: pass.
- `pnpm --filter @tickee/api exec vitest run test/checkin test/ticketing test/organizer/isolation.test.ts` -- expected: pass (cần Postgres từ docker compose).
- `pnpm --filter @tickee/web test` -- expected: pass.
- `pnpm typecheck && pnpm lint:deps` -- expected: không lỗi.
- `sh scripts/dev-env.sh pnpm turbo build --filter=@tickee/web && pnpm --filter @tickee/web exec playwright test e2e/checkin-lookup.spec.ts e2e/checkin-scan.spec.ts` -- expected: pass ở cả hai project.

**Manual checks:**
- Trên điện thoại thật: mở "Tra tay", bàn phím không che ô tìm và hàng kết quả đầu tiên.
