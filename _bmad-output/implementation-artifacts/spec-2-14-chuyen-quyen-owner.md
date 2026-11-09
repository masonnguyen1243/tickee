---
title: 'Story 2.14: Chuyển quyền Owner'
type: 'feature'
created: '2026-11-09'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '066b627104bc1091ae3b39ef64bc8b572747eb5e'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Mỗi BTC có đúng một Owner và không có cách đổi người, nên Owner rời CLB hoặc muốn xóa tài khoản (Story 7.6) thì BTC mất người quản lý tài khoản nhận tiền và key Tingee.

**Approach:** Owner chọn một Admin ở trang Thành viên, xác nhận lại (`consumeReauth` của 2.13-a), gõ tên BTC trong `Dialog` nêu hậu quả. Trong một transaction: Owner cũ → `admin`, Admin được chọn → `owner`, audit, enqueue email báo cho cả hai người và mọi Admin còn lại.

## Boundaries & Constraints

**Always:**
- Kiểm quyền trước (`MEMBERS_MANAGE`, Admin → `FORBIDDEN_ROLE`), rồi mới xác nhận lại. Lần xác nhận bị tiêu trong transaction ghi; lỗi sau đó thì rollback, lần xác nhận còn dùng được.
- Thứ tự trong tx: khóa dòng `organizations FOR UPDATE` → `consumeReauth` → hạ Owner cũ (`WHERE user_id = ctx.userId AND role='owner'`, 0 dòng → `FORBIDDEN_ROLE`) → nâng Admin (`WHERE id = :memberId AND role='admin'` trong `orgScope`, 0 dòng → 404 `NOT_FOUND` "Không tìm thấy thành viên.") → audit → enqueue. Hạ trước rồi nâng sau vì unique index `members_one_owner_per_organization_key` không deferrable; không cần migration.
- Audit `member.ownership_transferred`, target `user` = Owner mới, `changedFields: ['role']`, không PII.
- Email là job pg-boss mới enqueue bằng chính `tx`; payload chỉ id (`organizationId`, `previousOwnerUserId`, `newOwnerUserId`); worker đọc tên/email lúc gửi và gửi cho Owner cũ, Owner mới, mọi Admin khác tại thời điểm gửi.
- Gõ tên BTC chỉ kiểm ở web (so khớp chính xác sau trim); server dựa vào xác nhận lại.
- Quyết định đã chốt khi lập spec: (1) Đặt `transferOwnership` trong mô-đun `organizer` (`MembersService`), không ở `flows/`, vì chỉ ghi bảng của `organizer` (AD-25 chỉ đưa ghi chạm nhiều mô-đun vào `flows/`). (2) Trang Thành viên có mục "Chuyển quyền Owner" (chọn Admin + nút), không đặt nút trên từng hàng; không có Admin thì nút tắt kèm "Mời một Admin trước rồi chuyển quyền.". (3) Xong thì toast "Đã chuyển quyền Owner cho {tên}.", làm mới cache vai trò và đưa về `/btc/{orgId}`.

