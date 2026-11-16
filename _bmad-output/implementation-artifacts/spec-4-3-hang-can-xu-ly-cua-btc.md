---
title: 'Story 4.3: Hàng "Cần xử lý" của BTC'
type: 'feature'
created: '2026-11-16'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '0b2f4bdab21a96661cad506af8dbf187c63ed283'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** IPN và Đối soát bù đã tạo `review_items` (3.6, 4.1) nhưng BTC không thấy: `can-xu-ly` còn là trang "Sắp có", không có badge số, Tổng quan Sự kiện chưa có `needs-action-card`, và chưa nơi nào phát `org_review_items_changed`.

**Approach:** `reporting` ghép read model của `payment` (mục), `ordering` (Đơn) và `event` (tên) thành hàng gộp mọi Sự kiện của BTC, có `Sheet` chi tiết. Tạo mục thì phát `org_review_items_changed` (topic cấp BTC) trong cùng `tx`. Badge ở sidebar và `bottom-tab-bar` cùng `needs-action-card` cập nhật realtime qua stream `/live` sẵn có của BTC. Story này chỉ đọc; thao tác xử lý là 4.4.

## Boundaries & Constraints

**Always:**
- **Quyết định của Mason (16/11):**
  - Hàng xếp mục cũ nhất trước (`created_at`, rồi `id`, tăng dần).
  - `Sheet` và hàng chỉ hiện tên Người mua.
  - `needs-action-card` dẫn sang `can-xu-ly?suKien={eventId}` cho tới khi 6.1 đổi đích. Trang lọc có chip "Sự kiện: {tên} · Bỏ lọc".
  - Route danh sách nhận tham số lọc `eventId` tùy chọn. Khi lọc, mục `unmatched` không hiện. Response trả kèm tên Sự kiện đang lọc. Sự kiện không thuộc BTC → `404 EVENT_NOT_FOUND`.
- Ba route mới dưới `/v1/orgs/:orgId/review-items`: danh sách, `summary` (`{ openCount }`) và `:itemId` (chi tiết). Quyền `review_queue.handle` (Owner, Admin). Đọc qua read model trong `orgScope`, `no-store`.
- Danh sách chỉ gồm mục `open`. Chi tiết đọc được mục ở mọi trạng thái của BTC; id lạ, sai dạng hoặc của BTC khác → `404 REVIEW_ITEM_NOT_FOUND`.
- `needs-action-row`: `status-badge` loại (nhãn `REVIEW_TYPE_LABEL` sẵn có, tone `danger` cho cả 5 loại), mã Đơn, Người mua, "nhận X / Đơn Y" (phần chênh tô `danger-text`, chỉ khi hai số khác nhau và đều có), tên Sự kiện. Mục `unmatched` không có Đơn: mã Đơn hiện "Không khớp Đơn nào", Người mua và Sự kiện hiện "—".
- `Sheet` có ba phần:
  - "Giao dịch": số tiền nhận, mã giao dịch, thời điểm trả, phương thức. Với `unmatched` thêm "Mã Đơn trong giao dịch" (`provider_order_id`).
  - "Đơn liên quan": mã, `status-badge` trạng thái, Người mua, số Vé, tổng tiền, lúc tạo.
  - "Nhật ký": dựng từ dữ liệu sẵn có ("Nhận tiền" lúc `paid_at`/`received_at`, "Mở mục · {loại}" lúc `created_at`). 4.4 thêm dòng thao tác.
  - Mục `orphan` hiện thêm "Lý do: Sự kiện đã kết thúc / Sự kiện bị khóa / Hết chỗ".
- Hàng trống: "Không có gì cần xử lý."
- Badge nền `brand`, chữ `on-brand`, ẩn khi 0, trên 99 hiện "99+". Tên truy cập của mục nav có số mục ("Cần xử lý, 3 mục").
- `org_review_items_changed` là topic cấp BTC, phát bằng `realtime.notifyOrganization` trong cùng `tx` với INSERT `review_items`. Stream `GET …/live` của BTC đẩy cả topic này; stream Tổng quan Sự kiện đẩy thêm topic này khi `organizationId` khớp. Web giữ đúng một EventSource cho `/live`.
- `needs-action-card` ở Tổng quan Sự kiện: số mục `open` của Sự kiện (`openReviewCount` trong `EventOverview`).
  - Có mục: "{n} mục Cần xử lý" kèm liên kết "Xem các mục Cần xử lý".
  - 0 mục: "Không có gì cần xử lý.", không có liên kết.

