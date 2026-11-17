---
title: 'Story 4.6-e: Luật cảnh báo nghiệp vụ'
type: 'feature'
created: '2026-11-17'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '98f58328b7f1efa0a327f7923478edffcd6c2bd8'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Kênh `platform/alerts` (4.6-b) chưa báo ba điều kiện NFR-10: IPN lỗi tăng, p95 tạo link > 2 giây, tỉ lệ phát Vé giảm bất thường. Tingee đổi chữ ký, body IPN đổi dạng hay Tingee chậm thì đội vận hành chỉ biết khi BTC phàn nàn.

**Approach:** Thêm ba luật trên kênh có sẵn, ngưỡng là env có mặc định (Mason duyệt 17/11/2026). Hai luật ở api đếm trong bộ nhớ của tiến trình; luật thứ ba ở worker do `ordering` đăng ký vào registry quét mỗi phút.

## Boundaries & Constraints

**Always:**
- **(1) `ipn_failures`** (api): trong 5 phút gần nhất có từ `OPS_ALERT_IPN_FAILURES` (mặc định 5) request IPN kết thúc bằng 401 (chữ ký/timestamp sai, gồm key cũ không ràng được Đơn), 400 vì chữ ký đúng mà body hỏng (E3-3), hoặc 5xx. Không đếm `ipnKey` lạ (404), body quá lớn (413), client ngắt kết nối. Details nêu số lần theo lý do `signature` / `invalid_body` / `server_error`.
- **(2) `payment_link_slow`** (api): p95 (nearest-rank) thời lượng mọi lời gọi `create_link` (mọi `outcome`, kể cả timeout) trong 5 phút gần nhất vượt `OPS_ALERT_LINK_P95_MS` (2000), khi có từ `OPS_ALERT_LINK_MIN_SAMPLES` (20) lần gọi. Thời lượng lấy đúng số đo của histogram `tickee.tingee.request.duration` trong `tingee.client.ts`. Details: `p95Ms`, `samples`.
- **(3) `ticket_issuance_drop`** (worker): nhóm Đơn có `payment_link_attempt_at` trong (mốc − 75 phút, mốc − 15 phút] có từ `OPS_ALERT_ISSUANCE_MIN_ORDERS` (10) Đơn, và tỉ lệ có `paid_source` dưới `OPS_ALERT_ISSUANCE_RATIO` (0,5) lần tỉ lệ của cùng cửa sổ 7 ngày trước. Cửa sổ 7 ngày trước không có Đơn thì bỏ qua. Mốc là đồng hồ DB. Details: số Đơn và số Đơn có `paid_source` của hai cửa sổ.
- Cả ba loại: chống lặp `cooldown`, subject cố định một giá trị cho mỗi loại (một email mỗi `OPS_ALERT_COOLDOWN_MINUTES` cho cả hệ thống). Luật (1), (2) xét ngay khi ghi nhận một lần mới; mỗi instance api đếm riêng (không cộng giữa instance).
- Ghi nhận không bao giờ làm đổi mã trả về của IPN hay kết quả tạo link; lỗi chỉ log `warn`.
- Partial index `orders (payment_link_attempt_at) WHERE payment_link_attempt_at IS NOT NULL` (migration `0030`, sinh bằng drizzle-kit).
- Env mới: (1), (2) chỉ schema `api`; (3) chỉ schema `worker`. Ngưỡng là số nguyên ≥ 1, riêng `OPS_ALERT_ISSUANCE_RATIO` trong (0, 1].

**Never:**
- Không đổi mã trả về, log hay marker có sẵn của IPN; không đổi tên, thuộc tính hay bucket của histogram.
- Không làm luật `pending_order_overdue` (4.6-c đã làm), dead-letter ở `/admin` (4.6-d), cảnh báo giữ chỗ hàng loạt, hay báo job `failed` ở queue không có dead-letter.
- Không thêm backend giám sát hay đọc lại metric OTel; không lưu cửa sổ đếm vào DB.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| IPN sai chữ ký | 5 IPN 401 trong 5 phút | Một email `ipn_failures`, `signature: 5` | N/A |
| Dưới ngưỡng | 4 IPN 401, rồi 1 IPN 401 sau 6 phút | Không báo | N/A |
| Gộp lý do | 2 lần 401, 2 lần 400 body hỏng, 1 lần 500 | Một email nêu số theo từng lý do | N/A |
| `ipnKey` lạ | 10 IPN 404 | Không báo | N/A |
| Còn lỗi sau khi báo | Thêm IPN 401 trong cooldown | Không gửi thêm | N/A |
| Tạo link chậm | 20 lần `create_link`, 2 lần ≥ 2,5 giây | Báo, `p95Ms` ≥ 2500 | N/A |
| Ít mẫu | 19 lần đều 3 giây | Không báo | N/A |
| Phát Vé giảm | 20 Đơn, 4 có `paid_source`; 7 ngày trước 20 Đơn, 18 có | Một email `ticket_issuance_drop` | N/A |
| Không có nền | 20 Đơn, 0 có; 7 ngày trước 0 Đơn | Không báo | N/A |
| Ít Đơn | 9 Đơn, 0 có `paid_source` | Không báo | N/A |
| Kênh lỗi | DB lỗi khi raise từ IPN | IPN trả như cũ | log `warn` |

