# Epic 2 Context: BTC thiết lập và mở bán Sự kiện

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Một Tài khoản Tickee tạo BTC và thành Owner, có thể tự bật xác thực hai lớp (2FA), mời Admin, liên kết và đổi tài khoản nhận tiền qua Tingee, chuyển quyền Owner, và được Quản trị Tingee duyệt vào Closed Beta. Trên nền đó Owner/Admin tạo Sự kiện, Hạng vé, form mua vé, mở bán và chia sẻ trang Sự kiện công khai có OG preview. Epic dựng các cơ chế mọi epic sau dựa vào: guard quyền, cách ly dữ liệu giữa các BTC, audit, khung dashboard, nguồn trạng thái bán duy nhất (`sellability`) và nguồn banner duy nhất (`notices`).

## Stories

- Story 2.1: Tạo BTC và khung dashboard
- Story 2.2: Xác thực hai lớp tự bật (TOTP)
- Story 2.3: Landing BTC
- Story 2.4: Mời và xóa Admin
- Story 2.5: Quản trị Tingee duyệt BTC vào Closed Beta
- Story 2.6: Liên kết tài khoản nhận tiền
- Story 2.7: Tạo Sự kiện nháp
- Story 2.8: Hạng vé và tồn kho
- Story 2.9: Cấu hình form mua vé
- Story 2.10: Điều kiện mở bán và mở bán Sự kiện
- Story 2.11: Trang Sự kiện công khai
- Story 2.12: Sửa, ẩn và kết thúc sớm Sự kiện
- Story 2.13: Đổi tài khoản nhận tiền
- Story 2.14: Chuyển quyền Owner

## Requirements & Constraints

- **Vai trò:** mỗi BTC đúng một Owner; một tài khoản thuộc nhiều BTC. Chỉ Owner: liên kết/đổi tài khoản nhận tiền, mời/xóa thành viên, chuyển quyền, mua Token. Owner và Admin cùng quản lý Sự kiện, Hạng vé, form, mở bán/ẩn/kết thúc. Mục chỉ dành cho Owner bị ẩn với Admin; API trả `FORBIDDEN_ROLE`. Mọi thay đổi phân quyền và Sự kiện ghi audit (kèm danh sách trường đổi, không ghi giá trị PII).
- **2FA (TOTP) tự bật cho mọi tài khoản, không bắt buộc kể cả Owner** (thay luật cũ "Owner bắt buộc 2FA"). Owner chưa bật chỉ thấy gợi ý, không bị chặn. Riêng Quản trị Tingee bắt buộc đã bật 2FA và step-up mỗi session.
- **Xác nhận lại:** đổi tài khoản nhận tiền và chuyển quyền Owner luôn đòi xác nhận ngay lúc thao tác (TOTP nếu đã bật 2FA, OTP email nếu chưa), kèm email cảnh báo.
- **Quản trị Tingee:** cờ `platform_admin` chỉ cấp/thu qua CLI; chỉ nhận request từ dải IP `ADMIN_ALLOWED_CIDRS` (thiếu/sai ở production thì api không khởi động); mọi lần đọc chéo BTC ghi audit. Có thao tác "Đặt lại TOTP" cho user mất cả thiết bị lẫn mã khôi phục (bắt buộc lý do, hủy mọi phiên).
- **Closed Beta:** BTC mới ở "chờ duyệt"; chưa duyệt vẫn liên kết tài khoản, tạo nháp, bán Vé 0đ được, nhưng không bán Vé có phí. Thu hồi → mọi Hạng vé có phí "Tạm ngừng bán", Hạng vé 0đ vẫn bán.
- **Tiền:** chưa liên kết tài khoản nhận tiền thì không mở bán Hạng vé có phí; chặn VietinBank (`BANK_NOT_SUPPORTED`); Tickee không lưu số dư hay tiền của BTC.
- **Sự kiện:** thiếu chính sách hoàn vé thì không mở bán. "Ẩn" vẫn mở được bằng link nhưng không nhận Đơn. Tự kết thúc ở mốc muộn hơn của 23:59 ngày kết thúc và giờ kết thúc + 6 giờ; "Kết thúc" sớm được.
- **Hạng vé:** giá có phí ≥ 2.000đ; số suất không giảm dưới đã bán + đang giữ; Sự kiện toàn Hạng vé 0đ trần cứng 200 Vé; giới hạn Vé/Đơn mặc định 10.
- **Trang công khai:** không cần đăng nhập, tải dưới 2 giây trên 4G, "Còn N vé" chính xác, OG đúng ảnh/tên/thời gian trên Facebook/Zalo.
- Tiền `bigint` theo đồng; mốc thời gian `timestamptz`, tính theo `Asia/Ho_Chi_Minh`.

