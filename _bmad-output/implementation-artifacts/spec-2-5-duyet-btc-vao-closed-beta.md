---
title: 'Story 2.5: Quản trị Tingee duyệt BTC vào Closed Beta (phần lõi)'
type: 'feature'
created: '2026-11-02'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'd84d2e188642f1be4cfc6c99de6111538a84df51'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Chưa có Quản trị Tingee, chưa có trạng thái Closed Beta, nên không có gì phân biệt BTC được tin cậy (được bán Vé có phí khi chưa KYC) với BTC mới; dashboard cũng chưa có nguồn banner chung (FR-37, AD-26, AD-34).

**Approach:** Thêm cờ `users.platform_admin` chỉ cấp/thu bằng CLI chạy role DB `migrate`; khu `/v1/admin/*` + `/admin` chỉ cho người có cờ, đã bật 2FA và đã step-up; mọi lần đọc qua `platformAdminScope` ghi audit. `organizations.closed_beta_status` (`pending` mặc định → `approved` ↔ `revoked`) do Quản trị Tingee đổi ở màn "Duyệt Closed Beta". Dựng `reporting.notices(scope)` và dải `status-banner` đầu vùng nội dung dashboard; hai mã đầu tiên là Chờ duyệt và Bị thu hồi.

## Boundaries & Constraints

**Always:**
- Route admin mang decorator `@RequirePlatformAdmin()` (khai báo ở `platform/access`); guard toàn cục của `identity` chạy sau `ConsentGuard` đọc **mới từ DB** `platform_admin` và `two_factor_enabled`: không cờ → `403 FORBIDDEN_ROLE`; có cờ mà chưa bật 2FA → `403 TWO_FACTOR_NOT_ENABLED` (mã mới); chưa step-up thì `TotpGuard` hiện có đã trả `TOTP_REQUIRED` (guard admin vẫn tự kiểm `stepUpAt` lần nữa).
- `tickee_app` không UPDATE được cột `users.platform_admin` (grant theo cột, tính động trong `grants.ts` sau mỗi migrate); Better Auth không khai báo trường này nên không nhận từ input.
- CLI: `pnpm --filter @tickee/api admin:grant <email> --by <email người chạy>` / `admin:revoke`. `--by` phải là email một Tài khoản Tickee có sẵn (lần đầu được tự cấp cho chính mình); audit `platform_admin.granted|revoked`, actor = tài khoản `--by`, target = user bị đổi, `organization_id` null. Email không tồn tại → thoát mã ≠ 0, không đổi gì. Đã ở trạng thái đích → báo "không đổi", không ghi audit.
- Chuyển trạng thái Closed Beta bằng compare-and-set trong một `tx` cùng audit `organization.closed_beta_approved|revoked` (`changedFields: ['closed_beta_status']`): Duyệt `pending|revoked→approved` (BTC bị thu hồi được duyệt lại — quyết định 02/11); Thu hồi `approved→revoked`; bấm lại khi đã ở trạng thái đích → 204 không audit; chuyển không hợp lệ → `409 CLOSED_BETA_TRANSITION_INVALID`; id lạ → 404.
- Mọi request đọc của `/v1/admin/*` ghi đúng một dòng audit `platform_admin.read` qua `platformAdminScope` trong cùng `tx` với truy vấn.
- `GET /v1/orgs/:orgId/notices` (`@RequirePermission(Permission.ORG_READ)`, Owner và Admin) trả `StatusNotice[]` đã lọc theo `audience` chứa vai người gọi, sắp theo thứ tự ưu tiên khai báo trong `packages/contracts`. `CLOSED_BETA_PENDING`: warning, `blocking:false`, `dismissible:false`; nội dung "Chờ duyệt Closed Beta" + "Tingee sẽ liên hệ qua SĐT hoặc email liên hệ của BTC để xác minh.", không có nút (chưa có kênh liên hệ Tingee — quyết định 02/11). `CLOSED_BETA_REVOKED`: danger, `blocking:true`, `dismissible:false`. `version` đổi khi trạng thái đổi.
- Web: dải banner `aria-live="polite"` đầu `<main>` của dashboard; tối đa 2 banner, còn lại nút "+N thông báo" mở `Sheet`; web chỉ ánh xạ `code` → nội dung; banner `dismissible` ẩn theo `code+version` trong `sessionStorage`.
- `/admin` (desktop, shadcn mặc định): tab Chờ duyệt / Đã duyệt / Đã thu hồi; mỗi hàng: tên BTC, email Owner, SĐT/email liên hệ, ngày tạo; "Duyệt" ở Chờ duyệt và Đã thu hồi; "Thu hồi" (`button-destructive`) ở Đã duyệt mở `Dialog` "Sự kiện có phí của {BTC} sẽ Tạm ngừng bán."; tab rỗng: "Không có BTC chờ duyệt." / "Không có BTC đã duyệt." / "Không có BTC bị thu hồi.". Chưa đăng nhập → đăng nhập với `returnTo=/admin`; `FORBIDDEN_ROLE` → `EmptyState` "Bạn không có quyền vào trang này."; `TWO_FACTOR_NOT_ENABLED` → `EmptyState` + "Bật xác thực hai lớp" tới `/bao-mat/totp?returnTo=/admin`.