**Never:**
- Không làm duyệt, từ chối, ghép, hoàn tay, toast kết quả hay audit `review_item.*` (4.4). Không làm tab Đơn hay bộ lọc của nó (6.1).
- Không migration, không đổi luật IPN, Đối soát bù hay `markPaid`. `payment` không import `event`.
- Không trả `payment_events` thô (`bill_id`, `merchant_id`, `request_id`). Không trả email/SĐT Người mua.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Hàng gộp | Owner/Admin, mục `open` ở 2 Sự kiện | Mọi mục, cũ nhất trước; `resolved` không hiện | N/A |
| Lọc theo Sự kiện | `?eventId=` Sự kiện A của BTC | Chỉ mục của A, không có `unmatched`; kèm tên A | Sự kiện của BTC khác hoặc không tồn tại → `404 EVENT_NOT_FOUND` |
| Lệch số tiền | nhận 250.000đ, Đơn 300.000đ | "nhận 250.000đ / Đơn 300.000đ", phần chênh `danger-text` | N/A |
| Chưa khớp | `unmatched`, `order_id` null | Dòng không Đơn; `Sheet` có "Mã Đơn trong giao dịch" | N/A |
| Trống | Không mục `open` | "Không có gì cần xử lý."; không badge; card 0 | N/A |
| Mục mới | IPN tạo `review_item` | `org_review_items_changed` phát khi commit; badge, hàng, card tải lại không reload | `tx` rollback → không tín hiệu |
| Chi tiết lạ | `:itemId` của BTC khác, không tồn tại, sai dạng | `404 REVIEW_ITEM_NOT_FOUND` | N/A |
| Không phải thành viên | BTC khác hoặc CTV (chưa là vai thành viên) | `403 NOT_A_MEMBER` ở cả 3 route và `/live` | N/A |
| Badge lớn | 120 mục | "99+" | N/A |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/realtime.ts:36` -- thêm `ORG_REVIEW_ITEMS_CHANGED` vào `ORGANIZATION_REALTIME_TOPICS`. Sửa `test/realtime.test.ts`.
- `packages/contracts/src/reporting.ts:130,145-200` -- mẫu schema và path builder. Thêm schema hàng, `summary`, chi tiết và `openReviewCount` vào `EventOverview`.
- `packages/contracts/src/payment.ts:20-82` -- loại, lý do và trạng thái mục.
- `packages/contracts/src/organizer.ts:25,44,140` -- `Permission.REVIEW_QUEUE_HANDLE` (chưa dùng), section `review-queue` → `can-xu-ly`. Mã lỗi mới theo mẫu `EVENT_NOT_FOUND`.
- `apps/api/src/modules/payment/ipn-processor.ts:294-306` -- `openReviewItem`: nơi INSERT duy nhất (Đối soát bù dùng chung), nên phát tín hiệu ở đây. Helper: `platform/realtime/notify.ts:37`.
- `apps/api/src/modules/payment/review-read.ts` -- thêm hàm đọc theo BTC: danh sách `open` kèm số tiền từ `payment_events`, đếm, chi tiết. Dùng `orgScope` (`platform/access/org-scope.ts:26`). Xuất qua `index.ts`.
- `apps/api/src/modules/ordering/event-overview-read.ts` -- mẫu `recentOrdersOf`. Thêm hàm theo lô id Đơn trong `orgScope`: mã, tên Người mua, tổng tiền, trạng thái, `event_id`, lúc tạo, số Vé.
- `apps/api/src/modules/event/index.ts` -- dùng `ticketEventsByIds` lấy tên Sự kiện.
- `apps/api/src/modules/reporting/` -- controller và service mới theo mẫu `event-overview.*`, đăng ký ở `reporting.module.ts`.
  - `event-overview.service.ts:29-45` thêm số mục.
  - `event-overview.controller.ts:37-44` và `organization-live.controller.ts:23-31` mở bộ lọc cho topic mới.
- Test API:
  - `test/organizer/isolation.test.ts:57-126`: route tự phát hiện; thêm `expect` cho `guarded` và `permissionOf`.
  - `test/reporting/organization-live.test.ts:126-138`: hiện khẳng định topic này không tới; đổi thành phải tới.
  - `test/payment/ipn-edge.test.ts`: tín hiệu khi tạo mục.
  - `test/reporting/event-overview.test.ts`.
- Web:
  - `app/(dashboard)/btc/[orgId]/can-xu-ly/page.tsx`: thay `ComingSoon` theo mẫu `thanh-vien/page.tsx`.
  - `lib/reporting/overview.ts:37-61`: dùng lại `REVIEW_TYPE_LABEL`, `ORDER_STATUS_BADGE`, `reviewLine`.
  - `lib/reporting/api.ts:27-35`: mẫu fetch và hằng poll 10 giây.
- Shell web:
  - `lib/organizer/nav.ts:41-47`, `components/tickee/dashboard-sidebar.tsx:34-63` (dải `md`–`lg` chỉ icon) và `bottom-tab-bar.tsx:65-78`: badge.
  - `components/tickee/status-banner-stack.tsx:84-96`: `onSignal` làm mất hiệu lực query đếm và query hàng. Không mở EventSource thứ hai (`e2e/status-banners.spec.ts:329`).
- `su-kien/[eventId]/event-overview.tsx:227-233` -- ô thứ hai cạnh `StatCard` doanh thu dành cho `needs-action-card`.
- UI dùng lại:
  - `components/ui/sheet.tsx`, `status-badge.tsx`, `Skeleton`, `StatusBanner` (lỗi + "Thử lại").
  - `empty-state.tsx`: `description` đang bắt buộc, cần cho phép bỏ.
  - `formatVnd` (`contracts/money.ts:5`), `formatVnDateTime` (`contracts/event.ts:304`).
  - Mẫu bảng `md+` / thẻ dưới `md`: `event-overview.tsx:48-114`.
- Test web:
  - Unit: `test/nav.test.ts`, `test/event-overview.test.ts`.
  - e2e:
    - `organizer-mock.ts`: thêm handler mặc định cho `summary`, không thì mọi spec dashboard nhận 500.
    - `live-mock.ts`.
    - `dashboard-shell.spec.ts:21,265-268,405-422`: còn khẳng định "Sắp có".

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{realtime,reporting,organizer}.ts` (+ test) -- topic cấp BTC, schema và path, mã lỗi, `openReviewCount`.
- [x] `apps/api/src/modules/payment/{review-read,ipn-processor,index}.ts` -- read model theo BTC; tín hiệu trong `tx` khi tạo mục.
- [x] `apps/api/src/modules/ordering/{event-overview-read,index}.ts` -- Đơn theo lô trong `orgScope`.
- [x] `apps/api/src/modules/reporting/*` -- controller và service hàng, chi tiết, đếm; số mục ở Tổng quan; bộ lọc hai stream.
- [x] Test API cho mọi dòng I/O Matrix, cách ly, tín hiệu khi commit và khi rollback.
- [x] Web: trang `can-xu-ly` (hàng, `Sheet`, lọc `suKien` kèm chip "Bỏ lọc", trống, loading, lỗi, offline), badge sidebar và tab bar, `needs-action-card`, invalidation qua `StatusBannerStack`, `EmptyState` cho phép bỏ `description`.
- [x] Test web unit và e2e: hàng, lọc và bỏ lọc, `Sheet` (Enter/Esc), badge realtime qua `fakeEventSource`, card dẫn sang hàng đã lọc; sửa các spec "Sắp có".

