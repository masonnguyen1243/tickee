---
title: 'Story 3.9: Vé của tôi và Chi tiết Vé'
type: 'feature'
created: '2026-11-12'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '2dec2da5d7adafdf26deaf4033a3c51e49d05687'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Người mua chỉ thấy Vé trên Trang Đơn của từng Đơn. Không có nơi gom mọi Vé và Đơn đang chờ, nên đóng tab là mất dấu. Màn Thành công thiếu nút "Xem Vé của tôi" (UX-DR18). Menu tài khoản không có lối vào. Dòng mất mạng của Trang Đơn vẫn dùng copy tạm.

**Approach:** Thêm trang "Vé của tôi" có ba nhóm (Vé còn hiệu lực · Đơn đang chờ · Lịch sử) và trang Chi tiết Vé. Dữ liệu đến từ hai endpoint mới trong `buyerScope`, so `effective_end_at` bằng đồng hồ DB lúc request (AD-14). Thẻ Đơn tự cập nhật qua một stream SSE theo tập Đơn của người xem, chạy trên hub của 3.7. Gắn lối vào ở màn Thành công, menu tài khoản và email Vé.

## Boundaries & Constraints

**Always:**
- **`GET /v1/me/tickets`** (phiên Người mua) trả `MyTicketsView { serverNow, active[], pending[], history[] }`, chỉ dữ liệu có `user_id` = người gọi:
  - `active`: Vé có Sự kiện chưa quá `effective_end_at`. Mỗi mục có Sự kiện (tên, giờ, địa điểm), Hạng vé, "Vé k/N", mã Đơn, `status` (`valid` | `checked_in` | `cancelled`). Danh sách **không có QR**. Vé `cancelled`, hoặc Vé của Sự kiện `cancelled`, mang `status` = `cancelled`.
  - `pending`: Đơn chưa `paid`, Sự kiện chưa kết thúc, `buyerStatus` ∈ `awaiting_payment` | `confirming` | `under_review` | `cancelled_by_organizer` | `event_cancelled`, cộng Đơn `expired` trong 30 phút sau `expires_at` (xem Quyết định). Mỗi mục có `buyerStatus` (dùng lại `buyerStatusOf`), mã Đơn, Sự kiện, các dòng "Hạng vé × SL", tổng tiền, `expiresAt` và `organizer` (tên và kênh liên hệ). Không có QR, không lộ loại Cần xử lý hay số tiền lệch.
  - `history`: Vé có Sự kiện đã quá `effective_end_at`. Mỗi mục có tên Sự kiện, ngày, Hạng vé, "Vé k/N" và `attended` (đã check-in hay chưa).
  - Thứ tự: `active` theo giờ Sự kiện tăng dần, `pending` mới nhất trước, `history` giờ Sự kiện giảm dần. Không phân trang.
- **`GET /v1/me/tickets/:ticketId`** (phiên Người mua) trả `MyTicketDetail`.
  - Vé không thuộc người gọi, hoặc id sai dạng → `404 TICKET_NOT_FOUND`.
  - Vé `valid` hoặc `checked_in` mà Sự kiện chưa kết thúc và chưa hủy → có `qr` và `shareToken`.
  - Vé đã hủy, Sự kiện đã hủy hoặc đã quá `effective_end_at` → `qr` = `null`, `shareToken` = `null`. Server không ký QR trong các trường hợp này.
- **`GET /v1/me/tickets/live`** (SSE, phiên Người mua) chỉ đẩy `order_changed` của các Đơn mà người gọi sở hữu lúc mở stream. Lọc theo tập id đã tra lúc mở, vì payload AD-17 không có `userId` và giữ nguyên dạng đó.
- **Web `/tickets`** (trong `BuyerGate`):
  - Ba nhóm theo đúng thứ tự trên. Nhóm rỗng thì ẩn.
  - Tải lần đầu: `Skeleton` gồm 2 thẻ.
  - Không có gì cả: `empty-state` "Bạn chưa có vé nào. Vé bạn mua sẽ hiện ở đây.", không có nút.
  - Mỗi dòng Vé mở `/tickets/:ticketId`. Badge: Hợp lệ (success), Đã check-in (neutral), Đã hủy (danger).
