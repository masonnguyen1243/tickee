---
title: 'E3-5 (D1): link chia sẻ Vé ký bằng khóa QR đã gỡ trả 404 chung; test Vé khóa cũ'
type: 'bugfix'
created: '2026-11-13'
status: 'done'
baseline_commit: 'a06be42164746d72a9ea0c1797d9364d73518c9f'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-11-13-doi-chieu-spec-epic-3.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** (Retro Epic 3 D1) Token link chia sẻ và Mã QR vé đều tính từ khóa `TICKET_QR_KEYS` phiên bản `tickets.qr_key_version` của Vé (AD-16, AD-29). Khi phiên bản đó bị gỡ khỏi env, route công khai `GET /v1/shared-tickets/:token` vẫn tìm thấy Vé theo hash, rồi `signTicketQr` ném lỗi cấu hình, nên trả 500 thay vì `404 SHARED_TICKET_NOT_FOUND` chung. Repo cũng chưa có test nào cho Vé ký bằng khóa cũ (`test/helpers.ts` chỉ có một khóa).

**Approach:** `TicketsService.sharedTicket` kiểm khóa của Vé còn trong `TICKET_QR_KEYS` trước khi ký. Thiếu khóa thì trả `404` chung như mọi lý do khác, và ghi một dòng log mức `error` có marker `alert` cho vận hành (Story 4.6), không chứa token. Thêm test với hai phiên bản khóa:
- Vé ký bằng khóa cũ, khóa cũ vẫn còn trong env: Trang Đơn, Chi tiết Vé, link chia sẻ và email Vé đều đúng, Vé mới ký bằng khóa mới.
- Gỡ khóa cũ: route công khai trả `404`.

Ngoài phạm vi, theo Sprint Change Proposal 13/11/2026 §4.6:
- Chi tiết Vé, Trang Đơn và email khi thiếu khóa vẫn là lỗi cấu hình (runbook Story 4.7).
- Không làm công cụ ký lại, không tách khóa link chia sẻ khỏi khóa QR.

</frozen-after-approval>

## Implementation Notes

- `apps/api/src/modules/ticketing/tickets.service.ts`, `sharedTicket`:
  - Kiểm `this.keys.has(row.qrKeyVersion)` **sau** mọi lý do 404 khác (token sai, Vé không `valid`, Sự kiện hủy hoặc đã qua `effective_end_at`), nên chỉ cảnh báo khi link lẽ ra còn mở được. Thiếu khóa thì ném `sharedTicketNotFound()`, cùng mã và cùng câu như mọi lý do khác.
  - Log qua Nest `Logger('TicketsService')` mức `error`: `{ ticketId, qrKeyVersion, alert: 'ticket_qr_key_missing' }`. Không có token, không có PII.
  - Hằng `TICKET_QR_KEY_MISSING_ALERT` xuất từ `ticketing/index.ts`, theo mẫu `PAYMENT_UNMATCHED_ALERT` của `payment`, để Story 4.6 bắt theo marker.
- `ownTicket` (Chi tiết Vé), `ticketsOfOrder` (Trang Đơn, email Vé) và `regenerateShareLink` không đổi: khi thiếu khóa vẫn ném lỗi cấu hình, đúng phạm vi.
- `apps/api/test/ticketing/qr-key-rotation.test.ts` (mới):
  - Ba app api cùng DB, khác `TICKET_QR_KEYS`: `hOld` (chỉ v1, khóa test mặc định), `hBoth` (v1 + v2), `hNew` (chỉ v2). Khóa v2 = `testCredentialKey(2, 11)`.
  - Có worker với v1 + v2 để kiểm email Vé.
  - Năm ca:
    1. Vé v1 đọc qua `hBoth`: Trang Đơn, Chi tiết Vé, link chia sẻ có QR `t1.` và cùng token.
    2. Vé mới phát qua `hBoth` ký v2; link mở được qua `hBoth` và `hNew`.
    3. Email Vé v1 do worker v1 + v2 gửi có đúng token, link mở được.
    4. Vé v1 qua `hNew`: 404 chung + đúng một dòng log `alert`, không có token trong mọi log.
    5. Vé v1 đã hủy qua `hNew`: 404, không có dòng `alert`.
  - Log gom từ cả ba app, vì nestjs-pino giữ một logger gốc cho cả process (ghi chú có sẵn trong `buyer-email-job.test.ts`).
- Đối chứng: tắt dòng kiểm khóa thì ca 4 fail (`expected 500 to be 404`); bật lại thì pass.
- Kiểm chứng:
  - `pnpm run typecheck` sạch; `pnpm run lint:deps` không vi phạm (228 module).
  - `pnpm run test` (API): 65 file, 997 test pass, trên Postgres 18 của `docker compose`.
  - Cảnh báo `MaxListenersExceededWarning` có từ trước (retro Epic 3).
