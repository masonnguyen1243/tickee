---
title: 'Story 3.1: Chọn Vé và đăng nhập khi bấm "Mua"'
type: 'feature'
created: '2026-11-09'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'ee98a26c85f97d26c628781a396319ccec0b3a13'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-tickee-2026-10-27/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Trang Sự kiện `/e/{slug}` mới chỉ liệt kê Hạng vé, chưa chọn được số lượng, chưa có nút "Mua", chưa có Checkout. `PublicEvent` thiếu `maxTicketsPerOrder` (retro C7), và chưa đo được phễu Mua → đăng nhập (SM-C2).

**Approach:** Thêm `quantity-stepper` cho từng Hạng vé đang bán và `purchase-bar` dính đáy. Lựa chọn được mã hóa vào URL Checkout `/e/{slug}/checkout?items=…`. Chưa đăng nhập thì đi qua `/dang-nhap?returnTo=<URL Checkout>`. Checkout ở 3.1 chỉ là bề mặt cần đăng nhập, hiện tóm tắt Đơn; form và "Gửi Đơn" thuộc 3.2. Ghi `buy_clicked`/`login_completed` vào bảng mới `checkout_funnel_events` của `ordering` qua endpoint công khai không PII.

## Boundaries & Constraints

**Always:**
- Định dạng lựa chọn dùng chung, nằm trong contracts: `items=<ticketTypeId>:<qty>[,…]`, mỗi qty là số nguyên 1–50, id không trùng. Bị sửa tay sai thì coi như không có lựa chọn.
- Trần "+" của một Hạng vé = min(`remaining` của hạng, `maxTicketsPerOrder` − tổng số đã chọn ở các hạng khác). Khi availability refetch làm `remaining` giảm, lựa chọn bị kẹp xuống, không bao giờ vượt.
- Chỉ Hạng vé `on_sale` có stepper. Các hạng khác giữ dạng unavailable của 2.11.
- Đổi giới hạn Vé/Đơn thì enqueue revalidate trang công khai trong cùng `tx` (sự kiện khác nháp), giống các update khác ở `event.service.ts`.
- `checkout_funnel_events` không có PII và không có `user_id`. Bảng append-only. Chỉ nối hai sự kiện bằng `funnel_id` (uuid do trình duyệt sinh).
- Gửi sự kiện phễu kiểu fire-and-forget (`keepalive`). Lỗi gửi không bao giờ chặn điều hướng.

