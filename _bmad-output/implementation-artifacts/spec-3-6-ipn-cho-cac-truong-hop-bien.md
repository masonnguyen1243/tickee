---
title: 'Story 3.6: IPN cho các trường hợp biên'
type: 'feature'
created: '2026-11-11'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '958f9f39987c188e7956081c761eaed6a2938d1f'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sau 3.5, IPN `success` không khớp Đơn (lệch tiền, Sự kiện hủy, đã kết thúc, Đơn không còn chờ, Đơn của BTC khác, mã không có) chỉ được lưu `payment_events` và log warn. Tiền đã về tài khoản BTC mà không ai được báo. Ngoài ra Đơn `expired` nhận tiền muộn chưa được bán lại khi còn chỗ (FR-14).

**Approach:** Thêm bảng `review_items` của `payment`. Đưa toàn bộ thứ tự kiểm 3–7 của AD-7 vào `ordering.markPaid` nguồn `ipn`, chạy dưới khóa Sự kiện và khóa Đơn. `markPaid` tự chuyển Đơn sang `review` khi cần, rồi trả kết quả. `IpnProcessor` tạo đúng một `review_item` cho mỗi khoản tiền không thành Vé, trong cùng transaction.

## Boundaries & Constraints

**Always:**
- **Thứ tự kiểm cho IPN `success`** (Đối soát bù 4.1 dùng lại). Dừng ở nhánh đầu tiên khớp:
  1. Mã sai `ORDER_CODE_PATTERN` → chỉ lưu, không tạo mục. Mã đúng dạng mà không có Đơn → `unmatched`.
  2. Đơn thuộc BTC khác → `unmatched`. Không gắn Đơn, không đổi Đơn của BTC kia.
  3. Sự kiện đã hủy → `event_cancelled`.
  4. Đơn đang `paid`/`cancelled`/`refunded`/`review` → `duplicate_payment`.
  5. `paidAmount ≠ total_amount` → `amount_mismatch`.
  6. Tiền về muộn: Đơn `expired`, hoặc đồng hồ DB đã quá `effective_end_at`.
  7. Đơn `pending` → phát Vé như 3.5.

  Bước 1–2 ở `payment`: chúng dùng dữ liệu không đổi của Đơn. Bước 3–7 nằm trong `markPaid`, sau khi khóa Sự kiện `FOR SHARE` và khóa Đơn `FOR NO KEY UPDATE` (thứ tự khóa và lý do giữ như 3.5).
- **Đơn chuyển sang `review`** (CAS trong `markPaid`; Đơn `pending` thì `held -= n`) khi Đơn đang `pending` hoặc `expired` và rơi vào bước 3, 5 hoặc 6 mà không bán được. Đơn ở trạng thái khác thì giữ nguyên trạng thái, chỉ tạo mục. Riêng Đơn `cancelled` của Sự kiện đã hủy thì giữ `cancelled`.
- **Tiền về muộn (bước 6), theo thứ tự:**
  - Quá `effective_end_at`, Đơn `pending` hay `expired` → `orphan`, lý do `event_ended`.
  - Đơn `expired` mà Sự kiện bị khóa (`locked_at`), hoặc `event.organizationLocked` trả `true` → `orphan`, lý do `event_locked`. Đơn `pending` của Sự kiện bị khóa vẫn đi bước 7.
  - Còn lại (Đơn `expired`): bán có điều kiện `sellInventory` trong savepoint, theo `ticket_type_id` tăng dần. Đủ chỗ → CAS `expired → paid` (`paid_source='ipn'`), phát Vé, audit, phễu như bước 7. Một Hạng vé thiếu chỗ → rollback savepoint (không bán dòng nào) → `orphan`, lý do `sold_out`, không phát Vé.
