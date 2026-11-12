# Epic 3 Context: Người mua mua Vé và nhận Vé ngay

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Người mua đi trọn đường từ trang Sự kiện tới Vé trong tay. Họ chọn Vé theo Hạng vé, đăng nhập khi bấm "Mua" mà không mất lựa chọn, điền form một lần cho cả Đơn, thanh toán qua Tingee Payment Gateway, rồi tự thấy "Thành công" cùng từng Mã QR vé mà không cần tải lại. Vé đến email, nằm trong "Vé của tôi" và chia sẻ được từng Vé. Sự kiện miễn phí đi trọn luồng mà không qua thanh toán. Mọi khoản tiền về đều có kết cục rõ ràng: phát Vé, hoặc thành mục Cần xử lý; không khoản nào về mà không ai biết. Epic dựng lõi tiền, tồn kho, Vé và realtime mà Epic 4–8 dựa vào. Epic khép lại bằng Tổng quan Sự kiện tối thiểu: BTC thấy doanh thu nhảy lên và Đơn đầu tiên hiện ngay, không phải dò sao kê.

## Stories

- Story 3.1: Chọn Vé và đăng nhập khi bấm "Mua"
- Story 3.2: Checkout và Giữ chỗ không bao giờ bán quá số suất
- Story 3.3: Đăng ký Sự kiện miễn phí và nhận Vé ngay
- Story 3.4: Tạo link thanh toán Gateway và màn thanh toán
- Story 3.5: Nhận IPN và phát Vé đúng một lần
- Story 3.6: IPN cho các trường hợp biên
- Story 3.7: Trang Đơn tự chuyển "Thành công" theo thời gian thực
- Story 3.8: Email Vé và link chia sẻ Vé
- Story 3.9: Vé của tôi và Chi tiết Vé
- Story 3.10: Báo Người mua khi Sự kiện đổi giờ hoặc địa điểm
- Story 3.11: Tổng quan Sự kiện thấy Đơn đầu tiên ngay lập tức

## Requirements & Constraints

- **Mua:** xem trang Sự kiện không cần đăng nhập. Bấm "Mua" mới bắt đăng nhập, rồi quay về đúng Hạng vé và số lượng đã chọn. Một Đơn gồm nhiều Vé thuộc nhiều Hạng vé. Giới hạn Vé/Đơn đặt theo Sự kiện (mặc định 10) và được kiểm ở server. Tổng tiền chỉ tính ở server, từ giá đã chốt. Checkout ghi rõ thông tin trong form sẽ được chia sẻ cho BTC.
- **Không bao giờ bán quá số suất**, kể cả khi 5.000 người cùng mua một Sự kiện 300 Vé. Đơn nhiều Hạng vé được giữ chỗ trọn vẹn hoặc không giữ hạng nào, và báo rõ Hạng vé nào hết.
- **Giữ chỗ 15 phút**, có đếm ngược. Hết hạn thì nhả chỗ. Tiền về muộn: còn chỗ thì phát Vé, hết chỗ thì vào Cần xử lý và báo Người mua.
- **Miễn phí:** không thanh toán, không tiêu Token, vẫn bắt đăng nhập, phát Vé ngay khi gửi Đơn. Tổng Vé một Người mua nhận trên một Sự kiện miễn phí không vượt giới hạn Vé/Đơn.
- **Thanh toán:** đúng số tiền của Đơn. Màn ghi "Tiền chuyển thẳng cho {BTC}" và hiện chính sách hoàn vé. Tạo link p95 dưới 2 giây. Chỉ phát Vé khi số tiền khớp đúng.
- **IPN:** xác thực chữ ký. Mỗi giao dịch chỉ xử lý một lần: IPN lặp không phát thêm Vé, không gửi thêm email. Ghi thanh toán, phát Vé và lên lịch email diễn ra trọn gói hoặc không diễn ra gì.
- **Vé:** mỗi Vé có một Mã QR ký số; Đơn N Vé có N mã độc lập. Không chuyển nhượng Vé. Người mua không tra được Vé theo SĐT. Email lỗi thì tự thử lại, Vé vẫn hợp lệ. Sau mốc Sự kiện kết thúc, Vé rời "Vé của tôi" và chỉ còn lịch sử; dữ liệu phía BTC giữ nguyên.
- **Đổi giờ hoặc địa điểm** sau khi đã phát Vé thì gửi email cho Người mua, mỗi lần sửa đúng một lượt.
- **Tổng quan tối thiểu (3.11):** chỉ Owner/Admin xem được. Có `stat-card` doanh thu (chỉ tính Đơn `paid`) và 5 Đơn mới nhất ở mọi trạng thái, tự cập nhật không cần reload. Không thuộc story này: link "Xem tất cả Đơn", tab Đơn, bộ lọc, CSV, `stat-card` check-in, Vé theo Hạng vé (Epic 6); `needs-action-card` (Epic 4).
- **Chỉ tiêu:** từ lúc nhận IPN đến lúc Vé hiện trên trình duyệt dưới 3 giây. ≥ 95% Đơn có phí được phát Vé mà không qua Cần xử lý. p95 từ lúc tiền vào đến lúc có Vé dưới 10 giây. Phễu mua không chứa PII (`buy_clicked`, `login_completed`, `order_created`, `paid`).
- **Dữ liệu cá nhân và cách ly:** không lưu dữ liệu ngân hàng của người trả. Log che SĐT và email. Người mua chỉ thấy Đơn và Vé của mình. BTC không đọc được dữ liệu của BTC khác. CTV không nhận tín hiệu Đơn.

