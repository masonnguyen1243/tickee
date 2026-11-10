---
title: 'Story 3.3: Đăng ký Sự kiện miễn phí và nhận Vé ngay'
type: 'feature'
created: '2026-11-10'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '26cce43f4e8f0891a2822c8d5cb557a8a7bfb911'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-tickee-2026-10-27/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sau 3.2, mọi Đơn kể cả Đơn tổng 0đ đều chỉ dừng ở `pending` và giữ chỗ. Chưa có `markPaid`, chưa có bảng Vé và Mã QR vé, nên người đăng ký Sự kiện miễn phí không nhận được Vé. Các story 3.5 và 3.7 cũng chưa có lõi phát Vé và màn "Thành công" để dùng lại.

**Approach:** Đơn có **tổng 0đ** đi đường riêng ngay trong TX1. Ở đó bán có điều kiện (`sold += n`), chèn Đơn `pending`, kiểm trần Vé của Người mua, rồi gọi `ordering.markPaid(tx, orderId, 'free', 0)`. Hàm này CAS Đơn sang `paid`, nhờ `ticketing` phát N Vé có bản chụp, ghi audit `order.paid` và phễu `paid`, tất cả trong một transaction. `GET /v1/me/orders/:code` trả thêm Vé kèm Mã QR ký số. Trang `/orders/:code` hiện màn "Thành công" với các `ticket-card`.

## Boundaries & Constraints

**Always:**
- Phép tồn kho của Đơn 0đ: `UPDATE ticket_type_inventory SET sold = sold + :n WHERE ticket_type_id = :id AND sold + held + :n <= capacity`, chạy theo `ticket_type_id` tăng dần. Một dòng trả 0 thì rollback cả Đơn và báo `TICKET_TYPE_SOLD_OUT` như 3.2. `markPaid` với `source = 'free'` không đụng tồn kho nữa.
- Vé chỉ được tạo bên trong `markPaid`, không có đường nào khác (AD-1). `markPaid` khóa Sự kiện `FOR SHARE` và CAS `WHERE status='pending'`; CAS trả 0 dòng → `lost_race`, không phát Vé.
- Mỗi Vé có bản chụp `seq` (1..N, `UNIQUE (order_id, seq)`, đánh theo thứ tự dòng `ticket_type_id` tăng dần), `order_ticket_count`, `holder_name` (tên Người mua của Đơn), `ticket_type_name`, `order_code`, `issued_at`, `status = 'valid'` (AD-35, AD-27).
- Mã QR vé `t<k>.<ticketId>.<sig>`, `sig` = base64url(HMAC-SHA256(key_k, `t<k>.<ticketId>`)). Khóa lấy từ env `TICKET_QR_KEYS` cùng định dạng `v<k>:<base64 32 byte>` của `TINGEE_CREDENTIAL_KEYS`; ký bằng `k` lớn nhất. Vé lưu `qr_key_version`. **Không lưu `sig` hay chuỗi QR vào DB**: QR được tính lại khi đọc, nên lộ DB không lộ Mã QR hợp lệ. Có hàm verify (sai chữ ký hoặc `k` lạ → không hợp lệ) để 5.x dùng.
- Trần Vé của Người mua (Mason chốt 10/11): áp cho **mọi Đơn tổng 0đ**, kể cả ở Sự kiện hỗn hợp. Chỉ đếm Vé trong các Đơn `paid` **tổng 0đ** của Người mua trên Sự kiện đó; Vé có phí không tính. Điều kiện: số đó + `n` ≤ giới hạn Vé/Đơn.
- Trần được kiểm **sau** khi chèn Đơn, trong cùng transaction. Unique một phần `(user_id, event_id) WHERE status='pending'` buộc hai TX1 của cùng Người mua chạy nối tiếp, nên câu SUM chạy sau luôn thấy Đơn đã commit của bên kia. Vượt trần → 409 `FREE_TICKET_LIMIT_REACHED`, câu báo "Bạn đã nhận đủ số Vé tối đa cho Sự kiện này."
- Đơn 0đ không enqueue job hết hạn. `expires_at` = `clock_timestamp()` vì cột NOT NULL. Đơn được ghi thêm `paid_at`, `paid_amount = 0`, `paid_source = 'free'`.
- Idempotency, giới hạn tốc độ, chặn Đơn chờ và phễu `order_created` giữ nguyên như 3.2. Gửi lại cùng khóa trả đúng Đơn `paid` đó, cùng các Vé đó.
- Màn "Thành công" theo DESIGN.md và mockup `key-success-ticket.html`:
  - stage có wordmark, tên Sự kiện, "Vé của bạn đã sẵn sàng!";
  - mỗi Vé một `ticket-card` dáng cuống vé: đường xé nét đứt, hai khuyết, nhãn "Mã QR vé · đưa cho CTV ở cổng", QR đen trên tấm trắng ≥ 200×200, "Vé k/N", Hạng vé, tên Người mua, ngày-giờ Sự kiện;
  - thẻ đầu chồng mép stage ~30px, trượt lên; "rung nhẹ" là `navigator.vibrate` nếu thiết bị hỗ trợ (EXPERIENCE.md:390); reduced motion thì hiện ngay, không trượt, không rung;
  - có `aria-live="polite"`.
