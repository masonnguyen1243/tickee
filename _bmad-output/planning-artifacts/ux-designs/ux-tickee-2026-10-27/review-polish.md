# Review polish — structure + prose lens (2026-10-27)

Chỉ sửa DESIGN.md và EXPERIENCE.md. Frontmatter (status/updated, cấu trúc token) giữ nguyên; chỉ sửa 2 comment YAML.

## DESIGN.md

Đã áp (structure):
- S1 Lead-in Brand & Style đổi thành "Ba bề mặt, cùng một bộ token".
- S2 Open Questions thêm một dòng chỉ mục `[ASSUMPTION]` inline theo mục.
- S3 MOVE "Các khối khác của Tổng quan Sự kiện" sang EXPERIENCE (Bố cục Tổng quan Sự kiện); DESIGN giữ ghi chú hình ảnh + con trỏ.
- S4 MOVE "Bố cục màn Thành công" sang EXPERIENCE (State › Thành công); giữ câu chồng mép ~30px.
- S5 MOVE quy tắc đóng/chồng `status-banner` sang EXPERIENCE (§ Thứ tự ưu tiên `status-banner`); giữ nút đóng icon button.
- S6 MERGE danh sách shadcn nguyên trạng: chỉ ở § Components; Brand & Style trỏ tới.
- S7 CUT các ngoặc "(dark theo quy tắc § Nút)".
- S8 Components nhóm H3 theo bề mặt (Dùng chung · Người mua · Thanh toán & Vé · Màn quét · Dashboard · Landing); mọi key frontmatter có tiêu đề H4 hoặc bold lead; tách "Các component khác".
- S9 CONDENSE "Ghi chú" Colors thành 2 gạch đầu dòng; bỏ nguồn gốc duyệt; gộp câu biểu tượng quét vào Scan story (giữ link Màu quét).
- S10 CUT 2 hàng tương phản trùng (gộp thông tin vào hàng `stage` và `brand-text`/`page`).
- S11 CONDENSE số tương phản trong story Coral/Mực/Coral-700 → trỏ bảng; thêm 2 hàng "không đạt AA — cấm" vào bảng để giữ số liệu.
- S12 MERGE Do's & Don'ts hàng 1 và 3.
- S13 order-card mở bằng định nghĩa, Minh họa cuối mục.
- S14 Bo tấm QR căn theo frontmatter `plate-radius` = `{rounded.lg}` (payment-qr-card, Shapes, comment `rounded.lg`).
- S15 Quy tắc vòng 1px dark chỉ ở Elevation & Depth; Colors và button-secondary trỏ tới.
- S16 Typography "Quy tắc" thành danh sách.
- S17 Tiêu đề component chuẩn hóa (chỉ tên key); thêm avatar BTC vào comment `rounded.full`; ghi chú component không có key frontmatter.