## Technical Decisions

**Ranh giới mô-đun**

- Phân chia sở hữu:
  - `ordering`: Đơn, bản chụp người mua và câu trả lời form, mã Đơn, link Gateway, tồn kho, phễu mua.
  - `payment`: `payment_events` và `review_items`.
  - `ticketing`: Vé, Mã QR vé, link chia sẻ.
  - `integration`: gửi email.
  - `tingee`: adapter duy nhất gọi Tingee, không sở hữu bảng.
  - `reporting`: chỉ đọc.
- Chỉ mô-đun sở hữu được ghi bảng của mình. Mô-đun khác gọi service công khai xuất từ `index.ts` (truyền `tx`) hoặc đọc read model. Luồng ghi nhiều mô-đun trong một transaction nằm ở `flows/`. `apps/web` chỉ gọi REST `/v1`.
- **`reporting` chỉ đọc qua read model** của mô-đun sở hữu: view `<module>_read_*` (nằm trong migration của mô-đun đó) hoặc hàm query xuất từ `index.ts`. Không join thẳng bảng của mô-đun khác, không gọi service theo từng dòng (N+1). Đổi cột thì phải sửa view trong cùng migration.

**Tiền, tồn kho, Vé**

- **Chỉ phát Vé trong `ordering.markPaid(tx, orderId, source, paidAmount)`**, với `source` ∈ `ipn`/`reconciliation`/`manual`/`free`. Không bao giờ phát Vé từ `returnUrl` hay request của trình duyệt.
  - Chỉ kết quả `paid` mới phát N Vé (kèm bản chụp), enqueue email và ghi audit, cùng một transaction.
  - Với `mismatch`, `orphan` và `event_cancelled`, chính `markPaid` chuyển Đơn `pending`/`expired` sang `review`. Với mọi kết quả khác `paid`, bên gọi tạo `review_item` trong cùng `tx`.
- **Tồn kho:** `ticket_type_inventory(capacity, sold, held)` có CHECK. Giữ chỗ và bán là UPDATE có điều kiện `sold + held + :n <= capacity`. Đơn nhiều Hạng vé cập nhật theo `ticket_type_id` tăng dần; một dòng trả 0 thì rollback cả Đơn. Không dùng Redis.
- **Đơn là máy trạng thái compare-and-set:** `pending`, `paid`, `expired`, `review` (mang loại), `cancelled` (`rejected` | `event_cancelled`), `refunded`. UPDATE trả 0 dòng nghĩa là thua đua, phải đọc lại. Tiền về cho Đơn đã `paid`/`cancelled`/`refunded`/`review` không đổi trạng thái Đơn, chỉ tạo `review_item`.
- **Tạo Đơn có phí** đi theo thứ tự:
  1. TX1: gọi lại `sellability`, giữ chỗ, tạo Đơn `pending` với bản chụp bất biến, `expires_at` = now + 60 giây. TX1 không gọi HTTP, không gửi email, không `NOTIFY`.
  2. Commit, rồi tạo link Gateway ngoài transaction (timeout 5 giây).
  3. TX2: gắn link bằng compare-and-set, chụp `payout_account_id`, đặt `expires_at` = hạn link (15 phút).

  Tingee trả lỗi rõ ràng → được thử lại cùng Đơn trong 60 giây. Timeout hoặc kết quả mơ hồ → Đơn `expired`.
