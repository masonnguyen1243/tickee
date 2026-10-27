# Spine Pair Review — Tickee

## Overall verdict
Cặp spine đủ dùng làm hợp đồng cho Architecture và story-dev. Ba hành trình UJ-1/2/3 đều có Key Flow đầy đủ (nhân vật, bước đánh số, cao trào, nhánh lỗi). Token màu có hex và cặp sáng/tối, và có bảng tương phản đã kiểm. Hai rủi ro ưu tiên (niềm tin ở bước QR, tốc độ quét ở cổng) có section riêng. Không có lỗi critical. Chỗ yếu tập trung ở bốn điểm: (1) một số bề mặt thiếu trạng thái, nặng nhất là người nhận link Vé được chia sẻ; (2) vài component dùng trong EXPERIENCE nhưng chưa có spec trong DESIGN (banner, Social Ticket Card, thẻ Đơn chờ); (3) ba chỗ còn ghi "chưa chốt" dù memlog đã chốt; (4) một ngoại lệ "coral trên nền sáng" đi ngược quy tắc trong memlog.

## 1. Flow coverage — adequate
Đã kiểm: `sources` → PRD §2.3 (UJ-1, UJ-2, UJ-3), các FR và các luồng F1–F10 trong `.working/extract-prd.md`. Cả ba UJ có Key Flow với nhân vật đúng tên PRD (Minh, anh Tuấn, Lan), bước đánh số, **Cao trào** và nhánh lỗi (EXPERIENCE §Key Flows). F5 (Cần xử lý) nằm trong nhánh lỗi Flow 2; F9 và F10 được phủ bằng các dòng State Patterns.
### Findings
- **medium** FR-33 Hủy Sự kiện (Should, F6) chưa có luồng. Spine mới chỉ có `Dialog` xác nhận (EXPERIENCE Component Patterns, dòng `button-destructive`) và trạng thái Vé Đã hủy (State Patterns › Chi tiết Vé). Còn thiếu: xuất danh sách hoàn tiền, đánh dấu "Đã hoàn tay" từng Đơn sau khi hủy, email gửi Người mua, và màn sau khi hủy của BTC. *Fix:* thêm Flow 4 ngắn (anh Tuấn hủy giải), hoặc một bảng trạng thái "Sau khi hủy Sự kiện" trong Dashboard BTC.
- **low** F2 Sự kiện miễn phí mới có một dòng (State Patterns › "Sự kiện miễn phí"). Chưa rõ nhãn nút trên `purchase-bar` ("Mua" hay "Đăng ký"), và chưa rõ có bước Checkout/form hay không. *Fix:* thêm 2–3 dòng trạng thái, hoặc ghi nhãn nút vào Component Patterns `purchase-bar`.
- **low** Flow 2 không có nhánh lỗi cho bước liên kết Tingee thất bại và cho trường hợp "Chờ duyệt Closed Beta", dù đây là hai điểm có thể chặn SM-5 (EXPERIENCE Flow 2, bước 2). *Fix:* thêm hai nhánh lỗi.
- **low** FR-36 "Dòng giới thiệu Tickee" (Could) không xuất hiện ở đâu. *Fix:* ghi một dòng vào Component Patterns, hoặc ghi rõ là hoãn.

