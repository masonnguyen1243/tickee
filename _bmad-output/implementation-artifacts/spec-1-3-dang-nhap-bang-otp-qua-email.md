---
title: 'Story 1.3: Đăng nhập bằng OTP qua email'
type: 'feature'
created: '2026-10-28'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '11b89c96e2404258e836a8d514e48d34a3009389'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Tickee chưa có Tài khoản: `identity` rỗng, chưa có Better Auth, session hay màn đăng nhập. Mọi luồng của BTC và người mua (Epic 2, 3) đều cần người dùng đã đăng nhập và đã đồng ý NĐ 13/2023.

**Approach:** Gắn Better Auth 1.7.14 (`emailOTP`, session lưu DB) vào `identity` qua `@thallesp/nestjs-better-auth`. Web gọi các endpoint `/v1/identity/*` do Tickee tự định nghĩa. Lớp này bọc `auth.api.*` để giới hạn gửi mã trong Postgres, trả lỗi đúng dạng chuẩn và chặn tài khoản chưa đồng ý. Kèm theo màn đăng nhập OTP, màn đồng ý, `returnTo` an toàn và menu tài khoản có "Đăng xuất".

## Boundaries & Constraints

**Always:**
- OTP 6 số: `storeOTP: 'hashed'`, `expiresIn` 300 giây, `allowedAttempts` 5, `resendStrategy` `rotate` (gửi mã mới thì mã cũ hết hiệu lực). Bản ghi user chỉ được tạo khi xác minh đúng lần đầu.
- Giới hạn gửi mã đếm trong Postgres trước khi gọi Better Auth. Theo email: 1 lần mỗi 60 giây và tối đa 5 lần mỗi giờ. Theo IP: tối đa 20 lần mỗi giờ. Không lưu email hay IP dạng rõ trong bảng đếm, chỉ lưu HMAC.
- Bảng `users`, `sessions`, `accounts`, `verifications`: tên số nhiều, cột snake_case, PK do DB sinh `uuidv7()` (`generateId: false`), thời gian dùng `timestamptz`. Thời điểm đồng ý lưu ở `users.consented_at`.
- Cookie `httpOnly`, `SameSite=Lax`; bật `Secure` khi không phải môi trường local; domain cha lấy từ env. CORS chỉ cho phép `WEB_ORIGIN` và có credentials.
- Tài khoản chưa đồng ý: mọi endpoint cần đăng nhập trả 403 `CONSENT_REQUIRED`, trừ `me`, `consent` và `sign-out`.
- `returnTo` chỉ nhận đường dẫn nội bộ: bắt đầu bằng `/`, không bắt đầu bằng `//` hoặc `/\`, không có scheme. Sai hoặc thiếu thì về `/`.
- UI: dùng chuỗi tiếng Việt đúng như epic. `otp-input` có `autocomplete="one-time-code"` và `inputmode="numeric"`; dán hoặc tự điền thì điền đủ 6 ô, đủ 6 số thì tự gửi. Nhãn luôn hiện; lỗi gắn vào ô bằng `aria-describedby`. Màn hình không cuộn ngang ở 320px.
- Gửi email OTP trực tiếp qua `EmailTransport` (SMTP bằng nodemailer, local dùng Mailpit), không gọi trong transaction. Log không chứa email, OTP hay token.

**Never:**
- Không có nút Google thật (Story 1.4). Không mật khẩu, không SĐT, không TOTP (Epic 2).
- Web không gọi thẳng endpoint OTP của Better Auth. Chặn từ bên ngoài các đường dẫn `/email-otp/send-verification-otp` và `/sign-in/email-otp` của handler Better Auth để không vượt được giới hạn gửi mã.
- Không dùng rate limiter riêng của Better Auth thay cho bộ đếm Postgres. Không dùng `next-themes` và không viết lại component của 1.2.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Gửi mã | `POST /v1/identity/otp {email}` hợp lệ | 200 `{ resendAfterSeconds: 60 }`, email trong Mailpit có 6 số | email sai dạng → 400 `VALIDATION_FAILED` |
| Gửi lại quá sớm / quá 5 mã/giờ / IP quá 20/giờ | gửi lần 2 trong 60 giây, lần 6 trong giờ | 429 `OTP_RATE_LIMITED`, `details.retryAfterSeconds` | UI: "Bạn đã yêu cầu quá nhiều mã. Thử lại sau {n} phút." (n làm tròn lên, tối thiểu 1) |
| Mã đúng, email mới | `POST /v1/identity/otp/verify` | tạo user, set cookie session, `{ consentRequired: true }` | — |
| Mã đúng, đã đồng ý | như trên | set cookie, `{ consentRequired: false }` | — |
| Mã sai | lần sai thứ k (k < 5) | 400 `OTP_INVALID`, `details.remainingAttempts = 5 − k` | UI "Mã chưa đúng, còn N lần" |
| Sai lần 5 / dùng mã sau khi đã hết lượt | — | 400 `OTP_ATTEMPTS_EXCEEDED` | UI "Mã đã hết hiệu lực" + "Gửi mã mới" |
| Mã hết hạn | quá 300 giây | 400 `OTP_EXPIRED` | UI "Mã đã hết hạn" + "Gửi mã mới" |
| Mã cũ sau khi gửi lại | dùng mã trước đó | 400 `OTP_INVALID` | — |
| Chưa đồng ý | gọi endpoint cần đăng nhập khác | 403 `CONSENT_REQUIRED` | web chuyển tới màn đồng ý kèm `returnTo` |
| `returnTo` | `/su-kien/a?x=1`, `//evil.com`, `/\evil.com`, `https://x`, rỗng | lần lượt: giữ nguyên, `/`, `/`, `/`, `/` | — |
| SMTP lỗi | transport ném lỗi | 503 `SERVICE_UNAVAILABLE` | không tính vào giới hạn gửi |

