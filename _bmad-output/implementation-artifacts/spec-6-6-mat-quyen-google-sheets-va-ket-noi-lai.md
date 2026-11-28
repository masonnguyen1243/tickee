---
title: 'Story 6.6: Mất quyền Google Sheets và kết nối lại'
type: 'feature'
created: '2026-11-28'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '5b80cb3c6ca5dcedb1c4ba447bd1ac8a044bf043'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sau 6.5, kết nối Sheet chuyển `auth_revoked` khi Google trả `invalid_grant`/401/403, nhưng không ai được báo. Cài đặt chỉ hiện badge "Mất quyền", không có cách kết nối lại (`startConnect` trả 409 khi đã có kết nối). Người cấp OAuth bị xóa khỏi BTC thì Tickee vẫn ghi dữ liệu người mua vào Drive của người đó (FR-32, AD-23, AD-34, UX-DR40).

**Approach:** Lúc kết nối chuyển `auth_revoked`, cùng transaction đó ghi mốc `auth_revoked_at`, enqueue email theo khóa `(connectionId, auth_revoked_at)` và phát `ORG_STATUS_CHANGED`. `reporting.notices` sinh banner "Mất quyền ghi Google Sheets" cho mỗi kết nối `auth_revoked`. Owner hoặc Admin bấm "Kết nối lại" để chạy lại OAuth trên chính kết nối đó: Sheet cũ còn mở được bằng token mới thì dùng lại và flush dòng bẩn, không thì tạo Sheet mới. Xóa Admin chuyển sang một flow ở `flows/`, trong một transaction: xóa thành viên, rồi chuyển `auth_revoked` mọi kết nối người đó cấp.

**Quyết định (Mason, 28/11/2026):**
1. **Gộp phần E5-1 "removeMember thu hồi dòng checkers trong BTC":** flow xóa Admin thu hồi luôn mọi dòng `checkers` còn `active` của người đó trong các Sự kiện của BTC, cùng transaction. Các phần khác của E5-1 (xoay link mời, ghi vết tra tay, `ticketTypes`, lối đăng xuất) vẫn để E5-1.
2. Giữ một spec dù vượt ngưỡng 5.000 token (khoảng 7.400): một mục tiêu người dùng. Xóa người cấp chỉ là thêm một nguồn chuyển `auth_revoked`, dùng chung hàm, email và banner.

## Boundaries & Constraints

**Always:**
- **Chuyển `auth_revoked`**, ở cả lỗi Google (lần đẩy đầu, flush) lẫn khi xóa người cấp:
  - một transaction, CAS `status <> 'auth_revoked'`: đặt `status`, `last_error_code`, `auth_revoked_at = now()`, enqueue email, `realtime.notifyOrganization(ORG_STATUS_CHANGED)`;
  - kết nối đã `auth_revoked` thì không đổi gì (giữ mã và mốc đầu tiên, không gửi email lần nữa);
  - dòng bẩn giữ nguyên, không thử lại (như 6.5).
- **Xóa người cấp:** mã lỗi mới `SheetSyncErrorCode.GRANTOR_REMOVED`, nhãn "Người kết nối đã rời BTC". Route `DELETE /v1/orgs/:orgId/members/:memberId` chuyển từ `MembersController` sang `flows/` (tiền lệ 3.10). Method, path, quyền `MEMBERS_MANAGE`, 204, 404 và audit `member.removed` giữ nguyên.
- **Thu hồi CTV khi xóa Admin** (Quyết định 1): cùng transaction, `UPDATE checkers` của `organization_id` và `user_id` đó, chỉ dòng `active` → `revoked`, `revoked_by` = người xóa, `revoked_at = now()`; mỗi dòng đổi một audit `checker.revoked` (`changedFields: ['status']`), như `setCheckerStatus`. Không đẩy realtime (quyền CTV đọc lại ở mỗi request, như 5.6).
- **Email** (danh mục thông báo, kind mới `sheets_auth_revoked`):
  - `recipients: [OWNER, ADMIN]`, kênh email + banner, `dedupeKey: ['connectionId', 'auth_revoked_at']`;
  - job gốc tính người nhận lúc xử lý (Owner rồi mọi Admin, như `defaultPayoutRecipients`), mỗi người một job con có id cố định;
  - id job gốc suy từ `(connectionId, auth_revoked_at)`. Handler bỏ qua khi kết nối không còn, hoặc không còn `auth_revoked` với đúng mốc đó;
  - nội dung: tên Sự kiện, lý do theo `last_error_code`, câu "Thay đổi trong lúc mất quyền được giữ lại và ghi lên Sheet khi kết nối lại", link tới tab Cài đặt của Sự kiện. Không chứa token, email hay SĐT người mua.
- **Banner:**
  - mã `SHEETS_AUTH_REVOKED`, bậc 8 trong `STATUS_NOTICE_PRIORITY` (ngay trên `TOKEN_BELOW_THRESHOLD`);
  - warning, không chặn bán, đóng được; audience theo danh mục (Owner, Admin);
  - mỗi kết nối `auth_revoked` một notice, `data = {eventId, eventName}`, `version` = `auth_revoked_at` ISO, nên mỗi banner có khóa đóng riêng;
  - tiêu đề "Mất quyền ghi Google Sheets", mô tả nêu tên Sự kiện, hành động "Kết nối lại" dẫn tới tab Cài đặt của Sự kiện (kiểu hành động mới của web).
