---
title: 'Story 4.4-b: Ghép giao dịch chưa khớp với Đơn'
type: 'feature'
created: '2026-11-16'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'a42249e704ed045209f5cb6418de6ddd237f1ea8'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-4-a-duyet-tay-tu-choi-va-hoan-tay.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Mục `unmatched` (tiền về nhưng mã Đơn sai hoặc thuộc BTC khác) hiện chỉ kết thúc bằng "Đã hoàn tay"/"Bỏ qua". Khi BTC nhận ra khoản đó là của một Đơn đã hết hạn hoặc đang Cần xử lý, họ không có cách phát Vé cho khách mà phải hoàn tiền rồi bảo khách mua lại.

**Approach:** Thêm thao tác thứ năm `match` cho mục `unmatched` `open`. `reporting` trả danh sách Đơn ứng viên (cùng BTC, `expired`/`review`, `total_amount` bằng số tiền nhận, lọc theo Sự kiện). `payment` chạy một transaction: `markPaid(tx, orderId, 'manual', paidAmount)` (mở rộng cho Đơn `expired`), ghi liên kết giao dịch → Đơn, đóng mục `resolved` `approved`, audit và tín hiệu. `Sheet` có nút "Ghép với Đơn" mở `Dialog` chọn Đơn.

## Boundaries & Constraints

**Always:**
- **Quyết định của Mason (16/11):**
  - Vẫn ghép được Đơn `review`. Mục cũ của Đơn đó (`amount_mismatch`/`orphan` `open`) ở lại hàng và thành mục chỉ hoàn: khi Đơn `paid`, bảng thao tác trả "Đã hoàn tay", "Bỏ qua"; cả hai chỉ đóng mục, Đơn `paid`, Vé, doanh thu giữ nguyên (như Thanh toán trùng). Khoản đầu vẫn ở phần (2) danh sách hoàn tiền AD-28.
  - Liên kết lưu ở `payment_events.order_id` theo đúng AC: `tickee_app` được UPDATE riêng cột này (bảng vẫn cấm DELETE, cột khác vẫn khóa), ứng dụng chỉ ghi khi `order_id IS NULL`, trigger DB chặn mọi lần đổi giá trị đã có.
  - Giữ một spec dù vượt chuẩn kích thước (~5.000 token).
- Thao tác `match` chỉ có ở mục `unmatched` `open` và đứng đầu danh sách `actions` (nút primary), trước "Đã hoàn tay", "Bỏ qua".
- **Ứng viên** (`GET /v1/orgs/:orgId/review-items/:itemId/match-candidates?eventId=`, quyền `review_queue.handle`): Đơn trong `orgScope`, `status` `expired` hoặc `review`, `total_amount` = `paid_amount` của giao dịch, tùy chọn lọc `eventId`; mới nhất trước, tối đa 100 dòng kèm cờ `truncated`. Mỗi dòng: mã Đơn, tên Người mua, Sự kiện, trạng thái, số Vé, thời điểm tạo, `blockedReason` (Sự kiện đã hủy / đã kết thúc theo đồng hồ DB / bị khóa, dùng lại `ReviewApproveBlockedReason`). Mục lạ hoặc của BTC khác → `404 REVIEW_ITEM_NOT_FOUND`; mục không có `match` → danh sách rỗng.
- **Ghép** (`POST …/:itemId/match`, body `{ orderCode }`, `Idempotency-Key` bắt buộc như 4.4-a): một transaction, thứ tự khóa mục → Sự kiện → Đơn → tồn kho.
  - Đơn không thuộc BTC, không còn `expired`/`review`, hoặc `total_amount` ≠ số tiền nhận (kiểm lại dưới khóa) → `409 MATCH_ORDER_NOT_ELIGIBLE`, một mã cho mọi trường hợp để không lộ Đơn của BTC khác.
  - Sự kiện đã hủy / đã kết thúc / bị khóa → `409 EVENT_CANCELLED` / `EVENT_ALREADY_ENDED` / `EVENT_LOCKED`, rollback.
  - Bán có điều kiện cả Đơn (savepoint như 3.6). Hết chỗ → Đơn giữ nguyên trạng thái (`expired` vẫn `expired`, không sang `review`, không email), mục vẫn `open`, audit `review_item.match_sold_out`, commit rồi `409 TICKET_TYPE_SOLD_OUT`.
  - Thắng → Đơn `paid` (`paid_source` `manual`, `paid_amount` = số tiền nhận, `paid_at` = lúc Tingee báo tiền về, không có thì lúc nhận), phát Vé, email Vé; ghi liên kết giao dịch → Đơn; mục → `resolved` `approved`.
  - Audit trong cùng transaction, chỉ id và tên trường: `review_item.match` (target mục), `payment_event.match` (target giao dịch, `changedFields` `['order_id']`), và `order.paid` có người làm (đã có trong `pay`).
  - Tín hiệu trong cùng transaction: `order_changed`, `event_orders_changed`, `org_review_items_changed`.
  - Gửi lại `match` cho mục đã `approved` → `200` trạng thái hiện tại, không phát Vé lần hai.
