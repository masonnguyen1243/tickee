# **Tickee – Tài liệu Đặc tả Yêu cầu Nghiệp vụ (BRD) – MVP v1**

Oct 26, 2026

## **0\. Thông tin tài liệu**

| Mục | Nội dung |
| :---- | :---- |
| Dự án | Tickee – nền tảng bán vé sự kiện trên hạ tầng Tingee |
| Loại tài liệu | BRD (Business Requirements Document) cho MVP |
| Phiên bản | 1.0 |
| Trạng thái | Bản nháp chờ phê duyệt |
| Chủ sở hữu | Tingee |

 

| Phiên bản | Nội dung thay đổi |
| :---- | :---- |
| 1.0 | Nghiên cứu thị trường và ý tưởng sản phẩm ban đầu |

## **1\. Giới thiệu**

### **1.1 Mục đích**

Tài liệu xác định yêu cầu nghiệp vụ cho MVP của Tickee, làm cơ sở thống nhất giữa kinh doanh, sản phẩm, thiết kế, phát triển và kiểm thử.

### **1.2 Phạm vi**

| Trong phạm vi MVP | Ngoài phạm vi MVP |
| :---- | :---- |
| Tạo trang sự kiện, hạng vé, voucher, form tùy chỉnh | Hoàn tiền tự động / hàng loạt |
| Checkout không cần tài khoản, thanh toán QR động/tĩnh qua Tingee | Chợ vé (marketplace) khám phá sự kiện |
| Phát vé tự động, gửi qua Zalo ZNS và email | App mobile native |
| Check-in bằng PWA, chống quét trùng | Check-in offline, in thẻ |
| Đồng bộ Google Sheets theo thời gian thực | Đồng bộ Sheets hai chiều |
| Dashboard BTC, hiển thị số dư Token từ Tingee | Báo cáo nâng cao, Apple/Google Wallet |

### **1.3 Thuật ngữ**

| Thuật ngữ | Ý nghĩa |
| :---- | :---- |
| BTC | Ban tổ chức sự kiện, khách hàng trả phí của Tickee |
| Master Merchant / Merchant con | Tickee là Master Merchant trên Tingee; mỗi BTC là một merchant con |
| QR động | VietQR gắn số tiền và billId, hết hạn sau 15 phút |
| QR tĩnh | VietQR không gắn số tiền, đối soát theo nội dung chuyển khoản |
| billId | Mã định danh hóa đơn trên Tingee, bằng mã đơn Tickee |
| IPN / Webhook | Thông báo giao dịch Tingee gửi về Tickee |
| Token | Đơn vị phí dịch vụ do Tingee quản lý, bị trừ mỗi khi có Webhook |
| ZNS | Zalo Notification Service, tin nhắn giao dịch gửi qua Zalo theo SĐT |
| PWA | Ứng dụng web chạy trên trình duyệt, không cần cài đặt |
| CTV | Cộng tác viên soát vé do BTC mời |

## **2\. Bối cảnh & mục tiêu kinh doanh**

### **2.1 Vấn đề hiện tại**

BTC sự kiện vừa và nhỏ (30–300 khách) đang thu tiền bằng Google Forms \+ chuyển khoản chụp màn hình:

• Phải dò sao kê bằng mắt để xác nhận từng khách, dễ sót và bị lừa ảnh giả.

• Không có vé QR, check-in bằng danh sách giấy hoặc Sheets.

• Sàn vé lớn thu phí 8–15% \+ phí cố định và giữ tiền 7–14 ngày (số liệu nghiên cứu ban đầu, cần kiểm tra lại).

### **2.2 Phân khúc mục tiêu**

| Phân khúc | Ví dụ | Nhu cầu nổi bật |
| :---- | :---- | :---- |
| Thể thao phong trào | Pickleball, cầu lông, bóng đá phủi, chạy CLB | Form tùy chỉnh, Sheets để chia bảng |
| Workshop & networking | BNI, JCI, CLB khởi nghiệp, AI | Sự kiện định kỳ, hóa đơn |
| Phòng trà, livehouse, hài độc thoại | Acoustic bar, kịch ngách | Giữ chỗ, nhận tiền ngay |
| Sinh viên | Prom, CLB đại học | Phí rất thấp hoặc miễn phí |

### **2.3 Mục tiêu kinh doanh**

| Mã | Mục tiêu | Chỉ số đo |
| :---- | :---- | :---- |
| BO-01 | Thay thế quy trình Google Forms \+ duyệt tay | Tỉ lệ đơn được duyệt tự động |
| BO-02 | Tiền về tài khoản BTC ngay, Tickee không giữ tiền | Thời gian từ chuyển khoản đến phát vé |
| BO-03 | Chi phí thấp hơn sàn vé nhiều lần | Phí trên mỗi vé so với đối thủ |
| BO-04 | Tăng trưởng qua mạng lưới merchant Tingee và lan truyền từ vé | Số BTC mới mỗi tháng, tỉ lệ BTC quay lại |
| BO-05 | Tạo doanh thu Token cho hệ sinh thái Tingee | Token tiêu thụ mỗi tháng qua Tickee |