- **Cài đặt › Google Sheets khi `auth_revoked`:**
  - nút chính "Kết nối lại" (cùng luồng với "Kết nối Google Sheets");
  - nhãn lỗi theo mã, câu giữ dòng bẩn như email;
  - vẫn có "Mở Google Sheet" (nếu có URL) và "Ngắt kết nối".
- **Kết nối lại:**
  - `startConnect` chỉ trả 409 khi kết nối hiện có khác `auth_revoked`;
  - callback có kết nối `auth_revoked` thì đổi code lấy token (kiểm refresh token và scope như 6.4), rồi dò Sheet cũ bằng token mới ngoài transaction (`spreadsheetInfo`, tìm tab theo `sheet_tab_id`):
    - mở được, có tab → dùng lại;
    - 404, 401, 403 hay mất tab → Sheet mới;
    - lỗi tạm thời → `sheets-failed`, kết nối giữ nguyên;
  - transaction CAS `status = 'auth_revoked'`: thay refresh token (mã hóa như 6.4), `granted_by_user_id` = người kết nối lại, xóa `auth_revoked_at` và `last_error_code`, audit `sheet_connection.reconnected`, phát `ORG_STATUS_CHANGED`. Sau đó, trong cùng transaction:
    - dùng lại, `last_synced_at` có, còn dòng bẩn → `syncing` + hẹn flush; lượt flush thành công thì về `active` như 6.5;
    - dùng lại, không dòng bẩn → `active` ngay;
    - Sheet mới, hoặc lần đẩy đầu chưa xong → đặt lại Sheet như `resetSpreadsheet`, `syncing`, enqueue lần đẩy đầu với id job mới (phân biệt được với các lần trước); dòng bẩn giữ, lần đẩy đầu xong thì hẹn flush như 6.5;
  - CAS trượt: kết nối đã bị xóa → đi đường tạo kết nối của 6.4; kết nối đã khác `auth_revoked` → `already-connected`;
  - quay về tab Cài đặt với `SheetsNotice` mới `sheets-reconnected`, toast "Đã kết nối lại Google Sheets.".
- Mọi route mới hay route bị chuyển giữ trong bộ test cách ly BTC (CTV gọi → 403). Không gọi Google trong transaction DB. Không log refresh token.

