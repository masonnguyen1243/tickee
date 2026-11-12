# Epic 3 Context: Người mua mua Vé và nhận Vé ngay

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Người mua đi trọn đường từ trang Sự kiện tới Vé trong tay: chọn Vé theo Hạng vé, đăng nhập mà không mất lựa chọn, điền form một lần cho cả Đơn, thanh toán qua Tingee Payment Gateway (redirect toàn trang) rồi tự thấy "Thành công" cùng từng Mã QR vé mà không cần tải lại. Vé đến email, nằm trong "Vé của tôi" và chia sẻ được từng Vé. Sự kiện miễn phí đi trọn luồng mà không qua thanh toán. Mọi khoản tiền về đều có kết cục rõ ràng: hoặc phát Vé, hoặc thành mục Cần xử lý. Không có khoản tiền nào về mà không ai biết. Epic dựng lõi tiền – tồn kho – Vé – realtime mà Epic 4–8 dựa vào, và kết thúc bằng khung Tổng quan tối thiểu để BTC thấy Đơn đầu tiên theo thời gian thực.

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

- **Chọn và đăng nhập:** xem trang Sự kiện không cần đăng nhập. Bấm "Mua" mới bắt đăng nhập, rồi quay về đúng Hạng vé và số lượng đã chọn. Một Đơn gồm nhiều Vé thuộc nhiều Hạng vé. Giới hạn Vé/Đơn đặt theo Sự kiện (mặc định 10) và được kiểm ở server. Tổng tiền chỉ tính ở server, từ giá đã chốt.
- **Không bao giờ bán quá số suất**, kể cả khi 5.000 người cùng mua một Sự kiện 300 Vé. Đơn nhiều Hạng vé được giữ chỗ trọn vẹn hoặc không giữ hạng nào, và báo rõ Hạng vé nào hết.
- **Giữ chỗ 15 phút**, có đếm ngược. Hết hạn thì nhả chỗ và Đơn chuyển "Hết hạn". Tiền về muộn: còn chỗ thì phát Vé, hết chỗ thì vào Cần xử lý và báo Người mua.
- **Miễn phí:** không thanh toán, không tiêu Token, vẫn bắt đăng nhập, phát Vé ngay khi gửi Đơn. Tổng Vé một Người mua nhận trên một Sự kiện miễn phí (cộng mọi Đơn) không vượt giới hạn Vé/Đơn.
- **Thanh toán:** đúng số tiền của Đơn. Màn ghi "Tiền chuyển thẳng cho {BTC}" và hiện chính sách hoàn vé. Tạo link p95 dưới 2 giây. Chỉ phát Vé khi số tiền khớp đúng.
- **IPN:** xác thực chữ ký. Mỗi giao dịch chỉ xử lý một lần: IPN lặp không phát thêm Vé, không gửi thêm email. IPN sai chữ ký bị từ chối và được ghi lại. Ghi thanh toán, phát Vé và lên lịch email diễn ra trọn gói hoặc không diễn ra gì.
- **Realtime:** từ lúc nhận IPN đến lúc Vé hiện trên trình duyệt dưới 3 giây.
- **Vé:** mỗi Vé có một Mã QR ký số; Đơn N Vé có N mã độc lập. Không chuyển nhượng Vé. Người mua không tra được Vé theo SĐT. Email lỗi thì tự thử lại, Vé vẫn hợp lệ, Người mua không thấy lỗi. Sau mốc Sự kiện kết thúc, Vé rời "Vé của tôi" và chỉ còn lịch sử (tên, ngày, đã check-in hay chưa). Dữ liệu phía BTC vẫn giữ nguyên.
- **Đổi giờ hoặc địa điểm** sau khi đã phát Vé → gửi email cho Người mua, mỗi lần sửa đúng một lượt. Chưa phát Vé nào, hoặc chỉ sửa trường khác → không gửi.
- **Dashboard tối thiểu:** doanh thu chỉ tính Đơn đã thanh toán, cộng 5 Đơn gần đây ở mọi trạng thái, cập nhật realtime. Tab Đơn đầy đủ, bộ lọc, CSV và link "Xem tất cả Đơn" thuộc Epic 6.
- **Dữ liệu cá nhân và cách ly:** checkout ghi rõ thông tin trong form sẽ được chia sẻ cho BTC. Không lưu dữ liệu ngân hàng của người trả. Log che SĐT và email. Người mua chỉ thấy Đơn và Vé của chính mình. BTC không đọc được dữ liệu của BTC khác.
- **Đo lường:** phễu mua không chứa PII (`buy_clicked`, `login_completed`, `order_created`, `paid`). Mục tiêu: ≥ 95% Đơn có phí được phát Vé mà không qua Cần xử lý; p95 từ lúc tiền vào đến lúc Vé hiện < 10 giây.

