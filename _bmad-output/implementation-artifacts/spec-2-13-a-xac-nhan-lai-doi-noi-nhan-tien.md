---
title: 'Story 2.13-a: Xác nhận lại trước khi đổi nơi nhận tiền'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'beef6ded7e6a2defe0fa8ef64312c5c782c9e47c'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Phiên đăng nhập bị lộ hiện đổi được tài khoản nhận tiền mặc định hoặc hủy liên kết tài khoản mà không cần chứng minh lại danh tính, và không ai trong BTC được báo.

**Approach:** `identity` cấp một lần xác nhận lại (5 phút, dùng một lần, gắn với user và session) sau khi nhập TOTP (đã bật 2FA) hoặc OTP email (chưa bật). "Đặt làm mặc định" và "Hủy liên kết" (Story 2.6) đòi lần xác nhận này, thiếu thì `REAUTH_REQUIRED`; mỗi lần tài khoản mặc định đổi thì email cảnh báo Owner và mọi Admin. Đổi key Tingee là 2.13-b (đã ghi `deferred-work.md`).

## Boundaries & Constraints

**Always:**
- Quyết định đã chốt khi lập spec: chỉ nhận mã TOTP (không nhận mã khôi phục); hủy tài khoản mặc định cuối cùng cũng gửi email ("không còn tài khoản nhận tiền"); hủy tài khoản không mặc định thì không gửi email; "Đặt làm mặc định" cho tài khoản đã mặc định vẫn đòi xác nhận nhưng không gửi email.
- Kiểm quyền trước (Admin → `FORBIDDEN_ROLE`, không bao giờ thấy `REAUTH_REQUIRED`), rồi mới tới xác nhận lại.
- Lần xác nhận bị tiêu trong cùng transaction với thao tác: thao tác lỗi (404, đua) thì rollback, lần xác nhận còn dùng được.
- Token chỉ lưu hash; mã OTP chỉ lưu hash. Email cảnh báo là job pg-boss enqueue bằng chính `tx`; payload không chứa PII.
- Sai TOTP dùng chung bộ đếm `TotpAttemptLimiter`; gửi/sai OTP email dùng chung giới hạn của đăng nhập (`OtpRateLimiter`, khóa 15 lần sai/24 giờ).

