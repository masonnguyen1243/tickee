# Epic 6 Context: Báo cáo Đơn và Google Sheets

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Owner/Admin tra cứu được mọi Đơn của Sự kiện ngay trên dashboard, không phải mở sao kê hay Sheet. Tab Đơn đầy đủ gồm câu trả lời form, bộ lọc ở server và phân trang. Tổng quan hiện đủ số liệu: doanh thu theo tiền đã nhận, Vé theo Hạng vé, check-in. BTC xuất CSV mở đúng bằng Excel, và nối Sự kiện với một Google Sheet đồng bộ một chiều, cập nhật trong 1 phút khi Đơn đổi trạng thái hoặc khách check-in. Khi Tickee mất quyền ghi Sheet, BTC được báo để kết nối lại. Epic dựa trên Epic 3 và 4: Đơn do `markPaid` phát qua IPN, Đối soát bù và duyệt tay, cùng trạng thái Cần xử lý, đều phải đồng bộ. Check-in lấy từ Epic 5. Mọi story còn `backlog`, nên AC trong `epics.md` và spine áp dụng trực tiếp. Hành vi đã ship mà epic chạm tới (Tổng quan 3.11, Cần xử lý 4.3–4.4, check-in Epic 5) thì theo spec của story đó và spine. Điều kiện trước epic đã xong: định nghĩa doanh thu chốt ngày 26/11 (E4-5 C1); đối chiếu spec E5-4 và quy trình Build E5-6 đã làm.

## Stories

- Story 6.1: Tab Đơn đầy đủ
- Story 6.2: Số liệu Vé theo Hạng vé trên Tổng quan
- Story 6.3: Xuất CSV danh sách Đơn
- Story 6.4: Kết nối Google Sheets
- Story 6.5: Đồng bộ Đơn và check-in lên Sheet trong 1 phút
- Story 6.6: Mất quyền Google Sheets và kết nối lại

## Requirements & Constraints

- **Phân quyền:** chỉ Owner và Admin xem Đơn, doanh thu, xuất CSV, kết nối hoặc ngắt Sheets. CTV và Người mua không có quyền nào. Mọi route mới nằm trong bộ test cách ly BTC, CTV gọi thì nhận 403.
- **Tab Đơn (FR-31):**
  - cột: Mã Đơn · Người mua (tên, email, SĐT) · Vé theo Hạng vé · Số tiền · Trạng thái · Thời gian tạo/thanh toán;
  - phân trang `cursor` + `limit`, không cuộn vô hạn;
  - lọc ở server theo trạng thái (Đã thanh toán, Chờ thanh toán, Cần xử lý, Đã hủy, Đã hoàn tay), hoặc gõ mã Đơn/email/SĐT. SĐT/email khớp đầy đủ sau chuẩn hóa (E.164, email chữ thường), không khớp một phần. Bộ lọc giữ trên URL;
  - chi tiết Đơn: câu trả lời form kèm nhãn lúc đặt, danh sách Vé (Vé k/N, Hạng vé, trạng thái check-in), lịch sử trạng thái. Không bao giờ hiện Mã QR vé.
- **Tổng quan (6.2):**
  - bảng Vé theo Hạng vé: đã bán · đang giữ chỗ · còn lại / sức chứa;
  - doanh thu chỉ cộng `paid_amount` của Đơn `paid` (tiền đã nhận). Đơn `refunded` và `cancelled` không tính;
  - số liệu cập nhật realtime khi Đơn đổi trạng thái hoặc Vé được check-in.
- **CSV (6.3):**
  - gồm mọi Đơn khớp bộ lọc hiện tại, mỗi Đơn một dòng: đủ trường của danh sách, mỗi câu hỏi form một cột (nhãn lúc đặt), và cột check-in "k/N";
  - UTF-8 có BOM, số tiền là số nguyên VND, thời gian theo `Asia/Ho_Chi_Minh`;
  - giá trị bắt đầu bằng `=`, `+`, `-`, `@`, tab hoặc CR phải được thoát (chống CSV injection);
  - server stream theo cursor, không nạp hết vào bộ nhớ. Chỉ dùng mã Đơn `TK…`, không lộ id nội bộ;
  - mỗi lần xuất ghi audit (ai, Sự kiện, bộ lọc). BTC bị khóa vẫn xuất được.
