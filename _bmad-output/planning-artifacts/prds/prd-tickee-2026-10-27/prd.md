---
title: Tickee
status: final
created: 2026-10-27
updated: 2026-10-27
---

# PRD: Tickee — MVP v1
*Tên làm việc — cần xác nhận.*

## 0. Mục đích tài liệu

PRD này mô tả các yêu cầu sản phẩm cho MVP của Tickee. Người đọc là đội sản phẩm, kinh doanh, thiết kế, phát triển và kiểm thử. PRD cũng là đầu vào cho các bước tiếp theo: UX, Architecture và chia Epic/Story. PRD kế thừa BRD *Tickee – BRD MVP v1* (26/10/2026) và *Ghi chú rà soát mô hình dữ liệu* (27/10/2026). Khi hai nguồn này khác với PRD, **PRD là bản có hiệu lực**. Các điểm PRD đổi so với BRD được ghi ở §11.3.

Cách đọc tài liệu:
- Mọi thuật ngữ dùng đúng như định nghĩa trong Glossary (§3).
- Tính năng được nhóm ở §4. Mỗi FR mang mã toàn cục FR-1…FR-N, mã này không dùng chung với số FR trong BRD. FR được xếp theo nhóm chức năng, nên FR-38 (§4.1) và FR-37 (§4.2) không nằm theo thứ tự số.
- Phần **Hệ quả** của mỗi FR gồm các điều kiện kiểm thử được.
- FR không ghi mức ưu tiên là Must. Chỉ các FR Should hoặc Could mới được ghi rõ mức ưu tiên.
- Các giả định chưa được xác nhận gắn thẻ `[ASSUMPTION]` ngay tại chỗ và được tổng hợp ở §14.
- Chi tiết kỹ thuật và các phương án đã cân nhắc nằm trong `addendum.md`.

## 1. Vision

Tickee là nền tảng bán vé sự kiện cho các ban tổ chức (BTC) vừa và nhỏ ở Việt Nam, chạy trên hạ tầng thanh toán Tingee. BTC tạo trang Sự kiện trong vài phút và gửi link lên nhóm Zalo hoặc Facebook. Người mua quét VietQR là nhận Vé ngay. Tiền vé chuyển thẳng vào tài khoản của BTC, Tickee không giữ đồng nào. Hệ thống tự khớp từng giao dịch, nên BTC không còn phải dò sao kê hay xem ảnh chụp chuyển khoản. Ngày diễn ra Sự kiện, CTV quét Vé bằng trình duyệt trên điện thoại, không cần cài app.

Tickee thay cho cách làm thủ công hiện nay: Google Forms, ảnh chụp giao dịch, đối chiếu sao kê bằng mắt và điểm danh trên giấy. Phí của Tickee cũng thấp hơn nhiều lần so với các sàn vé lớn. Sàn vé thu 8–15% kèm phí cố định và giữ tiền 7–14 ngày. Tickee chỉ thu phí dịch vụ theo từng giao dịch dưới dạng Token của Tingee.

Đích đến lâu dài: **Tickee là nền tảng đầu tiên giới trẻ nghĩ đến khi muốn tổ chức một sự kiện hay workshop.**

## 2. Người dùng mục tiêu

Các phân khúc trong Closed Beta: thể thao phong trào (Pickleball, cầu lông, bóng đá phủi, chạy CLB), workshop và networking, phòng trà, livehouse, hài độc thoại, sự kiện sinh viên. Quy mô mỗi Sự kiện từ 30 đến 300 khách.

### 2.1 Jobs To Be Done

- **BTC:** "Mở bán vé thật nhanh và nhận tiền ngay vào tài khoản của mình để kịp chi trả chi phí tổ chức, không phải duyệt tay từng người."
- **BTC:** "Biết chính xác ai đã trả tiền và ai đã vào cổng, ai mua là người thật chứ không phải bot. Không sợ bán quá số suất."
- **BTC:** "Không phải trả 10% doanh thu cho sàn vé, chỉ vì cần một cái QR và một danh sách khách."
- **Người mua:** "Mua xong là có vé ngay. Không phải gửi ảnh chụp chuyển khoản rồi chờ BTC nhắn xác nhận."
- **Người mua:** "Yên tâm rằng tiền chuyển thẳng cho BTC, và biết chính sách hoàn vé trước khi trả tiền."
- **CTV:** "Cho khách qua cổng thật nhanh và không nhầm lẫn, chỉ cần cái điện thoại."

### 2.2 Không phải người dùng (v1)

- BTC sự kiện lớn, trên 300 khách mỗi sự kiện, cần sơ đồ chỗ ngồi hoặc bán vé theo bàn.
- Người tìm sự kiện để tham gia. Tickee không phải chợ vé, nên không có trang khám phá sự kiện.
- BTC không có tài khoản tại một trong 14 ngân hàng Tingee hỗ trợ.

### 2.3 Hành trình người dùng chính

- **UJ-1. Minh mua Vé giải Pickleball qua link trên mạng xã hội và nhận Vé ngay trên điện thoại.**
  - **Nhân vật và bối cảnh:** Minh chơi Pickleball phong trào. CLB ABC đăng giải "Đơn nam" giá 300.000đ lên nhóm Zalo và Facebook. Minh muốn mua nhanh vé cho mình và cho bạn đánh đôi.
  - **Điểm vào:** Minh bấm link trên mạng xã hội. Trang Sự kiện công khai mở trên trình duyệt điện thoại, chưa cần đăng nhập.
  - **Diễn biến:**
    1. Minh xem trang Sự kiện và chọn số lượng Vé. Một Đơn có thể gồm nhiều Hạng vé, ví dụ 1 "Đơn nam" và 1 "Đôi nam".
    2. Minh bấm "Mua". Hệ thống yêu cầu đăng nhập Tài khoản Tickee bằng Google hoặc OTP qua email.
    3. Minh điền form mua vé **một lần cho cả Đơn**: Tên, SĐT, email và câu hỏi "Trình độ" của BTC.
    4. Màn hình hiện QR thanh toán đúng số tiền, đếm ngược 15 phút. Minh quét QR hoặc bấm mở app ngân hàng để chuyển khoản.
  - **Cao trào:** Màn hình tự chuyển sang "Thành công" và hiện từng Vé, mỗi Vé có một Mã QR vé riêng. Cùng lúc đó Minh nhận Vé qua email.
  - **Kết thúc:** Các Vé nằm trong "Vé của tôi". Minh gửi một Vé cho bạn đánh đôi để mỗi người tự vào cổng. Minh xem lại Vé trong "Vé của tôi" hoặc trong email, vì Người mua không tra được Vé theo SĐT. Ngày thi đấu, CTV quét từng Vé ở cổng. Sau khi Sự kiện kết thúc, Vé không còn trong "Vé của tôi", chỉ còn lịch sử ghi Minh đã tham dự. → FR-3, FR-12–FR-18, FR-22–FR-25.
  - **Tình huống lỗi:**
    - Minh chưa trả tiền khi QR thanh toán hết hạn. Màn hình báo hết hạn, chỗ được trả lại, Minh phải mua lại từ đầu. → FR-14.
    - Minh chuyển thiếu tiền hoặc ghi sai nội dung chuyển khoản. Hệ thống không phát Vé tự động, Đơn vào hàng "Cần xử lý". → FR-21.
    - Đến cổng Minh không mở được Vé. Minh đọc SĐT hoặc email của Tài khoản Tickee. CTV, Owner hoặc Admin tra theo thông tin đó rồi check-in tay. → FR-29.

- **UJ-2. Anh Tuấn, chủ nhiệm CLB ABC, mở bán giải Pickleball đầu tiên trên Tickee và thấy tiền về thẳng tài khoản CLB.**
  - **Nhân vật và bối cảnh:** Anh Tuấn tổ chức giải phong trào cho CLB. Trước đây anh thu tiền bằng Google Forms rồi dò sao kê. Anh biết đến Tickee qua giới thiệu và quảng cáo của Tingee.
  - **Điểm vào:** Anh chưa có Tài khoản Tickee, mở Tickee từ link giới thiệu của Tingee.
  - **Diễn biến:**
    1. Anh đăng ký Tài khoản Tickee bằng email và tạo BTC, anh là Owner.
    2. Anh liên kết tài khoản nhận tiền của CLB qua Tingee. Hệ thống tạo Merchant con và báo BTC dùng được QR động hay chỉ QR tĩnh. CLB ABC đã được Quản trị Tingee duyệt vào Closed Beta và Closed Beta chưa yêu cầu KYC, nên xong bước này là mở bán được Vé có phí.
    3. Anh tạo Sự kiện: tên, thời gian, địa điểm, mô tả, ảnh, chính sách hoàn vé. Sau đó tạo các Hạng vé với giá, số suất và thời gian mở/đóng bán.
    4. Anh cấu hình form mua vé: các trường mặc định, câu hỏi riêng của BTC và các trường bổ sung.
    5. Anh mở bán và gửi link vào nhóm Zalo và Facebook của CLB.
  - **Cao trào:** Đơn đầu tiên được thanh toán. Tiền vào thẳng tài khoản CLB, Đơn tự duyệt, dashboard hiện ngay tên Người mua. Anh Tuấn không phải dò sao kê.
  - **Kết thúc:** Anh theo dõi doanh thu, số Vé theo Hạng vé và danh sách Người mua trên dashboard, có thể xuất CSV hoặc đồng bộ Google Sheets. Tiền vé đã về được dùng để chi trả chi phí tổ chức trước ngày thi đấu. → FR-1, FR-2, FR-5, FR-37, FR-7–FR-11, FR-31, FR-32.
  - **Tình huống lỗi:** Một Người mua chuyển thiếu tiền. Đơn không được duyệt mà nằm trong hàng "Cần xử lý" chờ anh Tuấn kiểm tra và quyết định. → FR-21.

