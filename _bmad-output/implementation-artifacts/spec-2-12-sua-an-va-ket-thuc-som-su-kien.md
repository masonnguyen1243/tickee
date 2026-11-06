---
title: 'Story 2.12: Sửa, ẩn và kết thúc sớm Sự kiện'
type: 'feature'
created: '2026-11-06'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: '4625a187485fb15b7a496a7a8d500c33be96d827'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sự kiện đã mở bán không sửa được từ dashboard (form thông tin chỉ có ở wizard nháp), không ẩn được và không kết thúc sớm được. Tab "Cài đặt" vẫn là placeholder; cột `ended_manually_at` (AD-14) chưa có.

**Approach:** Tab Cài đặt gồm form thông tin (tách từ wizard bước 1, dùng chung) và hai hành động trạng thái: Ẩn/Hiện lại (CAS `published` ↔ `hidden`) và "Kết thúc" (đặt `ended_manually_at` = `effective_end_at` = lúc bấm). API thêm 3 endpoint. "Đã kết thúc" thắng "Ẩn": `sellability` xét `ended` trước `hidden`.

## Boundaries & Constraints

**Always:**
- Sửa: mọi trạng thái trừ `cancelled` (→ `409 EVENT_CANCELLED`). Có `ended_manually_at` thì sửa giờ không đổi `effective_end_at`; chưa có thì tính lại như hiện tại.
- `POST /v1/orgs/:orgId/events/:eventId/{hide,unhide,end}`, `@RequirePermission(EVENTS_MANAGE)`, `@HttpCode(200)`, không body, trả `EventDetail`. Mẫu khóa dòng + CAS như `PublishService.publish`. Sai trạng thái → `409 EVENT_STATUS_CONFLICT` (`details.status` hiện tại). "Kết thúc" khi `effective_end_at <= now` → `409 EVENT_ALREADY_ENDED`.
- "Kết thúc" cho phép khi `status ∈ {published, hidden}` và `starts_at <= now < effective_end_at`; đặt cả hai cột bằng một `now` lấy trong transaction. Không đổi `status`. Quyết định (06/11/2026): chưa tới `starts_at` → `409 EVENT_NOT_STARTED`; web tắt nút kèm lý do "Sự kiện chưa bắt đầu — dùng Ẩn để dừng nhận Đơn."
- Quyết định (06/11/2026, review pass 1): "Đã kết thúc" thắng "Ẩn". `sellability` xét `effective_end_at <= now` trước `hidden` (vẫn sau `cancelled` và khóa), nên Sự kiện ẩn đã kết thúc (bấm tay hoặc tự hết giờ) có `eventReason: ended` và trang hiện "Sự kiện đã kết thúc". Ẩn và Hiện lại khi `effective_end_at <= now` → `409 EVENT_ALREADY_ENDED` (kiểm sau trạng thái); web ẩn cả hai nút khi đã kết thúc.
- Mỗi hành động: audit (`event.hidden`, `event.unhidden`, `event.ended`) và `enqueuePublicPageRevalidation` trong cùng `tx`.
- DB: migration 0013 thêm `ended_manually_at timestamptz NULL` + CHECK `ended_manually_at IS NULL OR effective_end_at = ended_manually_at`. `EventDetail` thêm `endedManuallyAt`.
- Web: "Kết thúc" qua `Dialog` nêu hậu quả ("Ngừng nhận Đơn ngay, không mở lại được."); Ẩn/Hiện lại không hỏi xác nhận. Nút gọi mạng có spinner, chặn bấm lặp. Sự kiện đã hủy: form chỉ đọc + lý do; đã kết thúc: ẩn nút "Kết thúc", hiện "Đã kết thúc lúc …"; chưa bắt đầu: nút "Kết thúc" tắt kèm lý do ở trên. `status-badge` hiện "Đã kết thúc" (neutral) khi `published`/`hidden` và `effectiveEndAt <= now`.

