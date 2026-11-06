---
title: 'Story 2.11-a: sellability và API công khai cho trang Sự kiện'
type: 'feature'
created: '2026-11-06'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '396336b32e4e167ea5cbf7158dc6fe4ecc9f6125'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Trang `/e/{slug}` (2.11-b) cần biết từng Hạng vé còn bán được không và còn bao nhiêu vé. Hiện chưa có `ordering.sellability`, nguồn duy nhất cho trạng thái bán (AD-21). `GET /v1/events/:slug` cũng chưa trả tên BTC và Hạng vé.

**Approach:** Thêm `sellability(db, eventId, now)` trong `ordering`, dùng chung luật điều kiện với `publishReadiness`. Thêm `GET /v1/events/:slug/availability` (công khai, cache 2 giây). Mở rộng `PublicEvent` với tên BTC và Hạng vé tĩnh. Phần web, OG và revalidate thuộc 2.11-b.

## Boundaries & Constraints

**Always:**
- `sellability` export qua `ordering/index.ts` và trả `{eventReason, tiers: [{ticketTypeId, status, remaining, saleStartsAt}]}`.
  - `eventReason` lấy theo thứ tự ưu tiên `cancelled` > `locked` (Sự kiện có `locked_at` hoặc BTC bị khóa) > `hidden` > `ended` (`effective_end_at` ≤ now) > `paused` (có ít nhất một Hạng vé `paused`) > `null`.
  - Khi `eventReason ∈ {cancelled, locked, hidden, ended}`, mọi Hạng vé là `unavailable`.
  - Ngoài trường hợp trên, `status` của mỗi Hạng vé xét theo thứ tự `paused` → `not_started` (now < `sale_starts_at`) → `closed` (now ≥ `sale_ends_at`) → `sold_out` → `on_sale`.
  - `paused` áp cho mọi Hạng vé khi thiếu chính sách hoàn vé. Với Hạng vé > 0đ, `paused` còn áp khi Closed Beta khác `approved`, khi không còn tài khoản nhận tiền chưa `retired_at`, hoặc khi dịch vụ thanh toán không `active`.
  - Dịch vụ thanh toán dùng stub luôn `active` tới Epic 4. Hàm stub đặt riêng, giống `organizationLocked()`.
  - `remaining = capacity − sold − held`, đọc qua `inventoryOf`. `sold_out` khi `remaining` = 0. Hạng vé xếp theo `created_at`.
- Luật chính sách hoàn vé, Closed Beta, tài khoản nhận tiền và khóa BTC tách khỏi `publish.service.ts` thành hàm export qua `event/index.ts`. Hàm chỉ nhận `{organizationId}`. `publishReadiness` và `sellability` cùng gọi các hàm này. Không chép luật. Việc này đóng mục deferred 2.10 về export `publishReadiness`.
- `GET /v1/events/:slug/availability` dùng `@Public()` và trả `EventAvailability`.
  - Sự kiện nháp, slug sai hoặc slug quá dài trả `404 EVENT_NOT_FOUND`, giống `GET /v1/events/:slug`.
  - Header `Cache-Control: public, max-age=2`. Có thêm memo trong process theo slug, sống 2 giây, giới hạn số mục để không phình bộ nhớ.
- `PublicEvent` thêm `organizationName` và `ticketTypes: [{id, name, description, price, saleStartsAt, saleEndsAt}]`, xếp theo `created_at`. Phần này không chứa số vé. Sự kiện `hidden`, `cancelled` hoặc bị khóa vẫn trả 200 (FR-7: Ẩn vẫn mở được bằng link). Có test cho từng trạng thái, đóng mục deferred 2.7 về `publicBySlug`.

