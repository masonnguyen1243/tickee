---
title: 'Story 2.2: TOTP cho Owner (đăng ký, step-up, mã khôi phục)'
type: 'feature'
created: '2026-10-30'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '5467d951524ce1cccfb833370e8cd66c44e22cf6'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Owner giữ quyền liên kết tài khoản nhận tiền nhưng chỉ cần email (OTP/Google) là vào được; chưa có lớp xác thực thứ hai (FR-1, NFR-6, AD-26).

**Approach:** API trả `TOTP_REQUIRED` khi request mang vai Owner mà user chưa đăng ký TOTP hoặc session chưa step-up trong 12 giờ. Web bắt mã này: chưa đăng ký thì chuyển sang màn đăng ký (QR, khóa nhập tay, mã 6 số, rồi 10 mã khôi phục hiện một lần); đã đăng ký thì mở dialog step-up ngay tại chỗ (mã TOTP hoặc mã khôi phục), đúng thì thử lại request dở. Phần "Đặt lại TOTP" của Quản trị Tingee đã tách sang `deferred-work.md`.

## Boundaries & Constraints

**Always:**
- Sinh secret, URI và xác minh TOTP qua plugin Better Auth `twoFactor` (`allowPasswordless: true`, 6 số, 30 giây, issuer "Tickee"). Mọi chỗ chạm nội bộ plugin (`auth.api.*` của two-factor, bảng `two_factors`, xoay session) gom vào **một** adapter `TotpStore` có test ghim hành vi Better Auth 1.7, theo mẫu `SignInOtpStore`. Endpoint HTTP gốc của plugin **không** vào `AUTH_HTTP_ALLOWLIST`; web chỉ gọi endpoint của Tickee dưới `/v1/identity/totp/*`.
- `stepUpAt` là cột của `sessions` (session `additionalFields`), phải còn sau khi plugin xoay session lúc xác nhận đăng ký. Hiệu lực 12 giờ, hằng số trong `packages/contracts`.
- Mã khôi phục: 10 mã, dùng một lần, bảng riêng chỉ lưu hash; mã dự phòng của plugin không dùng. Đăng ký lại thì sinh bộ mới, bộ cũ hết hiệu lực.
- Sai 5 lần liên tiếp (TOTP và mã khôi phục, ở cả xác nhận đăng ký lẫn step-up) khóa xác minh 15 phút theo user, trả `TOTP_LOCKED` (429, `retryAfterSeconds`); đúng thì đặt lại bộ đếm. Bị khóa thì mọi lần thử đều bị từ chối, kể cả mã đúng.
- Audit (không giá trị PII, `organizationId: null`): `totp.enrolled`, `totp.locked`, `totp.recovery_code_used`. Dùng mã khôi phục thì gỡ TOTP hiện tại (lần request Owner kế tiếp sẽ ra `TOTP_REQUIRED` loại `enroll`) và gửi email báo cho user sau khi commit, theo mẫu gửi đồng bộ của OTP; gửi lỗi chỉ ghi log, không làm hỏng step-up.
- Danh sách endpoint miễn khai báo một chỗ `TOTP_EXEMPT_ROUTES` trong `packages/contracts`: enroll, verify enroll, step-up, dùng mã khôi phục, `POST /v1/identity/sign-out`, `GET /v1/identity/me`, `GET /v1/me/memberships`. Có test.
- `TOTP_REQUIRED` là 403, `details: { reason: 'enroll' | 'step_up' }`. `Me` thêm `twoFactorEnabled`.
- Admin và người chỉ là Người mua không bao giờ nhận `TOTP_REQUIRED`.
- **Quyết định (Mason, 30/10/2026):** "request mang vai Owner" là request tới route của BTC (`@RequirePermission`) mà vai giải ra là `owner`; kiểm trong `PermissionGuard`. Route ngoài BTC (mua vé, Vé của tôi, tạo BTC mới) không đòi TOTP kể cả khi user là Owner ở đâu đó.