- Sau review (Blind Hunter, 11 phát hiện; xem Review Triage Log):
  - Log `alert` thêm `eventId` và `currentVersion`. Câu log đổi thành "instance này không có khóa của Vé", vì cùng nhánh này cũng gặp khi instance chưa có khóa mới (deploy dần, rollback).
  - Thêm `TEST_TICKET_QR_KEY_V2` vào `test/helpers.ts`.
  - Doc của `shared-tickets.controller.ts` và `SharedTicketView` (contracts) thêm lý do 404 do thiếu khóa.
  - Test viết lại, còn 6 ca:
    - Worker v1 + v2 chạy suốt file, và `freeTickets` chờ email Vé xong, nên job email của Vé v2 không bị để lại cho file test sau (worker chỉ có v1).
    - Thêm ca Vé v2 đọc qua `hOld` (instance chưa có khóa mới) → 404 + `alert` `{ qrKeyVersion: 2, currentVersion: 1 }`.
    - Ca "không log alert" gồm cả Vé hủy lẫn Sự kiện đã kết thúc, có đối chứng dương: đếm dòng log request 404 của `/v1/shared-tickets/[REDACTED]`.
  - Đối chứng thứ tự: dời dòng kiểm khóa lên trước dòng kiểm Sự kiện thì ca "Sự kiện đã kết thúc" fail; khôi phục thì pass.
  - Ghi vào `deferred-work.md`: "Đã xử lý" cho phần route công khai; bàn giao Story 4.6 cho marker, gộp trùng theo phiên bản; các đường còn lại thiếu marker và kiểm lúc khởi động cho 4.6/4.7.

## Review Triage Log

| # | Phát hiện (Blind Hunter) | Verdict | Bằng chứng / xử lý |
|---|---|---|---|
| 1 | Log `alert` trên route công khai không giới hạn có thể ngập log | low | Đúng: mỗi lần mở link là một dòng `error`, nhưng chỉ xảy ra sau khi xoay khóa sai, và mỗi request vốn đã có một dòng log của pino-http. Throttle cần thêm state theo process. Bỏ khỏi spec; ghi bàn giao 4.6 gộp trùng theo phiên bản trong `deferred-work.md` |
| 2 | Chi tiết Vé, Trang Đơn, email, "Tạo lại link" khi thiếu khóa không có marker; chưa kiểm lúc khởi động | medium | Đúng, có từ trước; spec giữ các đường này là lỗi cấu hình (Intent). Defer sang 4.6/4.7 trong `deferred-work.md` |
| 3 | Log không phân biệt "khóa cũ đã gỡ" với "instance chưa có khóa mới" | low | Đúng: Vé v2 đọc qua instance chỉ có v1 vào cùng nhánh. Patch: thêm `currentVersion`, `eventId`, sửa câu log |
| 4 | Thiếu test Vé v2 đọc qua instance chỉ có v1 | low | Đúng. Patch: thêm ca qua `hOld` |
| 5 | Thứ tự "xét sau mọi lý do 404 khác" mới test một nửa | low | Đúng: dời kiểm khóa lên trước kiểm Sự kiện thì test cũ vẫn pass. Patch: thêm ca Sự kiện đã kết thúc; đối chứng xác nhận test bắt được |
| 6 | Kiểm "không có alert" thiếu đối chứng dương | low | Đúng trong phạm vi ca đó. Patch: đếm dòng log request 404 trước và sau |
| 7 | Job email của Vé v2 có thể bị để lại cho file test sau | low | Đúng khi worker đóng trước khi xử lý hoặc chạy lọc `-t`. Patch: worker chạy suốt file, `freeTickets` chờ email xong |
| 8 | Chưa có bàn giao 4.6 cho marker mới; ghi chú 13/11 còn nói route 500 | low | Đúng. Patch: thêm "Đã xử lý" và bàn giao 4.6 vào cuối `deferred-work.md` (không sửa mục cũ, theo luật append-only); E3-5 → `done` trong `sprint-status.yaml` |
| 9 | Spec thiếu `baseline_commit`, mục Verification, Review Triage Log | low | `baseline_commit` thêm vào. Lệnh kiểm chứng giữ ở Implementation Notes, vì route oneshot bỏ các mục khác theo template. Triage Log là mục này |
| 10 | Khóa test v2 không nằm trong helper chung | low | Đúng với câu "helper có hai phiên bản khóa" của proposal §4.6. Patch: `TEST_TICKET_QR_KEY_V2` |
| 11 | Doc controller và contracts chưa có lý do 404 do thiếu khóa | low | Đúng. Patch: sửa hai đoạn doc |