Đã áp (prose):
- P1 Link brand-text "đạt AA trên cả card và page".
- P2 order-card token theo từng mục; số tiền `{typography.label}` theo frontmatter.
- P3 otp-input "phóng lên cỡ chữ 20px".
- P4 "weight 700/500" ở wordmark, event-hero, Tình trạng chỗ, ticket-tier-row, stepper, trust block, reassurance-line, sidebar.
- P5 Câu stage-block giới hạn stage cho Người mua/dashboard.
- P6 Don't "chữ hoa toàn bộ (trừ tên chủ tài khoản ngân hàng)".
- P7 Scan story "kết quả đỏ kèm thêm âm thanh".
- P8 Nút payment-qr-card tách vùng tối / page sáng.
- P9 Sidebar "(các mục chỉ dành cho Owner bị ẩn với Admin)".
- P10 Câu Elevation dashboard tiết chế.
- P11 Câu Input "khi focus thêm viền".
- P12 offline-banner "không tính vào giới hạn chồng banner (tối đa 2)".
- P13 manual-lookup "Hàng kết quả không bao giờ hiện Mã QR vé hay SĐT"; nhãn theo SĐT/email (FR-29), mở rộng tên/số cuối có điều kiện (EXPERIENCE Open Questions #3).
- P14 offline-banner "Khi camera tạm dừng".
- P15 Dòng giới thiệu "nội dung chữ là `[ASSUMPTION]`" (id `tickee-referral-line`).
- P16 "Chạm để quét tiếp" (chỉ ở kết quả đỏ).
- P17 social-ticket-card chân "wordmark + dòng giới thiệu Tickee (FR-36)".
- P18 reassurance-line "(ngưỡng thời gian: xem EXPERIENCE)".
- P19 "trượt" → "không đạt AA".
- P20 "Người mua" viết hoa.
- P21 "(Với QR tĩnh: …)"; "cách nhau bằng đường chia".
- P22 Thống nhất "light mode"/"dark mode", "stage block".
- Minor: "khi số lượng bằng 0", "mang tính thông tin", "khớp đúng tên mà app ngân hàng", "thẻ (card)", "phá hủy".

Không áp: không có. Ghi chú: S17 không thêm key frontmatter cho `value-tile`/`google-signin-button` (cấu trúc token khóa) — thay bằng câu ghi chú ở đầu § Components.

## EXPERIENCE.md

Đã áp (structure):
- S1 CUT dòng "Modal tối đa một tầng…" ở IA (trùng Interaction Primitives › Cấm).
- S2 MOVE danh sách 11 mức ưu tiên banner ra § Thứ tự ưu tiên `status-banner`; hàng bảng giữ con trỏ (kèm quy tắc đóng/chồng chuyển từ DESIGN).
- S3 Foundation thêm con trỏ tới Niềm tin khi thanh toán và Check-in tại cổng.
- S4 CONDENSE Chi tiết Vé qua link chia sẻ: một câu dẫn + danh sách trạng thái → mức tối thiểu.
- S5 CONDENSE hàng "Mất mạng" ở CTV → copy + trỏ `offline-banner`.
- S6 CONDENSE copy trấn an: chuẩn ở State › Chờ lâu; Niềm tin #5 và `reassurance-line` trỏ tới; giữ ví dụ Voice and Tone.
- S7 CONDENSE CTA landing ở Foundation và IA còn mục đích; quy tắc ở `landing-hero`.
- S8 CONDENSE ô "Tổng quan" IA thành danh mục.
- S9 Breakpoint IA khớp `bottom-tab-bar` (< `md`), `md–lg` trỏ Responsive & Platform.
- S10 Component Patterns nhóm H3 cùng tên nhóm DESIGN; id kebab-case `needs-action-card`, `recent-orders-block`, `tickee-referral-line`.
- S11 Nhãn `manual-lookup` theo SĐT/email (FR-29); mở rộng tên/số cuối có điều kiện Open Questions #3.
- S12 Flow 4 bộ lọc dùng một tên mô tả: Đơn Đã thanh toán chưa "Đã hoàn tay".
- S13 Open Questions thêm câu: `[ASSUMPTION]` inline không liệt kê là mặc định UX, kèm các mục chứa chúng.
- S14 Open Questions nhóm theo PM · Architecture · UX, đánh số lại, cập nhật mọi dẫn chiếu.
- S15 CONDENSE Inspiration: gộp 2 mục trùng (trang khám phá, nút "Tôi đã chuyển khoản") thành một dòng trỏ IA/Niềm tin.
- S16 "shadcn mặc định" cho Quản trị Tingee chỉ còn ở Foundation.
- S17 CUT trình duyệt ở Responsive & Platform ("bản hiện hành" chuyển vào Foundation).
- S18–20 Giữ purchase-bar, intro spine-wins + Minh họa, Key Flows; thêm "Minh họa: không có mock" cho Flow 4.
- Thêm: Bố cục Tổng quan Sự kiện và bố cục màn Thành công (nhận từ DESIGN).

Đã áp (prose):
- P1 "1 vé Đơn nam + 1 vé Đôi nam"; ghi chú "Đơn nam là tên Hạng vé" ở nhãn stepper.
- P2 Dẫn chiếu thống nhất "Open Questions #n" / "PRD OQ #n".
- P3 Một dạng "`[ASSUMPTION]` kế thừa PRD (…)" (Foundation, OTP, sửa Sự kiện, Sự kiện bị khóa).
- P4 "Minh (Người mua, UJ-1)", "Lan (CTV, UJ-3)".
- P5 Hết quyền "Sự kiện kết thúc hoặc quyền CTV bị thu hồi".
- P6 Flow 2 "CLB đã được duyệt Closed Beta".
- P7 SĐT theo FR-3: tự điền nếu tài khoản đã có, không thì Người mua nhập (Accessibility › Form và Flow 1 bước 4).
- P8 "Đây là nơi theo dõi chính của `[ASSUMPTION]` này."
- P9 "vượt phạm vi FR-x".
- P10 Voice Người mua "Không dùng thuật ngữ kỹ thuật: …".
- P11 ticket-tier-row "không bán được thì không chọn được; stepper ẩn".
- P12 quantity-stepper "Một Đơn có thể gồm nhiều Hạng vé (FR-12)".
- P13 status-banner "chặn bán hoặc mức danger".
- P14 "tự đóng sau ~1.5s".
- P15 "phá hủy", "đồ họa".
- P16 "Thanh toán được xác nhận".
- P17 "chỉ là tính năng bổ sung".
- P18 "gõ SĐT do khách đọc".
- Minor: "(PRD FR-22)" cho Vé không mang tên người đi cùng; "chỉ dành cho Owner".

Không áp: không có.

## Đánh số lại Open Questions (EXPERIENCE)

Cũ → mới: 1→1, 2→2, 3→14, 4→3, 5→4, 6→5, 7→13, 8→15, 9→6, 10→7, 11→8, 12→11, 13→9, 14→12, 15→10. Dẫn chiếu trong DESIGN (#4→#3, #5→#4) đã cập nhật.
