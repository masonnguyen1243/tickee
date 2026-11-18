---
title: 'Story 4.6-d: Dead-letter ở /admin'
type: 'feature'
created: '2026-11-17'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'ed45a4e2eda73760ec7342a7e53996d5b39faab4'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Job hết retry rơi vào queue `*.dead-letter` của pg-boss và nằm đó 14 ngày. Kênh cảnh báo của 4.6-b chỉ gửi email nêu `jobId`, nên muốn biết lý do lỗi hay chạy lại job thì vận hành phải vào DB tay (AD-12: "có requeue từ `/admin`").

**Approach:** Thêm tab "Dead-letter" vào trang `/admin`. Quản trị Tingee xem job đang nằm trong mọi queue dead-letter (queue gốc, id job gốc, số lần đã thử, lý do lỗi, payload) và requeue từng job về queue gốc. Requeue và audit chạy trong cùng một transaction.

## Boundaries & Constraints

**Always:**
- **API** (module `admin`, `@RequirePlatformAdmin()`, đi qua guard step-up hiện có):
  - `GET /v1/admin/dead-letters`: trong tx có `platformAdminScope` (audit `platform_admin.read`, target `{ type: 'dead_letter_jobs', id: 'all' }`). Chọn job `state = 'created'` trong queue có tên kết thúc bằng `.dead-letter`, mới nhất trước, tối đa 200, kèm `total`. Header `cache-control: no-store`.
  - Mỗi job trả về: `id`, `queue` (tên dead-letter), `sourceQueue`, `sourceJobId`, `retryCount` (`source_retry_count`), `createdAt` (lúc vào dead-letter), `reason`, `payload`.
  - `reason` lấy `message` từ `source_output` (không có thì JSON của cả output). Thay chuỗi dạng email và chuỗi từ 9 chữ số trở lên bằng `[REDACTED]`, cắt 300 ký tự, không bao giờ trả stack. `payload` là JSON của `data`, cắt 300 ký tự.
  - `POST /v1/admin/dead-letters/:id/requeue` (id uuid, sai thì 400 `VALIDATION_FAILED`): trong một tx, tìm job theo id trong queue dead-letter với `state = 'created'`. Gọi `boss.redrive(<queue>, { ids: [id], limit: 1, db })` trên chính tx đó. redrive tạo job mới ở queue gốc (retry từ 0) và xóa dòng dead-letter.
  - Kết quả của requeue:
    - Thành công: ghi `audit.record` action mới `dead_letter_job.requeued`, `organizationId: null`, target `{ type: 'dead_letter_job', id: '<queue>:<id>' }`, rồi trả 204.
    - Không tìm thấy job, hoặc redrive chuyển 0 job: 409 `DEAD_LETTER_JOB_GONE`, không ghi audit.
- **Web** (tab thứ 5 trong `ClosedBetaReview`, theo mẫu tab "Tạm ngừng bán"):
  - Bảng có các cột: queue gốc, thời điểm vào dead-letter, số lần đã thử, lý do lỗi, payload, nút "Requeue". `total` > 200 thì ghi "Đang hiện 200/{total} job mới nhất".
  - Bấm "Requeue" mở `ConfirmDialog` nêu queue gốc và cảnh báo job sẽ chạy lại từ đầu (job gửi email sẽ gửi lại). Khi đang gửi, nút hiện spinner và không bấm lặp được.
  - Thành công: toast "Đã requeue job vào {sourceQueue}." rồi tải lại danh sách. Gặp 409: toast info "Job không còn trong dead-letter." rồi tải lại.
  - Danh sách trống: `EmptyState` "Không có job nào trong dead-letter."