- **`order-card`** (không bao giờ có QR):
  - `awaiting_payment`: `countdown-chip` đếm theo `serverNow`, kèm "Tiếp tục thanh toán" mở `/orders/:code`.
  - Đồng hồ về 0: "Đang xác nhận thanh toán", thẻ vẫn ở nhóm.
  - `under_review`: "BTC đang kiểm tra thanh toán", badge warning, kèm `OrganizerContact`, không có nút chính.
  - `cancelled_by_organizer` / `event_cancelled`: badge neutral "Đã hủy", kèm `OrganizerContact`, thẻ mờ nhẹ.
  - `expired`: badge neutral "Hết hạn", không có nút.
  - Thẻ tự cập nhật qua `useLiveResource` + `/me/tickets/live`. Stream mở lại khi tập mã Đơn trong danh sách đổi.
- **Web `/tickets/:ticketId`:**
  - `ticket-card` + Mã QR vé đầy đủ + "Chia sẻ Vé" / "Tạo lại link" (dùng lại 3.8).
  - `checked_in`: QR mờ .25 + badge "Đã check-in".
  - Đã hủy: badge "Đã hủy", không có QR. Nếu Sự kiện hủy thì ghi "Sự kiện đã hủy. BTC sẽ liên hệ hoàn tiền.", còn lại hiện `OrganizerContact`.
  - Sau mốc kết thúc: hàng lịch sử (tên Sự kiện, ngày, "Đã tham dự" / "Chưa check-in"), không có QR, không có nút chia sẻ.
  - Khối "Biên nhận" (xem Quyết định), hiện cả khi đã sang lịch sử.
  - 404: `empty-state` "Không tìm thấy Vé".
- **Lối vào:**
  - Màn Thành công thêm nút `button-primary-on-light` "Xem Vé của tôi" → `/tickets`.
  - Menu tài khoản thêm mục "Vé của tôi".
  - Email Vé thêm một dòng link tới `/tickets`.
  - Dòng mất mạng của Trang Đơn đổi thành "Mất kết nối — vé vẫn được gửi qua email và Vé của tôi."
- **Quyết định của Mason (12/11):**
  - **Thẻ "Hết hạn":** `pending` của API có thêm Đơn `expired` trong 30 phút sau `expires_at` (so bằng đồng hồ DB). Thẻ hiện "Hết hạn" rồi tự rời nhóm ở lần tải sau mốc đó. Web không bao giờ tự suy ra "Hết hạn".
  - **Biên nhận ở Chi tiết Vé:** mã Đơn; mỗi dòng "Hạng vé × SL · thành tiền"; tổng đã trả (Đơn 0đ ghi "Miễn phí"); thời điểm thanh toán; "Tiền đã chuyển thẳng cho {BTC}" (chỉ Đơn có phí). `MyTicketDetail` mang các trường này.
  - **Độ sáng:** không có API chỉnh độ sáng, nên dùng Screen Wake Lock (giữ màn hình không tối) khi Chi tiết Vé đang hiện QR. Nhả khi rời trang hoặc tab ẩn, xin lại khi tab hiện lại. Trình duyệt không hỗ trợ hoặc từ chối thì bỏ qua, không báo lỗi.
  - **Giữ cả spec** dù khoảng 5.500–6.000 token: hai trang, API, stream và lối vào là cùng một mục tiêu của Người mua.

**Never:**
- Không tra Vé theo SĐT, không có ô tìm kiếm.
- Không lưu Chi tiết Vé để xem offline.
- Không làm ảnh Story (8.1).
- Không đổi dạng `RealtimeSignal`, `BuyerOrderView`, `BuyerTicket` hay ngữ nghĩa `buyerStatusOf`.
- Không phát tín hiệu mới khi check-in hay hủy Sự kiện (Epic 5, 7.1).
- Không làm dòng "Chưa cập nhật được" cho lỗi 401/5xx của Trang Đơn.
- Người nhận link chia sẻ không thấy Vé trong "Vé của tôi" của mình. Tuyệt đối không ghi gì từ đường xem.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Chưa có gì | User chưa có Đơn hay Vé | `empty-state`, không nút | — |
| Đơn chờ về 0 | `pending`, quá `expires_at` theo `serverNow` | Thẻ hiện "Đang xác nhận thanh toán", vẫn ở nhóm | Không bao giờ tự hiện "Hết hạn" theo đồng hồ máy |
| Đơn chờ được trả | IPN → `paid` | `order_changed` → tải lại: thẻ rời nhóm, Vé vào `active` | Không có SSE thì polling |
| Đơn hết hạn | API trả `expired`, trong 30 phút sau `expires_at` | Thẻ "Hết hạn", không nút; quá 30 phút thì không còn trong `pending` | Tiền về muộn → `paid` thì Vé hiện như thường |
| Đơn bị BTC từ chối | `cancelled` | Thẻ "Đã hủy" + liên hệ BTC | — |
| Vé đã check-in | `checked_in_at` có | Danh sách: badge "Đã check-in"; Chi tiết: QR mờ .25 + badge | — |
| Sự kiện kết thúc | DB `now()` > `effective_end_at` | Vé chỉ còn ở `history`; Chi tiết không có QR | — |
| Vé của người khác | `ticketId` của user B | `404 TICKET_NOT_FOUND`; danh sách không có Vé đó | — |
| Người nhận link | Mở `/xem-ve#…` khi đã đăng nhập | "Vé của tôi" của họ không đổi | — |
| Stream | Đơn của user B đổi | Stream của user A không nhận tín hiệu | — |

