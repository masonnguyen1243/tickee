---
title: 'Epic 1 AI-2: Làm chắc endpoint bắt đầu đăng nhập Google'
type: 'bugfix'
created: '2026-10-29'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '5f957032edba5f6baffe41bf483a2eb6ee35dd81'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-retro-2026-10-29.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-4-dang-nhap-bang-google.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `GET /v1/identity/google` là điều hướng cả trang, nhưng mọi lỗi ở đây đi qua `ErrorFilter` và hiện JSON 500 thô trên host api (retro C2). Endpoint không giới hạn tần suất, mỗi lần gọi ghi một dòng `verifications`, còn việc dọn rác chỉ chạy bên trong transaction gửi OTP khi đang giữ advisory lock (C3, B3).

**Approach:** Endpoint bắt mọi lỗi rồi 302 về `/dang-nhap?error=…` (giữ `returnTo`). Thêm giới hạn theo IP, đếm trong Postgres trước khi Better Auth ghi `verifications`. Chuyển việc dọn rác của `identity` ra khỏi `OtpRateLimiter.consume` sang một job định kỳ pg-boss chạy ở vai `worker`.

## Boundaries & Constraints

**Always:**
- Giới hạn bắt đầu Google: **60 lần mỗi giờ** mỗi IP, cửa sổ trượt 1 giờ (Mason chốt 2026-10-29: tránh chặn oan Wi-Fi dùng chung; vẫn chặn spam `verifications`). IP lấy như `sendOtp` (`req.ip`, theo `TRUST_PROXY_HOPS`). Chỉ lưu HMAC của IP. Đếm và ghi trong một transaction khóa `pg_advisory_xact_lock` theo IP.
- Bị giới hạn thì không gọi `signInSocial` (không ghi `verifications`, không đặt cookie state).
- Mã lỗi mới nằm trong `GoogleSignInError` ở `packages/contracts`: `rate_limited`, `start_failed`. Mọi 302 lỗi dùng `Cache-Control: no-store`, `returnTo` đã qua `safeReturnTo` (mặc định `/` thì bỏ).
- Log lỗi khởi động chỉ ghi tên lớp lỗi và `code` (nếu có), không ghi `message` hay params (theo hướng AI-1).
- Job dọn rác: tên queue khai báo trong `packages/contracts`, lịch pg-boss mỗi 10 phút, chỉ đăng ký ở vai `worker`. Giữ nguyên ngưỡng giữ dữ liệu hiện tại của `purgeExpired` và thêm bảng mới (xóa sau 1 giờ). Handler idempotent.
- Web: `rate_limited` hiện banner `warning` "Bạn đã thử đăng nhập Google quá nhiều lần. Vui lòng thử lại sau hoặc dùng mã qua email."; `start_failed` dùng banner lỗi chung có sẵn.

