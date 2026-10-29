---
title: 'Story 1.4: Đăng nhập bằng Google'
type: 'feature'
created: '2026-10-29'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'c9ad478b833d0fccf86c4dca644df7803f3c0be0'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-3-dang-nhap-bang-otp-qua-email.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Hiện Tickee chỉ đăng nhập được bằng OTP email, nên người mua phải chờ email về mới vào được. Trên màn đăng nhập đã có sẵn chỗ (`alternativeSignIn`, phía trên `Separator` "hoặc") cho nút Google.

**Approach:** Bật `socialProviders.google` của Better Auth trong `identity`. API thêm endpoint `GET /v1/identity/google`: endpoint này kiểm `returnTo` rồi gọi `auth.api.signInSocial`, chuyển tiếp cookie state và trả 302 sang Google. Từ ngoài chỉ mở đúng một đường dẫn của Better Auth là `GET /v1/auth/callback/google`. Sau khi đăng nhập xong, Google quay về trang trung gian `/dang-nhap/google` trên web. Trang này đọc `me` rồi chuyển sang màn đồng ý NĐ 13 nếu tài khoản chưa đồng ý, còn không thì về `returnTo`. Nếu có lỗi, Google quay về `/dang-nhap?error=…`.

## Boundaries & Constraints

**Always:**
- Cùng một email (đã đưa về chữ thường) luôn là một user. Đặt `account.accountLinking.enabled: true` và `trustedProviders: []`, giữ `requireLocalEmailVerified` mặc định (user OTP luôn có `emailVerified = true`).
- Google trả `email_verified = false` thì `user.validateUserInfo` trả `{ error: 'email_not_verified' }` trước khi tạo hay nối tài khoản: không có dòng `users`, `accounts` hay `sessions` nào được ghi.
- `returnTo` được kiểm ở API bằng cùng hàm `safeReturnTo` với web; hàm này chuyển sang `packages/contracts`. `callbackURL`, `errorCallbackURL` và `newUserCallbackURL` đều là URL tuyệt đối trên `WEB_ORIGIN` do server tự dựng, không nhận URL từ client.
- Không lưu token của Google: `accounts.access_token`, `refresh_token` và `id_token` luôn là null (dùng `databaseHooks.account.create/update.before`). `users.name` lấy theo Google; `users.image` để null.
- Cookie session của luồng Google dùng chung cấu hình với OTP (prefix `tickee`, `HttpOnly`, `SameSite=Lax`, `Secure` theo HTTPS, domain cha).
- Nút `google-signin-button`: dùng `button-secondary` rộng toàn chiều, logo "G" bốn màu theo brand guideline của Google ở bên trái, chữ "Tiếp tục với Google". Nút là một `<a>` để điều hướng cả trang; sau khi bấm thì hiện spinner và chặn bấm lặp.
- Các trường hợp lỗi ở màn đăng nhập theo bảng dưới. Sau khi hiện lỗi thì xóa tham số `error` khỏi URL.

**Never:**
- Không mở thêm đường dẫn nào của `/v1/auth/*` ngoài callback Google; `sign-in/social` và `get-session` vẫn trả 404.
- Không dùng `trustedProviders: ['google']`, vì như vậy sẽ bỏ qua `email_verified`.
- Không dùng Google One Tap và không xin scope ngoài `openid email profile`. Không làm TOTP (Epic 2).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bắt đầu | `GET /v1/identity/google?returnTo=/su-kien/a` | 302 tới `accounts.google.com`, có `Set-Cookie` state | `returnTo` sai thì dùng `/` |
| Email mới, đã xác minh | callback thành công | tạo user + account `google`, set cookie, chuyển về `/dang-nhap/google?returnTo=…` rồi tới `/dong-y` | — |
| Email đã có từ OTP | như trên | nối account vào user cũ, không tạo user mới; đã đồng ý thì về thẳng `returnTo` | — |
| Google trước, OTP sau | OTP với cùng email | vẫn là user đó (Better Auth `findUserByEmail`) | — |
| `email_verified = false` | callback | `/dang-nhap?error=email_not_verified&returnTo=…`, DB không đổi | `status-banner` cảnh báo: "Email Google chưa được xác minh. Hãy dùng mã qua email." |
| Hủy trên Google | `error=access_denied` | ở lại `/dang-nhap`, giữ `returnTo` | không hiện thông báo |
| Lỗi khác (`state_mismatch`, `invalid_code`…) | callback | `/dang-nhap?error=<mã>` | `status-banner` lỗi: "Chưa đăng nhập được bằng Google. Thử lại hoặc dùng mã qua email." |
| Trang trung gian khi chưa có session | `me` trả 401 | về `/dang-nhap?returnTo=…` | — |