## Technical Decisions

**Sở hữu và ranh giới**

- Phân chia sở hữu:
  - `ordering`: Đơn, dòng Đơn, câu trả lời form kèm nhãn, bản chụp người mua, mã Đơn, link Gateway, tồn kho `ticket_type_inventory`, phễu mua.
  - `payment`: `payment_events` và `review_items`.
  - `ticketing`: Vé, bản chụp trên Vé, Mã QR vé, link chia sẻ.
  - `integration`: gửi email qua `EmailTransport`.
  - `tingee`: adapter duy nhất gọi Tingee, không sở hữu bảng.
- Hướng phụ thuộc: `payment → ordering → ticketing → event → organizer`; `ordering` và `payment` gọi `tingee`. `reporting` chỉ đọc qua read model (view `<module>_read_*` hoặc hàm query xuất từ `index.ts`), không join thẳng bảng của mô-đun khác. `apps/web` chỉ gọi REST `/v1`.

**Lõi tiền, tồn kho và Vé**

- **Chỉ phát Vé trong `ordering.markPaid(tx, orderId, source, paidAmount)`**, với `source` ∈ `ipn`/`reconciliation`/`manual`/`free`. Không bao giờ phát Vé từ `returnUrl` hay từ request của trình duyệt. Mọi bước sau chạy trong một transaction:
  - đọc Sự kiện `FOR SHARE`, compare-and-set Đơn, chạy phép tồn kho;
  - phát N Vé kèm bản chụp: `seq` (1..N, unique theo Đơn), `order_ticket_count`, `holder_name`, `ticket_type_name`, `order_code`, `issued_at`;
  - enqueue email, ghi audit, ghi phễu.
- **Kết quả của `markPaid`:** `paid`, `orphan` (lý do `event_ended`/`event_locked`/`sold_out`), `mismatch`, `event_cancelled`, `duplicate_payment`, hoặc `lost_race` (chỉ nguồn `free`). Chỉ `paid` mới phát Vé. Với `mismatch`, `orphan` và `event_cancelled`, chính `markPaid` chuyển Đơn `pending`/`expired` sang `review`. Với mọi kết quả khác `paid`, bên gọi tạo `review_item` trong cùng `tx`.
- **Tồn kho:** ràng buộc `CHECK (held >= 0 AND sold >= 0 AND sold + held <= capacity)`. Giữ chỗ và bán là UPDATE có điều kiện `… WHERE sold + held + :n <= capacity`. Đơn nhiều Hạng vé cập nhật theo `ticket_type_id` tăng dần; một dòng trả 0 thì rollback cả Đơn. Không dùng Redis. Phép tồn kho theo từng chuyển trạng thái:

  | Chuyển trạng thái | Phép tồn kho |
  | --- | --- |
  | tạo Đơn có phí | `held += n` |
  | Đơn 0đ | `sold += n` |
  | `pending → paid` | `held -= n`, `sold += n` |
  | `pending → expired`/`review`/`cancelled` | `held -= n` |
  | `expired → paid` | bán có điều kiện; thiếu chỗ → `review` loại `orphan` `sold_out` |
  | `paid → cancelled` | không trả chỗ |

