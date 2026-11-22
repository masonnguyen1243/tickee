---
title: 'Story 5.1: Link mời CTV và tab Check-in'
type: 'feature'
created: '2026-11-22'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '22b370c4df237aa9406fea0efa0023ed8f8b66d0'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Owner/Admin chưa có cách mời CTV soát vé cho một Sự kiện. Tab Check-in đang là "Sắp có", mô-đun `checkin` còn trống (FR-26, AD-30, UX-DR39).

**Approach:** Thêm bảng `checker_invites` trong `checkin`, route `GET`/`POST /v1/orgs/:orgId/events/:eventId/checker-invite` (quyền `checkers.manage`), và tab Check-in hiện link mời chung: trạng thái còn hạn/hết hạn kèm thời điểm hết hạn, "Sao chép link", "Tạo link mới".

**Quyết định (Mason, 22/11/2026):**
- Giữ một spec cho cả API và web (khoảng 3.000–3.500 token).
- Màn "Link mời đã hết hạn" khi mở link cũ thuộc 5.2 (AC "link hết hạn, bị thu hồi hoặc token sai" của 5.2). 5.1 chỉ đảm bảo link cũ bị thu hồi, có test ở DB và API. Tới khi 5.2 xong, mở link ra 404.
- Link đầy đủ chỉ giữ trong bộ nhớ (cache React Query), không `sessionStorage`. Chuyển tab trong app vẫn sao chép được. Tải lại hoặc đóng trang thì "Sao chép link" bị tắt kèm lý do "Link đầy đủ chỉ hiện ngay sau khi tạo. Tạo link mới để có link gửi đi."
- Mục hoãn "`PermissionGuard` và cổng `AccessResolver` đang gắn với `:orgId`…" (`deferred-work.md:84`) chuyển cả sang 5.2.

## Boundaries & Constraints

**Always:**
- Token `randomBytes(16)` base64url (22 ký tự), DB chỉ lưu sha256 hex. Link dạng `{origin}/loi-moi-ctv#<token>` (token sau `#`, như `/loi-moi-btc`). Token chỉ có trong response `POST`, không vào audit, log hay `GET`.
- `checker_invites` có `organization_id NOT NULL` (không FK), `event_id` FK `events`, `token_hash` unique + CHECK hex 64, `expires_at`, `revoked_at`, `created_at`; unique index một phần `(event_id) WHERE revoked_at IS NULL`. Chỉ `revoked_at` được UPDATE (`UPDATE_PROTECTED_COLUMNS`).
- `POST`: khóa Sự kiện `FOR UPDATE` trong `orgScope`, kiểm trạng thái, đặt `revoked_at = now()` cho mọi link chưa thu hồi của Sự kiện, rồi INSERT với `expires_at = LEAST(now() + 7 ngày, effective_end_at)`, tất cả trong một transaction. Audit `checker_invite.revoked` cho từng link cũ và `checker_invite.created`, target `{type: 'checker_invite', id}`.
- `GET` trả link mới nhất hoặc `null`. `expiresAt` = `LEAST(expires_at, effective_end_at)`; `active` = chưa thu hồi, `now()` trước `expiresAt` và Sự kiện chưa `cancelled`, tính bằng `now()` của DB.
- Kiểm Sự kiện trước mọi thứ khác: Sự kiện lạ hoặc của BTC khác → `404 EVENT_NOT_FOUND`.
- Web: đã có link đang hoạt động thì "Tạo link mới" mở `ConfirmDialog` nêu hậu quả ("Link cũ hết hiệu lực ngay. CTV đã nhận lời mời vẫn giữ quyền."). Lần tạo đầu không hỏi. Nút tắt luôn kèm lý do hiển thị; nút gọi mạng dùng `loading`.

