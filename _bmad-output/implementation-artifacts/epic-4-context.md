# Epic 4 Context: Thanh toán đáng tin khi có sự cố

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Tiền Người mua đã trả không bao giờ bị lạc, kể cả khi Tingee hay hệ thống gặp sự cố. IPN trễ hoặc mất thì Đối soát bù chủ động hỏi Tingee rồi phát Vé bù. BTC bị ngắt dịch vụ thanh toán thì mọi Hạng vé có phí tự "Tạm ngừng bán", và tự bán lại khi dịch vụ mở. Owner/Admin xử lý từng mục "Cần xử lý" bằng một thao tác. Owner theo dõi Token và được cảnh báo trước khi chạm hạn mức. Đội vận hành nhận cảnh báo trước khi khách phàn nàn. Epic còn dựng staging/production, deploy không mất IPN và diễn tập khôi phục dữ liệu. Hai phần chuyển từ Epic 2 cũng nằm ở đây: giới hạn IP cho `/admin` và ảnh Sự kiện trên object storage. Xong epic là đạt tiêu chí hoàn thành Phase 1 trên sandbox Tingee: mua qua Gateway thành công, không bán quá số suất, IPN lặp không phát Vé trùng, hết Token thì "Tạm ngừng bán". Mọi story còn ở backlog, nên AC trong `epics.md` và spine áp dụng trực tiếp. Riêng hành vi đã ship ở Epic 3 (IPN, `markPaid`, `review_items`, Trang Đơn) thì spec của story đó và spine thắng.

## Stories

- Story 4.1: Đối soát bù khi IPN trễ hoặc mất
- Story 4.2: Tự "Tạm ngừng bán" và tự mở lại khi dịch vụ thanh toán của BTC bị ngắt
- Story 4.3: Hàng "Cần xử lý" của BTC
- Story 4.4: Duyệt tay, từ chối và đánh dấu đã hoàn tay
- Story 4.5: Token và cảnh báo Token
- Story 4.6: Giám sát và lưới an toàn vận hành
- Story 4.7: Môi trường staging/production, deploy và diễn tập khôi phục
- Story 4.8: Ảnh Sự kiện trên object storage

## Requirements & Constraints

- **Đối soát bù:** khi IPN trễ hoặc mất, và khi BTC được mở lại dịch vụ, hệ thống hỏi Tingee trạng thái thanh toán của các Đơn còn mở rồi phát Vé bù.
  - Theo đúng quy tắc chỉ xử lý một lần như IPN: IPN và Đối soát bù cùng đến cho một giao dịch thì chỉ phát Vé một lần, chỉ gửi email một lần.
  - Không lặp vô hạn. Mỗi Đơn có số lần tra tối đa; tra lỗi hoặc kết quả mơ hồ vượt mức thì dừng và cảnh báo vận hành kèm mã Đơn.
- **Tạm ngừng bán:** Tickee không tự tính Token trước. Tickee phát hiện bị ngắt khi tạo link bị từ chối, hoặc khi key hiện hành của BTC không còn dùng được.
  - Hạng vé > 0đ của BTC hiện "Tạm ngừng bán". Hạng vé 0đ vẫn bán.
  - Tự kiểm tra lại định kỳ. Owner bấm "Kiểm tra lại" hoặc lưu key mới được.
  - Dịch vụ mở lại thì Đối soát bù mọi Đơn còn mở của BTC.
  - Thu hồi Closed Beta là trục riêng, không dùng cờ này.
- **Cần xử lý:** có 5 loại: Lệch số tiền, Thanh toán mồ côi, Giao dịch chưa khớp, Thanh toán trùng, Sự kiện đã hủy.
  - Chỉ duyệt tay phát Vé khi còn chỗ, và chỉ với Lệch số tiền hoặc Thanh toán mồ côi.
  - Ghép tay một giao dịch chưa khớp chỉ vào Đơn `expired`/`review` của cùng BTC, có `total_amount` bằng số tiền nhận.
  - Thanh toán trùng, giao dịch không ghép và Sự kiện đã hủy chỉ kết thúc bằng "Đã hoàn tay" hoặc "Bỏ qua" (lý do bắt buộc), không phát Vé.
  - "Đã hoàn tay" trên Thanh toán trùng chỉ đóng mục. Đơn gốc giữ nguyên trạng thái và doanh thu.
  - Sự kiện đã hủy hoặc đã kết thúc thì không duyệt, không ghép được.
  - Mọi thao tác ghi nhật ký: ai làm, lúc nào, quyết định gì.
  - Dashboard hiện số mục đang chờ.
