---
title: 'Epic 1 AI-5: Tách auth.ts và gom phần nội bộ Better Auth vào một adapter'
type: 'refactor'
created: '2026-10-30'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '17409e4aeb1f72e45aab44c020b781a03556fe17'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-retro-2026-10-29.md'
---
<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates"></frozen>

## Intent

**Problem:** `apps/api/src/modules/identity/auth.ts` (227 dòng) trộn cấu hình Better Auth với cổng HTTP, kênh báo lỗi gửi mail, logger và việc đổi lỗi Google (retro B1); Story 2.2 (TOTP) sẽ nối tiếp vào đây. `identity.service.ts` gọi thẳng `auth.instance.$context.internalAdapter` ở 3 chỗ và tự đọc định danh `sign-in-otp-<email>` cùng định dạng `"<hash>:<attempts>"` (B2): nâng Better Auth có thể làm hỏng mà không test nào báo.

**Approach:** Tách `auth.ts` thành các file nhỏ theo trách nhiệm, `auth.ts` chỉ còn `createAuth` và kiểu. Gom mọi truy cập `internalAdapter` cùng hiểu biết về định danh/định dạng OTP vào một adapter duy nhất `SignInOtpStore`, có test ghim hành vi của Better Auth 1.7 chạy trên Postgres thật. Không đổi hành vi bên ngoài. Phần web của AI-5 (`login-form.tsx`) đã tách sang `deferred-work.md`.

## Boundaries & Constraints

**Always:**

- Hành vi HTTP, mã lỗi, câu báo, log và DB giữ nguyên: toàn bộ test hiện có của `apps/api` pass mà không sửa assertion (chỉ được sửa đường dẫn import).
- Sau khi xong, chỉ `sign-in-otp-store.ts` (và test của nó) được nhắc tới `internalAdapter`, `$context`, `sign-in-otp-` hay tách chuỗi theo `:` của verification trong `src/`.
- Không tạo vòng import; `pnpm --filter api lint:deps` sạch.
- Comment tiếng Việt, cùng mật độ và giọng như code hiện tại; giữ nguyên các comment giải thích "vì sao" khi di chuyển code.

**Never:**