- **UJ-3. Lan, sinh viên được CLB ABC nhờ soát vé, cho khách qua cổng nhanh chỉ bằng điện thoại.**
  - **Nhân vật và bối cảnh:** Lan là CTV, không thuộc BTC. Sáng ngày thi đấu Lan đứng cổng cùng vài CTV khác.
  - **Điểm vào:** BTC gửi link mời soát vé cho Lan qua email hoặc bất kỳ kênh nào. Lan đăng nhập Tài khoản Tickee để nhận lời mời.
  - **Diễn biến:**
    1. Lan mở link mời và vào màn hình quét của đúng Sự kiện được giao. Lan không thấy dữ liệu nào khác của BTC.
    2. Khách đưa Vé, Lan quét Mã QR vé bằng camera điện thoại.
    3. Vé hợp lệ: báo xanh, "thành công", kèm tên khách và Hạng vé. Vé đã check-in: báo đỏ, có âm thanh, kèm giờ check-in và người quét lần trước. Vé không hợp lệ: báo đỏ, có âm thanh, "vé không hợp lệ".
    4. Nhiều CTV quét song song ở các cổng. BTC theo dõi số người đã vào theo thời gian thực.
  - **Cao trào:** Khách qua cổng liên tục. Mỗi lượt quét Lan chỉ cần liếc: xanh thì cho vào, đỏ thì dừng lại.
  - **Kết thúc:** Sự kiện kết thúc thì quyền soát vé của Lan tự hết. BTC cũng có thể thu hồi quyền này bất kỳ lúc nào. → FR-26–FR-30.
  - **Tình huống lỗi:** Khách không mở được Vé. Lan tra theo SĐT hoặc email của khách, chỉ thấy tên và Hạng vé chứ không thấy Mã QR vé, rồi check-in tay. → FR-29.

## 3. Glossary

- **Tingee** — Hạ tầng thanh toán và đối soát QR mà Tickee chạy trên đó. Tingee là nguồn dữ liệu gốc về tiền và Token, kết nối với 14 ngân hàng.
- **Quản trị Tingee** — Nhân sự vận hành nội bộ của Tingee: hỗ trợ, xử lý báo cáo vi phạm, khóa Sự kiện hoặc BTC.
- **Tài khoản Tickee** — Danh tính đăng nhập của một người. Một tài khoản có thể là Người mua, thành viên của một hay nhiều BTC, hoặc CTV của một hay nhiều Sự kiện. `[ASSUMPTION: Người mua, thành viên BTC và CTV dùng chung một loại Tài khoản Tickee; vai trò gắn theo từng BTC hoặc từng Sự kiện]`
- **BTC (Ban tổ chức)** — Tổ chức bán Vé trên Tickee và là khách hàng trả phí. Mỗi BTC có đúng một Merchant con và có một hoặc nhiều thành viên.
- **Owner** — Thành viên chủ của BTC. Mỗi BTC có đúng một Owner. Chỉ Owner được liên kết tài khoản nhận tiền, quản lý Token và mời hoặc xóa thành viên.
- **Admin** — Thành viên quản lý của BTC. Admin tạo Sự kiện và xử lý Đơn, nhưng không được quản lý tài khoản nhận tiền hay thành viên.
- **CTV (Cộng tác viên soát vé)** — Tài khoản Tickee được BTC mời soát vé cho một Sự kiện cụ thể. Quyền CTV tự hết khi Sự kiện kết thúc. CTV không phải thành viên BTC.
- **Người mua** — Tài khoản Tickee đặt Đơn. Một Người mua có thể mua nhiều Vé trong một Đơn.
- **Master Merchant / Merchant con** — Tickee là Master Merchant trên Tingee. Mỗi BTC là một Merchant con gắn với tài khoản nhận tiền của BTC.
- **Sự kiện** — Một buổi hoặc một giải có thời gian và địa điểm, thuộc một BTC. Mỗi Sự kiện có một hoặc nhiều Hạng vé.
- **Sự kiện kết thúc** — Mốc Sự kiện chuyển sang "Đã kết thúc". Hệ thống tự chuyển vào mốc muộn hơn trong hai mốc: 23:59 của ngày kết thúc đã khai báo, hoặc giờ kết thúc đã khai báo cộng 6 tiếng. Owner hoặc Admin có thể bấm "Kết thúc" sớm hơn. Từ mốc này Vé rời khỏi "Vé của tôi" và quyền CTV hết hạn.
- **Sự kiện miễn phí** — Sự kiện mà mọi Hạng vé đều có giá 0đ. Không tạo QR thanh toán và không tiêu Token.
- **Hạng vé** — Một loại Vé trong Sự kiện, có giá, số suất và thời gian mở/đóng bán.
- **Đơn** — Một lần mua của Người mua trong một Sự kiện. Một Đơn gồm một hoặc nhiều Vé thuộc một hoặc nhiều Hạng vé. Mỗi Đơn có một QR thanh toán và một mã Đơn, mã này cũng là billId trên Tingee. Form mua vé được điền một lần cho cả Đơn.
- **Vé** — Quyền vào cổng của một người, được phát khi Đơn đã thanh toán. Mỗi Vé có một Mã QR vé riêng.
- **Mã QR vé** — Mã QR có chữ ký số trên mỗi Vé, dùng để check-in. Đây không phải QR thanh toán.
- **QR thanh toán** — VietQR dùng để trả tiền cho một Đơn. Có hai loại:
  - **QR động:** gắn số tiền và billId, hết hạn sau 15 phút.
  - **QR tĩnh:** không gắn số tiền, đối soát theo nội dung chuyển khoản có chứa mã Đơn.
- **Giữ chỗ** — Số suất tạm khóa cho một Đơn chưa thanh toán, kéo dài đúng thời hạn QR thanh toán (15 phút).
- **IPN** — Thông báo giao dịch Tingee gửi về Tickee, có kèm số tiền thực nhận.
- **Đối soát bù** — Việc Tickee chủ động hỏi Tingee về trạng thái QR thanh toán khi IPN đến trễ hoặc bị mất.
- **Token** — Đơn vị phí dịch vụ do Tingee quản lý. Tingee trừ Token mỗi khi gửi IPN về một giao dịch. Token không quy đổi ngược ra tiền và không chuyển nhượng được.
- **Token khả dụng** — Số dư Token cộng hạn mức âm (hoặc hạn mức trả sau), trừ đi số Đơn đang Chờ thanh toán (cả QR động lẫn QR tĩnh) nhân với mức trừ mỗi giao dịch.
- **Cần xử lý** — Hàng các giao dịch hoặc Đơn mà hệ thống không tự phát Vé được, gồm ba loại: "Lệch số tiền", "Thanh toán mồ côi" (tiền về sau khi đã trả lại chỗ mà Hạng vé đã hết, với cả QR động lẫn QR tĩnh) và "Giao dịch chưa khớp".
- **Closed Beta** — Giai đoạn chạy thật với 2–5 Sự kiện của các BTC được mời, trước khi mở công khai.
- **Closed Beta được duyệt** — Trạng thái của một BTC đã được Quản trị Tingee duyệt vào Closed Beta. Chỉ BTC có trạng thái này mới bán được Vé có phí trước khi mở công khai.
- **Vé của tôi** — Trang của Người mua liệt kê các Vé còn hiệu lực và lịch sử các Sự kiện đã tham dự.
- **Check-in** — Lượt xác nhận một Vé đã vào cổng. Mỗi Vé chỉ check-in thành công một lần.

**Trạng thái Đơn:**

| Trạng thái | Ý nghĩa |
|---|---|
| Chờ thanh toán | Đang Giữ chỗ, QR thanh toán còn hiệu lực |
| Đã thanh toán | Đã khớp IPN và phát Vé |
| Hết hạn | QR thanh toán hết hạn khi chưa trả tiền, đã trả lại chỗ. Nếu tiền về muộn sau đó, Đơn chuyển sang Đã thanh toán (còn chỗ) hoặc Cần xử lý (hết chỗ) |
| Cần xử lý | Lệch số tiền, Thanh toán mồ côi hoặc Giao dịch chưa khớp |
| Đã hủy | Sự kiện bị hủy, hoặc BTC từ chối Đơn đang Cần xử lý |
| Đã hoàn tay | BTC tự chuyển hoàn tiền ngoài hệ thống rồi đánh dấu |

**Trạng thái Vé:** Hợp lệ → Đã check-in, hoặc Hợp lệ → Đã hủy.