**Never:**
- Không có UI/API nào cấp `platform_admin`; không thêm mục "Quản trị" vào menu tài khoản.
- Không làm lọc IP `ADMIN_ALLOWED_CIDRS` và "Đặt lại TOTP" (đã ghi `deferred-work.md`, làm trước Closed Beta).
- Không làm `publishReadiness`/`sellability` hay chặn bán Vé có phí (2.10 đọc `closed_beta_status`); không thêm `closedBetaStatus` vào DTO `Organization`.
- Không dùng tên `notices`/`NoticeCode` trùng `apps/web/lib/notices.ts` (toast qua URL); không đổi `TOTP_EXEMPT_ROUTES`, `ROLE_PERMISSIONS`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| BTC mới | Owner/Admin mở dashboard | banner warning "Chờ duyệt Closed Beta" + câu hướng dẫn, không có nút đóng | — |
| Duyệt | admin bấm "Duyệt" (Chờ duyệt hoặc Đã thu hồi) | 204; hàng sang tab Đã duyệt; dashboard BTC hết banner ở lần tải kế | bấm 2 lần → 204 |
| Thu hồi | admin xác nhận `Dialog` | 204; dashboard BTC hiện banner danger không đóng được | BTC đang chờ → 409 |
| Không cờ | user thường gọi `/v1/admin/*` | 403 `FORBIDDEN_ROLE` | web: EmptyState không quyền |
| Có cờ, chưa 2FA | — | 403 `TWO_FACTOR_NOT_ENABLED` | web: EmptyState + link bật 2FA, quay lại `/admin` |
| Có cờ, 2FA, chưa step-up | — | 401/403 `TOTP_REQUIRED` | web: `StepUpDialog` sẵn có, xong tự tải lại |
| Bị thu cờ giữa phiên | đã vào `/admin` | request kế → `FORBIDDEN_ROLE` | — |
| CLI | email không tồn tại / thiếu `--by` | thoát ≠ 0, in lỗi, không đổi DB | không lộ secret DB |

</frozen-after-approval>

## Code Map