## 2. Token completeness — adequate
Đã kiểm: mọi key trong frontmatter DESIGN (`colors`, `typography`, `rounded`, `spacing`, `components`) và mọi tham chiếu `{path.to.token}` trong prose của hai spine. Mọi tham chiếu đều có định nghĩa. Mọi màu có hex. Các token chỉ có một giá trị cho cả hai chế độ (`brand`, `on-brand`, `stage*`, `bar`, `scan-*`, `qr-*`, `destructive`) được ghi rõ là dùng chung có chủ ý. Bảng tương phản phủ các cặp quan trọng, gồm cả `brand-text` #CF2147 mới.
### Findings
- **medium** Trọng số 600 được dùng ở 5 chỗ: dòng 1 của `event-hero` (DESIGN dòng 456), số trong `quantity-stepper` (467), giá trị trong `recipient-trust-block` (479), `reassurance-line` (481) và mục đang chọn của `dashboard-sidebar` (517). Nhưng §Typography chỉ tải 400/500/700 (dòng 382), không token typography nào có 600, và memlog ghi "500/700". Dev sẽ gặp faux-bold hoặc fallback không thống nhất. *Fix:* chọn một trong hai: đổi các chỗ trên sang 500/700, hoặc thêm 600 vào danh sách tải và tạo token (vd. `label-strong`).
- **medium** `button-primary-on-light` không có quy tắc cho dark mode. Nếu giữ nền `stage` #1C1416 trên `card-dark` #1C1416 thì tỉ lệ là 1.0:1, nút biến mất. Quy tắc "dark → dùng `button-primary`" mới chỉ ghi riêng cho `manual-lookup` (DESIGN dòng 509) và nút "Mở app ngân hàng" (482), chưa ghi cho form dashboard và Checkout (EXPERIENCE Component Patterns, dòng `button-primary-on-light`). *Fix:* thêm vào frontmatter `background-dark: '{colors.brand}'` và `foreground-dark: '{colors.on-brand}'`, hoặc ghi quy tắc chung một lần trong §Components › Nút.
- **low** Có giá trị literal nằm ngoài token: gradient fallback `#2A1D20` (DESIGN dòng 456), viền `rgba(255,77,106,.5)` của `countdown-chip` (frontmatter, dòng 233), và chuỗi bóng (dòng 422, 424). *Fix:* đặt tên token (`stage-fallback`, `brand-border`, `shadow-card`, `shadow-ring-dark`) để code mirror đúng.
- **low** `destructive` #B42318 trên `card-dark` chỉ đạt 2.75:1, trên `page-dark` 3.03:1, và cặp này không có trong bảng tương phản. Chữ trắng vẫn nhận diện được nút nên không vi phạm, nhưng nên ghi rõ. *Fix:* thêm dòng vào bảng tương phản, hoặc tạo `destructive-dark`.

## 3. Component coverage — adequate
Đã kiểm: mọi tên component trong hai spine, đối chiếu DESIGN §Components (spec hình ảnh) với EXPERIENCE §Component Patterns (spec hành vi). 25 component có mặt ở cả hai nơi, và quy tắc hành vi là quy tắc thật, không phải mô tả một từ.
### Findings
- **medium** "Banner" được dùng khoảng 10 lần trong EXPERIENCE State Patterns: banner trạng thái Sự kiện (Tạm ngừng bán, Ẩn, Bị khóa, Đã hủy, Đã kết thúc) và banner hệ thống dashboard (Chờ duyệt Closed Beta, Token, Chưa liên kết, Google Sheets). DESIGN chỉ có `offline-banner` và một câu "dùng `status-badge` tone tương ứng ở dạng banner rộng" (dòng 456). Chưa có spec cho vị trí, icon, nút hành động, có đóng được hay không, và thứ tự ưu tiên khi nhiều banner cùng lúc. *Fix:* thêm component `status-banner` (tone × vị trí) vào cả hai spine, kèm quy tắc chồng banner.
- **medium** Social Ticket Card (FR-25, Should) có trong EXPERIENCE (IA › Chi tiết Vé; Component Patterns, dòng `ticket-card`) nhưng DESIGN không có spec ảnh (bố cục, tỉ lệ Story 9:16, nền stage hay card). *Fix:* thêm mục spec trong DESIGN §Components, hoặc ghi rõ là hoãn.
- **medium** Thẻ Đơn chờ trong Vé của tôi (đếm ngược + "Tiếp tục thanh toán", badge "BTC đang kiểm tra thanh toán", Đơn Đã hủy kèm liên hệ BTC — EXPERIENCE State Patterns › Vé của tôi) chưa có component ở cả hai spine; `event-card` không phủ trường hợp này. *Fix:* thêm `order-card` (hình ảnh và hành vi).
- **low** Có component chỉ được mô tả trong prose mà không có entry trong frontmatter `components`: `wizard-stepper`, `needs-action-row`, `checkin-progress`, `empty-state`, `otp-input`, `scanner-viewport`, `manual-lookup`. Tên `scan-result-overlay` (heading DESIGN, EXPERIENCE) cũng không khớp với hai key `scan-result-success`/`-danger` trong frontmatter. *Fix:* bổ sung entry frontmatter và ghi `scan-result-overlay` là tên nhóm.
- **low** Ba thành phần của landing chưa có spec: các ô "bốn giá trị", form/CTA "Đăng ký Closed Beta" ở cuối trang, và nút "Tiếp tục với Google" ở màn đăng nhập. Hành vi đã có nhưng spec hình ảnh còn mỏng. *Fix:* thêm một dòng cho mỗi thành phần.

