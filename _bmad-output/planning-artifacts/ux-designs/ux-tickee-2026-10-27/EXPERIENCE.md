---
title: Tickee
status: final
created: 2026-10-27
updated: 2026-10-27
sources:
  - ../../prds/prd-tickee-2026-10-27/prd.md
  - ../../prds/prd-tickee-2026-10-27/addendum.md
  - .working/reference-sites.md
name: Tickee
---

# Tickee — Experience Spine

Spine hành vi cho Tickee MVP. Nội dung sản phẩm (FR, NFR, persona, phạm vi) nằm ở PRD và chỉ được dẫn theo mã. Hình ảnh nằm ở `DESIGN.md`; token được dẫn bằng cú pháp `{path.to.token}`. Các mock trong `mockups/` chỉ để minh họa và được link tại từng mục; **spine thắng khi mâu thuẫn với mọi mock**.

## Foundation

- **Đa bề mặt, một codebase web.** Không app native, không check-in offline (PRD §11.2).
  - **Người mua** (trang Sự kiện → Checkout → QR thanh toán → Vé của tôi): mobile-first trên trình duyệt điện thoại (Safari iOS, Chrome Android bản hiện hành — NFR-9). Mở từ link Zalo/Facebook, chưa đăng nhập.
  - **CTV** (màn quét, tra tay): mobile-first trên trình duyệt điện thoại, camera trình duyệt.
  - **Dashboard BTC** (Owner/Admin): responsive đầy đủ — dùng tốt ngang nhau trên điện thoại (tại sự kiện) và laptop.
  - **Landing BTC** (`/`): trang marketing hướng tới BTC; CTA đưa BTC vào Flow 2 (quy tắc ở `landing-hero`).
  - **Quản trị Tingee**: công cụ nội bộ, desktop; dùng shadcn mặc định; trạng thái tối thiểu ở State Patterns › Quản trị Tingee.
- **UI system:** shadcn/ui + Tailwind CSS. Spine này chỉ định phần hành vi khác với mặc định shadcn. `DESIGN.md` là tham chiếu nhận diện hình ảnh (hướng "Rạp tối").
- **Chế độ màu:** light và dark tự theo cài đặt hệ thống (`prefers-color-scheme`); không có công tắc trong app ở MVP. Màn quét cũng theo hệ thống; chỉ kết quả quét phủ màu cố định.
- **Ngôn ngữ:** chỉ tiếng Việt (NFR-9). Tiền: số nguyên đồng, "300.000đ" (NFR-12). Giờ hiển thị theo giờ Việt Nam, kèm ngày đầy đủ ("Chủ nhật, 16/11/2026 · 07:00 – 17:00").
- **Một Tài khoản Tickee cho mọi vai trò** (`[ASSUMPTION]` kế thừa PRD (§3)): một người có thể vừa là Người mua, vừa là CTV, vừa thuộc nhiều BTC — chuyển ngữ cảnh qua BTC switcher (FR-2).
- **Mức độ:** Consumer (Closed Beta với BTC và Người mua thật). Chuẩn a11y: WCAG 2.2 AA.
- **Hai rủi ro UX ưu tiên:** Minh bỏ ngang ở QR thanh toán → § Niềm tin khi thanh toán; Lan quét chậm ở cổng → § Check-in tại cổng.

## Information Architecture

### Công khai (không cần đăng nhập)

| Bề mặt | Đường dẫn / Vào từ | Mục đích |
|---|---|---|
| Landing BTC | `/` | Giới thiệu Tickee cho BTC; CTA "Đăng ký Closed Beta" (xem `landing-hero`) |
| Trang Sự kiện | `/e/{slug}` — link Zalo/Facebook | Xem Sự kiện, chọn Hạng vé + số lượng, "Mua" (FR-7, FR-8, FR-10) |
| Đăng nhập | Bấm "Mua", hoặc mở trang cần đăng nhập | Google hoặc OTP email; quay lại đúng lựa chọn (FR-1, FR-3) |
| Checkout | Sau đăng nhập | Form mua vé một lần cho cả Đơn + tóm tắt Đơn (FR-9, FR-12) |
| QR thanh toán | Gửi Đơn (Sự kiện có phí) | Trả tiền trong 15 phút Giữ chỗ (FR-14, FR-16, FR-17) |
| Thành công | Tự chuyển từ QR thanh toán; hoặc gửi Đơn Sự kiện miễn phí | Hiện từng Vé + Mã QR vé (FR-11, FR-18, FR-22) |
| Hết hạn | Tự chuyển khi hết 15 phút | Báo chỗ đã trả lại, mời mua lại (FR-14) |
| Báo cáo Sự kiện | Link ở chân trang Sự kiện | Gửi báo cáo kèm lý do (FR-35) |
| Không tìm thấy | `/e/{slug}` sai, hoặc Sự kiện còn Nháp | Báo không tìm thấy Sự kiện |

Không có trang khám phá Sự kiện (PRD §10 — không phải chợ vé). Người mua luôn vào thẳng trang Sự kiện qua link.

### Người mua (đã đăng nhập)

