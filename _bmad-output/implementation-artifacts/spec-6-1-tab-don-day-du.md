---
title: 'Story 6.1: Tab Đơn đầy đủ'
type: 'feature'
created: '2026-11-26'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'e0e3610e46dca9a1e41276111afc72a00ece4ea6'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Tab "Đơn" của Sự kiện vẫn chỉ là ô "Sắp có". BTC chỉ thấy 5 Đơn gần đây ở Tổng quan. BTC chưa tra được Người mua theo mã Đơn, email hay SĐT, và chưa xem được câu trả lời form hay Vé của một Đơn (FR-31, UX-DR37). `needs-action-card` vẫn dẫn sang trang Cần xử lý. Quy ước phân trang `cursor` + `limit` của spine chưa có chỗ dùng (mục hoãn F4 của sprint change proposal 21/11, `story: 6.1`).

**Approach:**
- **API (`reporting`, `orders.view`):**
  - `GET /v1/orgs/:orgId/events/:eventId/orders`: danh sách, lọc ở server, `cursor` + `limit`.
  - `GET …/orders/:code`: chi tiết một Đơn.
  - Read model mới: ở `ordering` (danh sách và chi tiết Đơn), `ticketing` (Vé của một Đơn), `payment` (mọi mục Cần xử lý của một Đơn). `reporting` ghép các nguồn này.
- **Contracts:** file mới `event-orders.ts` chứa schema, đường API, `parseOrderSearch` và cursor.
- **Web:**
  - tab Đơn gồm bảng hoặc thẻ, chip trạng thái, ô tìm, "Trang trước"/"Trang sau" và `Sheet` chi tiết. Tab tự cập nhật qua stream Tổng quan;
  - Tổng quan thêm link "Xem tất cả Đơn" và đổi đích của `needs-action-card`.

**Quyết định (Mason, 26/11/2026):**
- **Chip "Cần xử lý"** (`status=needs_action`) lọc Đơn của Sự kiện có ít nhất một mục Cần xử lý `open`, ở mọi trạng thái Đơn (vd. Đơn `paid` bị trả trùng). Cách lấy giống cách `needs-action-card` đếm, nên danh sách khớp số trên thẻ.
- **Không thao tác Cần xử lý ngay trong tab Đơn.** `Sheet` chi tiết hiện loại và số tiền của mục `open`, kèm link "Xử lý ở trang Cần xử lý" (`reviewQueuePath(orgId, eventId)`).
- **`epic-5-retro-e5-5-no-ky-thuat`** (vế "`checkin_method`: cùng 6.1 hoặc 6.5"): để lại cho 6.5.
- **`epic-4-retro-e4-5-quyet-dinh-can-xu-ly`** (vế B2): để lại, mục giữ trạng thái như cũ.

## Boundaries & Constraints

**Always:**
- **Quyền và phạm vi:**
  - Hai route nằm trong `EventOrdersController` mới của `reporting`, có `@RequirePermission(ORDERS_VIEW)` và `cache-control: no-store`.
  - Kiểm Sự kiện (`assertEventOfOrganization`) trước mọi lần đọc, kể cả ở route chi tiết: id Sự kiện lạ trả `404 EVENT_NOT_FOUND` trước khi xét mã Đơn.
  - Mã Đơn được trim rồi viết hoa. Mã không khớp `ORDER_CODE_PATTERN`, hoặc không thuộc Sự kiện hay BTC này, trả `404 ORDER_NOT_FOUND`.
  - CTV nhận `403 NOT_A_MEMBER` từ guard sẵn có.
- **Đọc chéo mô-đun** chỉ qua hàm xuất ở `index.ts`. Mọi hàm lọc theo `orgScope` và `event_id`, không join bảng của mô-đun khác. Số câu truy vấn cố định cho mỗi trang (không N+1).
- **Danh sách** (`EventOrderListQuery`):
  - tham số: `status?` ∈ `paid` | `pending` | `needs_action` | `cancelled` | `refunded`; `q?` (tối đa 254 ký tự); `cursor?`; `limit` từ 1 đến 100, mặc định 50. Trả về `{ orders, nextCursor }`;
  - xếp theo `created_at DESC, code DESC`. Keyset `(created_at, code) < cursor`, lấy `limit + 1` dòng để biết còn trang sau;
  - cursor là chuỗi base64url mờ, chứa `created_at` đủ micro giây và mã Đơn, không chứa id nội bộ. Cursor hỏng trả `400 VALIDATION_FAILED`;
  - `q` đi qua `parseOrderSearch`. Viết hoa mà khớp `ORDER_CODE_PATTERN` thì là mã Đơn. Còn lại dùng `parseLookupQuery`: email so với `lower(buyer_email)`, SĐT đổi sang E.164 rồi so `buyer_phone`. Không nhận ra thì trả `400 VALIDATION_FAILED`. Chỉ khớp đầy đủ, không khớp một phần. Có cả `status` lẫn `q` thì lấy giao (AND);
  - mỗi hàng gồm: `code`, `buyerName`, `buyerEmail`, `buyerPhone` (E.164), `items` [{`ticketTypeName`, `quantity`}] từ `order_items`, `totalAmount`, `paidAmount`, `status`, `createdAt`, `paidAt`, và `review` {`type`, `receivedAmount`} | null. `review` là mục `open` cũ nhất (`openReviewsOf`), tính ở mọi trạng thái Đơn. Không có id nội bộ.