- Chi tiết mục và `ReviewActionResult` của mục đã ghép trả Đơn được ghép (mã, số Vé) qua liên kết mới. Nhật ký thêm dòng "Đã ghép với Đơn {mã}" và "Ghép với Đơn không thành · Hết chỗ", kèm tên người làm như 4.4-a.
- **UX:**
  - `Dialog` "Ghép với Đơn" mở trên `Sheet`: số tiền nhận, "Mã Đơn trong giao dịch", ô chọn Sự kiện ("Mọi Sự kiện" + Sự kiện của BTC), danh sách radio ứng viên cuộn bên trong (nút xác nhận luôn thấy). Ứng viên bị chặn hiện tắt kèm lý do.
  - Nút "Ghép và phát Vé" tắt tới khi chọn một Đơn; spinner, chặn bấm lặp.
  - Không có ứng viên: "Không có Đơn hết hạn hay Cần xử lý nào cùng số tiền {số tiền}." `truncated`: "Chỉ hiện 100 Đơn mới nhất. Chọn Sự kiện để thu hẹp."
  - Thành công: toast "Đã ghép giao dịch vào Đơn {mã}. Đã phát {n} Vé.", hàng rời hàng, focus như 4.4-a.
  - Hết chỗ: `Dialog` ở lại, báo "Đơn {mã} không còn đủ chỗ." và tải lại ứng viên. `MATCH_ORDER_NOT_ELIGIBLE`: "Đơn này vừa đổi trạng thái. Chọn Đơn khác." và tải lại. `REVIEW_ACTION_NOT_ALLOWED`: xử lý cuộc đua như 4.4-a.
  - Màn 320px không cuộn ngang.