- **Token:** số dư và hạn mức đọc thẳng từ Tingee bằng credential của BTC mỗi lần xem (timeout 3 giây), không lưu. Lỗi thì hiện "Chưa đọc được số dư".
  - Admin chỉ xem. Ngưỡng cảnh báo và "Mua thêm Token" chỉ dành cho Owner.
  - "Mua thêm Token" mở portal Tingee của BTC; Tickee không bán Token.
  - Token xuống dưới ngưỡng: Owner nhận email và thấy banner. Chống gửi lặp theo `(organization, lần vượt ngưỡng)`.
- **Giám sát:** cảnh báo đội vận hành khi:
  - IPN lỗi chữ ký hoặc lỗi xử lý tăng;
  - tỉ lệ phát Vé giảm bất thường;
  - hàng đợi pg-boss ùn hoặc có dead-letter;
  - có Đơn `pending` quá hạn mà chưa xác nhận;
  - p95 tạo link > 2 giây.
- **Sẵn sàng và toàn vẹn:**
  - Checkout, IPN và check-in đạt uptime 99,9%/tháng, đo bằng kiểm tra từ bên ngoài, báo cáo theo tháng.
  - Không mất IPN nào trong lúc deploy.
  - PITR với RPO ≤ 5 phút, RTO ≤ 1 giờ, giữ 14 ngày.
  - Trước Closed Beta phải diễn tập khôi phục và ghi biên bản trong `docs/`. Không đạt RTO thì chưa mở Closed Beta.
- **`/v1/admin/*`** chỉ nhận request từ dải IP trong `ADMIN_ALLOWED_CIDRS`. Ở production, biến này thiếu hoặc sai định dạng thì api không khởi động. IP client lấy qua trusted proxy (`TRUST_PROXY_HOPS`).
- **Ảnh Sự kiện:** JPEG, PNG hoặc WebP, tối đa 5 MB. Ảnh OG dùng ảnh Sự kiện; không có ảnh thì giữ nền gradient.
- **Cách ly:** mọi route mới đi qua bộ test cách ly. BTC khác không đọc được dữ liệu của BTC này; CTV không truy cập được Cần xử lý hay Token.

## Technical Decisions

**Đối soát bù (`payment` sở hữu, chỉ `tingee` gọi HTTP)**

- TX2 gắn link enqueue job hoãn bằng chính `tx` của nó. Payload chỉ chứa id, handler idempotent, hết retry thì vào dead-letter.
- Nhịp tra trạng thái giao dịch trên Gateway theo `orderId` (= mã Đơn):
  - lần đầu sau 2 phút, rồi lặp theo backoff tới khi Đơn rời `pending`;
  - thêm một lần tại `expires_at`. Sau TX2, `expires_at` = `payment_link_attempt_at` (đồng hồ DB) + 15 phút, vì Tingee không trả hạn link;
  - Đơn đã từng có link mà chuyển `expired` thì tra thêm 3 lần, sau 30 phút, 2 giờ và 24 giờ kể từ lúc hết hạn.
- **Credential:** gọi Tingee bằng credential chụp qua `orders.payout_account_id`. Credential này có thể là credential cũ đã gỡ mềm. `organizer` giải mã ngay trước lời gọi. Lời gọi chạy ngoài transaction và có timeout.
- **Kết quả tra đi qua đúng hàm xử lý IPN:**
  - cùng whitelist field;
  - cùng khóa unique của `payment_events` (`(organization_id, providerTransactionCode)` cho thanh toán, `(organization_id, orderId, status)` cho trạng thái);
  - cùng thứ tự kiểm 7 bước.
