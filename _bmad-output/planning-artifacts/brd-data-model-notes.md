# Ghi chú rà soát mô hình dữ liệu – BRD Tickee v1.0

Ngày: 2026-10-27
Nguồn: [brd-tickee.md](brd-tickee.md), mục 10 (Yêu cầu dữ liệu) và Phụ lục A
Dùng cho: `bmad-prd` (chốt câu hỏi nghiệp vụ), `bmad-architecture` (thiết kế schema chi tiết)

## Kết luận

Không cần sửa BRD trước khi làm PRD. Mục 10 là mô hình dữ liệu mức khái niệm, đủ cho BRD. Schema chi tiết (cột, khóa, index, ràng buộc) sẽ chốt ở bước Architecture.

## Điểm đã ổn

- Tiền lưu số nguyên theo đồng; thời gian có múi giờ.
- Mọi bản ghi gắn `organization_id`, cách ly bằng Row Level Security.
- `payment_events` unique theo mã giao dịch → chống xử lý IPN lặp (BR-04).
- `outbox` cho ZNS / email / Sheets, thử lại khi lỗi (EX-09).
- Không lưu Token, tiền, thông tin ngân hàng người mua.
- Chống bán lố và check-in trùng bằng UPDATE có điều kiện (BR-01, BR-08).

## Câu hỏi nghiệp vụ cần chốt trong PRD

| # | Chỗ hở | Câu hỏi | Liên quan |
| :- | :---- | :---- | :---- |
| 1 | Chưa có `order_items`; attendee chưa gắn ticket_type; SQL giữ vé đang `reserved + 1` | Một đơn được mua nhiều vé / nhiều hạng không? Mỗi người dự điền form riêng không? | FR-04, FR-08, BR-01 |
| 2 | Đơn chưa lưu giá tại thời điểm mua và voucher đã áp | Voucher áp cho cả đơn hay từng vé? Có giới hạn mỗi SĐT không? | FR-06 |
| 3 | "Số lượt" voucher cần chống dùng lố giống BR-01 | Lượt voucher có được giữ trong 15 phút như vé không? | FR-06, BR-02 |
| 4 | CTV vào bằng link/mã, không có tài khoản → thiếu bảng lời mời (mã băm, hạn, thu hồi); `checkins` "người quét" chưa rõ trỏ vào đâu | CTV có cần tài khoản hoặc OTP không? | FR-20, mục 12.2 |
| 5 | FR-26 chưa có bảng `reports`; chưa có trạng thái khóa sự kiện / BTC | Quy trình xử lý báo cáo vi phạm, ai xử lý, khóa ở mức nào? | FR-26, R-01 |
| 6 | Muốn cập nhật trạng thái trên Sheets cần lưu dòng nào ứng với đơn nào; OAuth token cần mã hóa | BTC sửa / xóa cột hoặc dòng trong Sheets thì xử lý thế nào? | FR-22, US-06 |
| 7 | Hủy sự kiện + danh sách cần hoàn: đơn chưa có trạng thái "cần hoàn" / "đã hoàn tay" | BTC có đánh dấu đơn đã hoàn tay không? | FR-25, EX-08, D-06 |

## Điểm kỹ thuật để Architecture xử lý

| # | Chỗ hở | Ghi chú |
| :- | :---- | :---- |
| 8 | OTP tra lại vé chưa có chỗ lưu | Bảng OTP hoặc Redis có TTL, giới hạn số lần thử | 
| 9 | Hai nguồn số vé đang giữ: bộ đếm `ticket_types.reserved` và bảng `reservations` | Job nhả vé hết hạn phải giảm `reserved` và xóa / đóng `reservations` trong cùng một transaction; cần cơ chế đối chiếu định kỳ |