- Nút ở `purchase-bar` của Checkout ghi "Đăng ký" khi tổng 0đ (EXPERIENCE.md:271).

**Never:**
- Không gọi Tingee, không tiêu Token, không enqueue email hay queue mới. Email Vé thuộc 3.8 và sẽ thêm vào `markPaid` cho mọi `source`. Màn Thành công không ghi "Đã gửi Vé tới {email}" vì chưa có email nào được gửi.
- Không làm nhánh có phí của `markPaid` (`held → sold`, `orphan`, `mismatch`, `event_cancelled`). Kiểu kết quả khai đủ năm giá trị, nhưng 3.3 chỉ trả `paid` hoặc `lost_race`.
- Không làm link chia sẻ / `share_token` / nút "Chia sẻ Vé" (3.8). Không làm "Vé của tôi" và chưa hiện nút "Xem Vé của tôi"; 3.9 thêm nút cùng với trang (Mason chốt 10/11). Không làm realtime (3.7), không làm check-in (5.x).
- Không đổi định dạng AD-16. Câu hỏi `qr_version` vẫn để Mason quyết trước 3.8.
- `ticketing` không import `ordering`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Đăng ký thành công | Sự kiện miễn phí, A=2, form hợp lệ, khóa mới | 201 `BuyerOrder` `paid` + 2 Vé (`seq` 1,2, `count` 2, QR khớp mẫu); `sold` A +2, `held` không đổi; phễu `order_created` + `paid`; audit `order.paid`; không có job; web sang `/orders/:code` và hiện Thành công | — |
| Nhiều Hạng vé 0đ | A=1, B=2 | 3 Vé, `seq` 1..3 theo `ticket_type_id` tăng dần | — |
| Hết vé | B thiếu chỗ | Không có Đơn, `sold` của A không đổi | 409 `TICKET_TYPE_SOLD_OUT` như 3.2 |
| Vượt trần Người mua | Đã có 8 Vé trong các Đơn `paid` 0đ, giới hạn 10, xin thêm 3 | Không có Đơn, tồn kho không đổi | 409 `FREE_TICKET_LIMIT_REACHED`; web toast câu báo rồi về `/e/{slug}`, giữ lựa chọn |
| Sự kiện hỗn hợp | Đã có 10 Vé trong Đơn `paid` có phí, giới hạn 10, xin 2 Vé 0đ | 201 `paid`, 2 Vé (Vé có phí không tính vào trần) | — |
| Song song cùng Người mua | Giới hạn 10, hai Đơn khác khóa, mỗi Đơn 6 | Đúng một Đơn `paid` | Bên kia 409 `FREE_TICKET_LIMIT_REACHED` |
| Gửi lại cùng khóa | Đơn 0đ đã `paid` | 200 đúng Đơn và đúng Vé cũ, không phát thêm | — |
| Đơn tổng > 0 | Có cả dòng 0đ và dòng có phí | Giữ nguyên đường 3.2 (`pending`, `held`) | — |
| Xem Đơn đã trả | `GET /v1/me/orders/:code` | `tickets[]` có QR, `event.startsAt` | Của người khác → 404 như 3.2 |
| QR bị sửa | Đổi một ký tự trong `ticketId` hoặc `sig`, hoặc `k` không có trong env | Verify → không hợp lệ | — |
| Thiếu khóa | `TICKET_QR_KEYS` trống hoặc sai định dạng | API không khởi động | Lỗi cấu hình rõ ràng |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/ordering/orders.service.ts` -- `create()` 176-220: thứ tự idempotency → `pendingOf` → `consume` → TX1 → bắt unique. `placeOrder` 234-296: `lockSaleEventBySlug` 235, `assertOnSale` 244, `holdInventory` 245, tính items/tổng 248-252, `insertOrder` 253-264 (đang viết cứng `PENDING` + `expiresAt`), answers, phễu 288-293, `enqueueOrderExpiry` 294. Rẽ nhánh: tính tổng trước dòng 245. `view()` 368-401 dựng `BuyerOrder`.
- `apps/api/src/modules/ordering/inventory.service.ts:117-138` -- `holdInventory` / `releaseHeld`: làm mẫu cho `sellInventory`.
- `apps/api/src/modules/ordering/schema.ts` -- `orders` 80-122 (CHECK `status` đã đủ 6 giá trị; chưa có `paid_at`/`paid_amount`/`paid_source`), CHECK phễu ở 62, unique Đơn chờ ở 78. Migration kế tiếp `drizzle/0017`; sửa CHECK theo mẫu DROP rồi ADD của `0016:57,73`.
- `apps/api/src/modules/ticketing/index.ts` -- đang là stub `export {}`. Tạo module theo mẫu `ordering.module.ts:20-38` (`forRoot(config)`), đăng ký ở `api.module.ts:39,45`. `drizzle.config.ts` tự gom `src/**/schema.ts`. `module-graph.cjs:7-19`: `ordering → ticketing` và `ticketing → event` được phép; `.dependency-cruiser.cjs:38-75` cho `schema.ts` import `schema.ts` khác để làm FK. Nếu FK `tickets.order_id → orders` vi phạm luật thì bỏ FK, giống `orders.user_id`.
- `apps/api/src/platform/crypto/secret-box.ts:40,72-87` -- `parseCredentialKeys`, `currentVersion`: dùng lại cho `TICKET_QR_KEYS`. `platform/config/config.schema.ts:38-44,50-90` (`credentialKeys`, `apiConfigSchema`; worker chưa cần khóa). Mẫu so chữ ký `tingee/signing.ts:33` (`timingSafeEqual`). Truyền config theo mẫu `organizer.module.ts:22`.
- `apps/api/src/platform/audit/audit.ts:5-91,107` -- thêm `'order.paid'` vào `AuditAction`; `audit.record(tx, …)`.
- `apps/api/src/platform/db/grants.ts:11-45` -- cột bản chụp của `tickets` vào `UPDATE_PROTECTED_COLUMNS`. `packages/contracts/src/pii.ts:5` -- thêm `ticketing: ['holder_name']`.
- `apps/api/src/modules/event/public-event.ts:54-91` -- `lockSaleEventBySlug` trả `maxTicketsPerOrder`, `effectiveEndAt`, chưa có `startsAt` (thêm nếu `view()` cần).
- `packages/contracts/src/order.ts:198,226-239` -- `BuyerOrder` chưa có `tickets` và `event.startsAt`. `checkout.ts:72-110` -- thêm `PAID` vào `FUNNEL_EVENT_TYPES`, không thêm vào `FunnelEventInput`; test `contracts/test/checkout.test.ts:75`. `errors.ts` → kéo theo `app-error.ts` `DEFAULT_STATUS` và `error.filter.ts` `MESSAGES`. `event.ts:217` `formatEventDateTime`.
- `apps/api/test/ordering/order-fixtures.ts` -- `eventOnSale` 75, `postOrder` 116, `orderBody` 124, `inventory` 131, `orderRow` 139. `freeEventOnSale` ở `sellability.test.ts:77-83` chưa export. `test/helpers.ts:17-44` `testCredentialKey`, `apiConfig()`.
- `apps/web/app/(buyer)/orders/[code]/order-view.tsx` -- `StatusBlock` 21-40 chỉ có PENDING/EXPIRED; `paid` đang rơi vào "đang được xử lý". Đã có `aria-live` ở 94; polling 5 giây chỉ khi `pending` (50).
- `apps/web/app/(buyer)/e/[slug]/checkout/checkout-order-form.tsx` -- `onSuccess` 193-200 đã `setQueryData` rồi `router.push`. Nhãn nút ở 424. Map lỗi 409 theo mẫu sẵn có.
- `apps/web/components/tickee/{stage-block,wordmark}.tsx`, `components/ui/button.tsx:22` (`primary-on-light`). `QrImage` ở `app/(public)/bao-mat/totp/enroll-form.tsx:34-55` (`qrcode@1.5.4` đã có): tách thành component dùng chung. Token `bg-qr-plate`/`text-qr-module`/`qr-plate-padding` (`globals.css:64-65,156-157,235`); reduced motion toàn cục ở `globals.css:296-305`.
- `apps/web/e2e/purchase.spec.ts` -- `buyerOrder(patch)` 129-145, `mockOrders` 158-192, `mockAccount` 195-216, `SLUG_FREE`/`TIER_FREE_ONLY_ID`; mẫu reduced motion ở `e2e/components.spec.ts:54-70`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{order,checkout,errors,pii}.ts` + test -- `BuyerTicket` (`id`, `seq`, `count`, `ticketTypeName`, `holderName`, `qr`), `BuyerOrder.tickets` (rỗng khi chưa `paid`), `event.startsAt`, mẫu QR `TICKET_QR_PATTERN`, mã lỗi `FREE_TICKET_LIMIT_REACHED`, phễu `PAID` -- web và API dùng chung một nguồn.
- [x] `apps/api/src/modules/ticketing/{schema,qr,tickets.service,ticketing.module,index}.ts` -- bảng `tickets` (`id`, `order_id`, `event_id`, `organization_id`, `user_id`, `ticket_type_id`, bản chụp AD-35, `qr_key_version`, `status` CHECK `valid|cancelled`, `cancel_reason`, `checked_in_at`; `UNIQUE (order_id, seq)`); `issueTickets(tx, …)`, `ticketsOfOrder`, `signTicketQr`/`verifyTicketQr` -- lõi Vé mà 3.5, 3.8 và 5.x dùng lại.
- [x] `apps/api/src/platform/{config/config.schema,audit/audit,db/grants}.ts`, `.env.example`, `test/helpers.ts` -- `TICKET_QR_KEYS`, `order.paid`, cột bảo vệ.
- [x] `apps/api/src/modules/ordering/{schema,inventory.service,mark-paid,orders.service,funnel.service,index}.ts` + migration `0017` -- cột `paid_*`, CHECK phễu thêm `paid`, `sellInventory`, `markPaid`, rẽ nhánh Đơn 0đ, trần Người mua, `view()` trả Vé.
- [x] `apps/api/test/ordering/{free-order,free-order-concurrency}.test.ts`, `test/ticketing/qr.test.ts`, `test/config.test.ts` -- mọi dòng Matrix; gọi `markPaid` hai lần → lần sau `lost_race` và không thêm Vé; mỗi Vé có `seq` riêng và `sold + held ≤ capacity`.
- [x] `apps/web/components/tickee/{ticket-card,qr-plate}.tsx`, `app/(buyer)/orders/[code]/{order-view,order-success}.tsx`, `enroll-form.tsx`, `checkout-order-form.tsx` -- màn Thành công, nhãn "Đăng ký", map lỗi 409 mới, TOTP dùng `qr-plate` chung.
- [x] `apps/web/e2e/purchase.spec.ts` -- đăng ký 0đ thì thấy Thành công với N thẻ ("Vé k/N", nhãn QR, ảnh QR ≥ 200px); reduced motion thì `animation-name: none`; vượt trần thì có toast và về trang Sự kiện; nút "Đăng ký" khi tổng 0đ.