- **`review_items`** (mới, `payment` sở hữu):
  - Cột:
    - `organization_id` (BTC sở hữu `ipnKey`, NOT NULL; trùng BTC của Đơn khi có Đơn);
    - `order_id` (null đúng khi loại `unmatched`);
    - `payment_event_id` (NOT NULL, UNIQUE: một khoản tiền một mục);
    - `type` (`amount_mismatch`/`orphan`/`event_cancelled`/`duplicate_payment`/`unmatched`);
    - `reason` (chỉ `orphan`, bắt buộc: `event_ended`/`event_locked`/`sold_out`);
    - `status` (`open`/`resolved`, mặc định `open`);
    - `resolution` (`approved`/`rejected`/`refunded`/`dismissed`, có đúng khi `resolved`; `duplicate_payment`/`unmatched` chỉ `refunded`/`dismissed`);
    - `created_at`.
  - Ràng buộc bằng CHECK. Thêm unique một phần `(order_id, type) WHERE status = 'open' AND type IN ('amount_mismatch','orphan')`.
  - `tickee_app` chỉ UPDATE được `status`, `resolution`.
- **`unmatched`** (bước 1 không có Đơn, bước 2): log `error` có trường `alert: 'payment_unmatched'`. Đây là cảnh báo vận hành cho tới khi Story 4.6 nối kênh. Mọi nhánh tạo mục còn lại log warn kèm tên nhánh và loại mục.
- Mọi nhánh trên trả 200 `{"code":"00","message":"Success"}`. Lưu event, đổi Đơn, đổi tồn kho, tạo mục: cùng một transaction. Lỗi DB → rollback cả gói, Tingee gửi lại.
- Bất biến sau mọi nhánh: `sold + held ≤ capacity`; `held` mỗi Hạng vé = tổng Vé của các Đơn `pending`; mỗi Đơn 0 hoặc đủ N Vé.
- **Quyết định của Mason (11/11):**
  - **Email báo Người mua khi `orphan`/`sold_out` để 3.8.** 3.6 chỉ tạo mục `orphan`, không thêm hàng đợi hay mẫu email. Ghi `deferred-work.md` để 3.8 thêm email này khi dựng hàng đợi email Người mua. Đây là điểm lệch có chủ đích so với câu "enqueue email báo Người mua" trong AC 3.6 của epics.
  - **Giữ spec đầy đủ** dù vượt ngưỡng 1.600 token (khoảng 5.000): một mục tiêu xuyên lớp, thứ tự kiểm 7 nhánh phải nằm chung một chỗ.