- **Đơn là máy trạng thái compare-and-set** (`WHERE status=:from`; 0 dòng nghĩa là thua đua, phải đọc lại). Các trạng thái: `pending`, `paid`, `expired`, `review` (mang loại), `cancelled` (`cancel_reason` `rejected` | `event_cancelled`), `refunded`. Tiền về cho Đơn đã `paid`/`cancelled`/`refunded`/`review` không đổi trạng thái Đơn, chỉ tạo `review_item`.
- **Hết hạn:** lúc tạo, `expires_at` = now + 60 giây; gắn link xong thì bằng hạn link (15 phút). Đơn chuyển `expired` ở điều kiện đầu tiên xảy ra:
  - chưa có link mà đã quá `expires_at`: job hoãn, compare-and-set kèm `payment_link IS NULL`;
  - Tingee xác nhận chưa trả (IPN `canceled`/`expired`);
  - quá `expires_at + 5 phút`.
- **Tạo Đơn có phí** đi theo thứ tự:
  1. TX1: gọi lại `sellability`, giữ chỗ, tạo Đơn `pending` với bản chụp bất biến (giá, tổng, người mua, câu trả lời), mã Đơn `TK` + 8 ký tự Crockford base32.
  2. Commit, rồi tạo link Gateway ngoài transaction (timeout 5 giây).
  3. TX2: gắn link bằng compare-and-set, chụp `orders.payout_account_id`. Checkout URL chỉ trả cho trình duyệt sau khi TX2 commit.

  TX1 không gọi HTTP, không gửi email, không `NOTIFY`. Tingee trả lỗi rõ ràng → được thử lại cùng Đơn trong 60 giây qua `POST /v1/me/orders/:code/payment-link`. Timeout hoặc kết quả mơ hồ → Đơn `expired`, không thử lại với cùng `orderId`.
- **Gateway `create-link`:** ký bằng credential hiện hành của BTC, `vaAccountNumber` = VA của tài khoản nhận tiền mặc định, không gửi `merchantId`, `orderId` = mã Đơn, `expireInMinute` = 15, `returnUrl` = `/orders/:code`. Timestamp ký theo dạng `yyyyMMddHHmmssSSS` UTC+7 (Tingee production từ chối UNIX ms). Gặp `MERCHANT_SUSPENDED`/`TINGEE_CREDENTIAL_INVALID` → Đơn `expired`, Người mua thấy "Sự kiện tạm ngừng bán". Mọi test tự động dùng Tingee fake.

**IPN và Cần xử lý**

- **Endpoint:** mỗi BTC một URL riêng `POST /v1/payments/tingee/ipn/:ipnKey`. Route công khai với guard người dùng và dùng parser raw body riêng.
- **Xác thực:**
  - tìm BTC theo `ipnKey` trước khi đọc body (`ipnKey` lạ → `404`);
  - `x-signature` = HMAC-SHA512(`timestamp + ':' + rawBody`, secret), so bằng `timingSafeEqual`, thử secret hiện hành trước rồi tới các credential cũ. Secret cũ chỉ hợp lệ cho Đơn có `payout_account_id` thuộc đúng credential đó;
  - timestamp lệch quá 10 phút → từ chối.
- **Lưu và phản hồi:** `payment_events` chỉ giữ các field trong whitelist. Khóa unique theo từng BTC: mã giao dịch cho sự kiện thanh toán, `(orderId, status)` cho sự kiện trạng thái. Trùng khóa → trả thành công mà không làm gì. Luôn trả `00` trong dưới 5 giây.
- **Thứ tự kiểm cố định cho tiền về** (Đối soát bù dùng lại), dừng ở nhánh đầu tiên khớp:
  1. `orderId` sai định dạng → chỉ lưu event.
  2. `orderId` không tồn tại, hoặc Đơn thuộc BTC khác → `unmatched`, gắn BTC sở hữu `ipnKey`.
  3. Sự kiện đã hủy → `event_cancelled`.
  4. Đơn đã `paid`/`cancelled`/`refunded`/`review` → `duplicate_payment`.
  5. Lệch số tiền → `amount_mismatch`.
  6. Đơn `expired`, hoặc đã quá mốc kết thúc → tiền về muộn (`orphan`, hoặc bán lại có điều kiện).
  7. Đơn `pending` → `markPaid`. Đơn `pending` của Sự kiện bị khóa vẫn `markPaid`.
