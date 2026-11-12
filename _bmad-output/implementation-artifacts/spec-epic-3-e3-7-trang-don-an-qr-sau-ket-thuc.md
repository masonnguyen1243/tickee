---
title: 'E3-7 (D3): Trang Đơn ẩn Mã QR vé và link chia sẻ sau khi Sự kiện kết thúc'
type: 'bugfix'
created: '2026-11-12'
status: 'done'
baseline_commit: '6bd8baf3d6f55f16f2c482ceb144565063b4a2b6'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sau khi Sự kiện kết thúc, `GET /v1/me/orders/:code` vẫn trả Mã QR vé đã ký và `shareToken` cho Đơn `paid`. Trong khi đó Chi tiết Vé, link chia sẻ và email Vé đều đã chặn (FR-24, AD-14; retro Epic 3 D3). Nguyên nhân: điều kiện "Sự kiện còn dùng được cho Vé" bị chép 4 nơi, và Trang Đơn không dùng nơi nào (retro E2).

**Approach:** Gom điều kiện về một predicate duy nhất ở mô-đun `event` (Sự kiện có, chưa hủy, đồng hồ DB chưa quá `effective_end_at`), cho 4 chỗ cũ dùng lại. Trang Đơn cũng dùng predicate này: Sự kiện đã kết thúc thì không ký và không trả Vé, `BuyerOrderView.event` có thêm `ended`, web hiện trạng thái "đã kết thúc" thay cho màn Thành công.

## Boundaries & Constraints

**Always:**
- `ended` tính bằng đồng hồ DB (`now() > effective_end_at`, AD-14), cùng một biểu thức SQL dùng chung trong `event`, không dùng `new Date()`.
- Máy chủ không ký Mã QR vé và không tính `shareToken` cho Đơn mà Sự kiện đã kết thúc: đọc Sự kiện trước, rồi mới đọc Vé.
- 4 chỗ cũ đổi sang predicate chung mà không đổi hành vi. Test hiện có của link chia sẻ, Chi tiết Vé, email Vé và email đổi giờ phải pass nguyên.
- Sự kiện đã hủy vẫn đi nhánh `event_cancelled` như cũ, ưu tiên hơn "đã kết thúc".

**Never:**
- Không thêm `BuyerOrderStatus` mới. Không đổi bảng `buyerStatusOf`.
- Không phát tín hiệu realtime tại mốc kết thúc. Trang Đơn đang mở chỉ đổi ở lần tải sau, giống Chi tiết Vé.
- Không chạm B6, C7, việc tách `orders.service.ts`, hay việc gom `SELECT now()` (đã hoãn trong `deferred-work.md`).
- Không xử lý Vé `cancelled` trên Trang Đơn (thuộc 7.1/7.5).