**Never:**
- Không làm việc của story khác: hàng Cần xử lý và giao diện (4.3); duyệt/từ chối/đánh dấu đã hoàn (4.4); Đối soát bù (4.1); `orders.cancel_reason`, hủy Sự kiện (7.1); khóa Sự kiện/BTC (7.4); kênh cảnh báo thật (4.6); `buyerStatus` trên web (3.7). Web không đổi: Đơn `review` đang hiện "Đơn của bạn đang được xử lý.".
- Không tạo mục cho IPN trạng thái (`expired`/`canceled`/lạ), IPN lặp, hay mã sai định dạng.
- Không phát Vé ngoài `markPaid`. Không phát một phần Vé của Đơn.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Lệch tiền | `pending` hoặc `expired`, `paidAmount ≠ total` | Đơn `review`; `pending` thì `held -= n`; mục `amount_mismatch`; 0 Vé | log warn |
| Tiền về muộn còn chỗ | `expired`, chưa kết thúc, không khóa, đủ chỗ mọi hạng | Đơn `paid`, `sold += n`, N Vé, không mục | — |
| Tiền về muộn thiếu một hạng | `expired`, 2 Hạng vé, hạng thứ hai hết chỗ | Không hạng nào đổi `sold`; Đơn `review`; mục `orphan`/`sold_out` | log warn |
| Đã kết thúc | `pending` hoặc `expired`, quá `effective_end_at`, đúng tiền | Đơn `review` (nhả `held` nếu `pending`); mục `orphan`/`event_ended` | log warn |
| Sự kiện bị khóa | `locked_at` có giá trị, đúng tiền, chưa kết thúc | Đơn `expired` → `review` + mục `orphan`/`event_locked`; Đơn `pending` → `paid` + N Vé, không mục | log warn (nhánh `orphan`) |
| Sự kiện đã hủy | `status = cancelled`, Đơn ở mọi trạng thái | `pending`/`expired` → `review` (nhả `held` nếu `pending`) + mục `event_cancelled`; `paid`/`review`/`cancelled` → giữ trạng thái + mục `event_cancelled`; khoản trả thứ hai cho cùng Đơn → thêm một mục `event_cancelled` | log warn |
| Trả trùng | Đơn `paid`, hai IPN `success` khác mã | Hai mục `duplicate_payment`; Đơn, Vé không đổi | log warn |
| Đơn `review` nhận thêm tiền | Đơn `review` (lệch tiền), IPN đúng tiền | Mục `duplicate_payment`; vẫn `review`; mục cũ giữ `open` | log warn |
| Mã không có | Đúng `ORDER_CODE_PATTERN`, không có Đơn | Mục `unmatched`, `order_id` null, BTC của `ipnKey` | log error `alert` |
| Đơn BTC khác | Đơn của BTC B, IPN vào URL BTC A | Mục `unmatched` của A, `order_id` null; Đơn B không đổi | log error `alert` |
| Mã sai định dạng | `orderId` ngoài Tickee | Chỉ lưu event, không mục | log info |
| Đồng thời | 10 IPN `success` khác mã cho một Đơn `pending` | Đúng N Vé; 9 mục `duplicate_payment` | — |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/ordering/mark-paid.ts:82-172` -- `markPaid`. Nhánh `ipn` hiện khóa Sự kiện → khóa Đơn → `lost_race` khi không `pending` → hủy/lệch/kết thúc (không đổi DB) → CAS `pending→paid` → `settleHeld` → `issueTickets` → audit → phễu. Sửa:
  - Kiểm hủy Sự kiện trước kiểm trạng thái Đơn.
  - Nhận Đơn `expired` (bán có điều kiện, CAS `expired→paid`).
  - Tự chuyển `review`.
  - Kết quả đủ để `payment` chọn loại và lý do mục: `orphan` cần phân biệt `event_ended`/`event_locked`/`sold_out`.
  - Nhánh `free` giữ nguyên.
- `apps/api/src/modules/ordering/inventory.service.ts` -- `sellInventory:140` trả `ticketTypeId` đầu tiên thiếu chỗ và **không** hoàn các dòng đã bán, nên phải bọc savepoint. Mẫu savepoint `tx.transaction(async (sp) => …)` ở `orders.service.ts:424`. `releaseHeld:161`, `settleHeld:175`.
- `apps/api/src/modules/ordering/order-jobs.ts:118` -- `releaseOrderHeld` (đọc dòng Đơn rồi `releaseHeld`). Dùng lại cho `pending → review`.
- `apps/api/src/modules/event/index.ts:20` -- `organizationLocked(db, {organizationId})`; hiện luôn `false`, Epic 7 thay thân hàm. `lockEventByIdForShare` trả `status`, `lockedAt`, `effectiveEndAt`, `organizationId` (`event/public-event.ts:40-52,101`).
- `apps/api/src/modules/payment/ipn-processor.ts`:
  - `settlePayment:198`: bỏ nhánh `order_not_pending`, mọi Đơn của chính BTC đi `markPaid`.
  - `IpnBranch:101`, `WARN_BRANCHES:120`.
  - Tạo `review_item` theo nhánh trong `tx` ở `process:151`, có `saved.id` làm `payment_event_id`.
  - Log `alert` cho `unmatched`.
- `apps/api/src/modules/payment/schema.ts` -- thêm `reviewItems` cạnh `paymentEvents`, theo cùng mẫu CHECK và unique một phần. Migration `drizzle/0020_review_items.sql` sinh bằng `pnpm --filter api db:generate` (sửa tay phần chú thích nếu cần; có journal và snapshot).
- `apps/api/src/platform/db/grants.ts:28` -- `UPDATE_PROTECTED_COLUMNS` thêm `review_items`: chỉ chừa `status`, `resolution`.
- `packages/contracts` -- chưa có enum loại hay lý do mục. Thêm hằng `REVIEW_ITEM_TYPES`/`REVIEW_ITEM_REASONS`/`REVIEW_ITEM_STATUSES`/`REVIEW_ITEM_RESOLUTIONS` (web 4.3 sẽ dùng), theo mẫu `ORDER_STATUSES`.
- Test:
  - `apps/api/test/payment/{ipn,ipn-concurrency}.test.ts`, `ipn-fixtures.ts` (`postIpn`, `paymentEventsOf`, `orderState`, `expectInvariants`).
  - `test/ordering/mark-paid-ipn.test.ts` (`pendingOrder`, `ipnPaid`).
  - `order-fixtures.ts` (`paidReadyOrg`, `eventOnSale`, `inventory`, `orderRow`).
  - Fake: `test/tingee-fake/server.ts` (`fakeIpnPayload`, `signIpn`).
  - Hủy, khóa, kết thúc Sự kiện bằng SQL như `ipn.test.ts:575-592`. Hết hạn Đơn bằng `markExpired` hoặc IPN `expired`.
  - Các test 3.5 đang khẳng định "chỉ lưu" cho nhánh 3.6 phải đổi theo Matrix.
- `_bmad-output/planning-artifacts/architecture/architecture-tickee-2026-10-28/ARCHITECTURE-SPINE.md`:
  - AD-1 `orphan` (:82): thêm "đã kết thúc / bị khóa".
  - AD-3 (:105-126): `pending→review` khi đã kết thúc; `cancelled` giữ nguyên khi nhận tiền.
  - AD-7 (:152-160): `expired` đi nhánh tiền về muộn; `duplicate_payment` gồm `review`; Tài khoản lệch tạo `unmatched`.
  - AD-28 (:318): Đơn `cancelled` giữ nguyên.
  - Định nghĩa `review_items` (:164): `reason`, `payment_event_id`, quy tắc unique.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/` (file `payment.ts` mới hoặc `order.ts`) + `index.ts` -- hằng và kiểu của `review_items` -- dùng chung API/web.
