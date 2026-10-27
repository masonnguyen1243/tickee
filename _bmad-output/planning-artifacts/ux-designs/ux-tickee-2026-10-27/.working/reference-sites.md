# Nghiên cứu site tham chiếu — Tickee UX

> Ngày khảo sát: 2026-10-27. Phương pháp: WebFetch + trình duyệt (đọc computed CSS bằng JS, chụp màn hình ở 375x812 và desktop).
> Chỉ đọc: không đăng nhập, không submit form, không bấm "Accept all" cookie. Mô tả khách quan, không đề xuất hướng — chủ sản phẩm quyết định.
> Màu dạng `lab()/oklab()` trong CSS đã được quy đổi gần đúng sang hex (đánh dấu ≈).

---

## 1. flip.vn (tham chiếu UI người mua)

Trang đã xem: trang chủ `flip.vn/`, chi tiết sự kiện `flip.vn/events/converge-concert-...`, bước chọn vé `flip.vn/reservation/...` (chỉ mở, không tiếp tục).

### 1.1 Bố cục & mật độ
- **Header**: rất mỏng — nút hamburger (trái), logo, icon tài khoản (phải). Desktop có nút "Đăng nhập" bo 8px.
- **Hero trang chủ**: carousel poster sự kiện nổi bật chiếm gần trọn màn hình mobile (ảnh poster dọc/vuông), chấm phân trang bên dưới, rồi tên sự kiện in lớn (30px/500), dòng meta "T7, 28/11 · 18:00 – 19:00", BTC · thành phố.
- **Các section**: "Sự kiện sắp tới" (có chip lọc danh mục cuộn ngang: Tất cả / Nhạc sống / Sân khấu & Nghệ thuật…) → khối "Tổ chức sự kiện trên Flip" (cụm logo BTC tròn chồng nhau + 1 câu value prop + 1 nút) → "Sự kiện đã qua" → footer.
- **Footer**: nhiều cột link (Ban Tổ Chức, Hỗ trợ, Mạng xã hội, Pháp lý), huy hiệu "Đã đăng ký Bộ Công Thương", chính sách đổi trả/vận chuyển/thanh toán, dòng copyright.
- Mật độ: trung bình-thấp; danh sách dạng hàng (list row) gọn, khoảng trắng đều, ít trang trí.

### 1.2 Màu
- **Chủ đạo tối (dark)**: nền gần đen ≈ #18181b / #09090b; bề mặt thẻ/ô ≈ #27272a; viền trắng 10% opacity (`rgba(255,255,255,.1)`) — gần như toàn bộ viền.
- Chữ chính ≈ #fafafa / #ffffff; chữ phụ xám ≈ #9f9fa9. Thang xám trung tính lạnh (giống thang "zinc" của Tailwind).
- **Nền có ánh màu từ ảnh cover**: `body` ghi nhận #454728 (olive) khi hero là poster vàng/đen — tức nền được nhuộm nhẹ theo ảnh sự kiện, phần nội dung chuyển dần về gần đen.
- **Accent**: gần như không có màu thương hiệu trong UI; CTA chính là nút **xám sáng ≈ #e4e4e7 chữ tối** (không phải màu rực). Ngoại lệ duy nhất: nút "Bán vé sự kiện" ở khối BTC dùng gradient xanh lá → xanh dương; logo cũng gradient.
- Màu đến chủ yếu từ **poster sự kiện** chứ không từ UI.

### 1.3 Typography
- Font duy nhất: **"FZ Poppins"** (biến thể Poppins hỗ trợ tiếng Việt), sans-serif.
- Cỡ: thân 16px (đa số), 14px và 12px cho meta; H2 section 24px/400; tên sự kiện 30px/500; tiêu đề trong mô tả đến 36px/800.
- Trọng lượng: 400 chủ đạo, 300 cho chữ phụ, 500–600 cho tiêu đề/nhãn. Tiêu đề section để weight thường (400) — tạo cảm giác nhẹ.

