---
title: 'Story 3.11: Tổng quan Sự kiện thấy Đơn đầu tiên ngay lập tức'
type: 'feature'
created: '2026-11-12'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'cf029ae7a824b0800368ae658c60923039ec725d'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Tab Tổng quan của Sự kiện mới chỉ có thẻ "Thông tin", nên BTC phải dò sao kê để biết tiền đã về chưa (FR-31). Topic `event_orders_changed` đã khai báo nhưng chưa nơi nào phát. Đơn mới tạo không phát tín hiệu nào, kể cả Đơn 0đ (Đơn này được phát Vé ngay trong TX1).

**Approach:** `reporting` mở `GET …/overview` (doanh thu + 5 Đơn mới nhất) và stream SSE `GET …/overview/live` lọc `event_orders_changed` theo Sự kiện. Dữ liệu đọc qua hàm read model của `ordering` và `payment` (AD-33). `ordering` phát `event_orders_changed` ở mọi chỗ đang phát `order_changed`, và phát thêm một lần sau khi TX1 commit. Web thêm `stat-card` doanh thu và `recent-orders-block` vào tab Tổng quan, dùng `useLiveResource` (không có SSE thì polling 10 giây).

## Boundaries & Constraints

**Always:**
- **REST** `GET /v1/orgs/:orgId/events/:eventId/overview` → `EventOverview { revenue: { amount, paidOrders }, recentOrders }`:
  - quyền `orders.view` (Owner/Admin), `cache-control: no-store`;
  - Sự kiện lạ, sai dạng hoặc của BTC khác → `404 EVENT_NOT_FOUND`.
- **Doanh thu:**
  - `amount` = tổng `total_amount` của các Đơn `paid` của Sự kiện;
  - `paidOrders` = số Đơn `paid`, tính cả Đơn 0đ.
- **`recentOrders`:**
  - Tối đa 5 Đơn ở mọi trạng thái, xếp theo `created_at` rồi `id`, giảm dần.
  - Mỗi Đơn có `code`, `buyerName` (bản chụp), `ticketCount` (tổng `quantity`), `totalAmount`, `status`, `createdAt` và `review`.
  - `review` khác `null` chỉ khi Đơn ở `review`. Lúc đó `review` = `{ type, receivedAmount }`, lấy từ mục `review_items` `open` cũ nhất của Đơn; `receivedAmount` là số tiền của `payment_event` gắn với mục đó.
  - Không có id nội bộ, email hay SĐT.
- **SSE** `GET …/overview/live`:
  - cùng quyền với REST; trả 404 trước khi mở stream;
  - chỉ đẩy các `event_orders_changed` có `eventId` và `organizationId` khớp, cùng `resync`.
- **Phát `event_orders_changed`** (`{ id Đơn, organizationId, eventId }`):
  - trong cùng `tx` ở mọi chỗ đang phát `order_changed`;
  - sau khi TX1 tạo Đơn commit (Đơn có phí lẫn Đơn 0đ), bằng một lệnh riêng nằm ngoài TX1; lệnh này lỗi thì chỉ log, request vẫn thành công;
  - không bao giờ trong TX1.