**Quyết định của Mason (12/11/2026): màn Trang Đơn khi Đơn `paid` mà Sự kiện đã kết thúc.** Bỏ hẳn thẻ Vé, giống Chi tiết Vé sau kết thúc và FR-24. Stage gồm wordmark, tên Sự kiện, h1 "Sự kiện đã kết thúc" và dòng phụ "Vé của Đơn này đã chuyển vào lịch sử ở Vé của tôi." Không có dòng "Đã gửi Vé tới {email}", không có thẻ Vé, không có banner "đang được chuẩn bị". Vẫn giữ Mã Đơn và nút "Xem Vé của tôi". Không rung, không có hiệu ứng trượt. `BuyerTicket` giữ nguyên dạng.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Chưa kết thúc | Đơn `paid`, đồng hồ DB < `effective_end_at` | `event.ended = false`, `tickets` có `qr` và `shareToken` như cũ | N/A |
| Đã kết thúc | Đơn `paid`, đồng hồ DB > `effective_end_at` (kể cả "Kết thúc" sớm) | `event.ended = true`, `tickets = []`, không ký gì; web hiện trạng thái đã kết thúc, không QR, không "Chia sẻ Vé" | N/A |
| Hủy và đã kết thúc | Sự kiện `cancelled`, đã quá mốc | `buyerStatus = event_cancelled`, `tickets = []` như cũ | N/A |
| Đơn chưa trả | `pending`/`expired`/`under_review` | `tickets = []` như cũ, `event.ended` đúng theo đồng hồ DB | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/event/public-event.ts` -- `ticketEventColumns.ended` (biểu thức đồng hồ DB), `ticketEventById`, `saleEventById` (Trang Đơn và `sellability` dùng; chưa có `ended`). Nơi đặt predicate và biểu thức dùng chung.
- `apps/api/src/modules/event/index.ts` -- export công khai của `event`.
- `apps/api/src/modules/ticketing/tickets.service.ts:28-29` -- `eventOpenForTicket` (bản 1); `ticketsOfOrder` ký QR + token, không lọc.
- `apps/api/src/modules/ticketing/my-tickets.ts:~128` -- `ownTicket`: `open = !cancelled && !event.ended` (bản 2, có thêm điều kiện Vé hủy, giữ nguyên phần đó).
- `apps/api/src/modules/ordering/buyer-email-jobs.ts:~112` -- điều kiện inline (bản 3).
- `apps/api/src/modules/ordering/event-change-email-jobs.ts:~83` -- `stillNotifiable` (bản 4).
- `apps/api/src/modules/ordering/orders.service.ts:513-560` -- `view()`: `saleEventById` và `ticketsOfOrder` chạy song song trong `Promise.all`; `tickets` chỉ lọc theo `buyerStatus`.
- `packages/contracts/src/order.ts:360-390` -- `BuyerOrderView` (doc comment mô tả từng trường).
- `apps/web/app/(buyer)/orders/[code]/order-success.tsx` -- màn Thành công. `tickets` rỗng → banner "đang được chuẩn bị" (sai cho ca đã kết thúc).
- Test API: `apps/api/test/ordering/free-order.test.ts:411` (`GET … — Đơn đã trả`, có Đơn 0đ `paid` sẵn Vé). Cách đẩy mốc: `UPDATE events SET effective_end_at = now() - interval '1 second'` (`shared-tickets.test.ts:194`).
- Fixture e2e `BuyerOrderView` viết tay (web parse bằng schema, nên thiếu `ended` sẽ lỗi): `e2e/order-live.spec.ts:49`, `purchase.spec.ts:147,176,1368`, `shared-ticket.spec.ts:199`, `my-tickets.spec.ts:698`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/modules/event/public-event.ts`, `index.ts` -- tách biểu thức `ended` thành hằng dùng chung; `saleEventById` trả thêm `ended`; thêm và export predicate "Sự kiện còn dùng được cho Vé" nhận `{ status, ended } | null`.
- [x] `ticketing/tickets.service.ts`, `ticketing/my-tickets.ts`, `ordering/buyer-email-jobs.ts`, `ordering/event-change-email-jobs.ts` -- thay 4 bản bằng predicate chung, không đổi hành vi.
- [x] `ordering/orders.service.ts` -- `view()`: đọc Sự kiện trước; chỉ gọi `ticketsOfOrder` khi Đơn `paid` và Sự kiện còn dùng được; trả `event.ended`.
- [x] `packages/contracts/src/order.ts` -- `BuyerOrderView.event.ended: boolean` (bắt buộc), cập nhật doc comment cho `event` và `tickets`.
- [x] `apps/web/app/(buyer)/orders/[code]/order-success.tsx` -- nhánh `order.event.ended` theo quyết định của Mason ở Boundaries; `celebrate` không có tác dụng ở nhánh này.
- [x] `apps/api/test/ordering/free-order.test.ts` -- ca chưa/đã kết thúc theo Matrix (trước và sau khi đẩy `effective_end_at`).
- [x] Fixture e2e ở Code Map -- thêm `ended: false`; thêm một ca e2e Trang Đơn `paid` + `ended: true` vào `e2e/order-live.spec.ts`: h1 "Sự kiện đã kết thúc", không QR, không "Chia sẻ Vé", không "Đã gửi Vé tới", có Mã Đơn và "Xem Vé của tôi".

**Acceptance Criteria:**
- Given Đơn `paid` của Sự kiện đã quá `effective_end_at`, when gọi `GET /v1/me/orders/:code`, then body không chứa chuỗi Mã QR vé hay `shareToken` nào của Đơn.
- Given trang Đơn đó, when mở trên web, then không hiện banner "Vé của bạn đang được chuẩn bị".
- Given mã nguồn sau thay đổi, when tìm `status !== EventStatus.CANCELLED && !…ended` ở api, then chỉ còn trong predicate chung.

