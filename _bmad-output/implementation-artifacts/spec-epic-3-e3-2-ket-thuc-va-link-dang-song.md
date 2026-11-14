---
title: 'E3-2: Đơn đang chờ thanh toán khi BTC Kết thúc, Ẩn hoặc bị khóa'
type: 'bugfix'
created: '2026-11-13'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'f394bf7541c2943c328b9fd56fb91d558f31e89d'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** "Thử lại" tạo link (`POST /v1/me/orders/:code/payment-link`, và gửi lại cùng khóa) gọi Tingee mà không kiểm lại trạng thái bán, nên Sự kiện đã Kết thúc, Ẩn, bị khóa hay BTC mất điều kiện bán vẫn có link mới. Sau Kết thúc, Trang Đơn vẫn mời Người mua trả tiền, và Dialog "Kết thúc" chỉ nói "ngừng nhận Đơn" dù Vé hết hiệu lực, không báo còn bao nhiêu Đơn đang thanh toán; tiền về sau lúc Kết thúc thành Cần xử lý `orphan` `event_ended`, BTC phải hoàn tay (retro Epic 3 B1, C2 của E2-6).

**Approach:** Trước khi gọi Tingee, `PaymentLinks` hỏi `ordering.sellability` (một luật dùng chung); không còn bán thì Đơn hết hạn `sales_paused`, không gọi Tingee. Sau Kết thúc, máy chủ thôi trả link thanh toán và Trang Đơn hiện "Sự kiện đã kết thúc". Dialog "Kết thúc" nêu đủ hậu quả và số Đơn đang chờ thanh toán.

## Boundaries & Constraints

**Always:**
- **Chốt link** chạy khi request đã giữ lượt (sau CAS `claim`, hoặc lượt TX1 đặt sẵn), trước `defaultPayoutTargetOf` và Tingee: "Thử lại", gửi lại cùng khóa và lần gọi đầu sau TX1 đều qua một chỗ. Bị chặn → `expire(order, sales_paused)` (CAS `pending → expired`, nhả chỗ, `order_changed`), log `warn` kèm `organizationId`, mã Đơn, lý do; không trả lượt.
- Chặn khi: Sự kiện hủy, Sự kiện hoặc BTC bị khóa, đã quá `effective_end_at` (đồng hồ DB), Ẩn, hoặc BTC không đủ điều kiện bán Vé có phí (`paidOk`: Closed Beta, tài khoản nhận tiền, `paymentServiceStatus`). Không xét giờ mở/đóng bán, tồn kho hay chính sách hoàn vé của Hạng vé: Đơn đã giữ chỗ khi còn bán.
- Luật chặn là hàm thuần trong `ordering/sellability.ts`, dựng trên `blockingReason` và `SaleFacts.paidOk` (AD-21). Story 4.2 thay thân `paymentServiceStatus` là chốt này tự áp cho "Tạm ngừng bán".
- **Quyết định của Mason (13/11) — Kết thúc khi còn Đơn có link (B1):** giữ Đơn tới khi link tự hết hạn, thôi mời trả. `BuyerOrderView.payment.checkoutUrl` = `null` khi `event.ended`. Trang Đơn của Đơn `awaiting_payment`/`confirming`/`expired` mà `event.ended` hiện "Sự kiện đã kết thúc. Đơn này không thanh toán được nữa." kèm liên hệ BTC; không màn thanh toán, không "Thử lại", không "Mua lại". Tiền vẫn về thì đi nhánh `orphan` `event_ended` hiện có.
- **Quyết định của Mason (13/11) — Ẩn hoặc bị khóa khi Đơn đã có link:** giữ AC 3.6 (tiền về cho Đơn `pending` thì phát Vé); chỉ chặn link mới. Trang Đơn không đổi.
- **Đếm "Đơn đang chờ thanh toán"** = Đơn của Sự kiện `pending`, có `payment_link`, `expires_at > now()` (đồng hồ DB). `GET /v1/orgs/:orgId/events/:eventId/pending-payment-count` → `{ orders }`, quyền `events.manage`, Sự kiện lạ/của BTC khác → `404 EVENT_NOT_FOUND`, đi qua bộ test cách ly.
- Bấm "Kết thúc" → đếm trước (nút có spinner, chặn bấm lặp) rồi mới mở Dialog, như lệnh lưu của Story 3.10; đếm lỗi → banner "Chưa kết thúc được" kèm lỗi, không mở Dialog.
- **Câu chữ (C2).** Dialog: "Ngừng nhận Đơn ngay, không mở lại được. Từ lúc này Vé hết hiệu lực: không check-in được, CTV hết quyền, Vé rời "Vé của tôi" và link chia sẻ Vé ngừng hoạt động." Khi `orders > 0` thêm: "Còn {n} Đơn đang chờ thanh toán. Người mua đang ở trang thanh toán vẫn có thể chuyển tiền trong tối đa 15 phút; khoản đó không thành Vé và bạn sẽ phải hoàn tay." Dòng cạnh nút: "Kết thúc sớm: ngừng nhận Đơn và Vé hết hiệu lực ngay, không mở lại được."

