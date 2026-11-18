---
title: 'Story 4.8-b: Ảnh Sự kiện trên web'
type: 'feature'
created: '2026-11-18'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '42f36b4534c3c5261014b0257daa402d840527b9'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-8-a-ha-tang-va-api-anh-su-kien.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 4.8-a đã có presign, `imageKey` và `imageUrl`, nhưng web chưa cho BTC chọn ảnh; `event-card`, `event-hero` và ảnh OG vẫn không có ảnh, nên link chia sẻ lên Facebook/Zalo không hiện ảnh của giải (FR-7, FR-10).

**Approach:** Ô "Ảnh bìa" ở wizard bước 1 và Cài đặt upload thẳng lên storage ngay khi chọn file, rồi lưu `imageKey` cùng các trường khác. Card dashboard, hero trang công khai và ảnh OG dùng `imageUrl`; không có ảnh hoặc ảnh lỗi thì giữ giao diện hiện tại.

**Quyết định (Mason, 18/11/2026):** có nút "Gỡ ảnh". Ảnh OG: ảnh phủ cả khung 1200×630, lớp tối phía dưới, giữ chữ tên, ngày giờ, BTC như ảnh OG hiện tại. Thumbnail chỉ ở dashboard, không làm "Vé của tôi".

## Boundaries & Constraints

**Always:**
- Kiểm loại (JPEG/PNG/WebP) và dung lượng (≤ 5 MB) tại chỗ bằng hằng của `packages/contracts`, trước khi gọi API.
- Upload ngay khi chọn: presign `POST /v1/orgs/:orgId/event-images` rồi `PUT` thẳng `uploadUrl` kèm đúng `content-type`, không credentials. Chọn lại thì upload ảnh mới; preview hiện ngay bằng file đã chọn.
- Đang upload thì nút lưu bận và không lưu được. Upload lỗi giữ nguyên mọi ô đã nhập, kèm "Thử lại" (PUT lại cùng file, presign mới nếu URL đã hết hạn).
- Web luôn gửi `imageKey` khi lưu (giá trị đang có, key mới, hoặc `null` sau "Gỡ ảnh"). "Gỡ ảnh" chỉ đổi giá trị trong form, lưu cùng nút lưu như mọi ô khác.
- Sự kiện `cancelled`: ô ảnh chỉ đọc, không chọn, không gỡ.
- Ảnh tải lỗi ở card, hero hay OG → giao diện không ảnh hiện tại. Ảnh OG không bao giờ trả 500 vì ảnh.

**Never:**
- Không crop, không nén hay resize ảnh ở trình duyệt.
- Không đổi API hay contract của 4.8-a; không thêm env web mới.
- Không làm thumbnail ở "Vé của tôi", không thêm ảnh vào tab Tổng quan.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Chọn ảnh hợp lệ | PNG 200 KB ở wizard (Sự kiện chưa có id) hoặc Cài đặt | presign theo BTC, PUT 200, preview hiện; lưu gửi `imageKey` = key mới | — |
| File sai | `.gif`, hoặc 6 MB | lỗi tại chỗ "Chỉ nhận ảnh JPEG, PNG hoặc WebP." / "Ảnh tối đa 5 MB.", không gọi API, ảnh cũ giữ nguyên | — |
| PUT lỗi | storage 5xx, mất mạng, presign lỗi | lỗi tại chỗ "Chưa tải được ảnh." + "Thử lại"; các ô khác giữ nguyên; lưu vẫn gửi ảnh cũ | "Thử lại" thành công → như chọn ảnh hợp lệ |
| Gỡ ảnh | Sự kiện có ảnh, bấm "Gỡ ảnh" rồi lưu | preview về trống; body lưu có `imageKey: null` | — |
| Server từ chối key | lưu trả 400 ở `imageKey` | lỗi tại ô ảnh "Ảnh không hợp lệ. Chọn lại ảnh.", không báo chung ở ô tên | — |
| Hiển thị | `imageUrl` có / `null` / tải lỗi | card: thumbnail 56px `object-cover`; hero: ảnh `object-cover` trong khung 16:9 (lg 2:1); `null` hoặc lỗi → ô placeholder / gradient hiện tại | `onError` → fallback |
| Ảnh OG | có ảnh / không / tải lỗi hoặc quá 3 giây | ảnh phủ khung + lớp tối + chữ; không có hoặc lỗi → ảnh OG gradient hiện tại | không 500 |