**Never:**
- Không đòi TOTP khi đăng nhập (chỉ khi request mang vai Owner). Không trust-device, không tắt TOTP bằng tay, không step-up mới cho thao tác nhạy cảm (để 2.13/2.14).
- Không lưu secret hay mã khôi phục dạng rõ; không trả lại mã khôi phục sau lần hiện đầu tiên; không log mã.
- Không thêm pg-boss vào role api cho story này.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Owner chưa đăng ký | `GET /v1/orgs/:orgId` | 403 `TOTP_REQUIRED` `reason: enroll` | web chuyển sang màn đăng ký kèm `returnTo` |
| Xác nhận đăng ký đúng | mã 6 số đúng | 200 `{ recoveryCodes: [10] }`, `stepUpAt = now`, cookie session mới | — |
| Đã đăng ký, chưa step-up / quá 12 giờ | request Owner | 403 `reason: step_up` | dialog step-up, đúng thì thử lại request |
| Step-up sai | mã sai lần 1–4 | 400 `TOTP_INVALID` | lỗi tại ô, giữ dialog và thao tác |
| Sai lần thứ 5 | — | 429 `TOTP_LOCKED`, audit `totp.locked` | báo còn N phút |
| Dùng mã khôi phục | mã chưa dùng | step-up được, mã hết hiệu lực, TOTP gỡ, audit + email | web chuyển sang đăng ký lại |
| Mã khôi phục đã dùng | — | `TOTP_INVALID`, tính vào bộ đếm | lỗi tại ô |
| Admin / Người mua | mọi request | không bao giờ `TOTP_REQUIRED` | — |
| Route miễn | Owner chưa đăng ký gọi route trong `TOTP_EXEMPT_ROUTES` | 2xx bình thường | — |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/identity/auth.ts:27-112` -- `createAuth`; thêm plugin `twoFactor` và `session.additionalFields.stepUpAt`. `AUTH_BASE_PATH='/v1/auth'`, `rateLimit` tắt.
- `apps/api/src/modules/identity/auth-http-gate.ts:12` -- `AUTH_HTTP_ALLOWLIST`: **không** thêm route `/two-factor/*`.
- `apps/api/src/modules/identity/sign-in-otp-store.ts:28` -- mẫu adapter cho `TotpStore`. `otp-rate-limit.ts:46` -- mẫu đếm/khóa bằng Postgres + `pg_advisory_xact_lock` (`recordVerifyFailure` :159, `lockedForMs` :172, factory lỗi khoảng :38); viết bộ đếm riêng theo user, không sửa class này.
- `apps/api/src/modules/identity/schema.ts` -- `users` :12 thêm `twoFactorEnabled`; `sessions` :25-40 thêm `stepUpAt`; thêm bảng `two_factors` (theo schema plugin: `secret`, `backupCodes`, `userId`, `verified`, `failedVerificationCount`, `lockedUntil`), `totp_recovery_codes`, `totp_verify_failures`; đăng ký trong `authSchema` :127. Migration kế tiếp `0005`.
- Plugin: `node_modules/better-auth/dist/plugins/two-factor/{index,totp/index}.mjs`. Enable tạo hàng `verified=false`; `verify-totp` lần đầu xoay session (`totp/index.mjs:172-180`); lockout của plugin chỉ chạy khi chưa có session nên không dùng được.
- `apps/api/src/modules/identity/identity.controller.ts:38` -- `@Controller('identity')`; `GET me` :99, `POST sign-out` :114. Controller TOTP mới đặt cạnh, dùng `@ConsentExempt()` như các route này.
- `apps/api/src/platform/access/permission.guard.ts:55-61` -- đang gán `stepUpAt: null`; `org-scope.ts:13` có trường `stepUpAt`. Cổng `AccessResolver` hiện chỉ trả `{role}`.
- `apps/api/src/platform/http/{app-error.ts:3,error.filter.ts:6}` -- thêm `TOTP_REQUIRED` 403, `TOTP_INVALID` 400, `TOTP_LOCKED` 429 vào `DEFAULT_STATUS` và `MESSAGES`.
- `apps/api/src/platform/audit/audit.ts:5,22` -- mở rộng union `AuditAction`.
- `apps/api/src/modules/identity/otp-email.ts:10` + `platform/email/email-transport.ts` -- mẫu email đồng bộ.
- `packages/contracts/src/{errors.ts:4-29,identity.ts}` -- mã lỗi; `Me` :37; `OtpLockedDetails` :50 (dùng lại dạng `retryAfterSeconds`); `FLOW_PATHS` :70 thêm đường dẫn màn đăng ký.
- `apps/api/test/identity/harness.ts` -- `createHarness` :67, `signUp` :112, `FakeEmailTransport` :17. Owner: `POST /v1/orgs`; Admin: INSERT `members` như `test/organizer/permission-guard.test.ts:33-38`. Route test chỉ Owner: `test/organizer/test-controllers.ts`.
- `apps/web/app/providers.tsx:12-45` -- bắt `CONSENT_REQUIRED` trong `QueryCache`/`MutationCache`; làm tương tự cho `TOTP_REQUIRED`. `lib/auth/return-to.ts:11` `withReturnTo` đang thu hẹp kiểu đích, cần nới.
- `apps/web/app/(public)/dong-y/{page,consent-form}.tsx` -- mẫu trang chặn toàn màn (`safeReturnTo`, chuyển về `returnTo`).
- `apps/web/components/tickee/otp-input.tsx:34` -- ô nhập mã dùng lại. `components/ui/sonner.tsx` cho toast "Đã sao chép". Chưa có `dialog`, `checkbox`, thư viện QR.
- `apps/web/components/tickee/dashboard-shell.tsx:137` -- `redirecting` cần tính cả `TOTP_REQUIRED` loại `enroll`.
- `apps/web/e2e/identity-mock.ts:27` -- `mockIdentityApi`, CORS chỉ GET/POST/OPTIONS; `organizer-mock.ts:28`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{errors,identity}.ts` + test -- mã lỗi, `TotpRequiredDetails`, `TOTP_EXEMPT_ROUTES`, `STEP_UP_TTL_MS`, `TOTP_MAX_FAILURES`/`TOTP_LOCK_MS`, schema request/response các endpoint TOTP, `Me.twoFactorEnabled`, đường dẫn màn đăng ký.
- [x] `apps/api/src/modules/identity/{schema,auth}.ts` + `drizzle/0005_*.sql` -- cột, bảng, plugin, `additionalFields`.
- [x] `apps/api/src/modules/identity/{totp-store,totp.service,totp.controller,totp-email}.ts` + `identity.module.ts` -- `POST totp/enroll` (trả `totpUri` + khóa nhập tay), `POST totp/enroll/verify`, `POST totp/step-up`, `POST totp/recovery`; bộ đếm khóa; audit; email.
- [x] `apps/api/src/platform/access/permission.guard.ts` (+ cổng nếu cần) -- luật `TOTP_REQUIRED` khi vai là `owner` (chưa đăng ký → `enroll`, `stepUpAt` rỗng hoặc quá 12 giờ → `step_up`), đọc `stepUpAt` thật vào `accessContext`.
- [x] `apps/api/test/identity/{totp-store,totp}.test.ts`, `test/organizer/totp-required.test.ts` -- phủ mọi dòng của matrix, test ghim plugin (enable, URI, verify, xoay session vẫn giữ `stepUpAt`), test danh sách miễn duyệt mọi route trong `TOTP_EXEMPT_ROUTES`, test DB không chứa mã khôi phục dạng rõ.
- [x] `apps/web/components/ui/{dialog,checkbox}.tsx` + dependency QR (`qrcode`) -- primitive.
- [x] `apps/web/app/(public)/bao-mat/totp/{page,enroll-form}.tsx` + `lib/auth/totp.ts` -- đăng ký, rồi màn mã khôi phục (Tải xuống `.txt`, Sao chép, checkbox "Tôi đã lưu mã khôi phục" mở nút Tiếp tục về `returnTo`).
- [x] `apps/web/components/tickee/step-up-dialog.tsx` + `app/providers.tsx` -- `enroll` thì chuyển trang, `step_up` thì mở dialog; xác nhận đúng thì gọi lại query/mutation dở; mã khôi phục đúng thì chuyển sang đăng ký lại.
- [x] `apps/web/e2e/{totp.spec,identity-mock}.ts` -- đăng ký, mã khôi phục, step-up đúng và thử lại, sai giữ thao tác, khóa, dùng mã khôi phục, 320px không cuộn ngang; cả hai project.

**Acceptance Criteria:**
- Given xem DB sau khi đăng ký, then không có secret hay mã khôi phục dạng rõ, và audit không chứa mã.
- Given `pnpm turbo build typecheck lint:deps test` và Playwright, then tất cả pass, kể cả bộ test cách ly và các e2e hiện có.

## Implementation Notes

- Bộ đếm sai liên tiếp tách thành `totp-attempts.ts` (`TotpAttemptLimiter`, bảng `totp_verify_failures` một dòng/user, khóa `pg_advisory_xact_lock`). Mỗi lượt được giữ TRƯỚC khi xác minh (`begin`) để request song song không vượt ngưỡng; lỗi hệ thống hoặc "chưa bắt đầu đăng ký" trả lại lượt (`restore`).
- `PermissionGuard` đọc `req.user.twoFactorEnabled` và `req.session.session.stepUpAt` (session Better Auth, cột thật) nên không cần đổi cổng `AccessResolver`. Route miễn được so bằng `METHOD req.route.path` với `TOTP_EXEMPT_ROUTES`.
- Lúc xác nhận đăng ký, `TotpStore` lấy token session mới từ `set-cookie` của plugin để ghi `step_up_at`; test ghim xác nhận plugin chép `step_up_at` của session cũ sang session mới.
- Gọi enroll khi đã đăng ký, hoặc xác nhận khi chưa bắt đầu đăng ký → 409 `VALIDATION_FAILED` (không thêm mã lỗi mới). Step-up/mã khôi phục khi chưa đăng ký → 403 `TOTP_REQUIRED` `enroll`.
- Plugin vẫn sinh mã dự phòng của nó (lưu mã hóa trong `two_factors.backup_codes`); Tickee không dùng và không trả ra.
- Web: mutation bị chặn bởi `step_up` được gọi lại bằng `mutation.execute(variables)` sau khi step-up (giữ `onSuccess` khai báo ở `useMutation`); query lỗi `TOTP_REQUIRED` được invalidate. Đóng dialog thì bỏ các lần gọi lại đang chờ.

## Spec Change Log

## Review Triage Log

Pass 1 (30/10/2026, 3 lớp: blind-hunter BH, edge-case-hunter EC, verification-gap VG).

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | VG | Không test request song song cho luật "giữ lượt trước khi xác minh" của `TotpAttemptLimiter` | medium | Gap đã kiểm sẵn: mọi test khóa gửi tuần tự; bỏ `lockUser` ở `begin` thì mọi test vẫn pass | patch |
| 2 | VG | Không test trả lại lượt khi xác minh lỗi hệ thống | low | Gap đã kiểm sẵn: chỉ nhánh `not_started` được test | defer |
| 3 | VG | `isExempt` trong `PermissionGuard` không route nào chạm tới | low | Đúng, nhưng spec chủ ý: danh sách chủ yếu để ghi nhận và test (quyết định A); sửa nghĩa là sửa spec | reject |
| 4 | VG | `fail` đọc bộ đếm chung nên `remainingAttempts` lệch khi song song | low | Chỉ lệch số báo khi tự gửi song song; ngưỡng khóa vẫn đúng ở `begin` | reject |
| 5 | VG, EC, BH | `confirmEnrollment` không nguyên tử: plugin đã bật TOTP rồi transaction của Tickee lỗi → TOTP bật mà không có mã khôi phục, không đăng ký lại được (409) | medium | `totp.service.ts`: `store.verify` commit trước, transaction sau; `sessionGone` (session bị xóa ở tab khác) đi vào nhánh này; không bù trừ, không trả lượt | patch |
| 6 | EC, BH | `sessionTokenFrom`: cookie không có dấu chấm → `slice(0,-1)` trả token cụt thay vì bỏ qua | low | `indexOf('.')` = -1 → `slice(0,-1)`; sửa trực tiếp một điều kiện | patch |
| 7 | EC | `decodeURIComponent` ném khi percent-encoding hỏng | false | Cookie do chính Better Auth ký và encode; không có đường nào đưa giá trị hỏng vào `set-cookie` của nó | reject |
| 8 | EC | Hai request xác nhận đăng ký song song cùng qua `isEnabled` | low | Web khóa nút khi đang gửi; lần thứ hai dùng session cũ đã bị plugin xóa nên không qua được xác thực | reject |
| 9 | EC | Transaction sau xác minh của `stepUp` lỗi thì lượt đã giữ không được trả | low | Cùng gốc với #5 (lượt giữ trước khi xác minh không trả khi lỗi sau xác minh) | patch (gộp #5) |
| 10 | EC | `succeed` xóa khóa do request song song vừa đặt | low | Chỉ xảy ra khi chính người có mã đúng gửi song song với mã sai; sửa phải thêm điều kiện | reject |
| 11 | EC | `fail` sau khi `succeed` song song đặt về 0 báo còn 5 lần | low | Như #4, chỉ lệch số báo | reject |
| 12 | EC | `twoFactorEnabled` true mà thiếu hàng `two_factors` → step-up trả 409 | false | `remove` xóa hàng và tắt cờ trong cùng transaction; plugin bật cờ cùng lúc tạo/xác nhận hàng; không đường nào tạo trạng thái này | reject |
| 13 | EC | SMTP treo làm response dùng mã khôi phục treo | low | Cùng mẫu gửi đồng bộ của OTP (Epic 1), spec chọn có chủ đích | reject |
| 14 | EC | Màn đăng ký: `GET /identity/me` lỗi 5xx/mạng → skeleton mãi, không có "Thử lại" | medium | `enroll-form.tsx:270-302` chỉ xử lý UNAUTHENTICATED; nhánh còn lại rơi vào skeleton | patch |
| 15 | EC, BH | `revokeObjectURL` gọi ngay sau `click()` có thể hủy tải `.txt` trên Safari/Firefox | low | `enroll-form.tsx:189`; đây là cơ hội duy nhất lưu mã, sửa trực tiếp bằng hoãn revoke | patch |
| 16 | BH | `POST totp/enroll` trả secret mà không có `cache-control: no-store` | low | Chỉ `enroll/verify` đặt `no-store`; sửa một dòng | patch |
| 17 | BH | Không chống dùng lại cùng mã TOTP trong cửa sổ 30–90 giây | low | AC không đòi; người có mã đã có quyền step-up; sửa phải thêm trạng thái | reject |
| 18 | BH | Dùng mã khôi phục không xóa `step_up_at` của các session khác; đăng ký lại xong session khác qua guard không cần step-up | medium | `TotpStore.remove` chỉ xóa TOTP; guard đọc `step_up_at` theo session (12 giờ) nên session cũ (có thể của kẻ chiếm) vẫn qua | patch |
| 19 | BH | `stepUpAt` trong response mã khôi phục không cho quyền gì | low | Vô hại, chỉ là thông tin; spec ghi "step-up được" | reject |
| 20 | BH | Hai lỗi 409 cùng `VALIDATION_FAILED`, màn quét báo "phiên hết" khi đã bật ở tab khác | low | Bấm "Tạo mã mới" nhận 409 → tự chuyển về `returnTo`; sửa phải thêm mã lỗi công khai | reject |
| 21 | BH | e2e "step-up giữa thao tác" mock `POST /orgs` mà API thật không đòi TOTP ở đó | low | Đúng: chưa có mutation nào thuộc BTC; nhánh thử lại mutation chỉ test bằng hợp đồng giả | defer |
| 22 | BH | `mutation.execute` khi thử lại bỏ callback gắn ở `mutate(vars, {...})` / `mutateAsync` | low | Đúng theo TanStack; chưa ai dùng callback tại chỗ gọi, nhưng form sau (2.4+) sẽ gặp; sửa là ghi chú tại chỗ | patch |
| 23 | BH | Không audit step-up thành công, không email khi đăng ký | low | AC không đòi; danh sách audit spec đã chốt | reject |
| 24 | BH | Mã khôi phục mất khi tải lại trang, không sinh lại được | false | Spec và AC: hiện một lần duy nhất, có xác nhận "đã lưu" | reject |
| 25 | BH | `restore` không giữ advisory lock | false | `restore` là một câu UPDATE nguyên tử `greatest(x-1,0)`; không đọc-sửa-ghi | reject |
| 26 | BH | Hook sign-in của plugin có thể chặn đăng nhập OTP/Google của user đã đăng ký | false | `two-factor/index.mjs:247` so khớp đúng `/sign-in/email`, `/sign-in/username`, `/sign-in/phone-number`; OTP là `/sign-in/email-otp`, Google là callback | reject |

## Design Notes

Step-up dùng dialog tại chỗ, không chuyển trang, để giữ dữ liệu form đang nhập. Đăng ký lần đầu là trang riêng như `/dong-y`, vì cần nhiều bước và chỉ xảy ra một lần. Email "đã dùng mã khôi phục" gửi đồng bộ như OTP: api chưa có pg-boss (AD nói email là job; giữ nhất quán với Epic 1, chuyển sang outbox cùng lúc với các email khác).

## Verification

**Commands:**
- `pnpm turbo build typecheck lint:deps test` -- expected: tất cả pass.
- `pnpm --filter @tickee/web test:e2e` -- expected: pass trên `ios-webkit` và `android-chromium`.
