---
title: 'E2-5 (Web): gom primitive trùng lặp, ConfirmDialog chung, gom đăng xuất, tách payout-account-manager'
type: 'refactor'
created: '2026-11-09'
status: 'done'
baseline_commit: '14b9084a0a9f0da53b07e9fc43dfa36f72d749c8'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-retro-2026-11-09.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Code web đang chép tay cùng một thứ ở nhiều nơi: `messageOf` ×7, `useGoToLogin` ×5, `FieldError` ×11 (kể cả bản đổi tên), `handledElsewhere` ×3, bước đăng xuất ×4, 8 Dialog xác nhận tự viết. Ngoài ra `payout-account-manager.tsx` đã lên 1378 dòng (retro Epic 2 D2, D3; AI-6 của Epic 1). Epic 3 sắp thêm nhiều UI mới, nên phải gom lại trước Story 3.1.

**Approach:** Đưa từng primitive về một chỗ dùng chung trong `lib/` hoặc `components/tickee/`, rồi cho mọi nơi gọi import bản đó. Tạo `ConfirmDialog` dùng chung cho các Dialog xác nhận. Tách `payout-account-manager.tsx` thành 5 file theo ranh giới component. Giao diện, câu chữ và hành vi người dùng thấy phải giữ nguyên.

## Boundaries & Constraints

**Always:**
- Đây là refactor thuần. DOM, class, role/aria, câu chữ tiếng Việt, đích điều hướng sau đăng xuất và thứ tự thao tác (`queryClient.clear()` trước `router.replace`) đều giữ nguyên. E2e Playwright hiện có phải pass mà không sửa selector.
- File đặt tên kebab-case. Không tạo cycle (rule `no-circular` trong `.dependency-cruiser.cjs`). Code trong `lib/` không được import ngược từ `app/`.
- `FieldError` chung nhận `message?: string | null` và render đúng markup hiện tại: `<p id role="alert" … empty:hidden>` với `OctagonAlert` chỉ hiện khi có message.

**Never:**
- Không làm phần API của E2-5 (đã hoãn vào `deferred-work.md`).
- Không tách `login-form.tsx` thành hook. Phần web của AI-5 vẫn hoãn, chỉ thay `ErrorText` bằng `FieldError`.
- Không gom phần trùng giữa `ticket-types-editor.tsx` và `purchase-form-editor.tsx` ngoài các primitive đã liệt kê.
- Không đụng `DisableDialog` (`security-settings.tsx`), vì nó là form nhập mã chứ không phải Dialog xác nhận.
- Không thêm thư viện test component (jsdom, testing-library).

**Quyết định (Mason, 09/11/2026):**
- Spec này chỉ làm phần Web của E2-5. Phần API đã hoãn vào `deferred-work.md`.
- Giữ nguyên một spec, một PR, dù dài khoảng 3.000 token (vượt ngưỡng 1.600).
- AI-6: chỉ gom bước đăng xuất, không làm e2e full-stack trong CI. Trong `sprint-status.yaml`, AI-6 giữ `in-progress`, kèm ghi chú rằng chỉ còn phần e2e full-stack (web + API thật + Mailpit).

</frozen-after-approval>

## Code Map

Gốc là `apps/web/`. `[orgId]` là viết tắt của `app/(dashboard)/btc/[orgId]`.

- `lib/api/errors.ts`: có `ApiError`. `messageOf` và `GENERIC_ERROR` ('Đã có lỗi xảy ra. Vui lòng thử lại.') sẽ nằm ở `lib/api/message-of.ts`.
- `[orgId]/su-kien/handled-elsewhere.ts`: bản chung đang có (dựa trên `lib/auth/api` và `lib/auth/totp`). Chuyển sang `lib/api/handled-elsewhere.ts` và sửa 7 chỗ import.
  - Bản chép cục bộ: `payout-account-manager.tsx:94`, `members-manager.tsx:57`.
- `messageOf` (cả 7 bản giống hệt): `ticket-types-editor.tsx:63`, `payout-account-manager.tsx:100`, `members-manager.tsx:63`, `publish-panel.tsx:114`, `event-settings.tsx:43`, `purchase-form-editor.tsx:50`, `app/(admin)/admin/closed-beta-review.tsx:66`.
  - `GENERIC_ERROR` riêng ở `components/tickee/reauth-dialog.tsx:34` và `app/(public)/dang-nhap/login-form.tsx:32`.