## 4. State coverage — adequate
Đã kiểm từng bề mặt IA: trạng thái tải, rỗng, lỗi, mất mạng, bị từ chối quyền, focus. Trang Sự kiện, QR thanh toán, Vé của tôi, Dashboard và Màn quét được phủ rất kỹ (quyền camera, mất mạng, hết quyền giữa ca, quét song song). Vẫn còn vài lỗ hổng.
### Findings
- **high** Người nhận link Vé được chia sẻ (IA › Chi tiết Vé "link Vé được chia sẻ"; Flow 1 bước 9) chưa có trạng thái nào. Chưa rõ: người nhận có phải đăng nhập không, có thấy Mã QR vé không, mở link khi Vé đã check-in hay Đã hủy thì sao, người lạ cầm link thì sao. Quyết định này ảnh hưởng trực tiếp đến kiến trúc bảo mật Mã QR vé, và PRD Open Question #10 (chuyển nhượng Vé) vẫn còn mở. *Fix:* thêm hàng trạng thái "Chi tiết Vé qua link chia sẻ" (chưa đăng nhập / không phải chủ / Vé hết hiệu lực) và đưa vào Open Questions nếu chưa chốt.
- **medium** Foundation (EXPERIENCE dòng 22) viết Quản trị Tingee "không có yêu cầu trải nghiệm riêng ngoài State Patterns", nhưng State Patterns không có mục Quản trị Tingee. Đây là tham chiếu gãy. *Fix:* thêm bảng 3–4 trạng thái (hàng chờ duyệt rỗng, xác nhận khóa, đã khóa), hoặc sửa câu.
- **medium** Landing BTC chưa rõ CTA "Đăng ký Closed Beta" dẫn tới đâu: form riêng, hay tạo Tài khoản Tickee như Flow 2? Cũng chưa có trạng thái gửi thành công / lỗi / đã đăng ký (EXPERIENCE IA › Landing BTC; Component Patterns, dòng `landing-hero`). *Fix:* chốt đích đến và thêm trạng thái.
- **medium** Checkout và QR thanh toán thiếu trạng thái lỗi mạng hoặc máy chủ khi "Gửi Đơn" và khi tạo QR thất bại vì Tingee lỗi (không phải do Token). Hiện chỉ có "Hết chỗ" và "Token không đủ" (State Patterns › Trang Sự kiện & mua vé). *Fix:* thêm hàng "Gửi Đơn lỗi" và "Không tạo được QR", với thông điệp và hành động thử lại không gây trùng Đơn.
- **medium** Dashboard thiếu trạng thái bị từ chối quyền: Admin mở URL dành cho Owner, thành viên bị xóa khỏi BTC trong lúc đang dùng, và góc nhìn của BTC khi Sự kiện hoặc BTC bị khóa (FR-35). *Fix:* thêm 2–3 hàng vào State Patterns › Dashboard BTC.
- **medium** Tài khoản nhận tiền chưa có trạng thái "đang liên kết" và "liên kết thất bại" (State Patterns chỉ có "chưa liên kết" và "chỉ QR tĩnh"). Đây là bước chặn mở bán trong Flow 2. *Fix:* thêm trạng thái.
- **low** Trang Sự kiện với slug không tồn tại, hoặc Sự kiện còn Nháp mà mở bằng link, chưa có trạng thái 404. *Fix:* thêm một hàng.
- **low** Form Báo cáo Sự kiện (FR-35) chưa có trạng thái: đã gửi, lỗi, có cần đăng nhập không. *Fix:* thêm hai hàng.
- **low** Vé của tôi và Chi tiết Vé chưa ghi trạng thái tải lần đầu (skeleton). Hiện mới có "Tải" cho Dashboard và Trang Sự kiện. *Fix:* thêm một hàng.

