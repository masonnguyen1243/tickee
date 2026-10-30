---
title: 'Story 2.2 (làm lại): Xác thực hai lớp tự bật (TOTP)'
type: 'feature'
created: '2026-10-30'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '358cbf2b6e0edb9b21711b6d32d6c529e7dede2f'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-30.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Code Story 2.2 ở `6768753` bắt Owner phải đăng ký TOTP và step-up 12 giờ trên route BTC. Sprint Change Proposal 30/10/2026 (đã duyệt) đổi 2FA thành tính năng mọi tài khoản tự bật/tắt; tài khoản đã bật phải nhập mã sau mỗi lần đăng nhập (FR-1, NFR-6, AD-26, UX-DR42).

**Approach:** Giữ phần lõi đã có (`TotpStore`, `TotpAttemptLimiter`, mã khôi phục, màn đăng ký, dialog step-up, cơ chế gửi lại mutation). Bỏ luật bắt buộc khỏi `PermissionGuard`; thêm guard toàn cục của `identity` đòi TOTP với mọi request (ngoài danh sách miễn) khi user đã bật 2FA mà session chưa qua lớp hai, hiệu lực hết session. Thêm tắt 2FA, trang "Bảo mật tài khoản" và thẻ gợi ý bật 2FA cho Owner.

## Boundaries & Constraints

**Always:**
- Luật mới, kiểm ở guard `TotpGuard` của `identity`, đăng ký `APP_GUARD` ngay sau `SessionGuard` (trước `ConsentGuard`): user có `twoFactorEnabled` và `sessions.step_up_at` rỗng → 403 `TOTP_REQUIRED` (`details.reason = 'step_up'`; bỏ lý do `enroll`). Bỏ qua route công khai (`@Public`/`@AllowAnonymous`), request không có session, và route trong `TOTP_EXEMPT_ROUTES`. Không chặn `/v1/auth/*` của Better Auth (đăng nhập Google/OTP vẫn chạy với user đã bật 2FA).
- `TOTP_EXEMPT_ROUTES` chỉ còn: `POST /v1/identity/totp/step-up`, `POST /v1/identity/totp/recovery`, `POST /v1/identity/sign-out`, `GET /v1/identity/me`. Có test chứng minh guard thật sự đọc danh sách này (một route miễn trả 2xx còn route không miễn trả `TOTP_REQUIRED` với cùng session).
- Step-up hiệu lực hết session: bỏ `STEP_UP_TTL_MS` và mọi so sánh 12 giờ. `PermissionGuard` không còn luật TOTP, chỉ chép `stepUpAt` vào `accessContext`.
- Bật 2FA (xác nhận đăng ký): xóa `step_up_at` của mọi session khác của user rồi đánh dấu session hiện tại (session mới sau khi plugin xoay). Giữ bước bù trừ khi transaction sau xác minh lỗi.
- Tắt 2FA: `POST /v1/identity/totp/disable` nhận mã TOTP hoặc mã khôi phục (dùng chung `TotpAttemptLimiter`); đúng → gỡ TOTP và mã khôi phục, xóa `step_up_at` của mọi session, audit `totp.disabled`, email báo sau khi commit (lỗi gửi chỉ ghi log). Route này không miễn nên đã bị guard đòi qua lớp hai trước.
- Dùng mã khôi phục: giữ hành vi hiện có (qua lớp hai, mã hết hiệu lực, gỡ TOTP, audit, email); web đưa tới trang Bảo mật tài khoản kèm banner warning "Xác thực hai lớp cũ đã được gỡ. Bật lại với thiết bị mới.", không còn đưa tới màn đăng ký.
- Web: `TOTP_REQUIRED` luôn mở dialog "Xác thực hai lớp" tại chỗ; dialog có mã 6 số, link "Dùng mã khôi phục" và nút "Đăng xuất" (thay "Hủy"). Đúng mã thì gửi lại mutation và tải lại query bị chặn như hiện có.
- Trang "Bảo mật tài khoản" ở `/tai-khoan/bao-mat`, vào từ menu tài khoản (mục mới), dùng chung mọi vai: trạng thái 2FA; chưa bật → nút "Bật xác thực hai lớp" tới màn đăng ký hiện có (`/bao-mat/totp`, `returnTo` mặc định là trang này); đã bật → nút "Tắt" mở `Dialog` nêu hậu quả "Tài khoản chỉ còn được bảo vệ bằng email." kèm ô mã TOTP hoặc mã khôi phục, xong toast "Đã tắt xác thực hai lớp".
- Thẻ gợi ý trên danh sách Sự kiện của BTC khi vai là `owner` và `me.twoFactorEnabled` là false: "Bật xác thực hai lớp để bảo vệ tài khoản nhận tiền." + "Bật ngay" → trang Bảo mật tài khoản; có nút đóng, trạng thái đóng lưu `localStorage` theo user (bọc try/catch, lỗi thì vẫn hiện). Không dùng `status-banner`.
- Không ai bị buộc bật 2FA, kể cả Owner; user chưa bật không bao giờ nhận `TOTP_REQUIRED`.