**Trạng thái Sự kiện:** Nháp → Đang mở bán → Đã kết thúc. Từ trạng thái Đang mở bán, Sự kiện có thể chuyển sang Ẩn, Đã hủy, hoặc Bị khóa (do Quản trị Tingee). "Tạm ngừng bán" không phải một trạng thái riêng. Đây là thông báo hiện trên Sự kiện đang mở bán khi hệ thống tạm thời không tạo được QR thanh toán, vì Token khả dụng không đủ (FR-15) hoặc vì BTC bị thu hồi trạng thái Closed Beta được duyệt (FR-37).

`[ASSUMPTION: danh sách trạng thái Đơn, Vé và Sự kiện do PM đề xuất; Architecture chốt máy trạng thái chi tiết]`

## 4. Tính năng

### 4.1 Tài khoản và phân quyền

**Mô tả:** Mọi người dùng đăng nhập bằng Tài khoản Tickee. Ở MVP có hai cách đăng nhập: Google, hoặc OTP gửi qua email. OTP qua SĐT sẽ có ở bản sau, cùng lúc bật Zalo ZNS. Người mua chỉ phải đăng nhập khi bấm "Mua". Việc bắt buộc đăng nhập giúp BTC biết Người mua là người thật chứ không phải bot, đồng thời cho Người mua có trang "Vé của tôi". Hiện thực hóa UJ-1, UJ-2, UJ-3.

#### FR-1: Đăng ký và đăng nhập Tài khoản Tickee
Người dùng đăng ký và đăng nhập Tài khoản Tickee bằng Google hoặc OTP qua email. BTC đăng ký bằng email.

**Hệ quả:**
- OTP qua email chỉ dùng được một lần, có thời hạn và giới hạn số lần nhập sai. `[ASSUMPTION: OTP hiệu lực 5 phút, tối đa 5 lần nhập sai]`
- Không có luồng đăng nhập bằng mật khẩu hay bằng SĐT ở MVP.
- Owner bắt buộc bật xác thực hai lớp (2FA). `[ASSUMPTION: giữ yêu cầu 2FA cho Owner như BRD; phương thức do Architecture chọn]`
- Dù đăng nhập bằng cách nào, cùng một email luôn ra cùng một Tài khoản Tickee.

**Ngoài phạm vi:** đăng nhập bằng OTP qua SĐT, SSO tài khoản Tingee `[ASSUMPTION: SSO Tingee để sau MVP]`.

#### FR-2: Tạo BTC và quản lý thành viên
Một Tài khoản Tickee có thể tạo BTC và trở thành Owner. Owner mời hoặc xóa Admin.

**Hệ quả:**
- Chỉ Owner được mời hoặc xóa thành viên.
- Một Tài khoản Tickee có thể là thành viên của nhiều BTC và chuyển qua lại giữa các BTC.
- Mọi thay đổi về phân quyền đều được ghi nhật ký (NFR-11).

#### FR-3: Đăng nhập khi mua
Người mua xem trang Sự kiện mà không cần đăng nhập. Khi bấm "Mua", hệ thống yêu cầu đăng nhập rồi đưa Người mua quay lại đúng Hạng vé và số lượng đã chọn. Hiện thực hóa UJ-1.

**Hệ quả:**
- Lựa chọn Hạng vé và số lượng vẫn còn sau khi đăng nhập xong.
- Email trong form mua vé được tự điền từ Tài khoản Tickee.
- Người dùng đồng ý điều khoản xử lý dữ liệu cá nhân theo NĐ 13/2023 khi tạo Tài khoản Tickee. Trang Checkout ghi rõ thông tin trong form sẽ được chia sẻ cho BTC của Sự kiện. `[ASSUMPTION: PM đề xuất, thay cho việc thu đồng ý ở mỗi lần Checkout như BRD — chờ pháp chế xác nhận]`

#### FR-38: Xóa Tài khoản Tickee và rút lại đồng ý
Người dùng yêu cầu xóa Tài khoản Tickee hoặc rút lại đồng ý xử lý dữ liệu cá nhân. `[ASSUMPTION: PM đề xuất, bổ sung theo NĐ 13/2023]`

**Hệ quả:**
- Sau khi xóa, người đó không đăng nhập được nữa và không còn xuất hiện trong dữ liệu Người mua của các Sự kiện sắp diễn ra.
- Dữ liệu giao dịch mà pháp luật bắt buộc lưu vẫn được giữ, ở dạng tối thiểu. Thời hạn lưu do pháp chế chốt.
- Nếu Tài khoản Tickee còn Vé hợp lệ của Sự kiện chưa diễn ra, hệ thống cảnh báo trước khi xóa.

#### FR-4: Ma trận phân quyền

| Chức năng | Owner | Admin | CTV | Người mua |
|---|---|---|---|---|
| Liên kết tài khoản nhận tiền | Có | Không | Không | Không |
| Xem số dư Token, mua Token | Có | Chỉ xem | Không | Không |
| Mời hoặc xóa thành viên | Có | Không | Không | Không |
| Tạo, sửa, ẩn, hủy Sự kiện | Có | Có | Không | Không |
| Xem Đơn, doanh thu, xuất CSV, kết nối Sheets | Có | Có | Không | Không |
| Xử lý hàng "Cần xử lý" | Có | Có | Không | Không |
| Mời hoặc thu hồi CTV | Có | Có | Không | Không |
| Quét check-in | Có | Có | Sự kiện được giao | Không |
| Tra Vé theo SĐT/email tại cổng | Có | Có | Sự kiện được giao, không thấy Mã QR vé | Không |
| Xem Vé | – | – | – | Vé của mình |

Quản trị Tingee không thuộc BTC nào. Quản trị Tingee có quyền duyệt BTC vào Closed Beta (FR-37), xem báo cáo vi phạm, khóa hoặc mở khóa Sự kiện và BTC (FR-35). Đây là ngoại lệ duy nhất được xem dữ liệu của nhiều BTC, và mọi lần truy cập đều ghi nhật ký. `[ASSUMPTION: PM khôi phục từ BRD §12.2]`

**Hệ quả:**
- Không BTC nào đọc được dữ liệu của BTC khác (NFR-7). CTV chỉ thấy dữ liệu check-in của Sự kiện được giao.
- Quản trị Tingee đăng nhập bằng SSO nội bộ, bắt buộc 2FA, và chỉ truy cập được từ dải IP cho phép. `[ASSUMPTION: PM khôi phục từ BRD §12.2]`

### 4.2 Liên kết tài khoản nhận tiền

**Mô tả:** Owner liên kết tài khoản ngân hàng nhận tiền của BTC qua Tingee, hệ thống tạo Merchant con. Trong Closed Beta, BTC đã được Quản trị Tingee duyệt thì liên kết xong là mở bán Vé có phí được, chưa cần KYC. **KYC đầy đủ là điều kiện bắt buộc trước khi mở công khai.** Hiện thực hóa UJ-2.

#### FR-5: Liên kết tài khoản nhận tiền và tạo Merchant con
Owner liên kết tài khoản nhận tiền của BTC. Hệ thống tạo Merchant con trên Tingee và báo cho BTC biết họ dùng được QR động hay chỉ QR tĩnh.

**Hệ quả:**
- BTC chưa liên kết tài khoản nhận tiền thì không mở bán được Sự kiện có phí. Sự kiện miễn phí không cần liên kết.
- Sau khi liên kết, dashboard hiện loại QR thanh toán BTC dùng được. Nếu BTC chỉ dùng được QR tĩnh, dashboard kèm khuyến nghị chuyển sang tài khoản hỗ trợ QR động.
- Tickee không lưu số dư hay tiền của BTC.

#### FR-6: KYC BTC *(giai đoạn trước khi mở công khai, chưa thuộc Closed Beta)*
Owner hoàn tất KYC qua Tingee. Sau khi mở công khai, BTC chưa KYC không mở bán được Sự kiện có phí.

**Hệ quả:** Trước khi mở công khai, mọi BTC trong Closed Beta đã hoàn tất KYC hoặc bị tạm ngừng bán Vé có phí. Quy trình KYC và các biện pháp chống lừa đảo đi kèm sẽ được đặc tả trong một bản cập nhật PRD trước khi mở công khai.

#### FR-37: Duyệt BTC vào Closed Beta
Trước khi mở công khai, BTC chỉ bán được Vé có phí sau khi Quản trị Tingee duyệt BTC đó vào Closed Beta. Sự kiện miễn phí thì BTC nào cũng tạo được.

**Hệ quả:**
- BTC chưa được duyệt vẫn đăng ký, liên kết tài khoản nhận tiền và tạo Sự kiện nháp được, nhưng không mở bán được Hạng vé có giá trên 0đ.
- Dashboard hiện rõ trạng thái "Chờ duyệt Closed Beta" và hướng dẫn liên hệ Tingee.
- Quản trị Tingee duyệt hoặc thu hồi trạng thái này. Thu hồi thì mọi Sự kiện có phí của BTC chuyển sang "Tạm ngừng bán".
- Mọi lần duyệt và thu hồi đều ghi nhật ký (NFR-11).

### 4.3 Sự kiện, Hạng vé và form mua vé