## Implementation Notes

- Predicate chung: `eventOpenForTickets(event)` ở `event/public-event.ts` (export qua `event/index.ts`), generic theo `{ status, ended } | null`, là type guard. Biểu thức đồng hồ DB dùng chung: hằng `endedNow` (`now() > effective_end_at`), dùng cho `ticketEventColumns.ended` và `saleEventById` (trả `SaleEventRef` = `PublicEventRef & { ended }`).
- `my-tickets.ts` (`ownTicket`): `open = row.status !== 'cancelled' && eventOpenForTickets(event)`, tương đương bản cũ (`own.status` `cancelled` khi Vé hủy hoặc Sự kiện hủy).
- `orders.service.ts` `view()`: `saleEventById` chạy cùng đợt `Promise.all` với các truy vấn khác; `ticketsOfOrder` nối sau promise Sự kiện (`.then`) và chỉ chạy khi Đơn `paid` và `eventOpenForTickets(event)`, nên không thêm round trip mà vẫn không đọc/ký Vé cho Sự kiện đã kết thúc. `serverNow` vẫn `new Date()` (gom `SELECT now()` đã hoãn).
- Web: `OrderSuccess` chỉ rẽ nhánh (không hook) giữa `OrderEnded` (`data-slot="order-ended"`) và `OrderReady` (màn Thành công cũ), để Đơn đổi màn khi tải lại không trộn hook. Mã Đơn + "Xem Vé của tôi" tách thành `OrderFooter` dùng chung.
- Contracts test (`packages/contracts/test/order.test.ts`) cũng cần `ended: false` trong fixture `BuyerOrderView` (không có trong Code Map), thêm ca thiếu `event.ended` → không nhận.

## Spec Change Log

## Review Triage Log

Vòng 1 (12/11/2026). Ba lớp: Blind Hunter (BH), Edge Case Hunter (EC), Verification Gap (VG).

