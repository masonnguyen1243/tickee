---
title: 'Story 6.2: Số liệu Vé theo Hạng vé trên Tổng quan'
type: 'feature'
created: '2026-11-26'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '1a992307e684fb11e316afe37f503dd3d1cbbea3'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Tổng quan Sự kiện mới có `stat-card` doanh thu và `needs-action-card`. BTC chưa thấy mỗi Hạng vé đã bán, đang giữ và còn bao nhiêu, cũng chưa thấy số check-in (FR-31, UX-DR35). Doanh thu đang cộng `total_amount`, nên Đơn duyệt tay lệch tiền (300.000đ, nhận 250.000đ) tính 300.000đ, lệch danh sách hoàn tiền AD-28 (E4-5 C1, Mason chốt `paid_amount` 26/11/2026). Mục hoãn của 5.7 giao cho 6.2: Vé mới phát chỉ phát `event_orders_changed`, nên khi SSE check-in đang nối, mẫu số N ở tab Check-in giữ số cũ tới lần check-in kế tiếp.

**Approach:**
- **API:** `EventOverview` thêm `checkin` và `ticketTypes`. `reporting` ghép `event.ticketTypesOf` + `ordering.inventoryOf` + `ticketing.checkinCountsByTicketType`. `ordering.eventRevenueOf` đổi sang `SUM(paid_amount)`.
- **SSE:** stream Tổng quan lọc thêm `event_checkins_changed` của Sự kiện. Stream check-in lọc thêm `event_orders_changed` của Sự kiện cho Owner/Admin, không cho CTV.
- **Web:** hàng số liệu đủ ba thẻ (doanh thu, check-in có thanh tiến độ, Cần xử lý), thêm khối "Vé theo Hạng vé" giữa hàng số liệu và "Đơn gần đây".

## Boundaries & Constraints

**Always:**
- **Contract `EventOverview`** (`packages/contracts/src/reporting.ts`) thêm:
  - `checkin: { checkedInCount, validTicketCount }`, số nguyên không âm, cùng tên trường với `CheckinEvent`;
  - `ticketTypes: [{ name, price, capacity, sold, held, remaining }]`, số nguyên không âm, theo thứ tự của `ticketTypesOf` (tạo trước đứng trước). Không có id nội bộ. `remaining = max(0, capacity − sold − held)`, tính ở API.
- **Doanh thu:** `eventRevenueOf` cộng `paid_amount` của Đơn `paid`; `paidOrders` vẫn đếm mọi Đơn `paid` (kể cả 0đ). Sửa chú thích ở `event-overview-read.ts` và `reporting.ts` cho khớp.
- **Hạng vé:** Hạng vé không có dòng `ticket_type_inventory` thì bỏ qua, như `listTicketTypes` (`flows/ticket-types.flow.ts:129-141`). Đọc không khóa.
- **Check-in:** tổng cộng từ `checkinCountsByTicketType` (chỉ Vé `valid`; Vé hủy hay bị vô hiệu không tính, kể cả đã check-in), cùng số với tab Check-in.
- **Số câu truy vấn cố định** cho mỗi lần `GET …/overview`, không truy vấn theo từng Hạng vé.
- **Stream Tổng quan** (`GET …/overview/live`) đẩy thêm `event_checkins_changed` có `eventId` và `organizationId` khớp. Bộ lọc cũ giữ nguyên.
- **Stream check-in** (`GET /v1/checkin/events/:eventId/live`): khi `ctx.role` khác `null` (Owner/Admin), đẩy thêm `event_orders_changed` có `eventId` và `organizationId` khớp. CTV (`role` null) vẫn chỉ nhận `event_checkins_changed` (AD-17).
- **Web, hàng số liệu** (`event-overview.tsx`):
  - thứ tự: `StatCard` "Doanh thu" · `StatCard` "Check-in" · `NeedsActionCard`. Dưới `md` một cột, từ `lg` ba cột;
  - thẻ check-in dùng lại khuôn của `checkin-progress.tsx:103-121`: giá trị `progressLabel`, `ProgressBar tone="stage"` với `progressValueText`, nhãn từ `lib/checkin/progress-view.ts`. Caption "Cập nhật liên tục" khi SSE đang nối. Khi `stale` thì caption rỗng, vì dòng "Cập nhật lúc…" ở đầu đã báo;
  - skeleton theo bố cục mới.