- **Web, tab Tổng quan (Sự kiện không ở `draft`):** hai khối nằm trên thẻ "Thông tin".
  - `stat-card` (stage): nhãn "Doanh thu", giá trị dạng "300.000đ", dòng phụ "Chỉ tính Đơn Đã thanh toán · {n} Đơn".
  - `recent-orders-block` (card sáng phẳng), tiêu đề "Đơn gần đây":
    - từ `md` trở lên là bảng Mã Đơn · Người mua · Vé ("{n} Vé") · Số tiền · Trạng thái · Thời gian;
    - dưới `md` là danh sách thẻ;
    - chưa có Đơn → "Chưa có Đơn nào.".
  - Badge: Chờ thanh toán (warning), Đã thanh toán (success), Hết hạn / Đã hủy / Đã hoàn tay (neutral), Cần xử lý (danger).
  - Đơn `review` có thêm một dòng loại:
    - lệch số tiền: "Lệch số tiền · nhận {x} / Đơn {y}";
    - loại khác chỉ ghi tên: "Thanh toán mồ côi", "Giao dịch chưa khớp", "Thanh toán trùng", "Sự kiện đã hủy".
  - Thời gian: "HH:mm" nếu cùng ngày với hôm nay (giờ Việt Nam), còn lại "dd/MM · HH:mm".
  - Mất mạng:
    - mỗi lần mất mạng có đúng một toast "Mất kết nối. Đang thử lại…";
    - số liệu giữ giá trị cuối, kèm nhãn "Cập nhật lúc HH:MM";
    - có mạng lại thì tải lại và ẩn nhãn.
  - Tải lần đầu lỗi → báo lỗi trong khối kèm nút "Thử lại"; `401` → chuyển đăng nhập.
- **Nháp:** không hiện hai khối và không gọi `overview`.
- **Quyết định của Mason (12/11):**
  - Giữ cả spec dù khoảng 4.700 token: REST, SSE, điểm phát tín hiệu và hai khối web cùng phục vụ một mục tiêu là BTC thấy Đơn ngay.
  - Nhãn trạng thái bán trên dashboard lệch `sellability` (retro C5, phần còn lại của E2-6) để sang 4.2; 3.11 không đổi `event-status.ts`.

**Never:**
- Không làm link "Xem tất cả Đơn", tab Đơn, bộ lọc, CSV, `stat-card` check-in hay Vé theo Hạng vé (Epic 6).
- Không làm `needs-action-card` hay `org_review_items_changed` (Epic 4).
- Không `NOTIFY` trong TX1. Không đổi `RealtimeSignal` và hành vi `order_changed`.
- Không đặt luật doanh thu riêng cho Sự kiện đã hủy (7.1 quyết).
- `reporting` không join bảng của mô-đun khác.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Đơn 0đ mới | Owner đang xem Tổng quan, SSE đã nối; Người mua đăng ký | Đơn hiện đầu khối "Đã thanh toán"; `paidOrders` +1, doanh thu giữ nguyên | `NOTIFY` sau commit lỗi: log, Đơn vẫn tạo |
| Đơn có phí được trả | Đơn `pending` đang hiện; IPN gọi `markPaid` | Badge → "Đã thanh toán"; doanh thu + `total_amount` | — |
| Lệch số tiền | IPN 250.000đ cho Đơn 300.000đ | "Cần xử lý" + "Lệch số tiền · nhận 250.000đ / Đơn 300.000đ" | — |
| Hơn 5 Đơn | 7 Đơn | 5 Đơn mới nhất | — |
| Chưa có Đơn | 0 Đơn | "0đ", "· 0 Đơn", "Chưa có Đơn nào." | — |
| Không có SSE | `…/overview/live` trả 503 | Polling 10 giây | — |
| Mất mạng | Đang xem thì rớt mạng | Toast một lần, số liệu cũ + "Cập nhật lúc HH:MM" | Có mạng lại → tải lại |
| BTC khác | Owner A gọi REST/SSE trên Sự kiện của BTC B | `403 NOT_A_MEMBER`, không mở stream | — |
| Sự kiện lạ | id ngẫu nhiên hoặc sai dạng | `404 EVENT_NOT_FOUND`, không mở stream | — |
| Sự kiện khác | Đơn của Sự kiện Y đổi | Stream của Sự kiện X không nhận gì | — |
| Nháp | `draft` | Không có hai khối, không gọi API | — |

</frozen-after-approval>

## Code Map

Đường dẫn api tính từ `apps/api/src/`, web từ `apps/web/`, contracts từ `packages/contracts/src/`.