**Never:**
- Không ghép vào Đơn `pending` (còn giữ chỗ, bán lại sẽ đếm hai lần), `paid`, `cancelled`, `refunded`.
- Không đổi bước 1–7 của IPN và Đối soát bù; không tạo mục mới khi ghép thất bại.
- Không kiểm tài khoản nhận tiền của Đơn khớp tài khoản nhận giao dịch (IPN không có VA).
- Không phân trang ứng viên, không tìm theo mã Đơn hay Người mua.
- Không thêm bảng idempotency chung. `payment` không import `event`; `reporting` không import `identity`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Ghép Đơn hết hạn | `unmatched` nhận 300.000đ; Đơn `expired` 300.000đ, 2 Vé, còn chỗ | Đơn `paid` (`manual`, 300.000), 2 Vé, email Vé, mục `approved`, liên kết ghi, toast "Đã ghép giao dịch vào Đơn {mã}. Đã phát 2 Vé." | N/A |
| Ghép Đơn Cần xử lý | Đơn `review` 300.000đ có mục `amount_mismatch` nhận 250.000đ | Đơn `paid` (`paid_amount` 300.000), mục `unmatched` `approved`; mục lệch tiền vẫn `open`, có "Đã hoàn tay"/"Bỏ qua" | N/A |
| Hoàn khoản đầu | Mục lệch tiền `open`, Đơn `paid` sau ghép, bấm "Đã hoàn tay" | Mục `refunded`; Đơn `paid`, Vé, doanh thu giữ nguyên | N/A |
| Hết chỗ | Đơn `expired`, Hạng vé đã bán hết | Đơn `expired`, mục `open`, nhật ký "Ghép với Đơn không thành · Hết chỗ", không email | `409 TICKET_TYPE_SOLD_OUT`, `Dialog` báo tại chỗ |
| Sự kiện không còn bán | đã hủy / đã kết thúc / bị khóa | Ứng viên tắt kèm lý do | `409 EVENT_CANCELLED` / `EVENT_ALREADY_ENDED` / `EVENT_LOCKED` |
| Đơn không hợp lệ | mã Đơn của BTC khác, Đơn `pending`/`paid`, khác số tiền | Không đổi gì | `409 MATCH_ORDER_NOT_ELIGIBLE` |
| Hai giao dịch vào một Đơn | A ghép X vào D, B ghép Y vào D cùng lúc | Đúng một bên thắng | Bên thua `409 MATCH_ORDER_NOT_ELIGIBLE` |
| Không có ứng viên | Không Đơn nào cùng số tiền | `empty-state`, nút xác nhận tắt | N/A |
| Gửi lại | Mục đã `approved` | `200` trạng thái hiện tại | N/A |
| Ngoài BTC | BTC khác hoặc CTV | Không đọc, không ghi | `403 NOT_A_MEMBER` |

</frozen-after-approval>

## Code Map

- `apps/api/drizzle/0026_*.sql` (sinh bằng `pnpm --filter @tickee/api db:generate`, sửa tay phần CHECK/trigger nếu cần):
  - nới `review_items_refund_only_check` (`payment/schema.ts:141-144`, gốc `drizzle/0020_review_items.sql:16`) để `unmatched` nhận thêm `approved`;
  - index một phần `orders (organization_id, total_amount) WHERE status IN ('expired','review')` (`ordering/schema.ts:141-158`; hiện chỉ có index theo `event_id`, `user_id`);
  - trigger `BEFORE UPDATE` trên `payment_events` từ chối khi `OLD.order_id IS NOT NULL` hoặc cột khác đổi.
- `apps/api/src/platform/db/grants.ts` -- giữ `payment_events` trong `APPEND_ONLY_TABLES` (:12-18) và thêm mục `UPDATE_PROTECTED_COLUMNS` (:65) liệt kê mọi cột trừ `order_id`; vòng cấp theo cột chạy sau lệnh thu hồi chỉ-thêm (:111-131), nên chỉ `order_id` mở ra, DELETE vẫn bị thu hồi.
- Contracts (`packages/contracts/src`):
  - `payment.ts:57-84,101-154` -- thêm `match` vào `ReviewAction`; `reviewItemResolutionsFor('unmatched')` thêm `approved` (tách khỏi `REFUND_ONLY_REVIEW_ITEM_TYPES` chỗ dùng để chặn duyệt); body `MatchReviewItemRequest { orderCode }`; `ReviewActionResult` của `match` có mã Đơn, số Vé.
  - `reporting.ts:292-391` -- `ReviewItemLogKind` thêm `matched`, `match_sold_out`; schema ứng viên (`MatchCandidate`, `MatchCandidatesResponse { candidates, truncated }`) và path builder; `ReviewItemDetail.order` của mục đã ghép.
  - `errors.ts:210-218` + `apps/api/src/platform/http/app-error.ts:63-65` -- `MATCH_ORDER_NOT_ELIGIBLE` (409).
  - Test: `test/payment.test.ts:25-64` (đang khẳng định `match` không hợp lệ), `test/review-queue.test.ts:142-192`.
