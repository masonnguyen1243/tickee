# Epic 2 Context: BTC thiết lập và mở bán Sự kiện

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Owner tạo BTC, mời Admin, kết nối tài khoản merchant Tingee của chính BTC để chọn tài khoản nhận tiền và được duyệt vào Closed Beta; Owner/Admin tạo, mở bán và chia sẻ Sự kiện. Epic dựng nền cho các epic sau: guard quyền, audit, cách ly BTC, nguồn trạng thái bán và nguồn banner.

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

- Mỗi BTC đúng một Owner. Chỉ Owner quản lý Tingee, tài khoản nhận tiền và thành viên; Owner và Admin cùng quản lý Sự kiện. BTC không thấy dữ liệu BTC khác; riêng Quản trị Tingee được xem, bắt buộc 2FA, giới hạn IP, audit mọi lần đọc.
- 2FA tự nguyện. Đổi key Tingee, đổi tài khoản nhận tiền, chuyển quyền Owner luôn đòi xác nhận lại và gửi email cảnh báo.
- Mỗi BTC dùng tài khoản merchant Tingee riêng, tự KYC và cấu hình cổng thanh toán trên portal Tingee. Owner nhập Client ID và Secret Token; Tickee đọc danh sách tài khoản để kiểm key rồi cho chọn một tài khoản `active`. Key sai không lưu gì. VietinBank (`970415`) hiện mờ, không chọn được. MVP Tickee chưa thu phí.
- Vé có phí chỉ bán khi Closed Beta đã duyệt và đã có tài khoản nhận tiền; Hạng vé 0đ không cần.
- Thiếu chính sách hoàn vé thì không mở bán. Giá có phí ≥ 2.000đ; số suất ≥ đã bán + đang giữ; Sự kiện miễn phí tối đa 200 Vé.
- Trang công khai không cần đăng nhập, tải dưới 2 giây trên 4G, "Còn N vé" chính xác.
- Mọi thay đổi ghi audit (tên trường, không giá trị PII). Tiền `bigint` theo đồng; thời gian `timestamptz`.

## Technical Decisions

- **Sở hữu:** `organizer` giữ BTC, thành viên, `tingee_credentials` (Secret Token mã hóa, `ipn_key`), `payout_accounts` (VA, ngân hàng, 4 số cuối, tên chủ tài khoản), Closed Beta, `payment_service_status`. `event`: Sự kiện, Hạng vé, form. `ordering`: tồn kho, `sellability`. `tingee`: adapter duy nhất gọi Tingee, không có bảng.
- **Quyền:** `@RequirePermission` dựng `ctx` trước controller; truy vấn qua `orgScope(ctx)`; quyền và mã lỗi ở `packages/contracts`. Bộ test cách ly tự phủ mọi route có `@RequirePermission`.
- **Xác nhận lại:** token một lần, 5 phút, cấp sau TOTP hoặc OTP email (`REAUTH_REQUIRED`).
- **Transaction:** audit ghi cùng `tx`. Không gọi HTTP trong transaction; email là job pg-boss enqueue bằng `tx`.
- **Tingee:** mọi lời gọi nhận credential của một BTC làm tham số. `get-va-paging` ký HMAC-SHA512, timestamp `yyyyMMddHHmmssSSS` UTC+7. Lỗi miền: `TINGEE_CREDENTIAL_INVALID`, `MERCHANT_SUSPENDED`, `PAYMENT_PROVIDER_UNAVAILABLE`, `BANK_NOT_SUPPORTED`. Env chỉ có `TINGEE_BASE_URL` và `TINGEE_CREDENTIAL_KEYS` (khóa AES-256-GCM có phiên bản). Secret Token không trả về web, không ghi log; Client ID hiện dạng che. Test dùng Tingee fake nhiều cặp key.
- **IPN:** mỗi BTC một URL `/v1/payments/tingee/ipn/{ipnKey}`; `ipnKey` ngẫu nhiên 128 bit, không phải secret, không đổi khi đổi key.
- **Đổi key/tài khoản:** chỉ áp cho Đơn tạo sau; credential cũ được giữ cho Đơn đã chụp `orders.payout_account_id`.
- **Sự kiện:** `draft → published ↔ hidden → cancelled`, compare-and-set. "Đã kết thúc" tính từ `effective_end_at`, không lưu. Nháp và slug sai cùng trả `404`.
- **Nguồn duy nhất:** `event.publishReadiness`, `ordering.sellability`, `reporting.notices` (web chỉ ánh xạ `code`).

## UX & Interaction Patterns

- Mục chỉ Owner bị ẩn với Admin; mở bằng URL thấy "Chỉ Owner xem được mục này.". Hỗ trợ theme sáng và tối.
- Banner tối đa 2, còn lại gộp "+N thông báo"; banner danger không đóng được.
- Tài khoản nhận tiền: form key → chọn tài khoản → thẻ đã liên kết kèm URL IPN để sao chép và checklist cấu hình portal. Lỗi hiện tại chỗ, giữ dữ liệu.
- Wizard Sự kiện 4 bước, "Lưu nháp" ở mọi bước; "Mở bán" tắt kèm lý do khi thiếu điều kiện.

## Cross-Story Dependencies

- 2.1 là nền cho cả epic; 2.5 dựng `notices`.
- 2.6 dựng adapter `tingee` và credential mã hóa; 2.13 dùng lại 2.6 và dựng xác nhận lại; 2.14 dùng 2.13 và 2.4.
- 2.10 cần 2.5 và 2.6; 2.11 dùng `sellability`.
- Epic 3 tạo link và nhận IPN bằng credential, VA và `ipnKey` của BTC.
- Tingee chưa trả lời key merchant có gọi được Chi hộ/rút tiền không; câu này chặn bán Vé có phí ở Closed Beta.
