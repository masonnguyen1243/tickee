# Extract PRD Tickee cho UX (DESIGN.md + EXPERIENCE.md)

Nguồn: `prds/prd-tickee-2026-10-27/prd.md` (status: final, 27/10/2026) + `addendum.md`. PRD là bản có hiệu lực so với BRD (§0). Thuật ngữ in đậm giữ nguyên như Glossary §3. Mã FR là mã toàn cục của PRD (không theo thứ tự số trong nhóm). FR không ghi mức là Must.
Tên sản phẩm "Tickee" là *tên làm việc — cần xác nhận* (tiêu đề PRD) → ảnh hưởng branding.

---

## 0. Định vị (ảnh hưởng giọng điệu & nhận diện) — §1, §10
- Bán vé sự kiện cho BTC vừa và nhỏ ở VN (30–300 khách/Sự kiện), chạy trên hạ tầng thanh toán **Tingee**.
- Thông điệp cốt lõi: tạo trang Sự kiện trong vài phút → gửi link Zalo/Facebook → quét VietQR nhận Vé ngay → tiền về thẳng tài khoản BTC, Tickee không giữ tiền → hệ thống tự khớp giao dịch → check-in bằng trình duyệt, không cần cài app.
- Thay thế: Google Forms, ảnh chụp chuyển khoản, dò sao kê, điểm danh giấy. Rẻ hơn sàn vé (8–15% + giữ tiền 7–14 ngày).
- Đích đến: "nền tảng đầu tiên giới trẻ nghĩ đến khi muốn tổ chức một sự kiện hay workshop" → đối tượng trẻ.
- Phân khúc Closed Beta: thể thao phong trào (Pickleball, cầu lông, bóng đá phủi, chạy CLB), workshop/networking, phòng trà, livehouse, hài độc thoại, sự kiện sinh viên (§2).
- Non-Goals (§10): không giữ tiền/không xử lý hoàn tiền; **không phải chợ vé** (không trang khám phá, không gợi ý Sự kiện); không lưu Token/tiền/tài khoản ngân hàng Người mua; không CRM/email marketing; không sơ đồ chỗ ngồi/vé theo bàn.

## 1. Persona / vai trò — §2, §3, FR-4

| Vai trò | JTBD / mục tiêu | Thiết bị & bối cảnh | Nguồn |
|---|---|---|---|
| **Người mua** (vd. Minh) | "Mua xong là có vé ngay", không gửi ảnh chuyển khoản chờ xác nhận; yên tâm tiền chuyển thẳng cho BTC và biết chính sách hoàn vé trước khi trả | Điện thoại, mở link từ nhóm Zalo/Facebook trên trình duyệt; app ngân hàng để chuyển khoản; đứng ở cổng có thể không mở được Vé | §2.1, UJ-1 |
| **BTC** – **Owner** (vd. anh Tuấn, chủ nhiệm CLB) | Mở bán nhanh, tiền về ngay tài khoản; biết ai đã trả, ai đã vào, người thật không phải bot; không bán quá suất; không trả ~10% cho sàn | Không nêu rõ thiết bị cho dashboard (FR-30 "trong lúc Sự kiện diễn ra" ⇒ có thể dùng điện thoại tại sự kiện); biết Tickee qua giới thiệu/quảng cáo Tingee | §2.1, UJ-2 |
| **Admin** (thành viên BTC) | Tạo Sự kiện, xử lý Đơn; không quản lý tài khoản nhận tiền hay thành viên | như Owner | §3, FR-4 |
| **CTV** (vd. Lan, sinh viên) | "Cho khách qua cổng thật nhanh và không nhầm lẫn, chỉ cần cái điện thoại"; liếc: xanh cho vào, đỏ dừng lại | Điện thoại, camera trình duyệt, đứng cổng ngoài trời/đông người, nhiều CTV song song; không thuộc BTC | §2.1, UJ-3 |
| **Quản trị Tingee** | Duyệt BTC vào Closed Beta, xem báo cáo vi phạm, khóa/mở khóa Sự kiện/BTC | SSO nội bộ, 2FA, dải IP cho phép (nội bộ) | §3, FR-4, FR-35, FR-37 |

Không phải người dùng v1 (§2.2): BTC > 300 khách / cần sơ đồ chỗ; người đi tìm sự kiện (không chợ vé); BTC không có tài khoản ở 14 ngân hàng Tingee hỗ trợ.
`[ASSUMPTION §3]` Người mua, thành viên BTC, CTV dùng chung một loại **Tài khoản Tickee**; vai trò gắn theo từng BTC/Sự kiện → một người có thể vừa là Người mua vừa là CTV vừa thuộc nhiều BTC (cần chuyển ngữ cảnh, FR-2).