**Never:**
- Không thêm route/endpoint thu hồi riêng hay nút "Thu hồi link": thu hồi link chỉ xảy ra khi "Tạo link mới".
- Không làm bảng `checkers`, danh sách CTV, `checkin-progress`, Màn quét hay trang nhận lời mời (5.2, 5.6, 5.7). Không đổi `quet-ve`, nav, layout `(checkin)`.
- Không `Idempotency-Key` cho `POST` (thử lại chỉ tạo thêm một link, link trước bị thu hồi).
- Không sửa migration cũ, `module-graph.cjs`, tên `AuditAction` cũ, `ROLE_PERMISSIONS`.
- Không đổi `PermissionGuard`/`AccessResolver`: mục hoãn "`PermissionGuard` và cổng `AccessResolver` đang gắn với `:orgId`…" (từ spec 2.1) thuộc story nhận 5.2.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tạo lần đầu | `published`/`hidden`, chưa kết thúc, chưa có link | `201 {invite:{id,createdAt,expiresAt,active:true}, token}`; DB có hash, không có token | N/A |
| Tạo lại | Đã có link chưa thu hồi | Link cũ có `revoked_at`, link mới active; vẫn đúng một dòng `revoked_at IS NULL` | N/A |
| Sự kiện sắp kết thúc | `effective_end_at` = now + 2 ngày | `expiresAt` = `effective_end_at` | N/A |
| Trạng thái chặn | `draft` / `cancelled` / đã kết thúc (kể cả "Kết thúc" sớm) | Không ghi dòng nào | `409 EVENT_STATUS_CONFLICT` / `409 EVENT_CANCELLED` / `409 EVENT_ALREADY_ENDED` |
| Link hết hạn | Quá `expiresAt`, hoặc Sự kiện kết thúc sớm sau khi tạo link | `GET` → `active:false`; web hiện "Đã hết hạn" kèm thời điểm | N/A |
| Hai lần tạo đồng thời | Hai `POST` song song | Khóa Sự kiện xếp hàng; còn đúng một link active | N/A |
| Ngoài BTC | eventId của BTC khác / không phải thành viên | Không lộ dữ liệu | `404 EVENT_NOT_FOUND` / `403 NOT_A_MEMBER` |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/organizer.ts:17-51` -- `Permission.CHECKERS_MANAGE` đã có cho Owner và Admin; `ORGANIZATION_INVITATION_PATH`/`_TTL_DAYS` (:162-164) là mẫu đặt hằng.
- `packages/contracts/src/tickets.ts:19-23` -- mẫu `sharedTicketUrl(origin, token)`. `errors.ts` -- dùng lại `EVENT_NOT_FOUND`, `EVENT_STATUS_CONFLICT` (`details.status`), `EVENT_CANCELLED`, `EVENT_ALREADY_ENDED`; không thêm mã.
- `apps/api/src/modules/event/form.controller.ts:12` -- mẫu controller sub-resource (`@RequirePermission`, `@Access() ctx`, `parseRequest`). `event-status.service.ts:73-131` -- mẫu tx khóa → kiểm → ghi → audit.
- `apps/api/src/modules/event/ticket-type.service.ts:40` (`lockEventForTicketTypes`) và `public-event.ts:24` (`endedNow`) -- mẫu cho hàm khóa Sự kiện mới; `event/index.ts` export `eventNotFound`.
- `apps/api/src/modules/organizer/invitation-token.ts:4-14` -- mẫu sinh token/hash. Không import được từ `checkin`, phải chép.
- `apps/api/src/modules/organizer/members.service.ts:138-166` -- mẫu thu hồi bằng `revokedAt: sql\`now()\`` + `.returning()` rồi audit.
- `apps/api/src/modules/organizer/schema.ts:153-155` -- mẫu unique index một phần; `ticketing/schema.ts:32-33` -- FK sang `events`, `organization_id` không FK.
- `apps/api/src/platform/audit/audit.ts:6-173` -- union `AuditAction` (tên mới dạng quá khứ, spine :278). `platform/db/grants.ts:29` -- `UPDATE_PROTECTED_COLUMNS`. `platform/db/clock.ts` -- chỗ duy nhất được `SELECT now()`.
- `apps/api/test/organizer/isolation.test.ts:55,156-159,275,282` -- danh sách route, đếm route Sự kiện (23), regex POST không body.
- `apps/api/test/event/ticket-types.test.ts:31-79`, `event-status.test.ts:64-74,165` -- harness, seed Admin, đăng Sự kiện, ép kết thúc.
- `apps/web/app/(dashboard)/btc/[orgId]/su-kien/[eventId]/event-tab-list.ts:7`, `event-tabs.tsx:121-136` -- tab `check-in` đang `soon`; thêm nhánh render.
- `apps/web/lib/clipboard.ts:4` (`copyWithToast`), `components/tickee/confirm-dialog.tsx`, `status-badge.tsx`, `components/ui/button.tsx` (`loading`), `event-settings.tsx:403-413` (nút tắt kèm lý do), `su-kien/event-status.ts:25` (`isEventEnded`), `formatVnDateTime` (`contracts/src/event.ts:392`), `public-event-link.tsx:9-14` (origin sau hydrate).
- `apps/web/lib/event/api.ts:26-51`, `lib/api/client.ts:92`, `lib/api/message-of.ts:7` -- mẫu query key, fetcher, thông báo lỗi.
- `apps/web/e2e/event-settings.spec.ts`, `e2e/organizer-mock.ts` -- mẫu e2e có mock API. Không phá `e2e/event-draft.spec.ts:318` (tên tab).

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/checkin.ts` (+ export ở index) -- `CHECKER_INVITE_PATH='/loi-moi-ctv'`, `checkerInviteUrl`, `CHECKER_INVITE_TTL_DAYS=7`, pattern token, schema `CheckerInvite`, `CheckerInviteResponse {invite|null}`, `CreatedCheckerInvite {invite, token}`.
- [x] `apps/api/src/modules/event/checkin-gate.ts` (mới) + `index.ts` -- `lockEventForCheckerInvite(tx, ctx, eventId)`: `FOR UPDATE` trong `orgScope`, trả `status`, `effectiveEndAt`, `ended` (SQL `now() > effective_end_at`); thiếu → `eventNotFound()`.
- [x] `apps/api/src/modules/checkin/{schema,invite-token,checker-invite.service,checker-invite.controller,checkin.module,index}.ts` + `api.module.ts` -- bảng, service, route `GET`/`POST` theo Boundaries.
- [x] `apps/api/drizzle/0033_checker_invites.sql` -- sinh bằng `pnpm --filter @tickee/api db:generate --name checker_invites`.
- [x] `apps/api/src/platform/audit/audit.ts`, `platform/db/grants.ts` -- thêm `checker_invite.created`, `checker_invite.revoked`; khóa mọi cột trừ `revoked_at`.
- [x] `apps/api/test/checkin/checker-invite.test.ts` + `test/organizer/isolation.test.ts` -- test mọi dòng Matrix (song song: `Promise.all` hai `POST`), audit không chứa token, hash đúng sha256 của token; đăng ký route, quyền `CHECKERS_MANAGE`, sửa số đếm và regex.
- [x] `apps/web/lib/checkin/{api,invite-view}.ts` + `test/checker-invite-view.test.ts` -- fetcher, query key; hàm thuần tính nhãn/tone, lý do tắt của hai nút (nháp: "Đăng Sự kiện trước khi mời CTV."; đã kết thúc; đã hủy), có cần hỏi trước khi tạo.
- [x] `apps/web/app/(dashboard)/btc/[orgId]/su-kien/[eventId]/checkin-tab.tsx`, `event-tab-list.ts`, `event-tabs.tsx` -- bỏ `soon`, render tab: link đầy đủ (chỉ ngay sau khi tạo), `StatusBadge`, thời điểm hết hạn, hai nút, `ConfirmDialog`, `StatusBanner` khi lỗi.
- [x] `apps/web/e2e/checkin-invite.spec.ts` -- tạo lần đầu → sao chép (toast "Đã sao chép"), tạo lại qua Dialog, Sự kiện đã kết thúc → nút tắt kèm lý do.

**Acceptance Criteria:**
- Given Owner hoặc Admin, when mở `?tab=check-in`, then thấy khối link mời với trạng thái, thời điểm hết hạn (giờ Việt Nam) và hai nút; chưa có link thì hiện "Chưa có link mời" cùng "Tạo link mới".
- Given vừa tạo link, when bấm "Sao chép link", then clipboard nhận đúng `{origin}/loi-moi-ctv#<token>` và có toast "Đã sao chép".
- Given bất kỳ thao tác tạo nào, when xem `audit_events`, then có `checker_invite.created` (và `checker_invite.revoked` nếu có link cũ), không chứa token hay hash.