- **`review_items`:** luôn có `organization_id`. `payment_event_id` unique, nên mỗi khoản tiền là đúng một mục. Mỗi Đơn tối đa một mục `open` cho `amount_mismatch` và `orphan`. `status` là `open` hoặc `resolved`, kèm `resolution`. `event_cancelled`/`duplicate_payment`/`unmatched` chỉ kết thúc bằng `refunded`/`dismissed`.

**Vé, link chia sẻ, email**

- **Mã QR vé:** dạng `t<k>.<ticketId>.<sig>`, với `sig` = base64url(HMAC-SHA256(key_k, `t<k>.<ticketId>`)). Khóa có phiên bản, mã không chứa PII. Mã không đổi suốt đời Vé (không có `qr_version`).
- **Token link chia sẻ:** 128 bit, suy bằng HMAC từ khóa con của khóa QR theo `share_version` (`ticketing/share-token.ts`). DB chỉ lưu hash và `share_version`. Máy chủ tính lại token khi cần, nên chia sẻ nhiều lần vẫn ra cùng một link.
- **Tạo lại link:** chỉ chủ Vé làm được, có audit. Thao tác tăng `share_version` nên link cũ mất hiệu lực ngay; Mã QR vé không đổi.
- **Xem Vé qua link:** `GET /v1/shared-tickets/:token` không cần đăng nhập. Chỉ trả Mã QR vé, tên Sự kiện, Hạng vé, "Vé k/N" và trạng thái. Token sai, Vé hoặc Sự kiện đã hủy, hay đã quá mốc kết thúc → cùng một `404` chung.
- **Link web:** `/xem-ve#<token>`. Token nằm sau `#`; trang gọi API không kèm cookie, đặt `noindex` và `no-referrer`. Log của api che đoạn token.
- **Email** là job pg-boss enqueue bằng chính `tx` của thay đổi. Payload chỉ chứa id. Handler idempotent theo khóa = loại job + id; email đổi giờ/địa điểm thêm phiên bản Sự kiện vào khóa. Job tự retry, hết retry thì vào dead-letter; gửi qua `EmailTransport`. Email Vé có mỗi Vé một link chia sẻ và một dòng link tới "Vé của tôi" (3.9).
- **Email Người mua đã dựng (Story 3.8):** queue `ordering.send-buyer-email` (+ dead-letter), payload `SendBuyerEmailPayload` `{ kind: 'tickets' | 'orphan_sold_out', orderId }` (contracts), id job cố định `derivedJobId(orderId, '<queue>:<kind>')` nên enqueue lặp không tạo job thứ hai. `markPaid` enqueue `tickets` cho mọi nguồn; nhánh `sold_out` của IPN enqueue `orphan_sold_out`. Worker gửi tới `orders.buyer_email`, bỏ qua khi Đơn không còn `paid` (hay `review` với `orphan_sold_out`) hoặc Sự kiện hủy. 3.10 thêm loại email của mình vào cùng queue.

**Thời gian và trạng thái cho Người mua**

- **`effective_end_at`** (tính theo `Asia/Ho_Chi_Minh`) luôn được so với `now()` ngay tại request, không chờ job. Giá trị này quyết định Vé còn trong "Vé của tôi" hay không, link chia sẻ còn sống hay không, và nhánh tiền về muộn.
- **`BuyerOrderView.buyerStatus`** tính ở máy chủ:

  | Trạng thái Đơn | `buyerStatus` |
  | --- | --- |
  | `pending`, trước `expires_at` | `awaiting_payment` |
  | `pending`, từ `expires_at` | `confirming` |
  | `expired` | `expired` |
  | Sự kiện đã hủy (che mọi trạng thái sau thanh toán) | `event_cancelled` |
  | `paid` | `paid` |
  | `review` | `under_review` |
  | `cancelled`/`refunded` | `cancelled_by_organizer` |

  Vé chỉ có khi `paid`. Response kèm `organizer` (tên và kênh liên hệ BTC), không lộ loại Cần xử lý hay số tiền lệch. Response có hạn chót kèm `serverNow`.