**Never:**
- Không làm trang web, OG hay revalidate (2.11-b). Không làm khóa BTC thật (Epic 7), `payment_service_status` hay `org_sales_state` (Epic 4), tạo Đơn hay giới hạn Vé/Đơn trong Đơn (Epic 3), guard sửa sau mở bán (2.12).
- `event` không import `ordering` (`module-graph.cjs`).
- Không trả `capacity`, `sold`, `held` thô, hay lý do khóa, ra API công khai.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Đang bán | `published`, Hạng vé 0đ, capacity 50 | `on_sale`, `remaining` 50, `eventReason` null | — |
| Hết vé | `sold + held = capacity` | `sold_out`, `remaining` 0 | — |
| Chưa mở / đã đóng | now < `sale_starts_at` / now ≥ `sale_ends_at` | `not_started` có `saleStartsAt` / `closed` | — |
| Closed Beta bị thu hồi | Hạng vé 100.000đ + 0đ | có phí `paused`, 0đ `on_sale`, `eventReason` `paused` | — |
| Hủy hết tài khoản | Hạng vé có phí, mọi tài khoản đã `retired_at` | có phí `paused` | — |
| Ẩn / Hủy / Khóa / Kết thúc | `hidden` / `cancelled` / `locked_at` / `effective_end_at` ≤ now | `eventReason` tương ứng, mọi tier `unavailable`; `GET /:slug` vẫn 200 | — |
| Nhiều lý do cùng lúc | `cancelled` + `locked_at` | `eventReason` `cancelled` | — |
| Nháp / slug sai | `draft` / không tồn tại | — | 404 `EVENT_NOT_FOUND` |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/sellability.ts` (mới, export qua `index.ts`): `TierSaleStatus`, `EventSaleReason`, schema `EventAvailability`.
- `packages/contracts/src/event.ts:132-142` `PublicEvent`: thêm hai trường mới. Dùng lại schema giá/thời gian của Hạng vé có sẵn trong `ticket-type.ts`.
- `apps/api/src/modules/event/publish.service.ts`:
  - `organizationLocked()` (l.35) và đoạn `closedBetaStatusOf` / `payoutAccountStatusOf` trong `publishReadiness` → tách ra file mới, ví dụ `event/sale-rules.ts`.
  - Các hàm cần có: `refundPolicySet`, `organizationLocked`, `paidSalesAllowed(db, {organizationId})` trả `{closedBetaApproved, payoutLinked}`.
  - Giữ nguyên hành vi và test của 2.10.
- `apps/api/src/modules/event/event.service.ts:232-248` `publicBySlug`:
  - Thêm tên BTC. Cần thêm hàm đọc tên qua `organizer/index.ts` nếu chưa có.
  - Thêm Hạng vé bằng `ticketTypesOf` (`ticket-type.service.ts:58`); kiểm tra thứ tự `created_at`.
- `event/index.ts`: export các hàm luật và một hàm tra Sự kiện công khai theo slug (`id`, `organizationId`, `status`, `lockedAt`, `effectiveEndAt`, `refundPolicy`). Hàm này dùng chung kiểm tra slug và luật 404 với `publicBySlug`.
- `apps/api/src/modules/ordering/`:
  - `sellability.ts` (mới). Dùng `inventoryOf(db, ids)` (`inventory.service.ts:99`) và `ticketTypesOf`.
  - `public-availability.controller.ts` (mới, `@Public()` + `@Controller('events')` + `@Get(':slug/availability')`). Mẫu theo `event/public-events.controller.ts:7-15`.
  - `ordering.module.ts` (mới), đăng ký trong `src/api.module.ts` cạnh `EventModule`.
  - `index.ts` export `sellability`, `OrderingModule`.
- `module-graph.cjs:11` đã cho `ordering → event, organizer`. Không cần sửa.
- Test:
  - `apps/api/test/ordering/sellability.test.ts` (mới) phủ matrix, gồm `Cache-Control` và 404. Fixture Closed Beta và tài khoản chép từ `test/reporting/notices.test.ts:22-65`. Khóa Sự kiện: set `locked_at` bằng SQL trực tiếp.
  - `apps/api/test/event/events.test.ts:252` (khối "API công khai theo slug"): thêm trường mới và các trạng thái `hidden`, `cancelled`, khóa.
  - `test/event/publish.test.ts` phải pass nguyên vẹn sau khi tách luật.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{sellability,event,index}.ts` + test contracts -- hợp đồng availability và `PublicEvent` mở rộng.
