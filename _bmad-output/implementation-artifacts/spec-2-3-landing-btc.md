---
title: 'Story 2.3: Landing BTC'
type: 'feature'
created: '2026-11-02'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '931ea48eceed6869759ca19b45dbafb4f2e9faa4'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `/` đang là trang tạm (một stage block, comment "landing thật thuộc Story 2.3"). Chủ nhiệm CLB biết Tickee qua Tingee chưa có trang nào nói rõ lợi ích và đưa họ vào Closed Beta (UX-DR43).

**Approach:** Thay `/` bằng landing marketing tĩnh (Server Component, không gọi API lúc render) gồm `landing-hero` với 4 `value-tile`, các section theo hành trình BTC và CTA cuối trang. Riêng nút CTA là client component đọc `me` và memberships để chọn đích và nhãn.

## Boundaries & Constraints

**Always:**
- Hero là stage block toàn chiều rộng (không bo góc ở mobile, `rounded-lg` khi có lề ở desktop). Tiêu đề `text-display` (desktop lên 56px) có đúng một cụm từ nhấn `text-primary`. Dưới tiêu đề có câu phụ `text-stage-muted`, CTA chính và nút phụ viền trắng "Xem cách hoạt động" (cuộn tới section hành trình). Ngay dưới là 4 `value-tile` theo thứ tự: tiền về thẳng tài khoản, phí thấp, tạo trong vài phút, tự khớp giao dịch. Mỗi ô có icon lucide 24px `text-primary` và một dòng `text-label`, không nền, không bóng; lưới 2×2 ở mobile, 4 cột từ `lg`.
- Section hành trình kể 4 bước: tạo Sự kiện, bán qua link và VietQR (tiền về thẳng tài khoản BTC), theo dõi Đơn tự khớp giao dịch (xuất CSV/Google Sheets), soát vé bằng điện thoại cùng CTV. Mỗi thẻ có tiêu đề là lợi ích. Bố cục một cột ở mobile, 2 cột ở `md`, 3–4 cột ở `lg`. Thêm một section ngắn về Closed Beta: BTC đăng ký và chờ Quản trị Tingee duyệt mới bán được Vé có phí; Sự kiện miễn phí dùng được ngay.
- CTA cuối trang là section stage hẹp gồm một câu `text-headline` và cùng CTA với hero, không có ô nhập.
- Copy không nêu con số phí hay so sánh phần trăm với sàn vé khác.
- Luật của CTA (dùng chung cho hero và cuối trang):
  - Chưa đăng nhập, hoặc `me` chưa tải xong: "Đăng ký Closed Beta" → `withReturnTo(LOGIN_PATH, CREATE_ORGANIZATION_PATH)`.
  - Đã đăng nhập, memberships rỗng hoặc không hỏi được (chưa đồng ý NĐ 13, lỗi): "Đăng ký Closed Beta" → `CREATE_ORGANIZATION_PATH`. Màn tạo BTC tự lo đồng ý và đăng nhập.
  - Đã thuộc ít nhất một BTC: "Vào dashboard" → `organizationDashboardPath(memberships[0].organizationId)`.
- HTML render ở server luôn có CTA mặc định (link đăng nhập), nên trang dùng được trước khi JS chạy. Dùng `button-primary` (Button `asChild` + `Link`). Query dùng `ME_QUERY_KEY` / `MEMBERSHIPS_QUERY_KEY` với cùng điều kiện `enabled` như `AccountMenu`, để dùng chung cache và không gọi API trùng.
- Metadata riêng cho `/`: title và description nói về bán vé cho BTC, cho phép index.
- 320px không cuộn ngang. Có đúng một `h1`, các section dùng `h2`.

**Never:**
- Không làm form đăng ký Closed Beta riêng, không gọi API mới, không thêm route API.
- Không làm banner "Chờ duyệt Closed Beta" trên dashboard (thuộc Story 2.5).
- Không dùng ảnh hay đồ họa nặng ở hero (trang phải nhẹ). Không thêm thư viện.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Khách | `me` 401 | 2 CTA "Đăng ký Closed Beta" → `/dang-nhap?returnTo=%2Ftao-btc`; đăng nhập xong thì vào `/tao-btc` | — |
| Có tài khoản, chưa có BTC | memberships `[]` | CTA → `/tao-btc` | — |
| Chưa đồng ý NĐ 13 | `consentedAt` null | không gọi memberships; CTA → `/tao-btc` (màn đó chuyển sang `/dong-y`) | — |
| Đã có BTC | memberships có phần tử | 2 CTA "Vào dashboard" → `/btc/{id đầu tiên}` | — |
| Lỗi tải | `me` hoặc memberships 5xx | giữ CTA mặc định theo trạng thái biết được, không hiện lỗi trên landing | — |

</frozen-after-approval>

## Code Map