- **Gọi `markPaid` với `source` = `reconciliation`:** khóa Sự kiện `FOR SHARE` và khóa Đơn `FOR NO KEY UPDATE` như nguồn `ipn`. Hàm xử lý IPN hiện cố định nguồn `ipn`, nên phải nhận nguồn làm tham số.
- **Tingee xác nhận chưa trả và link đã hết hạn:** `payment` gọi `ordering.markExpired(tx, …)`, Đơn chuyển `expired` và nhả chỗ.
- **Credential cũ trả `TINGEE_CREDENTIAL_INVALID`:**
  - dừng tra Đơn đó và cảnh báo vận hành kèm mã Đơn;
  - Đơn hết hạn theo trần cứng (`expires_at` + 5 phút, job của `ordering`);
  - **không** bật `payment_service_status`, nên BTC vẫn bán bằng key mới.
- **Rủi ro mở:** Tingee chưa xác nhận tên endpoint và field của API tra trạng thái theo `orderId`. Tingee cũng chưa xác nhận `providerTransactionCode` có trùng giữa kết quả tra và IPN hay không. Việc chống phát trùng giữa IPN và Đối soát bù dựa vào điểm này. Spec phải ghi phương án dự phòng, và Tingee fake phải giả lập được việc tra trạng thái.

**Trạng thái dịch vụ thanh toán**

- `organizer` sở hữu hai thứ:
  - `payment_service_status`: `active` | `suspended`, `reason` `token` | `tingee_disabled` | `credential_invalid`, `since`, `last_checked_at`;
  - `token_alert_threshold`.
- **Bật cờ:** trong transaction bù sau lời gọi, khi adapter trả `MERCHANT_SUSPENDED`, hoặc khi lời gọi bằng credential **hiện hành** trả `TINGEE_CREDENTIAL_INVALID` (lúc đó `reason` = `credential_invalid`). Bật cờ thì phát `org_status_changed`.
- **Tắt cờ** bằng một trong các đường:
  - job dò `tingee.getMerchantServiceStatus(credential)` mỗi 5 phút khi đang `suspended`;
  - Owner bấm "Kiểm tra lại";
  - Quản trị Tingee tắt;
  - với `credential_invalid`: Owner lưu key mới hợp lệ.

  Tắt cờ thì enqueue Đối soát bù cho mọi Đơn còn mở của BTC.
- `ordering.sellability` là nguồn duy nhất của trạng thái bán; cờ này đang là stub `active`. Cờ chỉ gây "Tạm ngừng bán" sau khi đã mở bán, không chặn `publishReadiness`.
- `reporting.notices(scope)` là nguồn duy nhất cho `status-banner`. Enum `code` và thứ tự ưu tiên khai báo trong `packages/contracts`; web chỉ ánh xạ `code` sang nội dung.

**Cần xử lý**

- **Mô hình `review_items` (`payment` sở hữu):**
  - `organization_id`;
  - `order_id` (null đúng khi loại `unmatched`);
  - `payment_event_id` (unique);
  - loại;
  - `reason` (chỉ có ở `orphan`);
  - `status` `open` | `resolved`;
  - `resolution` `approved` | `rejected` | `refunded` | `dismissed`.

  `tickee_app` chỉ UPDATE được `status` và `resolution`.
- **Duyệt tay** gọi `markPaid(tx, orderId, 'manual', paidAmount)`. Đây là đường riêng, không đi bước 3–7 của IPN (bước 4 sẽ trả `duplicate_payment` cho Đơn `review`).
  - `review` → `paid` bán có điều kiện `+n`. Đơn nhiều Hạng vé chạy trong savepoint.
  - Hết chỗ thì Đơn giữ `review` và mục vẫn `open` kèm lý do.
  - Duyệt ghi `paid_amount` trong cùng transaction, nên một khoản không bao giờ vào cả hai phần của danh sách hoàn tiền.
- **Thao tác của thành viên BTC** (duyệt, từ chối, ghép, hoàn tay):
  - compare-and-set thêm `AND organization_id = :ctxOrg`;
  - `review_item` phải cùng BTC với Đơn;
  - POST kèm `Idempotency-Key`.
- **Ghép** chạy trong một transaction: gắn `payment_events.order_id` vào Đơn, rồi gọi `markPaid` nguồn `manual`. Danh sách Đơn để chọn lấy trong `orgScope`. Audit ghi id giao dịch, Đơn được ghép và người ghép.
- **Tín hiệu realtime:** mọi chỗ mới ghi `orders.status` phát `order_changed` và `event_orders_changed` trong cùng `tx`. Mục thay đổi thì phát `org_review_items_changed`.
- **Đọc dữ liệu:** màn đọc qua read model (hàm query xuất từ `index.ts`, theo mẫu `openReviewsOf`), trong `orgScope`. Audit ghi trong cùng transaction và không chứa PII.