- **Web, khối "Vé theo Hạng vé"** (`card` sáng, không stage):
  - tiêu đề "Vé theo Hạng vé", bên phải "`<tổng sold>`/`<tổng capacity>` Vé đã bán" (tabular);
  - từ `md`: `Table` phẳng gồm Hạng vé (tên, giá dạng `priceLabel` của `lib/event/selection.ts`) · Đã bán · Đang giữ chỗ · Còn lại (dạng "2 / 32"). Số tabular, căn phải;
  - dưới `md`: danh sách, mỗi Hạng vé hai dòng: tên · giá, rồi "Đã bán 30 · Đang giữ 0 · Còn 2 / 32";
  - `remaining` 0 thì thêm chữ "Hết vé" (không chỉ dựa vào màu);
  - không có Hạng vé nào thì không hiện khối;
  - 320px không cuộn ngang.
- Tổng quan, tab Đơn và `Sheet` chi tiết dùng chung stream, nên cả ba tải lại khi có check-in. `Sheet` vì thế hiện giờ check-in mới mà không cần chờ.

**Never:**
- Không migration, không thêm index.
- Không cột doanh thu theo Hạng vé (mockup `key-dashboard-event.html` có): `paid_amount` là của cả Đơn, không chia được theo Hạng vé khi duyệt tay lệch tiền. Đây là lệch có chủ đích so với mockup; lần đối chiếu spec sau retro Epic 6 gom về UX.
- Không hiện check-in theo từng Hạng vé trên Tổng quan (đã có ở tab Check-in).
- Không sửa `apps/web/app/(checkin)/events/[eventId]/checkin-event-screen.tsx` (`epic-5-retro-e5-5-no-ky-thuat`: tách trước story đầu tiên chạm lại).
- Phần CTV của mục hoãn 5.7 (đỉnh Màn quét của CTV giữ N cũ khi có Vé mới) để lại cho `epic-5-retro-e5-2-realtime-o-cong`: CTV không được nhận topic Đơn (AD-17), và E5-2 đã ghi giải pháp poll `CheckinEvent` 60 giây "chữa luôn N không theo Vé mới".
- Không đổi luật doanh thu cho Sự kiện đã hủy (7.1) hay Vé `voided` (7.5).
- Không sửa `contracts/organizer.ts`, `organizer/payment-service.ts`, `can-xu-ly/review-queue.tsx` (E4-10).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Duyệt tay lệch tiền | Đơn 300.000đ, nhận 250.000đ, duyệt tay phát Vé | `revenue.amount` 250.000, `paidOrders` tính Đơn này | N/A |
| Đơn 0đ | Một Đơn miễn phí `paid` | `paidOrders` +1, `amount` không đổi | N/A |
| Đang giữ chỗ | Hạng vé sức chứa 10, 3 bán, 2 Đơn `pending` giữ 4 | `sold` 3, `held` 4, `remaining` 3 | N/A |
| Hết vé | `sold + held = capacity` | `remaining` 0; web hiện "Hết vé" | N/A |
| Check-in | 5 Vé `valid`, 2 đã check-in, 1 Vé `cancelled` đã check-in | `checkin` = 2/5 | N/A |
| Check-in ở Sự kiện đang mở Tổng quan | Quét xanh một Vé | Stream Tổng quan của Sự kiện nhận `event_checkins_changed`; Sự kiện khác, BTC khác không nhận | N/A |
| Vé mới phát khi tab Check-in đang mở | Đơn của Sự kiện chuyển `paid` | Stream check-in của Owner/Admin nhận `event_orders_changed`; stream của CTV không nhận | N/A |

</frozen-after-approval>

## Code Map

