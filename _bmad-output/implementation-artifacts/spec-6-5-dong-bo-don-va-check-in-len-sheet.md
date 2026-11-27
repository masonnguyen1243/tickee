---
title: 'Story 6.5: Đồng bộ Đơn và check-in lên Sheet trong 1 phút'
type: 'feature'
created: '2026-11-27'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '0863307bf797a35df15b84e65be7c8848b021c88'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sau 6.4, Sheet chỉ là ảnh chụp lúc kết nối. Đơn được thanh toán, chuyển Cần xử lý, bị từ chối hay được hoàn tay, và khách check-in sau đó, đều không lên Sheet, nên Sheet lệch dashboard (FR-32, AD-23).

**Approach:** Mỗi lần Đơn chuyển `paid`, `review`, `cancelled`, `refunded` và mỗi check-in thành công enqueue `integration.sheet_row_changed {eventId, orderId}` bằng chính `tx` của lệnh đó. Worker `integration` đánh dấu dòng bẩn rồi hẹn một job flush theo kết nối: debounce theo cửa sổ thời gian và không bao giờ chạy song song. Flush đọc trạng thái hiện tại qua read model và tìm dòng theo cột Mã Đơn (thiếu thì thêm vào cuối). Nó chỉ ghi ô của cột Tickee, và chỉ xóa đánh dấu sau khi ghi thành công. Story gộp thêm các mục hoãn từ review 6.4: tìm tab theo `sheetId`, chỉ nới lưới, 403 vì quota là lỗi tạm thời, đánh dấu cả khi kết nối đang `syncing`, và thêm cột cho câu hỏi form mới.

**Quyết định (Mason, 27/11/2026):**
1. **Cột Tickee nhận ra bằng developer metadata của Google** gắn vào từng cột: khóa `tickee.column`, giá trị là mã cột cố định (vd. `order_code`) hoặc `question:<questionId>`, `visibility: PROJECT`.
   - BTC chèn, xóa hay di chuyển cột tùy ý; câu hỏi đổi nhãn vẫn ghi đúng cột theo id. Tiêu đề của cột đã có không bị ghi lại.
   - Cột Tickee bị xóa (trừ Mã Đơn) thì được thêm lại ở cuối lưới. Câu hỏi đã có câu trả lời mà chưa có cột thì được thêm cột ở cuối lưới, tiêu đề là nhãn hiện tại. Cả hai trường hợp đều đánh dấu bẩn mọi Đơn đồng bộ của Sự kiện để điền đủ.
2. **Sheet mất thì tự tạo Sheet mới.** Áp dụng khi spreadsheet không còn (404), tab theo `sheet_tab_id` không còn, hoặc không còn cột mang metadata Mã Đơn. Khi đó:
   - đặt lại `spreadsheet_id`, `spreadsheet_url`, `last_synced_at`, chuyển `syncing`, chạy lại job đẩy đầu với id job mới, giữ dòng bẩn;
   - link ở Cài đặt đổi sang Sheet mới; Sheet cũ (nếu còn) giữ nguyên trong Drive. Không báo BTC;
   - Sheet kết nối từ 6.4 chưa có metadata nên cũng đi đường này ở lượt flush đầu.
3. **E5-5 `checkin_method`:** Vé có cột `checkin_method` (`scan` | `manual`; null cho Vé check-in trước story này), đặt qua `CheckInInput` ở hai flow check-in. Sheet thêm cột Tickee "Check-in tay" (số Vé của Đơn được check-in tay), đứng ngay sau "Đã check-in". CSV 6.3 không đổi.
4. **Cửa sổ debounce của flush `W` = 45 giây.** Đây là lệch có chủ đích so với "tối đa một lần mỗi phút" của AD-23, để P95 ≤ 1 phút cả khi Đơn đổ liên tục.
5. Giữ nguyên spec dù vượt ngưỡng 5.000 token (khoảng 7.000): một mục tiêu người dùng, không tách.

## Boundaries & Constraints

**Always:**
- **Năm điểm enqueue**, cùng `tx` với lệnh đổi trạng thái; rollback thì không có job. Payload chỉ có `{eventId, orderId}`.
  - `OrderPayments.pay()`: mọi đường sang `paid`, gồm IPN, Đối soát bù, duyệt tay, ghép và Đơn 0đ;
  - `moveToReview()`: mọi đường sang `review`;
  - `OrderReviewDecisions.reject` (`cancelled`) và `.refund` (`refunded`);
  - `ticketing.checkIn`: chỉ khi check-in thành công.
  - Không gắn vào `notifyOrderChanged`, vì đường hết hạn cũng gọi hàm này.
- **Queue:** định nghĩa một lần trong `ticketing` (producer thấp nhất: `ordering → ticketing` và `integration → ticketing` đều hợp lệ), theo tên khai báo ở `packages/contracts`. `ordering` và `ticketing` không import `integration`. Mọi caller gọi `ready()` trước khi mở `tx`.
- **Handler `sheet_row_changed`:**
  - Sự kiện không có kết nối → hoàn tất, không ghi gì;
  - có kết nối (mọi trạng thái) → upsert dòng bẩn `(connection_id, order_id)` và tăng `version`;
  - chỉ hẹn flush khi lần đẩy đầu đã xong (`last_synced_at` khác null) và trạng thái khác `auth_revoked`;
  - lần đẩy đầu chưa xong → chỉ đánh dấu. Job đẩy đầu, khi xong, hẹn flush nếu còn dòng bẩn;
  - `auth_revoked` → chỉ đánh dấu, giữ dòng bẩn cho 6.6.
- **Flush:**
  - một job cho mỗi kết nối. Thay đổi đến trong lúc throttle hay trong lúc flush đang chạy luôn có một lượt flush sau đó, nên không mất;
  - mỗi lượt tối đa 500 dòng bẩn; còn thì hẹn lượt sau;
  - chỉ xóa dòng bẩn khi Google đã ghi xong và `version` vẫn bằng giá trị đã đọc;
  - đọc Đơn qua read model của `ordering`/`ticketing`, lọc theo `organization_id` của kết nối, không join bảng mô-đun khác. Đơn ngoài bốn trạng thái đồng bộ → bỏ qua và xóa đánh dấu.