**Never:**
- Không xóa, bỏ qua hay requeue hàng loạt. Không sửa payload trước khi requeue.
- Không dùng `boss.retry` trên job gốc ở trạng thái `failed`. Không đăng ký worker cho queue dead-letter.
- Không đổi luật cảnh báo hay nội dung email của 4.6-b. Không làm `ADMIN_ALLOWED_CIDRS` (4.7).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Xem danh sách | 2 job ở hai queue dead-letter khác nhau | Thấy cả hai với `sourceQueue`, `sourceJobId`, `reason`; có thêm một dòng audit `platform_admin.read` | N/A |
| Lý do có PII | `source_output.message` chứa `a@b.vn` và `0912345678`, kèm stack | `reason` thay cả hai bằng `[REDACTED]`, không có stack, dài tối đa 300 ký tự | N/A |
| Requeue | Job dead-letter `created` | Trả 204. Queue gốc có job mới cùng `data`, dòng dead-letter biến mất, có audit `dead_letter_job.requeued` | N/A |
| Requeue hai lần | Hai request đua nhau trên cùng job | Một bên 204, bên kia 409 `DEAD_LETTER_JOB_GONE`; chỉ có một job mới và một audit | N/A |
| Id không phải dead-letter | id của job thường ở `ordering.expire-order` | 409 `DEAD_LETTER_JOB_GONE`, job thường không đổi | N/A |
| Không phải Quản trị Tingee | Ẩn danh, user thường, Owner, Quản trị Tingee chưa step-up | 401 / 403 như mọi route `/v1/admin/*` | N/A |
| Danh sách rỗng | Không có job dead-letter | Thấy `EmptyState` | N/A |

</frozen-after-approval>

## Code Map

Đường dẫn dưới `apps/api/` trừ khi ghi khác.

- **Admin:** `src/modules/admin/admin.module.ts:11-15` khai controller và provider. Lấy `payment-service.controller.ts` làm mẫu cho `@RequirePlatformAdmin()`, `@PlatformAdminAccess()`, `platformAdminScope` (:43), `no-store`, `parseRequest` và cách tiêm `BOSS` (:12) qua `QueueProducer.ready()`.
- **pg-boss:**
  - `src/platform/jobs/queue.ts`: `fromDrizzle(tx, sql)` (:83) để truyền `db` cho `redrive`.
  - Câu SQL tìm dead-letter mẫu ở `src/platform/alerts/ops-alert-scan.ts:117-125`, cách dựng định danh `pgboss.job` ở :74, hằng `DEAD_LETTER_SUFFIX` ở :28.
  - `tickee_app` có đủ DML trên schema `pgboss` (`src/roles/migrate.ts:19`).
  - pg-boss 12.38 `redrive` chỉ nhận dòng `created`/`retry` và trả số job đã chuyển (`plans.js:3540-3593`). Dòng dead-letter có `source_name`, `source_id`, `source_retry_count`, `source_output`.
  - Code đọc `pgboss.job` đặt ở file mới `src/platform/jobs/dead-letters.ts`. File này không import module nào (`.dependency-cruiser.cjs:71`).
- **Audit:** thêm `'dead_letter_job.requeued'` vào union `AuditAction` (`src/platform/audit/audit.ts:6-166`), kèm doc comment. Ghi bằng `audit.record(tx, …)` (:191).
- **Contracts:** `packages/contracts/src/admin.ts` theo mẫu `SuspendedPaymentServiceOrganization(List)` (:76-87), `ADMIN_SUSPENDED_PAYMENT_SERVICES_API_PATH` (:90) và `adminPaymentServiceResumeApiPath()` (:96). Mã lỗi `DEAD_LETTER_JOB_GONE` khai ở `packages/contracts/src/errors.ts`, cạnh `PAYMENT_SERVICE_NOT_SUSPENDED` (:64).
- **Web** (`apps/web/`):
  - `app/(admin)/admin/closed-beta-review.tsx`: thêm tab theo `PAYMENT_SERVICE_TAB` (:64, :410-425); `useMutation` khai `onSuccess`/`onError` để retry `TOTP_REQUIRED` của `app/providers.tsx:24-37` chạy được; `handleActionError`/`isStale` (:245, :80).
  - `suspended-payment-services.tsx` là mẫu cho component trình bày.
  - Client gọi API ở `lib/admin/api.ts` (`apiRequest`), query key nằm dưới `ADMIN_QUERY_KEY`.
