---
title: 'Story 2.8: Hạng vé và tồn kho'
type: 'feature'
created: '2026-11-05'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '9e250a454d4e3d6e2ffc204333ef0921d6b8ab1d'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sự kiện nháp (2.7) chưa có Hạng vé: wizard bước 2 và tab "Hạng vé" chỉ hiện "Sắp có", chưa có bảng tồn kho. 2.10 (mở bán), 2.11 (trang công khai) và Epic 3 (tạo Đơn) đều cần Hạng vé và tồn kho.

**Approach:** Thêm bảng `ticket_types` (của `event`), `ticket_type_inventory` (của `ordering`) và cột giới hạn Vé/Đơn trên `events`. Tạo và đổi số suất đi qua `flows.createTicketType` / `flows.changeCapacity` trong một transaction. Web có một trình sửa Hạng vé dùng chung cho wizard bước 2 và tab "Hạng vé".

## Boundaries & Constraints

**Always:**
- Owner và Admin (`Permission.EVENTS_MANAGE`). Route `/v1/orgs/:orgId/events/:eventId/ticket-types…` có `@RequirePermission`, truy vấn qua `orgScope(ctx)`, tự vào bộ test cách ly. Sự kiện của BTC khác → `404 EVENT_NOT_FOUND`; Hạng vé lạ → `404 TICKET_TYPE_NOT_FOUND`.
- Hạng vé: tên (bắt buộc), mô tả, giá (`bigint`, đồng, số nguyên), số suất (số nguyên ≥ 1), thời gian mở/đóng bán (đóng > mở khi có cả hai). Giá > 0 và < 2.000 → lỗi tại trường giá.
- `ticket_type_inventory(capacity, sold, held)` có `CHECK (held >= 0 AND sold >= 0 AND sold + held <= capacity)`; chỉ `ordering` ghi.
- Đổi số suất đúng một câu `UPDATE … SET capacity = :c WHERE ticket_type_id = :id AND sold + held <= :c`. 0 dòng → `409 CAPACITY_BELOW_COMMITTED`, `details.minimum = sold + held`; web hiện tại trường "Tối thiểu {n} — đã bán và đang giữ chỗ."
- Trần 200 Vé cho Sự kiện miễn phí: kiểm mỗi lần tạo, sửa giá hoặc sửa số suất. Nếu sau thay đổi mọi Hạng vé đều 0đ và tổng số suất > 200 → `409 FREE_EVENT_CAPACITY_EXCEEDED`, lỗi tại trường số suất. Phép kiểm khóa dòng `events` rồi mọi dòng tồn kho của Sự kiện `FOR UPDATE` theo thứ tự id, sau đó mới cộng tổng.
- Giới hạn Vé/Đơn lưu ở `events.max_tickets_per_order`, mặc định 10, khoảng 1–50.
- Audit trong cùng transaction: `ticket_type.created`, `ticket_type.updated` (chỉ tên trường đổi), `ticket_type.deleted`, `event.updated` với `changedFields: ['maxTicketsPerOrder']`.
- **Quyết định 05/11/2026 (Mason):**
  - **(Q1) Xóa Hạng vé:** được xóa khi `sold + held = 0`, qua `Dialog` xác nhận nêu hậu quả. Xóa Hạng vé và dòng tồn kho trong cùng một transaction (`flows.deleteTicketType`), khóa theo cùng thứ tự Sự kiện → tồn kho. Nếu `sold + held > 0` → `409 TICKET_TYPE_IN_USE`.
  - **(Q2) Giờ mở/đóng bán không bắt buộc:** cả hai cột nullable. Bỏ trống giờ mở = bán ngay khi Sự kiện mở bán; bỏ trống giờ đóng = bán đến khi Sự kiện kết thúc. 2.10/2.11 diễn giải các giá trị này. Có cả hai thì giờ đóng phải sau giờ mở.
  - **(Q3) Ô "Giới hạn Vé/Đơn"** nằm trong tab "Hạng vé" và wizard bước 2, đặt cạnh danh sách Hạng vé (theo `EXPERIENCE.md:72`). Tab "Cài đặt" vẫn "Sắp có".

