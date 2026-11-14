---
title: 'Story 4.2-c: Nhãn trạng thái bán trên dashboard lấy từ sellability (C5)'
type: 'feature'
created: '2026-11-14'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: '817218872ec0d9e4e41533a406c7065baeb33e52'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Badge trạng thái Sự kiện trên dashboard (thẻ Sự kiện ở trang chủ BTC, badge thẻ "Thông tin" của tab Tổng quan) tự tính từ `status` và `effectiveEndAt` bằng đồng hồ máy khách, nên lệch với `ordering.sellability`: BTC bị "Tạm ngừng bán" (4.2-a) hay thiếu điều kiện bán Vé có phí vẫn thấy "Đang mở bán" (retro Epic 2 C5).

**Approach:** API trả lý do bán cấp Sự kiện (`sellability`, đồng hồ máy chủ) cho mọi Sự kiện đã mở bán của BTC; web lấy nhãn từ đó, giữ cách tính cũ làm dự phòng khi chưa có hoặc lỗi.

## Boundaries & Constraints

**Always:**
- `GET /v1/orgs/:orgId/event-sale-status` (mô-đun `ordering`, quyền `EVENTS_MANAGE` như danh sách Sự kiện; không đặt dưới `…/events/…` vì đụng `:eventId`) → `{ events: [{ eventId, reason, partial }] }` cho mọi Sự kiện không còn nháp của BTC (`orgScope`). `reason` = `eventReason` của `saleStatusOf` (một luật với trang công khai, TX1, chốt link; AD-21). `partial` = `reason` là `paused` mà còn ít nhất một Hạng vé `on_sale` (**Mason chốt lại 14/11 sau review:** khớp trang công khai `saleBanner`; Hạng vé còn lại hết vé, chưa mở hay đã đóng thì `partial: false`).
- Đọc theo lô: điều kiện bán có phí và khóa BTC đọc một lần cho cả BTC; Hạng vé và tồn kho đọc theo danh sách Sự kiện, không truy vấn lặp theo từng Sự kiện. Đồng hồ DB.
- Nhãn web (`status-badge`): `draft` → "Nháp" (neutral) không cần API; `cancelled` → "Đã hủy" (danger); `locked` → "Bị khóa" (danger); `ended` → "Đã kết thúc" (neutral); `hidden` → "Ẩn" (warning); `paused` → **quyết định của Mason (14/11):** "Tạm ngừng bán" (warning) khi `partial: false`, "Tạm ngừng bán một phần" (warning) khi `partial: true` (khớp câu trang công khai "Một số Hạng vé đang tạm ngừng bán."); `null` → "Đang mở bán" (success).
- Dự phòng: chưa có dữ liệu, lỗi, hay Sự kiện không có trong danh sách → nhãn tính như hiện nay (`eventBadge`); không skeleton, không banner lỗi.
- Hai nơi dùng chung một query (`organization-home.tsx`, `su-kien/[eventId]/event-tabs.tsx`); lưu Sự kiện, Ẩn/Hiện lại/Kết thúc, mở bán và `org_status_changed` (`onSignal` của dải banner) làm mới query này.
- Route mới qua bộ test cách ly.

**Never:**
- Không đổi `sellability`, `EventSummary`/`EventDetail`, trang công khai hay luật cờ của 4.2-a/4.2-b.
- Không bỏ `isEventEnded` (Cài đặt Sự kiện vẫn dùng cho nút Kết thúc).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| BTC bị ngắt | Sự kiện chỉ có Hạng vé có phí, cờ `suspended` | `reason: paused, partial: false`; "Tạm ngừng bán" | N/A |
| Ngắt một phần | Sự kiện có Hạng vé 0đ và có phí, cờ `suspended` | `reason: paused, partial: true`; "Tạm ngừng bán một phần" | N/A |
| Ngắt, Hạng vé 0đ hết vé | Như trên nhưng Hạng vé 0đ `sold_out` (hoặc chưa mở / đã đóng) | `reason: paused, partial: false`; "Tạm ngừng bán" | N/A |
| Đang bán | Sự kiện mở bán bình thường | `reason: null`; "Đang mở bán" | N/A |
| Đã kết thúc theo máy chủ | `effective_end_at` đã qua theo DB, đồng hồ máy khách chậm | "Đã kết thúc" | N/A |
| Ẩn / hủy | `hidden` / `cancelled` | "Ẩn" / "Đã hủy" | N/A |
| Nháp | `draft` | Không có trong danh sách; "Nháp" | N/A |
| API lỗi | 500 / mạng | Nhãn tính như cũ | Không báo lỗi |
| Cách ly | Owner BTC A gọi trên BTC B | 403 `NOT_A_MEMBER` | Admin của BTC → 200 |