- **Ranh giới** (`apps/api/module-graph.cjs:11,15`):
  - `reporting` import được `ordering`, `payment`, `event`;
  - `ordering` không import được `payment`, nên phần ghép loại Cần xử lý nằm ở `reporting`.
- **Realtime:**
  - `platform/realtime/notify.ts:21` `realtime.notify(tx, …)`.
  - `platform/realtime/realtime-hub.ts:127` `open(req, res, filter)`: ném 503 khi `LISTEN` chưa sẵn sàng.
  - Mẫu controller: `modules/ordering/my-tickets.controller.ts:37-41`.
  - `contracts/realtime.ts:24`: `EVENT_ORDERS_CHANGED` đã khai báo.
- **Điểm phát:**
  - `modules/ordering/order-changed.ts:15` `notifyOrderChanged`: mọi chỗ sau TX1 đều đi qua hàm này (`mark-paid.ts:141,342`; `payment-link.ts:213,256`; `order-jobs.ts:117,155`). Phát thêm `event_orders_changed` ở đây.
  - `modules/ordering/orders.service.ts:228`: `create` commit TX1 tại đây. Phát sau dòng này; đường trả Đơn cũ theo khóa chống trùng thì không phát.
  - `mark-paid.ts:341` bỏ qua nguồn `free`: giữ nguyên.
- **Read model** (chưa có view `*_read_*`; theo mẫu hàm `paidBuyerCount` ở `ordering/event-change-email-jobs.ts:55-62`, xuất qua `index.ts`):
  - `ordering`:
    - bảng `orders` (`schema.ts:98-160`, index `(event_id, created_at)` `:140`);
    - `order_items.quantity` (`:167-188`).
  - `payment`:
    - `review_items` (`payment/schema.ts:88-131`: `order_id`, `type`, `status`, `payment_event_id`);
    - `payment_events.paid_amount` (`:42`).
- **Reporting:** `modules/reporting/` (`notices.controller.ts` là mẫu controller org; `reporting.module.ts:5` đang ghi nhầm AD-34, đúng là AD-33). `assertEventOfOrganization` (`event/ticket-type.service.ts:52`, đã xuất ở `event/index.ts:33`).
- **Contracts:**
  - `reporting.ts`: chỗ đặt `EventOverview` và đường API.
  - Mẫu đường API: `event.ts:148` `eventBuyerCountApiPath`.
  - `order.ts:242` `OrderStatus`; `payment.ts:20` `ReviewItemType`; `money.ts:5` `formatVnd`.
  - `event.ts:159,172,293`: `vnParts`/`pad` (chưa xuất) và `formatVnDateTime`.
  - `organizer.ts:37-49`: `ORDERS_VIEW` (chưa route nào dùng).
- **Web:**
  - `app/(dashboard)/btc/[orgId]/su-kien/[eventId]/event-tabs.tsx:38-74` `Overview`.
  - `lib/realtime/use-live-resource.ts:48` trả `{query, connected, offline}`; dùng `query.dataUpdatedAt` cho nhãn (mẫu `app/(buyer)/tickets/my-tickets.tsx:49-54,101`).
  - `components/tickee/{stage-block,status-badge,tone}.tsx`; `components/ui/table.tsx`.
  - Mẫu stage: `app/(buyer)/orders/[code]/order-payment.tsx:126-137`.
  - Toast một lần bằng `id` cố định: `components/tickee/notice-toast.tsx:23`.
  - Helper: `lib/auth/use-go-to-login.ts`, `lib/api/message-of.ts`.
  - Token: `text-headline`, `tabular-nums`, `font-mono text-code`.