- **Google Sheets (FR-32):**
  - đồng bộ một chiều. Sửa trên Sheet không ảnh hưởng Tickee;
  - mỗi Sự kiện tối đa một kết nối, tạo ở tab Cài đặt;
  - OAuth riêng với scope `drive.file`, tách khỏi đăng nhập Google. Xong OAuth thì tạo spreadsheet mới trong Drive của người cấp, ghi hàng tiêu đề các cột Tickee quản lý, rồi đẩy toàn bộ Đơn hiện có;
  - mỗi Đơn một dòng, tìm dòng theo cột mã Đơn, thiếu thì thêm. Chỉ ghi các cột Tickee quản lý, không chạm cột BTC tự thêm. BTC chèn, xóa hay sắp xếp lại dòng thì lần sau vẫn ghi đúng dòng;
  - P95 từ lúc Đơn `paid` tới lúc dòng xuất hiện ≤ 1 phút, đo với Google Sheets fake;
  - lỗi tạm thời hoặc quota: trạng thái `retrying`, ghi `last_error_code`, tự thử lại có backoff, không báo BTC. Hết retry thì vào dead-letter và cảnh báo vận hành;
  - mất quyền (`invalid_grant`, người cấp thu hồi quyền, hoặc người cấp bị xóa khỏi BTC): chuyển `auth_revoked`, dừng thử lại, giữ dòng bẩn. Dashboard hiện banner "Mất quyền ghi Google Sheets" + "Kết nối lại", kèm một email báo theo khóa chống gửi lặp;
  - kết nối lại: dùng lại spreadsheet cũ nếu người cấp mới truy cập được, không thì tạo Sheet mới. Flush mọi dòng bẩn rồi về `active`;
  - ngắt kết nối: xóa token, dừng đồng bộ, Sheet giữ nguyên trong Drive, ghi audit.
- **Riêng tư:**
  - refresh token không bao giờ log hay trả về web;
  - log che SĐT/email. Ô tìm của tab Đơn nhận SĐT/email và bộ lọc nằm trên URL, nên request log của web và api phải che giá trị này.

## Technical Decisions

**Mô-đun và ranh giới**

- `reporting` chỉ đọc: tab Đơn, số liệu Tổng quan, CSV, `notices`. `integration` sở hữu kết nối Sheets, bảng dòng bẩn, job flush và email mất quyền (mô-đun sở hữu nghiệp vụ kích hoạt email thì sở hữu mẫu, queue và handler).
- **Hướng phụ thuộc:**
  - `reporting` được gọi `ordering`, `ticketing`, `payment`, `event`, `organizer`, `integration`;
  - `integration` được gọi `ordering`, `ticketing`, `event`, `organizer`, `identity`;
  - không mô-đun nào gọi ngược vào hai mô-đun này. dependency-cruiser kiểm trong CI.
- Đọc chéo chỉ qua read model của mô-đun sở hữu: hàm query xuất ở `index.ts`, theo mẫu `eventRevenueOf`/`recentOrdersOf` của 3.11, lọc được theo cả `organization_id` lẫn `event_id`. Không join thẳng bảng mô-đun khác, không gọi service gây N+1. Màn báo cáo nhiều mô-đun đi qua `reporting`/`integration`, không qua luồng đọc ghép ở `flows/`.
- `ordering` không được gọi `payment`, nên `reporting` ghép loại Cần xử lý vào Đơn bằng `payment.openReviewsOf`.
- **Bản chụp:** màn BTC, CSV và Sheets chỉ đọc bản chụp, trong `orgScope` và `event_id`:
  - trên Đơn: thông tin người mua, câu trả lời form kèm nhãn, `total_amount`, `paid_amount`, `paid_at`;
  - trên Vé: `seq`, `order_ticket_count`, `holder_name`, `ticket_type_name`, `order_code`, `checked_in_at`.
- **Trạng thái:**
  - Đơn: `pending` · `paid` · `expired` · `review` · `cancelled` · `refunded`;
  - check-in là cột `checked_in_at` trên Vé `valid`, không phải một trạng thái. Vé `cancelled` có `cancel_reason`.