## **3\. Các bên liên quan & tác nhân**

### **3.1 Tác nhân hệ thống**

| Tác nhân | Mô tả | Mục tiêu chính |
| :---- | :---- | :---- |
| Người mua | Khách mua vé, không cần tài khoản | Mua nhanh, nhận vé ngay |
| BTC Owner | Chủ tài khoản BTC | Quản lý sự kiện, tài khoản nhận tiền, Token |
| BTC Admin | Thành viên quản lý của BTC | Tạo sự kiện, xử lý đơn |
| Staff / CTV | Người soát vé | Quét vé nhanh, đúng |
| Quản trị Tingee | Nhân sự vận hành nội bộ | KYC, hỗ trợ, xử lý vi phạm |
| Tingee (hệ thống) | Hạ tầng thanh toán, Token | Tạo QR, gửi IPN, trừ Token |
| Zalo ZNS, Email, Google Sheets (hệ thống) | Kênh gửi vé và đồng bộ dữ liệu | Nhận yêu cầu từ Tickee |

## **4\. Tổng quan giải pháp**

Tickee là ứng dụng chuyên ngành nằm trên Tingee: Tickee lo sự kiện, vé, gửi vé và check-in; Tingee lo QR, đối soát, Token và kết nối 14 ngân hàng.

 

kiến trúc Tickee trên Tingee · dòng tiền tách khỏi dòng dữ liệu

Nguyên tắc thiết kế:

1\. **Không giữ tiền:** tiền vé chảy thẳng từ ngân hàng người mua vào tài khoản BTC; Tickee chỉ nhận trạng thái qua IPN.

2\. **Master Merchant:** Tickee là Master Merchant, mỗi BTC là merchant con liên kết tài khoản nhận tiền khi onboarding.

3\. **Tingee là nguồn sự thật về tiền và Token:** Tickee không lưu sổ Token, chỉ đọc số dư qua API.

4\. **QR động ưu tiên, QR tĩnh dự phòng:** QR động tùy ngân hàng và loại tài khoản (thường là doanh nghiệp); BTC không có QR động dùng QR tĩnh.

## **5\. Quy trình nghiệp vụ**

### **5.1 Quy trình hiện tại (As-is)**

1\. BTC đăng bài kèm link Google Forms và số tài khoản.

2\. Người mua điền form, chuyển khoản, gửi ảnh chụp giao dịch.

3\. BTC đối chiếu ảnh với sao kê bằng tay, nhắn xác nhận qua Zalo.

4\. Ngày sự kiện, BTC điểm danh theo danh sách Sheets.

### **5.2 Quy trình mua vé trên Tickee (To-be)**

Mỗi đơn là một QR động Tingee với billId \= mã đơn; thời hạn QR (15 phút) cũng là thời gian giữ vé.

 

luồng thanh toán · 6 bước, 1 rẽ nhánh

| Bước | Tác nhân | Mô tả |
| :---- | :---- | :---- |
| 1 | Người mua | Chọn hạng vé, điền Tên, SĐT Zalo, email và câu hỏi của BTC |
| 2 | Tickee | Kiểm tra Token khả dụng và tồn kho; giữ vé 15 phút; gọi Tingee tạo QR động |
| 3 | Người mua | Quét QR hoặc bấm Deep Link mở app ngân hàng, chuyển khoản |
| 4 | Tingee | Nhận biến động từ ngân hàng, gửi IPN về Tickee, tự trừ Token |
| 5 | Tickee | Xác thực IPN, khớp billId và số tiền, phát vé, hiển thị vé trên trình duyệt |
| 6 | Tickee | Gửi vé qua ZNS \+ email, ghi một dòng vào Google Sheets của BTC |
| 7 | Staff / CTV | Ngày sự kiện quét QR trên vé bằng PWA, hệ thống báo xanh hoặc đỏ |

### **5.3 Quy trình onboarding BTC**

1\. BTC đăng ký tài khoản Tickee.

2\. Xác minh danh tính (KYC) và liên kết tài khoản nhận tiền qua Tingee; hệ thống tạo merchant con.

3\. Tickee báo BTC dùng được QR động hay chỉ QR tĩnh.

4\. BTC mua Token hoặc được cấp hạn mức trả sau.

5\. BTC tạo sự kiện đầu tiên và mở bán.

## **6\. Yêu cầu chức năng (FR)**

Ưu tiên theo MoSCoW: Must \= bắt buộc cho MVP, Should \= nên có, Could \= có thì tốt.