### 1.4 Hình khối
- Bo góc: 8px (nút, ô), 10px (thẻ/khung ảnh), pill (chip lọc, chấm carousel, badge danh mục).
- Phân tách bằng **viền mảnh mờ** thay vì shadow (shadow chỉ rất nhẹ `0 1px 3px rgba(0,0,0,.1)`).
- Hình ảnh: poster sự kiện thật do BTC cung cấp; không minh hoạ, không icon màu. Icon line đơn sắc (lịch, ghim bản đồ) đặt trong ô vuông bo góc có viền.

### 1.5 Component liên quan bán vé
- **Thẻ sự kiện (list row)**: thumbnail vuông nhỏ bên trái (~56px, bo góc) + cột chữ: "T3, 10/11 · 19:00" (nhỏ, xám), tên sự kiện in đậm 1–2 dòng, địa điểm · thành phố (xám, cắt dấu …). Trên mobile hiển thị 2 cột lệch, cột thứ hai bị cắt để gợi ý cuộn ngang.
- **Trang chi tiết (mobile)** theo thứ tự:
  1. Ảnh cover lớn phía trên, mờ dần xuống nền tối.
  2. Badge danh mục (pill) + nút chia sẻ tròn bên phải.
  3. Tên sự kiện (30px, in hoa theo dữ liệu BTC).
  4. Hai hàng thông tin có icon trong ô vuông: ngày ("Thứ Ba, 10 Tháng 11" + "19:00 – 21:00"), địa điểm (tên + thành phố).
  5. Khối "Mua vé": thông báo "Số lượng vé có hạn / Nhanh tay mua vé kẻo lỡ!" + "Giá vé từ 300.000 ₫".
  6. "Hạng vé": danh sách tên hạng – giá (dạng bảng 2 cột).
  7. "Về sự kiện": mô tả rich-text dài của BTC.
  8. "Được tổ chức bởi" (tên BTC) và "Địa điểm" (địa chỉ đầy đủ).
- **Thanh mua vé dính đáy (sticky)**: trái "Giá vé từ / 300.000 ₫", phải nút "Mua vé ngay" (nền xám sáng, chữ tối, cao 48px, bo 8px, 14px/600). Luôn hiển thị khi cuộn.
- **Bước chọn vé** (trang riêng `/reservation/...`): header thu gọn (logo + tên sự kiện + ngày giờ) → "Hạng vé — Chọn số lượng vé bạn muốn mua theo từng hạng vé" → mỗi hạng là 1 thẻ: icon vé, tên, mô tả quyền lợi, giá, bộ đếm **[−] 0 [+]** → đáy dính: chip tóm tắt "Vip 300.000 ₫" (mở rộng được) + nút "Tiếp Tục" full-width (xám, disabled khi chưa chọn).
- Giá hiển thị định dạng VN: "300.000 ₫".

### 1.6 Mobile
- Thiết kế mobile-first rõ rệt; desktop là bản mở rộng. Chip lọc cuộn ngang, list sự kiện cuộn ngang theo cột, CTA dính đáy, bước chọn vé full-screen.

### 1.7 Nguyên tắc rút ra (trung tính thương hiệu)
- UI trung tính (đơn sắc), để ảnh sự kiện mang màu sắc.
- Một CTA chính duy nhất mỗi màn hình, dính đáy kèm "giá từ".
- Thông tin cốt lõi (ngày-giờ, địa điểm) trình bày dạng hàng icon + 2 dòng chữ, ngay dưới tiêu đề.
- Chọn vé bằng bộ đếm +/- theo hạng, tóm tắt đơn ở đáy.
- Viền mảnh mờ thay shadow; bo góc vừa phải (8–10px), pill cho chip/badge.
- Một họ font, phân cấp chủ yếu bằng cỡ chữ, weight tiết chế.

---

## 2. luma.com (tham chiếu UI người mua)

Trang đã xem: `luma.com/home` (chưa đăng nhập → chuyển sang trang Sign In), `luma.com/` (landing), `luma.com/discover`, `luma.com/ho-chi-minh-city`, hai trang sự kiện công khai `luma.com/uajmcurm`, `luma.com/eunph44k`. Xem cả chế độ sáng và tối.