- **Test:**
  - api:
    - `test/platform/sse-client.ts` (`listen`, `openSse`);
    - `test/ordering/order-live.test.ts:122` `notificationsFor` hiện lọc theo id, phải lọc thêm `type`, vì Đơn giờ có thêm `event_orders_changed` (ca `:185-197`);
    - `test/organizer/isolation.test.ts:153`: 20 → 22 route, thêm `toContain`;
    - fixtures `test/ordering/order-fixtures.ts`.
  - web:
    - `e2e/organizer-mock.ts:32-45`: `/v1/orgs/**` không có handler thì trả 500, nên phải thêm handler mặc định cho `overview` và `overview/live`;
    - `e2e/live-mock.ts` (`fakeEventSource`), mẫu `e2e/order-live.spec.ts`, `e2e/my-tickets.spec.ts:429-495`;
    - cả hai project Playwright rộng 375px, nên muốn kiểm bảng thì phải `setViewportSize` ≥ 768.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{reporting,event,index}.ts`, `packages/contracts/test/`:
  - `EventOverview`, `RecentOrder`, `eventOverviewApiPath`, `eventOverviewLiveApiPath`;
  - hàm định dạng giờ VN "HH:mm" và "dd/MM · HH:mm" kèm hàm so cùng ngày;
  - test.
- [x] `apps/api/src/modules/ordering/{order-changed,orders.service,event-overview-read,index}.ts`:
  - phát `event_orders_changed` cùng `order_changed`, và sau commit TX1;
  - read model `eventRevenueOf`, `recentOrdersOf`.
- [x] `apps/api/src/modules/payment/{review-read,index}.ts`: `openReviewsOf(db, orderIds)` → loại và số tiền nhận.
- [x] `apps/api/src/modules/reporting/{event-overview.controller,event-overview.service,reporting.module}.ts`: REST + SSE; sửa chú thích AD-33.
- [x] `apps/api/test/reporting/event-overview.test.ts` (mới):
  - phủ các dòng Matrix phía api (doanh thu, 5 Đơn, dòng `review`, 404/403, lọc stream theo Sự kiện, tín hiệu cho Đơn 0đ và Đơn có phí sau commit);
  - không có `NOTIFY` khi TX1 rollback.
  - Sửa `order-live.test.ts`, `isolation.test.ts`.
- [x] `apps/web/lib/reporting/{api,overview}.ts`, `apps/web/test/event-overview.test.ts`:
  - fetcher + query key;
  - hàm thuần cho badge, dòng loại Cần xử lý và nhãn giờ;
  - Vitest.
- [x] `apps/web/components/tickee/stat-card.tsx`, `apps/web/app/(dashboard)/btc/[orgId]/su-kien/[eventId]/{event-overview,event-tabs}.tsx`: hai khối, live, toast và nhãn mất mạng.
- [x] `apps/web/e2e/{organizer-mock.ts,event-overview.spec.ts}`:
  - handler mặc định;
  - các dòng Matrix phía web: thẻ < `md`, bảng ≥ `md`, tín hiệu → Đơn mới lên đầu, 503 → polling 10 giây, offline → toast + nhãn, nháp, lỗi tải + "Thử lại".
- [x] `ARCHITECTURE-SPINE.md` (AD-17: phát sau TX1, route SSE; AD-33: read model đầu tiên), `epic-3-context.md`, `deferred-work.md`, ghi chú E2-6 trong `sprint-status.yaml` (nhãn trạng thái bán → 4.2): tài liệu khớp code.

**Acceptance Criteria:**
- Given `pnpm test`, `pnpm typecheck`, `pnpm lint:deps`, `pnpm test:e2e`, when chạy, then tất cả pass, và `reporting` chỉ import `index.ts` của mô-đun khác.
- Given hai route mới, when chạy bộ test cách ly, then cả hai mang `orders.view`; BTC khác → 403; id ngẫu nhiên → 404 mà không treo stream.
- Given Owner đang mở Tổng quan, when IPN trả tiền một Đơn, then doanh thu và badge đổi mà không cần reload.

## Implementation Notes

- Phát sau commit TX1: `ordering/order-changed.ts` › `announceOrderCreated(db, ids)` chạy `pg_notify` trong một transaction riêng (giữ `realtime.notify(tx, …)` không đổi); `placeOrder` trả `{ id, organizationId, eventId }` để phát ngay sau commit, trước khi đọc lại Đơn. Lỗi → `logger.warn` chỉ có id.
- `notifyOrderChanged` phát `order_changed` rồi `event_orders_changed` trong cùng `tx`; `order-live.test.ts` › `notificationsFor` lọc thêm `type` (mặc định `order_changed`).
- `recentOrdersOf`: hai câu (5 Đơn qua index `(event_id, created_at)`, rồi `SUM(quantity)` của đúng 5 Đơn đó). `RecentOrder.review.receivedAmount` cho phép `null` (cột `payment_events.paid_amount` nullable); web khi đó chỉ ghi "Lệch số tiền".
- Hàm giờ mới ở contracts: `formatVnTime`, `formatVnDayTime`, `isSameVnDay` (offset +07:00 cố định, không `Intl`).
- Web: toast mất mạng là `toast.warning` với `id` cố định, gỡ khi có mạng lại; nhãn "Cập nhật lúc HH:MM" (giờ VN) nằm trong vùng `aria-live` luôn có trong DOM. 401 → bỏ query khỏi cache rồi `useGoToLogin` (một lần mỗi lần mount).

## Spec Change Log

## Review Triage Log

Vòng 1 (review_loop_iteration 0). Nguồn: BH = Blind Hunter, EC = Edge Case Hunter, VG = Verification Gap (đã kiểm sẵn).

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | BH | `announceOrderCreated` log nguyên `message` của lỗi DB, trái luật chỉ log lỗi DB qua `dbErrorSummary`; `code` đọc ở tầng ngoài nên thường `undefined` | low | Đúng: `order-changed.ts` log `{ code, message }` của `DrizzleQueryError` (message chứa SQL và tham số). `platform/logging/db-error.ts:48` `dbErrorSummary` đọc SQLSTATE theo chuỗi `cause` | patch (P1) |
| 2 | BH | Lệnh phát sau commit TX1 là một transaction riêng (BEGIN, `pg_notify`, COMMIT) nằm trên đường tạo Đơn, trước lúc tạo link | low | Có thêm vài round trip mỗi Đơn tạo thành công, ngoài TX1, không giữ khóa tồn kho. Số lần chạy bị chặn bởi số Đơn tạo được (≤ số suất), nên chỉ thêm vài ms so với ngưỡng p95 2 giây. Muốn bỏ hẳn thì phải đổi chữ ký `realtime.notify` (nhận `Tx`) | reject |
| 3 | BH | Schema `EventOverview` đóng (enum trạng thái/loại, `.max(5)`), web parse cứng nên bản web cũ gặp giá trị mới sẽ lỗi cả khối | low | `OrderStatus` (6 trạng thái) và `ReviewItemType` (5 loại) đã là đủ máy trạng thái của AD; web và api deploy cùng nhau; chưa có story nào thêm giá trị. Muốn nới thì phải thêm nhánh dự phòng ở cả schema lẫn bảng nhãn | reject |
| 4 | BH | Đã có dữ liệu mà lần tải lại sau lỗi server (5xx) thì số liệu cũ vẫn hiện như đang sống, không có nhãn | low | Đúng: `offline` của `useLiveResource` chỉ gồm mất mạng hoặc lỗi mạng (`use-live-resource.ts:145`); `query.isError` có dữ liệu thì không hiện gì. Sửa bằng một điều kiện | patch (P2) |
| 5 | BH | Nhãn giờ "HH:mm" của Đơn hôm qua không đổi sau nửa đêm, vì `now` chỉ tính khi render | low | Đúng, nhưng chỉ xảy ra khi tab mở qua nửa đêm giờ Việt Nam mà không render lại lần nào (không tín hiệu, dữ liệu y nguyên). Sửa phải thêm state và hẹn giờ | reject |
| 6 | BH | Prop `align` của `OrderStatusCell` không nơi nào truyền `'end'`; danh sách thẻ tự dựng lại badge và dòng loại | low | Prop thừa là đúng. Còn phần dựng lại thì cố ý: dòng loại ở cột trái dưới mã Đơn, badge ở cột phải (mock `key-dashboard-event.html`), khác ô bảng. Sửa trực tiếp: bỏ prop thừa | patch (P3) |
| 7 | BH | `openReviewsOf` không lọc `orgScope` | false | Nơi gọi duy nhất truyền id lấy từ `recentOrdersOf` (đã `orgScope`). Mục `review_items` có `order_id` luôn cùng BTC với Đơn: IPN cho Đơn của BTC khác thành `unmatched`, `order_id` null (`payment/schema.ts:20-23`) | reject |
| 8 | BH | Phần `organizationId` của bộ lọc SSE chưa có test | false | Mỗi `eventId` chỉ thuộc một BTC, nên không tín hiệu thật nào khớp `eventId` mà lệch `organizationId`; muốn test phải giả `NOTIFY`. Đây là lớp phòng thủ thêm, không có kết cục xấu nào để test bắt | reject |
| 9 | BH | Chưa có test cho thấy các đường hết hạn phát `event_orders_changed`; `order-live.test.ts` không kiểm cặp tín hiệu | low | `notifyOrderChanged` là điểm duy nhất, phát cả hai topic. `order-live.test.ts` ghim `order_changed` ở từng điểm; `event-overview.test.ts` ghim cặp tín hiệu ở TX2 | reject |
| 10 | BH | Test tên "< 1 giây" assert `< 1_500`, và mốc giờ tính cả `signUp` | low | Đúng: `sent` lấy trước `place()` (gồm `signUp`), nên không đo độ trễ tín hiệu. Sửa trực tiếp | patch (P4) |
| 11 | BH | `deferred-work.md` ghi "Đã xử lý" phần còn lại của E2-6 trong khi `sprint-status.yaml` để E2-6 `open`; dòng "Đã xử lý" mở một mục mới không có mục nào phía trên | low | Đúng: chưa sửa nhãn, chỉ mới quyết chuyển sang 4.2. E2-6 giữ `open` là đúng, câu "Đã xử lý" thì sai. Sửa trực tiếp: đổi thành "Quyết định" | patch (P5) |
| 12 | BH | Bản dựng lại `epic-3-context.md` bỏ nhiều luật vẫn còn hiệu lực | low | File này là bản tóm tắt dựng lại ở bước 1 theo `compile-epic-context` (trần độ dài), có ghi "Regenerate…". Các luật vẫn nằm ở `ARCHITECTURE-SPINE.md` và `epics.md`, là nguồn gốc | reject |
| 13 | BH | `StatCard` gắn `aria-label` lên `<section>`, nên mỗi thẻ thành một landmark và lặp lại nhãn đang hiện | low | Đúng: `StageBlock` render `<section>` (`stage-block.tsx:13`), có tên thì thành `region`. Sửa trực tiếp: bỏ `aria-label` | patch (P6) |
| 14 | BH | `reporting.module.ts` đổi trích dẫn AD-34 → AD-33, trong khi phần notices vẫn theo AD-34 | low | Đúng. Sửa trực tiếp: ghi cả AD-33 và AD-34 | patch (P7) |
| 15 | EC | Như #5 (nhãn giờ sau nửa đêm) | low | Như #5 | reject |
| 16 | EC | Rời tab Tổng quan rồi quay lại trong cùng một lần mất mạng thì hiện toast thứ hai | low | Đúng: `TabsContent` unmount nên `wasOffline` về `false`. Chỉ gặp khi đổi tab lúc đang mất mạng; sửa phải đưa trạng thái lên cấp module | reject |
| 17 | EC | Như #4 (lần tải lại lỗi không phải lỗi mạng) | low | Như #4 | patch (P2) |
| 18 | EC | "Cập nhật lúc HH:MM" không ghi ngày khi lần tải cuối là hôm trước | low | Chỉ gặp khi mất mạng qua nửa đêm mà vẫn mở tab. Muốn thêm ngày thì phải đổi câu chữ "HH:MM" đã chốt trong khối frozen | reject |
| 19 | EC | Admin bị gỡ sau khi mở stream vẫn nhận tín hiệu tới khi nối lại | low | Tín hiệu chỉ có `{type}`; lần tải REST sau đó trả 403, nên không lộ dữ liệu. Stream 3.7/3.9 cũng chỉ kiểm quyền lúc mở | reject |
| 20 | VG | Stream mở bằng id Sự kiện viết hoa: `toLowerCase()` ở bộ lọc chưa có test | low | Gap đã kiểm: bỏ `.toLowerCase()` thì stream id viết hoa mở được (200) mà không bao giờ khớp, và mọi test vẫn pass. Thêm một lần gọi `live()` với id viết hoa | patch (P8) |
| 21 | VG | E2e "toast biến mất khi có mạng lại" không thể fail, vì toast tự đóng sau 4 giây cũng thỏa | low | Gap đã kiểm: bỏ `toast.dismiss` thì toast tự đóng sau 4 giây, nằm trong cửa sổ 5 giây của `expect`. Sửa test: kiểm toast còn trước khi có mạng lại, rồi `toHaveCount(0, { timeout: 500 })` | patch (P9) |

## Design Notes

- **Vì sao phát sau commit TX1:** AD-17 cấm `NOTIFY` trong TX1, để không thêm khóa hàng đợi `NOTIFY` lúc commit trong khi TX1 đang giữ khóa tồn kho. Lệnh riêng sau commit không giữ khóa tồn kho. Spec 3.7 để 3.11 tự quyết việc báo dashboard cho Đơn 0đ. Mất tín hiệu chỉ xảy ra nếu tiến trình chết đúng giữa commit và `NOTIFY`; khi đó dashboard tự đúng lại ở lần `visibilitychange`, `resync` hoặc tín hiệu kế tiếp.
- **Vì sao dùng hàm read model thay vì view:** AD-33 cho phép cả hai. Hàm theo đúng mẫu `paidBuyerCount`, đổi cột không phải sửa view, và lọc được theo `organization_id` lẫn `event_id`.
- **Vì sao `orders.view`:** quyền này khai báo sẵn cho Owner/Admin. CTV (Epic 5) không có quyền này, nên không đăng ký được `event_orders_changed`.
- Gợi ý:
  ```ts
  // reporting/event-overview.controller.ts
  @Get('live') @RequirePermission(Permission.ORDERS_VIEW)
  async live(@Param('eventId') eventId: string, @Req() req, @Res() res) {
    await assertEventOfOrganization(this.db.orm, ctx, eventId); // 404 trước khi mở
    this.hub.open(req, res, (s) => s.type === RealtimeTopic.EVENT_ORDERS_CHANGED && s.eventId === eventId && s.organizationId === ctx.organizationId);
  }
  ```

## Verification

**Commands:**
- `pnpm test` -- expected: pass (contracts, api với Postgres thật, web).
- `pnpm typecheck && pnpm lint:deps` -- expected: pass.
- `pnpm test:e2e` -- expected: pass trên ios-webkit và android-chromium.

**Manual checks (if no CLI):**
- `pnpm dev`, đăng nhập BTC demo, mở tab Tổng quan của một Sự kiện miễn phí đang mở bán. Ở cửa sổ khác, đăng ký bằng một tài khoản Người mua. Trong vài giây, Đơn phải hiện đầu khối "Đơn gần đây" và "· 1 Đơn" phải tăng, không cần reload.