**Quyết định (29/10/2026):**
- `GOOGLE_CLIENT_ID` và `GOOGLE_CLIENT_SECRET` **bắt buộc** với vai `api`: thiếu thì dừng ngay khi khởi động, chỉ nêu tên biến, không in giá trị. Test và CI dùng giá trị giả. `.env.example` và README hướng dẫn tạo OAuth client với redirect URI `http://localhost:3001/v1/auth/callback/google`.
- Giữ cả story trong một spec (khoảng 3.000 token).
- Mason chưa có OAuth client Google. Trong lúc build chỉ kiểm bằng test có token endpoint giả. AC chạy với Google thật để Mason tự kiểm sau, ghi rõ là chưa kiểm.

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/identity/auth.ts` -- `createAuth` (L90–141): thêm `socialProviders.google`, `account.accountLinking`, `user.validateUserInfo`, `databaseHooks.account`. `AUTH_HTTP_ALLOWLIST` (L26) thêm `'/callback/google'`; `isAuthHttpPathAllowed` (L33) so khớp chính xác pathname, bỏ qua query.
- `apps/api/src/modules/identity/{identity.controller,identity.service,cookies}.ts` -- thêm handler `@AllowAnonymous` `GET google`. Gọi `auth.api.signInSocial({ body: { provider, callbackURL, errorCallbackURL, newUserCallbackURL, disableRedirect: true }, headers, returnHeaders: true })`, dùng `forwardSetCookies` rồi `res.redirect(302, url)`. Lời gọi server-side bỏ qua `originCheck`, nên phải tự dựng URL.
- `apps/api/src/modules/identity/identity.config.ts`, `platform/config/config.schema.ts` (`apiConfigSchema` L40–62) -- thêm biến Google.
- `apps/api/test/identity/harness.ts` (`createHarness(overrides)`), `otp-login.test.ts` -- test `ranh giới HTTP` (L556) duyệt mọi `api[*].path` và đòi 404: phải loại `/callback/:id` và thêm test riêng. Test `isAuthHttpPathAllowed` ở L582.
- Better Auth 1.7.14 (đã đọc mã nguồn):
  - Callback ở `api/routes/callback.mjs`. Lỗi đưa ra dạng `?error=<code>` trên `errorURL`; hủy thì là `access_denied`.
  - State được lưu thành dòng `verifications` `auth-state:<state>` cùng cookie `tickee.state` sống 300 giây.
  - `getUserInfo` chỉ giải mã `id_token` lấy từ lần đổi code. Vì vậy test có thể chặn `fetch` tới `oauth2.googleapis.com/token` và trả về một `id_token` không ký.
- `packages/contracts/src/identity.ts` -- nơi đặt `safeReturnTo` và hằng `LOGIN_PATH`/`CONSENT_PATH`. Web `lib/auth/return-to.ts` re-export, giữ `withReturnTo` và `withNotice`.
- `apps/web/app/(public)/dang-nhap/{page,login-form}.tsx` -- `page.tsx` đọc `searchParams`. Prop `alternativeSignIn` (L86–97) render phía trên `Separator` (L185–191).
- `apps/web/lib/api/client.ts` -- `apiBaseUrl()` (L12) là hàm private, đã gồm `/v1`; export ra để dựng `href`.
- `apps/web/components/ui/button.tsx` (`buttonVariants`, `loading`), `components/tickee/status-banner.tsx` -- dùng lại.
- `apps/web/e2e/login.spec.ts` -- `mockIdentityApi(page, handlers)` (L27) cùng các helper `me()` và `unauthenticated`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{identity,index}.ts` + test -- chuyển `safeReturnTo` vào đây, đổi luật thành từ chối mọi đường dẫn dưới `/dang-nhap` và `/dong-y`, test của web đi theo. Thêm `GoogleSignInError` (`access_denied`, `email_not_verified`) để web phân loại.
- [x] `apps/api/src/platform/config/config.schema.ts`, `identity.config.ts`, `.env.example`, `README.md` -- thêm `GOOGLE_CLIENT_ID` và `GOOGLE_CLIENT_SECRET` (bắt buộc), giá trị giả cho test/CI. Ghi cách tạo OAuth client và redirect URI.
- [x] `apps/api/src/modules/identity/auth.ts` -- cấu hình theo Always; allowlist chỉ có `/callback/google`.
- [x] `apps/api/src/modules/identity/identity.{controller,service}.ts` -- `GET /v1/identity/google`.
- [x] `apps/api/test/identity/google-login.test.ts` -- Postgres thật, chặn `fetch` tới token endpoint của Google. Đi đủ start → callback cho mọi dòng phía API của matrix. Kiểm: số user, `accounts.provider_id`, token là null, cookie `HttpOnly` + `SameSite=Lax`, không ghi DB khi email chưa xác minh, state sai thì có `error`, `returnTo` độc hại thì thành `/`. Sửa test `ranh giới HTTP`.
- [x] `apps/web/components/tickee/google-signin-button.tsx` -- nút theo Always, `href` = `${apiBaseUrl()}/identity/google?returnTo=…`.
- [x] `apps/web/app/(public)/dang-nhap/{page,login-form}.tsx` -- truyền nút vào `alternativeSignIn`; hiện banner theo `error` rồi xóa tham số.
- [x] `apps/web/app/(public)/dang-nhap/google/page.tsx` -- trang trung gian (spinner, `robots: noindex`). Đọc `me`, đi `replace` sang `/dong-y` hoặc `returnTo`; gặp 401 thì về màn đăng nhập.
- [x] `apps/web/e2e/login-google.spec.ts` -- chạy trên cả hai project:
  - bố cục nút–"hoặc"–ô email và `href` có `returnTo`
  - hủy thì không có banner
  - `email_not_verified` thì có banner
  - trang trung gian đi đúng nhánh chưa đồng ý, đã đồng ý và 401
  - 320px không cuộn ngang

