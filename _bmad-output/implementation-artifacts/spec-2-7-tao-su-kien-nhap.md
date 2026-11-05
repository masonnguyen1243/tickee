---
title: 'Story 2.7: Tạo Sự kiện nháp'
type: 'feature'
created: '2026-11-03'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'c819fba7ac5be8c7a7678986b6045f3f1fe325ab'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** BTC chưa tạo được Sự kiện: `/btc/{id}` chỉ có `EmptyState` cứng, `su-kien/tao` là `ComingSoon`, mô-đun `event` còn trống. Các story còn lại của Epic 2 đều gắn vào Sự kiện.

**Approach:** Thêm bảng `events` và API tạo, sửa, đọc Sự kiện nháp cho Owner và Admin, cùng API công khai theo slug (nháp → `404 EVENT_NOT_FOUND`). Web có wizard 4 bước (chỉ bước 1 "Thông tin" làm thật), danh sách `event-card` ở `/btc/{id}` và khung tab của Sự kiện. Ảnh Sự kiện tách sang Story 2.7-b (`deferred-work.md`).

## Boundaries & Constraints

**Always:**
- Owner và Admin đều làm được (`Permission.EVENTS_MANAGE`). Route `/v1/orgs/:orgId/…` có `@RequirePermission`, truy vấn qua `orgScope(ctx)` và tự vào bộ test cách ly.
- Bảng `events` có:
  - `organization_id`, `slug` unique;
  - `status`: enum đủ `draft|published|hidden|cancelled` kèm CHECK, nhưng story này chỉ ghi `draft`;
  - `starts_at`, `ends_at`, `effective_end_at` (`timestamptz`);
  - `venue`, `description`, `refund_policy` (nullable);
  - `locked_at`, `locked_by`, `lock_reason` (null).
- `effective_end_at` = max(23:59:59 ngày kết thúc, `ends_at` + 6 giờ) theo `Asia/Ho_Chi_Minh`, tính lại mỗi lần sửa giờ.
- Giờ nhập trên web luôn hiểu theo `Asia/Ho_Chi_Minh`, không theo múi giờ của máy. API nhận và trả ISO 8601 có offset.
- Audit `event.created` và `event.updated` (chỉ ghi tên trường đổi) trong cùng transaction.
- Wizard: "Lưu nháp" có ở mọi bước; "Tiếp" lưu rồi mới sang bước sau; quay lại không mất dữ liệu; mobile hiện "Bước 1/4 · Thông tin".
- **Quyết định 03/11/2026 (Mason):**
  - **(Q1) Slug:** sinh từ tên khi tạo (bỏ dấu, `đ` → `d`, chữ thường, ký tự khác chữ/số thành `-`, tối đa 60 ký tự, tên rỗng thì dùng `su-kien`), thêm `-` và 4 ký tự `[a-z0-9]` ngẫu nhiên, ví dụ `giai-chay-ha-noi-2026-x7k2`. Trùng thì sinh lại. Slug cố định từ lúc tạo: đổi tên không đổi slug, BTC không sửa được slug.
  - **(Q2) Lưu nháp** cần tên, giờ bắt đầu và giờ kết thúc (`ends_at` > `starts_at`, báo lỗi tại trường). Các trường khác để trống được, kể cả chính sách hoàn vé.
  - **(Q3) Mở Sự kiện nháp:** bấm cả hàng `event-card` → tab Tổng quan. Tab này hiện tóm tắt thông tin và nút "Tiếp tục thiết lập" mở lại wizard ở `su-kien/{id}/thiet-lap`. Các tab khác hiện "Sắp có".