</frozen-after-approval>

## Code Map

Đường dẫn dưới `apps/web/` trừ khi ghi khác.

- **Contracts (đã có từ 4.8-a, không đổi):** `EVENT_IMAGE_TYPES`, `EVENT_IMAGE_MAX_BYTES`, `EventImageUpload`, `eventImagesApiPath` ở `packages/contracts/src/event.ts`; `EventDetail.imageKey`/`imageUrl`, `EventSummary.imageUrl`, `PublicEvent.imageUrl`.
- **Upload (mới, thuần):** `lib/event/image-upload.ts`: kiểm file; presign qua `apiRequest` (`lib/api/client.ts:92`) với `eventImagesApiPath`; `fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'content-type': file.type } })` không credentials, không tiền tố `/v1`. Lỗi không phải `ApiError` dùng `messageOf` (`lib/api/message-of.ts:7`) khi cần.
- **Hook dùng chung:** logic chọn/upload/gỡ/thử lại trong một hook (vd. `lib/event/use-event-image.ts`) cho wizard và Cài đặt. Trạng thái: key hiện tại, URL preview (`URL.createObjectURL`, thu hồi khi đổi hoặc unmount; mẫu `app/(public)/bao-mat/totp/enroll-form.tsx:153`), đang upload, lỗi.
- **Picker:** `components/tickee/event-image-picker.tsx` (mới): nhãn "Ảnh bìa", gợi ý "JPEG, PNG hoặc WebP, tối đa 5 MB. Nên dùng ảnh ngang 16:9.", preview khung 16:9 `object-cover`, nút "Chọn ảnh"/"Đổi ảnh"/"Gỡ ảnh" (`Button loading`), `FieldError` (`components/tickee/field-error.tsx:7`), "Thử lại". Thêm vào showcase `app/(public)/ui-kit/ui-kit.tsx`.
- **Form:** `app/(dashboard)/btc/[orgId]/su-kien/event-info-form.tsx`: `EventInfoFields` (từ :120) chỉ hiển thị, nhận thêm slot ảnh đặt sau ô "Tên Sự kiện"; `inputOf` (:52-59) nhận thêm `imageKey`. `serverFieldErrors` (:98-103) hiện gom path lạ về ô tên: path `imageKey` phải về ô ảnh.
- **Wizard:** `su-kien/event-wizard.tsx`: mutation `save` (:67-90), `submit` (:95-106), `busy` (:92) tính cả lúc upload. Sự kiện mới chưa có id: presign theo `orgId`.
- **Cài đặt:** `su-kien/[eventId]/event-settings.tsx` `InfoForm` (:113-247): khởi tạo từ `event.imageKey`/`event.imageUrl`; `readOnly` khi hủy (:119, :190). Pre-count `notifiesBuyers` (:140-165) không đổi: contracts chỉ xét giờ và địa điểm.
- **Card:** `app/(dashboard)/btc/[orgId]/organization-home.tsx:99-123` `EventCard`: `<img>` 56px `rounded-md object-cover` thay ô `CalendarDays` (:107-109) khi có `imageUrl`; lỗi tải → ô cũ.
- **Hero:** `app/(public)/e/[slug]/event-hero.tsx` (fallback :30-34) và `page.tsx:81-86`: prop `imageUrl`, `<img>` cùng khung aspect với fallback; lỗi tải → fallback. `alt=""` (tên đã ở `h1`).
- **Ảnh OG:** `app/(public)/e/[slug]/opengraph-image.tsx` (Node runtime, gradient :59):
  - Tự tải ảnh, không đưa URL cho `ImageResponse`: Satori trong Next 16.4.3 chặn tải từ `localhost` (chống SSRF), và `resvg` không vẽ WebP.
  - Timeout 3 giây, bỏ nếu quá 5 MB; `sharp` resize `cover` 1200×630 sang JPEG rồi nhúng data URI làm nền, lớp tối phía dưới, chữ giữ như hiện tại. Mọi lỗi → bản gradient.
  - Thêm `sharp@0.35.5` vào dependencies của `apps/web` (lockfile đã có qua `next`).
  - Không làm route OG thành dynamic và không đưa ảnh vào data cache của Next (giới hạn 2 MB/mục): giữ cache theo tag `event:{slug}` của `fetchPublicEvent` (`lib/event/public-api.ts:18-23`). Tải bằng `node:http`/`node:https` là một cách.
