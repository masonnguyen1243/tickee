---
title: 'Story 4.7-d: Giới hạn presign ảnh Sự kiện'
type: 'feature'
created: '2026-11-19'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '3f01fcd4af1773229a28ec75a268d7bf278c039b'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `POST /v1/orgs/:orgId/event-images` cấp URL upload 5 MB không giới hạn và không ghi ai xin key nào. Ai có tài khoản cũng tạo được BTC (`POST /v1/orgs` không cần duyệt) rồi biến bucket đọc công khai thành chỗ chứa file miễn phí dưới tên miền Tickee, không truy được người tải. Review 4.8-a chốt việc này phải xong trước khi tạo bucket production (4.7).

**Approach:** Đếm mỗi lần presign thành công trong Postgres, theo BTC và theo tài khoản (gộp mọi BTC của tài khoản), cửa sổ trượt, theo mẫu `ordering/order-rate-limit.ts`. Vượt thì `429` kèm `retryAfterSeconds`. Mỗi lần cấp ghi log info `userId`, `organizationId`, `key`.

**Quyết định (Mason, 19/11/2026):**
- Trần: 50 lần mỗi BTC và 100 lần mỗi tài khoản (gộp mọi BTC) trong 24 giờ trượt.
- Không đòi BTC đã duyệt Closed Beta: BTC chưa duyệt vẫn mở bán Sự kiện miễn phí nên vẫn cần ảnh.
- Ô ảnh trên web khi bị `429`: hiện "Bạn đã tải quá nhiều ảnh. Thử lại sau {n} phút." (từ 60 phút trở lên thì "{n} giờ"), vẫn giữ nút "Thử lại".

## Boundaries & Constraints

**Always:**
- Kiểm giới hạn sau `parseRequest` (body sai → `400`, không đếm) và trước khi ký URL. Chỉ lần cấp thành công mới được đếm; lần bị `429` không ghi.
- Hai giới hạn đọc từ một hằng trong `packages/contracts`. Request song song của cùng tài khoản hay cùng BTC không cùng lọt quá trần.
- Lỗi `429 EVENT_IMAGE_RATE_LIMITED`, `details.retryAfterSeconds` (số nguyên dương) theo giới hạn chặn lâu nhất.
- Log info khi cấp: `userId`, `organizationId`, `key`. Log warn marker `event_image_presign_limited` khi chặn: `userId`, `organizationId`, giới hạn nào. Không log IP, email hay URL ký.
- Bảng đếm không phình: dòng ra khỏi cửa sổ bị xóa.