**API**
- `apps/api/src/modules/ordering/event-overview-read.ts:18-35` `eventRevenueOf`: đổi `total_amount` → `paid_amount` (cột `schema.ts:131`; CHECK `:176` bảo đảm Đơn `paid` có giá trị).
- `apps/api/src/modules/ordering/inventory.service.ts:202-209` `inventoryOf(db, ids)` (đã xuất ở `ordering/index.ts`). Dùng lại, không viết read model mới.
- `apps/api/src/modules/event/ticket-type.service.ts:62-72` `ticketTypesOf(db, ctx, eventId)` (lọc `orgScope` + `event_id`, có `name`, `price`). Mẫu ghép: `flows/ticket-types.flow.ts:129-141`. `reporting` được gọi `event`, không gọi `flows/`.
- `apps/api/src/modules/ticketing/check-in.ts:171-201` `checkinCountsByTicketType`; cách cộng tổng ở `checkin/checkin-event.controller.ts:52-79`.
- `apps/api/src/modules/reporting/event-overview.service.ts:25-52` `overview`: thêm ba lời gọi vào `Promise.all`, sửa chú thích lớp `:10-15`.
- `apps/api/src/modules/reporting/event-overview.controller.ts:21-47`: bộ lọc SSE và chú thích.
- `apps/api/src/modules/checkin/checkin-event.controller.ts:31-44`: bộ lọc stream check-in. `EventAccessContext.role` null với CTV (`platform/access/org-scope.ts:15-29`).
- Test:
  - `apps/api/test/reporting/event-overview.test.ts`: mẫu dựng dữ liệu, helper `live` `:96`, các describe stream `:314`, `:379`;
  - `apps/api/test/payment/review-actions.test.ts:357-415` (describe "Duyệt tay phát Vé", test đầu `:358`): thêm assert doanh thu. Helper `overviewOf` đang nằm trong describe ở `:947`, phải đưa lên cấp file;
  - `apps/api/test/checkin/checkin-live.test.ts:233-262`: đang khẳng định tạo Đơn không lọt vào mọi stream check-in. Sửa theo luật mới.

**Contracts**
- `packages/contracts/src/reporting.ts:205-232`: `EventOverview`, chú thích doanh thu và chú thích `eventOverviewLiveApiPath`.
- `packages/contracts/src/checkin.ts:140-145`: chú thích `checkinEventLiveApiPath` ghi "chỉ nhận `event_checkins_changed`", phải sửa theo luật mới.