- `apps/api/module-graph.cjs` -- `admin → organizer`, `reporting → organizer`, `organizer → identity` đã cho phép; **không thêm cạnh**. Guard admin nằm ở `identity`, decorator ở `platform`.
- `apps/api/src/modules/identity/schema.ts:12-25` -- `users`; thêm `platform_admin boolean NOT NULL DEFAULT false`. `auth.ts:45-64` additionalFields — **không** khai báo trường mới. `session.guard.ts`, `totp.guard.ts:20-39` (mẫu đọc `req.session`), `identity.module.ts:60-62` thứ tự APP_GUARD (Session → Totp → Consent → thêm PlatformAdmin). `user-directory.ts` (`findUserIdByEmail`, `userContacts`) — mẫu read model; thêm `setPlatformAdmin(db, userId, value)` xuất từ `identity/index.ts` cho CLI.
- `apps/api/src/platform/access/` -- thêm `require-platform-admin.ts` (SetMetadata + param decorator `@PlatformAdminAccess()` đọc `req.platformAdminContext = {userId, stepUpAt}`) và `platform-admin-scope.ts` (`platformAdminScope(tx, ctx, target)` ghi `platform_admin.read`). Mẫu: `org-scope.ts:6-36`, `require-permission.ts`. `PermissionGuard` chỉ chạy với `@RequirePermission` — route admin không mang nó.
- `apps/api/src/platform/db/grants.ts:36-54` -- sau vòng GRANT: `REVOKE UPDATE ON users`, rồi `GRANT UPDATE(<mọi cột trừ platform_admin>)` lấy từ `information_schema.columns`.
- `apps/api/src/platform/audit/audit.ts:5-22` -- thêm `platform_admin.granted|revoked|read`, `organization.closed_beta_approved|revoked`. `organization_id` nullable; `target.id` bắt buộc (với đọc danh sách dùng `{type:'closed_beta_queue', id:<tab>}`).
- `packages/contracts/src/errors.ts` + `apps/api/src/platform/http/{app-error.ts,error.filter.ts}` (Record theo `ErrorCode`) -- thêm `TWO_FACTOR_NOT_ENABLED` (403), `CLOSED_BETA_TRANSITION_INVALID` (409).
- `apps/api/src/modules/organizer/schema.ts:7-17` -- `organizations` thêm `closed_beta_status text NOT NULL DEFAULT 'pending'` + CHECK (mẫu `members.role` :33,:40) và `closed_beta_changed_at timestamptz`. Migration `0007` sinh bằng `pnpm --filter @tickee/api db:generate`. Thêm service Closed Beta (approve/revoke CAS + audit, mẫu `organizer.service.ts:29-46`), read model `listOrganizationsByClosedBeta(tx, status)` (kèm email Owner qua `identity.userContacts`) và `closedBetaStatusOf(orgId)`; xuất qua `organizer/index.ts`.
- `apps/api/src/modules/admin/` -- module + `closed-beta.controller.ts`: `GET /v1/admin/organizations?closedBeta=pending|approved|revoked`, `POST /v1/admin/organizations/:id/closed-beta/approve|revoke`. Đăng ký vào `api.module.ts`.
- `apps/api/src/modules/reporting/` -- module + `notices.controller.ts` `GET /v1/orgs/:orgId/notices`; tính từ `organizer.closedBetaStatusOf`.
- `packages/contracts/src/` -- `admin.ts` (DTO hàng duyệt, query), `reporting.ts` (`StatusNotice`, `StatusNoticeCode`, `STATUS_NOTICE_PRIORITY`), export ở `index.ts`.
- CLI: `apps/api/src/roles/admin-cli.ts` dùng `migrateConfigSchema` (`config.schema.ts:81-85`, `MIGRATION_DATABASE_URL`) và `new Database(...)` như `roles/migrate.ts:12-24`; script `admin:grant`/`admin:revoke` trong `apps/api/package.json` chạy `dist/roles/admin-cli.js`.
- Test api: `test/identity/harness.ts` (`signUpWithTotp`, step-up qua `POST /v1/identity/totp/step-up` như `totp-guard.test.ts:233`; bật cờ trong test bằng `migrationDatabaseUrl` của `test/helpers.ts:10`). `test/organizer/isolation.test.ts` tự phủ route notices (POST `{}`, UUID lạ).
- Web: `components/tickee/status-banner.tsx:17-28` (tone, `onDismiss`), `components/ui/sheet.tsx`, `dialog.tsx`, `empty-state.tsx`; chưa có `Table` → thêm shadcn `components/ui/table.tsx`. `dashboard-shell.tsx:52-78` (`ContentColumn`, chèn dải banner đầu `<main>`). `lib/organizer/api.ts:17-52` (mẫu query key, `apiRequest`). `providers.tsx:20-101` đã xử lý `TOTP_REQUIRED`. Mẫu chặn chưa đăng nhập: `tai-khoan/bao-mat/security-settings.tsx:183-188`. `site-header.tsx` cho layout `(admin)`. `lib/auth/return-to.ts:21` `withReturnTo`; `TOTP_ENROLL_PATH`.
- e2e: `e2e/organizer-mock.ts:13` regex đã khớp `/orgs/:id/notices` → thêm handler mặc định `[]` (nếu không spec dashboard cũ lỗi 500); thêm `e2e/admin-mock.ts` cho `/v1/admin/**`. Desktop dùng `page.setViewportSize({width:1280,height:800})` như `dashboard-shell.spec.ts:15`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{errors,admin,reporting,index}.ts` (+ test) -- mã lỗi, DTO admin, `StatusNotice` + thứ tự ưu tiên.
- [x] `apps/api/src/platform/{http,audit,access,db/grants.ts}` -- mirror mã lỗi, action audit, decorator + `platformAdminScope`, grant theo cột.
- [x] `apps/api/src/modules/identity/{schema,platform-admin.guard,user-directory,identity.module,index}.ts` + `organizer/schema.ts` + migration 0007 -- cột mới, guard, hàm đặt cờ.
- [x] `apps/api/src/modules/organizer/*` -- service Closed Beta, read model, export.
- [x] `apps/api/src/modules/{admin,reporting}/*`, `api.module.ts` -- controller admin và notices.
- [x] `apps/api/src/roles/admin-cli.ts`, `apps/api/package.json`, README -- CLI.
- [x] `apps/api/test/{admin,reporting}/*`, `test/roles.process.test.ts` -- matrix, grant theo cột (UPDATE bằng `tickee_app` bị từ chối), audit đọc/ghi, CAS đồng thời, CLI.
- [x] `apps/web/components/tickee/status-banner-stack.tsx`, `lib/reporting/*`, `dashboard-shell.tsx` -- dải banner.
- [x] `apps/web/app/(admin)/{layout.tsx,admin/*}`, `lib/admin/api.ts`, `components/ui/table.tsx` -- màn Duyệt Closed Beta.
- [x] `apps/web/e2e/{organizer-mock,admin-mock}.ts`, `status-banners.spec.ts`, `admin-closed-beta.spec.ts` -- phủ matrix web, "+N thông báo" (mock 3 notice), chạy cả hai project.

**Acceptance Criteria:**
- Given tài khoản thường gọi `UPDATE users SET platform_admin = true` bằng `tickee_app`, then Postgres từ chối; Better Auth vẫn cập nhật được `name`, `two_factor_enabled`, `consented_at`.
- Given hai admin cùng bấm Duyệt, then đúng một dòng audit.
- Given `pnpm turbo build typecheck lint:deps test` và `pnpm --filter @tickee/web test:e2e`, then tất cả pass, kể cả test hiện có.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (02/11/2026, 3 lớp: blind-hunter BH, edge-case-hunter EC, verification-gap VG).

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | BH, EC | `tickee_app` vẫn INSERT được `users` với `platform_admin = true`; comment ở `grants.ts`/`schema.ts` nói "không API nào ghi được dù có lỗi tầng ứng dụng" là quá lời | low | Chỉ chặn UPDATE theo cột. Đường INSERT duy nhất là đăng ký của Better Auth, vốn không khai báo trường này; muốn chặn hẳn phải thêm trigger. Sửa comment cho đúng phạm vi là đủ | patch (comment) |
| 2 | BH, EC | `--by` chỉ cần là tài khoản có sẵn, không cần là Quản trị Tingee, nên người chạy tự khai | low | Quyền thật nằm ở credential `tickee_migrator`; người có credential đó vẫn ghi được tên bất kỳ admin nào. Intent (khối frozen) định nghĩa `--by` đúng như vậy | reject |
| 3 | BH | Không có test bắt mọi route `/v1/admin/*` mang `@RequirePlatformAdmin()`; controller admin sau này quên decorator sẽ mở cho mọi user đã đăng nhập | medium | `test/organizer/routes.ts` + `isolation.test.ts` có kiểm tương tự cho `/v1/orgs/:orgId`, admin thì chưa. Cấu hình `@Public`+`@RequirePlatformAdmin` chỉ phát hiện lúc request (500) — test khám phá route bắt luôn | patch |
| 4 | BH, EC | Web parse `notices` bằng enum chặt: API trả mã mới (lệch phiên bản lúc deploy) thì cả danh sách lỗi, mọi banner — kể cả danger/chặn bán — biến mất im lặng | medium | `fetchStatusNotices` dùng `StatusNoticeList`; `StatusBannerStack` không render gì khi lỗi. Story 2.6/2.10 sẽ thêm mã | patch |
| 5 | BH, EC | Khóa đóng banner / React key chỉ là `code:version`, không có id đối tượng: trùng giữa BTC, giữa Sự kiện | low | Chưa với tới hôm nay: không mã nào `dismissible`, không mã nào phạm vi `event`; `version` là mốc thời gian theo BTC. Sửa phải đổi hợp đồng | reject → deferred-work (điều kiện tương lai) |
| 6 | BH | Tab Đã duyệt/Đã thu hồi không hiện và không sắp theo `closed_beta_changed_at` | low | Intent quy định cột của hàng (tên, email Owner, liên hệ, ngày tạo) | reject |
| 7 | BH | Thu hồi không ghi lý do, không email báo Owner | false | Intent và AC của epic không đòi; banner danger là kênh báo theo FR-37 | reject |
| 8 | BH | `GET /v1/admin/organizations` trả PII nhiều BTC mà không có `cache-control: no-store` | low | Quy ước của codebase: `identity.controller.ts:83`, `totp.controller.ts:35` đặt `no-store` cho phản hồi nhạy cảm; sửa một dòng | patch |
| 9 | BH, EC | Hàng duyệt không phân trang | low | Closed Beta chỉ vài chục BTC; khi mở rộng mới thành vấn đề | reject → deferred-work (điều kiện tương lai) |
| 10 | BH | Tài liệu kế hoạch lệch nhau (sprint-status vs spec, `source_spec: none`, epic-2-context còn "Đặt lại TOTP", sửa 2.4 → done) | false | `source_spec: none` là định dạng bước 1 quy định; sprint-status đồng bộ ở bước trình bày; epic-2-context biên dịch từ epics.md; 2.4 đã merge (PR #23) | reject |
| 11 | BH | Không có `admin:list`, README chưa có cách chạy CLI ở staging/production | low | Tính năng mới; chạy trên môi trường thật thuộc Story 4.7 | reject → deferred-work (điều kiện tương lai) |
| 12 | BH, VG | Nhánh lỗi màn `/admin` chưa có test: thu hồi lỗi 500 (banner "Chưa thu hồi được" trong Dialog), duyệt 404 (toast + tải lại) | medium | Gap đã kiểm sẵn: 11 test e2e chỉ phủ 409 ở thu hồi; grep không thấy assertion nào cho hai câu này | patch |
| 13 | BH | Chưa test không ghi `platform_admin.read` khi guard từ chối vì `TWO_FACTOR_NOT_ENABLED`/`TOTP_REQUIRED` | low | Cùng đường với `FORBIDDEN_ROLE` (đã test): guard ném trước handler | reject |
| 14 | VG | Test "Better Auth không nhận cờ từ input" nuốt mọi lỗi nên không phân biệt được lớp Better Auth với grant DB | medium | Gap đã kiểm sẵn: khai báo `platformAdmin` `input: true` → UPDATE lỗi 42501, `.catch` nuốt, test vẫn qua | patch |
| 15 | VG, EC | CLI gọi qua đường dẫn có symlink (vd. `/tmp` ↔ `/private/tmp` trên macOS) thì điều kiện `import.meta.url === argv[1]` sai, CLI không làm gì và thoát 0 | medium | Node đặt `import.meta.url` của module chính theo realpath; reviewer đã thử bằng probe. Người vận hành tưởng đã cấp quyền | patch |
| 16 | EC | CLI từ chối `--` đứng riêng ("Tùy chọn lạ: --") | low | Cách gọi `pnpm … admin:grant -- <email> --by …` phổ biến; sửa một dòng | patch |
| 17 | EC | Duyệt hai hàng liên tiếp: lần bấm thứ hai bị bỏ qua im lặng khi lần đầu còn chạy | low | `closed-beta-review.tsx:334` `!approve.isPending && …`, nút hàng khác không disabled — admin tưởng đã duyệt; sửa bằng `disabled` | patch |
| 18 | EC | Duyệt và Thu hồi song song ngược chiều: CAS trượt rồi đọc lại thấy trạng thái nguồn hợp lệ → 409 | low | Hai admin thao tác ngược nhau cùng lúc; web coi 409 là "trạng thái đã đổi", toast và tải lại — kết quả chấp nhận được | reject |
| 19 | EC | Nhánh CAS trượt đọc trạng thái một BTC ngoài `platformAdminScope`, không có audit đọc | low | Request ghi (POST); chỉ trả trạng thái Closed Beta (không phải PII) trong `details` của 409 | reject |

## Design Notes

Guard admin đặt ở `identity` vì `identity` sở hữu `users`, 2FA và step-up; `platform/access` chỉ khai báo metadata, nên `admin` không cần cạnh mới tới `identity`. Đọc cờ từ DB ở mỗi request (không qua session của Better Auth) để thu cờ có hiệu lực ngay. CLI chạy bằng `tickee_migrator` vì `tickee_app` bị chặn UPDATE cột này; `--by` bắt buộc vì `audit_events` chỉ có `actor_user_id`, không có chỗ ghi người vận hành ngoài hệ thống — thêm cột mới vào bảng append-only là lớn hơn cần thiết.

`platformAdminScope` không phải mệnh đề `where` như `orgScope` (Quản trị Tingee thấy mọi BTC); nó là cửa đọc có tên: ghi audit trước rồi trả quyền đọc trong cùng `tx`, nên read model organizer nhận `tx` từ đó.

## Verification

**Commands:**
- `pnpm turbo build typecheck lint:deps test` -- expected: tất cả pass.
- `pnpm --filter @tickee/web test:e2e` -- expected: pass trên `ios-webkit` và `android-chromium`.
- `pnpm --filter @tickee/api admin:grant <email> --by <email>` trên DB local -- expected: in "đã cấp", chạy lại in "không đổi".
