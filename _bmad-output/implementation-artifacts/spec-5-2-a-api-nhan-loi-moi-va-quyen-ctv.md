---
title: 'Story 5.2-a: API nhận lời mời và quyền CTV'
type: 'feature'
created: '2026-11-23'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'e67fb552d47ba82627122dd10262fcb1629a92ae'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Link mời CTV của 5.1 chưa nhận được. Chưa có bảng `checkers`, và `PermissionGuard` mới chỉ hiểu route `/v1/orgs/:orgId`, nên chưa có route CTV nào dưới `/v1/checkin/events/:eventId` (FR-26, FR-29, AD-26, AD-30, NFR-7).

**Approach:**
- Thêm bảng `checkers` trong `checkin`.
- Thêm flow xem trước và nhận lời mời bằng token (`flows`).
- Mở rộng `PermissionGuard` sang route `/v1/checkin/events/:eventId/…` bằng cổng `CheckerAccessResolver` do `checkin` cài.
- Thêm `GET /v1/checkin/events/:eventId` cho Màn quét.

**Quyết định (Mason, 23/11/2026):**
- Tách Story 5.2 thành hai spec. 5.2-a (spec này) làm API. 5.2-b làm web: trang `/loi-moi-ctv`, trang tạm `/events/[eventId]`, nút "Mở Màn quét" ở tab Check-in, sửa cache khi đăng nhập, e2e.
- CTV quay lại Màn quét bằng cách mở lại link mời. Người xem đã có quyền quét (CTV `active`, hoặc Owner/Admin của BTC sở hữu) được trả `scanEventId` kể cả khi link đã hết hạn hoặc đã bị thay, miễn token khớp một link từng tạo. Không thêm route liệt kê Sự kiện của CTV.

## Boundaries & Constraints

**Always:**
- Token chỉ đi trong body `POST` (`{token}`, chuỗi 1–256 ký tự). Token sai dạng thì xử lý như token sai. Token không vào URL, audit hay log. Cả hai route đều trả `cache-control: no-store`.
- Luật "link còn hiệu lực" nằm trong một hàm của `checkin`, so với đồng hồ DB. Link còn hiệu lực khi đủ ba điều kiện:
  - chưa thu hồi;
  - `now` trước `LEAST(expires_at, effective_end_at)`;
  - Sự kiện chưa `cancelled` và chưa bấm "Kết thúc".

  `CheckerInviteService.latest`, preview và accept đều gọi hàm này.
- Mọi lỗi về link trả một mã duy nhất `404 CHECKER_INVITE_INVALID` và không lộ tên Sự kiện. Lỗi về link gồm: token sai hoặc sai dạng, link hết hạn hoặc đã bị thu hồi, Sự kiện đã hủy hoặc đã kết thúc.
- Preview `POST /v1/checkin/invites/preview` dùng `@OptionalAuth()`, trả `200` theo thứ tự:
  1. Không có link nào khớp hash → 404.
  2. Người xem đã đăng nhập và có quyền quét Sự kiện của link → `{eventName, organizationName, scanEventId: <id Sự kiện>}`, kể cả khi link không còn hiệu lực.
  3. Link không còn hiệu lực → 404.
  4. Còn lại → `{eventName, organizationName, scanEventId: null}`.
- Accept `POST /v1/checkin/invites/accept` là `flows.acceptCheckerInvite`. Toàn bộ chạy trong một transaction và trả `200 {eventId}`:
  1. Không có link nào khớp hash → 404.
  2. Khóa Sự kiện `FOR SHARE`.
  3. Người gọi là Owner/Admin của BTC, hoặc đã là CTV `active` → không ghi gì.
  4. Đang có dòng `revoked` → `403 CHECKER_REVOKED`.
  5. Link không còn hiệu lực → 404.
  6. INSERT dòng `active` (`ON CONFLICT DO NOTHING` rồi đọc lại) và audit `checker.joined`. Hai accept song song của cùng một user chỉ ra một dòng.