**Never:**
- Không thêm migration, cột hay mã lỗi mới; dùng lại `PaymentLinkError.SALES_PAUSED`.
- Không đổi `markPaid` (bước 3–7 của AD-7), `EventStatusService` (Ẩn/Hiện lại/Kết thúc), job hết hạn (a)/(c), hay `order-card` của "Vé của tôi".
- Không thêm tín hiệu realtime khi Sự kiện kết thúc; không làm phần của Story 4.2 hay hành vi check-in của Epic 5.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Thử lại sau Kết thúc | Đơn `pending` chưa có link (`provider_error`), BTC bấm "Kết thúc", Người mua bấm "Thử lại" | 200 `expired`, `linkError = sales_paused`, nhả chỗ; không request nào tới Tingee | N/A |
| Thử lại sau Ẩn / khóa / hủy | Như trên, Sự kiện Ẩn, Sự kiện hoặc BTC bị khóa, hoặc Sự kiện hủy | Như trên | N/A |
| Thử lại khi mất điều kiện có phí | Closed Beta bị thu hồi giữa hai lần thử | Như trên | N/A |
| Thử lại khi còn bán | Sự kiện đang bán, Hạng vé vừa qua giờ đóng bán | Gọi Tingee như cũ (Đơn đã giữ chỗ) | N/A |
| Trang Đơn sau Kết thúc | Đơn `pending` có link, Sự kiện đã kết thúc | `checkoutUrl: null`; web hiện câu đã kết thúc + liên hệ BTC | N/A |
| Trang Đơn khi Ẩn | Đơn `pending` có link, Sự kiện Ẩn | `checkoutUrl` vẫn có; màn thanh toán như cũ | N/A |
| Đếm | 2 Đơn `pending` có link còn hạn, 1 `pending` chưa có link, 1 có link quá `expires_at`, 1 `paid` | `{ orders: 2 }` | Sự kiện của BTC khác → 404 |

</frozen-after-approval>

## Code Map

Gốc `apps/api/src` trừ khi ghi khác.

