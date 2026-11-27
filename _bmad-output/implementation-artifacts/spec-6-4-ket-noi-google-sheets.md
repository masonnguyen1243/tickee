---
title: 'Story 6.4: Kết nối Google Sheets'
type: 'feature'
created: '2026-11-27'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: 'ca0167612d512770db55a9b3a9c1262e1fa52b50'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Owner/Admin chỉ xem được Đơn trên dashboard hoặc qua CSV. Đội của họ muốn có danh sách Đơn trong Google Sheet quen dùng (FR-32, AD-23). Mô-đun `integration` hiện chỉ có `index.ts` rỗng.

**Approach:** Tab Cài đặt của Sự kiện có mục "Google Sheets". Nút "Kết nối Google Sheets" chạy OAuth riêng với scope `drive.file` (PKCE, `state` dùng một lần), tách khỏi đăng nhập Google. Callback lưu kết nối (refresh token mã hóa bằng `SecretBox`, trạng thái `syncing`), ghi audit và enqueue một job trong cùng transaction. Worker tạo spreadsheet mới trong Drive của người cấp, ghi hàng tiêu đề và mọi Đơn hiện có, rồi chuyển `active`. Mục Cài đặt hiện link, trạng thái, `last_synced_at`, người kết nối và nút "Ngắt kết nối". Ngắt kết nối thì xóa token và ghi audit.

**Quyết định (Mason, 27/11/2026):**
1. Lần đẩy đầu chỉ gồm Đơn `paid`, `review`, `cancelled`, `refunded`, đúng các trạng thái kích hoạt đồng bộ ở 6.5. Đơn `pending` hiện lên khi chuyển `paid`; Đơn `expired` không bao giờ lên Sheet.
2. Cột Sheet giống CSV 6.3 nhưng bỏ cột "Cần xử lý" (vì `integration` không được gọi `payment`). Thứ tự: Mã Đơn · Tên người mua · Email · SĐT · Vé · Số tiền · Đã nhận · Trạng thái · Thời gian tạo · Thời gian thanh toán · Đã check-in · Số Vé, rồi mỗi câu hỏi form một cột theo `answerColumnsOf`. Cột "Trạng thái" vẫn ghi "Cần xử lý" cho Đơn `review`.
3. Giữ nguyên spec dù vượt ngưỡng 5.000 token: một mục tiêu người dùng, không tách theo tầng.