## Implementation Notes

- Đã làm (22/11/2026): đủ 9 task. File mới chính: `apps/api/src/modules/checkin/` (schema, token, service, controller, module), `apps/api/src/modules/event/checkin-gate.ts` (`lockEventForCheckerInvite`, `checkinEventOf`), `apps/api/drizzle/0033_checker_invites.sql`, `packages/contracts/src/checkin.ts`, `apps/web/lib/checkin/{api,invite-view}.ts`, `[eventId]/checkin-tab.tsx`.
- `GET` sắp link chưa thu hồi trước, rồi theo `id` (UUIDv7) giảm dần, không theo `created_at`: hai `POST` song song có `created_at` = lúc bắt đầu transaction nên có thể đảo thứ tự.
- `checkin` không JOIN được `events`, nên `effective_end_at` đọc qua `event` rồi gửi lại Postgres làm tham số `timestamptz`; mất phần dưới mili giây (test cho phép lệch < 1 ms).
- Web: token giữ trong cache TanStack Query (`skipToken`, `gcTime: Infinity`), gắn với id link. `checkerInviteView` coi link hết hiệu lực khi Sự kiện đang hiện đã hủy hoặc đã kết thúc, và hạn hiển thị không vượt `effectiveEndAt`, để tab đúng ngay sau "Kết thúc" mà chưa tải lại link. 409 trạng thái Sự kiện → toast "Trạng thái Sự kiện vừa đổi. Đã tải lại." và tải lại Sự kiện cùng link.
- Thêm ngoài spec: index thường `checker_invites_event_id_idx`; toast "Đã tạo link mời CTV mới."; header `cache-control: no-store` cho hai route; `useOrigin` của `public-event-link.tsx` được export để dùng lại. Lý do tắt thêm: "Sự kiện đã kết thúc, không tạo được link mời mới.", "Sự kiện đã hủy, không tạo được link mời mới.", "Link đã hết hạn. Tạo link mới để có link gửi đi.", "Link đã hết hạn.".
- Kiểm (22/11/2026): API `test/checkin` + `isolation` 26 pass; web unit 413 pass; e2e `checkin-invite` + `event-draft` 34 pass; `typecheck`, `lint:deps` pass. Subagent đã chạy toàn bộ API (1636), Playwright (1130), contracts (337), đều pass.