- Audit qua `audit.record(tx, …)`, không chứa giá trị cá nhân. Tên action mới dạng `<đối tượng>.<động từ quá khứ>`, khai báo trong union `AuditAction`.

**Doanh thu và tồn kho (6.2)**

- Đổi `ordering.eventRevenueOf` từ `SUM(total_amount)` sang `SUM(paid_amount)` của Đơn `paid`. Đơn 0đ có `paid_amount = 0` và vẫn được đếm.
- Thêm assert `revenue` vào test Duyệt tay lệch tiền: Đơn 300.000đ, nhận 250.000đ → doanh thu 250.000đ. Con số này khớp danh sách hoàn tiền của Epic 7.
- Tồn kho đọc `ticket_type_inventory(capacity, sold, held)` qua read model của `ordering`.

**Realtime**

- Dùng hai topic `event_orders_changed` (Owner, Admin) và `event_checkins_changed` (Owner, Admin, CTV được giao). Payload chỉ có `{type, id, organizationId, eventId}`; REST là sự thật.
- SSE Tổng quan hiện có là `GET /v1/orgs/:orgId/events/:eventId/overview/live`: quyền `orders.view`, trả 404 trước khi mở stream, và chỉ lọc `event_orders_changed`. 6.2 thêm `event_checkins_changed` vào bộ lọc.
- Web dùng `useLiveResource`: gọi REST khi kết nối, khi nhận tín hiệu (gom trong 1 giây) và khi `visibilitychange`. Mất SSE thì polling 10 giây.

**API**

- Route BTC dưới `/v1/orgs/:orgId/events/:eventId/…` với `@RequirePermission`. Schema Zod đặt trong `packages/contracts`. Lỗi dạng `{error:{code,message,details}}`; API trả thời gian ISO 8601 có offset.
- Tab Đơn là chỗ dùng đầu tiên của quy ước `cursor` + `limit`; Epic 4 còn bốn danh sách không phân trang. Spec 6.1 dựng mẫu chung để CSV stream dùng lại.

**Google Sheets**

- **Bảng của `integration`:**
  - kết nối theo Sự kiện, tối đa một kết nối: trạng thái `active` | `syncing` | `retrying` | `auth_revoked`, `last_synced_at`, `last_error_code`, người cấp OAuth;
  - bảng dòng bẩn.
- **Token:** refresh token mã hóa AES-GCM, khóa có phiên bản (ciphertext tiền tố `v<k>:`), theo cùng mẫu `TINGEE_CREDENTIAL_KEYS`. Biến env mới khai báo trong schema Zod của `config`.
- **Kích hoạt:**
  - Đơn chuyển `paid`, `review`, `cancelled` hoặc `refunded`, và mỗi check-in, đều enqueue `integration.sheet_row_changed {eventId, orderId}` bằng chính `tx` (`markPaid`, luồng Cần xử lý, hủy Đơn, `ticketing.checkIn`);
  - mô-đun enqueue theo tên queue khai báo trong `packages/contracts`, không import `integration`;
  - handler chỉ đánh dấu dòng bẩn.
- **Flush:**
  - job theo từng Sự kiện, singleton, tối đa một lần mỗi phút;
  - đọc trạng thái hiện tại qua read model;
  - chỉ xóa đánh dấu sau khi ghi thành công, nên thay đổi đến trong lúc throttle không mất. Không dùng con trỏ `updated_at`.
- **Gọi Google:** không gọi Google API bên trong transaction DB. Ghi Sheets chạy ở vai worker. Dead-letter requeue được từ `/admin`.

**Thông báo**

- `reporting.notices(scope)` là nguồn duy nhất cho `status-banner`. Enum `code` và thứ tự ưu tiên khai báo trong `packages/contracts`; web chỉ ánh xạ `code` sang nội dung. Trong các trạng thái kết nối, chỉ `auth_revoked` sinh thông báo.
- Email mất quyền gửi một lần theo khóa chống gửi lặp của danh mục thông báo. Trường `dedupeKey` trong danh mục hiện chưa có code nào đọc (nợ E4-11). Tiền lệ chống gửi lặp là cảnh báo Token (4.5-b).

**Điểm spec phải chốt**