**Mô tả:** BTC tạo Sự kiện nhanh, mở bán và gửi link trang Sự kiện công khai. Trang này tối ưu cho điện thoại và có ảnh xem trước khi chia sẻ lên Facebook hoặc Zalo. Hiện thực hóa UJ-2.

#### FR-7: Tạo và quản lý Sự kiện
Owner và Admin tạo, sửa, ẩn, hủy Sự kiện. Thông tin Sự kiện gồm tên, thời gian bắt đầu và kết thúc, địa điểm, mô tả, ảnh và chính sách hoàn vé.

**Hệ quả:**
- Chính sách hoàn vé là trường bắt buộc. Thiếu trường này thì Sự kiện không mở bán được.
- Sự kiện ở trạng thái "Ẩn" thì vẫn truy cập được bằng link nhưng không nhận Đơn mới. `[ASSUMPTION: "ẩn" = tạm dừng nhận Đơn; Tickee không có chợ vé nên không có khái niệm ẩn khỏi danh sách]`
- Khi đã có Vé được phát, sửa thời gian hoặc địa điểm sẽ gửi email báo cho Người mua. `[ASSUMPTION: có email báo Người mua khi sửa thời gian hoặc địa điểm]`
- Mọi thay đổi Sự kiện đều được ghi nhật ký (NFR-11).
- Sự kiện tự chuyển sang "Đã kết thúc" theo mốc Sự kiện kết thúc (§3). Owner hoặc Admin bấm "Kết thúc" sớm được. Trước mốc đó, check-in vẫn hoạt động kể cả khi Sự kiện kéo dài quá giờ đã khai báo.
- Hủy Sự kiện: xem FR-33.

#### FR-8: Hạng vé
Owner và Admin tạo nhiều Hạng vé cho một Sự kiện. Mỗi Hạng vé có tên, giá, số suất và thời gian mở/đóng bán.

**Hệ quả:**
- Ngoài thời gian mở bán, Hạng vé hiện "Chưa mở bán" hoặc "Đã đóng bán" và không cho chọn.
- Số suất không được giảm xuống thấp hơn số Vé đã bán cộng số đang Giữ chỗ.
- Giá được chốt vào Đơn tại thời điểm đặt. Đổi giá về sau không ảnh hưởng đến Đơn đã tạo.

#### FR-9: Cấu hình form mua vé
Owner và Admin cấu hình form mua vé của Sự kiện.
- Trường mặc định: Tên, SĐT (hỏi nếu Tài khoản Tickee chưa có), email (tự điền từ Tài khoản Tickee).
- Câu hỏi riêng của BTC: dạng văn bản hoặc lựa chọn, bắt buộc hoặc không bắt buộc.
- Các trường bổ sung khác.

**Hệ quả:**
- Form được điền một lần cho mỗi Đơn, dù Đơn có bao nhiêu Vé.
- Không gửi được Đơn khi còn trường bắt buộc để trống.
- Câu trả lời trong form hiện trong danh sách Đơn, file CSV và Google Sheets.

#### FR-10: Trang Sự kiện công khai
Ai có link đều xem được trang Sự kiện mà không cần đăng nhập. Trang tối ưu cho điện thoại và có ảnh xem trước khi chia sẻ lên Facebook hoặc Zalo.

**Hệ quả:**
- Trang tải xong dưới 2 giây trên mạng 4G (NFR-1).
- Chia sẻ link lên Facebook hoặc Zalo hiện đúng ảnh, tên và thời gian của Sự kiện.
- Trang hiện số chỗ còn lại hoặc trạng thái "Hết vé" của từng Hạng vé. `[ASSUMPTION: hiện "còn ít chỗ" thay vì số chính xác là tùy chọn của BTC — để UX quyết]`

#### FR-11: Sự kiện miễn phí
Owner và Admin tạo Sự kiện miễn phí. Người mua đăng ký Vé mà không phải thanh toán.

**Hệ quả:**
- Không tạo QR thanh toán và không tiêu Token.
- Người mua vẫn phải đăng nhập Tài khoản Tickee. `[ASSUMPTION: Sự kiện miễn phí vẫn bắt buộc đăng nhập]`
- Vé được phát ngay khi gửi Đơn.
- Mỗi Sự kiện miễn phí có trần 200 Vé. `[ASSUMPTION: BRD ghi 200 là "tham khảo" — PRD coi là trần cứng ở MVP]`

### 4.4 Checkout và Giữ chỗ

**Mô tả:** Người mua chọn Vé, điền form và nhận QR thanh toán. Hệ thống Giữ chỗ trong 15 phút và không bao giờ bán quá số suất. Hiện thực hóa UJ-1.

#### FR-12: Tạo Đơn nhiều Vé, nhiều Hạng vé
Người mua chọn số lượng Vé, có thể thuộc nhiều Hạng vé trong cùng Sự kiện, rồi gửi một Đơn.

**Hệ quả:**
- Mỗi Đơn có giới hạn số Vé tối đa. `[ASSUMPTION: BTC đặt cho từng Sự kiện, mặc định 10 Vé/Đơn — xem Câu hỏi mở #2]`
- Tổng tiền của Đơn bằng tổng giá các Vé đã chốt (FR-8).

#### FR-13: Không bán quá số suất
Với mỗi Hạng vé, số Vé đã bán cộng số đang Giữ chỗ không bao giờ vượt số suất.

**Hệ quả:**
- Hạng vé còn 1 chỗ mà hai Người mua cùng gửi Đơn: chỉ một người được Giữ chỗ, người kia thấy "Hết vé".
- Một Đơn có nhiều Hạng vé được Giữ chỗ theo kiểu được hết hoặc không được gì. Thiếu chỗ ở bất kỳ Hạng vé nào thì cả Đơn không được tạo, và hệ thống báo rõ Hạng vé nào hết.
- Điều kiện này vẫn đúng khi 5.000 người cùng vào mua một Sự kiện 300 Vé (NFR-3).

#### FR-14: Giữ chỗ 15 phút và hết hạn
Khi Đơn được tạo, hệ thống Giữ chỗ đúng bằng thời hạn QR động (15 phút) và hiện đồng hồ đếm ngược.

**Hệ quả:**
- Hết 15 phút mà chưa thanh toán: QR không còn thanh toán được, chỗ được trả lại, Đơn chuyển sang "Hết hạn". Màn hình báo hết hạn và mời Người mua tạo Đơn mới.
- Chỗ đã trả lại được người khác mua ngay.
- IPN hợp lệ hoặc Đối soát bù xác nhận tiền đã về sau khi chỗ đã trả lại (ví dụ ngân hàng xử lý chậm ở sát giây cuối), áp dụng cho cả QR động lẫn QR tĩnh:
  - Hạng vé còn chỗ: Giữ chỗ lại và phát Vé bình thường.
  - Hạng vé đã hết: không phát Vé. Đơn vào "Cần xử lý" với loại "Thanh toán mồ côi", hệ thống báo cho BTC và gửi email cho Người mua. BTC tự hoàn tiền hoặc mở thêm chỗ.
- Không bao giờ phát Vé vượt số suất, kể cả với tiền về muộn (FR-13).
- Với QR tĩnh: xem FR-17.

#### FR-15: Kiểm tra Token trước khi tạo QR
Hệ thống chỉ tạo QR thanh toán khi Token khả dụng của BTC còn đủ cho ít nhất một giao dịch.

**Hệ quả:**
- Token khả dụng không đủ: không tạo QR, trang Sự kiện hiện "Tạm ngừng bán".
- Khi Tingee ngắt dịch vụ của BTC vì vượt hạn mức: mọi Sự kiện có phí của BTC đó hiện "Tạm ngừng bán".
- Sự kiện miễn phí không bị ảnh hưởng.

#### FR-16: Thanh toán bằng QR động
Người mua thấy QR động đúng số tiền của Đơn, có nút tải ảnh QR và nút mở thẳng app ngân hàng (Deep Link).

**Hệ quả:**
- QR được tạo xong dưới 2 giây (NFR-1).
- Trang thanh toán ghi rõ "Tiền chuyển thẳng cho [tên BTC]" và hiện chính sách hoàn vé của BTC.

#### FR-17: Thanh toán bằng QR tĩnh
BTC không dùng được QR động thì Người mua thanh toán qua QR tĩnh. Nội dung chuyển khoản phải chứa mã Đơn, và trang thanh toán hướng dẫn rõ điều này.

**Hệ quả:**
- Trang thanh toán hiện mã Đơn nổi bật, có nút sao chép và hướng dẫn ghi đúng nội dung chuyển khoản.
- Giữ chỗ với QR tĩnh cũng kéo dài 15 phút như QR động. Hết 15 phút, Đơn chuyển sang "Hết hạn" và chỗ được trả lại.
- Đơn QR tĩnh đang Chờ thanh toán cũng được tính vào phần trừ khi tính Token khả dụng, giống Đơn QR động đang Chờ thanh toán.
- Tiền về sau khi chỗ đã trả lại: xử lý theo quy tắc tiền về muộn ở FR-14.

#### FR-18: Tự chuyển sang "Thành công"
Khi Đơn được thanh toán, màn hình của Người mua tự chuyển sang "Thành công" và hiện tất cả Vé của Đơn, không cần tải lại trang.

