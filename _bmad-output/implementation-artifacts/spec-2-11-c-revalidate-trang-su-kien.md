---
title: 'Story 2.11-c: revalidate ngay trang Sự kiện công khai khi BTC sửa'
type: 'feature'
created: '2026-11-06'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'ac9617fb18f46e04339ee0bb5e732774491d5611'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Trang `/e/{slug}` (2.11-b) cache phần tĩnh 30 giây theo tag `event:{slug}`. BTC sửa tên, giờ, địa điểm hay Hạng vé thì người mở link vẫn thấy bản cũ tới 30 giây. AD-37 yêu cầu revalidate ngay khi BTC sửa.

**Approach:** Ghi làm đổi phần tĩnh của một Sự kiện đã mở bán thì enqueue job pg-boss trong cùng `tx`. Worker gọi route handler nội bộ của web, route này chạy `revalidateTag(publicEventTag(slug), { expire: 0 })`. Revalidate 30 giây giữ nguyên làm lưới an toàn.

## Boundaries & Constraints

**Always:**
- Enqueue khi Sự kiện không còn `draft` và thay đổi có thật: `EventService.update` (có trường đổi), `PublishService.publish`, flows tạo/sửa (có trường đổi)/xóa Hạng vé. Sự kiện nháp không enqueue. Đổi giới hạn Vé/Đơn và form mua vé không enqueue (không có trên trang).
- Enqueue bằng `boss.send(..., { db: fromDrizzle(tx, sql) })`: `tx` rollback thì không có job. Payload chỉ `{ slug }`.
- Helper enqueue export qua `event/index.ts` để 2.12 (Ẩn/Kết thúc) và Epic 7 dùng lại.
- Worker: `POST {WEB_ORIGIN}/api/revalidate`, header `Authorization: Bearer {REVALIDATE_SECRET}`, body `{ "tag": "event:{slug}" }`, timeout 5 giây. Không 2xx hoặc lỗi mạng → job `failed` để pg-boss retry (3 lần, 2 giây, backoff). Không có dead-letter: hết lượt thì cache tự hết hạn sau 30 giây. Log không chứa secret.
- Web: `REVALIDATE_SECRET` chỉ ở server. Thiếu biến → 503. Sai/thiếu header → 401 (so sánh hằng thời gian). Body không phải `{ tag }` hợp lệ dạng `event:{slug}` → 400. Hợp lệ → `revalidateTag(tag, { expire: 0 })`, 204.
- `REVALIDATE_SECRET` bắt buộc ≥ 32 ký tự với vai `worker` (kiểm Zod khi khởi động). Cập nhật `.env.example`, README.

**Never:**
- Không revalidate `/availability` (đã cache ≤ 2 giây). Không gọi HTTP trong transaction DB. Không đổi `PUBLIC_EVENT_REVALIDATE_SECONDS`.
- Không làm Ẩn/Kết thúc (2.12), không cache dùng chung cho nhiều instance web (4.7).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Sửa Sự kiện đang bán | `published`, đổi tên | 1 job `{slug}`; sau khi worker chạy, tải lại `/e/{slug}` thấy tên mới | — |
| Sửa không đổi gì | body giống hiện tại | Không job | — |
| Sửa nháp | `draft` | Không job | — |
| Mở bán | `draft` → `published` | 1 job (xóa 404 cũ nếu đã cache) | — |
| Ghi lỗi | `409` / rollback | Không job | — |
| Web lỗi | route trả 500 / mạng lỗi | Job `failed`, pg-boss retry | Hết lượt: cache tự hết sau 30 giây |
| Sai secret | header sai | 401, không revalidate | — |
| Tag lạ | `{ tag: "user:1" }` | 400 | — |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/jobs.ts` -- thêm `EVENT_REVALIDATE_PUBLIC_PAGE: 'event.revalidate-public-page'`. `publicEventTag` ở `event.ts:226`; route web kiểm tag bằng `EVENT_SLUG_PATTERN`.
- `apps/api/src/modules/organizer/invitation-jobs.ts` -- mẫu cần chép: `ensure…Queues`, `enqueue…(boss, tx, …)`, `…Queues` (vai `api`, `ready()` trước khi enqueue), `…Worker` + `Module.forRoot(config)` (vai `worker`), `perJobResults`.
- `apps/api/src/modules/event/public-page-jobs.ts` (mới) -- queue, enqueue, handler `revalidatePublicPage({ webOrigin, secret, fetch }, slug)` (tiêm `fetch` để test), `EventJobsModule.forRoot`.
- `apps/api/src/modules/event/event.service.ts:167` `update`, `publish.service.ts:80` `publish` -- enqueue trong `tx` khi `updated.status !== 'draft'`.
- `apps/api/src/flows/ticket-types.flow.ts:96,123,159` -- create/update/delete nhận thêm boss (hoặc enqueue fn); cần `status`, `slug` của Sự kiện: mở rộng `lockEventForTicketTypes` (`ticket-type.service.ts:37`) trả `{ id, status, slug }` thay vì `void`. Controller `flows/ticket-types.controller.ts` tiêm `PublicPageQueues`.
- `apps/api/src/modules/event/event.module.ts`, `flows/flows.module.ts`, `worker.module.ts` -- đăng ký Queues (api) và `EventJobsModule.forRoot({ WEB_ORIGIN, REVALIDATE_SECRET })` (worker).
- `apps/api/src/platform/config/config.schema.ts` -- `workerConfigSchema` thêm `REVALIDATE_SECRET`. `test/helpers.ts` `workerConfig` thêm giá trị test.
- `apps/web/app/api/revalidate/route.ts` (mới) -- `POST`, `export const dynamic = 'force-dynamic'`; `timingSafeEqual` trên hash SHA-256 của hai chuỗi (khác độ dài không ném).
- Không đổi: `apps/web/lib/event/public-api.ts` (đã gắn tag), `opengraph-image.tsx` (dùng cùng fetch nên cùng tag).

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/jobs.ts` -- tên queue.
- [x] `apps/api/src/platform/config/config.schema.ts`, `test/helpers.ts`, `.env.example`, `README.md` -- biến `REVALIDATE_SECRET` cho worker.
- [x] `apps/api/src/modules/event/{public-page-jobs,event.service,publish.service,ticket-type.service,event.module,index}.ts`, `src/flows/*`, `src/worker.module.ts` -- enqueue và worker.
- [x] `apps/api/test/event/public-page-job.test.ts` (mới) -- phủ 5 dòng đầu matrix (đếm job theo queue/slug); handler gọi đúng URL, header, body; 500 → ném lỗi.
- [x] `apps/web/app/api/revalidate/route.ts` + `apps/web/test/revalidate-route.test.ts` -- mock `next/cache`; 204/401/400/503.