**Never:**
- Không lưu "Đã kết thúc" vào `status`. Không có thao tác hoàn tác "Kết thúc". Không làm Hủy (Epic 7), email báo Người mua khi đổi giờ/địa điểm (3.10), ảnh Sự kiện, Idempotency-Key.
- Ngoài thứ tự `ended`/`hidden` ở trên, không đổi `sellability` và trang `/e/{slug}` (banner "Sự kiện tạm dừng nhận Đơn" / "Sự kiện đã kết thúc" đã có).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Sửa đang bán | `published`, đổi tên | Lưu, audit `changedFields:['name']`, 1 job revalidate | — |
| Sửa đã hủy | `cancelled` | Không ghi | `409 EVENT_CANCELLED` |
| Sửa giờ sau Kết thúc | `ended_manually_at` có, đổi `endsAt` | `endsAt` đổi, `effective_end_at` giữ nguyên | — |
| Ẩn | `published` | `hidden`; availability `eventReason: hidden` | — |
| Ẩn sai trạng thái | `draft`/`hidden`/`cancelled` | Không ghi | `409 EVENT_STATUS_CONFLICT` |
| Hiện lại | `hidden` | `published` | Khác `hidden` → `409 EVENT_STATUS_CONFLICT` |
| Kết thúc | `published`/`hidden`, chưa kết thúc | Hai cột = now; availability `ended` (cả khi `hidden`) | — |
| Ẩn đã tự hết giờ | `hidden`, `effective_end_at <= now` | availability `ended` | — |
| Ẩn/Hiện lại sau kết thúc | `published`/`hidden`, `effective_end_at <= now` | Không ghi | `409 EVENT_ALREADY_ENDED` |
| Kết thúc lặp | đã kết thúc (tự động hoặc tay) | Không ghi | `409 EVENT_ALREADY_ENDED` |
| Kết thúc trước giờ | `published`, `now < starts_at` | Không ghi | `409 EVENT_NOT_STARTED` |
| Kết thúc nháp/đã hủy | `draft`/`cancelled` | Không ghi | `409 EVENT_STATUS_CONFLICT` |
| Hai lần bấm đồng thời | 2 × hide | 1 thành công, 1 `409` | — |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/event/schema.ts:25-64` -- thêm `endedManuallyAt` + CHECK. Sinh migration: `pnpm --filter api db:generate` (ra `drizzle/0013_*.sql`).
- `apps/api/src/modules/event/event.service.ts:81-92` `columnsOf` -- nhận `current`; `endedManuallyAt` có thì không đặt `effectiveEndAt`. `:173` `update` -- chặn `cancelled`. `:63` `detailOf` thêm trường.
- `apps/api/src/modules/event/publish.service.ts:88-124` -- mẫu CAS/audit/revalidate để chép; đặt hide/unhide/end ở service mới `event-status.service.ts` (đăng ký trong `event.module.ts`).
- `apps/api/src/modules/event/events.controller.ts:73` -- mẫu route `publish`.
- `packages/contracts/src/errors.ts:107` -- thêm mã; map 409 ở `apps/api/src/platform/http/app-error.ts:41`, message mặc định ở `error.filter.ts:46`. `packages/contracts/src/event.ts:117` `EventDetail`.
- `apps/api/src/modules/ordering/sellability.ts:42-48` `blockingReason` -- đổi thứ tự: `ENDED` trước `HIDDEN`; cập nhật thứ tự ưu tiên trong `packages/contracts/src/sellability.ts:47-66` (`EventSaleReason`, chú thích) và test `test/ordering/sellability.test.ts` nếu có ca ẩn + kết thúc.
- Web, dưới `apps/web/app/(dashboard)/btc/[orgId]/su-kien/`: `event-wizard.tsx:241-292` tách thành `event-info-form.tsx` (giữ `valuesOf`, `fieldErrorsOf`, lỗi tại trường); `[eventId]/event-tab-list.ts:8` bỏ `soon` của `cai-dat`; `[eventId]/event-tabs.tsx:101-117` render `EventSettings` mới (`event-settings.tsx`); `event-status.ts` thêm helper badge có "Đã kết thúc" (dùng ở Tổng quan và danh sách).
- `apps/web/lib/event/api.ts:46,109` -- mẫu `updateEvent`/`publishEvent`; thêm `hideEvent`, `unhideEvent`, `endEvent`. `publish-panel.tsx:171` mẫu `hasErrorCode`. `components/ui/dialog.tsx`, mẫu dùng ở `ticket-types-editor.tsx:36,57`.
- Test: `apps/api/test/event/events.test.ts`, `publish.test.ts` (mẫu), `test/ordering/sellability.test.ts`; route mới tự vào `test/organizer/isolation.test.ts`. E2E `apps/web/e2e/` (mẫu `publish.spec.ts`).

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{errors,event}.ts`, `apps/api/src/platform/http/{app-error,error.filter}.ts` -- mã lỗi mới, `endedManuallyAt`.
- [x] `apps/api/src/modules/event/schema.ts` + `drizzle/0013_*` -- cột, CHECK.
- [x] `apps/api/src/modules/event/{event.service,event-status.service,events.controller,event.module}.ts` -- sửa có chặn hủy, giữ `effective_end_at`; 3 endpoint.
- [x] `apps/api/test/event/event-status.test.ts` (mới) + bổ sung `events.test.ts` -- phủ matrix, audit, đếm job revalidate, availability sau Ẩn/Kết thúc, CAS đồng thời.
- [x] `apps/web/lib/event/api.ts`, `su-kien/event-info-form.tsx`, `event-wizard.tsx`, `[eventId]/{event-settings,event-tabs,event-tab-list}.tsx`, `event-status.ts` -- tab Cài đặt.
- [x] `apps/web/e2e/event-settings.spec.ts` (mới) -- sửa tên, Ẩn → Hiện lại, Kết thúc qua Dialog.