**Hệ quả:** Từ lúc Tickee nhận IPN đến lúc Vé hiện trên trình duyệt mất dưới 3 giây (NFR-2).

### 4.5 Thanh toán và đối soát

**Mô tả:** Tickee nhận trạng thái thanh toán từ Tingee qua IPN, khớp với Đơn rồi phát Vé. Tickee không bao giờ giữ tiền. Hiện thực hóa UJ-1, UJ-2.

#### FR-19: Xử lý IPN và phát Vé
Hệ thống nhận IPN, xác thực chữ ký, khớp billId và số tiền thực nhận với Đơn, rồi phát Vé.

**Hệ quả:**
- Chỉ phát Vé khi IPN hợp lệ và số tiền thực nhận bằng đúng số tiền của Đơn.
- Mỗi giao dịch chỉ được xử lý một lần. Tingee gửi lặp cùng một IPN thì hệ thống không phát thêm Vé và không gửi thêm email.
- IPN sai chữ ký bị từ chối và được ghi lại để tra soát.
- Ghi nhận thanh toán, phát Vé và lên lịch gửi email diễn ra trọn gói hoặc không diễn ra gì (NFR-5).

#### FR-20: Đối soát bù
Khi IPN đến trễ hoặc bị mất, và khi BTC được Tingee mở lại dịch vụ, hệ thống chủ động hỏi Tingee trạng thái các QR thanh toán còn mở rồi phát Vé bù.

**Hệ quả:**
- Đơn đã thanh toán mà sau một khoảng thời gian vẫn chưa nhận IPN thì được Đối soát bù tự động. `[ASSUMPTION: bắt đầu hỏi sau 2 phút; Architecture chốt nhịp]`
- Sau khi BTC được mở lại dịch vụ, mọi QR thanh toán đã mở trong thời gian bị ngắt đều được kiểm tra trạng thái.
- Đối soát bù tuân theo cùng quy tắc chỉ xử lý một lần như FR-19.

**Lưu ý:** Thanh toán bằng QR tĩnh trong lúc BTC bị ngắt dịch vụ chưa có cách khôi phục. Xem Câu hỏi mở #4.

#### FR-21: Hàng "Cần xử lý"
Giao dịch lệch số tiền, Thanh toán mồ côi và Giao dịch chưa khớp (sai nội dung chuyển khoản khi dùng QR tĩnh) vào hàng "Cần xử lý". Owner hoặc Admin ghép tay giao dịch với Đơn, duyệt tay để phát Vé, hoặc từ chối.

**Hệ quả:**
- Đơn lệch số tiền không được phát Vé tự động.
- Ghép tay một giao dịch chưa khớp vào một Đơn đang chờ thì phát Vé cho Đơn đó, với điều kiện Hạng vé còn chỗ.
- Khi BTC từ chối và tự chuyển hoàn tiền ngoài hệ thống, BTC đánh dấu Đơn là "Đã hoàn tay".
- Mọi thao tác xử lý tay đều ghi nhật ký: ai làm, lúc nào, quyết định gì (NFR-11).
- Dashboard hiện số mục đang chờ trong hàng "Cần xử lý".

### 4.6 Vé và gửi Vé

**Mô tả:** Mỗi Vé có Mã QR vé riêng được ký số. Người mua xem Vé trong "Vé của tôi" và nhận Vé qua email. Hiện thực hóa UJ-1.

#### FR-22: Phát Vé và "Vé của tôi"
Mỗi Vé trong Đơn đã thanh toán có một Mã QR vé riêng được ký số. Người mua xem tất cả Vé của mình trong "Vé của tôi".

**Hệ quả:**
- Đơn có N Vé thì sinh ra N Mã QR vé khác nhau. Mỗi Mã QR vé check-in độc lập.
- Người mua chia sẻ từng Vé cho người đi cùng, bằng cách gửi link Vé hoặc ảnh Vé. `[ASSUMPTION: MVP không có chuyển nhượng Vé sang Tài khoản Tickee khác]`
- Người mua không tra được Vé theo SĐT.

#### FR-23: Gửi Vé qua email
Khi Vé được phát, hệ thống gửi email cho Người mua, kèm Vé hoặc link tới Vé.

**Hệ quả:**
- Gửi email lỗi thì hệ thống tự thử lại. Vé vẫn hợp lệ và vẫn xem được trong "Vé của tôi".
- Cuối email có dòng giới thiệu Tickee (FR-36).

**Ngoài phạm vi:** gửi Vé qua Zalo ZNS (để sau MVP).

#### FR-24: Vé sau khi Sự kiện kết thúc
Sau mốc Sự kiện kết thúc (§3), Vé không còn hiện trong "Vé của tôi". Người mua chỉ còn thấy lịch sử đã tham dự Sự kiện.

**Hệ quả:**
- Lịch sử ghi tên Sự kiện, ngày diễn ra và trạng thái đã check-in hay chưa.
- Dữ liệu Đơn và check-in phía BTC vẫn còn cho báo cáo. `[ASSUMPTION: "Vé bị xóa" = ẩn khỏi Người mua và vô hiệu Mã QR vé; thời gian lưu dữ liệu do pháp chế chốt]`

#### FR-25: Ảnh Social Ticket Card *(Should)*
Người mua tải ảnh Vé đã ẩn Mã QR vé để chia sẻ lên Story.

**Hệ quả:** Ảnh không chứa Mã QR vé hay bất kỳ thông tin nào dùng để check-in được.

### 4.7 Check-in

**Mô tả:** CTV, Owner và Admin quét Mã QR vé bằng ứng dụng web chạy trong trình duyệt điện thoại, không cần cài app. Kết quả hiện rõ bằng màu: xanh hoặc đỏ. Hiện thực hóa UJ-3.

#### FR-26: Mời và thu hồi CTV
Owner hoặc Admin tạo link mời CTV cho một Sự kiện và gửi qua email hoặc bất kỳ kênh nào. CTV phải đăng nhập Tài khoản Tickee để nhận lời mời.

**Hệ quả:**
- CTV đã nhận lời mời chỉ thấy màn hình check-in của Sự kiện đó.
- Quyền CTV tự hết ở mốc Sự kiện kết thúc (§3). BTC thu hồi được bất kỳ lúc nào, và thu hồi có hiệu lực ngay ở lượt quét tiếp theo.
- Link mời có thời hạn và thu hồi được. `[ASSUMPTION: một link dùng cho nhiều CTV hay mỗi CTV một link — để UX/Architecture quyết]`

#### FR-27: Quét Mã QR vé
Người có quyền check-in quét Mã QR vé bằng camera trình duyệt.

**Hệ quả:**
- Vé hợp lệ, chưa check-in: báo xanh, "thành công", kèm tên Người mua, số thứ tự Vé trong Đơn và Hạng vé. Ví dụ: "Minh · Vé 2/2 · Đôi nam". Vé không mang tên riêng của người đi cùng.
- Vé đã check-in: báo đỏ, có âm thanh, kèm giờ check-in và người quét lần trước.
- Mã không kiểm tra được chữ ký, Vé đã hủy, hoặc Vé của Sự kiện khác: báo đỏ, có âm thanh, "vé không hợp lệ".
- Màn hình quét không bao giờ hiện Mã QR vé.
- Kết quả quét hiện dưới 1 giây (NFR-2).

#### FR-28: Check-in một lần, nhiều người quét song song
Mỗi Vé chỉ check-in thành công một lần, kể cả khi nhiều CTV quét cùng lúc.

**Hệ quả:** Hai CTV quét cùng một Vé gần như đồng thời thì chỉ một người thấy xanh, người còn lại thấy đỏ kèm thông tin lượt check-in trước.

#### FR-29: Tra Vé và check-in tay
CTV, Owner và Admin tra Vé theo SĐT hoặc email của Người mua rồi check-in tay khi khách không mở được Vé.

**Hệ quả:**
- Kết quả tra chỉ hiện tên, Hạng vé và trạng thái check-in, không hiện Mã QR vé.
- CTV chỉ tra được trong Sự kiện được giao.
- Check-in tay cũng tuân theo quy tắc check-in một lần (FR-28) và ghi lại người thực hiện.

#### FR-30: Theo dõi check-in thời gian thực
Owner và Admin xem số người đã check-in trên tổng số Vé, theo từng Hạng vé, cập nhật liên tục trong lúc Sự kiện diễn ra.

### 4.8 Dashboard, dữ liệu và Token

**Mô tả:** BTC theo dõi doanh thu, Đơn và Người mua trên dashboard, xuất dữ liệu và đồng bộ một chiều sang Google Sheets. Số dư Token được đọc trực tiếp từ Tingee. Hiện thực hóa UJ-2.

#### FR-31: Dashboard và xuất CSV
Owner và Admin xem doanh thu, số Vé theo Hạng vé, danh sách Đơn kèm câu trả lời form, và xuất CSV.

**Hệ quả:**
- Doanh thu chỉ tính các Đơn "Đã thanh toán".
- File CSV chứa đủ các trường hiện trên danh sách Đơn.
- Dashboard xem theo từng Sự kiện. `[ASSUMPTION: chưa có báo cáo gộp nhiều Sự kiện ở MVP]`