- Bảng `checkers`:
  - cột `id`; `organization_id NOT NULL` (không FK); `event_id` (FK `events`); `user_id` (không FK); `status` `active|revoked` (CHECK); `revoked_by`; `revoked_at`; `created_at` (lúc nhận);
  - unique `(event_id, user_id)`;
  - chỉ `status`, `revoked_by`, `revoked_at` được UPDATE.
- `PermissionGuard`:
  - Route có `:orgId` giữ nguyên hành vi hiện tại.
  - Route `@RequirePermission` không có `:orgId` mà có `:eventId` đi nhánh Sự kiện:
    - Sự kiện không tồn tại, id sai dạng, hoặc người gọi không liên quan → `403 NOT_A_MEMBER`, câu "Bạn không có quyền soát vé cho Sự kiện này.";
    - Owner/Admin của BTC sở hữu → kiểm theo `ROLE_PERMISSIONS`;
    - CTV `active` → chỉ được các quyền trong `CHECKER_PERMISSIONS` (`checkin.scan`, `checkin.lookup`); quyền khác trả `403 FORBIDDEN_ROLE`;
    - CTV `revoked` → `403 CHECKER_REVOKED`.
  - Quyền đọc lại ở mỗi request, không cache.
  - Handler nhận `EventAccessContext {userId, organizationId, eventId, role: Role | null, assignedEventIds, stepUpAt}` qua `@EventAccess()`. Với CTV: `role: null`, `assignedEventIds: [eventId]`.
- `GET /v1/checkin/events/:eventId` cần `checkin.scan` và trả `{eventId, eventName}`.
- Audit `checker.joined`: target `{type: 'checker', id}`, `organizationId` của Sự kiện. Không chứa token hay hash.

**Never:**
- Không làm web: trang `/loi-moi-ctv`, `/events/[eventId]`, nút "Mở Màn quét", helper đường dẫn web, e2e. Mục hoãn "Đăng nhập tài khoản khác trong cùng tab (không đăng xuất) chỉ invalidate `me`…" cũng để lại. Tất cả thuộc 5.2-b.
- Không làm quét, tra tay, số check-in (5.3–5.5, 5.7).
- Không làm thu hồi/khôi phục CTV, chặn CTV sau `effective_end_at` (`EVENT_ENDED`) (5.6).
- Không đổi hành vi route `/v1/orgs/:orgId` (`NOT_A_MEMBER`, `assignedEventIds: []`).
- Không đổi kiểu `AccessContext`, `Role`, `ROLE_PERMISSIONS`.
- `checkin` không import `organizer` hay `identity`.
- Không sửa migration cũ hay `module-graph.cjs`.
- Không thêm giới hạn tốc độ cho preview: token 128 bit, giống `/v1/org-invitations/preview`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Preview hợp lệ | Ẩn danh, hoặc người chưa có quyền; link còn hiệu lực | `200 {eventName, organizationName, scanEventId: null}` | N/A |
| Preview của người đã có quyền | CTV `active` hoặc Owner/Admin; link còn hoặc hết hiệu lực | `scanEventId` = id Sự kiện | N/A |
| Link hỏng | Token sai hoặc sai dạng / hết hạn / bị thu hồi / Sự kiện đã hủy hoặc đã "Kết thúc"; người xem chưa có quyền | Không lộ tên Sự kiện | `404 CHECKER_INVITE_INVALID` |
| Nhận lần đầu | Đã đăng nhập, link còn hiệu lực | Ghi một dòng `active` và audit `checker.joined`; `200 {eventId}` | N/A |
| Nhận lại | Đã là CTV `active`, hoặc là Owner/Admin | Không ghi gì; `200 {eventId}` | N/A |
| Đã bị thu hồi | Có dòng `revoked` | Không kích hoạt lại | `403 CHECKER_REVOKED` |
| Chưa đăng nhập | Gọi accept khi không có session | Không ghi gì | `401 UNAUTHENTICATED` |
| Hai accept song song | Cùng user, cùng link | Đúng một dòng; cả hai trả `200` | N/A |
| Route CTV | CTV `active` của A gọi `GET /v1/checkin/events/A` | `200 {eventId, eventName}` | N/A |
| Owner/Admin không cần lời mời | Thành viên của BTC sở hữu | `200` | N/A |
| Cách ly | CTV của A gọi B (cùng BTC hoặc khác BTC) / người lạ / Sự kiện không có hoặc id sai dạng / Owner BTC khác / CTV gọi route `/v1/orgs/:orgId` | Không lộ dữ liệu | `403 NOT_A_MEMBER` |
| CTV bị thu hồi | Gọi route CTV | Không lộ dữ liệu | `403 CHECKER_REVOKED` |

