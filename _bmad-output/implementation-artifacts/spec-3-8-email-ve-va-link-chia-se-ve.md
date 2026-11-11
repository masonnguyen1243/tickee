---
title: 'Story 3.8: Email Vé và link chia sẻ Vé'
type: 'feature'
created: '2026-11-11'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'c33e38f4652f2645963966fb881ee99b98b1bfad'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Vé chỉ hiện trên Trang Đơn của người mua. Không có email Vé, không có cách gửi từng Vé cho bạn đi cùng, nên Đơn nhiều Vé buộc cả nhóm vào cổng bằng một điện thoại. Đơn hết hạn mà tiền về muộn khi Hạng vé đã hết (`orphan` `sold_out`) cũng chưa báo Người mua (3.6 hoãn sang 3.8).

**Approach:** Mỗi Vé có một link chia sẻ khó đoán (AD-29). `markPaid` enqueue trong cùng `tx` một job gửi email Vé: một email cho Người mua, mỗi Vé một link. Link mở trang công khai chỉ hiện QR, Sự kiện, Hạng vé, "Vé k/N", trạng thái. Chủ Vé bấm "Chia sẻ Vé" trên `ticket-card` của màn Thành công, và tạo lại được link. Cùng hàng đợi email Người mua gửi email báo `orphan` `sold_out`.

## Boundaries & Constraints

**Always:**
- **Link chia sẻ (AD-29):**
  - Mỗi Vé có token ≥ 128 bit, không đoán được. DB không lưu token dạng rõ: tra bằng hash, có unique index.
  - Server lấy lại được link hiện hành của Vé cho chủ Vé (`buyerScope`) và cho worker email. Bấm "Chia sẻ Vé" nhiều lần ra cùng một link.
  - "Tạo lại link": link cũ chết ngay, Mã QR vé không đổi.
- **`GET /v1/shared-tickets/:token`** (`@Public`, `shareScope`, `no-store`):
  - Trả `SharedTicketView` gồm `eventName`, `eventStartsAt`, `venue`, `ticketTypeName`, `seq`, `count`, `status` (`valid` | `checked_in`) và `qr`.
  - Không bao giờ có tên, SĐT, email Người mua, mã Đơn hay id user.
  - `404 SHARED_TICKET_NOT_FOUND` chung, cùng body, cho mọi trường hợp: token sai định dạng hoặc không khớp, Vé `cancelled`, Sự kiện đã hủy, hoặc giờ DB > `effective_end_at` (AD-14, so tại request).
  - Không ghi gì, nên người nhận link không thấy Vé trong "Vé của tôi".
- **`POST /v1/me/tickets/:ticketId/share-link`:**
  - Chỉ chủ Vé (`tickets.user_id`). Vé của người khác, đã hủy hoặc quá `effective_end_at` → `404 TICKET_NOT_FOUND`.
  - Trả link mới và ghi audit `ticket.share_link_regenerated`.
- **`BuyerTicket`** (chỉ trong response của chủ Đơn) thêm `shareToken`.
- **URL công khai:** `{WEB_ORIGIN}/xem-ve#<token>`. Một hàm trong contracts dựng URL này. Token nằm sau `#` (như `loi-moi-btc`) nên không đi vào log web hay Referer. Log request của api che phần token trong `/v1/shared-tickets/<token>`.
- **Job email Người mua** `ordering.send-buyer-email` (+ dead-letter):
  - Payload `{ kind: 'tickets' | 'orphan_sold_out', orderId }`, enqueue bằng chính `tx`.
  - Id job suy ra cố định từ (`kind`, `orderId`), nên enqueue lặp không tạo job thứ hai.
  - Lỗi thì retry có backoff, hết lượt vào dead-letter. Lỗi lưu vào job chỉ có tên lớp lỗi (không PII).
  - Gửi tới `orders.buyer_email` (bản chụp).
- **Email Vé:**
  - Enqueue trong `pay()` cho mọi nguồn (`free`, `ipn`, sau này `reconciliation`/`manual`).
  - Nội dung: tên Sự kiện, giờ (`formatVnDateTime`), địa điểm, mã Đơn, mỗi Vé một dòng "Vé k/N · {Hạng vé}" kèm link, và link về `/orders/:code`. Có bản text và bản HTML (`escapeHtml`). Không đính QR.
  - Lúc gửi mà Đơn không còn `paid` hoặc Sự kiện đã hủy → `completed`, không gửi.
  - Người mua không bao giờ thấy lỗi email. Vé vẫn hợp lệ.