- **Xóa người cấp khỏi BTC:** khi người cấp OAuth bị xóa, kết nối phải chuyển `auth_revoked` "trong cùng luồng". Nhưng `organizer` không được gọi `integration` (chỉ có cạnh `integration → organizer`), nên cần luồng xóa thành viên ở `flows/`, hoặc cách khác không phá hướng phụ thuộc.
- **Bộ lọc "Cần xử lý":** lọc theo Đơn `review`, hay theo Đơn có mục `review_items` `open`. Hai cách cho số khác nhau: `needs-action-card` đếm mục `open` của Sự kiện, và Đơn `paid` vẫn có thể còn mục `open` (vd. `duplicate_payment`).
- **Cột form trong CSV và Sheet:** câu hỏi có id ổn định nhưng sửa nhãn, sắp lại và xóa được sau khi đã có Đơn. Bản chụp câu trả lời có `questionId`, nhãn và vị trí lúc đặt.
- **Cột Tickee trên Sheet:** spine chỉ chốt tìm dòng theo mã Đơn, chưa nói cách nhận ra cột Tickee khi BTC chèn cột.
- **Đẩy lần đầu:** "toàn bộ Đơn hiện có" có gồm Đơn `pending`/`expired` không. Hai trạng thái này không kích hoạt đồng bộ.
- **Lịch sử trạng thái:** spine không định nghĩa nguồn cho lịch sử trạng thái trong chi tiết Đơn.

## UX & Interaction Patterns

- **Tabs Sự kiện:** Tổng quan · Đơn · Hạng vé · Form mua · Check-in · Cài đặt. Google Sheets nằm ở tab Cài đặt.
- **Tab Đơn:**
  - ≥ `md`: `Table` shadcn phẳng trên `card`, không stage block trong bảng. < `md`: danh sách thẻ;
  - mã Đơn dùng kiểu `code` tabular. Số tiền tabular, căn phải, dạng "300.000đ";
  - `status-badge` Đơn: Chờ thanh toán → warning · Đã thanh toán → success · Hết hạn, Đã hủy, Đã hoàn tay → neutral · Cần xử lý → danger, kèm dòng loại (vd. "Lệch số tiền · nhận 250.000đ / Đơn 300.000đ");
  - `status-badge` Vé: Hợp lệ → success · Đã check-in → neutral · Đã hủy → danger;
  - tự cập nhật khi có Đơn mới, không cần reload, giống `recent-orders-block`;
  - dưới bộ lọc Cần xử lý, UX dùng `needs-action-row` và `Sheet` chi tiết của hàng Cần xử lý (thao tác theo 4.4);
  - chi tiết Đơn mở bằng `Sheet`. Không mở modal chồng modal;
  - khi trống: "Chưa có Đơn nào. Gửi link Sự kiện để bắt đầu bán." + "Sao chép link" (luôn kèm toast "Đã sao chép");
  - nút "Xuất CSV" nằm ở tab Đơn.
- **Tổng quan:**
  - banner ở đầu vùng nội dung;
  - hàng số liệu: `stat-card` doanh thu và `stat-card` check-in đã vào/tổng (stage block; thanh tiến độ nền `stage-line`, phần đầy `brand`), cạnh đó là `needs-action-card` trên `card` sáng, dẫn sang tab Đơn đã lọc Cần xử lý;
  - mỗi màn tối đa 1–2 `stat-card` tối. Số liệu phụ, như bảng Vé theo Hạng vé, dùng `card` sáng;
  - `recent-orders-block` có link "Xem tất cả Đơn".
- **Cài đặt › Google Sheets:**
  - chưa kết nối: nút "Kết nối Google Sheets";
  - đã kết nối: link mở Sheet, trạng thái (Đã kết nối · đang đồng bộ · lỗi/thử lại · mất quyền), `last_synced_at`, và "Ngắt kết nối";
  - "Ngắt kết nối" qua `Dialog` nêu hậu quả cụ thể: dừng đồng bộ, Sheet giữ nguyên trong Drive.