**Realtime**

- **Server:** realtime chỉ là tín hiệu, REST mới là sự thật. `realtime.notify(tx, topic, ids)` (`platform/realtime`, kênh `tickee_realtime`; `RealtimeHub` chỉ ở vai api) phát `NOTIFY` trong cùng transaction, payload `{type, id, organizationId, eventId}`. Hub ở vai api giữ một kết nối `LISTEN`, lọc theo phạm vi rồi đẩy SSE: chỉ `{type}`, gửi `resync` khi nối lại, heartbeat 25 giây.
- **Endpoint SSE:** mỗi tài nguyên mở endpoint riêng, kiểm phiên và quyền như endpoint REST tương ứng, rồi đăng ký với hub bằng bộ lọc trên payload (`hub.open(req, res, filter)`). Đã có: `GET /v1/me/orders/:code/live` (3.7), `GET /v1/me/tickets/live` (3.9); 3.11 mở endpoint của mình theo cùng mẫu.
- **Topic của epic:** `order_changed` chỉ đến Người mua của Đơn. `event_orders_changed` đến Owner/Admin; CTV không được đăng ký.
- **Stream "Vé của tôi" (3.9):** `GET /v1/me/tickets/live` tra id mọi Đơn của người gọi lúc mở rồi lọc `order_changed` theo tập đó (payload không có `userId` và giữ nguyên). Web đưa khóa suy từ tập mã Đơn của danh sách vào đường SSE, nên stream mở lại khi tập đổi.
- **Web:** một hook duy nhất `useLiveResource` (`apps/web/lib/realtime/`) tải REST khi kết nối, khi có tín hiệu (gom trong 1 giây) và khi `visibilitychange`. Không có SSE thì polling: 2 giây ở màn chờ thanh toán, 10 giây ở dashboard.

**Chống trùng, cách ly, quy ước**

- **Chống trùng:** `POST` từ trình duyệt mang `Idempotency-Key`. Tạo Đơn có unique `(user_id, idempotency_key)`; request trùng khóa trả Đơn đã có. Mỗi Người mua tối đa một Đơn `pending` cho mỗi Sự kiện; vi phạm → `409 PENDING_ORDER_EXISTS` kèm mã Đơn. Giới hạn tốc độ tạo Đơn theo user và IP, đếm trong Postgres.
- **Cách ly:** đọc chéo phạm vi chỉ qua `buyerScope` (Người mua), `shareScope` (link chia sẻ) và `orgScope` (BTC). Mọi route mới phải vào bộ test cách ly chạy trong CI.
- **Quy ước:**
  - tiền là `bigint` theo đồng, thời gian là `timestamptz`;
  - schema Zod dùng chung trong `packages/contracts`;
  - lỗi dạng `{error:{code,message,details}}`;
  - mã Đơn là mã duy nhất hiển thị ở mọi nơi;
  - cô lập READ COMMITTED, an toàn đồng thời dựa vào UPDATE có điều kiện và khóa dòng theo thứ tự.
- **Kiểm thử:** Vitest với Postgres thật (đua chỗ cuối, Đơn nhiều hạng thiếu chỗ), test tích hợp với Tingee fake phủ mọi nhánh IPN, Playwright cho trường hợp tab ở nền khi IPN tới.

## UX & Interaction Patterns

