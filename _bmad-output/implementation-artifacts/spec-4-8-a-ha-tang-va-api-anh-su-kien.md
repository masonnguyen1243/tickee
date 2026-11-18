---
title: 'Story 4.8-a: Hạ tầng và API ảnh Sự kiện'
type: 'feature'
created: '2026-11-18'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '029a9d35c5f2a7ca8a394ea0d36e2e1cd8e89ca5'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sự kiện chưa có chỗ lưu ảnh bìa: không có object storage, không có cột ảnh, contract không có URL ảnh. Web (4.8-b) cần các thứ này để làm ô chọn ảnh, thumbnail, hero và ảnh OG (FR-7, FR-10).

**Approach:** Thêm object storage tương thích S3 (MinIO ở local), route cấp presigned PUT theo BTC, cột `events.image_key` nhận qua luồng tạo/sửa Sự kiện sẵn có, và `imageUrl` công khai trong contract dashboard và trang công khai.

**Quyết định (Mason, 18/11/2026):** BTC gỡ được ảnh: lưu `imageKey: null` thì Sự kiện về không ảnh. Phần web, ảnh OG và thumbnail ở "Vé của tôi" nằm ngoài story này (deferred-work, mục 4.8-a). Giới hạn presign (tốc độ, hạn mức, log ai xin key nào) cũng ngoài story này, nhưng bắt buộc phải có trước khi tạo bucket production ở Story 4.7 (chốt ở review lượt 1).

## Boundaries & Constraints