**Never:**
- Không giữ chỗ, không tạo Đơn, không làm form mua, không có nút "Gửi Đơn". Không biến thể `sellability` lúc đặt Đơn (C4), không `serverNow` (D4), không snapshot chính sách hoàn vé (C3), không câu hỏi form công khai: tất cả thuộc 3.2/3.4. Nhãn dashboard theo `sellability` (C5) thuộc 3.11/4.2.
- Không giới hạn tốc độ theo IP cho endpoint phễu ở story này (ghi vào `deferred-work.md`, gắn 4.6).
- Không lưu lựa chọn trong localStorage/cookie. URL là nguồn duy nhất (AD-19).
- `ordering` không import `identity` (module-graph).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Chọn nhiều hạng | Hạng A còn 3, B còn 20, giới hạn 4; chọn A=3 | "+" của A tắt (hết chỗ); "+" của B tắt ở 1; thanh "Tổng · 4 vé" + tổng tiền | N/A |
| Chưa chọn | Tổng 0 vé | Nút tắt + "Chọn vé để tiếp tục" | N/A |
| Sự kiện miễn phí | Mọi Hạng vé giá 0, chọn 2 | Tổng "Miễn phí", nút "Đăng ký"; hàng giá hiện "Miễn phí" | N/A |
| Hết sạch | Mọi Hạng vé `sold_out` | Thanh thay bằng thông báo "Hết vé" | N/A |
| Không hạng nào bán được | Không có hạng `on_sale`, không phải hết sạch | Không có thanh (banner 2.11 đã giải thích) | N/A |
| Chưa đăng nhập bấm Mua | Chọn A=2 | `buy_clicked` (`loginRequired: true`) → `/dang-nhap?returnTo=/e/{slug}/checkout?items=A:2&f=<uuid>`; OTP/Google/đồng ý xong → Checkout đúng A=2; ghi `login_completed`, bỏ `f` khỏi URL | Gửi phễu lỗi → vẫn điều hướng |
| Đã đăng nhập bấm Mua | `ME` có dữ liệu | `buy_clicked` (`loginRequired: false`) → thẳng Checkout, không có `f` | như trên |
| Mở Checkout khi chưa đăng nhập | Vào thẳng URL Checkout | Chuyển `/dang-nhap?returnTo=<URL hiện tại kèm query>` | N/A |
| `items` sai | Id lạ, qty ≤ 0/không nguyên, tổng > giới hạn, Sự kiện không bán | Checkout chuyển về `/e/{slug}` | N/A |
| Quay lại sửa | "Sửa lựa chọn" ở Checkout | `/e/{slug}?items=…` → stepper điền sẵn (đã kẹp theo availability) | `items` sai → bỏ qua |
| Endpoint phễu | `login_completed` không có `buy_clicked` cùng `funnel_id`; gửi trùng | Bỏ qua, 204; trùng `(funnel_id, type)` → 204, không thêm dòng | slug lạ/nháp → 404 `EVENT_NOT_FOUND`; body sai → 400 |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/sellability.ts:15-28` -- `PublicEvent`: thêm `maxTicketsPerOrder`. Hằng ở `event.ts:117-119`.
- `packages/contracts/src/identity.ts:85` -- `safeReturnTo` giữ query, không có allowlist hay độ dài tối đa; dùng nguyên.
- `packages/contracts/src/money.ts:5` -- `formatVnd`.
- `apps/api/src/modules/event/public-event.ts:77-104` -- mapper `publicEventDetail`: map thêm `maxTicketsPerOrder`.
- `apps/api/src/modules/event/event.service.ts:224-250` -- `updateOrderLimit`: thêm enqueue theo mẫu `:189,:214` (`publicPageQueues.ready()` + `enqueuePublicPageRevalidation`).
- `apps/api/test/event/public-page-job.test.ts:143-157` -- test đang ghim "đổi giới hạn → không job": lật lại.
- `apps/api/src/modules/ordering/` -- `schema.ts`, `index.ts`, `ordering.module.ts`, `public-availability.controller.ts` (mẫu controller `@Public`). Tra Sự kiện qua `index.ts` của `event`.
- `apps/api/src/platform/db/columns.ts`, `platform/db/grants.ts:9` (`APPEND_ONLY_TABLES`), `platform/audit/schema.ts:9` -- mẫu bảng append-only. Migration kế tiếp `0015` (`pnpm --filter api db:generate`).
- `apps/api/test/ordering/sellability.test.ts` + `test/identity/harness.ts:78` (`createHarness`) -- mẫu test endpoint công khai với Postgres thật.
- `apps/web/app/(public)/e/[slug]/page.tsx:94-98`, `ticket-tiers.tsx` (`TicketTiers` L56, `useAvailability` L16, `TierStatus` L34) -- chỗ gắn stepper và thanh. `lib/event/public-sale.ts` (`tierStatusText`), `lib/event/public-api.ts` (`fetchPublicEvent`, `fetchAvailability`).
- `apps/web/lib/auth/api.ts:18,28` (`ME_QUERY_KEY`, `fetchMe`), `lib/auth/return-to.ts:21,62` (`withReturnTo`, `LOGIN_PATH`). `use-go-to-login.ts` bỏ query nên không dùng được cho Checkout.
- `apps/web/app/(buyer)/layout.tsx` -- layout giữ chỗ cho bề mặt Người mua.
- `apps/web/components/tickee/bottom-tab-bar.tsx:62` -- mẫu `fixed` + `env(safe-area-inset-bottom)`. Token `--spacing-stepper-button`, `--bar`, `--text-total` trong `globals.css`. Specs UX: `DESIGN.md:597-607`, `EXPERIENCE.md:160-162`.
- `apps/web/e2e/public-event-api.ts` (fake SSR, cần `maxTicketsPerOrder`), `e2e/public-event.spec.ts:31` (`mockAvailability`), `e2e/identity-mock.ts:10` (CORS hard-code cổng 3100, phải tham số hóa origin cho server 3102).

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/sellability.ts`, `src/checkout.ts` (mới), `src/index.ts` -- thêm `PublicEvent.maxTicketsPerOrder`; tạo `checkoutPath(slug)`, `parseSelection`/`serializeSelection` (Zod), `FUNNEL_EVENT_TYPES`, `FunnelEventInput` -- nguồn chung cho web, API và 3.2.
- [x] `packages/contracts/test/checkout.test.ts` -- test parse/serialize: hợp lệ, trùng id, qty sai, chuỗi rác.
- [x] `apps/api/src/modules/event/public-event.ts`, `event.service.ts`, `test/event/public-page-job.test.ts` -- map giới hạn; enqueue revalidate khi đổi giới hạn; lật test.
- [x] `apps/api/src/modules/ordering/schema.ts` + migration `0015` + `platform/db/grants.ts` -- bảng `checkout_funnel_events` (`id`, `event_id` FK, `type` CHECK, `funnel_id` uuid, `login_required` boolean null, `created_at`), unique `(funnel_id, type)`, append-only.
- [x] `apps/api/src/modules/ordering/funnel.controller.ts` (+ service, đăng ký module) -- `POST /v1/events/:slug/funnel-events` `@Public` → 204; luật trong Matrix.
- [x] `apps/api/test/ordering/funnel.test.ts` -- các dòng endpoint phễu trong Matrix; kiểm `GET /v1/events/:slug` có `maxTicketsPerOrder`.
- [x] `apps/web/lib/event/selection.ts` + `test/selection.test.ts` -- hàm thuần: trần "+", kẹp lựa chọn theo availability/giới hạn, tổng vé/tiền, hợp lệ hóa `items` theo `PublicEvent`.
- [x] `apps/web/components/tickee/quantity-stepper.tsx`, `purchase-bar.tsx` -- component theo DESIGN; aria-label "Giảm/Tăng số vé {Hạng vé}"; thanh dùng lại được ở Checkout.
- [x] `apps/web/app/(public)/e/[slug]/ticket-tiers.tsx`, `page.tsx`, `lib/event/funnel.ts` -- state lựa chọn (điền sẵn từ `?items=`, bọc `Suspense`), dòng "Tối đa N vé mỗi Đơn", giá 0 hiện "Miễn phí", thanh + `scroll-padding-bottom`, luồng bấm Mua + gửi phễu.
- [x] `apps/web/app/(buyer)/layout.tsx`, `(buyer)/e/[slug]/checkout/page.tsx` (+ client con) -- layout có `SiteHeader`; server tải `PublicEvent`, `items` sai → `redirect('/e/{slug}')`; client chặn chưa đăng nhập, gửi `login_completed` khi có `f` rồi `router.replace` bỏ `f`; tóm tắt Đơn + "Sửa lựa chọn".
- [x] `apps/web/e2e/purchase.spec.ts` (+ sửa `identity-mock.ts`, `public-event-api.ts`) -- stepper/trần/aria, các trạng thái thanh, Mua khi chưa và đã đăng nhập, Checkout chặn chưa đăng nhập, `items` sai.