**Quyết định sau review lượt 1 (Mason, 27/11/2026; Triage #1, #21, #29, #30):**
4. Lỗi do cấu hình phía Tickee không phải "mất quyền":
   - các trường hợp gồm: token endpoint trả `invalid_client` hoặc `unauthorized_client`; Sheets API trả 403 với lý do `SERVICE_DISABLED` hoặc `accessNotConfigured` (API chưa bật trong project Google);
   - xử lý như lỗi tạm thời: `retrying` kèm `last_error_code` riêng, retry có backoff, hết lượt thì vào dead-letter và có cảnh báo vận hành. Sửa cấu hình xong, requeue từ `/admin` là kết nối chạy tiếp, BTC không phải kết nối lại;
   - chỉ `invalid_grant` và các 401/403 còn lại mới là `auth_revoked`.
5. Sửa tại chỗ trên code đã có, không revert, như Story 6.3.

## Boundaries & Constraints

**Always:**
- Ba route BTC dưới `/v1/orgs/:orgId/events/:eventId/google-sheets` (`GET` trạng thái, `POST …/connect`, `DELETE`) dùng `@RequirePermission(EVENTS_MANAGE)`, gồm Owner và Admin. Sự kiện không thuộc BTC → 404. Callback `GET /v1/integrations/google-sheets/callback` dùng `@OptionalAuth()`, luôn trả 302 về web, không bao giờ trả JSON.
- `POST …/connect` trả `{ authorizationUrl }` để web chuyển trang. Lỗi đi qua luồng mutation thường (2FA, 401, toast). Sự kiện đã có kết nối → `409 SHEETS_ALREADY_CONNECTED`.
- `state` là 32 byte ngẫu nhiên. DB chỉ lưu hash SHA-256, kèm BTC, Sự kiện, người dùng, `code_verifier` (đã mã hóa) và hạn 10 phút. Callback xóa dòng `state` bằng `DELETE … RETURNING` để dùng một lần, rồi kiểm:
  - `state` còn hạn;
  - người dùng của session trùng người tạo `state`;
  - người đó vẫn có `EVENTS_MANAGE` trong BTC (qua `memberRoleOf`).
  Sau đó đổi `code` lấy token ngoài transaction. Không có `refresh_token` → thất bại.
- Mỗi Sự kiện tối đa một kết nối: unique `event_id`. Callback thua race thì báo "đã kết nối", không ghi đè kết nối có sẵn.
- Refresh token, access token, `code`, `state` và `code_verifier` không bao giờ được log hay trả về web. Response chỉ có `{status, spreadsheetUrl, lastSyncedAt, lastErrorCode, connectedByName, createdAt}`.
- Không gọi Google bên trong transaction DB. Tạo Sheet và ghi Sheet chỉ chạy ở vai `worker`.
- Job idempotent:
  - lưu `spreadsheet_id` ngay sau khi tạo Sheet; lần retry dùng lại id đó, không tạo Sheet thứ hai;
  - ghi theo lô bằng `values` với `valueInputOption=RAW`, vào đúng các ô cố định, nên retry ghi đè cùng ô;
  - trước khi ghi, nới lưới của tab cho đủ số dòng và số cột;
  - kiểm kết nối còn tồn tại trước mỗi lô và trước bước cập nhật cuối.
- Dòng Sheet chỉ dùng mã Đơn `TK…`; không có id nội bộ, Mã QR hay token. Giá trị định dạng giống CSV 6.3 (`ORDER_STATUS_LABEL`, `formatVnTimestamp`, `eventOrderItemsText`, `csvBuyerPhone`); số tiền là số. Câu trả lời form thì **không** thêm `'` (`csvDigitsAsText` là mẹo riêng cho Excel; `RAW` đã giữ chữ).
- Lỗi Google trong job:
  - `invalid_grant`, 401 hoặc 403 → `auth_revoked`, job hoàn tất, không retry. Trừ lỗi cấu hình ở Quyết định 4;
  - 429, 5xx, timeout, lỗi mạng hoặc lỗi cấu hình (Quyết định 4) → `retrying` + `last_error_code`, retry có backoff (`retryLimit` 5), hết lượt → dead-letter (cảnh báo `DEAD_LETTER` tự quét).
- Nút gọi mạng có spinner và chặn bấm lặp. "Ngắt kết nối" mở `ConfirmDialog` nêu hậu quả: dừng đồng bộ, Sheet giữ nguyên trong Drive. Bố cục chạy ở 320px không cuộn ngang.

**Never:**
- Không làm việc của 6.5: `integration.sheet_row_changed`, bảng dòng bẩn, job flush, đo P95, cách nhận ra cột Tickee khi BTC chèn cột, thêm cột cho câu hỏi form mới sau khi đã kết nối.
- Không làm việc của 6.6: banner hoặc email `auth_revoked`, "Kết nối lại", chuyển `auth_revoked` khi người cấp bị xóa khỏi BTC (cùng chỗ `removeMember` của E5-1).
- Không import `payment` hay `reporting` từ `integration` (`apps/api/module-graph.cjs:16`). Không dùng provider Google của Better Auth: Story 1.4 cố ý bỏ token Google.
- Không gọi endpoint revoke của Google khi ngắt kết nối: revoke hủy cả grant của tài khoản Google đó, làm hỏng kết nối của Sự kiện khác do cùng người cấp.
- Không thêm Permission mới và không sửa `packages/contracts/src/organizer.ts`, để không chạm điều kiện tách file của E4-10. Không thêm bộ giới hạn tốc độ mới (E5-5). Không chuyển các hàm hash token hiện có sang `platform/crypto` (E5-5).
- Không bắt xác nhận lại (reauth) khi kết nối hay ngắt: nhất quán với xuất CSV.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bắt đầu kết nối | Admin, Sự kiện chưa có kết nối | `authorizationUrl` có `scope=…/drive.file`, `access_type=offline`, `prompt=consent`, `code_challenge_method=S256`, `state`, `redirect_uri=<API_PUBLIC_URL>/v1/integrations/google-sheets/callback` | Đã có kết nối → 409 |
| Callback thành công | `code` + `state` hợp lệ, cùng người dùng | Kết nối `syncing` + audit `sheet_connection.created` + job, trong một `tx`; 302 `<WEB_ORIGIN>/btc/<orgId>/su-kien/<eventId>?tab=cai-dat&notice=sheets-connected` | N/A |
| Người dùng từ chối | `error=access_denied` + `state` hợp lệ | Không tạo gì; xóa `state`; 302 về Cài đặt, `notice=sheets-denied` | N/A |
| `state` hỏng | Lạ, hết hạn, đã dùng, khác người dùng, không session, mất quyền | Không đổi `code`; không tạo gì | 302 `notice=sheets-failed` (về Cài đặt nếu biết Sự kiện, không thì về trang gốc web) |
| Đổi token thất bại | Token endpoint lỗi hoặc thiếu `refresh_token` | Không tạo kết nối | 302 `notice=sheets-failed` |
| Hai callback song song | Cùng Sự kiện | Đúng một kết nối | Bên thua: `notice=sheets-already-connected` |
| Job lần đầu | Kết nối `syncing` | Tạo Sheet (tiêu đề, tab "Đơn", cố định dòng 1), ghi tiêu đề và Đơn; `active` + `last_synced_at` | N/A |
| Sự kiện chưa có Đơn | 0 Đơn | Sheet chỉ có hàng tiêu đề; `active` | N/A |
| Google lỗi tạm thời | 429, 5xx, timeout | `retrying`, `last_error_code`; retry dùng lại `spreadsheet_id` | Hết lượt → dead-letter |
| Mất quyền | `invalid_grant`, 401, 403 | `auth_revoked`; không retry | N/A |
| Lỗi cấu hình | Token endpoint `invalid_client`/`unauthorized_client`; Sheets 403 `SERVICE_DISABLED`/`accessNotConfigured` | `retrying` + `last_error_code` riêng; không `auth_revoked` | Hết lượt → dead-letter; requeue sau khi sửa cấu hình |
| Ngắt khi job đang chạy | Dòng kết nối đã xóa | Job dừng trước lô kế tiếp, không cập nhật trạng thái | N/A |
| Ngắt kết nối | `DELETE` | Xóa dòng (token đi theo), audit `sheet_connection.deleted`, 204; Sheet giữ nguyên | Không có kết nối → 404 |

</frozen-after-approval>

## Code Map

**API, mô-đun `integration`** (`apps/api/src/modules/integration/`, hiện chỉ có `index.ts` rỗng):
- Mẫu bố cục mô-đun: `modules/checkin` (`index.ts`, `checkin.module.ts:19-24`, `schema.ts`, `lookup-attempts-jobs.ts`).
- Mẫu job worker gọi HTTP: `modules/event/public-page-jobs.ts`:
  - `PUBLIC_PAGE_QUEUE` :29, `PublicPageQueues extends QueueProducer` :97, `PublicPageWorker` :112, `EventJobsModule.forRoot` :144;
  - mẫu có dead-letter: `payment/reconciliation-worker.ts:122`, tùy chọn retry ở `ordering/reconciliation-jobs.ts:59-63`.
- Hạ tầng queue: `platform/jobs/queue.ts`:
  - `defineQueue` :66, `QueueProducer` :101 (`ready()`), `registerQueueWorker` :183 (`handle` trả `JOB_COMPLETED` hoặc `{status:'retry', reason}`);
  - enqueue trong `tx`: `QUEUE.enqueue(boss, tx, payload)` :56-63;
  - gọi `await queues.ready()` trước khi mở `tx`, như `organizer/members.service.ts:114`.
- Đăng ký mô-đun: `apps/api/src/api.module.ts` (`ApiModule.forRoot`) và `apps/api/src/worker.module.ts:38-68`.
- Mã hóa token: `platform/crypto/secret-box.ts`:
  - `parseCredentialKeys` :40, `SecretBox` :72 (`seal` :90 → `v<k>:…`, `open` :100);
  - cách dùng: `organizer/payment-service.ts:320`, chỉ đọc, không sửa.
- Mẫu hash token: `reauth_grants` (`identity/schema.ts:203-220`), `checkin/invite-token.ts`. Viết hàm hash riêng trong `integration`, theo đúng cách mỗi mô-đun hiện tự có một bản.
- Mẫu HTTP client và fake:
  - `tingee/tingee.client.ts:549-585`: `fetch(new URL(path, baseUrl))` + `AbortSignal.timeout`; lỗi transport không mang dữ liệu request;
  - fake `node:http`: `test/tingee-fake/server.ts`. Chưa có fake Google; `test/identity/google-login.test.ts:15-80` chỉ `spyOn(fetch)`.
- Session và quyền:
  - `OptionalAuth` (`identity/index.ts`) gắn `req.user` khi có session;
  - `memberRoleOf(db, userId, orgId)` và `memberNamesOf` (`organizer/index.ts`);
  - `roleHasPermission` ở contracts;
  - `@RequirePermission` (`platform/access/require-permission.ts:21`) + `@Access()`.
- Read model Đơn (`integration` được gọi `ordering`, `ticketing`, `event`):
  - `eventOrdersPageOf(db, {organizationId}, eventId, {statuses, cursor, limit})` (`ordering/event-orders-read.ts:80`), xếp `created_at DESC`;
  - `answerColumnsOf` :216, `answersOfOrders` :245 (không có scope, nên chỉ truyền id đã lọc theo scope);
  - `checkinCountsOfOrders` (`ticketing/order-checkin-counts.ts:18`);
  - Sự kiện: `assertEventOfOrganization`, cùng một hàm đọc tên Sự kiện trong `event/public-event.ts` (`ticketEventById`/`saleEventById`). Không có hàm phù hợp thì thêm `eventTitleOf` vào `event` và xuất qua `index.ts`.
- Mẫu cột và định dạng: `reporting/event-orders-csv.ts:22-81`. Không import file này; viết builder riêng trong `integration`.
- 302 về web: `identity/identity.controller.ts:84-96` (`cache-control: no-store`).
- Log: `platform/logging/pino-options.ts:85` `redactUrlQuery` đã che `code`/`state`. `ALWAYS_REDACTED` (`packages/contracts/src/pii.ts:22`) chưa có `refresh_token`/`access_token`.

**Config, audit, test chung:**
- `platform/config/config.schema.ts`:
  - `credentialKeys` :54, `GOOGLE_CLIENT_ID` :283;
  - api spread :285, worker spread :451;
  - `CROSS_RULES` :317 (mẫu cấm dùng chung khóa :379-384).
- `platform/config/production-rules.ts`: `ENV_EXAMPLE_SECRETS` :13, `ENV_EXAMPLE_KEYS` :26.
- `.env.example`: `GOOGLE_*` :62-63, `TINGEE_CREDENTIAL_KEYS` :93.
- `platform/audit/audit.ts`: union `AuditAction` :6-205; `audit.record(tx, …)` :230.
- `apps/api/drizzle/`: bản mới nhất là `0037_…`. Sinh migration bằng `pnpm --filter @tickee/api db:generate`.
- `apps/api/test/organizer/isolation.test.ts`: `guarded` :84, `permissionOf` :170. Không có tổng số route cứng.
- `apps/api/test/e2e-stack/main.ts`: khởi Tingee fake trong tiến trình :229-280, nạp env từ `.env.example` :55.
- Queue: `packages/contracts/src/jobs.ts` (`JobQueue`, dead-letter `<tên>.dead-letter`).

**Web** (gốc `apps/web/`):
- `app/(dashboard)/btc/[orgId]/su-kien/[eventId]/event-settings.tsx`: `EventSettings` :476; khối section :431-438 (`rounded-lg bg-card p-card-padding shadow-card` + `h2.text-title`).
- Mẫu kết nối ngoài: `…/tai-khoan-nhan-tien/linked-view.tsx` (`StatusBadge` :242-245, `UnlinkDialog`/`ConfirmDialog` :80-185, `onError` theo mã lỗi + `handledElsewhere`).
- Chuyển trang sang API: `components/tickee/google-signin-button.tsx` (spinner, reset khi `pageshow` `persisted`).
- Notice khi quay về: `lib/notices.ts` (`NOTICES`, `?notice=`), `components/tickee/notice-toast.tsx`.
- Fetcher và query key: `lib/event/api.ts:28,51`, `lib/api/client.ts` (`apiRequest` :129). `formatVnDateTime` ở `packages/contracts/src/event.ts:392`.
- Test:
  - `e2e/organizer-mock.ts`: `defaultHandler` :120-155. Phải thêm mặc định `GET …/google-sheets` → `{connection:null}`, không thì `e2e/event-settings.spec.ts` nhận 500;
  - mẫu chặn chuyển trang: `e2e/login-google.spec.ts:17-39`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/google-sheets.ts` (+ `index.ts`, test) -- enum `SheetConnectionStatus`, schema `EventSheetConnectionResponse`/`SheetConnectStartResponse`, đường API, `GOOGLE_SHEETS_SCOPE`, nhãn và tone trạng thái, mã `last_error_code` -- hợp đồng chung api/web.
- [x] `packages/contracts/src/jobs.ts` -- `INTEGRATION_SHEET_INITIAL_SYNC` + dead-letter -- AD-12.
- [x] `packages/contracts/src/pii.ts` -- thêm `refresh_token`, `access_token`, `code_verifier` (và dạng camelCase) vào `ALWAYS_REDACTED` -- NFR-6.
- [x] `apps/api/src/platform/config/config.schema.ts`, `production-rules.ts`, `.env.example` (+ test config) --
  - api và worker: `GOOGLE_SHEETS_CLIENT_ID`, `GOOGLE_SHEETS_CLIENT_SECRET`, `GOOGLE_SHEETS_TOKEN_KEYS` (dạng `credentialKeys`, không trùng khóa với `TINGEE_CREDENTIAL_KEYS`/`TICKET_QR_KEYS`);
  - `GOOGLE_OAUTH_AUTHORIZE_URL`, `GOOGLE_OAUTH_TOKEN_URL`, `GOOGLE_SHEETS_API_URL`, mặc định là endpoint thật, production bắt https;
  - giá trị mẫu bị cấm ở production -- AD-23.
- [x] `apps/api/src/platform/audit/audit.ts` -- `'sheet_connection.created'`, `'sheet_connection.deleted'` -- audit.
- [x] `apps/api/src/modules/integration/schema.ts` + migration `0038_…` -- `sheet_connections` (unique `event_id`, `organization_id`, `granted_by_user_id`, `status` có CHECK, `spreadsheet_id`, `spreadsheet_url`, `refresh_token` đã mã hóa, `last_synced_at`, `last_error_code`, `created_at`, `updated_at`) và `sheet_oauth_states` (`state_hash` unique, BTC, Sự kiện, người dùng, `code_verifier` đã mã hóa, `expires_at`). Tạo `state` thì xóa luôn các dòng hết hạn của người đó -- AD-23.
- [x] `apps/api/src/modules/integration/google-client.ts` -- `fetch` tới ba base URL trong config, timeout 10 giây:
  - `authorizationUrl`, `exchangeCode`, `accessToken(refresh)`;
  - `createSpreadsheet`, `resizeGrid`, `writeValues`;
  - lỗi phân loại `auth_revoked` | `transient(code)` | `failed`, không mang token hay body -- tách HTTP để test bằng fake.
- [x] `apps/api/src/modules/integration/sheet-rows.ts` -- hàm thuần: hàng tiêu đề và dòng của một Đơn, theo cột ở Quyết định 2 -- test riêng.
- [x] `apps/api/src/modules/integration/sheet-connection.service.ts`, `sheet-connection.controller.ts`, `sheet-oauth.controller.ts`, `integration.module.ts`, `index.ts` -- ba route BTC và callback như Always và I/O Matrix -- AC 6.4.
- [x] `apps/api/src/modules/integration/sheet-sync-jobs.ts` -- queue, worker `IntegrationJobsModule.forRoot`:
  - tạo Sheet tên "Tickee · <tên Sự kiện>", tab "Đơn", `locale` `vi_VN`, `timeZone` `Asia/Ho_Chi_Minh`, cố định dòng 1;
  - đọc Đơn theo lô 500 qua read model, dòng xếp cũ → mới;
  - nới lưới, ghi tiêu đề và các lô; cập nhật trạng thái -- job lần đầu.
- [x] `apps/api/src/api.module.ts`, `worker.module.ts` -- đăng ký hai mô-đun.
- [x] `apps/api/test/google-fake/server.ts` -- fake `node:http`:
  - authorize tự đồng ý (302 kèm `code`/`state`; chỉnh được thành `access_denied`);
  - token (kiểm PKCE; kịch bản `invalid_grant`, 500, thiếu `refresh_token`);
  - tạo spreadsheet, `batchUpdate`, `values`; lưu ô trong bộ nhớ và ghi lại request -- dùng cho test và e2e-stack.
- [x] `apps/api/test/integration/google-sheets.test.ts`, `sheet-initial-sync.test.ts`, `sheet-rows.test.ts` (mới) -- mọi dòng I/O Matrix:
  - ciphertext có tiền tố `v1:` và không chứa token gốc;
  - response và log không có token;
  - Sheet có tiêu đề và Đơn đúng thứ tự, giá trị đúng (gồm 0 Đơn, cột form, Đơn nhiều Vé đã check-in);
  - retry không tạo Sheet thứ hai -- khóa hành vi.
- [x] `apps/api/test/organizer/isolation.test.ts` -- thêm ba route vào `guarded`/`permissionOf` (`events.manage`) -- cách ly BTC.
- [x] `apps/api/test/e2e-stack/main.ts` -- khởi Google fake, trỏ ba URL Google vào fake -- kiểm được trên stack local.
- [x] `apps/web/lib/integration/google-sheets.ts` (+ vitest) -- query key, `fetch…`, `startSheetsConnect`, `disconnectSheets`.
- [x] `apps/web/lib/notices.ts` -- `sheets-connected`, `sheets-denied`, `sheets-failed`, `sheets-already-connected`.
- [x] `…/[eventId]/google-sheets-section.tsx` (mới) + `event-settings.tsx` -- mục "Google Sheets":
  - chưa kết nối: mô tả ngắn + nút "Kết nối Google Sheets" (viền, không phải hành động chính);
  - đã kết nối: badge trạng thái, "Mở Google Sheet" (tab mới; "Đang tạo Sheet…" khi chưa có link), "Đồng bộ lần cuối", "Kết nối bởi <tên>", "Ngắt kết nối" + `ConfirmDialog`;
  - poll 3 giây khi `syncing`.
- [x] `apps/web/e2e/organizer-mock.ts`, `apps/web/e2e/event-google-sheets.spec.ts` (mới) -- mặc định `{connection:null}`; bốn trạng thái; kết nối chuyển tới `authorizationUrl` (chặn trang thật); ngắt kết nối qua dialog; notice khi quay về; 375px không cuộn ngang.
- [x] `README.md` -- tạo OAuth client Google (Web, scope `drive.file`, redirect URI `<API_PUBLIC_URL>/v1/integrations/google-sheets/callback`), biến env mới, cách sinh khóa.

**Acceptance Criteria:**
- Given tab Cài đặt chưa có kết nối, when bấm "Kết nối Google Sheets" và đồng ý trên Google (fake), then quay về tab Cài đặt kèm toast; sau vài giây trạng thái là "Đã kết nối", có link Sheet và giờ đồng bộ; Sheet có hàng tiêu đề và mọi Đơn hiện có.
- Given một kết nối, when đọc DB, `GET` trạng thái và log của cả lượt, then refresh token chỉ tồn tại dưới dạng `v<k>:…`, không có trong response hay log.
- Given đã kết nối, when bấm "Ngắt kết nối" rồi xác nhận, then mục quay về "chưa kết nối", `audit_events` có `sheet_connection.deleted` với actor, BTC và Sự kiện, và không có request nào tới Google.
- Given CTV, hoặc thành viên BTC khác, gọi ba route, then nhận 403/404 như bộ test cách ly.

## Implementation Notes

- **Lỗi Google khác hai loại spec nêu** (4xx lạ, JSON sai dạng; `unexpected_response`): job vẫn xử lý như lỗi tạm thời (`retrying`, retry có backoff, hết lượt vào dead-letter), không chuyển `auth_revoked`.
- **Lưới tab "Đơn":** tab có id cố định `0`, nên lần retry nới đúng tab mà không cần lưu thêm id. Lưới không nhỏ hơn mặc định của Google (1.000 dòng × 26 cột). `resizeGrid` đặt kích thước tuyệt đối (không đọc lưới hiện tại), nên lần retry có thể thu nhỏ lưới nếu ai đó đã nới thêm (Triage #4, mục hoãn 6.5).
- **Audit:** `sheet_connection.created` và `sheet_connection.deleted` có đối tượng `{type:'event', id}`, nên mỗi dòng ghi đủ actor, BTC và Sự kiện; id kết nối không vào audit.
- **Callback:**
  - ngoài các kiểm của spec, callback còn thất bại khi Google trả `scope` mà không có `drive.file`;
  - lỗi xảy ra trước handler (guard 2FA hay đồng ý NĐ 13 của session đang có) đi qua `SheetsCallbackExceptionFilter`: 302 về trang gốc web với `notice=sheets-failed`, không bao giờ trả JSON.
- **Ngoài Code Map:**
  - `isolation.test.ts` có tổng số route Sự kiện cứng (31 → 34), và route `connect` nằm trong nhóm route không có body;
  - `.github/workflows/ci.yml` thêm ba biến Google Sheets vào bước khởi động image, kèm kiểm không lộ secret;
  - `roles.process.test.ts`, `telemetry.process.test.ts`, `test/helpers.ts` thêm biến mới;
  - Google fake chạy ở cổng 4020 trong e2e-stack;
  - lỗi mới `SHEETS_ALREADY_CONNECTED` (409) và `SHEETS_NOT_CONNECTED` (404) ở `contracts/errors.ts` + `app-error.ts`.
- **`.env` local:** api và worker dừng khi khởi động nếu thiếu `GOOGLE_SHEETS_CLIENT_ID`, `GOOGLE_SHEETS_CLIENT_SECRET`, `GOOGLE_SHEETS_TOKEN_KEYS`. Chép ba biến này từ `.env.example`. Agent không sửa `.env`.
- **Kiểm chứng của agent triển khai (27/11/2026):**
  - `pnpm typecheck` và `pnpm lint:deps` sạch;
  - `pnpm test` xanh (contracts 24 file, web 45, api 109);
  - `pnpm test:e2e` xanh 1.418 test trên `ios-webkit` và `android-chromium`;
  - chạy cả luồng trên e2e-stack với Google fake: OTP → kết nối → callback 302 `notice=sheets-connected` → `active` trong khoảng 1 giây → `DELETE` 204. Log api/worker không có token; URL callback được che thành `code=[REDACTED]&state=[REDACTED]`.
- **Kiểm chứng lại ở step-03 (27/11/2026):**
  - `test/integration/*` + `isolation.test.ts` + `config.test.ts`: 132/132 xanh;
  - contracts `google-sheets.test.ts` 8/8, web `google-sheets.test.ts` 9/9;
  - `pnpm typecheck` và `pnpm lint:deps` sạch;
  - e2e `event-google-sheets.spec.ts` + `event-settings.spec.ts`: 94/94 xanh.
- **Sửa sau review lượt 1 (27/11/2026), tại chỗ theo Quyết định 5:**
  - lỗi cấu hình (Quyết định 4) dùng mã mới `SheetSyncErrorCode.CONFIGURATION` (`configuration`). `httpFailure` xét theo thứ tự `invalid_grant` → `invalid_client`/`unauthorized_client` hoặc lý do `SERVICE_DISABLED`/`accessNotConfigured` (trong `error.details[].reason` và `error.errors[].reason`) → 401/403;
  - `markSyncFailure` trả `false` thì job trả `disconnected`;
  - `startConnect` xóa mọi lượt OAuth đã hết hạn, của bất kỳ ai;
  - spinner "Đang tạo Sheet…" chỉ hiện khi `syncing`/`retrying`;
  - web poll 3 giây khi `syncing`, 15 giây khi `retrying` (`SHEETS_RETRYING_POLL_MS`);
  - mục đã kết nối thêm dòng "Sheet nằm trong Google Drive của <tên>. Thành viên khác cần được chia sẻ Sheet trên Google mới mở được.";
  - gói lại dòng comment trong `.env.example`; README thêm cách xử lý lỗi cấu hình (retry, dead-letter, requeue từ `/admin` sau khi sửa);
  - test mới cho Triage #15–#20 (pg-boss `retry` qua worker thật, `unexpected_response`, lưới 28 cột, SecretBoxError, `scope_missing`, web 404 khi ngắt), cho lỗi cấu hình và cho `disconnected` sau `markSyncFailure`.
- **Kiểm chứng sau lượt sửa 1 (27/11/2026):**
  - `pnpm typecheck` và `pnpm lint:deps` sạch;
  - `pnpm test` xanh (contracts 405, web 511, api 1.893);
  - `pnpm test:e2e` 1.420/1.420 xanh.
- **Sửa sau review lượt 2 (27/11/2026):**
  - audit `sheet_connection.deleted` lưu `eventId` dạng chữ thường;
  - callback log mã `error` của Google nếu nằm trong danh sách mã OAuth đã biết, không thì ghi `other`;
  - câu về Drive đổi thành "Sheet nằm trong Google Drive của tài khoản Google mà <tên> dùng khi kết nối…";
  - hậu quả của "Ngắt kết nối" thêm câu "Kết nối lại sau này sẽ tạo một Sheet mới.";
  - README ghi rõ staging và production phải đặt consent screen ở "In production": ở chế độ Testing, refresh token hết hạn sau 7 ngày và chỉ test user được đồng ý;
  - test mới:
    - api: `connectedByName` thành `null` sau khi người cấp rời BTC; lỗi Google khác `access_denied`; `code_missing`; `verifier_unreadable`; `invalid_client` ở callback; audit nhận `eventId` viết hoa;
    - e2e: kết nối trả 500 và 401.
- **Kiểm chứng sau lượt sửa 2 (27/11/2026):**
  - `pnpm typecheck` và `pnpm lint:deps` sạch;
  - `pnpm test` xanh (contracts 405, web 511, api 1.901);
  - `pnpm test:e2e`: 1.423 xanh, 1 đỏ ở spec không liên quan 6.4: `payout-account.spec.ts:752` trên `ios-webkit` (hết 30 giây). Chạy lại riêng test đó 5 + 6 lần: 10/11 xanh; cả spec 72/72 xanh. Đây là test chập chờn trên webkit (nhóm E2-8); 6.4 không chạm trang Tài khoản nhận tiền hay trang chủ BTC.
- **Chưa làm:** kiểm thủ công với OAuth client Google thật (mục Verification › Manual checks).

## Spec Change Log

## Review Triage Log

Lớp: BH = Blind Hunter, EC = Edge Case Hunter, VG = Verification Gap. Lượt 1 (27/11/2026).

| # | Lớp | Phát hiện | Verdict | Route | Bằng chứng |
|---|-----|-----------|---------|-------|------------|
| 1 | BH | Cấu hình sai (client secret sai → token endpoint `401 invalid_client`; chưa bật Sheets API → `403`) bị coi là mất quyền: kết nối `auth_revoked` vĩnh viễn, job xong, không dead-letter, không cảnh báo vận hành | medium | intent_gap | `google-client.ts:97-100`: `httpFailure` xét `status === 401` trước mọi mã lỗi token khác `invalid_grant`. Google fake trả `401 invalid_client` (`google-fake/server.ts:305`). Code làm đúng câu frozen "`invalid_grant`, 401 hoặc 403 → `auth_revoked`", nhưng intent của "mất quyền" (AD-23: người cấp thu hồi) không nói gì về lỗi cấu hình do vận hành gây ra. |
| 2 | BH | Kết nối kẹt: hết lượt retry vẫn `retrying`; lỗi không phải Google (SecretBoxError, DB) hay `event_not_found` giữ `syncing`; web poll 3 giây không giới hạn | low | reject | `retrying` sau dead-letter là thiết kế AD-23: dead-letter → cảnh báo vận hành, requeue từ `/admin`, "chỉ `auth_revoked` sinh thông báo cho BTC". SecretBoxError ném lỗi → dead-letter → cảnh báo. `event_not_found` không xảy ra được vì không có code nào xóa cứng Sự kiện. Poll của TanStack mặc định dừng khi tab ẩn (`refetchIntervalInBackground: false`). |
| 3 | BH | Sheet bị xóa hoặc chuyển vào thùng rác → 404 → `unexpected_response`, retry tới dead-letter, không tự tạo lại | low | reject | Có thật, nhưng trong 6.4 chỉ gặp nếu BTC xóa Sheet vừa tạo ngay trong cửa sổ retry vài phút. Ở 6.5 (flush lâu dài) thì gặp thường: chuyển 6.5 xét (mục hoãn). |
| 4 | BH | `resizeGrid` đặt kích thước tuyệt đối nên có thể thu nhỏ lưới, trái với ghi chú "chỉ nới thêm, không thu nhỏ"; thêm một lời gọi `batchUpdate` thừa ngay sau khi tạo | low | reject | Đúng: `sheet-sync-jobs.ts:185` không đọc lưới hiện tại. Trong 6.4 phải có người nới lưới Sheet mới tạo ngay trong cửa sổ retry, rất hiếm. Ở 6.5 BTC tự thêm cột là chuyện thường, nên chuyển 6.5 xét (mục hoãn). Implementation Notes đã sửa lại cho đúng. |
| 5 | BH | Sheet nằm trong Drive của người cấp: Owner/Admin khác bấm "Mở Google Sheet" thì gặp trang "xin quyền truy cập", và UI không nói vì sao | medium | patch | `drive.file` tạo file riêng của người cấp. Mục đích của story là "đội của tôi xem". Sửa bằng câu chữ cạnh link: Sheet nằm trong Drive của <tên>, người khác cần được chia sẻ trên Google. |
| 6 | BH | Chưa bảo đảm "retry không tạo Sheet thứ hai": `create` thành công ở Google nhưng mất phản hồi (timeout) hoặc `saveSpreadsheet` lỗi | low | reject | Cần Google tạo xong mà phản hồi mất trong 10 giây: rất hiếm. Hậu quả là thừa một file "Tickee · …" trong Drive của người cấp, không sai dữ liệu. Muốn chặn hẳn thì phải thêm tìm file qua Drive API hoặc `developerMetadata`. |
| 7 | BH | `sheet_oauth_states` tích lũy: chỉ xóa dòng hết hạn của chính người bấm lại | low | patch | `sheet-connection.service.ts` (`startConnect`) xóa theo `userId`. Sửa trực tiếp: xóa mọi dòng đã hết hạn khi tạo lượt mới. |
| 8 | BH | `last_error_code` không có CHECK; mã lạ (vd. của 6.5) làm web parse lỗi cả mục | low | reject | Chỉ worker ghi cột này, và luôn từ enum `SheetSyncErrorCode`. Thêm mã mới là việc của story sau (thêm vào enum ở contracts trước khi worker dùng). |
| 9 | BH | Google giới hạn 100 refresh token mỗi tài khoản cho mỗi client; `prompt=consent` mỗi lần cấp một token mới, ngắt không revoke → kết nối cũ có thể bị vô hiệu | low | reject | Giới hạn có thật. Phải tới hơn 100 lượt kết nối bởi cùng một tài khoản Google; khi đó hệ quả hiện ra dưới dạng `invalid_grant` → `auth_revoked`, đúng đường "Kết nối lại" của 6.6. Chuyển 6.6 xét có cần ghi chú hay giảm thiểu (mục hoãn). |
| 10 | BH | FK `sheet_connections` → `events`/`organizations`/`users` là NO ACTION, sẽ chặn khi xóa cứng | false | reject | Không có code nào xóa cứng ba bảng này (`grep delete(events|users|organizations)` rỗng); AD-24 ẩn danh hóa chứ không xóa. |
| 11 | BH | Nhiều nhánh lỗi chưa có test: `unexpected_response`, `invalid_client`, SecretBoxError ở worker, `scope_missing`, `verifier_unreadable`, `code_missing`, dead-letter, callback với session cần 2FA | medium | patch | Trùng #15–#20 (VG). Thêm test cho các nhánh VG nêu, và test `invalid_client` sau khi chốt #1. |
| 12 | BH | Lần đẩy đầu không phải bản chụp nhất quán: Đơn chuyển `paid` trong lúc quét có thể bị sót | low | reject | Có thật (`sheetOrdersOf` đọc từng trang ngoài transaction), nhưng cửa sổ chỉ vài giây. Ở 6.5, chuyển `paid` sẽ enqueue `sheet_row_changed`; 6.5 phải đánh dấu dòng bẩn cả khi kết nối đang `syncing` (mục hoãn 6.5). |
| 13 | BH | `client_secret` không có trong `ALWAYS_REDACTED` | false | reject | Không đường log nào chứa body request tới Google; `GoogleApiError` không mang body hay URL có tham số (`google-client.ts:30-41`). |
| 14 | BH | Một dòng comment ở đầu `.env.example` chưa xuống dòng theo bề rộng của khối | low | patch | Sửa trực tiếp (gói lại dòng). |
| 15 | VG | Nhánh `retry` của worker (`{status:'retry'}` → pg-boss retry rồi dead-letter) chưa có test qua worker thật | gap | patch | Lỗ hổng do VG đã kiểm: test lỗi Google đều gọi thẳng `runSheetInitialSync`; test worker thật chỉ có ca thành công. |
| 16 | VG | `unexpected_response` (Sheets 400/404, body sai dạng) chưa có test, dù luật "retry, không `auth_revoked`" đã ghi | gap | patch | Grep `unexpected_response` trong `apps/api/test` không có kết quả. |
| 17 | VG | Lưới quá 26 cột (từ 15 câu hỏi form có trả lời trở lên) chưa được kiểm | gap | patch | Chỉ có assert `columnCount: 26`. `FORM_QUESTIONS_MAX = 20` nên trường hợp này xảy ra được. |
| 18 | VG | Kiểm `scope_missing` ở callback chưa có test | gap | patch | Fake luôn cấp `drive.file`; grep `scope_missing` trong test không có kết quả. |
| 19 | VG | Web: ngắt kết nối nhận `404 SHEETS_NOT_CONNECTED` chưa có test | gap | patch | Mock DELETE có nhánh 404 nhưng không test nào đi tới. |
| 20 | VG | SecretBoxError ở worker (khóa lệch giữa api và worker) chưa có test | gap | patch | Grep `SecretBoxError` trong `test/integration` không có kết quả. Các mô-đun khác có test mẫu cho trường hợp này. |
| 21 | VG | `invalid_client` / 403 do cấu hình → `auth_revoked` vĩnh viễn, không tín hiệu vận hành | medium | intent_gap | Trùng #1. |
| 22 | VG | Kết nối kẹt `syncing` và web poll 3 giây mãi | low | reject | Trùng #2. |
| 23 | VG | Luật "chỉ nới, không thu nhỏ" không được thực thi | low | reject | Trùng #4 (mục hoãn 6.5). |
| 24 | EC | `event_not_found` / SecretBoxError giữ `syncing` mãi | low | reject | Trùng #2. |
| 25 | EC | Hết lượt retry → `retrying` mãi dù không còn ai thử lại | low | reject | Trùng #2 (thiết kế AD-23). |
| 26 | EC | 404 khi Sheet bị xóa: retry mãi với `spreadsheet_id` cũ | low | reject | Trùng #3 (mục hoãn 6.5). |
| 27 | EC | BTC đổi tên hoặc xóa tab "Đơn" trước lần retry → mọi lần ghi bị 400 | low | reject | Có thật (vùng A1 dùng tên tab), nhưng trong 6.4 rất hiếm. Ở 6.5 BTC đổi tên tab là chuyện thường: flush nên tìm tab theo `sheetId`. Chuyển 6.5 (mục hoãn). |
| 28 | EC | `resizeGrid` đặt kích thước tuyệt đối, xóa dòng/cột BTC thêm | low | reject | Trùng #4. |
| 29 | EC | Token endpoint `401 invalid_client` → mọi kết nối `auth_revoked` | medium | intent_gap | Trùng #1. |
| 30 | EC | Sheets `403` vì API bị tắt hoặc lý do cấp project → `auth_revoked` | medium | intent_gap | Trùng #1. |
| 31 | EC | Kết nối `auth_revoked` trước khi tạo Sheet vẫn hiện spinner "Đang tạo Sheet…" mãi | low | patch | `google-sheets-section.tsx` (`ConnectedBody`) hiện spinner mỗi khi chưa có `spreadsheetUrl`, bất kể trạng thái. Sửa trực tiếp: chỉ hiện khi `syncing`/`retrying`. |
| 32 | EC | Poll dừng khi `retrying` → retry thành công rồi mà trang vẫn ghi "Lỗi, đang thử lại" cho tới khi tải lại | medium | patch | `sheetsRefetchInterval` chỉ poll khi `syncing`. Lần retry đầu cách 30 giây. Sửa: poll cả khi `retrying` (thưa hơn). |
| 33 | EC | `sheet_oauth_states` tích lũy | low | patch | Trùng #7. |
| 34 | EC | Giới hạn 100 refresh token | low | reject | Trùng #9 (mục hoãn 6.6). |
| 35 | EC | Đơn chuyển `paid` giữa lúc quét bị sót | low | reject | Trùng #12 (mục hoãn 6.5). |
| 36 | EC | Kết nối bị xóa giữa chừng rồi Google lỗi → `markSyncFailure` trả `false` nhưng job vẫn báo `retry`, chạy thêm một lượt thừa | low | patch | `sheet-sync-jobs.ts:208-216` bỏ qua kết quả của `markSyncFailure`. Sửa một dòng: `false` → `disconnected`. |
| 37 | EC | Tuyên bố "retry không tạo Sheet thứ hai" chưa được bảo đảm | low | reject | Trùng #6. |

Lượt 2 (27/11/2026, sau khi sửa tại chỗ theo Quyết định 4–5):

| # | Lớp | Phát hiện | Verdict | Route | Bằng chứng |
|---|-----|-----------|---------|-------|------------|
| 38 | VG | `connectedByName` của người cấp đã rời BTC (phải `null`) chưa có test | gap | patch | Chỉ có test người cấp còn trong BTC (có tên, không tên); thay `memberNamesOf` bằng tra user thì không test nào đỏ. |
| 39 | VG | Callback với `state` hợp lệ và lỗi Google khác `access_denied` (phải `sheets-failed`) chưa có test | gap | patch | Fake chỉ sinh `access_denied`; bỏ toán tử ba ngôi thì không test nào đỏ. |
| 40 | VG | Web: `POST …/connect` trả 500 (toast lỗi) và 401 (sang đăng nhập) chưa có test | gap | patch | Mock có `connectError` nhưng chỉ ca 409 dùng tới. |
| 41 | BH | 403 không phải lỗi cấu hình mà vì quota hoặc Drive đầy vẫn thành `auth_revoked` | maybe-false | defer | Sheets API v4 báo quota bằng 429 (đã là lỗi tạm thời); 403 kèm `rateLimitExceeded` là dạng của Drive API cũ. Drive đầy lúc tạo Sheet có thể trả 403. Muốn chốt thì cần phản hồi thật của Google cho trường hợp quota và Drive đầy. Nếu đúng thì mức medium. Chuyển 6.5 (flush hay gặp quota). |
| 42 | BH | Cột form chỉ lấy từ câu hỏi đã có Đơn trả lời: kết nối trước Đơn đầu tiên thì tiêu đề không có cột form | low | reject | Code làm đúng Quyết định 2 (cột theo `answerColumnsOf`, như CSV). Thêm cột cho câu hỏi xuất hiện sau khi kết nối là việc của 6.5 (Never); 6.5 cần lưu ánh xạ cột ↔ câu hỏi (mục hoãn). |
| 43 | BH | Lô ghi tính theo số dòng, không theo số byte: trường hợp xấu nhất có thể quá 2 MB mỗi request | low | reject | Phải có 500 Đơn × 20 câu × 1.000 ký tự mới tới mức đó; câu trả lời thật ngắn hơn nhiều. |
| 44 | BH | UI ghi "Drive của <tên thành viên>" nhưng người đó có thể đồng ý bằng một tài khoản Google khác | low | patch | Có thật (`drive.file` không cho biết email). Sửa câu chữ trực tiếp: "tài khoản Google mà <tên> dùng khi kết nối". |
| 45 | BH | README hướng dẫn consent screen ở chế độ Testing: với scope `drive.file`, refresh token hết hạn sau 7 ngày và chỉ test user được đồng ý | medium | patch | README "Google Sheets" dẫn về mục trên (External + Testing). Đây là chính sách của Google cho app ở Testing. Sửa tài liệu: staging và production phải chuyển consent screen sang "In production". |
| 46 | BH | Lỗi ở callback không báo vận hành; log bỏ mất mã `error` của Google | low | patch | Log `warn` đã có `reason` (`token_configuration`, `google_error`). Sửa nhỏ: log thêm mã `error` của Google nếu nằm trong danh sách mã OAuth đã biết. Cảnh báo vận hành riêng cho callback thì không làm. |
| 47 | BH | Câu chữ hứa đồng bộ liên tục trong khi 6.4 mới có lần đẩy đầu | low | reject | 6.5 là story kế tiếp; chưa có người dùng thật trước Closed Beta. |
| 48 | BH | Không thử được ở local nếu không có Google thật (`pnpm dev` không chạy Google fake) | low | reject | Thử bằng stack e2e (`e2e:stack`, có Google fake) hoặc bằng OAuth client thật. Chạy Google fake trong `pnpm dev` là việc của môi trường dev: chuyển E5-7 (mục hoãn). |
| 49 | BH | Vẫn còn nhánh chưa test: `code_missing`, `verifier_unreadable`, `invalid_client` ở callback, session cần 2FA, `event_not_found` | low | patch | Thêm test cho ba nhánh đầu. Session cần 2FA đi cùng đường filter với ca đồng ý NĐ 13 (đã có test). `event_not_found` không xảy ra được (#10). |
| 50 | BH | Ngày ghi dạng chữ (`RAW`), số tiền không định dạng, nên `locale`/`timeZone` không có tác dụng | low | reject | Đúng ý phần frozen: "Giá trị định dạng giống CSV 6.3 (`formatVnTimestamp`…)". |
| 51 | BH | Ngắt rồi kết nối lại thì tạo Sheet mới, Sheet cũ vẫn còn mà UI không nói | low | patch | Sửa câu chữ trực tiếp trong hậu quả của "Ngắt kết nối". |
| 52 | BH | Dữ liệu cá nhân của người mua nằm ngoài Tickee; ẩn danh hóa theo AD-24 không chạm tới Sheet | low | reject | Epic context đã giao cho 7.6: handler ẩn danh enqueue `sheet_row_changed`. Chuyển 7.6 (mục hoãn) để không rơi. |
| 53 | BH | Index của `sheet_oauth_states` không khớp truy vấn (`expires_at` không có index; index `user_id` không còn dùng) | low | reject | Bảng chỉ có vài dòng sống trong 10 phút; sửa index thì phải đổi migration. |
| 54 | EC | Lỗi không phải Google giữ `syncing` mãi | low | reject | carried #2. |
| 55 | EC | Hết lượt retry vẫn `retrying` mãi | low | reject | carried #25. |
| 56 | EC | Sheet bị xóa, hoặc tab bị đổi tên hay xóa, giữa các lần retry | low | reject | carried #3, #27 (mục hoãn 6.5). |
| 57 | EC | Retry tạo Sheet thứ hai khi phản hồi `create` bị mất | low | reject | carried #6. |
| 58 | EC | `resizeGrid` thu nhỏ lưới | low | reject | carried #4 (mục hoãn 6.5). |
| 59 | EC | 403 vì `rateLimitExceeded`/`userRateLimitExceeded` thành `auth_revoked` | maybe-false | defer | Trùng #41. |
| 60 | EC | Người cấp bị xóa khỏi BTC trước khi job chạy: worker vẫn ghi dữ liệu người mua vào Drive của người đã rời | low | reject | Intent loại trừ: Never "chuyển `auth_revoked` khi người cấp bị xóa khỏi BTC" là việc của 6.6 (AC trong `epics.md`). Cửa sổ của 6.4 chỉ vài giây. |
| 61 | EC | Bấm "Kết nối" nhiều lần trong 10 phút thì số dòng `state` còn hạn không bị giới hạn | low | reject | Chỉ Owner/Admin đã đăng nhập mới tạo được; dòng hết hạn bị xóa ở lần bấm kế tiếp của bất kỳ ai (#7). |
| 62 | EC | `DELETE` với `eventId` viết hoa: `target_id` của audit (`text`) lưu nguyên dạng viết hoa | low | patch | `sheet-connection.service.ts:171` dùng `eventId` của path; 6.3 dùng `eventId.toLowerCase()` (`event-orders.service.ts:216`). Sửa trực tiếp. |
| 63 | EC | Tasks của spec ghi "xóa dòng hết hạn của người đó" nhưng code xóa của mọi người | low | reject | Đổi theo Triage #7, đã ghi ở Implementation Notes. Callback quá 10 phút về trang gốc thay vì tab Cài đặt, cùng `sheets-failed`. |

## Design Notes

**`POST` trả URL thay vì link thẳng tới API:** link thẳng thì lỗi 2FA, 401 hay 403 sẽ hiện JSON thay cả trang. Dùng mutation thì 2FA tự hỏi rồi chạy lại, và nút có spinner. Chỉ callback mới là 302, vì Google điều hướng tới đó.

**Gọi Google bằng `fetch`, không dùng `@googleapis/sheets`:** spine ghi phiên bản `@googleapis/sheets` 18.1.1 trong bảng thư viện. Story này chỉ cần năm lời gọi REST, và theo mẫu Tingee (`fetch` + base URL trong config + fake `node:http`) thì test và e2e-stack không phải chặn thư viện. Đây là lệch có chủ đích so với bảng phiên bản; lần đối chiếu spec sau retro sẽ gom về spine.

**Biến env riêng `GOOGLE_SHEETS_CLIENT_*`:** có thể đặt cùng giá trị với client đăng nhập (thêm redirect URI) hoặc dùng client khác. `drive.file` là scope không nhạy cảm nên không cần Google thẩm định app.

**Dòng cũ → mới:** 6.5 sẽ thêm Đơn mới vào cuối Sheet ("thiếu thì thêm"), nên lần đẩy đầu xếp theo thời gian tạo tăng dần cho khớp. Sự kiện CLB vài nghìn Đơn, nên đọc hết theo lô rồi đảo thứ tự trong bộ nhớ là chấp nhận được.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: 0 lỗi
- `pnpm lint:deps` -- expected: 0 vi phạm (`integration` → `ordering`, `ticketing`, `event`, `organizer`, `identity`)
- `pnpm test` -- expected: xanh, kể cả các test `integration` mới, `isolation.test.ts`, test config và contracts
- `pnpm test:e2e` -- expected: `event-google-sheets.spec.ts` và `event-settings.spec.ts` xanh trên `ios-webkit` và `android-chromium`

**Manual checks (if no CLI):**
- Trên dev stack với OAuth client Google thật: kết nối một Sự kiện có Đơn thật (câu hỏi form, check-in). Sheet mới nằm trong Drive của người cấp: tiếng Việt đúng, SĐT giữ số 0, số tiền là số, giờ Việt Nam. Ngắt kết nối thì Sheet vẫn còn trong Drive.