## 2. Glossary liên quan UI (nguyên văn tên) — §3
- **Tingee**, **Quản trị Tingee**, **Tài khoản Tickee**, **BTC (Ban tổ chức)**, **Owner**, **Admin**, **CTV (Cộng tác viên soát vé)**, **Người mua**, **Master Merchant / Merchant con**.
- **Sự kiện**; **Sự kiện kết thúc** (tự chuyển "Đã kết thúc" vào mốc muộn hơn của: 23:59 ngày kết thúc đã khai báo, hoặc giờ kết thúc + 6 tiếng; Owner/Admin bấm "Kết thúc" sớm được; từ mốc này Vé rời "Vé của tôi", quyền CTV hết); **Sự kiện miễn phí** (mọi Hạng vé 0đ, không QR thanh toán, không tiêu Token).
- **Hạng vé** (giá, số suất, thời gian mở/đóng bán); **Đơn** (một lần mua, nhiều Vé/nhiều Hạng vé, một QR thanh toán, một mã Đơn = billId, form điền một lần); **Vé**; **Mã QR vé** (ký số, để check-in — KHÔNG phải QR thanh toán).
- **QR thanh toán** (VietQR): **QR động** (gắn số tiền + billId, hết hạn 15 phút) / **QR tĩnh** (không gắn số tiền, đối soát theo nội dung chuyển khoản chứa mã Đơn).
- **Giữ chỗ** (15 phút = thời hạn QR thanh toán); **IPN**; **Đối soát bù**.
- **Token**, **Token khả dụng** (số dư + hạn mức âm/trả sau − số Đơn Chờ thanh toán × mức trừ).
- **Cần xử lý** — 3 loại: "Lệch số tiền", "Thanh toán mồ côi", "Giao dịch chưa khớp".
- **Closed Beta**, **Closed Beta được duyệt**; **Vé của tôi**; **Check-in**.
- Nhãn UI nguyên văn khác trong PRD: "Mua", "Thành công", "Hết vé", "Chưa mở bán", "Đã đóng bán", "Tạm ngừng bán", "Kết thúc", "Chờ duyệt Closed Beta", "thành công", "vé không hợp lệ", "Đã hoàn tay", "mua thêm Token", "còn ít chỗ", "Tiền chuyển thẳng cho [tên BTC]".

## 3. Bề mặt / màn hình theo vai trò (suy ra từ FR)

