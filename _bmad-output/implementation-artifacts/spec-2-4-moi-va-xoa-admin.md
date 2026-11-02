---
title: 'Story 2.4: Mời và xóa Admin'
type: 'feature'
created: '2026-11-02'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'ddbe288ec36bc2e484fdb5c4158b3e687c03a051'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Mỗi BTC hiện chỉ có Owner; trang `/btc/{id}/thanh-vien` là placeholder. Owner chưa có cách giao việc quản lý Sự kiện cho người khác mà không giao quyền tiền (FR-2, FR-4).

**Approach:** Owner mời Admin bằng email. Lời mời lưu ở `organizer`, email gửi qua job pg-boss enqueue cùng `tx` (job email đầu tiên của dự án, worker xử lý). Người nhận mở link, đăng nhập đúng email rồi bấm nhận thì thành `admin`. Owner xóa được Admin; người bị xóa nhận `NOT_A_MEMBER` ở request kế tiếp và web hiện `Dialog` rồi chuyển đi.

## Boundaries & Constraints

**Always:**
- Mọi route `/v1/orgs/:orgId/…` mới mang `@RequirePermission(Permission.MEMBERS_MANAGE)` (Admin nhận `FORBIDDEN_ROLE`, tự rơi vào bộ test cách ly). Nhận lời mời nằm ngoài `/v1/orgs`.
- Lời mời: email chuẩn hóa (trim + lowercase), hạn 7 ngày (như link CTV, AD-30), token 128 bit ngẫu nhiên, DB chỉ lưu hash. Mời lại cùng email thì lời mời cũ còn treo bị thu hồi.
- Trang Thành viên liệt kê lời mời đang chờ (email, hạn hoặc "Đã hết hạn") kèm nút "Thu hồi"; thu hồi xong link trả "Link mời không hợp lệ.". Email đã là thành viên → lỗi tại ô "Email này đã là thành viên của BTC." Tối đa 20 lời mời mới mỗi BTC trong 24 giờ.
- Job `organizer.send-admin-invitation`, payload `{ invitationId }`. Worker sinh token, lưu hash, gửi email chứa link `{WEB_ORIGIN}/loi-moi-btc#{token}`. Handler idempotent: bỏ qua lời mời đã gửi, đã thu hồi, đã nhận hoặc hết hạn. Có retry, hết retry vào dead-letter.
- Nhận lời mời: bắt buộc đăng nhập (OTP hoặc Google) và đã đồng ý NĐ 13. Email session phải trùng email lời mời. Đánh dấu đã dùng bằng compare-and-set trong cùng `tx` với việc tạo `members` role `admin`. Cùng người bấm nhận lại thì vẫn thành công.
- Xóa chỉ áp cho dòng `role='admin'`, không bao giờ xóa Owner.
- Audit cùng `tx` cho: mời, thu hồi, nhận, xóa. Không ghi email vào audit.
- API trả `NOT_A_MEMBER` khi đang ở dashboard một BTC đã tải: `Dialog` không đóng được "Bạn không còn là thành viên của {BTC}.", nút "Đồng ý" → BTC đầu tiên còn lại, không còn BTC nào thì về `/` (chưa có "Vé của tôi"). Mở BTC lần đầu đã không có quyền thì giữ `EmptyState` hiện tại.
- Mutation mời/xóa đi qua `TOTP_REQUIRED` → step-up → tự gửi lại (`useMutation` callbacks, không `mutateAsync`). Đóng mục deferred-work bằng test API thật (POST mời với session đã bật 2FA chưa step-up → `TOTP_REQUIRED`, qua step-up → 201) cộng e2e Playwright mock trên chính mutation mời. e2e full-stack để AI-6.

