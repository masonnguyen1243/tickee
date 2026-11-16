---
title: 'Story 4.4-a: Duyệt tay, từ chối và đánh dấu đã hoàn tay'
type: 'feature'
created: '2026-11-16'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '51454d179676dcd3f02c55e0a6f32fa3f2ced2ae'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Hàng Cần xử lý (4.3) chỉ đọc. Owner/Admin thấy mục nhưng không làm được gì: khách đã trả tiền treo ở Đơn `review` (không Vé, không được báo hủy), còn tiền trùng hay tiền của Sự kiện đã hủy không có cách ghi nhận đã hoàn.

**Approach:** `payment` thêm bốn thao tác trên mục (`approve`, `reject`, `refund`, `dismiss`). Mỗi thao tác gọi hàm chuyển trạng thái của `ordering` (`markPaid` nguồn `manual` từ `review`, `review` → `cancelled` kèm `cancel_reason`, `cancelled` → `refunded`) trong một transaction có audit và tín hiệu realtime. Chi tiết mục trả danh sách thao tác được phép kèm lý do bị tắt. `Sheet` của 4.3 có nút, `Dialog`, toast; nhật ký thêm dòng thao tác.

## Boundaries & Constraints

**Always:**
- **Quyết định của Mason (16/11):**
  - Tách "Ghép với Đơn" (mục `unmatched`) sang 4.4-b, đã ghi `deferred-work.md`.
  - Sau "Từ chối", mục vẫn `open` và ở lại hàng (badge vẫn đếm) tới khi "Đã hoàn tay": khoản tiền khách đã trả luôn nằm trong phần (2) danh sách hoàn tiền của AD-28, read model của 4.3 không đổi. 4.4-a không ghi `resolution` `rejected` (lệch chữ epics, có chủ ý).
  - Giữ một spec cho cả 4 thao tác dù vượt chuẩn kích thước.
- Server tính thao tác được phép (`actions` trong chi tiết mục), web chỉ hiển thị:
  - mục `amount_mismatch`/`orphan` `open`, Đơn `review` → "Duyệt tay phát Vé", "Từ chối";
  - mục `amount_mismatch`/`orphan` `open`, Đơn `cancelled` (`rejected`) → "Đã hoàn tay";
  - mục `event_cancelled`/`duplicate_payment`/`unmatched` `open` → "Đã hoàn tay", "Bỏ qua";
  - mục `resolved`, hoặc Đơn ở trạng thái khác → không có thao tác.
- **Duyệt tay:** `markPaid(tx, orderId, 'manual', receivedAmount)` theo đường riêng (AD-1, không qua bước 3–7). Đơn `review` → `paid`, compare-and-set thêm `AND organization_id = :ctxOrg`, bán có điều kiện `+n` trong savepoint. Thắng thì phát Vé, email Vé, audit `order.paid` có người làm, `paid_amount` = số tiền nhận của mục; mục → `resolved` `approved`.
  - Sự kiện đã hủy, đã kết thúc (đồng hồ DB > `effective_end_at`) hoặc bị khóa: nút tắt, hiện lý do "Sự kiện đã hủy" / "Sự kiện đã kết thúc" / "Sự kiện đang bị khóa"; API từ chối.
  - Hết chỗ: Đơn giữ `review`, mục vẫn `open`, nhật ký có dòng "Duyệt tay không thành · Hết chỗ".
- **Từ chối:** đi qua `Dialog` nêu hậu quả. Đơn → `cancelled`, `cancel_reason` = `rejected`; mục vẫn `open`, `Sheet` giữ mở và chỉ còn "Đã hoàn tay". Người mua nhận email mới `order_rejected` (câu chính "BTC đã hủy Đơn này. Liên hệ BTC để được hoàn tiền nếu bạn đã chuyển.", kèm tên Sự kiện, mã Đơn, kênh liên hệ BTC, link Trang Đơn). Trang Đơn và Vé của tôi dùng `cancelled_by_organizer` sẵn có.
- **Đã hoàn tay** luôn đi qua `Dialog` xác nhận (không hoàn tác được):
  - mục `amount_mismatch`/`orphan` có Đơn `cancelled` (`rejected`): Đơn → `refunded`, mục → `refunded`;
  - mục refund-only: chỉ đóng mục (`refunded`); Đơn, Vé và doanh thu giữ nguyên.