</frozen-after-approval>

## Code Map

Đường dẫn dưới `apps/api/` trừ khi ghi khác.

- **Kênh** (`src/platform/alerts/`): `OpsAlerts.raise({ kind, subjects, details, notify? })` không ném (`ops-alerts.ts:117`); details: khóa `^[A-Za-z][A-Za-z0-9_]{0,63}$`, giá trị chuỗi ≤ 200, số, bool, null (:30-33). Loại `cooldown` có bộ nhớ `recent` theo instance (:97, :194-205), clock tiêm qua `OpsAlertSettings.now`. Thêm loại vào `OpsAlertKind` và `OPS_ALERT_KINDS` (`kinds.ts:7-28, 52-101`; sửa comment đầu file). `AlertsModule` là `@Global`, có `OpsAlerts` ở cả hai vai (`alerts.module.ts:16-61`).
- **Registry quét:** `OpsAlertRule { name; check({ db, alerts }) }`, `OpsAlertRules.register` (`ops-alert-scan.ts:42-72`). Chưa module nào đăng ký: đăng ký từ provider của `OrderingJobsModule.forRoot` (`ordering/ordering-jobs.module.ts`, chỉ worker) trong `onModuleInit`. Mẫu luật: `queueBacklogRule` (:82-107).
- **IPN:** `payment/ipn.controller.ts:194-237`. 404 :198-203; 401 qua `rejected()` (:240-248, cả lý do `retired_key_*`); 400 body hỏng :223-232; 400 client ngắt kết nối từ `readRawBody` (:164) không đếm; 5xx là lỗi không phải `AppError` (hoặc `AppError` status ≥ 500) bay ra `ErrorFilter`. Không có chỗ chung biết status cuối: đếm trong controller. Controller thuộc `PaymentModule.forRoot` (`payment/payment.module.ts:64-80`, chỉ api).
- **Tạo link:** `tingee/tingee.client.ts` `send()` (:522-539) bọc `measured()` (`platform/telemetry/measure.ts:61-82`); `sendOnce` không ném nên mọi lời gọi được đo. `measured` không trả thời lượng: thêm callback tùy chọn nhận số đo (giây) đúng lúc ghi histogram. `HttpTingeeClient` dựng trong `TingeeModule.forRoot` (`tingee/tingee.module.ts`, cả hai vai; `create_link` chỉ chạy ở api qua `ordering/payment-link.ts:195`). Test dựng `new HttpTingeeClient({...})` trực tiếp (`test/tingee/client.test.ts`): tham số mới phải tùy chọn.
- **Đơn:** `ordering/schema.ts:127` `payment_link_attempt_at` (null với Đơn 0đ; bị ghi lại khi claim lại, về NULL khi Tingee từ chối), :132 `paid_source` (`ipn|reconciliation|manual|free`). Index :141-151. Migration kế là `drizzle/0030_*`. Đồng hồ DB: `platform/db/clock.ts` (`dbNow`); `now()` trong `WHERE` thì được.
- **Config:** `platform/config/config.schema.ts` nhóm `opsAlerts` :141-144, `opsAlertDelivery` :147-155, spread api :187, worker :217-218. Test `test/config.test.ts:124-160`; `test/helpers.ts:50-51, 79-81` (trường có default phải đặt giá trị). `.env.example:81-90`; README :185-195 (bảng loại cảnh báo, thiếu cả hai loại của 4.6-c) và :328-330.
- **Không có tiện ích cửa sổ trượt trong bộ nhớ** (rate limit đều dựa DB): viết mới, nhận clock để test.
- **Test:** DB thật dùng chung, không truncate. Mẫu bắt cảnh báo: `test/platform/ops-alerts.test.ts:88-131` (`findJobs(JobQueue.OPS_ALERT, { data })`). Mẫu IPN: `test/payment/ipn-edge.test.ts`, `ipn-fixtures.ts`. Luật (3) xét mọi Đơn trong DB: cho hàm luật nhận mốc tùy chọn, test đặt mốc xa (vd. +400 ngày) và chèn Đơn quanh mốc đó, ở trạng thái không phải `pending` để lưới an toàn của 4.6-c không đụng.