**Acceptance Criteria:**
- Given màn 320px, when mở hàng và `Sheet`, then không có cuộn ngang; dưới `md` hàng là danh sách thẻ.
- Given `pnpm lint:deps`, then sạch: `reporting` ghép dữ liệu, `payment` không import `event`.
- Given bộ test cách ly, then ba route mới được phát hiện và đều pass.

## Implementation Notes

- `story_key`: `4-3-hàng-cần-xử-lý-của-btc`. Nhánh `feat/4-3-hang-can-xu-ly-cua-btc`.
- Mã lỗi `REVIEW_ITEM_NOT_FOUND` nằm ở `packages/contracts/src/errors.ts` (không phải `organizer.ts`). `REVIEW_BADGE_MAX` (99), `REVIEW_QUEUE_EVENT_PARAM` (`suKien`), `reviewQueuePath` và `ReviewItemLogKind` (`payment_received`, `item_opened`) nằm ở `reporting.ts`.
- Stream `/live` cấp BTC chỉ thêm `org_review_items_changed` khi vai có `review_queue.handle`. Hiện Owner và Admin đều có quyền này.
- Một EventSource: `StatusBannerStack` báo `onConnectedChange`. `DashboardShell` giữ trạng thái này và chia qua `OrganizationLiveProvider` (`components/tickee/organization-live.tsx`), để badge và hàng chỉ polling khi stream chưa kết nối. Khóa query dùng chung gốc `reviewQueueQueryPrefix`.
- `?suKien=` lạ, sai dạng hoặc quá dài → `empty-state` "Không tìm thấy Sự kiện này." kèm "Xem mọi mục Cần xử lý".
- "Thời điểm trả" hiện "—" khi Tingee không gửi `paidAt`. Nhật ký "Nhận tiền" lấy `paid_at`, không có thì lấy `received_at`, rồi xếp theo thời gian.
- Phương thức `qr` hiện "Quét mã QR"; mã khác giữ nguyên như Tingee gửi.
- `e2e/live-mock.ts` không cần đổi (Code Map dự kiến đổi).