| # | Lớp | Phát hiện | Verdict | Bằng chứng | Route |
|---|-----|-----------|---------|------------|-------|
| 1 | VG | e2e không kiểm h1 "Sự kiện đã kết thúc" nhận focus lúc gắn | low | `order-live.spec.ts` không có `toBeFocused`; màn Thành công có (`purchase.spec.ts:988`). Bỏ `useHeadingFocus()` ở `OrderEnded` thì test vẫn pass | patch |
| 2 | VG | Test "ended theo đồng hồ DB" không phân biệt được đồng hồ DB và đồng hồ app | low | `endEvent` đặt mốc `now() - 1s`, cả hai đồng hồ đều đã quá; không test api nào giả `Date`. Yếu điểm chung của `endedNow`, không riêng thay đổi này | defer |
| 3 | BH | `view()` chờ `saleEventById` rồi mới chạy `Promise.all`: thêm một lượt chờ DB cho mọi lần tải Trang Đơn (polling 2 giây, SSE, tạo Đơn) | low | Trước: 6 truy vấn một đợt; sau: 2 đợt. Chỉ cần nối `ticketsOfOrder` sau promise Sự kiện là giữ được luật "đọc Sự kiện trước rồi mới đọc Vé" | patch |
| 4 | BH | Ca e2e mới đi `awaiting_payment` → `paid` + `ended`, gần như không xảy ra (`mark-paid.ts:262-266` đưa tiền về sau mốc vào `review`); ca thường gặp `paid` có Vé → tải lại thấy `ended` chưa test | low | Đúng như mô tả; việc đổi `OrderReady` → `OrderEnded` (lý do tách hai component) không có test | patch |
| 5 | BH | Trang để mở qua mốc: "Tạo lại link" 404 mà không tải lại Đơn | low | Có thật, nhưng hiếm (bấm "Tạo lại link" đúng sau mốc), Chi tiết Vé cũng vậy từ trước; sửa phải thêm nhánh xử lý lỗi ở `TicketShareActions` | reject |
| 6 | BH, EC | Trang Đơn hiện dữ liệu cache (có QR) khi quay lại trong 30 giây sau mốc | low | `useLiveResource` mở SSE khi đã có dữ liệu, `onopen` → tải lại (`use-live-resource.ts:113-117`), nên QR cũ chỉ hiện tới lúc SSE mở. Trang để mở thì Never của spec đã chấp nhận. Sửa phải thêm tham số cho hook dùng chung | reject |
| 7 | BH | `ticketsOfOrder` vẫn ký vô điều kiện, luật dựa vào người gọi | low | Không người gọi hiện tại nào bỏ kiểm (Trang Đơn, email Vé); doc đã ghi. Sửa phải đổi chữ ký hàm | reject |
| 8 | BH, EC | Hai đồng hồ: `sellability` so `effectiveEndAt <= new Date()`, `endedNow` dùng DB `now() >`; Đơn 0đ đặt đúng sát mốc có thể ra màn đã kết thúc | low | Có từ trước (`sellability.ts:51`); chỉ xảy ra khi lệch đồng hồ hoặc trùng đúng mốc. Đã có mục hoãn "gom đồng hồ DB" của E3-7 | reject |
| 9 | BH, EC | Đơn chưa trả mà Sự kiện đã kết thúc (BTC bấm "Kết thúc") vẫn hiện màn thanh toán và checkout link | medium | Đúng là retro B1 / action item E3-2 (cần Mason chốt luật); có từ trước. `event.ended` mới có sẵn cho E3-2 dùng | defer |
| 10 | BH | Comment trong test contracts ("Đơn `paid` không còn Vé") nói một luật mà schema không kiểm | low | `order.test.ts`: chỉ parse lại fixture vốn đã `tickets: []` | patch |
| 11 | BH | Nhánh "Kết thúc" sớm chỉ test bằng SQL, không qua endpoint thật | low | Dòng Matrix ghi "kể cả 'Kết thúc' sớm"; endpoint đặt `effective_end_at` bằng `new Date()` của app nên đáng test thật | patch |
| 12 | BH | Comment "Sự kiện đã hủy hay đã kết thúc…" đặt ở dòng chỉ lọc theo `buyerStatus` | low | `orders.service.ts`: lọc theo Sự kiện nằm ở `withTickets` | patch |
| 13 | BH | `ARCHITECTURE-SPINE.md` (hàng "Trạng thái cho người mua") vẫn ghi "Vé chỉ có khi `paid`", không có `event.ended` | low | Đã đọc dòng đó; spine là bản ghi thực tế (retro E5) | patch |
| 14 | BH | `sprint-status.yaml` không ghi E3-7 đã tách | low | Mục `epic-3-retro-e3-7-…` vẫn một dòng `open` | patch |
| 15 | BH | Mục hoãn dùng `source_spec: none` | false | Định dạng do workflow tách phạm vi quy định; nguồn retro ghi trong `evidence` | reject |
| 16 | BH | Spec mới chưa được track | false | Spec sẽ commit cùng PR | reject |
| 17 | BH | `aria-live` trên stage của `OrderEnded` không có tác dụng | false | Giống hệt `OrderReady`; không gây hại (focus `h1` mới là cơ chế đọc) | reject |
| 18 | BH | `data-slot="order-success-my-tickets"` dùng chung cho màn đã kết thúc | false | Không selector nào dùng slot này để nhận diện màn Thành công (e2e dùng `[data-slot="order-success"]`) | reject |
| 19 | EC | BTC dời giờ kết thúc sau khi đã kết thúc tự nhiên → `ended` lật lại `false`, Vé hiện lại | low | Nếu sửa được thì Vé hiện lại là đúng với Sự kiện được kéo dài; hiếm, sửa phải thêm luật chặn sửa | reject |
| 20 | EC | `ticketsOfOrder` ký QR cho Vé `cancelled` | false | Chưa có đường nào đặt `tickets.status = 'cancelled'` (`deferred-work.md`, mục 3.3/3.9); khối frozen loại trừ (7.1/7.5) | reject |

## Verification

**Commands:**
- `pnpm test` -- expected: pass (contracts, api với Postgres thật, web).
- `pnpm typecheck && pnpm lint:deps` -- expected: pass.
- `pnpm test:e2e` -- expected: pass trên ios-webkit và android-chromium.

**Manual checks (if no CLI):**
- `pnpm dev`, đăng ký một Sự kiện miễn phí bằng tài khoản Người mua, BTC bấm "Kết thúc", rồi tải lại Trang Đơn: không còn Mã QR vé, không còn "Chia sẻ Vé".