**Never:**
- Không đặt token trong path của request API, payload job hay audit. Không gửi email trong transaction.
- Không đổi `ROLE_PERMISSIONS`, index Owner, luật `safeReturnTo`, nhãn nút của `OwnerOnly` ("Về danh sách Sự kiện").
- Không làm Admin tự rời BTC, chuyển quyền Owner (2.14), cảnh báo dead-letter (4.6), trang "Vé của tôi" (Epic 3).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Mời | Owner nhập email hợp lệ | 201; toast "Đã gửi lời mời tới {email}."; lời mời hiện trong danh sách chờ | email sai dạng → lỗi tại ô; quá 20/24 giờ → banner |
| Thu hồi | Owner bấm "Thu hồi" | 204; lời mời rời danh sách; link → "Link mời không hợp lệ." | id lạ/đã nhận → 404 |
| Admin gọi API thành viên | role admin | 403 `FORBIDDEN_ROLE`; web: `OwnerOnly` | — |
| Mở link, chưa đăng nhập | token hợp lệ | "Bạn được mời làm Admin của {BTC}." + "Đăng nhập để nhận" → đăng nhập với `returnTo` về link | — |
| Nhận | đã đăng nhập đúng email | thành `admin`; vào dashboard BTC | — |
| Sai email | email session khác | "Lời mời này gửi tới {email che}." + "Đăng xuất" | không tạo thành viên |
| Hết hạn / đã dùng / sai hay đã thu hồi | — | "Link mời đã hết hạn." / "Link mời đã được dùng." / "Link mời không hợp lệ." kèm "Liên hệ Owner để nhận link mới." | không tạo thành viên |
| Xóa Admin | Owner bấm "Xóa", xác nhận `Dialog` | 204; toast; request kế tiếp của Admin đó → `NOT_A_MEMBER` | xóa Owner/id lạ → 404 |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/organizer.ts` -- `Permission.MEMBERS_MANAGE` đã có; thêm DTO (invite request, member list, invitation preview/accept), `ORGANIZATION_INVITATION_PATH = '/loi-moi-btc'`. `identity.ts:18` `EmailAddress` để chuẩn hóa email. `jobs.ts` -- thêm tên queue.
- `packages/contracts/src/errors.ts` -- thêm `ALREADY_A_MEMBER`, `INVITATION_INVALID`, `INVITATION_EXPIRED`, `INVITATION_USED`, `INVITATION_EMAIL_MISMATCH`, `INVITATION_LIMIT_REACHED`; phải thêm cùng lúc vào `apps/api/src/platform/http/app-error.ts:3-20` và `error.filter.ts:6-23` (Record theo `ErrorCode`), nếu không web đổi thành `INTERNAL_ERROR`.
- `apps/api/src/modules/organizer/schema.ts` -- `members` :23-42 (unique `(organization_id,user_id)` :37, index Owner :38). Thêm bảng `organization_invitations` (`organization_id NOT NULL`, email, `token_hash` nullable tới khi gửi, `expires_at`, `email_sent_at`, `accepted_at`/`accepted_by`, `revoked_at`, `invited_by`); unique một phần theo `(organization_id, email)` khi còn treo.
- `organizer.service.ts` -- `createOrganization` :29 là mẫu `tx` + `audit.record`; `roleOf` :75. `access-resolver.impl.ts` không cache vai, nên xóa có hiệu lực ngay. `organizations.controller.ts` -- mẫu `@Access() ctx`, request type `{ user: { id } }` (mở rộng thêm `email` cho accept, `session.guard.ts:47`).
- `apps/api/src/platform/audit/audit.ts:5-14` -- `AuditAction` là union đóng, thêm `member.invited`, `member.invitation_revoked`, `member.joined`, `member.removed`.
- `packages/contracts/src/pii.ts:7` -- thêm cột `email` của lời mời vào `PII_COLUMNS.organizer`.
- `apps/api/src/modules/identity/index.ts` -- organizer không import được `users`; xuất read model `userContacts(ids)` và `findUserIdByEmail(email)` để liệt kê và kiểm "đã là thành viên".
- Hạ tầng job: `platform/jobs/{boss.ts,jobs.module.ts}` -- `ApiModule` (`api.module.ts:21-29`) chưa có `JobsModule`; vai api cần boss tắt `supervise`/`schedule`. pg-boss 12.38 `fromDrizzle(tx, sql)` (2 tham số), `boss.send(q, data, { db })`. `send` ném lỗi nếu queue hoặc dead-letter queue chưa tồn tại, nên phải tạo queue lúc khởi động ở cả api và worker. Mẫu đăng ký: `identity-janitor.ts:35-58`.
- Worker: `worker.module.ts`, `config.schema.ts:70-74` chỉ có `DATABASE_URL`; thêm `SMTP_URL`, `EMAIL_FROM`, `WEB_ORIGIN` và `EmailModule`. Phải sửa env trong `test/worker.test.ts:12`, `identity-janitor.test.ts:30`, `roles.process.test.ts:127`. Mẫu email: `identity/totp-email.ts:4` (`securityEmail`), `otp-email.ts:3` (`escapeHtml`). Single-use CAS: `totp.service.ts:248-262`.
- Migrations: `apps/api/drizzle/` (mới nhất `0005_totp.sql`), sinh bằng `pnpm --filter @tickee/api db:generate`; grant tự áp (`platform/db/grants.ts`).
- Test api (Postgres thật): `test/identity/harness.ts` (`createHarness`, `signUp`, `signIn`, `signUpWithTotp`, `FakeEmailTransport`). `test/organizer/isolation.test.ts` gửi `{}` cho POST và UUID ngẫu nhiên cho param: POST mời phải 400, DELETE id lạ phải 404. `permission-guard.test.ts:36-39` chèn Admin bằng SQL. `totp-guard.test.ts:128-245` mẫu cho TOTP.
- Web dashboard: `btc/[orgId]/thanh-vien/page.tsx` (placeholder `OwnerOnly` + `ComingSoon`), `lib/organizer/nav.ts` (mục Thành viên đã có), `components/tickee/owner-only.tsx`, `dashboard-shell.tsx:110-167` (query org, `EmptyState` `NOT_A_MEMBER`), `current-organization.tsx`.
- Web chung: `app/providers.tsx:20-93` (xử lý `CONSENT_REQUIRED`/`TOTP_REQUIRED` toàn cục, hàng đợi gửi lại mutation), `lib/organizer/api.ts`, `lib/auth/{api,return-to}.ts`. Mẫu form: `tao-btc/create-organization-form.tsx` (`FieldError`, `VALIDATION_FAILED`, banner "Thử lại"). Mẫu Dialog phá hủy: `tai-khoan/bao-mat/security-settings.tsx:108-134`. Mẫu trang công khai cần đăng nhập: `create-organization-form.tsx:74-81`.
- e2e: `e2e/{identity-mock,organizer-mock,fixtures}.ts`. CORS mock chỉ cho `GET, POST, OPTIONS` và regex `ORGANIZER_PATH` chỉ khớp `/orgs*`, `/me/memberships`, nên phải mở rộng. Mẫu: `dashboard-shell.spec.ts:29-44,406-426`, `totp.spec.ts:205-231`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{organizer,errors,jobs,pii}.ts` (+ test) -- DTO, mã lỗi, queue, path, cột PII -- hợp đồng chung trước.
- [x] `apps/api/src/platform/{http,audit}` -- mã lỗi, action audit.
- [x] `apps/api/src/modules/organizer/schema.ts` + migration -- bảng lời mời.
- [x] `apps/api/src/modules/identity/` -- read model email/tên user.
- [x] `apps/api/src/platform/jobs`, `api.module.ts`, `worker.module.ts`, `platform/config` -- boss cho vai api (chỉ gửi), worker có email + cấu hình.
- [x] `apps/api/src/modules/organizer/{members.controller,invitations.controller,members.service,invitation-email,invitation-jobs}.ts` -- liệt kê (thành viên + lời mời chờ), mời, thu hồi, xóa, xem trước (`@Public`), nhận; handler gửi email ở worker.
- [x] `apps/api/test/organizer/*` -- matrix, cách ly, `FORBIDDEN_ROLE`, `TOTP_REQUIRED` trên POST mời rồi qua step-up, job idempotent, CAS nhận đồng thời.
- [x] `apps/web/lib/organizer/api.ts`, `btc/[orgId]/thanh-vien/*` -- trang Thành viên.
- [x] `apps/web/app/(public)/loi-moi-btc/*` -- màn nhận lời mời; đọc token từ hash, sau khi nhận invalidate `MEMBERSHIPS_QUERY_KEY`.
- [x] `apps/web/app/providers.tsx` / `dashboard-shell.tsx` -- `Dialog` khi bị xóa giữa phiên.
- [x] `apps/web/e2e/{organizer-mock.ts,members.spec.ts,invitation.spec.ts}` -- phủ matrix, Dialog bị xóa, step-up rồi gửi lại trên mutation mời. Chạy cả hai project.

