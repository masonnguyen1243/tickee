---
title: 'Story 4.7-g: Kiểm khóa Mã QR vé lúc khởi động'
type: 'feature'
created: '2026-11-20'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '398b92eae0c59a7b88a1d535226436235afcb54e'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Có hai cách để Vé dùng một phiên bản khóa mà instance không có:
- gỡ khỏi `TICKET_QR_KEYS` một phiên bản khóa mà Vé còn dùng (xoay khóa sai);
- instance chưa có khóa mới khi deploy dần.

Lỗi này chỉ lộ ra khi người dùng mở Trang Đơn hay Chi tiết Vé (500), mở link chia sẻ (404), hoặc khi worker gửi email Vé (job vào dead-letter). Lúc deploy không có gì báo.

**Approach:** Mỗi lần vai api hoặc worker khởi động, so các phiên bản khóa mà Vé còn dùng với `TICKET_QR_KEYS` của instance. Thiếu phiên bản nào thì log `error` kèm marker `ticket_qr_key_missing` và báo kênh cảnh báo vận hành.

## Boundaries & Constraints

**Always:**
- **Khi nào kiểm:** một lần mỗi lần vai `api` hoặc `worker` khởi động, sau khi DB và pg-boss đã sẵn sàng. Vai `migrate` không kiểm.
- **Chỉ cảnh báo** (Mason chốt 20/11/2026): thiếu khóa thì instance vẫn khởi động và chạy bình thường. Không bao giờ thoát vì phần kiểm này, để Checkout, IPN và check-in không bị kéo sập và rollback vẫn lên được.
- **Vé còn dùng** (Mason chốt 20/11/2026): Vé `valid` mà Sự kiện còn mở, tức chưa kết thúc và chưa hủy (`eventOpenForTickets`). Vé của Sự kiện đã kết thúc hoặc đã hủy không cần khóa.
- **Mỗi phiên bản thiếu:**
  - ghi một dòng log `error` có `alert: 'ticket_qr_key_missing'`, `qrKeyVersion`, `currentVersion` và số Vé bị ảnh hưởng; không có id Vé, token hay khóa;
  - gọi `OpsAlerts.raise` loại `ticket_qr_key_missing`, subject `${qrKeyVersion}:${currentVersion}` (chống lặp `cooldown` như đường link chia sẻ).
- **Hai chiều đều báo:** phiên bản thiếu nhỏ hơn `currentVersion` (khóa cũ đã bị gỡ) và lớn hơn (instance chưa có khóa mới) đều báo.
- **Lỗi khi chạy truy vấn kiểm** (DB lỗi, timeout) thì log `warn` rồi khởi động tiếp. Phần kiểm không bao giờ làm sập instance vì lỗi của chính nó.

**Never:**
- Không sửa các đường đọc Vé hiện có: Trang Đơn, Chi tiết Vé, email Vé, link chia sẻ.
- Không ký lại Vé, không làm công cụ ký lại. Việc chọn phương án xoay khóa thuộc runbook của Story 9.1.
- Không thêm biến env.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Đủ khóa | Vé `valid` dùng v1 và v2; `TICKET_QR_KEYS` có v1, v2 | Khởi động, không có log `error` | N/A |
| Khóa cũ đã gỡ | Vé `valid` của Sự kiện còn mở dùng v1; keys chỉ có v2 | Log `error` kèm marker (`qrKeyVersion` 1, `currentVersion` 2, số Vé) và raise | N/A |
| Instance chưa có khóa mới | Vé dùng v3; keys có v1, v2 | Như trên, với `qrKeyVersion` 3 | N/A |
| Vé đã hủy | Vé `cancelled` dùng v1; keys chỉ có v2 | Không báo | N/A |
| Sự kiện đã kết thúc hoặc hủy | Vé `valid` dùng v1 của Sự kiện đã kết thúc (hoặc đã hủy); keys chỉ có v2 | Không báo | N/A |
| Trộn | v1 có Vé của Sự kiện đã kết thúc và Vé của Sự kiện còn mở | Báo v1, số Vé chỉ đếm Vé của Sự kiện còn mở | N/A |
| Chưa có Vé | Bảng `tickets` trống | Không báo | N/A |
| Vai `migrate` | Như "Khóa cũ đã gỡ" | Không kiểm | N/A |
| DB lỗi khi kiểm | Truy vấn kiểm ném lỗi | Log `warn`, vẫn khởi động | N/A |

