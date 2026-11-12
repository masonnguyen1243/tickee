---
title: 'E3-7 (E2 + E3): tách orders.service.ts, gom đồng hồ DB, chuyển releaseOrderHeld sang inventory.service.ts'
type: 'refactor'
created: '2026-11-12'
status: 'done'
route: 'dispatch'
baseline_commit: '263d0c4acfb4f6d62a03337cb069e90811547981'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** (E3) `ordering/orders.service.ts` dài 588 dòng, gánh ít nhất 6 trách nhiệm: form checkout, điều phối tạo Đơn, TX1, tra Đơn của Người mua, dựng `BuyerOrderView`, thử lại link. Epic 4 (Đối soát bù, duyệt tay) sẽ phải sửa file này. (E2) Đồng hồ DB đang bị chép ra 7 bản: `SELECT now()` nằm ở 6 file và `SELECT clock_timestamp()` nằm ở `mark-paid.ts`. (Review B6 #6) `releaseOrderHeld` đặt trong mô-đun job `order-jobs.ts`, còn `releaseHeld` vẫn được export, nên một đường code mới vẫn có thể tự nhả chỗ mà không qua hàm chung.

**Approach:** Tách TX1 và read model `BuyerOrderView` ra khỏi `orders.service.ts`, thành hai file hàm thuần trong `ordering`. Gom đồng hồ DB về `platform/db` (`dbNow`/`dbClock`). Chuyển `releaseOrderHeld` vào `inventory.service.ts` và thôi export `releaseHeld`. Không đổi hành vi, API, schema hay cách nối DI.

## Boundaries & Constraints

**Always:**
- Đây là refactor thuần. Các thứ sau phải giữ nguyên:
  - hợp đồng HTTP và mã lỗi;
  - thứ tự khóa (Sự kiện, rồi tồn kho theo `ticket_type_id`);
  - TX1 không `NOTIFY` và không gọi Tingee;
  - mốc thời gian ở từng chỗ: `now()` hay `clock_timestamp()`.
- Không tạo vòng import. Luật `no-circular` của depcruise tính cả import type.
- Tên trong API công khai `ordering/index.ts` giữ nguyên.
- Doc comment chuyển đi nguyên văn, chỉ sửa câu nào nói sai chỗ đặt.

**Never:**
- Không tách `mark-paid.ts`, `order-jobs.ts`, `contracts/order.ts`, `purchase.spec.ts`. Ở các file này chỉ sửa import, đồng hồ và `releaseOrderHeld`.
- Không đổi các `sql\`now()\`` viết nội tuyến trong câu SQL, cũng không đổi `new Date()` của `serverNow` trong `view`.
- Không thêm provider Nest, không sửa `ordering.module.ts`.
- Không gom helper lỗi unique của `event` hay `organizer`.
- Không làm `buyerScope` (AD-13, retro E4) trong PR này. Lý do: helper chỉ đặt tên cho `eq(user_id)`, mỗi truy vấn vẫn phải tự nhớ gọi, còn lưới an toàn thật là test cách ly hai Người mua. Mục này được ghi hoãn vào `deferred-work.md` (Mason quyết ngày 12/11/2026).

**Quyết định (12/11/2026):** Giữ cả ba việc trong một spec và một PR, dù spec dài khoảng 2.400 token (Mason chọn).

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/ordering/orders.service.ts`. Phần **ở lại**: `ORDER_HOLD`, `OrdersService` (checkoutForm, create, mine, liveOrderId, retryPaymentLink, ownOrder, withPaymentLink, reload, byKey, expireStalePending, pendingOf), `idempotencyKeyOf`, `orderNotFound`, `pendingExists`, `IDEMPOTENCY_KEY`, `ONE_PENDING_KEY`. Phần **đi ra**:
  - TX1 (`placeOrder`, `insertOrder`, `assertFreeTicketLimit`, `assertOnSale`, `soldOut`, `notOnSale`, `freeTicketLimitReached`, `CODE_KEY`, `uniqueViolation`, `PlacedOrder`, `Buyer`) sang `place-order.ts`;
  - `view`, `paymentOf` sang `order-view.ts`. Tham số `db` của `view` chưa ai truyền, được giữ lại.
- `ordering/orders.controller.ts:5`: dòng `import { OrdersService, type Buyer }`.
- `ordering/index.ts:31`: dòng `export { ORDER_HOLD } from './orders.service.js'`, giữ nguyên.
- `ordering/order-jobs.ts`: `releaseOrderHeld` ở dòng 122-134, dòng 10 import `releaseHeld`.
- `ordering/inventory.service.ts`: `releaseHeld` ở dòng 157-168. File đã import sẵn `asc`, `eq`, `orderItems`.
- `ordering/payment-link.ts:18` và `ordering/mark-paid.ts:13`: import `releaseOrderHeld` từ `order-jobs.js`.
- Đồng hồ DB, 7 chỗ:
  - Trả ms: `identity/totp-attempts.ts:33`, `identity/otp-rate-limit.ts:19`, `ordering/order-rate-limit.ts:25`.
  - Trả `Date`: `flows/event-update.flow.ts:22`.
  - Viết nội tuyến: `ordering/my-tickets.service.ts:71`, `organizer/payout-account.service.ts:559`.
  - `clock_timestamp()`: `ordering/mark-paid.ts:74` (`dbClock`).
- `apps/api/src/platform/db/index.ts`: barrel của `platform/db`.
- `apps/api/test/db.test.ts`: test `platform/db` chạy trên Postgres thật.
- Test bảo vệ:
  - `test/ordering/*`: orders, các bộ concurrency, payment-link, ipn, order-expiry, order-live, my-tickets;
  - `test/identity/*`;
  - `test/organizer/payout-account.test.ts`;
  - `test/event/event-change-email.test.ts`;
  - `test/dependency-rules.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/platform/db/clock.ts` (mới) và `platform/db/index.ts`. Thêm `dbNow(db: DbExecutor): Promise<Date>` (`SELECT now()`, mốc đầu transaction) và `dbClock(db)` (`SELECT clock_timestamp()`, giờ lúc gọi). Doc ghi rõ khi nào dùng hàm nào.
- [x] 7 chỗ đồng hồ nêu trong Code Map. Thay bằng `dbNow`/`dbClock` và xóa hàm cục bộ. Chỗ cần ms thì dùng `.getTime()`.
- [x] `ordering/inventory.service.ts`. Nhận `releaseOrderHeld` (giữ doc về luật chung), `releaseHeld` thành hàm nội bộ.
- [x] `ordering/order-jobs.ts`, `payment-link.ts`, `mark-paid.ts`. Import `releaseOrderHeld` từ `inventory.service.js`, bỏ import thừa.
- [x] `ordering/place-order.ts` (mới). Viết `placeOrder(tx, deps, buyer, slug, key, body)`, trong đó `deps = { boss, orderCode, holdSeconds, payments }` do `OrdersService` truyền vào, kèm các hàm phụ và lỗi chỉ TX1 dùng. Export `Buyer`, `PlacedOrder`, `uniqueViolation`.
- [x] `ordering/order-view.ts` (mới). Viết `buyerOrderView(db, tickets, row)` và `paymentOf`. Giữ nguyên thứ tự đọc: Vé chỉ đọc sau khi đã đọc Sự kiện, và chỉ khi `eventOpenForTickets`.
- [x] `ordering/orders.service.ts` và `orders.controller.ts`. Gọi sang hai file mới. Comment đầu file chỉ tới phần nào nằm ở đâu. Controller import `Buyer` từ `place-order.js`.
- [x] `test/db.test.ts`. Thêm test: trong một transaction, hai lần gọi `dbNow` trả cùng giá trị. `dbClock` không nhỏ hơn `dbNow`, và tăng giữa hai lần gọi khi có `pg_sleep(0.01)` ở giữa.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md`. Thêm mục hoãn `buyerScope`: hiện có 13 bộ lọc `user_id` viết tay trong `orders.service.ts`/`place-order.ts`, `my-tickets.service.ts`, `ticketing/my-tickets.ts`, `ticketing/tickets.service.ts`. Ghi lý do hoãn theo quyết định ở trên.

**Acceptance Criteria:**
- Given code sau refactor, when chạy test api, `typecheck` và `lint:deps`, then tất cả pass, và không test hiện có nào phải sửa ngoài đường import.
- Given `apps/api/src`, when grep `SELECT now()` hoặc `SELECT clock_timestamp()`, then chỉ còn trong `platform/db/clock.ts`.
- Given `apps/api/src`, when grep `releaseHeld(`, then chỉ thấy trong `inventory.service.ts`, và hàm này không được export.
- Given `orders.service.ts`, then file ≤ 340 dòng và chỉ còn phần điều phối request. Không file nào của `ordering` vượt 400 dòng.

## Implementation Notes

- `OrdersService` còn một hàm riêng `view(row)` ba dòng gọi `buyerOrderView(this.db.orm, this.tickets, row)`, để bốn chỗ gọi cũ giữ nguyên. Toàn bộ logic nằm ở `order-view.ts`; biến Vé đổi tên thành `ownTickets` để không che tham số `tickets`.
- `insertOrder` nhận `orderCode` làm tham số. `create` dựng `deps` từ các field đã inject, nên `ordering.module.ts` không đổi và test vẫn override `ORDER_HOLD`/`ORDER_CODE_GENERATOR` được.
- Chỗ cần ms gọi `(await dbNow(tx)).getTime()`. Doc của `dbClock` cũ ở `mark-paid.ts` thành comment tại chỗ gọi.
- Theo review: thêm `test/platform/db-clock-usage.test.ts` chặn `SELECT now()`/`SELECT clock_timestamp()` ngoài `clock.ts`; đoạn mô tả từng bước TX1 chuyển sang header `place-order.ts`; sửa doc `clock.ts` (lý do chọn từng hàm, trỏ tới `endedNow`); bỏ chữ "hàm thuần" ở hai file mới; `deferred-work.md` đóng B6 + C7.
- `sprint-status.yaml`: action item E3-7 → `done` (E3-9: đồng bộ trong PR).

## Spec Change Log

## Review Triage Log

Vòng 1 (12/11/2026). Ba lớp: Blind Hunter (BH), Edge Case Hunter (EC), Verification Gap (VG).

| # | Lớp | Phát hiện | Verdict | Bằng chứng | Route |
|---|-----|-----------|---------|------------|-------|
| 1 | VG | Không test nào ghim `markPaid` dùng `dbClock` (`clock_timestamp()`) thay cho `dbNow`. Đổi sang `dbNow` thì mọi test vẫn pass, vì không test nào cho IPN chờ khóa Sự kiện/Đơn rồi mới đọc đồng hồ | medium | Lớp VG đã kiểm sẵn: `mark-paid-ipn.test.ts`, `ipn.test.ts`, `ipn-edge.test.ts` đều đọc đồng hồ ngay sau khi bắt đầu transaction. Refactor chuyển đúng `dbClock` (`mark-paid.ts:256`), khoảng trống này có từ trước PR | defer |
| 2 | EC | Task trong spec ghi "13 bộ lọc `user_id`" trong 4 nhóm file, nhưng bộ lọc thứ 13 nằm ở `event-change-email-jobs.ts:144` | false | `deferred-work.md:15` liệt kê đủ 13, có cả `event-change-email-jobs.ts`, nên việc `buyerScope` sau này không bỏ sót. Muốn sửa câu chữ thì phải sửa spec của chính build này | reject |
| 3 | BH | Mục hoãn của review D3 (test giả `Date` cho `endedNow`, "nên làm cùng mục gom đồng hồ DB của E3-7") không được làm cũng không được hoãn lại | low | Đúng: `deferred-work.md:500-502` vẫn mở và gắn vào E3-7. `endedNow` là `now()` viết nội tuyến, mà intent loại trừ việc đổi chỗ đó | defer |
| 4 | BH | Mục "build E3-7, tách phạm vi" vẫn trông như còn 3 việc mở: B6 và C7 (đã ship ở PR #65) chưa có dòng "Đã xử lý" | low | Đúng: các dòng 487-492 không có dòng đóng, trong khi PR này đã thêm dòng "Đã xử lý" cho E2/E3 và B6 #6. Mục bị đóng lệch | patch |
| 5 | BH | Việc gom đồng hồ DB chưa phủ hết: `saleStatusOf(facts, new Date())` trong TX1, `serverNow` của `buyerOrderView`, `event-status.service.ts:110` vẫn dùng đồng hồ app | low | Đúng, nhưng các chỗ này có từ trước, và đổi sang đồng hồ DB là đổi hành vi, điều intent loại trừ (spec giữ `serverNow` có chủ đích). Lệch chỉ khi giờ app và giờ DB chênh nhau đúng lúc chạm mốc, khó xảy ra; sửa thì phải thêm truy vấn | reject |
| 6 | BH | Doc `clock.ts` cho hai câu trả lời cho "Sự kiện đã kết thúc chưa" (một ví dụ dưới `dbNow`, một dưới `dbClock`) và không nhắc `endedNow` | low | Đúng (`clock.ts:7-12`). Epic 4 (E3-2, 4.2) sẽ thêm kiểm "đã kết thúc" và đọc chính doc này | patch |
| 7 | BH | Không có gì chặn các bản `SELECT now()` chép tay quay lại; AC chỉ được kiểm bằng grep một lần | low | Đúng: 7 bản đã tích lại qua 3 epic. Sửa nhỏ: một test quét `src` giống `dependency-rules.test.ts` | patch |
| 8 | BH | Mô tả từng bước của TX1 nằm ở header `orders.service.ts`, còn code TX1 ở `place-order.ts`, nên sẽ lệch nhau khi Epic 4 sửa TX1 | low | Đúng (`orders.service.ts:38-44`). Header `place-order.ts` chỉ có 3 dòng | patch |
| 9 | BH | `Buyer` (dùng ở controller) đặt trong file TX1; đề xuất tách `buyer.ts` | low | Spec chỉ rõ `Buyer` → `place-order.ts` để tránh vòng import. Đây là import type, không gây lỗi chạy. Muốn đổi thì phải sửa spec | reject |
| 10 | BH | `uniqueViolation` export từ file TX1; tên constraint unique của `orders` nằm rải hai file | low | Spec chỉ rõ export `uniqueViolation` từ `place-order.ts`. Dời sang `platform/db` là tái cấu trúc thêm, vượt mức sửa trực tiếp, và không có lỗi cụ thể nào | reject |
| 11 | BH | `PlaceOrderDeps.payments` rộng hơn mức cần (`OrderPayments` thay vì `Pick<…,'markPaid'>`); `deps` dựng lại mỗi request | false | Không có hậu quả: `payments` là đúng instance provider đã inject, không test nào cần stub nó, còn một object literal mỗi request thì chi phí không đáng kể | reject |
| 12 | BH | Header `place-order.ts`/`order-view.ts` gọi hai file là "hàm thuần", trong khi `placeOrder` ghi DB, khóa, enqueue và `buyerOrderView` chạy truy vấn | low | Đúng: ở `sellability.ts:23,73`, "hàm thuần" nghĩa là không có side effect. Người đọc có thể hiểu sai | patch |
| 13 | BH | `OrderRow` định nghĩa 3 lần; thứ tự tham số `buyerOrderView(db, …, row)` và `paymentOf(row, db)` không đồng nhất | false | Cả 3 alias đều là `typeof orders.$inferSelect`, không thể lệch nhau. `paymentOf(row, db)` là chữ ký riêng có sẵn, chuyển nguyên văn theo spec | reject |
| 14 | BH | `order-view.ts` báo cùng một thông điệp lỗi cho thiếu BTC và thiếu người nhận tiền | low | Có từ trước, chuyển nguyên văn. Intent ghi "không đổi hành vi"; cả hai nhánh là bất biến không bao giờ xảy ra | reject |
| 15 | BH | Test đồng hồ yếu: Invalid Date/NaN vẫn lọt, không kiểm `dbNow` ngoài transaction, không kiểm trùng `created_at` | low | Vế NaN sai: `clock1 >= now1` và `clock2 > clock1` fail khi gặp NaN. Hai vế còn lại là đảm bảo sẵn của Postgres (`defaultNow()`), khó gặp lỗi, mà muốn kiểm thì phải thêm ca test | reject |

## Design Notes

Tách bằng hàm thuần nhận `tx` và `deps`, không tạo provider mới. Cách này theo đúng kiểu đang có (`expireOrder(db, …)`, `markExpired(tx, …)`), DI giữ nguyên, nên test vẫn override được `ORDER_HOLD`/`ORDER_CODE_GENERATOR` qua `OrdersService`. `Buyer` chuyển sang `place-order.ts` vì `orders.service.ts` sẽ import file này; nếu `Buyer` ở lại `orders.service.ts` thì import type ngược chiều tạo vòng, và depcruise sẽ chặn.

## Verification

**Commands:**
- `pnpm --filter @tickee/api exec vitest run` -- expected: pass toàn bộ, gồm cả test đồng hồ mới. Kết quả sau review: pass (64 file, 992 test)
- `pnpm typecheck && pnpm lint:deps` -- expected: pass. Kết quả: pass (api 228 module, 0 vi phạm)
- `grep -rnE "SELECT (now|clock_timestamp)\(\)" apps/api/src` -- expected: chỉ `platform/db/clock.ts`. Kết quả: đúng
- `wc -l apps/api/src/modules/ordering/*.ts` -- expected: `orders.service.ts` ≤ 340, không file nào > 400. Kết quả: `orders.service.ts` 273, lớn nhất `mark-paid.ts` 358