**Vận hành và hạ tầng**

- **Quan sát:** api và worker xuất trace và metrics OpenTelemetry. Log pino kèm `requestId`, `organizationId` và mã Đơn; không có secret hay chữ ký; che SĐT và email.
- **Job định kỳ:**
  - Đối chiếu tồn kho: so `held` với Vé của Đơn `pending`, `sold` với số Vé đã phát. Lệch thì cảnh báo, không tự sửa.
  - Quét cấp phút cho Đơn `pending` đã quá mốc hết hạn mà job hoãn bỏ sót. Đây chỉ là lưới an toàn.
- **Dead-letter:** Quản trị Tingee xem ở `/admin` và requeue từng job; mọi thao tác ghi audit.
- **Môi trường:** có ba môi trường: `local` (Tingee fake), `staging` (UAT) và `production` (PROD).
  - Mỗi nơi một `TINGEE_BASE_URL` và một bộ `TINGEE_CREDENTIAL_KEYS` riêng. Credential Tingee là của từng BTC, không nằm trong env.
  - Secret tiêm từ secret store và kiểm bằng schema Zod của `config`.
  - Có hai role DB: `tickee_migrator` và `tickee_app`.
- **Deploy:**
  - CI thêm Playwright với Tingee fake và bộ test cách ly.
  - Image gắn tag theo commit SHA. Staging tự deploy từ `main`; production deploy thủ công theo tag.
  - Vai `migrate` chạy trước khi đổi `api`/`worker`. Migration luôn tương thích ngược.
  - Topology tối thiểu: ≥ 2 `api` sau load balancer (dùng `/readyz`: DB và `LISTEN`), ≥ 1 `worker`.
  - Khi nhận `SIGTERM`: ngừng SSE mới, đóng SSE đang mở, gọi `boss.stop({ graceful })`.
  - Test hợp đồng với Tingee UAT chạy ở staging bằng một tài khoản merchant UAT, chạy được bằng một lệnh và theo lịch; lỗi thì cảnh báo.
- **Ảnh:**
  - Object storage tương thích S3 (MinIO trong docker-compose ở local). Biến `S3_*` kiểm bằng Zod. Dùng `@aws-sdk/client-s3` cùng presigner. Bucket bật CORS `GET` cho origin web.
  - API cấp presigned PUT với key `orgs/{orgId}/events/{uuid}.{ext}`. Lưu Sự kiện chỉ nhận key đúng tiền tố BTC, vào `events.image_key`, có audit.
  - Ảnh OG do `apps/web` sinh. Không dùng dịch vụ độc quyền của cloud nào.

## UX & Interaction Patterns

- **Người mua** không bao giờ thấy IPN, Đối soát bù hay Token.
  - "Tạm ngừng bán": banner warning dưới stage; stepper và "Mua" tắt.
  - Mọi loại Cần xử lý hiện chung "BTC đang kiểm tra thanh toán" kèm liên hệ BTC, không lộ loại hay số tiền lệch.
  - Đơn bị từ chối: `order-card` "Đã hủy" kèm liên hệ BTC, và Người mua nhận email.
- **Banner dashboard:**
  - Lý do Token: danger, không đóng được, "Mọi Sự kiện có phí đang Tạm ngừng bán". Owner có "Mua thêm Token".
  - `credential_invalid`: danger, không đóng được, "Key Tingee không còn dùng được". Owner có "Nhập lại key" (qua xác nhận lại); Admin thấy "Nhờ Owner cập nhật key Tingee."
  - Token dưới ngưỡng: warning, đóng được.
  - Hiện tối đa 2 banner; phần còn lại gộp "+N thông báo".
  - Thứ tự ưu tiên: Bị khóa > Đã hủy > Closed Beta bị thu hồi > chạm hạn mức Token / key hỏng > chưa liên kết > chờ duyệt Closed Beta > Ẩn / Tạm ngừng bán > mất quyền Google Sheets > Token dưới ngưỡng > Đã kết thúc.