## Spec Change Log

## Review Triage Log

Lượt 1 (16/11/2026). BH = blind-hunter, ECH = edge-case-hunter, VG = verification-gap.

| # | Nguồn | Phát hiện | Verdict | Route | Bằng chứng |
|---|-------|-----------|---------|-------|------------|
| 1 | BH | `reviewOrdersOf` luôn chạy thêm câu đếm Vé, trong khi hàng và `openReviewCount` bỏ kết quả | low | reject | Thêm một câu `SUM` nhỏ theo lô id; người dùng không thấy; sửa phải tách hàm hoặc thêm cờ. |
| 2 | BH | `openReviewCount` đọc mọi mục `open` của BTC rồi lọc ở JS | low | reject | Đã ghi deferred (phân trang và đếm theo Sự kiện) trong build này; hàng ngoại lệ thường vài chục mục. |
| 3 | BH | Hàm riêng `openReviewCountOf` trùng tên hàm xuất của `payment` | low | patch | `event-overview.service.ts`: cùng tên mà khác nghĩa (một Sự kiện và cả BTC); đổi tên là sửa thẳng. |
| 4 | BH, ECH | `ReviewItemLogEntry.kind` là `z.enum`, nên nhánh `default: null` của `reviewLogLabel` (loại lạ của 4.4) không bao giờ chạy: loại lạ làm hỏng cả lần parse | low | patch | `reporting.ts` `z.enum(ReviewItemLogKind)`; web parse bằng `ReviewItemDetail`. Lời hứa tương thích về sau là sai; 4.4 sửa contracts cùng web. |
| 5 | BH | Stream `/live` cấp BTC chặn topic theo `review_queue.handle`, stream Tổng quan và card thì không | low | reject | Owner và Admin đều có cả hai quyền; CTV không có `orders.view`. Thống nhất phải thêm guard ở nhiều nơi. |
| 6 | BH | `onConnectedChange` không báo `false` khi `StatusBannerStack` unmount | false | reject | Stack chỉ unmount khi khung rời nhánh thành công (không còn nav và badge); lần mount lại, effect chạy với `connected` `false` nên báo lại `false`. |
| 7 | BH | Focus/online tải badge và hàng hai lần (mặc định TanStack và `onSignal`) | low | reject | Thêm một GET, người dùng không thấy. |
| 8 | BH | Trang hàng chép lại phần ống của Tổng quan (401, toast offline, nhãn cũ) | low | reject | Chỉ là trùng lặp; tách hook dùng chung là refactor. |
| 9 | BH | `ticketEventsByIds` không lọc `orgScope`, trái với doc của service | false | reject | Id Sự kiện chỉ lấy từ Đơn đã lọc `orgScope`; `eventOf` gọi `assertEventOfOrganization` trước. Không đọc được Sự kiện của BTC khác. |
| 10 | BH | "Thời điểm trả" hiện lúc Tickee nhận khi Tingee không gửi `paidAt` | low | patch | `review-queue.tsx` `paidAt ?? receivedAt` dưới nhãn "Thời điểm trả"; API đã trả riêng hai giá trị. |
| 11 | BH | Kiểm "không có tín hiệu" bằng `sleep` cố định; `listener.end()` không kiểm | low | reject | Cùng mẫu với test hiện có (`organization-live.test.ts`); thay bằng sentinel NOTIFY thì thêm máy móc. |
| 12 | BH, VG | Không có test cho nhánh lỗi của `Sheet` (`REVIEW_ITEM_NOT_FOUND`; lỗi khác kèm "Thử lại") | low | patch | VG gap #3: mọi handler chi tiết trong e2e trả 200; grep không thấy chuỗi lỗi nào trong test. |
| 13 | BH, VG | Không có test hàng polling 10 giây khi không có SSE | low | patch | VG gap #1: test polling duy nhất (`review-queue.spec.ts:440`) chỉ kiểm badge. |
| 14 | BH | Chưa test `event_cancelled` và `orphan`/`event_locked` từ đầu tới cuối | low | reject | Loại và lý do chỉ đi thẳng qua; nhãn web là `Record` đủ khóa, typecheck bắt thiếu. |
| 15 | BH, ECH | Doc `useReviewBadgeCount` nói lỗi tải thì không badge, nhưng TanStack giữ `data` cũ | low | patch | `dashboard-shell.tsx`: refetch lỗi giữ số cũ. Giữ hành vi (số gần nhất), sửa doc. |
| 16 | BH | Implementation Notes trống; Tasks ghi `organizer.ts`, Code Map ghi `live-mock.ts` | low | reject | Sửa bằng cách sửa spec của build này (luật triage). |
| 17 | BH | Comment vượt 120 cột ở `event-overview.controller.ts` và `organization-live.test.ts` | low | patch | Prettier không ngắt comment; ngắt dòng tay là sửa thẳng. |
| 18 | BH | Bôi chọn chữ trong bảng (mã Đơn, tên) mở `Sheet` | low | patch | `onClick` trên cả `<tr>`; BTC hay chép mã Đơn để đối chiếu ngân hàng. |
| 19 | VG | Không test nào thấy polling dừng khi stream cấp BTC đã kết nối | low | patch | VG gap #2: bỏ `onConnectedChange` thì test vẫn pass (`toBeGreaterThan`, không chờ 10 giây). |
| 20 | VG | Thứ tự nhật ký chưa được test khi `paidAt` sau `created_at` | low | patch | VG gap #4: bỏ `log.sort` thì hai test nhật ký vẫn pass. |
| 21 | ECH | `Sheet` gặp 401 thì hiện skeleton mãi, không sang đăng nhập | medium | patch | `handledElsewhere` true với `UNAUTHENTICATED`, nhưng chỉ query hàng tự chuyển trang; phiên hết hạn rồi mở mục thì `Sheet` treo. |
| 22 | ECH | Trả focus về hàng đã bị gỡ hay bị ẩn (đổi breakpoint) thì focus rơi về `body` | low | reject | Ở 4.3 hàng không bị gỡ khi `Sheet` mở (chưa có thao tác xử lý); đổi breakpoint lúc mở `Sheet` hiếm. 4.4 gỡ hàng sau khi xử lý thì phải tính. |
| 23 | ECH | `?suKien=a&suKien=b` (mảng) bỏ lọc mà không báo | low | patch | `page.tsx`: `typeof raw === 'string'`; lấy phần tử đầu là sửa thẳng. |
| 24 | ECH | `?suKien=` dài hơn 200 ký tự → `400 VALIDATION_FAILED`, banner lỗi có "Thử lại" không bao giờ thành công | low | patch | `ReviewQueueQuery` `max(200)`; web chỉ map `EVENT_NOT_FOUND` sang trạng thái không tìm thấy. |