**Never:**
- Không làm ảnh Sự kiện (2.7-b), Hạng vé (2.8), form mua (2.9), mở bán (2.10), trang `/e/{slug}` (2.11), ẩn/kết thúc/email khi sửa giờ (2.12).
- Không chuyển `status` khỏi `draft`. Không làm `Idempotency-Key` (chưa có ở đâu; làm chung theo AD-31).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Tạo nháp | Admin gửi tên, giờ, không có chính sách hoàn vé | 201; `status: draft`; có slug; audit `event.created` | — |
| Thiếu giờ, hoặc kết thúc ≤ bắt đầu | — | 400 `VALIDATION_FAILED` | Lỗi tại trường |
| Kết thúc trong ngày | `endsAt` 16/11 17:00 (+07) | `effectiveEndAt` 16/11 23:59:59 (+07) | — |
| Kết thúc khuya | `endsAt` 16/11 20:00 (+07) | `effectiveEndAt` 17/11 02:00 (+07) | — |
| Sửa nháp | Đổi tên và giờ | 200; slug giữ nguyên; audit `changedFields` `["name","startsAt","endsAt"]`; `effectiveEndAt` tính lại | — |
| Hai Sự kiện cùng tên | Tên "Giải chạy" ×2 | Hai slug khác nhau, cùng tiền tố `giai-chay-` | — |
| Slug công khai | Sự kiện `draft`, hoặc slug không tồn tại | Cùng `404 EVENT_NOT_FOUND`, cùng thông điệp | — |
| Khác BTC | Id Sự kiện của BTC B gọi qua `/orgs/{A}/events/{id}` | 404 `EVENT_NOT_FOUND` | — |
| Danh sách trống | Chưa có Sự kiện | `empty-state` "Chưa có Sự kiện nào." + "Tạo Sự kiện" | — |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/event.ts` mới, export qua `index.ts`:
  - Schema: `EventDraftInput` (POST và PATCH), `EventDetail`, `EventSummary`, `EventList`, `PublicEvent`.
  - Hàm dùng chung: `effectiveEndAt(endsAt)`, `slugBase(name)`, `eventPath(orgId, eventId, sub?)`.
  - `ORGANIZATION_SECTION_SEGMENTS` (`organizer.ts:136`) giữ nguyên: danh sách vẫn ở `/btc/{id}`, tạo mới vẫn ở `su-kien/tao`.
- `EVENT_NOT_FOUND`: thêm vào `contracts/src/errors.ts`, `DEFAULT_STATUS` (404) trong `api/src/platform/http/app-error.ts`, `MESSAGES` trong `error.filter.ts`. Các chỗ này khai báo kiểu `Record`, nên thiếu chỗ nào sẽ báo lỗi biên dịch.
- `apps/api/src/modules/event/` (`index.ts` hiện chỉ có `export {}`):
  - `schema.ts`: theo mẫu `organizer/schema.ts` (`id()`, `createdAt()`, `timestamptz()`, enum bằng `text({enum})` + `check`, FK `organizations.id`, `updatedAt` có `$onUpdate`). Thêm index `(organization_id, created_at)`.
  - `event.service.ts`, `events.controller.ts` (`orgs/:orgId/events`: `POST`, `GET`, `GET :eventId`, `PATCH :eventId`), `public-events.controller.ts` (`GET events/:slug`, `@Public()` từ `platform/http/public.decorator.ts`), `event.module.ts`.
  - Controller theo mẫu `payout-account.controller.ts:31-36`: `@RequirePermission`, `@Access() ctx`, `parseRequest(Schema, body)`. `:eventId` không phải UUID thì trả 404.
  - Đăng ký trong `api.module.ts:30-42`. Không đăng ký lại `PermissionGuard`: nó đã là guard global từ `OrganizerModule`. `module-graph.cjs` đã cho `event → organizer`.
- Migration `0010`: `pnpm --filter @tickee/api db:generate --name events`. Quyền DML tự cấp khi chạy migrate.
- `platform/audit/audit.ts:5-49`: thêm `'event.created' | 'event.updated'`.
- Web:
  - `organization-home.tsx:78-100`: thay `EmptyState` cứng bằng danh sách `event-card` (DESIGN L554: thẻ `rounded-lg bg-card px-card-padding shadow-card`, ô 56px nền thay thế vì chưa có ảnh, tên, ngày-giờ dạng "Chủ nhật, 16/11/2026 · 07:00", `status-badge` tone `neutral` "Nháp").
  - `su-kien/tao/page.tsx`: thay `ComingSoon` bằng wizard. Thêm `su-kien/[eventId]/page.tsx` (tab qua `ui/tabs.tsx`, chọn bằng `?tab=`; mặc định Tổng quan) và `su-kien/[eventId]/thiet-lap/page.tsx` (wizard cho Sự kiện đã có).
  - Thêm `components/tickee/wizard-stepper.tsx` (DESIGN L697) và `components/ui/textarea.tsx`. Giờ nhập bằng `Input type="datetime-local"`.
  - Thêm `lib/event/api.ts` theo mẫu `lib/organizer/api.ts` (query key `['event', …]`).
  - Form làm theo mẫu `create-organization-form.tsx`: `useState` + `safeParse`, `serverIssuePaths`, `aria-invalid`.
- Test:
  - `apps/api/test/event/events.test.ts` mới, dùng `createHarness` và `signUp` (`test/identity/harness.ts`).
  - `test/organizer/isolation.test.ts:47-66`: thêm các route mới. Body `{}` và id ngẫu nhiên phải ra 400/404, không ra 500.
  - `apps/web/e2e/event-draft.spec.ts` mới, mock bằng `organizer-mock.ts`. Thêm `PATCH` vào danh sách method CORS của mock.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{event,errors,index}.ts` + `packages/contracts/test/event.test.ts` -- schema, `effectiveEndAt` (hai dòng matrix về giờ kết thúc, ngày cuối tháng/năm), `slugBase` (dấu, `đ`, ký tự lạ, tên rỗng, cắt 60 ký tự).