| Bề mặt | Vào từ | Mục đích |
|---|---|---|
| Vé của tôi | Menu tài khoản; link trong email Vé; nút sau "Thành công" | Ba nhóm: Vé còn hiệu lực · Đơn đang chờ / "BTC đang kiểm tra thanh toán" (`order-card`) · Lịch sử (FR-22, FR-24) |
| Chi tiết Vé | Hàng Vé trong Vé của tôi; link Vé được chia sẻ (quyền truy cập do Architecture quyết — Open Questions #11) | Mã QR vé, chia sẻ Vé bằng link/ảnh (FR-22), Social Ticket Card (FR-25, Should) |
| Tài khoản | Menu tài khoản | Xóa Tài khoản Tickee / rút đồng ý (FR-38) |

### BTC (dashboard)

Điều hướng hai cấp. Đầu sidebar là **BTC switcher** (FR-2).

| Cấp | Bề mặt | Vai trò | Mục đích |
|---|---|---|---|
| BTC | Sự kiện | Owner, Admin | Danh sách Sự kiện + trạng thái; nút "Tạo Sự kiện" (FR-7) |
| BTC | Cần xử lý (badge số) | Owner, Admin | Hàng việc gộp mọi Sự kiện của BTC (FR-21) |
| BTC | Token | Owner (Admin chỉ xem) | Số dư, hạn mức, ngưỡng, "mua thêm Token" (FR-34) |
| BTC | Thành viên | Owner | Mời/xóa Admin (FR-2, FR-4) |
| BTC | Tài khoản nhận tiền | Owner | Liên kết qua Tingee; QR động hay chỉ QR tĩnh (FR-5) |
| BTC | Cài đặt | Owner, Admin | Thông tin BTC, trạng thái Closed Beta (FR-37) |
| Sự kiện | Tổng quan | Owner, Admin | Doanh thu, check-in, Vé theo Hạng vé, `needs-action-card`, `recent-orders-block`, cảnh báo (FR-31) |
| Sự kiện | Đơn | Owner, Admin | Danh sách Đơn + câu trả lời form, bộ lọc "Cần xử lý", xuất CSV (FR-21, FR-31) |
| Sự kiện | Hạng vé | Owner, Admin | Giá, số suất, mở/đóng bán, giới hạn Vé/Đơn (FR-8, FR-12) |
| Sự kiện | Form mua | Owner, Admin | Trường mặc định, câu hỏi riêng, trường bổ sung (FR-9) |
| Sự kiện | Check-in | Owner, Admin | Check-in real-time theo Hạng vé, danh sách CTV, link mời chung (FR-26, FR-30) |
| Sự kiện | Cài đặt | Owner, Admin | Ẩn / Hủy / "Kết thúc" sớm / Google Sheets (FR-7, FR-32, FR-33) |
| — | Tạo Sự kiện (wizard 4 bước) | Owner, Admin | Thông tin → Hạng vé → Form mua → Xem trước & mở bán |
| — | Quét vé | Owner, Admin | Cùng màn quét của CTV (FR-27–FR-29) |

"Cần xử lý" có ở **hai cấp**: mục riêng ở sidebar (gộp mọi Sự kiện, badge số) và bộ lọc theo Sự kiện trong tab Đơn. `[ASSUMPTION]` hàng gộp cấp BTC vượt phạm vi FR-31 (dashboard theo từng Sự kiện) — đây chỉ là hàng việc, không phải báo cáo gộp; cần PM xác nhận (Open Questions #5).

Điều hướng: ≥ `lg` dùng `dashboard-sidebar`; < `md` dùng `bottom-tab-bar` (Sự kiện · Cần xử lý · Quét vé · Thêm); `md`–`lg`: xem Responsive & Platform. "Thêm" mở `Sheet` chứa Token, Thành viên, Tài khoản nhận tiền, Cài đặt, BTC switcher. Mục chỉ dành cho Owner bị **ẩn** với Admin (không hiện rồi khóa).

### CTV

| Bề mặt | Vào từ | Mục đích |
|---|---|---|
| Nhận lời mời | Link mời chung của Sự kiện | Đăng nhập → nhận → vào thẳng Màn quét (FR-26) |
| Màn quét | Sau khi nhận; mở lại link | Quét Mã QR vé (FR-27, FR-28) |
| Tra tay | Nút "Tra tay" trên Màn quét | Tìm Vé, check-in tay (FR-29) |
| Hết quyền | Tự động khi Sự kiện kết thúc hoặc quyền CTV bị thu hồi | Báo hết quyền soát vé (FR-26) |

CTV không thấy bất kỳ bề mặt nào khác của BTC (NFR-7). Owner/Admin dùng cùng Màn quét và Tra tay.

### Quản trị Tingee (nội bộ)

Duyệt Closed Beta · Báo cáo vi phạm · Khóa/mở khóa Sự kiện hoặc BTC (FR-35, FR-37). Spine-only.

## Voice and Tone

Giọng thương hiệu và tư thế hình ảnh nằm ở `DESIGN.md`. Đây là microcopy. Thuật ngữ PRD giữ nguyên văn (Sự kiện, Hạng vé, Đơn, Vé, Mã QR vé, QR thanh toán, Giữ chỗ, Cần xử lý, Vé của tôi…).

**Với Người mua** — thân thiện, xưng "bạn", ngắn gọn. Không dùng thuật ngữ kỹ thuật: IPN, billId, Đối soát bù, Token không bao giờ xuất hiện với Người mua.

| Nên | Không nên |
|---|---|
| "Vé của bạn đã sẵn sàng!" | "Giao dịch đã được xử lý thành công." |
| "Còn 12 vé" | "Số lượng còn lại: 12" |
| "Hết vé" | "Hạng vé không khả dụng" |
| "Tiền chuyển thẳng cho CLB ABC" | "Thanh toán qua cổng Tickee" |
| "Đang chờ thanh toán — vé sẽ tự hiện khi BTC nhận được tiền." | "Vui lòng chờ hệ thống xác nhận IPN." |
| "Nếu bạn đã chuyển, vé sẽ về trong vài phút — đừng chuyển lại." | "Chưa nhận được thanh toán. Vui lòng thử lại." |
| "Hạng vé Đôi nam vừa hết. Bạn chọn lại nhé." | "Lỗi 409: tạo Đơn thất bại." |
| "BTC đang kiểm tra thanh toán" | "Đơn đang ở trạng thái Cần xử lý" |
| "Tickee không giữ tiền của bạn" | Hứa hẹn về hoàn tiền (Tickee không xử lý hoàn tiền) |

**Với BTC** (dashboard) — ngắn, nghiệp vụ, ít lời, động từ rõ ràng. Dùng đủ thuật ngữ PRD.

| Nên | Không nên |
|---|---|
| "Mở bán" · "Ẩn" · "Kết thúc" · "Hủy Sự kiện" | "Bắt đầu hành trình bán vé của bạn 🎉" |
| "3 mục Cần xử lý" | "Bạn có 3 việc đang chờ xử lý nè!" |
| "Lệch số tiền · nhận 250.000đ / Đơn 300.000đ" | "Có vấn đề với thanh toán này" |
| "Thiếu chính sách hoàn vé — chưa mở bán được." | "Ôi, có lỗi rồi!" |
| "Đã ghép giao dịch vào Đơn TK8F3Q2A. Đã phát 2 Vé." | "Thành công!" |
| "Chờ duyệt Closed Beta" | "Tài khoản đang chờ" |

**Với CTV** — mệnh lệnh ngắn, đọc trong một cái liếc: "Thành công", "Đã check-in", "Vé không hợp lệ", "Chạm để quét tiếp", "Mất kết nối — chưa quét được".

**Landing BTC** — câu lợi ích ngắn; hero nói đủ bốn giá trị: tiền về thẳng tài khoản, phí thấp, tạo trong vài phút, tự khớp giao dịch.

## Component Patterns

Hành vi. Spec hình ảnh ở `DESIGN.md` › Components (hoặc mặc định shadcn khi kế thừa); nhóm theo bề mặt, cùng tên nhóm với DESIGN. Minh họa: [Màn quét](mockups/key-checkin.html) (`scanner-viewport`, `scan-result-overlay`, `offline-banner`, `manual-lookup`) · [Thành công & Vé của tôi](mockups/key-success-ticket.html) (`ticket-card`, `order-card`) · [Tổng quan Sự kiện](mockups/key-dashboard-event.html) (`dashboard-sidebar`, `bottom-tab-bar`, `stat-card`, `status-banner`) · [Hướng D · Rạp tối](mockups/directions-2.html) (`event-hero`, `ticket-tier-row`, `purchase-bar`, `payment-qr-card`).

### Dùng chung

| Component | Dùng ở | Quy tắc hành vi |
|---|---|---|
| `button-primary` | Thanh mua vé, stage, sidebar, landing | Một nút chính mỗi màn. Bấm → trạng thái loading (spinner trong nút, giữ nguyên độ rộng, chặn bấm lặp) cho mọi thao tác gọi mạng. Không bao giờ disable mà không có lý do hiển thị gần đó. |
| `button-primary-on-light` | Form dashboard, Checkout nền sáng, Tra tay, `order-card` | Hành vi như `button-primary`. Ở dark mode luôn hiển thị như `button-primary` (coral, chữ mực) — quy tắc chung ở `DESIGN.md` › Nút. |
| `button-secondary` | "Tải ảnh QR", "Chia sẻ Vé", "Tra tay" | Hành động phụ; không bao giờ đứng một mình làm hành động chính. |
| `button-destructive` | "Hủy Sự kiện", "Từ chối", "Thu hồi" | Luôn qua `Dialog` xác nhận nêu hậu quả cụ thể ("Mọi Vé sẽ bị vô hiệu. Email gửi tới 48 Người mua."). "Hủy Sự kiện" yêu cầu gõ tên Sự kiện `[ASSUMPTION]`. |
| `stage-block` | Hero, QR, stat-card | Không tương tác tự thân; chỉ chứa nội dung/nút. |
| `event-card` | Danh sách Sự kiện (dashboard), lịch sử Vé của tôi | Chạm cả hàng → vào Sự kiện (dashboard: tab Tổng quan). |
| `status-badge` | Mọi nơi | Không tương tác; luôn có chữ. |
| `status-banner` | Trang Sự kiện (dưới stage), Dashboard (đầu vùng nội dung) | Banner chặn bán hoặc mức danger không đóng được; banner mang tính thông tin có nút đóng. Mỗi banner tối đa một hành động (vd. "Liên kết ngay", "Mua thêm Token", "Kết nối lại Google Sheets"). Hiện tối đa 2; còn lại gộp "+N thông báo". Quy tắc đóng, chồng và thứ tự: § Thứ tự ưu tiên `status-banner` (dưới). Banner đổi nội dung được thông báo `aria-live="polite"`. Người mua chỉ thấy banner trạng thái Sự kiện, không bao giờ thấy banner hệ thống BTC. |
| `empty-state` | Mọi danh sách trống | Một câu nêu tình trạng + tối đa một hành động. |
| `otp-input` | Đăng nhập | 6 ô; dán cả mã vào ô đầu tự điền đủ; `autocomplete="one-time-code"`; đủ 6 số tự gửi. |
| `Sonner` (toast, shadcn) | Mọi nơi | Phản hồi sau thao tác; không dùng toast cho lỗi chặn luồng (lỗi chặn hiển thị tại chỗ). |

### Người mua

| Component | Dùng ở | Quy tắc hành vi |
|---|---|---|
| `event-hero` | Trang Sự kiện | Địa điểm chạm được → mở bản đồ `[ASSUMPTION]`. Nút chia sẻ dùng Web Share API, fallback sao chép link. |
| `ticket-tier-row` | Trang Sự kiện | Tình trạng chỗ cập nhật khi tải trang và khi quay lại tab; số chính xác "Còn N vé" (FR-10). Hạng vé không bán được thì không chọn được; stepper ẩn. |
| `quantity-stepper` | Trong `ticket-tier-row` | Bắt đầu ở 0. "+" bị chặn tại min(số còn lại, giới hạn Vé/Đơn còn lại của cả Đơn) — kèm dòng giải thích ("Tối đa 4 vé mỗi Đơn"). Một Đơn có thể gồm nhiều Hạng vé (FR-12). Giữ nguyên lựa chọn qua bước đăng nhập (FR-3). |
| `purchase-bar` | Trang Sự kiện, Checkout | Dính đáy, luôn thấy. Tổng cập nhật tức thì khi đổi số lượng. Chưa chọn vé → nút disabled + nhắc "Chọn vé để tiếp tục". Sự kiện miễn phí: tổng "Miễn phí", nút "Đăng ký" thay "Mua"; Checkout vẫn có form mua, nút "Gửi Đơn" `[ASSUMPTION]` (nhãn). |
| `tickee-referral-line` (dòng giới thiệu Tickee) | Chân trang Sự kiện, email Vé | FR-36 (Could): một dòng + link tới `/`; không chặn, không che nội dung. Có thể hoãn nếu thiếu thời gian. |

### Thanh toán & Vé

| Component | Dùng ở | Quy tắc hành vi |
|---|---|---|
| `payment-qr-card` | QR thanh toán | Tự lắng nghe trạng thái thanh toán (không cần reload, không có nút "Tôi đã chuyển khoản"). Thanh toán được xác nhận → tự chuyển "Thành công" (FR-18). "Mở app ngân hàng" dùng Deep Link; "Tải ảnh QR" lưu ảnh QR (kèm số tiền + mã Đơn trên ảnh `[ASSUMPTION]`). QR tĩnh: nút sao chép mã Đơn → toast "Đã sao chép mã Đơn". |
| `countdown-chip` | QR thanh toán | Đếm theo giờ máy chủ (không theo đồng hồ máy). Về 0 → chuyển màn Hết hạn. Không nhấp nháy. |
| `recipient-trust-block` | QR thanh toán | Tĩnh; hiện tên BTC + chủ tài khoản + ngân hàng ngay khi màn mở, trước cả khi QR tải xong. |
| `reassurance-line` | QR thanh toán | Xuất hiện thay dòng "Đang chờ thanh toán" sau một khoảng chờ (`[ASSUMPTION]` ~2 phút, khớp mốc Đối soát bù FR-20 — Open Questions #14); copy ở State Patterns › Chờ lâu. Thông báo cho trình đọc màn hình (`aria-live="polite"`). |
| `ticket-card` | Thành công, Chi tiết Vé | Mở Chi tiết Vé → tăng độ sáng màn hình nếu trình duyệt cho phép `[ASSUMPTION]`. Chia sẻ từng Vé bằng link hoặc ảnh (FR-22). |
| `social-ticket-card` | Chi tiết Vé (nút "Tải ảnh Story") | Tạo ảnh tại chỗ rồi lưu/chia sẻ qua Web Share API (fallback tải ảnh). Ảnh **không bao giờ chứa Mã QR vé** hay thông tin check-in được (FR-25). Chỉ hiện với Vé hợp lệ; Vé Đã hủy không có nút `[ASSUMPTION]`. Đang tạo ảnh → spinner trong nút; lỗi → toast "Chưa tạo được ảnh. Thử lại." `[ASSUMPTION]`. |
| `order-card` | Vé của tôi › Đơn đang chờ | Chờ thanh toán: đếm ngược theo giờ máy chủ; "Tiếp tục thanh toán" mở lại đúng QR thanh toán của Đơn đó (không tạo Đơn mới); về 0 → thẻ chuyển "Hết hạn" rồi rời nhóm chờ. "BTC đang kiểm tra thanh toán": không hành động chính, hiện liên hệ BTC. Đã hủy: hiện liên hệ BTC. Không bao giờ có QR. Tự cập nhật khi trạng thái Đơn đổi (Đơn được duyệt → thành Vé trong nhóm hiệu lực). |

### Màn quét

| Component | Dùng ở | Quy tắc hành vi |
|---|---|---|
| `scanner-viewport` | Màn quét | Camera chạy liên tục; nhận QR → khóa quét cho tới khi kết quả đóng (chống đọc lặp cùng mã). Kết quả < 1s (NFR-2). |
| `scan-result-overlay` | Màn quét | Xanh: tự đóng sau ~1.5s, quay về quét. Đỏ: giữ tới khi CTV chạm (bất kỳ đâu). Đỏ phát âm thanh cảnh báo (FR-27). Xem "Check-in tại cổng". |
| `offline-banner` | Màn quét | Hiện ngay khi mất mạng; camera tạm dừng, khung ngắm hiện "Camera tạm dừng · tự thử lại"; tự thử lại; tự ẩn khi có mạng. Không đóng tay được. Nút "Tra tay" vẫn hiện (giữ vị trí ổn định), nhưng tra tay cũng cần mạng — không có check-in offline. |
| `manual-lookup` | Tra tay | Một ô tìm theo **SĐT hoặc email** của Người mua (đúng FR-29); nhãn luôn hiển thị: "SĐT hoặc email Người mua". Thêm tìm theo tên hoặc vài số cuối SĐT là `[ASSUMPTION]` chờ PM/Architecture (Open Questions #3); nếu được duyệt, nhãn đổi thành "Tên, SĐT/email hoặc số cuối SĐT". Kết quả hiện ngay khi gõ (debounce ~200ms `[ASSUMPTION]`), chỉ trong Sự kiện được giao; mỗi hàng chỉ có tên, Hạng vé, trạng thái check-in và nút "Check-in" — hàng "Đã check-in" không có nút; check-in tay vẫn một lần, ghi người thực hiện (FR-29). Không bao giờ hiện Mã QR vé. |

### Dashboard

| Component | Dùng ở | Quy tắc hành vi |
|---|---|---|
| `dashboard-sidebar` | Dashboard ≥ `lg` | BTC switcher đầu sidebar: đổi BTC → về danh sách Sự kiện của BTC đó. Mục chỉ dành cho Owner bị ẩn với Admin. |
| `bottom-tab-bar` | Dashboard < `md` | 4 mục cố định; badge số ở "Cần xử lý" cập nhật real-time. "Quét vé" mở Màn quét của Sự kiện đang chọn; nếu nhiều Sự kiện đang diễn ra → chọn Sự kiện trước `[ASSUMPTION]`. |
| `stat-card` | Tổng quan, Check-in | Số check-in cập nhật liên tục không reload (FR-30); doanh thu chỉ tính Đơn Đã thanh toán (FR-31). |
| `needs-action-card` (thẻ Cần xử lý) | Tổng quan Sự kiện | Số mục Cần xử lý của Sự kiện, cập nhật real-time; link "Mở tab Đơn, lọc Cần xử lý" → tab Đơn với bộ lọc "Cần xử lý" bật sẵn. |
| `recent-orders-block` (khối "Đơn gần đây") | Tổng quan Sự kiện | 5 Đơn mới nhất mọi trạng thái, tự cập nhật như tab Đơn (Đơn mới hiện đầu khối, không reload); "Xem tất cả Đơn" → tab Đơn. Chỉ là lối tắt — danh sách đầy đủ, bộ lọc và xuất CSV vẫn ở tab Đơn. |
| `wizard-stepper` | Tạo Sự kiện | 4 bước; quay lại bước trước không mất dữ liệu. Bước "Xem trước & mở bán" liệt kê mọi điều kiện còn thiếu (chính sách hoàn vé, liên kết tài khoản, Closed Beta, Token) với link sửa nhanh; "Mở bán" chỉ bật khi đủ. Có thể "Lưu nháp" ở mọi bước. Tự lưu nháp: `[ASSUMPTION]`. |
| `needs-action-row` | Cần xử lý, tab Đơn | Mở → `Sheet` chi tiết: giao dịch, Đơn liên quan, nhật ký. Thao tác theo loại: ghép tay giao dịch với Đơn, duyệt tay phát Vé (chỉ khi còn chỗ), từ chối, đánh dấu "Đã hoàn tay" (FR-21). Sau thao tác: hàng rời hàng đợi + toast nêu kết quả. |
| `checkin-progress` | Tab Check-in | Theo từng Hạng vé, real-time. Dưới đó: link mời CTV chung (nút "Sao chép link") + danh sách CTV đã nhận, mỗi người có "Thu hồi" (FR-26). |

**Bố cục Tổng quan Sự kiện** (đã chốt; minh họa: [Tổng quan Sự kiện](mockups/key-dashboard-event.html)):

- `status-banner` warning "Token dưới ngưỡng" (khi có) ở đầu vùng nội dung, trên các khối số liệu.
- Hàng số liệu: hai `stat-card` (doanh thu; check-in đã vào / tổng) + `needs-action-card` cạnh bên — nhãn "Cần xử lý", giá trị "2 mục Cần xử lý", link "Mở tab Đơn, lọc Cần xử lý".
- `recent-orders-block`: tiêu đề + link "Xem tất cả Đơn" bên phải; bảng 5 Đơn mới nhất: Mã Đơn · Người mua · Vé · Số tiền · Trạng thái (Đơn Cần xử lý kèm dòng loại, vd. "Lệch số tiền · nhận 250.000đ / Đơn 300.000đ") · Thời gian. < `md`: danh sách thẻ như bảng Đơn.

### Landing

| Component | Dùng ở | Quy tắc hành vi |
|---|---|---|
| `landing-hero` | `/` | CTA "Đăng ký Closed Beta" dẫn tới tạo Tài khoản Tickee (đăng nhập Google/OTP email) rồi vào Flow 2 bước 1: tạo BTC → banner "Chờ duyệt Closed Beta". Không có form đăng ký riêng. CTA lặp lại ở section cuối trang. Đã đăng nhập và đã có BTC → CTA đổi thành "Vào dashboard" `[ASSUMPTION]`. |

### Thứ tự ưu tiên `status-banner`

- **Đóng được hay không**: banner danger và banner chặn bán (Bị khóa, Đã hủy, Closed Beta bị thu hồi, chạm hạn mức Token, chưa liên kết tài khoản nhận tiền) **không đóng được**. Banner warning/neutral mang tính thông tin (Token dưới ngưỡng, Chỉ QR tĩnh, Google Sheets) có nút đóng; đóng rồi thì ẩn tới phiên sau hoặc tới khi trạng thái đổi `[ASSUMPTION]`.
- **Chồng nhiều banner**: hiện tối đa 2 banner theo thứ tự dưới; còn lại gộp thành dòng "+N thông báo" mở `Sheet` danh sách. `offline-banner` của Màn quét không tính vào giới hạn này.
- **Thứ tự** `[ASSUMPTION]` (đề xuất, cao → thấp — Open Questions #7):
  1. BTC hoặc Sự kiện Bị khóa
  2. Đã hủy
  3. Closed Beta bị thu hồi
  4. Token chạm hạn mức (Tạm ngừng bán)
  5. Chưa liên kết / liên kết thất bại tài khoản nhận tiền
  6. "Chờ duyệt Closed Beta"
  7. Ẩn / Tạm ngừng bán
  8. Mất quyền Google Sheets
  9. Token dưới ngưỡng
  10. Chỉ QR tĩnh
  11. Đã kết thúc

## State Patterns

### Trang Sự kiện & mua vé

Minh họa: [Trang Sự kiện](mockups/directions-2.html) (mục "Hướng D · Rạp tối").

| Trạng thái | Bề mặt | Cách thể hiện |
|---|---|---|
| Tải lần đầu | Trang Sự kiện | `Skeleton` theo bố cục stage + 2 thẻ Hạng vé; mục tiêu < 2s trên 4G (NFR-1). |
| Không tìm thấy (slug sai / Sự kiện Nháp) | Không tìm thấy | `empty-state` "Không tìm thấy Sự kiện này. Kiểm tra lại link BTC gửi bạn." Không có nút khám phá; Sự kiện Nháp trả cùng trạng thái, không lộ là có tồn tại `[ASSUMPTION]`. |
| Hạng vé đang bán | `ticket-tier-row` | "Còn N vé" chính xác (FR-10). Sắp hết (≤ 10 vé còn lại): chữ `{colors.brand-text}` đậm. |
| "Hết vé" / "Chưa mở bán" / "Đã đóng bán" | `ticket-tier-row-unavailable` | Nhãn thay stepper; "Chưa mở bán" kèm giờ mở (FR-8). |
| Mọi Hạng vé hết | Trang Sự kiện | `purchase-bar` thay bằng thông báo "Hết vé"; nút ẩn. |
| "Tạm ngừng bán" | Trang Sự kiện | Banner warning dưới stage; stepper và "Mua" tắt (FR-15, FR-37). |
| Ẩn | Trang Sự kiện | Xem được, `status-banner` warning "Sự kiện tạm dừng nhận Đơn", không mua được (FR-7). |
| Bị khóa (Sự kiện hoặc BTC) | Trang Sự kiện | `status-banner` danger, không nhận Đơn (FR-35). Copy: "Sự kiện tạm thời không nhận Đơn." — không nêu lý do vi phạm `[ASSUMPTION]`. |
| Đã hủy | Trang Sự kiện | Banner danger "Sự kiện đã hủy"; không mua được (FR-33). |
| Đã kết thúc | Trang Sự kiện | Banner neutral "Sự kiện đã kết thúc"; không mua được. |
| Phòng chờ (Sự kiện đông) | Trang Sự kiện | Chưa quyết — Open Questions #1 (PRD OQ #5, NFR-3). |
| Đăng nhập: OTP đã gửi / sai / hết hạn | Đăng nhập | "Mã đã gửi tới {email}" + đếm ngược gửi lại; sai: "Mã chưa đúng, còn N lần" tại ô; hết hạn: "Mã đã hết hạn" + "Gửi mã mới" (5 phút / 5 lần — `[ASSUMPTION]` kế thừa PRD (FR-1)). |
| Đăng nhập Google bị hủy | Đăng nhập | Ở lại màn đăng nhập, không báo lỗi đỏ. |
| Form thiếu/sai | Checkout | Lỗi tại từng trường khi rời trường và khi gửi; cuộn + focus trường lỗi đầu tiên. Ghi rõ thông tin chia sẻ cho BTC (FR-3). |
| Hết chỗ khi gửi Đơn | Checkout | Không tạo Đơn; báo đúng Hạng vé nào hết; quay lại trang Sự kiện với số lượng hạng đó về 0, các hạng khác giữ nguyên (FR-13). |
| Token khả dụng không đủ | Checkout | Không tạo QR; "Sự kiện tạm ngừng bán. Bạn thử lại sau nhé." (FR-15). |
| Gửi Đơn lỗi (mạng / máy chủ) | Checkout | Lỗi tại chỗ trên nút: "Chưa gửi được Đơn. Kiểm tra kết nối rồi thử lại." + nút "Thử lại"; form giữ nguyên dữ liệu. Thử lại dùng cùng khóa chống trùng của lần gửi đầu nên không tạo Đơn thứ hai; nếu Đơn đã được tạo ở lần trước → chuyển thẳng tới QR thanh toán của Đơn đó `[ASSUMPTION]` (copy + cơ chế, Architecture xác nhận — Open Questions #12). |
| Không tạo được QR (Tingee lỗi, không do Token) | QR thanh toán | Đơn và Giữ chỗ vẫn còn; khung QR thay bằng "Chưa tạo được mã QR. Đang thử lại…" + nút "Thử lại" (`button-secondary`); `recipient-trust-block` và đếm ngược vẫn hiện. Thử lại tạo QR cho **cùng Đơn**, không tạo Đơn mới. Lỗi kéo dài → dòng phụ "Đơn của bạn vẫn được giữ trong Vé của tôi." `[ASSUMPTION]` (copy, số lần tự thử). |
| Báo cáo Sự kiện | Báo cáo Sự kiện | Form chọn lý do + mô tả ngắn; yêu cầu đăng nhập Tài khoản Tickee `[ASSUMPTION]`. Đã gửi: "Cảm ơn bạn. Tingee sẽ xem xét báo cáo này." Lỗi: lỗi tại chỗ + "Thử lại", giữ nội dung đã nhập. `[ASSUMPTION]` copy. |

### QR thanh toán & sau thanh toán

Minh họa: [QR thanh toán](mockups/directions-2.html) (mục "Hướng D · Rạp tối", gồm trạng thái trấn an).

| Trạng thái | Bề mặt | Cách thể hiện |
|---|---|---|
| Đang chờ | QR thanh toán | QR + đếm ngược + `recipient-trust-block` + "Đang chờ thanh toán — vé sẽ tự hiện khi BTC nhận được tiền." |
| Chờ lâu | QR thanh toán | `reassurance-line` (copy chuẩn): "Nếu bạn đã chuyển, vé sẽ về trong vài phút — đừng chuyển lại." |
| Quay lại từ app ngân hàng | QR thanh toán | Kiểm tra trạng thái ngay khi tab hiển thị lại (`visibilitychange`); nếu đã thanh toán → "Thành công". `[ASSUMPTION]` |
| QR tĩnh | QR thanh toán | Mã Đơn nổi bật + sao chép + hướng dẫn ghi đúng nội dung chuyển khoản (FR-17). |
| Mất mạng khi đang chờ | QR thanh toán | QR vẫn hiển thị (thanh toán ở app ngân hàng không phụ thuộc trang); dòng nhỏ "Mất kết nối — vé vẫn được gửi qua email và Vé của tôi." `[ASSUMPTION]` |
| Thành công | Thành công | Chuyển cảnh nhẹ: thẻ Vé trượt lên từ stage tối + rung nhẹ nếu thiết bị hỗ trợ. "Vé của bạn đã sẵn sàng!" + từng `ticket-card` + "Đã gửi Vé tới {email}" (FR-18, FR-22, FR-23). Bố cục (đã chốt): stage block đầu màn chứa wordmark, tên Sự kiện, "Vé của bạn đã sẵn sàng!" và "Đã gửi Vé tới {email}"; `ticket-card` đầu tiên chồng mép dưới stage (vị trí cuối của chuyển cảnh), các Vé sau xếp dưới; mỗi Vé có "Chia sẻ Vé"; cuối màn một nút chính `button-primary-on-light` "Xem Vé của tôi" → Vé của tôi. Reduced motion: hiện ngay, không trượt, không rung. Minh họa: [Thành công](mockups/key-success-ticket.html). |
| Hết hạn | Hết hạn | "Hết thời gian giữ chỗ. Chỗ đã được trả lại." + `button-primary` "Mua lại" về trang Sự kiện (FR-14). Dòng phụ: "Nếu bạn đã chuyển tiền, đừng chuyển lại — kiểm tra Vé của tôi hoặc email." `[ASSUMPTION]` |
| Sự kiện miễn phí | Trang Sự kiện → Checkout → Thành công | Giá "Miễn phí", nút "Đăng ký"; vẫn qua đăng nhập + form mua (FR-9); không có QR; gửi Đơn → Thành công ngay với Mã QR vé (FR-11). Nhãn nút `[ASSUMPTION]`. |
| Email Vé lỗi | — | Tự thử lại phía sau; không hiện với Người mua (FR-23). |

### Vé của tôi & Chi tiết Vé

Minh họa: [Vé của tôi](mockups/key-success-ticket.html) (mục 3).

| Trạng thái | Bề mặt | Cách thể hiện |
|---|---|---|
| Tải lần đầu | Vé của tôi, Chi tiết Vé | `Skeleton` theo bố cục thẻ (Vé của tôi: 2 thẻ; Chi tiết Vé: `ticket-card` với ô QR xám). |
| Trống | Vé của tôi | "Bạn chưa có vé nào. Vé bạn mua sẽ hiện ở đây." Không có nút khám phá (không chợ vé). |
| Đơn Chờ thanh toán | Vé của tôi | `order-card` với đếm ngược + "Tiếp tục thanh toán" → QR thanh toán của cùng Đơn. |
| "BTC đang kiểm tra thanh toán" | Vé của tôi | `order-card`. Mọi loại Cần xử lý hiện cùng một trạng thái phía Người mua (không lộ tên loại), kèm thông tin liên hệ BTC; email gửi cho mọi loại — `[ASSUMPTION]`, xem Open Questions #4. |
| Đơn Đã hủy (BTC từ chối) | Vé của tôi | `order-card` badge "Đã hủy" + liên hệ BTC. `[ASSUMPTION]` hiển thị Đơn bị từ chối cho Người mua. |
| Vé hợp lệ | Chi tiết Vé | `ticket-card` + Mã QR vé đầy đủ. |
| Vé Đã check-in | Chi tiết Vé | QR mờ + badge "Đã check-in". |
| Vé Đã hủy (Sự kiện hủy) | Chi tiết Vé | QR mờ + badge "Đã hủy" + "Sự kiện đã hủy. BTC sẽ liên hệ hoàn tiền." (FR-33) |
| Sau Sự kiện kết thúc | Vé của tôi | Vé rời nhóm hiệu lực, chỉ còn hàng lịch sử: tên, ngày, "Đã tham dự"/"Chưa check-in" (FR-24). |
| Xóa tài khoản khi còn Vé | Tài khoản | `Dialog` cảnh báo liệt kê Vé còn hiệu lực trước khi xác nhận (FR-38). |

### Chi tiết Vé qua link chia sẻ

Ai được mở link, có phải đăng nhập không, và có thấy Mã QR vé không chờ Architecture quyết (Open Questions #11, liên quan PRD OQ #10 — chuyển nhượng Vé); UX chỉ chốt các trạng thái phải có và mức tối thiểu:

- **Người nhận chưa đăng nhập** (Chi tiết Vé qua link chia sẻ) — xem thẳng Vé, hay đăng nhập trước rồi quay lại đúng link như FR-3.
- **Người mở không phải chủ Vé (đã đăng nhập)** — có thấy Mã QR vé hay chỉ thông tin Vé; Vé có vào Vé của tôi của người nhận không.
- **Vé đã check-in** — tối thiểu nhất quán với chủ Vé: QR mờ + badge "Đã check-in".
- **Vé Đã hủy / hết hiệu lực** (Sự kiện hủy hoặc đã kết thúc) — tối thiểu: không có Mã QR vé dùng được + badge trạng thái.
- **Link không hợp lệ** (sai, bị thu hồi, Vé không tồn tại) — tối thiểu: `empty-state` không lộ thông tin Vé hay Người mua.

### Dashboard BTC

| Trạng thái | Bề mặt | Cách thể hiện |
|---|---|---|
| Tải | Mọi trang | `Skeleton` theo bố cục. |
| Chưa có Sự kiện | Sự kiện | `empty-state` "Chưa có Sự kiện nào." + "Tạo Sự kiện". |
| "Chờ duyệt Closed Beta" | Mọi trang (banner) | Banner warning + hướng dẫn liên hệ Tingee; vẫn tạo được Sự kiện nháp và Sự kiện miễn phí (FR-37). |
| Closed Beta bị thu hồi | Banner + Sự kiện | Banner danger; Sự kiện có phí "Tạm ngừng bán" (FR-37). |
| Chưa liên kết tài khoản nhận tiền | Banner (Owner) / Wizard bước 4 | Owner: "Liên kết tài khoản nhận tiền để bán Vé có phí." Admin: "Nhờ Owner liên kết tài khoản nhận tiền." |
| Đang liên kết tài khoản nhận tiền | Tài khoản nhận tiền | Sau khi Owner gửi thông tin: nút loading, `status-badge` neutral "Đang liên kết"; nếu Tingee trả kết quả chậm, rời trang được — banner trên dashboard cập nhật khi xong `[ASSUMPTION]`. Không mở bán Sự kiện có phí trong lúc này (FR-5). |
| Liên kết tài khoản nhận tiền thất bại | Tài khoản nhận tiền + `status-banner` danger | Lỗi tại chỗ nêu lý do có thể hành động (thông tin tài khoản không khớp / Tingee tạm lỗi) + "Thử lại"; dữ liệu đã nhập giữ nguyên. `[ASSUMPTION]` danh sách lý do và copy phụ thuộc mã lỗi Tingee. |
| Chỉ dùng được QR tĩnh | Tài khoản nhận tiền, Tổng quan | Thông báo + khuyến nghị đổi sang tài khoản hỗ trợ QR động (FR-5). |
| Token dưới ngưỡng / chạm hạn mức | Banner + Token | Dưới ngưỡng: warning "Token khả dụng dưới ngưỡng cảnh báo." + hành động "mua thêm Token" (Owner). Chạm hạn mức: danger "Mọi Sự kiện có phí đang Tạm ngừng bán" (FR-34). |
| Google Sheets | Cài đặt Sự kiện | Đã kết nối · đang đồng bộ · lỗi/thử lại · mất quyền → banner trên Tổng quan "Kết nối lại Google Sheets" (FR-32). |
| Cần xử lý trống | Cần xử lý | "Không có gì cần xử lý." |
| Đơn trống | Tab Đơn | "Chưa có Đơn nào. Gửi link Sự kiện để bắt đầu bán." + "Sao chép link". |
| Chặn mở bán | Wizard bước 4 | Danh sách điều kiện còn thiếu, mỗi mục có link sửa. |
| Giảm số suất dưới (đã bán + Giữ chỗ) | Hạng vé | Lỗi tại trường: "Tối thiểu {n} — đã bán và đang giữ chỗ." (FR-8) |
| Sửa thời gian/địa điểm khi đã phát Vé | Sửa Sự kiện | `Dialog` báo sẽ email Người mua (`[ASSUMPTION]` kế thừa PRD (FR-7)). |
| Lời mời CTV | Tab Check-in | Link chung còn hạn / hết hạn (tạo link mới); CTV đã nhận / đã thu hồi. |
| Không có quyền (Admin mở URL dành cho Owner) | Thành viên, Tài khoản nhận tiền, mua Token | Không hiện trang lỗi chung: `empty-state` "Chỉ Owner xem được mục này." + nút về Tổng quan. Mục vẫn ẩn khỏi điều hướng `[ASSUMPTION]` (copy). |
| Bị xóa khỏi BTC giữa phiên | Mọi trang của BTC đó | Thao tác kế tiếp (hoặc cập nhật real-time) → `Dialog` "Bạn không còn là thành viên của {BTC}." → về BTC khác trong switcher, hoặc trang Vé của tôi nếu không còn BTC nào `[ASSUMPTION]`. Không lưu thao tác dở. |
| BTC bị khóa (góc nhìn BTC) | Mọi trang của BTC | `status-banner` danger không đóng được "BTC đang bị khóa — mọi Sự kiện ngừng nhận Đơn." + "Liên hệ Tingee"; vẫn xem được Đơn, check-in, xuất CSV; không tạo/mở bán Sự kiện (FR-35) `[ASSUMPTION]` (quyền còn lại khi bị khóa — Open Questions #9). |
| Sự kiện bị khóa (góc nhìn BTC) | Tổng quan Sự kiện | `status-banner` danger "Sự kiện bị khóa — ngừng nhận Đơn."; Vé đã phát vẫn check-in được trừ khi Quản trị Tingee vô hiệu (`[ASSUMPTION]` kế thừa PRD (FR-35)). Nút "Mở bán"/"Ẩn" tắt kèm lý do. |
| Mất mạng | Dashboard | Toast một lần "Mất kết nối. Đang thử lại…"; số liệu real-time giữ giá trị cuối + nhãn "Cập nhật lúc HH:MM" `[ASSUMPTION]`. |
| 2FA Owner | Đăng nhập Owner | Chưa quyết — phương thức chưa chốt: Open Questions #2 (PRD OQ #9). |
| Sau khi Hủy Sự kiện | Sự kiện (BTC) | `status-badge` "Đã hủy"; `status-banner` danger trên Tổng quan "Sự kiện đã hủy · {n} Đơn cần hoàn tiền" + "Xuất danh sách hoàn tiền"; tab Đơn lọc sẵn Đơn Đã thanh toán chưa "Đã hoàn tay"; mọi thao tác bán tắt (FR-33). Xem Flow 4. |
| Đã hoàn tay hết | Sự kiện (BTC) | Banner đổi sang neutral "Đã hoàn tay mọi Đơn." và có thể đóng `[ASSUMPTION]`. |

### Landing BTC

| Trạng thái | Bề mặt | Cách thể hiện |
|---|---|---|
| Khách chưa đăng nhập bấm CTA | Landing → Đăng nhập | Màn đăng nhập (Google / OTP email) → tạo Tài khoản Tickee → màn tạo BTC (Flow 2 bước 1). |
| Đã có Tài khoản Tickee, chưa có BTC | Landing → tạo BTC | Bỏ qua đăng nhập, vào thẳng màn tạo BTC. |
| Đã có BTC (đang chờ duyệt hoặc đã duyệt) | Landing | CTA "Vào dashboard"; dashboard hiện `status-banner` "Chờ duyệt Closed Beta" nếu chưa duyệt `[ASSUMPTION]`. |
| Lỗi tạo tài khoản / tạo BTC | Đăng nhập, tạo BTC | Lỗi tại chỗ + "Thử lại", giữ dữ liệu đã nhập (dùng các trạng thái Đăng nhập ở trên). |

### Quản trị Tingee

Trạng thái tối thiểu `[ASSUMPTION]` (PRD chưa đặc tả quy trình — PRD OQ #7, Open Questions #9):

| Trạng thái | Bề mặt | Cách thể hiện |
|---|---|---|
| Hàng chờ duyệt Closed Beta rỗng | Duyệt Closed Beta | `empty-state` "Không có BTC chờ duyệt." |
| Duyệt / thu hồi Closed Beta | Duyệt Closed Beta | Nút "Duyệt"; "Thu hồi" (`button-destructive`) qua `Dialog` nêu hậu quả "Sự kiện có phí của {BTC} sẽ Tạm ngừng bán." (FR-37). |
| Danh sách báo cáo rỗng | Báo cáo vi phạm | `empty-state` "Chưa có báo cáo nào." |
| Xác nhận khóa | Báo cáo vi phạm, chi tiết Sự kiện/BTC | `Dialog` chọn khóa Sự kiện hay khóa BTC, lý do bắt buộc, tùy chọn vô hiệu Vé đã phát (FR-35); "Khóa" là `button-destructive`. |
| Đã khóa / mở khóa | Chi tiết Sự kiện/BTC | `status-badge` danger "Bị khóa" + nhật ký khóa/mở khóa (ai, lúc nào, lý do); "Mở khóa" qua `Dialog` (FR-35). |

### CTV / Màn quét

Minh họa: [Màn quét](mockups/key-checkin.html).

| Trạng thái | Bề mặt | Cách thể hiện |
|---|---|---|
| Lời mời hợp lệ | Nhận lời mời | Tên Sự kiện + BTC + "Nhận soát vé" → Màn quét. |
| Lời mời hết hạn / bị thu hồi | Nhận lời mời | "Link mời đã hết hạn. Liên hệ BTC để nhận link mới." |
| Xin quyền camera | Màn quét | Trước khi trình duyệt hỏi: màn giải thích ngắn "Cho phép camera để quét Mã QR vé" + nút "Bật camera". |
| Camera bị từ chối | Màn quét | Hướng dẫn bật lại theo trình duyệt (Safari iOS / Chrome Android) + nút "Tra tay" để vẫn làm việc được. |
| Đang quét | Màn quét | Khung ngắm + số đã check-in của Sự kiện. |
| Xanh "Thành công" | `scan-result-success` | Tên Người mua · "Vé 2/2" · Hạng vé; tự đóng ~1.5s. |
| Đỏ đã check-in | `scan-result-danger` | "Đã check-in" + giờ + người quét lần trước; âm thanh; chạm để đóng (FR-27, FR-28). |
| Đỏ "Vé không hợp lệ" | `scan-result-danger` | Tiêu đề "Vé không hợp lệ" + một dòng lý do ngay dưới: "Mã QR vé không đúng" (sai chữ ký) / "Vé đã hủy" / "Vé của Sự kiện khác"; âm thanh; chạm để đóng. |
| Mất mạng | `offline-banner` | "Mất kết nối — chưa quét được"; hành vi: xem `offline-banner` (Component Patterns › Màn quét). |
| Tra tay: không có kết quả | Tra tay | "Không tìm thấy Vé khớp." |
| Hết quyền (giữa ca) | Hết quyền | Lượt quét kế tiếp → màn "Bạn không còn quyền soát vé cho Sự kiện này." (FR-26) |
| Sự kiện kết thúc | Hết quyền | Như trên, kèm "Sự kiện đã kết thúc." |

## Interaction Primitives

- **Chạm để hành động**; không có thao tác chỉ-hover. Một hành động chính mỗi màn, đặt trong vùng ngón cái (nửa dưới) trên điện thoại.
- **Thanh mua vé dính đáy** trên trang Sự kiện và Checkout.
- **Không reload để biết kết quả**: QR thanh toán, Check-in real-time, badge Cần xử lý đều tự cập nhật.
- **Deep Link** sang app ngân hàng; quay lại trình duyệt tự kiểm tra trạng thái.
- **Web Share API** cho chia sẻ Sự kiện và Vé; fallback sao chép link + toast "Đã sao chép".
- **Sao chép**: mã Đơn (QR tĩnh), link Sự kiện, link mời CTV — luôn kèm toast xác nhận.
- **Phản hồi xúc giác**: rung nhẹ khi "Thành công" (Người mua) nếu thiết bị hỗ trợ. Rung trên Màn quét: `[ASSUMPTION]` chưa quyết.
- **Âm thanh**: chỉ trên Màn quét — kết quả đỏ luôn có âm thanh (FR-27); kết quả xanh: `[ASSUMPTION]` một tiếng "bíp" ngắn, nhẹ, khác hẳn tiếng đỏ.
- **Phím tắt dashboard**: không có ở MVP `[ASSUMPTION]`; dashboard dùng tốt bằng bàn phím (Tab/Enter/Esc).
- **Cấm**: carousel tự chạy, cuộn vô hạn (dùng phân trang ở bảng Đơn), kéo-thả, modal chồng modal, pop-up quảng bá, xác nhận "Bạn có chắc?" cho thao tác không phá hủy, đổi màu đếm ngược sang đỏ nhấp nháy.

## Accessibility Floor

Hành vi. Tương phản hình ảnh nằm ở `DESIGN.md` › Colors (mọi cặp chữ/nền đã kiểm, gồm `brand-text` #CF2147 trên `page`).

- **WCAG 2.2 AA** trên mọi bề mặt.
- **Focus**: mọi control có focus ring `{colors.ring}` / `{colors.ring-dark}` 2px, offset 2px, chỉ hiện khi điều hướng bàn phím (`:focus-visible`). Focus không bao giờ bị che bởi thanh mua vé dính đáy hay tab bar (2.4.11) — `scroll-padding-bottom` bằng chiều cao thanh.
- **Kích thước vùng chạm**: tối thiểu 24×24px (2.5.8); control chính cao `{spacing.control-height}`; stepper `{spacing.stepper-button}`.
- **Không chỉ dựa vào màu**: kết quả quét = màu + chữ lớn + hình icon khác nhau + âm thanh (đỏ); badge trạng thái luôn có chữ; Hạng vé hết dùng nhãn chữ + viền nét đứt.
- **Trình đọc màn hình**:
  - Kết quả quét thông báo `aria-live="assertive"`: "Thành công. Minh, vé 2 trên 2, Đôi nam." / "Dừng lại. Vé đã check-in lúc 7 giờ 42."
  - QR thanh toán: ảnh QR có nhãn "Mã QR thanh toán 300.000 đồng cho CLB ABC"; đếm ngược không đọc mỗi giây — chỉ thông báo ở mốc 5 phút và 1 phút còn lại (`aria-live="polite"`).
  - Chuyển "Thành công" và `reassurance-line` thông báo `polite`.
  - Stepper: nút có nhãn "Giảm/Tăng số vé Đơn nam" (Đơn nam là tên Hạng vé), giá trị đọc dạng "2 vé".
- **Chuyển động**: tôn trọng `prefers-reduced-motion` — bỏ trượt thẻ Vé, bỏ rung, kết quả quét hiện tức thì không fade.
- **Thời gian**: đếm ngược 15 phút là giới hạn bắt buộc của nghiệp vụ Giữ chỗ (ngoại lệ 2.2.1 "real-time"); luôn hiển thị thời gian còn lại. Kết quả xanh tự đóng sau ~1.5s, không chứa thông tin chỉ có ở đó (số check-in vẫn cập nhật trên màn quét).
- **Form**: nhãn hiển thị luôn (không chỉ placeholder); lỗi gắn `aria-describedby`; không bắt nhập lại thông tin đã có (3.3.7) — email tự điền (FR-3); SĐT tự điền nếu Tài khoản Tickee đã có, không thì Người mua nhập một lần. Xác thực không dùng câu đố nhận thức (3.3.8): OTP hỗ trợ dán và tự điền.
- **Thu phóng**: dùng được ở 200% chữ, không cuộn ngang ở 320px.
- **Ngôn ngữ**: `lang="vi"`.

## Niềm tin khi thanh toán

Minh họa: [QR thanh toán](mockups/directions-2.html) (mục "Hướng D · Rạp tối").

Rủi ro UX số 1: Minh (Người mua, UJ-1) bỏ ngang ở bước VietQR vì **không tin / sợ mất tiền**, không phải vì thao tác quét. Mọi quyết định trên màn QR thanh toán phục vụ niềm tin:

1. **Tên người nhận là tín hiệu chính.** `recipient-trust-block` hiện tên BTC + chủ tài khoản + ngân hàng **khớp đúng thứ app ngân hàng sẽ hiển thị** khi Minh quét. Minh đối chiếu được trước khi bấm chuyển.
2. **"Tiền chuyển thẳng cho [tên BTC]"** và "Tickee không giữ tiền của bạn" (FR-16) luôn thấy mà không cần cuộn trên màn 375×667.
3. **Chính sách hoàn vé** có link ngay trên màn QR (FR-16), mở trong `Sheet` — không rời màn QR.
4. **Không có nút "Tôi đã chuyển khoản".** Xác nhận tự động; màn hình giữ nguyên QR.
5. **Dòng trấn an** (`reassurance-line`) sau khoảng chờ ngăn chuyển lặp; copy ở State Patterns › Chờ lâu.
6. **Không bao giờ để Minh mất dấu Đơn**: nếu rời trang, Đơn đang chờ nằm trong Vé của tôi; nếu Đơn vào Cần xử lý, Minh thấy "BTC đang kiểm tra thanh toán" + liên hệ BTC + email.
7. **Đồng hồ bình tĩnh**: đếm ngược coral, không đỏ, không nhấp nháy.

Thứ tự trên màn (trên xuống): số tiền + đếm ngược → QR → mã Đơn → khối người nhận → trạng thái chờ → "Mở app ngân hàng" / "Tải ảnh QR" → chân trang niềm tin.

## Check-in tại cổng

Minh họa: [Màn quét](mockups/key-checkin.html).

Rủi ro UX số 2: Lan (CTV, UJ-3) quét chậm vì **đọc kết quả chậm** và **tra tay mất thời gian**.

- **Đọc bằng một cái liếc**: kết quả phủ toàn màn hình xanh `{colors.scan-success}` / đỏ `{colors.scan-danger}`, tiêu đề `{typography.scan-result}`, đọc được ở khoảng cách cánh tay ngoài trời.
- **Nhịp quét**: xanh tự quay về quét sau ~1.5s — Lan không chạm gì giữa hai khách hợp lệ. Đỏ phải chạm để đóng — buộc Lan dừng lại xử lý.
- **Thông tin trên xanh**: "Minh · Vé 2/2 · Đôi nam" — đủ để đối chiếu nhanh; Vé không mang tên người đi cùng (PRD FR-22).
- **Thông tin trên đỏ**: lý do (một dòng dưới tiêu đề) + (nếu đã check-in) giờ và người quét lần trước, để Lan giải thích với khách.
- **Quét song song**: cùng Vé quét gần đồng thời → chỉ một xanh, người còn lại đỏ kèm thông tin lượt trước (FR-28).
- **Tra tay nhanh**: nút "Tra tay" luôn ở vùng ngón cái; ô tìm tự focus; kết quả hiện khi gõ theo SĐT hoặc email (FR-29), thêm tên / vài số cuối SĐT nếu PM duyệt (Open Questions #3); "Check-in" ngay trên hàng kết quả, không qua màn chi tiết.
- **Mất mạng là trạng thái rõ ràng**, không phải lỗi im lặng: banner cố định, camera dừng (để Lan không tưởng đã quét được), tự thử lại.

## Key Flows

### Flow 1 — Minh mua Vé giải Pickleball qua link (UJ-1)

Minh họa: [Trang Sự kiện, QR thanh toán](mockups/directions-2.html) (bước 1–7) · [Thành công & Vé của tôi](mockups/key-success-ticket.html) (bước 8–9).

Minh chơi Pickleball phong trào, mở link CLB ABC đăng trong nhóm Zalo, trên điện thoại, muốn mua vé cho mình và bạn đánh đôi.

1. Minh chạm link → trang Sự kiện mở trên trình duyệt, chưa đăng nhập. `event-hero` tối hiện tên giải, ngày-giờ, địa điểm; BTC "CLB ABC" ngay dưới.
2. Minh thấy "Đơn nam · 300.000đ · Còn 12 vé" và "Đôi nam". Minh tăng `quantity-stepper` mỗi hạng lên 1. `purchase-bar` cập nhật tổng.
3. Minh bấm "Mua" → màn đăng nhập: "Tiếp tục với Google" (một chạm) hoặc OTP email. Đăng nhập xong quay lại Checkout với đúng 1 vé Đơn nam + 1 vé Đôi nam (FR-3).
4. Checkout: email tự điền; SĐT tự điền nếu tài khoản đã có, không thì Minh nhập; Minh nhập Tên, trả lời câu hỏi "Trình độ" của BTC — một lần cho cả Đơn. Dòng ghi rõ thông tin chia sẻ cho BTC. Minh bấm "Gửi Đơn".
5. Màn QR thanh toán: số tiền, "Giữ chỗ còn 14:59", QR trên tấm trắng giữa stage tối. Ngay dưới: "Tiền chuyển thẳng cho CLB ABC · Chủ tài khoản NGUYEN VAN TUAN · Vietcombank".
6. Minh bấm "Mở app ngân hàng", quét/xác nhận; app ngân hàng hiện đúng tên chủ tài khoản như Tickee đã báo — Minh yên tâm chuyển.
7. Minh quay lại trình duyệt; màn kiểm tra trạng thái ngay.
8. **Cao trào:** màn QR tự chuyển sang "Thành công" — hai thẻ Vé trượt lên từ sân khấu tối, điện thoại rung nhẹ: "Vé của bạn đã sẵn sàng!" Mỗi Vé một Mã QR vé riêng; email Vé đến cùng lúc.
9. Minh bấm "Chia sẻ Vé" trên Vé thứ hai, gửi link cho bạn đánh đôi qua Zalo. Cả hai Vé nằm trong Vé của tôi.

Nhánh lỗi:
- Hết 15 phút chưa trả → màn Hết hạn: "Hết thời gian giữ chỗ. Chỗ đã được trả lại." + "Mua lại" (FR-14).
- Minh chuyển rồi nhưng chưa thấy xác nhận → sau khoảng chờ hiện `reassurance-line`; Minh không chuyển lại.
- Minh chuyển thiếu tiền / ghi sai nội dung (QR tĩnh) → không phát Vé; Vé của tôi hiện "BTC đang kiểm tra thanh toán" + liên hệ BTC; Minh nhận email (FR-21; email mọi loại — Open Questions #4).
- Gửi Đơn khi "Đôi nam" vừa hết → không tạo Đơn: "Hạng vé Đôi nam vừa hết. Bạn chọn lại nhé." (FR-13).
- Gửi Đơn lỗi mạng → "Chưa gửi được Đơn…" + "Thử lại"; thử lại không tạo Đơn trùng.
- Đến cổng không mở được Vé → Minh đọc SĐT hoặc email của tài khoản; CTV tra tay theo thông tin đó (`manual-lookup`, Flow 3).

### Flow 2 — Anh Tuấn mở bán giải Pickleball đầu tiên (UJ-2)

Minh họa: [Tổng quan Sự kiện](mockups/key-dashboard-event.html) (bước 7–9).

Anh Tuấn, chủ nhiệm CLB ABC, trước đây thu tiền bằng Google Forms rồi dò sao kê; mở Tickee từ link giới thiệu của Tingee, trên laptop buổi tối.

1. Anh đăng ký Tài khoản Tickee bằng email (OTP), đồng ý điều khoản dữ liệu cá nhân, tạo BTC "CLB ABC" — anh là Owner. Thiết lập 2FA (Open Questions #2, PRD OQ #9).
2. Banner trên dashboard dẫn anh tới **Tài khoản nhận tiền**: liên kết tài khoản CLB qua Tingee. Kết quả hiện ngay: dùng được QR động. CLB đã được duyệt Closed Beta nên không có banner "Chờ duyệt Closed Beta".
3. Anh bấm "Tạo Sự kiện" → `wizard-stepper` bước 1 **Thông tin**: tên, thời gian, địa điểm, mô tả, ảnh, chính sách hoàn vé.
4. Bước 2 **Hạng vé**: "Đơn nam" 300.000đ, 32 suất, giờ mở/đóng bán; thêm "Đôi nam".
5. Bước 3 **Form mua**: giữ trường mặc định, thêm câu hỏi "Trình độ" (lựa chọn, bắt buộc).
6. Bước 4 **Xem trước & mở bán**: xem trang Sự kiện như Người mua sẽ thấy; mọi điều kiện đã đủ. Anh bấm "Mở bán" → nhận link + "Sao chép link"; dán vào nhóm Zalo và Facebook (preview đúng ảnh, tên, thời gian — FR-10).
7. Anh mở Tổng quan Sự kiện trên điện thoại.
8. **Cao trào:** Đơn đầu tiên được thanh toán — tiền vào thẳng tài khoản CLB, Đơn tự duyệt; `stat-card` doanh thu nhảy lên 300.000đ và tên Người mua hiện ngay đầu khối "Đơn gần đây" và tab Đơn, không cần reload. Anh Tuấn không phải dò sao kê.
9. Những ngày sau, anh theo dõi doanh thu, Vé theo Hạng vé, xuất CSV hoặc kết nối Google Sheets ở Cài đặt Sự kiện.

Nhánh lỗi:
- Một Người mua chuyển thiếu tiền → badge "Cần xử lý" trên sidebar/tab bar tăng lên 1. Anh mở hàng: `needs-action-row` "Lệch số tiền · nhận 250.000đ / Đơn 300.000đ". Anh chọn "Từ chối" (Đơn → Đã hủy) hoặc "Duyệt tay phát Vé" nếu còn chỗ; sau khi tự hoàn tiền ngoài hệ thống, đánh dấu "Đã hoàn tay". Mọi thao tác ghi nhật ký (FR-21).
- Thiếu chính sách hoàn vé ở bước 4 → "Mở bán" tắt, danh sách nêu "Thiếu chính sách hoàn vé" kèm link về bước 1.
- Token dưới ngưỡng → banner warning + email; Owner bấm "mua thêm Token" sang luồng Tingee (FR-34).
- Liên kết tài khoản nhận tiền thất bại ở bước 2 → lỗi tại chỗ + "Thử lại", `status-banner` "Chưa liên kết tài khoản nhận tiền" vẫn còn; anh vẫn tạo được Sự kiện nháp, nhưng "Mở bán" Sự kiện có phí tắt ở bước 4 (FR-5).
- BTC chưa được duyệt Closed Beta → `status-banner` warning "Chờ duyệt Closed Beta" + hướng dẫn liên hệ Tingee; anh vẫn tạo Sự kiện nháp và Sự kiện miễn phí; bước 4 liệt kê "Chờ duyệt Closed Beta" trong điều kiện còn thiếu cho Sự kiện có phí (FR-37).

### Flow 3 — Lan soát vé ở cổng (UJ-3)

Minh họa: [Màn quét](mockups/key-checkin.html).

Lan, sinh viên được CLB ABC nhờ soát vé, đứng cổng ngoài trời sáng ngày thi đấu cùng vài CTV khác, chỉ có điện thoại.

1. Tối hôm trước, anh Tuấn sao chép link mời CTV chung ở tab Check-in và gửi vào nhóm CTV.
2. Lan mở link → đăng nhập Tài khoản Tickee → màn Nhận lời mời hiện tên giải + BTC → "Nhận soát vé" → vào thẳng Màn quét của đúng Sự kiện. Lan không thấy dữ liệu nào khác của BTC.
3. Màn giải thích quyền camera → Lan bấm "Bật camera" → trình duyệt hỏi → cho phép.
4. Khách đưa Vé; Lan đưa khung ngắm vào Mã QR vé.
5. Màn phủ xanh: "Thành công · Minh · Vé 2/2 · Đôi nam". Sau ~1.5s tự quay về quét.
6. Khách kế tiếp đưa ảnh chụp Vé đã được người khác dùng → màn phủ đỏ, có âm thanh: "Đã check-in · lúc 07:42 · bởi Hùng". Lan chạm để đóng, mời khách gặp BTC.
7. Một khách không mở được Vé → Lan bấm "Tra tay", gõ SĐT do khách đọc → hàng "Minh · Đôi nam · Hợp lệ" hiện ngay → "Check-in".
8. **Cao trào:** khách qua cổng liên tục. Mỗi lượt Lan chỉ liếc: xanh cho vào, đỏ dừng lại — không đọc chữ nhỏ, không chạm giữa hai khách hợp lệ. Anh Tuấn xem số đã check-in tăng real-time trên `checkin-progress`.
9. Sự kiện kết thúc → lượt quét kế tiếp của Lan hiện "Bạn không còn quyền soát vé cho Sự kiện này."

Nhánh lỗi:
- Sóng 4G ở cổng chập chờn → `offline-banner` "Mất kết nối — chưa quét được", camera dừng; Lan chuyển khách sang hàng chờ; banner tự ẩn khi có mạng.
- Lan lỡ từ chối quyền camera → màn hướng dẫn bật lại + nút "Tra tay" để vẫn làm việc.
- Anh Tuấn thu hồi quyền của một CTV → hiệu lực ngay lượt quét kế tiếp của người đó (FR-26).
- Vé của Sự kiện khác / Vé đã hủy → đỏ "Vé không hợp lệ".

### Flow 4 — Anh Tuấn hủy giải Pickleball (FR-33, Should)

Minh họa: không có mock; xây từ spine.

Sân thi đấu báo hỏng mái ba ngày trước giải; anh Tuấn phải hủy giải đã bán 48 Vé, trên laptop.

1. Anh vào Sự kiện › Cài đặt → "Hủy Sự kiện" (`button-destructive`).
2. `Dialog` nêu hậu quả cụ thể: "Ngừng bán ngay. Mọi Vé (48) sẽ bị vô hiệu. Email gửi tới 48 Người mua. Bạn tự hoàn tiền ngoài Tickee." Anh gõ tên Sự kiện để xác nhận (`[ASSUMPTION]`, như `button-destructive`) rồi bấm "Hủy Sự kiện".
3. Hệ thống ngừng bán, vô hiệu mọi Vé, gửi email cho mọi Người mua; Đơn đang Chờ thanh toán hết hiệu lực (Người mua thấy "Sự kiện đã hủy" trên QR thanh toán / `order-card`) `[ASSUMPTION]` (xử lý Đơn đang chờ — Open Questions #8). Trang Sự kiện hiện `status-banner` danger "Sự kiện đã hủy".
4. Tổng quan Sự kiện: badge "Đã hủy" + `status-banner` "Sự kiện đã hủy · 48 Đơn cần hoàn tiền" + nút "Xuất danh sách hoàn tiền".
5. Anh xuất danh sách (CSV: Người mua, SĐT, email, số tiền đã trả, mã Đơn — FR-33) và chuyển khoản hoàn từng người từ app ngân hàng.
6. Trong tab Đơn (lọc sẵn Đơn Đã thanh toán chưa "Đã hoàn tay"), anh đánh dấu từng Đơn "Đã hoàn tay"; chọn nhiều Đơn để đánh dấu cùng lúc `[ASSUMPTION]`. Mỗi thao tác ghi nhật ký; bộ đếm "còn N Đơn" giảm dần.
7. **Cao trào:** Đơn cuối cùng được đánh dấu — banner chuyển neutral "Đã hoàn tay mọi Đơn." Anh không phải dò lại sao kê để biết ai đã được hoàn.

Nhánh lỗi:
- Anh bấm nhầm "Hủy Sự kiện" → `Dialog` chặn bằng bước gõ tên; Esc/"Quay lại" không thay đổi gì. Sau khi xác nhận thì không hoàn tác được (`Dialog` ghi rõ).
- Email tới một số Người mua lỗi → hệ thống tự thử lại (FR-23); không chặn BTC.
- Khách vẫn đến cổng với Vé cũ → CTV quét thấy đỏ "Vé không hợp lệ" (FR-33); Vé trong Vé của tôi hiện "Sự kiện đã hủy. BTC sẽ liên hệ hoàn tiền."
- Một Đơn được đánh dấu "Đã hoàn tay" nhầm → bỏ đánh dấu được, có ghi nhật ký `[ASSUMPTION]`.

## Inspiration & Anti-patterns

- **Lấy từ flip.vn:** thanh mua vé dính đáy kèm tổng tiền; chọn vé bằng bộ đếm +/− theo từng hạng; thông tin cốt lõi (ngày-giờ, địa điểm) là hàng icon + 2 dòng ngay dưới tên Sự kiện; giá định dạng VN; một CTA chính mỗi màn.
- **Lấy từ luma.com:** gom mua/đăng ký vào một vùng có trạng thái rõ (còn / hết); font sạch, ít cỡ chữ; hỗ trợ sáng/tối theo hệ thống; hiện người tổ chức (BTC) như tín hiệu tin cậy.
- **Lấy từ weeztix.com (landing BTC):** hero một câu lợi ích + câu giải thích + CTA; kể sản phẩm theo hành trình BTC (tạo Sự kiện → bán → theo dõi → soát vé); tiêu đề thẻ tính năng là lợi ích; CTA lặp theo nhịp và khép trang bằng section CTA cuối.
- **Không lấy — nhiều màu pastel và mega-menu (weeztix):** trái với "ít màu mè"; Tickee một màu thương hiệu.
- **Không lấy — toast đánh giá nổi và bong bóng chat che nội dung trên mobile (weeztix).**
- **Không lấy — hero có đồ họa nặng tải chậm (luma landing):** trang Sự kiện phải < 2s trên 4G.
- **Không lấy — nhuộm nền theo ảnh cover (flip, luma):** "Rạp tối" dùng stage cố định để coral luôn đạt tương phản.
- **Không lấy — trang khám phá / carousel Sự kiện nổi bật (flip, luma); gửi ảnh chụp chuyển khoản / nút "Tôi đã chuyển khoản":** xem Information Architecture và Niềm tin khi thanh toán.

## Responsive & Platform

| Bề mặt | < `md` (< 768px) | `md`–`lg` | ≥ `lg` (≥ 1024px) |
|---|---|---|---|
| Trang Sự kiện | Một cột, `purchase-bar` nổi đáy | Cột căn giữa tối đa `{spacing.content-max-buyer}` `[ASSUMPTION]` | 2 cột: trái ảnh bìa + mô tả, phải thẻ chọn vé dính khi cuộn (đã chốt) |
| Checkout, QR, Vé của tôi | Một cột, `purchase-bar` nổi đáy | Cột căn giữa tối đa `{spacing.content-max-buyer}` `[ASSUMPTION]` | Như `md` `[ASSUMPTION]` |
| Dashboard BTC | `bottom-tab-bar`; bảng Đơn thành danh sách thẻ; `Dialog` → `Sheet` toàn màn | Sidebar thu icon `[ASSUMPTION]` | `dashboard-sidebar` đầy đủ; bảng Đơn dạng `Table` |
| Màn quét CTV | Toàn màn, dọc | Như điện thoại | Như điện thoại (không tối ưu desktop) |
| Landing BTC | Một cột, CTA xếp chồng | 2 cột | 2–3 cột |

Nền tảng (trình duyệt: xem Foundation): camera qua `getUserMedia` (HTTPS, NFR-6). Rung qua Vibration API (Safari iOS không hỗ trợ — chỉ là tính năng bổ sung). Deep Link mở app ngân hàng trên điện thoại; trên desktop ẩn nút "Mở app ngân hàng", chỉ còn QR để quét bằng điện thoại `[ASSUMPTION]`. OG preview cho Zalo/Facebook (FR-10). Safe-area inset cho thanh dính đáy.

## Open Questions

Nhóm theo người quyết; số thứ tự liên tục để dẫn chiếu ("Open Questions #n"). Câu hỏi mở của PRD dẫn là "PRD OQ #n".

**PM**

1. **Phòng chờ** khi Sự kiện đông (NFR-3, PRD OQ #5): Người mua thấy gì.
2. **2FA Owner** — phương thức và UI thiết lập (PRD OQ #9).
3. **Tra tay theo tên + số cuối SĐT** vượt phạm vi FR-29 (SĐT/email đầy đủ là bắt buộc, đã có) — PM/Architecture xác nhận (quyền riêng tư: CTV thấy danh sách tên khớp). Đây là nơi theo dõi chính của `[ASSUMPTION]` này.
4. **Email + liên hệ BTC cho mọi loại Cần xử lý** — PM xác nhận kênh liên hệ BTC. Đây là nơi theo dõi chính của `[ASSUMPTION]` này.
5. **Hàng "Cần xử lý" gộp cấp BTC** vượt phạm vi FR-31 — PM xác nhận.
6. **Người mua thấy gì với QR tĩnh khi BTC bị ngắt dịch vụ** (PRD OQ #4).
7. **Thứ tự ưu tiên `status-banner`** (đề xuất ở Component Patterns › Thứ tự ưu tiên `status-banner`) và banner nào đóng được — PM xác nhận.
8. **Xử lý Đơn đang Chờ thanh toán khi Hủy Sự kiện**, đánh dấu "Đã hoàn tay" hàng loạt và bỏ đánh dấu (Flow 4) — PM xác nhận.
9. **Quyền còn lại của BTC khi bị khóa** (xem Đơn, check-in, xuất CSV) và quy trình Quản trị Tingee (PRD OQ #7).
10. **Báo cáo Sự kiện có cần đăng nhập không** (FR-35).

**Architecture**

11. **Chi tiết Vé qua link chia sẻ** — **Architecture quyết**: người nhận có phải đăng nhập không, có thấy Mã QR vé không, xử lý người lạ cầm link, Vé đã check-in / Đã hủy / hết hiệu lực và link không hợp lệ (State Patterns › Chi tiết Vé qua link chia sẻ). Liên quan PRD OQ #10 (chuyển nhượng Vé).
12. **Retry an toàn khi Gửi Đơn / tạo QR lỗi** — Architecture xác nhận khóa chống trùng Đơn (State Patterns › Trang Sự kiện & mua vé).
13. **Vé khi mất mạng ở cổng**: Chi tiết Vé có cần lưu sẵn để mở offline không (hiện dựa vào tra tay FR-29).

**UX**

14. **Khoảng chờ hiện `reassurance-line`** — đề xuất ~2 phút.
15. **Âm thanh/rung cho kết quả xanh** trên Màn quét.

`[ASSUMPTION]` inline không có trong danh sách trên là mặc định UX (copy, nhãn nút, chi tiết tương tác), không chặn triển khai; chúng nằm ở Foundation, Component Patterns, State Patterns (mọi nhóm), Interaction Primitives, Responsive & Platform và Flow 4.