#### FR-32: Đồng bộ Google Sheets
Owner hoặc Admin kết nối một Google Sheet của BTC. Hệ thống ghi mỗi Đơn thành một dòng, rồi cập nhật trạng thái thanh toán và trạng thái check-in.

**Hệ quả:**
- Đơn được thanh toán hoặc check-in thì Sheet có dòng mới hoặc dòng được cập nhật trong vòng 1 phút.
- Chỉ đồng bộ một chiều, từ Tickee sang Sheet. Sửa trên Sheet không ảnh hưởng đến Tickee.
- Ghi Sheet lỗi thì hệ thống tự thử lại. Mất quyền truy cập Sheet thì dashboard báo cho BTC kết nối lại.
- BTC sửa hoặc xóa cột/dòng trên Sheet: `[ASSUMPTION: hệ thống ghi lại dòng bị mất ở lần cập nhật kế tiếp và không ghi đè cột do BTC tự thêm — xem Câu hỏi mở #6]`

#### FR-33: Hủy Sự kiện *(Should)*
Khi Owner hoặc Admin hủy Sự kiện, hệ thống ngừng bán, vô hiệu mọi Vé, gửi email cho tất cả Người mua và xuất danh sách cần hoàn tiền.

**Hệ quả:**
- Sau khi hủy, quét Vé của Sự kiện này đều báo "vé không hợp lệ".
- Danh sách cần hoàn tiền gồm Người mua, SĐT, email, số tiền đã trả và mã Đơn.
- BTC tự chuyển hoàn tiền ngoài hệ thống rồi đánh dấu từng Đơn là "Đã hoàn tay".

#### FR-34: Token
Owner xem số dư Token, hạn mức âm hoặc hạn mức trả sau do Tingee cấp, đặt ngưỡng cảnh báo và bấm mua thêm Token. Admin chỉ xem được.

**Hệ quả:**
- Số dư và hạn mức được đọc từ Tingee. Tickee không lưu số dư Token.
- Token khả dụng xuống dưới ngưỡng Owner đặt: Owner nhận cảnh báo qua email và trên dashboard.
- BTC được Tingee cấp hạn mức âm hoặc trả sau thì vẫn bán bình thường khi số dư âm, cho đến khi chạm hạn mức (FR-15).
- Nút "mua thêm Token" chuyển Owner sang luồng mua Token của Tingee. `[ASSUMPTION: Tickee không tự bán Token]`

### 4.9 Niềm tin và an toàn

**Mô tả:** Closed Beta chưa có KYC, nên báo cáo vi phạm và khóa là lớp kiểm soát chính chống Sự kiện lừa đảo.

#### FR-35: Báo cáo và khóa Sự kiện hoặc BTC
Người mua báo cáo một Sự kiện, kèm lý do. Quản trị Tingee xem báo cáo rồi khóa Sự kiện hoặc khóa cả BTC vi phạm.

**Hệ quả:**
- Sự kiện bị khóa ngừng nhận Đơn ngay và hiện thông báo trên trang Sự kiện.
- BTC bị khóa thì mọi Sự kiện của BTC ngừng nhận Đơn.
- Vé đã phát của Sự kiện bị khóa: `[ASSUMPTION: vẫn hợp lệ để check-in trừ khi Quản trị Tingee chọn vô hiệu]`
- Quản trị Tingee có nơi xem danh sách báo cáo, chi tiết Sự kiện, lịch sử khóa và mở khóa.
- Mọi thao tác khóa và mở khóa đều ghi nhật ký.

**Lưu ý:** Quy trình xử lý báo cáo (ai trực, thời gian phản hồi, có báo cho BTC hay không) chưa được định nghĩa. Xem Câu hỏi mở #7.

### 4.10 Lan truyền

#### FR-36: Dòng giới thiệu Tickee *(Could)*
Trang mua Vé và email Vé có một dòng giới thiệu Tickee, kèm link để BTC khác đăng ký.

## 5. Yêu cầu phi chức năng

Các con số dưới đây là mục tiêu đề xuất. Đội kỹ thuật cần xác nhận trước khi chốt.

| ID | Nhóm | Yêu cầu |
|---|---|---|
| NFR-1 | Hiệu năng | Trang Sự kiện tải dưới 2 giây trên 4G. Tạo QR thanh toán dưới 2 giây |
| NFR-2 | Hiệu năng | Từ lúc nhận IPN đến lúc Vé hiện trên trình duyệt dưới 3 giây. Quét check-in phản hồi dưới 1 giây |
| NFR-3 | Chịu tải | 5.000 người cùng vào mua một Sự kiện 300 Vé mà không bán quá số suất. Có phòng chờ cho Sự kiện đông Người mua `[ASSUMPTION: tiêu chí bật phòng chờ — Câu hỏi mở #5]` |
| NFR-4 | Sẵn sàng | Uptime 99,9%/tháng cho Checkout, IPN và check-in |
| NFR-5 | Toàn vẹn dữ liệu | Ghi nhận thanh toán, phát Vé và lên lịch gửi email/Sheets diễn ra trọn gói hoặc không diễn ra gì. Sao lưu và khôi phục được về một thời điểm bất kỳ |
| NFR-6 | Bảo mật | Toàn bộ dùng HTTPS. Mọi request tới Tingee và mọi IPN đều có chữ ký được xác thực. Mã QR vé được ký số. Owner bắt buộc 2FA |
| NFR-7 | Cách ly dữ liệu | BTC này không đọc được dữ liệu của BTC khác. CTV chỉ đọc được dữ liệu check-in của Sự kiện được giao |
| NFR-8 | Dữ liệu cá nhân | Thu thập sự đồng ý xử lý dữ liệu theo NĐ 13/2023. Không lưu thông tin tài khoản ngân hàng của Người mua. Dữ liệu Người mua chỉ dùng cho Sự kiện họ đã mua |
| NFR-9 | Khả dụng | Tối ưu cho điện thoại. Chạy được trên Safari iOS và Chrome Android bản hiện hành. Giao diện tiếng Việt |
| NFR-10 | Giám sát | Cảnh báo cho đội vận hành khi IPN lỗi, khi tỉ lệ phát Vé giảm bất thường, hoặc khi hàng đợi gửi email/Sheets bị ùn |
| NFR-11 | Kiểm toán | Ghi nhật ký mọi thay đổi Sự kiện, phân quyền, xử lý Đơn tay và thao tác khóa của Quản trị Tingee |
| NFR-12 | Dữ liệu tiền | Tiền lưu dưới dạng số nguyên theo đồng. Mọi mốc thời gian có múi giờ |

## 6. Tích hợp và phụ thuộc

| Hệ thống | Dùng cho | Trạng thái |
|---|---|---|
| Tingee: Master Merchant | Tạo Merchant con, liên kết tài khoản nhận tiền (FR-5) | Có. Tingee cho tạo Merchant con khi chưa KYC (đã xác nhận bằng lời, cần văn bản xác nhận) |
| Tingee: QR động | Tạo QR, tra trạng thái, xóa QR (FR-16, FR-20) | Có |
| Tingee: QR tĩnh | Đối soát theo nội dung chuyển khoản (FR-17) | Có |
| Tingee: Webhook (IPN) | Nhận giao dịch kèm số tiền thực nhận (FR-19) | Có. Mỗi IPN bị trừ Token |
| Tingee: Token | Đọc số dư, hạn mức, lịch sử trừ (FR-15, FR-34) | **Tingee chưa xác nhận API**, đây là điểm chặn |
| Tingee: Deep Link | Mở app ngân hàng (FR-16) | Có |
| Email | Gửi Vé, OTP, thông báo, cảnh báo Token | Cần chọn nhà cung cấp (Architecture) |
| Google (OAuth đăng nhập) | Đăng nhập Tài khoản Tickee (FR-1) | Có |
| Google Sheets API | Đồng bộ một chiều (FR-32) | BTC cấp quyền OAuth |
| Zalo ZNS, SMS OTP | Gửi Vé, cảnh báo, OTP qua SĐT | **Không thuộc MVP** |

## 7. Mô hình phí và Token