- **Bỏ qua:** chỉ mục refund-only. Lý do bắt buộc, 1–300 ký tự sau trim, lưu ở mục, hiện trong nhật ký. Mục → `dismissed`.
- **Mọi POST:**
  - `Idempotency-Key` UUID bắt buộc (thiếu hoặc sai → `400 VALIDATION_FAILED`);
  - quyền `review_queue.handle`; mục lạ hoặc của BTC khác → `404 REVIEW_ITEM_NOT_FOUND`;
  - gửi lại đúng thao tác cho mục đã ở kết quả của thao tác đó → `200` trả trạng thái hiện tại, không làm lại; thao tác không được phép ở trạng thái hiện tại → `409 REVIEW_ACTION_NOT_ALLOWED`.
- Audit trong cùng transaction: `review_item.approve` | `approve_sold_out` | `reject` | `refund` | `dismiss` (target mục), cộng `order.rejected` / `order.refunded` khi Đơn đổi. Chỉ id và tên trường.
- Tín hiệu trong cùng transaction: Đơn đổi trạng thái → `order_changed` và `event_orders_changed`; mục đổi → `org_review_items_changed`; mục đóng mà Đơn không đổi → `event_orders_changed` của Sự kiện của Đơn (nếu có Đơn).
- Nhật ký `Sheet` thêm dòng thao tác từ audit, xếp theo thời gian, kèm tên người làm (tên thành viên; trống → "Thành viên BTC"). Dòng "Bỏ qua" kèm lý do.
- UX:
  - Nút gọi mạng hiện spinner, chặn bấm lặp. Nút tắt luôn có lý do hiện cạnh nút.
  - Toast: "Đã phát {n} Vé cho Đơn {mã}." / "Đã hủy Đơn {mã}. Hoàn tiền cho khách rồi bấm "Đã hoàn tay"." / "Đã ghi nhận hoàn tay {số tiền}." / "Đã bỏ qua mục."
  - Mục rời hàng thì `Sheet` đóng, focus về hàng kế tiếp, hết hàng thì về tiêu đề trang.
  - Thua cuộc đua (409) → toast info "Mục này vừa được xử lý." và tải lại hàng.

