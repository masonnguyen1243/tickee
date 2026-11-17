---
title: 'Story 4.6-b: Kênh cảnh báo vận hành'
type: 'feature'
created: '2026-11-17'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'aa65008804768186d8f48c968b64f18cd4df0a9b'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Đội vận hành chưa nhận được cảnh báo nào. Ba marker log đang chờ kênh: `payment_unmatched`, `payment_reconciliation_stopped`, `ticket_qr_key_missing`. Hàng đợi pg-boss bị ùn hay có job rơi vào dead-letter thì không ai biết.

**Approach:** Thêm kênh `platform/alerts` trong app. Kênh ghi dấu chống lặp trong DB, rồi một job pg-boss gửi email tới đội vận hành. Ba marker nối vào kênh này. Một cron quét mỗi phút chạy các luật đã đăng ký; 4.6-b đăng ký hai luật pg-boss, còn 4.6-e thêm luật nghiệp vụ.

## Boundaries & Constraints

**Always:**
- **`raise({ kind, subjects, details })`:** một tx ngắn ghi dấu `(kind, subject)` vào bảng `ops_alert_marks`. Nếu có subject mới thì enqueue một job `platform.ops-alert` trong cùng tx; job này mang `details`, số subject mới và tối đa 20 subject mới.
  - Loại `once`: mỗi subject chỉ báo một lần.
  - Loại `cooldown`: bỏ qua subject đã báo trong `OPS_ALERT_COOLDOWN_MINUTES` (mặc định 30). Instance vừa raise subject đó thì bỏ qua ngay trong bộ nhớ, không ghi DB.
  - Dấu cũ hơn 30 ngày bị xóa.
  - `raise` không bao giờ ném lỗi; lỗi chỉ ghi log `warn`.
- **Gửi:**
  - Worker gửi email `[Tickee vận hành] <tiêu đề loại>` tới `OPS_ALERT_EMAILS` (danh sách email, tùy chọn, chỉ worker cần).
  - Không đặt biến này: worker log `warn` một lần lúc khởi động. Mỗi job chỉ log `warn` rồi xong.
  - Lỗi gửi thì retry (`retryLimit` 8), hết lượt thì vào `platform.ops-alert.dead-letter`.
- **Loại và luật:**

  | kind | Vai | Báo khi | Chống lặp (subject) |
  |---|---|---|---|
  | `payment_unmatched` | api, worker | Có marker này, sau khi tx của IPN hay Đối soát bù xong | once (id `payment_events`) |
  | `payment_reconciliation_stopped` | worker | Có marker này | once (mã Đơn) |
  | `ticket_qr_key_missing` | api | Có marker này | cooldown (`qrKeyVersion:currentVersion`) |
  | `queue_backlog` | worker (quét) | Queue không phải dead-letter, không phải nội bộ pg-boss, có job `created` hoặc `retry` mà `start_after` đã qua quá `OPS_ALERT_QUEUE_WAIT_MINUTES` (mặc định 5) | cooldown (tên queue) |
  | `dead_letter` | worker (quét) | Có job `created` trong queue `*.dead-letter`. Mỗi queue một email mỗi lượt quét. Với `platform.ops-alert.dead-letter` thì chỉ log `error`, không gửi email. | once (`jobId`) |

- **Quét:**
  - Cron `platform.ops-alert-scan` chạy mỗi phút (`retryLimit: 0`), do `platform/alerts` sở hữu.
  - Registry nhận luật từ platform, và về sau từ module.
  - Một luật lỗi chỉ log `warn`; các luật còn lại vẫn chạy.
- **Nội dung và log:**
  - Nội dung chỉ mang loại, id, mã, tên queue, số đếm và lý do. Không chứa PII, secret, chữ ký hay token.
  - Mỗi lần có subject mới thì log `error` kèm `alert: <kind>`.
  - Ba marker giữ nguyên hằng, message và trường.