**Acceptance Criteria:**
- Given đăng nhập bằng OTP hoặc Google (kể cả qua `/dong-y`) từ "Mua", when xong, then trang Checkout hiện đúng Hạng vé, số lượng, tổng như đã chọn.
- Given thanh hiện trên 375×667, when focus bằng bàn phím vào stepper cuối danh sách, then phần tử đó không bị thanh che; thanh không che nội dung cuối trang.
- Given BTC đổi giới hạn Vé/Đơn của Sự kiện đang bán, when job chạy, then trang công khai được revalidate.

## Implementation Notes

- Quyết định ngoài spec (subagent triển khai):
  - Bảng có thêm CHECK: `login_required` khác null đúng khi `type = 'buy_clicked'`.
  - `login_completed` chỉ ghi khi đã có `buy_clicked` cùng `funnel_id` **và cùng Sự kiện**.
  - `checkoutSelection` kiểm theo phần tĩnh: Sự kiện `published`, chưa qua `effectiveEndAt`, Hạng vé đã chọn đang trong giờ bán. Hết chỗ, tạm ngừng bán, khóa, kết thúc sớm tay thì để `sellability` của 3.2 kiểm.
  - Bấm "Mua" thì `history.replaceState` đưa `?items=` lên URL trang Sự kiện, để Back về vẫn còn lựa chọn.
  - `TOTP_REQUIRED` được tính là đã đăng nhập: dialog lớp hai toàn cục mở ở Checkout.
  - Stepper dùng `aria-disabled` chứ không dùng `disabled`, nên focus vẫn ở nút khi chạm giới hạn.
- `scroll-padding-bottom` và padding đáy đặt trong `globals.css`, theo `:has([data-slot='purchase-bar'])`, chỉ áp dưới `lg`.
- Rủi ro deploy:
  - Web bắt buộc `maxTicketsPerOrder` trong `PublicEvent`, nên phải deploy API trước web.
  - Không mang `.next/cache/fetch-cache` cũ qua các lần deploy.
- Đã ghi `deferred-work.md`: giới hạn tốc độ theo IP cho endpoint phễu (4.6).