**Never:**
- Không đổi quyền route (`events.manage`), hợp đồng thành công, hạn URL, loại hay dung lượng ảnh.
- Không giới hạn theo IP. Không dọn object trên storage. Không cấu hình bucket staging/production.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Dưới trần | Owner/Admin, body hợp lệ | `200` như cũ; thêm một dòng đếm; log info | — |
| Chạm trần BTC | BTC đã đủ lần trong cửa sổ, kể cả do thành viên khác | `429 EVENT_IMAGE_RATE_LIMITED`, `retryAfterSeconds` | Không ghi dòng |
| Chạm trần tài khoản | Tài khoản đủ lần, gộp qua nhiều BTC | `429` ở mọi BTC của tài khoản | Không ghi dòng |
| Song song | N request cùng lúc khi còn 1 lượt | đúng 1 lần `200` | Còn lại `429` |
| Hết cửa sổ | Lần cũ nhất ra khỏi cửa sổ | Cấp lại được | — |
| Body sai | `{}` | `400`, không đếm | — |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/event/event-images.controller.ts` -- gọi limiter giữa `parseRequest` và `presignPut`; log sau khi ký. Logger Nest dạng `this.logger.log({ ...fields }, 'câu')` (vd. `payment/reconciliation-worker.ts:161`).
- `apps/api/src/modules/ordering/order-rate-limit.ts` -- mẫu chép: transaction riêng, `pg_advisory_xact_lock(hashtextextended(…))`, đọc dòng thứ `limit` mới nhất (`offset(limit-1)`), `dbNow`, `AppError` kèm `details`. Không cần HMAC IP. Khóa tài khoản trước rồi khóa BTC (thứ tự cố định, tránh deadlock).
- `apps/api/src/modules/event/schema.ts` -- bảng mới `event_image_presigns` (`id`, `organization_id`, `user_id`, `created_at`; index `(organization_id, created_at)` và `(user_id, created_at)`), theo `orderCreateAttempts` (`ordering/schema.ts:241-253`). Migration `pnpm --filter @tickee/api db:generate --name event_image_presigns` → `drizzle/0032_…`. `grants.ts` không đổi (`tickee_app` có đủ DML trên bảng thường).
- Dọn: xóa dòng hết cửa sổ của chính tài khoản và BTC đó trong cùng transaction. `modules/event` chỉ được phụ thuộc `organizer` (`.dependency-cruiser.cjs`), nên không gắn vào cron của `ordering`.
- `apps/api/src/modules/event/event.module.ts` -- khai provider.
- `packages/contracts/src/event.ts` (`:86-128`) -- hằng `EVENT_IMAGE_PRESIGN_LIMITS`, `EventImageRateLimitedDetails`. `packages/contracts/src/errors.ts` (mẫu `:191-192`) và `apps/api/src/platform/http/app-error.ts` (`:59`) -- mã mới, HTTP 429.
- Web: `apps/web/lib/event/image-upload.ts` (câu lỗi), `use-event-image.ts:83-91` (`onError`); mẫu đổi `retryAfterSeconds` ra phút/giờ ở `lib/auth/api.ts:46-57`, `lib/order/checkout-form.ts:154`. Test: `apps/web/test/event-image-upload.test.ts`, `apps/web/e2e/event-image.spec.ts` (mock presign `:33`).
- Test api: `apps/api/test/event/event-image.test.ts` (harness, `signUp`, Admin chèn thẳng `members`); mẫu `429` ở `test/ordering/orders.test.ts:516-548`. Route đã nằm trong `test/organizer/isolation.test.ts`. Mỗi test dùng BTC và tài khoản mới (DB dùng chung giữa các file test, không truncate).

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/event.ts`, `errors.ts` -- hằng giới hạn, schema `details`, mã lỗi.
- [x] `apps/api/src/modules/event/schema.ts` + migration `0032` -- bảng đếm.
- [x] `apps/api/src/modules/event/event-image-rate-limit.ts` (mới), `event.module.ts`, `event-images.controller.ts`, `platform/http/app-error.ts` -- limiter, gọi trong route, log.
- [x] `apps/api/test/event/event-image-rate-limit.test.ts` (mới) -- mọi dòng của I/O Matrix; log info có đủ ba trường; dòng hết cửa sổ bị xóa (chèn dòng cũ bằng SQL như `safety-net.test.ts:380`).
- [x] `apps/web/lib/event/image-upload.ts`, `use-event-image.ts` -- câu lỗi `429` ở ô ảnh theo Quyết định; unit test ở `apps/web/test/event-image-upload.test.ts` và một case trong `apps/web/e2e/event-image.spec.ts` (mock presign trả `429`).
- [x] `README.md` -- một dòng về giới hạn presign trong mục ảnh Sự kiện.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- "Đã xử lý (…)" dưới mục review 4.8-a (giới hạn presign) và dưới story con tương ứng ở mục "tách phạm vi Story 4.7".

**Acceptance Criteria:**
- Given `pnpm typecheck`, `pnpm turbo lint:deps`, then sạch.
- Given toàn bộ test api và web hiện có, then pass (presign trong test cũ không chạm trần).

## Implementation Notes