- `apps/api/src/modules/ordering/mark-paid.ts` -- `settleManual` (:357-394) chỉ nhận `review` (:371); thêm tập trạng thái nguồn vào `ManualApproval`/`MarkPaidOptions` (:55-64): duyệt tay truyền `[review]`, ghép truyền `[review, expired]`; `pay` (:402-452) nhận `from: locked.status`. Đơn `expired` đã nhả chỗ lúc hết hạn (`order-jobs.ts:156-166`) nên `sellAllOrNothing` (:128-139) bán lại đúng. Cập nhật chú thích thứ tự khóa (:254-258).
- `apps/api/src/modules/ordering/` -- hai read model xuất qua `index.ts`: tìm Đơn theo `(organizationId, code)` cho ghép; liệt kê ứng viên theo org, trạng thái, số tiền, `eventId`, giới hạn 101 dòng (mẫu `reviewOrdersOf`, `event-overview-read.ts:95-121`; `orgScope` ở `platform/access/org-scope.ts:26-29`).
- `apps/api/src/modules/payment/review-actions.ts` -- `reviewActionsFor` (:71-77) thêm `match` cho `unmatched`, và `amount_mismatch`/`orphan` `open` có Đơn `paid` → `[refund, dismiss]`; nhánh refund/dismiss của các mục này chỉ đóng mục (không chạm Đơn `paid`), giữ `notifyOrderUnchanged`; `reviewActionDone` (:84-95); nhánh `match` trong `apply` (:215-264) theo mẫu approve (`payments.ready()`, sold out ghi audit rồi ném 409 sau commit :178-180, :230-234); ghi liên kết chỉ sau khi `markPaid` trả `paid`; `resultOf` (:312-337) đọc Đơn qua liên kết. Controller (`review-actions.controller.ts:33-94`) thêm `POST match`, kiểm mục trước rồi mới parse body.
- `apps/api/src/modules/payment/review-read.ts:121-148` -- dòng nguồn trả Đơn được ghép của mục `unmatched` đã `approved`.
- `apps/api/src/platform/audit/audit.ts:130-147` -- action `review_item.match`, `review_item.match_sold_out`, `payment_event.match`.
- `apps/api/src/modules/reporting/review-queue.service.ts` -- `ACTION_LOG_KIND` (:35-42); chi tiết (:123-174) đọc Đơn được ghép, dòng nhật ký `matched` kèm `note` = mã Đơn; service + controller GET ứng viên (ghép `ticketEventsByIds` lấy tên và trạng thái Sự kiện; `approveBlockedReasonOf` :49-60 làm mẫu `blockedReason`).
- Test API:
  - `test/payment/review-actions.test.ts` -- helper `freshOrg`, `place`, `pay(org, strayCode(), amt)` tạo `unmatched` (:687), `ipn(… 'expired')` tạo Đơn hết hạn (:866), `setEvent`, `act*`, `auditOf`, `emailJobsOf`, `signalsAfter`.
  - `test/reporting/review-queue.test.ts:91-192` (`insertUnmatched`, `setEnded`).
  - `test/organizer/isolation.test.ts:120-126,227-251` -- route POST tự lặp theo `REVIEW_ACTIONS`; sửa số route (+1 GET ứng viên), coi GET ứng viên là route theo mục (404 với id lạ), gửi body đúng theo thao tác.
  - `test/payment/ipn.test.ts:848-856`, `test/payment/ipn-edge.test.ts:605-752` -- test grant và CHECK đổi theo migration.
- Web (`apps/web`):
  - `app/(dashboard)/btc/[orgId]/can-xu-ly/review-actions.tsx` -- nút và `Dialog` ghép (tách file `match-dialog.tsx`); `ConfirmDialog asForm` `confirmVariant="primary-on-light"` (`components/tickee/confirm-dialog.tsx`); tổng quát hóa nhánh lỗi đang cứng cho approve (:138-153) và luật nút primary (:247).
  - Danh sách radio theo mẫu `tai-khoan-nhan-tien/replace-key-flow.tsx:238-271`; ô chọn Sự kiện theo `thanh-vien/members-manager.tsx:366-379` với `fetchEvents` (`lib/event/api.ts:26,48`); `orderStatusBadge`, `ticketCountLabel` (`lib/reporting/overview.ts:31-69`), `formatVnd`, `formatVnDateTime`. Không dùng `Table` (tự `overflow-x-auto`, che lỗi 320px).
  - `lib/reporting/api.ts:82-108` -- GET ứng viên (query key dưới `reviewQueueQueryPrefix`; Đơn đã chọn biến mất thì bỏ chọn), POST body tổng quát.
  - `lib/reporting/review-queue.ts:86-173` -- nhãn, toast, nhãn nhật ký (switch exhaustive).
  - Test: `test/review-queue.test.ts:100-192`; `e2e/review-queue.spec.ts` (fixture `ITEMS[1]` unmatched :95-135, mock `openApi` :175-265, nút footer :830, 320px :935-976), `e2e/organizer-mock.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/modules/{payment,ordering}/schema.ts`, `platform/db/grants.ts` + migration `0026` -- CHECK, index, liên kết.
