---
title: 'E2-1: Xác nhận lại khi bật 2FA và admin:grant đòi 2FA'
type: 'bugfix'
created: '2026-11-09'
status: 'done'
baseline_commit: '67699ae102a7da1fea93b7059b6cace6ac685458'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-retro-2026-11-09.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Bật 2FA đổi cách xác nhận lại của tài khoản sang TOTP, nhưng chính việc bật 2FA không đòi xác nhận lại và không gửi email. Vì vậy bằng chứng xác nhận lại của các thao tác nhạy cảm (AD-26) yếu hơn thiết kế. Ngoài ra `admin:grant` cấp `platform_admin` cho tài khoản chưa bật 2FA, trái AD-26 "Quản trị Tingee: bắt buộc đã bật 2FA" (retro Epic 2 A1, A3).

**Approach:** Bắt đầu đăng ký TOTP khi 2FA đang tắt phải tiêu một lần xác nhận lại (OTP email) như mọi thao tác nhạy cảm. Bật xong gửi email "2FA vừa được bật". `admin:grant` từ chối tài khoản chưa bật 2FA. Bổ sung luật này vào AD-26.

## Boundaries & Constraints

**Always:**
- Dùng `consumeReauth` có sẵn trong transaction của thao tác. Thiếu, hết hạn hoặc đã dùng → 403 `REAUTH_REQUIRED` `{method: email_otp}`.
- Web dùng `withReauth` có sẵn, không viết dialog mới.
- Email gửi sau khi commit, lỗi gửi chỉ ghi log (theo mẫu `notify`).
- `admin:revoke` không đổi.

**Never:**
- Không đụng việc hủy session khi dùng mã khôi phục hoặc tắt 2FA (đó là E2-2).
- Không mô tả kịch bản khai thác trong commit, PR hay tài liệu trong repo.
- Không mở lại endpoint HTTP gốc của plugin `twoFactor`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bật 2FA đủ bước | 2FA tắt; `POST /totp/enroll` kèm token xác nhận hợp lệ của session này → `enroll/verify` mã đúng | 200, 10 mã khôi phục; token bị tiêu; email "2FA vừa được bật" gửi tới tài khoản; audit `totp.enrolled` | Gửi email lỗi → vẫn 200, chỉ log |
| Thiếu xác nhận | `enroll` không header, hoặc token đã dùng, hết hạn hay của session khác | 403 `REAUTH_REQUIRED` `{method: email_otp}`; không tạo secret | — |
| Verify khi chưa bắt đầu | `enroll/verify` khi chưa có `enroll` thành công | 409 như hiện tại, 2FA vẫn tắt | — |
| Đã bật 2FA | `enroll` khi 2FA đang bật | 409 `alreadyEnabled` như hiện tại (kiểm trước khi đòi xác nhận) | — |
| admin:grant chưa 2FA | target `two_factor_enabled=false` | Exit ≠ 0, thông báo cần bật 2FA trước; không đổi cờ, không audit | — |
| admin:grant đã 2FA | target đã bật 2FA | Như hiện tại | — |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/identity/totp.service.ts` -- `beginEnrollment` (dòng 84) thêm tiêu xác nhận; `confirmEnrollment` (94-122) thêm `notify` email bật; mẫu `notify` ở cuối file.
- `apps/api/src/modules/identity/totp.controller.ts` -- `enroll` đọc header `REAUTH_HEADER` và dựng proof bằng `reauthProof(req, …)` (xem cách controller organizer đọc header).
- `apps/api/src/modules/identity/reauth.service.ts` -- `consumeReauth(tx, {userId, sessionId, token})`: tái dùng, không sửa.
- `apps/api/src/modules/identity/totp-email.ts` -- thêm `buildTotpEnabledEmail()` theo mẫu `buildTotpDisabledEmail`.
- `apps/api/src/modules/identity/user-directory.ts` -- `setPlatformAdmin`/`findUserIdByEmail`; thêm hàm đọc `two_factor_enabled` (hoặc trả kèm) cho CLI.
- `apps/api/src/roles/admin-cli.ts:110-140` -- nhánh `grant`: kiểm 2FA của target trong cùng `tx`, thêm `status: 'no_2fa'`.
- `apps/api/test/identity/harness.ts:193` -- `enrollTotp` phải lấy `reauthToken(h, user)` (đường email) rồi gửi header ở `enroll`.
- `apps/api/test/identity/totp.test.ts`, `apps/api/test/roles.process.test.ts` -- test mới; fixture grant phải bật 2FA cho target (cập nhật `users.two_factor_enabled` trực tiếp hoặc `signUpWithTotp`).
- `apps/web/app/(public)/bao-mat/totp/enroll-form.tsx:242` -- `begin` mutation bọc `withReauth`; `apps/web/lib/auth/totp.ts:22` -- `beginTotpEnrollment(reauthToken?)` dùng `withReauthHeader`.
- `apps/web/e2e/totp.spec.ts` -- mock `/identity/totp/enroll` trả `REAUTH_REQUIRED` khi thiếu header; thêm mock `/identity/reauth*`.
- `_bmad-output/planning-artifacts/architecture/architecture-tickee-2026-10-28/ARCHITECTURE-SPINE.md:302` -- AD-26: thêm "bật 2FA" vào danh sách thao tác cần xác nhận lại, kèm email báo.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/modules/identity/totp-email.ts` -- thêm `buildTotpEnabledEmail` -- báo chủ tài khoản.
- [x] `apps/api/src/modules/identity/totp.controller.ts`, `totp.service.ts` -- `beginEnrollment` nhận proof; sau `isEnabled` thì mở tx `consumeReauth` rồi mới gọi `store.beginEnrollment` (lỗi plugin → rollback, token còn dùng được); `confirmEnrollment` gửi email sau commit -- cổng xác nhận lại trước khi có secret.
- [x] `apps/api/src/modules/identity/user-directory.ts`, `apps/api/src/roles/admin-cli.ts` -- grant từ chối target chưa bật 2FA -- AD-26.
- [x] `apps/api/test/identity/harness.ts`, `totp.test.ts`, `apps/api/test/roles.process.test.ts` -- cập nhật helper; test các dòng I/O Matrix; test chuỗi: tài khoản chưa 2FA bị chặn bật TOTP khi không có xác nhận, nên không có cách nào lấy được grant TOTP mà không qua OTP email -- chứng minh lỗ đã đóng.
- [x] `apps/web/lib/auth/totp.ts`, `enroll-form.tsx`, `apps/web/e2e/totp.spec.ts` -- `withReauth` cho bước bắt đầu; e2e thấy dialog xác nhận rồi QR -- UX.
- [x] `ARCHITECTURE-SPINE.md` AD-26 -- cập nhật luật.