- **Mua (trang Sự kiện, Checkout):** `quantity-stepper` bắt đầu ở 0, "+" chặn ở min(số còn lại, giới hạn Vé/Đơn còn lại). `purchase-bar` dính đáy, tổng tiền cập nhật tức thì. Checkout là form một lần cho cả Đơn, lỗi hiện tại từng trường. Hết chỗ → "Hạng vé {tên} vừa hết. Bạn chọn lại nhé." Lỗi mạng → thử lại với cùng `Idempotency-Key`.
- **Màn thanh toán:** stage có số tiền, `countdown-chip` theo `serverNow` (coral, không đổi đỏ) và mã Đơn; `recipient-trust-block`; chân trang "Tickee không giữ tiền của bạn". Thấy đủ mà không cuộn ở 375×667. "Thanh toán" redirect toàn trang, không popup.
- **`/orders/:code`:** đang chờ thì sau khoảng 2 phút hiện `reassurance-line` ("đừng chuyển lại"). Đồng hồ về 0 → "Đang xác nhận thanh toán"; chỉ hiện "Hết hạn" khi API trả `expired`. `under_review` → "BTC đang kiểm tra thanh toán" + liên hệ BTC. `buyerStatus` lạ → trạng thái an toàn, không bao giờ trống hay kẹt.
- **Thành công và `ticket-card`:** stage có "Vé của bạn đã sẵn sàng!" và "Đã gửi Vé tới {email}". `ticket-card` dáng cuống vé, nhãn "Mã QR vé · đưa cho CTV ở cổng", QR module đen trên tấm trắng ≥ 200×200. Thẻ đầu chồng mép stage, trượt lên (tắt khi reduced motion). Mỗi Vé có "Chia sẻ Vé".
- **Vé của tôi (`/tickets`, `GET /v1/me/tickets`):**
  - Ba nhóm: Vé còn hiệu lực (giờ Sự kiện tăng dần) · Đơn đang chờ (mới nhất trước) · Lịch sử (giờ Sự kiện giảm dần). Nhóm rỗng thì ẩn. Tải lần đầu dùng `Skeleton` 2 thẻ. Danh sách không có QR; dòng Vé mở Chi tiết Vé.
  - Trống → "Bạn chưa có vé nào. Vé bạn mua sẽ hiện ở đây.", không có nút khám phá.
  - `order-card` không bao giờ có QR. Các dạng:
    - Chờ thanh toán: `countdown-chip` trên nền sáng (không đọc mốc) đếm theo `serverNow` + "Tiếp tục thanh toán" mở lại đúng Đơn đó. Về 0 thì hiện "Đang xác nhận thanh toán", ẩn nút, thẻ vẫn ở nhóm.
    - "BTC đang kiểm tra thanh toán": badge warning, liên hệ BTC, không có nút chính.
    - Đã hủy (BTC hủy Đơn, Sự kiện hủy): badge neutral, liên hệ BTC, thẻ mờ nhẹ.
    - Hết hạn: API trả Đơn `expired` trong 30 phút sau `expires_at` (đồng hồ DB); badge neutral "Hết hạn", không nút. Web không tự suy ra "Hết hạn".

    Thẻ tự cập nhật qua `order_changed` (stream `/v1/me/tickets/live`; không có SSE thì polling 2 giây khi có Đơn chờ tiền).
  - Lối vào: menu tài khoản, nút "Xem Vé của tôi" cuối màn Thành công, link trong email Vé.
- **Chi tiết Vé (`/tickets/:ticketId`, `GET /v1/me/tickets/:ticketId`):**
  - Web không chỉnh được độ sáng: đang hiện QR thì giữ màn hình không tối bằng Screen Wake Lock (nhả khi rời trang hoặc tab ẩn, xin lại khi tab hiện lại; không hỗ trợ hay bị từ chối thì bỏ qua).
  - Vé đã check-in → QR mờ (.25) + badge "Đã check-in".
  - Vé đã hủy → badge "Đã hủy", không có QR (máy chủ không ký). Sự kiện hủy → "Sự kiện đã hủy. BTC sẽ liên hệ hoàn tiền."; còn lại kênh liên hệ BTC.
  - Sau mốc kết thúc chỉ còn hàng lịch sử ("Đã tham dự"/"Chưa check-in"), không có Mã QR vé, không chia sẻ.
  - Khối "Biên nhận": mã Đơn, "Hạng vé × SL · thành tiền", tổng đã trả (0đ → "Miễn phí"), thời điểm thanh toán, "Tiền đã chuyển thẳng cho {BTC}" (chỉ Đơn có phí). Hiện cả khi Vé đã sang lịch sử.