**Never:**
- Không làm xác nhận lại `REAUTH_REQUIRED` (Story 2.13) hay bắt buộc 2FA cho Quản trị Tingee / "Đặt lại TOTP" (Story 2.5).
- Không thêm migration; không đổi `TotpStore` ngoài phần cần cho xóa `step_up_at` theo user.
- Không đòi TOTP lúc gọi endpoint đăng nhập; không trust-device.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Chưa bật 2FA | Owner gọi `GET /v1/orgs/:orgId` | 200, không bao giờ `TOTP_REQUIRED` | — |
| Bật 2FA | xác nhận đúng mã đầu tiên | 10 mã khôi phục; session hiện tại đã qua lớp hai; session khác của user nhận `TOTP_REQUIRED` ở request kế tiếp | — |
| Đăng nhập lại khi đã bật | session mới gọi API không miễn | 403 `TOTP_REQUIRED` `step_up` | web mở dialog |
| Route miễn | session chưa qua lớp hai gọi `GET /v1/identity/me` | 200 | — |
| Route công khai | session chưa qua lớp hai gọi route `@Public` | xử lý như khách | — |
| Step-up đúng | mã TOTP đúng | 200; mọi request sau trong session qua guard, không hết hạn theo giờ | — |
| Step-up sai / khóa | sai 1–4 / lần 5 | `TOTP_INVALID` / 429 `TOTP_LOCKED` + audit | lỗi tại ô |
| Tắt 2FA | mã TOTP hoặc mã khôi phục đúng | 2FA tắt, xóa secret + mã khôi phục, audit + email; request sau không đòi TOTP | sai → `TOTP_INVALID`, tính bộ đếm |
| Dùng mã khôi phục | mã chưa dùng | qua lớp hai, TOTP bị gỡ, audit + email | web sang trang Bảo mật kèm banner |
| Owner chưa bật mở dashboard | vai `owner`, `twoFactorEnabled=false` | thấy thẻ gợi ý; đóng thì không hiện lại trên trình duyệt đó | — |

</frozen-after-approval>

## Code Map

