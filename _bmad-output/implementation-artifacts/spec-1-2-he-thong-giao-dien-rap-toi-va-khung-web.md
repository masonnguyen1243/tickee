---
title: 'Story 1.2: Hệ thống giao diện "Rạp tối" và khung web'
type: 'feature'
created: '2026-10-28'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '30ac88d520dbf1939b780fd8186d1a4d70ccec5a'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-tickee-2026-10-27/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `apps/web` mới là trang Next.js trống. Story 1.3 trở đi cần token giao diện, component dùng chung, cấu trúc route và API client chung; thiếu nền này mỗi màn sẽ tự dựng một kiểu và dễ vi phạm luật màu/AA của DESIGN.md.

**Approach:** Dựng hệ thống giao diện "Rạp tối" trong `apps/web` trên Tailwind 4 + shadcn/ui đúng DESIGN.md (màu light/dark theo hệ thống, Be Vietnam Pro, bo góc/spacing/elevation, 8 component dùng chung, wordmark), kèm khung web (route groups, API client typed từ `packages/contracts`, TanStack Query, Sonner) và Playwright hai project mobile chạy trong CI.

## Boundaries & Constraints

**Always:**
- Giá trị màu, typography, rounded, spacing, elevation lấy đúng frontmatter và § Colors / Elevation của DESIGN.md. Light/dark chỉ theo `prefers-color-scheme`; không công tắc theme, không `next-themes`.
- Coral `brand` chỉ trên nền tối; chữ trên coral là `on-brand`; lỗi dùng `danger-text`, không dùng coral.
- Nút gọi mạng (`loading`): spinner trong nút, giữ độ rộng, bỏ qua bấm lặp, `aria-busy`; không `disabled` khi loading.
- WCAG 2.2 AA: focus ring 2px `--ring` offset 2px chỉ qua `:focus-visible`; `lang="vi"`; `prefers-reduced-motion` tắt animation/transition; 320px không cuộn ngang; ô nhập 16px.
- Mọi chuỗi giao diện tiếng Việt. Phiên bản theo bảng Stack (Tailwind 4.3.3, TanStack Query 5.105.0, Playwright 1.64.1, Vitest 5.0.5, Zod 4.6.7).
- Hàm định dạng tiền nằm trong `packages/contracts` để web và email (Epic 3) dùng chung.

