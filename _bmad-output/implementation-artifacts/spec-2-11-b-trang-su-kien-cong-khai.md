---
title: 'Story 2.11-b: trang Sự kiện công khai /e/{slug}'
type: 'feature'
created: '2026-11-06'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '6692c421ba75b9a5f509c3cff060c8862422cc22'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** BTC đã mở bán và có link `/e/{slug}` nhưng web chưa có trang. Người nhận link chưa xem được Sự kiện, chưa thấy "Còn N vé", preview OG chưa có.

**Approach:** Thêm `/e/{slug}` trong `(public)`: phần tĩnh SSR từ `GET /v1/events/:slug` (cache 30 giây, tag `event:{slug}`), số vé lấy phía client từ `/availability` (2.11-a), `generateMetadata` và ảnh OG do web sinh. Revalidate ngay khi BTC sửa tách sang 2.11-c (Mason chọn 06/11).

## Boundaries & Constraints

**Always:**
- SSR fetch không cookie, `next: {revalidate: 30, tags: ['event:{slug}']}`. `404 EVENT_NOT_FOUND` → `notFound()` với `empty-state` "Không tìm thấy Sự kiện này. Kiểm tra lại link BTC gửi bạn.", không nút. Lỗi khác lên `error.tsx`.
- `event-hero` trong `StageBlock`: gradient coral trên `stage-fallback` (chưa có ảnh), eyebrow, tên `h1`, ngày-giờ "Chủ nhật, 16/11/2026 · 07:00 – 17:00" (khác ngày thì ghi đủ hai đầu), địa điểm là link Google Maps, nút chia sẻ (Web Share API, fallback `copyWithToast`). Dưới stage: hàng BTC, banner, mô tả, chính sách hoàn vé.
- `ticket-tier-row`: tên, mô tả, giá `formatVnd`. `on_sale` → "Còn N vé", N ≤ 10 thì `brand-text` đậm. Trạng thái khác dùng `ticket-tier-row-unavailable` (viền nét đứt): "Hết vé" / "Chưa mở bán · mở {ngày-giờ}" / "Đã đóng bán" / "Tạm ngừng bán" / "Không nhận Đơn". Chưa có stepper, nút Mua.
- Gọi `/availability` lúc tải và khi tab hiện lại (`visibilitychange`). Đang tải → `Skeleton`; lỗi → "Chưa tải được số vé." + "Thử lại".
- Banner theo `eventReason`, không đóng được: `cancelled` danger "Sự kiện đã hủy"; `locked` danger "Sự kiện tạm thời không nhận Đơn."; `hidden` warning "Sự kiện tạm dừng nhận Đơn"; `ended` neutral "Sự kiện đã kết thúc"; `paused` warning: còn tier `on_sale` → "Một số Hạng vé đang tạm ngừng bán.", không còn → "Sự kiện tạm ngừng bán. Bạn thử lại sau nhé." Không bao giờ hiện banner hệ thống của BTC.
- ≥ `lg`: 2 cột, trái hero + mô tả, phải Hạng vé `sticky`. `loading.tsx` là `Skeleton` stage + 2 thẻ. 320px không cuộn ngang.
- `generateMetadata`: title "{tên} · Tickee", description ngày-giờ + địa điểm, OG/twitter dùng `opengraph-image.tsx` (1200×630, tên, ngày-giờ, BTC, tiếng Việt đúng dấu). `hidden` → `noindex`.