| Mã | Module | Yêu cầu | Ưu tiên |
| :---- | :---- | :---- | :---- |
| FR-01 | Tài khoản BTC | BTC đăng ký, đăng nhập, mời thành viên theo vai trò Owner / Admin / Staff | Must |
| FR-02 | Tài khoản BTC | BTC hoàn tất KYC và liên kết tài khoản nhận tiền qua Tingee; hệ thống tạo merchant con | Must |
| FR-03 | Sự kiện | Tạo, sửa, ẩn, hủy sự kiện: tên, thời gian, địa điểm, mô tả, ảnh, chính sách hoàn vé | Must |
| FR-04 | Sự kiện | Tạo nhiều hạng vé: giá, số lượng, thời gian mở/đóng bán | Must |
| FR-05 | Sự kiện | Thêm câu hỏi tùy chỉnh: văn bản, lựa chọn, bắt buộc/không | Must |
| FR-06 | Sự kiện | Tạo voucher: mức giảm, số lượt, thời hạn | Should |
| FR-07 | Sự kiện | Trang sự kiện công khai mobile-first, có ảnh preview khi chia sẻ Facebook/Zalo | Must |
| FR-08 | Checkout | Mua vé không cần tài khoản: Tên, SĐT Zalo, email \+ câu hỏi của BTC | Must |
| FR-09 | Checkout | Giữ vé trong thời hạn QR (15 phút), hiển thị đếm ngược | Must |
| FR-10 | Checkout | Hiển thị QR động, nút tải ảnh QR, Deep Link mở app ngân hàng | Must |
| FR-11 | Checkout | Dùng QR tĩnh với nội dung chuyển khoản chứa mã đơn khi BTC không có QR động | Must |
| FR-12 | Checkout | Tự chuyển màn hình sang "Thành công" và hiển thị vé ngay khi đơn được thanh toán | Must |
| FR-13 | Thanh toán | Nhận IPN, xác thực chữ ký, khớp billId và số tiền thực nhận, phát vé | Must |
| FR-14 | Thanh toán | Đối soát bù bằng API trạng thái QR khi IPN trễ hoặc sau khi BTC được mở lại dịch vụ | Must |
| FR-15 | Thanh toán | Hàng chờ "Cần xử lý" cho giao dịch lệch tiền, mồ côi, chưa khớp; BTC ghép tay hoặc duyệt tay | Must |
| FR-16 | Gửi vé | Gửi vé qua Zalo ZNS (BTC bật/tắt) và email | Must |
| FR-17 | Gửi vé | Trang vé web có QR; tra lại vé bằng OTP qua SĐT hoặc email | Must |
| FR-18 | Gửi vé | Ảnh Social Ticket Card để chia sẻ Story, ẩn QR | Should |
| FR-19 | Check-in | PWA quét QR bằng camera trình duyệt; báo xanh khi hợp lệ, đỏ \+ âm thanh khi trùng hoặc không hợp lệ | Must |
| FR-20 | Check-in | BTC mời CTV soát vé bằng link/mã theo sự kiện, có hạn, thu hồi được | Must |
| FR-21 | Check-in | Tra cứu và check-in tay theo tên/SĐT khi khách không mở được QR | Should |
| FR-22 | Đồng bộ | Kết nối Google Sheets của BTC; ghi từng đơn, trạng thái thanh toán, trạng thái check-in | Must |
| FR-23 | Dashboard | Doanh thu, số vé theo hạng, danh sách đơn, xuất CSV | Must |
| FR-24 | Dashboard | Hiển thị số dư và hạn mức Token từ Tingee, cảnh báo sắp hết, nút mua thêm | Must |
| FR-25 | Dashboard | Hủy sự kiện: nhắn hàng loạt cho khách, xuất danh sách cần hoàn | Should |
| FR-26 | Niềm tin | Người mua báo cáo sự kiện; quản trị Tingee khóa sự kiện/BTC vi phạm | Must |
| FR-27 | Lan truyền | Dòng giới thiệu Tickee dưới trang mua vé và tin nhắn vé | Could |

## **7\. User story & tiêu chí chấp nhận**

Các story cốt lõi của MVP; tiêu chí viết theo dạng Given / When / Then để QA kiểm thử trực tiếp.

**US-01 – Mua vé bằng QR động** (FR-08 → FR-13)

Là người mua, tôi muốn quét QR và nhận vé ngay, để không phải gửi ảnh chụp giao dịch cho BTC.

• Given hạng vé còn chỗ và BTC còn Token khả dụng, When tôi gửi form, Then hệ thống giữ 1 chỗ và hiển thị QR động đúng số tiền kèm đếm ngược 15 phút.

• Given QR còn hiệu lực, When tôi chuyển đúng số tiền, Then màn hình chuyển sang "Thành công" và hiển thị vé có QR.

• Given vé đã phát, Then tôi nhận vé qua ZNS (nếu BTC bật) và email.