- **Chi tiết** (`EventOrderDetail`) gồm:
  - các trường của hàng, thêm `paidSource` và `cancelReason`;
  - `answers` [{`label`, `answer`}] theo `position`, dùng nhãn lúc đặt, kể cả câu hỏi đã bị xóa;
  - `tickets` [{`seq`, `orderTicketCount`, `ticketTypeName`, `holderName`, `status`, `cancelReason`, `checkedInAt`}] theo `seq`. Không Mã QR, không token chia sẻ, không id;
  - `history` theo Design Notes.
- **Log:** không thêm dòng log nào chứa `q`, email hay SĐT. Pino đã che giá trị query (`redactUrlQuery`).
- **Web, tab Đơn** (`orders-tab.tsx` mới, đặt cạnh `event-tabs.tsx`; bỏ `soon` của tab `don`):
  - Từ `md` trở lên là `Table` trên `card` sáng; dưới `md` là danh sách thẻ, theo khuôn của `RecentOrdersBlock`.
  - Các cột:
    - Mã Đơn: `font-mono text-code`, là nút mở `Sheet`;
    - Người mua: tên, email, và SĐT hiển thị bằng `localBuyerPhone`;
    - Vé theo Hạng vé, vd. "2 × VIP, 1 × Thường";
    - Số tiền: `formatVnd`, `tabular-nums`, căn phải;
    - Trạng thái: `orderStatusBadge`, có `review` thì thêm dòng `reviewLine`;
    - Thời gian: lúc tạo, và lúc thanh toán nếu có, theo giờ Việt Nam.
  - **Chip lọc:** Tất cả · Đã thanh toán · Chờ thanh toán · Cần xử lý · Đã hủy · Đã hoàn tay.
  - **Ô tìm:**
    - chỉ gửi khi bấm Enter hoặc nút "Tìm", có nút xóa;
    - giá trị không nhận ra thì báo ngay dưới ô "Nhập mã Đơn, email hoặc SĐT đầy đủ" và không gọi API.
  - **URL:**
    - dạng `?tab=don&trangThai=<da-thanh-toan|cho-thanh-toan|can-xu-ly|da-huy|da-hoan-tay>&tim=<chuỗi>`;
    - F5 vẫn giữ bộ lọc; giá trị lạ thì bỏ qua;
    - cursor không lên URL. Đổi bộ lọc thì quay về trang đầu.
  - **Phân trang:** nút "Trang trước"/"Trang sau", ngăn xếp cursor giữ trong state. Không cuộn vô hạn, không đếm tổng.
  - **Tự cập nhật:** `useLiveResource` với `queryKey` gồm bộ lọc và cursor, `livePath` là `eventOverviewLiveApiPath`, polling 10 giây khi chưa kết nối. `Sheet` chi tiết cũng tự cập nhật như vậy.
  - **`Sheet` chi tiết** (`side="right"`):
    - nội dung: Người mua, câu trả lời form, danh sách Vé, Số tiền và lịch sử. Vé hiện "Vé k/N" · Hạng vé · tên · `status-badge`: Hợp lệ (success), Đã check-in (neutral, kèm giờ), Đã hủy (danger). Số tiền hiện tổng, và số đã nhận nếu khác tổng;
    - Đơn có mục Cần xử lý `open`: thêm khối hiện `reviewLine` và link "Xử lý ở trang Cần xử lý";
    - không có Mã QR. Đóng `Sheet` thì focus trở về nút đã mở nó.
  - **Lúc tải và lỗi:** tải lần đầu hiện skeleton. Lỗi hiện `StatusBanner` danger kèm "Thử lại". `401` thì chuyển sang đăng nhập (như Tổng quan).
  - **Khi trống:**
    - Sự kiện chưa có Đơn (chip Tất cả, không tìm): `EmptyState` "Chưa có Đơn nào." / "Gửi link Sự kiện để bắt đầu bán." kèm nút "Sao chép link" (`copyWithToast`, toast "Đã sao chép");
    - Sự kiện `draft`: không có nút, mô tả là "Mở bán Sự kiện để có link gửi Người mua.";
    - có bộ lọc mà không Đơn nào khớp: "Không có Đơn nào khớp bộ lọc." kèm "Bỏ lọc".
  - Dùng được ở 320px không cuộn ngang. Chip và nút đủ vùng chạm. Không truyền đạt chỉ bằng màu.