- [x] `apps/api/src/modules/payment/schema.ts`, `drizzle/0020_review_items.sql` (+ meta), `platform/db/grants.ts` -- bảng `review_items` với CHECK, unique và quyền cột như Boundaries.
- [x] `apps/api/src/modules/ordering/{mark-paid,order-jobs,index}.ts` -- thứ tự kiểm 3–7 dưới khóa, chuyển `review`, tiền về muộn cho Đơn `expired` (savepoint), kết quả kèm lý do `orphan`.
- [x] `apps/api/src/modules/payment/{ipn-processor,index}.ts` -- ánh xạ nhánh → mục, insert `review_items` trong `tx`, log `alert` cho `unmatched`, bỏ `order_not_pending`.
- [x] `apps/api/test/payment/ipn-edge.test.ts` (mới), cập nhật `ipn.test.ts`, `ipn-concurrency.test.ts`, `test/ordering/mark-paid-ipn.test.ts` -- mọi dòng Matrix qua HTTP với Tingee fake; bất biến tồn kho sau mỗi ca; CHECK/unique của `review_items` (insert sai bị từ chối); `tickee_app` không UPDATE được cột ngoài `status`/`resolution`.
- [x] `ARCHITECTURE-SPINE.md` -- cập nhật AD-1, AD-3, AD-7, AD-28, `review_items` như Code Map.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- hai mục: (1) cho 4.6, marker `alert: 'payment_unmatched'` cần nối kênh cảnh báo; (2) cho 3.8, email báo Người mua khi Đơn thành `orphan`/`sold_out` (theo quyết định của Mason).

**Acceptance Criteria:**
- Given bất kỳ IPN `success` hợp lệ nào không phát Vé (trừ mã sai định dạng và IPN lặp), when xử lý xong, then có đúng một `review_items` gắn `payment_event_id` của nó, cùng `organization_id` với BTC của `ipnKey`.
- Given IPN lỗi giữa chừng sau khi Đơn đã chuyển `review`, when transaction rollback, then không còn event, mục, hay thay đổi Đơn/tồn kho; gửi lại cùng mã → xử lý đúng một lần.
- Given `pnpm test`, `pnpm typecheck`, `pnpm lint:deps`, when chạy, then pass; `payment` vẫn chỉ gọi `ordering`/`organizer`/`tingee` qua `index.ts`.

## Implementation Notes