- `apps/web/app/(public)/page.tsx` -- trang tạm hiện tại: xóa, chuyển sang nhóm route mới.
- `apps/web/app/(public)/layout.tsx` -- khung 480px (`max-w-content-max-buyer`); landing cần rộng hơn nên không dùng khung này.
- `apps/web/components/tickee/site-header.tsx` -- header dùng lại nguyên trạng. `stage-block.tsx` -- dùng làm nền hero và CTA cuối trang (truyền thêm class cho bo góc theo breakpoint).
- `apps/web/components/tickee/account-menu.tsx` -- mẫu query `me` và memberships (`enabled: Boolean(me.data?.consentedAt)`), cũng là mẫu cho link đăng nhập kèm `returnTo`.
- `apps/web/lib/auth/{api,return-to}.ts`, `lib/organizer/api.ts` -- `fetchMe`, `ME_QUERY_KEY`, `withReturnTo`, `LOGIN_PATH`, `fetchMemberships`, `MEMBERSHIPS_QUERY_KEY`.
- `packages/contracts/src/organizer.ts:117-119` -- `CREATE_ORGANIZATION_PATH`, `organizationDashboardPath`.
- `apps/web/app/globals.css` -- token `--spacing-content-max-buyer: 480px` (:226), `--text-display: 40px` (:164). Thêm token chiều rộng tối đa của landing tại đây.
- `apps/web/app/layout.tsx:20` -- metadata gốc ("Mua vé sự kiện"); `/` ghi đè ở page.
- `apps/web/app/(dashboard)/tao-btc/create-organization-form.tsx` -- đã tự chuyển khách sang đăng nhập và người chưa đồng ý sang `/dong-y`. Không sửa file này.
- `apps/web/e2e/{identity-mock,organizer-mock,fixtures}.ts` -- `mockIdentityApi`, `me`, `unauthenticated`, `mockOrganizerApi`, `ORG_ID`. Ví dụ dùng: `create-organization.spec.ts`. `theme.spec.ts:54` và `login-google.spec.ts:146` có mở `/`: không phụ thuộc nội dung, vẫn phải pass.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/app/globals.css` -- thêm `--spacing-content-max-landing: 1120px` -- khung landing rộng hơn trang Người mua.
- [x] `apps/web/app/(landing)/layout.tsx` -- tạo khung: `SiteHeader` + `main` trong container `max-w-content-max-landing`, lề `px-gutter-mobile` (mở rộng ở `md`) -- tách khỏi khung 480px.
- [x] `apps/web/app/(landing)/page.tsx` (+ xóa `app/(public)/page.tsx`) -- trang Server Component: hero, value-tile, hành trình, Closed Beta, CTA cuối, `metadata`.
- [x] `apps/web/app/(landing)/landing-cta.tsx` -- client component hiện thực luật CTA, nhận `className` để dùng ở hai chỗ.
- [x] `apps/web/e2e/landing.spec.ts` -- phủ mọi dòng của matrix. Thêm: khách bấm CTA rồi đăng nhập OTP (mock) thì vào `/tao-btc`; có 4 value-tile; "Xem cách hoạt động" cuộn tới section hành trình; 320px không cuộn ngang. Chạy cả hai project.

**Acceptance Criteria:**
- Given khách mở `/` với JS tắt, then thấy đủ hero, 4 value-tile, các section và CTA dẫn tới đăng nhập.
- Given `pnpm turbo build typecheck lint:deps test` và `pnpm --filter @tickee/web test:e2e`, then tất cả pass, kể cả e2e hiện có.

## Implementation Notes

- Build production để chạy e2e cần `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001` (`.env.development` không được nạp khi `next build`); CI đặt sẵn. Thư mục `.next/dev` cũ của dev server còn tham chiếu `(public)/page.tsx` đã xóa, nên phải xóa `.next/dev` và `.next/types` thì typecheck mới qua.
- Test 5xx giới hạn kiểm `role="alert"` trong `main`, vì Next luôn render route announcer `role="alert"` rỗng.

## Spec Change Log

## Review Triage Log

Pass 1 (02/11/2026, 3 lớp: blind-hunter BH, edge-case-hunter EC, verification-gap VG).

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | BH, EC | CTA coi memberships đang tải/lỗi là "chưa có BTC": Owner thấy "Đăng ký Closed Beta" thoáng qua, bấm lúc đó vào `/tao-btc` | low | Nhánh lỗi đúng matrix đã chốt (lỗi → `/tao-btc`); lúc đang tải chỉ kéo dài một request; HTML server phải có CTA mặc định nên nhãn luôn đổi một lần; tạo thêm BTC là thao tác hợp lệ; sửa phải thêm trạng thái chờ | reject |
| 2 | VG, BH, EC | Test "me 5xx" và "memberships 5xx" khẳng định khi query còn đang retry (2 lần, ~3 giây), chưa vào trạng thái lỗi | medium | Gap đã kiểm sẵn: `retry.ts:8`; href mặc định trùng href mong đợi nên assertion qua ngay ở trạng thái pending | patch |
| 3 | VG, EC | Test khách, memberships rỗng, chưa đồng ý khẳng định trước khi response được áp; `toHaveLength(0)` chỉ kiểm một lần | medium | Gap đã kiểm sẵn: cùng gốc với #2 (không chờ trạng thái ổn định) | patch |
| 4 | VG | Không test nào kiểm chỉ có một lần gọi `me` và memberships mỗi lần tải trang | low | Gap đã kiểm sẵn: chỉ có `toBeGreaterThan(0)` | patch |
| 5 | BH | `TOTP_REQUIRED` trên memberships: dialog đè landing, CTA dẫn sai | false | Dialog là modal toàn cục có từ 2.2 (`totp.spec.ts:153`), CTA không bấm được khi dialog mở; qua lớp hai thì `providers.tsx:92` tải lại query bị chặn nên CTA cập nhật đúng | reject |
| 6 | BH, EC | Người đã đăng nhập bấm CTA trước khi `me` tải xong phải đăng nhập lại | low | Có thật nhưng chỉ trong khoảng trước khi `me` về; Design Notes đã chấp nhận; sửa phải thêm chuyển hướng ở màn đăng nhập | reject |
| 7 | BH | Comment `(public)/layout.tsx` còn ghi "trang chủ" | low | Trang chủ đã chuyển sang `(landing)`; sửa comment | patch |
| 8 | BH | `LandingLayout` chép `PublicLayout`, dễ lệch nhau | low | Hai file khoảng 10 dòng, chỉ khác max-width; gộp là thêm cấu trúc | reject |
| 9 | BH | Landing không có footer (chính sách dữ liệu, liên hệ) | low | Không có trong UX/epic; chính sách dữ liệu hiện ở màn đồng ý trước khi tạo BTC; thêm footer là thêm component | reject |
| 10 | BH | Metadata thiếu `openGraph`; title "Tickee · …" ngược mẫu "X · Tickee" của các trang khác | low | Đúng: `dang-nhap`, `tao-btc` dùng "X · Tickee"; Next không tự sinh thẻ `og:` từ title | patch |
| 11 | BH | Copy lặp "tiền về thẳng tài khoản"; bước 2 đổi từ "của bạn" sang "của BTC" | low | Lặp giá trị chính là chủ ý; đổi ngôi trong một thẻ là lỗi chữ thật | patch |
| 12 | BH | Section Closed Beta thiếu thời gian duyệt/liên hệ; câu nối bằng dấu phẩy | low | Thời gian duyệt và kênh liên hệ chưa có trong PRD nên không viết được; câu nối phẩy sửa trực tiếp | patch |
| 13 | BH | `<ol>`/`<ul>` mất ngữ nghĩa danh sách trên Safari/VoiceOver vì `list-style: none` | low | Hành vi WebKit đã biết, ios-webkit là target; thêm `role="list"` | patch |
| 14 | BH | Nút phụ ghi đè class thay vì dùng variant; `lg:text-[56px]` hard-code | low | Chỉ một chỗ dùng; 56px là `[ASSUMPTION]` trong DESIGN.md; thêm variant/token là thêm public surface | reject |
| 15 | BH | `className` của `LandingCta` không dùng; CTA cuối không full width ở mobile như hero | low | Hero kéo giãn trong `flex-col`, CTA cuối `items-start`; truyền `w-full sm:w-auto` | patch |
| 16 | BH, EC | `Item.body` tùy chọn nên bước thiếu `body` render `<p>` rỗng | low | Hiện không bước nào thiếu; tách kiểu là sửa trực tiếp | patch |
| 17 | EC | Đăng nhập tài khoản khác trong cùng tab mà không đăng xuất: cache memberships của tài khoản trước còn 30 giây, "Vào dashboard" trỏ BTC của người khác | low | `login-form.tsx:164` chỉ invalidate `me`; `AccountMenu` có cùng lỗi từ trước; server vẫn chặn truy cập | defer |

## Design Notes

Nhóm route `(landing)` riêng thay vì nới khung `(public)`: các trang đăng nhập, đồng ý và bảo mật vẫn giữ cột 480px. CTA là island client nhỏ để phần còn lại render tĩnh, đáp ứng yêu cầu nhẹ và nhanh trên 4G. Đích mặc định ở SSR là màn đăng nhập. Nếu người đã đăng nhập bấm CTA trước khi `me` tải xong, màn đăng nhập vẫn chạy và dẫn đúng `returnTo`.

## Verification

**Commands:**
- `pnpm turbo build typecheck lint:deps test` -- expected: tất cả pass.
- `pnpm --filter @tickee/web test:e2e` -- expected: pass trên `ios-webkit` và `android-chromium`.