- [x] `apps/api/src/modules/event/*`, `api.module.ts`, `platform/audit/audit.ts`, `platform/http/{app-error,error.filter}.ts`, migration `0010` -- bảng, service, các controller.
- [x] `apps/api/test/event/events.test.ts`, `test/organizer/isolation.test.ts` -- phủ matrix; Admin làm được; slug sinh lại khi trùng (ép trùng bằng hàm sinh ngẫu nhiên tiêm được).
- [x] `apps/web/components/{tickee/wizard-stepper,ui/textarea}.tsx`, `lib/event/api.ts`, `app/(dashboard)/btc/[orgId]/{organization-home.tsx,su-kien/**}` -- wizard (bước 2–4 hiện "Sắp có" kèm "Lưu nháp"), danh sách, Tổng quan, khung tab.
- [x] `apps/web/e2e/{event-draft,dashboard-shell}.spec.ts`, `e2e/organizer-mock.ts` -- tạo nháp, lỗi tại trường, quay lại không mất dữ liệu, bấm hàng vào Tổng quan, "Tiếp tục thiết lập", 375px không cuộn ngang.

**Acceptance Criteria:**
- Given wizard đang ở bước 2, when bấm quay lại bước 1, then mọi ô còn nguyên giá trị đã nhập.
- Given máy người dùng đặt múi giờ khác `+07`, when nhập 07:00 ngày 16/11/2026, then API nhận `2026-11-16T07:00:00+07:00` và danh sách hiện "Chủ nhật, 16/11/2026 · 07:00".
- Given "Lưu nháp" ở bước 1 của Sự kiện mới, when lưu thành công, then URL chuyển sang `su-kien/{id}/thiet-lap`, nên bấm lưu lần nữa là `PATCH`, không tạo Sự kiện thứ hai.

### Review Findings

Code review sau merge (05/11/2026, diff `c819fba..aed6332`, 4 lớp: blind-hunter BH, edge-case-hunter EC, verification-gap VG, acceptance-auditor AA).