- **Test:**
  - API: `test/admin/closed-beta.test.ts:92-108`: thêm hai route mới vào `arrayContaining` của bộ test cách ly route admin; mẫu từ chối ở :110-144. Tạo Quản trị Tingee bằng `signUpPlatformAdmin` (`test/admin/platform-admin.ts:19`).
  - Tạo job dead-letter trong test: `boss.send('<q>.dead-letter', data)`, rồi `UPDATE pgboss.job SET source_name, source_id, source_output`. Queue gốc chọn queue mà payload giả không gây tác dụng phụ nếu worker của test khác nhặt job. DB dùng chung: chỉ assert theo id của chính test.
  - E2E: `apps/web/e2e/admin-mock.ts` (`mockAdminApi`, thêm handler) và mẫu `admin-closed-beta.spec.ts:256`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/admin.ts`, `errors.ts`: schema `DeadLetterJob`, `DeadLetterJobList { items, total }`, path list và hàm path requeue, mã `DEAD_LETTER_JOB_GONE`.
- [x] `apps/api/src/platform/jobs/dead-letters.ts` (mới) và `index.ts`: `listDeadLetterJobs(reader, limit)` và `requeueDeadLetterJob(boss, tx, id)`, gồm che `reason`.
- [x] `apps/api/src/platform/audit/audit.ts`: action `dead_letter_job.requeued`.
- [x] `apps/api/src/modules/admin/dead-letter.controller.ts` (mới) và `admin.module.ts`: hai route.
- [x] `apps/api/test/admin/dead-letter.test.ts` (mới): mỗi dòng của I/O Matrix. Sửa `closed-beta.test.ts` để thêm route vào danh sách cách ly.
- [x] `apps/web/lib/admin/api.ts`, `app/(admin)/admin/dead-letter-jobs.tsx` (mới), `closed-beta-review.tsx`: tab, bảng, dialog, toast.
- [x] `apps/web/e2e/admin-mock.ts`, `apps/web/e2e/admin-dead-letter.spec.ts` (mới): xem danh sách, requeue thành công, 409, danh sách rỗng.

**Acceptance Criteria:**
- Given `pnpm turbo lint:deps`, then sạch.
- Given toàn bộ test api và e2e web hiện có, then pass.

## Implementation Notes

- `story_key`: `4-6-giám-sát-và-lưới-an-toàn-vận-hành`. Đây là phần cuối của 4.6 (a, b, c, e đã xong). Xong 4.6-d thì đặt story `done`.
- Nhánh `feat/4-6-d-dead-letter-o-admin`, cắt từ `main` (`ed45a4e2eda73760ec7342a7e53996d5b39faab4`).
- Lựa chọn ngoài spec của lượt triển khai:
  - `sourceQueue`, `sourceJobId`, `retryCount`, `reason` nullable trong contract. Dòng không có queue gốc hiện "Không rõ queue gốc" và không có nút Requeue.
  - `DEAD_LETTER_SUFFIX` chuyển từ `platform/alerts/ops-alert-scan.ts` sang `platform/jobs/dead-letters.ts`, tránh vòng phụ thuộc jobs→alerts.
  - Controller gọi `boss.start()` (idempotent trong pg-boss 12.38) thay vì `QueueProducer.ready()`, vì `redrive` không cần ensure queue nào.
  - Bảng hiện thêm id job dead-letter, là id mà email cảnh báo nêu.

## Spec Change Log

## Review Triage Log

Lượt 1 (18/11/2026). BH = blind-hunter, ECH = edge-case-hunter, VG = verification-gap.

| # | Nguồn | Phát hiện | Verdict | Route | Bằng chứng |
|---|-------|-----------|---------|-------|------------|
| 1 | BH | `redactDeadLetterText` chạy regex email trên toàn bộ `message`/JSON trước khi cắt; chuỗi dài không có `@` tốn O(n²) (100k ký tự ≈ 6 giây), chặn event loop của api, tối đa 200 dòng mỗi request | medium | patch | `EMAIL_PATTERN` bắt đầu bằng `[…]+` tham lam, thử lại ở mọi vị trí (`dead-letters.ts:207`). Lỗi Drizzle mang cả câu SQL dài vài KB. Sửa trực tiếp: cắt đầu vào trước khi che. |
| 2 | VG | Requeue và audit cùng transaction chưa có test: dời `audit.record` ra sau tx thì mọi test vẫn pass | medium | patch | Gap VG đã kiểm. Đây là bất biến trong khối frozen. Mẫu ép lỗi có sẵn: `test/payment/reconciliation.test.ts:290`. |
| 3 | BH, ECH | Cột "Số lần đã thử" hiện `source_retry_count`, tức số lần thử lại; số lần chạy thật là +1. Assert e2e `toContainText('8')` luôn pass vì id job có chữ số `8` | low | patch | `plans.js`: job chỉ thất bại hẳn khi `retry_count = retry_limit`, nên retryLimit 8 là 9 lần chạy. Giữ nhãn của khối frozen, hiện `retryCount + 1`, assert đúng ô. |
| 4 | ECH | Bảng không hiện id job gốc dù API trả `sourceJobId` | low | patch | `dead-letter-jobs.tsx` chỉ render `job.id` (id dead-letter). Approach của khối frozen nêu "id job gốc". Sửa trực tiếp: render thêm một dòng. |
| 5 | ECH | `message` là chuỗi rỗng thì `reason` = `''`, ô "Lý do lỗi" trống (bỏ qua "Không có") | low | patch | `deadLetterReason` chỉ kiểm `typeof message === 'string'`. Sửa trực tiếp: chuỗi rỗng thì dùng JSON của output. |
| 6 | VG | Ngưỡng "từ 9 chữ số" chưa test: đổi `\d{9,}` thành `\d{10,}` thì test vẫn pass | low | patch | Gap VG đã kiểm: test chỉ dùng số 10 và 11 chữ số. Thêm ca 9 chữ số (bị che) và 8 chữ số (giữ nguyên). |
| 7 | BH, ECH, VG | redrive chuyển 0 job vì queue gốc không còn hoặc trùng singleton: API trả 409 "Job không còn trong dead-letter" trong khi dòng vẫn còn và nút Requeue vẫn hiện | low | reject | Khối frozen định 409 `DEAD_LETTER_JOB_GONE` cho cả hai trường hợp. Queue của Tickee không bao giờ bị xóa khỏi `pgboss.queue` (ensure chỉ tạo/cập nhật), và không queue nào dùng singleton hay policy (grep `singletonKey\|policy:`). Sửa thì phải thêm trường mới vào contract. |
| 8 | BH, ECH | Mẫu che bỏ sót SĐT có dấu cách, chấm hay `+84`; payload không được che | low | reject | SĐT lưu dạng chuẩn hóa, lỗi của handler hiếm khi chứa SĐT. Payload theo hợp đồng chỉ chứa id (`contracts/src/jobs.ts`). Sửa là thêm regex mới. |
| 9 | ECH | Đoạn ≥ 9 chữ số trong UUID hoặc mốc epoch-ms bị che, id trong lý do lỗi bị cắt dở | low | reject | Đúng như quy tắc trong khối frozen. Xác suất thấp (chỉ đoạn cuối 12 ký tự hex của UUID), và id job vẫn hiện ở cột riêng. Sửa phải thêm logic bảo vệ UUID. |
| 10 | BH | Không mở lớp bọc `{ value: { message } }` của pg-boss (lỗi timeout, heartbeat) | low | reject | `plans.js:2956-2960`. Ô vẫn hiện JSON có message ("job timed out"), đọc được. Handler timeout hiếm. Sửa phải thêm nhánh. |
| 11 | BH | Cắt 300 ký tự mà không có dấu `…`, payload cắt dở trông như đầy đủ | low | reject | Đúng giới hạn 300 của khối frozen. Đầy đủ dữ liệu tra được bằng id job ở cột riêng. |
| 12 | BH | Chỉ xem được 200 job mới nhất, không phân trang, không có cột hạn xóa (`keep_until`) | low | reject | Khối frozen chốt 200 job mới nhất kèm `total`. Sửa là sửa spec. |
| 13 | BH | Audit không ghi queue đích, `source_id` hay id job mới | low | reject | Target của khối frozen là `<queue>:<id>`; queue đích suy được từ tên dead-letter. Job mới tra được qua `source_root_id`. Sửa là sửa spec. |
| 14 | BH | Chưa test đường redrive xung đột (pg-boss đổi dòng sang `failed` tại chỗ, rollback hoàn lại) | low | reject | Không queue nào khai singleton hay policy, nên đường này không chạy được hôm nay. Rollback của tx bảo đảm đúng theo cấu trúc. |
| 15 | BH | Test giới hạn tạo 201 dòng cùng `created_on`; thiếu e2e cho banner lỗi tải và `TWO_FACTOR_NOT_ENABLED` ở tab này | low | reject | Thứ tự mới nhất trước đã test ở ca hai queue. Banner lỗi và cổng 2FA dùng chung code với các tab khác (`active`), đã có e2e ở `admin-closed-beta.spec.ts`. |
| 16 | BH | Dead-letter chỉ nhận ra qua hậu tố `.dead-letter`, quy ước không được ép | false | reject | Cả 10 queue dead-letter trong `JobQueue` đều theo hậu tố. Không queue nào bị bỏ sót (giống #26 của 4.6-b). |
| 17 | BH | Chưa có unit test cho `truncate` (cặp surrogate) và các ca biên của regex | low | reject | Logic ngắn và đúng khi đọc: bỏ nửa surrogate cao ở cuối. Ca 9 chữ số đã patch ở #6. |
| 18 | BH | Dialog cảnh báo "Job gửi email sẽ gửi lại email." với mọi queue | false | reject | Câu là điều kiện ("job gửi email") và đúng với mọi queue; câu trước nêu job chạy lại từ đầu ở queue gốc. Đúng như khối frozen. |
| 19 | BH | `ClosedBetaReview` ôm 5 tab; `staleMessage` rơi về câu về BTC cho mã lạ | false | reject | `isStale` chỉ nhận 4 mã và `staleMessage` xử lý đúng cả 4. Không có mã lạ nào tới được nhánh mặc định. |
| 20 | BH | `platform/jobs/dead-letters.ts` mang logic hiển thị (che, cắt, DTO) và phụ thuộc `platform/access` | false | reject | Đặt đúng chỗ Code Map chỉ định. `lint:deps` sạch, không nêu được chỗ nào hỏng. |
| 21 | BH, VG | Controller gọi `boss.start()` thay cho `QueueProducer.ready()`; dòng này không test được vì harness luôn start pg-boss trước | false | reject | pg-boss 12.38 `start()` trả về in-flight promise hoặc `this` nếu đã start (`index.js:132-148`). Đã ghi vào Implementation Notes. Muốn test phải có harness không start pg-boss. |
| 22 | ECH | API không có test danh sách rỗng trên Postgres thật | false | reject | `total: rows[0]?.total ?? 0` trả `{ items: [], total: 0 }`. DB dùng chung nên không dựng được trạng thái rỗng. e2e đã phủ phần hiển thị. |

## Design Notes

- **`redrive`, không dùng `retry`:** `redrive` chuyển đúng dòng dead-letter về queue gốc trong một câu SQL rồi xóa dòng đó, nên luật `dead_letter` của 4.6-b không báo lại. Còn `retry` chạy lại dòng `failed` ở queue gốc, để dòng dead-letter nằm lại, và không chạy được khi dòng gốc đã hết hạn giữ.
- **Job lỗi lại sau khi requeue** thì vào dead-letter với id mới, nên kênh cảnh báo gửi email mới.
- **Không có nút xóa:** job không muốn chạy lại thì cứ để đó; pg-boss tự xóa sau 14 ngày.

## Verification

**Commands:**
- `pnpm typecheck`: expected không lỗi.
- `pnpm turbo lint:deps`: expected không vi phạm.
- `pnpm --filter @tickee/api build && pnpm --filter @tickee/api test`: expected pass.
- `pnpm --filter @tickee/web test:e2e e2e/admin-dead-letter.spec.ts e2e/admin-closed-beta.spec.ts`: expected pass.

**Manual checks:**
- Chạy `pnpm dev`, làm một job email rơi vào dead-letter (SMTP sai), rồi mở `/admin` › "Dead-letter" và requeue job đó (SMTP đã sửa). Mailpit nhận email, tab trống lại.