**Never:**
- Không làm Ghép với Đơn (4.4-b), danh sách hoàn tiền và hoàn tay hàng loạt (7.2), bỏ đánh dấu "Đã hoàn tay" (UX OQ #8 chưa chốt), hủy Sự kiện (7.1), tab Đơn (6.1).
- Không có `review` → `refunded`. Không có "Đã hoàn tay" hay "Bỏ qua" trên mục `amount_mismatch`/`orphan` khi Đơn còn `review`, và không có "Bỏ qua" cho Đơn đã từ chối.
- Không đổi bước 3–7 của IPN và Đối soát bù. Không đổi cách tính doanh thu Tổng quan.
- Không thêm bảng idempotency chung. Không ghi giá trị (số tiền, lý do, tên) vào audit.
- `payment` không import `event`; `reporting` không import `identity`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Duyệt tay còn chỗ | `amount_mismatch` `open`, nhận 250.000đ, Đơn 300.000đ `review`, 2 Vé | Đơn `paid`, `paid_amount` 250.000, 2 Vé, email Vé, mục `approved`, hàng rời, toast "Đã phát 2 Vé cho Đơn {mã}." | N/A |
| Duyệt tay hết chỗ | Hạng vé đã bán hết | Đơn `review`, mục `open`, nhật ký "Duyệt tay không thành · Hết chỗ" | `409 TICKET_TYPE_SOLD_OUT`, `Sheet` báo tại chỗ |
| Sự kiện không còn bán | đã hủy / đã kết thúc / bị khóa | Nút "Duyệt tay phát Vé" tắt kèm lý do | API `409 EVENT_CANCELLED` / `EVENT_ALREADY_ENDED` / `EVENT_LOCKED` |
| Từ chối | `orphan` `open`, Đơn `review` | Đơn `cancelled` (`rejected`), email `order_rejected`, Người mua thấy "Đã hủy" + liên hệ BTC; mục vẫn `open`, ở lại hàng | Bấm Hủy trong `Dialog` → không gọi API |
| Hoàn tay sau Từ chối | `orphan` `open`, Đơn `cancelled` (`rejected`) | Đơn `refunded`, mục `refunded`, hàng rời | N/A |
| Hoàn tay tiền trùng | `duplicate_payment` `open`, Đơn `paid` | Mục `refunded`; Đơn `paid`, Vé, doanh thu giữ nguyên | N/A |
| Bỏ qua thiếu lý do | `unmatched` `open`, lý do rỗng | Nút xác nhận tắt, `FieldError` | API `400 VALIDATION_FAILED` |
| Gửi lại | cùng thao tác, mục đã ở kết quả đó | `200` trạng thái hiện tại; không phát Vé, không gửi email lần 2 | N/A |
| Hai thành viên cùng lúc | A Duyệt, B Từ chối | Đúng một bên thắng | Bên thua `409 REVIEW_ACTION_NOT_ALLOWED` |
| Ngoài BTC | BTC khác hoặc CTV | Không đọc, không ghi | `403 NOT_A_MEMBER` |

</frozen-after-approval>

## Code Map

- `apps/api/drizzle/0025_*.sql` (sinh bằng `pnpm --filter @tickee/api db:generate`) -- thêm `orders.cancel_reason` (CHECK giá trị `rejected` | `event_cancelled`, có đúng khi `status` là `cancelled`/`refunded`) và `review_items.dismiss_reason` (CHECK có đúng khi `resolution = 'dismissed'`, ≤ 300 ký tự). Schema: `ordering/schema.ts:141-158`, `payment/schema.ts:90-133`. Cột mới tự được UPDATE (`platform/db/grants.ts:117-131`).
- Contracts (`packages/contracts/src`):
  - `order.ts:244-254` -- `OrderCancelReason`.
  - `payment.ts:55-82` -- `ReviewAction`, `ReviewApproveBlockedReason`, body "Bỏ qua", `ReviewActionResult` (kết quả cho toast: mã Đơn, số Vé, số tiền).
  - `reporting.ts:314-357` -- `ReviewItemLogKind` thêm `approved`, `approve_sold_out`, `rejected`, `refunded`, `dismissed`; `ReviewItemLogEntry` thêm `actorName`, `note` tùy chọn; `ReviewItemDetail` thêm `actions`, `approveBlockedReason`; path builder cho POST. `z.enum` chặt nên sửa contracts và web cùng lúc (4.3 triage #4).
  - `errors.ts:210` -- `REVIEW_ACTION_NOT_ALLOWED`, `EVENT_LOCKED`; status bắt buộc ở `apps/api/src/platform/http/app-error.ts:3-64`.
  - `jobs.ts:92-99` -- `BuyerEmailKind.ORDER_REJECTED`.
- `apps/api/src/modules/ordering/mark-paid.ts` -- `manual` đang bị chặn ở :209-211; `PayInput.from` (:369) chỉ `pending`/`expired`. Đường `manual`: khóa Sự kiện `FOR SHARE`, kiểm hủy/kết thúc (`dbClock` như :281)/khóa → kết quả không đổi gì; `sellAllOrNothing` (:113) thua → `orphan` `sold_out`, Đơn giữ `review` (không `moveToReview`, không email orphan); thắng → `pay()` (:320) với CAS có `organization_id` và actor cho audit (thêm vào `MarkPaidOptions`). `pay()` đã phát Vé, email, `notifyOrderChanged`.
- `apps/api/src/modules/ordering/` -- file mới cho `review` → `cancelled` (`rejected`, enqueue `ORDER_REJECTED`) và `cancelled` → `refunded`, mẫu CAS `markExpired` (`order-jobs.ts:156-166`), có audit và `notifyOrderChanged` (`order-changed.ts:21`). Xuất qua `index.ts` cùng `notifyEventOrdersChanged` (`order-changed.ts:30`).
- `ordering/buyer-email.ts:93-135`, `buyer-email-jobs.ts:62,99-146` -- builder `order_rejected` theo mẫu `buildOrphanSoldOutEmail` và `organizerContactLines`; nhánh `messageOf` (switch exhaustive); bỏ gửi khi Đơn không còn `cancelled`.
- `apps/api/src/modules/payment/` -- service thao tác mới: khóa mục theo `(id, organization_id)`, kiểm bảng thao tác (hàm thuần, xuất cho `reporting`), gọi `ordering`, CAS mục, audit, `realtime.notifyOrganization(ORG_REVIEW_ITEMS_CHANGED)` (mẫu `ipn-processor.ts:300-313`). Controller POST mới `/v1/orgs/:orgId/review-items/:itemId/{approve,reject,refund,dismiss}` với `@RequirePermission(Permission.REVIEW_QUEUE_HANDLE)` + `@Access()` (mẫu `reporting/review-queue.controller.ts:19-47`); đọc header như `ordering/orders.controller.ts:52`. Hết chỗ: ném 409 sau commit để dòng audit "không thành" còn lại.
- `apps/api/src/platform/audit/audit.ts:5-148` -- thêm action; thêm hàm đọc audit theo target (index `audit_events_target_idx`).
- `apps/api/src/modules/organizer/` -- read model chỉ trả tên thành viên theo lô id (dùng `identity` `userContacts`, `identity/user-directory.ts:29`), xuất `index.ts`.
- `apps/api/src/modules/reporting/review-queue.service.ts:80-121` -- chi tiết thêm `actions`, `approveBlockedReason` (Sự kiện: `status`, `effectiveEndAt` so đồng hồ DB, `lockedAt`) và dòng nhật ký từ audit kèm tên.
- Test API:
  - `test/organizer/isolation.test.ts:55-134,217-226` -- 4 route POST mới; test đang đếm đúng 3 route `review-items` phải sửa.
  - Fixture: `test/payment/ipn-fixtures.ts` (`reviewItemsOf`, `orderState`, `expectInvariants`), `test/ordering/order-fixtures.ts`; mẫu `place`/`ipn`/`insertUnmatched`/`setEnded` ở `test/reporting/review-queue.test.ts`; LISTEN ở `test/payment/ipn-edge.test.ts:86-92`.
- Web (`apps/web`):
  - `app/(dashboard)/btc/[orgId]/can-xu-ly/review-queue.tsx:206-366,409-537` -- footer thao tác trong `Sheet` (nên tách file); trả focus khi hàng bị gỡ (4.3 triage #22, `returnFocus` :533).
  - `lib/reporting/api.ts:53-79` -- hàm POST theo mẫu `lib/order/api.ts:37-42` (`IDEMPOTENCY_KEY_HEADER`); khóa sinh bằng `newFunnelId` (`lib/event/funnel.ts:12`) mỗi lần mở thao tác, giữ khi thử lại.
  - `lib/reporting/review-queue.ts:70-77` -- `reviewLogLabel` cho loại mới.
  - Dùng lại: `components/tickee/confirm-dialog.tsx` (mẫu `asForm` + ô nhập ở `thanh-vien/members-manager.tsx:298-329`), `Textarea` + `FieldError`, `Button loading`, toast `sonner`, `messageOf`, `handledElsewhere`.
  - e2e: `e2e/review-queue.spec.ts:332-333` đang khẳng định không có nút → sửa; `e2e/organizer-mock.ts:136` thêm `idempotency-key` vào `access-control-allow-headers`; đọc header trong handler như `e2e/purchase.spec.ts:234`; mẫu `Dialog` ở `e2e/admin-closed-beta.spec.ts:114-194`.
  - Unit: `test/review-queue.test.ts:67-88`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/modules/{ordering,payment}/schema.ts` + migration `0025` -- `orders.cancel_reason`, `review_items.dismiss_reason` và CHECK.
- [x] `packages/contracts/src/{order,payment,reporting,errors,jobs}.ts` (+ test) -- enum, body, kết quả, chi tiết mục, mã lỗi, loại email.
- [x] `apps/api/src/modules/ordering/*` -- `markPaid` `manual`, hai hàm chuyển trạng thái, email `order_rejected`, export.
- [x] `apps/api/src/platform/audit/audit.ts`, `apps/api/src/modules/organizer/*` -- action mới, đọc audit theo target, tên thành viên.
- [x] `apps/api/src/modules/payment/*` -- service 4 thao tác và controller POST.
- [x] `apps/api/src/modules/reporting/review-queue.service.ts` -- `actions`, `approveBlockedReason`, nhật ký thao tác.
- [x] Test API cho mọi dòng I/O Matrix, cách ly, tín hiệu khi commit và khi rollback, gửi lại, cuộc đua hai thao tác.
- [x] Web: footer thao tác, ba `Dialog`, toast, trả focus, nhãn nhật ký, POST kèm khóa.
- [x] Test web unit và e2e: từng thao tác, nút tắt có lý do, lỗi hết chỗ, 409 cuộc đua, `Dialog` Hủy không gọi API, focus sau khi hàng rời.

**Acceptance Criteria:**
- Given `pnpm lint:deps`, then sạch.
- Given bộ test cách ly, then 4 route POST mới được phát hiện và đều pass.
- Given màn 320px, when mở `Sheet` có thao tác và các `Dialog`, then không cuộn ngang.
- Given một khoản đã duyệt tay, then mục không còn `open` và Đơn có `paid_amount`: khoản đó không vào cả hai phần của AD-28.

## Implementation Notes

- `story_key`: `4-4-duyệt-tay-từ-chối-và-đánh-dấu-đã-hoàn-tay` (để `in-progress` tới khi 4.4-b xong). Nhánh `feat/4-4-a-duyet-tay-tu-choi-va-hoan-tay`.
- Migration `0025_review_actions.sql` điền `cancel_reason` (`event_cancelled` nếu Sự kiện đã hủy, còn lại `rejected`) và `dismiss_reason` = "Bỏ qua trước Story 4.4" cho dòng `cancelled`/`refunded`/`dismissed` có sẵn trước khi thêm CHECK. Trước 4.4 không đường nào của ứng dụng ghi các trạng thái này, nên chỉ chạm dữ liệu SQL tay ở DB dev/test; khoảng 8 test cũ chèn trạng thái này bằng SQL được sửa theo CHECK.
- Mã mới: `ordering/order-review.ts` (`OrderReviewDecisions.reject`/`refund`), `payment/review-actions.ts` (`reviewActionsFor`, `reviewActionDone`, `ReviewActionsService`), `payment/review-actions.controller.ts`, `audit.trailOf`, `organizer.memberNamesOf`, web `can-xu-ly/review-actions.tsx`. `TicketEventRef` thêm `organizationId`, `lockedAt`.
- `org_review_items_changed` còn phát khi "Từ chối" và khi duyệt tay hết chỗ (mục vẫn `open` nhưng chi tiết đổi), để `Sheet` đang mở của thành viên khác tải lại.
- Duyệt tay: `paid_at` = lúc Tingee báo tiền về (không có thì lúc Tickee nhận), `issued_at` của Vé = đồng hồ DB.
- Tên người làm chỉ lấy từ thành viên hiện tại; thành viên đã bị xóa hiện "Thành viên BTC".
- Focus khi mục rời hàng: hàng kế tiếp, mục ở cuối thì hàng trước, hết hàng thì `h1` (`PageHeading` nhận `titleRef`, `tabIndex=-1`). Thua cuộc đua: toast, `Sheet` ở lại với chi tiết tải lại.
- Mục `event_cancelled` có Đơn `review`: "Đã hoàn tay"/"Bỏ qua" chỉ đóng mục, Đơn giữ `review` (không có `review → refunded`); ghi `deferred-work.md` cho 7.1.

## Spec Change Log

## Review Triage Log

Lượt 1 (16/11/2026). BH = blind-hunter, ECH = edge-case-hunter, VG = verification-gap.

| # | Nguồn | Phát hiện | Verdict | Route | Bằng chứng |
|---|-------|-----------|---------|-------|------------|
| 1 | VG | "Bỏ qua" mục chỉ hoàn có Đơn: chưa test `event_orders_changed` | low | patch | Gap đã kiểm: mọi test dismiss thành công dùng mục `unmatched`; bỏ `notifyOrderUnchanged` ở nhánh DISMISS không test nào đỏ. |
| 2 | VG | Thành viên đã bị xóa → "Thành viên BTC": chưa test | low | patch | Gap đã kiểm: không test nào xóa dòng `members`; đổi `memberNamesOf` sang tra thẳng `userContacts` vẫn pass. |
| 3 | VG | `paid_at` của Đơn duyệt tay chưa được khẳng định | low | patch | Gap đã kiểm: test duyệt chỉ so `status`, `paid_amount`, `paid_source`, `tickets`; bỏ option `paidAt` không test nào đỏ. |
| 4 | VG | Lỗi khác 409 trong `Dialog` Từ chối/Đã hoàn tay/Bỏ qua chưa test | low | patch | Gap đã kiểm: e2e lỗi duy nhất là 500 của approve (không `Dialog`); không test nào chứa "Chưa từ chối được". |
| 5 | VG | "Đã hoàn tay" trên mục chỉ hoàn mà Đơn đã từ chối → Đơn bị chuyển `refunded` | medium | patch | `review-actions.ts:243-246` rẽ theo `isRejectedOrder(order)`, không xét `isRefundOnly`. Tái hiện: lệch tiền (Đơn `review`) + trả lần hai (`duplicate_payment` cùng Đơn) → Từ chối mục lệch tiền → Đã hoàn tay mục trùng → Đơn `refunded`, mục lệch tiền `open` với `actions` rỗng, kẹt mãi trong hàng và badge. Trái Always "mục refund-only: chỉ đóng mục". |
| 6 | ECH | Như #5 | medium | patch | Cùng dòng và cùng hậu quả với #5. |
| 7 | BH | Hai thành viên cùng thao tác → bên sau nhận 200 và toast thành công; lý do "Bỏ qua" thứ hai bị bỏ | low | reject | Đúng luật đã duyệt ("gửi lại đúng thao tác cho mục đã ở kết quả đó → 200", Design Notes idempotency theo trạng thái); kết quả toast là sự thật. Sửa cần lưu khóa, trái Never "không thêm bảng idempotency chung". |
| 8 | ECH | Như #7 (bên thua cuộc đua cùng thao tác nhận 200) | low | reject | Như #7. |
| 9 | ECH | Thử lại cùng khóa sau khi mất phản hồi: lý do "Bỏ qua" đã sửa bị bỏ; dòng `approve_sold_out` lặp | low | reject | Cần mất phản hồi rồi sửa lý do mới gặp; web bỏ khóa sau 409 hết chỗ nên mỗi lần bấm lại là một lần thử thật. Sửa cần lưu khóa (như #7). |
| 10 | BH | `Dialog` đang mở không đóng khi thành viên khác đổi mục | low | reject | Chỉ khi hai thành viên xử lý cùng mục cùng lúc; xác nhận lúc đó nhận 409 (toast "Mục này vừa được xử lý.") hoặc 200 đúng trạng thái. Sửa thêm effect theo dõi `actions`. |
| 11 | ECH | `actions` rỗng do tải lại khi `Dialog` mở → `Dialog` biến mất, mất lý do đang gõ | low | reject | Cùng điều kiện hiếm như #10 (thành viên khác vừa xử lý); sửa là thêm điều kiện giữ component. |
| 12 | BH | Sau "Từ chối" focus rơi khỏi `Sheet` vì nút "Từ chối" bị gỡ khi chi tiết tải lại | low | patch | `ConfirmDialog` trả focus về nút "Từ chối", nút đó biến mất khi `actions` thành `['refund']`. Gặp ở mọi lần Từ chối bằng bàn phím; đưa focus sang "Đã hoàn tay" là sửa nhỏ trong component. |
| 13 | BH | Banner lỗi tại chỗ (hết chỗ) còn lại khi mục đã được người khác xử lý | low | reject | Cần lần duyệt hết chỗ rồi thành viên khác xử lý xong khi `Sheet` vẫn mở; sửa thêm effect xóa `inline`. |
| 14 | BH | Mục lệch tiền/mồ côi `open` với Đơn `cancelled` (`event_cancelled`) hay trạng thái khác không có thao tác nào | false | reject | Không có đường tới: `flows.cancelEvent` (AD-28) giữ nguyên Đơn `review`; Đơn của hai loại này chỉ rời `review` qua duyệt (đóng mục cùng `tx`) hoặc Từ chối (`rejected` → có `refund`). Đường duy nhất là lỗi #5, đã vá. |
| 15 | BH | BTC bị khóa hiện nhãn "Sự kiện đang bị khóa" | low | reject | `organizationLocked` là stub trả `false` (`event/sale-rules.ts:20`); chưa ai gặp tới Story 7.4. Sửa cần thêm giá trị enum. |
| 16 | BH | `buyerStatus` không dùng `cancel_reason`; `refunded` trông như `cancelled` với Người mua | low | reject | Bảng trạng thái Người mua (`order.ts:321-334`) có sẵn từ 3.7; Đơn đã từ chối rồi Sự kiện bị hủy hiện "Sự kiện đã hủy" vẫn đúng sự thật. Báo hoàn tiền cho Người mua là quyết định sản phẩm ngoài intent. |
| 17 | BH | Email `order_rejected` thiếu số tiền, giờ, mã giao dịch | low | reject | Nội dung theo câu đã chốt; Người mua có sao kê ngân hàng. Thêm trường là mở rộng, không phải lỗi. |
| 18 | BH | "Duyệt tay phát Vé" không có `Dialog` xác nhận dù không hoàn tác được | low | reject | Epics/UX chỉ đòi `Dialog` cho "Từ chối"; `Sheet` hiện "nhận X / Đơn Y" tô `danger-text` ngay trên nút, nhãn nút nêu rõ hành động. |
| 19 | BH | `ReviewActionResult` đọc sau commit, có thể phản ánh thao tác của người khác | low | patch | `resultOf` dùng `this.db.orm` sau `transaction`; đọc bằng `tx` trước commit là sửa thẳng. |
| 20 | BH | Thử duyệt hết chỗ lặp lại tạo nhiều dòng nhật ký | false | reject | Web bỏ khóa sau 409 hết chỗ: mỗi dòng ứng với một lần bấm thật; nhật ký ghi đúng từng lần thử. |
| 21 | BH | CHECK `dismiss_reason` không đòi chuỗi đã trim, khác rỗng | low | reject | Chỉ ứng dụng ghi cột này, qua `DismissReason` (`trim().min(1)`); thêm điều kiện CHECK là thêm guard cho trạng thái không ai tạo được. |
| 22 | BH | Chú thích thứ tự khóa của `markPaid` chưa ghi khóa `review_items` trước và Từ chối khóa Đơn không qua Sự kiện | low | patch | Story 7.1 (hủy Sự kiện chạm Đơn và mục) sẽ đọc chú thích này; thiếu thứ tự dễ gây deadlock về sau. Sửa chú thích. |
| 23 | BH | Đường lỗi (409, chặn Sự kiện) không có log có cấu trúc | low | reject | 409 là kết quả nghiệp vụ trả cho người dùng; lỗi 5xx đã qua filter lỗi toàn cục. Sửa thêm `try/catch`. |
| 24 | BH | Thiếu test: hai thành viên cùng thao tác, backfill `0025`, nhánh BTC bị khóa | low | reject | Cuộc đua cùng thao tác theo #7; backfill chỉ chạm dữ liệu SQL tay ở dev/test; nhánh BTC khóa là stub (#15). |
| 25 | ECH | BTC bấm "Đã hoàn tay" trước khi job `order_rejected` gửi (kể cả lúc SMTP thử lại) → Người mua không bao giờ nhận email hủy | medium | patch | `buyer-email-jobs.ts:145` bỏ gửi khi Đơn khác `cancelled`; `order-review.ts` `refund` lại giả định email đã đi. Cho gửi cả khi Đơn `refunded` là sửa thẳng điều kiện. |
| 26 | ECH | Đóng `Sheet` bằng Esc khi đang duyệt rồi mở mục khác → `onSuccess` cũ đóng `Sheet` của mục khác | low | reject | Cửa sổ dưới một giây giữa bấm Duyệt và mở mục khác; sửa thêm guard theo mục đang chọn. |
| 27 | ECH | Lý do chứa U+0000 → Postgres 22021 → 500 thay vì 400 | low | reject | Phải cố ý gửi NUL qua JSON; sửa thêm `refine` vào schema. |

## Design Notes

- **Idempotency theo trạng thái.** Chưa có bảng idempotency chung; mỗi thao tác là một chuyển trạng thái có compare-and-set, nên gửi lại sau khi đã thắng chỉ gặp trạng thái đích và trả `200`. Header vẫn bắt buộc để giữ hợp đồng AD-31 nếu sau này cần lưu khóa.
- **Ai sở hữu gì.** `payment` sở hữu `review_items` và được gọi `ordering`; kiểm Sự kiện nằm trong `markPaid` (`ordering` → `event` được phép), nên `payment` không cần `event`. `reporting` ghép chi tiết và tên người làm qua `organizer`.
- **Hết chỗ ghi nhật ký.** `reason` chỉ dành cho `orphan` và không UPDATE được, nên "hết chỗ" lưu bằng dòng audit `review_item.approve_sold_out`; controller ném 409 sau commit.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: không lỗi.
- `pnpm lint:deps` -- expected: không vi phạm.
- `pnpm --filter @tickee/api test` -- expected: pass, gồm `isolation.test.ts`.
- `pnpm --filter @tickee/contracts test`, `pnpm --filter @tickee/web test` -- expected: pass.
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 pnpm --filter @tickee/web build` rồi `pnpm --filter @tickee/web exec playwright test e2e/review-queue.spec.ts e2e/dashboard-shell.spec.ts e2e/event-overview.spec.ts` -- expected: pass.