</frozen-after-approval>

## Code Map

Gốc `apps/api/src` trừ khi ghi khác. Web: `apps/web`.

- `modules/ordering/sellability.ts` -- `saleStatusOf` (hàm thuần :79), `saleFactsOf` (:133, đọc theo một Sự kiện), `paidOkOf` (:123), `blockingReason`. Thêm hàm đọc theo lô cho mọi Sự kiện của BTC, gọi `saleStatusOf` cho từng Sự kiện.
- `modules/event/` -- `ticketTypesOf`, `organizationLocked`, read model Sự kiện theo BTC (xuất qua `event/index.ts`; `ordering → event` hợp lệ). `modules/ordering/inventory.service.ts` -- `inventoryOf(db, ticketTypeIds)` nhận nhiều id.
- `modules/event/events.controller.ts:22-45` -- `@Controller('orgs/:orgId/events')` có `@Get(':eventId')` nên route mới đặt ngoài tiền tố `events/`; quyền `EVENTS_MANAGE`.
- `packages/contracts/src/sellability.ts:50-64` -- `EventSaleReason`, `eventSaleReasonSchema`; thêm schema danh sách và đường API.
- `apps/api/test/organizer/isolation.test.ts` -- danh sách route có guard; đếm route `/v1/orgs/:orgId/events` (không đổi vì route mới ngoài tiền tố).
- Web: `app/(dashboard)/btc/[orgId]/su-kien/event-status.ts` (`eventBadge` :30, `EVENT_STATUS_BADGE` :8, `isEventEnded` :25), `organization-home.tsx:95,110`, `su-kien/[eventId]/event-tabs.tsx:51,60`, `lib/event/api.ts` (`eventsQueryKey` :24, mẫu fetcher), `components/tickee/status-banner-stack.tsx` (`onSignal` của 4.2-b), các mutation Ẩn/Hiện lại/Kết thúc (`su-kien/[eventId]/event-settings.tsx` `useEventSaved`) và mở bán (publish panel) để làm mới query.
- Test: `apps/api/test/ordering/sellability.test.ts` (mẫu dựng Sự kiện), `apps/web/test/event-status.test.ts`, e2e `apps/web/e2e/` có thẻ Sự kiện và tab Tổng quan (`event-draft.spec.ts`, `event-overview.spec.ts`, `publish.spec.ts`) — mock thêm `GET /orgs/:id/event-sale-status`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/sellability.ts` -- schema `EventSaleStatusList` và đường API.
- [x] `apps/api/src/modules/ordering/sellability.ts` (+ controller mới trong `ordering`, đăng ký module) -- đọc theo lô, route `GET /v1/orgs/:orgId/event-sale-status`.
- [x] `apps/api/test/` -- mọi dòng I/O Matrix phía API (gồm cờ `suspended` của 4.2-a, đồng hồ DB), cách ly, số truy vấn không tăng theo số Sự kiện (hoặc kiểm bằng đọc theo lô).
- [x] `apps/web/lib/event/api.ts`, `su-kien/event-status.ts` -- fetcher, query key, hàm nhãn từ `reason`/`partial` có dự phòng.
- [x] `organization-home.tsx`, `event-tabs.tsx` -- dùng nhãn mới; làm mới query sau lưu/Ẩn/Hiện lại/Kết thúc/mở bán và khi có `org_status_changed`.
- [x] Test web: unit hàm nhãn (mọi `reason`, `partial`, dự phòng); e2e thẻ Sự kiện và badge Tổng quan với "Tạm ngừng bán" và API lỗi.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- đóng mục 4.2-c (và mục C5 của spec 3.11).

**Acceptance Criteria:**
- Given BTC bị ngắt dịch vụ thanh toán đang mở dashboard, when `org_status_changed` tới, then badge của Sự kiện có phí đổi sang nhãn Tạm ngừng bán mà không tải lại trang.
- Given mọi test e2e hiện có của dashboard, then vẫn pass với mock mới.
- Given `pnpm lint:deps`, then không vi phạm module graph.

## Implementation Notes

- API: `event` thêm hai read model theo lô (`saleEventsOfOrganization`, `ticketTypesOfEvents`); `ordering.organizationSaleStatuses(db, scope, now)` đọc Sự kiện, Hạng vé, tồn kho mỗi thứ một truy vấn, khóa BTC và điều kiện bán Vé có phí một lần (chỉ khi BTC có Hạng vé > 0đ), rồi gọi `saleStatusOf` cho từng Sự kiện. `EventSaleStatusController` (`ordering`) chạy trong transaction REPEATABLE READ chỉ đọc, `now` = `dbNow(tx)`.
- Test số truy vấn đếm `pg.Client.prototype.query` của một request với 1 rồi 4 Sự kiện (bằng nhau); test đồng hồ DB giả `Date` của app lệch ±1 giờ.
- Web: `useEventSaleStatus` (`lib/event/sale-status.ts`) giữ kết quả gần nhất của api khi lần tải lại lỗi (không quay về nhãn máy khách giữa chừng); lần tải đầu lỗi → nhãn dự phòng. Thẻ "Thông tin" của Sự kiện nháp không gọi api. `refreshEventSaleStatus` dùng chung cho mọi điểm làm mới; sau thao tác của chính người dùng trên một Sự kiện (lưu, Ẩn/Hiện lại/Kết thúc, mở bán) bỏ dòng cũ của Sự kiện đó khỏi cache trước để không hiện nhãn cũ trong lúc tải lại. Thêm làm mới sau khi đổi Hạng vé (giá có phí đổi `paused`), ngoài danh sách của Boundaries.
- e2e: mock mặc định `GET /orgs/:id/event-sale-status` → `{ events: [] }`; ca mới ở `status-banners.spec.ts` (thẻ Sự kiện: mọi lý do, lỗi 500/mất mạng, `org_status_changed`, polling) và `event-overview.spec.ts` (badge "Thông tin").

## Spec Change Log

- **Lượt review 1 (14/11/2026), intent_gap #1 → Mason chốt lại phần đã khóa.** Phát hiện: `partial` định nghĩa "còn Hạng vé không `paused`" mâu thuẫn với "khớp câu trang công khai" (trang công khai dùng `on_sale`). Sửa: `partial` khi còn ít nhất một Hạng vé `on_sale`; thêm dòng I/O Matrix Hạng vé 0đ hết vé → `partial: false`. Trạng thái tránh được: dashboard ghi "một phần" trong khi trang công khai báo tạm ngừng cả Sự kiện. Mason chọn giữ code và vá có mục tiêu. KEEP: đọc theo lô, endpoint và controller, nhãn và dự phòng, các điểm làm mới, test hiện có.

## Review Triage Log

Lượt 1 (14/11/2026). BH = blind-hunter, ECH = edge-case-hunter, VG = verification-gap.

| # | Nguồn | Phát hiện | Verdict | Route | Bằng chứng |
|---|-------|-----------|---------|-------|------------|
| 1 | BH, ECH, VG (other) | `partial` tính "còn Hạng vé không `paused`" trong khi trang công khai chỉ báo "một phần" khi còn Hạng vé `on_sale`: Hạng vé 0đ hết vé/chưa mở/đã đóng thì dashboard ghi "Tạm ngừng bán một phần", trang công khai ghi tạm ngừng cả Sự kiện | low | intent_gap | Phần đã khóa vừa định nghĩa `partial` theo "không `paused`" vừa nói "khớp câu trang công khai" (`public-sale.ts:34` dùng `ON_SALE`); hai cách hiểu. |
| 2 | BH, ECH | Polling: chỉ đổi mã notice dịch vụ thanh toán mới làm mới nhãn; `CLOSED_BETA_*`, `PAYOUT_ACCOUNT_NOT_LINKED` cũng làm `paidOk` sai | low | patch | `status-banner-stack.tsx:90-101`; tính khóa làm mới từ mọi mã ảnh hưởng bán Vé có phí. |
| 3 | BH | Đổi tài khoản nhận tiền (hủy liên kết, đặt mặc định, đổi key) và "Kiểm tra lại" không làm mới nhãn | low | patch | `tai-khoan-nhan-tien/shared.tsx` `refreshOverview`/`applyOverview`, `payment-service-block.tsx`; gọi `refreshEventSaleStatus`. |
| 4 | VG (gap), BH | Các điểm làm mới sau thao tác của BTC (Ẩn, Lưu, mở bán, Hạng vé) và việc bỏ dòng cũ trước khi tải lại không được test với dữ liệu API | low | patch | Mock mặc định `{ events: [] }` nên mọi test chỉ chạm nhánh dự phòng; bỏ `refreshEventSaleStatus` không test nào đỏ. |
| 5 | ECH | `reload()` của Cài đặt (sau `EVENT_CANCELLED`/trạng thái đổi) làm mới mà không bỏ dòng của Sự kiện | low | patch | `event-settings.tsx:80`; truyền `eventId`. |
| 6 | BH | e2e "Sự kiện nháp không gọi api" dùng `waitForTimeout(500)` | low | patch | `event-overview.spec.ts`; chờ điều kiện xác định. |
| 7 | BH | API test thiếu ca Closed Beta bị thu hồi / hủy liên kết (thiếu điều kiện có phí, nêu ở Problem) | low | patch | `event-sale-status.test.ts` chỉ có cờ `suspended` và thiếu chính sách hoàn vé. |
| 8 | BH | Chú thích `ordering.module.ts` gãy dòng | low | patch | Sửa chú thích. |
| 9 | BH | Chú thích ở `ticket-types-editor.tsx` nói giờ bán đổi trạng thái bán | low | reject | Đúng nếu chốt #1 theo `on_sale`; nếu không thì sửa cùng lượt vá. |
| 10 | BH | Đọc theo lô vẫn đọc Hạng vé/tồn kho cho Sự kiện đã chặn (hủy, kết thúc, Ẩn) | low | reject | Số truy vấn không đổi; số dòng nhỏ ở quy mô Closed Beta. |
| 11 | BH | Contract không ép `partial` ⇒ `paused`; test dùng `TIER_ID` làm `eventId` | low | reject | Máy chủ bảo đảm; đặt tên trong test. |
| 12 | BH | `READ_TRANSACTION` lặp với `my-tickets.service.ts` | low | reject | Không có hại cụ thể. |
| 13 | BH, ECH | Dòng cũ thắng `event.status` mới (Ẩn/hủy ở phiên khác); trang chủ gọi api cả khi không có Sự kiện mở bán | low | reject | Thao tác của chính BTC đã bỏ dòng cũ; phiên khác cũ tối đa `staleTime` 30 giây; hủy Sự kiện chưa có (7.1). |
| 14 | ECH | Sự kiện qua `effective_end_at` khi trang đang mở vẫn "Đang mở bán" tới lần tải lại | low | reject | Như trước 4.2-c (nhãn cũ cũng chỉ tính lúc render); tải lại khi quay lại tab. |
| 15 | ECH | Danh sách id vượt 65.535 tham số Postgres | false | reject | Cần hơn 65 nghìn Sự kiện/Hạng vé cho một BTC. |
| 16 | ECH | Lỗi ở lần tải lại giữ kết quả máy chủ cũ thay vì nhãn dự phòng | low | reject | Giữ câu trả lời máy chủ gần nhất an toàn hơn (không lật "Tạm ngừng bán" về "Đang mở bán" vì lỗi mạng); "lỗi" của phần đã khóa đọc là lần tải đầu. |

Lượt 2 (14/11/2026, sau vá intent_gap #1 và các patch lượt 1).

| # | Nguồn | Phát hiện | Verdict | Route | Bằng chứng |
|---|-------|-----------|---------|-------|------------|
| 17 | BH, VG (other) | `reload()` của Cài đặt bỏ dòng của Sự kiện khi chưa có `EventDetail` mới (vá #5 sai): badge dự phòng tính từ chi tiết cũ, có thể ghi "Đang mở bán" cho Sự kiện đang ngừng | low | patch | `event-settings.tsx` `reload` chỉ invalidate chi tiết; doc `refreshEventSaleStatus` yêu cầu đã có Sự kiện mới. Bỏ `eventId` ở `reload`. |
| 18 | BH | `refreshEventSaleStatus` ghi cache không `cancelQueries` trước: lần tải cũ đang chạy ghi đè lại dòng vừa bỏ | low | patch | `lib/event/sale-status.ts`; `applyOverview`, `PaymentServiceBlock` đã `await cancelQueries` trước `setQueryData`. |
| 19 | BH, ECH | Query nhãn không tự tải lại khi trang mở và đang xem: dữ liệu "cũ" không tự refetch; Sự kiện qua `effective_end_at`, phiên khác Ẩn, Closed Beta đổi thì nhãn đứng mãi; ghi chú deferred nói "hết `staleTime`" là sai, lý do bác #13/#14 dựa trên giả định này | low | patch | `useEventSaleStatus` không có `refetchInterval`; thêm 60 giây và sửa ghi chú. |
| 20 | ECH | Lưu trường không liên quan (tên, địa điểm) của Sự kiện đang ngừng cũng bỏ dòng: badge nháy "Đang mở bán" tới khi tải lại xong | low | patch | `useEventSaved.saved` luôn truyền `eventId`; chỉ bỏ dòng khi `status`/`endedManuallyAt`/`effectiveEndAt` đổi. |
| 21 | VG (gap), BH | Làm mới sau mở bán và sau đổi tài khoản nhận tiền không có test với dữ liệu api | low | patch | Chỉ Ẩn có test; xóa lời gọi ở `publish-panel.tsx:167` hay `shared.tsx:46` không test nào đỏ. |
| 22 | VG (gap) | Nhánh poll với `CLOSED_BETA_REVOKED`/`PAYOUT_ACCOUNT_NOT_LINKED` (vá #2) chưa được thử | low | patch | Test poll chỉ dùng mã Token; tham số hóa theo ba mã. |
| 23 | BH | Cuối test Ẩn không phân biệt dữ liệu api với dự phòng (api trả `hidden` trùng nhãn dự phòng) | low | patch | Dùng câu trả lời client không tự tính được. |
| 24 | BH | Doc danh sách điểm làm mới ở `eventSaleStatusQueryKey`/`refreshEventSaleStatus` thiếu tài khoản nhận tiền, "Kiểm tra lại", poll | low | patch | Sửa doc, trỏ về một danh sách. |
| 25 | BH | Tên `paymentServiceKey`/`lastPaymentServiceKey` không còn khớp tập `PAID_SALES_CODES` | low | patch | Đổi tên. |
| 26 | BH | Tiêu đề test cách ly API ngược với nội dung, BTC B tạo ra không dùng | low | patch | `event-sale-status.test.ts`. |
| 27 | BH | Thiếu API test hủy liên kết tài khoản nhận tiền (`payoutLinked = false`) | low | patch | Vá #7 mới thêm ca Closed Beta. |
| 28 | BH | Mock e2e gõ `reason` là `string \| null` | low | patch | `organizer-mock.ts` `saleStatus()`; gõ theo `EventSaleReason`. |
| 29 | BH | Bốn chỗ chép tay cùng bộ làm mới (notices + tổng quan + nhãn) | low | reject | Không có lỗi hiện tại; gom helper là tái cấu trúc. |
| 30 | BH | Transaction mở ở controller thay vì service | low | reject | Chạy đúng; kiểu đặt code. |
| 31 | BH | Tên `EventSaleStatus` dễ nhầm với `TierSaleStatus`; `saleEventsOfOrganization` ở `public-event.ts` | low | reject | Tên gọi. |
| 32 | ECH | Bỏ dòng rồi lần tải lại lỗi → nhãn dự phòng tới lần tải thành công kế | low | reject | Cần lỗi mạng ngay sau thao tác của chính BTC; chu kỳ 60 giây (#19) tự sửa. |
| 33 | ECH | Dòng cũ thắng `EventDetail` mới hủy/kết thúc ở phiên khác | low | reject | carried #13; nay giới hạn bởi chu kỳ 60 giây (#19). |
| 34 | ECH | Danh sách id vượt giới hạn tham số | false | reject | carried #15. |
| 35 | ECH | Lỗi ở lần tải lại giữ kết quả cũ | low | reject | carried #16. |

## Verification

**Commands:**
- `pnpm typecheck` -- expected: không lỗi.
- `pnpm lint:deps` -- expected: không vi phạm.
- `pnpm --filter @tickee/api test` -- expected: pass.
- `pnpm --filter @tickee/web test` -- expected: pass.
- `pnpm --filter @tickee/web exec playwright test e2e/event-draft.spec.ts e2e/event-overview.spec.ts e2e/publish.spec.ts e2e/event-settings.spec.ts e2e/status-banners.spec.ts` -- expected: pass.