</frozen-after-approval>

## Code Map

**Quyền và guard**
- `apps/api/src/platform/access/permission.guard.ts:33-77`: guard hiện chỉ đọc `:orgId` (:53-55) và đặt cứng `assignedEventIds: []` (:70). Lỗi cấu hình "@Public + @RequirePermission" (:45-47) giữ lại làm lớp phòng thủ.
- `platform/access/{access-resolver,org-scope,require-permission,index}.ts`: cổng, ctx và decorator hiện có. Thêm `CHECKER_ACCESS_RESOLVER` cạnh `ACCESS_RESOLVER`.
- `modules/organizer/organizer.module.ts:78-79`: nơi đăng ký `PermissionGuard` (`APP_GUARD`) và `ACCESS_RESOLVER`.
  - Guard lấy DI trong scope của `OrganizerModule`, nên cổng của `checkin` phải toàn cục (`@Global()`, như `ticketing.module.ts:119`).
  - Guard inject cổng này bằng `@Optional()`, để harness test không nạp `CheckinModule` vẫn chạy.
- `identity/session.guard.ts:15,50`: `@OptionalAuth()` (từ `@thallesp/nestjs-better-auth`) chưa route nào dùng. Có session thì gắn `req.user`; guard TOTP và consent vẫn áp với người đã đăng nhập.
- `packages/contracts/src/organizer.ts:6-53`: `Permission.CHECKIN_SCAN/LOOKUP`, `ROLE_PERMISSIONS`, `roleHasPermission`. Khai báo `CHECKER_PERMISSIONS` cạnh đây.

**Mẫu và module liên quan**
- `modules/organizer/invitations.controller.ts:10-30`, `members.service.ts:265-349`: mẫu preview/accept với token trong body (CAS + `onConflictDoNothing`, đọc lại khi trùng).
- `organizer/index.ts` đã export `organizationNameOf`. Cần thêm export đọc vai trò thành viên, bọc `OrganizerService.roleOf` (`organizer.service.ts:128`).
- `modules/checkin/checker-invite.service.ts:68-84` (`latest`): luật hiệu lực đang nằm hai nơi, SQL (:75) và JS (:82-83).
- `modules/checkin/schema.ts`: mẫu `id()`/`createdAt()`, FK `events`, unique index.
- `modules/checkin/invite-token.ts`: `hashCheckerInviteToken`.
- `modules/checkin/checkin.module.ts`; `modules/checkin/index.ts` hiện chỉ export module.
- `modules/event/checkin-gate.ts:17-65`: `CheckinEventRef`, `lockEventForCheckerInvite` (định nghĩa "đã kết thúc" ở :48). Thêm hàm đọc/khóa `FOR SHARE` theo id, không cần ctx, trả thêm `organizationId` và `name`. Mẫu: `public-event.ts:120` (`lockEventByIdForShare`).
- `src/flows/flows.module.ts`, `ticket-types.flow.ts`: mẫu flow `(db, …)` tự mở transaction; controller đặt ở `flows/*.controller.ts`.

**Hạ tầng dùng chung**
- `platform/db/clock.ts:20-26`: `dbNow`.
- `platform/audit/audit.ts:174-183`: union `AuditAction`.
- `platform/db/grants.ts:29-91`: `UPDATE_PROTECTED_COLUMNS`.
- `platform/http/app-error.ts`: `DEFAULT_STATUS` phải có mọi mã.
- `packages/contracts/src/{checkin,errors}.ts`.