- Sprint-status: theo tiền lệ 4.7-a/b/c, `story_key` coi như rỗng; `4-7-…` giữ `in-progress`.
- Kích thước: khoảng 2.300 token, vượt mức 1.600; Mason chọn giữ cả spec (một mục tiêu, API + câu lỗi web).
- Nhánh `feat/4-7-d-gioi-han-presign-anh-su-kien`, cắt từ `main`.
- Lựa chọn của lượt triển khai:
  - `EventImagePresignLimiter.issue(userId, orgId, sign)` gói cả việc ký URL trong transaction đếm: ký lỗi thì rollback, không đếm. Ký URL là SigV4 cục bộ, không gọi mạng, nên transaction chỉ dài thêm rất ít.
  - `organization_id` có FK tới `organizations`. `user_id` không có FK, vì `event` không được phụ thuộc `identity` (AD-10).
  - Log `warn` mang `limits: ['organization' | 'user']`. `details` sai dạng ở web thì báo chờ 24 giờ (cả cửa sổ).
  - Dọn chỉ xóa dòng hết cửa sổ của tài khoản và BTC đang xin. Tài khoản không bao giờ xin lại thì giữ tối đa số dòng trong một cửa sổ; không có cron dọn chung.
- Kiểm chứng 19/11/2026:
  - `pnpm typecheck` và `pnpm turbo lint:deps` sạch.
  - Test mới `test/event/event-image-rate-limit.test.ts` 10/10, cùng `event-image.test.ts` và `isolation.test.ts` (31/31).
  - Web: unit `event-image-upload.test.ts` 36/36; e2e case `429` xanh trên cả hai project.
  - Agent triển khai báo: api 1565/1565, web 325/325, e2e giả lập 1118/1118. Tháo khóa tài khoản hoặc khóa BTC thì test song song tương ứng đỏ 3/3 lượt.
  - Lượt chạy toàn bộ e2e giả lập của bước kiểm: 1117/1118. Ca fail `public-event-revalidate.spec.ts:15` (android-chromium) chạy riêng 6/6 pass, diff không chạm trang công khai; ghi vào `deferred-work.md` (E2-8).