• Given tôi không trả trong 15 phút, Then QR hết hiệu lực, chỗ được nhả và đơn chuyển "Hết hạn".

**US-02 – Chống bán lố** (FR-09, BR-01)

Là BTC, tôi muốn không bao giờ bán quá số suất, để không phải từ chối khách đã trả tiền.

• Given hạng vé còn 1 chỗ, When hai người cùng gửi form, Then chỉ một người được giữ chỗ, người còn lại thấy "Hết vé".

**US-03 – IPN gửi lặp** (FR-13, BR-04)

• Given một giao dịch đã được xử lý, When Tingee gửi lại cùng IPN, Then không phát thêm vé và không gửi thêm tin.

**US-04 – Check-in tại cổng** (FR-19, FR-20)

Là CTV, tôi muốn quét vé bằng điện thoại mà không cài app, để cho khách vào nhanh.

• Given tôi mở link mời còn hiệu lực, Then tôi chỉ thấy màn hình quét của sự kiện đó.

• Given vé hợp lệ chưa check-in, When tôi quét, Then màn hình báo xanh kèm tên khách và hạng vé.

• Given vé đã check-in, When tôi quét lại, Then màn hình báo đỏ \+ âm thanh kèm giờ và người quét lần trước.

**US-05 – Hết Token** (FR-24, BR-06)

Là BTC Owner, tôi muốn được báo trước khi hết Token, để việc bán vé không bị gián đoạn.

• Given Token khả dụng xuống dưới ngưỡng tôi đặt, Then tôi nhận cảnh báo qua Zalo/email và trên dashboard.

• Given Token khả dụng không đủ cho thêm một giao dịch, When người mua gửi form, Then hệ thống không tạo QR và hiển thị "Tạm ngừng bán".

**US-06 – Đồng bộ Google Sheets** (FR-22)

• Given BTC đã kết nối Sheets, When một đơn được thanh toán hoặc check-in, Then Sheets có dòng mới hoặc cập nhật trạng thái trong vòng 1 phút.

## **8\. Quy tắc nghiệp vụ (BR) & xử lý ngoại lệ**

### **8.1 Quy tắc nghiệp vụ**

| Mã | Quy tắc |
| :---- | :---- |
| BR-01 | Tổng vé đã bán \+ đang giữ của mỗi hạng không bao giờ vượt số suất |
| BR-02 | Mỗi đơn giữ chỗ đúng bằng thời hạn QR động: 15 phút; hết hạn thì QR không quét thanh toán được và chỗ được nhả |
| BR-03 | Vé chỉ được phát khi IPN hợp lệ và số tiền thực nhận bằng số tiền đơn |
| BR-04 | Mỗi giao dịch IPN chỉ được xử lý một lần, dù Tingee gửi lặp |
| BR-05 | Tingee trừ Token cho mỗi giao dịch có Webhook báo về (QR động, QR tĩnh, kể cả lệch tiền hoặc chưa khớp); Tickee không trừ hoặc lưu Token |
| BR-06 | Tickee chỉ tạo QR mới khi Token khả dụng \= số dư \+ hạn mức âm − số QR đang mở × mức trừ ≥ mức trừ một giao dịch |
| BR-07 | Vượt hạn mức Token, Tingee ngắt toàn bộ API \+ Webhook của BTC; Tickee hiển thị "Tạm ngừng bán" |
| BR-08 | Mỗi vé chỉ check-in thành công một lần; các lần quét sau báo trùng |
| BR-09 | Mã QR trên vé được ký; mã không kiểm tra được chữ ký báo không hợp lệ |
| BR-10 | BTC phải hoàn tất KYC trước khi mở bán sự kiện có phí |
| BR-11 | Trang checkout ghi rõ "Tiền chuyển thẳng cho \[tên BTC\]" và hiển thị chính sách hoàn vé của BTC |
| BR-12 | Sự kiện miễn phí không tạo QR và không tiêu Token; giới hạn 200 vé/sự kiện (tham khảo) |

### **8.2 Xử lý ngoại lệ**

| Mã | Tình huống | Hệ thống tự động | BTC làm |
| :---- | :---- | :---- | :---- |
| EX-01 | QR động hết hạn, khách chưa trả | Nhả vé, mời khách tạo đơn mới | Không cần |
| EX-02 | Số tiền thực nhận lệch với đơn | Giữ đơn "Lệch số tiền", không phát vé | Duyệt tay hoặc tự hoàn |
| EX-03 | IPN trễ hoặc mất | Poll API trạng thái QR, đối soát bù | Không cần |
| EX-04 | QR tĩnh: trả sau khi đã nhả vé, vé còn | Phát vé bình thường | Không cần |
| EX-05 | QR tĩnh: trả sau khi đã nhả vé, vé hết | Đánh dấu "Thanh toán mồ côi", báo BTC \+ nhắn khách | Tự hoàn hoặc mở thêm chỗ |
| EX-06 | QR tĩnh: sai nội dung chuyển khoản | Đưa vào "Giao dịch chưa khớp" | Ghép tay với đơn |
| EX-07 | BTC bị ngắt dịch vụ khi còn QR đang mở | Sau khi mở lại, gọi API trạng thái các QR đó để phát vé bù | Mua thêm Token |
| EX-08 | Sự kiện hủy | Nhắn hàng loạt, xuất danh sách cần hoàn | Tự chuyển hoàn theo danh sách |
| EX-09 | Gửi ZNS / email / Sheets lỗi | Thử lại tự động; vé vẫn hợp lệ trên trang web | Không cần |