## Spec Change Log

## Review Triage Log

Vòng 1 (review_loop_iteration 0). Nguồn: BH = Blind Hunter, EC = Edge Case Hunter, VG = Verification Gap.

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | BH | `funnel_id` NOT NULL, `f` bị bỏ và người đã đăng nhập không có `f`, nên 3.2/3.5 không nối được `order_created`/`paid`; CHECK `type` viết cứng | low | Đúng: 3.2 phải thêm migration và mang funnel id qua Checkout. Nhưng ở 3.1 không có kết quả sai, và cách sửa là đổi spec (bỏ "bỏ `f`", "không có `f`") | reject (sửa = đổi spec); ghi chú cho 3.2 |
| 2 | BH, EC | `needsLogin` coi lỗi mạng/5xx của `me` là chưa đăng nhập → người đã đăng nhập bị đưa tới `/dang-nhap`, phễu ghi `loginRequired: true` | low | `ticket-tiers.tsx:100-102` `return !isTotpRequired(error)`; `shouldRetryQuery` thử lại 2 lần rồi ném lỗi 5xx | patch |
| 3 | BH | Checkout `redirect('/e/{slug}')` bỏ lựa chọn, bỏ `f`, không báo lý do khi lựa chọn hết hợp lệ trong lúc đăng nhập | low | Đúng như mô tả, nhưng chỉ xảy ra khi giờ bán/giới hạn đổi trong lúc đăng nhập. Sửa phải thêm tham số thông báo và cứu lựa chọn; Matrix ghi "về `/e/{slug}`" | reject (hiếm, sửa thêm nhánh) |
| 4 | BH, EC | `history.replaceState` thay cả URL, mất `utm_*` và hash | low | `ticket-tiers.tsx:113` dựng chuỗi mới từ `eventPagePath` | patch |
| 5 | BH, EC, VG | `pending` của `useBuy` không bao giờ trả về false: nút "Mua" quay mãi nếu Checkout redirect về `/e/{slug}` mà `TicketPicker` không mount lại | maybe-false | Không xác định được App Router có mount lại page khi redirect server từ `/e/{slug}/checkout` về `/e/{slug}` hay không; cần thử trên trình duyệt. `me` treo thì `shouldRetryQuery` giới hạn 2 lần, không treo mãi | defer (chưa kiểm, nếu đúng: medium) |
| 6 | BH | Lựa chọn bị kẹp xuống khi refetch mà không báo | low | Đúng, nhưng chỉ khi số vé còn tụt dưới số đã chọn lúc quay lại tab; sửa phải thêm UI thông báo | reject |
| 7 | BH | "+" `aria-disabled` không có lý do cho trình đọc màn hình; dòng "Tối đa N vé mỗi Đơn" không nối `aria-describedby` | low | `quantity-stepper.tsx` không có `aria-describedby`; dòng ghi chú `order-limit-note` không có `id` | patch |
| 8 | BH, EC | Khoảng chừa cố định 70px + 20px trong khi thanh chỉ có `min-h`, phóng chữ thì thanh cao hơn | low | Đúng khi bật cỡ chữ lớn; nút và đệm tính bằng px nên thanh chỉ cao thêm vài px; sửa cần ResizeObserver | reject |
| 9 | BH | `env(safe-area-inset-bottom)` vô tác dụng vì `viewport` không có `viewportFit: 'cover'` | false | Không có `cover` thì Safari tự giữ trang ngoài vùng không an toàn (inset = 0 vì nội dung không tràn xuống thanh home), nên thanh không bị che; cùng mẫu với `bottom-tab-bar.tsx:62` đã có | reject |
| 10 | BH | `PublicEvent.maxTicketsPerOrder` bắt buộc làm web và API phải deploy theo thứ tự | low | Đúng, đã ghi ở Implementation Notes; chưa có staging/production (4.7); cache cũ chỉ hỏng lần đầu rồi tự revalidate | reject |
| 11 | BH | Endpoint phễu nhận cả Sự kiện ẩn, hủy, đã kết thúc | low | `publicEventBySlug` chỉ chặn nháp; Matrix chỉ đòi 404 cho slug lạ/nháp; chỉ là dữ liệu rác cùng nhóm rủi ro đã hoãn sang 4.6 | reject |
| 12 | BH | Chưa có đường đọc dữ liệu phễu để tính SM-C2 | false | 3.1 chỉ ghi dữ liệu; `reporting` đọc qua read model ở story báo cáo; không có kết quả sai trong story này | reject |
| 13 | BH | Nhánh `TOTP_REQUIRED`, `me` 5xx khi bấm Mua, `f` sai dạng, redirect sau đăng nhập chưa có test | low | `me` 5xx gộp vào #2 (thêm test cùng bản sửa). Các nhánh còn lại là đường phụ, rủi ro thấp | patch phần `me` 5xx (gộp #2); reject phần còn lại |
| 14 | BH | Spec ghi `in-review` nhưng sprint-status vẫn `in-progress` | false | Bước trình bày của workflow sẽ đồng bộ sprint-status; lệch tạm thời là đúng quy trình | reject |
| 15 | BH | `parseSelection` không giới hạn số dòng | false | Độ dài URL bị server giới hạn (~8KB → tối đa khoảng 200 dòng); Zod trên chừng đó là không đáng kể | reject |
| 16 | EC | `me` refetch 401 sau khi hết phiên, TanStack giữ `me.data` cũ → `useBuy` ghi `loginRequired: false`, không có `f` | low | `ticket-tiers.tsx:96` `if (me.data) return false`; sửa trực tiếp `me.data && !me.isError` | patch |
| 17 | EC | Đổi stepper trong lúc `buy()` chờ `needsLogin` → Checkout mang lựa chọn cũ | low | Cửa sổ chỉ bằng một lượt gọi `me`; sửa phải thêm khóa cho stepper | reject |
| 18 | EC | Checkout không biết "Kết thúc" tay (`endedManuallyAt` không có trong `PublicEvent`) | low | Đúng; chỉ tới được khi BTC bấm Kết thúc trong lúc Người mua đăng nhập; 3.1 Checkout chỉ hiện tóm tắt, 3.2 kiểm `sellability`; sửa phải thêm trường công khai | reject |
| 19 | EC | ≥ lg, nhiều Hạng vé làm cột phải cao hơn màn hình, thanh nằm dưới màn | low | Thanh vẫn tới được khi cuộn hết cột; cần nhiều Hạng vé trên màn thấp; sửa là đổi bố cục | reject |
| 20 | EC | `updateOrderLimit` chờ `publicPageQueues.ready()` cả với Sự kiện nháp | false | Cùng mẫu với `update()` ở `event.service.ts:189` mà mọi lần sửa Sự kiện đều đi qua; pg-boss chạy trên cùng Postgres nên không thêm kiểu lỗi mới | reject |
| 21 | VG | Bấm Enter vào "+" ở trần chưa được kiểm (bỏ guard `canIncrease &&` không test nào fail) | medium | Gap đã kiểm sẵn; e2e chỉ dùng `toBeDisabled()` | patch (thêm test) |
| 22 | VG | `CheckoutGate` chuyển `/dong-y` cho người đã đăng nhập mà chưa đồng ý chưa được kiểm | medium | Gap đã kiểm sẵn; test đồng ý duy nhất bắt đầu từ trạng thái chưa đăng nhập | patch (thêm test) |
| 23 | VG | Trạng thái lỗi của `CheckoutGate` (`me` lỗi khác 401) chưa được kiểm | medium | Gap đã kiểm sẵn. Bản sửa #2 đưa người dùng tới đúng nhánh này khi `me` 5xx, nên kiểm luôn | patch (gộp #2) |