**Never:**
- Không màn đăng nhập, `otp-input`, `google-signin-button` (Story 1.3/1.4); không component bề mặt riêng (event-hero, purchase-bar, …).
- Không driver DB, không secret, không import từ `apps/api` trong `apps/web`.
- Không tùy biến component shadcn ngoài token (trừ thay `next-themes` trong Sonner bằng `theme="system"`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tiền | `formatVnd(300000)`, `0`, `1234567` | `"300.000đ"`, `"0đ"`, `"1.234.567đ"` | số âm/không nguyên/NaN → ném `RangeError` |
| Theme | trình duyệt `colorScheme: dark` | `--background` = `#0B0809`, `--primary` = `#FF4D6A` | — |
| Nút loading | bấm 2 lần khi `loading` | `onClick` chỉ chạy 0 lần thêm; độ rộng không đổi | — |
| API lỗi | `/v1/...` trả 4xx/5xx dạng lỗi chuẩn | client ném `ApiError` có `code`, `message`, `details` | body không đúng schema → `ApiError` code `INTERNAL_ERROR` |
| API mạng | fetch reject | `ApiError` code `SERVICE_UNAVAILABLE` | — |
| Trang UI kit | `TICKEE_UI_KIT` khác `1` | `/ui-kit` trả 404 | — |

**Quyết định (28/10/2026):**
- Trang `/ui-kit` hiển thị đủ component và tone để Playwright kiểm; chỉ bật khi env `TICKEE_UI_KIT=1`, production không đặt nên trả 404.
- "API client typed sinh từ contracts" = client nhận schema Zod của contracts để kiểm response và suy kiểu; không dùng codegen OpenAPI.
- Trang chủ tạm: header wordmark + một `stage-block` giới thiệu ngắn; landing thật thuộc Story 2.3.

</frozen-after-approval>

## Code Map

- `apps/web/app/layout.tsx`, `app/page.tsx` -- có từ 1.1 (`lang="vi"`, trang trống); layout giữ và mở rộng, `page.tsx` chuyển vào `(public)`.
- `apps/web/package.json`, `tsconfig.json`, `next.config.ts` -- thêm dependency/script; tsconfig thêm alias `@/*`.
- `packages/contracts/src/{errors,index}.ts` -- `ErrorCode`, `ErrorResponse` (Zod) dùng cho `ApiError`; thêm `money.ts`, export từ `index.ts`. Contracts chưa có test runner.
- `turbo.json` -- `lint:deps.inputs` chỉ có `src/**`; thêm thư mục web.
- `.github/workflows/ci.yml` -- một job `ci`; thêm bước Playwright sau Vitest.
- `apps/api/**` -- không đụng.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/money.ts` + test Vitest -- `formatVnd` theo matrix; thêm `vitest` và script `test`.
- [x] `apps/web/package.json`, `components.json`, `postcss.config.mjs` -- Tailwind 4 (`@tailwindcss/postcss`), shadcn (style new-york, `cssVariables`), `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`, `sonner`, `@tanstack/react-query`, `zod`, `@playwright/test`; scripts `test:e2e`, `lint:deps`.
- [x] `apps/web/app/globals.css` -- `@theme inline` ánh xạ biến shadcn + biến riêng Tickee; `:root` light, `@media (prefers-color-scheme: dark)` dark; token typography (`text-display`…`text-code`), rounded, spacing có tên, `shadow-card` (light) / vòng `stage-line` (dark); base: focus ring, input 16px, `tabular-nums` utility, reduced-motion.
- [x] `apps/web/app/layout.tsx` -- Be Vietnam Pro qua `next/font/google` (`vietnamese`, `latin`; 400/500/700; `display: 'swap'`; `variable: '--font-sans'`), `Providers`, `Toaster`.
- [x] `apps/web/app/providers.tsx` -- `QueryClientProvider` (client component).
- [x] `apps/web/app/{(public),(buyer),(dashboard),(checkin),(admin)}/layout.tsx` -- layout tối thiểu; `(public)/page.tsx` trang chủ tạm; `(public)/ui-kit/page.tsx` theo quyết định.
- [x] `apps/web/lib/utils.ts`, `components/ui/{button,separator,sonner}.tsx` -- shadcn; `Button` variant `primary`, `primary-on-light`, `secondary`, `destructive`, `ghost`, `link` + prop `loading`.
- [x] `apps/web/components/tickee/{wordmark,stage-block,status-badge,status-banner,empty-state}.tsx` -- theo DESIGN.md § Components; badge/banner nhận `tone` và luôn có chữ; banner icon `CircleCheck`/`TriangleAlert`/`OctagonAlert`/`Info`, tối đa một `action`.
- [x] `apps/web/lib/api/{client,errors}.ts` -- `apiRequest(path, { schema, init })` gọi `NEXT_PUBLIC_API_BASE_URL` + `/v1`, `credentials: 'include'`, kiểm response bằng schema; `ApiError` theo matrix; `lib/api/server.ts` bản server chuyển tiếp cookie qua `next/headers`.
- [x] `apps/web/.dependency-cruiser.cjs` -- cấm `pg`, `drizzle-orm`, `pg-boss`, `@tickee/api` và đường dẫn `apps/api`; `turbo.json` thêm inputs `app/**`, `components/**`, `lib/**`.
- [x] `apps/web/playwright.config.ts`, `apps/web/e2e/*.spec.ts` -- project `ios-webkit` (WebKit, `devices['iPhone SE']`) và `android-chromium` (Chromium, `devices['Pixel 5']`), cả hai viewport 375×667; `webServer` = `next start` với `TICKEE_UI_KIT=1`. Test: biến màu light/dark, font, `lang`, focus-visible, 320px không cuộn ngang, nút loading, badge/banner có chữ và icon khác nhau, reduced-motion, `/ui-kit` 404 khi tắt.
- [x] `.github/workflows/ci.yml` -- cài trình duyệt (`playwright install --with-deps chromium webkit`) rồi `pnpm --filter @tickee/web test:e2e`.
- [x] `.env.example`, `README.md` -- `NEXT_PUBLIC_API_BASE_URL`, `TICKEE_UI_KIT`; lệnh chạy e2e.

**Acceptance Criteria:**
- Given `pnpm install && pnpm turbo build typecheck lint:deps`, then thành công không lỗi TS strict; một import `pg` thử trong web làm `lint:deps` đỏ.
- Given CI trên PR, when chạy Playwright, then cả hai project pass.
- Given `/ui-kit` ở light và dark, when soi bằng mắt, then không có coral trên nền sáng và mọi chuỗi là tiếng Việt.

## Implementation Notes

- `turbo.json` thêm `@tickee/web#typecheck` phụ thuộc `build`: trên `.next` trống, `next typegen` và `next build` chạy song song làm typecheck lỗi.
- `lucide-react` ghim 1.57.0 (1.63.0 ra hôm nay, vướng `minimumReleaseAgeExclude` của pnpm 12).
- Wordmark trên nền sáng dùng ô vuông `brand-text`; `tone="stage"` mới dùng coral (giữ luật coral chỉ trên nền tối).
- Thêm `components/tickee/tone.ts` (tone → class dùng chung badge/banner), `app/not-found.tsx` tiếng Việt.
- Playwright chạy hai `next start`: cổng 3100 (`TICKEE_UI_KIT=1`) và 3101 (tắt) để kiểm 404. Test focus thử Tab rồi Alt+Tab (WebKit macOS chỉ Tab qua nút khi giữ Option).
- Audit matrix: hai dòng "API lỗi"/"API mạng" chưa có test → thêm Vitest cho web (`vitest.config.mts`, `test/api-client.test.ts`, 8 test, script `test`).
- `.env.example`: `NEXT_PUBLIC_API_URL` đổi thành `NEXT_PUBLIC_API_BASE_URL`. Next chỉ đọc `.env` trong `apps/web`, README truyền biến qua dòng lệnh.
- CI: timeout job 20 → 30 phút; upload `test-results` khi Playwright lỗi. `next build` cần mạng để tải Be Vietnam Pro.

## Spec Change Log

## Review Triage Log

| # | Lớp | Finding | Verdict | Bằng chứng | Route |
|---|-----|---------|---------|-----------|-------|
| 1 | blind | Diff thiếu spec và sprint-status | false | Cố ý loại `_bmad-output` và lockfile khỏi diff review; không phải code | reject |
| 2 | blind, edge | AbortError bị đổi thành `SERVICE_UNAVAILABLE` rồi retry | medium | `client.ts` catch mọi reject của fetch → `serviceUnavailableError` | patch |
| 3 | blind | Không có timeout request | low | Đúng, nhưng sửa cần thêm tham số; chưa có consumer | reject |
| 4 | blind, edge | `content-type: application/json` đè boundary của FormData | low | Điều kiện chỉ xét `body` khác null | patch |
| 5 | blind | Server cần URL API nội bộ riêng | maybe-false | Spine đặt API ở `api.<domain>` công khai; cần topology deploy (Epic sau) để biết; nếu đúng chỉ low | reject |
| 6 | blind | Thiếu `import 'server-only'` ở `server.ts` | low | `next/headers` đã ném lỗi nếu import phía client; sửa thêm dependency | reject |
| 7 | blind, verif | `serverApiRequest`, header mặc định chưa có test | medium | Verif-gap đã kiểm: chỉ `apiRequest` được test; chưa có consumer | defer |
| 8 | blind | Thiếu `error.tsx`/`global-error.tsx` → màn lỗi tiếng Anh | medium | `ls app` không có; vi phạm "mọi chuỗi tiếng Việt" | patch |
| 9 | blind | `StatusBanner` luôn `role="status"` làm đọc dồn | false | Live region có sẵn lúc tải trang không được đọc; chỉ thay đổi nội dung mới được thông báo | reject |
| 10 | blind | Ô email ui-kit tương phản 1.05:1, thiếu `Input`/`Label` | low | Theo DESIGN.md (nền `surface-sunken`, viền khi focus); `Input` thuộc Story 1.3 | reject |
| 11 | blind, edge | `Button` không mặc định `type="button"`; `asChild` bỏ qua `loading` | low | Giống shadcn gốc; `asChild` + `loading` đã ghi chú trong JSDoc | reject |
| 12 | blind | Nút loading mất tên truy cập (chỉ còn "Đang xử lý") | medium | `invisible` gỡ nhãn khỏi cây a11y | patch |
| 13 | blind | Reduced-motion đóng băng spinner | low | Đúng như spec ("tắt animation/transition"); nút vẫn có `aria-busy` | reject |
| 14 | blind | `themeColor` lặp mã màu với globals.css | low | Đúng; chỉ ảnh hưởng màu thanh trình duyệt | reject |
| 15 | blind | Thiếu test dark cho focus ring/elevation | low | Đúng; biến dark đã kiểm ở test theme tối | reject |
| 16 | blind, edge | Kiểm độ rộng nút pass rỗng khi bounding box null | low | `undefined === undefined` | patch |
| 17 | blind, edge | Retry bỏ qua 408/429; không có onError tập trung | low | Đúng; sửa thêm nhánh, chưa có query nào | reject |
| 18 | blind | Header lặp ở not-found; thiếu title template | low | Đúng; thẩm mỹ code | reject |
| 19 | blind | `.env.example` bật `TICKEE_UI_KIT=1`; contracts đổi format `files` | low | Sửa trực tiếp một dòng | patch |
| 20 | verif | `cn()` mở rộng tailwind-merge chưa có test | medium | Verif-gap chạy `twMerge` gốc: mất `text-label`/`text-button` mà không test nào đỏ | patch |
| 21 | verif | Predicate retry không test được | medium | Inline, không export | patch |
| 22 | verif | Luật depcruise web không có fixture test | medium | api có tiền lệ `dependency-rules.test.ts`; web không | patch |
| 23 | verif, edge | Thiếu env/path sai ném `Error` thường, không phải `ApiError` | low | Lỗi cấu hình ném to là hành vi đúng | reject |
| 24 | edge | Mạng rớt khi đọc body → `INTERNAL_ERROR` | low | Hiếm; sửa thêm nhánh | reject |
| 25 | edge | 204 → `INTERNAL_ERROR` | false | Body rỗng thành `undefined`; caller truyền schema chấp nhận `undefined` | reject |
| 26 | edge | 502 HTML từ proxy → `INTERNAL_ERROR` | false | Đúng matrix: body không đúng schema → `INTERNAL_ERROR` | reject |
| 27 | edge | `credentials` của caller bị đè | low | Spec yêu cầu `credentials: 'include'` | reject |
| 28 | edge | `cookies()` ngoài request scope ném lỗi | false | Ném to khi dùng sai chỗ là đúng | reject |
| 29 | edge | Cookie caller tự truyền bị thay | low | Chưa có caller; hiếm | reject |
| 30 | edge | `lint:deps` không quét `hooks/` | low | Chưa có thư mục `hooks/` | reject |
| 31 | edge | `DB_PACKAGES` thiếu `postgres`, `kysely`, … | low | Stack chỉ dùng `pg`/Drizzle | reject |
| 32 | edge | Chuỗi tiếng Anh: "Display" ở ui-kit, nhãn a11y mặc định của Sonner | medium | `ui-kit.tsx:164`; sonner `containerAriaLabel = 'Notifications'`, `'Close toast'` | patch |

## Design Notes

`button-primary-on-light` đổi ở dark mode bằng biến, không cần JS:

```css
--btn-on-light-bg: var(--stage); --btn-on-light-fg: var(--stage-foreground);
@media (prefers-color-scheme: dark) { --btn-on-light-bg: var(--primary); --btn-on-light-fg: var(--primary-foreground); }
```

Nút loading giữ độ rộng: nhãn vẫn render nhưng `invisible`, spinner đặt `absolute` giữa nút; handler bọc `if (loading) return`.

## Verification

**Commands:**
- `pnpm install && pnpm turbo build typecheck lint:deps` -- expected: thành công.
- `pnpm --filter @tickee/contracts test` -- expected: test `formatVnd` pass.
- `pnpm --filter @tickee/web test:e2e` -- expected: hai project pass.

**Manual checks (if no CLI):**
- `TICKEE_UI_KIT=1 pnpm --filter @tickee/web start`, mở `/ui-kit` ở light và dark: đúng màu DESIGN.md, coral chỉ trên nền tối.