## **9\. Yêu cầu phi chức năng (NFR)**

Các con số dưới đây là mục tiêu đề xuất, cần đội kỹ thuật xác nhận trước khi chốt.

| Mã | Nhóm | Yêu cầu |
| :---- | :---- | :---- |
| NFR-01 | Hiệu năng | Trang sự kiện tải dưới 2 giây trên 4G; tạo QR dưới 2 giây |
| NFR-02 | Hiệu năng | Từ lúc nhận IPN đến hiển thị vé trên trình duyệt dưới 3 giây; quét check-in phản hồi dưới 1 giây |
| NFR-03 | Chịu tải | Chịu được 5.000 người cùng vào mua một sự kiện 300 vé mà không bán lố; bật phòng chờ cho sự kiện hot |
| NFR-04 | Sẵn sàng | Uptime 99,9%/tháng cho checkout, IPN và check-in |
| NFR-05 | Toàn vẹn dữ liệu | Xử lý đơn, phát vé và ghi việc cần gửi nằm trong một transaction; sao lưu khôi phục theo thời điểm |
| NFR-06 | Bảo mật | HTTPS toàn bộ; xác thực chữ ký HMAC cho mọi request tới Tingee và mọi IPN; 2FA cho BTC Owner |
| NFR-07 | Cách ly dữ liệu | BTC này không đọc được dữ liệu BTC khác (phân tách theo tổ chức, Row Level Security) |
| NFR-08 | Dữ liệu cá nhân | Thu thập đồng ý xử lý dữ liệu tại checkout theo NĐ 13/2023; không lưu thông tin tài khoản ngân hàng của người mua |
| NFR-09 | Khả dụng | Mobile-first; hoạt động trên Safari iOS và Chrome Android hiện hành; giao diện tiếng Việt |
| NFR-10 | Giám sát | Cảnh báo khi IPN lỗi, tỉ lệ phát vé giảm bất thường hoặc hàng đợi gửi vé ùn ứ |
| NFR-11 | Kiểm toán | Ghi nhật ký mọi thay đổi sự kiện, phân quyền và xử lý đơn tay |

## **10\. Yêu cầu dữ liệu**

Database của Tickee chỉ lưu dữ liệu nghiệp vụ bán vé; tiền và Token nằm ở Tingee. Mỗi mũi tên đọc là "một → nhiều".

 

kiến trúc dữ liệu · mũi tên \= một → nhiều

### **10.1 Thực thể dữ liệu**

| Nhóm | Thực thể | Lưu gì |
| :---- | :---- | :---- |
| Tổ chức | organizations | BTC (merchant con): tên, mã merchant Tingee, trạng thái KYC |
| Tổ chức | users, memberships | Tài khoản và vai trò trong từng BTC; CTV được giao sự kiện nào |
| Tổ chức | integrations | Kết nối Google Sheets, Zalo OA của BTC |
| Sự kiện | events | Tên, thời gian, địa điểm, mô tả, ảnh, chính sách hoàn vé |
| Sự kiện | ticket\_types | Giá, tổng số, đã bán, đang giữ, thời gian mở bán |
| Sự kiện | form\_fields, vouchers | Câu hỏi tùy chỉnh; mã giảm giá |
| Đơn & vé | orders | Người mua (tên, SĐT Zalo, email), tổng tiền, trạng thái |
| Đơn & vé | attendees | Từng người dự \+ câu trả lời form |
| Đơn & vé | reservations | Vé đang giữ, hết hạn sau 15 phút |
| Đơn & vé | tickets | Vé đã phát: mã QR đã ký, thời điểm check-in |
| Thanh toán | payments | Đơn ↔ billId, loại QR, số tiền, trạng thái |
| Thanh toán | payment\_events | Bản gốc IPN, chống xử lý trùng, tra soát |
| Vận hành | checkins | Lượt quét: vé, người quét, thời điểm, kết quả |
| Vận hành | outbox | Việc cần gửi ZNS, email, Sheets (thử lại khi lỗi) |
| Vận hành | audit\_logs | Ai thay đổi gì, lúc nào |

Không lưu: số dư và lịch sử Token (đọc từ Tingee), tiền, thông tin tài khoản ngân hàng của người mua.