**Acceptance Criteria:**
- Given Owner mời, when `tx` rollback, then không có lời mời lẫn job. Given job chạy hai lần, then chỉ một email.
- Given `pnpm turbo build typecheck lint:deps test` và `pnpm --filter @tickee/web test:e2e`, then tất cả pass, kể cả test hiện có.

## Implementation Notes

- Vai api chạy pg-boss chế độ `producer` (tắt `supervise`/`schedule`), start chạy nền để api vẫn khởi động khi DB chưa sẵn sàng (test `/healthz` 200, `/readyz` 503). `AdminInvitationQueues.ready()` start boss và tạo queue + dead-letter trước mỗi lần mời; lần trước lỗi thì làm lại. pg-boss không lên được thì mời trả 500.
- Retry: 8 lần, chờ 30 giây rồi gấp đôi (tối đa 1 giờ), hết lượt thì sang `organizer.send-admin-invitation.dead-letter`. Payload hỏng thì sang dead-letter ngay. Cấu hình queue chỉ áp lúc tạo; đổi về sau phải gọi `updateQueue`.
- Worker bắt buộc thêm `WEB_ORIGIN`, `SMTP_URL`, `EMAIL_FROM` (README, `.env.example`). `pnpm dev` không chạy worker nên local không có email mời.
- Màn nhận lời mời: "Đăng nhập để nhận" dẫn tới `/dang-nhap?returnTo=/loi-moi-btc`, token giữ trong `sessionStorage` của tab, không nằm trong `returnTo`. `returnTo` đi qua query của màn đăng nhập, và với đăng nhập Google thì tới cả api, nên đặt token ở đó là trái Design Notes. Storage bị chặn thì người dùng mở lại link trong email.
- `hashInvitationToken` dùng SHA-256 không khóa: token 128 bit ngẫu nhiên nên lộ DB không suy ra được link.
- Nhận lời mời khi đã là thành viên (không có luồng nào tạo ra) trả 409 `ALREADY_A_MEMBER`; web hiện banner lỗi chung.
- Nút gửi của form đặt nhãn "Mời" theo AC của epic.
- Test hiện có phải sửa: `dashboard-shell.spec.ts` (Thành viên không còn là trang "Sắp có"), env worker trong `worker.test.ts`, `identity-janitor.test.ts`, `roles.process.test.ts`, `helpers.ts`. `isolation.test.ts` khẳng định 4 route mới đã nằm trong bộ test.