- **Email `orphan_sold_out`:**
  - Enqueue trong `settleIpn`, chỉ nhánh `SOLD_OUT`.
  - Nội dung: "BTC đã nhận tiền nhưng Hạng vé đã hết, BTC sẽ liên hệ hoàn tiền.", mã Đơn, tên Sự kiện, kênh liên hệ BTC.
- **Web:**
  - Trang `/xem-ve`:
    - client đọc `#token`, gọi API không kèm cookie, `noindex`, `referrer: no-referrer`;
    - `ticket-card` không có dòng Người mua; `checked_in` → QR mờ .25 + `status-badge` "Đã check-in";
    - 404, thiếu token hoặc lỗi → `empty-state` "Không tìm thấy Vé" / "Link không đúng hoặc không còn hiệu lực.", không nút.
  - Màn Thành công:
    - stage thêm "Đã gửi Vé tới {email}";
    - mỗi `ticket-card` có "Chia sẻ Vé" (`button-secondary`): Web Share API, fallback sao chép + toast "Đã sao chép" (`copyWithToast`); hủy chia sẻ thì im lặng;
    - "Tạo lại link" mở `ConfirmDialog` ghi "Ai đã thấy hoặc chụp mã QR vẫn có thể dùng mã để vào cổng.", xong thì toast + tải lại Đơn.
- **Quyết định của Mason (11/11):**
  - **Token suy ra bằng HMAC.**
    - token = 16 byte đầu của HMAC-SHA256(khóa con, `share:<ticketId>:<share_version>`), mã base64url (22 ký tự). Khóa con suy từ khóa `TICKET_QR_KEYS` ở phiên bản `tickets.qr_key_version` của Vé, có nhãn riêng để tách miền với chữ ký QR.
    - DB lưu `share_token_hash` (sha256, unique) và `share_version` (bắt đầu 1). Server tính lại token khi cần. "Tạo lại link" tăng `share_version` và ghi hash mới trong cùng một `UPDATE`.
    - Không thêm biến env. AD-29 đổi chữ "ngẫu nhiên" thành "khó đoán, suy ra bằng khóa bí mật". Lộ DB không lộ link.
  - **Không thêm `qr_version` vào AD-16.** Giữ định dạng `t<k>.<ticketId>.<sig>`; "Tạo lại link" chỉ thu hồi đường xem. Ghi quyết định vào AD-16/AD-29 và đóng action item trong `sprint-status.yaml`. Đổi mã khi gửi nhầm chưa có ở MVP.
  - **Giữ cả spec** dù vượt ngưỡng 1.600 token (khoảng 4.000–5.500): email `orphan_sold_out` dùng chung hàng đợi email Người mua của 3.8.

**Never:**
- Không làm "Vé của tôi", Chi tiết Vé, nút "Xem Vé của tôi", biên nhận (3.9). Không đổi dòng mất mạng (đổi khi có 3.9). Không làm dòng giới thiệu Tickee trong email (8.2), ảnh Vé (8.1), email đổi giờ (3.10).
- Không đưa token, email hay tên vào payload job, log hay URL query. Không thêm Redis hay giới hạn tốc độ cho route công khai (token 128 bit).
- Không phát Vé, đổi trạng thái Đơn hay Vé từ route chia sẻ.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Đơn 0đ / IPN đúng tiền | `markPaid` → `paid`, N Vé | N Vé có link; đúng một job `tickets`; worker gửi một email có N link mở được | SMTP lỗi → retry → dead-letter; Vé vẫn hợp lệ |
| `tx` rollback | Lỗi sau khi phát Vé | Không Vé, không job | — |
| Enqueue lặp | Cùng `kind` + `orderId` | Vẫn một job | — |
| Mở link | Vé `valid`, trước `effective_end_at` | QR, Sự kiện, Hạng vé, "Vé k/N", "Hợp lệ"; không PII | — |
| Đã check-in | `checked_in_at` có | QR mờ .25 + "Đã check-in" | — |
| Token sai / Vé hủy / quá hạn / Sự kiện hủy | — | 404 chung, cùng body; web `empty-state` | — |
| Tạo lại link | Chủ Vé xác nhận | Link cũ 404 ngay, link mới mở được, `qr` không đổi | Vé người khác → 404 |
| Bấm "Chia sẻ Vé" lặp | — | Cùng một link | Không Web Share → sao chép + toast |
| Tiền về muộn, hết chỗ | IPN cho Đơn `expired`, `sold_out` | `orphan` + một job `orphan_sold_out`, email báo hoàn tiền | — |
| Gửi lúc Đơn đã đổi | Đơn không còn `paid` | `completed`, không gửi | — |