- **Banner mất quyền Sheets:**
  - banner thông tin, đóng được; đóng rồi thì ẩn tới phiên sau hoặc tới khi trạng thái đổi;
  - một hành động "Kết nối lại";
  - ưu tiên mức 8/10: dưới Ẩn/Tạm ngừng bán, trên Token dưới ngưỡng;
  - hiện tối đa 2 banner, còn lại gộp "+N thông báo".
- **Ràng buộc chung:**
  - nút gọi mạng hiện spinner và chặn bấm lặp;
  - nút bị tắt luôn kèm lý do hiển thị;
  - không hỏi "Bạn có chắc?" cho thao tác không phá hủy;
  - một hành động chính mỗi màn;
  - WCAG 2.2 AA, chạy được ở 320px không cuộn ngang, không chỉ dựa vào màu.

## Cross-Story Dependencies

- **Dựa trên phần đã ship:**
  - Tổng quan, `EventOverview`, `eventRevenueOf`, `recentOrdersOf`, SSE Tổng quan và `useLiveResource` (3.7, 3.11);
  - hàng Cần xử lý, `openReviewsOf`, và các thao tác duyệt/từ chối/hoàn tay/ghép (4.3, 4.4). Đây là những chỗ chuyển `review`/`cancelled`/`refunded` mà 6.5 phải enqueue. `needs-action-card` hiện dẫn sang `can-xu-ly?suKien={eventId}`; 6.1 đổi đích sang tab Đơn đã lọc;
  - Đối soát bù (4.1) và duyệt tay cũng gọi `markPaid`;
  - dead-letter và cảnh báo vận hành (4.6);
  - `notices` và `status-banner` (dựng từ 2.5, mở rộng ở Epic 4);
  - `ticketing.checkIn` và `event_checkins_changed` (Epic 5);
  - cách chuẩn hóa SĐT/email khi tra tay (5.5);
  - id câu hỏi form ổn định (2.9).
- **Trong epic:**
  - 6.3 xuất theo bộ lọc và trường của 6.1;
  - 6.2 cùng màn Tổng quan với các link của 6.1;
  - 6.5 cần kết nối và bảng của 6.4;
  - 6.6 dựng trên `auth_revoked`, dòng bẩn và job flush của 6.5.
- **Action item và mục hoãn giao cho epic:**
  - E5-5: thêm cột `checkin_method` (`scan` | `manual`) trên Vé, làm cùng 6.1 hoặc 6.5;
  - mục hoãn giao cho 6.2: Vé mới phát chỉ phát `event_orders_changed`. Khi SSE check-in đang nối, mẫu số N ở tab Check-in và đỉnh Màn quét giữ số cũ tới lần check-in kế tiếp. Hướng sửa: stream check-in lọc thêm `event_orders_changed` cho Owner/Admin, hoặc polling chậm;
  - E4-10: tách `review-queue.tsx`, `payment-service.ts`, `contracts/organizer.ts` trước story đầu tiên chạm lại; dùng `defineCronQueue` chung kèm dead-letter cho queue cron;
  - E5-1: `removeMember` thu hồi `checkers`. Cùng chỗ với việc chuyển `auth_revoked` khi xóa người cấp OAuth (6.6).
- **Epic sau:**
  - 7.1: hủy Sự kiện chuyển Đơn sang `cancelled`, nên phải enqueue `sheet_row_changed`. Sau khi hủy, tab Đơn lọc sẵn Đơn Đã thanh toán chưa "Đã hoàn tay";
  - 7.2: CSV danh sách hoàn tiền dùng chuẩn CSV của 6.3;
  - 7.4: BTC hoặc Sự kiện bị khóa vẫn xem Đơn và xuất CSV;
  - 7.5: doanh thu của 6.2 không tính Đơn có toàn bộ Vé `voided`;
  - 7.6: người đã xóa tài khoản không còn trong danh sách Đơn, CSV và Sheets của Sự kiện sắp diễn ra. Handler ẩn danh enqueue `sheet_row_changed`. Kết nối `auth_revoked` giữ các dòng tồn đọng tới khi kết nối lại.
- **Câu hỏi mở còn treo (giữ mặc định hiện tại):**
  - quyền còn lại của BTC bị khóa: mặc định vẫn xem Đơn, check-in và xuất CSV;
  - thứ tự ưu tiên `status-banner` mới là đề xuất của UX, chờ PM xác nhận.