## 5. Visual reference coverage — adequate
Đã kiểm `mockups/`, `wireframes/`, `imports/`. Hai thư mục đầu chưa tồn tại, `imports/` rỗng. Đây là **pending như dự kiến**: mock các màn chính sẽ được render sau review này. Tham chiếu duy nhất là `.working/directions-2.html` (Hướng D · Rạp tối), được dẫn ở DESIGN §Brand & Style (dòng 307) và EXPERIENCE phần mở đầu (dòng 13). Câu "spine thắng khi mâu thuẫn" có ở cả hai.
### Findings
- **low** *(pending như dự kiến)* Sau khi render mock các màn chính, cần link inline từng mock tại section liên quan: IA, `payment-qr-card`, `ticket-card`, `scan-result-overlay`, `dashboard-sidebar`, và ghi rõ mỗi mock minh họa gì. *Fix:* làm ở vòng Update sau khi có mockups.
- **low** Tham chiếu duy nhất đang nằm trong `.working/`, thư mục nháp có thể bị dọn. Mock Hướng D chỉ phủ trang Sự kiện, QR thanh toán và trạng thái trấn an; `ticket-card`, dashboard và màn quét chưa có tham chiếu hình ảnh nào (DESIGN dòng 495 đã tự ghi `[ASSUMPTION]`). *Fix:* chuyển ảnh hoặc HTML Hướng D đã chọn vào `imports/` hoặc `mockups/`, rồi cập nhật link.

## 6. Bloat & overspecification — adequate
Đã kiểm restate nguồn, prose thay được bằng bảng, và section không ai đọc. Nhìn chung gọn: FR được dẫn theo mã thay vì chép lại, persona không bị restate.
### Findings
- **low** Cùng một `[ASSUMPTION]` được lặp ở ba nơi. Tra tay theo tên/số cuối SĐT: Component Patterns (`manual-lookup`), §Check-in tại cổng và Open Questions #4. Email mọi loại Cần xử lý: State Patterns › Vé của tôi, Flow 1 nhánh lỗi và Open Questions #5. Lặp như vậy dễ lệch nhau khi PM trả lời. *Fix:* giữ một chỗ chuẩn (Open Questions) và tham chiếu từ các chỗ khác.
- **low** §Niềm tin khi thanh toán lặp lại phần lớn quy tắc của các dòng `payment-qr-card`, `recipient-trust-block`, `reassurance-line` và `countdown-chip`. Section này đáng giữ vì nó là rationale và thứ tự trên màn, nhưng nên ghi thứ tự một lần ở đây và các quy tắc hành vi chỉ ở Component Patterns. *Fix:* rút gọn các mục 4, 5, 7 thành tham chiếu.
- **low** DESIGN có nhiều kích thước pixel lẻ trong prose (padding 3px của stepper, 12px của tấm QR, icon 96px, vòng 28px, thumbnail 56px, icon button 40px). Đây là spec hình ảnh hợp lệ, nhưng các giá trị lặp lại (40px, 12px) nên thành token `spacing`. *Fix:* chỉ token hóa các giá trị lặp.

## 7. Inheritance discipline — adequate
Đã kiểm: `sources` resolve được (`../../prds/prd-tickee-2026-10-27/prd.md` tồn tại). Tên UJ và thuật ngữ Glossary dùng đúng nguyên văn (Sự kiện, Hạng vé, Đơn, Vé, Mã QR vé, QR thanh toán, Giữ chỗ, Cần xử lý, Vé của tôi, Token, CTV). Token mà EXPERIENCE tham chiếu đều có trong DESIGN. Đối chiếu từng quyết định trong memlog với spine: mọi decision đều có mặt trong spine.
### Findings
- **medium** Ba chỗ vẫn ghi "chưa chốt" dù memlog đã chốt:
  1. DESIGN dòng 445: `button-primary-on-light` vẫn gắn `[ASSUMPTION]` "cách thể hiện nút chính trên nền sáng chưa được chốt", trong khi memlog decision "Nút chính trên bề mặt sáng: nền stage gần đen" đã chốt và DESIGN Open Questions #2 cũng ghi đã chốt.
  2. DESIGN dòng 468: "cần giải quyết Open Question #1", trong khi memlog (change) đã đổi `brand-text` sang #CF2147.
  3. EXPERIENCE dòng 269: "trừ `brand-text` trên `page` đang là Open Question".

  Người đọc downstream sẽ nhận tín hiệu mâu thuẫn. *Fix:* xóa ba ghi chú cũ.