</frozen-after-approval>

## Code Map

Đường dẫn api tính từ `apps/api/src/`, web từ `apps/web/`, trừ khi ghi đủ.

- **Phát Vé & QR (`ticketing`):**
  - `modules/ticketing/schema.ts:21-60` -- bảng `tickets` (có `qr_key_version`, `status`, `checked_in_at`, `user_id`, `organization_id`). Migration mới `drizzle/0021_*`. Cột mới tự có quyền UPDATE (`platform/db/grants.ts`).
  - `modules/ticketing/tickets.service.ts`:
    - `issueTickets:46` -- đặt cột share lúc phát.
    - `ticketsOfOrder:80` -- dựng `BuyerTicket`: thêm `shareToken`.
  - `modules/ticketing/qr.ts` -- `TicketQrKeys` (`mac`, `currentVersion`), `signTicketQr:57`. `TicketingModule.forRoot` global ở cả api và worker (khóa đã có ở worker từ 3.5). `ticketing` → chỉ `event` (`module-graph.cjs`).
  - Route mới đặt trong `ticketing` (controller mới), `@Public` theo `platform/http/public.decorator.ts`. Mẫu: `event/public-events.controller.ts`.
  - Đọc Sự kiện: `event/index.ts` (`saleEventById`, `PublicEventRef` có `status`, `effectiveEndAt`). Chưa có hàm xuất `venue`: thêm read model nhỏ vào `event/index.ts`.
  - Audit: `platform/audit/audit.ts` (`audit.record(tx, …)`).
- **Ordering:**
  - `modules/ordering/mark-paid.ts`:
    - `pay():278` -- sau `issueTickets` enqueue job `tickets`. RETURNING `:283-292` đã có `id`.
    - `settleIpn():212` -- nhánh `SOLD_OUT` ở khối `status === EXPIRED`: enqueue `orphan_sold_out`.
    - Comment `:148` hứa chỗ enqueue này.
  - `modules/ordering/order-jobs.ts` -- mẫu `OrderQueues`/`OrderExpiryWorker`/`OrderingJobsModule:198`. Module chưa nhận config: thêm `forRoot({ WEB_ORIGIN })` (worker có `WEB_ORIGIN`, `config.schema.ts:114`). Worker đăng ký ở `apps/api/src/worker.module.ts:36-40`.
  - Queue phải có trước khi enqueue:
    - `orders.service.ts:222` gọi `queues.ready()` trước TX1 cho đường Đơn 0đ;
    - đường IPN (`payment/ipn-processor.ts:193`, chạy ở api và worker) chưa gọi `ready()`.
  - `orders.service.ts:504` `view` (Vé chỉ khi `paid`). `organizerContactOf` cho kênh liên hệ BTC. `orders.buyerEmail` (`ordering/schema.ts:114`).