**Never:**
- Không làm luật nghiệp vụ (lỗi IPN, p95 tạo link, tỉ lệ phát Vé, Đơn `pending` quá hạn). Phần này thuộc 4.6-e.
- Không làm cảnh báo giữ chỗ hàng loạt (hoãn), lưới an toàn (4.6-c), hay dead-letter ở `/admin` (4.6-d).
- Không chọn backend giám sát (4.7). Không gửi qua webhook hay chat.
- Không đổi hành vi hay mã trả về của IPN, Đối soát bù hay link chia sẻ.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Không người nhận | Chưa đặt `OPS_ALERT_EMAILS`; có job dead-letter mới | Có dấu; log `error` kèm `alert`, rồi log `warn` | Job xong, không retry |
| Dead-letter | 3 job vào `ordering.send-buyer-email.dead-letter`, sau đó thêm 1 job | Email đầu nêu 3 `jobId`; lượt quét kế tiếp không gửi; email sau chỉ nêu job mới | N/A |
| Hàng đợi ùn | Job `ordering.expire-order` tới hạn từ 6 phút trước, chưa chạy | Một email nêu tên queue; 30 phút sau mới gửi lại nếu vẫn ùn | N/A |
| Job hoãn | Job `retry` có `start_after` ở tương lai | Không báo | N/A |
| Hai instance | Hai api cùng thiếu khóa QR của cùng một cặp phiên bản | Một email | N/A |
| Tiền không khớp | IPN `order_not_found` | Log như cũ, kèm một email có `organizationId`, id `payment_events` và mã Đơn (nếu đúng định dạng) | N/A |
| DB lỗi khi raise | api gọi `raise`, DB lỗi | IPN và link chia sẻ trả như cũ | log `warn` |
| Kênh tự lỗi | Job `platform.ops-alert` vào dead-letter | Quét chỉ log `error`, không gửi email | log `error` |

</frozen-after-approval>

## Code Map

- **Marker** (đường dẫn dưới `apps/api/src/modules/`):
  - `payment/ipn-processor.ts:251-257`: log sau tx của `process`. Raise ở đây, sau commit.
  - `payment/reconciliation-worker.ts:262-276`: `stop()` hiện đồng bộ; nơi gọi phải `await` raise.
  - `ticketing/tickets.service.ts:186-199`: raise trước `throw sharedTicketNotFound()`.
  - Test ghim marker: `test/payment/reconciliation.test.ts:224`, `test/ticketing/qr-key-rotation.test.ts:101,170`, `test/payment/ipn-edge.test.ts`.
- **pg-boss 12.38** (`apps/api/src/platform/jobs/`):
  - `boss.ts:44`: api chạy chế độ producer. Enqueue từ api theo mẫu `QueueProducer.ready()` (`queue.ts:101-130`) rồi `enqueue(boss, tx, …)` (`queue.ts:80-89`).
  - `defineQueue` ở `queue.ts:66`; `registerQueueWorker` ở `queue.ts:183`.
  - Tên queue khai ở `packages/contracts/src/jobs.ts`.
  - Cron theo mẫu `organizer/token-alert-jobs.ts:138,172` (`boss.schedule` trong `onApplicationBootstrap` của worker).
  - Quét bằng SQL trên `pgboss.job` (`name`, `state`, `start_after`, `id`).
  - Comment "dead-letter alerting là 4.6" ở `organizer/invitation-jobs.ts:39`, `organizer/payout-default-jobs.ts:63`, `ordering/buyer-email-jobs.ts:44`, `ordering/order-jobs.ts:39`: sửa thành trỏ tới kênh.
- **Email:** `EMAIL_TRANSPORT` (`platform/email/email-transport.ts`; worker lắp ở `worker.module.ts:35`). Dựng `{ subject, text, html }` theo mẫu `organizer/token-alert-email.ts:21`.
- **DB:**
  - Bảng platform theo mẫu `platform/audit/schema.ts`; drizzle-kit quét `src/**/schema.ts`.
  - Migration kế tiếp là `drizzle/0028_*`. Default privileges đã cấp DML cho `tickee_app`.