- **Hết hạn:** Đơn chuyển `expired` ở điều kiện đầu tiên xảy ra: chưa có link sau 60 giây; Tingee xác nhận chưa trả; hoặc quá `expires_at` + 5 phút.
- **IPN:**
  - Mỗi BTC có URL riêng theo `ipnKey`. Chữ ký HMAC-SHA512 kiểm trên raw body. Timestamp lệch quá 10 phút thì từ chối.
  - `payment_events` chỉ giữ field trong whitelist, có khóa unique theo BTC.
  - Luôn trả `00` trong dưới 5 giây.
- **Thứ tự kiểm cố định cho tiền về** (Đối soát bù dùng lại), dừng ở nhánh đầu tiên khớp:
  1. Mã Đơn sai định dạng → chỉ lưu event.
  2. Đơn không tồn tại, hoặc Đơn thuộc BTC khác → `unmatched`.
  3. Sự kiện đã hủy → `event_cancelled`.
  4. Đơn không còn chờ → `duplicate_payment`.
  5. Lệch số tiền → `amount_mismatch`.
  6. Tiền về muộn → bán lại có điều kiện, hoặc `orphan` (`event_ended`/`event_locked`/`sold_out`).
  7. Đơn `pending` → `markPaid`.
- **`review_items`:** luôn có `organization_id`. Mỗi khoản tiền là đúng một mục. `status` là `open` hoặc `resolved`, kèm `resolution`.
- **Mã Đơn:** `TK` + 8 ký tự Crockford base32. Đây là `orderId` gửi Gateway và là mã duy nhất hiển thị ở mọi nơi. Không đưa id nội bộ ra ngoài.
- **Mã QR vé:** dạng `t<k>.<ticketId>.<sig>` (HMAC-SHA256, khóa có phiên bản). Không chứa PII, không đổi suốt đời Vé.
- **Link chia sẻ:** token 128 bit, DB chỉ lưu hash. Tạo lại thì link cũ mất hiệu lực, Mã QR vé không đổi. Xem không cần đăng nhập và không lộ SĐT, email hay tên. Token sai, Vé đã hủy hoặc đã hết hiệu lực → cùng một `404`.
- **Hiệu ứng phụ** (email, …) là job pg-boss enqueue bằng chính `tx`. Payload chỉ chứa id. Handler idempotent (khóa = loại job + id; thêm phiên bản thực thể khi kích hoạt nhiều lần). Hết retry thì vào dead-letter.

**Thời gian và trạng thái cho Người mua**

- `effective_end_at` (tính theo `Asia/Ho_Chi_Minh`) luôn được so với `now()` ngay tại request, không chờ job.
- `BuyerOrderView.buyerStatus` tính ở server:

  | Trạng thái Đơn | `buyerStatus` |
  | --- | --- |
  | `pending`, trước `expires_at` | `awaiting_payment` |
  | `pending`, từ `expires_at` | `confirming` |
  | `expired` | `expired` |
  | `paid` | `paid` |
  | `review` | `under_review` |
  | `cancelled`/`refunded` | `cancelled_by_organizer` |
  | Sự kiện đã hủy (che mọi trạng thái sau thanh toán) | `event_cancelled` |

  Response không lộ loại Cần xử lý hay số tiền lệch. Response có hạn chót thì kèm `serverNow`.

**Realtime**