**Test**
- `test/organizer/routes.ts:21-67`: `discoverRoutes`, `ORG_ROUTE`.
- `isolation.test.ts:43-48,160-183,281`: `fill` thay theo `:orgId`; đếm 25 route Sự kiện. Route CTV phải lọc ra khỏi phần thay bằng BTC khác.
- `test/admin/closed-beta.test.ts:91-117`: mẫu kiểm kho route.
- `test/checkin/checker-invite.test.ts:40-127`: helper tạo BTC, Sự kiện đã đăng, Admin, migrator.
- `test/identity/harness.ts` (`signUp`, `sessionCookie`).
- `test/organizer/permission-guard.test.ts:98-102`: giữ ca cấu hình sai trả 500.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{checkin,errors,organizer}.ts` (+ test) -- Thêm vào contracts:
  - schema `CheckerInviteTokenRequest`, `CheckerInvitePreview`, `AcceptedCheckerInvite`, `CheckinEvent`;
  - mã lỗi `CHECKER_INVITE_INVALID`, `CHECKER_REVOKED`;
  - `CHECKER_PERMISSIONS` và `checkerHasPermission`.
- [x] `apps/api/src/platform/access/*`, `platform/http/app-error.ts` -- Mở rộng quyền ở `platform`:
  - cổng `CHECKER_ACCESS_RESOLVER`: `resolveEvent(userId, eventId)` trả `{organizationId, checker: 'active'|'revoked'|null}` hoặc `null`;
  - `EVENT_ID_PARAM`, `EventAccessContext`, `@EventAccess()`;
  - nhánh Sự kiện trong `PermissionGuard` theo Boundaries;
  - HTTP status cho hai mã mới.
  - Phần này làm mục hoãn "`PermissionGuard` và cổng `AccessResolver` đang gắn với `:orgId`…".
- [x] `apps/api/src/modules/checkin/{schema,checkers,invite-rule,checker-access-resolver.impl,checkin-event.controller,checkin.module,index}.ts` + `checker-invite.service.ts` -- Mô-đun `checkin`:
  - bảng `checkers`;
  - hàm luật hiệu lực dùng chung. `latest` chuyển sang dùng hàm này, giữ nguyên kết quả của 5.1 (mục hoãn "Luật "link mời CTV còn hiệu lực"…");
  - hàm export cho flow: tìm link theo token, đọc dòng `checkers`, INSERT dòng `checkers`;
  - resolver;
  - `GET /v1/checkin/events/:eventId`;
  - module `@Global()` export cổng.
- [x] `apps/api/src/modules/event/{checkin-gate,index}.ts` -- hàm đọc/khóa Sự kiện theo id, không cần ctx.
- [x] `apps/api/src/modules/organizer/{organizer.service,index}.ts` -- export hàm đọc vai trò thành viên.
- [x] `apps/api/src/flows/{checker-invite.flow,checker-invite.controller,flows.module,index}.ts` -- `previewCheckerInvite` và `acceptCheckerInvite` cùng hai route của chúng, theo Boundaries.
- [x] `apps/api/drizzle/0034_checkers.sql`, `platform/audit/audit.ts`, `platform/db/grants.ts` -- Lưu trữ và audit:
  - sinh migration bằng `pnpm --filter @tickee/api db:generate --name checkers`;
  - thêm action `checker.joined`;
  - khóa cột `checkers`.
- [x] `apps/api/test/checkin/{checker-accept,checkin-access}.test.ts` -- Test API:
  - mọi dòng Matrix; hai accept song song chạy bằng `Promise.all`;
  - audit không chứa token hay hash;
  - `latest` cho kết quả như cũ sau khi đổi sang hàm chung;
  - CTV gọi route cần quyền ngoài `CHECKER_PERMISSIONS` (controller giả trong harness) → `403 FORBIDDEN_ROLE`.
- [x] `apps/api/test/organizer/{isolation.test,routes}.ts` -- Bộ test route:
  - lọc `ORG_ROUTE` cho phần thay `:orgId`;
  - thêm regex `CHECKIN_EVENT_ROUTE`;
  - kiểm kho route: không route nào vừa `isPublic` vừa có quyền; mọi route có quyền nằm dưới `/v1/orgs/:orgId/` hoặc `/v1/checkin/events/:eventId`.
  - Đây là phần "kiểm `@Public()` + `@RequirePermission`" của mục hoãn về `PermissionGuard`, làm bằng test route.

**Acceptance Criteria:**
- Given mọi route có `@RequirePermission`, when chạy bộ test route, then không route nào vừa công khai vừa đòi quyền, và mọi route nằm dưới một trong hai tiền tố hợp lệ.
- Given harness không nạp `CheckinModule`, when gọi route BTC, then guard vẫn chạy như trước (cổng CTV là `@Optional()`).
- Given preview hoặc accept trả lỗi về link, when xem response, then không có tên Sự kiện, tên BTC hay id Sự kiện.

## Implementation Notes

- Đã làm (23/11/2026): đủ 9 task.
  - Mới: `checkin/{checkers,invite-rule,checker-access-resolver.impl,checkin-event.controller}.ts`, `flows/checker-invite.{flow,controller}.ts`, `drizzle/0034_checkers.sql`.
  - Thêm export: `event` có `checkinEventById`, `lockCheckinEventByIdForShare`; `organizer` có `memberRoleOf` (`OrganizerService.roleOf` gọi lại hàm này).
- Luật hiệu lực chung là `inviteActiveSql(event)` (`checkin/invite-rule.ts`). Sự kiện đã hủy hoặc đã bấm "Kết thúc" thì trả `false`; còn lại so `revoked_at` và `LEAST(expires_at, effective_end_at)` với `now()` của DB.
  - `latest`, `create` (`active` trong response), preview và accept cùng gọi hàm này.
  - Không dùng `dbNow` + JS như Boundaries gợi ý, vì so bằng `now()` ngay trong câu SQL vẫn là đồng hồ DB.
- `@OptionalAuth` được xuất lại từ `identity/index.ts`, vì `flows` không được import Better Auth.
- Preview đọc ngoài transaction, nên mỗi câu có `now()` riêng. Accept chạy trọn trong transaction.
- Thêm ngoài spec:
  - `no-store` cho `GET /v1/checkin/events/:eventId`;
  - tùy chọn `moduleOverrides` trong `test/identity/harness.ts` (bỏ `CheckinModule` để kiểm `@Optional()`);
  - body sai schema (thiếu token, rỗng, > 256 ký tự) trả `400 VALIDATION_FAILED`; token đúng độ dài mà sai dạng trả 404.
- Kiểm (23/11/2026):
  - contracts: 346 pass;
  - API `test/checkin test/organizer test/platform test/dependency-rules.test.ts`: 432 pass;
  - `pnpm typecheck`, `pnpm lint:deps`: không lỗi;
  - subagent đã chạy toàn bộ API: 1.696 pass.
- Vá sau review lượt 1 (23/11/2026, P1–P7):
  - **Test mới:**
    - khóa `FOR SHARE` của accept: "Kết thúc" commit trong lúc accept đang chờ → 404. Đã thử bỏ `.for('share')`: test hỏng;
    - Owner/Admin thắng link hỏng và dòng `revoked` ở cả accept lẫn preview;
    - log `organizationId` ở route CTV, trong `log-context.test.ts`. Đã thử bỏ `assignLogContext`: test hỏng;
    - vòng cách ly tự dò route CTV có thêm hai người gọi: CTV của Sự kiện khác cùng BTC → `NOT_A_MEMBER`, CTV bị thu hồi → `CHECKER_REVOKED`.
  - **Sửa test và comment:**
    - `whileHolding` gọi ROLLBACK khi lỗi;
    - sửa comment `no-store` ở `checker-invite.controller.ts` và comment đầu `checkers.ts`.
  - **Kiểm lại:**
    - contracts: 346 pass;
    - API `test/checkin test/organizer test/platform test/telemetry/log-context.test.ts test/dependency-rules.test.ts`: 443 pass;
    - `pnpm typecheck`, `pnpm lint:deps`: exit 0.

## Spec Change Log

## Review Triage Log

Lượt 1 (23/11/2026). VG = Verification Gap, BH = Blind Hunter, EC = Edge Case Hunter.

| # | Phát hiện | Verdict | Bằng chứng | Hướng |
|---|---|---|---|---|
| VG1 | Khóa `FOR SHARE` của accept chưa có test ghim | medium | Lớp VG đã kiểm: bỏ `.for('share')` thì test `:358` vẫn pass, vì FK check của INSERT cũng chờ khóa `FOR UPDATE` đang giữ. Bước 2 của accept có thể mất mà không test nào hỏng | patch (P1) |
| VG2 | Owner/Admin thắng dòng `revoked` và link hỏng ở accept/preview chưa có test ghim | medium | Lớp VG đã kiểm: dời return sớm của Owner/Admin ra sau hai bước kiểm thì không test nào hỏng. Khi đó Admin từng là CTV sẽ nhận 403, Owner mở link cũ sẽ nhận 404 | patch (P2) |
| VG3 | Route CTV gắn `organizationId` vào log chưa có test | low | Lớp VG đã kiểm: xóa `assignLogContext` trong `eventRoute` thì mọi test vẫn pass. Thêm một ca theo mẫu `log-context.test.ts` | patch (P3) |
| BH1 | Vòng cách ly tự dò route CTV chỉ gọi bằng Owner BTC khác | medium | Đúng: `isolation.test.ts` chỉ dùng `ownerA`. Ca CTV khác Sự kiện và CTV bị thu hồi chỉ nằm ở danh sách đường dẫn cố định của `checkin-access.test.ts`, nên route 5.3+ không tự được kiểm với người gọi là CTV (epic: "mọi route mới… có ca CTV truy cập Sự kiện không được giao → 403") | patch (P4) |
| BH2 | Thiếu `eventScope`; `assignedEventIds` mơ hồ (`[]` = mọi Sự kiện) | low | Nghĩa `[]` cho thành viên có từ 2.1 và Boundaries đã khóa; chưa handler nào đọc `assignedEventIds`. Sửa thì phải đổi spec | reject |
| BH3 | `tickee_app` vẫn DELETE được `checkers` | low | Đúng, nhưng không code nào DELETE. `grants.ts` cấp DELETE cho mọi bảng không append-only (`members`, `checker_invites` cũng vậy); chặn riêng cần cơ chế quyền mới | reject |
| BH4 | Không có CHECK ràng `status` với `revoked_at`/`revoked_by` | low | Đúng: DB nhận tổ hợp lệch, nhưng chưa code nào ghi `revoked_*`. Nghĩa của "Khôi phục" (giữ hay xóa `revoked_*`) do 5.6 chốt | reject, để 5.6 xét (deferred-work) |
| BH5 | Không test nào chứng minh accept đọc lại trạng thái đã commit sau khóa | medium | Trùng gốc VG1 | patch (gộp P1) |
| BH6 | Preview không báo CTV đã bị thu hồi | low | Dạng response nằm trong Boundaries (frozen); accept trả `CHECKER_REVOKED` để web hiện câu đúng. Sửa thì phải đổi spec | reject |
| BH7 | Câu lỗi và hàm dựng lỗi lặp giữa guard và `checkin` | low | Đúng: hai chỗ cùng câu, hiện vẫn khớp. Sửa phải thêm export ở `platform` | reject |
| BH8 | Mỗi request CTV tốn 3–4 câu SQL | low | Đều là tra theo PK hoặc unique index; p95 quét đo ở 5.3/9.2. Sửa phải đổi cổng | reject |
| BH9 | Chưa test 2FA cho preview `@OptionalAuth` và accept | low | Hành vi là của `TotpGuard` toàn cục (mọi route không `@Public`), đã có `totp-guard.test.ts`; không có lỗi | reject |
| BH10 | Comment `no-store` "có ở cả response lỗi" nói quá | low | Đúng: lỗi từ guard toàn cục (401, `CONSENT_REQUIRED`, `TOTP_REQUIRED`) không qua handler. Sửa câu chữ | patch (P5) |
| BH11 | Comment đầu `checkers.ts` nói mọi lần đọc qua `orgScope` | low | Đúng: `checkerInviteByToken` cố ý đọc mọi BTC theo hash. Ghi rõ ngoại lệ | patch (P6) |
| BH12 | CTV `active` vẫn vào route CTV khi Sự kiện đã hủy; `CheckinEvent` không có trạng thái | low | Đúng, nhưng chưa route nào đặt `cancelled` (7.1 mới làm), nên người dùng chưa gặp | reject, để 7.1 xét (deferred-work) |
| BH13 | Helper `checkers` nhận `scope` và `eventId` rời nhau | low | Mọi caller truyền `(event, event.id)`; không caller nào lệch | reject |
| BH14 | `waitingOnLocks` bị chép lần thứ năm | low | Mẫu có sẵn ở bốn file test khác; gom lại phải chạm file ngoài story | reject |
| BH15 | Tên `CheckinAccessResolver` / `checker-access-resolver.impl.ts` / `CheckerAccessResolver` lệch nhau | low | Theo tiền lệ `MemberAccessResolver` trong `access-resolver.impl.ts` (tên lớp theo bên cài, tên file theo cổng) | reject |
| EC1 | Link hết hạn đúng lúc accept đang chờ khóa (`now()` = lúc bắt đầu transaction) vẫn được nhận | low | Đúng trong cửa sổ chờ khóa (mili giây), và link còn hạn lúc request tới. Sửa phải thêm tham số đồng hồ vào luật chung | reject |
| EC2 | CHECK `status` ↔ `revoked_*` | low | Trùng BH4 | reject (gộp BH4) |
| EC3 | `whileHolding` trả client về pool khi đang trong transaction nếu test lỗi | low | Đúng: không có ROLLBACK, các test sau có thể treo vì khóa còn giữ | patch (P7) |
| EC4 | Lỗi từ guard không có `no-store` | low | Trùng gốc BH10; POST không bị cache, response 401/403 không có dữ liệu | patch (gộp P5) |
| EC5 | Nhánh Sự kiện của guard không kiểm tiền tố đường dẫn | low | Spec chọn kiểm bằng bộ test kho route; `PERMISSION_ROUTE_PREFIXES` bắt route `:eventId` nằm ngoài `/v1/checkin/events/` | reject |

## Design Notes

Spine AD-26 có một decorator `@RequirePermission` và một guard dựng ctx. Guard chọn nhánh theo tham số route:
- Route có `:orgId` đi nhánh BTC như cũ.
- Route chỉ có `:eventId` đi nhánh Sự kiện. Nhánh này ghép hai cổng:
  - `ACCESS_RESOLVER`: vai trò trong BTC;
  - `CHECKER_ACCESS_RESOLVER`: BTC sở hữu Sự kiện và trạng thái CTV. `checkin` cài cổng này, vì `checkin → event` là hướng hợp lệ.

`EventAccessContext` tách khỏi `AccessContext` để không phải nới `role` thành nullable. Các chỗ đang truyền `ctx.role` vào hàm nhận kiểu `Role` sẽ hỏng nếu nới:
- `organizer.service.ts:114`;
- `token.service.ts:226`;
- `organization-live.controller.ts:29`.

`orgScope` chỉ đọc `organizationId`, nên dùng được với cả hai loại ctx.

Preview và accept nằm ở `flows`, vì preview cần tên BTC (`organizer`) và accept cần kiểm Owner/Admin, mà `checkin` không được import `organizer`.

## Verification

**Commands:**
- `pnpm --filter @tickee/contracts build && pnpm --filter @tickee/contracts test` -- expected: pass.
- `pnpm --filter @tickee/api exec vitest run test/checkin test/organizer test/platform test/dependency-rules.test.ts` -- expected: pass (cần Postgres từ docker compose).
- `pnpm typecheck && pnpm lint:deps` -- expected: không lỗi.