## Spec Change Log

## Review Triage Log

Pass 1 (02/11/2026, 3 lớp: blind-hunter BH, edge-case-hunter EC, verification-gap VG).

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | BH, EC | Retry sinh token mới, nên link trong email đã tới tay người nhận (SMTP nhận thư rồi lỗi, hoặc ghi `email_sent_at` lỗi sau khi gửi) thành "Link mời không hợp lệ." | low | Chỉ xảy ra khi SMTP đã trả 250 mà vẫn lỗi, DB lỗi ngay sau khi gửi, hoặc worker chết giữa hai bước. Người nhận vẫn nhận email mới có link dùng được. Sửa phải đổi thiết kế token (HMAC theo id, thêm secret cho worker) | reject |
| 2 | BH, EC | Bước đánh dấu đã gửi bỏ qua số dòng bị cập nhật, nên trả `'sent'` cả khi hash đã bị lần chạy khác ghi đè | low | Worker bỏ giá trị trả về. Chỉ xảy ra khi hai lần chạy chồng nhau, trong khi job hết hạn sau 15 phút còn SMTP timeout 20 giây | reject |
| 3 | BH | Giới hạn 20 lời mời/24 giờ tính theo BTC, nên tạo nhiều BTC là lách được. Tên BTC vào nguyên văn tiêu đề email mang thương hiệu Tickee, có thể bị dùng để spam/phishing | medium | `organizer.service.ts` không giới hạn số BTC một tài khoản tạo được (có từ 2.1). Cần chính sách chống lạm dụng ở cấp tài khoản, chưa có trong intent | defer |
| 4 | BH, EC | Owner không biết email mời có gửi được không (worker dừng, job vào dead-letter); toast nói "Đã gửi"; không có nút gửi lại | low | Chỉ gặp khi worker lỗi. Mời lại cùng email thì thay link và gửi lại được. Cảnh báo dead-letter thuộc 4.6. Sửa phải thêm trường vào hợp đồng | reject |
| 5 | BH, EC | Không có thời hạn giữ: lời mời đã nhận, đã thu hồi hay hết hạn giữ `email` (PII) mãi mãi; lời mời hết hạn nằm trong danh sách chờ tới khi thu hồi tay | medium | Không có janitor nào cho `organization_invitations` (identity có `identity.purge-expired`). Cần chốt thời hạn giữ dữ liệu (liên quan 7.6) | defer |
| 6 | BH, VG | Chưa test handler worker đổi lỗi gửi thành `failed` (để retry) và payload hỏng thành dead-letter | medium | Gap đã kiểm sẵn: test worker chỉ có nhánh thành công; đổi `failed` thành `completed` thì không test nào hỏng | patch |
| 7 | BH, VG, EC | Test "job chạy hai lần → một email" chỉ chờ cố định 1,5 giây, ngắn hơn chu kỳ poll 2 giây của pg-boss | medium | Job trùng thường chưa được lấy khi test khẳng định, nên test qua mà không kiểm gì | patch |
| 8 | BH, EC | `createQueue` là `INSERT … ON CONFLICT DO NOTHING`, nên đổi option retry/dead-letter sau này không áp vào môi trường đã có queue | low | Đã kiểm `pg-boss/dist/plans.js` (`ON CONFLICT DO NOTHING`). Staging/prod sẽ lệch cấu hình ở lần đổi đầu tiên; sửa bằng một lời gọi `updateQueue` | patch |
| 9 | BH, EC | Token còn trong `#` của URL: hiện trên thanh địa chỉ và lịch sử; "Đăng xuất" trong dialog step-up hay `CONSENT_REQUIRED` dựng `returnTo` từ `location.hash`, đưa token vào query `/dang-nhap?returnTo=` (và tới api khi đăng nhập Google) | medium | `providers.tsx:49` `currentLocation()` gồm cả `hash`, dùng ở :73 và :105-108; trái Design Notes | patch |
| 10 | BH | Step-up chỉ được test trên mutation mời, chưa test trên xóa/thu hồi; chưa test phát hiện bị xóa qua lỗi mutation | low | Cùng cơ chế `Providers` đã test trên mời; spec chỉ đòi mutation mời | reject |
| 11 | BH | Nội dung `Dialog` xóa Admin biến mất trong lúc dialog đóng | low | Thẩm mỹ, kéo dài khoảng 200 ms; sửa phải thêm state | reject |
| 12 | BH, EC | `useRemovedMidSession` nhận `NOT_A_MEMBER` của BTC khác (request còn treo sau khi đổi BTC) | low | Cần cùng lúc bị xóa khỏi BTC trước và có request đang treo đúng lúc đổi BTC; sửa phải soi khóa query và biến mutation | reject |
| 13 | BH | Comment của `handledElsewhere` không nhắc `NOT_A_MEMBER` (do `DashboardShell` xử lý) | low | Sửa thẳng comment | patch |
| 14 | BH | Đang thu hồi một lời mời thì nút "Thu hồi" của dòng khác bị bỏ qua mà không báo gì | low | Hiếm gặp; sửa là thêm trạng thái disabled | reject |
| 15 | BH | Job bị bỏ qua (đã thu hồi, hết hạn…) không để lại log | low | Một dòng log (không email); giúp tra lỗi "không nhận được email" | patch |
| 16 | VG | Chưa test `AdminInvitationQueues.ready()` thử lại sau lần start lỗi | medium | Gap đã kiểm sẵn: bỏ `.catch` reset thì không test nào hỏng; api start lúc DB chập chờn sẽ không mời được tới khi restart | patch |
| 17 | VG | Chưa test thứ tự "lời mời mới nhất trước" | low | Gap đã kiểm sẵn: mỗi test chỉ mời một lần | patch |
| 18 | VG | Chưa test điều kiện "chỉ đánh dấu khi hash vẫn là của lần chạy này" | low | Điều kiện kích hoạt hẹp (job hết hạn giữa lúc gửi SMTP chậm); test phải dựng transport chặn giữa chừng | reject |
| 19 | VG | Tên test "vai api tạo queue và dead-letter lúc khởi động" hứa nhiều hơn những gì kiểm | low | Test chỉ đọc cấu hình queue; đổi tên là đủ | patch |
| 20 | EC | Owner thu hồi trong khoảng giữa lúc ghi hash và lúc gửi, nên người bị thu hồi vẫn nhận email có link chết | low | Khoảng hở chỉ vài trăm ms; đọc lại trước khi gửi vẫn còn hở | reject |
| 21 | EC | Lời mời cũ được nhận song song với lần mời lại, tạo lời mời treo cho người đã là thành viên | low | Race hẹp; Owner thu hồi được; lời mời đó nhận thì trả `ALREADY_A_MEMBER`, không tạo dữ liệu sai | reject |
| 22 | EC | Nhận lời mời gặp `ALREADY_A_MEMBER` chỉ hiện banner lỗi chung | low | Chỉ tới được qua race #21 | reject |
| 23 | EC | Mở link mời thứ hai trong cùng tab (chỉ đổi hash) thì vẫn dùng token cũ | low | Link trong email mở tab mới hoặc tải lại trang; phải tự dán link vào đúng tab đó | reject |
| 24 | EC | Danh sách thành viên trả 401 lần đầu thì kẹt ở skeleton | low | Phải hết session đúng khoảng giữa lúc tải BTC và lúc tải danh sách; refetch nền thì shell chuyển sang đăng nhập | reject |

## Design Notes

Token do worker sinh lúc gửi email chứ không phải api lúc mời: payload job chỉ chứa id và DB chỉ lưu hash, nên api không có cách nào chuyển token thô cho worker. Nếu job retry sau khi đã ghi hash mà email chưa đi, worker sinh token mới và ghi đè hash; link chưa từng tới tay ai nên không mất gì. Token đặt sau `#` để không tới server web và không lọt vào header `Referer`. Lời mời thuộc `organizer`, nên handler email cũng thuộc `organizer` (tên queue theo mô-đun xử lý, AD-10), gửi bằng `EMAIL_TRANSPORT` của platform như `identity` đang làm.

## Verification

**Commands:**
- `pnpm turbo build typecheck lint:deps test` -- expected: tất cả pass.
- `pnpm --filter @tickee/web test:e2e` -- expected: pass trên `ios-webkit` và `android-chromium`.