- `apps/api/src/platform/access/permission.guard.ts` -- `access.role === Role.OWNER` (khoảng :83) và `isExempt` (:98): xóa luật TOTP, giữ `stepUpAt` vào `accessContext`.
- `apps/api/src/modules/identity/identity.module.ts:59-60` -- thứ tự `APP_GUARD` (Session → Consent); chèn `TotpGuard` ở giữa. `session.guard.ts` -- mẫu đọc `PUBLIC_ROUTE_KEY`/`@OptionalAuth`, `RequestWithSession`; `consent.guard.ts` -- mẫu guard có miễn trừ.
- `apps/api/src/modules/identity/totp.service.ts` -- `confirmEnrollment`, `stepUp`, `useRecoveryCode`, `checkCode`, `totpRequired()`; thêm `disable`. `totp.controller.ts` -- thêm route `disable`.
- `apps/api/src/modules/identity/totp-store.ts` -- `remove` (đã xóa `step_up_at` mọi session), `markStepUp`; thêm hàm xóa `step_up_at` các session khác khi bật.
- `apps/api/src/modules/identity/totp-email.ts` -- mẫu email; thêm email "đã tắt 2FA". `platform/audit/audit.ts` -- thêm `totp.disabled` vào `AuditAction`.
- `packages/contracts/src/identity.ts` -- `TOTP_ENROLL_PATH` (:66), `FLOW_PATHS` (:74), `STEP_UP_TTL_MS` (:126, bỏ), `TotpRequiredReason` (:198, chỉ còn `step_up`), `TOTP_EXEMPT_ROUTES` (:221), `isTotpExemptRoute`; thêm schema request/response cho disable và đường dẫn trang Bảo mật.
- `apps/api/test/organizer/totp-required.test.ts` -- viết lại theo luật mới (có thể chuyển sang `test/identity/totp-guard.test.ts`). `test/identity/harness.ts` -- `signUpWithTotp`/`enrollTotp`; test organizer khác đang đăng ký TOTP cho Owner, vẫn hợp lệ, không bắt buộc sửa.
- `apps/web/app/providers.tsx` -- `goToEnroll` (:62), nhánh `enroll` (:79), `onReenroll` (:98): bỏ nhánh `enroll`; mã khôi phục → `/tai-khoan/bao-mat`.
- `apps/web/components/tickee/step-up-dialog.tsx` -- nút "Hủy" (:146) đổi thành "Đăng xuất" (dùng `signOut` ở `lib/auth/api.ts`, rồi về đăng nhập).
- `apps/web/components/tickee/dashboard-shell.tsx` -- `redirecting` đang tính `TOTP_REQUIRED` `enroll`: bỏ.
- `apps/web/app/(public)/bao-mat/totp/{page,enroll-form}.tsx` -- màn đăng ký giữ nguyên; `returnTo` mặc định trang Bảo mật. `app/(public)/dong-y/` -- mẫu trang toàn màn trong `(public)`.
- `apps/web/components/tickee/account-menu.tsx` -- thêm mục "Bảo mật tài khoản".
- `apps/web/app/(dashboard)/btc/[orgId]/organization-home.tsx` -- danh sách Sự kiện; chèn thẻ gợi ý. Role lấy từ query BTC của layout (`organizationQueryKey`), `twoFactorEnabled` từ `fetchMe`.
- `apps/web/e2e/totp.spec.ts`, `identity-mock.ts`, `organizer-mock.ts` -- sửa theo luật mới.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{identity,errors}.ts` + test -- bỏ `STEP_UP_TTL_MS` và lý do `enroll`, danh sách miễn mới, schema disable, đường dẫn `/tai-khoan/bao-mat`.
- [x] `apps/api/src/modules/identity/{totp.guard,identity.module}.ts` + `platform/access/permission.guard.ts` -- guard mới, gỡ luật cũ.
- [x] `apps/api/src/modules/identity/{totp.service,totp.controller,totp-store,totp-email}.ts` + `platform/audit/audit.ts` -- tắt 2FA, xóa `step_up_at` session khác khi bật.
- [x] `apps/api/test/identity/{totp-guard,totp}.test.ts` -- phủ mọi dòng API của matrix; test danh sách miễn thật sự có tác dụng; bỏ test của luật cũ.
- [x] `apps/web/app/(public)/tai-khoan/bao-mat/{page,security-settings}.tsx` + `lib/auth/totp.ts` -- trang Bảo mật, dialog tắt, banner sau mã khôi phục.
- [x] `apps/web/app/providers.tsx`, `components/tickee/{step-up-dialog,dashboard-shell,account-menu}.tsx`, `app/(dashboard)/btc/[orgId]/organization-home.tsx` -- dialog có Đăng xuất, bỏ nhánh enroll, mục menu, thẻ gợi ý.
- [x] `apps/web/e2e/totp.spec.ts` + mock -- bật từ trang Bảo mật, dialog sau đăng nhập, tắt, mã khôi phục → trang Bảo mật, thẻ gợi ý hiện/đóng, Owner chưa bật vào dashboard không bị chặn, 320px; cả hai project.

**Acceptance Criteria:**
- Given Owner chưa bật 2FA, when tạo BTC rồi mở dashboard, then vào thẳng danh sách Sự kiện, không chuyển sang màn đăng ký.
- Given `pnpm turbo build typecheck lint:deps test` và Playwright, then tất cả pass, kể cả bộ test cách ly và e2e hiện có.

## Implementation Notes

- Kiểm chứng sau review (30/10/2026): e2e `totp.spec.ts:39` chập chờn trên ios-webkit vì toast "Đã sao chép" đè nút "Tiếp tục" ở 375px và sonner dừng đếm giờ khi chuột rê lên toast; test giờ chờ toast tắt trước khi bấm. Toàn bộ build/typecheck/lint:deps/test và 204 e2e pass.

## Spec Change Log

## Review Triage Log

Pass 1 (30/10/2026, 3 lớp: blind-hunter BH, edge-case-hunter EC, verification-gap VG).

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | VG | Nhánh "409 = 2FA đã tắt → coi như qua" của dialog nhập mã không có test | medium | Gap đã kiểm sẵn: không mock nào trả 409; xóa nhánh thì không test nào hỏng, user kẹt trong dialog không đóng được | patch |
| 2 | VG | "Đăng xuất" từ dialog: `returnTo` về trang đang đứng chưa được kiểm | low | Gap đã kiểm sẵn: test duy nhất bắt đầu ở `/`, `withReturnTo` bỏ tham số khi đích là `/` | patch |
| 3 | BH, EC | `isTotpNotEnabled` coi mọi `VALIDATION_FAILED` 409 là "chưa bật"; `notStarted` cũng là 409 → dialog lặp | low | `notStarted` chỉ xảy ra khi thiếu hàng `two_factors` mà `two_factor_enabled` true; `remove` xóa cả hai trong một transaction, plugin bật cờ cùng lúc xác nhận hàng → không đường nào tới trạng thái này; sửa cần mã lỗi công khai mới | reject |
| 4 | BH, EC | Hai request tắt 2FA đồng thời đều qua `isEnabled` → audit và email trùng | low | Form khóa nút khi đang gửi; chỉ xảy ra khi tự gửi song song từ hai tab; sửa phải thêm UPDATE có điều kiện | reject |
| 5 | EC | Tắt bằng mã khôi phục song song sau khi request kia đã xóa mã → `TOTP_INVALID` giả | low | Cùng gốc với #4, chỉ khi gửi song song | reject |
| 6 | BH | Tắt bằng mã khôi phục không để lại dấu vết mã đã dùng (mã bị xóa, audit không ghi cách tắt) | low | `consumeRecoveryCode` đánh dấu rồi `removeTwoFactor` xóa hết trong cùng transaction; audit chỉ có `totp.disabled` | patch |
| 7 | BH | `disable` bỏ `set-cookie` của `verify` | false | `verify-two-factor.mjs:102-106`: với session đã có, `valid()` chỉ trả JSON, không set cookie; plugin chỉ xoay session khi `verified !== true` (lúc bật) | reject |
| 8 | BH, VG | `limiter.restore` trong nhánh mã khôi phục không có `.catch`, che lỗi gốc (nhánh TOTP thì có) | low | `totp.service.ts` hai nhánh của `disable` xử lý khác nhau; sửa trực tiếp | patch |
| 9 | BH | Web không biết session đã qua lớp hai; dialog chỉ hiện nhờ query memberships của menu tài khoản | low | `AccountMenu` có ở header mọi trang và gọi `/v1/me/memberships` (không miễn) → dialog luôn hiện sau đăng nhập; API vẫn chặn mọi thứ; sửa phải thêm trường công khai vào `Me` | reject |
| 10 | BH | Comment `TotpGuard` nói đứng trước `ConsentGuard` để giấu trạng thái đồng ý, nhưng `GET /v1/identity/me` (miễn) vẫn trả `consentedAt` | low | Đúng: lý do trong comment không đứng vững; sửa comment | patch |
| 11 | BH | Test "không chặn đăng nhập" không thử đăng nhập Google thành công với user đã bật 2FA | low | `totp-guard.test.ts:149` chỉ gọi callback với `state` sai (nhánh lỗi); đăng nhập OTP thì có test | patch |
| 12 | BH | Test "route công khai" không chạm nhánh `PUBLIC_ROUTE_KEY` của `TotpGuard` (nhánh thừa) | low | `SessionGuard` không nạp session ở route công khai nên `!session` đã đủ; nhánh thừa vô hại | reject |
| 13 | BH | Chưa có e2e cho luồng tắt 2FA bị `TOTP_REQUIRED` rồi gửi lại, và lỗi "Chưa đăng xuất được" | low | Cơ chế gửi lại mutation đã có e2e "qua lớp hai giữa thao tác"; phần còn lại là nhánh hiếm | reject |
| 14 | BH, EC | Dùng mã khôi phục bỏ thao tác dở và chuyển trang | low | Spec (frozen) quy định dùng mã khôi phục thì đưa tới trang Bảo mật kèm banner; sửa là đổi spec | reject |
| 15 | BH | Dialog không đóng được, không có hướng dẫn khi mất cả thiết bị lẫn mã khôi phục | low | Đúng như UX đã duyệt (chỉ "Đăng xuất"); lối hỗ trợ "Đặt lại TOTP" thuộc Story 2.5 — thêm dòng hướng dẫn khi làm 2.5 | reject |
| 16 | BH, EC | Trang đăng ký: `returnTo` rỗng hoặc không an toàn thì về `/` thay vì trang Bảo mật | low | `bao-mat/totp/page.tsx` chỉ mặc định khi `undefined`; sửa một điều kiện | patch |
| 17 | BH | Email bảo mật không có link, helper HTML không escape | low | Chuỗi đều là hằng; link là bổ sung | reject |
| 18 | BH | `TotpRequiredReason` chỉ còn một giá trị, không ai rẽ nhánh | low | Giữ dạng `details` để Story 2.5/2.13 thêm lý do; vô hại | reject |
| 19 | EC | Tab khác đã qua lớp hai mà dialog ở tab này vẫn mở | low | Nhập mã lại vẫn qua; sửa phải thêm lắng nghe focus | reject |
| 20 | VG, EC | Comment `sessions.stepUpAt` còn nhắc `STEP_UP_TTL_MS` đã xóa | low | `schema.ts:38`; sửa comment | patch |

## Design Notes

Guard ở `identity` thay vì `PermissionGuard` vì luật giờ áp cho mọi route có session, không chỉ route BTC; đặt trước `ConsentGuard` để user đã bật 2FA không lộ trạng thái đồng ý trước khi qua lớp hai. Step-up hết hạn cùng session nên `step_up_at` chỉ cần "có hay không"; vẫn giữ kiểu timestamp để Story 2.13/2.5 dùng lại.

## Verification

**Commands:**
- `pnpm turbo build typecheck lint:deps test` -- expected: tất cả pass (cần Postgres local: `docker compose up -d postgres`).
- `pnpm --filter @tickee/web test:e2e` -- expected: pass trên `ios-webkit` và `android-chromium`.