### **10.2 Ví dụ luồng dữ liệu**

CLB ABC mở giải Pickleball, hạng "Đơn nam" giá 300.000đ, 64 suất; anh Minh mua 1 vé.

| Bước | Chuyện gì xảy ra | Thực thể được ghi |
| :---- | :---- | :---- |
| 1\. BTC tạo sự kiện | Tạo giải, hạng vé, câu hỏi "Trình độ" | events, ticket\_types (64 suất), form\_fields |
| 2\. Minh bấm mua (10:00) | Tạo đơn \#T1024, giữ 1 chỗ đến 10:15 | orders, attendees, reservations; ticket\_types.reserved \+1 |
| 3\. Hiện QR | Tingee tạo QR động 300.000đ, billId \= T1024 | payments (chờ) |
| 4\. Minh chuyển khoản (10:03) | Tiền vào TK CLB ABC; Tingee gửi IPN, tự trừ Token | payment\_events |
| 5\. Xử lý (1 transaction) | Khớp billId và số tiền, phát vé | payments, orders → đã thanh toán; xóa reservations; tickets \+1; outbox \+3 |
| 6\. Gửi vé | ZNS \+ email, ghi Google Sheets | outbox → xong |
| 7\. CTV quét (7:30) | Báo xanh | tickets.checked\_in\_at; checkins (hợp lệ) |
| 8\. Quét lại (7:42) | Báo đỏ, đã check-in lúc 7:30 | checkins (trùng) |

### **10.3 Quy ước dữ liệu**

• Tiền lưu số nguyên theo đồng, không dùng số thực; thời gian có múi giờ.

• Mọi bản ghi gắn organization\_id để cách ly dữ liệu giữa các BTC.

• Dữ liệu người mua chỉ dùng cho sự kiện đã mua; thời gian lưu trữ cần pháp chế chốt.

## **11\. Tích hợp hệ thống**