**Never:**
- Không làm ảnh Sự kiện (2.7-b), revalidate on-demand (2.11-c), stepper/`purchase-bar`/Mua (3.1), Ẩn/Kết thúc (2.12).
- Web không chạm DB, không import `apps/api`. Không render số vé ở server.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Đang bán | tier 0đ còn 50 | Hero + "Còn 50 vé", không banner | — |
| Sắp hết | `remaining` 7 | "Còn 7 vé" `brand-text` đậm | — |
| Chưa mở | `not_started` | "Chưa mở bán · mở Thứ bảy, 15/11/2026 · 08:00" | — |
| Tạm ngừng một phần | tier có phí `paused`, tier 0đ `on_sale` | Banner "Một số Hạng vé đang tạm ngừng bán." | — |
| Ẩn | `hidden` | 200, banner warning, tier "Không nhận Đơn", `noindex` | — |
| Nháp / slug sai | `draft` / không có | `empty-state`, HTTP 404 | — |
| Availability lỗi | 503 | Giá vẫn hiện, "Chưa tải được số vé." + "Thử lại" | không ném |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/event.ts:208` `formatEventDateTime`/`vnParts`: thêm `formatEventTimeRange(startsAt, endsAt)` + test. Thêm `publicEventTag(slug)` để 2.11-c dùng lại. `formatVnd` ở `money.ts`; `PublicEvent`, `EventAvailability`, `TierSaleStatus`, `EventSaleReason` ở `sellability.ts`.
- `apps/web/lib/api/client.ts`: `performApiRequest` truyền `init` thẳng vào `fetch` nên `next` đi qua được. Không dùng `serverApiRequest` (gửi cookie, `no-store`). Thêm `API_INTERNAL_URL` server-only, tùy chọn, ưu tiên khi chạy ở server (e2e trỏ mock, production gọi nội bộ).
- `apps/web/lib/event/public-api.ts` (mới): `fetchPublicEvent(slug)` (server, có tag), `fetchAvailability(slug, signal)`, query key.
- `apps/web/app/(public)/e/[slug]/{page,loading,not-found,opengraph-image}.tsx`, `event-hero.tsx`, `ticket-tiers.tsx` (client, `useQuery` + `refetchOnWindowFocus`; kiểm `app/providers.tsx` để mặc định không tắt).
- Dùng lại: `components/tickee/{stage-block,status-banner,empty-state}.tsx`, `lib/clipboard.ts`, token `brand-text`/`stage-fallback` (`globals.css`), mẫu skeleton `organization-home.tsx:118`.
- Font OG: Be Vietnam Pro TTF (OFL) trong `apps/web/assets/fonts/`, `readFile` trong `opengraph-image.tsx`.
- e2e: `apps/web/playwright.config.ts` thêm webServer mock api (node `http`) và một `next start` có `API_INTERNAL_URL` trỏ vào đó; `/availability` phía trình duyệt mock bằng `page.route`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/event.ts` + test -- khoảng giờ, tag.
- [x] `apps/web/lib/api/client.ts`, `lib/event/public-api.ts` + test -- fetch công khai, `API_INTERNAL_URL`.
- [x] `apps/web/app/(public)/e/[slug]/*`, `assets/fonts/*` -- trang, loading, 404, OG.
- [x] `apps/web/e2e/public-event.spec.ts`, `playwright.config.ts`, mock server -- phủ matrix, 320px, 2 cột ≥ `lg`, OG `image/png`.