**Acceptance Criteria:**
- Given worker và web chạy, Sự kiện đang bán đã được xem (cache nóng), when BTC đổi tên, then trong vài giây tải lại `/e/{slug}` thấy tên mới, không phải chờ 30 giây.
- Given `REVALIDATE_SECRET` thiếu khi khởi động worker, when chạy, then worker dừng và nêu tên biến.

## Implementation Notes

- `PublicPageQueues.ready()` chạy trước transaction ở mọi lệnh ghi liên quan (cả khi Sự kiện còn nháp, vì chưa biết trạng thái trước khi khóa dòng), như mẫu `AdminInvitationQueues`. `EventModule` xuất `PublicPageQueues`, `FlowsModule` import `EventModule` để dùng chung một instance.
- Flows nhận thêm `boss` (`createTicketType(db, boss, ctx, …)`); controller chờ `ready()` sau khi parse body (lỗi 400 không phụ thuộc pg-boss).
- Worker chạy song song các job trong lô (tối đa 10) và gọi web một lần cho mỗi slug trong lô. Payload hỏng → `deadletter` (queue không có dead-letter nên job hỏng hẳn, không retry). Fetch dùng `redirect: 'error'` để secret không đi theo redirect; lỗi chỉ mang mã HTTP hoặc tên lỗi + mã lỗi mạng.
- Route web trả 400 cho slug > 100 ký tự (cùng giới hạn `assertPublicSlug`); body rỗng, `cache-control: no-store`.
- Đã ghi deferred-work (gắn 4.7): nhiều instance web cần cache handler dùng chung; checklist deploy đặt `REVALIDATE_SECRET` cho cả worker và web.
- Sau review pass 1: thêm `test/event/public-page-queues.test.ts`, e2e `public-event-revalidate.spec.ts` (mock API có `POST /__test/events/:slug/name`, server Next có `REVALIDATE_SECRET`), kiểm `AbortSignal.timeout(5000)`, test payload hỏng; tài liệu chuyển sang `apps/web/.env.local`.
- Chạy e2e ở local: xóa `apps/web/.next` trước khi build lại có `NEXT_PUBLIC_API_BASE_URL`. Turbo khôi phục cache đè lên `.next` cũ có thể để lại chunk thiếu biến, làm hàng loạt spec dùng `page.route` fail.
- Kiểm tay (api + worker + `next start` trên `tickee_test`): ngay sau khi đổi tên vẫn `HIT` tên cũ; sau ~3 giây `MISS` → tên mới (3 giây kể từ lúc cache nóng, trước mốc 30 giây).

## Spec Change Log

## Review Triage Log