## Technical Decisions

- **Sở hữu mô-đun:** `organizer` (BTC, thành viên, Merchant con, `closed_beta_status`, `payment_service_status`, khóa BTC); `event` (Sự kiện, Hạng vé, giới hạn Vé/Đơn, form, `effective_end_at`); `ordering` (`ticket_type_inventory`, `sellability`); `identity` (2FA, step-up, mã khôi phục, xác nhận lại); `tingee` là adapter duy nhất gọi Tingee, không có bảng. Hướng phụ thuộc: `organizer → identity, tingee`; `event → organizer`; `ordering → event, organizer, tingee`.
- **Quyền và cách ly (đã dựng ở 2.1):** route BTC dưới `/v1/orgs/:orgId/…`, mang `@RequirePermission`; ma trận quyền chỉ khai báo trong `packages/contracts`; truy vấn đi qua `orgScope(ctx)`; bảng thuộc BTC có `organization_id NOT NULL`. Bộ test cách ly CI tự duyệt mọi route có decorator. Đọc chéo chỉ qua các scope có tên (`platformAdminScope` cho `/v1/admin/*`).
- **2FA (đã dựng ở 2.2):** `TOTP_REQUIRED` nằm ở guard toàn cục của `identity` sau `SessionGuard`, không trong `PermissionGuard`; hiệu lực hết session.
- **Xác nhận lại (dựng ở 2.13):** `identity` cấp một lần xác nhận ngắn hạn (5 phút, dùng một lần) sau TOTP hoặc OTP email; thiếu → `REAUTH_REQUIRED`. Không dùng `step_up_at`.
- **Luồng nhiều mô-đun ở `flows/`, một transaction:** `createTicketType` (tạo Hạng vé + tồn kho với `CHECK (held >= 0 AND sold >= 0 AND sold + held <= capacity)`), `changeCapacity` (UPDATE có điều kiện `sold + held <= :c`), `transferOwnership` (unique index một phần "một Owner" phải đúng sau commit: đổi thứ tự cập nhật hoặc ràng buộc deferrable). Kiểm trần 200 Vé khóa mọi dòng tồn kho của Sự kiện `FOR UPDATE` theo thứ tự id.
- **Hiệu ứng phụ:** không gọi Tingee trong transaction DB. Email là job pg-boss enqueue bằng chính `tx`, payload chỉ id, handler idempotent. Token lời mời ngẫu nhiên, DB lưu hash, có hạn.
- **Adapter Tingee:** ký request (thời gian `yyyyMMddHHmmssSSS` UTC+7), secret từ env, timeout, đổi lỗi Tingee thành lỗi miền (`BANK_NOT_SUPPORTED`, `MERCHANT_SUSPENDED`). Test tự động dùng `apps/api/test/tingee-fake`. Đổi tài khoản: Merchant con mới chỉ áp cho Đơn tạo sau; Merchant con cũ giữ lại.
- **Máy trạng thái Sự kiện:** `draft → published ↔ hidden`, `→ cancelled`, compare-and-set. "Đã kết thúc" không lưu thành status, tính từ `effective_end_at` lúc request; có `ended_manually_at` (đã kết thúc sớm thì sửa giờ không tính lại). Nháp và slug sai cùng trả `404 EVENT_NOT_FOUND`.
- **Nguồn sự thật duy nhất:** `event.publishReadiness(eventId)` → `[{code, satisfied}]`, lệnh mở bán gọi lại đúng hàm này ở server. `ordering.sellability(eventId)` → trạng thái theo Hạng vé + `eventReason`. `reporting.notices(scope)` → nguồn duy nhất cho `status-banner`; enum `code` và thứ tự ưu tiên trong `packages/contracts`, web chỉ ánh xạ `code` sang nội dung. Trạng thái dịch vụ thanh toán và khóa chỉ làm "Tạm ngừng bán" sau khi mở bán, không chặn mở bán.
- **Trang công khai và ảnh:** ảnh upload thẳng S3 bằng presigned URL (bucket CORS `GET` cho origin web). `/e/{slug}` SSR revalidate 30 giây và revalidate ngay khi BTC sửa; `GET /v1/events/:slug/availability` cache ≤ 2 giây, gọi lúc tải và khi `visibilitychange`. Ảnh OG do `apps/web` sinh.
- **Form mua:** câu hỏi riêng có id ổn định; câu trả lời Đơn chụp kèm nhãn lúc đặt.