</frozen-after-approval>

## Code Map

Đường dẫn dưới `apps/api/`.

- `src/modules/ticketing/qr.ts:15-38`: `TicketQrKeys` (`has`, `currentVersion`), token DI `TICKET_QR_KEYS`.
- `src/modules/ticketing/ticketing.module.ts:17-24`: module `@Global`. `forRoot` được gọi ở vai api (`src/api.module.ts:72`) và worker (`src/worker.module.ts:45`); vai migrate không nạp module này.
- `src/modules/ticketing/tickets.service.ts:29-33, 191-213`: mẫu log kèm `alert: TICKET_QR_KEY_MISSING_ALERT` và `this.alerts.raise(…)` của link chia sẻ. Dùng lại cùng dạng.
- `src/platform/alerts/kinds.ts:15, 90-96`: loại `ticket_qr_key_missing` (`cooldown`). `summary` hiện chỉ nói tới link chia sẻ; sửa để bao cả trường hợp phát hiện lúc khởi động.
- `src/platform/jobs/jobs.module.ts:19`: pg-boss start ở `onModuleInit`, nên gọi `raise` (enqueue) ở `onApplicationBootstrap` được.
- `src/modules/ticketing/schema.ts:44-61`: `tickets.qr_key_version`, `status` là `valid`/`cancelled`, index `tickets_event_id_idx`.
- `src/modules/event/public-event.ts:31, 204`: `eventOpenForTickets`, `ticketEventsByIds` (batch, đồng hồ DB). Ticketing đã import các hàm này (`my-tickets.ts:5`).
- `test/ticketing/qr-key-rotation.test.ts`: mẫu dựng Vé ký bằng v1/v2. `test/roles.process.test.ts`: mẫu test tiến trình.

## Tasks & Acceptance

**Execution:**
- [x] `src/modules/ticketing/qr-key-check.ts` (mới): hàm `missingQrKeyVersions(db, keys)` trả `{ qrKeyVersion, tickets }[]`. Trước tiên tìm các cặp (`qr_key_version`, `event_id`) của Vé `valid` mà `keys.has` là false (thường rỗng, nên rẻ), rồi chỉ giữ Vé của Sự kiện còn mở qua `ticketEventsByIds` và `eventOpenForTickets`. Gom logic để test không cần Nest.
- [x] `src/modules/ticketing/ticketing.module.ts`: provider chạy kiểm ở `onApplicationBootstrap`; log và raise theo Always, không thoát.
- [x] `src/platform/alerts/kinds.ts`: `summary` của `ticket_qr_key_missing` nói cả trường hợp phát hiện lúc khởi động.
- [x] `test/ticketing/qr-key-check.test.ts` (mới): phủ I/O Matrix.
- [x] `test/roles.process.test.ts`: vai api với `TICKET_QR_KEYS` thiếu phiên bản của một Vé đã seed thì output có dòng kèm marker.
- [x] `../../README.md`: mục ngắn "Xoay khóa Mã QR vé": thêm khóa mới cho mọi instance trước; chỉ gỡ khóa cũ khi lần khởi động không còn báo; câu SQL tra phiên bản còn dùng.
- [x] `deferred-work.md`: thêm dòng "Đã xử lý (…)" dưới mục review E3-5 D1 #2 (phần 4.7) và mục 4.7-g của "tách phạm vi Story 4.7-f".