**Acceptance Criteria:**
- Given Đơn 0đ đang ở TX1, when có lỗi ở bất kỳ bước nào sau bán có điều kiện (trần Người mua, phát Vé, audit), then cả transaction rollback: không có Đơn, `sold` không đổi, không có Vé.
- Given màn Thành công ở 375×667 hoặc 320px, when hiện N thẻ, then không cuộn ngang, QR ≥ 200×200 trên tấm trắng ở cả theme sáng lẫn tối.
- Given 30 request 0đ song song cho 10 chỗ từ 30 Người mua khác nhau, then đúng 10 Đơn `paid`, đúng số Vé bằng `sold`, và `sold ≤ capacity`.

## Implementation Notes

- Spec dài khoảng 2.150 từ, vượt ngưỡng 1.600 token. Mason chọn giữ nguyên ngày 10/11, vì đây là một mục tiêu xuyên lớp.

- Quyết định ngoài spec (subagent triển khai):
  - `tickets.order_id` và `organization_id` không có FK, vì luật phụ thuộc cấm `ticketing → ordering/organizer`. FK chỉ có tới `events` và `ticket_types`.
  - Audit `order.paid` ghi `actor_user_id = null` (hệ thống), dùng chung cho mọi nguồn.
  - `qr_key_version` vẫn sửa được, để ký lại khi một khóa bị lộ. Muốn khóa cứng thì thêm vào `UPDATE_PROTECTED_COLUMNS`.
  - Thêm `lockEventByIdForShare` ở `event` cho `markPaid`, và thêm `startsAt` vào `PublicEventRef`.
  - CHECK `orders_paid_check`: `paid_at`, `paid_amount`, `paid_source` có đủ cả ba hoặc không có cột nào, và Đơn `paid` luôn có đủ.
  - `markPaid` với nguồn có phí ném "chưa hỗ trợ (Story 3.5)".
  - Màn Thành công rung mỗi lần mount, kể cả khi mở lại Trang Đơn.