- **Job & email:**
  - `platform/jobs/queue.ts`:
    - `defineQueue:57`, `EnqueueOptions:31` (chỉ `startAfter`): thêm id cố định.
    - Mẫu id cố định: `childJobId:204` + `boss.insert` (ON CONFLICT).
    - Cũng dùng `registerQueueWorker:160`, `QueueProducer:90`, `jobErrorMessage:126`.
  - Mẫu end-to-end: `modules/organizer/invitation-jobs.ts` (queue `:25` retry 8/backoff/dead-letter, worker `:124`, module `:159`) + `invitation-email.ts:12`.
  - `errorName` chép ở `organizer/payout-default-jobs.ts:97`, `organizer/ownership-transfer-jobs.ts:71`, bản inline trong `invitation-jobs.ts`: gom vào `platform/jobs` (deferred E2-5 #11).
  - Email: `platform/email/{email-transport,escape-html}.ts`.
  - Queue: `packages/contracts/src/jobs.ts` `JobQueue`.
- **Log:** `platform/logging/pino-options.ts:87` `httpSerializers.req` (đã che query): thêm che token trong đường `/v1/shared-tickets/`.
- **Contracts:**
  - `packages/contracts/src/order.ts:269-283` -- `TICKET_QR_PATTERN`, `BuyerTicket` (+`shareToken`).
  - File mới cho `SharedTicketView`, đường API, `sharedTicketUrl`.
  - `errors.ts` thêm `SHARED_TICKET_NOT_FOUND`, `TICKET_NOT_FOUND`.
- **Web:**
  - `components/tickee/ticket-card.tsx:8-21,60-63` -- props: `holderName` bắt buộc, chưa có trạng thái hay hành động. QR qua `qr-plate.tsx`.
  - `app/(buyer)/orders/[code]/order-success.tsx:41,71-81` -- stage + map Vé. `order.buyer.email` đã có.
  - Mẫu chia sẻ: `app/(public)/e/[slug]/event-hero.tsx:20-31` `shareEvent`. `lib/clipboard.ts:4` `copyWithToast`.
  - Component: `confirm-dialog.tsx` (`ConfirmDialog`), `empty-state.tsx`, `status-badge.tsx` (tone: Hợp lệ success, Đã check-in neutral).
  - Mẫu trang token: `app/(public)/loi-moi-btc/page.tsx` (`#`, `noindex`, `no-referrer`). API client: `lib/api/client.ts`.
- **Test:**
  - api:
    - `test/ordering/order-fixtures.ts` (`paidReadyOrg`, `eventOnSale`, `postOrder`), `test/payment/ipn-fixtures.ts` (`postIpn`), `test/ordering/free-order.test.ts:216` (đếm job bằng `boss.findJobs`), `test/ordering/mark-paid-ipn.test.ts`;
    - mẫu worker `test/organizer/admin-invitation-job.test.ts` (`FakeEmailTransport` `test/identity/harness.ts:26`, dead-letter `:223`).
  - web:
    - `e2e/purchase.spec.ts:987-989` ghim `not.toContainText('Đã gửi Vé tới')` và "Chia sẻ Vé" = 0: đổi lại;
    - `e2e/identity-mock.ts`, `e2e/qr-image.ts`, clipboard mẫu `e2e/public-event.spec.ts:241-255`;
    - vitest `environment:'node'`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{tickets,order,errors,jobs,index}.ts`, `packages/contracts/test/` -- `SharedTicketView`, đường API, `sharedTicketUrl`, `BuyerTicket.shareToken`, mã lỗi, `JobQueue.ORDERING_SEND_BUYER_EMAIL` (+ dead-letter) và schema payload -- một nguồn cho api/web.
- [x] `apps/api/src/modules/ticketing/{schema,share-token,tickets.service,shared-tickets.controller,ticketing.module,index}.ts`, `apps/api/drizzle/0021_*` -- cột `share_token_hash` (unique) + `share_version`, sinh/tra/tạo lại token theo Quyết định (HMAC), `GET /v1/shared-tickets/:token`, `POST /v1/me/tickets/:ticketId/share-link` + audit -- AD-29.
- [x] `apps/api/src/modules/event/{public-event,index}.ts` -- read model trả thêm `venue` cho Vé -- trang chia sẻ và email.
- [x] `apps/api/src/platform/jobs/{queue,index}.ts` -- id job cố định cho `enqueue`, `errorName` dùng chung; sửa ba chỗ chép ở `organizer` -- idempotent và một chỗ chặn PII.
- [x] `apps/api/src/modules/ordering/{buyer-email-jobs,buyer-email,mark-paid,order-jobs,orders.service,index}.ts`, `apps/api/src/worker.module.ts`, `apps/api/src/modules/payment/ipn-processor.ts` (nếu cần `ready()`) -- queue + worker + hai mẫu email, enqueue ở `pay()` và nhánh `SOLD_OUT` -- FR-23.
- [x] `apps/api/src/platform/logging/pino-options.ts` -- che token trong đường chia sẻ.
- [x] `apps/api/test/ticketing/shared-tickets.test.ts`, `apps/api/test/ordering/buyer-email-job.test.ts` (mới), sửa test ghim số job hay hình dạng `BuyerTicket` -- phủ Matrix phía API, cả rollback và dead-letter.
- [x] `apps/web/app/(public)/xem-ve/*`, `apps/web/components/tickee/{ticket-card,ticket-share-actions}.tsx`, `apps/web/lib/share.ts` (gom `shareEvent`), `apps/web/app/(buyer)/orders/[code]/order-success.tsx`, `apps/web/lib/order/*` -- trang chia sẻ, nút chia sẻ + tạo lại link, dòng "Đã gửi Vé tới {email}".
- [x] `apps/web/e2e/shared-ticket.spec.ts` (mới), `apps/web/e2e/purchase.spec.ts`, `apps/web/test/` -- `page.route` giả API: trang hợp lệ/đã check-in/404/thiếu token, không lộ tên; Web Share (stub `navigator.share`) và fallback sao chép + toast; Dialog tạo lại link; dòng "Đã gửi Vé tới".
- [x] `ARCHITECTURE-SPINE.md` (AD-29 token HMAC + đường web `/xem-ve#`, AD-16 ghi không có `qr_version`), `epic-3-context.md`, `deferred-work.md` (đóng mục 3.8: orphan email, "Đã gửi Vé tới", `errorName`), `sprint-status.yaml` action item `qr_version` -- tài liệu khớp code.

**Acceptance Criteria:**
- Given `markPaid` trả `paid`, when transaction commit, then đúng một job `tickets` cho Đơn đó; rollback thì không có job.
- Given worker chạy job `tickets`, when SMTP nhận, then một email tới `buyer_email` có N link, mỗi link `GET` ra đúng Vé đó; SMTP lỗi hết lượt thì job vào dead-letter, và `GET /v1/me/orders/:code` vẫn trả Vé.
- Given `pnpm test`, `pnpm typecheck`, `pnpm lint:deps`, `pnpm test:e2e`, when chạy, then pass; `ticketing` không import `ordering`.

## Implementation Notes

- **API:**
  - `ticketing/share-token.ts`: `shareTokenOf` (khóa con `TicketQrKeys.derive(qr_key_version, 'tickee:ticket-share-link:v1')`), `hashShareToken` (SHA-256 hex).
  - `issueTickets` lấy id Vé trước (`uuidv7()`) để INSERT có sẵn hash.
  - `TicketsService.sharedTicket` / `regenerateShareLink`: khóa Vé `FOR NO KEY UPDATE`, CAS theo `share_version`, audit.
  - Route ở `TicketingRoutesModule`, chỉ vai api. Đọc Sự kiện qua read model mới `event.ticketEventById` (có `venue`, `ended` theo đồng hồ DB).
  - `ordering/buyer-email-jobs.ts` (queue retry 8/backoff/dead-letter, `BuyerEmailQueues`, `BuyerEmailWorker`, `sendBuyerEmail`) + `buyer-email.ts` (hai mẫu email).
  - `OrderPayments.ready()` được gọi trước transaction ở `orders.service.create` và `ipn-processor.process`. `OrderingJobsModule.forRoot({ WEB_ORIGIN })`.
  - `platform/jobs`: `EnqueueOptions.id`, `derivedJobId` (`childJobId` giờ gọi nó), `errorName` dùng chung.
  - Log: `redactSharedTicketPath`, bỏ `req.params` ở mọi request.
- **Web:**
  - `app/(public)/xem-ve/{page,shared-ticket}.tsx`, `lib/order/shared-ticket.ts` (`sharedTicketTokenFromHash`).
  - `components/tickee/ticket-share-actions.tsx`; `ticket-card` có thêm `holderName?`, `venue`, `status`, `actions`.
  - `lib/share.ts` (`shareLink`, gom `shareEvent`). `apiRequest` cho `init.credentials` ghi đè `include`.
- **Lựa chọn khi làm** (ngoài chữ của spec):
  - `POST …/share-link` trả `{ shareToken }`, web dựng URL bằng `sharedTicketUrl`, giống `BuyerTicket.shareToken`.
  - Email `orphan_sold_out` bỏ qua khi lúc gửi Đơn không còn `review` (BTC đã xử lý).
  - "Tạo lại link" cũng từ chối khi Sự kiện đã hủy, khớp luật của `GET`.
  - `GET` chia sẻ thêm header `referrer-policy: no-referrer`; web gọi với `referrerPolicy: 'no-referrer'`.
- **Giới hạn của test:**
  - Phép kiểm "không gửi cookie" trên e2e chỉ chắc ở Chromium (WebKit không cho Playwright đọc header cookie cross-origin).
  - Test dead-letter dùng một job cùng việc với `retryLimit: 0`, không chờ hết 8 lượt của job thật.
- **Kiểm chứng của agent code:** `pnpm typecheck`, `pnpm lint:deps`, `pnpm test` (contracts 261, web 207, api 926), `pnpm test:e2e` (754 pass) đều pass. Chưa kiểm tay bằng Mailpit.
- **Kiểm chứng lại ở bước 3 (đọc diff, chạy lại):**
  - `pnpm typecheck`, `pnpm lint:deps`, `pnpm test` (16 + 24 + 60 file) và `pnpm test:e2e` (754 pass, không skip hay flaky) đều exit 0.
  - Mỗi dòng Matrix có test đã chạy:
    - Đơn 0đ/IPN, rollback, enqueue lặp, `orphan` hết chỗ, gửi lúc Đơn đã đổi: `buyer-email-job.test.ts`, `free-order`, `mark-paid-ipn`, `ipn-edge`.
    - Mở link, đã check-in, 404 chung, tạo lại link, chia sẻ lặp: `shared-tickets.test.ts`, `shared-ticket.spec.ts` (14 ca × 2 trình duyệt).
- **Sau review vòng 1 (nhóm A–H trong Review Triage Log):**
  - **A (log worker):** làm khác chỉ dẫn. nestjs-pino 5.3.1 giữ một root logger mỗi tiến trình (module tạo trước thắng), nên log của worker trong test vốn đổ vào `h.logs`, chỉ là `Test.createTestingModule()` thay bằng `TestingLogger` nên bị nuốt.
    - Test worker giờ gọi `moduleRef.useLogger(moduleRef.get(Logger))` như `roles/worker.ts`.
    - Hai test khẳng định có dòng `BuyerEmailWorker` của đúng Đơn rồi mới khẳng định không có email hay token nào trong log.
    - Không thêm tùy chọn log cho `WorkerModule.forRoot`.
  - **B:** "Tạo lại link" ghi token mới vào cache Đơn (`setQueryData`) rồi mới invalidate. E2e có ca tải lại Đơn lỗi mà vẫn chia sẻ link mới.
  - **C, H:** `messageOf` là `switch` theo `kind`. `tickets` bỏ qua khi `event.ended`; `kind` lạ thì ném lỗi (kiểm `never`). Có test cho cả hai.
  - **D:** doc của id job cố định ghi rõ chỉ chặn trùng khi dòng job còn (job xong bị xóa sau `deleteAfterSeconds`, mặc định 7 ngày).
  - **E:** `redactSharedTicketPath` đọc path bằng `new URL(url, 'http://localhost')`, so không phân biệt hoa thường, bỏ host của absolute-form. Test thêm các ca hoa thường, `/` cuối, absolute-form.
  - **F:** e2e `hashchange` (cùng document, `#token1` → `#token2`).
  - **G:** test SMTP lỗi đặt `failFor` trước khi đặt Đơn (`placeOrder`/`freeOrder` nhận `buyer` tùy chọn).
  - Agent code đã thử đột biến: bỏ listener `hashchange` hoặc `setQueryData` thì hai ca e2e mới fail trên cả hai trình duyệt.

## Spec Change Log

## Review Triage Log

Vòng 1 (review_loop_iteration 0). Nguồn: BH = Blind Hunter, EC = Edge Case Hunter, VG = Verification Gap (đã kiểm sẵn).

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | BH | Câu kiểm "log của worker không có email hay token" (`buyer-email-job.test.ts`) đọc `h.logs` (log của api), không đọc log của worker | low | Worker dựng bằng `WorkerModule.forRoot(workerConfig())`, không có đích capture. Hiện worker chỉ log `{jobId, kind, orderId, result}` nên chưa rò, nhưng câu kiểm không chứng minh gì | patch (nhóm A) |
| 2 | BH | "Tạo lại link" bỏ token mới server trả về, chỉ `invalidateQueries` | medium | TanStack giữ data cũ khi tải lại lỗi (mạng di động), nên "Chia sẻ Vé" kế tiếp gửi link vừa bị thu hồi ngay sau toast "Đã tạo link mới" | patch (nhóm B) |
| 3 | BH | `/xem-ve` gặp lỗi mạng/5xx thì báo link không hợp lệ, không có "Thử lại" | low | Đúng như khối frozen ("404, thiếu token hoặc lỗi → `empty-state` …, không nút"), và TanStack đã thử lại 2 lần với lỗi mạng/5xx. Đổi hành vi là đổi ý định đã chốt | reject |
| 4 | BH | `ticketsOfOrder` vẫn trả token khi `share_token_hash` NULL; cột không NOT NULL | low | Chỉ Vé phát trước 3.8 (DB dev) có hash NULL, Design Notes đã chấp nhận. `issueTickets` luôn ghi hash. Backfill lười thêm nhánh ghi trong đường đọc | reject |
| 5 | BH | Token Bearer nằm trong read model chung `ticketsOfOrder`, bên gọi sau này (BTC) có thể lộ | low | Hiện chỉ Trang Đơn của chủ Đơn và worker email gọi, doc comment đã ghi giới hạn. Chưa có bên gọi nào lộ | reject |
| 6 | BH | Email `orphan_sold_out` bị bỏ im lặng khi `organizerContactOf` trả `null` | false | `organizerContactOf` chỉ trả `null` khi không có dòng BTC. Đơn luôn thuộc một BTC có thật và chưa có đường xóa BTC | reject |
| 7 | BH | Người mua trả tiền mà không có Vé vì `event_ended`, `event_locked` hoặc `amount_mismatch` không nhận email nào, chưa có mục theo dõi | medium | Có từ trước 3.8: epics chỉ đòi email cho `sold_out` (AC 3.6). Mục `deferred-work.md` chỉ nhắc trong ghi chú "Đã xử lý" | defer |
| 8 | BH | Email Vé có thể gửi khi Sự kiện đã quá `effective_end_at` (link đều 404); Vé đã hủy vẫn có link | low | `messageOf` có `event.ended` mà chỉ xét `CANCELLED`. Retry trải tới ~2 giờ. Phần Vé hủy: chưa có đường nào hủy Vé của Đơn `paid` (7.1/7.5) | patch (nhóm C, phần đã kết thúc); phần Vé hủy reject |
| 9 | BH | Docstring id job cố định nói enqueue lặp "chỉ có một job" | low | pg-boss chỉ chặn trùng khi dòng job còn trong bảng (trước khi bị xóa theo thời hạn lưu). An toàn ở 3.8 nhờ CAS, nhưng 3.10 sẽ đọc docstring này | patch (nhóm D) |
| 10 | BH | Che token trong log phân biệt hoa thường | low | Express route không phân biệt hoa thường (`identity.module.ts:45`). Serializer log `originalUrl`, nên `/V1/Shared-Tickets/<token>` lọt token. Chỉ request tự dựng mới gặp | patch (nhóm E) |
| 11 | BH | `POST …/share-link` không giới hạn tốc độ, có thể làm đầy audit | low | Cần chủ Vé đã đăng nhập gọi lặp. Sửa phải thêm limiter | reject |
| 12 | BH | Mọi lần tạo Đơn chờ `payments.ready()` | false | Cùng một pg-boss đã bắt buộc qua `queues.ready()` trước TX1, nên không có kiểu lỗi mới | reject |
| 13 | BH | Luật gọi `ready()` trước `markPaid` chỉ nằm trong doc | false | Quên `ready()` thì `boss.send` ném trong `tx` → rollback, lỗi ầm ĩ đúng như mong muốn | reject |
| 14 | BH | Spec `in-review` mà sprint-status `in-progress` | false | Bước trình bày (step 5) đồng bộ sprint-status sang `review` | reject |
| 15 | BH | Diff thiếu `_journal.json`/`0021_snapshot.json`; file SQL không có newline cuối | false | Hai file có trong cây làm việc, chỉ bị loại khỏi diff review vì do máy sinh. 0019, 0020 do drizzle-kit sinh cũng không có newline cuối | reject |
| 16 | BH | Chưa test hai lần tạo lại link đồng thời và nhánh "CAS thua" | low | `FOR NO KEY UPDATE` tuần tự hóa; nhánh ném là phòng thủ cho lỗi lập trình | reject |
| 17 | VG | Đọc lại `#token` khi `hashchange` chưa có test | low | Khoảng trống đã kiểm: bỏ listener thì mọi test `/xem-ve` vẫn pass. Mở link Vé thứ hai trong cùng tab vẫn hiện Vé thứ nhất | patch (nhóm F) |
| 18 | VG | Đường viết hoa và absolute-form vẫn tới controller mà không bị che | low | Như #10 | patch (nhóm E) |
| 19 | VG | Test SMTP lỗi của worker có thể chập chờn | low | Job đã commit ở `freeOrder(1)` trước khi `failFor` được đặt, mà worker đang poll, nên email có thể gửi thành công trước đó. Test anh em (`ownership-transfer-job.test.ts:268`) đặt lỗi trước khi enqueue | patch (nhóm G) |
| 20 | EC | Che token trong log (hoa thường, absolute-form) | low | Như #10 | patch (nhóm E) |
| 21 | EC | Email Vé sau `effective_end_at`; Vé hủy | low | Như #8 | patch (nhóm C, phần đã kết thúc) |
| 22 | EC | `kind` lạ rơi vào nhánh `orphan_sold_out` | low | `messageOf` coi mọi `kind` khác `tickets` là `orphan`. 3.10 thêm loại vào cùng queue sẽ gửi nhầm email hoàn tiền mà không ai biết. Sửa: rẽ nhánh tường minh + kiểm `never` | patch (nhóm H) |
| 23 | EC | IPN thanh toán nào cũng chờ `ready()`, pg-boss chưa sẵn thì 5xx | low | `ready()` ghi nhớ sau lần đầu thành công, nên chỉ gặp lúc khởi động. Tingee gửi lại. Sửa phải đọc trước ngoài `tx` | reject |
| 24 | EC | Backfill hash cho Vé trước 3.8 | low | Như #4 | reject |
| 25 | EC | Màn Thành công vẫn hiện nút chia sẻ sau `effective_end_at` | low | Sau khi Sự kiện kết thúc hầu như không ai chia sẻ Vé. Sửa phải thêm trường vào `BuyerOrderView` | reject |
| 26 | EC | Token cũ sau "Tạo lại link" khi tải lại lỗi | medium | Như #2 | patch (nhóm B) |
| 27 | EC | `/xem-ve` đang mở vẫn hiện thẻ khi lần tải nền trả 404 | low | QR hiện ra vẫn dùng được ở cổng (không `qr_version`). Đổi sang `empty-state` ở mọi lỗi sẽ giấu QR hợp lệ khi mạng chập chờn | reject |
| 28 | EC | `send` id cố định trả `null` vì policy của queue | false | Queue email Người mua không đặt `policy` (mặc định standard), nên `null` chỉ đến từ ON CONFLICT | reject |
| 29 | EC | Câu kiểm log worker đọc log api | low | Như #1 | patch (nhóm A) |
| 30 | EC | Test SMTP lỗi chập chờn | low | Như #19 | patch (nhóm G) |
| 31 | EC | `identity` còn hai bản chép lấy tên lớp lỗi | low | `identity.controller.ts:28`, `totp.service.ts:291` log lỗi TOTP/identity, không phải lỗi job lưu DB. Mục deferred chỉ nói ba chỗ của job email `organizer` | reject |

## Design Notes

- **Worker email ở `ordering`, không ở `integration`:**
  - Theo tiền lệ email của `organizer` (mỗi mô-đun tự gửi qua `EmailTransport`).
  - `ordering` đọc được `ticketing`/`event`/`organizer`, và tự enqueue cả hai loại. Không phải chuyển cấu hình queue qua `contracts` cho hai mô-đun.
  - `integration` vẫn rỗng. Handler không ghi bảng nào: idempotent nhờ id job cố định. Nếu gửi xong mà crash trước khi đánh dấu xong thì có thể gửi lặp một lần (chấp nhận).
- **Trang chia sẻ chạy ở client, token sau `#`:** không SSR, nên token không vào log web, Referer hay ảnh xem trước của Zalo/Messenger. API vẫn nhận token trong đường dẫn (AD-29), nên che trong log.
- **Vé phát trước 3.8** (chỉ có ở DB dev) chưa có hash: link của chúng 404 tới khi chủ Vé "Tạo lại link". Không viết migration tính lại.

## Verification

**Commands:**
- `pnpm test` -- expected: pass (contracts, api với Postgres thật + Tingee fake + `FakeEmailTransport`, web).
- `pnpm typecheck && pnpm lint:deps` -- expected: pass.
- `pnpm test:e2e` -- expected: pass trên ios-webkit và android-chromium.

**Manual checks (if no CLI):**
- `pnpm dev`, đặt Đơn 0đ 2 Vé: Mailpit có một email với 2 link. Mở link ở cửa sổ ẩn danh thấy Vé, không có tên. Bấm "Tạo lại link" thì link cũ hiện "Không tìm thấy Vé".