- **Tìm dòng:**
  - mỗi lượt đọc toàn bộ cột mang metadata Mã Đơn; dòng 1 là tiêu đề;
  - khớp nguyên chuỗi `TK…`. Có hai dòng trùng mã thì ghi dòng đầu tiên;
  - không thấy → thêm sau dòng cuối cùng có Mã Đơn;
  - chỉ ghi ô của cột Tickee, kể cả khi các cột Tickee không liền nhau.
- **Tab và lưới** (áp cho cả flush và job đẩy đầu):
  - tìm tab theo `sheetId` đã lưu, không theo tên "Đơn". BTC đổi tên tab thì vẫn ghi được;
  - chỉ nới lưới, không bao giờ thu nhỏ (đọc lưới hiện tại trước khi nới).
- **Lỗi Google:**
  - giữ nguyên phân loại của 6.4;
  - thêm: 403 kèm lý do `rateLimitExceeded`, `userRateLimitExceeded` hoặc `quotaExceeded` → `rate_limited`; 403 kèm `storageQuotaExceeded` → mã mới `storage_quota`. Cả hai là lỗi tạm thời;
  - thành công → `active`, cập nhật `last_synced_at`, xóa `last_error_code`;
  - không thông báo BTC; không gọi Google bên trong transaction DB.
- Giá trị ô giống 6.4 (`sheetOrderRow`, `RAW`).
- Ngắt kết nối thì dòng bẩn bị xóa theo. Flush kiểm kết nối còn tồn tại trước khi ghi và trước khi cập nhật trạng thái.

**Never:**
- Không làm việc của 6.6: banner hay email `auth_revoked`, "Kết nối lại", flush dòng bẩn khi kết nối lại, chuyển `auth_revoked` khi người cấp bị xóa khỏi BTC.
- Không enqueue cho hủy Sự kiện (7.1, chưa có code) hay ẩn danh hóa (7.6); hai story đó tự gọi queue này.
- Không import `payment` hay `reporting` từ `integration`.
- Không sửa `organizer/payment-service.ts`, `can-xu-ly/review-queue.tsx`, `contracts/organizer.ts` (điều kiện tách file của E4-10), không sửa `checkin-event-screen.tsx` (E5-5). Không thêm bộ giới hạn tốc độ (E5-5).
- Không dùng con trỏ `updated_at`, không dùng cron cho flush, không dùng `values:append` của Google.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Đơn mới `paid` | Kết nối `active` | Dòng mới cuối Sheet, giá trị như 6.4 | N/A |
| Không có kết nối | Sự kiện chưa kết nối | Job hoàn tất; không có dòng bẩn, không gọi Google | N/A |
| Check-in | Vé của Đơn đã có trên Sheet | Ô "Đã check-in" của đúng dòng đó đổi | N/A |
| Cần xử lý | Duyệt tay, ghép, từ chối, hoàn tay | Ô "Trạng thái" và "Đã nhận" đổi | N/A |
| Nhiều thay đổi | 20 Đơn trong một cửa sổ | Một lượt flush ghi đủ 20 | N/A |
| Thay đổi giữa lượt | Đơn đổi khi flush đang ghi | Dòng bẩn còn (`version` tăng), lượt sau ghi | N/A |
| BTC sửa dòng | Chèn, xóa, sắp xếp lại dòng | Ghi đúng dòng theo Mã Đơn | N/A |
| BTC đổi tên tab | "Đơn" → "Orders" | Vẫn ghi đúng tab | N/A |
| BTC chèn hay di chuyển cột | Cột mới chen giữa các cột Tickee | Ghi đúng cột Tickee theo metadata; cột của BTC không đổi | N/A |
| BTC xóa cột Tickee | Vd. "Email" | Cột được thêm lại ở cuối, các lượt sau điền đủ | N/A |
| Câu hỏi form mới | Đơn đầu tiên trả lời câu hỏi đó sau khi kết nối | Thêm cột ở cuối, tiêu đề là nhãn hiện tại | N/A |
| Sheet mất | Spreadsheet 404, mất tab, hoặc mất cột Mã Đơn | Tạo spreadsheet mới, đẩy lại toàn bộ, giữ dòng bẩn | N/A |
| Check-in tay | CTV tra tay rồi check-in | `checkin_method = manual`; ô "Check-in tay" tăng | N/A |
| Đang đẩy đầu | Kết nối `syncing` | Chỉ đánh dấu; đẩy đầu xong thì flush ghi | N/A |
| Mất quyền | `auth_revoked` | Chỉ đánh dấu; không gọi Google | N/A |
| Lỗi tạm thời | 429, 5xx, timeout, 403 quota | `retrying` + `last_error_code`; dòng bẩn còn | Retry có backoff; hết lượt → dead-letter + cảnh báo |
| Ngắt giữa lượt | Kết nối bị xóa | Dừng trước khi ghi tiếp, không cập nhật trạng thái; dòng bẩn đã bị xóa theo | N/A |

</frozen-after-approval>

## Code Map

**Điểm enqueue** (mọi chỗ đều có `tx`):
- `apps/api/src/modules/ordering/mark-paid.ts`:
  - `OrderPayments.pay()` :429. CAS sang `paid` ở :432, `enqueueBuyerEmail` trong `tx` ở :462. Đây là mẫu đặt lời gọi enqueue;
  - `markPaid` :252 → `settleGateway` :303, `settleManual` :378, Đơn 0đ :288;
  - `moveToReview()` :173, được gọi ở :330, :337, :344, :354, :358;
  - `OrderPayments` inject `BOSS` + `BuyerEmailQueues`; `ready()` ở :199-212.
- `apps/api/src/modules/ordering/order-review.ts`: `reject` :43 (review → cancelled), `refund` :72 (cancelled → refunded), `ready()` :35.
- `apps/api/src/modules/payment/review-actions.ts:204-205`: chỉ gọi `ready()` cho approve, match, reject. Phải thêm refund. Đơn 0đ: `ordering/place-order.ts:206`, đã gọi `ready()` ở `orders.service.ts:140-141`.
- `apps/api/src/modules/ticketing/check-in.ts`:
  - `checkIn(tx, input)` :73 ghi `checked_in_at` ở :83, phát `event_checkins_changed` ở :95 khi thành công;
  - `RETURNING` (`snapshot` :49) chưa có `order_id`; `CheckInInput` ở :20.