- **Nguyên tắc:** realtime chỉ là tín hiệu, REST mới là sự thật. `realtime.notify(tx, topic, ids)` phát `NOTIFY` trong cùng transaction với thay đổi. Payload chỉ gồm `{type, id, organizationId, eventId}`.
- **Hub SSE** (vai api): giữ một kết nối `LISTEN`, lọc theo phạm vi người đăng ký, đẩy SSE chỉ chứa `{type}`, gửi `resync` khi nối lại, heartbeat 25 giây.
- **Endpoint SSE:** mỗi tài nguyên mở endpoint riêng, kiểm phiên và quyền như REST tương ứng, rồi đăng ký với hub bằng bộ lọc trên payload.
- **Topic:**
  - `order_changed` chỉ đến Người mua của Đơn.
  - `event_orders_changed` đến Owner/Admin của BTC, để tải lại Đơn gần đây và số liệu Sự kiện. CTV không được đăng ký.
- **Điểm phát tín hiệu:** `order_changed` được phát ở mọi chỗ đổi trạng thái hoặc link của Đơn sau TX1: `markPaid`, `pending`/`expired` → `review`, hết hạn, TX2 gắn link. Đơn 0đ đi `pending` → `paid` ngay trong TX1 và không phát `order_changed`, nhưng Tổng quan vẫn phải thấy Đơn này realtime.
- **`event_orders_changed` (3.11):** phát trong cùng `tx` ở mọi chỗ phát `order_changed`, và thêm một lần sau khi TX1 tạo Đơn commit (Đơn có phí lẫn Đơn 0đ), bằng một transaction riêng chỉ có `pg_notify`; lệnh này lỗi thì chỉ log. Stream `GET /v1/orgs/:orgId/events/:eventId/overview/live` (`orders.view`) lọc theo `eventId` và `organizationId`.
- **Web:** một hook duy nhất `useLiveResource`. Hook tải REST khi kết nối, khi có tín hiệu (gom trong 1 giây) và khi `visibilitychange`. Không có SSE thì polling: 2 giây ở màn chờ thanh toán, 10 giây ở dashboard.

**Chống trùng, cách ly, quy ước**

- **Chống trùng:** `POST` từ trình duyệt mang `Idempotency-Key`. Mỗi Người mua tối đa một Đơn `pending` cho mỗi Sự kiện; vi phạm → `409 PENDING_ORDER_EXISTS`. Giới hạn tốc độ đếm trong Postgres.
- **Cách ly:**
  - Endpoint của BTC nằm dưới `/v1/orgs/:orgId/…`, có `@RequirePermission`, truy vấn qua `orgScope(ctx)`.
  - Đọc chéo phạm vi chỉ qua `buyerScope`, `shareScope`, `systemScope`, `platformAdminScope`.
  - Mọi route mới có decorator quyền phải vào bộ test cách ly chạy trong CI.
- **Bản chụp:** màn BTC chỉ đọc bản chụp trên Đơn và Vé (người mua, giá, tổng tiền).
- **Quy ước:**
  - tiền là `bigint` theo đồng, thời gian là `timestamptz`;
  - schema Zod, topic và queue khai báo trong `packages/contracts`;
  - lỗi dạng `{error:{code,message,details}}`;
  - cô lập READ COMMITTED, an toàn đồng thời dựa vào UPDATE có điều kiện.
- **Kiểm thử:** Vitest với Postgres thật. Mọi test tự động dùng Tingee fake. Luồng web kiểm bằng Playwright.

## UX & Interaction Patterns

- **Mua:**
  - `quantity-stepper` bắt đầu ở 0; "+" chặn ở min(số còn lại, giới hạn Vé/Đơn còn lại).
  - `purchase-bar` dính đáy.
  - Checkout là form một lần cho cả Đơn, lỗi hiện tại từng trường.
  - Hết chỗ → "Hạng vé {tên} vừa hết. Bạn chọn lại nhé."
- **Màn thanh toán:**
  - Stage có số tiền, `countdown-chip` theo `serverNow` (coral, không đổi đỏ) và mã Đơn.
  - Có `recipient-trust-block` và chân trang "Tickee không giữ tiền của bạn".
  - "Thanh toán" redirect toàn trang, không popup.
- **`/orders/:code`:**
  - Đồng hồ về 0 → "Đang xác nhận thanh toán". Chỉ hiện "Hết hạn" khi API trả `expired`.
  - Chờ khoảng 2 phút → `reassurance-line` dặn "đừng chuyển lại".
  - `buyerStatus` lạ → trạng thái an toàn + kênh liên hệ BTC.