**Acceptance Criteria:**
- Given tài khoản chưa bật 2FA và session không có lần xác nhận, when gọi `enroll` rồi `enroll/verify`, then 2FA vẫn tắt và `POST /identity/reauth` vẫn đòi mã email.
- Given đang ở trang bật 2FA trên web, when bấm bắt đầu, then dialog "Xác nhận để tiếp tục" mở; nhập mã email đúng thì hiện QR mà không phải bấm lại.
- Given toàn bộ test API/web, when chạy, then xanh (kể cả các test dùng `enrollTotp`).

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Nguồn | Phát hiện | Verdict | Bằng chứng / Xử lý |
|---|-------|-----------|---------|--------------------|
| 1 | edge, blind | Docstring `beginEnrollment` nói "cùng transaction với việc sinh secret" | low | Đúng: `enableTwoFactor` ghi `two_factors` trên connection riêng, chỉ việc tiêu grant nằm trong `tx`. Sửa comment → **patch** |
| 2 | edge, blind | Giữ `tx` (và connection) trong lúc gọi plugin → cạn pool khi nhiều enroll đồng thời | low | Cần ≥10 enroll đồng thời, mỗi cái đã qua OTP email; không gặp khi dùng thường, sửa phải thêm bước bù → **reject** |
| 3 | edge | Commit lỗi sau khi plugin sinh secret → secret chờ mồ côi | low | Secret không trả cho ai, verify lại cần secret đó → vô hại; **reject** |
| 4 | edge | `admin:grant` race: target tắt 2FA giữa lúc kiểm và lúc set | low | Cửa sổ vài ms trong CLI vận hành tay; sửa phải thêm khóa/điều kiện → **reject** |
| 5 | edge, verif | Bấm "Tạo mã mới" rồi đóng dialog → QR cũ biến mất | low | Spec chấp nhận "bắt đầu lại cần xác nhận lại"; banner cho thử lại → **reject** |
| 6 | verif | Không test email "bật 2FA" không gửi khi verify lỗi/rollback | low | Đúng: test rollback và mã sai không đọc `h.email.sent` → **patch** |
| 7 | blind | Test chuỗi assert yếu (`>=400`, không assert grant cuối) | low | Đúng: 500 cũng qua → **patch** |
| 8 | blind | `two_factors` chờ từ trước deploy verify được không cần xác nhận; secret chờ không có TTL | false | Chưa deploy, không có dữ liệu thật; secret chờ chỉ trả cho session đã xác nhận → **reject** |
| 9 | blind | Chủ thật không có đường khôi phục khi người khác đã bật 2FA | medium | Có sẵn từ trước (retro: "Đặt lại TOTP" chưa có), không do thay đổi này → **defer** |
| 10 | blind | AC nói "khi bấm bắt đầu" nhưng form tự bắt đầu khi tải trang | low | Tự bắt đầu là hành vi có từ trước; sửa là sửa spec → **reject** |
| 11 | blind | Test tự tính hash `token_hash` bằng SQL | low | Chỉ ảnh hưởng dev khi đổi cách hash; sửa không đơn giản → **reject** |
| 12 | blind | `hasTwoFactorEnabled` là bản thứ ba của cùng truy vấn | low | Trùng 1 dòng select, chưa gây lệch → **reject** |
| 13 | blind | Thiếu unit test web cho header/nhánh banner | low | e2e đã kiểm header `[null,'tok-1']` và banner → **reject** |
| 14 | blind | Spec/test mô tả kịch bản khai thác | false | Spec và comment test chỉ nêu luật, không nêu chuỗi bước tấn công → **reject** |
| 15 | blind | Spec ở trạng thái lệch (log trống, số dòng cũ) | false | Log được điền ở bước này; sửa là sửa spec → **reject** |

## Design Notes

Tiêu xác nhận ở `enroll` (bắt đầu), không ở `enroll/verify`: khi verify đúng, Better Auth tạo session mới và xóa session cũ (`two-factor/totp/index.mjs:180`), mà `reauth_grants.session_id` cascade theo session — grant biến mất trước khi Tickee kịp tiêu, còn tiêu trước verify thì mã TOTP sai làm mất lần xác nhận. Gác ở bước bắt đầu là đủ: secret đang chờ chỉ sinh ở `enroll` (plugin endpoint bị cổng HTTP chặn) và chỉ trả cho session đã xác nhận. Hệ quả UX: dialog xác nhận hiện trước QR; bắt đầu lại đăng ký cần xác nhận lại.

## Verification

**Commands:**
- `pnpm --filter @tickee/api test` -- expected: xanh.
- `pnpm --filter @tickee/web test && pnpm --filter @tickee/web test:e2e -- totp` -- expected: xanh.
- `pnpm typecheck` -- expected: không lỗi.