**Web** (gốc `apps/web/app/(dashboard)/btc/[orgId]/su-kien/[eventId]/`)
- `event-overview.tsx`: hàng số liệu `:275-282`, skeleton `:189-200`, `RecentOrdersBlock`, `NeedsActionCard` `:163-187`.
- `checkin-progress.tsx:103-121`: khuôn `StatCard` + `ProgressBar`. Chép khuôn, không import component.
- `apps/web/components/tickee/stat-card.tsx` (`meter`, `caption`), `progress-bar.tsx`.
- `apps/web/lib/checkin/progress-view.ts`: `progressLabel`, `progressValueText`, `CHECKIN_PROGRESS_LABEL`, `CHECKIN_PROGRESS_TOTAL`, `CHECKIN_PROGRESS_LIVE`.
- `apps/web/lib/reporting/overview.ts`: thêm helper cho khối Hạng vé (tóm tắt "66/72 Vé đã bán", dòng di động). `apps/web/lib/event/selection.ts:30` `priceLabel`.
- Test:
  - `apps/web/e2e/event-overview.spec.ts`: mock `OVERVIEW` `:92` và các `state.overview` `:303-399`; locator `[data-slot="stat-card"]` `:148-150`, `:183-186`, `:212-216` sẽ vỡ ở strict mode khi có hai thẻ, phải lọc theo nhãn;
  - `apps/web/e2e/organizer-mock.ts:68` `emptyOverview`;
  - `apps/web/test/event-overview.test.ts:105-117` (`EventOverview.safeParse`).

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/reporting.ts` -- thêm `checkin`, `ticketTypes` (`EventOverviewTicketType`) vào `EventOverview`; sửa chú thích doanh thu và stream -- hợp đồng mới cho web và test.
- [x] `apps/api/src/modules/ordering/event-overview-read.ts` -- `SUM(paid_amount)` và chú thích -- AC doanh thu (AD-33).
- [x] `apps/api/src/modules/reporting/event-overview.service.ts` -- ghép `ticketTypes` và `checkin` -- AC bảng Hạng vé và thẻ check-in.
- [x] `apps/api/src/modules/reporting/event-overview.controller.ts` -- lọc thêm `event_checkins_changed` của Sự kiện -- AC realtime.
- [x] `apps/api/src/modules/checkin/checkin-event.controller.ts`, `packages/contracts/src/checkin.ts` -- Owner/Admin nhận thêm `event_orders_changed` của Sự kiện; sửa chú thích hai chỗ -- mục hoãn 5.7 "Vé mới phát (Đơn `paid`, Đơn 0đ) chỉ phát `event_orders_changed`…" (`deferred-work.md:1274-1276`), phần Owner/Admin.
- [x] `apps/api/test/reporting/event-overview.test.ts` -- các dòng Đơn 0đ, Đang giữ chỗ, Hết vé, Check-in, Check-in ở Sự kiện đang mở của I/O Matrix; Hạng vé không có dòng tồn kho bị bỏ; response không có id -- khóa hành vi API.
- [x] `apps/api/test/payment/review-actions.test.ts` -- đưa `overviewOf` lên cấp file; test duyệt tay lệch tiền assert `revenue.amount` 250.000 -- AC 6.2.
- [x] `apps/api/test/checkin/checkin-live.test.ts` -- tạo Đơn: stream Owner/Admin của Sự kiện nhận `event_orders_changed`; CTV, Sự kiện khác, BTC khác không nhận -- luật mới.
- [x] `apps/web/lib/reporting/overview.ts` (+ `apps/web/test/event-overview.test.ts`) -- helper khối Hạng vé; sửa `safeParse` theo shape mới -- dùng chung, có test.
- [x] `…/[eventId]/event-overview.tsx` -- thẻ check-in, khối "Vé theo Hạng vé", bố cục ba thẻ, skeleton -- UX-DR35.
- [x] `apps/web/e2e/event-overview.spec.ts`, `apps/web/e2e/organizer-mock.ts` -- mock shape mới; locator theo nhãn; bảng ở 1024px, danh sách ở 375px, "Hết vé"; thẻ check-in 41/66 kèm thanh tiến độ; thứ tự ba thẻ; tín hiệu stream làm số check-in đổi không reload -- khóa UI.

**Acceptance Criteria:**
- Given Đơn 300.000đ được duyệt tay khi nhận 250.000đ, when gọi `GET …/overview`, then `revenue.amount` là 250.000.
- Given Tổng quan đang mở, when một Vé của Sự kiện được check-in, then thẻ check-in đổi số mà không tải lại trang.
- Given tab Check-in đang mở bằng tài khoản Owner, when một Đơn mới của Sự kiện chuyển `paid`, then mẫu số N tăng mà không cần lần check-in nào.
- Given Tổng quan ở 320px, when trang tải, then ba thẻ xếp một cột và khối Hạng vé là danh sách, không cuộn ngang.

## Implementation Notes

- **Dòng phụ thẻ check-in:** hiện "Cập nhật liên tục" chỉ khi SSE đang nối và số liệu không cũ (`checkinCardCaption`); đang polling hoặc `stale` thì không có dòng phụ.
- **Bố cục `md` (768–1023px):** hai cột; `needs-action-card` trải hai cột (`md:col-span-2`); từ `lg` ba cột một hàng.
- **Khóa React của hàng Hạng vé** là chỉ số mảng, vì api cố ý không trả id; thứ tự Hạng vé cố định (tạo trước đứng trước).
- **Ngoài Code Map:** `packages/contracts/test/event-overview.test.ts` khẳng định shape cũ nên phải sửa, thêm kiểm `checkin`, `ticketTypes`.
- **Sau review:** stream check-in cho tín hiệu Đơn theo quyền `orders.view` (`roleHasPermission`), không theo `role !== null`; thêm test đếm số câu truy vấn của `GET …/overview` (1 Hạng vé và 4 Hạng vé bằng nhau); test stream `event_checkins_changed` chỉ xét tin sau mốc trước khi quét.
- **Kiểm chứng (26/11/2026):** `pnpm typecheck`, `pnpm lint:deps` sạch; `pnpm test` xanh (contracts 378, web 493, api 1809); `pnpm test:e2e` 1386 xanh trên `ios-webkit` và `android-chromium`. Ảnh chụp Tổng quan ở 320, 768, 1024, 1280px bằng mock e2e lúc làm.
- Kiểm thủ công (26/11/2026): Trên dev stack: mở Tổng quan của một Sự kiện có Đơn và check-in ở 320px và 1280px. Quét một Vé ở máy khác thì thẻ check-in đổi số; thêm một Đơn thì bảng Hạng vé và tab Check-in đổi số — đạt. Claude kiểm trên stack local `e2e:stack` (DB `tickee_e2e`, Tingee fake, Mailpit) + `next start`, đăng nhập BTC demo bằng OTP trong trình duyệt của app: 1280px và 1024px ba thẻ một hàng, 320px một cột, khối Hạng vé dạng danh sách, không cuộn ngang; quét Vé qua API (máy khác) → thẻ check-in 0/3 → 1/3 không tải lại trang; Đơn 0đ mới → bảng 3/15 → 5/15 Vé đã bán, thẻ check-in 1/3 → 1/5; trên tab Check-in, Đơn mới → 1/5 → 1/6 không cần check-in.

## Spec Change Log

## Review Triage Log

| # | Lớp | Phát hiện | Verdict | Route | Bằng chứng |
|---|-----|-----------|---------|-------|------------|
| 1 | VG | Không test nào khóa số câu truy vấn cố định của `GET …/overview` khi số Hạng vé tăng | — (gap) | patch | Theo bằng chứng của lớp: các test Hạng vé chỉ so giá trị; đổi `inventoryOf` thành gọi theo từng Hạng vé vẫn xanh. Mẫu đếm truy vấn có ở `event-sale-status.test.ts:225-243`. |
| 2 | VG, BH | Chú thích cũ: `orders-tab.tsx:326`, `checkin-progress.tsx:63-68`, `event-tabs.tsx:36-37`, `lib/reporting/api.ts:46,50`, `realtime.ts:19` | low | patch | Đã đọc: còn ghi stream Tổng quan chỉ có `event_orders_changed`/`org_review_items_changed`, tab Check-in chỉ tải lại theo `event_checkins_changed`, Tổng quan chỉ có doanh thu + Đơn gần đây. Sửa chữ là sửa thẳng. |
| 3 | BH, ECH | Stream check-in cho tín hiệu Đơn theo `ctx.role !== null`, không theo quyền `orders.view` | low | patch | `checkin-event.controller.ts:39`. Hôm nay Owner/Admin đều có `orders.view` (`organizer.ts:45`), nhưng vai trò mới thiếu quyền này sẽ nhận topic Đơn, trái AD-17 và lệch stream Tổng quan. Sửa thẳng bằng `roleHasPermission` (`organizer.ts:53`). |
| 4 | BH | `deferred-work.md` chưa đánh dấu mục 5.7; mục 9.2 đếm thiếu tải Tổng quan theo check-in | false / low | reject | Dòng "Đã xử lý" do bước kết sổ ở On Complete ghi. Tải thêm: Tổng quan chỉ mở trên vài máy Owner/Admin, gom 1 giây; đã chấp nhận ở Design Notes. |
| 5 | BH | Duyệt tay thiếu tiền: "Đơn gần đây" hiện 300.000đ Đã thanh toán, doanh thu chỉ +250.000đ | low | reject | Đúng định nghĩa đã chốt (E4-5 C1). Chỉ gặp khi duyệt tay lệch tiền (hiếm); `Sheet` của tab Đơn đã hiện "đã nhận". Đổi câu chữ cần quyết định UX. |
| 6 | BH | Không test trả thừa tiền | false | reject | `eventRevenueOf` là một `SUM(paid_amount)` không nhánh theo thiếu/thừa; test 250.000đ đã khóa cột. Trả thừa cộng số đã nhận đúng định nghĩa "tiền đã nhận". |
| 7 | BH | AC 3 chỉ kiểm ở API; không e2e cho tab Check-in hay `Sheet` nhận tín hiệu mới | false | reject | Web không đổi ở hai đường này: `useLiveResource` tải lại với mọi tin (`signalReload`, `use-live-resource.ts:100`). Phần mới là bộ lọc của api, đã có test stream và REST N. |
| 8 | BH | Test stream check-in chỉ dùng Đơn 0đ; chú thích nói quá về nguồn tải lại | low | reject | Bộ lọc theo topic, IPN và duyệt tay phát cùng topic (đã test ở `event-overview.test.ts`, `review-actions.test.ts`). Tải lại thừa do Đơn chờ/hết hạn đã chấp nhận ở Design Notes; chú thích nêu lý do, không nói "chỉ". |
| 9 | BH | Thiếu test bố cục dải `md`; giá trị dài tràn thẻ ở `lg` | low | reject | Dải 768px đã kiểm bằng ảnh chụp lúc làm. Doanh thu ≥ 1 tỷ đồng cho một Sự kiện CLB hiếm; sửa phải đổi `StatCard` dùng chung. |
| 10 | BH | Tổng check-in cộng hai cách (mọi nhóm vs nhóm khớp `ticketTypesOf`) | false | reject | FK `tickets.ticket_type_id` và luật chỉ xóa Hạng vé khi `sold+held=0` (`inventory.service.ts:82-93`) làm hai tập trùng nhau; không có đường lệch. |
| 11 | BH | "Hết vé" cả khi suất chỉ đang giữ | false | reject | Đúng luật đóng băng (`remaining` 0 → "Hết vé"), khớp trang công khai (`remainingIn` trừ `held`). |
| 12 | BH, ECH | Web mới đọc response api cũ thiếu `checkin`/`ticketTypes` → lỗi cả Tổng quan | low | reject | Chưa có môi trường deploy (9.1); tiền lệ `openReviewCount` bắt buộc ở 4.3. Thứ tự deploy thuộc runbook 9.1. |
| 13 | BH | Thẻ check-in và khối Hạng vé không link sang tab Check-in | low | reject | UX và mockup không có link này; spec không đòi. |
| 14 | BH | Skeleton luôn giữ chỗ khối Hạng vé | low | reject | Sự kiện đã rời nháp mà không có Hạng vé hiếm; bỏ chỗ giữ làm nhảy bố cục ở ca thường gặp. |
| 15 | BH | Bảng Hạng vé không có tên truy cập | low | reject | `section` bao quanh đã `aria-labelledby` tiêu đề; cùng cách với bảng "Đơn gần đây" (`event-overview.tsx:79`). |
| 16 | ECH | Sửa/thêm/xóa Hạng vé không phát tín hiệu, khối Hạng vé của người xem khác giữ số cũ | low | reject | Đã đọc `flows/ticket-types.flow.ts`: không `notify`. Người sửa quay lại tab Tổng quan thì component mount lại, mở SSE và tải lại; chỉ người xem đồng thời khác thấy cũ tới tín hiệu kế tiếp. Sửa phải thêm điểm phát ở các flow. |
| 17 | ECH | Test stream `event_checkins_changed` có thể chập chờn: tín hiệu tạo Đơn tới hub sau 200 ms thì `toEqual([CHECKINS_CHANGED])` hỏng | low | patch | `event-overview.test.ts` (describe Story 6.2 stream): chỉ chờ listener của test rồi `sleep(200)` trước khi mở stream; hub nhận NOTIFY trễ hơn thì stream X nhận thêm `event_orders_changed`. Sửa trong test: chỉ xét tin sau mốc trước khi quét. |

## Design Notes

**Vì sao ghép ở `reporting` bằng read model có sẵn:** `inventoryOf` và `ticketTypesOf` đã xuất ở `index.ts` và là hàm query đúng AD-33. `ticketTypesOf` lọc `orgScope` + `event_id`, còn `inventoryOf` lọc theo id lấy từ câu đó, như `ticketCountsOf` của 3.11. Viết read model tồn kho mới theo `event_id` chỉ lặp lại hai hàm này.

**Stream check-in lọc theo vai trò:** AD-17 cho Owner/Admin nhận `event_orders_changed`, và tab Check-in chỉ mở bằng Owner/Admin. Tín hiệu Đơn tới thì tab tải lại `GET /v1/checkin/events/:eventId` một lần nữa, gom trong 1 giây. Ngày diễn ra Sự kiện ít Đơn mới, nên tải thêm không đáng kể.

**Tab Đơn tải lại theo check-in:** dùng chung stream Tổng quan là quyết định của 6.1. Mỗi check-in làm danh sách Đơn đang mở tải lại, gom trong 1 giây. Đổi lại, `Sheet` chi tiết hiện giờ check-in mới ngay. Tách stream riêng cho tab Đơn không đáng so với cái giá đó.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: 0 lỗi
- `pnpm test` -- expected: mọi test xanh, gồm `event-overview.test.ts`, `review-actions.test.ts`, `checkin-live.test.ts`
- `pnpm lint:deps` -- expected: 0 vi phạm (`reporting` → `event`, `ordering`, `ticketing`)
- `pnpm test:e2e` -- expected: `event-overview.spec.ts`, `event-orders.spec.ts` xanh

**Manual checks (if no CLI):**
- Trên dev stack: mở Tổng quan của một Sự kiện có Đơn và check-in ở 320px và 1280px. Quét một Vé ở máy khác thì thẻ check-in đổi số; thêm một Đơn thì bảng Hạng vé và tab Check-in đổi số.