- **Tổng quan:**
  - `RecentOrdersBlock` thêm link "Xem tất cả Đơn" sang tab Đơn;
  - `needs-action-card` dẫn sang tab Đơn đã lọc Cần xử lý, chữ "Mở tab Đơn, lọc Cần xử lý";
  - bấm link thì chuyển tab ngay trong trang, không reload. `EventTabs` đang giữ tab bằng `useState`, nên phải theo được thay đổi của URL.
- **Contracts:** sửa chú thích của `REVIEW_QUEUE_EVENT_PARAM` (`reporting.ts:236-239`), bỏ cụm "cho tới khi Story 6.1". Giữ hằng này vì trang Cần xử lý vẫn dùng.

**Never:**
- Không migration, không thêm index. Danh sách đi qua `orders_event_id_created_at_idx`; tìm SĐT/email quét trong phạm vi Sự kiện như Story 5.5.
- Không xuất CSV (6.3). Không làm số liệu Hạng vé hay doanh thu (6.2). Không thêm `event_checkins_changed` vào stream Tổng quan (6.2). Trạng thái check-in trong `Sheet` cập nhật ở lần tải lại kế tiếp.
- Không có chip "Hết hạn", vì AC 6.1 không liệt kê. Đơn hết hạn chỉ hiện ở chip "Tất cả".
- Không ghi người thao tác vào lịch sử Đơn.
- Không sửa `contracts/organizer.ts`, `organizer/payment-service.ts` hay `can-xu-ly/review-queue.tsx` (E4-10: tách trước story đầu tiên chạm lại).
- Không có thao tác duyệt tay, từ chối, hoàn tay hay ghép trong tab Đơn. Đây là lệch có chủ đích so với `EXPERIENCE.md:196` (Mason chốt 26/11/2026). Lần đối chiếu spec sau retro Epic 6 sẽ gom lệch này về UX và `epics.md`.
- Không thêm cột `checkin_method`: để lại cho 6.5 (`epic-5-retro-e5-5-no-ky-thuat`, Mason chốt 26/11/2026). Lý do: AC 6.1 chỉ cần biết Vé đã check-in hay chưa, và Sheet ở 6.5 mới là nơi dùng phương thức check-in.
- Không làm vế B2 của `epic-4-retro-e4-5-quyet-dinh-can-xu-ly` (Trang Đơn của Người mua khi BTC Tạm ngừng bán). Lý do: B2 không chạm file nào của 6.1, và retro Epic 4 chỉ gắn Epic 6 cho vế C1.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Trang đầu | 120 Đơn, `limit` 50 | 50 Đơn mới nhất, có `nextCursor` | N/A |
| Trùng `created_at` | 3 Đơn cùng micro giây nằm ở ranh giới trang | Đi hết các trang: không mất, không lặp Đơn nào | N/A |
| Tìm theo SĐT | `q=0912 345 678` | Đơn có `buyer_phone = +84912345678` | N/A |
| Tìm theo email | `q=Minh@X.vn` | Đơn có `lower(buyer_email) = minh@x.vn` | N/A |
| Tìm theo mã Đơn | `q=tk1234abcd` | Đúng Đơn `TK1234ABCD` của Sự kiện | N/A |
| Tìm sai dạng | `q=0912` hoặc `q=minh@` | Web báo ngay, không gọi API | API: `400 VALIDATION_FAILED` |
| Cursor hỏng | `cursor=abc` | — | `400 VALIDATION_FAILED` |
| Đơn của Sự kiện khác | `GET …/orders/:code` với mã Đơn của Sự kiện khác cùng BTC | — | `404 ORDER_NOT_FOUND` |
| CTV gọi | CTV được giao gọi cả hai route | — | `403 NOT_A_MEMBER` |
| Sự kiện lạ | id ngẫu nhiên | — | `404 EVENT_NOT_FOUND` |
| Có Đơn mới | Tab đang ở trang đầu | Đơn mới hiện ở đầu bảng, không reload | Mất SSE thì polling 10 giây |

</frozen-after-approval>

## Code Map

**API**
- `apps/api/src/modules/ordering/event-overview-read.ts`:
  - mẫu read model cần theo: `recentOrdersOf` (:54) gồm `orgScope` + `event_id`, hai câu truy vấn, `ticketCountsOf` (:124);
  - `reviewOrdersOf` (:95) dùng cho cách đếm Cần xử lý.
  - Đặt read model mới trong file `ordering/event-orders-read.ts` và xuất qua `ordering/index.ts:6-15`.