- [x] `apps/api/src/modules/event/{sale-rules,publish.service,event.service,index}.ts` -- tách luật dùng chung, mở rộng `publicBySlug`, tra theo slug cho ordering.
- [x] `apps/api/src/modules/ordering/{sellability,public-availability.controller,ordering.module,index}.ts`, `src/api.module.ts` -- `sellability` + endpoint có cache 2 giây.
- [x] `apps/api/test/ordering/sellability.test.ts`, `test/event/events.test.ts` -- phủ matrix và trạng thái công khai.

**Acceptance Criteria:**
- Given Sự kiện đã mở bán có Hạng vé 0đ và 100.000đ, BTC đã duyệt Closed Beta và có tài khoản nhận tiền, when Quản trị Tingee thu hồi Closed Beta rồi gọi `/availability`, then Hạng vé có phí `paused`, Hạng vé 0đ vẫn `on_sale`.
- Given đã tách luật, when chạy lại `publish.test.ts`, then mọi test của 2.10 vẫn pass.
- Given một Hạng vé vừa bán thêm (đổi `sold` trong DB), when gọi lại `/availability` sau hơn 2 giây, then `remaining` giảm đúng.

## Implementation Notes

- `PublicEvent` chuyển sang `contracts/src/sellability.ts`, vì nó dùng `PublicTicketType` mà `ticket-type.ts` lại import `event.ts` (tránh vòng import). `@tickee/contracts` vẫn export như cũ.
- `EventService.publicBySlug` được thay bằng `event/public-event.ts`, gồm `publicEventDetail`, `publicEventBySlug` và `saleEventById`, dùng chung một luật 404. `PublicEventsController` đọc DB trực tiếp để tránh vòng `event.service` ↔ `public-event`.
- Luật dùng chung nằm ở `event/sale-rules.ts`: `refundPolicySet`, `organizationLocked` (stub), `paidSalesAllowed`. `paymentServiceStatus` (stub `active`) nằm trong `ordering/sellability.ts`.
- Memo ở `AvailabilityMemo`: sống 2 giây, tối đa 1.000 slug, lỗi không được memo, request đến cùng lúc dùng chung promise. Đồng hồ tiêm được qua `AVAILABILITY_CLOCK`.
- Hạng vé `unavailable` vẫn trả `remaining` (không lộ số thô capacity/sold/held).

## Spec Change Log

## Review Triage Log