## Tasks & Acceptance

**Execution:**
- [x] `src/platform/alerts/kinds.ts` -- thêm ba loại (tiêu đề, summary nêu việc cần kiểm, `cooldown`).
- [x] `src/platform/alerts/sliding-window.ts` (mới, xuất qua `index.ts`) -- cửa sổ trượt theo thời gian có clock tiêm, đếm theo nhãn và tính percentile nearest-rank; giới hạn số mẫu giữ trong bộ nhớ.
- [x] `src/modules/payment/ipn-failure-alert.ts` (mới) + `ipn.controller.ts` + `payment.module.ts` -- ghi nhận ba lý do, raise khi đạt ngưỡng.
- [x] `src/platform/telemetry/measure.ts`, `src/modules/tingee/tingee.client.ts`, `tingee.module.ts` + monitor mới trong `tingee/` -- nạp thời lượng `create_link`, raise khi p95 vượt ngưỡng; worker không cần env mới.
- [x] `src/modules/ordering/issuance-drop-rule.ts` (mới) + `ordering-jobs.module.ts` -- luật (3) và đăng ký vào `OpsAlertRules`.
- [x] `src/modules/ordering/schema.ts`, `drizzle/0030_*.sql` -- partial index.
- [x] `config.schema.ts`, `test/config.test.ts`, `test/helpers.ts`, `.env.example`, `README.md` -- năm env mới; bảng loại cảnh báo trong README đủ 10 loại.
- [x] Test mới (`test/platform/sliding-window.test.ts`, `test/payment/ipn-failure-alert.test.ts`, `test/tingee/link-latency-alert.test.ts`, `test/ordering/issuance-drop.test.ts`) -- mỗi dòng của I/O Matrix.

**Acceptance Criteria:**
- Given WorkerModule khởi động, then `OpsAlertRules.list()` có `ticket_issuance_drop` cùng hai luật pg-boss.
- Given `HttpTingeeClient` gọi `get_order` hay `get_token_balance` chậm, then không nạp vào cửa sổ p95.
- Given `pnpm turbo lint:deps`, then sạch.
- Given không đặt env mới, when chạy toàn bộ test hiện có, then pass.

## Implementation Notes

- `story_key`: `4-6-giám-sát-và-lưới-an-toàn-vận-hành`. 4.6-e xong thì story vẫn chưa xong (còn 4.6-d): giữ story ở `in-progress`, không đặt `done`.
- Lựa chọn đã chốt khi lập spec (người dùng ít thấy): subject cố định mỗi loại; 401 key cũ đếm như `signature`; p95 nearest-rank; cửa sổ (1), (2) là hằng 5 phút.
- Nhánh `feat/4-6-e-luat-canh-bao-nghiep-vu`, cắt từ `main` (`98f58328b7f1efa0a327f7923478edffcd6c2bd8`).
- Subject chung là `OPS_ALERT_SYSTEM_SUBJECT` = `toan-he-thong` (`kinds.ts`). `measured()` thêm callback tùy chọn `onRecorded(seconds, outcome)`; `HttpTingeeClient` thêm `onPaymentLinkDuration`, chỉ `TingeeModule.forRoot({ linkLatencyAlert })` của api nối vào `PaymentLinkLatencyMonitor`. Tạo link không chờ lần báo; IPN lỗi chờ ghi nhận như `payment_unmatched`.
- `ipn.controller.ts`: `receive()` bọc `handle()` để đếm 5xx. Lỗi "Body IPN đã bị đọc trước handler" (cấu hình sai, 500) đếm `server_error`; lỗi stream khi request chưa nhận đủ thì không đếm.
- Test luật (3) đặt mốc ≥ 400 ngày tới, chèn Đơn `paid`/`expired`, xóa ở `afterAll` bằng role migrator. Test IPN cũ tạo nhiều 401/400 nay cũng raise `ipn_failures` (log `error` + job); test mới xóa dấu trước khi assert.

## Spec Change Log

## Review Triage Log

Lượt 1 (17/11/2026). BH = blind-hunter, ECH = edge-case-hunter, VG = verification-gap.