</frozen-after-approval>

## Code Map

Đường dẫn api tính từ `apps/api/src/`, web từ `apps/web/`, trừ khi ghi đủ.

- **Contracts:**
  - `packages/contracts/src/order.ts`: `orderPath:23`, `BuyerTicket:283`, `BuyerOrderStatus:332`, `BuyerOrderOrganizer:353`, `BuyerOrderView:374`. Giữ nguyên, chỉ dùng lại.
  - `tickets.ts`: `SHARED_TICKET_PATH:19`, `SharedTicketStatus:33`, `sharedTicketUrl`.
  - `realtime.ts:37` `RealtimeSignal` (strict, không `userId`; không đổi).
  - `errors.ts:198` `TICKET_NOT_FOUND`.
  - Formatter: `money.ts:5` `formatVnd`; `event.ts:217-246` `formatEventDateTime`, `formatVnDate`.
- **Event:**
  - `modules/event/public-event.ts:127-155`: `TicketEventRef` / `ticketEventById`, có `ended` theo đồng hồ DB. Thêm bản batch theo danh sách id, xuất qua `event/index.ts`.
- **Ticketing** (chỉ được import `event`):
  - `modules/ticketing/schema.ts:25` `tickets`: `user_id`, `status`, `cancel_reason`, `checked_in_at`, `seq`, `order_ticket_count`, snapshot. Index `tickets_user_id_event_id_idx` đã có.
  - `tickets.service.ts`:
    - `ticketsOfOrder:118`: giữ chữ ký và hành vi, vì email Vé dùng nó.
    - `sharedTicket:145`, `eventOpenForTicket:30`: mẫu cho luật QR / `ended`.
    - `regenerateShareLink:182`: lọc theo `userId`.
  - `qr.ts` `signTicketQr`; `share-token.ts` `shareTokenOf`.
  - Read model mới đặt trong `ticketing`, xuất qua `ticketing/index.ts`.
- **Ordering** (gom Đơn + Vé + liên hệ BTC; chỉ `ordering` import được cả ba):
  - `modules/ordering/orders.controller.ts:13` `buyerOf`; `:65-81` `GET me/orders/:code` và `/live`. Mẫu SSE: `realtime.open(req, res, filter)`.
  - `orders.service.ts`:
    - `ownOrder:273`: mẫu `buyerScope`.
    - `view:505`: mẫu ghép `organizerContactOf`, `serverNow`.
  - `buyer-status.ts:17` `buyerStatusOf`.
  - `schema.ts:98` `orders`: index `(user_id, created_at)`; không có cột loại review. `order_items:167`: `ticket_type_name`, `unit_price`, `quantity`.
  - `ordering.module.ts:36`: danh sách controller.
  - `buyer-email.ts`: mẫu email Vé, thêm dòng link.
  - `organizer/index.ts:12` `organizerContactOf`.
- **Realtime:** `platform/realtime/realtime-hub.ts:127` `open`. `order_changed` phát từ `ordering/order-changed.ts:15`; Đơn 0đ cố ý không phát.
- **Web:**
  - `app/(buyer)/layout.tsx:5-16`: slug tiếng Anh. Sửa comment `:6`.
  - `app/(buyer)/buyer-gate.tsx:16-62`: `BuyerGate`, `BuyerSkeleton`.
  - `app/(buyer)/orders/[code]/`:
    - `order-view.tsx`: hằng copy `:39-44` chưa export, chuyển sang `lib/order` để `order-card` dùng chung; `:79` có thể nối link "Vé của tôi".
    - `order-payment.tsx`: `:37` `OFFLINE_TEXT`, `:89-92` đếm ngược.
    - `order-success.tsx:43`: chỗ nút "Xem Vé của tôi".
  - `lib/order/use-server-countdown.ts`, `lib/order/live.ts`; `lib/realtime/use-live-resource.ts:16-44` (mở lại khi `livePath` đổi; comment `:12`).
  - `lib/order/api.ts:24-65`: query key `[domain, kind, …ids]`, `apiRequest`.
  - `components/tickee/`:
    - `ticket-card.tsx`: `qr` đang bắt buộc; `status` mới có `valid` | `checked_in`; opacity ở `:123`.
    - `countdown-chip.tsx`: chỉ đặt trên stage, mỗi chip có một vùng `aria-live`.
    - `ticket-share-actions.tsx:38-55`: ghi cache `buyerOrderQueryKey`.
    - Dùng lại: `organizer-contact.tsx` (`useId`), `status-badge.tsx`, `empty-state.tsx`, `account-menu.tsx:74-108`.
  - `components/ui/`: chưa có `skeleton`; skeleton hiện viết inline `animate-pulse rounded-lg bg-muted`.