**Acceptance Criteria:**
- Given Sự kiện đang bán, when mở `/e/{slug}` chưa đăng nhập trên mobile, then hero, hàng BTC, Hạng vé hiện đúng.
- Given trang đang mở và số vé đổi ở server, when chuyển tab rồi quay lại, then "Còn N vé" cập nhật không cần tải lại.
- Given chia sẻ link, when đọc thẻ meta, then có `og:title`, `og:description`, `og:image` 1200×630.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (06/11/2026, 3 lớp: blind-hunter BH, edge-case-hunter EC, verification-gap VG).

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | BH, EC | Font OG đọc bằng `process.cwd()` ở cấp module; thiếu file thì promise bị reject khi chưa có ai chờ | low | Có thật nếu deploy đổi cwd hoặc dùng standalone (chưa có Dockerfile web, 4.7). Sửa trực tiếp: đọc font lười trong handler | patch |
| 2 | BH, EC | `WEB_ORIGIN` không đặt ở production → `og:image` trỏ localhost; `API_INTERNAL_URL` chưa có trong tài liệu deploy | medium | `metadataBase()` trả `undefined`, Next dùng localhost. Chưa có cấu hình deploy web (Story 4.7) | defer |
| 3 | EC | `WEB_ORIGIN` sai dạng làm `new URL` ném lỗi | false | Cấu hình sai thì lỗi rõ ràng là đúng; không phải dữ liệu người dùng | reject |
| 4 | BH | `API_INTERNAL_URL` áp cho mọi lời gọi server, kể cả có cookie | low | Biến tùy chọn; cookie chỉ là header chuyển tiếp, không phụ thuộc host | reject |
| 5 | BH, EC | Làm mới khi quay lại tab bị lỗi nhưng đã có dữ liệu cũ → vẫn hiện "Còn N vé" cũ, không báo | medium | `failed = !data && isError`; TanStack giữ `data` khi refetch lỗi. Trái matrix "Availability lỗi" | patch |
| 6 | BH | Hạng vé có trong HTML cache nhưng thiếu ở `/availability` trông như đang bán | low | Chưa có stepper/nút Mua (3.1) nên không mua được; chỉ lệch tối đa 30 giây | reject |
| 7 | BH | Không có `error.tsx` cho lỗi khác 404 | false | `apps/web/app/error.tsx` có sẵn ở gốc và bắt lỗi của segment con | reject |
| 8 | BH, VG | Nhánh fallback sao chép link của nút chia sẻ chưa có test | medium | VG gap: xóa `copyWithToast` vẫn pass | patch |
| 9 | BH | Thiếu e2e cho venue null, mô tả null, 0 Hạng vé, nhiều ngày, banner cancelled/locked/ended | low | Banner và khoảng giờ đã có unit test (`public-event.test.ts`, contracts); phần còn lại là ẩn/hiện đơn giản | reject |
| 10 | BH | Ảnh OG không cache riêng, chưa thử tên rất dài | low | Phần dữ liệu đã cache 30 giây; tên giới hạn bởi schema | reject |
| 11 | BH | noindex trễ tới 30 giây; route ảnh OG của Sự kiện ẩn không có `X-Robots-Tag` | low | Trễ đã ghi ở Design Notes, 2.11-c xử lý; ảnh OG không phải trang lập chỉ mục | reject |
| 12 | BH, EC | Cổng mock 3199 khai báo hai nơi | low | Sửa trực tiếp: `playwright.config.ts` import hằng từ `e2e/public-event-api.ts` | patch |
| 13 | BH | Màu OG chép tay; dấu chấm cuối banner không đều; skeleton lệch tỉ lệ hero; "Đang tải số vé" không ở live region | low | Copy banner theo đúng EXPERIENCE; các mục khác là thẩm mỹ, ít gặp | reject |
| 14 | VG | Test 2 cột vẫn pass khi khung không nở rộng | medium | VG gap: bỏ biến thể `has-[…]` thì hero co còn ~32px mà 3 assert vẫn đúng | patch |
| 15 | VG | Ảnh OG của slug nháp/sai trả 404 chưa có test | low | VG đề xuất defer; sửa chỉ là thêm một request trong spec có sẵn | patch |
| 16 | EC | `on_sale` với `remaining` 0 hiện "Còn 0 vé" | false | `sellability.ts:94` đặt `sold_out` khi `remaining === 0` | reject |
| 17 | EC | Sự kiện đã hủy vẫn được lập chỉ mục | low | Intent chỉ yêu cầu `noindex` cho Ẩn; trang hủy vẫn có banner rõ | reject |
| 18 | EC | Địa điểm chỉ có khoảng trắng | low | Schema `optionalText` cắt khoảng trắng khi lưu | reject |
| 19 | EC | Mock server ném khi slug có `%` hỏng | low | Chỉ là mock e2e, test không gửi slug như vậy | reject |

## Design Notes

- **Hai tầng cache:** HTML tĩnh cũ tối đa 30 giây, số vé tối đa 2 giây, nên số vé không bao giờ render ở server.

## Verification

**Commands:**
- `pnpm turbo build typecheck lint:deps test` -- expected: pass.
- `pnpm --filter @tickee/web test:e2e` -- expected: pass, gồm `public-event.spec.ts`.

**Manual checks:**
- `/e/{slug}` ở 320px và 1280px, light/dark; `/e/{slug}/opengraph-image` đúng dấu tiếng Việt.