| # | Nguồn | Phát hiện | Verdict | Route | Bằng chứng |
|---|-------|-----------|---------|-------|------------|
| 1 | BH, ECH | Phép so tỉ lệ của luật (3) nhân `ratio` thực: tỉ lệ bằng đúng ngưỡng vẫn báo (vd. 0,1: 1/10 so với 3/3) | low | patch | `issuance-drop-rule.ts:95`: `3 < 3.0000000000000004`. Khối frozen nói "dưới" (nhỏ hơn hẳn). Sửa trực tiếp phép so. |
| 2 | VG | Ranh giới luật (3) chưa test: đúng `minOrders` Đơn, tỉ lệ bằng đúng ngưỡng | medium | patch | Gap VG đã kiểm: đổi `<` thành `<=` ở một trong hai phép so thì mọi test vẫn pass. |
| 3 | VG | `ticket_issuance_drop` là `cooldown` (không phải `once`) chưa được ghim | medium | patch | Gap VG đã kiểm: đổi sang `once` thì mọi test vẫn pass; subject cố định nên `once` nghĩa là im 30 ngày. |
| 4 | VG | Cấu hình `OPS_ALERT_ISSUANCE_*` tới luật đã đăng ký chưa test | medium | patch | Gap VG đã kiểm: đảo hai trường hay bỏ qua config thì test vẫn pass. |
| 5 | VG | Đơn vị thời lượng tới cửa sổ p95 chỉ được kiểm cận dưới | medium | patch | Gap VG đã kiểm: nạp ms thay giây thì test vẫn pass; production sẽ báo `payment_link_slow` mỗi cooldown. |
| 6 | ECH | p95 làm tròn trước khi so ngưỡng: p95 thô 2000,4 ms với ngưỡng 2000 không báo | low | patch | `link-latency-alert.ts:78` `Math.round` rồi so `<=`. Sửa trực tiếp: so giá trị thô, chỉ làm tròn trong details. |
| 7 | BH | Mỗi lời gọi tạo link copy và sort cả cửa sổ trước khi kiểm số mẫu | low | patch | `record` gọi `stats()` (≤ 5.000 giá trị, đồng bộ trên đường Checkout) trước khi so `minSamples`. Sửa trực tiếp: kiểm `count()` trước. |
| 8 | BH, ECH | `SlidingWindow` mặc định `Date.now` (có thể lùi); `prune` giả định mẫu theo thứ tự thời gian | low | patch | Đồng hồ lùi thì mẫu đầu nằm "ở tương lai" và mẫu cũ hơn 5 phút vẫn được đếm. Sửa trực tiếp: mặc định `performance.now`. |
| 9 | BH | README vẫn ghi email "chỉ có loại, id, mã Đơn, tên queue, số đếm và lý do"; một dòng vượt bề rộng của đoạn | low | patch | Ba loại mới gửi thêm `p95Ms`, `thresholdMs`, `thresholdRatio`, `windowMinutes`. |
| 10 | BH, ECH | Khung nền 7 ngày đã "chốt" (Đối soát bù +30 phút/+2 giờ/+24 giờ, duyệt tay), khung xét thì chưa: tỉ lệ nền bị đẩy lên | low | reject | Tiền về muộn chỉ có khi IPN mất hay lệch tiền, hiếm lúc vận hành bình thường; ngưỡng 0,5 lần hấp thụ độ lệch nhỏ. Sửa phải có mốc ghi `paid_source` (chưa có cột này). |
| 11 | BH | Mẫu số tính cả Đơn hết hạn `sales_paused`/`timeout` (vẫn giữ `payment_link_attempt_at`) | low | reject | Đúng tập Đơn của khối frozen. `sales_paused` chỉ gồm Đơn đang dở lúc BTC bị ngắt (sau đó sellability chặn Đơn có phí mới, `payment-link.ts:301-313`); `timeout` là lỗi thật của Tingee, đáng báo. |
| 12 | BH, ECH | Khung nền không có cỡ tối thiểu (1–3 Đơn đủ để so) | low | reject | Khối frozen chốt "Cửa sổ 7 ngày trước không có Đơn thì bỏ qua" (Mason duyệt 17/11/2026). Sửa phải sửa intent. |
| 13 | BH, ECH | IPN lỗi chờ `raise` trước khi trả 401/400/5xx; raise lỗi thì IPN lỗi kế tiếp lại thử | low | reject | Chỉ chờ khi vừa đạt ngưỡng; raise xong thì bộ nhớ cooldown bỏ qua DB; IPN đồng thời chờ chung một lần raise (`raising`). Chậm chỉ khi DB đã lỗi, lúc đó IPN đã lỗi sẵn. Giống #21 của 4.6-b. Backoff là thêm trạng thái. |
| 14 | BH | Không luật nào bắt `create-link` lỗi nhanh (Tingee từ chối, `release` trả lượt nên Đơn rời khung của luật (3)) | medium | defer | Có từ trước 4.6-e: NFR-10 không liệt kê điều kiện này, ba luật mới không xét. Ghi vào deferred-work. |
| 15 | BH | Subject chung, email không nêu BTC nào gây lỗi | low | reject | Khối frozen chốt subject cố định và details theo lý do. Log `warn` của IPN đã có `organizationId`. |
| 16 | BH | Ngưỡng không có trần; ngưỡng lớn làm trần `maxSamples` lớn | low | reject | Khối frozen chỉ đòi "số nguyên ≥ 1". Bộ nhớ vẫn giới hạn bởi số lần gọi thật trong 5 phút. |
| 17 | BH | Khung 60 phút với cooldown 30 phút: sự cố đã qua vẫn có email thứ hai; phát hiện trễ ít nhất 15 phút | low | reject | Khung và cooldown theo khối frozen (Mason duyệt). Đổi phải sửa intent. |
| 18 | BH | Callback thời lượng chạy trong span `tingee create_link`, nên span DB của raise thành span con | low | reject | Chỉ khi raise (tối đa 1 lần mỗi cooldown mỗi instance); chỉ ảnh hưởng hình dạng trace. |
| 19 | BH | Migration `CREATE INDEX` không `CONCURRENTLY` (khóa ghi `orders`); index không `INCLUDE (paid_source)` | low | reject | Cùng mẫu 0029; chưa có production (4.7), bảng nhỏ. `CONCURRENTLY` cần bước migration ngoài transaction. |
| 20 | BH | Hai monitor lặp cùng khung (cửa sổ, `raising`, nuốt lỗi) | low | reject | Hai lớp khoảng 100 dòng; gom là refactor, không có lỗi cụ thể. |
| 21 | BH, ECH | Cửa sổ IPN có trần `max(threshold, 1000)` mẫu: bão lỗi thì số đếm trong email dừng ở 1.000 | low | reject | Cần hơn 1.000 IPN lỗi trong 5 phút trên một instance; email vẫn đi. Sửa phải thêm bộ đếm riêng. |
| 22 | BH | Cửa sổ thời lượng giữ nhãn `outcome` mà không ai đọc | low | reject | Không gây hại gì cho người dùng hay dev. |
| 23 | BH | Test "mốc mặc định là đồng hồ DB" có thể chập chờn trên DB dùng chung | low | reject | `fileParallelism: false` (`vitest.config.ts`); CI dùng DB mới. Chỉ lỗi khi một Đơn cũ vượt mốc −15/−75 phút đúng trong vài ms giữa hai lần đọc. |
| 24 | ECH | `make_interval(days => 7)` lệch 1 giờ khi TimeZone của phiên DB có DST | maybe-false | reject | Docker Postgres mặc định UTC; Asia/Ho_Chi_Minh không có DST. Kiểm `SHOW TimeZone` của DB production (4.7); nếu đúng thì chỉ low. |
| 25 | ECH | api có loại cảnh báo mới deploy trước worker: worker cũ từ chối payload, job vào dead-letter, dấu đã ghi nên im một cooldown | low | defer | Mối nguy chung của payload job khi rolling deploy; chưa có production. Ghi vào deferred-work cho 4.7. |

## Design Notes

- **Đếm trong tiến trình thay vì đọc metric OTel:** metric OTel chỉ xuất ra ngoài, không đọc lại được, và backend giám sát chưa chốt (4.7). Hệ quả: N instance api thì mỗi instance phải tự đạt ngưỡng; lỗi rải đều qua load balancer có thể chậm báo. Chấp nhận ở MVP (≥ 2 api).
- **Luật (3) chạy trong scan mỗi phút** chứ không cron riêng: truy vấn hai khoảng theo index mới, rẻ; `cooldown` chặn email lặp.
- **Mốc 15 phút** khớp hạn link (`expires_at` = `payment_link_attempt_at` + 15 phút): Đơn trong cửa sổ đã hết thời gian thanh toán, nên tỉ lệ không bị kéo xuống bởi Đơn đang chờ trả.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: không lỗi.
- `pnpm turbo lint:deps` -- expected: không vi phạm.
- `pnpm --filter @tickee/api build && pnpm --filter @tickee/api test` -- expected: pass.