**Acceptance Criteria:**
- Given cấu hình local và DB seed (`pnpm db:seed`), when chạy `pnpm dev`, then không có log `ticket_qr_key_missing`.

## Implementation Notes

- Sprint-status: 4.7-g là story con cuối của 4.7. `story_key` là `4-7-siết-cấu-hình-production-và-ci-trước-khi-deploy`; override `bmad-build.toml` đặt `done` trong nhánh của story.
- **`TicketQrKeyCheck`** (`ticketing.module.ts`) được đăng ký trong `TicketingModule.forRoot`, nên cả api lẫn worker đều có. Các lựa chọn của agent triển khai, spec không định:
  - chạy nền từ `onApplicationBootstrap`, để không làm chậm lúc instance bắt đầu nhận request hay job;
  - `beforeApplicationShutdown` chờ lần kiểm xong;
  - chạy trong transaction chỉ đọc, `repeatable read`, `statement_timeout` 30 giây;
  - log và chi tiết cảnh báo dùng trường `tickets` cho số Vé.
- **`missingQrKeyVersions`** (`qr-key-check.ts`) có ba bước:
  1. `DISTINCT qr_key_version` của Vé `valid`, quét bảng vì không có index theo phiên bản (8 ms với khoảng 35.000 Vé ở local);
  2. chỉ khi có phiên bản thiếu mới đếm theo cặp (phiên bản, Sự kiện);
  3. đọc Sự kiện bằng `ticketEventsByIds`, theo lô 1.000.
- **Một cảnh báo mới ra hai dòng `error`:** một của lần kiểm, một của `OpsAlerts`, giống đường link chia sẻ hiện nay.
- **`qr-key-rotation.test.ts`:**
  - Thay `TicketQrKeyCheck` bằng no-op ở bốn app api. Nếu không, lần raise `1:2`/`2:1` lúc khởi động nằm trong bộ nhớ chống lặp và chặn đúng đường email mà file đó kiểm.
  - `afterAll` cho kết thúc Sự kiện của mọi Vé `valid` ký khác v1, để Vé v2 của file không còn dùng trong DB test chung.
- **Kiểm chứng:**
  - agent triển khai: api 97 file, 1592 test; `build typecheck` và `lint:deps` xanh;
  - vai api chạy với `.env` local trên DB dev (Vé v1): không có marker, tức đạt AC;
  - kiểm lại 20/11/2026: `test/ticketing/`, `roles.process.test.ts`, `platform/ops-alerts.test.ts` gồm 6 file, 89 test, xanh.