**Acceptance Criteria:**
- Given Sự kiện đang bán, when Owner/Admin Ẩn ở Cài đặt, then `/e/{slug}` vẫn mở được và hiện "Sự kiện tạm dừng nhận Đơn", Hạng vé không mua được; "Hiện lại" thì bán lại.
- Given đã bấm "Kết thúc", when tải `/e/{slug}`, then hiện "Sự kiện đã kết thúc"; dashboard badge "Đã kết thúc".
- Given wizard nháp, when lưu bước 1, then hành vi không đổi (form dùng chung).

## Implementation Notes

- Migration `apps/api/drizzle/0013_event_ended_manually.sql` (tên đổi tay từ tên ngẫu nhiên của drizzle-kit, tag cập nhật trong `meta/_journal.json`).
- Ngoài Code Map: `effectiveEndAt` chuyển vào `EventSummary` để danh sách Sự kiện hiện badge "Đã kết thúc"; audit thêm `event.hidden`, `event.unhidden`, `event.ended`; `isolation.test.ts` đếm 19 route Sự kiện, ba route mới không body.
- `end` lấy `now` bằng đồng hồ app trong transaction (cùng đồng hồ với `sellability`), kiểm "đã kết thúc" trước "chưa bắt đầu".
- Web: đã kết thúc (kể cả đang ẩn) thì không còn nút nào ở "Trạng thái bán", chỉ "Đã kết thúc lúc …". Nháp: gợi ý "Tiếp tục thiết lập" thay cho nút trạng thái. 409 `EVENT_STATUS_CONFLICT`/`EVENT_ALREADY_ENDED` → toast "Trạng thái Sự kiện vừa đổi. Đã tải lại." + tải lại; `EVENT_NOT_STARTED` báo lỗi tại chỗ.
- Loop 2: `sellability` xét `ended` trước `hidden` (api + `EventSaleReason` thứ tự `cancelled, locked, ended, hidden, paused`); Ẩn/Hiện lại kiểm `notEnded` sau trạng thái. Kiểm: `pnpm turbo build typecheck lint:deps test --force` pass (api 37 file / 501 test, `event-status.test.ts` 25 test; web 12 file gồm `event-status.test.ts` mới); toàn bộ Playwright 538/538 pass (gồm `purchase-form`).
- E2E mock cũ (`event-draft`, `publish`, `ticket-types`, `purchase-form`) thêm `endedManuallyAt` / `effectiveEndAt` vì client parse bằng schema contracts.
- Kiểm: `pnpm turbo build typecheck lint:deps test --force` pass (api 37 file, `event-status.test.ts` 20 test). E2E `event-settings` + `event-draft` + `publish`: 65/66 lần đầu; `event-settings.spec.ts:173` (webkit) fail một lần khi chạy song song, sau đó 3/3 và `--repeat-each=8` 72/72 pass — flaky hiếm, chưa rõ nguyên nhân. Subagent ghi `purchase-form.spec.ts:376` (focus "Lên") fail 2/6, chưa xác nhận trên baseline.
- Chạy e2e: build web với `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001` sau khi xóa `apps/web/.next`.
- Chưa kiểm tay với `pnpm dev` + worker.

## Spec Change Log