- Hai caller, chưa có `boss` hay queue producer:
  - `flows/checkin-scan.flow.ts:85` (`tx` :102), controller `flows/checkin-scan.controller.ts:20`;
  - `flows/checkin-lookup.flow.ts:46` (`tx` :52), controller `flows/checkin-lookup.controller.ts:51`;
  - mẫu flow inject queue: `flows/flows.module.ts:32` + `flows/event-edit.controller.ts:30-46`.
- `notifyOrderChanged` (`ordering/order-changed.ts:21`) cũng được đường hết hạn gọi (`order-jobs.ts:161,186`, `payment-link.ts:269,310`): không gắn vào đây.

**Queue và mẫu cross-module:**
- `apps/api/src/platform/jobs/queue.ts`:
  - `defineQueue` :66, `ensure()` :75 gọi `createQueue` rồi `updateQueue`. pg-boss 12.38 ném lỗi khi `updateQueue` nhận `policy` (`manager.js:2418`);
  - `EnqueueOptions` :32 chỉ có `startAfter` và `id`; `enqueue` :80;
  - `QueueProducer` :101, `registerQueueWorker` :183 (`dedupeBy` :166 chỉ gộp trong một lô fetch), `derivedJobId` :236.
- pg-boss 12.38:
  - `sendDebounced(name, data, opts, seconds, key)` thử chèn vào khe hiện tại, trùng thì chèn vào khe kế với `startAfter` (`manager.js:1478-1545`);
  - mỗi khe có tối đa một job theo `singleton_key`, trừ `cancelled` (index `job_i4`);
  - policy `singleton`: tối đa một job `active` cho mỗi `singleton_key` (`job_i2`), và fetch bỏ qua key đang active.
- Mẫu producer tự định nghĩa queue, consumer import từ `index.ts`: `ordering/reconciliation-jobs.ts:60,109` (queue khai báo ở `ordering` để TX2 enqueue mà không import `payment`).
- `packages/contracts/src/jobs.ts`: queue `integration.sheet-initial-sync` :146-148, payload :196; tên queue cho phép `_ - . /`.
- Đồ thị mô-đun `apps/api/module-graph.cjs`: `ticketing → [event]`; `ordering → [ticketing, event, organizer, tingee]`; `integration → [ordering, ticketing, event, organizer, identity]`.
- Dead-letter: tên `<queue>.dead-letter` tự hiện ở `/admin` (`platform/jobs/dead-letters.ts:81`) và có cảnh báo (`platform/alerts/ops-alert-scan.ts:119`).

**Mô-đun `integration` (6.4):**
- `schema.ts`: `sheetConnections` :18, CHECK trạng thái :43. Migration mới nhất: `drizzle/0038_sheet_connections.sql`.
- `sheet-connection-store.ts`: `connectionOfEvent` :15, `connectionById` :28, `connectionExists` :34, `saveSpreadsheet` :46, `markSyncFailure` :64, `markSynced` :79.
- `sheet-sync-jobs.ts`:
  - hằng: `SHEET_SYNC_BATCH` :58, `SHEET_ORDERS_TAB_ID = 0` :61, `SHEET_MIN_GRID` :64;
  - queue :70 (retry 5, backoff 30→600 giây), `SheetSyncQueues` :89, `SheetSyncDeps` :96, `sheetOrdersOf` :120;
  - `sheetGridFor` :136 và `resizeGrid` đặt kích thước tuyệt đối: phải đổi thành chỉ nới;
  - `runSheetInitialSync` :146 ghi theo vùng A1 tên tab ở `start+2`, kết thúc bằng `markSynced`;
  - `SheetSyncWorker` :227, `IntegrationJobsModule.forRoot` :270, đăng ký ở `worker.module.ts:68`.
- `google-client.ts`:
  - `GoogleApiError` :30, `GoogleOperation` :18;
  - các method: `createSpreadsheet` :200, `resizeGrid` :223, `writeValues` :237;
  - chưa có method đọc; `sheets()` :269 chỉ nhận `POST`/`PUT`;
  - `httpFailure` :125, nhánh 403 :136; `transportFailure` :143.
- `sheet-rows.ts`: `GOOGLE_SHEET_ORDER_COLUMNS` :15 (12 cột, A = Mã Đơn), `sheetHeaderRow` :31, `sheetOrderRow` :50, `sheetColumnName` :74.
- `packages/contracts/src/google-sheets.ts`: `SheetSyncErrorCode` :79, `SHEET_SYNC_ERROR_LABEL` :107 (web lấy nhãn từ đây), `GOOGLE_SHEET_ORDER_STATUSES` :187.

**Mục hoãn giao cho 6.5** (`deferred-work.md` › "Deferred from: code review of spec-6-4-ket-noi-google-sheets.md"):
- "Sheet bị BTC xóa hoặc chuyển vào thùng rác…" → Quyết định 2;
- "Vùng A1 ghi theo tên tab "Đơn"…" → Always › Tab và lưới;
- "`resizeGrid` đặt kích thước lưới tuyệt đối…" → Always › Tab và lưới;
- "Lần đẩy đầu đọc Đơn từng trang ngoài transaction…" → Always › Handler (đánh dấu khi `syncing`, đẩy đầu xong thì flush);
- "Chưa kiểm (maybe-false…): Google có thể trả 403 vì lý do không phải mất quyền…" → Always › Lỗi Google;
- "Cột form trên Sheet lấy từ câu hỏi đã có Đơn trả lời lúc kết nối…" → Quyết định 1;
- "Kiểm thủ công của 6.4 chưa làm…" → AC thứ ba.

**Read model** (xuất qua `ordering/index.ts:9-20`, `ticketing/index.ts:18`):
- `eventOrdersPageOf(db, scope, eventId, {orderIds, statuses, limit})` (`ordering/event-orders-read.ts:80`, `orderIds` :49);
- `answerColumnsOf` :216, `answersOfOrders` :245 (không có scope: chỉ truyền id đã lọc);
- `checkinCountsOfOrders` (`ticketing/order-checkin-counts.ts:18`).