- **Chia sẻ Vé:** dùng Web Share API, fallback sao chép link kèm toast "Đã sao chép". Tạo lại link qua `Dialog` ghi rõ: ai đã thấy hoặc chụp mã QR vẫn dùng được mã để vào cổng. Link sai, Vé hủy hoặc đã hết hiệu lực → `empty-state` chung, không lộ thông tin.
- **Sửa giờ/địa điểm:** trước khi lưu, `Dialog` báo "Email sẽ được gửi tới {n} Người mua."
- **Tổng quan BTC:**
  - `stat-card` doanh thu: nền stage, số `tabular-nums`.
  - `recent-orders-block`: card sáng; bảng Mã Đơn · Người mua · Vé · Số tiền · Trạng thái · Thời gian. Đơn `review` kèm dòng loại, vd. "Lệch số tiền · nhận 250.000đ / Đơn 300.000đ". Dưới `md` hiển thị dạng thẻ.
  - Mất mạng → toast một lần "Mất kết nối. Đang thử lại…" và nhãn "Cập nhật lúc HH:MM".
- **Tone của `status-badge`:**
  - Đơn: Chờ thanh toán → warning · Đã thanh toán → success · Hết hạn, Đã hủy, Đã hoàn tay → neutral · Cần xử lý → danger.
  - Vé: Hợp lệ → success · Đã check-in → neutral · Đã hủy → danger.

  Badge luôn có chữ.
- **Chung:**
  - Tiền định dạng "300.000đ", dùng `tabular-nums`.
  - Gọi mạng → spinner trong nút, chặn bấm lặp.
  - Không dùng coral để báo lỗi.
  - WCAG 2.2 AA; dùng được ở 320px mà không cuộn ngang; tôn trọng reduced motion.

## Cross-Story Dependencies

- **Từ Epic 1–2:** đăng nhập kèm `returnTo`; `sellability` (gọi lại trong TX1); tồn kho tạo cùng Hạng vé; giới hạn Vé/Đơn; form mua; tài khoản nhận tiền mặc định và credential cũ được giữ lại; `effective_end_at`; khung dashboard; bộ test cách ly. Story 3.10 gắn vào luồng sửa Sự kiện có sẵn của Story 2.12.
- **Trong epic:**
  - 3.2 là nền cho 3.3 và 3.4.
  - 3.3 dựng `markPaid`, phát Vé, Mã QR và màn Thành công; 3.5 và 3.7 dùng lại.
  - 3.6 mở rộng xử lý IPN của 3.5.
  - 3.7 dựng `platform/realtime` và `useLiveResource`; 3.9 và 3.11 mở endpoint SSE riêng trên hub này.
  - 3.8 cấp link chia sẻ và hàng đợi email; 3.9 (Chi tiết Vé, chia sẻ) và 3.10 (email đổi giờ) dùng lại.
- **Epic sau:**
  - 4.1 Đối soát bù đi chung đường xử lý và thứ tự kiểm của 3.5/3.6.
  - 4.2 bật trạng thái dịch vụ thanh toán từ lỗi tạo link của 3.4.
  - 4.4 xử lý `review_items` (tạo trạng thái `cancelled_by_organizer`).
  - Epic 5 check-in dựa trên Vé và Mã QR vé.
  - Epic 6 mở rộng Tổng quan và tab Đơn.
  - 7.1 hủy Sự kiện sinh `event_cancelled`; 7.4 khóa Sự kiện ảnh hưởng nhánh tiền về muộn.
- **Câu hỏi còn mở:** cách tính doanh thu trên dashboard sau khi hủy Sự kiện chưa chốt.