### 2.1 Bố cục & mật độ
- **Header**: rất tối giản — logo chữ nhỏ màu xám (trái); "Discover Events" + nút "Sign In" dạng pill nền xám nhạt (phải). Không có thanh tìm kiếm lớn.
- **Landing**: hero chữ lớn ("…events start here"), 1 câu mô tả, 2 nút ("Create Your First Event", "Discover Events"); hero có phần đồ hoạ động (canvas) tải chậm → nhiều giây đầu chỉ thấy trang trắng. Tiếp theo: "Upcoming Major Events", "Explore Global Communities", "Browse by Category".
- **Discover**: tiêu đề + đoạn mô tả → "Browse by Category" (lưới thẻ: icon màu + tên + số sự kiện, cuộn ngang) → "Featured Calendars" (avatar vuông + tên + mô tả 2 dòng) → "Explore Local Events" (tab theo châu lục, danh sách thành phố) → footer.
- **Trang thành phố**: hero ảnh thành phố full-width mờ dần, "What's Happening in / Ho Chi Minh City", giờ địa phương, đoạn mô tả, ô email + nút Subscribe; bên dưới **timeline sự kiện theo ngày** ("Tomorrow · Wednesday", chấm + đường nét đứt dọc bên trái, thẻ sự kiện trắng).
- **Footer**: một hàng link nhỏ (Discover, Pricing, Help), icon mạng xã hội, "Get the App".
- Mật độ thấp, khoảng trắng rộng, cột nội dung hẹp (~1 cột cả trên desktop cho trang sự kiện dạng mobile; desktop dùng 2 cột ảnh trái / thông tin phải).