Pass 1 (06/11/2026, 3 lớp: blind-hunter BH, edge-case-hunter EC, verification-gap VG).

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | VG, BH | Nhánh phục hồi của `PublicPageQueues.ready()` (lỗi → `pending = null` → lần sau start lại) chưa có test, mà mọi lệnh ghi Sự kiện/Hạng vé giờ phụ thuộc nó | medium | VG gap: phá dòng reset vẫn pass; lớp anh em có `admin-invitation-queues.test.ts` | patch |
| 2 | VG, BH | `revalidateTag(tag, { expire: 0 })` thật chưa có test tự động, chỉ có mock; AC 1 chỉ kiểm tay | medium | VG gap: e2e không đặt `REVALIDATE_SECRET`, không có spec nào gọi `/api/revalidate` | patch |
| 3 | VG | Test "có timeout" chỉ kiểm có `AbortSignal`, không kiểm 5 giây | low | VG gap; sửa trực tiếp: spy `AbortSignal.timeout` và kiểm đối số `REVALIDATE_TIMEOUT_MS` | patch |
| 4 | BH | Payload hỏng → `deadletter` không có test | low | Nhánh có thật (`public-page-jobs.ts`); test chỉ thêm một job dữ liệu sai | patch |
| 5 | BH | Hướng dẫn đặt secret web ở `.env.development.local`, nhưng `next start` (README, e2e) không đọc file này | low | Next chỉ đọc `.env.development.local` khi `next dev`; `.env.local` đọc cả dev lẫn start. Sửa tài liệu | patch |
| 6 | BH | Chỉ đổi số suất vẫn enqueue dù số suất không có trên trang | low | Đúng (`ticketTypeChangedFields` có `capacity`), nhưng hại chỉ là một lần purge thừa; người dùng không thấy | reject |
| 7 | BH | pg-boss không start được thì cả lệnh sửa nháp cũng 500; `send` trả null làm rollback | low | pg-boss dùng chung Postgres với lệnh ghi: DB lên thì boss start được; `send` chỉ trả null khi có singleton/throttle (không cấu hình). Cùng mẫu với lời mời Admin | reject |
| 8 | BH | Không gộp job theo slug (`stately` + `singletonKey`), policy queue khó đổi sau | low | BTC sửa thưa; web lỗi thì N×4 lời gọi nhẹ. `stately` làm `send` trả null → phải thêm nhánh | reject |
| 9 | BH | 400/401/503 vẫn retry; cấu hình sai chỉ thấy qua `warn` | low | Cấu hình sai xảy ra một lần lúc deploy, đã ghi checklist 4.7; cảnh báo là 4.6 | reject |
| 10 | BH | Web không kiểm `REVALIDATE_SECRET` lúc khởi động | false | Intent chọn rõ: thiếu biến → 503 (trang vẫn làm mới sau 30 giây); web hiện không có module kiểm env nào | reject |
| 11 | BH | Hợp đồng worker ↔ web chép tay (path, schema, `SLUG_MAX` ba nơi, secret test) | low | Có thật nhưng chưa có caller nào lệch; chuyển vào contracts thêm public surface | reject |
| 12 | BH | Test dùng chung queue: job còn lại trong `tickee_test`, worker ở test khác gọi `web.tickee.test` | low | Lỗi DNS `.test` trả về ngay; mẫu y hệt job lời mời có sẵn; toàn bộ suite pass | reject |
| 13 | BH, EC | Race: render đọc API trước commit, ghi cache sau khi revalidate → bản cũ thêm ≤ 30 giây | low | Cửa sổ cần fetch kéo dài qua lúc worker poll (~0–2 giây) trong khi API trả trong vài ms; giới hạn 30 giây | reject |
| 14 | BH | CDN trước web (4.7) giữ bản cũ bất kể `revalidateTag` | low | `/e/[slug]` là ISR có `s-maxage`; chỉ xảy ra khi 4.7 thêm CDN | defer |
| 15 | BH | Tên BTC có trên trang; đổi tên/khóa BTC sau này phải revalidate mọi Sự kiện của BTC | low | Chưa có endpoint đổi tên; ghi để story sau không quên | defer |
| 16 | EC | Redirect → lỗi chỉ ghi `TypeError`, khó chẩn đoán | low | Chỉ xảy ra khi cấu hình sai; sửa thêm nhánh | reject |
| 17 | EC | `enqueuePublicPageRevalidation` nhận slug sai → `deadletter` không log | low | Slug luôn lấy từ DB, sinh đúng `EVENT_SLUG_PATTERN`; không có đường tới | reject |
| 18 | EC | Invalidation chạy sau khi trả 204 (`pendingWaitUntil`); cache handler lỗi thì job vẫn completed | maybe-false | Chỉ xảy ra với cache handler dùng chung (4.7); cần đọc Next khi có handler. Nếu đúng thì chỉ low (trễ ≤ 30 giây) | reject |

## Design Notes

- **Vì sao qua job:** quy ước dự án là hiệu ứng phụ enqueue cùng `tx`. Gọi web ngay sau commit thì mất khi api chết giữa chừng; job có retry. Độ trễ ≈ chu kỳ poll của worker (~2 giây), vẫn là "ngay" với người dùng.
- **`{ expire: 0 }`:** Next 16 `revalidateTag(tag, 'max')` vẫn trả bản cũ một lần; `updateTag` chỉ chạy trong Server Action. Gọi từ route handler cho webhook thì dùng `{ expire: 0 }`.
- **Nhiều instance web:** `revalidateTag` chỉ xóa cache của instance nhận request. Hiện chạy một instance; nếu 4.7 dùng nhiều instance thì cần cache handler dùng chung — ghi vào deferred-work gắn 4.7.

## Verification

**Commands:**
- `pnpm turbo build typecheck lint:deps test` -- expected: pass.

**Manual checks:**
- `pnpm dev` + worker, mở `/e/{slug}`, sửa tên trong dashboard, tải lại sau ~3 giây thấy tên mới.