- **Vá sau review vòng 1** (triage #1–3, #8–10, #12–16, #20, #23):
  - **Trần chờ khi tắt:** `beforeApplicationShutdown` chờ lần kiểm tối đa `QR_KEY_CHECK_SHUTDOWN_WAIT_MS` = 5 giây, bằng một timer đã `unref`; hết giờ thì log `warn` `{ waitedMs }`.
  - **README:**
    - bước 1 nói rõ instance cũ đang chạy không báo: trong cửa sổ deploy chỉ còn cảnh báo 404 của link chia sẻ, còn lần khởi động chỉ bắt được instance khởi động sau khi đã có Vé phiên bản mới;
    - mỗi câu truy vấn có trần 30 giây, việc tắt chờ tối đa 5 giây;
    - thêm check-in vào phần tác động; `summary` của loại cảnh báo cũng vậy.
  - **`qr-key-check.test.ts`:**
    - test "tắt ngay sau khi khởi động": bỏ phần chờ thì test này đỏ (agent triển khai đã kiểm đột biến);
    - test của worker tự ghi dấu chống lặp `6:1`;
    - ca 1.001 Sự kiện (`generate_series`) kiểm `EVENT_BATCH`;
    - `expect.poll` có `timeout: 10_000`;
    - Vé v6 còn sót được trả về v1 trước harness đầu tiên.
- Defer #4 và #21 vào `deferred-work.md`.
- **Verification sau khi vá:**
  - xanh: `build typecheck`, `lint:deps` (api 300 mô-đun);
  - api: 97 file, 1594 test;
  - agent triển khai từng thấy `qr-key-rotation` đỏ một lần: test đầu chạy 18,7 giây, quá ngưỡng chờ email 15 giây. Chạy lại riêng thì xanh, và lượt chạy đủ bộ của bước Verification cũng xanh.

## Spec Change Log

## Review Triage Log

Vòng 1 (20/11/2026): Blind Hunter (BH), Edge Case Hunter (EC), Verification Gap (VG).

| # | Lớp | Phát hiện | Verdict | Bằng chứng | Hướng |
|---|-----|-----------|---------|------------|-------|
| 1 | BH | README bước 1 nói instance chưa có khóa mới "báo" ở lần khởi động khi deploy dần. Nhưng instance cũ đang chạy đã kiểm trước khi có Vé phiên bản mới, nên không bao giờ báo | medium | Đúng: chỉ kiểm một lần, trong `onApplicationBootstrap`. Chỉ instance khởi động sau khi đã có Vé phiên bản mới (rollback, scale-out, restart) mới bị bắt; trong cửa sổ deploy chỉ còn đường 404 của link chia sẻ báo. Code đúng intent (kiểm lúc khởi động), câu README sai | patch |
| 2 | EC | Như #1 | medium | Cùng gốc với #1 | patch |
| 3 | VG | Như #1 (mục Other findings) | medium | Cùng gốc với #1 | patch |
| 4 | BH | Hai instance có cùng phiên bản nhưng khác byte khóa thì không bị phát hiện | medium | Đúng: chỉ kiểm `keys.has(version)`. Đây là loại sai cấu hình khác, có từ trước, ngoài intent (intent so phiên bản) | defer |
| 5 | BH | Câu "thường rỗng, nên rẻ" sai sau lần xoay khóa đúng đầu tiên: Vé của Sự kiện đã kết thúc vẫn `valid`, nên mỗi lần khởi động đều chạy GROUP BY và đọc Sự kiện | low | Đúng. Nhưng lần kiểm chạy nền, mỗi câu có trần 30 giây, và quy mô MVP chỉ vài nghìn Vé. Muốn đưa điều kiện Sự kiện vào SQL thì phải join bảng của mô-đun `event` (AD-10) | reject |
| 6 | EC | Như #5 | low | Cùng gốc với #5 | reject |
| 7 | BH | Kiểm xong mà sạch thì không có dòng `info`, nên im lặng không phân biệt được "sạch" với "chưa chạy" | low | Lần kiểm lỗi đã log `warn`. README bước 2 còn đòi câu SQL không còn Vé dùng phiên bản cũ, nên không ai dựa vào im lặng để gỡ khóa | reject |
| 8 | BH | `beforeApplicationShutdown` chờ lần kiểm mà không có trần tổng; câu README "quá 30 giây" không đúng | medium | Đúng: `statement_timeout` tính theo từng câu, còn các lệnh ghi của `raise` chạy ngoài transaction. SIGTERM đúng lúc DB chậm thì việc tắt có thể vượt thời gian ân hạn của orchestrator | patch |
| 9 | EC | Như #8 | medium | Cùng gốc với #8 | patch |
| 10 | BH | Phần nói về tác động bỏ sót check-in (`verifyTicketQr` trả `null` thì cổng từ chối Vé) | low | Đúng: README và `summary` liệt kê Trang Đơn, Chi tiết Vé, link chia sẻ, email nhưng không có check-in. Sửa chỉ là thêm câu | patch |
| 11 | BH | Cảnh báo không cho biết instance hay vai nào cấu hình sai | low | `summary` đã dặn kiểm `TICKET_QR_KEYS` của mọi instance. Muốn ghi vai thì phải tiêm cấu hình vai vào `ticketing` | reject |
| 12 | BH | `expect.poll` chờ lần kiểm nền với timeout mặc định 1 giây, dễ chập chờn trên CI; `jobs.at(-1)` dựa vào thứ tự của `findJobs` | low | Đúng phần timeout, sửa chỉ là thêm tham số. Phần `at(-1)` vô hại vì payload cũ và mới giống hệt nhau | patch |
| 13 | EC | Như #12 (phần timeout) | low | Cùng gốc với #12 | patch |
| 14 | BH | Test của worker phụ thuộc vào test trước (dấu chống lặp `6:1`) và không chứng minh được việc tắt có chờ lần kiểm | medium | Cùng gốc với #16 | patch |
| 15 | EC | Như #14 (test của worker chạy riêng thì đỏ) | medium | Cùng gốc với #16 | patch |
| 16 | VG | Chưa có test nào đỏ nếu bỏ phần chờ trong `beforeApplicationShutdown` | medium | Gap VG đã kiểm: xóa hàm này thì mọi test vẫn xanh; raise bị cắt ngang cũng không tạo job mới | patch |
| 17 | BH | `missingWith` chạy `DELETE FROM tickets` trên DB test dùng chung (trong transaction rồi rollback) | low | Test api chạy tuần tự (`fileParallelism: false`) nên không tranh khóa. Nếu sau này có FK `RESTRICT` thì test đỏ ngay chứ không lỗi âm thầm | reject |
| 18 | BH | Tắt lần kiểm theo từng file và dọn dữ liệu chung làm các file test phụ thuộc nhau | low | Có thật cho người viết test sau này, nhưng sửa thì phải đổi `createHarness` sang bật lần kiểm khi cần | reject |
| 19 | BH | Mấy chỗ nhỏ: export `TicketQrKeyCheck` qua barrel chỉ để test dùng; nhánh `EVENT_BATCH`, nhánh timeout, và ca "đủ khóa" ở cấp provider đều chưa có test | low | Phần `EVENT_BATCH` gộp với #20 (patch), phần timeout gộp với #21 (defer). Barrel và ca "đủ khóa" ở cấp provider: chưa thấy tác hại cụ thể; ca "đủ khóa" đã được phủ ở cấp hàm và bằng AC | reject |
| 20 | VG | Đọc Sự kiện theo lô (`EVENT_BATCH` = 1.000) chỉ từng chạy với một lô | medium | Gap VG đã kiểm: viết sai `slice` thì mọi test vẫn xanh, và quá 1.000 Sự kiện sẽ đếm thiếu hoặc bỏ sót phiên bản | patch |
| 21 | VG | `statement_timeout` 30 giây chưa có test | medium | Gap VG đã kiểm. Test thật phải chờ hơn 30 giây, hoặc phải biến timeout thành tham số (spec cấm thêm biến env) | defer |
| 22 | EC | `check()` reject sau khối `try` gây unhandled rejection | false | `OpsAlerts.raise` tự bắt mọi lỗi (`ops-alerts.ts`, `raise` gọi `raiseOrThrow` trong `try/catch`). Chỉ `Logger.error` của Nest mới có thể ném, và nó không ném | reject |
| 23 | EC | Bước trả Vé v6 còn sót của lần chạy trước về v1 lại chạy sau khi harness `h` đã kiểm | low | Đúng, chỉ xảy ra sau một lần chạy bị dừng giữa chừng; sửa chỉ là chuyển câu `UPDATE` lên trước `newHarness()` | patch |
| 24 | EC | `afterAll` của `qr-key-rotation.test.ts` ném lỗi thì các app không được đóng | low | Câu `UPDATE events` hầu như không lỗi; sửa phải bọc thêm `try/finally` | reject |

## Verification

**Commands:**
- `pnpm turbo build typecheck` (đặt `NEXT_PUBLIC_API_BASE_URL`) và `pnpm turbo lint:deps`: expected xanh.
- `pnpm --filter @tickee/api test`: expected xanh.