- `markPaid` trả object `{ outcome }` (thêm `reason` khi `orphan`) thay cho chuỗi; `lost_race` chỉ còn ở nguồn `free`. Nhánh `ipn` nằm trong `settleIpn`; CAS và phát Vé gom vào `pay` (dùng cho `pending → paid` và `expired → paid`). Bán lại Đơn `expired` dùng savepoint (`sellAllOrNothing`, ném `SoldOut` để rollback). `releaseOrderHeld` của `order-jobs.ts` được export cho `pending → review`.
- `IpnProcessor`: `order_not_found`/`other_organization` → mục `unmatched` + log `error` kèm `alert: 'payment_unmatched'` (`PAYMENT_UNMATCHED_ALERT`); kết quả `markPaid` → mục theo loại; `IpnOutcome` có thêm `reviewItem`. `lost_race` từ nguồn `ipn` không thể xảy ra (Đơn đã khóa) → ném để rollback thay vì im lặng.
- `review_items` có thêm index `(organization_id, status, created_at)` cho hàng Cần xử lý (4.3) và index `order_id`. Migration `0020_review_items.sql` sinh bằng `db:generate` rồi đổi tên; `0020_snapshot.json` đi kèm.
- Contracts: `packages/contracts/src/payment.ts` (`ReviewItemType`, `ReviewItemReason`, `ReviewItemStatus`, `ReviewItemResolution`, `REFUND_ONLY_REVIEW_ITEM_TYPES`, `reviewItemResolutionsFor`).
- Đổi hành vi so với 3.5: IPN `success` và `expired` tới cùng lúc (hay `markPaid` đua `markExpired`) giờ luôn kết thúc `paid`. Hết hạn thắng trước thì tiền về muộn bán lại khi còn chỗ (FR-14). Test 3.5 tương ứng đã đổi kỳ vọng.
- Chưa chặn ở DB: `review_items.organization_id` trùng BTC của Đơn (chỉ đảm bảo bằng code); `tickee_app` vẫn DELETE được `review_items` (spec chỉ giới hạn UPDATE).
- Kiểm chứng: `pnpm typecheck`, `pnpm lint:deps`, `pnpm test` pass (contracts 249, web 177, api 875; `ipn-edge` 16 test).
- Sau review vòng 1 (nhóm A–F trong Review Triage Log): docstring `markExpired` và dòng `expired → review` ở AD-2; AD-28 danh sách hoàn tiền gồm cả mục `event_cancelled` chưa xử lý (số tiền từ `payment_events`); `event_cancelled` chỉ kết thúc `refunded`/`dismissed` (CHECK, sửa thẳng migration 0020 và snapshot, contracts, test); `epic-3-context.md` khớp code; AD-1 chỉ nguồn `ipn`/`reconciliation` chạy bước 3–7, `manual` (4.4) cần đường riêng; comment bán lại Đơn `expired` trong `mark-paid.ts`. DB test cục bộ `tickee_test` đã được reset bảng `review_items` và dòng migration 0020 để áp lại file đã sửa; môi trường nào đã chạy bản 0020 cũ cần reset tương tự. Kiểm chứng lại: pass (contracts 249, web 177, api 875).

## Spec Change Log

## Review Triage Log