- `modules/ordering/sellability.ts` -- `blockingReason` (:47, thứ tự hủy > khóa > kết thúc > Ẩn), `SaleFacts.paidOk` (:65), `saleFactsOf` (:112, đọc Hạng vé, tồn kho, khóa BTC, điều kiện có phí qua `paymentServiceStatus` stub :37), `saleEventById` (từ `event`). Thêm hàm thuần lý do chặn link và hàm đọc theo `eventId` + `now`.
- `modules/ordering/payment-link.ts` -- `ensure` (:93), `attempt` (:133) là chỗ duy nhất trước Tingee cho mọi đường; `expire` (:247) là đúng phép hết hạn cần dùng. `LinkCandidate` (:69) thiếu `eventId`: thêm vào (người gọi đã truyền cả dòng `orders`).
- `modules/ordering/orders.service.ts` -- `withPaymentLink` (:212) và đường sau TX1 (:166) gọi `ensure`; không đổi ngoài kiểu.
- `platform/db/clock.ts` -- `dbNow`; đồng hồ DB chỉ đi qua đây (`test/platform/db-clock-usage.test.ts` chặn chép tay).
- `modules/ordering/order-view.ts` -- `paymentOf` (:89, `checkoutUrl` :98) cần `ended` từ `buyerOrderView` (`event.ended` đã tính theo đồng hồ DB).
- `modules/ordering/event-overview-read.ts` -- chỗ đặt hàm đọc cho màn BTC (mẫu `paidBuyerCount` ở `event-change-email-jobs.ts:62`); export qua `ordering/index.ts`.
- `flows/event-update.flow.ts` (:49 `eventBuyerCount`, `assertEventOfOrganization`), `flows/event-edit.controller.ts` (:41 `buyer-count`, `EVENTS_MANAGE`) -- thêm route đếm cùng chỗ.
- `packages/contracts/src/event.ts` (:144) -- mẫu `EventBuyerCount` + `eventBuyerCountApiPath`.
- `apps/web/lib/event/api.ts` (:58) -- mẫu `fetchEventBuyerCount`.
- `apps/web/app/(dashboard)/btc/[orgId]/su-kien/[eventId]/event-settings.tsx` -- `StatusActions` (:248), dòng "Kết thúc sớm" (:334), `ConfirmDialog` Kết thúc (:376); mẫu đếm-rồi-mở-Dialog ở `InfoForm` (:119, `count` mutation). `components/tickee/confirm-dialog.tsx` là Dialog dùng chung.
- `apps/web/app/(buyer)/orders/[code]/order-view.tsx` -- `StatusBlock` (:55), `statusAnnouncement`, `waiting`/`payment` (:222, :254) quyết màn thanh toán. `apps/web/lib/order/status-copy.ts` -- thêm câu đã kết thúc (một câu dùng chung).
- Test: `test/ordering/payment-link.test.ts` (mẫu "BTC vừa hủy liên kết … không gọi Tingee" :394, `POST …/payment-link` :488), `test/ordering/sellability.test.ts`, `test/event/event-change-email.test.ts` (mẫu test `buyer-count`), `test/organizer/isolation.test.ts:95` (danh sách route có guard), `test/ordering/orders.test.ts` hoặc test `BuyerOrderView` hiện có cho `checkoutUrl`; `apps/web/e2e/event-settings.spec.ts`, `apps/web/e2e/order-live.spec.ts` (mock qua `live-mock.ts`).

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/modules/ordering/sellability.ts` -- hàm thuần `linkBlockOf(facts, now): EventSaleReason | null` (`blockingReason`, rồi `PAUSED` khi `!paidOk`) và `paymentLinkBlock(db, eventId, now)` -- một luật với trang công khai và TX1.
- [x] `apps/api/src/modules/ordering/payment-link.ts` -- `LinkCandidate` thêm `eventId`; đầu `attempt` gọi `paymentLinkBlock` với `dbNow`, bị chặn thì log và `expire(SALES_PAUSED)` -- chốt duy nhất trước Tingee.
- [x] `apps/api/src/modules/ordering/order-view.ts` -- `checkoutUrl` null khi `event.ended` -- máy chủ thôi mời trả sau Kết thúc.
- [x] `packages/contracts/src/event.ts`, `apps/api/src/modules/ordering/event-overview-read.ts`, `ordering/index.ts`, `apps/api/src/flows/event-update.flow.ts`, `flows/event-edit.controller.ts` -- schema `EventPendingPaymentCount`, đường API, hàm đếm, route `pending-payment-count`.
- [x] `apps/web/lib/event/api.ts`, `event-settings.tsx` -- fetch số Đơn; "Kết thúc" đếm trước rồi mở Dialog; câu chữ C2.
- [x] `apps/web/lib/order/status-copy.ts`, `apps/web/app/(buyer)/orders/[code]/order-view.tsx` -- Đơn chưa trả của Sự kiện đã kết thúc: khối "đã kết thúc" + liên hệ BTC thay màn thanh toán / "Mua lại"; vùng `aria-live` đọc cùng câu.
- [x] Test API: mọi dòng I/O Matrix (fake Tingee đếm request), unit `linkBlockOf`, route đếm (404 BTC khác, Staff/CTV bị chặn), đăng ký route ở `isolation.test.ts`. Test web: e2e Dialog (có/không Đơn đang chờ, đếm lỗi) và Trang Đơn sau Kết thúc (`awaiting_payment`, `expired`) so với khi Ẩn.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- đóng mục E3-2 của review E3-7 (Trang Đơn sau Kết thúc) bằng dòng "Đã xử lý" trỏ spec này.

**Acceptance Criteria:**
- Given request đầu tiên sau TX1 và Sự kiện vẫn đang bán, when tạo Đơn có phí, then hành vi tạo link không đổi (mọi test `payment-link.test.ts` hiện có vẫn pass).
- Given chốt chặn một Đơn, then bất biến `sold + held ≤ capacity` và `held` = tổng Vé của Đơn `pending` vẫn đúng (`expectInvariants`).
- Given `pnpm lint:deps`, then `event` không import `ordering`; route đếm nằm ở `flows`.

## Implementation Notes

- `paymentLinkBlock` không đi qua `saleFactsOf` (khỏi đọc Hạng vé và tồn kho mỗi lần thử); nó dùng chung `blockingReason` và helper mới `paidOkOf` (tách từ `saleFactsOf`, nên trang công khai, TX1 và chốt link vẫn một luật). Đơn có phí nên luôn đọc điều kiện có phí. Thêm khoảng 4 truy vấn nhỏ mỗi lần tạo link.
- `order-view.ts`: `paymentOf` chạy sau lần đọc Sự kiện (song song với đọc Vé) để có `ended`.
- Test cũ "BTC vừa hủy liên kết hết tài khoản trước lần thử lại" giờ dừng ở chốt (`saleReason: 'paused'`) thay vì nhánh `no_default_payout_account`; kết quả không đổi. Nhánh cũ có test mới: còn liên kết nhưng không có tài khoản mặc định.
- BTC bị khóa chỉ có unit test (`linkBlockOf`): `organizationLocked` (`event/sale-rules.ts:20`) còn là stub luôn `false` tới Story 7.4. Khóa Sự kiện có test end-to-end.
- Lần gọi đầu sau TX1 bị chặn không có test end-to-end (không đổi được trạng thái Sự kiện giữa commit TX1 và chốt); cùng code `attempt` với các đường đã test.
- Câu chữ Dialog dùng ngoặc kép cong “Vé của tôi” như các câu UI hiện có.
- Vá sau review lượt 1: chốt bọc try/catch (lỗi → log `error`, trả lượt, `provider_error`; test dùng `vi.mock` của `sellability.js`, mock đầu tiên trong repo); log chốt dùng `reason`; "15 phút" lấy từ `PAYMENT_LINK_MINUTES`; doc `sales_paused` nêu chốt E3-2; e2e: `under_review` + `ended`, 401 của số đếm → đăng nhập, Ẩn xóa banner đếm lỗi; route đếm loại Đơn của Sự kiện khác cùng BTC.
- Task "Staff/CTV bị chặn" ở route đếm không viết được: thành viên BTC chỉ có `owner`/`admin` (`Role`, ràng buộc `members_role_check`), CTV không phải thành viên. Thay bằng người dùng không thuộc BTC → 403 `NOT_A_MEMBER` trên Sự kiện của chính BTC đó.
- Kiểm (13/11): `pnpm typecheck`, `pnpm lint:deps` sạch; API `payment-link`, `payment-link-concurrency`, `sellability`, `orders`, `isolation`, `test/platform` 143/143; contracts `event.test.ts` 34/34; web vitest 227/227; Playwright `event-settings` + `order-live` 108/108. Subagent triển khai đã chạy cả bộ API (1104) và e2e (852) pass.

## Spec Change Log

## Review Triage Log

Lượt 1 (13/11/2026). BH = blind-hunter, ECH = edge-case-hunter, VG = verification-gap.

| # | Nguồn | Phát hiện | Verdict | Route | Bằng chứng |
|---|-------|-----------|---------|-------|------------|
| 1 | BH, ECH, VG (other) | Chốt `paymentLinkBlock`/`dbNow` ném (lỗi DB) khi đang giữ lượt → lượt không trả, Đơn kẹt không "Thử lại" được tới khi hết giữ chỗ, request trả 500 | medium | patch | `payment-link.ts:144` nằm ngoài try/catch; nhánh `defaultPayoutTargetOf` ngay dưới (chưa gọi Tingee) thì `release`. Chốt phá bất biến "chưa gọi Tingee → trả lượt". |
| 2 | VG (gap) | Không test `under_review` (tiền về sau Kết thúc) với `event.ended: true` vẫn hiện màn của nó | low | patch | `order-live.spec.ts` chỉ có `ended: true` cho chờ tiền/xác nhận/hết hạn; nới `unpaidAfterEnd` thành `event.ended` không test nào đỏ. |
| 3 | VG (gap) | 401 của `pending-payment-count` → chuyển trang đăng nhập không có test; mock bỏ qua `signedOut` | low | patch | `event-settings.spec.ts:140` không đọc `state.signedOut`; bỏ `goToLogin()` của `count` không test nào đỏ. |
| 4 | VG (gap) | `count.reset()` khi Ẩn/Hiện lại (xóa banner "Chưa kết thúc được" cũ) không có test | low | patch | Test đếm lỗi chỉ xóa banner bằng bấm "Kết thúc" lần nữa. |
| 5 | BH, ECH | Test route đếm thiếu Staff/CTV bị chặn (Tasks yêu cầu) và thiếu ca Đơn của Sự kiện khác cùng BTC | low | patch | `payment-link.test.ts` chỉ có Owner/Admin 200, người ngoài 403, 401. |
| 6 | BH, ECH | `sales_paused` giờ gồm Kết thúc/Ẩn/khóa/hủy/mất điều kiện có phí nhưng doc `PaymentLinkError`, `SALES_PAUSED`, `salesPaused` vẫn chỉ nói Tingee từ chối | low | patch | `contracts/src/order.ts:44-50`, `status-copy.ts`, `order-view.tsx` chú thích `salesPaused`. |
| 7 | BH | Log chốt dùng trường `saleReason`, nhánh `sales_paused` cạnh đó dùng `reason` | low | patch | `payment-link.ts:146` vs `no_default_payout_account` (`reason`); truy vấn log theo `reason` sẽ hụt. |
| 8 | BH | "15 phút" viết cứng trong câu Dialog thay vì `PAYMENT_LINK_MINUTES` | low | patch | `event-settings.tsx` `pendingPaymentsNotice`. Vế "nói thiếu thời gian tiền về" là false: Người mua chỉ chuyển được khi link còn sống; Đối soát bù chỉ hỏi lại khoản đã trả. |
| 9 | VG, BH | Không test nào chứng minh chốt link và `ended` theo đồng hồ DB (app và DB lệch); mục deferred E3-7 VG #2 nêu E3-2 mà không được làm hay chuyển tiếp | low | defer | Harness Nest chưa có mẫu giả `Date`; cùng yếu điểm đã ghi ở `deferred-work.md` (E3-7 VG #2). |
| 10 | ECH | "Kết thúc" đặt `effective_end_at` bằng đồng hồ app (`new Date()`) trong khi chốt và Trang Đơn so bằng đồng hồ DB | low | defer | `event-status.service.ts:110`; có từ Story 2.12, spec cấm đổi `EventStatusService`. Lệch đồng hồ thường ở mức ms (NTP). |
| 11 | BH, ECH | Sự kiện hủy: Đơn bị chốt chặn hiện "Sự kiện tạm ngừng bán. Bạn thử lại sau nhé." + "Về trang Sự kiện" | low | defer | Chưa đường nào hủy Sự kiện (Story 7.1 backlog; không code nào đặt `events.status = 'cancelled'`), nên chưa xảy ra. 7.1 phải chọn câu cho Đơn `expired` của Sự kiện đã hủy. |
| 12 | BH | Thẻ Đơn ở "Vé của tôi" vẫn hiện đếm ngược + "Tiếp tục thanh toán" cho Đơn chờ tiền của Sự kiện đã kết thúc | low | defer | `order-card.tsx:56`; intent (Never) giữ nguyên `order-card`. Nút dẫn tới Trang Đơn đã hiện câu đã kết thúc. |
| 13 | BH, ECH | Số đếm bỏ Đơn có link đã quá `expires_at` còn trong 5 phút chừa (`confirming`) và lượt đang gọi Tingee | low | reject | Luật đếm nằm trong phần đã chốt (`expires_at > now()`); sửa là đổi spec. IPN thường về trong vài giây nên Đơn `confirming` có tiền đang về lúc Kết thúc hiếm. Nêu lại với Mason ở bước trình bày. |
| 14 | BH | Người mua đã chuyển (`confirming`/`expired`) sau Kết thúc không còn câu "Nếu bạn đã chuyển tiền, đừng chuyển lại…" | low | reject | Câu chữ đã chốt kèm liên hệ BTC; tiền về thì Đơn sang `under_review` với câu riêng. Ca hiếm (đã trả sát giờ mà IPN chưa về). |
| 15 | BH, ECH | Hai luật "đã kết thúc": chốt dùng `<=`, `endedNow` dùng `>` | low | reject | Chỉ lệch khi `now()` của DB bằng đúng `effective_end_at` tới micro giây; sửa `endedNow` chạm mọi người dùng của nó. |
| 16 | BH | `sprint-status.yaml` còn `open`, spec chưa track | false | reject | Bước trình bày và override `on_complete` đặt `done` và commit spec. |
| 17 | BH | Câu e2e dùng `${n}`, web dùng `toLocaleString` | low | reject | Chỉ khác từ 1.000 Đơn; test dùng 1 và 3. |
| 18 | BH, ECH | Số đếm trong Dialog đang mở có thể cũ | low | reject | BTC xác nhận trong vài giây; làm mới cần thêm lần gọi; Kết thúc đã có xử lý `EVENT_ALREADY_ENDED`. |
| 19 | ECH | TX2 gắn link không kiểm lại `sellability` | false | reject | Cửa sổ dưới 6 giây đã chấp nhận ở Design Notes; với Ẩn/khóa, link gắn được đúng với AC 3.6 (Đơn `pending` vẫn được trả). |
| 20 | ECH | Trang Đơn đang mở (SSE) lúc Kết thúc vẫn hiện link cũ | false | reject | Intent (Never) không thêm tín hiệu realtime khi Sự kiện kết thúc; Design Notes ghi rõ. |
| 21 | ECH | Một test cũ bị sửa, trái AC "mọi test hiện có vẫn pass" | false | reject | AC áp cho Sự kiện vẫn đang bán; test sửa là BTC hết tài khoản (không còn bán). Kết quả không đổi, chỉ đổi log; ghi ở Implementation Notes. |

## Design Notes

**Vì sao chốt sau khi giữ lượt, không trước `claim`:** request đang giữ lượt nên `expire` không thể đè lên một request khác đang gọi Tingee cho cùng Đơn. "Thử lại" bị chặn vẫn tính một lần vào giới hạn tốc độ (`beforeClaim` chạy trước `claim`); đó vẫn là một lần thử.

**Cửa sổ còn lại (chấp nhận):** BTC bấm Kết thúc giữa lúc chốt chạy và lúc Tingee trả link (dưới 6 giây) thì link vẫn được tạo; tiền về đi nhánh `orphan` `event_ended` như mọi khoản về sau Kết thúc. Đóng hẳn cần giữ khóa Sự kiện trong lúc gọi Tingee, trái AD-5. Trang Đơn đang mở lúc BTC bấm Kết thúc không tự đổi (không có tín hiệu cho việc này); lần tải lại hay quay về từ trang Tingee sẽ thấy trạng thái mới.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: không lỗi.
- `pnpm lint:deps` -- expected: không vi phạm ranh giới mô-đun.
- `pnpm --filter @tickee/api test` -- expected: toàn bộ pass (cần Postgres của `docker-compose.yml`).
- `pnpm --filter @tickee/web test` và `pnpm --filter @tickee/web test:e2e -- event-settings order-live` -- expected: pass.