**Never:**
- Không đổi schema `members`, không đụng `tingee_credentials`/`payout_accounts`/sự kiện (thuộc về BTC, không thuộc người).
- Không làm xóa tài khoản hay rời BTC (Story 7.6), không cho Owner tự rời BTC sau khi chuyển.
- Không cache vai ở server (resolver đã đọc DB mỗi request).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Chuyển thành công | Owner, token xác nhận hợp lệ, `POST /v1/orgs/:orgId/members/:memberId/ownership-transfer` | `204`; Owner cũ là `admin`, Admin là `owner`; đúng một Owner; audit; job email | — |
| Thiếu xác nhận | Không header `X-Reauth-Token`, token đã tiêu/quá 5 phút/session khác | Không đổi gì | `403 REAUTH_REQUIRED {method}` |
| Đích không hợp lệ | `memberId` sai định dạng, lạ, của BTC khác, là chính Owner | Không đổi gì, token không bị tiêu | `404 NOT_FOUND` |
| Admin bị xóa giữa chừng | Admin bị xóa sau khi Owner mở Dialog | Không đổi gì, token không bị tiêu | `404 NOT_FOUND`, web làm mới danh sách |
| Hai lần gửi song song | Owner gửi 2 lần (2 tab, 2 token) | Lần sau chờ khóa, thấy mình không còn Owner | `403 FORBIDDEN_ROLE` |
| Admin gọi | Admin gọi route | Không đổi gì | `403 FORBIDDEN_ROLE` |
| BTC không có Admin | Owner mở trang Thành viên | Nút tắt + hướng dẫn | — |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/organizer/schema.ts:46-61` -- bảng `members` (`role` 'owner'|'admin'), partial unique index một Owner; chỉ đọc.
- `apps/api/src/modules/organizer/payout-account.service.ts:606` -- `lockOrganization` private: tách ra helper dùng chung (vd. `organization-lock.ts`, export nội bộ mô-đun), payout-account dùng lại.
- `apps/api/src/modules/organizer/members.service.ts` -- `removeMember` (:193, mẫu `orgScope` + `memberNotFound` + audit); thêm `transferOwnership(ctx, memberId, reauth)`. `members.controller.ts` -- thêm route `POST members/:memberId/ownership-transfer` với `@RequirePermission(Permission.MEMBERS_MANAGE)`, `@HttpCode(204)`, lấy `ReauthProof` như `reauthProof` ở `payout-account.controller.ts:19-25` (tách ra dùng chung nếu tiện).
- `apps/api/src/modules/identity/reauth.service.ts:95` `consumeReauth(tx, {userId, sessionId, token})`, export qua `identity/index.ts`.
- `apps/api/src/platform/audit/audit.ts` -- thêm action `member.ownership_transferred`.
- Email: mẫu `payout-default-jobs.ts` (queue + DEAD_LETTER, zod payload, `enqueue…(boss, tx, payload)`, worker gửi Owner + Admin) và `payout-default-email.ts`. Tạo `ownership-transfer-jobs.ts` + `ownership-transfer-email.ts`; queue mới ở `packages/contracts/src/jobs.ts`; producer vào `organizer.module.ts:46-47`, worker vào `OrganizerJobsModule` (`invitation-jobs.ts:209`).
- `reauth.service.ts:29`, `apps/web/lib/auth/reauth.ts:16`, `packages/contracts/src/identity.ts:249` -- comment "sau này chuyển quyền Owner (2.14)" cần cập nhật.
- Web: `app/(dashboard)/btc/[orgId]/thanh-vien/members-manager.tsx` (`MembersManager` :333, `RemoveDialog` :178 mẫu Dialog); tên BTC từ `CurrentOrganizationProvider`. `lib/organizer/api.ts` thêm `transferOwnership(orgId, memberId, reauthToken?)` dùng `withReauthHeader`; gọi qua `withReauth` (`lib/auth/reauth.ts:134`), mẫu ở `tai-khoan-nhan-tien/payout-account-manager.tsx`. Sau thành công invalidate `organizationQueryKey(orgId)`, `MEMBERSHIPS_QUERY_KEY`, `membersQueryKey(orgId)`.
- Test: `apps/api/test/organizer/members.test.ts`; `reauthToken(h, user)` ở `test/identity/harness.ts:217`; `isolation.test.ts` (danh sách route :51-54 và `reauthRoutes` :124); mẫu job test `payout-default-job.test.ts`; web `e2e/members.spec.ts` + `e2e/organizer-mock.ts`, mẫu reauth ở `e2e/payout-account.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/jobs.ts` -- queue `ORGANIZER_NOTIFY_OWNERSHIP_TRANSFERRED` (+ DEAD_LETTER).
- [x] `apps/api/src/modules/organizer/organization-lock.ts`, `payout-account.service.ts` -- tách `lockOrganization`.
- [x] `apps/api/src/platform/audit/audit.ts` -- action mới.
- [x] `apps/api/src/modules/organizer/ownership-transfer-{jobs,email}.ts`, `organizer.module.ts`, `invitation-jobs.ts` -- job, email ("{tên mới} là Owner mới của {BTC}; {tên cũ} chuyển sang Admin."), đăng ký producer/worker.
- [x] `apps/api/src/modules/organizer/members.{service,controller}.ts` -- `transferOwnership` + route theo matrix.
- [x] Web `lib/organizer/api.ts`, `thanh-vien/members-manager.tsx` -- mục "Chuyển quyền Owner": `Select` Admin + nút; `Dialog` "{tên} sẽ là Owner, quản lý tài khoản nhận tiền và Token. Bạn sẽ thành Admin." + ô gõ tên BTC (nút xác nhận tắt tới khi khớp, có lý do); gửi qua `withReauth`; spinner, lỗi tại chỗ; xong theo quyết định (3).
- [x] Test API: matrix; sau commit đúng một Owner; audit; token không bị tiêu khi 404; job gửi đủ người (Owner cũ, mới, Admin khác) và không gửi cho người đã bị xóa; route mới vào `isolation.test.ts` + `reauthRoutes`.
- [x] `apps/web/e2e/members.spec.ts` -- không Admin thì nút tắt + hướng dẫn; luồng chuyển với mock `REAUTH_REQUIRED`, gõ sai tên thì không gửi được.

**Acceptance Criteria:**
- Given chuyển xong, when Owner cũ mở lại trang Thành viên, then thấy "Chỉ Owner xem được mục này." và mục chỉ Owner bị ẩn.
- Given chuyển xong, when Owner mới gọi các thao tác chỉ Owner (đổi key, mời Admin), then được phép ngay ở request kế tiếp.
- Given Admin, when mở trang Thành viên, then không thấy mục "Chuyển quyền Owner".

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (2026-11-09). Lớp: BH = Blind Hunter, EC = Edge Case Hunter, VG = Verification Gap.

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | BH, EC | Một email lỗi thì cả job retry, người đã nhận bị gửi lại tới 8 lần | low | Có thật ở `notifyOwnershipTransferred`, nhưng là mẫu chung có từ `payout-default-jobs.ts`; sửa cần nhật ký đã gửi hoặc tách job theo người nhận | defer |
| 2 | EC | So khớp tên BTC không chuẩn hóa Unicode (NFC/NFD) | medium | `typed.trim() === organizationName.trim()`; bộ gõ tiếng Việt có thể sinh dạng tổ hợp | patch |
| 3 | EC | Admin đã chọn rời BTC thì ô chọn tự về Admin đầu tiên | low | Ô chọn hiện giá trị mới và Dialog nêu tên người nhận quyền trước khi gửi; sửa phải thêm nhánh | reject |
| 4 | EC, BH | Đóng Dialog do xác nhận lại không xóa tên đã gõ; mở lại thì đã khớp sẵn | low | `onPrompt` chỉ gọi `onClose()`; sửa một dòng `setTyped('')` | patch |
| 5 | EC | Sau xác nhận lại, lỗi hiện bằng toast thay vì tại chỗ | low | Dialog đã đóng khi dialog xác nhận lại mở, giống mẫu 2.13-b | reject |
| 6 | BH | Thao tác chỉ Owner khác không kiểm lại vai trong transaction, có thể commit sau khi đã chuyển | low | Cửa sổ vài ms, cần chính Owner cũ chạy song song; sửa phải đổi guard/khóa chung | reject |
| 7 | BH | Câu hậu quả ở mục, Dialog và email dùng từ khác nhau | low | Câu Dialog lấy nguyên văn AC; mục và email chỉ nói rộng hơn | reject |
| 8 | BH | Email không có thời điểm chuyển | low | Email cảnh báo đổi tài khoản nhận tiền cũng không có; thêm phải đổi payload | reject |
| 9 | BH | Thiếu liên hệ thì tiêu đề "Không rõ là Owner mới…" | low | `userContacts` chỉ thiếu khi tài khoản bị xóa (Story 7.6, chưa có) | reject |
| 10 | BH | Test dead-letter không kiểm job vào queue dead-letter | low | Chỉ kiểm `state` và `retryCount`; thêm một assertion | patch |
| 11 | BH | Thiếu test Owner cũ bị chặn thao tác chỉ Owner, lỗi SMTP một phần | low | Test 204 đã kiểm Owner cũ nhận 403 ở `GET members`, resolver đọc DB mỗi request; SMTP một phần thuộc #1 | reject |
| 12 | BH | Cache dữ liệu chỉ Owner (tài khoản nhận tiền) còn hiện cho Owner cũ | false | `OwnerOnly` đọc vai từ `organizationQueryKey` đã được làm mới, nên trang chỉ Owner hiện empty-state, không hiện dữ liệu cache | reject |
| 13 | BH | Admin không được hỏi đồng ý trước khi nhận quyền | low | AC chốt chuyển ngay sau xác nhận của Owner | reject |
| 14 | BH | Chặn tự chuyển cho mình nằm sau UPDATE, dựa vào rollback | low | Đúng kết quả nhưng nâng nhầm dòng rồi mới hủy; thêm `ne(userId)` vào WHERE | patch |
| 15 | BH | Lỗi `NOT_A_MEMBER` định nghĩa hai chỗ | low | Cùng mã và câu; chỉ lệch nếu ai sửa một chỗ | reject |
| 16 | BH | JSDoc và dòng `providers` quá dài trong `invitation-jobs.ts`, `organizer.module.ts` | low | Repo không có prettier; sửa định dạng trực tiếp | patch |
| 17 | BH | Spec và sprint-status không có trong diff | false | Diff cố ý chỉ gồm code | reject |
| 18 | VG | e2e không kiểm nav ngay sau `router.push`, bỏ `refreshRoles` vẫn pass | medium | VG đã xác minh: kiểm vai chỉ sau `page.goto` | patch |
| 19 | VG | Nhánh web `FORBIDDEN_ROLE` không có test | medium | VG đã xác minh: không mock nào trả mã này | patch |
| 20 | VG | Không test Owner cũ/mới đã rời BTC vẫn nhận email | medium | VG đã xác minh: test chỉ xóa Admin khác | patch |

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint && pnpm lint:deps` -- expected: sạch.
- `pnpm --filter @tickee/api test` -- expected: pass, gồm `members.test.ts`, test job email, `isolation.test.ts`.
- `pnpm --filter @tickee/web test && pnpm --filter @tickee/web test:e2e members` -- expected: pass.