- **Loop 1 (06/11/2026), intent_gap từ review pass 1 #1–#2.** Phát hiện: Sự kiện ẩn đã kết thúc hiện "tạm dừng nhận Đơn" vì `sellability` xét `hidden` trước `ended`; Ẩn/Hiện lại vẫn chạy sau khi kết thúc. Người dùng chọn phương án A. Đã sửa: frozen block (Approach, Always, Never, matrix thêm 2 dòng) và Code Map (`sellability.ts`). Trạng thái tránh được: Người mua thấy "tạm dừng" cho Sự kiện đã kết thúc; toast "Đã hiện lại" mà không bán lại.
  - **KEEP:** bản cài đặt pass 1 lưu ở `git stash` `1baf29153439bf0b962c291fef43aaa0b5a526d4` ("2.12 pass-1 implementation"). Xem bằng `git stash show -p --include-untracked 1baf291`. Phần đã đạt và phải giữ: migration 0013 + CHECK; `event-status.service.ts` với hàm `transition` chung (khóa dòng → kiểm trạng thái → `check` → CAS → audit → revalidate); chặn `cancelled` và giữ `effective_end_at` trong `event.service.ts`; 3 route + `isolation.test.ts` (19 route); `event-info-form.tsx` dùng chung với wizard; `event-settings.tsx`; `eventBadge`/`isEventEnded`; `effectiveEndAt` trong `EventSummary`; mock e2e cũ thêm trường; `event-status.test.ts` và `event-settings.spec.ts`. Có thể áp lại stash rồi sửa thay vì viết lại.
  - **Áp thêm các patch đã duyệt ở pass 1** (Review Triage Log #7, #8, #9, #11, #14, #19, #20): `InfoForm` có `key` theo cờ đã hủy để nạp lại giá trị server khi Sự kiện thành `cancelled`; nút "Kết thúc" gọi `change.reset()` trước khi mở Dialog; bỏ `EVENT_NOT_STARTED` khỏi `STALE_CODES` (báo lỗi tại chỗ); toast stale dùng câu riêng của web ("Trạng thái Sự kiện vừa đổi. Đã tải lại."), không ghép message server; test 409 Hiện lại đếm job như Ẩn; e2e lưu ở Cài đặt khi server trả `EVENT_CANCELLED` (toast, không banner lỗi, sau khi tải lại thì form chỉ đọc với giá trị server); vitest `eventBadge`/`isEventEnded` cho draft, cancelled, published, hidden với `effectiveEndAt` đã qua và chưa tới.

## Review Triage Log

Pass 1 (06/11/2026, 3 lớp: blind-hunter BH, edge-case-hunter EC, verification-gap VG).

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | BH | Sự kiện Ẩn rồi Kết thúc (hoặc Ẩn rồi tự hết giờ): trang công khai hiện "tạm dừng nhận Đơn" thay vì "đã kết thúc" | medium | `sellability.ts:45` xét `hidden` trước `effectiveEndAt <= now`; test `event-status.test.ts` chấp nhận `hidden`. Epic AC: "từ đó `sellability` trả Đã kết thúc", trong khi frozen block cho Kết thúc khi `hidden` và cấm đổi `sellability` | intent_gap |
| 2 | BH, EC | Ẩn / Hiện lại vẫn chạy được sau khi Sự kiện đã kết thúc; UI Sự kiện ẩn đã kết thúc vẫn hiện "Hiện lại" (toast "Đã hiện lại" mà không bán lại) | medium | `HIDE`/`UNHIDE` không có `check`; `event-settings.tsx` nhánh `hidden` xét trước `!ended`. Cùng gốc với #1: frozen block chưa nói Ẩn/Hiện lại có còn ý nghĩa sau khi kết thúc | intent_gap (gộp #1) |
| 3 | BH, EC | Sửa `startsAt` sau mốc bấm Kết thúc → `effective_end_at < starts_at` | low | Có thật (không có ràng buộc), nhưng Sự kiện vẫn "Đã kết thúc"; BTC hiếm làm, sửa cần thêm guard | reject |
| 4 | EC | Sự kiện tự kết thúc, sửa `endsAt` muộn hơn → bán lại | false | AD-14 cố ý: `effective_end_at` tính lại khi sửa giờ trừ khi có `ended_manually_at`; BTC dời lịch là đường hợp lệ | reject |
| 5 | EC | `ended_manually_at` độ chính xác µs → ghi lại từ `Date` (ms) vi phạm CHECK, 500 | false | Chỉ app ghi cột này, bằng `Date` (ms); Postgres lưu đúng ms nên đọc/ghi lại khớp. Chỉ SQL `now()` trong test mới có µs | reject |
| 6 | EC | CAS trả 0 dòng → `details.status` cũ | false | Dòng đã `FOR UPDATE` trong cùng transaction, CAS không thể trượt | reject |
| 7 | EC, BH, VG | Form Cài đặt không đồng bộ lại sau khi tải lại: Sự kiện thành đã hủy vẫn hiện giá trị chưa lưu ở form chỉ đọc | low | `useState(() => valuesOf(event))` một lần, không `key`. Đường tới: 409 `EVENT_CANCELLED` (Epic 7 mới có Hủy). Sửa: `key` theo cờ đã hủy | patch |
| 8 | EC, BH | Dialog Kết thúc hiện lỗi của Ẩn/Hiện lại trước đó | low | Nút "Kết thúc" mở Dialog không `change.reset()`; Dialog hiện `failure` | patch |
| 9 | EC, BH | Đồng hồ máy khách lệch: server trả `EVENT_NOT_STARTED` → coi là "stale", tải lại, nút vẫn bật, lặp toast | low | `STALE_CODES` gồm `EVENT_NOT_STARTED`; tải lại không đổi gì. Sửa: bỏ khỏi `STALE_CODES` để báo lỗi tại chỗ | patch |
| 10 | EC, BH | Nút bật/tắt theo `Date.now()` lúc render, không tự cập nhật khi qua giờ bắt đầu/kết thúc | low | Có thật; cần mở trang qua đúng mốc. Sửa cần timer | reject |
| 11 | BH | Toast stale ghép "Tải lại để xem trạng thái mới." với "Đã tải lại Sự kiện." | low | `toast.info(\`${messageOf(error)} Đã tải lại Sự kiện.\`)` với message server. Sửa: câu riêng của web | patch |
| 12 | BH, EC | Ba đồng hồ (app `new Date()`, `AVAILABILITY_CLOCK`, DB `now()`); ghi chú nói "cùng đồng hồ với sellability" | low | Production cùng `Date.now()`; chỉ ảnh hưởng test. Sửa ghi chú là sửa spec | reject |
| 13 | BH | Message lỗi chép ở service, `error.filter.ts`, web | low | Cùng mẫu có sẵn (`publish.service.ts` `notDraft`); chưa lệch | reject |
| 14 | BH | Thiếu test: Ẩn/Hiện lại sau khi kết thúc, PATCH Sự kiện ẩn đếm job, 403 vai không có quyền, Ẩn đua Kết thúc, 409 Hiện lại không đếm job | low | Ẩn sau khi kết thúc phụ thuộc #1; BTC chỉ có `owner`/`admin`, đều có `events.manage`; Ẩn đua Kết thúc khóa cùng dòng. Đếm job cho 409 Hiện lại là thêm một dòng | patch (đếm job), còn lại reject |
| 15 | BH | `EventSummary` thêm `effectiveEndAt` bắt buộc là đổi hợp đồng | false | Monorepo, mọi consumer cập nhật cùng diff, typecheck pass | reject |
| 16 | BH | Audit `event.ended` không ghi trạng thái/mốc trước | low | Audit có action + target + thời điểm; dữ liệu khác đọc được từ dòng | reject |
| 17 | BH | Snapshot 0013 không có trong patch; migration thiếu newline cuối | false | Snapshot bị loại khỏi patch review có chủ ý; drizzle-kit sinh file không newline như 0000–0012 | reject |
| 18 | EC | `serverFieldErrors`: path dạng mảng nhiều đoạn → `String(array)` không khớp ô | low | api trả `path` dạng chuỗi chấm (`ValidationFailed`); mảng không xuất hiện | reject |
| 19 | VG | Nhánh web `EVENT_CANCELLED` khi lưu (toast + tải lại) không có test | low | VG gap: không e2e nào submit khi server trả `EVENT_CANCELLED` | patch |
| 20 | VG | `isEventEnded` chỉ áp cho `published`/`hidden` chưa được ghim | low | VG gap: không test nào có draft/cancelled với `effectiveEndAt` đã qua | patch |

Pass 2 (06/11/2026, sau loop 1; 3 lớp BH, EC, VG).

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 21 | BH, EC | Sự kiện tự kết thúc, sửa `endsAt` muộn hơn → bán lại | false | carried #4: AD-14 cố ý tính lại khi chưa có `ended_manually_at` | reject |
| 22 | BH | Dời `endsAt` về quá khứ làm ngừng bán ngay, không hỏi xác nhận | low | Đúng AD-14; wizard nháp cũng vậy từ 2.7; không phá hủy (dời lại được) | reject |
| 23 | BH | Sự kiện đang bán xóa được chính sách hoàn vé; hint "Lưu nháp thì để trống được" sai ngoài nháp | low | `sellability.ts:92`: thiếu chính sách → mọi Hạng vé `paused`, không bán khi thiếu chính sách. Hại là BTC không biết hậu quả; sửa câu hint theo trạng thái | patch |
| 24 | BH | Nút xác nhận trong Dialog Kết thúc không chặn bấm lặp | false | `Button` có `loading` chặn click (`button.tsx:63-67`), Dialog truyền `loading={pending === 'end'}` | reject |
| 25 | BH | Ẩn/Hiện lại/Kết thúc/sửa không xét khóa Sự kiện/BTC | low | Chưa có đường khóa (Epic 7); `sellability` vẫn trả `locked`. UX yêu cầu tắt nút khi khóa | defer |
| 26 | BH, EC | Ba đồng hồ (app, `AVAILABILITY_CLOCK`, DB) | low | carried #12 | reject |
| 27 | BH, EC | Nút không tự cập nhật khi qua mốc; đồng hồ máy khách chậm tắt nút Kết thúc | low | carried #10 | reject |
| 28 | BH | CAS sau `FOR UPDATE` là code chết | false | carried #6; giữ cùng mẫu `PublishService.publish` | reject |
| 29 | BH | Audit `event.ended` không ghi mốc trước | low | carried #16 | reject |
| 30 | BH | Test CHECK chỉ `.rejects.toThrow()`, lỗi DB bất kỳ cũng pass | low | Có thật; sửa trực tiếp: kiểm tên ràng buộc | patch |
| 31 | BH | Thiếu test: PATCH Sự kiện ẩn đếm job, `startsAt == now`, 403 vai không quyền | low | carried #14; biên `>`/`>=` không người dùng nào thấy | reject |
| 32 | BH | Message lỗi chép ba nơi | low | carried #13 | reject |
| 33 | BH | Đã hủy thì form thay giá trị chưa lưu mà toast không nói | low | `EVENT_CANCELLED` chưa có đường tới (Hủy ở Epic 7); toast đã báo tải lại | reject |
| 34 | BH | `EventDetail` không `.refine` bất biến hai cột | low | DB CHECK giữ bất biến; schema chỉ parse phản hồi | reject |
| 35 | EC | Sửa `startsAt` sau mốc bấm Kết thúc | low | carried #3 | reject |
| 36 | EC | Form giữ giá trị cũ sau khi người khác sửa, lưu PATCH toàn bộ ghi đè | low | Last-write-wins như wizard 2.7; cần khóa lạc quan để sửa | reject |
| 37 | VG | Web xử lý 409 `EVENT_ALREADY_ENDED` (stale) từ nút đang hiện chưa có test | low | VG gap: không e2e nào gặp mã này khi còn nút | patch |

## Design Notes

- **Vì sao một service riêng:** ba lệnh chung khung "khóa dòng → kiểm trạng thái → CAS → audit → revalidate"; viết một hàm nội bộ `transition(ctx, eventId, { allowed, set, action })` cho cả ba, `end` thêm kiểm `starts_at <= now < effective_end_at` (kiểm "đã kết thúc" trước "chưa bắt đầu").
- **CHECK ràng buộc hai cột:** giữ AD-14 ở tầng DB — mọi lệnh sửa sau này không thể làm lệch `effective_end_at` khỏi mốc bấm.

## Verification

**Commands:**
- `pnpm turbo build typecheck lint:deps test` -- expected: pass.
- `pnpm --filter web exec playwright test e2e/event-settings.spec.ts` -- expected: pass.

**Manual checks:**
- `pnpm dev` + worker: Ẩn một Sự kiện đang bán, mở `/e/{slug}` sau ~3 giây thấy banner tạm dừng.