**Test:**
- `apps/api/test/google-fake/server.ts`:
  - đã có: create, `batchUpdate` (chỉ `updateSheetProperties`, :441), PUT values (:457);
  - chưa có: GET values, `batchGet`, `ByDataFilter`, thao tác cột/dòng;
  - `parseRange` :181 cần vùng hai góc; ghi quá lưới → 400 :463;
  - knob `sheetsReplies`, `scriptSheets`; nhật ký `requests`, `calls()`; đọc ô bằng `fake.values()` :240.
- `apps/api/test/integration/sheet-initial-sync.test.ts`:
  - helper `connect` :116, `placeFree` :150, `seed` :182, `stateOf` :139, `run` :129;
  - worker thật :542 (`WorkerModule.forRoot` + `expect.poll`).
- `platform/alerts/sliding-window.ts:75` `percentile(p)` dùng để tính P95.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/jobs.ts` (+ test) -- `INTEGRATION_SHEET_ROW_CHANGED` = `integration.sheet_row_changed` và `INTEGRATION_SHEET_FLUSH` = `integration.sheet-flush`, mỗi queue kèm dead-letter; payload `SheetRowChangedPayload {eventId, orderId}`, `SheetFlushPayload {connectionId}` -- AD-12, AD-23.
- [x] `packages/contracts/src/google-sheets.ts` (+ test) -- `SheetSyncErrorCode.STORAGE_QUOTA` + nhãn; khóa `tickee.column` và mã các cột cố định -- dùng chung api/web.
- [x] `apps/api/src/platform/jobs/queue.ts` (+ test) -- `enqueue` nhận debounce (`singletonKey`, `singletonSeconds`, `singletonNextSlot`); `ensure()` không truyền `policy` vào `updateQueue` -- pg-boss chặn đổi policy.
- [x] `apps/api/src/modules/ticketing/sheet-row-changed-queue.ts` (mới) + `index.ts` -- `SHEET_ROW_CHANGED_QUEUE`, `SheetRowChangedQueues extends QueueProducer`, `enqueueSheetRowChanged(boss, tx, payload)` -- producer thấp nhất.
- [x] `apps/api/src/modules/ticketing/check-in.ts` -- `RETURNING` thêm `order_id`; nhận `boss`; enqueue khi thành công; `CheckInInput.method` ghi `checkin_method` -- AC 6.5, Quyết định 3.
- [x] `apps/api/src/modules/ticketing/schema.ts`, `order-checkin-counts.ts` -- cột `checkin_method` (CHECK `scan`/`manual`, null được khi chưa check-in hoặc check-in trước story này); `CheckinCounts` thêm `manualCheckedInCount` -- Quyết định 3.
- [x] `apps/api/src/modules/integration/sheet-rows.ts` (+ test) -- mỗi cột có mã ổn định cho metadata; thêm cột "Check-in tay" sau "Đã check-in"; dựng giá trị ô theo mã cột thay vì vị trí -- Quyết định 1, 3.
- [x] `apps/api/src/modules/ordering/mark-paid.ts`, `order-review.ts`, module ordering -- enqueue ở `pay()`, `moveToReview()`, `reject`, `refund`; `ready()` của `OrderPayments`/`OrderReviewDecisions` gọi cả `SheetRowChangedQueues` -- AC 6.5.
- [x] `apps/api/src/modules/payment/review-actions.ts` -- gọi `ready()` cả cho refund.
- [x] `apps/api/src/flows/checkin-scan.flow.ts`, `checkin-lookup.flow.ts`, hai controller, `flows.module.ts` -- inject `BOSS` + `SheetRowChangedQueues`, `ready()` trước `tx`, truyền `boss` và `method` (`scan` ở flow quét, `manual` ở flow tra tay) cho `checkIn`.
- [x] `apps/api/src/modules/integration/schema.ts` + migration `0039_…` -- bảng `sheet_dirty_rows` (`connection_id` FK `ON DELETE CASCADE`, `order_id`, `version`, `marked_at`, PK `(connection_id, order_id)`); cột `sheet_tab_id` (mặc định 0) trên `sheet_connections` -- AD-23, Quyết định 2.
- [x] `apps/api/src/modules/integration/sheet-connection-store.ts` -- `markDirty`, `dirtyRowsOf(limit)`, `clearDirty(rows)` (xóa khi `version` khớp), `hasDirty`.
- [x] `apps/api/src/modules/integration/google-client.ts` (+ test) --
  - `sheets()` nhận `GET`;
  - `spreadsheetInfo` (tab theo `sheetId`, lưới);
  - đọc cột và ghi ô theo `gridRange` (`values:batchGetByDataFilter`, `values:batchUpdateByDataFilter`, `RAW`);
  - `expandGrid` chỉ nới; `appendDimension` cột; tạo và tìm developer metadata cột (`developerMetadata:search`);
  - spreadsheet 404 có mã riêng để flush nhận ra (Quyết định 2);
  - `httpFailure` xếp 403 quota/storage như Always -- mục hoãn 6.4.
- [x] `apps/api/src/modules/integration/sheet-flush-jobs.ts` (mới) --
  - queue `sheet_row_changed` + handler đánh dấu;
  - queue flush có policy `singleton` và retry như job đẩy đầu;
  - `scheduleSheetFlush(boss, connectionId)` dùng `sendDebounced(…, W, connectionId)`;
  - `runSheetFlush(deps, connectionId)` làm đúng Always; lỗi phân loại như 6.4;
  - cột thiếu hay mất xử lý theo Quyết định 1, Sheet mất theo Quyết định 2;
  - `W` = 45 giây là hằng (Quyết định 4), test thay qua tùy chọn của `IntegrationJobsModule.forRoot`, không qua env -- AC 6.5.
- [x] `apps/api/src/modules/integration/sheet-sync-jobs.ts`, `index.ts` -- đẩy đầu tìm tab theo `sheet_tab_id`, chỉ nới lưới, gắn metadata cho mọi cột Tickee khi tạo Sheet, ghi cột "Check-in tay", xong thì hẹn flush nếu còn dòng bẩn; id job đẩy đầu phân biệt được lần tạo lại Sheet (Quyết định 2); đăng ký worker mới trong `IntegrationJobsModule` -- mục hoãn 6.4.
- [x] `apps/api/test/google-fake/server.ts` --
  - endpoint mới của client: GET spreadsheet, `ByDataFilter`, metadata, `appendDimension`;
  - helper mô phỏng BTC: chèn, xóa, sắp xếp dòng; chèn và di chuyển cột; đổi tên hay xóa tab; xóa spreadsheet;
  - kịch bản 403 có lý do quota.
- [x] `apps/api/test/integration/sheet-row-changed.test.ts` (mới) -- năm điểm enqueue có job trong cùng `tx`; rollback thì không có job; không có kết nối thì không có dòng bẩn; `syncing`/`auth_revoked` chỉ đánh dấu.
- [x] `apps/api/test/integration/sheet-flush.test.ts` (mới) -- mọi dòng I/O Matrix; `version` chống mất thay đổi; tab đổi tên; lưới không thu nhỏ; cột BTC không bị chạm; cột Tickee bị xóa và câu hỏi mới; Sheet mất (cả Sheet từ 6.4 chưa có metadata); 403 quota không thành `auth_revoked`.
- [x] `apps/api/test/integration/sheet-flush-worker.test.ts` (mới, worker pg-boss thật) --
  - debounce: nhiều thay đổi trong cửa sổ → hai lượt flush, không mất thay đổi nào;
  - không có hai flush cùng kết nối chạy song song;
  - dead-letter khi hết retry;
  - P95: 30 Đơn `paid` rải ngẫu nhiên qua 3 cửa sổ, `W` rút ngắn còn 3 giây, P95 ≤ `W` + 5 giây (`percentile`).

**Acceptance Criteria:**
- Given Sự kiện có kết nối `active`, when một Đơn được thanh toán qua IPN (Tingee fake), then dòng của Đơn xuất hiện ở cuối Sheet (Google fake) trong `W` + 10 giây, với giá trị giống lần đẩy đầu.
- Given `pnpm lint:deps`, when chạy, then không có cạnh mới vào `integration`; `ordering` và `ticketing` vẫn không import `integration`.
- Given dev stack với OAuth client Google thật (gộp kiểm thủ công hoãn từ 6.4), when kết nối một Sự kiện có Đơn thật (câu hỏi form, check-in), rồi thanh toán một Đơn mới và check-in một Vé, then:
  - Sheet trong Drive của người cấp có tiếng Việt đúng, SĐT giữ số 0, số tiền là số, giờ Việt Nam;
  - dòng mới và ô check-in cập nhật trong khoảng 1 phút;
  - ngắt kết nối thì Sheet vẫn còn trong Drive.

## Implementation Notes

- **Bố cục file của `integration`:**
  - `sheet-flush-queue.ts`: queue flush (policy `singleton`, retry 5 lần 30→600 giây, poll 1 giây), `SHEET_FLUSH_WINDOW_SECONDS = 45`, `scheduleSheetFlush` (debounce qua `enqueue` với `singletonKey`/`singletonSeconds`/`singletonNextSlot`, đúng như `sendDebounced`). Tách riêng để lần đẩy đầu và flush cùng hẹn flush mà không import vòng;
  - `sheet-layout.ts`: hằng lưới, `columnPositions` (metadata → chỉ số cột; trùng mã → cột trái nhất), `cellBlocks` (chỉ cột Tickee, đoạn cột liền nhau, gộp dòng liền nhau);
  - `sheet-flush-jobs.ts`: handler `markSheetRowChanged`, `runSheetFlush`, `SheetFlushWorker`;
  - `IntegrationJobsModule` chuyển sang `integration-jobs.module.ts` (cũng để tránh import vòng); `forRoot(config, { flushWindowSeconds })`.
- **Handler `sheet_row_changed`** khóa kết nối `FOR SHARE` trong transaction của nó. `markSynced` của lần đẩy đầu phải chờ handler commit, nên hoặc lần đẩy đầu thấy dòng bẩn khi kiểm `hasDirty`, hoặc handler thấy `last_synced_at` và tự hẹn flush. "Ngắt kết nối" cũng chờ handler rồi mới xóa (dòng bẩn đi theo). Trong một lô, cùng Đơn chỉ đánh dấu một lần (`dedupeBy`).
- **Spreadsheet 404:** `GoogleApiError` có loại mới `not_found` (chỉ cho lời gọi Sheets API), mã lưu vẫn là `unexpected_response`. Không thêm `SheetSyncErrorCode` vì flush và lần đẩy đầu luôn tự tạo Sheet mới khi gặp loại này.
- **403 quota:** ngoài ba lý do của spec, nhận thêm `RATE_LIMIT_EXCEEDED` (dạng `google.rpc.ErrorInfo`) là `rate_limited`.
- **Lần đẩy đầu:**
  - bỏ qua (`already_active`) khi `last_synced_at` đã có, kể cả khi kết nối đang `retrying` do flush lỗi. Job cũ bị requeue không đẩy đè lên Sheet BTC đã sắp xếp;
  - đang retry mà spreadsheet 404 hay mất tab → CAS bỏ Sheet đó (`resetSpreadsheet`) và tạo Sheet mới ngay trong lần chạy (không cần job mới);
  - Sheet chưa có cột Mã Đơn mang metadata → tiêu đề (dòng 1) và metadata của mọi cột Tickee ghi trong một `batchUpdate` nguyên khối (`tagColumns`). Lần retry đã có metadata → giữ vị trí đã gắn, câu hỏi mới thêm cột ở cuối;
  - ghi theo `gridRange` của tab (`values:batchUpdateByDataFilter`); bỏ `writeValues` (A1 theo tên tab), `resizeGrid`, `sheetRange`, `sheetColumnName`.
- **Flush:**
  - Đơn mới thêm theo thứ tự tạo (read model trả mới → cũ, đảo lại);
  - "dòng cuối cùng có Mã Đơn" = dòng cuối cùng có giá trị khác rỗng trong cột Mã Đơn, để không ghi đè chữ BTC gõ ở cột đó;
  - cột thiếu: đánh dấu bẩn mọi Đơn đồng bộ (`markDirty(…, 'keep')`, không đè `version` của dòng đã bẩn) trước khi thêm cột, rồi `appendColumns` (thêm cột + tiêu đề + metadata trong một `batchUpdate`). Lượt lỗi sau khi thêm cột vẫn còn dấu để điền;
  - tạo Sheet mới (Quyết định 2): đặt lại Sheet bằng CAS theo `spreadsheet_id` và enqueue lần đẩy đầu trong cùng transaction. Id job suy từ spreadsheet bị thay (`sheetInitialSyncJobId(connectionId, replacedSpreadsheetId)`).
- **`checkin_method`:** CHECK `checkin_method IS NULL OR (checked_in_at IS NOT NULL AND checkin_method IN ('scan','manual'))`. `CheckinCounts.manualCheckedInCount` có ở cả `checkinCountsOfOrders` lẫn `checkinCountsByTicketType` (hai nơi dùng chung kiểu), nhưng các response hiện có đều ánh xạ từng trường nên không đổi.
- **Check-in:** `checkIn(tx, boss, input)`. Hai flow gọi `SheetRowChangedQueues.ready()` sau khi kiểm chữ ký, trước transaction, nên Mã QR sai chữ ký vẫn không chạm DB hay pg-boss. `scanTicket`/`manualCheckIn` nhận thêm `SheetRowChanges { boss, queues }`.
- **`SheetRowChangedQueues`** được cung cấp ở `OrderPaymentsModule` (cả api lẫn worker) và `FlowsModule`. `OrderPayments.ready()` và `OrderReviewDecisions.ready()` chờ cả queue email lẫn queue này.
- **Migration** `0039_sheet_dirty_rows.sql`: bảng `sheet_dirty_rows` (PK `(connection_id, order_id)`, FK `ON DELETE CASCADE`, index `(connection_id, marked_at)`, CHECK `version >= 1`), cột `sheet_connections.sheet_tab_id` (mặc định 0, CHECK `>= 0`), cột `tickets.checkin_method`.
- **Google fake:**
  - endpoint mới: GET spreadsheet, `batchUpdate` nguyên khối (`appendDimension`, `updateCells`, `createDeveloperMetadata`, `updateSheetProperties`), `developerMetadata:search`, `values:batchGetByDataFilter`, `values:batchUpdateByDataFilter`;
  - bỏ PUT values A1;
  - helper BTC: `insertRows`/`deleteRows`/`sortRows`/`setCell`/`insertColumns`/`deleteColumn`/`moveColumn` (metadata đi theo cột), `renameTab`/`addTab`/`deleteTab`, `deleteSpreadsheet`, `columnOf`; kịch bản `sheetsForbidden(reason)`.
- **Test:**
  - `test/integration/sheet-fixtures.ts` dùng chung cho ba file mới;
  - test worker dựng module riêng (`DbModule` + `JobsModule` + `IntegrationJobsModule.forRoot(…, { flushWindowSeconds: 3 })`, client Google bọc để đo lượt chạy song song). Test chờ hết job `sheet_row_changed` tồn đọng của các file trước rồi mới đo;
  - P95 đo được khoảng 3,8 giây với `W` = 3 (ngưỡng 8 giây).
- **Kiểm chứng của agent triển khai (27/11/2026):**
  - `pnpm typecheck` và `pnpm lint:deps` sạch;
  - api 112 file / 1.952 test xanh (gồm `sheet-row-changed` 10, `sheet-flush` 31, `sheet-flush-worker` 6); contracts 408, web 511;
  - `pnpm test:e2e` 1.424/1.424 xanh trên `ios-webkit` và `android-chromium`;
  - AC thứ ba (dev stack với OAuth client Google thật) chưa làm: cần người kiểm thủ công.
- **Sửa sau review (27/11/2026):**
  - lần đẩy đầu retry trên Sheet đã có cột Tickee mà mất cột Mã Đơn → bỏ Sheet (CAS `resetSpreadsheet`), tạo Sheet mới ngay lần chạy. Chỉ gắn cột tại chỗ khi Sheet chưa có metadata `tickee.column` nào;
  - nhánh `already_active` của lần đẩy đầu: `last_synced_at` có và không `auth_revoked` → `scheduleFlushIfDirty` (phòng lần trước `markSynced` xong mà hẹn flush lỗi);
  - `dirtyRowsOf` đọc đánh dấu gần nhất trước (`marked_at DESC`, rồi id Đơn): thay đổi mới không phải chờ hàng nghìn dòng điền cột;
  - flush khớp mã Đơn cả ở dòng 1 (BTC xóa hay dời dòng tiêu đề);
  - Google fake bỏ `sheetId`/`startIndex` bằng 0 trong phản hồi `GET` spreadsheet và `developerMetadata:search`, như JSON proto3 của Google;
  - test thêm: Mã Đơn bị xóa giữa hai lần đẩy đầu, cột câu hỏi mới ở lần retry, hẹn lại flush sau lỗi hẹn, `already_active` khi `retrying`, hơn 500 dòng điền cột cùng một thay đổi mới, xóa dòng tiêu đề, 403 chỉ có `ErrorInfo` `RATE_LIMIT_EXCEEDED`;
  - test worker thật (`sheet-initial-sync`, `sheet-flush-worker`) bỏ job Google Sheets còn chờ của các ca gọi thẳng trước đó (`discardPendingSheetJobs`), để kết quả không phụ thuộc thứ tự file.

## Spec Change Log

## Review Triage Log

Lớp: BH = Blind Hunter, EC = Edge Case Hunter, VG = Verification Gap. Lượt 1 (27/11/2026).

| # | Lớp | Phát hiện | Verdict | Route | Bằng chứng |
|---|-----|-----------|---------|-------|------------|
| 1 | VG | Lần đẩy đầu bỏ qua khi `last_synced_at` có mà kết nối `retrying` (flush lỗi) chưa có test | gap | patch | Chỉ có assert `already_active` sau lần đẩy thành công (`sheet-initial-sync.test.ts:293`); bỏ vế `lastSyncedAt !== null` (`sheet-sync-jobs.ts:224`) thì không test nào đỏ. |
| 2 | VG | Fake luôn gửi `sheetId: 0` / `startIndex: 0`, nên `.default(0)` của `SpreadsheetInfoResponse` / `MetadataSearchResponse` chưa bao giờ chạy | gap | patch | `google-fake/server.ts:680,702` ghi rõ cả số 0; Google bỏ trường mang giá trị mặc định (chú thích ở `google-client.ts:149`). Bỏ `.default(0)` thì không test nào đỏ. |
| 3 | VG | Nhánh retry của lần đẩy đầu thêm cột câu hỏi mới (`sheet-sync-jobs.ts:291-306`) chưa có test | gap | patch | Grep `appendColumns` trong test rỗng; xóa `positions.set` ở :304 thì lần chạy vẫn `synced` và không test nào đỏ. |
| 4 | VG | 403 dạng `ErrorInfo` lý do `RATE_LIMIT_EXCEEDED` → `rate_limited` chưa có test | gap | patch | `sheetsForbidden` chỉ dựng dạng `errors[].reason`; bỏ `RATE_LIMIT_EXCEEDED` khỏi tập thì 403 đó thành `auth_revoked` mà không test nào đỏ. |
| 5 | VG | Tên test nói kiểm `ready()` trước `tx` của refund nhưng không quan sát được | low | patch | `sheet-row-changed.test.ts:150`: queue đã có từ lúc harness khởi động và bước reject trước đó đã `ready()`. Sửa tên test; kiểm thật cần hook làm hỏng tạo queue lúc khởi động, không có tiền lệ trong repo. |
| 6 | BH | Mọi 404 của Sheets API thành `not_found` → tạo lại Sheet, không giới hạn, có thể lặp | low | reject | Không lặp: lần đẩy đầu gặp 404 thì `recordGoogleFailure` → `retrying` → dead-letter, không tạo lại, nên tối đa thêm một Sheet. Với Google thật, 404 ở endpoint theo spreadsheet nghĩa là spreadsheet không còn. Fake trả 404 cho endpoint chưa làm chỉ ảnh hưởng dev. |
| 7 | BH | Lần đẩy đầu retry gặp spreadsheet có metadata Tickee mà mất cột Mã Đơn thì gắn lại tiêu đề và metadata tại chỗ ở A…, nên hai mã cột có thể trùng một cột | medium | patch | `sheet-sync-jobs.ts:280` chỉ xét `tagged.has(ORDER_CODE)`; metadata cũ đã dời theo cột vẫn còn, `columnPositions` không chặn hai mã cùng chỉ số, tên người mua có thể đè cột Mã Đơn và mọi lượt sau thêm trùng. Lệch Quyết định 2 (mất cột Mã Đơn → Sheet mới). Sửa nhỏ: nhánh này tạo Sheet mới như khi mất tab. |
| 8 | BH | `markSynced` commit rồi `scheduleFlushIfDirty` chạy riêng; lỗi giữa hai bước → retry trả `already_active`, dòng bẩn không được hẹn flush | low | patch | `sheet-sync-jobs.ts:225,326`. Sửa trực tiếp: nhánh `already_active` có `last_synced_at` thì gọi `scheduleFlushIfDirty`. |
| 9 | BH | Lần đẩy đầu vào dead-letter (kể cả sau khi tự tạo lại Sheet) thì kết nối kẹt, không gì phục hồi | false | reject | Requeue từ `/admin` và cảnh báo `DEAD_LETTER` là đường phục hồi theo AD-12 và Story 6.4. |
| 10 | BH | `answerColumnsOf` không lọc trạng thái: câu chỉ Đơn `pending`/`expired` trả lời cũng thành cột, kèm đánh dấu lại mọi Đơn | low | reject | Có từ 6.3/6.4 (lần đẩy đầu cũng vậy). Hậu quả: một cột trống tới khi Đơn đó thanh toán, và một lượt điền lại. Sửa phải đổi read model của `ordering`. |
| 11 | BH | Điền lại hơn 500 dòng (cột vừa thêm) đẩy thay đổi mới ra sau nhiều cửa sổ: `dirtyRowsOf` đọc cũ trước, `bump` đặt `marked_at = now()` | medium | patch | `sheet-connection-store.ts` (`dirtyRowsOf` `ORDER BY marked_at ASC`). Sự kiện 5.000 Đơn thêm câu hỏi giữa đợt bán → khoảng 10 cửa sổ, quá 1 phút. Sửa một dòng: đọc mới nhất trước. |
| 12 | BH | `markDirty` mọi Đơn vượt giới hạn 65.535 tham số khi hơn khoảng 32 nghìn Đơn | low | reject | Ngoài quy mô (Sự kiện CLB vài nghìn Đơn); sửa phải viết lại câu insert. |
| 13 | BH | Policy `singleton` mất âm thầm nếu queue flush đã có với policy khác | low | reject | Queue mới; mọi môi trường tạo lần đầu với policy. Kiểm lúc khởi động là guard cho trạng thái chưa thấy xảy ra. |
| 14 | BH | Không có metric production cho độ trễ tới Sheet | low | reject | Intent chỉ đòi đo bằng test với Google fake; dead-letter đã có cảnh báo vận hành. Metric mới là bề mặt mới. |
| 15 | BH | Mỗi lượt flush gọi Google nhiều hơn ước tính, chưa tính quota; lượt mà mọi Đơn bị bỏ qua vẫn gọi Google | low | reject | Mỗi lượt có 3 đọc + 1 ghi Sheets API (làm mới token không tính quota Sheets), khớp ước tính 3–4. Lượt mà mọi Đơn ngoài bốn trạng thái gần như không có, vì chỉ bốn trạng thái đó kích hoạt. |
| 16 | BH | Mọi check-in giờ phụ thuộc pg-boss (`ready()` và insert trong `tx`) | low | reject | AC 6.5 và AD-12 đòi enqueue trong cùng `tx` của `checkIn`. pg-boss dùng cùng Postgres nên hỏng cùng lúc với DB; bỏ enqueue khi chưa sẵn sàng thì mất đồng bộ. |
| 17 | BH | Đường ghép và Đối soát bù vào `pay()` chưa có test enqueue | low | reject | Cả hai đi qua `pay()`, một chỗ enqueue duy nhất, đã kiểm qua Đơn 0đ, IPN và duyệt tay. |
| 18 | BH | Tên test "hay của BTC/Sự kiện khác" nhưng chỉ seed Sự kiện khác cùng BTC | low | patch | `sheet-flush.test.ts:244`. Sửa tên test cho đúng điều nó kiểm. |
| 19 | BH | Chưa có unit test `httpFailure`: `ErrorInfo` `RATE_LIMIT_EXCEEDED`, 403 nhiều lý do, 404 ở token endpoint | low | patch | Phần `ErrorInfo` trùng #4. 403 nhiều lý do và 404 ở token endpoint là nhánh thẳng (`sheets = false` → `failed`): không thêm. |
| 20 | BH | Test dead-letter dùng job tự dựng `retryLimit: 0`, không phải job debounce thật 5 lần retry | low | reject | Test kiểm đúng việc nối dead-letter của queue; chạy đủ 5 lần retry thật mất hơn 10 phút. |
| 21 | BH | Test I/O Matrix của Cần xử lý đổi trạng thái bằng SQL rồi `mark` tay | low | reject | Đường lệnh thật → job đã kiểm ở `sheet-row-changed.test.ts`; flush kiểm riêng. |
| 22 | BH | Spreadsheet trong thùng rác có thể vẫn được Sheets API phục vụ (không 404), nên không tạo lại và Tickee ghi vào Sheet trong thùng rác; dạng phản hồi `developerMetadata:search` và `appendDimension` + `createDeveloperMetadata` trong một lô chỉ kiểm với fake | maybe-false | defer | Cần phản hồi thật của Google (AC 3, kiểm thủ công). Nếu đúng thì medium. |
| 23 | EC | BTC thêm cột giữa lúc đọc lưới và `appendColumns` → tiêu đề và metadata rơi vào cột của BTC | low | reject | Cửa sổ dưới một giây; sửa phải đổi kiểu request và fake. |
| 24 | EC | BTC sắp xếp, chèn hay xóa dòng giữa `readColumn` và `writeCells` → ghi vào dòng của Đơn khác | low | reject | Cửa sổ vài trăm mili giây; Sheets API không có khóa; sửa phải đọc lại và kiểm sau khi ghi. |
| 25 | EC | Hàng tiêu đề bị xóa hay di chuyển, dòng 0 chứa một Mã Đơn → Đơn đó không khớp, bị thêm trùng | low | patch | `sheet-flush-jobs.ts:210` bỏ qua dòng 0. Chỉ thêm trùng một lần (lần sau khớp dòng trùng). Sửa bằng cách xóa vế `row === 0`: tiêu đề "Mã Đơn" không bao giờ là mã `TK…`. |
| 26 | EC | Lỗi giữa `markSynced` và hẹn flush làm dòng bẩn bị bỏ lại | low | patch | Trùng #8. |
| 27 | EC | `markDirty` vượt giới hạn tham số Postgres | low | reject | Trùng #12. |
| 28 | EC | Điền lại hơn 500 dòng làm thay đổi mới chờ nhiều cửa sổ | medium | patch | Trùng #11. |
| 29 | EC | Queue flush có sẵn mà không có policy `singleton` | low | reject | Trùng #13. |
| 30 | EC | `ready()` lỗi làm check-in ở cổng lỗi | low | reject | Trùng #16. |
| 31 | EC | Hai mã cột Tickee cùng một cột khi lần đẩy đầu gắn lại metadata | medium | patch | Trùng #7. |
| 32 | EC | `flushWindowSeconds` bằng 0, âm hay lẻ không bị chặn | low | reject | Chỉ có hằng 45 và test truyền 3; không caller nào truyền giá trị sai. |

## Design Notes

**Queue nằm ở `ticketing`:** có hai producer là `ordering` và `ticketing`, mà `ticketing` chỉ được gọi `event`. Định nghĩa queue ở `ticketing` thì `ordering` import qua `ticketing/index.ts` và `integration` cũng vậy, không phá hướng phụ thuộc. Đây là tiền lệ `RECONCILE_ORDER_QUEUE`: queue khai báo ở producer.

**Debounce + `singleton`:** handler luôn gọi `sendDebounced` sau khi đánh dấu. Khe hiện tại đã có job thì chèn vào khe kế, khe kế cũng có rồi thì job đó chưa chạy và sẽ đọc dòng bẩn mới. Nhờ vậy không thay đổi nào bị bỏ lại không có lượt flush. Policy `singleton` chặn hai lượt chạy song song (lượt retry và lượt của khe mới), nên không có chuyện hai lượt cùng thêm một Đơn vào cuối Sheet. Không cần lease trong DB.

**`version` thay vì xóa thẳng:** flush đọc `(order_id, version)`, ghi Google, rồi `DELETE … WHERE version = <đã đọc>`. Thay đổi đến giữa lượt làm `version` tăng, nên dòng bẩn còn lại cho lượt sau.

**Không dùng `values:append`:** Google tự đoán "bảng" để nối dòng, nên có thể ghi lệch khi BTC có dữ liệu ở cột khác bên dưới. Flush tự tính dòng đích từ cột Mã Đơn rồi ghi theo `gridRange`.

**Sheet từ 6.4:** chưa có người dùng thật trước Closed Beta, nên Sheet tạo ở 6.4 (không có metadata) được thay bằng Sheet mới ở lượt flush đầu (Quyết định 2) thay vì viết code gắn metadata ngược.

**`W` = 45 giây:** thay đổi đầu tiên trong một cửa sổ lên Sheet sau vài giây; thay đổi sau đó chờ tới cửa sổ kế, chậm tối đa 45 giây cộng vài giây xử lý. Mỗi lượt flush khoảng 3–4 request, nên khoảng 1,3 lượt mỗi phút cho mỗi Sự kiện vẫn trong quota Google.

**Đo P95:** chờ cửa sổ 60 giây thật thì test chậm và dễ chập chờn. Test rút ngắn `W` để kiểm cơ chế "độ trễ ≤ `W` + thời gian xử lý" bằng worker và Google fake thật. Khi chạy thật, độ trễ ≤ `W` + vài giây.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: 0 lỗi
- `pnpm lint:deps` -- expected: 0 vi phạm
- `pnpm test` -- expected: xanh, gồm ba file test mới, test `queue.ts`, `google-client`, contracts, và các test ordering/payment/checkin hiện có
- `pnpm test:e2e` -- expected: xanh trên `ios-webkit` và `android-chromium` (không có màn mới; kiểm hồi quy check-in và Cần xử lý)

**Manual checks (if no CLI):**
- Như AC thứ ba: dev stack, OAuth client Google thật, Sự kiện có Đơn thật.