**Quyết định (28/10/2026):**
- URL dùng tiếng Việt không dấu: màn đăng nhập `/dang-nhap`, màn đồng ý `/dong-y`. Các route sau giữ cùng kiểu (vd. `/ve-cua-toi`).
- Màn đồng ý NĐ 13 gồm:
  - Một đoạn tóm tắt ngắn: dữ liệu thu thập (email, tên, lịch sử mua), mục đích xử lý, quyền rút đồng ý.
  - Link tới trang `/chinh-sach-du-lieu`. Trang này có nội dung tạm, ghi rõ "Bản nháp, chờ pháp chế xác nhận".
  - Hai nút "Đồng ý" và "Không đồng ý".
  - Văn bản phải được thay bằng bản pháp chế duyệt trước Closed Beta.
- Giữ toàn bộ phạm vi story trong một spec, không tách (khoảng 5.000 token).

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/identity/index.ts` -- đang rỗng; export public API của mô-đun (vd. `IdentityModule`, `ConsentExempt`).
- `apps/api/src/api.module.ts` -- `ApiModule.forRoot` đăng ký `DbModule`, `ErrorFilter`; thêm `IdentityModule` (bên trong là `AuthModule.forRoot({ auth, bodyParser: { rawBody: true } })`, theo AD-19) và `APP_GUARD` cho consent.
- `apps/api/src/roles/api.ts` `configureApiApp` -- tiền tố `v1`; thêm `enableCors({ origin: WEB_ORIGIN, credentials: true })`. AuthModule tự tắt body parser của Nest.
- `apps/api/src/platform/config/config.schema.ts` -- role `api` thêm `BETTER_AUTH_SECRET` (≥32 ký tự), `API_PUBLIC_URL`, `WEB_ORIGIN`, `AUTH_COOKIE_DOMAIN` (tùy chọn), `SMTP_URL`, `EMAIL_FROM`. `load-config.ts` vẫn không in giá trị.
- `apps/api/src/platform/db/{columns,database}.ts` -- dùng lại `id()`, `timestamptz()`, `createdAt()` và `Database.transaction`. drizzle-kit quét `./src/**/schema.ts`.
- `apps/api/src/platform/http/{app-error,error.filter}.ts` -- `DEFAULT_STATUS` và `MESSAGES` là `Record<ErrorCode,…>`, phải thêm mã mới vào cả hai.
- `apps/api/src/platform/logging/pino-options.ts` -- redact lấy từ `PII_KEYS` và đã che cookie/set-cookie.
- `apps/api/module-graph.cjs` (`identity: []`), `.dependency-cruiser.cjs` -- giữ luật; Better Auth chỉ được import trong `modules/identity`.
- `apps/api/test/{helpers,global-setup}.ts`, `vitest.config.ts` -- Postgres thật (`tickee_test`), migrate ở global setup; dùng lại `apiConfig()`.
- `packages/contracts/src/{errors,pii,index}.ts` -- thêm mã lỗi và schema Zod request/response `identity`; thêm cột PII mới.
- `apps/web/app/(public)/layout.tsx` -- header có `Wordmark`; thêm `AccountMenu` (chưa đăng nhập: link "Đăng nhập"; đã đăng nhập: email + "Đăng xuất").
- `apps/web/components/ui/button.tsx` (`loading`), `separator.tsx`, `components/tickee/status-banner.tsx` -- dùng lại. Chưa có `input`, `label`, `dropdown-menu`; thêm bằng shadcn.
- `apps/web/lib/api/{client,server,errors}.ts`, `app/providers.tsx` -- `apiRequest` và `ApiError(code, …, details)`; thêm `QueryCache.onError` để xử lý `CONSENT_REQUIRED`.
- `apps/web/playwright.config.ts` -- hai project, webServer `next start` cổng 3100/3101, chưa có API. `NEXT_PUBLIC_API_BASE_URL` được inline lúc build, nên CI phải đặt giá trị này ở bước build để e2e mock được bằng `page.route`.
- `docker-compose.yml` -- Mailpit SMTP 1025, UI 8025. CI không có Mailpit nên test API dùng transport giả.
- Better Auth 1.7.14 (đã đọc mã nguồn): `signInEmailOTP` chỉ tạo user sau `atomicVerifyOTP`. Mã lỗi gốc là `INVALID_OTP`, `OTP_EXPIRED`, `TOO_MANY_ATTEMPTS`. Giá trị verification lưu dạng `"<hash>:<attempts>"`. Khi rotate, plugin gọi `createVerificationValue` và chỉ xóa bản cũ khi insert lỗi, nên `verifications.identifier` phải có unique index.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/package.json` -- thêm `better-auth@1.7.14`, `@thallesp/nestjs-better-auth@2.8.0`, `@nestjs/platform-express@12.3.2`, `nodemailer@10.2.1` (+ types), ghim chính xác.
- [x] `packages/contracts/src/{errors,identity,pii,index}.ts` -- `ErrorCode` thêm `UNAUTHENTICATED`, `CONSENT_REQUIRED`, `OTP_RATE_LIMITED`, `OTP_INVALID`, `OTP_EXPIRED`, `OTP_ATTEMPTS_EXCEEDED`. Schema `SendOtpRequest/Response`, `VerifyOtpRequest/Response`, `Me` (`{ id, email, consentedAt | null }`). PII thêm `users.name`, `sessions.ip_address`, `sessions.user_agent`.
- [x] `apps/api/src/modules/identity/schema.ts` + `apps/api/drizzle/0001_identity.sql` -- bảng của Better Auth (gồm `users.consented_at`; `verifications.identifier` unique) và `otp_send_events(id, email_hmac, ip_hmac, created_at)`, index `(email_hmac, created_at)` và `(ip_hmac, created_at)`. Migration sinh bằng drizzle-kit.
- [x] `apps/api/src/modules/identity/auth.ts` -- factory `createAuth(config, db, emailTransport)`: drizzle adapter với `usePlural`, `advanced.database.generateId: false`, `basePath: '/v1/auth'`, `trustedOrigins: [WEB_ORIGIN]`, `crossSubDomainCookies` khi có domain, `rateLimit.enabled: false`, `user.additionalFields.consentedAt` (`input: false`), plugin `emailOTP` theo Always. Chặn hai đường dẫn OTP gốc theo Never; nếu `disabledPaths` chặn cả `auth.api.*` thì dùng `hooks.before` từ chối mọi request HTTP tới hai path đó.
- [x] `apps/api/src/platform/email/{email-transport,smtp-transport}.ts` -- interface `EmailTransport.send({ to, subject, text, html })`, bản SMTP dùng nodemailer. Mẫu email OTP tiếng Việt nằm trong `identity`.
- [x] `apps/api/src/modules/identity/otp-rate-limit.ts` -- trong `db.transaction`: `pg_advisory_xact_lock` theo `email_hmac`, đếm các cửa sổ, insert event; vượt giới hạn thì `AppError('OTP_RATE_LIMITED', { details: { retryAfterSeconds } })`. Nếu gửi mail lỗi thì xóa event vừa thêm.
- [x] `apps/api/src/modules/identity/identity.controller.ts` -- `POST otp`, `POST otp/verify` (`@AllowAnonymous`), `GET me`, `POST consent`, `POST sign-out` dưới `/v1/identity`. Gọi `auth.api.*` với `headers` và `returnHeaders`, chuyển tiếp `set-cookie`, map lỗi của Better Auth sang `ErrorCode`. `remainingAttempts` đọc từ phần `:attempts` của verification.
- [x] `apps/api/src/modules/identity/consent.guard.ts` -- `APP_GUARD` chạy sau `AuthGuard`. Request có session mà `consentedAt` null thì ném `CONSENT_REQUIRED`, trừ handler có `@ConsentExempt()`. Request ẩn danh thì bỏ qua.
- [x] `apps/api/test/identity/*.test.ts` -- Postgres thật + `EmailTransport` giả ghi lại mã: phủ mọi dòng của matrix phía API; user chưa tồn tại sau khi gửi mã; OTP trong DB không phải 6 số rõ; cookie có `HttpOnly`, `SameSite=Lax`; sign-out xóa dòng session và trả cookie hết hạn; CORS từ chối origin lạ.
- [x] `apps/web/lib/auth/return-to.ts` + `test/return-to.test.ts` -- `safeReturnTo(raw)`, kèm test các dòng `returnTo` của matrix.
- [x] `apps/web/components/tickee/otp-input.tsx` -- 6 ô theo DESIGN.md (chữ 20px, `rounded-md`, nền `surface-sunken`, focus ring); xử lý dán, tự điền, Backspace lùi ô, gọi `onComplete` khi đủ 6 số.
- [x] `apps/web/app/(public)/dang-nhap/page.tsx` + `login-form.tsx` -- bước email → bước mã. Có đếm ngược gửi lại, các trạng thái lỗi theo matrix và nút "Đổi email". Chừa chỗ phía trên `Separator` "hoặc" cho nút Google của 1.4 (chưa render). Thành công: `consentRequired` thì sang màn đồng ý, không thì về `safeReturnTo`.
- [x] `apps/web/app/(public)/{dong-y,chinh-sach-du-lieu}/page.tsx` -- nội dung theo Quyết định. "Đồng ý" gọi `consent` rồi về `returnTo`. "Không đồng ý" gọi `sign-out`, về `returnTo` kèm `?notice=consent-declined`; `NoticeToast` ở layout gốc hiện "Bạn cần đồng ý để dùng Tickee." rồi xóa tham số.
- [x] `apps/web/components/tickee/account-menu.tsx`, `app/providers.tsx` -- đọc `me` bằng TanStack Query. "Đăng xuất" gọi `sign-out`, xóa cache rồi về `/`. `CONSENT_REQUIRED` từ bất kỳ query nào thì chuyển sang màn đồng ý.
- [x] `apps/web/e2e/login.spec.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`, `turbo.json` -- mock API bằng `page.route` trên cả hai project: dán mã thì tự gửi, hiện lỗi còn N lần, quá giới hạn, hết hạn, chuyển sang đồng ý, từ chối có toast, 320px không cuộn ngang. Đặt `NEXT_PUBLIC_API_BASE_URL` ở bước build trong CI và thêm vào `env` của turbo `build`.
- [x] `.env.example`, `README.md` -- biến mới; cách xem mã OTP qua Mailpit `http://localhost:8025`.