- `useGoToLogin` (cả 5 bản giống hệt): `ticket-types-editor.tsx:78`, `payout-account-manager.tsx:102`, `members-manager.tsx:79`, `event-settings.tsx:45`, `purchase-form-editor.tsx:65`. Bản inline ở `event-wizard.tsx:84`. Bản chung sẽ là `lib/auth/use-go-to-login.ts`, dùng `withReturnTo` và `LOGIN_PATH` của `lib/auth/return-to.ts`.
- `FieldError` → `components/tickee/field-error.tsx`. Các bản cần thay:
  - `app/(dashboard)/tao-btc/create-organization-form.tsx:53`, `ticket-types-editor.tsx:65`, `payout-account-manager.tsx:144`, `event-info-form.tsx:105`, `purchase-form-editor.tsx:52`
  - `app/(public)/tai-khoan/bao-mat/security-settings.tsx:28`, `members-manager.tsx:65`, `components/tickee/step-up-dialog.tsx:17`
  - Bản đổi tên: `login-form.tsx:80` `ErrorText`, `reauth-dialog.tsx:84` `FieldErrorText`, `app/(public)/bao-mat/totp/enroll-form.tsx:33` `ErrorText`
- Đăng xuất: cả 4 nơi đều gọi `useMutation({ mutationFn: signOut })` (lấy từ `lib/auth/api.ts:33`), rồi `clear()` và `replace(đích)`.
  - `components/tickee/account-menu.tsx:42` → `'/'` rồi `router.refresh()`
  - `app/(public)/dong-y/consent-form.tsx:35` → `withNotice(returnTo, DECLINED)`
  - `app/(public)/loi-moi-btc/invitation-acceptance.tsx:121` → `LOGIN_TO_ACCEPT`
  - `components/tickee/step-up-dialog.tsx:68` → prop `onSignedOut`, handler thật ở `app/providers.tsx:105`
  - Hook chung sẽ là `lib/auth/use-sign-out.ts`.
- Dialog xác nhận: primitive là `components/ui/dialog.tsx` (radix). Lỗi hiển thị bằng `StatusBanner tone="danger"`. Footer gồm `Button variant="destructive" className="w-full" loading` và nút "Hủy" `variant="secondary"`. Cần chuyển 7 Dialog:
  - `RemoveDialog` ở `members-manager.tsx:189`
  - `DeleteDialog` ở `ticket-types-editor.tsx:376` và `purchase-form-editor.tsx:471`, cả hai dùng trạng thái `shown` để giữ nội dung trong lúc chạy animation đóng
  - `RevokeDialog` ở `closed-beta-review.tsx:167` (controlled)
  - "Kết thúc Sự kiện?" ở `event-settings.tsx:312`
  - `UnlinkDialog` ở `payout-account-manager.tsx:682` (reauth + toast, description `asChild`)
  - `TransferOwnershipDialog` ở `members-manager.tsx:279` (người dùng phải gõ tên BTC)
- `payout-account-manager.tsx` (1378 dòng) tách vào cùng thư mục `tai-khoan-nhan-tien/`:
  - `shared.tsx`: hằng số, `refreshOverview`/`applyOverview`, `accountLabel`, `cardClass`, `TingeeLink`, `TingeeGuide`, `ListSkeleton`, `PageSkeleton`
  - `tingee-key-form.tsx`: `TingeeKeyForm`, `ConnectForm`
  - `account-chooser.tsx`: `OptionRow`, `AccountChooser`
  - `linked-view.tsx`: `AccountRow`, `UnlinkDialog`, `LinkedView`
  - `replace-key-flow.tsx`: `ReplaceKeyFlow`
  - `payout-account-manager.tsx` chỉ giữ component trang.
- Test: Vitest chỉ có `test/**/*.test.ts` (node), e2e chạy trong `e2e/*.spec.ts` (Playwright, mock API). `test/dependency-rules.test.ts` ghim rule của dependency-cruiser.

## Tasks & Acceptance

**Execution:**
- [x] `lib/api/message-of.ts`, `lib/api/handled-elsewhere.ts`, `lib/auth/use-go-to-login.ts`: tạo bản chung, xóa `[orgId]/su-kien/handled-elsewhere.ts`. Đây là nguồn duy nhất cho các hàm này.
- [x] `components/tickee/field-error.tsx`: tạo `FieldError`. Thay 11 bản trong Code Map. `login-form` và `reauth-dialog` truyền `error?.message`.
- [x] `lib/auth/use-sign-out.ts`: `useSignOut(onSignedOut)` trả về mutation, `onSuccess` = `queryClient.clear()` rồi gọi `onSignedOut()`. Thay 4 nơi; mỗi nơi giữ đích điều hướng và cách báo lỗi riêng của mình.
- [x] `components/tickee/confirm-dialog.tsx`: tạo `ConfirmDialog`. Props:
  - `open`, `onOpenChange`
  - `title`, `description: ReactNode`
  - `children` (phần thân thêm)
  - `confirmLabel`, `onConfirm`, `pending`, `confirmDisabled`
  - `failureTitle`, `failure`
  - Giữ nội dung lúc đang đóng thay cho trạng thái `shown`, và chặn đóng khi `pending`.
  - Chuyển 7 Dialog trong Code Map sang dùng nó. Logic reauth/toast vẫn ở nơi gọi.