- [x] `packages/contracts/src/{payment,reporting,errors}.ts` (+ test) -- `match`, ứng viên, nhật ký, mã lỗi.
- [x] `apps/api/src/modules/ordering/*` -- `markPaid` `manual` từ `expired`, hai read model, export.
- [x] `apps/api/src/platform/audit/audit.ts` -- ba action mới.
- [x] `apps/api/src/modules/payment/*` -- nhánh `match`, controller, đọc liên kết.
- [x] `apps/api/src/modules/reporting/*` -- GET ứng viên, chi tiết và nhật ký mục đã ghép.
- [x] Test API cho mọi dòng I/O Matrix, cách ly, grant, tín hiệu khi commit và rollback, cuộc đua hai giao dịch vào một Đơn.
- [x] Web: nút, `Dialog` chọn Đơn, lọc Sự kiện, toast, lỗi tại chỗ, focus.
- [x] Test web unit và e2e: chọn và ghép, ứng viên tắt có lý do, rỗng, hết chỗ, Đơn đổi trạng thái, 320px.

**Acceptance Criteria:**
- Given `pnpm lint:deps`, then sạch.
- Given bộ test cách ly, then `POST …/match` và GET ứng viên được phát hiện và đều pass.
- Given một giao dịch đã ghép, then Đơn có `paid_amount` và mục không còn `open`: khoản đó chỉ nằm ở phần (1) danh sách hoàn tiền AD-28.
- Given `tickee_app`, then vẫn không DELETE được `payment_events` và không UPDATE được cột nào khác ngoài phạm vi đã chốt.

## Implementation Notes

- `story_key`: `4-4-duyệt-tay-từ-chối-và-đánh-dấu-đã-hoàn-tay` (4.4-a đã xong; 4.4-b xong thì story `done`). Nhánh `feat/4-4-b-ghep-voi-don`.
- Mã mới: migration `0026_match_review_item.sql` (sinh rồi thêm trigger bằng tay), `ordering/match-read.ts` (`matchableOrderOf`, `matchCandidatesOf`), web `can-xu-ly/match-dialog.tsx`. `ManualApproval` thêm `from` (duyệt `[review]`, ghép `[review, expired]`) và `totalAmount` (kiểm dưới khóa Đơn).
- Trigger `payment_events_link_order_once` so cả dòng dạng jsonb trừ `order_id`, nên cột thêm sau cũng được chặn; áp cho mọi role. Lỗi dùng SQLSTATE 42501 như thiếu quyền; test phân biệt bằng câu lỗi ("permission denied" với trigger).
- `REFUND_ONLY_REVIEW_ITEM_TYPES` giữ `unmatched` (vẫn chặn duyệt và từ chối); chỉ `reviewItemResolutionsFor('unmatched')` thêm `approved`.
- GET ứng viên kiểm `eventId` trước khi xét mục còn `match`: mục đã xử lý kèm Sự kiện lạ trả `404 EVENT_NOT_FOUND` thay vì danh sách rỗng.
- `roles.process.test.ts` chạy `dist/main.js`: chạy thẳng `vitest` trong `apps/api` khi `dist` cũ sẽ cấp lại grant cũ giữa chừng và test ghép báo "permission denied". `pnpm test` (turbo) build trước nên không gặp.
- Test 4.4-a "hết chỗ" gửi `paidAt` lùi một phút: đồng hồ máy test nhanh hơn đồng hồ DB vài ms làm đảo thứ tự hai dòng nhật ký đầu.