**Acceptance Criteria:**
- Given chạy local đủ docker-compose, api và web, when nhập email, lấy mã ở Mailpit rồi nhập, then đăng nhập được, qua màn đồng ý và về đúng `returnTo`; `users.consented_at` có giá trị.
- Given `pnpm turbo build typecheck lint:deps test` và Playwright, then tất cả pass; một import `better-auth` ngoài `modules/identity` làm `lint:deps` đỏ.
- Given log api khi chạy toàn luồng, then không chứa email, mã OTP hay token session.

### Review Findings

Code review PR #8 (29/10/2026), diff `origin/main...HEAD` (bỏ lockfile, `drizzle/meta`, `_bmad-output`). 4 lớp: blind, edge, verification-gap, acceptance. 50 finding.

- [x] [Review][Decision] Không có trần số lần nhập sai qua các lần gửi lại — Mỗi lần gửi mã mới, bộ đếm 5 lần sai lại bắt đầu từ 0. Với 5 mã/giờ cho một email, kẻ tấn công thử được 25 mã/giờ (~600/ngày), không giới hạn theo thời gian. Không gian mã là 10⁶, nên đoán trúng ~0,06%/ngày cho mỗi email bị nhắm. **Mason chọn phương án 1 (29/10/2026):** thêm trần sai theo ngày, chuyển thành patch bên dưới.
- [x] [Review][Patch] Trần sai theo ngày: một email nhập sai quá 15 lần trong 24 giờ thì khóa cả gửi mã lẫn xác minh mã cho email đó đến khi lần sai cũ nhất ra khỏi cửa sổ 24 giờ. Thêm mã lỗi `OTP_LOCKED` (429, `details.retryAfterSeconds`). UI hiện "Bạn đã nhập sai quá nhiều lần. Thử lại sau {n} giờ." (n làm tròn lên, tối thiểu 1). Bảng đếm chỉ lưu HMAC [apps/api/src/modules/identity/identity.service.ts:62]
- [x] [Review][Patch] SMTP lỗi để lại một mã mới không bị giới hạn: phải xóa verification `sign-in-otp-<email>` khi gửi thất bại [apps/api/src/modules/identity/identity.service.ts:53]
- [x] [Review][Patch] `sessions` hết hạn (giữ `ip_address`/`user_agent`) không bao giờ bị xóa: thêm vào lượt dọn bản ghi [apps/api/src/modules/identity/otp-rate-limit.ts:107]
- [x] [Review][Patch] Test `TRUST_PROXY_HOPS` ở tầng request (theo `X-Forwarded-For`) và test gửi song song cho các email khác nhau từ cùng IP [apps/api/src/roles/api.ts:22]
- [x] [Review][Patch] Test nội dung HTML của email OTP có mã và "5 phút" [apps/api/src/modules/identity/otp-email.ts:10]
- [x] [Review][Patch] Test trả lại lượt đếm khi `sendVerificationOTP` ném lỗi (nhánh catch) [apps/api/src/modules/identity/identity.service.ts:49]
- [x] [Review][Patch] e2e: đăng xuất nhận 401 vẫn hoàn tất (từ chối đồng ý, menu tài khoản) [apps/web/lib/auth/api.ts:35]
- [x] [Review][Patch] e2e: `/dong-y` khi ẩn danh chuyển sang `/dang-nhap`, khi đã đồng ý chuyển về `returnTo` [apps/web/app/(public)/dong-y/consent-form.tsx:28]
- [x] [Review][Patch] e2e: gõ đè lên ô `OtpInput` đã có số [apps/web/components/tickee/otp-input.tsx:88]
- [x] [Review][Patch] e2e: gửi lại mã ở bước nhập mã bị 429 thì hiện thông báo [apps/web/app/(public)/dang-nhap/login-form.tsx:117]
- [x] [Review][Patch] Test mã đúng không dùng lại được lần hai [apps/api/test/identity/otp-login.test.ts]
- [x] [Review][Patch] `logBetterAuth` ném TypeError khi message không phải chuỗi (`session.mjs:370` gọi `logger.error(e)`) [apps/api/src/modules/identity/auth.ts:77]
- [x] [Review][Patch] Trang `/chinh-sach-du-lieu` (bản nháp) thiếu `robots: noindex` [apps/web/app/(public)/chinh-sach-du-lieu/page.tsx:11]
- [x] [Review][Defer] pino-http log IP/User-Agent dạng rõ; che khóa `name` ở mọi log [apps/api/src/platform/logging/pino-options.ts] — deferred: có từ Story 1.1, đã ghi ở deferred-work (Triage #7, #8)
- [x] [Review][Defer] `DrizzleQueryError` lọt ra `ErrorFilter` nên log cả params chứa email [apps/api/src/platform/http/error.filter.ts:40] — deferred: có từ Story 1.1, đã ghi ở deferred-work (Triage #31)

**Rejected:**
- Cookie `Secure` theo scheme; ở production vẫn chấp nhận `http`, secret mẫu, `SMTP_URL` rỗng, `TRUST_PROXY_HOPS` không chặn trên, không kiểm same-site/cookie domain (low): chỉ gặp khi cấu hình sai lúc deploy, sửa phải thêm `superRefine` (Triage #9, #10, #38).
- Implementation/Design Notes mô tả cơ chế chặn khác code: muốn sửa phải sửa spec.
- `Separator` "hoặc" chưa render (low): chưa có nút Google thì một chữ "hoặc" đứng riêng là vô nghĩa.
- e2e `CONSENT_REQUIRED` giả lập qua `/me` (low): test vẫn chứng minh handler chạy; hiện chưa có query nào khác trả mã này.
- Thay đổi ngoài spec (`pnpm dev`, pino-pretty, `agentRules`) (false): người dùng yêu cầu trong session.
- Chặn mã của nạn nhân bằng cách verify sai; IP xoay IPv6 /64, `::ffff`, `unknown`, email alias, cổng trong XFF (low): Triage #11, #28.
- Dọn bản ghi không có index (low): `otp_send_events` chỉ giữ 1 giờ nên bảng nhỏ.
- Từ chối đồng ý vẫn giữ tài khoản; chưa rút được đồng ý; chưa lưu phiên bản chính sách; CSRF consent/sign-out: Triage #4, #5, #18.
- Văn bản đồng ý chưa nêu IP/UA, bên xử lý SMTP, thời hạn lưu: là bản nháp, phải thay trước Closed Beta theo Quyết định.
- IP trong `sessions` lấy từ XFF (low): chưa tính năng nào đọc cột này.
- `verifications.identifier` chưa có trong PII (low): không có đường log nào ghi giá trị này.
- Thiếu `Retry-After`/`Cache-Control: no-store` (low).
- `identity/index.ts` chưa export `OptionalAuth`/kiểu session (low): chưa mô-đun nào cần; thêm khi Epic 2 dùng.
- Mất bản ghi mã → `OTP_ATTEMPTS_EXCEEDED`, kể cả sau khi hết hạn (low): đằng nào cũng dẫn tới "Gửi mã mới" (Triage #12).
- Test `ConsentGuard` + `@OptionalAuth` chưa đồng ý, e2e đếm ngược (low).
- Trạng thái nút gửi lại lệch sau 429 (low): Triage #14.
- `release` ném lỗi, rotate rồi SMTP lỗi, verify đồng thời, đua 23505, đổi email khi đang gửi, đua khi từ chối, đăng xuất lỗi im lặng, `/dang-nhap/` có `/` cuối: Triage #30, #13, #12, #33, #43, #44, #45, #42.
- Dán mã lẫn số khác (vd. ngày tháng) (low): hiếm, sửa phải thêm nhánh.

## Implementation Notes

- `SessionGuard` (`modules/identity/session.guard.ts`) thay `AuthGuard` của thư viện (`disableGlobalAuthGuard: true`). Guard của thư viện bỏ mất cookie mới khi Better Auth gia hạn session; có test cho trường hợp này. Guard vẫn tôn trọng `@AllowAnonymous`/`@OptionalAuth`. Cả `SessionGuard` lẫn `ConsentGuard` đăng ký trong `IdentityModule` theo đúng thứ tự.
- Dùng `AuthModule.forRootAsync` để inject `DATABASE` và `EMAIL_TRANSPORT`. CORS bật một lần trong `configureApiApp`. Trái với Code Map, `AuthModule` không tự tắt body parser của Nest: app phải tạo với `bodyParser: false`, xuất ra thành `API_APP_OPTIONS` để test dùng chung. Parser urlencoded tắt để chặn login CSRF qua form HTML.
- `disabledPaths` chặn cả 9 đường dẫn HTTP của emailOTP, không chỉ 2, vì các đường dẫn còn lại cũng gửi hoặc kiểm mã.
- `verification.disableCleanup: true`: nếu không đặt, lời gọi verify của người khác có thể xóa bản ghi đã hết hạn, và người nhập mã hết hạn nhận `OTP_INVALID` thay vì `OTP_EXPIRED`. Better Auth báo INVALID mà không còn bản ghi mã thì trả `OTP_ATTEMPTS_EXCEEDED`.
- Better Auth nuốt lỗi của `sendVerificationOTP`, nên lỗi SMTP được báo ngược về request qua `AsyncLocalStorage` (`otpDelivery`) để trả 503 và gỡ lần đếm.
- `@Public()` trong `platform/http/public.decorator.ts` dùng chung khóa metadata với `@AllowAnonymous`, cho mô-đun không được import Better Auth. `HealthController` dùng decorator này.
- Thêm `name` vào PII làm pino che mọi khóa `name`, nên logger bootstrap trong `main.ts` đổi sang dùng `context`.
- nodemailer 10.2.1 có sẵn types (không cần `@types/nodemailer`). shadcn CLI 4.19.0 sinh `input`/`label`/`dropdown-menu` import nhầm gói `cn` từ npm, nên ba component này được viết lại để dùng `@/lib/utils`.
- `NEXT_PUBLIC_API_BASE_URL` đặt ở cấp job CI vì `turbo test` phụ thuộc `build`. Cookie có tiền tố `tickee.`. Thêm unique index `accounts(provider_id, account_id)`. Khi ẩn danh, `me`/`consent`/`sign-out` trả 401 `UNAUTHENTICATED`; `sign-out` trả 204. `safeReturnTo` từ chối thêm ký tự điều khiển và hai đích `/dang-nhap`, `/dong-y` để tránh vòng lặp.
- Kiểm tra (29/10/2026):
  - `pnpm turbo build typecheck lint:deps test --force`: 11/11 task, api 65, web 41, contracts 20 test.
  - Playwright 46/46 trên `ios-webkit` và `android-chromium`.
  - Smoke test local với Mailpit thật do agent triển khai chạy.
- Sau code review PR #8 (29/10/2026), đã áp 13 patch trong Review Findings:
  - Cơ chế chặn HTTP của Better Auth trong code bây giờ là `authHttpGate` với `AUTH_HTTP_ALLOWLIST` đang trống, nên mọi route `/v1/auth/*` đều trả 404, kể cả `get-session`. Ghi chú về `disabledPaths` ở trên đã cũ.
  - Trần sai theo ngày dùng bảng `otp_verify_failures` (migration `0002`) và mã lỗi `OTP_LOCKED`. Lần sai chỉ được ghi khi email có mã đang chờ xác minh; nếu không, ai biết email cũng khóa được người đó chỉ bằng request verify mà không cần gửi mã.
  - Kiểm tra: `pnpm turbo build typecheck lint:deps test --force` chạy xong 11/11 task, gồm api 81, web 46, contracts 20 test; Playwright 60/60.

## Spec Change Log

- 2026-10-29 (retro Epic 1, AI-4): ghi nhận hai hành vi không có trong AC gốc, nay đã đưa vào `epics.md` (Story 1.3) và PRD (FR-1): giới hạn gửi theo IP là 20 mã mỗi giờ (`OTP_SEND_LIMITS.ipPerHour`); trần sai theo ngày, hơn 15 lần sai trong 24 giờ thì khóa gửi và xác minh mã, trả `OTP_LOCKED` (bảng `otp_verify_failures`, migration `0002`, code review PR #8).

## Review Triage Log

Lượt 1. Diff review loại `_bmad-output` (spec là claims, chỉ đưa cho lớp edge), `pnpm-lock.yaml` và `drizzle/meta` (file sinh tự động). Mã route: P1–P11 là các nhóm patch.

| # | Lớp | Finding | Verdict | Bằng chứng | Route |
|---|-----|---------|---------|-----------|-------|
| 1 | blind | Giới hạn theo IP dùng IP của proxy (không `trust proxy`); IPv6 xoay trong /64 | medium | Trong `apps/api/src` không có chỗ nào đặt `trust proxy`; spine đặt api sau LB (dòng 354) và yêu cầu cấu hình trusted proxy (dòng 292). Phần IPv6 tách ra ở #28 | patch P1 |
| 2 | blind | Giới hạn IP không nguyên tử vì advisory lock chỉ khóa theo email | low | `otp-rate-limit.ts:56` chỉ khóa `otp-send:${emailHmac}`. Sửa trực tiếp bằng một lock nữa theo `ipHmac`; khóa email trước rồi IP nên không tạo vòng chờ | patch P2 |
| 3 | blind | Better Auth mở theo blocklist: `/v1/auth/update-user`, `list-sessions`… vẫn gọi được và lọt qua `ConsentGuard` | medium | Handler mount dạng middleware nên không đi qua guard của Nest. Vi phạm Always "mọi endpoint cần đăng nhập trả `CONSENT_REQUIRED`" | patch P3 |
| 4 | blind | Không lưu phiên bản chính sách, không rút được đồng ý | low | Rút đồng ý thuộc Story 7.6 (epic context). Phiên bản chính sách: hiện mới có một bản nháp, sửa phải thêm cột | reject |
| 5 | blind | "Không đồng ý" vẫn giữ dòng `users` | low | Đúng với intent đã chốt: user tạo khi OTP đúng, từ chối thì đăng xuất. Xóa thêm là đổi intent | reject |
| 6 | blind | Không dọn `verifications` (identifier chứa email rõ) và `otp_send_events` | medium | `disableCleanup: true` và không có job nào thay; email của người chỉ xin mã, chưa từng đăng nhập, bị giữ mãi | patch P4 |
| 7 | blind | pino-http log IP/User-Agent dạng rõ | medium | Serializer mặc định của pino-http có từ Story 1.1; story này chỉ khai báo hai cột đó là PII | defer |
| 8 | blind | Thêm `name` vào PII làm che mọi khóa `name` trong log | low | Cơ chế redact theo tên khóa trần có từ 1.1. Hậu quả: log job pg-boss (có `name`) ở Epic 3 bị che tên queue | defer |
| 9 | blind | `Secure` theo `NODE_ENV` chứ không theo HTTPS; secret mẫu dùng được ở production | medium | `auth.ts` đặt `useSecureCookies: NODE_ENV==='production'`: staging chạy HTTPS mà NODE_ENV khác thì thiếu `Secure`. Phần secret mẫu là low, sửa phải thêm kiểm tra | patch P5 |
| 10 | blind | Thiếu kiểm tra chéo `WEB_ORIGIN`/`API_PUBLIC_URL`/cookie domain | low | Chỉ gặp khi cấu hình sai lúc deploy; sửa phải thêm `superRefine` | reject |
| 11 | blind | Người biết email có thể khóa nạn nhân bằng cách dùng hết hạn mức gửi | low | Hệ quả của giới hạn theo email mà NFR-6 trong intent yêu cầu | reject |
| 12 | blind | Verify đồng thời gắn sai nhãn `OTP_ATTEMPTS_EXCEEDED` | low | `submitCode` đã chặn gửi trùng (`isPending`, `lastSubmitted`); chỉ xảy ra khi mở hai tab | reject |
| 13 | blind | SMTP lỗi làm mã cũ mất hiệu lực (rotate trước khi gửi) | low | Người dùng thấy 503 rồi gửi lại; lần đó không bị tính vào giới hạn. Sửa phải chụp lại và khôi phục bản ghi | reject |
| 14 | blind | UI gửi lại không theo cooldown sau 429 | low | Lỗi 429 vẫn hiện "Thử lại sau n phút"; hiếm khi sai đủ 5 lần trong vòng 60 giây | reject |
| 15 | blind | Chuyển sang màn đồng ý bằng `push` nên bấm Back bị lặp | low | `providers.tsx` dùng `routerRef.current.push`; đổi sang `replace` | patch P6 |
| 16 | blind | Hằng số lặp ở nhiều nơi (5 phút / 300 giây, 60 giây, `\d{6}`) | low | Đổi `OTP_RESEND_AFTER_SECONDS` trong contracts thì đếm ngược của UI lệch với cooldown của server | patch P7 |
| 17 | blind | Transport SMTP thật và luồng cookie web↔api thật chưa có test | medium | Phần SMTP trùng #22. Phần cookie e2e là low: smoke test local đã kiểm | patch P8 |
| 18 | blind | CSRF cho `consent`/`sign-out` chỉ dựa vào SameSite | low | `SameSite=Lax` chặn POST cross-site; subdomain anh em đều do Tickee kiểm soát | reject |
| 19 | verif | Chỉ 2/9 đường dẫn bị chặn có test | gap | Đã kiểm trước theo đánh giá của lớp verif | patch P3 |
| 20 | verif | Cookie production (`Secure`, `Domain`) chưa có test | gap | Đã kiểm trước | patch P5 |
| 21 | verif | Advisory lock theo email chưa có test đồng thời | gap | Đã kiểm trước | patch P2 |
| 22 | verif | `SmtpEmailTransport` chưa được chạy trong test | gap | Đã kiểm trước | patch P8 |
| 23 | verif | Backspace của `OtpInput` chưa có test | gap | Đã kiểm trước | patch P9 |
| 24 | verif | Không có `trust proxy` (trùng #1) | medium | Như #1 | patch P1 |
| 25 | verif | `SessionGuard` trả 500 khi `getSession` ném `APIError` | low | `session.mjs` ném UNAUTHORIZED khi gia hạn trúng session đã xóa; `ErrorFilter` biến lỗi không phải `AppError` thành 500 | patch P10 |
| 26 | edge | `trust proxy` (trùng #1) | medium | Như #1 | patch P1 |
| 27 | edge | Lock IP (trùng #2) | low | Như #2 | patch P2 |
| 28 | edge | IPv6 xoay trong /64 vượt giới hạn IP | low | Sửa phải thêm nhánh cắt prefix; giới hạn theo email vẫn còn | reject |
| 29 | edge | Rotate trước khi gửi rồi SMTP lỗi (trùng #13) | low | Như #13 | reject |
| 30 | edge | `release` ném lỗi che mất lỗi gốc | low | Chỉ xảy ra khi DB lỗi ngay giữa request | reject |
| 31 | edge | `DrizzleQueryError` có params (email, token) bị log khi 5xx | medium | `error.filter.ts:40,48` log `err` nguyên vẹn; filter có từ Story 1.1 | defer |
| 32 | edge | `APIError` không map (getSession, mã OTP lạ) thành 500 | low | Cùng gốc với #25 | patch P10 |
| 33 | edge | 23505 khi resend chạy song song với verify sai | maybe-false | Cần biết `atomicVerifyOTP` có insert lại hay không; dù đúng cũng chỉ low | reject |
| 34 | edge | Verify đồng thời gắn sai nhãn (trùng #12) | low | Như #12 | reject |
| 35 | edge | Không dọn bản ghi (trùng #6) | medium | Như #6 | patch P4 |
| 36 | edge | Lọt consent qua `/v1/auth/*` (trùng #3) | medium | Như #3 | patch P3 |
| 37 | edge | `Secure` nên theo HTTPS (trùng #9) | medium | Như #9 | patch P5 |
| 38 | edge | `AUTH_COOKIE_DOMAIN` không phải miền cha của api | low | Như #10 | reject |
| 39 | edge | `@Roles`/`@OrgRoles` bị bỏ qua vì đã tắt `AuthGuard` | false | Không handler nào dùng các decorator này; vai trò của Tickee làm theo AD-26 | reject |
| 40 | edge | Đăng nhập lại khi đang có session thì session cũ vẫn còn | low | Session cũ vẫn là của chính người dùng đó; hết hạn sau 7 ngày | reject |
| 41 | edge | `returnTo` `/..//evil.com` qua `withNotice` thành `//evil.com` (open redirect) | medium | `node`: `new URL('/..//evil.com', base).pathname === '//evil.com'`; `withNotice` trả `'//evil.com?notice=…'` cho `router.replace` | patch P11 |
| 42 | edge | `/dang-nhap/` có `/` cuối lọt kiểm tra vòng lặp | low | Hiếm; người dùng chỉ phải đăng nhập thêm một lần | reject |
| 43 | edge | Bấm "Đổi email" khi đang gửi lại thì UI nhảy lại bước mã | low | Cửa sổ thời gian rất hẹp | reject |
| 44 | edge | Từ chối → `clear()` refetch `me` → 401 có thể chuyển sang màn đăng nhập | maybe-false | e2e "Không đồng ý" pass trên hai project; cần chạy ở mạng chậm để biết; dù đúng chỉ low | reject |
| 45 | edge | Đăng xuất lỗi mạng mà không báo gì | low | Hiếm; sửa phải thêm nhánh `onError` | reject |
| 46 | edge | `me` lỗi 5xx thì hiện "Đăng nhập" | low | Hiếm; người dùng tải lại là hết | reject |
| 47 | edge | Log IP/UA của pino-http (trùng #7) | medium | Như #7 | defer |
| 48 | edge | `sendVerificationOTP` không truyền `headers` | false | Không có hook Better Auth nào cần request context lúc gửi; `returnHeaders` chỉ cần cho lời gọi set cookie | reject |

## Design Notes

Lý do bọc thay vì cho web gọi thẳng Better Auth: giới hạn theo email cần đếm *trước* khi plugin tạo mã. Nếu chặn trong `sendVerificationOTP` thì mã cũ đã bị rotate rồi. Bọc như vậy cũng giữ một dạng lỗi `{ error: { code, message, details } }` cho toàn API. Handler Better Auth vẫn mount ở `/v1/auth/*` để Story 1.4 dùng callback Google và `get-session`.

Quyết định: session theo mặc định Better Auth (7 ngày, gia hạn khi dùng); `users.name` để rỗng; email chuẩn hóa chữ thường trước khi HMAC.

## Verification

**Commands:**
- `docker compose up -d && pnpm turbo build typecheck lint:deps` -- expected: thành công.
- `pnpm --filter @tickee/api test` -- expected: test identity pass trên Postgres thật.
- `pnpm --filter @tickee/web test && pnpm --filter @tickee/web test:e2e` -- expected: pass cả hai project.

**Manual checks (if no CLI):**
- Chạy local, đăng nhập bằng mã từ Mailpit ở light và dark; thử dán mã trên Safari iOS giả lập; mở DevTools xác nhận cookie `HttpOnly`, `SameSite=Lax`.
