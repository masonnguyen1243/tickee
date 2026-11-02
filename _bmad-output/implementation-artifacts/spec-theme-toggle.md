---
title: 'Nút chuyển giao diện sáng/tối'
type: 'feature'
created: '2026-11-02'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '931ea48eceed6869759ca19b45dbafb4f2e9faa4'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Giao diện sáng/tối hiện chỉ theo cài đặt hệ thống (`prefers-color-scheme`), người dùng không tự chọn được. Planning (EXPERIENCE.md, UX-DR1, AC Story 1.2) ghi "không có công tắc theme ở MVP". Ngày 02/11/2026 Mason quyết định đổi: thêm nút chuyển giao diện và sửa tài liệu theo.

**Approach:** Lưu lựa chọn theme trên trình duyệt. Một script chặn trong `<head>` đặt `data-theme` (sáng hoặc tối) lên `<html>` trước lần vẽ đầu. Biến màu dark chuyển từ media query sang selector `[data-theme='dark']`. Nút đặt trong `SiteHeader`, cạnh menu tài khoản, có ở mọi trang dùng header này, khách cũng thấy.

## Boundaries & Constraints

**Always:**
- Quyết định (Mason, 02/11/2026): nút có hai trạng thái, mỗi lần bấm đổi Sáng ↔ Tối. Icon chỉ đích đến (đang sáng thì hiện mặt trăng, đang tối thì hiện mặt trời). Không có lựa chọn "theo hệ thống" trên giao diện.
- Mặc định (chưa chọn gì) theo hệ thống, và cập nhật ngay khi hệ thống đổi chế độ lúc trang đang mở. Lần bấm đầu tiên lưu lựa chọn; từ đó không theo hệ thống nữa.
- Lựa chọn lưu ở `localStorage` (khóa `tickee:theme`), theo từng trình duyệt. Mọi lần đọc/ghi bọc try/catch; lỗi thì coi như "theo hệ thống".
- Không nhấp nháy sai màu khi tải trang: script inline chạy trước khi vẽ, `<html suppressHydrationWarning>`.
- Mỗi giá trị màu dark chỉ khai báo ở một nơi trong `globals.css`. `color-scheme` của `:root` khớp theme đang dùng (thanh cuộn, ô nhập native). Không có JS thì dùng giao diện sáng.
- Toast (`components/ui/sonner.tsx`) và `<meta name="theme-color">` theo theme đang dùng, không theo hệ thống.
- Nút là icon button 40px có `aria-label` tiếng Việt nói rõ hành động, focus bằng bàn phím được, đổi theme ngay tại chỗ không tải lại trang.
- Giá trị màu của hai theme giữ nguyên như DESIGN.md. Stage, QR, màu quét không đổi.
- Sửa tài liệu cho khớp: `EXPERIENCE.md:26`, `epics.md` (UX-DR1 :184, AC Story 1.2 :401), `DESIGN.md:398`, comment ở `globals.css:6` và `sonner.tsx:7`. Ghi ngày đổi 02/11/2026.

**Never:**
- Không thêm thư viện (kể cả `next-themes`), không lưu lựa chọn theo tài khoản ở API, không dùng cookie.
- Không đọc theme ở server (giữ các trang tĩnh được prerender).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Lần đầu | chưa lưu gì, hệ thống tối | trang tối, nút nói "Chuyển sang giao diện sáng" | — |
| Bấm nút | đang sáng | trang tối ngay, lưu lựa chọn | — |
| Tải lại | đã lưu "tối", hệ thống sáng | trang tối ngay từ HTML đầu, không chớp sáng | — |
| Hệ thống đổi | chưa chọn gì, hệ thống đổi sáng → tối | trang đổi theo | — |
| Storage hỏng | `localStorage` ném lỗi hoặc giá trị lạ | theo hệ thống, nút vẫn đổi được trong phiên | không lỗi console |

</frozen-after-approval>

## Code Map