## Design Notes

- **Một EventSource.** Badge sống ở shell trên mọi trang. `StatusBannerStack` đã giữ stream `/live` của BTC, nên chỉ thêm invalidation trong `onSignal` thay vì mở stream mới. Trang hàng và card tải lại theo cùng tín hiệu; poll 10 giây là đường dự phòng như `notices`.
- **Topic cấp BTC.** Mục `unmatched` không có Sự kiện, nên topic phải nằm trong `ORGANIZATION_REALTIME_TOPICS`. Stream Tổng quan nhận mọi mục của BTC: tải lại thừa nhưng rẻ, và tránh thêm `eventId` tùy chọn vào `RealtimeSignal`.
- **Không phân trang.** Đây là hàng ngoại lệ, mục `open` của một BTC thường chỉ vài chục, có index `(organization_id, status, created_at)`. Ghi deferred nếu cần sau.
- **Nhật ký.** Chưa có audit cho mục: chưa có thao tác nào và IPN không ghi audit. Phần nhật ký đọc từ dữ liệu sẵn có; 4.4 nối dòng audit vào cùng danh sách.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: không lỗi.
- `pnpm lint:deps` -- expected: không vi phạm.
- `pnpm --filter @tickee/api test` -- expected: pass, gồm `isolation.test.ts`.
- `pnpm --filter @tickee/contracts test`, `pnpm --filter @tickee/web test` -- expected: pass.
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 pnpm --filter @tickee/web build` rồi `pnpm --filter @tickee/web exec playwright test e2e/review-queue.spec.ts e2e/dashboard-shell.spec.ts e2e/status-banners.spec.ts e2e/event-overview.spec.ts` -- expected: pass.