- **Cần xử lý:** mục ở sidebar và `bottom-tab-bar`, gộp mọi Sự kiện, có badge số realtime.
  - `needs-action-row` gồm `status-badge` loại, mã Đơn, Người mua, số nhận / số Đơn (phần chênh tô `danger-text`) và tên Sự kiện.
  - Mở mục thì hiện `Sheet` chi tiết: giao dịch, Đơn liên quan, nhật ký.
  - Hàng trống: "Không có gì cần xử lý."
  - `needs-action-card` ở Tổng quan dẫn sang tab Đơn đã lọc Cần xử lý.
  - Làm xong thì hàng rời hàng đợi kèm toast nêu kết quả cụ thể ("Đã phát {n} Vé cho Đơn {mã}.").
  - "Từ chối" đi qua `Dialog` nêu hậu quả. Nút bị tắt luôn có lý do hiển thị. Nút gọi mạng hiện spinner và chặn bấm lặp.
- **Trang Token:** Admin mở URL dành cho Owner thì thấy `empty-state` "Chỉ Owner xem được mục này."
- **Ảnh:**
  - `event-card` có thumbnail; `event-hero` dùng ảnh thay nền gradient.
  - Sai định dạng hoặc quá dung lượng thì báo lỗi tại chỗ.
  - Upload lỗi thì giữ dữ liệu đã nhập, kèm "Thử lại".

## Cross-Story Dependencies

- **Dựa trên Epic 2–3:**
  - hàm xử lý IPN và `markPaid` (3.5–3.6);
  - `review_items` do 3.6 tạo;
  - Trang Đơn với `useLiveResource` (3.7);
  - Tổng quan Sự kiện (3.11);
  - `sellability` còn stub (2.11);
  - xác nhận lại khi đổi key (2.13).
- **Bàn giao cho 4.1 từ retro Epic 3:**
  - IPN `expired`/`canceled` hiện nhả chỗ ngay, bỏ qua 5 phút ân hạn của trần cứng. 4.1 quyết giữ cách này, hay để Đối soát bù tra lại trước khi nhả.
  - Nguồn `reconciliation` phải truyền được vào hàm xử lý IPN.
  - Trang Đơn thôi polling khi Đơn `expired`, và thẻ "Hết hạn" ở Vé của tôi chỉ hiện 30 phút. Trong khi đó 4.1 tra tiếp tới 24 giờ, nên màn vẫn phải nhận được thay đổi trong cửa sổ này.
- **Trong epic:**
  - 4.1 dùng kênh cảnh báo vận hành của 4.6.
  - 4.2 kích hoạt Đối soát bù của 4.1 khi mở lại dịch vụ. Hành động "Mua thêm Token" trên banner của 4.2 mở portal Tingee như ở 4.5.
  - 4.4 dựng trên hàng và `Sheet` của 4.3.
- **4.6:** phải chốt trước cách chặn giữ chỗ hàng loạt bằng nhiều tài khoản: đặt trần số Vé đang giữ, hay chỉ tạo link khi Người mua bấm "Thanh toán". 4.6 nhận phần cảnh báo; 5.8 đo.
- **4.7:**
  - Checklist deploy: edge phục vụ API bằng HTTP/2, vì nhiều trang giữ SSE dài hạn.
  - Runbook xoay khóa Mã QR vé phải tính cả link chia sẻ: gỡ khóa làm hỏng link, ký lại thì đổi token. Chọn một trong ba: giữ khóa cũ tới khi Vé hết hạn, công cụ ký lại kèm gửi lại email Vé, hoặc tách khóa link chia sẻ.
- **Epic sau:**
  - 6.5 đồng bộ cả Đơn do `markPaid` của Epic 4 phát;
  - 7.1 dựa vào Đối soát bù;
  - 7.2 dùng "Đã hoàn tay" của 4.4 (phần 2 của danh sách hoàn tiền là mọi `review_item` còn `open` gắn Đơn của Sự kiện);
  - 7.4 dùng `notices` và banner;
  - 8.1 dùng ảnh của 4.8.
- **Phụ thuộc ngoài:**
  - Tingee chưa xác nhận API tra trạng thái theo `orderId` (4.1), và API Token cùng trạng thái dịch vụ gọi bằng key merchant (4.2, 4.5). Spec phải ghi phương án dự phòng trước khi làm.
  - Nhà cung cấp hạ tầng, email và giám sát chờ pháp chế (NĐ 53/2022), phải chốt trước Closed Beta (4.6, 4.7).