**Always:**
- JPEG, PNG hoặc WebP, 1 byte tới 5 MB, kiểm khi presign. Hằng loại và dung lượng khai ở `packages/contracts` để 4.8-b dùng chung.
- Key `orgs/{orgId}/events/{uuid}.{jpg|png|webp}`. Tạo/sửa Sự kiện chỉ nhận key có tiền tố `orgs/{ctx.organizationId}/events/`; sai dạng hoặc tiền tố BTC khác → `400 VALIDATION_FAILED` ở trường `imageKey`.
- Owner và Admin (`events.manage`). Route mới đi qua bộ test cách ly.
- Đổi hoặc gỡ ảnh là một lần sửa Sự kiện như các trường khác: audit `event.updated` với `changedFields` chứa `'imageKey'` (không ghi giá trị); revalidate `/e/{slug}` khi không còn nháp; Sự kiện `cancelled` → `409`; không báo Người mua.
- Chỉ dùng API S3 chuẩn (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`), không dịch vụ độc quyền của cloud nào (AD-22).

**Never:**
- API không tải, đọc hay proxy byte ảnh; không gọi mạng tới storage.
- Không xóa object cũ hay object mồ côi.
- Không cấu hình bucket staging/production (Story 4.7). Không đổi UI web.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Presign hợp lệ | Owner hoặc Admin, `{contentType:'image/webp', contentLength: 1..5 MB}` | `200 {key, uploadUrl, expiresAt}`; key đúng dạng của BTC; URL ký `content-type` và `content-length`, hạn 5 phút | — |
| Presign sai | loại khác 3 loại, `contentLength` 0 hoặc > 5 MB, body `{}` | `400 VALIDATION_FAILED` | — |
| Presign ngoài quyền | thành viên BTC khác, CTV | như mọi route org khác | — |
| Lưu có ảnh | POST hoặc PATCH với `imageKey` của BTC mình | lưu; detail, list và trang công khai trả `imageUrl` = `S3_PUBLIC_BASE_URL/{key}`; PATCH audit `['imageKey']` | — |
| Gỡ ảnh | PATCH `imageKey: null` (hoặc bỏ trường) | cột `null`, `imageUrl: null` | — |
| Key lạ | tiền tố BTC khác hoặc sai dạng | `400 VALIDATION_FAILED` ở `imageKey` | — |

</frozen-after-approval>

## Code Map

Đường dẫn dưới `apps/api/` trừ khi ghi khác.

- **Cột:** `src/modules/event/schema.ts:27-81` thêm `imageKey: text('image_key')` nullable cạnh `venue`/`description` (:47-50). Migration `pnpm --filter @tickee/api db:generate --name event_image_key` → `drizzle/0031_event_image_key.sql` (mẫu `0022_event_time_venue_version.sql`). Không sửa `src/platform/db/grants.ts`: `tickee_app` có UPDATE cả bảng `events`.
- **Contracts** (`packages/contracts/src/`):
  - `event.ts` `EventDraftInput` (:77-92) thêm `imageKey` (regex key, `.nullish()` → `null`, cùng ngữ nghĩa "thay toàn bộ" như `optionalText`); `'imageKey'` vào `EVENT_DRAFT_FIELDS` (:95). `EventSummary` (:97-111) thêm `imageUrl`; `EventDetail` (:122-135) thêm `imageKey` và `imageUrl`. `notifiesBuyers` (:232) không đổi.
  - Mới: `EventImageUploadInput {contentType, contentLength}`, `EventImageUpload {key, uploadUrl, expiresAt}`, `EVENT_IMAGE_TYPES`, `EVENT_IMAGE_MAX_BYTES`, hằng path route.
  - `sellability.ts:15-31` `PublicEvent` thêm `imageUrl`.
- **Sự kiện:** `src/modules/event/event.service.ts`: `columnsOf`/`changedFieldsOf` nhận `imageKey`; kiểm tiền tố trong `create` (:179-204) và `applyEventEdit` (:131-167); `detailOf` (:67-83) và `list` (:208-220, select tường minh) trả `imageUrl`. `public-event.ts:218-249` `publicEventDetail` trả `imageUrl`.
- **Route presign:** controller mới `src/modules/event/event-images.controller.ts`, `POST /v1/orgs/:orgId/event-images`, `@RequirePermission(Permission.EVENTS_MANAGE)` + `@Access()`, `parseRequest` trước mọi việc khác. Mẫu `events.controller.ts:31-35`. Không cần `Idempotency-Key`, không audit (chưa đổi dữ liệu). Khai trong `event.module.ts`.
- **Storage:** `src/platform/storage/` (mới) theo mẫu `src/platform/email/` (token `Symbol`, module `@Global` `forRoot`, `index.ts`): `presignPut({key, contentType, contentLength})` và `publicUrlOf(key)`. Wire ở `src/api.module.ts:39`; worker không cần (chỉ nạp `EventJobsModule`). `S3Client` đặt `requestChecksumCalculation: 'WHEN_REQUIRED'`, nếu không SDK mới thêm header checksum vào URL ký và PUT từ trình duyệt hỏng. `forcePathStyle` theo env.
- **Config:** `src/platform/config/config.schema.ts`, nhóm `storage` chỉ trong `apiConfigSchema` (:185-217): `S3_ENDPOINT` (url), `S3_REGION` (default `us-east-1`), `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` (default `false`), `S3_PUBLIC_BASE_URL` (url). Cập nhật `.env.example` (gốc repo), bảng env README (~:325-352), `test/helpers.ts` `apiConfig()` (:28-57), `test/config.test.ts` (:11, :254-266), `test/roles.process.test.ts` (:26, :159).
- **Deps:** `@aws-sdk/client-s3@3.1158.0` (spine:453) và `@aws-sdk/s3-request-presigner` cùng phiên bản. `pnpm-workspace.yaml` có `minimumReleaseAge`.
- **Local:** `docker-compose.yml` thêm `minio` (`127.0.0.1:9000` API, `:9001` console, `MINIO_API_CORS_ALLOW_ORIGIN` là origin web, dùng cho cả `GET` và `PUT`) và `minio-init` (`minio/mc`: tạo bucket, `anonymous set download`). Ghim tag kéo được (MinIO ngừng phát image cộng đồng mới từ cuối 2025; kiểm bằng `docker pull`). Mục "Chạy local" của README (:20-48). CI không cần MinIO: ký presign không gọi mạng.
- **Ràng buộc:** `.dependency-cruiser.cjs`: platform không import modules; `modules/event` chỉ phụ thuộc `organizer`.
- **Test:** `test/event/events.test.ts` sửa `toEqual` ở :233, :286, :344. `test/organizer/isolation.test.ts` thêm route vào danh sách :81-110 (route không nằm dưới `/events`, nên số đếm :272 giữ nguyên). Helper `createHarness`, `signUp`; Admin chèn thẳng `members` (`events.test.ts:44-49`).
- **Web:** chỉ sửa nếu typecheck đòi (fixture có kiểu contract thêm `imageUrl: null`). `e2e/event-draft.spec.ts` không đổi vì web chưa gửi `imageKey`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/event.ts`, `sellability.ts` -- trường `imageKey`/`imageUrl`, schema presign, hằng -- một luật cho API và 4.8-b.
- [x] `apps/api/package.json`, `src/platform/storage/*` (mới), `src/platform/config/config.schema.ts`, `src/api.module.ts`, `.env.example`, `README.md` -- client presign, URL công khai, env `S3_*`.
- [x] `apps/api/src/modules/event/schema.ts` + migration `0031` -- cột `image_key`.
- [x] `apps/api/src/modules/event/event.service.ts`, `public-event.ts`, `event-images.controller.ts` (mới), `event.module.ts` -- presign, kiểm tiền tố, `imageUrl` ở detail, list, public.
- [x] `apps/api/test/event/event-image.test.ts` (mới); sửa `events.test.ts`, `isolation.test.ts`, `config.test.ts`, `roles.process.test.ts`, `helpers.ts` -- mọi dòng của I/O Matrix, thêm audit và revalidate khi đổi ảnh Sự kiện đã mở bán.
- [x] `docker-compose.yml`, `README.md` -- MinIO, bucket đọc công khai, CORS cho origin web.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- hoãn: dọn object cũ và mồ côi; resize/CDN ảnh cho NFR-1; bucket, CORS, đọc công khai và `S3_*` ở staging/production (4.7); chọn nhà cung cấp object storage theo NĐ 53/2022.

**Acceptance Criteria:**
- Given `docker compose up -d --wait`, when lấy presign rồi `curl -X PUT` đúng `content-type` và file, then `GET` `imageUrl` trả `200` đúng ảnh; PUT với file lớn hơn số byte đã khai thì storage từ chối.
- Given `pnpm typecheck` và `pnpm turbo lint:deps`, then sạch.
- Given toàn bộ test api và test web hiện có, then pass.

## Implementation Notes

- `story_key`: `4-8-ảnh-sự-kiện-trên-object-storage`. Story còn 4.8-b (`deferred-work.md`), nên xong 4.8-a thì story vẫn `in-progress`, không đặt `done`.
- Nhánh `feat/4-8-a-ha-tang-va-api-anh-su-kien`, cắt từ `main` (`029a9d35c5f2a7ca8a394ea0d36e2e1cd8e89ca5`).
- Lựa chọn ngoài spec của lượt triển khai:
  - **Image MinIO:** `minio/minio` và `minio/mc` không còn kéo được (Docker Hub từ chối, quay.io đòi đăng nhập). Compose ghim bản fork cộng đồng `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` và `pgsty/mc:RELEASE.2026-10-26T00-00-00Z`. Môi trường build không được phép kéo image này, nên AC đầu tiên (`docker compose up`, `curl -X PUT`, PUT lớn hơn số byte đã khai bị từ chối) chưa chạy. Chữ ký URL đã kiểm bằng một bộ kiểm SigV4 riêng: nhận đúng số byte và loại đã khai, từ chối thêm một byte hoặc khác loại.
  - **`minio-init` không thoát:** làm xong thì đứng yên với healthcheck "đã sẵn sàng", vì `docker compose up --wait` coi container đã thoát (kể cả mã 0) là lỗi.
  - **Đọc công khai bằng policy JSON chỉ `s3:GetObject`,** không dùng `mc anonymous set download` (preset đó mở cả liệt kê bucket, lộ key ảnh của Sự kiện nháp).
  - **Fixture web:** web kiểm response bằng schema contract, nên 9 file e2e và 2 fixture unit thêm `imageUrl` (và `imageKey`). Code Map nói `e2e/event-draft.spec.ts` không đổi là sai: web gửi bản đã qua `EventDraftInput`, mà transform thêm `imageKey: null`, nên body POST được kiểm có `imageKey: null`.
  - **`test/telemetry/telemetry.process.test.ts`** cũng khởi vai api bằng env tường minh, nên thêm nhóm `S3_*` (Code Map không liệt kê).
  - Tới khi 4.8-b ship, mọi lần lưu từ web gửi `imageKey: null`: ảnh đặt thẳng qua API sẽ bị gỡ. UI chưa đặt được ảnh nên hiện vô hại.
- Kiểm tay MinIO (18/11/2026, sau khi Mason chạy `docker compose up -d --wait` với hai image `pgsty`): script dùng `S3ObjectStorage` đã build và `S3_*` của `.env.example`, 8/8 pass. PUT đúng loại và số byte → 200; `GET imageUrl` ẩn danh → 200, đúng byte, `image/png`; PUT thêm 1 byte → 403, object không được tạo; PUT khác `content-type` → 403; liệt kê bucket ẩn danh → 403; preflight CORS `PUT` và `GET` từ `http://localhost:3000` → cho phép. Route presign (sinh key + `presignPut`) đã có test API; lần kiểm này không đi qua HTTP có cookie.
- Toàn bộ test api lần kiểm chứng: 1459/1460; ca fail `test/organizer/members.test.ts:434` chập chờn, chạy riêng 3/3 pass, ghi vào `deferred-work.md`.
- Sửa sau review lượt 1 (mục 2, 3, 4, 6, 7 của Review Triage Log; agent triển khai không tiếp tục được nên sửa trực tiếp): `test/platform/s3-object-storage.test.ts` (mới) tính lại SigV4 độc lập bằng `node:crypto` và so với `X-Amz-Signature`, kiểm URL virtual-hosted, cắt `/` cuối và mã hóa từng đoạn của `publicUrlOf`; `EventDetail.imageKey` trong response là `z.string().nullable()`; `S3_ENDPOINT` dùng `httpOrigin`; README cảnh báo web gỡ ảnh đặt bằng `curl` cho tới 4.8-b. Kiểm chứng lại: typecheck, `lint:deps` sạch; contracts 337/337, web 289/289, api 1463/1463.

## Spec Change Log

## Review Triage Log

Lượt 1 (18/11/2026). BH = blind-hunter, ECH = edge-case-hunter, VG = verification-gap.

| # | Nguồn | Phát hiện | Verdict | Route | Bằng chứng |
|---|-------|-----------|---------|-------|------------|
| 1 | ECH, BH | Presign không giới hạn tốc độ hay hạn mức, không ghi ai xin key nào: ai có tài khoản cũng tạo được BTC rồi xin vô hạn URL upload 5 MB vào bucket đọc công khai; object không bao giờ bị xóa | medium | intent_gap | `POST /v1/orgs` không cần duyệt (`organizations.controller.ts:21`); `event-images.controller.ts` chỉ cần `events.manage`. Repo không có limiter chung, chỉ `ordering/order-rate-limit.ts` riêng cho Đơn. Dọn object đã hoãn. Khối frozen không nói hạn mức, cũng không nói BTC thấy gì khi vượt. Hậu quả chỉ xảy ra khi có bucket thật (4.7). |
| 2 | VG | Không test nào tính lại chữ ký SigV4 theo `content-type`/`content-length` đã khai và secret: nối sai secret, controller truyền sai số byte hay SDK đổi canonical request thì mọi test vẫn pass | medium | patch | Gap VG đã kiểm: `event-image.test.ts:145-186` chỉ kiểm hình dạng URL (`X-Amz-SignedHeaders` là tên header, chữ ký chỉ kiểm 64 hex). Bộ kiểm SigV4 của lượt build không nằm trong repo. |
| 3 | VG, BH | Không có unit test trực tiếp cho `S3ObjectStorage`: bỏ cắt `/` cuối của `publicBaseUrl`, đổi mã hóa từng segment, hay URL kiểu virtual-hosted (mặc định `S3_FORCE_PATH_STYLE=false`) thì không test nào bắt | low | patch | Gap VG đã kiểm: base của test không có `/` cuối; `z.url` không chuẩn hóa `/` cuối; helper và `.env.example` đều path-style. Sửa trực tiếp: thêm file test. |
| 4 | ECH, BH | Bỏ trường `imageKey` là gỡ ảnh: web hiện tại (và tab web cũ sau 4.8-b) lưu Sự kiện thì xóa ảnh đặt bằng `curl` theo README | low | patch | Khối frozen chốt "`imageKey: null` (hoặc bỏ trường)" là gỡ ảnh nên giữ ngữ nghĩa; mục 4.8-b đã ghi web luôn gửi `imageKey`. README hướng dẫn đặt ảnh bằng `curl` mà không cảnh báo. Sửa trực tiếp: thêm một câu vào README. |
| 5 | ECH, BH | Web deploy trước api thì response thiếu `imageUrl`/`imageKey`, parse schema lỗi ở dashboard, Cài đặt và `/e/{slug}` | medium | defer | Mối nguy chung của rolling deploy khi contract thêm trường bắt buộc, cùng loại mục 4.6-e đã hoãn sang checklist 4.7; chưa có production. |
| 6 | BH | `EventDetail.imageKey` dùng regex đầu vào cho response: key lưu không khớp regex (sửa DB tay, dạng key sau này) làm hỏng cả response | low | patch | Mọi đường ghi đã kiểm regex nên hôm nay không gặp. Sửa trực tiếp: response dùng `z.string().nullable()`, regex chỉ ở đầu vào. |
| 7 | BH | `S3_ENDPOINT` dùng `httpUrl` nên nhận path, query, `user:pass@` | low | patch | Repo có sẵn helper `httpOrigin` (`config.schema.ts:27`) cho `TINGEE_BASE_URL`, `API_PUBLIC_URL`. Sửa trực tiếp: đổi helper. |
| 8 | ECH, BH | `S3_PUBLIC_BASE_URL` có query hoặc fragment thì key bị nối sau `?`/`#`, mọi `imageUrl` sai | low | reject | Chỉ khi cấu hình sai; base CDN có query là hiếm. Sửa là thêm guard. |
| 9 | BH | Regex bucket nhận `a..b`, tên dạng IP, và dấu chấm (hỏng TLS khi virtual-hosted) | low | reject | Chỉ khi cấu hình sai; storage từ chối tên sai lúc tạo bucket ở 4.7. Sửa là regex phức tạp hơn. |
| 10 | ECH | Lưu key đúng tiền tố mà chưa PUT thành công thì `imageUrl` trỏ object không có | low | reject | Design Notes chốt không HEAD; 4.8-b chỉ đặt key sau PUT 200 và có fallback `onError`. Sửa là thêm bảng key đã cấp hoặc gọi mạng tới storage. |
| 11 | BH | DB không có CHECK tiền tố `image_key` theo `organization_id` | low | reject | Chỉ `create` và `applyEventEdit` ghi cột, cả hai gọi `assertOwnEventImageKey`. `0031` đã chạy ở DB local và test nên phải thêm migration mới. |
| 12 | BH | Object không có `Cache-Control`; response không liệt kê header PUT phải gửi | low | reject | Hiệu năng thuộc mục hoãn resize/CDN (NFR-1). Ký thêm header là đổi hợp đồng với trình duyệt; 4.8-b chỉ cần `content-type`. |
| 13 | BH | URL PUT dùng lại được trong 5 phút, ghi đè được ảnh đã lưu | low | reject | URL chỉ nằm trong trình duyệt người upload, hạn 5 phút. Sửa là ký `If-None-Match` và đổi hợp đồng của 4.8-b. |
| 14 | BH | `hide`, `unhide`, `end`, `publish`, `updateOrderLimit` chưa test với Sự kiện có ảnh | false | reject | Kiểu trả về `EventDetail` bắt buộc có `imageKey`/`imageUrl` nên typecheck chặn thiếu trường; cả năm đường cùng gọi `detailOf(row, this.storage)`. |
| 15 | BH | Đổi `S3_PUBLIC_BASE_URL` sau này (lên CDN) làm mọi `imageUrl` đổi cùng lúc, chưa có kế hoạch | low | reject | Việc vận hành tương lai, không có hậu quả trong thay đổi này. |
| 16 | BH | CORS của MinIO local chỉ cho một origin | false | reject | Cả stack local cố định `http://localhost:3000` (`WEB_ORIGIN` trong `.env.example`; CORS của api và Better Auth chỉ tin origin này): mở web ở `127.0.0.1` thì gọi api đã hỏng từ trước. |

Mục 1 (intent_gap): Mason chọn hoãn, chặn trước 4.7 (18/11/2026). Quyết định ghi vào khối frozen, việc ghi vào `deferred-work.md`; không loopback, mã giữ nguyên.

## Design Notes

- **Đọc công khai, không presigned GET:** ảnh Sự kiện vốn công khai, và crawler Facebook/Zalo cần URL ổn định cho OG. Bucket cho đọc ẩn danh; key chứa uuid nên ảnh của Sự kiện nháp không đoán được. API trả URL đầy đủ, nên web không cần env mới.
- **CORS gồm cả `PUT`:** AC 4.8 chỉ nêu `GET`, nhưng trình duyệt PUT thẳng cross-origin.
- **5 MB chặn ở storage:** URL ký `content-length` đúng số byte khai lúc presign. Không HEAD object khi lưu: key trỏ object không tồn tại chỉ làm ảnh rơi về fallback ở web.
- **Presign theo BTC, không theo Sự kiện:** wizard upload trước khi Sự kiện có id.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: không lỗi.
- `pnpm turbo lint:deps` -- expected: không vi phạm.
- `pnpm --filter @tickee/api build && pnpm --filter @tickee/api test` -- expected: pass.
- `pnpm --filter @tickee/web test` -- expected: pass.

**Manual checks:**
- `docker compose up -d --wait`, `pnpm dev`, đăng nhập BTC demo: gọi presign, PUT một ảnh WebP bằng `curl`, PATCH Sự kiện với key đó; `GET` detail có `imageUrl` mở được trong trình duyệt; mở console MinIO (`:9001`) thấy object dưới `orgs/{orgId}/events/`.