- **Config:** `platform/config/config.schema.ts`, mẫu nhóm `telemetry` :112-119, spread vào api (:150) và worker (:179). Lỗi chỉ nêu tên biến. Trong `test/helpers.ts:28-78`, trường có `.default()` phải đặt giá trị.
- **Ranh giới:** `.dependency-cruiser.cjs:71` cấm platform import modules. Module gọi `platform/alerts` qua `index.ts` của nó.
- **Test:**
  - Postgres thật, không có fake clock: lùi mốc bằng `now() - interval`. Chỉ `platform/db/clock.ts` được đọc đồng hồ DB.
  - Mẫu: `test/organizer/token-alert.test.ts:119,588` (gọi `scan()` trực tiếp, bắt email); `test/organizer/payment-service.test.ts:1398` (`getSchedules()`).

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/jobs.ts`: thêm `platform.ops-alert` (kèm `.dead-letter`) và `platform.ops-alert-scan`.
- [x] `apps/api/src/platform/alerts/*` (mới):
  - schema `ops_alert_marks`;
  - danh mục loại (tiêu đề, kiểu chống lặp);
  - `raise`;
  - email và worker gửi;
  - cron quét và registry;
  - hai luật pg-boss;
  - module Nest, lắp vào `api.module.ts` và `worker.module.ts`.
- [x] `apps/api/drizzle/0028_*.sql`: sinh bằng drizzle-kit.
- [x] `payment/ipn-processor.ts`, `payment/reconciliation-worker.ts`, `ticketing/tickets.service.ts`: raise cạnh marker. Sửa 4 comment dead-letter.
- [x] `platform/config/config.schema.ts` (+ test), `test/helpers.ts`, `.env.example`, `README.md`: thêm `OPS_ALERT_EMAILS`, `OPS_ALERT_COOLDOWN_MINUTES`, `OPS_ALERT_QUEUE_WAIT_MINUTES`.
- [x] Test:
  - mỗi dòng của I/O Matrix;
  - `once` và `cooldown` (gồm hết cooldown thì gửi lại);
  - ba marker đi qua kênh;
  - một luật lỗi không chặn các luật khác.

**Acceptance Criteria:**
- Given `pnpm turbo lint:deps`, then sạch.
- Given không đặt `OPS_ALERT_*`, when chạy toàn bộ test hiện có, then pass.
- Given worker khởi động, then `getSchedules()` có `platform.ops-alert-scan` chạy mỗi phút.

## Implementation Notes

- `story_key`: `4-6-giám-sát-và-lưới-an-toàn-vận-hành`. 4.6-b xong thì story vẫn chưa xong (còn 4.6-c/d/e): giữ story ở `in-progress`, không đặt `done`.
- Nhánh `feat/4-6-b-canh-bao-van-hanh`, cắt từ `main` (`aa65008804768186d8f48c968b64f18cd4df0a9b`).

## Spec Change Log

## Review Triage Log

Lượt 1 (17/11/2026). BH = blind-hunter, ECH = edge-case-hunter, VG = verification-gap.

| # | Nguồn | Phát hiện | Verdict | Route | Bằng chứng |
|---|-------|-----------|---------|-------|------------|
| 1 | VG, BH | Chưa test nào kiểm `AlertsModule.forWorker` truyền `OPS_ALERT_EMAILS` và `OPS_ALERT_QUEUE_WAIT_MINUTES` tới worker thật | medium | patch | Gap VG đã kiểm: mọi test email tự dựng `OpsAlertEmailWorker` với người nhận; test "worker thật" chạy cấu hình mặc định. Đổi thành `recipients: []` thì mọi test vẫn pass. |
| 2 | VG | Đường cron `platform.ops-alert-scan` → handler → `scan()` (payload `null`) chưa chạy trong test | medium | patch | Gap VG đã kiểm: mọi test gọi `scan()` trực tiếp. Bỏ `await this.scan()` khỏi handler thì mọi test vẫn pass. |
| 3 | VG | Gom theo queue của luật `dead_letter` (và tách `notify`) chưa test với nhiều queue trong một lượt quét | low | patch | Gap VG đã kiểm: mỗi test chỉ có job mới ở một queue mỗi lượt quét. |
| 4 | VG, BH | Đường nhiều lô của `mark` (> 1000 subject) chưa chạy | low | patch | Gap VG đã kiểm: lần raise lớn nhất trong test là 26 subject. |
| 5 | BH | `queue_backlog` của chính `platform.ops-alert` enqueue email vào đúng queue đang ùn | low | patch | `queueBacklogRule` chỉ loại `*.dead-letter` và `__pgboss*`. Luật dead-letter đã dùng `notify: false` cho queue của kênh; luật ùn chưa làm vậy. Sửa trực tiếp bằng `notify`. |
| 6 | BH | Email `payment_unmatched` thiếu mã giao dịch Tingee, vận hành phải tra DB | low | patch | Details chỉ có `organizationId`, `paymentEventId`, `orderCode`, `source`, `reason`. `providerTransactionCode` là mã (không phải PII), luôn có ở nhánh thanh toán (`ipn-processor.ts:83-93`). |
| 7 | BH | Cảnh báo phát hiện lúc chưa đặt `OPS_ALERT_EMAILS` đã có dấu, đặt biến sau cũng không gửi lại; tài liệu không nói | low | patch | Loại `once` ghi dấu cả khi job chỉ log `warn`. Sửa trực tiếp: thêm một câu vào README và `.env.example`. |
| 8 | BH | `qrAlertJobs` chỉ lọc theo subject cố định, nên job của các lượt chạy trước dồn lại (`findJobs` giới hạn mặc định, `.at(-1)`, `before + n`) | low | patch | `qr-key-rotation.test.ts:169-170`: lọc `{ kind, subjects: [pair] }`. Job ở vai api (producer) không bao giờ xong, nên giữ tới 14 ngày. Sửa trực tiếp: lọc thêm `ticketId`. |
| 9 | ECH | Job hết retry ở queue không có dead-letter (`event.revalidate-public-page`, các cron) kết thúc `failed` mà không ai biết | low | defer | Có từ trước 4.6-b: các queue này không khai dead-letter. Hai luật mới không xét job `failed`. Ghi vào deferred-work. |
| 10 | BH | Email không nêu môi trường (staging hay production); tiêu đề giống nhau nên bị gom thành một luồng | low | reject | Mỗi môi trường đặt `OPS_ALERT_EMAILS` riêng. Thêm nhãn môi trường thì phải thêm cấu hình và đổi tiêu đề đã chốt. Staging và production chưa có (4.7). |
| 11 | BH | `ticket_qr_key_missing` không nêu instance nào thiếu khóa | low | reject | Email đã nêu cặp phiên bản khóa; vận hành kiểm `TICKET_QR_KEYS` của mọi instance như hướng dẫn. Thêm id instance cần nguồn mới. Hiếm (chỉ khi xoay khóa sai). |
| 12 | BH | Email không có thời điểm phát hiện; retry có thể làm email tới trễ vài giờ | low | reject | Chỉ trễ khi SMTP lỗi kéo dài; bình thường gửi ngay. Thêm trường thì phải đổi payload. |
| 13 | BH | Một giá trị chi tiết sai dạng làm mất cả cảnh báo | false | reject | Mọi nơi gọi chỉ truyền khóa cố định và giá trị ngắn (uuid, mã Đơn, tên queue, enum lỗi). Không có đường nào tạo ra details sai dạng. |
| 14 | BH | Không giới hạn bão cảnh báo (mỗi Đơn một email khi Đối soát bù dừng hàng loạt; dead-letter mỗi phút khi SMTP sập) | low | reject | Chỉ xảy ra khi BTC đổi key lúc đang có nhiều Đơn mở, hoặc SMTP sập (khi đó email cảnh báo cũng không đi). Gom hay giới hạn tần suất là thiết kế mới. |
| 15 | BH | Email dead-letter không có id job gốc và lý do lỗi | low | reject | Id trong email tra thẳng được `pgboss.job` (dữ liệu và output của job). Màn dead-letter ở `/admin` là việc của 4.6-d. |
| 16 | BH | Kênh hỏng chỉ lộ ra qua log `warn`, không có metric | low | reject | Thêm counter OTel là phạm vi mới. Lỗi raise và lỗi luật đều log `warn` có ngữ cảnh. |
| 17 | BH | Mỗi sự kiện có hai dòng log mang cùng `alert` (marker của module và dòng của `OpsAlerts`) | low | reject | Spec yêu cầu cả hai (Always: giữ marker; mỗi subject mới log `error` kèm `alert`). Sửa thì phải sửa spec. Hai dòng phân biệt được qua `context`. |
| 18 | BH | Loại cảnh báo chốt cứng ở `platform/alerts/kinds.ts`; hằng của module lặp lại chuỗi | false | reject | Danh mục loại nằm ở platform giống `JobQueue` ở contracts; 4.6-e thêm loại tại đây. Chuỗi lệch nhau thì typecheck báo lỗi, vì `kind` có kiểu `OpsAlertKind`. |
| 19 | BH | `payment_reconciliation_stopped` chống lặp chỉ theo mã Đơn, nên lần dừng sau trong 30 ngày không gửi email | low | reject | Đúng theo spec (`once`, theo mã Đơn), đã báo ở checkpoint. Sửa thì phải sửa spec. |
| 20 | BH | Lượt quét chồng nhau có thể tách job dead-letter của một queue ra hai email | low | reject | Chỉ xảy ra khi một lượt quét kéo dài quá 1 phút (thực tế chạy vài ms). Đổi policy queue thì phải xử lý queue đã tạo. |
| 21 | BH | `await raise` làm IPN trả lời Tingee chậm hơn | low | reject | Chỉ ở nhánh tiền không khớp (hiếm), thêm một tx nhỏ. Mã trả về không đổi (test "DB lỗi khi raise"). |
| 22 | BH | Thiếu test cho dọn `RECENT_PRUNE_SIZE` | low | reject | Chỉ dọn khi có hơn 1000 subject `cooldown` (cặp khóa, tên queue): thực tế không chạm tới. |
| 23 | BH | Thiếu test vai api không lên lịch quét, không đăng ký handler email | false | reject | `forRoot` không có provider worker nào. JobsModule của api chạy chế độ producer (không schedule, không work). |
| 24 | BH | Thiếu test `payment_unmatched` với `source: 'reconciliation'` | low | reject | Cùng một nhánh code; `source` chỉ là một trường của details. |
| 25 | ECH | Instance nhớ subject `cooldown` cả khi dấu là của instance khác, nên có thể nhắc trễ tới khoảng 2 lần cooldown | low | reject | Cảnh báo đầu luôn đi; chỉ lần nhắc bị trễ, và instance khác vẫn nhắc đúng hạn. Sửa phải đọc `raised_at` của dòng không cập nhật. Rủi ro đã ghi trong báo cáo Build. |
| 26 | ECH | Queue dead-letter đặt tên không theo hậu tố `.dead-letter` | false | reject | Mọi queue dead-letter khai ở `JobQueue` đều theo quy ước này. Không có queue nào lệch. |
| 27 | ECH | Raise lỗi ở link chia sẻ thì mỗi request lại thử tx và log `warn`, không giới hạn | low | reject | Cần raise lỗi trong khi các truy vấn khác của request vẫn chạy (vd. quyền DB). Chỉ xảy ra khi khóa QR đã sai sẵn. Sửa phải thêm nhánh backoff. |

## Design Notes

- **Raise sau commit, không trong tx của người gọi:** raise trong tx mà lỗi thì tx của IPN hỏng, Tingee phải gửi lại. Raise sau commit có rủi ro mất cảnh báo nếu tiến trình chết giữa chừng. Rủi ro này chấp nhận được: mục Cần xử lý vẫn còn, và marker vẫn có trong log.
- **Dấu trong DB:** một câu `INSERT … ON CONFLICT (kind, subject) DO UPDATE SET raised_at = now() WHERE raised_at < now() - cooldown RETURNING subject` quyết định subject nào là mới, chạy đúng khi có nhiều instance. Loại `once` dùng `DO NOTHING`.
- **Giới hạn:** worker chết thì không quét, nên không có cảnh báo. Phần này để kiểm tra uptime từ bên ngoài của 4.7 lo.

## Verification

**Commands:**
- `pnpm typecheck`: expected không lỗi.
- `pnpm turbo lint:deps`: expected không vi phạm.
- `pnpm --filter @tickee/api build && pnpm --filter @tickee/api test`: expected pass.

**Manual checks:**
- Đặt `OPS_ALERT_EMAILS`, chạy `pnpm dev`, rồi làm một job email rơi vào dead-letter (SMTP sai). Mailpit nhận đúng một email `dead_letter`.