**Never:**
- Không gọi endpoint revoke của Google: revoke hủy cả grant của tài khoản đó, làm hỏng kết nối Sự kiện khác của cùng người cấp (6.4).
- Không làm cảnh báo "Có dữ liệu cần cập nhật lên Sheet" và enqueue khi ẩn danh hóa (7.6), enqueue khi hủy Sự kiện (7.1).
- Không thêm đường đọc `dedupeKey` trong code (E4-11, mục hoãn F2). Không thêm bộ giới hạn tốc độ (E5-5).
- Không sửa `organizer/payment-service.ts`, `can-xu-ly/review-queue.tsx`, `contracts/organizer.ts` (E4-10), `checkin-event-screen.tsx` (E5-5).
- Giới hạn 100 refresh token mỗi tài khoản Google trên mỗi OAuth client (mục hoãn 6.4 Triage #9/#34): chỉ ghi chú vận hành ở README › "Google Sheets". Khi vượt giới hạn, kết nối cũ nhận `invalid_grant` và đi đúng đường banner + "Kết nối lại" của story này. Không thêm câu chữ cho BTC, không giảm thiểu bằng code.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Thu hồi quyền | Flush nhận `invalid_grant` | `auth_revoked` + `auth_revoked_at`, email cho Owner và mọi Admin, banner hiện ngay (SSE) | Không retry |
| Lỗi lặp | Kết nối đã `auth_revoked`, job khác lại nhận 401 | Không đổi mốc, không email thứ hai | N/A |
| Xóa người cấp | Owner xóa Admin đã cấp OAuth cho 2 Sự kiện | Cả hai kết nối `auth_revoked` (`grantor_removed`) trong cùng transaction; hai email cho mỗi người nhận | Lỗi DB → rollback, Admin chưa bị xóa |
| Xóa Admin khác | Admin không cấp kết nối nào | Như cũ; không kết nối nào đổi | N/A |
| Xóa Admin là CTV | Admin đó là CTV `active` ở 2 Sự kiện, `revoked` ở 1 | Hai dòng `active` → `revoked` + audit; dòng đã `revoked` giữ người và lúc thu hồi cũ | Lỗi DB → rollback |
| Kết nối lại, dùng lại Sheet | Cùng tài khoản Google, có dòng bẩn | Cùng `spreadsheet_id`, `syncing` → flush → `active`; banner mất | Flush lỗi tạm thời → `retrying` như 6.5 |
| Kết nối lại, người khác | Admin khác kết nối lại, token mới không mở được Sheet cũ | Sheet mới, đẩy lại toàn bộ Đơn; `granted_by_user_id` đổi | N/A |
| Kết nối lại khi chưa có Sheet | `auth_revoked` trước khi lần đẩy đầu xong | Lần đẩy đầu chạy lại với id job mới | N/A |
| Dò Sheet lỗi tạm thời | 5xx/429 khi dò | `sheets-failed`, kết nối vẫn `auth_revoked` | Bấm lại |
| Hai người cùng kết nối lại | Hai callback gần nhau | Một thắng; người sau nhận `already-connected` | N/A |
| Email trễ | Kết nối lại trước khi job email chạy | Job bỏ qua, không gửi | N/A |
| Từ chối trên Google | `access_denied` khi kết nối lại | `sheets-denied`, kết nối giữ nguyên | N/A |
| Kết nối đang hoạt động | `POST connect` khi `active` | 409 `SHEETS_ALREADY_CONNECTED` như 6.4 | N/A |

</frozen-after-approval>

## Code Map

**Mô-đun `integration`** (`apps/api/src/modules/integration/`):
- `google-client.ts`: `httpFailure` :234-257 (`invalid_grant` :241, cấu hình :242, 401 :245, 403 quota :246-251, 403 khác :252, 404 `not_found` :253); `GoogleApiError` :46; `spreadsheetInfo` :369 (dùng để dò Sheet cũ); `authorizationUrl` :314 (`prompt=consent`); `accessToken` :340.
- `sheet-sync-jobs.ts`: `recordGoogleFailure` :360-375, dùng chung cho lần đẩy đầu và flush (`sheet-flush-jobs.ts:271`). Nhánh `auth_revoked` gọi `markSyncFailure` ngoài transaction; đổi thành transaction chuyển `auth_revoked` của Always. `runSheetInitialSync` :220 (`auth_revoked` → `skipped` :233), `sheetInitialSyncJobId` :98, worker :413-420.
- `sheet-flush-jobs.ts`: `runSheetFlush` :162 (bỏ qua `auth_revoked` :166, không dòng bẩn → `skipped clean`, không đổi trạng thái); `recreateSheet` :138 (reset + enqueue lần đẩy đầu trong một transaction: mẫu cho nhánh Sheet mới của kết nối lại); `markSheetRowChanged` :95-107 (chú thích :54 "giữ cho 6.6": vẫn chỉ đánh dấu khi `auth_revoked`).
- `sheet-connection-store.ts`: `markSyncFailure` :76-88 (CAS `ne(status, AUTH_REVOKED)`), `markSynced`, `resetSpreadsheet` :110.
- `sheet-connection.service.ts`: `startConnect` :147 (409 :149); `completeCallback` :202 (kết nối đã có → `ALREADY_CONNECTED` :242, trước khi đổi code); `createConnection` :278 (insert `onConflictDoNothing`, audit `sheet_connection.created`, enqueue lần đẩy đầu trong `tx`); `disconnect` :177.
- `sheet-oauth.controller.ts:62-80` callback, luôn 302 tới `googleSheetsReturnPath`. `sheet-connection.controller.ts`: `GET` :17, `POST connect` :28, `DELETE` :37, quyền `EVENTS_MANAGE`.
- `schema.ts`: `sheet_connections` :23-59 (`granted_by_user_id` FK `users`, CHECK trạng thái), migration mới nhất `apps/api/drizzle/0039_sheet_dirty_rows.sql`. `index.ts` chưa xuất read model hay hàm theo `tx`.
- Không có code email hay notice nào trong mô-đun.

**Xóa thành viên:**
- `organizer/members.service.ts:196-212` `removeMember(ctx, memberId)`: UUID sai → 404 trước transaction; tự mở transaction; xóa `members` có `role = admin` (Owner không bao giờ bị xóa); audit `member.removed`; trả `{userId}`. `organizer/index.ts` chưa xuất hàm thành viên nào.
- Route `organizer/members.controller.ts:44-49` (`@HttpCode(204)`, `MEMBERS_MANAGE`). Chuyển quyền Owner (`:221-262`) giữ người cũ làm Admin, không phải đường mất thành viên. Repo chưa có đường rời BTC hay xóa tài khoản.
- Mẫu flow: `flows/event-update.flow.ts:33-54` (một transaction, hai mô-đun, `enqueue…(boss, tx)`), controller `flows/event-edit.controller.ts:26-65` (`queues.ready()` trước transaction), đăng ký ở `flows/flows.module.ts:20-31`, xuất từ `flows/index.ts`. Commit `413b101` chuyển route từ `event` sang `flows`.
- CTV: bảng `checkers` (`checkin/schema.ts:46`, `organization_id`/`user_id` không FK, CHECK `checkers_revoked_check`); mẫu thu hồi `setCheckerStatus` (`checkin/checkers.ts:148-200`, `ACTION_RULES` :143). `checkin/index.ts` chưa xuất hàm thu hồi.
- `module-graph.cjs`: `organizer → [identity, tingee]`, `checkin → [ticketing, event]`, `integration → [ordering, ticketing, event, organizer, identity]`, `reporting → […, organizer, integration]`. `flows` gọi mọi mô-đun qua `index.ts`.

**Thông báo và email:**
- `reporting/notices.service.ts:167-182` `notices(scope)`, scope chỉ org (`:42`); các nguồn `closedBetaNotices` :47 … `tokenAlertNotices` :131; chú thích :158 chừa chỗ cho Sheets. Route `reporting/notices.controller.ts:7-15`.
- `packages/contracts/src/reporting.ts`: `StatusNoticeCode` :28-73, `STATUS_NOTICE_PRIORITY` :84-96 (chú thích đã giữ bậc 8), `StatusNotice` :123-137 (`data`, `version`).
- `packages/contracts/src/notifications.ts`: `NotificationKind` :16, `NOTIFICATION_CATALOG` :46-58 (tiền lệ `token_below_threshold`).
- Tiền lệ email chống gửi lặp: `organizer/token-alert.ts:129-170` (CAS mốc, enqueue id cố định `tokenAlertEmailJobId`, `notifyOrganization` trong `tx`); handler `token-alert-jobs.ts:58` bỏ qua khi mốc đổi; mẫu email `token-alert-email.ts:21`. Fan-out người nhận: `organizer/payout-default-jobs.ts:134-145` (đọc `members`; `integration` cần một read model mới của `organizer` thay cho đọc thẳng bảng), job con theo `userId` :221, `identity/user-directory.ts:29` `userContacts`. Tên queue và payload ở `packages/contracts/src/jobs.ts` (queue integration :146-166).
- Web:
  - `apps/web/lib/reporting/status-notices.ts`: `STATUS_NOTICE_CONTENT` :100 (mã thiếu → lỗi typecheck), hành động :14-24 (chỉ `section` hoặc `urlKey`), `statusNoticeLink` :151, khóa đóng :171;
  - `apps/web/components/tickee/status-banner-stack.tsx`: SSE `organizationLiveApiPath`, render trong `dashboard-shell.tsx:331`;
  - `packages/contracts/src/google-sheets.ts`: `EVENT_SETTINGS_TAB` :164, `googleSheetsReturnPath` :170.

**Cài đặt Google Sheets (web):** `apps/web/app/(dashboard)/btc/[orgId]/su-kien/[eventId]/google-sheets-section.tsx` (`ConnectedBody` :65, nút kết nối :205-212), `apps/web/lib/integration/google-sheets.ts` (`startSheetsConnect`, `sheetsConnectionView` :95, nhãn `SHEETS_*`), toast callback `apps/web/lib/notices.ts`. Contracts: `SheetSyncErrorCode` :79, `SHEET_SYNC_ERROR_LABEL`, `SheetsNotice` :155, mã lỗi API `errors.ts:273-275`.

**Test:**
- Google fake `apps/api/test/google-fake/server.ts`: `revokeAll()` :175, `refreshReplies`, `sheetsReplies`, `scriptSheets`, `consent`, `authorize(url)`. Spreadsheet thuộc về grant (:818-828): grant mới nhận 404 với Sheet của grant cũ (Google thật có thể khác: kiểm tay).
- `apps/api/test/integration/sheet-fixtures.ts`: `connectSheet` :113, `connectAndSync`, `disconnectSheet`, `connectionStateOf`, `dirtyOf`. Ca mất quyền hiện có: `sheet-initial-sync.test.ts:522-542`, `sheet-flush.test.ts:603`.
- `apps/api/test/organizer/members.test.ts` (`xóa Admin` :395-431); `test/organizer/isolation.test.ts` tự tìm route qua `discoverRoutes` và khẳng định tên `DELETE /v1/orgs/:orgId/members/:memberId` (:90).
- Web: `apps/web/test/status-notices.test.ts`, `apps/web/e2e/status-banners.spec.ts`, `apps/web/e2e/event-google-sheets.spec.ts` (bốn trạng thái :184-225, API giả).

**Mục hoãn giao cho 6.6** (`deferred-work.md`):
- "Google giới hạn 100 refresh token…" → Never (README).
- Phần "chuyển vào thùng rác" của mục "Sheet bị BTC xóa hoặc chuyển vào thùng rác…" cùng Triage #22 của 6.5 ("Chưa kiểm…: Sheets API có thể vẫn phục vụ spreadsheet đã chuyển vào thùng rác…") → AC kiểm tay.
- "Kiểm thủ công AC 3 của 6.5 (gộp kiểm thủ công hoãn từ 6.4) chưa làm…", gồm cả mục "Kiểm thủ công của 6.4 chưa làm…" → AC kiểm tay.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/google-sheets.ts`, `reporting.ts`, `notifications.ts`, `jobs.ts` (+ test) -- `SheetSyncErrorCode.GRANTOR_REMOVED` + nhãn; `SheetsNotice.RECONNECTED`; `StatusNoticeCode.SHEETS_AUTH_REVOKED` ở bậc 8; kind `sheets_auth_revoked` trong danh mục; queue email gốc + con (kèm dead-letter) và payload -- AD-34, Always.
- [x] `apps/api/src/modules/integration/schema.ts` + migration `0040_…` -- cột `auth_revoked_at`; CHECK `(status = 'auth_revoked') = (auth_revoked_at IS NOT NULL)`; điền mốc cho dòng `auth_revoked` sẵn có bằng `updated_at`.
- [x] `apps/api/src/modules/integration/sheet-revocation.ts` (mới) + `index.ts` -- `revokeSheetConnection(tx, boss, connectionId, code)` và `revokeSheetConnectionsOfGrantor(tx, boss, organizationId, userId)` làm đúng phần "Chuyển `auth_revoked`"; `SheetRevocationQueues` (`ready()`); read model `revokedSheetConnectionsOf(db, organizationId)` cho `reporting`.
- [x] `apps/api/src/modules/integration/sheet-sync-jobs.ts`, `sheet-flush-jobs.ts` -- `recordGoogleFailure` dùng `revokeSheetConnection` cho loại `auth_revoked`; worker gọi `ready()` của queue mới.
- [x] `apps/api/src/modules/integration/sheet-revoked-email.ts` + `sheet-revoked-email-jobs.ts` (mới) -- mẫu email, job gốc (người nhận lúc xử lý) và job con; đăng ký trong `IntegrationJobsModule`.
- [x] `apps/api/src/modules/organizer/` (`members.service.ts`, `index.ts`, controller) -- tách `removeAdminMember(tx, ctx, memberId)` xuất qua `index.ts`; read model người nhận (Owner rồi Admin); bỏ route khỏi `MembersController`.
- [x] `apps/api/src/modules/checkin/checkers.ts`, `index.ts` -- `revokeCheckersOfMember(tx, ctx, userId)` làm đúng "Thu hồi CTV khi xóa Admin" -- Quyết định 1.
- [x] `apps/api/src/flows/member-removal.flow.ts` + controller (mới), `flows.module.ts`, `index.ts` -- route `DELETE /v1/orgs/:orgId/members/:memberId`: `ready()` trước transaction, rồi trong một transaction xóa Admin, thu hồi CTV và gọi `revokeSheetConnectionsOfGrantor`.
- [x] `apps/api/src/modules/integration/sheet-connection.service.ts`, `google-client.ts` (nếu cần) -- `startConnect` cho phép khi `auth_revoked`; `completeCallback` thêm đường kết nối lại đúng Always (dò Sheet, CAS, ba nhánh, CAS trượt).
- [x] `apps/api/src/modules/reporting/notices.service.ts` -- nguồn `sheetsAuthRevokedNotices` qua `revokedSheetConnectionsOf` + tên Sự kiện qua read model của `event`.
- [x] `apps/web/lib/reporting/status-notices.ts`, `status-banner-stack.tsx` (nếu cần) -- nội dung `SHEETS_AUTH_REVOKED` (mô tả nêu `data.eventName`), kiểu hành động mới tới tab Cài đặt của `data.eventId`; thiếu `eventId` thì banner không có hành động.
- [x] `apps/web/app/(dashboard)/btc/[orgId]/su-kien/[eventId]/google-sheets-section.tsx`, `apps/web/lib/integration/google-sheets.ts`, `apps/web/lib/notices.ts` -- trạng thái `auth_revoked` có "Kết nối lại" và câu giữ dòng bẩn; toast `sheets-reconnected`.
- [x] `README.md` › "Google Sheets" -- ghi chú giới hạn 100 refresh token và đường kết nối lại.
- [x] `apps/api/test/integration/sheet-reconnect.test.ts` (mới) -- mọi dòng I/O Matrix phía api: một email cho mỗi người nhận theo mốc, lỗi lặp không gửi lại, dùng lại Sheet và flush dòng bẩn rồi `active`, Sheet mới khi grant mới không mở được, chưa có Sheet, dò lỗi tạm thời, CAS hai người, email trễ bỏ qua, notices và thứ tự ưu tiên, `ORG_STATUS_CHANGED` khi chuyển và khi kết nối lại.
- [x] `apps/api/test/organizer/members.test.ts` -- xóa người cấp: các kết nối `auth_revoked` (`grantor_removed`) trong cùng transaction, rollback khi lỗi; xóa Admin khác không đổi kết nối; xóa Admin là CTV: dòng `active` → `revoked` + audit, dòng đã `revoked` giữ nguyên, sau đó CTV đó bị chặn ở route check-in; route vẫn trong bộ cách ly.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- thêm `note` vào E5-1: phần "removeMember thu hồi dòng checkers trong BTC" đã làm ở spec này (ngày, đường dẫn spec).
- [x] `apps/web/test/status-notices.test.ts`, `apps/web/e2e/event-google-sheets.spec.ts`, `apps/web/e2e/status-banners.spec.ts` -- banner và hành động; nút "Kết nối lại" ở Cài đặt; toast kết nối lại.

**Acceptance Criteria:**
- Given `pnpm lint:deps`, when chạy, then không có cạnh mới; `organizer` không import `integration`, `integration` không import `reporting` hay `payment`.
- Given dev stack với OAuth client Google thật (gộp kiểm tay hoãn từ 6.4 và 6.5), when kết nối một Sự kiện có Đơn thật (câu hỏi form, check-in), thanh toán một Đơn mới, check-in một Vé, rồi thu hồi quyền của Tickee ở trang quyền của tài khoản Google, đổi một Đơn, và bấm "Kết nối lại", then:
  - Sheet có tiếng Việt đúng, SĐT giữ số 0, số tiền là số, giờ Việt Nam; dòng mới và ô check-in cập nhật trong khoảng 1 phút;
  - sau khi thu hồi: banner và đúng một email; sau khi kết nối lại bằng cùng tài khoản: dùng lại Sheet cũ và có thay đổi lúc mất quyền;
  - chuyển Sheet đang kết nối vào thùng rác rồi cho flush chạy: ghi lại Google trả 404 hay vẫn ghi được (Triage #22 của 6.5); thêm một câu hỏi form để kiểm lô thêm cột với Google thật;
  - ngắt kết nối thì Sheet vẫn còn trong Drive.

## Implementation Notes

- **File mới của `integration`:** `sheet-revocation.ts` (chuyển `auth_revoked` dùng chung, queue email, read model cho banner), `sheet-revoked-email.ts` (mẫu), `sheet-revoked-email-jobs.ts` (job gốc tính người nhận, job con gửi). Migration `0040_sheet_auth_revoked_at.sql`. Flow `flows/member-removal.{flow,controller}.ts`. Export mới: `organizer.removeAdminMember`, `memberUserIdsOf`, `lockMemberRole`; `checkin.revokeCheckersOfMember`.
- **Bổ sung so với chữ của spec:**
  - khóa đóng banner ở web thêm `data.eventId` (`…:<code>:<eventId>:<version>`): hai kết nối mất quyền trong cùng transaction xóa người cấp có cùng `version`; `version` của api giữ đúng spec;
  - CAS kết nối lại kiểm thêm mốc `auth_revoked_at` đã đọc (so ở mức mili giây): kết nối lại rồi mất quyền lần mới giữa lúc dò → `sheets-failed`, bấm lại;
  - `markSynced` và `resetSpreadsheet` không bao giờ đè `auth_revoked` (CHECK mới cũng chặn);
  - lỗi lấy access token lúc dò → `sheets-failed`; job con email bỏ qua khi người nhận không còn là Owner/Admin; banner `scope: event`; vai api tạo cả queue flush lúc khởi động (kết nối lại có thể hẹn flush);
  - Google fake có knob `account` để nhiều grant thuộc cùng một tài khoản Google (kết nối lại bằng cùng tài khoản thấy lại Sheet cũ).
- **Sửa sau review (28/11/2026):**
  - callback kiểm lại vai trong transaction ghi người cấp (`lockMemberRole` khóa dòng `members` `FOR SHARE`, cả đường kết nối lại lẫn tạo mới): người bị xóa giữa chừng → `sheets-failed` (`forbidden`), kết nối không đổi;
  - job đang chạy kiểm `connectionWritable` (còn và khác `auth_revoked`) trước mỗi lần ghi Google; mất quyền giữa lượt → dừng với `skipped auth_revoked`, không ghi tiếp;
  - "Ngắt kết nối" phát `org_status_changed` (banner mất ngay);
  - web: tín hiệu cấp BTC tải lại cả mục Cài đặt Google Sheets (`googleSheetsQueryPrefix`);
  - hộp thoại "Xóa Admin khỏi BTC?" thêm câu về Google Sheets dừng đồng bộ và quyền CTV bị thu hồi;
  - README nói rõ email mỗi người nhận gửi một lần cho mỗi lần mất quyền, hiếm khi lặp nếu worker chết giữa chừng;
  - test thêm: kết nối người đó cấp ở BTC khác giữ nguyên, SMTP lỗi chỉ ném tên lớp, mất quyền giữa lượt ở flush và lần đẩy đầu (trước/sau khi ghi, khi tạo lại Sheet, giữa hai lô, sau lô cuối), người kết nối lại bị xóa trong lúc dò.
- **Kiểm chứng (28/11/2026):** `pnpm typecheck` sạch; `pnpm lint:deps` 0 vi phạm; `pnpm test`: api 113 file / 1.995 test, web 516, contracts 412, đều xanh. `pnpm test:e2e` lần đầu báo lỗi (log chỉ giữ phần cuối nên không biết test nào), chạy lại 1.438/1.438 xanh trên `ios-webkit` và `android-chromium`. Migration 0040 đã chạy lại tay trên 306 dòng `auth_revoked` có sẵn (Triage #17).
- **Còn mở:** AC thứ hai (OAuth client Google thật) chưa kiểm. Chưa chốt được hành vi thật của `drive.file` khi kết nối lại bằng cùng tài khoản (có mở lại được Sheet cũ không); hiện chỉ Google fake mô phỏng.
- Kiểm thủ công hoãn (28/11/2026): AC thứ hai (dev stack với OAuth client Google thật, gộp kiểm tay hoãn từ 6.4 và 6.5) và Verification › Manual checks → 9.1.

## Spec Change Log

## Review Triage Log

Lớp: BH = Blind Hunter, EC = Edge Case Hunter, VG = Verification Gap. Lượt 1 (28/11/2026).

| # | Lớp | Phát hiện | Verdict | Route | Bằng chứng |
|---|-----|-----------|---------|-------|------------|
| 1 | BH | Kết nối lại chen với "Xóa Admin": người kết nối lại bị xóa giữa lúc kiểm vai và transaction kết nối lại, vẫn thành người cấp | medium | patch | `completeCallback` kiểm `memberRoleOf` trước đổi code và dò Sheet (vài giây); `reconnectInTx` và `createConnection` không kiểm lại. `revokeSheetConnectionsOfGrantor` lúc xóa không thấy kết nối (người cấp cũ khác, hoặc chưa có dòng), nên sau commit Tickee ghi dữ liệu người mua vào Drive của người đã rời BTC (AD-23). Sửa: khóa dòng `members` của người gọi `FOR SHARE` trong transaction, mất vai thì thất bại. |
| 2 | BH | Job đang chạy vẫn ghi lên Google sau khi kết nối chuyển `auth_revoked` | medium | patch | `connectionExists` (`sheet-connection-store.ts:46`) trả true cho dòng `auth_revoked`; lần đẩy đầu kiểm trước mỗi lô (`sheet-sync-jobs.ts:319,355`) và flush (`sheet-flush-jobs.ts:230,260`) dùng hàm này. Xóa người cấp giữa lần đẩy đầu thì các lô 500 Đơn còn lại vẫn vào Drive người đó. Sửa: kiểm `status <> 'auth_revoked'` trước mỗi lần ghi. |
| 3 | BH | "Ngắt kết nối" một kết nối `auth_revoked` không phát `org_status_changed`, banner còn nguyên | low | patch | `disconnect()` (`sheet-connection.service.ts:191-206`) xóa dòng, không phát tín hiệu; banner chỉ tải lại theo SSE. Người vừa bấm "Ngắt kết nối" vẫn thấy banner "Kết nối lại" trỏ tới Sự kiện không còn kết nối. Sửa một dòng: phát tín hiệu trong cùng transaction. |
| 4 | BH | Mục Cài đặt Google Sheets không tải lại khi kết nối đổi `auth_revoked` hay được kết nối lại ở chỗ khác | low | patch | `refreshOnSignal` (`status-banner-stack.tsx:106`) không invalidate query Google Sheets; `sheetsRefetchInterval` chỉ poll `syncing`/`retrying`, `useLiveResource` tắt `refetchOnWindowFocus`. Banner hiện mà mục vẫn "Đã kết nối", không có "Kết nối lại"; bấm link banner cùng URL không tải lại. Sửa: invalidate tiền tố query Google Sheets khi có tín hiệu. |
| 5 | BH | Dò Sheet nhận 401 với token vừa cấp thì coi là không mở được, tạo Sheet mới; lần đẩy đầu lại mất quyền | low | reject | Phần đóng băng chốt "404, 401, 403 hay mất tab → Sheet mới". Access token vừa đổi mà bị 401 gần như không xảy ra; hậu quả là thêm một vòng banner + email. Sửa phải đổi intent. |
| 6 | BH | Chuyển `auth_revoked` không ghi audit | low | reject | Spec không đòi; xóa người cấp đã có `member.removed`, lỗi Google là hệ thống. Sửa phải thêm `AuditAction` mới (bề mặt mới), không ai gặp hậu quả khi dùng hằng ngày. |
| 7 | BH | Kết nối lại tạo Sheet mới mà toast vẫn "Đã kết nối lại", BTC có thể làm tiếp trên Sheet cũ | low | reject | Theo tiền lệ Quyết định 2 của 6.5 (Sheet mất thì tạo Sheet mới, không báo BTC); link "Mở Google Sheet" ở Cài đặt đổi sang Sheet mới. Thêm notice riêng là đổi `SheetsNotice` đã chốt trong phần đóng băng. |
| 8 | BH | Hộp thoại xóa Admin không nêu hậu quả mới (dừng đồng bộ Sheets người đó kết nối, thu hồi quyền CTV) | low | patch | `members-manager.tsx:193-195` chỉ nói "sẽ không còn quản lý Sự kiện, Đơn…". Owner gặp hộp thoại này mỗi lần xóa; UX đòi hộp thoại nêu hậu quả cụ thể. Sửa câu chữ. |
| 9 | BH | Xóa người cấp 20 Sự kiện → mỗi người nhận 20 email, kể cả Owner vừa bấm xóa | low | reject | Phần đóng băng chốt mỗi kết nối một email (I/O Matrix: "hai email cho mỗi người nhận"). |
| 10 | BH | Diff review thiếu `0040_snapshot.json` và file spec | false | reject | Hai file được loại khỏi diff review có chủ đích (snapshot sinh tự động, spec là claims của lớp Edge Case); cả hai có trong cây làm việc và sẽ vào commit. |
| 11 | BH | Chưa test CAS mới của `markSynced`/`resetSpreadsheet` khi mất quyền giữa lượt | gap | patch | Trùng #15. |
| 12 | BH | Backfill migration cho kết nối mất quyền từ trước: có banner mà không có email; `updated_at` có thể không phải lúc mất quyền | low | reject | Trước Closed Beta chưa có người dùng thật (Design Notes 6.5); chỉ dữ liệu dev/test bị ảnh hưởng. Gửi email bù phải thêm job một lần. |
| 13 | BH | README ghi "đúng một email" nhưng job con gửi ít nhất một lần | low | patch | SMTP xong mà worker chết trước khi chốt job thì pg-boss gửi lại. Sửa câu chữ README. |
| 14 | VG | Xóa Admin ở BTC A: chưa test kết nối người đó cấp ở BTC B giữ nguyên | gap | patch | `members.test.ts:689-738` chỉ tạo kết nối trong BTC hiện tại; bỏ `orgScope` ở `revokeSheetConnectionsOfGrantor` thì không test nào đỏ. |
| 15 | VG | Guard "không đè `auth_revoked`" của `markSynced`/`resetSpreadsheet` chưa được kiểm bằng ca mất quyền giữa lượt | gap | patch | Ca giữa lượt duy nhất (`sheet-flush.test.ts:668-701`) xóa kết nối, không chuyển `auth_revoked`. Thêm ca chuyển `auth_revoked` giữa lượt cho flush và lần đẩy đầu (cùng sửa #2). |
| 16 | VG | Nhánh SMTP lỗi của email mất quyền (lỗi chỉ mang tên lớp) chưa có test | gap | patch | Mọi lời gọi `sendSheetsAuthRevokedEmail` trong test chỉ assert `sent`/`skipped`; tiền lệ `payout-default-job.test.ts:216-224`. |
| 17 | VG | Backfill của migration 0040 chỉ chạy trên bảng rỗng trong test | gap | reject | Đã kiểm tay (28/11/2026): trên `tickee_test`, trong một transaction rollback, đưa bảng về trạng thái trước 0040 rồi chạy lại 0040 với 306 dòng `auth_revoked`: `UPDATE 306`, CHECK thêm được, mọi dòng `auth_revoked` có mốc bằng `updated_at`. Repo không có harness migrate trên dữ liệu cũ. |
| 18 | VG | Job đang chạy vẫn ghi khi kết nối đã `auth_revoked` (`connectionExists`) | medium | patch | Trùng #2. |
| 19 | EC | Người kết nối lại bị xóa khỏi BTC trước khi transaction kết nối lại commit | medium | patch | Trùng #1. |
| 20 | EC | Guard trước khi ghi bỏ qua `auth_revoked` | medium | patch | Trùng #2. |
| 21 | EC | Job cũ xong sau khi kết nối lại đặt lại Sheet: `markSynced` chỉ loại `auth_revoked` → `active` với spreadsheet rỗng | low | reject | Cần mất quyền và cả lượt OAuth kết nối lại xảy ra giữa lần kiểm cuối của job và `markSynced`. Sau sửa #2 job kiểm trạng thái trước mỗi lần ghi, nên cửa sổ chỉ còn một lời gọi Google, ngắn hơn một lượt OAuth. Sửa phải đổi chữ ký `markSynced`. |
| 22 | EC | Job cũ dùng token trước kết nối lại nhận 401 sau khi đã kết nối lại → kết nối lành bị chuyển `auth_revoked` lần nữa | low | reject | Cùng điều kiện thời gian với #21: sau sửa #2 job đã dừng ngay lần kiểm sau khi mất quyền, trước khi kết nối lại kịp xong. |
| 23 | EC | Sheet cũ đọc được mà không ghi được (chỉ xem) → dùng lại rồi 403 → mất quyền lại | low | reject | Với `drive.file`, cùng tài khoản là chủ file app tạo (có quyền sửa), tài khoản khác không mở được file (404/403 → Sheet mới). Chỉ xảy ra khi chủ file chuyển quyền sở hữu rồi tự hạ xuống chỉ xem; kiểm thêm phải gọi Drive API. |
| 24 | EC | Code cũ còn chạy sau migration ghi `auth_revoked` thiếu mốc → vi phạm CHECK | low | reject | Chưa có production (deploy ở 9.1); lỗi ồn ào, job retry và code mới xử lý. |
| 25 | EC | Hai notice theo Sự kiện thiếu `eventId` hợp lệ, cùng `version` → trùng khóa | false | reject | Mã theo Sự kiện duy nhất là `SHEETS_AUTH_REVOKED`, và `notices.service.ts` luôn đặt `eventId` từ cột uuid của DB. |
| 26 | EC | `queues.ready()` trước khi kiểm UUID: pg-boss hỏng thì mọi lần xóa Admin lỗi 500 | low | reject | pg-boss dùng cùng Postgres nên hỏng cùng lúc với DB (tiền lệ Triage #16 của 6.5); lời xóa thật luôn cần queue. |
| 27 | EC | Không dò khi lần đẩy đầu chưa xong, bỏ Sheet dở | false | reject | Đúng phần đóng băng: "Sheet mới, hoặc lần đẩy đầu chưa xong → đặt lại Sheet". |
| 28 | EC | Chữ ký `revokedSheetConnectionsOf` nhận `scope` thay vì `organizationId` như Tasks ghi | low | reject | Typecheck sạch; `scope` theo mẫu read model của dự án. Chỉ khác câu chữ trong Tasks. |

## Design Notes

**Vì sao `auth_revoked_at`:** cột này là khóa chống gửi lặp của email và là `version` của banner. Mất quyền lần hai sau khi đã kết nối lại là một lần mới: mốc mới thì có email mới, và banner đã đóng hiện lại. Tiền lệ `token_below_threshold_since` của 4.5-b.

**Vì sao dò Sheet ở callback:** token vừa cấp nên 403/404 khi đọc Sheet cũ nghĩa là grant mới không có quyền với file đó (`drive.file` chỉ mở file app tạo hoặc người dùng mở bằng app), không phải mất quyền. Để flush tự gặp lỗi này thì 6.5 xếp 403 vào `auth_revoked`, và kết nối vừa nối lại sẽ mất quyền ngay.

**Vì sao flow ở `flows/`:** `organizer` không được gọi `integration` hay `checkin`. Route chuyển sang `flows/` giữ nguyên path, nên web, test HTTP và bộ cách ly không đổi.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: 0 lỗi
- `pnpm lint:deps` -- expected: 0 vi phạm
- `pnpm test` -- expected: xanh, gồm `sheet-reconnect`, `members`, `isolation`, `sheet-flush`, `sheet-initial-sync`, contracts, web
- `pnpm test:e2e` -- expected: xanh trên `ios-webkit` và `android-chromium`

**Manual checks (if no CLI):**
- Như AC thứ hai: dev stack, OAuth client Google thật.