| Mã | Hệ thống | Chức năng dùng | Ghi chú |
| :---- | :---- | :---- | :---- |
| INT-01 | Tingee – Master Merchant | Tạo merchant con, liên kết tài khoản nhận tiền của BTC | Khi onboarding |
| INT-02 | Tingee – QR động | POST /v1/generate-dynamic-qr, tra trạng thái, xóa QR | 15 phút, gắn billId ([tài liệu](https://developers.tingee.vn/docs/qr/dynamic/)) |
| INT-03 | Tingee – QR tĩnh | QR cho BTC không có QR động | Đối soát theo nội dung ([tài liệu](https://developers.tingee.vn/docs/qr/static/)) |
| INT-04 | Tingee – Webhook (IPN) | Nhận giao dịch kèm số tiền thực nhận | Mỗi Webhook bị trừ Token |
| INT-05 | Tingee – Token | Đọc số dư, hạn mức, lịch sử trừ | API cần Tingee xác nhận |
| INT-06 | Tingee – Deep Link | Mở app ngân hàng từ trang checkout |   |
| INT-07 | Zalo ZNS | Gửi vé và cảnh báo theo SĐT | Cần Zalo OA xác thực \+ mẫu tin được duyệt |
| INT-08 | Email (Amazon SES / Resend) | Gửi vé, OTP, thông báo | Kênh dự phòng của ZNS |
| INT-09 | Google Sheets API | Ghi đơn và trạng thái check-in vào Sheets của BTC | BTC cấp quyền OAuth |

Mọi request tới Tingee ký bằng x-client-id, x-request-timestamp, x-signature (HMAC SHA512); API luôn trả HTTP 200, thành công khi code \= "00" ([Tingee Developers](https://developers.tingee.vn/docs/)).

## **12\. Phân quyền & bảo mật**

### **12.1 Ma trận phân quyền**

| Chức năng | Owner | Admin | Staff / CTV | Người mua |
| :---- | :---- | :---- | :---- | :---- |
| Liên kết tài khoản nhận tiền, KYC | Có | Không | Không | Không |
| Mua Token, xem số dư Token | Có | Xem | Không | Không |
| Mời / xóa thành viên | Có | Không | Không | Không |
| Tạo, sửa, hủy sự kiện | Có | Có | Không | Không |
| Xem đơn, doanh thu, xuất CSV | Có | Có | Không | Không |
| Xử lý đơn "Cần xử lý" | Có | Có | Không | Không |
| Mời CTV soát vé | Có | Có | Không | Không |
| Quét check-in | Có | Có | Sự kiện được giao | Không |
| Xem vé | – | – | – | Vé của mình |

### **12.2 Xác thực**

| Nhóm | Cách đăng nhập |
| :---- | :---- |
| Người mua | Không cần tài khoản; xem vé qua link có chữ ký, tra lại bằng OTP qua SĐT hoặc email |
| Owner / Admin BTC | SSO tài khoản Tingee nếu có; nếu không: email \+ mật khẩu, Google hoặc magic link. Bắt buộc 2FA cho Owner |
| Staff / CTV | Link hoặc mã mời theo sự kiện, có hạn, thu hồi được; có thể kèm OTP |
| Quản trị Tingee | SSO nội bộ \+ 2FA, giới hạn IP |

Phiên đăng nhập lưu cookie httpOnly, access token ngắn hạn, refresh token xoay vòng. IPN từ Tingee luôn kiểm tra chữ ký và giới hạn IP nguồn nếu được.

## **13\. Mô hình phí & Token**

Tingee quản lý chi phí của BTC bằng Token và tự trừ mỗi khi gửi Webhook; mọi mức phí dưới đây chỉ để tham khảo, sẽ chốt sau.

| Thành phần | Quy định |
| :---- | :---- |
| Ai quản lý | Tingee: số dư, lịch sử trừ, bảng giá gói, hóa đơn. Tickee không lưu bản sao |
| Cách thanh toán | Trả trước; hoặc trả sau / cho âm Token theo hạn mức Tingee cấp cho từng BTC |
| Khi nào trừ | Mỗi Webhook báo một giao dịch (BR-05) |
| Trừ bao nhiêu | Theo mức Tingee quy định mỗi giao dịch; tham khảo tương đương 3.000–5.000đ/vé |
| Zalo ZNS | Tính riêng, BTC bật/tắt |
| Sự kiện miễn phí | Không tiêu Token (BR-12) |
| Vượt hạn mức | Tingee ngắt API \+ Webhook; Tickee ngừng tạo QR trước đó (BR-06, BR-07) |

So sánh chi phí tham khảo với sàn vé thu 10% \+ 15.000đ/vé, vé 300.000đ, Tickee ở mức 4.000đ/vé:

| Quy mô sự kiện | Chi phí qua Tickee | Chi phí qua sàn vé |
| :---- | :---- | :---- |
| 50 vé | 200.000đ | 2.250.000đ |
| 150 vé | 600.000đ | 6.750.000đ |
| 300 vé | 1.200.000đ | 13.500.000đ |

Token chỉ dùng cho dịch vụ Tingee, không quy đổi ngược ra tiền và không chuyển nhượng, để không bị coi là ví điện tử.

## **14\. Giả định, ràng buộc, phụ thuộc & rủi ro**

### **14.1 Giả định**

• A-01: Tingee cung cấp API đọc số dư, hạn mức và lịch sử Token theo merchant con.

• A-02: API trạng thái QR vẫn gọi được sau khi BTC được mở lại dịch vụ (để phát vé bù EX-07).

• A-03: BTC có tài khoản tại một trong 14 ngân hàng Tingee hỗ trợ.

### **14.2 Ràng buộc**

• C-01: QR động hết hạn cố định sau 15 phút.

• C-02: QR động tùy ngân hàng và loại tài khoản, thường chỉ tài khoản doanh nghiệp.

• C-03: API Chi hộ không hỗ trợ hoàn tiền hàng loạt.

• C-04: Tickee là sản phẩm của Tingee; nghĩa vụ pháp lý xét theo pháp nhân Tingee.

### **14.3 Phụ thuộc**

• DEP-01: Zalo OA xác thực và mẫu ZNS được duyệt trước Closed Beta.

• DEP-02: Ý kiến pháp chế về TMĐT, thuế và Token trước khi mở công khai.

### **14.4 Rủi ro**

| Mã | Rủi ro | Mức | Biện pháp |
| :---- | :---- | :---- | :---- |
| R-01 | Sự kiện lừa đảo, tiền đã về tài khoản kẻ gian | Cao | KYC (BR-10), giới hạn vé có phí cho BTC mới, báo cáo \+ khóa sự kiện (FR-26) |
| R-02 | Khách đổ lỗi Tickee khi không được hoàn tiền | Cao | BR-11, chính sách hoàn vé bắt buộc |
| R-03 | BTC bị ngắt dịch vụ khi còn QR đang mở, khách trả tiền không nhận vé | Cao | BR-06, cảnh báo sớm, EX-07 |
| R-04 | BTC dùng QR tĩnh, tỉ lệ ghép tay cao và vẫn bị trừ Token cho giao dịch sai nội dung | Trung bình | Hướng dẫn nội dung rõ tại checkout; khuyến khích tài khoản có QR động |
| R-05 | Nghĩa vụ sàn TMĐT và thuế (NĐ 117/2025) | Trung bình | Pháp chế xác định SaaS hay sàn theo pháp nhân Tingee |
| R-06 | Token bị coi là ví điện tử | Trung bình | Không rút, không chuyển nhượng, xuất hóa đơn khi mua |
| R-07 | Zalo OA / ZNS duyệt chậm | Trung bình | Nộp tuần 1; email là kênh dự phòng |
| R-08 | Dữ liệu cá nhân (NĐ 13/2023) | Trung bình | NFR-08; GTM không dùng tool cào dữ liệu |
| R-09 | Đối thủ hạ phí hoặc sao chép | Trung bình | Trải nghiệm sản phẩm \+ mạng lưới merchant Tingee |

## **15\. Lộ trình & tiêu chí nghiệm thu**

MVP dự kiến 6 tuần vì thanh toán đã có sẵn trên Tingee; thủ tục Zalo và pháp lý chạy song song từ tuần 1\.

 

lộ trình MVP · 3 phase, 1 cửa mở công khai

| Giai đoạn | Yêu cầu bao phủ | Tiêu chí hoàn thành |
| :---- | :---- | :---- |
| Phase 1 · Tuần 1–2 | FR-01 → FR-15, BR-01 → BR-07 | US-01, US-02, US-03, US-05 đạt trên sandbox Tingee |
| Phase 2 · Tuần 3–4 | FR-16 → FR-27 | US-04, US-06 đạt; kiểm thử tải NFR-03 đạt |
| Phase 3 · Tuần 5–6 | Closed Beta 5–10 sự kiện, mọi mô hình tương tự | Không có lỗi nghiêm trọng mở |

Tiêu chí mở công khai (tuần 7):

• ☐ Không có vé phát trùng hoặc bán vé khi BTC đã hết Token trong beta

• ☐ Đa số đơn tự duyệt, không cần BTC can thiệp

• ☐ Mẫu ZNS đã duyệt

• ☐ Pháp chế xác nhận mô hình Token và nghĩa vụ TMĐT

## **16\. Quyết định đã chốt & vấn đề mở**

### **16.1 Quyết định đã chốt**

| Mã | Chủ đề | Quyết định |
| :---- | :---- | :---- |
| D-01 | Tài khoản cá nhân | Hầu hết ngân hàng hỗ trợ; QR động tùy ngân hàng và loại tài khoản, QR tĩnh là dự phòng |
| D-02 | Mô hình tài khoản | Tickee là Master Merchant, mỗi BTC là merchant con |
| D-03 | Thời hạn QR động | 15 phút; hết hạn không quét thanh toán được |
| D-04 | IPN | Trả về số tiền thực nhận |
| D-05 | Chi phí | Tingee quản lý Token, tự trừ mỗi Webhook kể cả QR tĩnh; cho trả sau hoặc âm theo hạn mức; vượt hạn mức ngắt API \+ Webhook |
| D-06 | Hoàn tiền | Làm ở giai đoạn sau |
| D-07 | Pháp nhân | Tickee là sản phẩm của Tingee |
| D-08 | Mức phí | Số trong tài liệu chỉ để tham khảo, chốt sau |
| D-09 | Ngách Closed Beta | Mọi mô hình tương tự: thể thao, workshop, phòng trà, sinh viên |
| D-10 | Database | Tickee không lưu Token; chỉ lưu bản ghi đối chiếu thanh toán (payments, payment\_events) |

## **Phụ lục A. Công nghệ đề xuất**

TypeScript cho cả frontend và backend (Tingee có SDK Node.js); PostgreSQL là nguồn dữ liệu gốc của Tickee.

| Lớp | Đề xuất |
| :---- | :---- |
| Trang sự kiện, checkout, dashboard | Next.js (React), Tailwind CSS, shadcn/ui |
| Backend API | NestJS (Node.js) \+ Tingee Node SDK |
| Cơ sở dữ liệu | PostgreSQL managed (primary \+ standby, sao lưu PITR), PgBouncer, read replica cho báo cáo; Prisma hoặc Drizzle |
| Hàng đợi, cache | Redis \+ BullMQ: xử lý IPN, gửi vé, đồng bộ Sheets, rate limit, phòng chờ |
| Trạng thái realtime | Server-Sent Events, poll API trạng thái QR dự phòng |
| Check-in | PWA \+ ZXing hoặc html5-qrcode; QR vé ký HMAC |
| Ảnh vé chia sẻ | Satori / @vercel/og |
| Xác thực | Better Auth / Auth.js, hoặc Keycloak / Logto nếu dùng chung danh tính với Tingee |
| Hạ tầng, vận hành | Docker, GitHub Actions, Sentry, Grafana \+ Prometheus; cloud trong nước hoặc AWS Singapore |
| Kiểm thử tải | k6 |

Cơ chế kỹ thuật then chốt:

• **Giữ vé (BR-01):** UPDATE ticket\_types SET reserved \= reserved \+ 1 WHERE id \= ? AND sold \+ reserved \< capacity.

• **IPN (BR-04):** ghi payment\_events với unique theo mã giao dịch, trả 200 ngay; worker xử lý đơn, phát vé, ghi outbox trong một transaction.

• **Check-in (BR-08):** UPDATE tickets SET checked\_in\_at \= now() WHERE id \= ? AND checked\_in\_at IS NULL.