### 3.1 Chung / xác thực
| Màn hình | Nội dung chính | FR |
|---|---|---|
| Đăng ký / đăng nhập | Google hoặc OTP qua email; nhập email → nhập OTP (dùng 1 lần, hạn 5 phút, tối đa 5 lần sai `[ASSUMPTION]`); không mật khẩu, không SĐT | FR-1 |
| Đồng ý NĐ 13/2023 khi tạo Tài khoản Tickee | Điều khoản xử lý dữ liệu cá nhân (một lần, `[ASSUMPTION]` chờ pháp chế) | FR-3, NFR-8, §8 |
| Thiết lập/nhập 2FA cho Owner | Bắt buộc với Owner; phương thức chưa chốt (Câu hỏi mở #9) | FR-1, NFR-6 |
| Cài đặt tài khoản: xóa Tài khoản Tickee / rút lại đồng ý | Cảnh báo nếu còn Vé hợp lệ của Sự kiện chưa diễn ra | FR-38 |
| Bộ chuyển BTC (workspace switcher) | Một tài khoản thuộc nhiều BTC, chuyển qua lại | FR-2 |

### 3.2 Người mua (public + đã đăng nhập)
| Màn hình | Nội dung chính | FR |
|---|---|---|
| Trang Sự kiện công khai | Không cần đăng nhập; tối ưu điện thoại; tên, thời gian, địa điểm, mô tả, ảnh, chính sách hoàn vé; danh sách Hạng vé với số chỗ còn lại / "Hết vé" / "Chưa mở bán" / "Đã đóng bán"; chọn số lượng nhiều Hạng vé; nút "Mua"; banner "Tạm ngừng bán", Sự kiện bị khóa, Sự kiện Ẩn (xem được nhưng không nhận Đơn), Đã hủy; nút báo cáo Sự kiện; OG preview cho Facebook/Zalo | FR-7, FR-8, FR-10, FR-12, FR-15, FR-35, FR-36 |
| Gate đăng nhập khi bấm "Mua" | Sau đăng nhập quay lại đúng Hạng vé + số lượng đã chọn | FR-3 |
| Checkout / form mua vé | Điền một lần cho cả Đơn: Tên, SĐT (nếu tài khoản chưa có), email tự điền; câu hỏi riêng BTC (văn bản/lựa chọn, bắt buộc/không); trường bổ sung; validation bắt buộc; ghi rõ thông tin sẽ chia sẻ cho BTC; tóm tắt Đơn + tổng tiền; giới hạn Vé/Đơn | FR-3, FR-9, FR-12 |
| Lỗi tạo Đơn do hết chỗ | Báo rõ Hạng vé nào hết; cả Đơn không được tạo | FR-13 |
| Thanh toán QR động | QR đúng số tiền, đếm ngược 15 phút, nút tải ảnh QR, nút mở app ngân hàng (Deep Link), "Tiền chuyển thẳng cho [tên BTC]", chính sách hoàn vé | FR-14, FR-16 |
| Thanh toán QR tĩnh | Như trên + mã Đơn nổi bật, nút sao chép, hướng dẫn ghi đúng nội dung chuyển khoản | FR-17 |
| Hết hạn thanh toán | Báo hết hạn, chỗ đã trả lại, mời tạo Đơn mới | FR-14 |
| "Thành công" | Tự chuyển (không reload) khi thanh toán; hiện tất cả Vé của Đơn, mỗi Vé một Mã QR vé | FR-18, FR-22 |
| Đăng ký Sự kiện miễn phí | Không QR, Vé phát ngay khi gửi Đơn; vẫn phải đăng nhập `[ASSUMPTION]` | FR-11 |
| "Vé của tôi" | Vé còn hiệu lực + lịch sử Sự kiện đã tham dự (tên, ngày, đã check-in hay chưa) | FR-22, FR-24 |
| Chi tiết Vé / link Vé | Mã QR vé; chia sẻ từng Vé bằng link hoặc ảnh cho người đi cùng | FR-22 |
| Social Ticket Card *(Should)* | Ảnh Vé đã ẩn Mã QR vé để đăng Story | FR-25 |
| Form báo cáo Sự kiện | Kèm lý do | FR-35 |
| Email Vé | Vé hoặc link tới Vé; dòng giới thiệu Tickee | FR-23, FR-36 |

### 3.3 BTC (Owner / Admin) — dashboard
| Màn hình | Nội dung chính | FR |
|---|---|---|
| Tạo BTC (onboarding) | Người tạo thành Owner | FR-2 |
| Quản lý thành viên (chỉ Owner) | Mời/xóa Admin | FR-2, FR-4 |
| Liên kết tài khoản nhận tiền (chỉ Owner) | Qua Tingee, tạo Merchant con; kết quả: dùng được QR động hay chỉ QR tĩnh (+ khuyến nghị đổi sang tài khoản hỗ trợ QR động) | FR-5 |
| Trạng thái Closed Beta trên dashboard | "Chờ duyệt Closed Beta" + hướng dẫn liên hệ Tingee; thu hồi → Sự kiện có phí "Tạm ngừng bán" | FR-37 |
| Danh sách Sự kiện của BTC | Trạng thái từng Sự kiện | FR-7 |
| Tạo/sửa Sự kiện | Tên, thời gian bắt đầu/kết thúc, địa điểm, mô tả, ảnh, chính sách hoàn vé (bắt buộc để mở bán); hành động: mở bán, ẩn, hủy, "Kết thúc" sớm; cảnh báo sửa thời gian/địa điểm khi đã phát Vé sẽ gửi email Người mua `[ASSUMPTION]` | FR-7 |
| Quản lý Hạng vé | Tên, giá, số suất, thời gian mở/đóng bán; không giảm suất dưới (đã bán + đang Giữ chỗ); đổi giá không ảnh hưởng Đơn cũ; giới hạn Vé/Đơn (mặc định 10 `[ASSUMPTION]`); trần 200 Vé cho Sự kiện miễn phí `[ASSUMPTION]` | FR-8, FR-11, FR-12 |
| Cấu hình form mua vé | Trường mặc định, câu hỏi riêng (văn bản/lựa chọn, bắt buộc/không), trường bổ sung | FR-9 |
| Dashboard theo Sự kiện | Doanh thu (chỉ Đơn Đã thanh toán), số Vé theo Hạng vé, danh sách Đơn + câu trả lời form, xuất CSV, số mục "Cần xử lý" đang chờ, cảnh báo Token, báo mất quyền Sheet; chưa có báo cáo gộp nhiều Sự kiện `[ASSUMPTION]` | FR-21, FR-31, FR-32, FR-34 |
| Hàng "Cần xử lý" | Theo 3 loại; thao tác: ghép tay giao dịch với Đơn, duyệt tay phát Vé (nếu còn chỗ), từ chối, đánh dấu "Đã hoàn tay"; nhật ký ai/lúc nào/quyết định | FR-21, NFR-11 |
| Kết nối Google Sheets | OAuth, chọn Sheet, trạng thái đồng bộ, báo kết nối lại khi mất quyền | FR-32 |
| Hủy Sự kiện *(Should)* | Xác nhận hủy → ngừng bán, vô hiệu mọi Vé, email Người mua, xuất danh sách cần hoàn tiền (Người mua, SĐT, email, số tiền, mã Đơn); đánh dấu từng Đơn "Đã hoàn tay" | FR-33 |
| Token | Số dư, hạn mức âm/trả sau, ngưỡng cảnh báo (Owner đặt), nút "mua thêm Token" → luồng Tingee; Admin chỉ xem | FR-34, FR-4 |
| Mời / thu hồi CTV | Tạo link mời có thời hạn, gửi qua email/kênh bất kỳ; danh sách CTV, thu hồi | FR-26 |
| Theo dõi check-in thời gian thực | Đã check-in / tổng Vé, theo từng Hạng vé, cập nhật liên tục | FR-30 |
| Quét + tra Vé (Owner/Admin cũng dùng được) | Như CTV | FR-27–FR-29 |

### 3.4 CTV (web app check-in)
| Màn hình | Nội dung chính | FR |
|---|---|---|
| Nhận lời mời | Mở link → đăng nhập Tài khoản Tickee → nhận; link hết hạn/bị thu hồi | FR-26 |
| Màn hình quét (chỉ Sự kiện được giao) | Camera trình duyệt; kết quả xanh/đỏ + âm thanh; không bao giờ hiện Mã QR vé; không thấy dữ liệu khác của BTC | FR-26, FR-27, FR-28 |
| Tra Vé + check-in tay | Tìm theo SĐT/email Người mua; kết quả chỉ tên, Hạng vé, trạng thái check-in | FR-29 |
| Trạng thái hết quyền | Khi Sự kiện kết thúc hoặc bị thu hồi (hiệu lực ngay lượt quét tiếp theo) | FR-26 |

### 3.5 Quản trị Tingee (nội bộ)
| Màn hình | Nội dung chính | FR |
|---|---|---|
| Duyệt/thu hồi Closed Beta cho BTC | Ghi nhật ký | FR-37 |
| Danh sách báo cáo vi phạm, chi tiết Sự kiện, lịch sử khóa/mở khóa | Khóa/mở khóa Sự kiện hoặc BTC; tùy chọn vô hiệu Vé `[ASSUMPTION]` | FR-35 |

## 4. Luồng chính (theo PRD)

### F1. Mua Vé có phí qua VietQR — UJ-1, FR-3, FR-10, FR-12–FR-19, FR-22, FR-23
1. Bấm link từ Zalo/Facebook → trang Sự kiện công khai trên trình duyệt điện thoại, chưa đăng nhập (tải < 2s trên 4G).
2. Chọn số lượng ở một hoặc nhiều Hạng vé (vd. 1 "Đơn nam" + 1 "Đôi nam"), trong giới hạn Vé/Đơn.
3. Bấm "Mua" → đăng nhập Google hoặc OTP email → quay lại đúng lựa chọn.
4. Điền form mua vé một lần cho cả Đơn (email tự điền; Checkout ghi rõ dữ liệu chia sẻ cho BTC).
5. Gửi Đơn → hệ thống Giữ chỗ all-or-nothing; thiếu chỗ ở bất kỳ Hạng vé nào → không tạo Đơn, báo Hạng vé nào hết. Hai người tranh 1 chỗ: người thua thấy "Hết vé".
6. Kiểm tra Token khả dụng; không đủ → không tạo QR, "Tạm ngừng bán".
7. Màn hình QR thanh toán (tạo < 2s), đếm ngược 15 phút; quét QR / tải ảnh QR / mở app ngân hàng (Deep Link). QR tĩnh: phải ghi mã Đơn trong nội dung chuyển khoản.
8. IPN hợp lệ + số tiền khớp đúng → phát Vé → màn hình tự chuyển "Thành công" (< 3s từ IPN; SM-3 p95 < 10s từ chuyển tiền) → hiện từng Vé với Mã QR vé riêng; email Vé gửi đồng thời.
9. Vé vào "Vé của tôi"; chia sẻ từng Vé cho bạn qua link/ảnh.
- Lỗi/edge:
  - Hết 15 phút chưa trả → Đơn "Hết hạn", chỗ trả lại, mời tạo Đơn mới (FR-14).
  - Tiền về muộn sau khi hết hạn (cả QR động/tĩnh): còn chỗ → Giữ chỗ lại, phát Vé bình thường; hết chỗ → "Cần xử lý"/"Thanh toán mồ côi", báo BTC + email Người mua (FR-14). ⇒ UI Người mua cần trạng thái "đã nhận tiền nhưng chưa có Vé" (PRD không mô tả màn hình này — câu hỏi UX).
  - Chuyển thiếu/sai số tiền → không phát Vé, "Lệch số tiền" (FR-19, FR-21).
  - QR tĩnh ghi sai nội dung → "Giao dịch chưa khớp" (FR-21).
  - IPN trễ/mất → Đối soát bù sau ~2 phút `[ASSUMPTION]` (FR-20) ⇒ màn hình chờ cần xử lý trường hợp tiền đã chuyển nhưng chưa xác nhận.
  - IPN lặp → không phát thêm Vé, không gửi thêm email (FR-19).
  - Email lỗi → tự thử lại; Vé vẫn trong "Vé của tôi" (FR-23).
  - Phòng chờ khi Sự kiện đông (NFR-3) — tiêu chí và giao diện chưa định nghĩa (Câu hỏi mở #5).
  - Hạng vé ngoài thời gian bán: "Chưa mở bán"/"Đã đóng bán", không cho chọn (FR-8).

### F2. Đăng ký Sự kiện miễn phí — FR-11
Trang Sự kiện → chọn Vé → "Mua"/đăng ký → đăng nhập (bắt buộc `[ASSUMPTION]`) → form → gửi → Vé phát ngay (không QR, không Token) → "Thành công" + email. Trần 200 Vé/Sự kiện `[ASSUMPTION]`. Không cần liên kết tài khoản nhận tiền.

### F3. BTC onboarding & tạo Sự kiện — UJ-2, FR-1, FR-2, FR-5, FR-37, FR-7–FR-10
1. Mở Tickee từ link giới thiệu Tingee → đăng ký Tài khoản Tickee bằng email (Owner bật 2FA).
2. Tạo BTC → thành Owner.
3. Owner liên kết tài khoản nhận tiền qua Tingee → tạo Merchant con → hiển thị QR động hay chỉ QR tĩnh (+ khuyến nghị).
4. Trạng thái Closed Beta: chưa duyệt → "Chờ duyệt Closed Beta" + hướng dẫn liên hệ Tingee; vẫn tạo Sự kiện nháp và Sự kiện miễn phí được, không mở bán Hạng vé > 0đ.
5. Tạo Sự kiện (tên, thời gian, địa điểm, mô tả, ảnh, chính sách hoàn vé bắt buộc) → tạo Hạng vé (giá, số suất, mở/đóng bán) → cấu hình form.
6. Mở bán → copy/gửi link vào nhóm Zalo/Facebook (preview đúng ảnh, tên, thời gian).
7. Đơn đầu tiên: tiền về thẳng tài khoản CLB, Đơn tự duyệt, dashboard hiện tên Người mua ngay.
8. Theo dõi doanh thu, Vé theo Hạng vé, Người mua; xuất CSV / đồng bộ Sheets.
- Chặn mở bán: thiếu chính sách hoàn vé; chưa liên kết tài khoản (Sự kiện có phí); chưa Closed Beta được duyệt (Sự kiện có phí); Token khả dụng không đủ → "Tạm ngừng bán".
- Mục tiêu SM-5: trung vị < 15 phút từ liên kết xong đến Sự kiện đầu tiên mở bán ⇒ luồng tạo phải rất nhanh.

### F4. Check-in tại cổng — UJ-3, FR-26–FR-30
1. Owner/Admin tạo link mời CTV (có thời hạn, thu hồi được) → gửi qua email/kênh bất kỳ.
2. CTV mở link → đăng nhập Tài khoản Tickee → nhận lời mời → vào thẳng màn hình quét của đúng Sự kiện.
3. Quét Mã QR vé bằng camera trình duyệt; kết quả < 1s:
   - Hợp lệ, chưa check-in → **xanh**, "thành công", tên Người mua · số thứ tự Vé trong Đơn · Hạng vé (vd. "Minh · Vé 2/2 · Đôi nam"). Vé không mang tên người đi cùng.
   - Đã check-in → **đỏ + âm thanh**, giờ check-in + người quét lần trước.
   - Sai chữ ký / Vé đã hủy / Vé Sự kiện khác → **đỏ + âm thanh**, "vé không hợp lệ".
4. Nhiều CTV song song; cùng Vé quét gần đồng thời → chỉ một xanh, người kia đỏ kèm thông tin lượt trước (FR-28).
5. Khách không mở được Vé → khách đọc SĐT/email Tài khoản Tickee → tra (chỉ tên, Hạng vé, trạng thái check-in; không Mã QR vé) → check-in tay (vẫn một lần, ghi người thực hiện) (FR-29).
6. Owner/Admin xem số đã check-in / tổng theo Hạng vé, real-time (FR-30).
7. Kết thúc: quyền CTV tự hết ở mốc Sự kiện kết thúc; BTC thu hồi bất kỳ lúc nào, hiệu lực ngay lượt quét kế. Check-in vẫn chạy nếu Sự kiện kéo dài quá giờ khai báo trước mốc kết thúc (FR-7).
- Không có check-in offline (§11.2) ⇒ cần trạng thái mất mạng/lỗi kết nối trên màn hình quét (PRD không mô tả).

### F5. Xử lý "Cần xử lý" — FR-21, UJ-2
Dashboard hiện số mục chờ → mở hàng → theo loại ("Lệch số tiền" / "Thanh toán mồ côi" / "Giao dịch chưa khớp") → Owner/Admin: ghép tay giao dịch chưa khớp vào Đơn đang chờ (phát Vé nếu còn chỗ) | duyệt tay phát Vé | từ chối (Đơn → "Đã hủy") → nếu BTC tự chuyển hoàn tiền ngoài hệ thống → đánh dấu "Đã hoàn tay". Với "Thanh toán mồ côi": BTC tự hoàn tiền hoặc mở thêm chỗ. Mọi thao tác ghi nhật ký.

### F6. Hoàn tiền / Hủy Sự kiện — FR-33 *(Should)*, §10, §11.2
- Tickee không xử lý hoàn tiền; không có hoàn tiền tự động/hàng loạt; không hủy/hoàn từng Đơn đã thanh toán (Vé vẫn hợp lệ, chỗ không trả lại).
- Hủy Sự kiện: xác nhận → ngừng bán, vô hiệu mọi Vé (quét = "vé không hợp lệ"), email mọi Người mua, xuất danh sách hoàn tiền → BTC tự chuyển → đánh dấu từng Đơn "Đã hoàn tay".
- Chính sách hoàn vé là trường bắt buộc, hiển thị trên trang Sự kiện và trang thanh toán (FR-7, FR-16).

### F7. Token — FR-15, FR-34, §7
Owner xem số dư + hạn mức (đọc từ Tingee) → đặt ngưỡng → dưới ngưỡng: cảnh báo email + dashboard → "mua thêm Token" chuyển sang luồng Tingee. Hết Token khả dụng/Tingee ngắt dịch vụ → mọi Sự kiện có phí "Tạm ngừng bán"; mở lại dịch vụ → Đối soát bù. Token trừ theo Đơn, không theo Vé; mức tham khảo 3.000–5.000đ/giao dịch.

### F8. Báo cáo & khóa — FR-35
Người mua báo cáo Sự kiện kèm lý do → Quản trị Tingee xem → khóa Sự kiện (ngừng nhận Đơn ngay + thông báo trên trang Sự kiện) hoặc khóa BTC (mọi Sự kiện ngừng nhận Đơn). Vé đã phát vẫn hợp lệ trừ khi chọn vô hiệu `[ASSUMPTION]`. Quy trình phản hồi, có báo BTC/Người mua không: chưa định nghĩa (#7).

### F9. Sự kiện đã kết thúc — FR-24
Sau mốc kết thúc: Vé biến khỏi "Vé của tôi", chỉ còn lịch sử (tên Sự kiện, ngày, đã check-in hay chưa); Mã QR vé vô hiệu `[ASSUMPTION]`; BTC vẫn còn dữ liệu báo cáo.

### F10. Xóa tài khoản — FR-38
Yêu cầu xóa / rút đồng ý → cảnh báo nếu còn Vé hợp lệ chưa diễn ra → sau xóa không đăng nhập được, biến khỏi dữ liệu Người mua của Sự kiện sắp diễn ra; dữ liệu giao dịch bắt buộc giữ ở dạng tối thiểu.

## 5. Trạng thái UI phải hiển thị

| Thực thể | Trạng thái | Nguồn |
|---|---|---|
| **Đơn** | Chờ thanh toán (đang Giữ chỗ, QR còn hiệu lực) · Đã thanh toán · Hết hạn (có thể chuyển tiếp Đã thanh toán / Cần xử lý nếu tiền về muộn) · Cần xử lý · Đã hủy (Sự kiện hủy hoặc BTC từ chối) · Đã hoàn tay | §3 |
| Loại **Cần xử lý** | "Lệch số tiền" · "Thanh toán mồ côi" · "Giao dịch chưa khớp" | §3, FR-21 |
| **Vé** | Hợp lệ → Đã check-in · Hợp lệ → Đã hủy; (sau Sự kiện kết thúc: ẩn khỏi Người mua, vô hiệu `[ASSUMPTION]`) | §3, FR-24 |
| **Sự kiện** | Nháp → Đang mở bán → Đã kết thúc; từ Đang mở bán: Ẩn · Đã hủy · Bị khóa. "Tạm ngừng bán" = thông báo (không phải trạng thái) khi Token khả dụng không đủ hoặc bị thu hồi Closed Beta được duyệt | §3, FR-15, FR-37 |
| **Hạng vé** (trên trang công khai) | Đang bán + số chỗ còn lại (hoặc "còn ít chỗ" `[ASSUMPTION]` do UX quyết) · "Hết vé" · "Chưa mở bán" · "Đã đóng bán" | FR-8, FR-10 |
| **Kết quả quét** | Xanh "thành công" · Đỏ đã check-in (giờ + người quét trước) · Đỏ "vé không hợp lệ" | FR-27, FR-28 |
| **QR thanh toán** | Loại QR động / QR tĩnh; đếm ngược; hết hạn | FR-14, FR-16, FR-17 |
| **BTC** | Chờ duyệt Closed Beta / Closed Beta được duyệt / bị thu hồi; Bị khóa; liên kết tài khoản nhận tiền: chưa / đã (QR động hoặc chỉ QR tĩnh); KYC (chưa thuộc Closed Beta) | FR-5, FR-6, FR-35, FR-37 |
| **Token** | Số dư (có thể âm), hạn mức, dưới ngưỡng cảnh báo, chạm hạn mức / bị Tingee ngắt | FR-15, FR-34 |
| **Google Sheets** | Đã kết nối · đang đồng bộ (< 1 phút) · lỗi/thử lại · mất quyền → yêu cầu kết nối lại | FR-32 |
| **Lời mời CTV / quyền CTV** | Còn hạn · hết hạn · bị thu hồi · hết khi Sự kiện kết thúc | FR-26 |
| **Check-in real-time** | Đã check-in / tổng, theo Hạng vé | FR-30 |
| **OTP** | Đã gửi · sai (đếm lần, tối đa 5) · hết hạn (5 phút) `[ASSUMPTION]` | FR-1 |
| **Email Vé** | Thử lại khi lỗi (Vé vẫn hợp lệ) | FR-23 |

## 6. Ràng buộc UX/UI tường minh
- **Form factor:** tối ưu cho điện thoại; Safari iOS và Chrome Android bản hiện hành (NFR-9, FR-10). Trang Sự kiện tối ưu điện thoại (FR-10).
- **Không app / chỉ trình duyệt:** check-in bằng web app trong trình duyệt điện thoại, không cài app (§1, §4.7); không app native, không check-in offline (§11.2).
- **Ngôn ngữ:** giao diện tiếng Việt (NFR-9). Tiền là số nguyên theo đồng (NFR-12) → hiển thị VND không phần thập phân (vd. 300.000đ theo UJ-1). Mọi mốc thời gian có múi giờ (NFR-12).
- **Hiệu năng cảm nhận:** trang Sự kiện < 2s trên 4G; tạo QR < 2s (NFR-1); IPN → Vé trên trình duyệt < 3s; kết quả quét < 1s (NFR-2); "Thành công" tự chuyển không reload (FR-18); dashboard check-in cập nhật liên tục (FR-30); Sheets < 1 phút (FR-32).
- **Chịu tải:** 5.000 người cùng vào một Sự kiện 300 Vé; có phòng chờ (NFR-3) — UI phòng chờ chưa định nghĩa.
- **Uptime** 99,9%/tháng cho Checkout, IPN, check-in (NFR-4).
- **Phản hồi check-in:** mã màu xanh/đỏ rõ ràng, âm thanh khi đỏ, đọc được bằng một cái liếc (UJ-3, FR-27). (Hàm ý a11y: không chỉ dựa vào màu — PRD dùng màu + chữ + âm thanh.)
- **Accessibility:** PRD **không** nêu chuẩn a11y (WCAG...) tường minh — UX cần tự đặt.
- **Bảo mật hiển thị:** màn hình quét không bao giờ hiện Mã QR vé; kết quả tra không hiện Mã QR vé; Social Ticket Card không chứa Mã QR vé hay thông tin check-in (FR-25, FR-27, FR-29). CTV chỉ thấy dữ liệu check-in của Sự kiện được giao (NFR-7). HTTPS toàn bộ (NFR-6).
- **Niềm tin/minh bạch:** "Tiền chuyển thẳng cho [tên BTC]" + chính sách hoàn vé trên trang thanh toán (FR-16, R-2); Checkout báo thông tin chia sẻ cho BTC (FR-3); đồng ý NĐ 13/2023 (NFR-8).
- **Giảm ma sát đăng nhập:** chỉ yêu cầu khi bấm "Mua", Google một chạm, giữ lựa chọn sau đăng nhập; theo dõi SM-C2 tỉ lệ bỏ ngang (R-5, §12).
- **Chia sẻ Zalo/Facebook:** OG preview đúng ảnh, tên, thời gian Sự kiện (FR-10). Link mời CTV gửi qua kênh bất kỳ (FR-26). Chia sẻ Vé bằng link/ảnh (FR-22). Story qua Social Ticket Card (FR-25).
- **Thông báo / email** (chỉ email ở MVP; ZNS/SMS ngoài phạm vi, §6): OTP; Vé (FR-23); đổi thời gian/địa điểm `[ASSUMPTION]` (FR-7); Thanh toán mồ côi gửi Người mua + báo BTC (FR-14); hủy Sự kiện (FR-33); cảnh báo Token cho Owner (FR-34). Thông báo trong dashboard: số mục "Cần xử lý", cảnh báo Token, mất quyền Sheet, "Chờ duyệt Closed Beta", khuyến nghị QR động.
- **Branding/lan truyền:** dòng giới thiệu Tickee + link đăng ký BTC trên trang mua Vé và email Vé *(Could, FR-36)*. Tên "Tickee" chưa chốt. Phải phân biệt rõ trực quan Mã QR vé vs QR thanh toán (§3).
- **Nhật ký kiểm toán** (NFR-11): thay đổi Sự kiện, phân quyền, xử lý Đơn tay, khóa — có thể cần UI xem log (PRD không yêu cầu màn hình cho BTC).

## 7. [ASSUMPTION] & câu hỏi mở chạm tới UX

**Assumption (§14):**
- Một loại Tài khoản Tickee cho mọi vai trò (§3).
- Danh sách trạng thái Đơn/Vé/Sự kiện do PM đề xuất, Architecture chốt (§3).
- OTP 5 phút, tối đa 5 lần sai; 2FA Owner (FR-1).
- Đồng ý NĐ 13 một lần khi tạo tài khoản + thông báo ở Checkout, chờ pháp chế (FR-3).
- Xóa tài khoản / rút đồng ý (FR-38).
- "Ẩn" = tạm dừng nhận Đơn, vẫn xem bằng link; email khi sửa thời gian/địa điểm (FR-7).
- **Cách hiện số chỗ còn lại ("còn ít chỗ" vs số chính xác, tùy chọn BTC) — để UX quyết** (FR-10).
- Sự kiện miễn phí vẫn bắt buộc đăng nhập; trần 200 Vé cứng (FR-11).
- Mặc định 10 Vé/Đơn, BTC chỉnh được (FR-12).
- Đối soát bù sau 2 phút (FR-20).
- Không chuyển nhượng Vé sang tài khoản khác (FR-22).
- "Vé bị xóa" sau Sự kiện = ẩn khỏi Người mua + vô hiệu Mã QR vé (FR-24).
- **Link mời CTV dùng chung hay mỗi CTV một link — để UX/Architecture quyết** (FR-26).
- Dashboard theo từng Sự kiện, chưa gộp (FR-31).
- Xử lý khi BTC sửa Sheet (FR-32).
- Nút mua Token chuyển sang luồng Tingee (FR-34).
- Vé Sự kiện bị khóa vẫn hợp lệ trừ khi Quản trị Tingee vô hiệu (FR-35).
- Tiêu chí bật phòng chờ (NFR-3).

**Câu hỏi mở (§13) liên quan UX:**
- #2 Giới hạn Vé/Đơn và Vé/Tài khoản/Sự kiện → ảnh hưởng stepper số lượng & thông báo lỗi.
- #3 API Token Tingee chưa xác nhận → màn hình Token (FR-15, FR-34) có thể phải thiết kế lại (R-9).
- #4 QR tĩnh khi BTC bị ngắt dịch vụ: chưa có quy tắc khôi phục Vé → trạng thái Người mua đã trả tiền mà chưa có Vé.
- #5 Phòng chờ: tiêu chí, ai bật, **Người mua thấy gì khi đang chờ**.
- #6 Google Sheets khi BTC sửa/xóa cột/dòng hoặc OAuth hết hạn → trạng thái lỗi.
- #7 Xử lý báo cáo: có báo BTC/Người mua không; Vé Sự kiện bị khóa.
- #8 Thời gian lưu dữ liệu Người mua (ảnh hưởng lịch sử "Vé của tôi", FR-24).
- #9 Phương thức 2FA Owner → UI thiết lập 2FA.
- #10 Chuyển nhượng Vé: link/ảnh đủ chưa hay cần đổi tên người giữ.

**Khoảng trống UX suy ra (PRD không mô tả, cần designer quyết):** màn hình chờ sau khi Người mua đã chuyển khoản nhưng IPN chưa về / Đối soát bù; thông báo cho Người mua khi Đơn vào "Cần xử lý" (Lệch số tiền, Giao dịch chưa khớp — chỉ "Thanh toán mồ côi" có email); trạng thái mất mạng/camera bị từ chối trên màn hình quét; luồng Owner thiết lập 2FA; empty states (BTC chưa có Sự kiện, "Vé của tôi" trống); giao diện chuyển BTC; xem nhật ký.

## 8. Ngoài phạm vi MVP — §11.2, §10, §6
- KYC (trước mở công khai, FR-6); Zalo ZNS và OTP qua SĐT (cùng đợt sau MVP); đăng ký BTC bằng SĐT; SMS OTP (addendum §A chỉ là phương án tham khảo).
- Đăng nhập bằng mật khẩu; SSO tài khoản Tingee.
- Voucher.
- Hoàn tiền tự động/hàng loạt; hủy/hoàn từng Đơn đã thanh toán.
- Chợ vé / trang khám phá / gợi ý Sự kiện; app mobile native; check-in offline; in thẻ.
- Đồng bộ Sheets hai chiều; báo cáo nâng cao / gộp nhiều Sự kiện; Apple Wallet, Google Wallet.
- Chuyển nhượng Vé sang Tài khoản Tickee khác; Sự kiện định kỳ; hóa đơn điện tử cho Người mua.
- Sơ đồ chỗ ngồi, vé theo bàn; Sự kiện > 300 khách; CRM/email marketing.
- Người mua tra Vé theo SĐT (chỉ CTV/Owner/Admin tra được).

## 9. Mức ưu tiên ngoài Must
- *(Should)* FR-25 Social Ticket Card; FR-33 Hủy Sự kiện + danh sách hoàn tiền.
- *(Could)* FR-36 Dòng giới thiệu Tickee.
- Lộ trình (§11.4): Phase 1 (tuần 1–2) tài khoản → Checkout → phát Vé + email; Phase 2 (tuần 3–4) check-in, CTV, dashboard, CSV, Sheets, Token, báo cáo/khóa, Should/Could; Phase 3 Closed Beta 2–5 Sự kiện.