Vòng 1 (review_loop_iteration 0). Nguồn: BH = Blind Hunter, EC = Edge Case Hunter, VG = Verification Gap. VG không có phát hiện lỗ hổng kiểm chứng; dòng #1 là "Other findings" của VG.

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | VG | Docstring `markExpired` (`order-jobs.ts`) còn ghi "chạy song song với `markPaid` thì chỉ một bên thắng CAS, chỗ chỉ nhả hoặc chốt bán một lần" | low | Sai từ 3.6: `markExpired` thắng trước thì `markPaid` bán lại Đơn `expired` (nhả rồi bán lại). Test "markPaid và markExpired song song … Đơn luôn paid" khẳng định hành vi mới. Người làm 4.1 sẽ đọc câu này | patch (nhóm A) |
| 2 | EC | Bán lại Đơn `expired` bỏ qua Sự kiện Ẩn, Hạng vé đã đóng bán, điều kiện bán có phí | false | Khối frozen và AC 3.6 chỉ chặn bằng "đã kết thúc" và "bị khóa"; FR-14 "còn chỗ thì phát Vé". Người mua đã trả tiền khi còn bán | reject |
| 3 | EC | `markPaid` dùng `now > effective_end_at`, `sellability` dùng `<=` cho ENDED | low | Đúng chữ AC 3.6 (`now()` > `effective_end_at` là kết thúc, `≤` là chưa). Chỉ lệch khi trùng đúng mili giây; sửa thì lệch AC | reject |
| 4 | EC | Tiền về muộn xét theo đồng hồ DB lúc xử lý, không theo `paidAt` của Tingee | false | Khối frozen: "đồng hồ DB đã quá `effective_end_at`"; AC 3.6 dùng `now()`; 3.5 đã xét (#4, #38) | reject |
| 5 | EC | AD-28: danh sách hoàn tiền = "mọi Đơn có `paid_amount` > 0", nhưng tiền về Đơn của Sự kiện đã hủy (Đơn `review`/`cancelled`) không ghi `paid_amount` | medium | Spine:321 còn câu đó; `moveToReview` chỉ đổi `status`. Story 7.2 làm theo spine sẽ bỏ sót đúng các khoản AC 3.6 nói "luôn vào danh sách hoàn tiền" | patch (nhóm B) |
| 6 | EC | CHECK và `reviewItemResolutionsFor` cho `event_cancelled` kết thúc `approved` (phát Vé), điều không bao giờ xảy ra được với Sự kiện đã hủy | low | Sự kiện hủy không mở lại; `markPaid` luôn dừng ở bước 3. Helper contracts sẽ được web 4.3/4.4 dùng. Sửa trực tiếp: thêm `event_cancelled` vào nhóm chỉ `refunded`/`dismissed` | patch (nhóm C) |
| 7 | EC | `tickee_app` vẫn DELETE/TRUNCATE được `review_items` | low | Có thật; không code nào xóa. `orders`, `tickets` cũng giữ DELETE theo cùng mẫu. Sửa phải thêm loại quyền mới trong `grants.ts` | reject |
| 8 | EC | `ipn-edge` không gọi `expectInvariants` sau vài lần Đơn thành `paid` ở cuối ca | low | Đường `paid` đã được ghim bất biến ở `ipn.test.ts` (26 lần) và `mark-paid-ipn.test.ts` | reject |
| 9 | BH | (như #5) Danh sách hoàn tiền AD-28 bỏ sót tiền về Đơn `review`/`cancelled`, trả trùng Đơn `paid` | medium | Như #5 | patch (nhóm B) |
| 10 | BH | `epic-3-context.md` còn luật cũ: kết quả `markPaid` dạng chuỗi, "bên gọi tạo `review_item`", unique "mỗi Đơn tối đa một mục `open` mỗi loại, trừ `duplicate_payment`" | low | Có thật (dòng `markPaid` và `review_items`); 3.7–3.11 nạp file này | patch (nhóm D) |
| 11 | BH | AD-1 ghi "Nguồn có phí … chạy bước 3–7", nhưng duyệt tay 4.4 chạy trên Đơn `review` mà bước 4 trả `duplicate_payment` | low | Spine:82 gộp `manual` vào "nguồn có phí". `manual` hiện ném "chưa hỗ trợ" nên chưa có lỗi chạy; người làm 4.4 đọc spine sẽ hiểu sai. Phần Design Notes của spec: reject (sửa spec) | patch (nhóm E) |
| 12 | BH | Comment "Bán lại Đơn đã hết hạn … (như `sellability`)" nói quá: chỉ xét khóa | low | Hành vi đúng (xem #2) nhưng comment gợi ý ngang hàng với `sellability` | patch (nhóm F) |
| 13 | BH | DB không ràng `review_items.organization_id`/`order_id` với `payment_events`, không bắt event phải `kind = 'payment'` | low | Chỉ `IpnProcessor` chèn, và luôn từ event `payment` vừa lưu. Sửa cần khóa unique phụ + FK ghép | reject |
| 14 | BH | (như #7) DELETE trên `review_items` | low | Như #7 | reject |
| 15 | BH | `approved` được phép cho `event_cancelled` và `orphan`/`event_ended` | low | Phần `event_cancelled`: như #6. Phần `orphan`/`event_ended`: cần CHECK theo `reason`, thêm độ phức tạp; hành động duyệt do 4.4 định nghĩa | patch (nhóm C, phần `event_cancelled`); phần còn lại reject |
| 16 | BH | Tingee chỉ gửi lại 5 lần; 5xx kéo dài làm mất khoản tiền; unique một phần có thể bắn ra 5xx | false | Unique một phần không chạm được: `amount_mismatch`/`orphan` đưa Đơn vào `review`, không có chuyển ngược về `pending`/`expired`. `lost_race` dưới khóa Đơn không xảy ra. Các 5xx khác có từ 3.5 | reject |
| 17 | BH | `review_items` thiếu `updated_at`/`resolved_at` | low | Chưa có ai ghi `status`/`resolution` trước 4.4; 4.4 thêm cột xử lý cùng người xử lý | reject |
| 18 | BH | Thiếu test đồng thời cho bán lại Đơn `expired` (nhiều IPN, đua TX1, hai Đơn tranh chỗ cuối) | low | CHECK `sold + held ≤ capacity` chặn bán vượt kể cả khi có lỗi; thứ tự khóa Sự kiện → Đơn → tồn kho theo id giống TX1; nhiều IPN cùng Đơn tuần tự hóa bởi khóa Đơn (đã test với Đơn `pending`) | reject |
| 19 | BH | Người mua của `orphan`/`event_ended`/`event_locked`, `event_cancelled`, `amount_mismatch` không có email dự kiến | false | AC 3.6 chỉ đòi email cho `orphan` hết chỗ, đã dời sang 3.8 theo quyết định của Mason; các ca khác không có trong AC | reject |
| 20 | BH | Tài liệu chưa theo bán lại: docstring `markExpired` (như #1); bảng AD-2 thiếu dòng `expired → review` (không đổi tồn kho) | low | Có thật: AD-2 nói mọi chuyển trạng thái đều có phép tồn kho, mà bảng không có `expired → review` | patch (nhóm A) |
| 21 | BH | `sprint-status.yaml` ghi `in-progress` trong khi spec `in-review` | false | Bước trình bày (step 5) đồng bộ sprint-status sang `review` | reject |
| 22 | BH | `mark-paid.ts` import `releaseOrderHeld` từ mô-đun job pg-boss; `linesOf` lặp truy vấn `order_items` | low | Không có vòng import (`order-jobs.ts` không import `mark-paid.ts`); api và worker đều đã nạp mô-đun job. Lặp một truy vấn | reject |
| 23 | BH | Hằng contracts và CHECK SQL viết tay có thể lệch nhau mà không ai biết | low | Cùng mẫu với `ORDER_STATUSES`/`orders_status_check`; sửa phải thêm cơ chế sinh CHECK hay test đọc `pg_constraint` | reject |

## Design Notes

- **Bước 3–7 nằm trong `markPaid`, không nằm ở `payment`:** `ordering` sở hữu trạng thái Đơn và tồn kho. Kiểm dưới khóa Đơn tránh đúng lỗi #25 của 3.5 (bên thua đua nhận sai nhánh). 4.1/4.4 gọi `markPaid` là có cùng thứ tự kiểm.
- **`event_cancelled` một mục cho mỗi khoản tiền (lệch có chủ đích so với AC "tối đa một mục `open` mỗi loại, trừ `duplicate_payment`"):** bước 3 đứng trước bước 4, nên khoản trả thứ hai cho Đơn của Sự kiện đã hủy lại vào `event_cancelled`. Nếu unique theo `(order_id, type)` thì INSERT vỡ, cả transaction rollback, Tingee gửi lại mãi và khoản tiền im lặng. Unique `payment_event_id` cho mọi loại, cộng unique một phần chỉ cho `amount_mismatch`/`orphan` (hai loại đưa Đơn vào `review`, nên lần thứ hai đã thành `duplicate_payment`), giữ ý "mỗi khoản tiền một mục, BTC hoàn đủ từng khoản".
- **BTC bị khóa coi như Sự kiện bị khóa** với Đơn `expired`: bán lại Đơn hết hạn là một lần bán mới, `sellability` đã chặn bán khi BTC bị khóa. `organizationLocked` hiện luôn `false`.
- **Rủi ro còn lại (3.5 #26):** người giữ secret cũ bị lộ ký được IPN cho Đơn có link tạo bằng credential cũ. Từ 3.6 mỗi IPN như vậy thành một mục, hoặc đưa Đơn `pending` cũ vào `review`. Chấp nhận: cần secret cũ bị lộ, và chỉ chạm Đơn tạo trước lúc đổi key.

## Verification

**Commands:**
- `pnpm test` -- expected: pass (contracts, api với Postgres thật và Tingee fake, web).
- `pnpm typecheck && pnpm lint:deps` -- expected: pass.