- **Test:**
  - api:
    - fixtures: `test/ordering/order-fixtures.ts` (`paidReadyOrg`, `eventOnSale`, `postOrder`), `test/ticketing/shared-tickets.test.ts:52` `freeTickets`;
    - SQL dựng trạng thái: check-in `:170`, kết thúc `:194`;
    - SSE: `test/ordering/order-live.test.ts:54-128`, `test/platform/sse-client.ts`.
  - web:
    - `e2e/identity-mock.ts`, `e2e/fixtures.ts`, `e2e/qr-image.ts`;
    - `fakeEventSource` trong `e2e/order-live.spec.ts:144-200`;
    - `e2e/purchase.spec.ts:989-992` đang ghim "Xem Vé của tôi" = 0; `e2e/order-live.spec.ts:28` `OFFLINE`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{my-tickets,index}.ts`, `packages/contracts/test/` -- `MY_TICKETS_PATH` (`/tickets`), `myTicketPath`, đường API (`/me/tickets`, `/live`, `/:ticketId`), schema `MyTicketsView`, `MyTicketItem`, `MyPendingOrder`, `MyTicketHistoryItem`, `MyTicketDetail` -- một nguồn cho api và web.
- [x] `apps/api/src/modules/event/{public-event,index}.ts` -- bản batch của `ticketEventById` (`ended` theo đồng hồ DB) -- AD-14.
- [x] `apps/api/src/modules/ticketing/{my-tickets,index}.ts` -- read model Vé theo `user_id`: danh sách (không ký QR) và một Vé (ký QR / `shareToken` theo luật ở trên) -- ticketing sở hữu Vé.
- [x] `apps/api/src/modules/ordering/{my-tickets.service,my-tickets.controller,ordering.module}.ts` -- ghép `active` / `pending` (kèm Đơn `expired` 30 phút) / `history`, chi tiết kèm biên nhận, stream lọc theo tập Đơn -- `buyerScope`, AD-17.
- [x] `apps/api/src/modules/ordering/buyer-email.ts` -- dòng link "Vé của tôi" trong email Vé.
- [x] `apps/api/test/ordering/my-tickets.test.ts` (mới), sửa test email -- phủ Matrix: nhóm, thứ tự, check-in, kết thúc, cách ly hai user, stream không rò, Vé chia sẻ không lọt.
- [x] `apps/web/app/(buyer)/tickets/{page,my-tickets}.tsx`, `apps/web/app/(buyer)/tickets/[ticketId]/{page,ticket-detail}.tsx`, `apps/web/lib/tickets/*` (gồm hook Screen Wake Lock) -- hai trang, biên nhận, query key, `useLiveResource`.
- [x] `apps/web/components/tickee/{order-card,ticket-row,ticket-card,countdown-chip,ticket-share-actions}.tsx`, `apps/web/components/ui/skeleton.tsx` -- thẻ Đơn, dòng Vé, `ticket-card` có `qr` tùy chọn và `status` `cancelled`, chip trên nền sáng không thông báo mốc, cache chia sẻ qua callback.
- [x] `apps/web/app/(buyer)/orders/[code]/{order-success,order-payment,order-view}.tsx`, `apps/web/components/tickee/account-menu.tsx` -- nút "Xem Vé của tôi", copy mất mạng, mục menu, hằng copy dùng chung.
- [x] `apps/web/e2e/my-tickets.spec.ts` (mới), `apps/web/e2e/{purchase,order-live}.spec.ts`, `apps/web/test/` -- `page.route` giả API: ba nhóm, rỗng, skeleton, đếm ngược về 0, tín hiệu → tải lại, Chi tiết (QR, đã check-in, đã hủy, lịch sử, biên nhận, 404), thẻ "Hết hạn", lối vào; vitest cho hook Wake Lock (không hỗ trợ / từ chối / tab ẩn).
- [x] `ARCHITECTURE-SPINE.md` (AD-17: `/v1/me/tickets/live`; AD-13: route `/v1/me/tickets`), `epic-3-context.md`, `deferred-work.md` (đóng: dòng mất mạng, nút "Xem Vé của tôi", `status` của Vé ở phía Người mua, biên nhận) -- tài liệu khớp code.

**Acceptance Criteria:**
- Given `pnpm test`, `pnpm typecheck`, `pnpm lint:deps`, `pnpm test:e2e`, when chạy, then pass; `ticketing` không import `ordering`.
- Given Người mua A và B, when A gọi ba route mới, then không bao giờ thấy Đơn, Vé hay tín hiệu của B.
- Given một Đơn đang chờ trên `/tickets` được trả tiền, when IPN commit, then thẻ rời nhóm và Vé hiện mà không cần tải lại.

## Implementation Notes

- **API:**
  - `event.ticketEventsByIds` (batch, `ended` theo đồng hồ DB).
  - `ticketing/my-tickets.ts`: `ticketsOfUser` (không ký QR), `ownTicket` (ký `qr`/`shareToken` chỉ khi Vé chưa hủy, Sự kiện chưa hủy, chưa kết thúc). `TicketsService` xuất cả hai.
  - `ordering/my-tickets.{service,controller}.ts`: `GET /v1/me/tickets` chạy trong một transaction `READ ONLY`, nên `serverNow`, `ended` và cửa sổ 30 phút của Đơn `expired` cùng một `now()` của DB. `live` khai báo trước `:ticketId`. `ticketsOfOrder` giữ nguyên.
- **Web:**
  - `app/(buyer)/tickets/{page,my-tickets}.tsx`, `tickets/[ticketId]/{page,ticket-detail}.tsx`.
  - Component mới: `order-card`, `ticket-row`, `ui/skeleton`.
  - Lib mới: `lib/tickets/{api,live,wake-lock}.ts`, `lib/order/status-copy.ts` (copy trạng thái Đơn dùng chung).
  - Component sửa:
    - `ticket-card`: `qr` tùy chọn, badge "Đã hủy" (`TICKET_STATUS_BADGE`).
    - `countdown-chip`: `surface="light"`, không có vùng `aria-live`.
    - `ticket-share-actions`: nhận `onRegenerated` thay cho tự ghi cache Đơn.
    - `organizer-contact`: thêm `headingLevel`, `variant="inline"`.
  - `useLiveResource` nhận `livePath` dạng hàm của dữ liệu.
  - `e2e/live-mock.ts`: `fakeEventSource` dùng chung.
- **Lựa chọn khi làm** (ngoài chữ của spec):
  - `MyTicketDetail` có thêm `attended`, `eventCancelled`, `ended` để web chọn cách hiển thị.
  - Khóa stream: `?orders=<FNV-1a của tập mã Đơn>`, máy chủ bỏ qua. Đơn chuyển từ `pending` sang `active` không đổi tập, nên không mở lại stream.
  - Thẻ chờ về 0: "Đang xác nhận thanh toán" và ẩn "Tiếp tục thanh toán" (giống Trang Đơn).
  - Biên nhận Đơn 0đ ghi "Đăng ký lúc", không có dòng "Tiền đã chuyển thẳng cho".
  - Hàng lịch sử cũng mở Chi tiết Vé (để xem biên nhận).
  - Không có SSE: polling 2 giây chỉ khi còn Đơn `awaiting_payment`/`confirming`.
  - Trang Đơn hết hạn: chữ "Vé của tôi" thành link.
- **Bổ sung ở bước 3:** test API "Đơn hết hạn (còn trong 30 phút) rồi tiền về muộn, còn chỗ → rời nhóm chờ, Vé vào active" (dòng Matrix "Đơn hết hạn", cột xử lý lỗi).
- **Kiểm chứng:**
  - Agent code: `pnpm typecheck`, `pnpm lint:deps`, `pnpm test` (contracts 268, web 218, api 943), `pnpm test:e2e` (792 pass) đều pass.
  - Bước 3 chạy lại: `pnpm typecheck`, `pnpm lint:deps`, contracts 268, web 218, api `my-tickets.test.ts` + `buyer-email-job.test.ts` (32 test, gồm ca mới) đều pass. Playwright `my-tickets`, `purchase`, `order-live`, `shared-ticket` trên ios-webkit và android-chromium: 212 pass, không skip hay flaky.
  - Mỗi dòng Matrix có test đã chạy và pass:
    - Chưa có gì, Đơn chờ về 0, thẻ "Hết hạn", BTC từ chối: `my-tickets.test.ts` và `my-tickets.spec.ts`.
    - Đơn chờ được trả: stream SSE thật ở api; tín hiệu → tải lại và polling ở e2e.
    - Tiền về muộn: ca mới ở `my-tickets.test.ts`.
    - Đã check-in, Sự kiện kết thúc: cả hai tầng.
    - Vé của người khác, người nhận link, stream không rò: `my-tickets.test.ts`.
- **Sau review vòng 1** (nhóm A–H trong Review Triage Log):
  - **A:** "Tạo lại link" ghi token mới vào cache của cả hai trang (Trang Đơn ↔ Chi tiết Vé) rồi tải lại cả hai. Query Chi tiết Vé có `refetchOnMount: 'always'`. E2e mới: tải lại Chi tiết lỗi 5xx sau khi tạo lại link, "Chia sẻ Vé" vẫn ra link mới.
  - **B:** `list` chạy trong một transaction `repeatable read`, `read only` (một snapshot, một `now()`).
  - **C:** dòng biên nhận dùng key theo vị trí.
  - **D:** `epic-3-context.md` lấy lại các dữ kiện bị rơi khi biên soạn lại; AD-13 ghi đúng `POST …/payment-link` và story của từng route.
  - **E–H:** thẻ `expired` chỉ còn badge "Hết hạn"; e2e mới cho thẻ `confirming` do máy chủ trả, lỗi 5xx kèm "Thử lại" ở cả hai trang, link "Vé của tôi" ở Trang Đơn hết hạn.
  - **Kiểm chứng sau patch:**
    - `pnpm typecheck`, `pnpm lint:deps`, `pnpm test` (contracts 268, web 218, api 944) đều pass.
    - `pnpm test:e2e` lần đầu báo lỗi trong chuỗi chạy liền sau test api, nhưng không giữ được tên ca. Chạy lại toàn bộ: 800/800 pass.
    - `my-tickets.spec.ts` + `order-live.spec.ts` lặp 3 lần: 240/240 pass, không flaky.
- **Rủi ro còn lại:**
  - Hủy Sự kiện chưa phát tín hiệu (7.1): danh sách đang mở vẫn ghi "Hợp lệ" tới lần tải sau. Chi tiết Vé tải lại mỗi lần mở.
  - Trang Đơn vẫn hiện QR cho Vé đã hủy (`BuyerTicket` giữ nguyên, để 7.1/7.5).
  - Đơn `paid` sau này bị hủy hay hoàn (4.4/7.x) sẽ có thẻ "Đã hủy" trong `pending` trong khi Vé vẫn ở `active`, tới khi luồng 7.x hủy Vé.
  - Wake Lock mới kiểm bằng stub, chưa thử trên máy thật.

## Spec Change Log

## Review Triage Log

Vòng 1 (review_loop_iteration 0). Nguồn: BH = Blind Hunter, EC = Edge Case Hunter, VG = Verification Gap (đã kiểm sẵn).

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | VG | Thẻ Đơn `confirming` do máy chủ trả chưa có e2e | low | Gap đã kiểm: bỏ nhánh `CONFIRMING` ở `badgeOf`/`Footer` thì thẻ rơi về "Đang cập nhật" mà mọi test vẫn pass | patch (nhóm E) |
| 2 | VG | Chi tiết Vé: ghi token mới vào cache sau "Tạo lại link" khi tải lại lỗi chưa có test | medium | Gap đã kiểm: mock trả token mới ở mọi lần tải, nên bỏ `setQueryData` vẫn pass | patch (nhóm A) |
| 3 | VG | Lỗi 5xx của `/tickets` và `/tickets/:ticketId` (khác 404), cả "Thử lại", chưa có test | low | Gap đã kiểm: spec chỉ giả 404 và 503 của `/live` | patch (nhóm G) |
| 4 | VG | Link "Vé của tôi" ở Trang Đơn hết hạn chưa có assertion | low | Gap đã kiểm: `purchase.spec.ts` chỉ kiểm banner và "Mua lại" | patch (nhóm H) |
| 5 | VG | Chi tiết Vé mở lại trong 30 giây dùng cache, không tải lại; ghi chú deferred "tải lại mỗi lần mở" sai | medium | `providers.tsx:43` `staleTime: 30_000`; query Chi tiết không đặt `refetchOnMount` | patch (nhóm A) |
| 6 | VG | Dòng biên nhận dùng `key={item.name}` | low | `ticket_types` không unique `(event_id, name)`: hai Hạng vé trùng tên thì trùng key | patch (nhóm C) |
| 7 | BH | "Tạo lại link" chỉ ghi cache của trang đang mở; trang kia (Trang Đơn / Chi tiết Vé) mở trong 30 giây vẫn chia sẻ link đã chết | medium | `onRegenerated` ở `order-success.tsx` chỉ ghi `buyerOrderQueryKey`, ở `ticket-detail.tsx` chỉ ghi `myTicketQueryKey`; `staleTime` 30 giây | patch (nhóm A) |
| 8 | BH | `list` không cùng snapshot: `READ COMMITTED` nên `markPaid` commit giữa hai truy vấn làm Đơn biến khỏi cả hai nhóm | low | `database.ts:40` ép `read committed`; tín hiệu kế tiếp sửa trong khoảng 1 giây, nhưng sửa chỉ là một tùy chọn transaction | patch (nhóm B) |
| 9 | BH | Vé hủy khi sang lịch sử mất dấu hủy; Chi tiết sau mốc kết thúc bỏ qua `status`/`eventCancelled` | low | Chưa có đường nào hủy Vé hay Sự kiện (7.1/7.5); sửa phải thêm trường vào contract `history` đã chốt | reject |
| 10 | BH | Copy Sự kiện hủy ở Chi tiết Vé khác `status-copy`, không kèm liên hệ BTC | low | Đúng chữ và luật trong khối frozen (lấy từ EXPERIENCE); sửa là sửa spec | reject |
| 11 | BH | Đơn `refunded`/`cancelled` ở nhóm chờ tới khi Sự kiện kết thúc, câu "hoàn tiền nếu bạn đã chuyển" sai với Đơn đã hoàn | low | Khối frozen đưa `cancelled_by_organizer` vào `pending`; câu có từ 3.7; `refunded` chỉ phát sinh từ 4.4 | reject |
| 12 | BH | Biên nhận không cho biết Đơn sau đó bị hủy hay hoàn | low | `paid → cancelled/refunded` chưa có đường (4.4/7.1); sửa phải thêm trường contract | reject |
| 13 | BH | Tập Đơn của stream cố định lúc mở: Đơn đặt ở thiết bị khác không hiện khi SSE đang nối | low | Đúng khối frozen ("sở hữu lúc mở stream"); tab hiện lại hay có mạng lại thì tải lại; sửa phải tra chủ theo tín hiệu hoặc thêm polling | reject |
| 14 | BH | Chi tiết Vé không tự cập nhật khi đang giữ màn hình sáng (check-in, hủy, qua mốc) | low | Check-in (Epic 5) và hủy (7.x) chưa phát tín hiệu; sửa phải thêm polling | reject |
| 15 | BH | Viết lại `epic-3-context.md` làm mất dữ kiện các story sau cần: queue email Người mua của 3.8 (3.10 thêm loại vào đây), chữ ký IPN, `ipnKey` lạ → 404, Đơn `pending` của Sự kiện khóa vẫn `markPaid`, kết cục `review_item`, điểm móc 2.12 cho 3.10, `POST …/payment-link`, con trỏ file | medium | So với bản ở `baseline_commit`; 3.10, 4.1, 4.4 lập kế hoạch từ file này | patch (nhóm D) |
| 16 | BH | AD-13: `/payment-link` ghi là `GET`, nhãn "(Story 3.9)" cho cả danh sách | low | `orders.controller.ts:88` `@Post`; đa số route có từ 3.7/3.8 | patch (nhóm D) |
| 17 | BH | "Vé của tôi" không báo gì khi tải lại lỗi sau khi đã có dữ liệu | low | Khối frozen không có dòng mất mạng cho `/tickets`, UX chưa có copy; sửa phải thêm UI | reject |
| 18 | BH | Như #6 | low | Như #6 | patch (nhóm C) |
| 19 | BH | Tải lại toàn bộ, không giới hạn, mỗi 2 giây khi có Đơn chờ; `organizerContactOf` gọi tuần tự | low | "Không phân trang" là khối frozen; số Đơn và số BTC của một Người mua nhỏ | reject |
| 20 | BH | Test api mở `/live` không có query, web mở `/live?orders=…` | false | Express khớp route theo path, query không ảnh hưởng; e2e kiểm đường có `?orders=` | reject |
| 21 | BH | Chưa test Đơn chờ của nhiều BTC, chuẩn hóa id trong `ticketEventsByIds`, consent/2FA trên route mới | low | Đọc code: vòng theo BTC đúng; id do DB cấp; guard `identity` toàn cục đã có test ở route khác | reject |
| 22 | BH | Test dùng `sleep` / `waitForTimeout` cố định và ngưỡng đồng hồ | low | Ca âm cần chờ; cùng mẫu test 3.7/3.8; lần chạy 212 ca không flaky | reject |
| 23 | BH | Nhóm "Vé còn hiệu lực" lẫn Vé "Đã hủy" | low | Đúng khối frozen (`active` có `cancelled`); chưa phát sinh trước 7.1/7.5 | reject |
| 24 | EC | Đơn đã `paid` sau bị hủy/hoàn hiện hai lần (Vé ở `active`, thẻ ở `pending`) | low | Chưa có đường `paid → cancelled/refunded` (4.4/7.1); sửa là guard một trạng thái chưa chứng minh được | reject |
| 25 | EC | Như #13 | low | Như #13 | reject |
| 26 | EC | `/tickets/live` (ticketId = `live`) gọi nhầm vào SSE, skeleton quay mãi | low | Chỉ gặp khi gõ tay URL; sửa phải thêm guard | reject |
| 27 | EC | Như #7 | medium | Như #7 | patch (nhóm A) |
| 28 | EC | Như #6 | low | Như #6 | patch (nhóm C) |
| 29 | EC | Đơn hết hạn vì Tingee từ chối link: thẻ ghi "Hết thời gian giữ chỗ" trong khi Trang Đơn ghi "Sự kiện tạm ngừng bán" | low | `Footer` nhánh `EXPIRED` → `HOLD_EXPIRED`; `MyPendingOrder` không có `linkError`. Khối frozen chỉ đòi badge "Hết hạn", không nút, nên bỏ câu là đủ | patch (nhóm F) |
| 30 | EC | Đơn hết hạn sớm (IPN `canceled`) ở lại quá 30 phút sau lúc hết hạn thật | low | Quyết định frozen tính từ `expires_at`; sửa cần cột mới và sửa spec | reject |
| 31 | EC | Khóa QR của Vé đã bị gỡ → Chi tiết Vé 500 | low | Theo thiết kế (phải giữ khóa cũ); runbook xoay khóa đã ở `deferred-work.md` (4.6/4.7) | reject |
| 32 | EC | Như #17 | low | Như #17 | reject |

## Design Notes

- **Ghép ở `ordering`:** chỉ `ordering` đọc được Đơn, Vé (`ticketing`) và liên hệ BTC (`organizer`). `ticketing` tự quyết có ký QR hay không (đọc Sự kiện qua `event`), `ordering` thêm `pending` và liên hệ BTC. Route `/me/tickets/*` nằm trong controller của `ordering`. Route `share-link` của 3.8 vẫn ở `ticketing`.
- **Danh sách không có QR:** QR chỉ ở Chi tiết. Danh sách nhẹ hơn, không ký N chữ ký, khớp mô tả "dòng Vé mở Chi tiết Vé" (EXPERIENCE:58).
- **Stream theo tập Đơn:** lúc mở, tra id mọi Đơn của user (index `(user_id, created_at)`), rồi lọc `type === order_changed && ids.has(id)`. Đơn tạo sau lúc mở không có trong tập, nên web đưa một khóa suy từ tập mã Đơn vào `livePath` để stream mở lại khi tập này đổi. Không thêm `userId` vào payload (AD-17).
- **Vé đã hủy** chưa phát sinh trước 7.1/7.5. 3.9 chỉ hiện đúng (Đã hủy, không có QR, như AC 7.1/7.5), không làm luồng hủy.

## Verification

**Commands:**
- `pnpm test` -- expected: pass (contracts, api với Postgres thật, web).
- `pnpm typecheck && pnpm lint:deps` -- expected: pass.
- `pnpm test:e2e` -- expected: pass trên ios-webkit và android-chromium.

**Manual checks (if no CLI):**
- `pnpm dev`, đăng nhập BTC demo, mua Vé 0đ và tạo một Đơn có phí đang chờ. Mở `/tickets`: Vé ở nhóm hiệu lực, Đơn ở nhóm chờ có đếm ngược. Bắn IPN từ Tingee fake thì thẻ tự chuyển thành Vé.