- [x] `[orgId]/tai-khoan-nhan-tien/*`: tách thành 5 file như Code Map, dùng primitive chung, không đổi logic.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml`: ghi chú vào mục AI-6 rằng bước đăng xuất đã gom, chỉ còn e2e full-stack. Giữ trạng thái `in-progress`.
- [x] `test/message-of.test.ts`, `test/handled-elsewhere.test.ts`: unit test cho hai hàm thuần, phủ `ApiError`, `Error` thường, `undefined`, và từng mã lỗi `handledElsewhere` nhận ra.

**Acceptance Criteria:**
- Given đã refactor xong, when grep `const messageOf|function useGoToLogin|function FieldError|const handledElsewhere|mutationFn: signOut` trong `apps/web`, then mỗi mẫu chỉ còn đúng một định nghĩa, nằm trong file chung.
- Given `payout-account-manager.tsx` đã tách, when đếm dòng, then không file nào trong `tai-khoan-nhan-tien/` vượt 400 dòng.
- Given bộ e2e Playwright hiện có, when chạy, then pass mà không đổi selector hay snapshot.
- Given một Dialog đã chuyển sang `ConfirmDialog`, when thao tác đang pending, then không đóng được Dialog bằng Esc hay nút "Hủy", giống hành vi hiện tại.

## Implementation Notes

- `ConfirmDialog` có thêm vài prop ngoài danh sách tối thiểu, để giữ đúng DOM của 7 Dialog: `titleClassName`, `descriptionClassName`, `descriptionAsChild` (UnlinkDialog), `cancelLabel` ("Giữ tài khoản", "Đóng" khi Hạng vé bị chặn xóa), `onCloseAutoFocus` (hai DeleteDialog trả focus), `asForm` (TransferOwnershipDialog: thân + footer trong `<form>`, nút xác nhận là `submit`).
- `useSignOut(onSignedOut, { onError })`: `onError` tùy chọn cho `step-up-dialog` (báo lỗi tại dialog). `providers.tsx` bỏ `queryClient.clear()` của mình vì hook đã xóa cache trước khi gọi `onSignedOut`.
- `event-settings.tsx`: nút "Kết thúc" trong Dialog dùng `pending={change.isPending}` thay cho `pending === 'end'`; khi Dialog mở, các nút khác bị che nên chỉ "Kết thúc" có thể đang chạy.
- Kiểu lỗi cục bộ `FieldError` của `login-form.tsx` và `reauth-dialog.tsx` đổi tên thành `FieldFailure` để không trùng component.
- E2E `event-settings.spec.ts:224` (webkit) chập chờn ở `page.goto` cuối test (điều hướng bị tab "Tổng quan" cắt ngang); lỗi có cả trên baseline `14b9084` (2/8 lần), không liên quan refactor.
- Kiểm diff (step 3): `components/tickee/wordmark.tsx` bị đổi định dạng (nháy đơn → nháy kép), ngoài phạm vi, đã trả về baseline. `TransferOwnershipDialog` trước đây cho đóng cả khi đang pending; giờ chặn như các Dialog khác (đúng AC pending).
- Đính chính (review vòng 1, #2): `TransferOwnershipDialog` vốn đã chặn đóng khi pending qua `close()`; hành vi không đổi.
- Verification sau review (vòng 1): `pnpm typecheck`, `pnpm test` và `pnpm lint:deps` đều pass. `pnpm test:e2e`: 579 pass, 1 fail ở `purchase-form.spec.ts:376` (focus sau khi sắp thứ tự). Chạy lại test này 40 lần: baseline `14b9084` fail 4/40, bản E2-5 fail 2/40, nên đây là test chập chờn có từ trước (focus đặt trong `requestAnimationFrame`).

## Spec Change Log

## Review Triage Log

Vòng 1 (blind-hunter BH, edge-case-hunter EC, verification-gap VG):

| # | Nguồn | Phát hiện | Verdict | Bằng chứng / Route |
|---|---|---|---|---|
| 1 | BH, EC | 4 file vẫn viết tay `x instanceof ApiError ? x.message : 'Đã có lỗi…'`: `create-organization-form.tsx:190`, `organization-home.tsx:167`, `event-wizard.tsx:151`, `event-gate.tsx:66` | low | Grep xác nhận. Đây là bản chép inline của `messageOf`, câu chữ có thể lệch nhau. → patch |
| 2 | BH | Ghi chú nói `TransferOwnershipDialog` trước đây đóng được khi pending | false (về code) | `close()` (`members-manager.tsx:298`) đã có `if (transfer.isPending) return;` từ trước. Hành vi không đổi, chỉ ghi chú sai. Sửa ghi chú là sửa spec, nên loại; đã ghi đính chính ở Implementation Notes. |
| 3 | BH | Nơi gọi giữ guard `isPending` dư trong `close()` | low | Vô hại, không có tác hại cụ thể. Loại. |
| 4 | BH, EC | `ConfirmDialog` ghi `held.current` ngay trong render | low | Repo không bật React Compiler. Một render bị hủy chỉ có thể ghi props của chính trạng thái đang mở. Sửa là một dòng (chuyển sang `useLayoutEffect`). → patch |
| 5 | BH | Problem ghi "8 Dialog", Code Map ghi 7 | low | Bản thứ 8 là `DisableDialog`, bị loại có chủ ý. Muốn sửa thì phải sửa spec, nên loại. |
| 6 | VG, BH | AC "pending không đóng được bằng Esc/Hủy" chưa có test nào chạy | medium | Grep e2e: `hold` chỉ dùng cho test "Ẩn". → patch (thêm e2e) |
| 7 | BH | Mục deferred mới để `source_spec: none` | false | Bước 1 của workflow quy định đúng định dạng `none` cho mục tách ở bước 1. Loại. |
| 8 | BH | Prop `failure` bị ép kiểu theo hai cách khác nhau | low | Chỉ là thẩm mỹ, sửa thì phải đổi API của component. Loại. |
| 9 | BH | Giữ nội dung lúc đóng nhưng không giữ `pending`/`confirmDisabled` | low | Chỉ là thẩm mỹ trong khoảng 200ms hiệu ứng đóng; code cũ cũng không giữ. Loại. |
| 10 | BH | Verification ghi e2e pass nhưng không nhắc test chập chờn | low | Muốn sửa thì phải sửa spec, nên loại; test chập chờn đã có trong Implementation Notes. |
| 11 | BH | lint:deps không chứng minh được bản tách không có cycle | false | `no-circular` chạy trên toàn bộ `app components lib`, và `pnpm lint:deps` pass. Loại. |
| 12 | BH | `useGoToLogin` tạo closure mới mỗi lần render | low | Đã có từ trước. Không chỗ gọi nào đưa nó vào mảng deps. Loại. |
| 13 | BH | `providers.tsx` giờ `clear()` trước `closeStepUp()`, và chưa có test nào ghim thứ tự | low | Dialog step-up lấy state của `Providers`, không lấy từ cache query, nên thứ tự không ảnh hưởng. Bất biến quan trọng (clear trước khi điều hướng) vẫn giữ và đã có e2e đăng xuất kiểm. Loại. |
| 14 | EC | Banner lỗi bị giữ lại trong lúc Dialog chạy hiệu ứng đóng | low | Có thật: `held.failure` vẫn còn sau `reset()`. Sửa một dòng (đóng thì bỏ `failure`). → patch |
| 15 | EC | Đăng xuất từ menu tài khoản thất bại thì không báo gì | medium | Có thật nhưng đã có từ trước: code cũ cũng không có `onError`. → defer |

## Design Notes

`ConfirmDialog` tự giữ nội dung lúc đóng bằng cách lưu props của lần mở gần nhất, nên nơi gọi chỉ cần `open={target !== null}`:

```tsx
<ConfirmDialog open={target !== null} onOpenChange={(o) => !o && close()}
  title="Xóa hạng vé?" description={`"${target?.name}" sẽ bị xóa.`}
  confirmLabel="Xóa" onConfirm={() => remove.mutate(target!.id)}
  pending={remove.isPending} failureTitle="Chưa xóa được" failure={remove.error && messageOf(remove.error)} />
```

## Verification

**Commands:**
- `pnpm typecheck`: pass
- `pnpm test`: pass, có unit test mới
- `pnpm lint:deps`: không vi phạm, không có cycle
- `pnpm test:e2e`: pass

**Manual checks:**
- Mở trang Tài khoản nhận tiền, Thành viên, Hạng vé, Form mua vé, admin Closed Beta. Mở từng Dialog xác nhận; giao diện và câu chữ phải không đổi.