**Never:**
- Không làm `sellability`, trạng thái "Chưa mở bán"/"Đã đóng bán" trên trang công khai (2.10/2.11), tạo Đơn hay Giữ chỗ (Epic 3), form mua (2.9), `Idempotency-Key`.
- `event` không import `ordering`; mô-đun không gọi `flows` (dependency-cruiser).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Tạo Hạng vé có phí | Admin: "Đơn nam", 300.000đ, 32 suất | 201; tồn kho `(32, 0, 0)`; audit `ticket_type.created` | — |
| Giá lẻ dưới sàn | giá 1.500 | không lưu | 400 `VALIDATION_FAILED` path `price` |
| Giá 0 hoặc 2.000 | — | lưu được | — |
| Trần miễn phí | Hai Hạng vé 0đ 120 + 90 suất | Hạng vé thứ hai không lưu | 409 `FREE_EVENT_CAPACITY_EXCEEDED` |
| Có Hạng vé có phí | 0đ 150 suất + 300.000đ 100 suất | lưu được (không phải Sự kiện miễn phí) | — |
| Đổi giá thành 0 | Hạng vé có phí duy nhất 250 suất đổi giá 0 | không lưu | 409 `FREE_EVENT_CAPACITY_EXCEEDED` |
| Giảm số suất dưới đã cam kết | `sold 5, held 3`, đổi capacity 7 | không lưu | 409 `CAPACITY_BELOW_COMMITTED`, `minimum: 8` |
| Đóng bán trước mở bán | đóng ≤ mở | không lưu | 400 path `saleEndsAt` |
| Khác BTC | Sự kiện của BTC B qua `/orgs/{A}/…` | 404 `EVENT_NOT_FOUND` | — |
| Giới hạn Vé/Đơn | Sự kiện mới | `maxTicketsPerOrder: 10`; đặt 0 hoặc 51 → 400 | — |
| Xóa Hạng vé chưa bán | `sold 0, held 0` | 204; xóa luôn dòng tồn kho; audit `ticket_type.deleted` | — |
| Xóa Hạng vé đã có người mua | `sold + held > 0` | không xóa | 409 `TICKET_TYPE_IN_USE` |
| Bỏ trống giờ bán | không có giờ mở và giờ đóng | 201; `saleStartsAt`/`saleEndsAt` là `null` | — |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/event.ts`: export `EventInputDateTime` (:59, hiện để private) và `optionalText` (:63) để dùng lại. Thêm `maxTicketsPerOrder` vào `EventDetail`.
- `packages/contracts/src/ticket-type.ts` (mới, export qua `index.ts`): `TicketTypeInput` (giá ≤ 100.000.000, số suất ≤ 100.000, refine sàn 2.000 với path `price`), `TicketTypeDetail` (thêm `id`, `sold`, `held`), `TicketTypeList`, `EventOrderLimitInput`, `FREE_EVENT_TICKET_CAP = 200`, `MIN_PAID_PRICE = 2000`. Giá in ra bằng `formatVnd` (`money.ts:5`).
- `contracts/src/errors.ts:82`, `api/src/platform/http/app-error.ts` `DEFAULT_STATUS`, `error.filter.ts` `MESSAGES`: thêm `TICKET_TYPE_NOT_FOUND` (404), `CAPACITY_BELOW_COMMITTED` (409), `FREE_EVENT_CAPACITY_EXCEEDED` (409), `TICKET_TYPE_IN_USE` (409). Các chỗ này khai báo kiểu `Record`, nên thiếu chỗ nào sẽ báo lỗi biên dịch.
- `apps/api/src/modules/event/`:
  - `schema.ts`: bảng `ticket_types` có `organization_id` (để dùng `orgScope`), FK `event_id`, cột `price bigint` (mode number), index `(event_id, created_at)`. Thêm cột `events.max_tickets_per_order` (smallint, CHECK 1–50, default 10).
  - Service theo mẫu `event.service.ts` (`UUID`, `notFound`, `detailOf`, `changedFieldsOf`). Hàm nhận `tx`, export qua `index.ts`: khóa Sự kiện `FOR UPDATE` theo `orgScope`, insert/update/list Hạng vé.
  - `PATCH orgs/:orgId/events/:eventId/order-limit` đặt trong `events.controller.ts`.
- `apps/api/src/modules/ordering/`: thêm `schema.ts` (`ticket_type_inventory`, PK là `ticket_type_id`, FK sang `ticket_types`). Service: `createInventory`, `changeCapacity`, `lockInventoryForEvent` (`ORDER BY ticket_type_id`, `FOR UPDATE`), `inventoryOf(ids)`. Hiện `index.ts` chỉ có `export {}`.
- `apps/api/src/flows/`: `ticket-types.flow.ts` (`createTicketType`, `updateTicketType`, `deleteTicketType`; khi số suất đổi thì gọi `changeCapacity`), `ticket-types.controller.ts` (`orgs/:orgId/events/:eventId/ticket-types`: `GET`, `POST`, `PATCH :ticketTypeId`, `DELETE :ticketTypeId`), `flows.module.ts`. Đăng ký trong `api.module.ts:30-42`. Theo luật `outside-public-api-only`, flows chỉ import `modules/*/index.ts`.
- Migration `0011`: `pnpm --filter @tickee/api db:generate --name ticket_types`.
- `platform/audit/audit.ts:49`: thêm `ticket_type.created`, `ticket_type.updated`, `ticket_type.deleted`.
- Web (`W` = `apps/web/app/(dashboard)/btc/[orgId]/su-kien`):
  - `W/ticket-types-editor.tsx` (mới): danh sách hàng gồm tên, giá `tabular-nums`, số suất, giờ bán, cùng nút "Thêm Hạng vé", "Sửa" và "Xóa" (mở `Dialog` xác nhận). Ô "Giới hạn Vé/Đơn" nằm cạnh danh sách. Thêm và sửa mở `Dialog` chứa form, làm theo mẫu `create-organization-form.tsx`. Ô giá là `Input inputMode="numeric"`; giờ dùng `eventLocalToIso`/`eventIsoToLocal`. Lỗi 409 hiện tại trường số suất.
  - `W/event-wizard.tsx`: bước 2 render trình sửa thay cho `EmptyState` (:295) và bỏ `COMING_SOON[1]` (:49). Bước 3–4 vẫn "Sắp có".
  - `W/[eventId]/event-tab-list.ts`: bỏ `soon` của `hang-ve`. `W/[eventId]/event-tabs.tsx:90` render trình sửa.
  - `apps/web/lib/event/api.ts`: thêm `ticketTypesQueryKey`, `fetchTicketTypes`, `createTicketType`, `updateTicketType`, `deleteTicketType`, `updateOrderLimit`.
- Test:
  - `apps/api/test/event/ticket-types.test.ts` (mới) theo mẫu `events.test.ts`. Muốn có `sold`/`held` thì `UPDATE` thẳng bằng SQL trong test.
  - `test/organizer/isolation.test.ts:66`: thêm route mới.
  - `test/dependency-rules.test.ts`: chạy lại, không cần sửa.
  - `apps/web/e2e/ticket-types.spec.ts` (mới) dùng `mockOrganizerApi` (`e2e/organizer-mock.ts:60`).

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{ticket-type,event,errors,index}.ts` + `packages/contracts/test/ticket-type.test.ts` -- schema, sàn giá (0, 1.999, 2.000), giờ đóng > giờ mở.
- [x] `apps/api/src/modules/{event,ordering}/*`, migration `0011`, `platform/audit/audit.ts`, `platform/http/{app-error,error.filter}.ts` -- bảng, service nhận `tx`, `order-limit`.
- [x] `apps/api/src/flows/*`, `api.module.ts` -- flow và controller Hạng vé.
- [x] `apps/api/test/event/ticket-types.test.ts`, `test/organizer/isolation.test.ts` -- phủ matrix; hai request tạo Hạng vé 0đ song song không vượt 200.
- [x] Web: `ticket-types-editor.tsx`, `event-wizard.tsx`, `event-tab-list.ts`, `event-tabs.tsx`, `lib/event/api.ts` -- trình sửa dùng chung, ô giới hạn Vé/Đơn.
- [x] `apps/web/e2e/ticket-types.spec.ts`, `e2e/organizer-mock.ts` -- thêm, sửa, xóa qua `Dialog`, lỗi giá, lỗi 409 tại trường số suất, 320px không cuộn ngang.

**Acceptance Criteria:**
- Given wizard bước 2, when thêm "Đơn nam" 300.000đ 32 suất, then hàng mới hiện "300.000đ" và "32 suất" mà không tải lại trang; tab "Hạng vé" của cùng Sự kiện thấy đúng hàng đó.
- Given hai request tạo Hạng vé 0đ (mỗi request 150 suất) chạy cùng lúc, when cả hai commit, then đúng một request thành công.

## Implementation Notes

- `ticket_type_inventory` có thêm cột `event_id` (lặp từ `ticket_types`), để `ordering` khóa mọi dòng tồn kho của Sự kiện (`ORDER BY ticket_type_id FOR UPDATE`) mà không phải join sang bảng của `event`.
- `ticket_types` có CHECK ở DB cho sàn giá (`price = 0 OR price >= 2000`) và cho cửa sổ bán (đóng > mở khi có cả hai).
- `PATCH` Hạng vé thay toàn bộ trường, giống `PATCH` Sự kiện. Không đổi gì thì không ghi audit.
- Trần 200 Vé miễn phí được kiểm cả khi xóa (triage #1): xóa Hạng vé có phí duy nhất mà phần còn lại vượt 200 → 409.
- Ô "Giới hạn Vé/Đơn" tự lưu khi rời ô nếu giá trị đổi và hợp lệ (triage #12), vẫn giữ nút "Lưu" và phím Enter. Lưu lại đúng giá trị cũ thì không gửi request.
- Form Thêm/Sửa nằm trong `Dialog` (portal) nhưng ở trong form của wizard, nên sự kiện submit phải `stopPropagation`.
- Chạy `pnpm turbo build`/`typecheck` có thể khôi phục từ cache bản build web không có `NEXT_PUBLIC_API_BASE_URL`, khiến e2e lỗi hàng loạt. Phải build lại web theo lệnh ở Verification trước khi chạy e2e.

## Spec Change Log

## Review Triage Log

Pass 1 (05/11/2026, 3 lớp: blind-hunter BH, edge-case-hunter EC, verification-gap VG).

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | BH, EC | Xóa Hạng vé có phí duy nhất khiến Sự kiện còn toàn Hạng vé 0đ với tổng > 200; sau đó mọi lần sửa Hạng vé, kể cả đổi tên, đều bị 409 | medium | `deleteTicketType` không gọi `assertFreeCap`. Trình tự: có phí 100 + 0đ 250 rồi xóa Hạng vé có phí → vi phạm trần cứng 200 của epic. Chỉ cần kiểm trên các Hạng vé còn lại; khi bất biến luôn đúng thì hiện tượng 409 lúc đổi tên cũng hết | patch |
| 2 | BH | Ghi Hạng vé và giới hạn Vé/Đơn không xét `status` và khóa của Sự kiện | false | Chưa đạt tới được: chưa có đường nào chuyển khỏi `draft` hay đặt `locked_at` (giống 2.7 triage #6, mục deferred của 2.7). 2.10/2.12/Epic 7 phải thêm guard cho cả route Hạng vé. Sửa giá sau khi bán là hợp lệ vì giá chốt vào Đơn (FR-8) | reject |
| 3 | BH | Giờ bán không so với giờ Sự kiện; có thể tạo Hạng vé không bao giờ bán được | low | Có thật, nhưng hiếm; sửa phải thêm guard chéo mô-đun và kiểm lại khi sửa giờ Sự kiện. Điều kiện mở bán (2.10) là chỗ hợp lý để báo | reject |
| 4 | BH, EC, VG | `listTicketTypes` đọc Hạng vé và tồn kho bằng hai câu riêng; xóa commit chen giữa thì trả Hạng vé ma 0 suất | low | Có thật khi hai request chen nhau. Sửa trực tiếp: bỏ dòng không có tồn kho thay vì fallback `capacity: 0` | patch |
| 5 | BH, EC | Dòng `ticket_types` thiếu tồn kho bị xử lý bốn kiểu (0 suất, 404, 409 IN_USE) | false | Không đạt tới được: tồn kho tạo và xóa cùng transaction với Hạng vé, FK chặn tồn kho mồ côi | reject |
| 6 | BH | `assertTicketTypeId` chạy sau khi khóa; `changeCapacity` ghi trước `assertFreeCap` rồi bị rollback | false | Không có hậu quả: lỗi vẫn đúng mã, ghi bị rollback trong cùng transaction; chỉ là thứ tự | reject |
| 7 | BH | Audit Hạng vé không ghi `eventId`; sau khi xóa không biết Hạng vé thuộc Sự kiện nào | low | Có thật, nhưng chưa có ai đọc audit theo Sự kiện; sửa phải mở rộng `AuditEvent` (public surface) | reject |
| 8 | BH | DB không ràng buộc `event_id`/`organization_id` lặp lại (FK ghép) và không có CHECK `capacity >= 1` | low | Lối ghi duy nhất (flows) truyền đúng giá trị; contract chặn `capacity < 1`. Sửa phải thêm ràng buộc và migration | reject |
| 9 | BH, EC | Escape, X hoặc bấm nền đóng được `Dialog` Thêm/Sửa khi đang lưu; `onDone` đến muộn đóng `Dialog` vừa mở lại | low | Có thật (nút "Hủy" có chặn, `onOpenChange` thì không), nhưng phải bấm trong lúc lưu chưa tới một giây; sửa phải đưa `isPending` lên trên | reject |
| 10 | EC | Mở lại cùng `Dialog` trước khi hiệu ứng đóng kết thúc thì form không mount lại, còn giữ giá trị cũ | low | Phải bấm lại trong khoảng 200ms; sửa phải thêm bộ đếm lần mở | reject |
| 11 | BH, EC | `parseWholeNumber` xóa mọi `.`/`,` nên "4,5" → 45, "1,5" → 15, lưu im lặng | low | Đã đọc code: `replace(/[\s.,]/g, '')`. Sửa trực tiếp regex: chỉ nhận số liền hoặc nhóm 3 chữ số có dấu phân cách | patch |
| 12 | BH, EC | Ô giới hạn Vé/Đơn đã gõ nhưng chưa bấm "Lưu" sẽ mất im lặng khi bấm "Tiếp"/"Lưu nháp"/"Quay lại" của wizard | medium | Có thật và hay gặp: 2.7 quy định "Tiếp" lưu rồi mới sang bước, mà ô này là ô duy nhất của bước 2 không tự lưu. Sửa nhỏ: lưu khi rời ô (blur) nếu giá trị đổi và hợp lệ | patch |
| 13 | BH | Nút "Xóa" vẫn bấm được với Hạng vé đã bán; form sửa không báo trước số suất tối thiểu | low | Chưa đạt tới được trước Epic 3 (chưa có Đơn); khi đó `Dialog` vẫn báo lỗi 409 rõ ràng | reject |
| 14 | BH | Hằng số lặp hoặc không dùng (`MAX_TICKETS_PER_ORDER_DEFAULT`, "200" cứng trong `MESSAGES`, "mặc định 10" cứng) | low | Sửa trực tiếp: dùng hằng số ở `schema.ts` (default), `error.filter.ts` và câu gợi ý của trình sửa. Không sửa CHECK `BETWEEN 1 AND 50` để migration giữ nguyên | patch |
| 15 | BH | Thiếu test truy cập chéo BTC cho PATCH/DELETE bằng id Hạng vé thật của BTC B | low | Route có `orgScope` qua `lockEventForTicketTypes` nhưng không test nào chạy nhánh này | patch |
| 16 | BH | Không có test chạy song song tạo + sửa giá, xóa + tạo; web thiếu e2e đổi giá về 0 → 409 | low | Mọi lệnh đã tuần tự qua khóa dòng `events`, đã có test chạy song song cho tạo; nhánh 409 ở web đã có e2e của lần tạo | reject |
| 17 | BH | Không giới hạn số Hạng vé mỗi Sự kiện | low | Là luật mới, intent không có; MVP mỗi Sự kiện có ít Hạng vé | reject |
| 18 | VG | Form sửa điền sẵn mô tả và giờ bán chưa được test, PATCH body không được kiểm (PATCH thay toàn bộ) | — | Gap đã xác minh: test sửa duy nhất seed `null` và chỉ kiểm method/path | patch |
| 19 | VG | `eventId` sai dạng trên route ghi (POST/PATCH/DELETE Hạng vé, PATCH order-limit) chưa có test | — | Gap đã xác minh: chỉ GET có test `khong-phai-uuid` | patch |
| 20 | VG | Admin gọi GET danh sách Hạng vé chưa có test | — | Gap đã xác minh: mọi GET dùng cookie Owner | patch |
| 21 | VG | Nhánh `TICKET_TYPE_NOT_FOUND` của web khi sửa và xóa chưa được chạy | — | Gap đã xác minh: không test nào xóa Hạng vé khỏi state của mock trước khi gửi | patch |
| 22 | EC | Sửa Hạng vé có giờ bán lẻ giây (client API) làm lệch giờ và ghi audit giả | low | Web luôn gửi giây `:00`; chỉ client API khác mới tạo được (giống 2.7 triage #19) | reject |
| 23 | EC | Giờ mở bán sai năm kèm theo lỗi phụ ở `saleEndsAt` | low | Đã chạy thử: năm 2199 cho `['saleStartsAt','saleEndsAt']`. Câu lỗi phụ vẫn đúng (giờ mở sau giờ đóng) và hiếm gặp | reject |
| 24 | EC | Không có `flows.changeCapacity`; `ordering.changeCapacity` gọi thẳng được mà không khóa Sự kiện | low | Hiện chỉ `flows.updateTicketType` gọi hàm này; câu UPDATE có điều kiện tự an toàn với `sold + held`, chỉ bỏ qua trần miễn phí. Sửa phải thêm public surface | reject |

## Design Notes

- **Controller ở `flows`:** tạo và sửa Hạng vé ghi cả `event` lẫn `ordering`, mà `event` không được gọi `ordering`, mô-đun cũng không được gọi `flows`. Vì vậy controller đặt ở `flows/`. `GET` cũng ở đây vì danh sách cần ghép `sold`/`held` từ `ordering`.
- **Khóa dòng `events` trước:** `FOR UPDATE` trên tồn kho không chặn được một Hạng vé mới đang được thêm song song. Khóa dòng Sự kiện trước thì mọi thao tác Hạng vé của cùng Sự kiện chạy tuần tự. Thứ tự khóa luôn là Sự kiện rồi đến tồn kho theo id, giống AD-2.

## Verification

**Commands:**
- `pnpm turbo build typecheck lint:deps test` -- expected: tất cả pass (Postgres chạy bằng `docker compose up -d`).
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 pnpm --filter @tickee/web build && pnpm --filter @tickee/web test:e2e` -- expected: pass trên `ios-webkit` và `android-chromium`.