- `apps/api/src/modules/ordering/schema.ts`:
  - `orders` :102-179: `code`, `status`, `buyer_*`, `total_amount`, `paid_amount`, `paid_source`, `paid_at`, `expires_at`, `cancel_reason`, `created_at`, `updated_at`; index :145;
  - `order_items` :186: `ticket_type_name`, `quantity`;
  - `order_answers` :214-234: `position`, `label`, `answer`.
- `apps/api/src/modules/ordering/buyer-contact-read.ts:21`: cách khớp SĐT/email đầy đủ. Dùng lại cùng biểu thức, không gọi hàm này (hàm trả về id, không phân trang).
- `apps/api/src/modules/ticketing/schema.ts:37-87` (cột của Vé); `ticketing/lookup-read.ts` là mẫu. Thêm `orderTicketsOf(db, scope, orderId)` và xuất qua `ticketing/index.ts`.
- `apps/api/src/modules/payment/review-read.ts`:
  - `openReviewsOf` :34 (mục `open` cũ nhất của mỗi Đơn), `openReviewItemsOf` :69 (mục `open` của BTC, có `orderId`);
  - thêm `reviewItemsOfOrder(db, scope, orderId)` trả mọi mục (`type`, `status`, `createdAt`), xuất qua `payment/index.ts:41-50`.
- `apps/api/src/modules/reporting/event-overview.service.ts`:
  - `assertEvent` :20;
  - `eventOpenReviewCountOf` :57-66 là cách lấy id Đơn của Sự kiện có mục `open`. Dùng chung, đừng chép.
- `apps/api/src/modules/reporting/event-overview.controller.ts`: mẫu controller (`@Access`, `@RequirePermission`, `@Header`). `reporting.module.ts` để đăng ký controller và service mới.
- `apps/api/src/platform/audit/audit.ts:239` `audit.trailOf`: lấy `order.rejected` / `order.refunded` (target `{type:'order', id}`).
- `apps/api/src/platform/http/parse-request.ts`: parse `@Query()` theo schema, mẫu ở `review-queue.controller.ts:29`.
- `apps/api/test/organizer/isolation.test.ts`:
  - thêm `guarded` và `permissionOf` (:136-138, :175);
  - đổi `toHaveLength(28)` thành 30 (:400).
- `apps/api/test/reporting/event-overview.test.ts`: mẫu dựng dữ liệu. Mẫu test CTV ở `review-queue.test.ts:471`.

**Contracts**
- `packages/contracts/src/order.ts`: `ORDER_CODE_PATTERN` :20, `localBuyerPhone` :95, `OrderStatus` :244.
- `packages/contracts/src/checkin.ts:319` `parseLookupQuery`, `CHECKIN_LOOKUP_QUERY_MAX`.
- `packages/contracts/src/reporting.ts`: `eventOverviewLiveApiPath` :229, `reviewQueuePath` :243, chú thích :236-239. File đã 452 dòng, nên phần mới đặt ở `event-orders.ts`, xuất qua `index.ts`.

**Web** (gốc `apps/web/app/(dashboard)/btc/[orgId]/su-kien/[eventId]/`)
- `event-tab-list.ts:4`: bỏ `soon`.
- `event-tabs.tsx`:
  - :101-105 `select` dùng `router.replace`, chỉ giữ `?tab=`;
  - :120-139 nhánh render theo tab;
  - `page.tsx` phải chuyển `trangThai`/`tim` xuống tab.