**Never:**
- Không bật `rateLimit` hay bỏ `verification.disableCleanup` của Better Auth (cần giữ verification vừa hết hạn cho `OTP_EXPIRED`).
- Không đổi giới hạn OTP, không đụng callback `/v1/auth/callback/google`, không sửa log PII ngoài endpoint này (AI-1), không tách `auth.ts` (AI-5).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bình thường | IP chưa chạm ngưỡng | 302 sang Google như hiện nay, ghi một dòng `google_start_events` | N/A |
| Chạm ngưỡng | IP đã đủ số lần trong cửa sổ | 302 `/dang-nhap?error=rate_limited&returnTo=…`; không thêm `verifications` | Không log lỗi |
| IP khác | IP B khi IP A bị chặn | Vẫn 302 sang Google | N/A |
| Lỗi khi bắt đầu | `signInSocial` hoặc DB ném lỗi | 302 `/dang-nhap?error=start_failed&returnTo=…`, không có JSON | Log `{ errName, code }` mức error |
| Gửi OTP | Có rác hết hạn | `consume` không còn xóa gì | N/A |
| Job chạy | Rác cũ và dòng còn hạn | Rác cũ bị xóa, dòng còn hạn còn nguyên | pg-boss retry |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/identity/identity.controller.ts:44-57` -- `google()`: bọc try/catch, kiểm giới hạn trước `startGoogleSignIn`, dựng URL lỗi từ `WEB_ORIGIN` + `LOGIN_PATH`.
- `apps/api/src/modules/identity/identity.service.ts:60-76` -- `startGoogleSignIn`: thêm tham số `ip`, gọi limiter trước Better Auth; tái dùng cách dựng `query` cho `returnTo`.
- `apps/api/src/modules/identity/otp-rate-limit.ts` -- `OtpRateLimiter`: thêm `consumeGoogleStart(ip)` theo mẫu `consume` (advisory lock, `dbNow`, `ipHmac`); bỏ lời gọi `purgeExpired` khỏi `consume` và chuyển hàm dọn sang file janitor. Không đổi tên lớp (AI-5 sẽ tách).
- `apps/api/src/modules/identity/schema.ts` -- thêm bảng `google_start_events (id, ip_hmac, created_at)` + index `(ip_hmac, created_at)`, theo mẫu `otpSendEvents`.
- `apps/api/drizzle/` -- migration 0003 sinh bằng drizzle-kit (bảng mới tự có quyền nhờ default privileges ở 0000).
- `apps/api/src/modules/identity/index.ts` -- xuất module janitor cho `worker.module.ts`.
- `apps/api/src/worker.module.ts` -- import module janitor (chỉ cần `DATABASE` và `BOSS`, không cần config Better Auth).
- `apps/api/src/platform/jobs/jobs.module.ts` -- pg-boss đã start ở `onApplicationBootstrap`; janitor `createQueue` + `schedule` + `work` sau khi boss đã chạy.
- `packages/contracts/src/identity.ts:91-97` -- `GoogleSignInError`; `packages/contracts/src/` thêm `jobs.ts` (tên queue), xuất qua `index.ts`.
- `apps/web/app/(public)/dang-nhap/login-form.tsx:64-71` -- `googleBannerOf`: thêm nhánh `RATE_LIMITED`.
- Test hiện có: `apps/api/test/identity/google-login.test.ts:180-237` (describe bắt đầu), `apps/api/test/worker.test.ts` (mẫu dựng `WorkerModule`), `apps/web/e2e/login-google.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/identity.ts`, `jobs.ts`, `index.ts` -- thêm `RATE_LIMITED`, `START_FAILED`, hằng ngưỡng Google và tên queue `identity.purge-expired`.
- [x] `apps/api/src/modules/identity/schema.ts` + migration 0003 -- bảng `google_start_events`.
- [x] `apps/api/src/modules/identity/otp-rate-limit.ts` -- `consumeGoogleStart`; bỏ dọn rác khỏi `consume`.
- [x] `apps/api/src/modules/identity/identity-janitor.ts` -- module + provider: `purgeExpired(db)` (logic cũ + bảng mới), đăng ký queue, lịch mỗi 10 phút, worker handler.
- [x] `apps/api/src/modules/identity/identity.service.ts`, `identity.controller.ts` -- giới hạn + redirect lỗi theo ma trận.
- [x] `apps/api/src/worker.module.ts`, `modules/identity/index.ts` -- nối janitor vào vai worker.
- [x] `apps/web/app/(public)/dang-nhap/login-form.tsx` -- banner `rate_limited`.
- [x] Test: `google-login.test.ts` (chạm ngưỡng, IP khác, lỗi khởi động → 302 không JSON và log không có message), `identity-janitor.test.ts` mới (xóa rác, giữ dòng còn hạn, lịch được đăng ký), `otp-login.test.ts` (sửa test nào dựa vào việc `consume` dọn rác), `login-google.spec.ts` (banner `rate_limited`).

**Acceptance Criteria:**
- Given vai `api` khởi động, when kiểm lịch pg-boss, then không có lịch nào do `api` đăng ký; vai `worker` đăng ký đúng một lịch `identity.purge-expired`.
- Given có request gửi OTP song song, when `consume` chạy, then transaction không còn câu `DELETE` nào.
- Given bộ test đầy đủ, when chạy CI, then typecheck, dependency-cruiser, Vitest và Playwright đều pass.

## Implementation Notes

- `JobsModule` nay start pg-boss ở `onModuleInit` (trước đây `onApplicationBootstrap`). Nest gọi xong mọi `onModuleInit` rồi mới tới `onApplicationBootstrap`, nên `IdentityJanitor` đăng ký queue/lịch/worker trong `onApplicationBootstrap` mà không phụ thuộc thứ tự mô-đun (`JobsModule` và `IdentityJanitorModule` cùng khoảng cách tới gốc).
- `startGoogleSignIn` trả union `{ ok: true, url, headers } | { ok: false, error: 'rate_limited' }`; chạm ngưỡng là đường bình thường (không ném lỗi, không log). Mọi lỗi ném ra được controller bắt, log `{ errName, code }` (`code` lấy từ thuộc tính `code` hoặc `body.code` của `APIError`) rồi 302 `start_failed`.
- URL lỗi: `${WEB_ORIGIN}/dang-nhap?error=<mã>&returnTo=…` (`googleSignInErrorUrl` trong service, dùng chung cách dựng `returnTo` với `startGoogleSignIn`).
- `consumeGoogleStart` dùng chung khóa HMAC với bộ đếm OTP (`ipHmac`), khóa advisory riêng `google-start-ip:<hmac>`; lần bị chặn không được ghi. Đếm bằng `now()` của Postgres nên không cần `dbNow`.
- `purgeExpired(db)` chạy từng câu `DELETE` riêng (không cần transaction: mỗi câu idempotent). `createQueue`/`schedule` của pg-boss là upsert: khởi động lại worker vẫn chỉ một lịch (có test).
- Test cũ "mỗi lần gửi dọn …" trong `otp-login.test.ts` đổi thành kiểm `consume` không xóa gì; phần kiểm dọn chuyển sang `identity-janitor.test.ts`.
- Kiểm tra (29/10/2026): `pnpm typecheck` 5/5; `pnpm lint:deps` không vi phạm; api 117 test (12 file); web 24; contracts 51; Playwright toàn bộ 87 pass + 1 flaky trên hai project (build với `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001` như CI); flaky là `login.spec.ts:206` "Không đồng ý" đã biết (Triage #25 của 1.4, retro AI-6), không liên quan thay đổi này.

## Spec Change Log

## Review Triage Log

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Hướng xử lý |
|---|-------|-----------|---------|------------|-------------|
| 1 | verification-gap | Advisory lock theo IP của `consumeGoogleStart` không có test song song | medium | Mọi test mới đều gửi tuần tự; bỏ dòng lock thì test vẫn pass | patch |
| 2 | blind, edge | `errorSummary` mất SQLSTATE khi lỗi DB thật bị bọc trong `DrizzleQueryError` | medium | drizzle-orm 0.45.4: `DrizzleQueryError` giữ lỗi pg ở `cause`; test dùng `FakeDbError` có `code` trực tiếp | patch |
| 3 | blind, edge | Lần bắt đầu thất bại (`start_failed`) vẫn tính vào hạn mức của IP | medium | Event được ghi trước `signInSocial` và không bị xóa khi lỗi, khác luồng OTP có `release` | patch |
| 4 | blind, edge | Test janitor để lại lịch `*/10` trong DB test, boss "reader" vẫn bật cron | low | `unschedule` chỉ ở đầu test; `createBoss` mặc định bật schedule, trái comment | patch |
| 5 | verification-gap, blind, edge | Không có vai `worker` thì không còn gì dọn `verifications`/`sessions` (có PII) | medium | Trước đây `api` dọn ở mỗi lần gửi OTP; giờ chỉ `WorkerModule` đăng ký job | defer (checklist Story 4.7) |
| 6 | blind | IPv6: mỗi địa chỉ một bucket, client có cả /64 vượt giới hạn dễ dàng | medium (chưa kiểm) | Giới hạn OTP theo IP cũng như vậy, nên đây là mẫu có từ trước | defer |
| 7 | blind | Test otp-login có thể flaky khi chạy song song với test janitor | false | `vitest.config.ts` đặt `fileParallelism: false` | reject |
| 8 | blind | Queue tạo với option mặc định, purge có thể chạy chồng | false | Lệnh xóa idempotent nên chạy chồng vô hại; pg-boss 12 có retry mặc định | reject |
| 9 | blind, edge | DELETE không chia lô, lần đầu có thể xóa rất nhiều | low | Đến commit này rác vẫn được dọn ở mỗi lần gửi OTP, nên lần đầu ít tồn đọng; chia lô làm phức tạp thêm | reject |
| 10 | blind, edge | Mọi client không có IP dùng chung bucket `'unknown'` | false | Express luôn có `req.ip`/`remoteAddress` cho socket TCP; `sendOtp` cũng dùng fallback này từ trước | reject |
| 11 | blind | Cửa sổ `interval '1 hour'` lặp ở hai chỗ | low | Lệch chỉ xảy ra khi có người sửa một chỗ mà quên chỗ kia | reject |
| 12 | blind | Banner `rate_limited` không báo khi nào thử lại được | low | Câu banner đã chốt trong phần frozen của spec | reject |
| 13 | blind | `googleSignInErrorUrl` nối query bằng `.replace('?', '&')` | low | Chạy đúng và có test, `returnTo` đã qua `encodeURIComponent` | reject |
| 14 | blind | `OtpRateLimiter` giờ lo cả Google nhưng tên vẫn là OTP | low | Chỉ là chuyện đặt tên; AI-5 sẽ tách | reject |
| 15 | blind | Thiếu test cho nhánh không có `url` và handler lỗi; còn sót dòng test | low | Nhánh không có `url` cũng đi qua cùng `catch` đã có test; dòng sót chỉ nằm ở DB test | reject |
| 16 | blind | Diff thiếu spec, meta drizzle; file SQL thiếu newline cuối | false | Cố ý loại khỏi diff review; file SQL do drizzle-kit sinh | reject |
| 17 | edge | `res.redirect` ném lỗi sau `forwardSetCookies` thì cookie state lọt | false | `res.redirect` của Express không ném lỗi trong trường hợp này | reject |
| 18 | edge | Guard toàn cục ném lỗi trước handler vẫn ra JSON | false | Route có `@AllowAnonymous` nên `SessionGuard` return sớm (session.guard.ts:33); `@ConsentExempt` bỏ qua ConsentGuard | reject |

## Verification

**Commands:**
- `pnpm typecheck` -- expected: không lỗi.
- `pnpm --filter @tickee/api test` -- expected: pass, gồm test mới (cần Postgres local).
- `pnpm --filter @tickee/web test:e2e -- login-google` -- expected: pass.
- `pnpm lint:deps` -- expected: không vi phạm AD-10.