**Acceptance Criteria:**
- Given chạy local với OAuth client Google thật, when bấm "Tiếp tục với Google" bằng một email đã đăng nhập OTP trước đó, then về đúng `returnTo`, và `users` vẫn chỉ có một dòng cho email đó, kèm một dòng `accounts` (`provider_id = 'google'`; đăng nhập OTP không tạo dòng `accounts`).
- Given `pnpm turbo build typecheck lint:deps test` và Playwright, then tất cả pass.
- Given log api trong luồng Google, then không có email, code, state hay token.

## Implementation Notes

- Better Auth kiểm `email_verified` *trước* `validateUserInfo` khi email đã có user (nhánh nối tài khoản) và trả `account_not_linked`. Với cấu hình này mã đó chỉ xảy ra khi Google báo chưa xác minh, nên `hooks.after` của `/callback/:id` đổi nó thành `email_not_verified` (`rewriteUnverifiedLinkError`). Email mới và account Google đã nối thì `validateUserInfo` chặn trực tiếp.
- `onAPIError.errorURL` = `${WEB_ORIGIN}/dang-nhap`: lỗi không gắn được state hợp lệ (state không tồn tại) về màn đăng nhập thay vì `/v1/auth/error` (bị cổng chặn). Cổng HTTP chỉ cho `GET` (POST callback form_post vẫn 404).
- `updateUserInfoOnLink: true` để user OTP nhận `name` của Google khi nối; `mapProfileToUser` bỏ `image`; `includeGrantedScopes: false`. `GET /v1/identity/google` có thêm `@ConsentExempt()` và `Cache-Control: no-store`.
- Request `/v1/auth/*` không đi qua pino-http (handler Better Auth trả lời trước). Để chắc chắn không lộ `code`/`state`, serializer pino-http che giá trị query trong `req.url`, bỏ `req.query` và che header `location`.
- `packages/contracts` thêm lib `DOM` (cho `URL`). `apiBaseUrl()` của web nay đã gồm `/v1`. Mock `/v1/identity/*` của e2e tách ra `e2e/identity-mock.ts` dùng chung.
- e2e bấm nút: điều hướng cả trang còn treo thì Playwright không đọc được DOM, nên test chặn điều hướng bằng listener ở `window` (chạy sau React) và kiểm React có `preventDefault` ở lần bấm thứ hai.
- Kiểm tra (29/10/2026): `pnpm turbo build typecheck lint:deps test --force` 11/11 task (api 108, web 24, contracts 52 test); Playwright 82/82 trên hai project. **Chưa kiểm với Google thật** (AC 1, manual check) — chờ Mason có OAuth client.
- Ghi chú cho AC 1: đăng nhập OTP **không** tạo dòng `accounts` (emailOTP chỉ `createUser`), nên user OTP sau khi nối Google có **một** dòng `accounts` (`provider_id = 'google'`), không phải hai. Câu "kèm hai dòng `accounts`" trong Acceptance Criteria là sai về Better Auth. Khi kiểm tay, đúng là: một dòng `users`, một dòng `accounts` google.
- 29/10/2026: Mason đã kiểm đăng nhập bằng Google thật ở local (OAuth client riêng), thành công (AC 1). Walkthrough xong, Mason duyệt ship.
- Build web cho e2e phải có `NEXT_PUBLIC_API_BASE_URL` lúc build (như CI): thiếu thì `/dang-nhap` không render được vì nút Google gọi `apiBaseUrl()` khi render.