- **Không dùng `next/image`:** `next.config.ts` không có `remotePatterns`; dùng `<img>`.
- **Test:**
  - Vitest Node-only (`vitest.config.mts`), mẫu `test/api-client.test.ts` (stub `fetch`).
  - E2E: `e2e/organizer-mock.ts:164` (`mockOrganizerApi`, handler `"METHOD /path"`, ghi `postDataJSON()`). Giả storage bằng `page.route` theo host: `OPTIONS` 204 kèm `access-control-allow-origin`, `-methods: PUT`, `-headers: content-type`; `PUT` kiểm `headers()['content-type']` và `postDataBuffer()`; `GET` trả PNG nhỏ. Chọn file bằng `setInputFiles({ name, mimeType, buffer })`.
  - `e2e/event-draft.spec.ts` (body POST đang có `imageKey: null` từ 4.8-a), `e2e/event-settings.spec.ts`, `e2e/public-event.spec.ts` (hero :58-75, OG :285-313), `e2e/public-event-api.ts` (fake API cổng 3199 cho fetch phía server: thêm route trả byte ảnh, và Sự kiện có `imageUrl` trỏ vào đó).

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/lib/event/image-upload.ts` (mới) + `apps/web/test/event-image-upload.test.ts` (mới) -- kiểm file, presign, PUT -- luật chung cho mọi ô ảnh.
- [x] hook dùng chung (mới), `apps/web/components/tickee/event-image-picker.tsx` (mới), `ui-kit.tsx` -- trạng thái và giao diện ô ảnh.
- [x] `event-info-form.tsx`, `event-wizard.tsx`, `[eventId]/event-settings.tsx` -- ô ảnh ở wizard bước 1 và Cài đặt, gửi `imageKey`, lỗi server ở ô ảnh.
- [x] `organization-home.tsx`, `e/[slug]/event-hero.tsx`, `e/[slug]/page.tsx` -- thumbnail và hero.
- [x] `e/[slug]/opengraph-image.tsx`, `apps/web/package.json`, `pnpm-lock.yaml` -- ảnh OG có ảnh Sự kiện.
- [x] `apps/web/e2e/event-image.spec.ts` (mới) và sửa `event-draft.spec.ts`, `event-settings.spec.ts`, `public-event.spec.ts`, `public-event-api.ts`, `organizer-mock.ts` -- mọi dòng của I/O Matrix; ảnh OG có ảnh kiểm bằng điểm ảnh (`sharp` đọc pixel của ảnh màu đặc), không chỉ status 200.

**Acceptance Criteria:**
- Given `docker compose up -d --wait` và `pnpm dev`, when Owner chọn một ảnh WebP ở wizard bước 1 rồi "Lưu nháp", mở bán, then card dashboard, hero `/e/{slug}` và `/e/{slug}/opengraph-image` đều hiện ảnh; "Gỡ ảnh" ở Cài đặt rồi lưu thì cả ba về giao diện không ảnh.
- Given `pnpm typecheck` và `pnpm turbo lint:deps`, then sạch.
- Given test web (vitest và e2e) và test api hiện có, then pass.

## Implementation Notes

- `story_key`: `4-8-ảnh-sự-kiện-trên-object-storage`. 4.8-b là phần cuối của 4.8 (4.8-a đã xong): xong 4.8-b thì đặt story `done`.
- Nhánh `feat/4-8-b-anh-su-kien-tren-web`, cắt từ `feat/4-8-a-ha-tang-va-api-anh-su-kien` (`42f36b4534c3c5261014b0257daa402d840527b9`), vì 4.8-a chưa merge.
- Lựa chọn ngoài spec của lượt triển khai:
  - **Preview khi upload lỗi** về ảnh của form (ảnh cũ hoặc ô trống), vì lưu vẫn gửi ảnh cũ; file lỗi giữ lại cho "Thử lại". Đang upload thì preview là file vừa chọn.
  - **"Thử lại" PUT lại cùng URL** khi presign còn hạn hơn 30 giây và lần trước lỗi mạng hoặc 5xx; storage trả 4xx (vd. chữ ký hết hạn) hoặc presign sắp hết hạn → presign mới.
  - **File rỗng (0 byte)** báo như sai loại ("Chỉ nhận ảnh JPEG, PNG hoặc WebP."): contract chặn `contentLength` 0, I/O Matrix không có câu riêng.
  - **Upload đi qua `useMutation`** để 2FA (`TOTP_REQUIRED`, tự gửi lại sau khi qua lớp hai), đồng ý, 401 và `NOT_A_MEMBER` được xử lý ở nơi chung như mọi mutation; các lỗi đó không hiện "Chưa tải được ảnh.".
  - **Hero:** ảnh SSR có thể lỗi trước khi React gắn `onError`, nên lúc mount kiểm thêm `complete && naturalWidth === 0`.
  - **Ảnh OG:** bản có ảnh được dựng trọn (`arrayBuffer`) trước khi trả, dựng lỗi thì trả bản gradient; lớp tối đậm dần từ khoảng 22% xuống đáy kèm bóng chữ (chỉ khi có ảnh) để tên dài vẫn đọc được trên ảnh sáng. Bảng route của `next build` vẫn ghi OG là `ƒ` như baseline.
  - **E2E WebKit:** Playwright với WebKit không đưa body Blob/File vào `postDataBuffer()` (luôn `null`), nên so byte PUT chỉ ở Chromium; WebKit vẫn kiểm key, `content-type` và số lần PUT. Unit test kiểm body PUT chính là `File` đã chọn.
  - **README:** thay câu "web luôn gửi `imageKey: null` tới 4.8-b" bằng mô tả ô ảnh.
- Kiểm chứng (18/11/2026): typecheck và `lint:deps` sạch; web 309/309; Playwright 1100/1100; api 1463/1463.
- Kiểm tay AC đầu tiên trên stack thật (`turbo dev` + MinIO `pgsty`, BTC demo của `pnpm db:seed`, OTP từ Mailpit), bằng script Playwright, 14/14 pass: PUT WebP từ trình duyệt lên MinIO 200; lưu nháp có `imageKey` đúng tiền tố; `imageUrl` đọc ẩn danh (`image/webp`); mở bán; thumbnail card, hero và ảnh OG (1200×630, điểm ảnh màu của ảnh, bố cục ảnh phủ khung + lớp tối + chữ) hiện ảnh; "Gỡ ảnh" ở Cài đặt rồi lưu → `imageKey` null, card về ô không ảnh, hero và ảnh OG về gradient sau revalidate. URL ảnh OG thật có hậu tố (`/opengraph-image-<hash>?…`), lấy từ `og:image`. Chưa kiểm tay riêng ca tắt MinIO rồi "Thử lại" (e2e đã phủ PUT lỗi, mất mạng và presign hết hạn). Dữ liệu kiểm tay để lại trong DB dev: các Sự kiện "Kiểm tay ảnh 4.8-b …" của BTC demo.
- Sửa sau review lượt 1 (mục 1–7, 9, 11, 16–19, 21 của Review Triage Log; agent triển khai làm): mutation upload `networkMode: 'always'`; timeout presign 30 giây và PUT 120 giây (hết giờ → "Chưa tải được ảnh." + "Thử lại", hủy bởi người dùng vẫn im lặng); "Thử lại" hiện khi còn file lỗi chờ (kể cả sau khi đóng hộp xác thực hai lớp) và xóa lỗi server ở ô ảnh; picker có prop `disabled`, khóa khi đang lưu, đếm Người mua hay chuyển trang (upload của chính ô ảnh không khóa, nên "Gỡ ảnh" vẫn bấm được lúc upload); ảnh OG `limitInputPixels: 40_000_000`, chỉ nhận `jpeg`/`png`/`webp`, log `console.warn('[og-image] …', { host, reason })`; thumbnail `loading="lazy"` + `decoding="async"`, hero `fetchPriority="high"`; README bảng env `S3_PUBLIC_BASE_URL` thêm server web. Test thêm: 4 unit (timeout, hủy) và 5 e2e (offline, gỡ ảnh khi đang upload, wizard gửi lại key cũ, Cài đặt bận khi upload, khóa ô ảnh khi đang lưu), điểm ảnh coral cho ba ca ảnh OG dự phòng. Kiểm chứng lại: typecheck và `lint:deps` sạch; web 313/313; Playwright 1110/1110; api 1463/1463.

## Spec Change Log

## Review Triage Log

Lượt 1 (18/11/2026). BH = blind-hunter, ECH = edge-case-hunter, VG = verification-gap.

| # | Nguồn | Phát hiện | Verdict | Route | Bằng chứng |
|---|-------|-----------|---------|-------|------------|
| 1 | BH | Chọn ảnh khi trình duyệt offline: mutation upload bị "tạm dừng", spinner và các nút lưu bận mãi, không hiện "Chưa tải được ảnh." | medium | patch | TanStack Query 5.105 mặc định `networkMode: 'online'` cho mutation; `app/providers.tsx:41-46` chỉ đặt mặc định cho query. E2E "mất mạng" dùng `route.abort`, không đổi `navigator.onLine`. Sửa trực tiếp: `networkMode: 'always'` cho mutation upload. |
| 2 | BH, ECH | Presign hoặc PUT treo (mạng di động chập chờn) thì không có timeout: nút lưu bận mãi, Sự kiện mới không có cách hủy ngoài tải lại trang (mất dữ liệu đã nhập) | medium | patch | `putEventImage`/`presignEventImage` (`lib/event/image-upload.ts`) chỉ có `signal` của hook; nút "Đổi ảnh" bị `loading` khi upload, "Gỡ ảnh" chỉ hiện khi đã có key. Sửa: timeout cho cả presign và PUT, hết giờ thì "Chưa tải được ảnh." + "Thử lại". |
| 3 | BH, ECH | Presign gặp `TOTP_REQUIRED` mà người dùng đóng hộp xác thực: file đã chọn biến mất, không lỗi, không "Thử lại" | low | patch | `use-event-image.ts` `onError` đặt `error: null` khi `handledElsewhere`; `canRetry` đòi `error === IMAGE_UPLOAD_ERROR`. Sửa trực tiếp: "Thử lại" hiện khi còn file lỗi chờ và không đang upload. |
| 4 | ECH | "Thử lại" thành công mà lỗi server "Ảnh không hợp lệ" vẫn nằm trên ảnh mới | low | patch | `onRetry` không gọi `onEdit`, còn picker hiện `errors.imageKey ?? controls.error`. Sửa trực tiếp: `onRetry` gọi `onEdit`. |
| 5 | ECH | Ô ảnh vẫn bấm được khi đang lưu: Cài đặt lưu key cũ rồi báo "Đã lưu" trong khi form hiện ảnh mới; wizard chuyển trang khi POST xong làm hủy upload đang chạy | low | patch | `busy` chỉ khóa nút lưu, picker không nhận `busy`. Sửa trực tiếp: khóa thao tác của ô ảnh khi đang lưu, đếm Người mua hay chuyển trang. |
| 6 | BH, ECH | Ảnh OG giải mã byte không tin cậy không giới hạn: ảnh "bom" điểm ảnh dưới 5 MB tốn CPU/RAM ở mỗi request của route công khai không cache; định dạng khác JPEG/PNG/WebP cũng được giải mã | medium | patch | `opengraph-image.tsx` gọi `sharp(bytes)` với `limitInputPixels` mặc định (~268 MP); timeout 3 giây chỉ bao lượt tải. Bất kỳ ai có tài khoản cũng tạo được BTC và upload. Sửa trực tiếp: `limitInputPixels` chặt và chỉ nhận định dạng `jpeg`/`png`/`webp`. |
| 7 | BH | Ảnh OG rơi về gradient mà không để lại dấu vết (`catch {}`), nên `S3_PUBLIC_BASE_URL` không tới được từ server web thì không ai biết | low | patch | Hai khối `catch` trong `backgroundOf` và lượt dựng có ảnh nuốt lỗi. Sửa trực tiếp: log `warn` kèm host và lý do. |
| 8 | BH | `download()` không theo redirect | low | reject | `S3_PUBLIC_BASE_URL` do Tickee cấu hình, không trỏ vào redirect; theo redirect là thêm nhánh. |
| 9 | BH | Route OG tải và mã hóa lại ảnh ở mỗi request; chú thích "không làm route thành dynamic" sai vì route vốn dynamic | low | patch | Cache trong tiến trình là thêm trạng thái (thuộc mục hoãn resize/CDN của 4.8-a), nên không làm. Chú thích sai thì sửa trực tiếp. |
| 10 | BH | Đổi hay gỡ ảnh thì preview link đã chia sẻ vẫn giữ ảnh cũ: URL `og:image` không đổi theo ảnh, Facebook/Zalo cache theo URL | medium | defer | URL `og:image` (`/opengraph-image-<hash>?<hash>`) cố định từ 2.11-b; đổi tên hay giờ cũng đã có cùng vấn đề. Sửa là đổi metadata (`generateMetadata` với phiên bản ảnh). |
| 11 | BH | Thumbnail 56px tải ảnh gốc tới 5 MB, không `loading="lazy"`/`decoding="async"`; ảnh hero (LCP) không `fetchPriority="high"` | low | patch | Sửa trực tiếp: thêm thuộc tính. Ảnh theo kích thước đã có mục hoãn resize/CDN. |
| 12 | BH, ECH | File đúng đuôi nhưng không phải ảnh (đổi tên, hỏng) qua mọi kiểm, lưu được, preview trống mà vẫn hiện "Đổi ảnh"/"Gỡ ảnh" | low | reject | Hiếm: trình duyệt suy `type` từ đuôi; ảnh hỏng thì card, hero, OG đều rơi về giao diện không ảnh. Sửa là thêm bước giải mã ảnh trước presign. |
| 13 | BH | Wizard: upload lỗi rồi "Lưu nháp" lần đầu thì chuyển trang, mất file và "Thử lại" | low | reject | Sau khi chuyển trang ô ảnh hiện "Chưa có ảnh bìa" nên người dùng thấy và chọn lại được; giữ trạng thái qua đổi route là thêm phức tạp. |
| 14 | BH | `download()`/`backgroundOf()` không có unit test (trần 5 MB, mã khác 200, giao thức) | low | reject | E2E đã phủ ảnh 404 và ảnh chậm; tách hàm ra `lib/` để test là tái cấu trúc. |
| 15 | BH | Assert "không lưu" trong e2e "đang upload" chạy ngay sau click, không chờ | false | reject | Sau khi thả upload, test bấm lưu lần nữa rồi assert đúng 1 lần ghi: lần lưu thừa trong lúc bận sẽ làm số lần ghi thành 2. |
| 16 | VG, BH | "Gỡ ảnh" trong lúc upload chưa có test: bỏ `abandon()` hay guard lần thử thì ảnh sống lại hoặc hiện lỗi giả | medium | patch | Gap VG đã kiểm: `removeButton` chỉ bấm khi không upload; test giữ PUT chỉ dùng Sự kiện mới (không có "Gỡ ảnh"). |
| 17 | VG | Wizard của Sự kiện đã có ảnh: chưa test PATCH gửi lại `imageKey` hiện có | medium | patch | Gap VG đã kiểm: test duy nhất mở `thiet-lap` với ảnh có `rejectImage = true`, không kiểm body. Đổi `initialKey` thành `null` thì mọi test vẫn pass. |
| 18 | VG | Cài đặt: chưa test "Lưu thay đổi" bận khi đang upload | low | patch | Gap VG đã kiểm: test giữ PUT chỉ chạy ở wizard. |
| 19 | VG | Ảnh OG dự phòng chỉ kiểm "không xanh", không bắt được mất gradient coral | low | patch | Gap VG đã kiểm: gradient chuyển sang spread có điều kiện (`opengraph-image.tsx`); test 404/chậm/không ảnh chỉ assert `isGreen === false`. |
| 20 | VG | Gửi lại upload sau xác thực 2 lớp (`TOTP_REQUIRED` ở presign) chưa có test | medium | defer | Gap VG đã kiểm; cần mất step-up giữa phiên, đường gửi lại chung của `Providers` đã có test ở `members.spec.ts`. |
| 21 | BH | Bảng env README: `S3_PUBLIC_BASE_URL` chỉ ghi vai `api`, trong khi server web cũng phải tới được (ảnh OG) | low | patch | Văn README đã nói, bảng chưa. Sửa trực tiếp. |
| 22 | BH | Showcase ui-kit thiếu trạng thái đang upload và key bị từ chối | low | reject | Test hiện có của trang ui-kit đòi đúng một spinner; hai trạng thái xem được ở wizard và e2e. |
| 23 | ECH | Presign lỗi 4xx lâu dài (403, 400, giới hạn) vẫn báo chung "Chưa tải được ảnh." kèm "Thử lại" | low | reject | Web đã kiểm loại/dung lượng trước; vai không đủ quyền không vào được Cài đặt. Sửa là thêm nhánh phân loại lỗi. |

## Design Notes

- **Upload khi chọn, lưu khi bấm lưu:** key chỉ vào Sự kiện qua nút lưu như mọi ô khác, nên bỏ wizard giữa chừng không đổi Sự kiện (object mồ côi đã có mục dọn trong deferred-work).
- **Tự tải ảnh cho OG:** `ImageResponse` tự tải URL thì bị chặn ở `localhost` và hỏng với WebP; tự tải rồi đổi sang JPEG 1200×630 cũng làm nhẹ ảnh đưa vào Satori.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: không lỗi.
- `pnpm turbo lint:deps` -- expected: không vi phạm.
- `pnpm --filter @tickee/web test` -- expected: pass.
- `pnpm test:e2e` -- expected: pass (build web rồi chạy toàn bộ Playwright).
- `pnpm --filter @tickee/api test` -- expected: pass (không đổi api; chạy để chắc contract không vỡ).

**Manual checks:**
- `docker compose up -d --wait`, `pnpm dev`: tạo Sự kiện có ảnh WebP ở wizard, mở bán, xem card, `/e/{slug}`, `/e/{slug}/opengraph-image`; thử file `.gif` và file 6 MB; tắt MinIO (`docker compose stop minio`) rồi chọn ảnh → "Chưa tải được ảnh." + "Thử lại", bật lại rồi "Thử lại"; "Gỡ ảnh" ở Cài đặt rồi lưu.