- Tingee quản lý số dư Token, lịch sử trừ, bảng giá và hóa đơn. Tickee không lưu bản sao.
- BTC trả trước, hoặc được Tingee cấp hạn mức âm hay trả sau ngay từ đầu.
- Tingee trừ Token cho mỗi IPN báo một giao dịch, gồm cả QR tĩnh, giao dịch lệch tiền và giao dịch chưa khớp.
- Token được trừ **theo giao dịch, tức theo mỗi Đơn**, không theo mỗi Vé. Mức do Tingee quy định. Mức tham khảo tương đương 3.000–5.000đ/giao dịch, sẽ chốt sau. Bảng so sánh chi phí trong BRD giả định mỗi Đơn chỉ có 1 Vé. Với Đơn nhiều Vé, phí tính trên mỗi Vé sẽ thấp hơn và doanh thu Token cũng giảm theo (xem Câu hỏi mở #11). `[ASSUMPTION: PM suy ra từ BR-05 của BRD]`
- Sự kiện miễn phí không tiêu Token.
- Vượt hạn mức thì Tingee ngắt API và Webhook của BTC. Tickee ngừng tạo QR trước thời điểm đó (FR-15).
- Token chỉ dùng cho dịch vụ Tingee, không quy đổi ngược ra tiền và không chuyển nhượng, để không bị coi là ví điện tử.

## 8. Pháp lý và dữ liệu cá nhân

- **NĐ 13/2023:** thu thập sự đồng ý xử lý dữ liệu cá nhân khi tạo Tài khoản Tickee. Checkout báo rõ dữ liệu được chia sẻ cho BTC (FR-3). Người dùng xóa được Tài khoản Tickee và rút lại đồng ý (FR-38). Thời gian lưu dữ liệu Người mua do pháp chế chốt.
- **NĐ 117/2025, thương mại điện tử và thuế:** pháp chế xác định Tickee là SaaS hay sàn thương mại điện tử, xét theo pháp nhân Tingee. Đây là điều kiện trước khi mở công khai.
- **Token:** pháp chế xác nhận mô hình Token không phải ví điện tử trước khi mở công khai.
- **Tiếp thị:** không dùng công cụ cào dữ liệu.

## 9. Rủi ro

| ID | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| R-1 | Sự kiện lừa đảo, tiền đã về tài khoản kẻ gian | Cao | **Closed Beta chấp nhận rủi ro có chủ đích:** chỉ BTC được Quản trị Tingee duyệt mới bán được Vé có phí (FR-37), có báo cáo và khóa (FR-35). Đã cân nhắc và không áp trần số Vé hay số tiền cho BTC chưa KYC. Trước khi mở công khai bắt buộc có KYC (FR-6) và biện pháp chống lừa đảo |
| R-2 | Khách đổ lỗi cho Tickee khi không được hoàn tiền | Cao | Chính sách hoàn vé bắt buộc. Ghi rõ "Tiền chuyển thẳng cho [tên BTC]" (FR-7, FR-16) |
| R-3 | BTC bị ngắt dịch vụ khi còn QR thanh toán đang mở, khách đã trả tiền mà không nhận Vé | Cao | Kiểm tra Token khả dụng (FR-15), cảnh báo sớm, hạn mức âm hoặc trả sau, Đối soát bù (FR-20) |
| R-4 | BTC dùng QR tĩnh: tỉ lệ ghép tay cao, vẫn bị trừ Token cho giao dịch sai nội dung | Trung bình | Hướng dẫn rõ ở trang thanh toán (FR-17). Khuyến khích dùng tài khoản có QR động (FR-5) |
| R-5 | Bắt đăng nhập trước khi mua làm giảm tỉ lệ mua | Trung bình | Chỉ yêu cầu đăng nhập lúc bấm "Mua". Có đăng nhập Google một chạm. Giữ lựa chọn Vé sau khi đăng nhập (FR-3). Theo dõi SM-C2 |
| R-6 | Nghĩa vụ thương mại điện tử và thuế theo NĐ 117/2025 | Trung bình | Có ý kiến pháp chế trước khi mở công khai |
| R-7 | Token bị coi là ví điện tử | Trung bình | Không rút, không chuyển nhượng, xuất hóa đơn khi mua |
| R-8 | Dữ liệu cá nhân theo NĐ 13/2023 | Trung bình | NFR-8, thu sự đồng ý ở FR-3 |
| R-9 | Tingee chưa xác nhận API Token | Cao | Xin xác nhận trước Phase 1. Nếu không có thì FR-15 và FR-34 phải thiết kế lại |
| R-10 | Đối thủ hạ phí hoặc sao chép | Trung bình | Trải nghiệm sản phẩm và mạng lưới merchant Tingee |

## 10. Non-Goals

- Tickee **không giữ tiền** và không xử lý hoàn tiền. Mọi khoản hoàn tiền do BTC tự chuyển.
- Tickee **không phải chợ vé**: không có trang khám phá Sự kiện, không gợi ý Sự kiện cho Người mua.
- Tickee **không lưu Token, tiền hay thông tin tài khoản ngân hàng** của Người mua.
- Tickee không phải công cụ CRM hay email marketing cho BTC.
- Tickee không bán Vé có sơ đồ chỗ ngồi hay Vé theo bàn.

## 11. Phạm vi MVP

### 11.1 Trong phạm vi
- Tài khoản Tickee đăng nhập bằng Google hoặc OTP qua email. Người mua bắt buộc đăng nhập khi mua.
- BTC, Owner, Admin, CTV và ma trận phân quyền.
- Liên kết tài khoản nhận tiền và tạo Merchant con, chưa có KYC trong Closed Beta. Quản trị Tingee duyệt BTC vào Closed Beta.
- Xóa Tài khoản Tickee và rút lại đồng ý xử lý dữ liệu.
- Sự kiện, Hạng vé, form mua vé tùy chỉnh, trang Sự kiện công khai, Sự kiện miễn phí.
- Đơn nhiều Vé và nhiều Hạng vé, Giữ chỗ 15 phút, thanh toán bằng QR động hoặc QR tĩnh.
- IPN, Đối soát bù, hàng "Cần xử lý".
- Mỗi Vé một Mã QR vé, "Vé của tôi", gửi Vé qua email.
- Check-in bằng ứng dụng web, nhiều người quét song song, tra Vé và check-in tay, theo dõi check-in thời gian thực.
- Dashboard, xuất CSV, đồng bộ Google Sheets một chiều, hiển thị Token và cảnh báo Token.
- Báo cáo và khóa Sự kiện hoặc BTC.
- Should/Could: hủy Sự kiện kèm danh sách hoàn tiền, Social Ticket Card, dòng giới thiệu Tickee.

### 11.2 Ngoài phạm vi MVP
- **KYC:** để giai đoạn trước khi mở công khai. Đây là điều kiện bắt buộc để mở công khai (FR-6).
- **Zalo ZNS và OTP qua SĐT:** làm cùng một đợt sau MVP. Đăng ký BTC bằng SĐT cũng để sau.
- **Voucher:** chưa cần thiết cho MVP.
- Hoàn tiền tự động hoặc hàng loạt. API Chi hộ không hỗ trợ việc này.
- Hủy hoặc hoàn tiền cho từng Đơn đã thanh toán. BTC tự hoàn tiền ngoài hệ thống, Vé của Đơn đó vẫn hợp lệ và chỗ không được trả lại. Chỉ khi hủy cả Sự kiện mới có danh sách hoàn tiền (FR-33).
- Chợ vé, app mobile native, check-in offline, in thẻ.
- Đồng bộ Sheets hai chiều, báo cáo nâng cao, Apple Wallet và Google Wallet.
- Chuyển nhượng Vé sang Tài khoản Tickee khác, Sự kiện định kỳ, hóa đơn điện tử cho Người mua.
- SSO tài khoản Tingee.

### 11.3 Thay đổi so với BRD

Các mã trong cột BRD (FR-xx, BR-xx, R-xx) là mã của BRD, không phải mã trong PRD này.

| BRD | PRD | Lý do |
|---|---|---|
| Mua Vé không cần tài khoản (FR-08), tra Vé bằng OTP (FR-17) | Người mua bắt buộc có Tài khoản Tickee khi mua. Xem Vé trong "Vé của tôi" hoặc email. Chỉ CTV, Owner và Admin tra được theo SĐT | Có trang "Vé của tôi". BTC biết Người mua là người thật |
| Gửi Vé qua ZNS và email (FR-16) | Chỉ gửi qua email | ZNS và OTP qua SĐT làm cùng một đợt sau MVP |
| KYC trước khi mở bán Sự kiện có phí (BR-10) | Closed Beta chưa KYC. KYC bắt buộc trước khi mở công khai | Rút ngắn thời gian ra Closed Beta |
| Voucher (FR-06, Should) | Bỏ khỏi MVP | Chưa cần thiết |
| CTV vào bằng link hoặc mã, không cần tài khoản | CTV phải có Tài khoản Tickee. Quyền tự hết khi Sự kiện kết thúc | Có danh tính để hiện "người quét lần trước" |
| Chưa rõ một Đơn có mấy Vé | Một Đơn có nhiều Vé, nhiều Hạng vé, mỗi Vé một Mã QR vé, điền form một lần | Đã chốt khi làm UJ-1 |
| Closed Beta 5–10 Sự kiện | Closed Beta 2–5 Sự kiện thật | Đã chốt khi bàn về chỉ số thành công |
| Giới hạn số Vé có phí cho BTC mới (R-01) | Không áp trần. Thay bằng việc chỉ BTC được duyệt vào Closed Beta mới bán Vé có phí (FR-37) | Kiểm soát rủi ro lừa đảo khi chưa có KYC |
| Điều kiện mở công khai có "Mẫu ZNS đã duyệt" | Bỏ điều kiện này | ZNS không thuộc MVP |

### 11.4 Lộ trình và điều kiện ra mắt

`[ASSUMPTION: các phase của BRD được sắp lại theo năng lực, vì BRD gán US-01 và US-05 vào Phase 1 trong khi chúng phụ thuộc vào FR của Phase 2]`

| Phase | Nội dung | Điều kiện hoàn thành |
|---|---|---|
| Phase 1, tuần 1–2 | Tài khoản, BTC, Merchant con, Sự kiện, Hạng vé, form, Checkout, Giữ chỗ, QR thanh toán, IPN, Đối soát bù, "Cần xử lý", kiểm tra Token, phát Vé, gửi email | Trên sandbox Tingee: mua Vé bằng QR động thành công, không bán quá số suất, IPN lặp không phát Vé trùng, hết Token thì "Tạm ngừng bán" |
| Phase 2, tuần 3–4 | Check-in, CTV, Dashboard, CSV, Sheets, hiển thị và cảnh báo Token, báo cáo và khóa, các mục Should/Could | Check-in tại cổng đạt yêu cầu. Sheets cập nhật trong vòng 1 phút. Kiểm thử tải NFR-3 đạt |
| Phase 3, tuần 5–6 | Closed Beta với 2–5 Sự kiện thật | Không còn lỗi nghiêm trọng nào chưa xử lý |

**Điều kiện mở công khai:**
1. Trong Closed Beta không có Vé phát trùng, không bán quá số suất, và không bán Vé khi BTC đã hết Token.
2. Đa số Đơn tự duyệt, không cần BTC can thiệp (SM-2).
3. KYC đầy đủ và các biện pháp chống lừa đảo đã hoạt động (FR-6).
4. Pháp chế xác nhận mô hình Token và nghĩa vụ thương mại điện tử, thuế.

## 12. Chỉ số thành công

**Chính (Closed Beta)**
- **SM-1: Closed Beta không lỗi.** Có 2–5 Sự kiện thật chạy trọn từ mở bán đến check-in, không có lỗi nghiêm trọng nào. Lỗi nghiêm trọng gồm: Vé phát trùng, bán quá số suất, phát Vé khi chưa nhận tiền, khách đã trả tiền mà không nhận được Vé, check-in sai. Kiểm chứng FR-13, FR-19, FR-20, FR-28.

**Phụ** `[ASSUMPTION: mục tiêu số do PM đề xuất, chưa có con số được xác nhận]`
- **SM-2: Tỉ lệ Đơn tự duyệt.** Là số Đơn có phí được phát Vé mà không qua "Cần xử lý", chia cho tổng số Đơn có phí đã thanh toán. Mục tiêu ≥ 95% với QR động và ≥ 80% với QR tĩnh. Kiểm chứng FR-17, FR-19.
- **SM-3: Thời gian từ chuyển khoản đến có Vé.** Tính từ lúc tiền vào tài khoản BTC đến lúc Vé hiện trên màn hình Người mua. Mục tiêu p95 < 10 giây. Kiểm chứng FR-18, FR-19.
- **SM-4: Tỉ lệ BTC quay lại.** Là tỉ lệ BTC trong Closed Beta tạo Sự kiện thứ hai trong vòng 60 ngày. Mục tiêu ≥ 50%. Kiểm chứng giá trị của UJ-2.
- **SM-5: Thời gian tạo Sự kiện.** Tính từ lúc BTC liên kết xong tài khoản nhận tiền đến lúc Sự kiện đầu tiên mở bán. Mục tiêu trung vị < 15 phút. Kiểm chứng FR-7 đến FR-9.

**Dài hạn (chưa có mục tiêu số)**
- Số BTC mới mỗi tháng và tỉ lệ BTC mới đến từ dòng giới thiệu trên Vé (FR-36), dùng làm chỉ báo cho mục tiêu "nền tảng đầu tiên giới trẻ nghĩ đến".
- Số Token tiêu thụ mỗi tháng qua Tickee.

**Chỉ số đối trọng (không tối ưu)** `[ASSUMPTION: do PM đề xuất]`
- **SM-C1: Số báo cáo vi phạm trên 100 Sự kiện.** Không được đổi lấy tăng trưởng số BTC bằng cách nới lỏng kiểm soát. Cân bằng với SM-4 và chỉ số BTC mới.
- **SM-C2: Tỉ lệ bỏ ngang ở bước đăng nhập.** Là tỉ lệ người bấm "Mua" mà không đăng nhập xong. Không được tăng lên để đổi lấy dữ liệu Người mua. Cân bằng với quyết định bắt buộc có Tài khoản Tickee.
- **SM-C3: Số mục trong hàng "Cần xử lý" trên mỗi Sự kiện.** Không được kéo SM-2 lên bằng cách tự duyệt lỏng các giao dịch lệch tiền.

## 13. Câu hỏi mở

1. ~~**Giữ chỗ với QR tĩnh**~~ — **Đã chốt (27/10/2026):** Giữ chỗ 15 phút như QR động. Đơn QR tĩnh đang Chờ thanh toán được tính vào phần trừ của Token khả dụng (FR-17, §3).
2. **Giới hạn Vé:** mỗi Đơn tối đa bao nhiêu Vé? Mỗi Tài khoản Tickee tối đa bao nhiêu Vé cho một Sự kiện?
3. **API Token của Tingee** *(chặn Phase 1. Người phụ trách: Mason làm việc với Tingee. Hạn: trước khi bắt đầu Phase 1)*: Tingee có API đọc số dư, hạn mức và mức trừ theo Merchant con không? API trạng thái QR có gọi được sau khi BTC được mở lại dịch vụ không? Cùng lúc đó, xin Tingee xác nhận bằng văn bản rằng cho tạo Merchant con khi BTC chưa KYC.
4. **QR tĩnh khi BTC bị ngắt dịch vụ** *(chuyển sang Architecture, làm cùng Tingee)*: tiền vẫn về tài khoản BTC nhưng Webhook bị ngắt, và QR tĩnh không có API tra trạng thái. PRD chưa có quy tắc khôi phục Vé cho các giao dịch này. Đây là rủi ro đã biết, gắn với R-3.
5. **Phòng chờ:** tiêu chí nào thì coi là Sự kiện đông, ai bật phòng chờ, Người mua thấy gì khi đang chờ?
6. **Google Sheets:** hệ thống xử lý thế nào khi BTC sửa hoặc xóa cột/dòng, hoặc khi quyền OAuth hết hạn?
7. **Xử lý báo cáo vi phạm:** ai trực, thời gian phản hồi bao lâu, có báo cho BTC hoặc Người mua không? Vé đã phát của Sự kiện bị khóa xử lý ra sao?
8. **Thời gian lưu dữ liệu Người mua** sau Sự kiện: chờ pháp chế. Ảnh hưởng đến FR-24.
9. **Phương thức 2FA cho Owner.**
10. **Chuyển nhượng Vé:** chia sẻ link hoặc ảnh Vé có đủ không, hay cần đổi tên người giữ Vé?
11. **Doanh thu Token với Đơn nhiều Vé:** Token tính theo giao dịch, nên một Đơn 10 Vé chỉ bị trừ một lần. Tingee có muốn tính theo số Vé không? Có cần sửa mục tiêu BO-05 của BRD không?

## 14. Danh mục giả định

- §3: Người mua, thành viên BTC và CTV dùng chung một loại Tài khoản Tickee.
- §3: Danh sách trạng thái Đơn, Vé và Sự kiện do PM đề xuất.
- FR-1: OTP hiệu lực 5 phút, tối đa 5 lần nhập sai. Giữ 2FA cho Owner. SSO Tingee để sau MVP.
- FR-3, FR-38: Thu đồng ý NĐ 13 một lần khi tạo Tài khoản Tickee, kèm thông báo chia sẻ dữ liệu ở Checkout. Có xóa Tài khoản Tickee và rút lại đồng ý.
- FR-4: Quản trị Tingee dùng SSO nội bộ, 2FA, giới hạn IP, và là ngoại lệ duy nhất được xem dữ liệu nhiều BTC.
- FR-7: "Ẩn" nghĩa là tạm dừng nhận Đơn. Có báo email khi sửa thời gian hoặc địa điểm.
- FR-10: Cách hiện số chỗ còn lại do UX quyết.
- FR-11: Sự kiện miễn phí vẫn phải đăng nhập. Trần 200 Vé là giới hạn cứng.
- FR-12: Mặc định tối đa 10 Vé/Đơn, BTC chỉnh được.
- FR-20: Bắt đầu Đối soát bù sau 2 phút.
- FR-22: Không có chuyển nhượng Vé sang Tài khoản Tickee khác.
- FR-24: "Vé bị xóa" nghĩa là ẩn khỏi Người mua và vô hiệu Mã QR vé, BTC vẫn giữ dữ liệu.
- FR-26: Link mời dùng chung hay riêng cho từng CTV do UX/Architecture quyết.
- FR-31: Dashboard xem theo từng Sự kiện.
- FR-32: Cách xử lý khi BTC sửa Sheet.
- FR-34: Nút mua Token chuyển sang luồng của Tingee.
- FR-35: Vé của Sự kiện bị khóa vẫn hợp lệ, trừ khi Quản trị Tingee chọn vô hiệu.
- NFR-3: Tiêu chí bật phòng chờ.
- §7: Token trừ theo giao dịch (mỗi Đơn), không theo Vé.
- §11.4: Sắp lại các phase theo năng lực.
- §12: Mục tiêu số cho SM-2 đến SM-5 và các chỉ số đối trọng.