- Không đổi nội dung `logBetterAuth` (che PII thêm là việc của AI-1), không đổi cấu hình `betterAuth({...})`.
- Không nâng/hạ phiên bản `better-auth`; không thêm dependency.
- Không đụng `apps/web`, `packages/contracts`, migration hay schema.
- Không đổi API công khai của mô-đun (`index.ts`).

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/identity/auth.ts` -- nguồn cần tách. Dòng 32-67: allowlist + `isAuthHttpPathAllowed` + `authHttpGate`; 69-84: `EmailDeliveryError`, `OtpDeliveryState`, `otpDelivery`; 86-103: `EMAIL_PATTERN`, `logBetterAuth`; 108-128 + hook 174-182: `OAUTH_CALLBACK_ENDPOINT`, `rewriteUnverifiedLinkError`. Giữ lại: `AUTH_BASE_PATH`, `OTP_EXPIRES_IN_SECONDS`, `GOOGLE_PROVIDER_ID`, `WITHOUT_PROVIDER_TOKENS`, `createAuth`, `Auth`, `AuthSession`.
- `apps/api/src/modules/identity/identity.service.ts` -- `signInIdentifier` (:26), `usedAttempts` (:29-32), `internalAdapter` ở :117-118 (xóa mã khi SMTP lỗi), :133-134 (`hadCode`), :195-197 (số lượt còn lại trong `mapOtpError`). Đây là mọi chỗ cần chuyển sang adapter.
- `apps/api/src/modules/identity/identity.module.ts` -- import `authHttpGate`, `createAuth`; đăng ký provider mới ở đây.
- `apps/api/src/modules/identity/session.guard.ts` -- chỉ import kiểu `Auth`, `AuthSession`: không đổi.
- `apps/api/test/identity/{better-auth-logger,otp-login,google-login}.test.ts` -- import `logBetterAuth`, `isAuthHttpPathAllowed`, `rewriteUnverifiedLinkError` từ `auth.js`: chỉ sửa đường dẫn.
- `apps/api/test/identity/harness.ts` -- dựng app thật + Postgres + `FakeEmailTransport.lastCodeFor`; dùng cho test adapter.
- Better Auth 1.7.14 `plugins/email-otp/utils.mjs` (`toOTPIdentifier` → `sign-in-otp-<email>`, `splitAtLastColon`) và `routes.mjs:246-253` (sai mã → ghi `<otp>:<attempts+1>`): hành vi mà adapter ghim.

## Tasks & Acceptance

**Execution:**

- [X] `apps/api/src/modules/identity/auth-http-gate.ts` -- mới: chuyển `AUTH_HTTP_ALLOWLIST`, `AUTH_HTTP_METHODS`, `NOT_FOUND_BODY`, `isAuthHttpPathAllowed`, `authHttpGate` -- cổng HTTP tách khỏi cấu hình.
- [X] `apps/api/src/modules/identity/otp-delivery.ts` -- mới: chuyển `EmailDeliveryError`, `OtpDeliveryState`, `otpDelivery` -- kênh lỗi gửi mail.
- [X] `apps/api/src/modules/identity/better-auth-logger.ts` -- mới: chuyển `EMAIL_PATTERN`, `authLogger`, `logBetterAuth` nguyên văn -- chỗ AI-1 sẽ sửa.
- [X] `apps/api/src/modules/identity/google-callback.ts` -- mới: chuyển `rewriteUnverifiedLinkError` và xuất hook after (`googleCallbackHook` bọc `createAuthMiddleware`) -- `createAuth` chỉ gắn `hooks: { after: googleCallbackHook }`.
- [X] `apps/api/src/modules/identity/sign-in-otp-store.ts` -- mới: `@Injectable() SignInOtpStore` nhận `AuthService<Auth>`; ba phương thức `has(email)`, `remainingAttempts(email)` (không có mã → 0; tính `OTP_MAX_ATTEMPTS − attempts`), `delete(email)`. Định danh và phân tích `"<hash>:<attempts>"` là chi tiết riêng của file này, ghi rõ trong comment là phụ thuộc Better Auth 1.7.
- [X] `apps/api/src/modules/identity/auth.ts` -- chỉ còn hằng số giữ lại, `createAuth`, kiểu; import từ các file mới.
- [X] `apps/api/src/modules/identity/identity.service.ts` -- bỏ `signInIdentifier`, `usedAttempts`, mọi `$context`; inject `SignInOtpStore`; import `otpDelivery`/`OtpDeliveryState` từ `otp-delivery.js`.
- [X] `apps/api/src/modules/identity/identity.module.ts` -- import gate từ file mới; thêm `SignInOtpStore` vào providers.
- [X] `apps/api/test/identity/*.test.ts` -- sửa đường dẫn import sang file mới.
- [X] `apps/api/test/identity/sign-in-otp-store.test.ts` -- mới, dùng harness: ghim hành vi Better Auth (xem AC).

**Acceptance Criteria:**

- Given chưa gửi mã cho email, when gọi `has`/`remainingAttempts`, then `false`/`0`.
- Given vừa gửi mã qua `POST /v1/identity/otp`, when gọi adapter, then `has` = `true` và `remainingAttempts` = `OTP_MAX_ATTEMPTS`.
- Given đã nhập sai k lần (k < 5) qua `POST /v1/identity/otp/verify`, when gọi `remainingAttempts`, then = `OTP_MAX_ATTEMPTS − k`.
- Given có mã, when gọi `delete`, then `has` = `false` và verify bằng mã đúng cũ trả lỗi (không đăng nhập được).
- Given gói `better-auth` đã cài, when chạy test, then phiên bản khớp `1.7.x`; khác thì test fail kèm thông điệp yêu cầu kiểm lại `sign-in-otp-store.ts`.
- Given mã nguồn sau thay đổi, when `grep -rn "internalAdapter\|\$context\|sign-in-otp-" apps/api/src`, then chỉ thấy trong `sign-in-otp-store.ts`.

## Implementation Notes

- `auth.ts` 227 → 115 dòng; 4 file mới chép nguyên code và comment. Comment duy nhất đổi: `AUTH_BASE_PATH` trỏ sang `auth-http-gate.ts`. `auth-http-gate.ts` import hằng số từ `auth.ts` (một chiều, không vòng).
- AC grep: ngoài `sign-in-otp-store.ts`, lệnh grep còn khớp dòng `import { SignInOtpStore } from './sign-in-otp-store.js'` ở `identity.module.ts` và `identity.service.ts` (tên file chứa `sign-in-otp-`). Không có truy cập nội bộ nào khác; ý của AC đạt.
- Kiểm (2026-10-30): `typecheck` sạch, `lint:deps` 0 vi phạm, `test` 16 file / 158 test pass (5 test mới).

## Spec Change Log

## Review Triage Log

Vòng 1 (2026-10-30; blind-hunter, edge-case-hunter, verification-gap):

| # | Phát hiện | Verdict | Bằng chứng | Hướng |
|---|---|---|---|---|
| 1 | `signInIdentifier` không hạ chữ thường email (blind + edge) | low | Better Auth hạ chữ thường trước `toOTPIdentifier` (`routes.mjs:95,237,409`); hiện chỉ đúng nhờ zod `EmailAddress`. Sửa trực tiếp một dòng. | patch |
| 2 | `usedAttempts` đọc sai khi giá trị không có `:` (blind + edge) | false | Better Auth luôn ghi `${otp}:<n>` (`routes.mjs:43,49,141,253,784`); không có đường nào tạo giá trị thiếu `:`. | reject |
| 3 | Test ghim dừng trước lần sai thứ 5 | low | Trạng thái hết lượt (`atomicVerifyOTP` tạo lại bản ghi `:5`) là thứ `mapOtpError` dựa vào; mở rộng vòng lặp là sửa test trực tiếp. | patch |
| 4 | Test `delete` chỉ kiểm `status >= 400` | low | 500 hay 429 cũng pass; siết về mã lỗi cụ thể. | patch |
| 5 | Không có test cho mã đã hết hạn trong `has()` | low | `otp-login.test.ts:389` đã chạy đường mã hết hạn → `OTP_EXPIRED`; thêm test là phức tạp thêm cho trường hợp hiếm. | reject |
| 6 | Kiểm phiên bản lỏng (`1.7.x`) | low | Spec chốt `1.7.x`; sửa nghĩa là sửa spec. | reject |
| 7 | Kiểm phiên bản đọc `node_modules` theo đường dẫn tương đối (blind + edge) | low | Pass hiện tại nhờ symlink pnpm ở `apps/api/node_modules`, vỡ nếu đổi layout; `createRequire().resolve` là sửa trực tiếp. | patch |
| 8 | `wrongCode` cứng 6 chữ số | low | Không dùng `OTP_LENGTH`; sửa trực tiếp. | patch |
| 9 | `googleCallbackHook` chạy cho mọi provider | low | Hành vi có từ trước (`OAUTH_CALLBACK_ENDPOINT` cũ cũng khớp `/callback/:id`), hiện chỉ có Google. | reject |
| 10 | `auth-http-gate.ts` import `auth.ts` chỉ để lấy hằng số | false | Gate chỉ được nạp trong `identity.module.ts`, nơi vốn đã nạp `auth.ts`; không có người dùng nào bị kéo thêm phụ thuộc. | reject |
| 11 | `has()` trước và `remainingAttempts()` sau có thể đua khi verify song song | low | Có từ trước refactor (cùng thứ tự gọi `internalAdapter`); số lượt báo về có thể lệch một. | defer |
| 12 | Diff thiếu `deferred-work.md` và file spec | false | Hai file là artifact quy trình, cố ý không đưa vào diff review. | reject |
| 13 | AC grep không sạch theo nghĩa đen (blind + edge) | low | Chỉ khớp dòng import `./sign-in-otp-store.js`; sửa nghĩa là sửa spec. | reject |
| 14 | JSDoc trong `otp-delivery.ts` gắn vào interface thay vì `otpDelivery` | low | Chép nguyên từ code cũ (có từ trước), chỉ ảnh hưởng hover. | reject |

## Design Notes

Adapter là provider Nest (giống `OtpRateLimiter`) để `IdentityService` inject và test có thể lấy từ `app.get(SignInOtpStore)`. Lấy `context` mỗi lần gọi (`await this.auth.instance.$context`) như code hiện tại, không cache. Thứ tự giữ nguyên: `signInWithCode` vẫn tra `has` *trước* `signInEmailOTP`; `mapOtpError` vẫn tra `remainingAttempts` *sau* khi Better Auth đã ghi lần sai.

```ts
const remaining = await this.otpStore.remainingAttempts(email);
if (remaining <= 0) return attemptsExceeded();
```

## Verification

**Commands:**

- `pnpm --filter api typecheck` -- expected: không lỗi.
- `pnpm --filter api test` -- expected: mọi test pass, gồm `sign-in-otp-store.test.ts` mới.
- `pnpm --filter api lint:deps` -- expected: `no dependency violations`.
- `grep -rn "internalAdapter\|\$context\|sign-in-otp-" apps/api/src` -- expected: chỉ `sign-in-otp-store.ts`.