- `.env` local cần thêm `TICKET_QR_KEYS` (chép từ `.env.example`), nếu không thì api không khởi động.
- Kiểm chứng (session gốc chạy lại): `pnpm typecheck`, `pnpm lint:deps`, `pnpm test` đều pass (contracts 241, web 173, api 710). `pnpm test:e2e` 667/668 pass; lỗi duy nhất ở `purchase-form.spec.ts:376` (WebKit), test đã được ghi là chập chờn từ E2-5 và không thuộc 3.3. 10 test e2e của 3.3 chạy riêng đều pass trên cả hai project.

- Sau review vòng 1, đã vá 6 mục patch (triage #1-#6): thêm test QR với provider thật, thêm helper e2e `e2e/qr-image.ts` kiểm ảnh QR mã hóa đúng chuỗi (Vé và TOTP), focus `h1` của màn Thành công, test trần kiểm đúng mã lỗi, fixture e2e đệm số, comment phễu. Session gốc chạy lại `pnpm typecheck`, `pnpm lint:deps`, `pnpm test` (contracts 241, web 173, api 710) và `pnpm test:e2e` (668/668): tất cả pass.

## Spec Change Log

## Review Triage Log

Vòng 1 (review_loop_iteration 0). Nguồn: BH = Blind Hunter, EC = Edge Case Hunter, VG = Verification Gap.

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | VG | Chưa test provider `TICKET_QR_KEYS` thật: nối nhầm sang `TINGEE_CREDENTIAL_KEYS` thì mọi test vẫn qua | medium | Gap đã được VG kiểm: `free-order.test.ts` thay `TicketsService`; `free-order-concurrency.test.ts` dùng DI thật nhưng chỉ kiểm mẫu QR | patch |
| 2 | VG | Không test nào kiểm ảnh QR có mã hóa đúng `qr` của Vé (và `totpUri` của TOTP vừa chuyển sang `QrPlate`) | medium | Gap đã được VG kiểm: `expectQrPlates` chỉ kiểm cỡ, màu, có hiện; `totp.spec.ts` chỉ kiểm có ảnh | patch |
| 3 | BH, EC | Trình đọc màn hình không đọc "Vé của bạn đã sẵn sàng!": vùng `aria-live` mount sẵn nội dung | medium | `order-success.tsx` mount stage cùng nội dung; route announcer của Next đọc title "Đơn của bạn · Tickee" (`orders/[code]/page.tsx:6`) | patch (focus `h1`) |
| 4 | BH | Hai test trần chỉ kiểm `.expect(409)`, không kiểm mã lỗi | low | `free-order.test.ts:292,397`; `PENDING_ORDER_EXISTS` hay `TICKET_TYPE_SOLD_OUT` cũng qua. Sửa thẳng | patch |
| 5 | EC | Fixture `ticketQr`/`freeOrder` với `n ≥ 10` ra uuid và chữ ký sai | low | `purchase.spec.ts` ghép `n` vào đuôi; sửa thẳng bằng `padStart` | patch |
| 6 | EC | Comment đầu `funnel.service.ts` chỉ nói `order_created` ghi ngoài service, thiếu `paid` | low | `funnel.service.ts:8-14`; sửa comment | patch |
| 7 | BH, EC | `markPaid('free')` công khai, không đụng tồn kho, nên có thể phát Vé cho Đơn 0đ chỉ đang `held` | false | Bên duy nhất gọi `'free'` là `placeOrder`, ngay sau `sellInventory` trong cùng `tx`. Đơn 0đ `held` từ thời 3.2 chỉ đi job hết hạn. Spec chốt "`free` không đụng tồn kho" | reject |
| 8 | BH | Gỡ một phiên bản khóa còn Vé dùng thì Trang Đơn trả 500; chưa có công cụ xoay khóa | low | `signTicketQr` ném lỗi đúng thiết kế; chỉ xảy ra khi người vận hành gỡ khóa sai (README đã dặn). Sửa phải thêm kiểm lúc khởi động và công cụ | reject (ghi deferred 4.7/4.6) |
| 9 | BH | Không chặn `TICKET_QR_KEYS` trùng khóa Tingee, hay khóa mẫu `.env.example` lọt lên production | medium | `config.schema.ts` chỉ kiểm định dạng; lỗ có sẵn với mọi bí mật mẫu; cấu hình production thuộc 4.7 | defer |
| 10 | BH | `tickets` vẫn DELETE được; `paid_*` sửa được; `paid_source='free'` chưa buộc số tiền 0 | low | `grants.ts` chỉ có append-only và cột bảo vệ, `orders` cũng DELETE được; không code nào xóa hay sửa. Sửa phải thêm cơ chế quyền mới | reject |
| 11 | BH, EC | `BuyerTicket` không có `status`; Vé `cancelled` vẫn hiện QR | false | Chưa có đường nào đặt `tickets.status='cancelled'` (chỉ có `issueTickets`/`ticketsOfOrder`) | reject (ghi deferred 3.9/7.5) |
| 12 | BH | 409 trần không trả `details`, web về lại đúng lựa chọn vừa lỗi | low | Đúng Matrix (toast + giữ lựa chọn); Người mua tự giảm số lượng được. Thêm `details` và chặn stepper là thêm nhánh | reject |
| 13 | BH | Không kiểm trần trước TX1: người đã đủ trần vẫn tốn một lần thử và khóa dòng tồn kho | low | Tốn một lần trong 10 lần/10 phút; khóa chỉ vài ms rồi rollback. Sửa phải thêm truy vấn và nhánh | reject |
| 14 | BH | `QrPlate` lỗi vẽ thì hiện ô giữ chỗ mãi, không báo gì | low | `toDataURL` chỉ lỗi khi dữ liệu quá dài cho QR; chuỗi ≤ ~90 ký tự; giống `QrImage` TOTP cũ | reject |
| 15 | BH, EC | Rung và hiệu ứng trượt chạy lại mỗi lần mở Trang Đơn | low | Đúng, nhưng chỉ là trình bày (rung 40ms, hiệu ứng 560ms); chặn phải thêm state; 3.7 dùng lại màn này | reject (ghi deferred 3.7) |
| 16 | BH | Helper test bị chép giữa hai file concurrency | low | Chỉ trong test, chưa chỉ ra chỗ nào sẽ lệch | reject |
| 17 | BH | `TicketQrKeys` lặp phần map khóa của `SecretBox`, ném `Error` thường | low | Đầu vào đã qua `parseCredentialKeys` lúc kiểm config; chưa chỉ ra chỗ nào sẽ lệch | reject |
| 18 | BH | Worker chưa chạy được `markPaid` vì thiếu `TICKET_QR_KEYS`/DI | false | 3.3 không có đường worker nào gọi `markPaid` hay đọc Vé; spec ghi "worker chưa cần khóa" | reject (ghi deferred 3.8/4.1) |
| 19 | BH | Trang Đơn `paid` bỏ phần tóm tắt; `expiresAt = createdAt` chưa ghi vào contract | false | 3.3 chỉ có Đơn 0đ; màn Thành công trong UX không có tóm tắt; `expires_at` của Đơn 0đ đã ghi ở comment schema | reject (ghi deferred 3.7) |
| 20 | EC | `queues.ready()` lỗi thì Đơn 0đ cũng hỏng dù không enqueue | low | pg-boss dùng chung Postgres; `ready()` chỉ chờ lần đầu. Bỏ qua cho Đơn 0đ phải tính tổng trước TX1 | reject |

## Design Notes

- Vì sao kiểm trần sau `insertOrder` mà không dùng advisory lock: TX1 thứ hai của cùng Người mua bị chặn ở unique Đơn chờ cho tới khi TX1 đầu commit. Lúc đó dòng `pending` đầu đã thành `paid`, nên không còn vi phạm unique. Ở READ COMMITTED, câu SUM chạy sau thấy Vé vừa phát. Test song song giữ bất biến này.
- Vì sao không lưu chuỗi QR: chữ ký là bí mật suy ra từ khóa. Tính lại khi đọc bằng `qr_key_version` thì QR vẫn ổn định khi xoay khóa, miễn khóa cũ còn trong env (AD-16).
- `qr_version` (action item mở, chặn trước 3.8) xoay quanh việc thu hồi một QR đã lộ, không liên quan tới xoay khóa `k`. Trước Closed Beta chưa có Vé thật, nên nếu 3.8 đổi định dạng thì không tốn công chuyển dữ liệu.

## Verification

**Commands:**
- `pnpm test` -- pass (contracts, api với Postgres thật, web vitest)
- `pnpm typecheck && pnpm lint:deps` -- pass, `ticketing` không import `ordering`
- `pnpm test:e2e` -- pass (`purchase.spec.ts` và các spec cũ)
