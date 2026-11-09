---
title: 'E2-2: Đăng xuất các session khác khi gỡ 2FA'
type: 'bugfix'
created: '2026-11-09'
status: 'done'
route: 'oneshot'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Dùng mã khôi phục hoặc tắt 2FA đều gỡ TOTP của tài khoản, nhưng các session khác của user vẫn sống. Khi 2FA không còn bật, `TotpGuard` cho mọi session đó qua, kể cả session chưa từng nhập TOTP. Bản vá cùng loại ở review #18 của 2.2 v1 đã mất khi 2.2 được làm lại (retro Epic 2 A2).

**Approach:** Trong chính transaction của `useRecoveryCode` và `disable` (`apps/api/src/modules/identity/totp.service.ts`), xóa mọi session khác của user và chỉ giữ session đang gọi. `reauth_grants` của các session đó tự xóa theo FK cascade. Email báo (dùng mã khôi phục, tắt 2FA) nói rõ các thiết bị khác đã bị đăng xuất. AD-26 ghi thêm luật này. Test API: session khác nhận 401 ở request kế tiếp, session đang gọi vẫn dùng được, kể cả trường hợp session khác đang bị chặn ở bước TOTP.

**Never:** Không đổi luồng bật 2FA (các session khác đã phải nhập TOTP sau khi bật). Không đổi web. Không mô tả kịch bản khai thác trong commit, PR hay tài liệu trong repo.

</frozen-after-approval>

## Implementation Notes

- `TotpStore.revokeOtherSessions(tx, userId, keepSessionToken)` (mới, `totp-store.ts`): xóa dòng `sessions` của user trừ session đang gọi. Better Auth không bật cookie cache nên session bị xóa nhận 401 ở request kế tiếp; `reauth_grants` xóa theo FK cascade.
- `totp.service.ts`: `useRecoveryCode` gọi sau `store.remove`, trước `markStepUp`; `removeTwoFactor` (cả hai nhánh của `disable`) nhận thêm token session giữ lại. Hai lời gọi đều nằm trong transaction sẵn có, nên lỗi sau đó rollback cả việc xóa session.
- `totp-email.ts`: email dùng mã khôi phục và email tắt 2FA thêm câu "mọi thiết bị khác đã bị đăng xuất".
- `totp.test.ts`: test cũ khẳng định session khác vẫn nhận 200 sau khi gỡ 2FA, nay đổi thành 401 `UNAUTHENTICATED`. Có thêm session đang bị chặn ở bước TOTP và chỉ gọi `/v1/identity/me`, kèm kiểm tra `sessions` còn 1 dòng và `reauth_grants` về 0. Kiểm chéo: cho `revokeOtherSessions` không làm gì thì 3 test đỏ.
- `ARCHITECTURE-SPINE.md` AD-26: thêm luật gỡ 2FA thì đăng xuất session khác.
- Không đổi web: tab hay thiết bị khác nhận 401 và đi theo luồng hết phiên sẵn có.
- Sau review: email gỡ 2FA dùng chung lời dặn `SIGNED_OUT_WARNING` (đăng nhập lại, bật lại 2FA, liên hệ hỗ trợ), vì "đăng xuất khỏi mọi thiết bị" không còn làm được. Đã ghi sự phụ thuộc vào việc không bật `cookieCache`/`secondaryStorage` tại `auth.ts`, cập nhật mô tả hai audit action, thêm test tài khoản khác không bị đụng và lần xác nhận lại của session đang gọi còn nguyên (kiểm chéo: bỏ điều kiện `userId` thì 2 test đỏ).

## Verification

- `pnpm --filter @tickee/api test`: 570 test pass. `pnpm --filter @tickee/api typecheck`, `pnpm lint:deps`: sạch.

## Review Triage Log

| # | Phát hiện (Blind Hunter) | Verdict | Bằng chứng / Xử lý |
|---|--------------------------|---------|--------------------|
| 1 | `disable` bằng TOTP không kiểm lại trong `tx`; nếu session giữ lại đã bị xóa (race) thì `ne(token)` xóa mọi session | low | Có thật nhưng chỉ khi cùng user gỡ 2FA đồng thời từ hai session trong vài ms; hậu quả là đăng xuất hết (an toàn hơn), sửa phải thêm khóa/guard → **reject** |
| 2 | Không test chứng minh chỉ xóa session của chính user | medium | Đúng: mọi assert lọc theo `userId`; bỏ điều kiện thì xóa session toàn hệ thống mà test vẫn xanh → **patch** (thêm tài khoản khác, kiểm chéo đỏ) |
| 3 | Assert `reauth_grants` một chiều; nhánh `disable` không có grant | low | Đúng; sửa chỉ thêm assert → **patch** |
| 4 | Lời dặn "đăng xuất khỏi mọi thiết bị" không còn làm được; docblock email cũ; email nói đã đăng xuất kể cả khi không có thiết bị nào | low | Đúng → **patch** (`SIGNED_OUT_WARNING`, thêm "(nếu có)", sửa docblock) |
| 5 | Web/EXPERIENCE.md không báo trước việc đăng xuất thiết bị khác | low | Intent loại trừ đổi web → **defer** (`deferred-work.md`) |
| 6 | Phụ thuộc việc không bật `cookieCache` mà không ghi ở code | low | Đúng; sửa là thêm comment → **patch** |
| 7 | Mô tả audit action chưa nói việc đăng xuất | low | Đúng → **patch** (mô tả); ghi số session bị xóa → reject (thêm trường, không ai đọc) |
| 8 | sprint-status và trạng thái spec chưa cập nhật | false | Làm ở bước chốt spec, ngay sau review |
| 9 | Dùng mã khôi phục để 2FA về tắt, chỉ còn email bảo vệ | false | Hành vi thiết kế của 2.2 (UX ghi "chỉ còn được bảo vệ bằng email"), không thuộc A2 |
| 10 | Docblock `useRecoveryCode`/`disable` ngắt dòng lệch | low | Đúng, sửa trực tiếp → **patch** |
