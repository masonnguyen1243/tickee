# Addendum: PRD Tickee

Tài liệu này lưu những nội dung chi tiết thuộc về các tài liệu ở bước sau (kiến trúc, thiết kế giải pháp) và những nội dung có giá trị nhưng không phù hợp để đưa vào PRD.

## A. Kênh gửi OTP qua SĐT: các phương án đã xem xét (2026-10-27)

**Bối cảnh:** lúc đầu dự kiến người mua đăng nhập bằng OTP qua SĐT hoặc Google. Sau khi so sánh, MVP đã chốt chỉ dùng Google hoặc OTP qua email (PRD FR-1). OTP qua SĐT làm sau, cùng đợt bật Zalo ZNS. Bảng dưới đây giữ lại để dùng khi đến đợt đó. BRD chưa chỉ định nhà cung cấp SMS nào.

| Phương án | Điểm chính | Chi phí | Ràng buộc |
|---|---|---|---|
| SpeedSMS: OTP qua brandname dùng chung "Verify"/"Notify" | Dùng được ngay. Có OTP qua cuộc gọi (voice OTP) | Không mất phí đăng ký hay duy trì brandname riêng. Voice OTP rẻ hơn khoảng 50% | Tin nhắn không hiện tên Tickee |
| eSMS: GENCODE đa kênh | Gửi mã qua Zalo trước, SMS làm dự phòng. Hợp với lộ trình bật ZNS sau này | Chỉ trả tiền SMS khi Zalo không gửi được | Cần Zalo OA, template Zalo, brandname CSKH và template brandname |
| Stringee: SMS OTP | Có voice OTP | Theo blog của Stringee: khoảng 830đ/SMS OTP và 250–320đ/voice OTP. Brandname CSKH: 50.000đ/nhà mạng (phí một lần) + 50.000đ/tháng | Cần brandname CSKH |
| Twilio Verify hoặc Firebase Auth | Nhà cung cấp quốc tế, dễ tích hợp | Twilio: $0,05/lần xác thực + phí kênh | Firebase PNV chưa hỗ trợ Việt Nam |

Lưu ý:
- **Chi phí:** mỗi lần gửi SMS OTP tốn khoảng 800đ, tương đương khoảng 15–25% mức Token tham khảo (3.000–5.000đ/giao dịch). Đăng nhập bằng Google không mất phí theo lượt.
- **Câu hỏi mở:** cần xác định ai chịu chi phí SMS OTP.
- **Giá cần xác nhận:** giá lấy từ blog và tài liệu của các nhà cung cấp, có thể đã cũ. Cần xin báo giá chính thức cho năm 2026.

**Nguồn:** speedsms.vn/sms-otp-service, developers.esms.vn (GENCODE đa kênh), stringeex.com/vi/blog/post/sms-otp-la-gi, stringeex.com/vi/blog/post/bao-gia-sms-brandname, twilio.com/verify/pricing.