- **Vé và Đơn của Người mua:**
  - `ticket-card` dáng cuống vé, QR module đen trên tấm trắng ≥ 200×200.
  - Vé đã check-in → QR mờ + badge.
  - `order-card` không bao giờ có QR.
- **Tổng quan Sự kiện (3.11):**
  - `stat-card` doanh thu là stage block: nhãn `stage-muted`, giá trị cỡ headline, `tabular-nums`. Dashboard tối đa 1–2 `stat-card` tối.
  - `recent-orders-block` nằm trên `card` sáng phẳng: tiêu đề + bảng Mã Đơn (font code) · Người mua · Vé · Số tiền (tabular, căn phải) · Trạng thái (`status-badge`) · Thời gian.
  - Đơn Cần xử lý kèm dòng loại, vd. "Lệch số tiền · nhận 250.000đ / Đơn 300.000đ". Tên loại: "Lệch số tiền", "Thanh toán mồ côi", "Giao dịch chưa khớp", "Thanh toán trùng", "Sự kiện đã hủy".
  - Dưới `md`, khối hiển thị dạng danh sách thẻ.
  - Đơn mới hiện đầu khối và doanh thu nhảy lên mà không cần reload.
  - Mất mạng → toast một lần "Mất kết nối. Đang thử lại…"; số liệu giữ giá trị cuối kèm nhãn "Cập nhật lúc HH:MM".
- **Tone của `status-badge` cho Đơn:** Chờ thanh toán → warning · Đã thanh toán → success · Hết hạn, Đã hủy, Đã hoàn tay → neutral · Cần xử lý → danger. Badge luôn có chữ.
- **Chung:**
  - Tiền định dạng "300.000đ".
  - Gọi mạng → spinner trong nút, chặn bấm lặp.
  - Không dùng coral để báo lỗi. Toast không dùng cho lỗi chặn luồng.
  - WCAG 2.2 AA; dùng được ở 320px mà không cuộn ngang; tôn trọng reduced motion.

## Cross-Story Dependencies

- **Từ Epic 1–2:** đăng nhập kèm `returnTo`; `sellability` là nguồn duy nhất cho trạng thái bán; tồn kho tạo cùng Hạng vé; form mua; tài khoản nhận tiền mặc định và credential cũ được giữ lại; `effective_end_at`; khung dashboard và tabs cấp Sự kiện; bộ test cách ly.
- **Trong epic:**
  - 3.2 là nền cho 3.3 và 3.4.
  - 3.3 dựng `markPaid`, phát Vé và màn Thành công.
  - 3.5 và 3.6 xử lý IPN.
  - 3.7 dựng `platform/realtime` và `useLiveResource`; 3.9 và 3.11 mở endpoint SSE riêng trên hub này.
  - 3.8 dựng link chia sẻ và hàng đợi email; 3.9 và 3.10 dùng lại.
  - 3.10 gắn vào luồng sửa Sự kiện (flow `updateEvent`).
- **Nhãn trạng thái bán trên dashboard:** đang tự tính riêng và lệch với `sellability`. Mason quyết 12/11 khi lập spec 3.11: chuyển sang 4.2; 3.11 không đổi `event-status.ts`.
- **Epic sau:**
  - 4.1 Đối soát bù dùng chung thứ tự kiểm của IPN.
  - 4.2 bật trạng thái dịch vụ thanh toán từ lỗi tạo link.
  - 4.3 thêm `needs-action-card` (topic `org_review_items_changed`).
  - 4.4 xử lý `review_items`, sinh trạng thái `cancelled_by_organizer`.
  - Epic 5 check-in dựa trên Vé và Mã QR vé.
  - 6.1 và 6.2 thêm link "Xem tất cả Đơn", tab Đơn, `stat-card` check-in và Vé theo Hạng vé.
  - 7.1 hủy Sự kiện sinh `event_cancelled`.
  - 7.4 khóa Sự kiện, ảnh hưởng nhánh tiền về muộn.
- **Câu hỏi còn mở:** chưa chốt cách tính doanh thu trên dashboard sau khi hủy Sự kiện.
