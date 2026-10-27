# Addendum: PRD Tickee

Phần này giữ những nội dung chi tiết thuộc về tài liệu sau (kiến trúc, thiết kế giải pháp), hoặc những nội dung có giá trị nhưng không nằm vừa trong PRD.

## A. Kênh gửi OTP qua SĐT: các phương án đã xem xét (2026-10-27)

Bối cảnh: người mua đăng nhập bằng OTP qua SĐT hoặc Google. MVP chưa dùng Zalo ZNS, nên OTP qua SĐT cần một kênh SMS. BRD chưa có nhà cung cấp SMS nào.

| Phương án | Điểm chính | Ràng buộc |
|---|---|---|
| SpeedSMS: OTP dùng brandname dùng chung "Verify"/"Notify" | Bắt đầu được ngay, không mất phí đăng ký hay duy trì brandname riêng. Có OTP bằng cuộc gọi, rẻ hơn khoảng 50% | Tin nhắn không hiện tên Tickee |
| eSMS: GENCODE đa kênh, gửi Zalo trước rồi mới đến SMS | Mã gửi qua Zalo trước, chỉ trả tiền SMS khi Zalo không gửi được. Hợp với lộ trình bật ZNS sau này | Cần Zalo OA, template Zalo, brandname CSKH và template brandname |
| Stringee: SMS OTP, có Voice OTP | Theo blog của Stringee, khoảng 830đ/SMS OTP và 250–320đ/voice OTP | Brandname CSKH: 50.000đ/nhà mạng (một lần) + 50.000đ/tháng |
| Twilio Verify hoặc Firebase Auth | Quốc tế, dễ tích hợp | Twilio: $0,05/lần xác thực + phí kênh. Firebase PNV chưa hỗ trợ VN |

Lưu ý:
- Giá lấy từ blog và tài liệu của nhà cung cấp, có thể đã cũ. Cần báo giá chính thức cho năm 2026.
- Chi phí OTP SMS (khoảng 800đ/lần) tương đương khoảng 15–25% mức Token tham khảo (3.000–5.000đ/vé). Cần xác định ai chịu khoản này.
- Đăng nhập bằng Google không tốn phí cho mỗi lần đăng nhập.

Nguồn: speedsms.vn/sms-otp-service, developers.esms.vn (GENCODE đa kênh), stringeex.com/vi/blog/post/sms-otp-la-gi, stringeex.com/vi/blog/post/bao-gia-sms-brandname, twilio.com/verify/pricing.