## Design Notes

- Vì sao phễu không có `user_id`: SM-C2 = tỉ lệ bấm Mua mà không đăng nhập xong, chỉ cần nối `buy_clicked` ↔ `login_completed`. `login_required` cho phép loại người đã đăng nhập sẵn khỏi mẫu số. `login_completed` cần `buy_clicked` có trước nên bơm rác phải đi theo cặp.
- Vì sao Checkout nằm ở `(buyer)` và `/e/{slug}/checkout`: Người mua dùng slug tiếng Anh (`/e`, `/orders`). Phiên ở origin API, server web không đọc được, nên chặn đăng nhập nằm ở client (`ME_QUERY_KEY`), còn hợp lệ hóa `items` nằm ở server.
- Thanh mua: < `lg` thì `fixed`, cách mép 10px + safe-area, trang có padding đáy bằng chiều cao thanh. ≥ `lg` thì nằm dưới danh sách Hạng vé trong cột phải đang sticky.

## Verification

**Commands:**
- `pnpm test` -- pass (contracts, api với Postgres test, web vitest)
- `pnpm typecheck && pnpm lint:deps` -- pass, dependency-cruiser không báo cycle hay import chéo module
- `pnpm test:e2e` -- pass (gồm `purchase.spec.ts`, `public-event*.spec.ts`, `login*.spec.ts`)