## Spec Change Log

- 2026-10-29 (retro Epic 1, AI-4): AC 1 sửa "kèm hai dòng `accounts`" thành "kèm một dòng `accounts`" (`provider_id = 'google'`). emailOTP chỉ `createUser`, không tạo `accounts` (Implementation Notes, Triage #17).

## Review Triage Log

Lượt 1. Ba lớp: blind (B), edge (E), verification-gap (V). Diff loại `_bmad-output` và `pnpm-lock.yaml`. Route `patch` P1–P9.

| # | Lớp | Finding | Verdict | Bằng chứng | Route |
|---|-----|---------|---------|-----------|-------|
| 1 | V | Nhánh lỗi không phải 401 của `GoogleReturn` chưa có test | gap | Lớp V đã kiểm: không e2e nào mock `me` lỗi khác 401 | patch P1 |
| 2 | V | Reset spinner khi `pageshow` (bfcache) chưa có test | gap | Lớp V đã kiểm | patch P2 |
| 3 | V | Kiểm `href` nút Google không neo, `/v1` lặp hay URL tương đối vẫn pass | gap | Lớp V đã kiểm | patch P3 |
| 4 | V+B | `cache-control: no-store` của endpoint bắt đầu chưa được kiểm | gap | Chỉ có dòng `setHeader` trong controller | patch P4 |
| 5 | V+B | `.env.example` để trống biến Google nên `cp .env.example .env` không chạy được api | medium | Schema `z.string().min(1)`; README quickstart dùng `cp` | patch P5 |
| 6 | B+E | Assertion "không gọi token endpoint" khi hủy có thể rỗng nghĩa | low | better-fetch gọi `fetch(context.url, context)`; file đã có `requestUrl` để chuẩn hóa, sửa một dòng | patch P6 |
| 7 | B+E | `?error` lặp → không banner, tham số còn trên URL | low | `page.tsx` chỉ nhận chuỗi; sửa trực tiếp bằng lấy phần tử đầu | patch P7 |
| 8 | B | Test `GoogleSignInError` trong contracts chỉ so hằng với chính nó | low | Không kiểm gì; sửa bằng xóa | patch P8 |
| 9 | B | Tên test e2e ghi "noindex" mà không kiểm | low | Có test riêng kiểm noindex; sửa tên | patch P9 |
| 10 | B+E | `GET /v1/identity/google` không giới hạn, mỗi lần ghi một dòng `verifications` | low | Dòng `auth-state:*` được `purgeExpired` xóa sau hết hạn + 24 giờ; api chưa có throttle chung (có từ trước); sửa phải thêm limiter | reject |
| 11 | B+E | `rewriteUnverifiedLinkError` gán nhầm `email_not_verified` khi user cục bộ chưa xác minh | low | Hiện không có đường nào tạo user cục bộ `emailVerified = false` (OTP đặt true, Google chưa xác minh bị chặn); sửa phải thêm truy vấn/nhánh | reject |
| 12 | B+E | Lỗi khi bắt đầu (DB sập) trả trang JSON 500 cho điều hướng cả trang | low | Chỉ khi DB lỗi; sửa phải thêm try/catch + mã lỗi mới | reject |
| 13 | E | Hủy điều hướng (Esc) sau khi bấm → spinner treo đến khi tải lại | low | Hiếm trên mobile; sửa phải thêm nhánh focus/timeout | reject |
| 14 | B+E | Thiếu `NEXT_PUBLIC_API_BASE_URL` thì cả `/dang-nhap` không render | false | Biến bắt buộc lúc build (playwright.config, CI, turbo env); trước thay đổi này luồng OTP cũng ném lỗi khi gửi mã; lỗi ồn ào khi cấu hình sai là đúng | reject |
| 15 | E | Cookie state sống 300 giây, bản ghi state 10 phút → ở Google quá 5 phút thì `state_mismatch` | low | `state.mjs:75` `maxAge: 300`; hiếm, sửa phải thêm cấu hình cookie | reject |
| 16 | E | Log test không kiểm secret dạng percent-encoded | false | Secret test là `prefix + hex`, `encodeURIComponent` không đổi giá trị | reject |
| 17 | E | AC "kèm hai dòng `accounts`" sai: OTP không tạo dòng `accounts` | low | `email-otp/routes.mjs` chỉ `createUser`; sửa là sửa spec → ghi vào Implementation Notes | reject |
| 18 | B | Không ẩn được nút Google khi chưa cấu hình | false | Trái quyết định đã chốt (biến Google bắt buộc) | reject |
| 19 | B | Trang trung gian lỗi không có "Thử lại" | low | Đã có link về màn đăng nhập; sửa phải thêm hành động | reject |
| 20 | B | contracts thêm lib `DOM` cho cả gói; `PROBE_ORIGIN` lặp | low | Chỉ ảnh hưởng typecheck của gói contracts; sửa không trực tiếp | reject |
| 21 | B | e2e chờ hydrate qua `__reactProps*`; test assert message nội bộ `'Failed to parse state'` | low | Giòn khi nâng phiên bản; sửa phải thêm marker | reject |
| 22 | B | `updateUserInfoOnLink` ghi đè `users.name` | false | Đúng Always "users.name lấy theo Google"; hiện user OTP có `name` rỗng | reject |
| 23 | B | Nối phương thức đăng nhập mới không có audit/email báo | low | Ngoài AC; audit là của Epic 2; sửa là thêm tính năng | reject |
| 24 | B | README chỉ nói chế độ Testing của Google, thiếu bước publish cho staging/production | low | Deploy thuộc Story 4.7 | reject |
| 25 | verify | e2e `login.spec.ts:224` ("Không đồng ý" + sign-out 401) lỗi lẻ khi chạy lại sau patch | medium | Có từ Story 1.3 (Triage #44); story này không đổi tệp liên quan; khoảng 4 lần lỗi qua ~12 lượt chạy | defer |

Sau patch P1–P9: `pnpm turbo build typecheck lint:deps test --force` (có `NEXT_PUBLIC_API_BASE_URL`) 11/11 task; Playwright 84/84 ba lượt liên tiếp, 419/420 với `--repeat-each=5` (lần lỗi duy nhất là #25).

## Design Notes

Lý do bọc `signInSocial` bằng một endpoint GET riêng thay vì mở `/v1/auth/sign-in/social`:
- Server kiểm được `returnTo` và tự dựng URL quay về, vì lời gọi server-side không chạy `originCheck`.
- Allowlist chỉ mở thêm callback.
- Web chỉ cần một thẻ `<a>`, không phải `fetch` rồi gán `window.location`.

Cookie state được đặt trên domain api qua điều hướng top-level, và Google quay về callback cũng bằng điều hướng GET top-level, nên cookie đi qua được với `SameSite=Lax`.

## Verification

**Commands:**
- `docker compose up -d && pnpm turbo build typecheck lint:deps test --force` -- expected: pass, có test Google mới.
- `pnpm --filter @tickee/web test:e2e` -- expected: pass trên `ios-webkit` và `android-chromium`.

**Manual checks (if no CLI):**
- Chạy local với OAuth client thật và đi ba luồng: email mới, email đã có từ OTP, và hủy trên Google. Xem bảng `users` và `accounts` trong DB.