- Sửa sau review vòng 1 (triage #1–3, #5–8, #13–14):
  - Dọn bảng: mỗi lần gọi (kể cả khi bị chặn) xóa tối đa 500 dòng hết cửa sổ của mọi tài khoản và BTC, qua `id IN (SELECT … FOR UPDATE SKIP LOCKED)`. Khác Code Map (chỉ xóa dòng của tài khoản và BTC đang xin), để đúng câu Always và để không khóa chéo dòng.
  - Log `info` có marker `event_image_presign_issued`; log `warn` thêm `retryAfterSeconds`.
  - Web: `details` sai dạng thì báo "Bạn đã tải quá nhiều ảnh. Thử lại sau." (không có số).
  - README: cách gỡ chặn một BTC hoặc một tài khoản ở staging/production.
  - Test: `retryAfterSeconds` khi chỉ giới hạn tài khoản chặn, và khi giới hạn tài khoản là bên chặn lâu hơn.

## Spec Change Log

## Review Triage Log

Vòng 1 (19/11/2026): Blind Hunter (BH), Edge Case Hunter (EC), Verification Gap (VG).

| # | Lớp | Phát hiện | Verdict | Bằng chứng | Hướng |
|---|-----|-----------|---------|------------|-------|
| 1 | BH | Dòng hết cửa sổ của tài khoản/BTC không xin lại không bao giờ bị xóa; bảng lớn theo số BTC từng presign | low | Đúng: `DELETE` lọc `user_id = U OR organization_id = O`. Trái câu Always "dòng ra khỏi cửa sổ bị xóa". Sửa trực tiếp: xóa dòng hết cửa sổ của mọi nơi | patch |
| 2 | BH | `DELETE` chạm dòng ngoài hai khóa advisory: hai request không liên quan có thể khóa chéo dòng của nhau | low | Đúng: (U1,O1) và (U2,O2) cùng xóa được dòng (U2,O1), (U1,O2); thứ tự quét khác nhau thì Postgres hủy một bên (500). Sửa trực tiếp: xóa qua `id IN (SELECT … FOR UPDATE SKIP LOCKED)` | patch |
| 3 | BH | Không test khi giới hạn tài khoản là giới hạn chặn lâu hơn | medium | Cùng gốc với #13; gap đã kiểm | patch |
| 4 | BH | Rollback khi ký URL lỗi chưa có test | low | Ký là SigV4 cục bộ, không lỗi với cấu hình hợp lệ; sửa phải thay `OBJECT_STORAGE` trong DI, nhiều hơn một sửa trực tiếp | reject |
| 5 | BH | `details` sai dạng thì web báo "24 giờ" như sự thật | low | Chỉ khi api gửi `details` sai, hiện không xảy ra; sửa trực tiếp: câu không có số "Thử lại sau." | patch |
| 6 | BH | Log `info` khi cấp không có marker, truy vết dựa vào câu tiếng Việt | low | Đúng: chỉ dòng `warn` có `marker`; test lọc theo `msg`. Sửa trực tiếp: thêm marker `event_image_presign_issued` | patch |
| 7 | BH | Log `warn` khi chặn thiếu `retryAfterSeconds` | low | Đúng; sửa trực tiếp: thêm trường | patch |
| 8 | BH | Không có cách gỡ chặn cho một BTC thật ở production; README chỉ có `DELETE` cả bảng | low | Đúng; sửa trực tiếp: README thêm lệnh xóa theo `organization_id`/`user_id` | patch |
| 9 | BH | Thêm cột `key` vào bảng đếm để truy người tải từ DB | low | Intent chọn log `info` để truy vết; thêm cột là đổi migration, nhiều hơn sửa trực tiếp | reject |
| 10 | BH | Bản thứ ba của hàm đổi `retryAfterSeconds` ra câu chờ | low | Ba nơi khác nhau về đơn vị và mặc định; gom lại là refactor ba nơi gọi | reject |
| 11 | BH | `429` không có header `Retry-After` | low | Có từ trước cho mọi mã `429` (`ORDER_RATE_LIMITED`, OTP); web chỉ đọc `details`; sửa ở filter lỗi toàn cục | reject |
| 12 | EC | Một tài khoản dội nhiều presign cùng lúc: mỗi request chờ khóa advisory giữ một kết nối pool (tối đa 10), request khác của api chờ pool | medium | Đúng: các transaction cùng tài khoản chạy tuần tự, còn kết nối chờ thì bị giữ. Cùng thiết kế với `OrderRateLimiter`, mà intent đóng băng bảo theo mẫu đó; chọn try-lock hay `lock_timeout` là đổi hành vi "Song song" | defer |
| 13 | VG | `retryAfterSeconds` của giới hạn tài khoản và luật "chặn lâu nhất" khi tài khoản là bên lâu hơn không được kiểm | medium | Gap đã kiểm: `blocked[0]!.allowedAt` hay bỏ `* 1000` ở nhánh tài khoản vẫn qua mọi test | patch |
| 14 | EC | Như #1 (dòng hết cửa sổ không bao giờ bị xóa) | low | Cùng gốc với #1 | patch |

## Design Notes

- **Theo tài khoản gộp mọi BTC:** đường lạm dụng là một tài khoản tạo nhiều BTC; trần theo BTC một mình không chặn được.
- **Đếm lần cấp, không đếm upload:** api không gọi storage nên không biết PUT có xảy ra; mỗi URL cấp ra là một lần upload tiềm năng 5 MB.

## Verification

**Commands:**
- `pnpm typecheck && pnpm turbo lint:deps` -- expected: sạch.
- `pnpm --filter @tickee/api build && pnpm --filter @tickee/api test` -- expected: pass.
- `pnpm --filter @tickee/web test && pnpm --filter @tickee/web test:e2e` -- expected: pass.