**Never:**
- Không dùng `sessions.step_up_at`. Không đổi luồng đăng nhập OTP của Better Auth.
- Không làm đổi key Tingee (2.13-b) hay chuyển quyền Owner (2.14).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Thiếu xác nhận | Owner gọi setDefault/unlink không có header `X-Reauth-Token` | Không đổi gì | `403 REAUTH_REQUIRED {method: 'totp' \| 'email_otp'}` |
| TOTP đúng | Owner bật 2FA, `POST /v1/identity/reauth {code}` | `{reauthToken, expiresAt}` (+5 phút) | Sai → `TOTP_INVALID`/`TOTP_LOCKED` |
| OTP email | Owner chưa bật 2FA, `POST …/reauth/email-code` rồi `POST …/reauth {code}` | Email "Mã xác nhận" 6 số, hết hạn 5 phút; đúng → token | Sai/hết hạn/quá lượt → `OTP_INVALID`/`OTP_EXPIRED`/`OTP_ATTEMPTS_EXCEEDED`/`OTP_LOCKED`; gửi dồn → `OTP_RATE_LIMITED` |
| Sai phương thức | Đã bật 2FA mà gọi `email-code` | Không gửi | `409 REAUTH_METHOD_MISMATCH` |
| Token dùng lại / hết hạn / session khác | Gửi lại token đã tiêu, quá 5 phút, hoặc từ session khác | Không đổi gì | `REAUTH_REQUIRED` |
| Đổi mặc định | Token hợp lệ, setDefault tài khoản B (A đang mặc định) | B mặc định; job cảnh báo ••••A → ••••B | — |
| Hủy mặc định | Token hợp lệ, unlink A mặc định, còn B | B mặc định; job cảnh báo ••••A → ••••B | — |
| Hủy tài khoản cuối | Token hợp lệ, unlink tài khoản duy nhất | Không còn tài khoản; job cảnh báo ••••A → không còn | — |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/identity/` -- `totp-store.ts:87` `verify(headers, code)`, `:104` `isEnabled`; `totp-attempts.ts:47` limiter (`begin`/`fail`/`succeed`); `otp-rate-limit.ts:25` `consume`, `assertVerifyAllowed`, `recordVerifyFailure`; `totp-email.ts:4` `securityEmail` (mẫu email bảo mật, chưa export); `identity-janitor.ts` dọn rác; `identity.controller.ts:99` mẫu route; `index.ts` chỉ export hàm (mẫu `userContacts`). Không đụng `otp-email.ts`, `sign-in-otp-store.ts`, plugin emailOTP.
- `apps/api/src/modules/organizer/payout-account.service.ts` -- `unlink` (:297), `setDefault` (:332), `makeDefault` (:351), `lockOrganization` (:387), `currentAccount` (:405, cần thêm `accountLast4`). `payout-account.controller.ts:54-67` hai route.
- `apps/api/src/modules/organizer/invitation-jobs.ts:50-148` -- mẫu queue + `enqueue(boss, tx, …)` + worker + `ready()`; đăng ký worker ở `worker.module.ts:27`. Queue tên ở `packages/contracts/src/jobs.ts`.
- `packages/contracts/src/errors.ts`, `apps/api/src/platform/http/app-error.ts:3-47` (`Record<ErrorCode,number>`), `error.filter.ts` (`MESSAGES`). `packages/contracts/src/identity.ts` (DTO identity).
- Web: `components/tickee/step-up-dialog.tsx` (mẫu dialog TOTP), `components/tickee/otp-input.tsx`; `lib/auth/api.ts:18` `fetchMe` (`twoFactorEnabled`, email); `lib/organizer/api.ts:89-101` fetchers; `tai-khoan-nhan-tien/payout-account-manager.tsx` `UnlinkDialog` (:602, mutation :617), `LinkedView` makeDefault (:731).
- Test: `apps/api/test/identity/harness.ts` (`signUp`, `signUpWithTotp`, `totpCode`, `lastCodeFor`), `test/organizer/payout-account.test.ts` (suite đa tài khoản :531-760, Admin :807), `test/organizer/admin-invitation-job.test.ts:134-174` (mẫu `boss.findJobs`); `apps/web/e2e/payout-account.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{errors,identity,jobs}.ts` -- thêm `REAUTH_REQUIRED` (details `{method}`), `REAUTH_METHOD_MISMATCH`; DTO `ReauthRequest {code}`, `ReauthGrant {reauthToken, expiresAt}`, hằng `REAUTH_HEADER = 'x-reauth-token'`, `REAUTH_TTL_SECONDS = 300`; queue `ORGANIZER_NOTIFY_DEFAULT_PAYOUT_CHANGED` -- hợp đồng chung api/web.
- [x] `apps/api/src/platform/http/{app-error,error.filter}.ts` -- `REAUTH_REQUIRED: 403`, `REAUTH_METHOD_MISMATCH: 409`, message tiếng Việt.
- [x] `apps/api/src/modules/identity/schema.ts` + migration `0014` (`db:generate --name reauth`) -- bảng `reauth_codes` (`user_id` PK, `code_hash`, `attempts`, `expires_at`) và `reauth_grants` (`id`, `user_id`, `session_id`, `token_hash` unique, `expires_at`, `used_at`, `created_at`); janitor dọn dòng hết hạn.
- [x] `apps/api/src/modules/identity/reauth.{service,controller}.ts`, `reauth-email.ts` -- `POST /v1/identity/reauth/email-code`, `POST /v1/identity/reauth`; email "Mã xác nhận" qua `securityEmail` (export từ `totp-email.ts`); đăng ký trong `identity.module.ts`.
- [x] `apps/api/src/modules/identity/index.ts` -- export `consumeReauth(tx, {userId, sessionId, token})`: `UPDATE … SET used_at = now() WHERE token_hash = … AND user_id AND session_id AND used_at IS NULL AND expires_at > now() RETURNING`; 0 dòng → ném `REAUTH_REQUIRED` với `method` theo `users.two_factor_enabled`.
- [x] `apps/api/src/modules/organizer/payout-account.{controller,service}.ts` -- controller đọc header, service gọi `consumeReauth` ngay sau `lockOrganization`; khi mặc định đổi (setDefault khác cũ, unlink tài khoản mặc định kể cả cuối cùng) enqueue job cảnh báo trong `tx`.
- [x] `apps/api/src/modules/organizer/payout-default-jobs.ts`, `payout-default-email.ts` -- queue + worker theo mẫu `invitation-jobs.ts`; payload `{organizationId, previousAccountId, nextAccountId|null, actorUserId, changedAt}`; worker đọc 4 số cuối (dòng đã gỡ vẫn còn), gửi Owner và mọi Admin: tên BTC, ••••cũ → ••••mới/"không còn tài khoản nhận tiền", người đổi, giờ `Asia/Ho_Chi_Minh`, lời khuyên nếu không phải mình.
- [x] `apps/web/components/tickee/reauth-dialog.tsx`, `apps/web/lib/auth/reauth.ts` -- `Dialog` "Xác nhận để tiếp tục": 2FA → `OtpInput` TOTP; chưa → "Gửi mã tới {email}" + `OtpInput`; lỗi tại chỗ; helper `withReauth(call)` gọi, gặp `REAUTH_REQUIRED` thì mở dialog, lấy token, gọi lại với header.
- [x] `apps/web/lib/organizer/api.ts`, `payout-account-manager.tsx` -- fetchers nhận `reauthToken?`; nút "Đặt làm mặc định" và nút xác nhận của `UnlinkDialog` đi qua `withReauth`; bỏ chú thích ":599" về Story 2.13.
- [x] Test API: `test/identity/reauth.test.ts` (matrix phần identity: TOTP, OTP email, mismatch, dùng lại, hết hạn, session khác, khóa); `test/organizer/payout-account.test.ts` sửa ca cũ để lấy token, thêm `REAUTH_REQUIRED`, rollback không tiêu token (404), Admin vẫn `FORBIDDEN_ROLE`; test job/worker gửi đúng người nhận và đúng 4 số cuối. Route mới vào `isolation.test.ts`.
- [x] `apps/web/e2e/payout-account.spec.ts` -- mock `REAUTH_REQUIRED` → dialog → nhập mã → thao tác xong, cho cả `totp` và `email_otp`.

**Acceptance Criteria:**
- Given Owner đã xác nhận rồi bấm "Hủy liên kết", when dialog hủy liên kết đã đóng và dialog xác nhận lại hiện, then nhập mã đúng thì thao tác chạy mà không phải bấm lại "Hủy liên kết".
- Given job cảnh báo được enqueue, when transaction rollback, then không có email nào được gửi.
- Given Admin, when xem trang Tài khoản nhận tiền, then không thấy nút đặt mặc định/hủy liên kết (giữ nguyên 2.6).

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (2026-11-08). Lớp: BH = Blind Hunter, EC = Edge Case Hunter, VG = Verification Gap.

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | EC | Header `x-reauth-token` không nằm trong danh sách redact của pino, nên token lọt vào log request | medium | `pino-options.ts` `buildRedactPaths` chỉ che `authorization`, `cookie`, IP | patch |
| 2 | BH, EC | Email OTP: thao tác thứ hai trong vòng 60 giây gặp `OTP_RATE_LIMITED`; dialog mount lại nên mất `resendAt` | medium | `OtpRateLimiter` cooldown 60 giây; `ReauthForm` có `key={prompt.id}` | patch |
| 3 | BH, EC | Một mã TOTP dùng lại trong cửa sổ 30 giây cấp được nhiều lần xác nhận | medium | Better Auth `verifyTOTP` không chặn dùng lại mã; step-up đã có từ trước | defer |
| 4 | BH | Queue cảnh báo không có dead-letter, còn queue mời Admin có | medium | `DEFAULT_PAYOUT_QUEUE_OPTIONS` không có `deadLetter`; Story 4.6 cảnh báo dựa vào dead-letter | patch |
| 5 | BH | Một địa chỉ lỗi mãi thì retry gửi lại cho mọi người | low | Lỗi SMTP lúc gửi cho riêng một người nhận hiếm gặp; sửa cần một job cho mỗi người nhận | reject |
| 6 | BH | Xóa Admin không cần xác nhận lại, nên phiên Owner bị lộ có thể xóa Admin trước khi đổi mặc định | medium | `members.controller.ts:37`; kiến trúc không liệt kê xóa Admin là thao tác nhạy cảm; có từ 2.4 | defer |
| 7 | BH, EC, VG | `select()` biến tài khoản đầu tiên sau khi đã hủy hết thành mặc định mà không xác nhận lại, không gửi cảnh báo | low | Hành vi có từ 2.6; lần hủy tài khoản cuối đã gửi cảnh báo; tài khoản mới phải cùng merchant Tingee. Liên quan 2.13-b | defer |
| 8 | BH, EC | `confirmTotp` gặp `not_started` (2FA bị tắt giữa chừng) thì trả lỗi của luồng đăng ký | low | `reauth.service.ts` `totpNotStarted()`; sửa trực tiếp được | patch |
| 9 | BH, EC | Dialog gặp `UNAUTHENTICATED` thì chỉ báo tại chỗ, không chuyển tới đăng nhập | low | Session hết hạn trong 5 phút dialog mở là hiếm; vẫn có thông báo; sửa phải thêm nhánh | reject |
| 10 | EC | `TOTP_REQUIRED` mở `StepUpDialog` chồng lên dialog xác nhận lại | low | Chỉ xảy ra khi 2FA được bật ở nơi khác giữa chừng | reject |
| 11 | BH | Không có audit cho việc cấp hay tiêu lần xác nhận | low | Thao tác đã có audit theo actor; lần xác nhận được ép bằng mã nên không thể đổi mà thiếu nó | reject |
| 12 | BH | Email cảnh báo thiếu link; lời khuyên "đăng xuất khỏi mọi thiết bị" nhưng chưa có tính năng này | low | Câu chữ chép từ `totp-email.ts` (có từ trước); thiếu link chỉ là mỹ thuật | defer (phần đăng xuất mọi thiết bị) |
| 13 | BH | Mã email gắn với user, không gắn session | low | Cần quyền vào hộp thư; sửa phải thêm cột | reject |
| 14 | BH | "Mã có hiệu lực 5 phút" viết cứng | low | `reauth-dialog.tsx:179`; sửa trực tiếp | patch |
| 15 | BH, EC | `defaultPayoutQueues.ready()` lỗi thì thao tác không enqueue gì cũng nhận 500 | low | pg-boss hỏng là lỗi hạ tầng chung | reject |
| 16 | BH | Kiểu `SessionRequest` riêng; `clientIp` export từ controller | low | Chỉ là kiểu dáng mã, không gây hại cụ thể | reject |
| 17 | EC | Rời trang khi dialog còn mở thì xác nhận vẫn chạy thao tác cũ | low | Dialog là modal; thao tác vẫn là thao tác người dùng đã bấm | reject |
| 18 | EC | `release`/`delete` trong `catch` ném lỗi thì 503 thành 500 | low | Sửa trực tiếp bằng `.catch(() => undefined)` | patch |
| 19 | VG | Chưa có test worker: gửi lỗi thì job sang `retry` | medium | Gap đã được xác minh; mẫu `admin-invitation-job.test.ts:186-199` | patch |
| 20 | VG, BH | Chưa có test UnlinkDialog sau dialog xác nhận lại: hủy thì im lặng, lỗi thì hiện toast | medium | Gap đã được xác minh | patch |
| 21 | VG, BH | Chưa có test dialog đổi phương thức khi gặp `REAUTH_METHOD_MISMATCH` | medium | Gap đã được xác minh | patch |
| 22 | VG | Chưa có test CORS preflight của API cho `x-reauth-token` | medium | Gap đã được xác minh; mock e2e tự cho phép header | patch |

## Design Notes

- **Tiêu token trong transaction của thao tác, không dùng guard:** guard tiêu token ở transaction riêng thì thao tác lỗi sau đó làm mất token, người dùng phải nhập mã lại. Gọi `consumeReauth` sau `lockOrganization` cũng tuần tự hóa hai request cùng token.
- **Không gắn token với loại thao tác:** đã gắn user + session, dùng một lần, 5 phút; 2.13-b và 2.14 gọi cùng `consumeReauth` ở bước ghi cuối.
- **Web phản ứng theo lỗi, không đoán trước:** server là nguồn duy nhất quyết định khi nào cần xác nhận; web chỉ biết header và dialog.

## Verification

**Commands:**
- `pnpm --filter @tickee/api db:generate --name reauth` -- expected: sinh `drizzle/0014_reauth.sql` chỉ tạo 2 bảng mới.
- `pnpm typecheck && pnpm lint:deps` -- expected: sạch.
- `pnpm --filter @tickee/api test` -- expected: pass, gồm `reauth.test.ts` và `payout-account.test.ts`.
- `pnpm --filter @tickee/web test && pnpm --filter @tickee/web test:e2e payout-account` -- expected: pass.