- **medium** Chấm "đang chờ" màu coral `{colors.brand}` trên nền sáng (DESIGN dòng 480) đi ngược memlog decision "#FF4D6A chỉ đặt trên nền tối" và quy tắc tương phản trong memlog. Spine đã tự gắn `[ASSUMPTION]` nhưng vẫn để coral làm phương án mặc định. *Fix:* đổi mặc định sang chấm `{colors.muted}`, hoặc `{colors.brand-text}`, và chỉ dùng coral khi user duyệt ngoại lệ.
- **medium** FR-29 và UJ-3 yêu cầu tra Vé theo **SĐT hoặc email**. `manual-lookup` (EXPERIENCE Component Patterns; DESIGN dòng 509) chỉ tìm theo tên và số cuối SĐT, tức là mở rộng một phần nhưng bỏ mất email. Trong khi đó, nhánh lỗi Flow 1 vẫn viết "Minh đọc SĐT/email cho CTV tra tay", mâu thuẫn ngay trong spine. *Fix:* thêm tìm theo email (đúng PRD) bên cạnh phần mở rộng đang chờ PM xác nhận.
- **low** Tên ví dụ không thống nhất: DESIGN dòng 479 dùng "CLB Sóng Xanh", còn PRD và EXPERIENCE dùng "CLB ABC". *Fix:* đổi thành "CLB ABC".
- **low** `sources` của cả hai spine chỉ liệt kê `prd.md`, trong khi memlog ghi nguồn là `prd.md + addendum.md`. Addendum chỉ bàn kênh OTP SĐT nên tác động nhỏ. `.working/reference-sites.md` (nguồn của §Inspiration) cũng chưa được liệt kê. *Fix:* thêm cả hai vào `sources`.

## 8. Shape fit — strong
Đã kiểm thứ tự section. DESIGN theo đúng thứ tự canonical (Brand & Style → Colors → Typography → Layout & Spacing → Elevation & Depth → Shapes → Components → Do's and Don'ts), cuối cùng là Open Questions. EXPERIENCE có đủ các section mặc định bắt buộc (Foundation, IA, Voice and Tone, Component Patterns, State Patterns, Interaction Primitives, Accessibility Floor, Key Flows). Inspiration & Anti-patterns có mặt, đúng vì memlog có sản phẩm tham khảo (flip, luma, weeztix). Responsive & Platform có mặt, đúng vì sản phẩm đa bề mặt. Hai section tự thêm (§Niềm tin khi thanh toán, §Check-in tại cổng) xứng đáng tồn tại vì chúng gắn với hai rủi ro UX ưu tiên trong memlog.
### Findings
- **low** Open Questions đặt cuối DESIGN nằm ngoài danh sách section canonical. Chấp nhận được vì đứng sau Do's and Don'ts nên không phá thứ tự. Khi các câu đã chốt (#1, #2) thì nên xóa hẳn thay vì gạch ngang. *Fix:* dọn ở vòng Update.

## Mechanical notes
- **Frontmatter:** cả hai spine có `title`, `status: draft`, `created`, `updated`, `sources`, `name`. DESIGN có thêm `description` cùng đủ các khối token. Đường dẫn `sources` resolve được.
- **Tham chiếu chéo:** mọi `{colors.*}`, `{typography.*}`, `{rounded.*}`, `{spacing.*}` và `{components.*}` đều resolve được. Không có tham chiếu gãy.
- **Tên không thống nhất:** `scan-result-overlay` (heading, tên nhóm) so với `scan-result-success`/`scan-result-danger` (key frontmatter). "CLB Sóng Xanh" so với "CLB ABC". "Quét vé" (tab) và "Màn quét" (tên bề mặt) dùng song song, chấp nhận được nhưng nên ghi rõ là cùng một bề mặt.
- **Ghi chú cũ:** DESIGN dòng 445 và 468, EXPERIENCE dòng 269 (xem §7).
- **Mermaid:** không có sơ đồ Mermaid. Không có lỗi cú pháp.
- **Visual refs:** `mockups/` và `wireframes/` chưa có, `imports/` rỗng. Pending như dự kiến, mock các màn chính sẽ render sau review này.