- `event-overview.tsx`: `RecentOrdersBlock` :119-143, `OrdersTable` :51-84, `OrdersList` :87-116, `NeedsActionCard` :150-174 (link :166), `EventOverviewLive` :201-206 (mẫu `useLiveResource`).
- `apps/web/lib/reporting/overview.ts:31-69`: `orderStatusBadge`, `reviewLine`, `orderTimeLabel`. Dùng lại, không chép.
- `apps/web/lib/reporting/review-queue.ts:309` `NEEDS_ACTION_LINK`.
- `apps/web/lib/reporting/api.ts:47-51`: mẫu query key và hàm tải. `apps/web/lib/api/client.ts:92` `apiRequest`.
- `apps/web/lib/realtime/use-live-resource.ts:23-75`.
- `can-xu-ly/review-queue.tsx` `ItemSheet` :300-394: mẫu `Sheet` (focus, `SheetSection`). Chép mẫu, không import. Không sửa file này (E4-10).
- `apps/web/components/tickee/{status-badge,empty-state}.tsx`, `apps/web/lib/clipboard.ts:4` `copyWithToast`, `packages/contracts/src/money.ts:5` `formatVnd`, `packages/contracts/src/event.ts:404-416` (giờ Việt Nam).
- Test:
  - `apps/web/e2e/event-overview.spec.ts`: test link Cần xử lý ở :441-471 cần sửa;
  - `apps/web/e2e/organizer-mock.ts:191` `mockOrganizerApi` (thêm mock hai route);
  - `apps/web/e2e/review-queue.spec.ts` là mẫu test `Sheet` và focus;
  - `apps/web/test/event-overview.test.ts` là mẫu vitest.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/event-orders.ts` (+ `index.ts`, test `packages/contracts/test/event-orders.test.ts`): `EventOrderListQuery`, `EventOrderRow`, `EventOrderPage`, `EventOrderDetail`, `EventOrderHistoryEntry`, `eventOrdersApiPath` / `eventOrderApiPath`, `parseOrderSearch`, `EVENT_ORDERS_PAGE_LIMIT` (50) / `_MAX` (100), schema cursor. Test cách phân loại `q`.
- [x] `apps/api/src/modules/ordering/event-orders-read.ts` (+ `index.ts`):
  - `eventOrdersPageOf(db, scope, eventId, {statuses?, orderIds?, search?, cursor?, limit})`: keyset, `created_at` dạng text đủ micro giây, `items` gom theo lô;
  - `eventOrderDetailOf(db, scope, eventId, code)`: Đơn, `items`, `answers`.
- [x] `apps/api/src/modules/ticketing/order-tickets-read.ts` (+ `index.ts`): `orderTicketsOf`.
- [x] `apps/api/src/modules/payment/review-read.ts` (+ `index.ts`): `reviewItemsOfOrder`.
- [x] `apps/api/src/modules/reporting/event-orders.service.ts`, `event-orders.controller.ts`, `reporting.module.ts`:
  - ghép danh sách và chi tiết; `needs_action` lọc theo id các Đơn có mục `open` (Quyết định);
  - dựng `history`; dùng chung cách lấy id Đơn có mục `open` với `EventOverviewService`.
- [x] `apps/api/test/reporting/event-orders.test.ts` (mới): mọi dòng của I/O Matrix; mỗi `status`; cách ly giữa BTC và giữa Sự kiện; chi tiết không có trường QR hay token; `history` của Đơn duyệt tay lệch tiền.
- [x] `apps/api/test/organizer/isolation.test.ts`: thêm hai route và đổi số route thành 30.
- [x] `apps/web/lib/reporting/orders.ts` (+ `test/event-orders.test.ts`): chuyển URL ↔ bộ lọc, nhãn chip, nhãn lịch sử, chuỗi "Vé theo Hạng vé"; hàm tải và query key.
- [x] `…/[eventId]/orders-tab.tsx`, `order-sheet.tsx` (mới), `event-tab-list.ts`, `event-tabs.tsx`, `page.tsx`: tab Đơn như ở Always; chuyển tab theo URL.
- [x] `…/[eventId]/event-overview.tsx`, `apps/web/lib/reporting/review-queue.ts`, `packages/contracts/src/reporting.ts`: "Xem tất cả Đơn", đích và chữ của `needs-action-card`, sửa chú thích.
- [x] `apps/web/e2e/event-orders.spec.ts` (mới), `organizer-mock.ts`, `event-overview.spec.ts`: bảng ở 1024px, thẻ ở 375px; lọc và tìm giữ trên URL sau F5; trang sau, trang trước; `Sheet` và focus; empty-state kèm toast; link từ Tổng quan đổi tab.

**Acceptance Criteria:**
- Given Đơn được duyệt tay khi lệch tiền (Đơn 300.000đ, nhận 250.000đ), when mở `Sheet`, then Số tiền ghi "300.000đ" kèm "đã nhận 250.000đ", và lịch sử có "Cần xử lý · Lệch số tiền" rồi "Đã thanh toán · Duyệt tay".
- Given Tổng quan có `needs-action-card` khác 0, when bấm link, then tab Đơn mở với chip "Cần xử lý" bật, URL có `trangThai=can-xu-ly`, không reload trang.
- Given URL `?tab=don&tim=0912345678`, when tải lại trang, then ô tìm giữ giá trị và bảng chỉ có Đơn khớp.
- Given bất kỳ response nào của hai route, when kiểm JSON, then không có `id` nội bộ, `qr`, `shareToken` hay `checkinScanId`.

## Implementation Notes

- **Lịch sử, mục "Đã thanh toán · Duyệt tay":** `paid_at` của nguồn `manual` là lúc tiền về (Story 4.4), sớm hơn lúc mở mục Cần xử lý, nên xếp theo `paid_at` sẽ đặt "Đã thanh toán" trước "Cần xử lý" và trái AC 1. Riêng nguồn `manual`, mục này lấy lúc BTC duyệt (audit `order.paid`), không có audit thì `paid_at`. Nguồn khác giữ `paid_at` như Design Notes.
- **Lịch sử, mục "Hết hạn":** `markExpired` (IPN `expired`/`canceled`) và `PaymentLinkService.expire` chuyển Đơn sang `expired` sớm mà không đổi `expires_at` (hạn Giữ chỗ), nên `expires_at` có thể nằm ở tương lai. Mục này lấy mốc sớm hơn giữa `expires_at` và `updated_at`.
- **Lịch sử Đơn `refunded` không có audit `order.rejected`** (vd. hủy Sự kiện ở 7.1 rồi hoàn tay): không có mục "Đã hủy" (không biết lúc hủy); "Đã hoàn tay" vẫn lấy `updated_at` khi thiếu audit.
- **`reviewLine` của web** chỉ hiện dòng cho Đơn `review` (test của 3.11 chốt điều này). Tab Đơn cần dòng ở mọi trạng thái Đơn, nên tách lõi thành `reviewItemLine` trong `lib/reporting/overview.ts`; `reviewLine` gọi lại lõi đó, hành vi Tổng quan không đổi.
- **Chuyển tab theo URL:** `EventTabs` đọc `tab` từ `useSearchParams`, bấm tab thay URL bằng `window.history.replaceState` (Next đồng bộ `useSearchParams`, không gọi server). Tab Đơn đọc `trangThai`/`tim` cùng cách, nên `page.tsx` không còn truyền `initialTab` (trang `/btc/[orgId]/…` vốn dựng theo request).
- **`orderTicketsOf(db, scope, eventId, orderId)`** nhận thêm `eventId` để lọc `event_id` theo Always. `reviewItemsOfOrder` chỉ lọc `orgScope` + `order_id` vì `review_items` không có `event_id`; Đơn đã được kiểm thuộc Sự kiện trước đó.
- **Query sai và Sự kiện lạ:** route danh sách kiểm query (không chạm DB) trước, rồi kiểm Sự kiện trước mọi lần đọc; Sự kiện lạ kèm query hợp lệ → `404 EVENT_NOT_FOUND`. Route chi tiết kiểm Sự kiện trước mã Đơn.
- **Phân trang trên web:** chỉ hiện nút dùng được ("Trang trước" ẩn ở trang đầu, "Trang sau" ẩn ở trang cuối) thay vì nút tắt, theo ràng buộc "nút bị tắt luôn kèm lý do". Có thêm nhãn "Trang n"; đổi trang thì focus về đầu danh sách.

## Spec Change Log

## Review Triage Log

| # | Lớp | Phát hiện | Verdict | Route | Bằng chứng |
|---|-----|-----------|---------|-------|------------|
| 1 | BH | Mục "Hết hạn" của lịch sử lấy `expires_at` có thể là giờ tương lai | medium | patch | `markExpired` (`order-jobs.ts:177`, IPN `expired`/`canceled`) và `PaymentLinkService.expire` (`payment-link.ts:300`) đặt `expired` sớm mà không đổi `expires_at` (hạn Giữ chỗ). Sửa: lấy giờ sớm hơn giữa `expires_at` và `updated_at`. |
| 2 | BH | Đơn đã hết hạn rồi nhận tiền muộn mất mục "Hết hạn" | low | reject | Đúng như Design Notes (chỉ khi đang `expired`). Tiền về sau khi hết hạn là ca hiếm; suy ra lúc hết hạn cho Đơn đã đổi trạng thái phải thêm nhánh. |
| 3 | BH | Lịch sử không ghi lúc mục Cần xử lý được đóng | low | reject | Duyệt, từ chối, hoàn tay đã có mục "Đã thanh toán"/"Đã hủy"/"Đã hoàn tay". Chỉ trả trùng bị hoàn hay bỏ qua là không có mục kết thúc: ca hiếm, `Sheet` không còn khối Cần xử lý. Thêm mục phải đọc audit `review_item.*`. |
| 4 | BH | Đường lùi `updated_at` cho "Đã hủy"/"Đã hoàn tay" mong manh, test không kiểm giờ | low | patch (gộp #17) | Lúc chạy: mọi đường tới `cancelled`/`refunded` hiện có đều ghi audit (`order-review.ts:60, :89`), nên đường lùi chưa tới được. Phần test thiếu kiểm `at` gộp vào #17. |
| 5 | BH | `Sheet` không hiện lý do hủy của Đơn và của Vé | low | reject | Lý do hủy Đơn tới được hôm nay chỉ có `rejected`, đã hiện trong lịch sử "Đã hủy". Vé hủy (`event_cancelled`, `voided`) chưa có đường ghi. Spec không đòi trường này. |
| 6 | BH | `Sheet` đang mở không cập nhật khi có check-in | low | reject | Ý định loại trừ: Never (frozen) ghi "Trạng thái check-in trong `Sheet` cập nhật ở lần tải lại kế tiếp". |
| 7 | BH | Mở `Sheet` mở thêm một stream SSE cùng đường | low | reject | Đúng là hai `EventSource` tới `…/overview/live`. Người dùng không thấy, trừ khi chạm giới hạn 6 kết nối của HTTP/1.1. Sửa phải nối tín hiệu của danh sách vào truy vấn chi tiết và lo polling riêng. |
| 8 | BH | Trang Sự kiện có thể thành tĩnh, `useSearchParams` thiếu `Suspense` | false | reject | `next build` ghi `ƒ /btc/[orgId]/su-kien/[eventId]` (dựng theo request), build không lỗi. |
| 9 | BH | Empty-state chỉ tách `draft`; Sự kiện ẩn, đã hủy, đã kết thúc vẫn mời "bắt đầu bán" | low | reject | Chỉ xảy ra với Sự kiện không có Đơn nào mà đang ẩn hoặc đã kết thúc (`cancelled` chưa tới được trước 7.1): hiếm. Sửa cần chọn câu chữ cho từng trạng thái. |
| 10 | BH | Trang 2+ rỗng sau lần tải lại hiện "Không có Đơn nào khớp bộ lọc."; focus rơi về body | low | reject | Chỉ khi Đơn rời bộ lọc giữa hai lần tải; nút "Trang trước" vẫn có. Hiếm, sửa phải thêm nhánh. |
| 11 | BH | Bộ chặn bôi chữ trên hàng chặn luôn Enter/Space trên nút mã Đơn | low | patch | `onClick` của `TableRow` kiểm `window.getSelection()` trên cả trang; click do bàn phím nổi lên hàng nên bị chặn khi có chữ đang chọn. Sửa: bỏ `onClick` của hàng, mở `Sheet` từ chính nút mã Đơn. |
| 12 | BH | Link "Xử lý ở trang Cần xử lý" không dẫn thẳng tới mục | low | reject | Ý định chốt đích `reviewQueuePath(orgId, eventId)` (Quyết định, frozen). |
| 13 | BH | Tên test cũ trong `apps/web/test/event-overview.test.ts` vẫn nói `needs-action-card` dẫn `?suKien=` | low | patch | Assertion đúng (`reviewQueuePath`), chỉ tên và `describe` sai chỗ. Đổi tên là sửa thẳng. |
| 14 | BH | Chú thích "mọi hàm lọc `orgScope`" không khớp `itemsOfOrders`, câu `order_answers`, `openReviewsOf` | false | reject | Các câu này lọc theo id lấy từ câu đã lọc `orgScope` + `event_id`, như `ticketCountsOf` của 3.11; không có đường đọc chéo BTC. |
| 15 | BH | Enum trạng thái và lý do hủy Vé lặp trong contracts, không có ràng buộc đồng bộ | low | reject | Hôm nay khớp `ticketing/schema.ts:14` (`event_cancelled`, `voided`). Chỉ gặp khi thêm lý do mới; ràng buộc kiểu là thêm code. |
| 16 | VG | Tự cập nhật của `Sheet` chi tiết chưa có test | — (gap) | patch | Theo bằng chứng của lớp: không test nào gửi tín hiệu SSE khi `Sheet` mở; thay `useLiveResource` bằng `useQuery` vẫn xanh. |
| 17 | VG | Giờ của các mục lịch sử chưa được so với cột nguồn | — (gap) | patch | Test chỉ kiểm thứ tự `kind`; đổi nguồn giờ của "Hết hạn" hay đường lùi vẫn xanh. Gộp #4. |
| 18 | VG | Ô tìm không chắc được xóa khi "Bỏ lọc" bỏ `tim` | — (gap) | patch | Test "Bỏ lọc" bắt đầu từ `trangThai` không có `tim`; xóa nhánh đồng bộ ô tìm vẫn xanh. |
| 19 | VG | Lỗi chung và "Thử lại" của `Sheet` chưa có test | — (gap) | patch | Chỉ có test 404; ép mọi lỗi thành không tìm thấy vẫn xanh. |
| 20 | VG | Tên test cũ ở `event-overview.test.ts:127` | low | patch (gộp #13) | Cùng gốc với #13. |
| 21 | VG | Thứ tự AC 1 chỉ đúng nhờ vài mili giây độ trễ | low | patch | `paidAt` của IPN fake là `new Date()` (`tingee-fake/server.ts:179`), `review_items.created_at` ghi ngay sau. Truyền `paidAt` sớm hơn một giờ để test bắt được hồi quy. |
| 22 | ECH | Cursor giả mạo năm 0000 qua được giải mã, Postgres từ chối → 500 | low | patch | Đã thử: `'0000-01-01T00:00:00.000000Z'::timestamptz` → "date/time field value out of range"; JS `Date.parse` nhận. Sửa: chặn năm 0000 trong `decodeEventOrderCursor`. |
| 23 | ECH | Enter trên nút mã Đơn không mở `Sheet` khi đang có chữ được chọn | low | patch (gộp #11) | Cùng gốc với #11. |
| 24 | ECH | Nhấp đúp để chọn email trong hàng: lần nhấp đầu mở `Sheet`, lần sau đóng | low | patch (gộp #11) | Cùng gốc: `onClick` cấp hàng. |
| 25 | ECH | Tải trang 2+ lỗi thì banner lỗi không có nút về trang trước | low | reject | Hiếm (lỗi đúng lúc sang trang); vẫn có "Thử lại"; sửa phải thêm nhánh. |
| 26 | ECH | "Trang sau" ra trang rỗng thì focus rơi về body | low | reject | Cùng ca hiếm với #10. |
| 27 | ECH | Empty-state của Sự kiện ẩn hoặc đã hủy | low | reject | Như #9. |
| 28 | ECH | Lần tải lại nền lỗi hoặc offline thì danh sách cũ mà không báo | low | reject | Spec không đòi chỉ báo dữ liệu cũ cho tab Đơn; ít gặp trên dashboard; sửa thêm nhánh UI. |
| 29 | ECH | `Sheet` mở thêm `EventSource` | low | reject | Như #7. |
| 30 | ECH | Đơn có 2+ mục `open`: hàng và `Sheet` chỉ hiện mục cũ nhất | low | reject | Ý định chốt `review` là mục `open` cũ nhất (`openReviewsOf`, Always frozen); link sang trang Cần xử lý thấy đủ. |
| 31 | ECH | Mục được đóng giữa hai lần đọc → hàng "Cần xử lý" có `review` null | low | reject | Tạm thời; lần tải lại kế tiếp (tín hiệu `org_review_items_changed`) sửa ngay. |
| 32 | ECH | Thẻ đếm số mục, chip liệt kê số Đơn; Đơn có hai mục lệch số | low | reject | Thẻ đếm mục theo Story 4.3, danh sách là Đơn; chỉ lệch khi một Đơn có 2+ mục `open` (hiếm). Sửa câu trong spec không phải lượt sửa code. |

## Design Notes

**Lịch sử Đơn:** spine không định nghĩa nguồn, nên dựng từ dữ liệu có sẵn, không thêm bảng. Xếp các mục theo thời gian tăng dần:
- "Tạo Đơn" lấy `created_at`;
- mỗi mục Cần xử lý (mọi trạng thái của mục): "Cần xử lý · <loại>" lấy `review_items.created_at`;
- "Đã thanh toán · <nguồn>" lấy `paid_at`. Nguồn: `ipn` → "Cổng thanh toán", `reconciliation` → "Đối soát bù", `manual` → "Duyệt tay", `free` → "Miễn phí";
- "Hết hạn" lấy `expires_at`, chỉ khi Đơn đang `expired`;
- "Đã hủy" / "Đã hoàn tay" lấy giờ của audit `order.rejected` / `order.refunded`. Không có audit (vd. hủy Sự kiện ở 7.1) thì lấy `updated_at`.

**Cursor đủ micro giây:** `timestamptz` của Postgres lưu tới micro giây, còn `Date` của JS chỉ tới mili giây. Nếu đổi `created_at` qua `Date` rồi so keyset, các Đơn cùng mili giây ở ranh giới trang sẽ bị mất hoặc lặp. Vì vậy select `created_at` dạng text ISO đủ micro giây theo UTC, đưa nguyên chuỗi đó vào cursor, rồi so `(created_at, code) < ($1::timestamptz, $2)`.

**Email và SĐT trên URL:** AC 6.1 bắt giữ bộ lọc trên URL. Story 5.5 tránh URL vì máy của CTV ở cổng dùng chung; ở đây là dashboard của Owner/Admin. API đã che giá trị query trong log và span. Web không có header `Referrer-Policy` riêng, nên trình duyệt dùng mặc định `strict-origin-when-cross-origin`: request sang origin khác chỉ mang origin.

**Chuyển tab theo URL:** link từ Tổng quan đổi `?tab=` trên cùng route, nên `EventTabs` không remount và `useState(initialTab)` giữ tab cũ. Cần một trong hai cách: `EventTabs` đọc tab và bộ lọc từ `useSearchParams`, hoặc truyền callback chọn tab xuống `Overview`. Test e2e của link phải bắt được lỗi này.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: 0 lỗi
- `pnpm test` -- expected: mọi test xanh, kể cả `event-orders.test.ts` mới và `isolation.test.ts`
- `pnpm lint:deps` -- expected: 0 vi phạm (`reporting` → `ordering`, `payment`, `ticketing`)
- `pnpm test:e2e` -- expected: `event-orders.spec.ts` và `event-overview.spec.ts` xanh

**Manual checks (if no CLI):**
- Trên dev stack: mở tab Đơn của một Sự kiện có Đơn thật ở 320px và 1280px. Lọc và tìm; F5 vẫn giữ bộ lọc; mở `Sheet` thấy câu trả lời form và Vé.