## UX & Interaction Patterns

- **Dashboard:** ≥ `lg` sidebar có BTC switcher ở đầu (cuối danh sách "Tạo BTC mới"); `md`–`lg` thu thành icon; < `md` `bottom-tab-bar` (Sự kiện · Cần xử lý · Quét vé · Thêm). Admin mở URL của Owner → `empty-state` "Chỉ Owner xem được mục này.". Bị xóa giữa phiên → `Dialog` rồi chuyển BTC khác. Tối đa 2 banner, còn lại gộp "+N thông báo"; banner chặn bán không đóng được.
- **Thẻ gợi ý 2FA cho Owner** trên danh sách Sự kiện: đóng được, không dùng `status-banner`.
- **`REAUTH_REQUIRED`** → `Dialog` "Xác nhận để tiếp tục" (TOTP hoặc "Gửi mã tới {email}" + OTP); đúng thì thực hiện thao tác, giữ dữ liệu đã nhập.
- **Wizard tạo Sự kiện** 4 bước (Thông tin → Hạng vé → Form mua → Xem trước & mở bán), "Lưu nháp" mọi bước, quay lại không mất dữ liệu. Bước 4 liệt kê điều kiện thiếu kèm link sửa nhanh; nút "Mở bán" tắt kèm lý do.
- Lỗi tại trường, giữ dữ liệu, "Thử lại". Hành động phá hủy qua `Dialog` nêu hậu quả cụ thể; chuyển quyền Owner yêu cầu gõ tên BTC.
- **Trang Sự kiện công khai:** `event-hero` dạng stage, `ticket-tier-row` (≤ 10 vé chữ `brand-text` đậm) và biến thể unavailable; `status-banner` dưới stage cho Tạm ngừng bán/Ẩn/Bị khóa/Đã hủy/Đã kết thúc; Người mua không thấy banner hệ thống của BTC; desktop 2 cột với thẻ Hạng vé dính.
- **Quản trị Tingee:** desktop, shadcn mặc định; Duyệt/Thu hồi qua `Dialog` nêu hậu quả.

## Cross-Story Dependencies

- 2.1 và 2.2 đã xong: mọi route mới dùng lại guard quyền, `orgScope`, audit, khung dashboard và guard 2FA.
- 2.3 dẫn vào màn tạo BTC qua `returnTo` của Epic 1.
- 2.5 dựng `reporting.notices`, được 2.6, 2.10 và epic sau dùng; 2.5 dựa vào step-up của 2.2.
- 2.6 dựng adapter `tingee` và fake; 2.13 dùng lại form, quy tắc của 2.6 và dựng `REAUTH_REQUIRED`; 2.14 dùng lại xác nhận lại của 2.13 và cần Admin từ 2.4.
- 2.7 → 2.8 → 2.9 → 2.10 nối theo wizard; 2.10 cần Closed Beta (2.5) và liên kết tài khoản (2.6); 2.11 dùng `sellability` của 2.10; 2.12 dùng máy trạng thái và `effective_end_at` của 2.7.
- Epic sau: Epic 3 dùng tồn kho, `sellability`, Merchant con hiện hành; Epic 4 dùng `payment_service_status`; Epic 5 cài `AccessResolver` cho `checkin`; Epic 7 dùng khóa BTC/Sự kiện.
- Phụ thuộc ngoài: API Master Merchant/liên kết tài khoản của Tingee; S3 cho ảnh Sự kiện.