Pass 1 (06/11/2026, 3 lớp: blind-hunter BH, edge-case-hunter EC, verification-gap VG).

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | VG, BH | Chưa có test chứng minh `paused` thắng `not_started`/`closed`/`sold_out` | medium | VG gap: mọi test `paused` dùng Hạng vé không có cửa sổ bán và còn đủ chỗ; dời kiểm `paused` xuống dưới thì test vẫn pass | patch |
| 2 | VG, BH | Giới hạn 1.000 mục và việc chia sẻ promise của memo chưa có test | medium | VG gap: không test nào dùng `AVAILABILITY_MEMO_MAX`, `AvailabilityMemo` hay `size`; bỏ `makeRoom` vẫn pass | patch |
| 3 | BH, EC | Slug sai dạng hoặc quá dài vẫn vào memo và có thể gọi `makeRoom` trước khi bị 404 | low | Có thật: `get` set entry và `makeRoom` trước `compute`. Sửa trực tiếp bằng cách kiểm slug trước khi chạm memo, không thêm bề mặt | patch |
| 4 | EC | `sellabilityOf` đã export nhận Sự kiện `draft` và báo Hạng vé đang bán | low | Có thật với người gọi tự dựng `PublicEventRef`; sửa bằng một dòng guard `EVENT_NOT_FOUND` | patch |
| 5 | BH, EC | Thiếu dòng tồn kho thì Hạng vé hiện `sold_out` | low | Dòng tồn kho tạo cùng transaction với Hạng vé (`flows.createTicketType`) và có FK; chỉ lệch khi Hạng vé bị xóa đúng giữa hai lần đọc, lúc đó Hạng vé cũng sắp biến mất | reject |
| 6 | BH | `Promise.all` trên cùng một `tx` sẽ chạy song song | false | Một client `pg` xếp hàng truy vấn tuần tự; transaction lỗi thì cả transaction đã hỏng dù chạy kiểu nào | reject |
| 7 | BH | `sellability` không ghi rằng đọc tồn kho không khóa | low | Spec và Design Notes đã ghi tạo Đơn kiểm lại trong TX1 (AD-37); Epic 3 dùng `lockInventoryForEvent` | reject |
| 8 | BH | `paymentServiceStatus` không nằm ở `sale-rules.ts` và chưa export | low | Spec chỉ yêu cầu hàm stub riêng; luật này chỉ `ordering` dùng (`publishReadiness` không xét dịch vụ thanh toán theo AD-34). Epic 4 thay thân hàm | reject |
| 9 | BH | Hai lần tra dùng hai kiểu `select` khác nhau | low | Chỉ khác số cột đọc; trên đường nóng đã có memo 2 giây | reject |
| 10 | BH | Hạng vé `unavailable` vẫn trả `remaining` | low | Đã chốt trong Implementation Notes; không lộ số thô. Sửa nghĩa là sửa spec | reject |
| 11 | BH | Test "không lộ lý do khóa" dùng regex `/lock/` dễ vỡ | low | Tên Hạng vé trong test cố định; test vẫn bắt đúng việc lộ `lockedAt`/`lockReason` | reject |
| 12 | BH | `GET /v1/events/:slug` không có `Cache-Control`/memo | low | Phần tĩnh được SSR cache 30 giây ở web (2.11-b, AD-37); API không bị gọi theo từng lượt xem | reject |
| 13 | BH | Nhánh khóa BTC chưa có test; `EVENT_UNAVAILABLE_REASONS` không được server dùng | low | Stub tới Epic 7, đã có trong deferred-work 2.10. Hằng số chỉ để web dùng | reject |
| 14 | BH | Sự kiện 0 Hạng vé trả `tiers` rỗng, `eventReason` null | low | Mở bán đòi `HAS_TICKET_TYPE`; xóa Hạng vé sau mở bán thuộc guard 2.12 | reject |
| 15 | EC, VG | Không còn BTC thì `/:slug` 404 còn `/availability` 200 | false | `events.organization_id` có FK tới `organizations`, không cascade; không thể còn Sự kiện mà mất BTC | reject |

## Design Notes

- **Một chỗ cho luật:** 2.10 xét "có được mở bán không", 2.11-a xét "Hạng vé này có đang bán không". Cả hai hỏi chung các câu: chính sách hoàn vé, Closed Beta, tài khoản nhận tiền, khóa BTC. Vì vậy các câu hỏi đó thành hàm trong `event` mà cả hai mô-đun gọi. Riêng kết luận (mã readiness hay `status` tier) để ở từng nơi.
- **Memo 2 giây trong process:** `Cache-Control` chỉ giúp khi có CDN hoặc proxy đứng trước. Memo giữ 5.000 lượt xem cùng lúc ở mức khoảng 1 truy vấn mỗi 2 giây cho mỗi process (AD-37). "Còn N vé" lệch tối đa 2 giây. Tạo Đơn (Epic 3) vẫn kiểm lại trong TX1.

## Verification

**Commands:**
- `pnpm turbo build typecheck lint:deps test` -- expected: tất cả pass (Postgres chạy bằng `docker compose up -d`).