- [x] [Review][Patch] Danh sách Sự kiện ở trang BTC hiện banner lỗi cả với lỗi đã xử lý nơi khác (`TOTP_REQUIRED`, `CONSENT_REQUIRED`, `UNAUTHENTICATED`, `NOT_A_MEMBER`); dùng `handledElsewhere` như `EventGate` (BH, low) [apps/web/app/(dashboard)/btc/[orgId]/organization-home.tsx:160]
- [x] [Review][Patch] Server trả `VALIDATION_FAILED` với path lạ thì wizard báo "Tên Sự kiện tối đa 200 ký tự." dù tên hợp lệ, và không test nào chạy nhánh này; đổi fallback sang thông điệp chung ở ô tên + e2e trả path `unknown` (BH, VG, low) [apps/web/app/(dashboard)/btc/[orgId]/su-kien/event-wizard.tsx:174]
- [x] [Review][Patch] Giờ input nhận phần lẻ giây nhưng `toEventIso` trả về bỏ phần lẻ, nên client API gửi lại giá trị vừa nhận sẽ ghi audit `event.updated` giả; thêm `precision: 0` cho giờ input (EC, AA, low) [packages/contracts/src/event.ts:58]
- [x] [Review][Patch] Chưa có test cho slug trùng cả 5 lần (dừng sau 5 lần gọi, không lặp vô hạn) (VG) [apps/api/test/event/events.test.ts]
- [x] [Review][Patch] e2e kiểm không cuộn ngang ở 375px, trong khi epic yêu cầu 320px (AA) [apps/web/e2e/event-draft.spec.ts:405]
- [x] [Review][Defer] `PATCH` và trang `thiet-lap` không chặn Sự kiện không còn nháp hoặc bị khóa [apps/api/src/modules/event/event.service.ts:167] — deferred: chưa đạt tới được ở 2.7 (triage #6); phải có guard và mã lỗi khi 2.10/2.12 cho phép chuyển khỏi `draft` hoặc khi Epic 7 đặt `locked_at`
- [x] [Review][Defer] API công khai theo slug chưa loại Sự kiện bị khóa và chưa có test cho `hidden`/`cancelled` [apps/api/src/modules/event/event.service.ts:212] — deferred: 2.11 chốt luật hiển thị (triage #7)

**Rejected:**
- Ghi đè khi hai người sửa cùng lúc (BH, EC) — low, đã reject ở triage #8; sửa phải thêm token phiên bản vào contract.
- POST thành công nhưng mất response, "Thử lại" tạo nháp thứ hai (BH, EC) — low, Never của story loại `Idempotency-Key` (triage #20).
- Bấm hai lần thật nhanh tạo hai POST (EC) — low; `submit` chặn khi `busy`, hai cú bấm của người cách nhau đủ để `isPending` cập nhật.
- Danh sách không phân trang (BH, EC) — low, triage #11.
- `?buoc=` và `?tab=` không theo bước/tab hiện tại (BH, EC) — low, triage #17, #21.
- Hết 5 lần thử slug thì trả 500 (BH, EC) — low, triage #10 (test cho nhánh này ở mục Patch).
- `formatEventDateTime` không chặn input sai (BH) — low, triage #18; dữ liệu đã qua schema.
- Rời trang mất dữ liệu chưa lưu (BH) — low, triage #16.
- Form giữ giá trị chưa trim sau khi lưu (BH) — low; chỉ khác khoảng trắng đầu cuối, sửa bằng ghi đè `values` sẽ mất chữ gõ trong lúc đang lưu.
- `PATCH` body sai trả 400 trước khi kiểm Sự kiện có thuộc BTC (AA) — false; matrix cho phép 400/404 và không lộ dữ liệu.
- "Quay lại"/"Tiếp" bị bỏ qua khi đang lưu (AA) — low; lưu xong trong chưa tới một giây và nút "Lưu" đã có spinner.
- AC ghi "Chủ nhật, 16/11/2026" trong khi đó là thứ Hai (AA) — sửa phải sửa spec frozen; Mason tự sửa AC (đã ghi ở Implementation Notes, triage #23).

## Implementation Notes

- **16/11/2026 là thứ Hai**, không phải Chủ nhật: ví dụ "Chủ nhật, 16/11/2026 · 07:00" ở AC và DESIGN chỉ minh họa định dạng. `formatEventDateTime` tính đúng lịch, nên danh sách hiện "Thứ hai, 16/11/2026 · 07:00"; test contracts kiểm thêm 15/11/2026 → "Chủ nhật".
- Giờ Việt Nam tính bằng offset cố định `+07:00` (VN không có giờ mùa hè), không dùng `Intl` hay múi giờ của máy.
- `PATCH` nhận đủ `EventDraftInput` (thay toàn bộ); không đổi gì thì không ghi audit. `effectiveEndAt` không nằm trong `changedFields` (là giá trị suy ra).
- Wizard giữ bước trong state; sau lần lưu đầu của Sự kiện mới, `router.replace` sang `su-kien/{id}/thiet-lap?buoc=N` (cache Sự kiện đã nạp sẵn nên mở lại ngay với dữ liệu vừa lưu).
- API công khai `GET /v1/events/:slug` trả Sự kiện có `status <> 'draft'`; story này không có cách chuyển khỏi nháp nên luôn 404 ngoài test.

## Spec Change Log

## Review Triage Log

Pass 1 (03/11/2026, 3 lớp: blind-hunter BH, edge-case-hunter EC, verification-gap VG).

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | EC, BH | Năm ngoài khoảng hợp lý: năm 0–99 làm `Date.UTC` hiểu thành 1900+năm nên `effectiveEndAt` sai; năm 9999 cộng 6 giờ thành năm 5 chữ số nên `EventDetail.parse` ở web hỏng | medium | `Date.UTC(26,10,16)` → `1926-11-16` (đã chạy thử). `datetime-local` cho gõ năm 4 chữ số bất kỳ, gõ nhầm "0026" là chuyện có thể xảy ra | patch |
| 2 | VG | Đường lỗi `400 VALIDATION_FAILED` từ server về trường của wizard chưa có test nào chạy qua | — | Mock `invalid()` không bao giờ trả về vì `safeParse` phía web chặn trước | patch |
| 3 | VG | Banner "Chưa lưu được Sự kiện" và "Thử lại" của wizard chưa có test | — | Không handler nào trả 5xx | patch |
| 4 | VG | Lỗi 5xx của danh sách Sự kiện và `EventGate` chưa có test | — | Chỉ có test cho 200/404. Thêm một test là rẻ | patch |
| 5 | VG (other) | Wizard hiện banner lỗi cả khi gặp `TOTP_REQUIRED`/`NOT_A_MEMBER`, đè lên xử lý toàn cục | low | `EventGate.handledElsewhere` loại hai mã này, còn `failure` của wizard thì không. Sửa là dùng cùng danh sách | patch |
| 6 | BH, EC | `PATCH` không kiểm `status`/khóa; trang `thiet-lap` mở được cho Sự kiện không còn nháp | false | Story này không có đường nào chuyển khỏi `draft` hay đặt `locked_at`. Ghi ở Implementation Notes cho 2.10/2.12 | reject |
| 7 | BH, EC | API công khai trả Sự kiện bị khóa hoặc `hidden` | false | Như #6, không đạt tới được. Theo FR-7, `hidden` vẫn mở được bằng link; 2.11 sẽ chốt | reject |
| 8 | BH | Owner và Admin sửa cùng lúc thì ghi đè nhau | low | Có thật, nhưng hiếm; sửa phải thêm token phiên bản vào contract | reject |
| 9 | BH | `PATCH` thay toàn bộ, nên client gửi thiếu trường sẽ xóa trường đó | low | Client duy nhất (wizard) luôn gửi đủ trường; đã ghi ở Implementation Notes | reject |
| 10 | BH | Hết 5 lần thử slug thì trả 500 | low | Hậu tố có 36⁴ ≈ 1,7 triệu giá trị mỗi tiền tố | reject |
| 11 | BH | Danh sách Sự kiện không phân trang | low | Mỗi BTC có ít Sự kiện ở MVP | reject |
| 12 | BH | Contract chưa có `effectiveEndAt` để hiện "Đã kết thúc" | false | Mọi Sự kiện còn nháp nên badge "Nháp" là đúng; 2.11/2.12 sẽ thêm | reject |
| 13 | BH | Server trả path lạ thì wizard báo lỗi ở ô tên dù tên hợp lệ | low | Chỉ gặp khi web và server lệch luật; sửa phải thêm nhánh | reject |
| 14 | BH | Thông điệp `startsAt`/`endsAt` không theo nguyên nhân thật | false | `datetime-local` chỉ cho giá trị hợp lệ hoặc rỗng. Zod 4 bỏ qua `refine` của object khi trường lỗi, nên không ra "phải sau giờ bắt đầu" khi thiếu giờ bắt đầu | reject |
| 15 | BH | "Tiếp" ở bước 2–4 vẫn gửi PATCH | false | Đúng như spec quy định ("Tiếp" lưu rồi mới sang bước sau) | reject |
| 16 | BH | Rời trang thì mất dữ liệu chưa lưu, không có cảnh báo | low | Intent không yêu cầu; làm thì thêm hành vi mới | reject |
| 17 | BH | Tab không theo URL khi có `Link` cùng trang khác `?tab=` | low | Chưa có link nào như vậy | reject |
| 18 | BH | Nhiều `role="alert"` luôn có mặt; `formatEventDateTime` không chặn input sai | low | Giống mẫu `members-manager.tsx:56`. Input đã qua schema nên không sai | reject |
| 19 | EC | Wizard bỏ giây khi lưu lại | false | Mọi Sự kiện tạo từ web đều có giây `:00` | reject |
| 20 | EC | Mất response của POST rồi bấm "Thử lại" sẽ tạo hai nháp | low | Phần Never loại `Idempotency-Key` khỏi story này (AD-31) | reject |
| 21 | EC | `?buoc=` không cập nhật khi đổi bước | low | Tải lại chỉ mở bước khác, không mất dữ liệu | reject |
| 22 | EC | Thông điệp lỗi tính từ `values` hiện tại, không từ body đã gửi | low | Chỉ gặp khi người dùng sửa ô trong lúc đang lưu | reject |
| 23 | EC | AC ghi "Chủ nhật, 16/11/2026" nhưng ngày đó là thứ Hai | false | Code theo đúng lịch; sửa thì phải sửa spec (khối frozen). Báo Mason | reject |

## Design Notes

- **`effectiveEndAt` và `slugBase` đặt ở contracts:** api và test dùng chung một cách tính. Story 2.12 sẽ thêm nhánh `ended_manually_at` ở service.
- **Sinh lại slug khi trùng:** bắt `23505` của unique index slug rồi thử lại, tối đa 5 lần. Không kiểm trước bằng SELECT vì có thể hai request chạy song song.

## Verification

**Commands:**
- `pnpm turbo build typecheck lint:deps test` -- expected: tất cả pass (Postgres chạy bằng `docker compose up -d`).
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 pnpm --filter @tickee/web build && pnpm --filter @tickee/web test:e2e` -- expected: pass trên `ios-webkit` và `android-chromium`.