- `apps/web/app/globals.css` -- `:root` light (:10-71, có `color-scheme: light dark` :70); `@media (prefers-color-scheme: dark) { :root {...} }` (:73-~110) chứa mọi biến dark: chuyển sang `[data-theme='dark']`. Không file nào dùng biến thể `dark:` của Tailwind, nên chỉ cần lo biến CSS.
- `apps/web/app/layout.tsx` -- `<html lang="vi">`, `viewport.themeColor` theo media (:26-32). Script inline đặt ở `<head>` tại đây.
- `apps/web/components/ui/sonner.tsx:12` -- `theme="system"`: đổi sang theme đang dùng.
- `apps/web/components/tickee/site-header.tsx` -- header dùng chung (trang công khai, `/tao-btc`, cột nội dung dashboard qua `dashboard-shell.tsx`); thêm nút cạnh `AccountMenu`. `(buyer)`, `(checkin)`, `(admin)` chưa có layout thật.
- `apps/web/app/(dashboard)/btc/[orgId]/organization-home.tsx:15-30` -- mẫu đọc/ghi `localStorage` có try/catch.
- `apps/web/components/ui/button.tsx` -- variant/size có sẵn cho icon button. Token `--spacing-icon-button: 40px` có trong `globals.css`.
- `apps/web/e2e/theme.spec.ts` -- test biến màu theo `colorScheme` của Playwright: phải vẫn pass (mặc định theo hệ thống).
- Tài liệu: `_bmad-output/planning-artifacts/ux-designs/ux-tickee-2026-10-27/{EXPERIENCE,DESIGN}.md`, `_bmad-output/planning-artifacts/epics.md`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/lib/theme.ts` -- khóa lưu, đọc/ghi an toàn, tính theme đang dùng, hook đăng ký thay đổi (storage + `matchMedia`), và chuỗi script inline -- một nguồn logic theme.
- [x] `apps/web/app/layout.tsx` + `app/globals.css` -- script chặn trong `<head>`, `suppressHydrationWarning`, biến dark theo `[data-theme='dark']`, `color-scheme` theo theme -- áp theme trước khi vẽ.
- [x] `apps/web/components/tickee/theme-toggle.tsx` + `site-header.tsx` -- nút hai trạng thái Sáng ↔ Tối -- điểm chạm của người dùng.
- [x] `apps/web/components/ui/sonner.tsx` -- toast theo theme đang dùng.
- [x] `apps/web/e2e/theme-toggle.spec.ts` -- phủ mọi dòng matrix (giả lập hệ thống bằng `page.emulateMedia({ colorScheme })`, storage hỏng bằng `addInitScript`), kiểm `--background` và `<meta name="theme-color">`; cả hai project.
- [x] Tài liệu planning và comment -- sửa các chỗ ở Boundaries cho khớp quyết định mới.

**Acceptance Criteria:**
- Given đang ở bất kỳ trang nào có header, when bấm nút bằng bàn phím (Tab rồi Enter), then theme đổi và `aria-label` đổi theo.
- Given `pnpm turbo build typecheck lint:deps test` và `pnpm --filter @tickee/web test:e2e`, then tất cả pass, kể cả `theme.spec.ts`.

## Implementation Notes

- `lib/use-theme.ts` tách khỏi `lib/theme.ts`, vì root layout (Server Component) import `theme.ts` để lấy script, mà hook React chỉ được dùng ở client.
- `THEME_SCRIPT` lấy từ `applyTheme.toString()`, nên script và app sau hydrate dùng chung một logic. Hàm này phải tự đủ, không tham chiếu biến hay import nào bên ngoài.
- `account-menu.tsx`: nút tài khoản giờ co lại được (email cắt "…") để header vừa 320px khi có thêm nút theme.
- `global-error.tsx` gọi `useTheme()` để áp lại theme, vì trang này thay cả `<html>`.

## Spec Change Log

## Review Triage Log

Pass 1 (02/11/2026, 3 lớp: blind-hunter BH, edge-case-hunter EC, verification-gap VG).

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | VG, BH | Đồng bộ theme giữa các tab (`storage`) không có test, cũng không ghi trong tài liệu | low | Gap đã kiểm sẵn: mọi test chỉ dùng một trang | patch |
| 2 | VG | Không test nào kiểm `color-scheme` theo theme đang dùng | medium | Gap đã kiểm sẵn: chỉ có `emulateMedia`, không đọc `color-scheme` đã tính | patch |
| 3 | VG | Test tải lại không chớp chỉ loại giá trị "light", không bắt trường hợp `data-theme` bị gỡ | medium | Gap đã kiểm sẵn: `theme-toggle.spec.ts:119` lọc `=== 'light'`, mutation `null` lọt qua | patch |
| 4 | VG, EC | Test "đã chọn thì hệ thống đổi vẫn giữ" có thể khẳng định trước khi sự kiện `change` tới listener | medium | Gap đã kiểm sẵn: `:84-86`, `:152-155` chỉ chờ `matchMedia().matches` mới tạo; vòng tối → sáng → tối có thể không phát `change` | patch |
| 5 | VG | Áp lại theme ở `global-error.tsx` không có test | low | Gap đã kiểm sẵn; e2e chạy `next start` không có cách làm root layout ném lỗi; dựng harness là ngoài phạm vi | reject |
| 6 | BH, EC | `global-error.tsx` áp theme trong passive effect, có thể vẽ sáng một khung hình cho người dùng tối | low | Đúng: subscribe của `useSyncExternalStore` chạy sau commit; chỉ xảy ra khi chính root layout lỗi; sửa cần thêm export và layout effect | reject |
| 7 | BH | Nút theme bị đẩy sang trái khi `AccountMenu` (trong Suspense, fallback rỗng) hiện ra: layout shift, bấm nhầm | low | Đúng: `site-header.tsx:19-22` đặt nút trước slot đổi độ rộng (rỗng → placeholder 96px → nút thật) | patch |
| 8 | BH, EC | `viewport.colorScheme: 'light dark'` vẫn sinh `<meta name="color-scheme">` theo hệ thống, mâu thuẫn lựa chọn | low | Đúng: `layout.tsx:29`; CSS đã đặt `color-scheme` theo `data-theme` nên bỏ dòng này là đủ | patch |
| 9 | BH | Chưa có kế hoạch CSP cho script inline | maybe-false | Hiện chưa có CSP nên chưa có lỗi; khi thêm CSP (script Tingee) phải tính hash/nonce cho `THEME_SCRIPT` mà vẫn giữ trang tĩnh | defer |
| 10 | BH | Script `toString()` hỏng thì im lặng, không có unit test | false | e2e chạy trên build production và khẳng định mutation `data-theme` đầu tiên xảy ra trước khi có `<body>` (`:117`): script không chạy thì test này hỏng | reject |
| 11 | BH | Tài liệu còn chỗ mâu thuẫn: `epics.md:393`, `DESIGN.md:11,:387,:389,:681`, `epic-1-context.md:46`, `.memlog.md:17`; EXPERIENCE chưa ghi "không JS thì sáng", "storage bị chặn chỉ giữ trong phiên", đồng bộ giữa tab; comment `sonner.tsx` nói "không theo hệ thống" | low | Đúng; intent yêu cầu sửa tài liệu cho khớp; mục sprint-status bỏ qua vì đây không phải story | patch |
| 12 | BH | Màn không có `SiteHeader` (buyer, checkin, admin) chưa có quy tắc đặt nút | low | Các layout này còn là placeholder; story của từng bề mặt sẽ quyết định | reject |
| 13 | EC | Trang 404 có header riêng nhưng không có nút theme, trái AC "mọi trang có header" | low | Đúng: `not-found.tsx:11-15` chỉ có wordmark | patch |
| 14 | BH | Chưa test header 320px với email dài | low | Mọi fixture dùng email 17 ký tự; thay đổi co nút ở `account-menu.tsx` chưa được kiểm | patch |
| 15 | BH | `aria-label` sai trước hydrate với người dùng tối | low | Đúng: server luôn render nhãn "…tối"; đổi sang hai nhãn `sr-only` chọn bằng CSS là sửa trực tiếp | patch |
| 16 | BH | Đổi theme thì nút chuyển màu từ từ (transition) còn nền đổi ngay | low | Chỉ là hiệu ứng thị giác; sửa phải thêm cơ chế tắt transition | reject |
| 17 | BH | Màu nền chép sang `THEME_CONFIG.themeColors` mà không có comment tham chiếu chéo | low | Đúng; thêm comment ở cả hai nơi | patch |
| 18 | EC | Safari < 14 không có `MediaQueryList.addEventListener` | false | Next 16 nhắm Safari ≥ 16.4; trình duyệt cũ hơn không chạy được app | reject |
| 19 | EC | Trang khôi phục từ bfcache giữ theme cũ khi tab khác đã đổi | low | Có thật nhưng hiếm; sửa phải thêm listener `pageshow` | reject |
| 20 | EC | Không JS: nút theme vẫn hiện nhưng bấm không có tác dụng | low | Đúng; ẩn nút khi `<html>` chưa có `data-theme` bằng một class | patch |
| 21 | EC | Bỏ `themeColor` tĩnh nên khách không JS không có `theme-color` | low | Thêm lại meta tĩnh có thể sinh hai thẻ `theme-color` mâu thuẫn, vì thứ tự giữa metadata của Next và script trong `<head>` không chắc chắn; ảnh hưởng chỉ là màu thanh trình duyệt | reject |

## Design Notes

Script resolve lựa chọn thành `data-theme` sáng/tối cụ thể, kể cả khi đang "theo hệ thống", để CSS chỉ cần một selector cho dark: không phải chép khối biến vào cả media query lẫn selector. Đổi lại, khi không có JS trang luôn sáng. Chấp nhận được vì mọi bề mặt ngoài landing đều cần JS. Không dùng `light-dark()` vì Safari dưới 17.5 không hỗ trợ.

## Verification

**Commands:**
- `pnpm turbo build typecheck lint:deps test` -- expected: tất cả pass (build web với `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001` để chạy e2e).
- `pnpm --filter @tickee/web test:e2e` -- expected: pass trên `ios-webkit` và `android-chromium`.