- Vá sau review lượt 1 (22/11/2026, P1–P6): `lockEventForCheckerInvite` coi Sự kiện đã kết thúc khi `ended_manually_at IS NOT NULL OR now() >= effective_end_at`; `CheckinEventRef` thêm `endedManually`, `latest` trả `active:false` khi Sự kiện đã bấm "Kết thúc". Test mới: API ca "Kết thúc" ghi mốc còn tương lai so với đồng hồ DB (đặt cả `ended_manually_at` và `effective_end_at` = now + 5 giây, vì ràng buộc `events_ended_manually_check` bắt hai cột bằng nhau) → 409; vòng quyền cột thêm `organization_id`, `id`; `packages/contracts/test/checkin.test.ts`; unit ca giới hạn hạn khi Sự kiện chưa kết thúc; e2e "Admin khác vừa tạo link mới" (đã thử đột biến chốt id: test hỏng) và ca tạo lỗi trong Dialog.

## Spec Change Log

## Review Triage Log

Lượt 1 (22/11/2026). VG = Verification Gap, BH = Blind Hunter, EC = Edge Case Hunter.

| # | Phát hiện | Verdict | Bằng chứng | Hướng |
|---|---|---|---|---|
| VG1 | Chốt `stored.inviteId === invite.id` (`checkin-tab.tsx:116`) không có test | medium | Lớp VG đã kiểm: mọi ca e2e có token khớp `invites[0]` hoặc không có token; đổi dòng 116 thành `stored?.token` thì vẫn pass. Hỏng thì sao chép link đã bị Admin khác thay | patch (P1) |
| VG2 | Tạo link lỗi bên trong `ConfirmDialog` không có test | medium | Lớp VG đã kiểm: ca 500 ở `:212` không có link sẵn nên không mở Dialog. Bỏ prop `failure` của Dialog thì không test nào hỏng, lỗi im lặng | patch (P2) |
| VG3 | Test quyền cột bỏ sót `organization_id`, `id` | low | Vòng lặp ở `checker-invite.test.ts:346` chỉ thử 4 cột; bỏ `organization_id` khỏi `grants.ts:90` thì test vẫn pass. Sửa bằng hai phần tử, không thêm nhánh | patch (P3) |
| BH1 | Sự kiện đã hủy: badge "Đã hết hạn" kèm "Hết hạn lúc <tương lai>" | low | Đúng: `latest` chỉ đặt `active:false`, `expiresAt` giữ nguyên. Nhưng chưa có route nào đặt `events.status='cancelled'` (chỉ 7.1 làm), người dùng chưa gặp; sửa cần thêm nhánh câu chữ | reject, để 7.1 xét (deferred-work) |
| BH2 | Hạn lưu `LEAST(now+7 ngày, effective_end_at)` làm link chết ở mốc cũ khi Sự kiện kéo dài | low | Đúng khi sửa `endsAt` muộn hơn sau khi tạo link. Nhưng công thức này là AC 5.1 và AD-30 trong Intent đã khóa; BTC thấy "Đã hết hạn" và tạo link mới được. Sửa phải đổi spec | reject |
| BH3 | Web không so hạn với đồng hồ; tab mở qua mốc hết hạn vẫn "Còn hạn" | low | Đúng nếu tab giữ focus liên tục qua đúng mốc (refetch khi focus/mount sau 30 giây sẽ sửa). Hiếm, link chết chỉ khiến CTV thấy "hết hạn"; sửa cần thêm timer | reject (gộp EC6) |
| BH4 | Ca chặn không kiểm "không audit" | false | `assertCanInvite` ném lỗi bên trong `db.transaction` trước mọi lệnh ghi, transaction rollback nên không thể có dòng audit sót | reject |
| BH5 | `packages/contracts/src/checkin.ts` chưa có test | low | Đúng: `tickets.test.ts:32-42`, `organizer.test.ts:148-150` có test cho helper cùng loại, còn `checkerInviteUrl`, pattern token, hằng thì chưa. Thêm test, không thêm nhánh | patch (P4) |
| BH6 | `GET` đọc Sự kiện và link ở hai snapshot | low | Đúng: hai câu ngoài transaction; "Kết thúc" commit đúng giữa hai câu thì trả `active:true` với hạn cũ. Cửa sổ vài mili giây, lần tải sau đúng, web còn chặn bằng `isEventEnded` | reject (gộp EC4) |
| BH7 | Biên `now() > effective_end_at` lệch với `<=` ở `event-status.service.ts:43` | low | Đúng, cùng gốc với EC1–EC3: định nghĩa "đã kết thúc" của `lockEventForCheckerInvite` khác phần còn lại | patch (P5) |
| BH8 | Admin khác thay link thì câu "Link đầy đủ chỉ hiện ngay sau khi tạo…" không nói link cũ đã chết | low | Đúng, nhưng chỉ khi nhiều Admin cùng tạo link; sửa cần thêm đầu vào và nhánh câu chữ mới | reject |
| BH9 | e2e thiếu: Sự kiện hủy, 409 khác, 500 trong Dialog, refetch ra id khác | medium | Phần 500 trong Dialog và id khác trùng VG2, VG1. Sự kiện hủy chưa đạt được trước 7.1 (unit test đã có); 409 `EVENT_CANCELLED`/`EVENT_STATUS_CONFLICT` đi cùng nhánh `isStale` mà e2e 409 `EVENT_ALREADY_ENDED` đã phủ | patch (gộp P1, P2) |
| BH10 | Unit test thiếu ca Sự kiện chưa kết thúc mà `effectiveEndAt` sớm hơn `expiresAt` | low | Đúng: `Math.min` chỉ được kiểm với `eventEnded: true`. Thêm một ca | patch (P6) |
| BH11 | Mục hoãn `deferred-work.md:84` vẫn giao 5.1 | false | Bước On Complete (mục "Mục hoãn trong `deferred-work.md`") ghi dòng "Story nhận … 5.2" theo quyết định của Mason; chưa tới bước đó | reject |
| BH12 | Spec `in-review` mà sprint-status `in-progress` | false | Đúng quy trình: On Complete đặt `done` trong nhánh story | reject |
| BH13 | Luật "link còn hiệu lực" tách SQL/JS; 5.2 sẽ phải chép | low | Chưa có nơi thứ hai dùng luật này; tách hàm chung bây giờ là đoán trước 5.2 | reject, để 5.2 xét (deferred-work) |
| BH14 | `useOrigin` export từ file component | false | Không có hỏng hóc nào: import chạy, không vòng, `lint:deps` pass | reject |
| BH15 | URL hiện ra không có nhãn | false | URL nằm trong `<section aria-labelledby>` có tiêu đề "Link mời CTV", trình đọc màn hình đọc tiêu đề trước | reject |
| EC1 | `now()` đúng bằng `effective_end_at`: 201 kèm link đã hết hạn, link cũ bị thu hồi | low | Đúng ở biên, cùng gốc BH7 | patch (P5) |
| EC2 | Sau "Kết thúc", `effective_end_at` theo đồng hồ app có thể đi trước `now()` của DB | low | Đúng: `event-status.service.ts` đặt cả hai cột bằng `new Date()`; đồng hồ app nhanh hơn DB thì tạo được link sau khi đã kết thúc. Web (`isEventEnded`) đã coi `endedManuallyAt` là kết thúc | patch (P5) |
| EC3 | `POST` chờ khóa trong lúc "Kết thúc" commit; `now()` là lúc bắt đầu transaction | low | Đúng: dòng đọc lại sau khóa có `ended_manually_at` mới, nhưng `now()` cũ nhỏ hơn mốc kết thúc nên qua chốt. Kiểm `ended_manually_at` sẽ chặn | patch (P5) |
| EC4 | `GET` đọc hai lần không cùng snapshot | low | Trùng BH6 | reject |
| EC5 | Đồng hồ máy khách chậm: 409 `EVENT_ALREADY_ENDED` lặp lại, nút vẫn bật | low | Đúng khi đồng hồ máy chậm vượt qua mốc kết thúc; hiếm, sửa cần thêm state | reject |
| EC6 | Web không đổi trạng thái đúng lúc hết hạn | low | Trùng BH3 | reject |

## Design Notes

Hàm đọc/khóa Sự kiện đặt ở `event` vì code `checkin` (ngoài `schema.ts`) chỉ được import `event/index.ts` (`module-public-api-only`); chỉ `checkin/schema.ts` được import `event/schema.ts` để khai FK. `GET` lấy `status`/`effectiveEndAt` qua một hàm đọc (không khóa) export từ `event`, rồi tính `expiresAt`/`active` trong SQL của câu đọc `checker_invites` (`LEAST(expires_at, <effectiveEndAt>)`, so với `now()`).

## Verification

**Commands:**
- `pnpm --filter @tickee/contracts build` -- expected: thành công.
- `pnpm --filter @tickee/api exec vitest run test/checkin test/organizer/isolation.test.ts test/platform` -- expected: pass (cần Postgres từ docker compose).
- `pnpm typecheck && pnpm lint:deps` -- expected: không lỗi.
- `pnpm --filter @tickee/web test` và `pnpm test:e2e` -- expected: pass.