## Spec Change Log

## Review Triage Log

Lượt 1 (16/11/2026). BH = blind-hunter, ECH = edge-case-hunter, VG = verification-gap.

| # | Nguồn | Phát hiện | Verdict | Route | Bằng chứng |
|---|-------|-----------|---------|-------|------------|
| 1 | VG | Dialog "Đã hoàn tay" sau "Từ chối": câu "Đơn {mã} chuyển "Đã hoàn tay"…" không được khẳng định sau khi điều kiện đổi sang `refundsOrder` | low | patch | Gap đã kiểm: e2e chỉ khẳng định số tiền và "Không hoàn tác được."; grep `rời hàng Cần xử lý` trong `e2e/`, `test/` không có. |
| 2 | BH | Gửi lại `match` với mã Đơn khác (hoặc bên thua cuộc đua một giao dịch vào hai Đơn) nhận `200` và toast nêu Đơn đã thắng | low | reject | Đúng dòng "Gửi lại" của I/O Matrix (frozen) và tiền lệ 4.4-a #7/#8; toast nêu đúng Đơn đã được ghép. Chỉ gặp khi hai thành viên ghép cùng mục cùng lúc; sửa thêm nhánh so mã. |
| 3 | BH | "Ghép với Đơn" vẫn hiện khi khoản tiền không có số tiền, không bao giờ ghép được | false | reject | Mục `unmatched` chỉ sinh từ IPN `success`, schema bắt `paidAmount` (`ipn-processor.ts:83-89`); Đối soát bù tra theo Đơn của chính BTC nên không bao giờ tạo `unmatched`. |
| 4 | ECH | Như #3 | false | reject | Như #3. |
| 5 | BH | Hơn 100 Đơn mới hơn thì Đơn cũ không chọn được; đề xuất xếp theo thời điểm tiền về | low | reject | Intent (frozen) chốt "mới nhất trước, tối đa 100, lọc theo Sự kiện; không phân trang, không tìm"; lọc Sự kiện thu hẹp được. |
| 6 | BH | `Dialog` không hiện lúc tiền về; ứng viên tạo sau lúc tiền về không bị loại hay đánh dấu | low | reject | Cùng gốc với #7; thêm thời điểm và cờ là mở rộng giao diện, không phải lỗi của hành vi đã chốt. |
| 7 | ECH | Ghép Đơn tạo sau lúc tiền về → `paid_at` sớm hơn `created_at` | low | reject | Tái hiện được nhưng hiếm: Đơn phải tạo sau khoản chuyển sai mã rồi hết hạn hoặc vào Cần xử lý. Sửa cần thêm điều kiện lọc (đổi tập ứng viên đã chốt) hoặc kẹp `paid_at`. |
| 8 | BH | Không cảnh báo Người mua đã có Đơn `paid` khác của cùng Sự kiện (phát Vé hai lần) | low | reject | BTC thấy tên Người mua ở từng ứng viên và tự chọn; thêm cờ là tính năng mới (truy vấn thêm mỗi ứng viên), ngoài intent. |
| 9 | BH | `Dialog` không nói ghép Đơn Cần xử lý làm khoản đầu thành khoản thừa phải hoàn | low | reject | Mục cũ ở lại hàng với "Đã hoàn tay"/"Bỏ qua" (quyết định của Mason), BTC thấy ngay; sửa cần câu điều kiện theo trạng thái Đơn đã chọn. |
| 10 | BH | Mục lệch tiền còn lại không có dòng nhật ký hay liên kết giải thích vì sao mất "Duyệt tay" | low | reject | `Sheet` của mục đó hiện Đơn "Đã thanh toán" và `Dialog` "Đã hoàn tay" nêu Đơn giữ nguyên (e2e :1297); thêm dòng cần đọc audit chéo mục. |
| 11 | BH | Index `orders_match_candidates_idx` không phủ `ORDER BY created_at DESC, id DESC`; danh sách trạng thái lặp ở predicate và hằng số | low | reject | Index đã thu về đúng BTC và số tiền; top-N sort trên tập đó rẻ ở quy mô Closed Beta. Đổi cột index phải làm lại migration `0026` đã chạy trên DB dev/test. |
| 12 | BH | Ứng viên dùng `staleTime` 30 giây: mở lại `Dialog` thấy Đơn vừa được IPN trả hay Sự kiện vừa kết thúc | low | patch | Đã kiểm: query ứng viên không đặt `staleTime`, IPN muộn và Sự kiện kết thúc không phát `org_review_items_changed`. Máy chủ vẫn chặn (409), sửa là một tùy chọn. |
| 13 | BH | Test grant `payment_events` chỉ so 42501, mã mà trigger cũng ném: grant sai vẫn pass | low | patch | Đã kiểm `ipn.test.ts:850-915`: các câu `status`, `paid_amount`, `status_code` với `tickee_app` chỉ so `pgCode`; dòng đã gắn Đơn thì trigger cũng ném 42501. |
| 14 | BH | Thiếu test đua: ghép với IPN muộn của chính Đơn, ghép với duyệt/từ chối mục của Đơn Cần xử lý | low | reject | Mọi đường khóa Sự kiện `FOR SHARE` rồi Đơn `FOR NO KEY UPDATE`; bên sau thấy Đơn đã rời trạng thái nguồn → `lost_race` (409) hoặc IPN bước 4 `duplicate_payment`, các nhánh này đều đã có test riêng. Hiếm, sửa là thêm test đua mới. |
| 15 | ECH | Đơn `expired` được ghép trong khi IPN của chính link Gateway bị mất: Đối soát bù dừng ở `not_open`, khoản tiền thật không có mục nào | medium | defer | `reconciliation-worker.ts:153-157` bỏ Đơn khác `pending`/`expired`. Gốc có từ 4.1 (Đơn vào `review` vì lệch tiền cũng dừng tra như vậy); 4.4-b thêm một đường. Sửa phải đổi Đối soát bù, ngoài intent (Never). Ghi `deferred-work.md`. |
| 16 | ECH | Trigger không kiểm Đơn được gắn cùng BTC và dòng là `payment` | low | reject | Ứng dụng chỉ ghi qua `matchableOrderOf` (`orgScope`) và `WHERE organization_id`; khoản tiền của mục `unmatched` luôn `kind = 'payment'`. Thêm kiểm trong trigger là guard cho trạng thái không ai tạo được. |
| 17 | ECH | Mục được xử lý ở nơi khác khi `Dialog` ghép đang mở: component trả `null`, `Dialog` biến mất, focus rơi về `body` | low | reject | Đúng (`review-actions.tsx:219`), cùng loại 4.4-a #10/#11: chỉ khi hai thành viên xử lý cùng mục cùng lúc; sửa thêm nhánh giữ component. |
| 18 | ECH | Danh sách Sự kiện lỗi hoặc đang tải: ô lọc chỉ có "Mọi Sự kiện", không báo | low | reject | Hiếm (GET Sự kiện lỗi trong khi GET ứng viên được); danh sách ứng viên vẫn dùng được. Sửa thêm nhánh lỗi và tải. |

## Design Notes

- **Hết chỗ khác IPN.** IPN cho Đơn `expired` hết chỗ thì sang `review` và tạo mục `orphan`; ghép tay thì không, vì `payment_event_id` của mục là unique (không tạo được mục thứ hai cho cùng giao dịch) và AC muốn mục vẫn `open`. Ghi bằng audit như `approve_sold_out` của 4.4-a.
- **Một mã lỗi cho Đơn không hợp lệ.** Phân biệt "không có" với "của BTC khác" sẽ cho dò mã Đơn của BTC khác.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: không lỗi.
- `pnpm lint:deps` -- expected: không vi phạm.
- `pnpm --filter @tickee/api test` -- expected: pass, gồm `isolation.test.ts`.
- `pnpm --filter @tickee/contracts test`, `pnpm --filter @tickee/web test` -- expected: pass.
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 pnpm --filter @tickee/web build` rồi `pnpm --filter @tickee/web exec playwright test e2e/review-queue.spec.ts` -- expected: pass.