### 2.2 Màu
- Hệ token xám trung tính: #f8f8f8, #ececec, #e0e0e0, #d4d4d4, #b5b5b5, #959595, #757575, #555, #353535, #232323, đen ≈ #151515.
- Hỗ trợ **sáng & tối** theo `prefers-color-scheme` (tối: nền ≈ #151515–#232323, chữ trắng, chữ phụ trắng 50%).
- Màu thương hiệu "cranberry" (#f31a7c, dark mode #f98dbe) dùng rất ít (link/nhấn). Có bảng màu phụ (barney/tím, xanh, xanh lá, cam, vàng, đỏ) nhưng chỉ cho icon danh mục, trạng thái.
- **Trang sự kiện được "tint" theo ảnh cover**: nền gradient động + lớp glow lấy tông từ ảnh (ví dụ cover kem → nền be ấm, nút vàng nâu #9e6c00; cover đỏ → nền hồng nhạt, nút đỏ). Mỗi sự kiện có màu riêng nhưng luôn ở độ bão hoà nhẹ, phần còn lại vẫn trung tính.
- Bề mặt thẻ dùng nền mờ rất nhẹ (`rgba(63,41,0,.04)`) + viền inset 0.5px thay vì màu đặc.

### 2.3 Typography
- Font hệ thống: `-apple-system, system-ui, Inter, Roboto, "Segoe UI", …` — không tải webfont riêng.
- Cỡ: thân 16px; meta 14px/13px; tiêu đề trang sự kiện 24px/600 (mobile); tiêu đề trang Discover/thành phố lớn hơn (~28–32px).
- Weight: 400 chủ đạo, 500 cho nút/nhãn, 600 cho tiêu đề. Rất ít in đậm.

### 2.4 Hình khối
- Bo góc: 8px (ô/nút nhỏ), 15–16px (nút CTA, thẻ đăng ký), 24px (thẻ lớn), pill 100px/1000px (Sign In, Subscribe, chip), tròn (avatar).
- Gần như không shadow; dùng viền inset mảnh + nền mờ. Ảnh cover có một shadow nhiều lớp rất mềm.
- Hình ảnh: ảnh cover vuông do host tải lên (thường là đồ hoạ poster), ảnh thành phố; icon danh mục dạng line có màu.

### 2.5 Component liên quan bán vé
- **Trang sự kiện (mobile)** theo thứ tự:
  1. Ảnh cover **vuông** bo góc lớn, dưới ảnh có dải nhỏ "Featured in Ho Chi Minh City".
  2. Tên sự kiện (24px/600).
  3. Host: avatar nhỏ chồng nhau + "Hosted by …" + mũi tên ›.
  4. **Ô ngày kiểu tờ lịch** (tháng viết tắt "OCT" + số ngày "28" trong ô vuông viền) + "Wednesday, October 28 / 6:30 PM – 9:00 PM".
  5. Hàng địa điểm: icon ghim trong ô vuông + tên địa điểm (có thể ẩn: "Register to See Address") + thành phố.
  6. **Thẻ "Registration"**: tiêu đề thẻ, trạng thái (Welcome… / Event Full – waitlist), nút full-width (bo 16px, cao ~38px, 500). Với sự kiện có vé, thẻ này chứa lựa chọn loại vé.
  7. "About Event" (rich-text), "Location" (địa chỉ + bản đồ), "Hosted By" (danh sách host), "113 Going" (avatar người tham dự + tên), "Contact the Host", "Report Event", tag danh mục.
- **Không có thanh CTA dính đáy** trên trang sự kiện: CTA nằm trong thẻ Registration ở màn hình đầu/thứ hai.
- **Thẻ sự kiện (list/timeline)**: giờ trên cùng, tên sự kiện, host, địa điểm; thumbnail vuông bên phải; nhóm theo ngày với tiêu đề ngày dính.
- Bằng chứng xã hội: số người "Going" + avatar.
- (Không kiểm tra checkout vì cần đăng nhập/nhập thông tin.)

### 2.6 Mobile
- Bố cục 1 cột, phần tử co giãn tự nhiên; thẻ danh mục và calendar cuộn ngang; ô ngày dạng lịch giữ nguyên kích thước. Desktop trang sự kiện chuyển sang 2 cột (cover + host bên trái, thông tin + đăng ký bên phải).

### 2.7 Nguyên tắc rút ra (trung tính thương hiệu)
- Nền trung tính, chỉ "nhuộm" nhẹ theo ảnh cover của từng sự kiện → mỗi sự kiện có cá tính mà UI vẫn điềm tĩnh.
- Font hệ thống, ít cỡ chữ, weight 400/500/600 — sạch và nhanh.
- Ngày hiển thị dạng tờ lịch nhỏ: nhận diện ngày tức thì.
- Gom hành động đăng ký/mua vào **một thẻ duy nhất** có trạng thái rõ (còn vé / hết / waitlist).
- Viền mảnh + nền mờ thay shadow; bo góc lớn hơn (16–24px) cho thẻ chính, pill cho nút phụ.
- Hiển thị host và người tham dự như tín hiệu tin cậy.

---

## 3. weeztix.com (tham chiếu homepage marketing cho BTC)

Trang đã xem: `weeztix.com/` (desktop + mobile), `weeztix.com/pricing` (qua WebFetch). Popup cookie chỉ có "Accept all" / "Change cookie preferences" — không bấm.

### 3.1 Trình tự section trang chủ
1. **Thanh thông báo trên cùng** (nền xanh nhạt): câu hỏi gây chú ý về doanh số + link "Take the free assessment →", có nút đóng.
2. **Header**: logo, chọn ngôn ngữ (cờ), nút pill viền "Join for free", hamburger (mega menu: Features 10 mục, Industries 9 mục, Resources, Pricing, Support).
3. **Hero** nền **xanh dương đặc #006aff**: tiêu đề cực lớn (80px/620) dạng "Boost your ticket sales with [brand]", 1 câu phụ (giải pháp trọn gói từ bán vé đến cashless), 2 CTA: "Build your shop" (chính) và "Book a demo".
4. **Dải logo khách hàng** (trắng trên nền xanh, ~15 logo, chạy lặp).
5. **Tab sản phẩm** theo hành trình BTC: Event creation → Ticket shop → Sales → Scanning; mỗi tab là ảnh chụp/mô phỏng giao diện lớn trong khung bo góc; CTA "Build your shop".
6. **"Next-gen technology"**: lưới 6 thẻ tính năng nền **pastel khác nhau** (hồng, xanh lá nhạt, xanh dương nhạt, cam nhạt…), mỗi thẻ: icon + nhãn nhỏ, tiêu đề lợi ích ("A ticket shop designed for conversion"), "→ Learn more", mô phỏng UI tối giản (bộ đếm vé, biểu đồ cột, QR). CTA "Join for free" + "Book a demo".
7. **"Sell tickets online for"**: carousel 9 thẻ ngành (ảnh minh hoạ + tiêu đề + 1 dòng mô tả), nút ‹ › tròn viền.
8. **Integrations**: "700+ integrations", lưới logo app, CTA "Discover integrations".
9. **Đánh giá**: "An award-winning solution / Loved by customers" + 3 thẻ điểm (Google 4.9/5 – 933 reviews; TrustPilot 4.2/5; Kiyoh 9.5/10).
10. **Testimonial**: 4 trích dẫn có logo + ảnh chân dung khách; sau đó tường trích dẫn ngắn.
11. **Resources**: tab Case Studies / Knowledge Base / Blog; thẻ case study có số liệu (ví dụ "14,000 tickets sold in under one hour").
12. **"Start now"** (CTA cuối): "Trusted by more than 10,000 organisations" + "Create account" / "Plan a demo".
13. **Footer** nền trắng: cột Features, For organisers (Product help, Pricing, Contact), More (API docs, Careers, Press), Direct contact (email, điện thoại), Offices (địa chỉ), mạng xã hội tròn xanh, link pháp lý (điều khoản riêng cho người mua & BTC).
- Phần tử nổi: **toast đánh giá nổi góc trái dưới** (Google/Kiyoh ★★★★★ + trích dẫn ngắn, xoay vòng) và **bong bóng chat** góc phải dưới.

### 3.2 Màu
- Nền trang trắng #ffffff; nền section xám rất nhạt #f1f2f4 và xanh rất nhạt #d9f2ff.
- Màu thương hiệu: **xanh dương #006aff** (chữ link, nền hero, nút) + biến thể #0182e5. Chữ chính đen #000000, chữ phụ #424d5c / #6e7b8c.
- Thẻ tính năng pastel: #ffebc9 (cam nhạt), #c5f7c6 (xanh lá nhạt), hồng nhạt, xanh nhạt. Accent điểm xuyết: #ff5500, #8742ed, #ff006e (trong mô phỏng/nhãn).
- Tổng thể: 1 màu chủ đạo mạnh + nhiều pastel phụ → khá nhiều màu, sáng (light).

### 3.3 Typography
- Thân: **Suisse Intl** (grotesk trung tính). Tiêu đề: **Right Grotesk** (variable, dạng condensed/display) — rất lớn, weight ~620, giãn chữ chặt.
- Cỡ tiêu đề section 72–88px (desktop); H2/H3 phụ 20–26px; thân 16–18px. Chênh lệch cỡ rất lớn giữa tiêu đề và nội dung.
- Một từ trong tiêu đề tô màu xanh để nhấn ("Next-gen **technology**").

### 3.4 Hình khối
- Nút: **pill** (radius 40px), padding 12px 20px, weight 500; nút chính nền xanh chữ trắng, nút phụ nền trắng chữ xanh/đen hoặc viền đen.
- Thẻ: bo góc lớn 28–32px; thẻ ảnh có kiểu bo chỉ trên/chỉ dưới (28px 28px 0 0); ô nhỏ 8–12px.
- Ít shadow; phân biệt bằng nền màu khối. Hình ảnh: mô phỏng UI phẳng (flat UI mock), ảnh chụp sản phẩm, minh hoạ sơ đồ ghế, logo khách hàng.

### 3.5 Thông điệp, CTA, social proof, giá
- **Giọng thông điệp**: lợi ích trực tiếp, câu ngắn, động từ mệnh lệnh ("Boost…", "Build your shop", "Start now"); tiêu đề thẻ = lợi ích, không phải tên tính năng.
- **CTA**: cặp cố định "tự làm" (Join for free / Build your shop / Create account) + "có người hỗ trợ" (Book a demo / Plan a demo), lặp lại sau mỗi 1–2 section.
- **Social proof**: logo khách hàng ngay dưới hero, điểm review từ 3 nền tảng có số lượng review, testimonial có mặt người, case study có con số, tổng số tổ chức sử dụng, toast review nổi.
- **Giá**: trang chủ **không hiện giá**, chỉ link "Pricing" và chữ "free". Trang Pricing: tiêu đề + câu "best tools, best service, fair price"; bộ cấu hình (quốc gia, số vé/năm, chọn có/không VAT); 2 thẻ gói "Free events" / "Paid events" với đơn vị "€ / Ticket"; sự kiện miễn phí: 5.000 vé đầu miễn phí rồi phí cố định/vé; sự kiện có phí: báo giá; phí đặt chỗ/vé, không thuê bao, BTC chọn ai chịu phí; bảng so sánh tính năng. Không thấy FAQ.

### 3.6 Mobile
- Hero xanh giữ nguyên, tiêu đề xuống nhiều dòng, 2 CTA pill xếp chồng căn giữa; thanh thông báo trên cùng xuống 2 dòng; menu thu vào hamburger; lưới thẻ chuyển 1 cột; toast review và chat vẫn nổi (che một phần nội dung).

### 3.7 Nguyên tắc rút ra (trung tính thương hiệu)
- Hero: một câu lợi ích + một câu giải thích + 2 CTA (tự đăng ký / được hỗ trợ).
- Social proof đặt ngay sau hero (logo, con số), lặp lại ở cuối trang.
- Kể sản phẩm theo **hành trình của BTC** (tạo sự kiện → bán vé → theo dõi → soát vé) bằng tab có ảnh giao diện thật.
- Thẻ tính năng đặt tiêu đề theo lợi ích, kèm mô phỏng UI tối giản thay vì ảnh trang trí.
- Giá minh bạch theo mô hình "phí/vé, không thuê bao", BTC chọn ai chịu phí; có thể tách ra trang riêng.
- CTA lặp lại theo nhịp; khép trang bằng một section CTA cuối có con số tin cậy.
- Phân cấp chữ cực mạnh (tiêu đề rất lớn) trên nền trắng, nhiều khoảng trắng.

---

## 4. So sánh nhanh (dữ kiện, không khuyến nghị)

| Khía cạnh | flip.vn | luma.com | weeztix.com |
|---|---|---|---|
| Chế độ màu | Tối (dark) | Sáng + tối theo hệ thống | Sáng |
| Số màu accent trong UI | ~0 (CTA xám sáng; 1 gradient ở khối BTC) | 1 thương hiệu dùng rất ít + tint theo cover | 1 chủ đạo mạnh (#006aff) + nhiều pastel |
| Font | FZ Poppins | System UI / Inter | Suisse Intl + Right Grotesk |
| Bo góc chính | 8–10px | 16–24px, pill | 28–40px, pill |
| Phân tách | Viền trắng 10% | Viền inset + nền mờ | Khối nền màu |
| CTA mua trên mobile | Sticky đáy + "giá từ" | Trong thẻ Registration (không sticky) | n/a (marketing) |
| Chọn vé | Trang riêng, bộ đếm +/- theo hạng, tóm tắt đáy | Trong thẻ Registration | n/a |
| Ngày-giờ | Icon lịch + 2 dòng | Ô tờ lịch (tháng/ngày) + 2 dòng | n/a |
| Ngôn ngữ | Tiếng Việt, định dạng "300.000 ₫" | Tiếng Anh (nội dung host có tiếng Việt) | Đa ngôn ngữ (không có tiếng Việt) |

## 5. Ghi chú hạn chế
- Không xem được checkout/thanh toán của cả Flip và Luma (cần đăng nhập/nhập dữ liệu — ngoài phạm vi chỉ đọc).
- `luma.com/home` yêu cầu đăng nhập; đã thay bằng landing `luma.com/`, `/discover`, trang thành phố và 2 trang sự kiện công khai.
- Màu nền Flip/Luma thay đổi theo ảnh sự kiện, nên hex nền ghi ở trên chỉ là mẫu quan sát tại thời điểm khảo sát.
- Không sao chép logo, tài sản thương hiệu hay copy; các câu trích chỉ dùng để minh hoạ cấu trúc.
