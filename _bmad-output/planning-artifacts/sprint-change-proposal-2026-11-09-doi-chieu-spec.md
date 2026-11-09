---
title: 'Sprint Change Proposal: đối chiếu spec sau Epic 2 (E2-4)'
date: '2026-11-09'
author: 'Mason (duyệt) · Developer agent (soạn)'
status: 'approved'
scope: 'moderate'
trigger_story: 'retro Epic 2, action item E2-4'
---

# Sprint Change Proposal: đối chiếu spec sau Epic 2 (E2-4)

## 1. Tóm tắt vấn đề

**Nguồn:** action item E2-4 của retro Epic 2 (`implementation-artifacts/epic-2-retro-2026-11-09.md`, mục Action item 4; phát hiện E1–E5, B1, C8, D1). Phải xong trước Story Epic 3 đầu tiên.

**Phân loại:** tài liệu kế hoạch lệch với quyết định đã chốt (Architecture 28/10, các sprint change proposal 30/10 và 03/11) và lệch với code đã ship ở Epic 2. Không có thay đổi code.

**Bằng chứng:**

- **E4. PRD vẫn mô tả thanh toán bằng QR động/tĩnh và Deep Link.** Từ 28/10, AD-6 đã chuyển sang Tingee Payment Gateway, mở bằng redirect toàn trang. Danh sách "Cập nhật tài liệu nguồn" của spine (`ARCHITECTURE-SPINE.md`, cuối mục Open Questions) chưa làm, gồm cả phần PRD lẫn phần UX. Epic 3 là epic checkout, nên PRD và UX phải khớp trước khi viết spec 3.4 và 3.7. Frontmatter `updated` của PRD, EXPERIENCE và DESIGN vẫn là 2026-10-27.
- **E2. `epics.md` lệch với code:**
  - 2.14 ghi `flows.transferOwnership`, nhưng code là `MembersService.transferOwnership`. Chỉ ghi bảng `members` của `organizer`, nên đúng AD-25 là không qua `flows`.
  - `ordering.sellability` ghi ở 2.10, nhưng làm ở 2.11-a.
  - 2.13 đã tách thành 2.13-a và 2.13-b.
- **C8.** Spec 2.11-a ghi thứ tự `hidden > ended`, còn code dùng `ended > hidden` (`sellability.ts:42-49`). Story 2.12 đã đổi thứ tự này.
- **B1.** AC 2.13 nói key cũ bị thu hồi không được chặn BTC bán bằng key mới. AD-32 và Story 4.2 lại bật "Tạm ngừng bán" khi bất kỳ lời gọi nào "bằng key của BTC" trả `TINGEE_CREDENTIAL_INVALID`. AC "Đối soát bù bằng key cũ" của 2.13 bị đẩy sang Epic 3/4 (`spec-2-13-b:35`), nhưng chưa story nào nhận.
- **E1.** Năm AC của Epic 2 chưa làm, vẫn nằm trong Epic 2 và chưa có story theo dõi:
  - `ADMIN_ALLOWED_CIDRS` (2.5);
  - "Đặt lại TOTP" (2.5);
  - ảnh Sự kiện trên S3 của 2.7-b (vì vậy ảnh OG của 2.11 đang là nền gradient);
  - "trường bổ sung" của FR-9;
  - đo NFR-1 trên 4G (2.11).
- **D1.** `ARCHITECTURE-SPINE.md:41` ghi admin "ghi qua `flows`", trái AD-25. Thực tế admin gọi service công khai của `organizer`.
- **E5.** `spec-2-2-totp-cho-owner.md` chưa có `superseded_by`.

**Quyết định của Mason (09/11/2026):**

- **Q1 (E1):** chuyển từng AC sang epic sẽ làm nó, không mở lại Epic 2.
  - `ADMIN_ALLOWED_CIDRS` và trusted proxy → Story 4.7.
  - Đặt lại TOTP → Story 7.7 (mới).
  - Ảnh S3 và OG đúng ảnh → Story 4.8 (mới).
  - Đo NFR-1 trên 4G → Story 5.8.
  - Trường dựng sẵn của FR-9 → ngoài phạm vi MVP.
- **Q2:** duyệt theo batch.

## 2. Phân tích tác động (kết quả checklist)

| Mục | Trạng thái | Ghi chú |
|---|---|---|
| 1.1 Story kích hoạt | [x] | Retro Epic 2, E2-4 (E1–E5, B1, C8, D1) |
| 1.2 Loại vấn đề | [x] | Tài liệu lệch quyết định đã chốt và lệch code; một thay đổi phạm vi nhỏ (FR-9) |
| 1.3 Bằng chứng | [x] | §1, dẫn file:dòng theo retro |
| 2.1 Epic hiện tại | [x] | Epic 2 vẫn `done`. AC chưa làm được chuyển đi, không mở lại epic |
| 2.2 Thay đổi cấp epic | [x] | Không thêm hay bỏ epic. Sửa mô tả Epic 4 và Epic 7 |
| 2.3 Epic tương lai | [!] | Epic 3: 3.4 thêm AC credential hiện hành. Epic 4: 4.1 thêm AC key cũ, 4.2 sửa điều kiện bật cờ, 4.7 thêm AC giới hạn IP, thêm 4.8. Epic 5: 5.8 thêm đo 4G. Epic 7: thêm 7.7 |
| 2.4 Epic lỗi thời / mới | [N/A] | Không |
| 2.5 Thứ tự epic | [N/A] | Giữ nguyên. 4.8 và 7.7 vẫn trước Closed Beta |
| 3.1 PRD | [!] | §1, UJ-1, UJ-2, §3, FR-1, FR-8, FR-9, FR-11, §4.4, FR-14–FR-17, FR-19–FR-22, NFR-1, §6, §7, §9, §11, SM-2, §13 |
| 3.2 Architecture | [!] | Bảng mô-đun (`admin`, dòng 41), AD-32, frontmatter `sources`, danh sách "Cập nhật tài liệu nguồn" |
| 3.3 UX | [!] | EXPERIENCE.md và DESIGN.md: bỏ `payment-qr-card`, QR tĩnh và Deep Link; thêm màn thanh toán redirect và màn `/orders/:code`. Mockup HTML không sửa, chỉ ghi chú là đã cũ |
| 3.4 Artifact khác | [!] | Spec 2.11-a (Spec Change Log), spec 2.2 cũ (`superseded_by`), `sprint-status.yaml`. Code, env và CI không đổi |
| 4.1 Sửa trực tiếp | Viable | Effort trung bình (nhiều tài liệu), rủi ro thấp: chỉ sửa tài liệu |
| 4.2 Rollback | Not viable | Không có code cần lùi |
| 4.3 Xem lại MVP | Viable một phần | Chỉ bỏ trường dựng sẵn của FR-9 khỏi MVP (Mason đã bỏ ở 2.9 ngày 05/11) |
| 4.4 Chọn hướng | [x] | Hybrid: sửa trực tiếp, cộng thu hẹp FR-9 |

## 3. Hướng đi đề xuất

**Chọn: sửa trực tiếp tài liệu**, cộng một thay đổi phạm vi nhỏ ở FR-9.

- PRD và UX được viết lại theo Gateway, khớp AD-4, AD-6, AD-7, AD-29 và AD-32. Spec của Epic 3 sẽ đọc thẳng từ đây.
- `epics.md` khớp code của Epic 2. Mỗi AC chưa làm có đúng một story nhận.
- AD-32 chỉ bật "Tạm ngừng bán" khi lời gọi bằng **credential hiện hành** trả `TINGEE_CREDENTIAL_INVALID`. Lời gọi bằng credential cũ (Đơn tạo trước khi đổi key) chỉ làm Đơn đó hết hạn và cảnh báo vận hành. Cách này giữ đúng AC của 2.13.

**Rủi ro:**

- Thấp: chỉ đổi tài liệu, không đổi code.
- Trung bình: phần UX viết lại màn thanh toán dựa trên UX-DR16/17 của `epics.md` và `reviews/reconcile-ux.md`, chưa có mockup mới. Mockup `directions-2.html` (phần QR) và `key-success-ticket.html` (mục 2) không còn đúng. EXPERIENCE.md đã ghi "spine thắng khi mâu thuẫn với mock".
- Các câu hỏi còn mở với Tingee vẫn mở: trang Gateway hiển thị tên ai, tra trạng thái theo `orderId`, gọi lại `create-link`. Tài liệu ghi rõ chỗ nào phụ thuộc các câu hỏi này.

## 4. Chi tiết đề xuất sửa

### 4.1 PRD (`prds/prd-tickee-2026-10-27/prd.md`)

Frontmatter: `updated: 2026-11-09`.

**§1 Vision:**
- CŨ: `Người mua quét VietQR là nhận Vé ngay.`
- MỚI: `Người mua trả tiền trên trang thanh toán của Tingee là nhận Vé ngay.`

**UJ-1:**
- Bước 4:
  - CŨ: `Màn hình hiện QR thanh toán đúng số tiền, đếm ngược 15 phút. Minh quét QR hoặc bấm mở app ngân hàng để chuyển khoản.`
  - MỚI: `Màn thanh toán hiện số tiền của Đơn, BTC nhận tiền và đếm ngược 15 phút. Minh bấm "Thanh toán", được chuyển sang trang thanh toán của Tingee, trả tiền ở đó rồi quay lại Tickee.`
- Cao trào:
  - CŨ: `Màn hình tự chuyển sang "Thành công"`
  - MỚI: `Trang Đơn trên Tickee tự chuyển sang "Thành công"` (phần sau giữ nguyên).
- Tình huống lỗi 1:
  - CŨ: `…khi QR thanh toán hết hạn`
  - MỚI: `…khi link thanh toán hết hạn` (phần sau giữ nguyên).
- Tình huống lỗi 2:
  - CŨ: `Minh chuyển thiếu tiền hoặc ghi sai nội dung chuyển khoản.`
  - MỚI: `Tingee báo số tiền nhận được khác số tiền của Đơn.`

**UJ-2:**
- Bước 4: bỏ `và các trường bổ sung`.
- Tình huống lỗi:
  - CŨ: `Một Người mua chuyển thiếu tiền.`
  - MỚI: `Tingee báo một Đơn nhận thiếu tiền.`

**§3 Glossary:**
- **Tingee:** `Hạ tầng thanh toán và đối soát QR` → `Hạ tầng thanh toán (cổng thanh toán Payment Gateway) và đối soát`.
- **Sự kiện miễn phí:** `Không tạo QR thanh toán` → `Không tạo link thanh toán`.
- **Đơn:**
  - CŨ: `Mỗi Đơn có một QR thanh toán và một mã Đơn, mã này cũng là billId trên Tingee.`
  - MỚI: `Mỗi Đơn có một mã Đơn. Với Đơn có phí, mã Đơn là orderId gửi cổng thanh toán Tingee, không phải billId. Mỗi Đơn có phí trả tiền qua một link thanh toán.`
- **Mã QR vé:** `Đây không phải QR thanh toán.` → `Mã này chỉ dùng để check-in, không dùng để thanh toán.`
- **QR thanh toán:** thay cả mục (gồm QR động và QR tĩnh) bằng mục **Link thanh toán**: `Link tới trang thanh toán của Tingee Payment Gateway, tạo riêng cho từng Đơn có phí, đúng số tiền của Đơn, hết hạn sau 15 phút. Người mua được chuyển hẳn sang trang này (redirect toàn trang), trả tiền ở đó rồi quay về trang Đơn của Tickee. Tickee không tự hiển thị mã QR thanh toán, không dùng QR tĩnh hay Deep Link.`
- **Giữ chỗ:**
  - CŨ: `…kéo dài đúng thời hạn QR thanh toán (15 phút).`
  - MỚI: `…kéo dài theo thời hạn link thanh toán (15 phút). Chỗ chỉ được trả lại khi Tingee xác nhận Đơn chưa được trả, hoặc khi quá hạn mà vẫn không có xác nhận (FR-14).`
- **Đối soát bù:** `trạng thái QR thanh toán` → `trạng thái thanh toán của Đơn trên cổng thanh toán`.
- **Token khả dụng:**
  - CŨ: `Số dư Token cộng hạn mức âm (hoặc hạn mức trả sau), trừ đi số Đơn đang Chờ thanh toán (cả QR động lẫn QR tĩnh) nhân với mức trừ mỗi giao dịch.`
  - MỚI: `Số dư Token cộng hạn mức âm (hoặc hạn mức trả sau), do Tingee báo. Tickee không tự trừ trước cho Đơn đang Chờ thanh toán; khi BTC chạm hạn mức, Tingee ngắt dịch vụ và Tickee phát hiện qua lần tạo link bị từ chối (FR-15).`
- **Cần xử lý:**
  - CŨ: ba loại, có cụm `với cả QR động lẫn QR tĩnh`.
  - MỚI: năm loại, khớp AD-7 và Story 4.3:
    - "Lệch số tiền";
    - "Thanh toán mồ côi";
    - "Giao dịch chưa khớp" (tiền về với mã Đơn không tồn tại);
    - "Thanh toán trùng" (tiền về cho Đơn đã thanh toán, đã hủy hoặc đã hoàn);
    - "Sự kiện đã hủy" (tiền về sau khi Sự kiện bị hủy).
- **Bảng trạng thái Đơn:**
  - Chờ thanh toán: `Đang Giữ chỗ, QR thanh toán còn hiệu lực` → `Đang Giữ chỗ, chờ Người mua trả tiền qua link thanh toán`.
  - Hết hạn: `QR thanh toán hết hạn khi chưa trả tiền` → `Tingee xác nhận Đơn chưa được trả, hoặc quá hạn link mà không có xác nhận`.
  - Cần xử lý: liệt kê năm loại như trên.
- **Trạng thái Sự kiện, câu "Tạm ngừng bán":**
  - CŨ: `…không tạo được QR thanh toán, vì Token khả dụng không đủ (FR-15) hoặc…`
  - MỚI: `…không bán được Vé có phí, vì Tingee đang ngắt dịch vụ thanh toán của BTC hoặc key Tingee của BTC không còn dùng được (FR-15), hoặc…`

**FR-1 (phát hiện thêm khi đối chiếu, ngoài danh sách E2-4):** danh sách thao tác nhạy cảm thêm `bật 2FA`, cho khớp AD-26 sau E2-1.

**FR-8:** thêm hệ quả `Giá Hạng vé có phí tối thiểu 2.000đ, kiểm khi lưu Hạng vé (AD-6).`

**FR-9:**
- Bỏ gạch đầu dòng `Các trường bổ sung khác.`
- Thêm: `**Ngoài phạm vi MVP:** trường dựng sẵn khác (vd. Ngày sinh, CCCD, Size áo). Mỗi trường cần định dạng và cách xử lý dữ liệu cá nhân riêng. Câu hỏi riêng của BTC đủ cho MVP (Mason chốt 05/11/2026 ở Story 2.9, xác nhận 09/11/2026).`

**FR-11:** `Không tạo QR thanh toán` → `Không tạo link thanh toán`.

**§4.4 Mô tả:**
- CŨ: `…điền form và nhận QR thanh toán.`
- MỚI: `…điền form rồi được chuyển sang trang thanh toán của Tingee.`

**FR-14 (viết lại, theo AD-4):**
- Câu chính: `Khi Đơn có phí được tạo, hệ thống Giữ chỗ và hiện đồng hồ đếm ngược theo hạn link thanh toán (15 phút).`
- Hệ quả:
  - `Chỗ được trả lại và Đơn chuyển "Hết hạn" khi gặp điều kiện đầu tiên trong ba điều kiện:`
    - `chưa tạo được link thanh toán sau 60 giây;`
    - `Tingee xác nhận Đơn chưa được trả;`
    - `quá hạn link 5 phút mà vẫn chưa có xác nhận.`
  - `Màn hình báo hết hạn và mời Người mua tạo Đơn mới.`
  - `Đồng hồ về 0 mà chưa có xác nhận thì màn hình hiện "Đang xác nhận thanh toán", chưa báo hết hạn.`
  - Giữ: `Chỗ đã trả lại được người khác mua ngay.`
  - Giữ quy tắc tiền về muộn, bỏ cụm `áp dụng cho cả QR động lẫn QR tĩnh`.
  - Bỏ `Với QR tĩnh: xem FR-17.`

**FR-15 (viết lại, theo AD-32):**
- Tiêu đề: `Tạm ngừng bán khi dịch vụ thanh toán của BTC bị ngắt`.
- Câu chính: `Tickee không tự tính Token trước khi tạo link. Khi Tingee ngắt dịch vụ của BTC (vd. vượt hạn mức Token), hoặc key Tingee hiện hành của BTC không còn dùng được, lần tạo link bị từ chối và hệ thống đánh dấu dịch vụ thanh toán của BTC là tạm ngừng.`
- Hệ quả:
  - `Đơn đang tạo link bị từ chối thì hết hạn, chỗ được trả lại, Người mua thấy "Sự kiện tạm ngừng bán".`
  - `Mọi Sự kiện có phí của BTC hiện "Tạm ngừng bán" cho tới khi dịch vụ mở lại. Hệ thống tự kiểm tra lại định kỳ; Owner bấm "Kiểm tra lại" hoặc lưu key mới được.`
  - `Dịch vụ mở lại thì hệ thống Đối soát bù mọi Đơn còn mở của BTC (FR-20).`
  - Giữ: `Sự kiện miễn phí không bị ảnh hưởng.`

**FR-16 (viết lại, theo AD-6):**
- Tiêu đề: `Thanh toán qua cổng thanh toán Tingee`.
- Câu chính: `Người mua thấy màn thanh toán của Tickee với số tiền, đếm ngược và BTC nhận tiền, rồi bấm "Thanh toán" để chuyển sang trang thanh toán của Tingee (redirect toàn trang, không popup). Trả tiền xong, Tingee đưa Người mua về trang Đơn của Tickee.`
- Hệ quả:
  - `Link đúng số tiền của Đơn, tiền vào tài khoản nhận tiền mặc định của BTC lúc tạo link, hết hạn sau 15 phút.`
  - `Link tạo xong dưới 2 giây (NFR-1).`
  - Giữ: `Trang thanh toán ghi rõ "Tiền chuyển thẳng cho [tên BTC]" và hiện chính sách hoàn vé của BTC.`
  - `Tingee báo lỗi rõ ràng khi tạo link thì Người mua thử lại được cho cùng Đơn trong 60 giây. Hết thời gian hoặc kết quả không rõ thì Đơn hết hạn, Người mua tạo Đơn mới.`
  - `Trang Đơn luôn lấy trạng thái từ Tickee, không tin tham số trên link quay về.`
  - `Tickee không tự hiển thị mã QR thanh toán, không dùng QR tĩnh, không mở thẳng app ngân hàng (Deep Link).`

**FR-17:**
- Tiêu đề: `~~Thanh toán bằng QR tĩnh~~ (bỏ)`.
- Nội dung: `Mọi thanh toán đi qua cổng thanh toán (FR-16, AD-6). Cổng tự khớp giao dịch với Đơn, nên Tickee không đối soát theo nội dung chuyển khoản và không có QR tĩnh. Giữ mã FR-17 để truy vết.`

**FR-19:** `khớp billId và số tiền` → `khớp mã Đơn và số tiền`.

**FR-20:**
- `trạng thái các QR thanh toán còn mở` → `trạng thái thanh toán của các Đơn còn mở`.
- `mọi QR thanh toán đã mở trong thời gian bị ngắt` → `mọi Đơn còn mở của BTC`.

**FR-21:**
- Câu chính: năm loại như ở Glossary. Bỏ `(sai nội dung chuyển khoản khi dùng QR tĩnh)`.
- Ghép tay:
  - CŨ: `vào một Đơn đang chờ`
  - MỚI: `vào một Đơn đã hết hạn hoặc đang Cần xử lý của cùng BTC, cùng số tiền` (khớp Story 4.4).
- Thêm hệ quả: `"Thanh toán trùng" và "Giao dịch chưa khớp" không ghép được thì chỉ đánh dấu "Đã hoàn tay" hoặc bỏ qua (kèm lý do), không phát Vé.`

**FR-22 (theo AD-29):** thêm hệ quả `Link Vé chứa mã ngẫu nhiên, không đoán được. Chủ Vé tạo lại link được; link cũ mất hiệu lực. Người mở link không cần đăng nhập, chỉ thấy Vé đó (Mã QR vé, Sự kiện, Hạng vé, số thứ tự Vé, trạng thái), không thấy SĐT, email hay tên Người mua. Vé đã hủy, quá mốc kết thúc hoặc link sai đều báo "không tìm thấy" như nhau.`

**NFR-1:** `Tạo QR thanh toán dưới 2 giây` → `Tạo link thanh toán dưới 2 giây`.

**§6 Tích hợp:**
- Thêm dòng `Tingee: Payment Gateway | Tạo link thanh toán cho từng Đơn (FR-16), tra trạng thái theo mã Đơn (FR-20) | Có. Tên API tra trạng thái theo orderId đang chờ Tingee xác nhận`.
- Bỏ dòng `Tingee: Deep Link`.
- Dòng Token: `(FR-15, FR-34)` → `(FR-34); trạng thái dịch vụ (FR-15)`.

**§7:**
- `gồm cả QR tĩnh, giao dịch lệch tiền…` → `gồm cả giao dịch lệch tiền…`.
- CŨ: `Tickee ngừng tạo QR trước thời điểm đó (FR-15).`
- MỚI: `Tickee phát hiện việc này khi tạo link bị từ chối, rồi chuyển các Sự kiện có phí sang "Tạm ngừng bán" (FR-15).`

**§9 Rủi ro:**
- R-3:
  - Mô tả: `khi còn QR thanh toán đang mở` → `khi còn Đơn đang chờ thanh toán`.
  - Giảm thiểu: `Tạm ngừng bán ngay khi phát hiện (FR-15), cảnh báo Token sớm (FR-34), hạn mức âm hoặc trả sau, Đối soát bù khi mở lại (FR-20)`.
- R-4 (QR tĩnh): gạch, ghi `Bỏ 09/11/2026: không còn QR tĩnh (FR-17)`.
- R-9: `FR-15 và FR-34 phải thiết kế lại` → `FR-34 và việc tự mở lại ở FR-15 phải thiết kế lại`.

**§11.1:** `thanh toán bằng QR động hoặc QR tĩnh` → `thanh toán qua cổng thanh toán Tingee (redirect)`.

**§11.2:** thêm `Trường dựng sẵn trong form mua vé ngoài Tên, SĐT, email (vd. Ngày sinh, CCCD, Size áo) (FR-9).`

**§11.3:** thêm dòng `QR động, QR tĩnh do Tickee hiển thị; Deep Link mở app ngân hàng | Thanh toán qua Tingee Payment Gateway, redirect toàn trang | Gateway tự khớp giao dịch với Đơn, bỏ đối soát theo nội dung chuyển khoản (Architecture AD-6, 28/10/2026)`.

**§11.4 Phase 1:**
- `QR thanh toán` → `link thanh toán Gateway`.
- `mua Vé bằng QR động thành công` → `mua Vé qua Gateway thành công`.

**§12 SM-2:**
- CŨ: `Mục tiêu ≥ 95% với QR động và ≥ 80% với QR tĩnh. Kiểm chứng FR-17, FR-19.`
- MỚI: `Mục tiêu ≥ 95%. Kiểm chứng FR-16, FR-19.`

**§13 Câu hỏi mở #1:** thêm `Không còn áp dụng từ 03/11/2026: không dùng QR tĩnh (AD-6).`

### 4.2 Epics (`epics.md`)

**Overview, đoạn "Thứ tự hiệu lực":** thêm câu `Từ 09/11/2026, PRD và UX đã được cập nhật theo các điểm này (Sprint Change Proposal 09/11/2026, E2-4).`

**Inventory:**
- FR-9: `và trường bổ sung` → `(trường dựng sẵn khác: ngoài phạm vi MVP)`.
- NFR-1: `Tạo link/QR thanh toán` → `Tạo link thanh toán`.

**FR Coverage Map:**
- FR-1: thêm `; Đặt lại TOTP ở E7 (Story 7.7)`.
- FR-4: thêm `; giới hạn IP /admin ở Story 4.7`.
- FR-7: thêm `; ảnh Sự kiện ở Story 4.8`.
- FR-9: thêm `; trường dựng sẵn ngoài MVP`.
- FR-10: thêm `; OG đúng ảnh ở Story 4.8, đo 4G ở Story 5.8`.

**Epic List:**
- Epic 4: thêm `ảnh Sự kiện trên object storage; giới hạn IP cho /admin` vào mô tả và FRs covered (FR-7, FR-10 một phần).
- Epic 7: thêm `Quản trị Tingee đặt lại TOTP` và FR-1 (một phần).

**Story 2.5:**
- AC đầu:
  - CŨ: `API chỉ nhận request từ dải IP cho phép (cấu hình trusted proxy để lấy đúng IP) và yêu cầu step-up…`
  - MỚI: `API yêu cầu step-up…`
- Bỏ AC `dải IP cho phép đọc từ biến env ADMIN_ALLOWED_CIDRS…`.
- Bỏ khối AC "Đặt lại TOTP".
- Thêm ghi chú: `*(E2-4, 09/11/2026: giới hạn dải IP ADMIN_ALLOWED_CIDRS và trusted proxy chuyển sang Story 4.7; "Đặt lại TOTP" chuyển sang Story 7.7.)*`

**Story 2.7:**
- AC 1: `…mô tả, ảnh và chính sách hoàn vé` → `…mô tả và chính sách hoàn vé`.
- Bỏ AC upload S3.
- `event-card (thumbnail, …)` → `event-card (tên, …; thumbnail có từ Story 4.8)`.
- Thêm ghi chú: `*(E2-4: ảnh Sự kiện, tách thành 2.7-b khi build, chuyển sang Story 4.8.)*`

**Story 2.10:** bỏ khối AC `ordering.sellability`. Thêm ghi chú `*(ordering.sellability làm ở Story 2.11, spec 2.11-a.)*`

**Story 2.11:**
- Thêm khối AC `sellability` ở đầu, khớp code:
  - **Given** `ordering.sellability` (spec 2.11-a);
  - **Then** trả trạng thái theo từng Hạng vé (`on_sale`, `not_started`, `closed`, `sold_out`, `paused`, `unavailable`, kèm số còn lại) và một `eventReason`.
  - Thứ tự ưu tiên của `eventReason`: Đã hủy > Bị khóa > Đã kết thúc > Ẩn > Tạm ngừng bán.
  - Các điều kiện xét giữ như AD-21, trừ giới hạn Vé/Đơn: phần này kiểm lúc tạo Đơn (Story 3.2).
  - `payment_service_status` là stub `active` tới Epic 4.
  - Dùng chung luật với `publishReadiness`.
  - Closed Beta bị thu hồi làm Hạng vé có phí "Tạm ngừng bán".
- `trang tải dưới 2 giây trên 4G (FR-10, NFR-1, AD-37)` → `mục tiêu tải dưới 2 giây trên 4G (FR-10, NFR-1, AD-37; đo ở Story 5.8)`.
- OG: `preview hiện đúng ảnh, tên và thời gian` → `preview hiện đúng tên và thời gian; ảnh OG do apps/web sinh, dùng nền gradient tới khi có ảnh Sự kiện (Story 4.8)`.

**Story 2.13:**
- Thêm câu đầu AC: `*Làm thành hai spec: 2.13-a (xác nhận lại và email cho "Đặt làm mặc định" / "Hủy liên kết") và 2.13-b (Đổi key Tingee).*`
- Gắn nhãn `(2.13-a)` / `(2.13-b)` cho từng khối AC.
- Thay khối AC "key cũ bị thu hồi" bằng ghi chú `*(E2-4: Đối soát bù bằng key cũ chuyển sang Story 4.1; link luôn ký bằng credential hiện hành ghi ở Story 3.4; điều kiện bật "Tạm ngừng bán" ở Story 4.2/AD-32.)*`

**Story 2.14:**
- CŨ: `gọi flows.transferOwnership(orgId, toUserId)`
- MỚI: `gọi MembersService.transferOwnership của organizer (chỉ ghi bảng members của một mô-đun nên không qua flows, AD-25)`.
- CŨ: `trong một transaction: Owner cũ → admin, Admin được chọn → owner; … (đổi thứ tự cập nhật hoặc dùng ràng buộc deferrable)`
- MỚI: `trong một transaction, dưới khóa BTC và sau khi kiểm lại vai trò: Owner cũ → admin trước, rồi Admin được chọn → owner; …`

**Story 3.4:** thêm AC:

> **Given** BTC đã đổi key Tingee hoặc đổi tài khoản mặc định (Story 2.13)
> **When** tạo link cho Đơn mới
> **Then** link luôn ký bằng credential hiện hành, vì tài khoản mặc định luôn thuộc credential hiện hành: đổi key gỡ mọi tài khoản của credential cũ. Đơn đã có link giữ `orders.payout_account_id` đã chụp, nên IPN (Story 3.5) và Đối soát bù (Story 4.1) của Đơn đó vẫn dùng credential cũ (AD-35)

**Story 4.1:** thêm AC (chuyển từ 2.13):

> **Given** BTC đã thu hồi key cũ trên Tingee, và còn Đơn `pending` có link tạo bằng key đó
> **When** Đối soát bù gọi Tingee bằng credential đã chụp và nhận `TINGEE_CREDENTIAL_INVALID`
> **Then** job dừng tra Đơn đó và cảnh báo vận hành kèm mã Đơn (Story 4.6). Đơn hết hạn theo trần cứng AD-4 (c). Không bật `payment_service_status`, vì lời gọi không dùng credential hiện hành (AD-32), nên BTC vẫn bán bằng key mới. IPN đã ký bằng secret cũ vẫn kiểm được (Story 3.5)

**Story 4.2, AC đầu:**
- CŨ: `hoặc một lời gọi bằng key của BTC trả TINGEE_CREDENTIAL_INVALID`
- MỚI: `hoặc một lời gọi bằng credential hiện hành của BTC trả TINGEE_CREDENTIAL_INVALID (lời gọi bằng credential cũ không bật cờ, xem Story 4.1)`.

**Story 4.7:** thêm AC (chuyển từ 2.5):

> **Given** `/v1/admin/*` trên staging và production
> **When** api khởi động và nhận request
> **Then** chỉ nhận request từ dải IP trong env `ADMIN_ALLOWED_CIDRS`, kiểm bằng schema Zod khi khởi động; thiếu hoặc sai định dạng ở production thì api không khởi động. IP client lấy qua trusted proxy (`TRUST_PROXY_HOPS` đúng số proxy thật trước api); có test (FR-4, AD-26)

**Story 4.8 (mới): Ảnh Sự kiện trên object storage**

As a Owner hoặc Admin,
I want tải ảnh bìa cho Sự kiện,
So that trang Sự kiện và preview khi chia sẻ lên Zalo/Facebook hiện đúng ảnh của giải.

AC (gộp AC ảnh của 2.7, AC OG của 2.11 và mục 2.7-b trong `deferred-work.md`):

- Hạ tầng (AD-22):
  - object storage tương thích S3 (MinIO trong docker-compose ở local);
  - biến `S3_*` kiểm bằng Zod;
  - `@aws-sdk/client-s3` cùng presigner;
  - bucket ảnh bật CORS `GET` cho origin web;
  - không dùng dịch vụ độc quyền của cloud nào.
- Wizard bước 1 và Cài đặt Sự kiện:
  - API cấp presigned PUT (JPEG/PNG/WebP ≤ 5 MB, key `orgs/{orgId}/events/{uuid}.{ext}`);
  - web upload thẳng lên object storage;
  - lưu Sự kiện chỉ nhận key đúng tiền tố BTC; lưu vào `events.image_key`; audit ghi lại (FR-7, AD-13, AD-22);
  - sai định dạng hoặc quá dung lượng → lỗi tại chỗ; upload lỗi → giữ dữ liệu đã nhập, kèm "Thử lại".
- Hiển thị: Sự kiện có ảnh thì `event-card` có thumbnail và `event-hero` dùng ảnh thay nền gradient (UX-DR7, UX-DR10).
- OG: ảnh OG do `apps/web` sinh, dùng ảnh Sự kiện; không có ảnh thì giữ nền gradient (FR-10, AD-11).
- Story 8.1 dùng lại ảnh này.

**Story 5.8:** thêm AC (chuyển từ 2.11):

> **And** đo thời gian tải `/e/{slug}` với mạng 4G giả lập (throttling) trên cấu hình thiết bị di động tầm trung, mục tiêu dưới 2 giây; kết quả ghi trong cùng báo cáo (FR-10, NFR-1)

**Story 7.7 (mới): Quản trị Tingee đặt lại TOTP**

As a Quản trị Tingee,
I want đặt lại xác thực hai lớp cho người dùng mất cả thiết bị TOTP lẫn mã khôi phục,
So that họ lấy lại được tài khoản mà không phải tạo tài khoản mới.

AC (chuyển từ 2.5; gộp hai mục "Đặt lại TOTP" trong `deferred-work.md`):

- Quản trị Tingee đã step-up có thao tác "Đặt lại TOTP" cho một user ở `/admin`:
  - tìm user theo email;
  - lý do bắt buộc;
  - xác nhận qua `Dialog` nêu hậu quả (UX-DR44);
  - user chưa bật 2FA thì không có thao tác này.
- Khi thực hiện, trong một transaction:
  - xóa TOTP và mã khôi phục;
  - hủy mọi session của user;
  - đưa 2FA về trạng thái chưa bật;
  - ghi audit (người làm, user, lý do), không ghi giá trị cá nhân (FR-1, AD-18, AD-26).
- Email báo cho user và Owner/Admin của các BTC user thuộc.
- Quy trình hỗ trợ (cách Tingee xác minh người yêu cầu) ghi ở `docs/` trước Closed Beta.

### 4.3 Architecture (`ARCHITECTURE-SPINE.md`)

- **Frontmatter:**
  - `updated: '2026-11-09'`;
  - `sources`: bỏ `(nhánh docs/ux-tickee-mvp, commit 1bec95c, chưa merge vào main)` ở DESIGN.md và EXPERIENCE.md, vì commit này đã nằm trong `main`.
- **Bảng mô-đun, dòng `admin`:**
  - CŨ: `Báo cáo vi phạm; endpoint của Quản trị Tingee (ghi qua flows)`
  - MỚI: `Báo cáo vi phạm; endpoint của Quản trị Tingee. Ghi dữ liệu của mô-đun khác bằng service công khai của mô-đun đó (vd. Closed Beta qua organizer); chỉ luồng ghi từ hai mô-đun trở lên mới qua flows (AD-25: lockEvent/lockOrganization, voidTickets)`
- **AD-32, Rule:**
  - CŨ: `bật với reason credential_invalid khi lời gọi bằng key của BTC trả TINGEE_CREDENTIAL_INVALID.`
  - MỚI: `bật với reason credential_invalid khi lời gọi bằng credential hiện hành của BTC trả TINGEE_CREDENTIAL_INVALID. Lời gọi bằng credential cũ, tức tra trạng thái hoặc Đối soát bù cho Đơn có link tạo trước khi đổi key (AD-35), trả mã này thì không bật cờ: Đơn đó hết hạn theo AD-4 (c) và vận hành được cảnh báo.`
- **Open Questions, mục "Cập nhật tài liệu nguồn":** đánh dấu đã làm (09/11/2026, đề xuất này). Danh sách cũ giữ lại để truy vết.

### 4.4 UX (`ux-designs/ux-tickee-2026-10-27/`)

Frontmatter của cả hai file: `updated: 2026-11-09`. Mockup HTML không sửa.

**EXPERIENCE.md:**

| Chỗ | Đổi |
|---|---|
| Đầu file, sau đoạn mở | Thêm ghi chú: từ 09/11/2026 thanh toán theo Gateway (AD-6). Phần QR của `mockups/directions-2.html` và mục 2 của `key-success-ticket.html` là mock cũ |
| Foundation: hành trình Người mua; rủi ro UX ưu tiên | `Checkout → QR thanh toán → …` → `Checkout → Thanh toán (redirect sang Tingee) → Trang Đơn → …`. "bỏ ngang ở QR thanh toán" → "bỏ ngang ở bước thanh toán" |
| IA Công khai: các hàng QR thanh toán, Thành công, Hết hạn | "QR thanh toán" thành **Thanh toán** (`/orders/{code}` trước khi sang Gateway). Thêm **Trang Đơn** (`/orders/{code}`, `returnUrl` của Gateway: Đang chờ, Đang xác nhận, Thành công, Hết hạn, BTC đang kiểm tra). "Thành công" đến từ trạng thái máy chủ. "Hết hạn" chỉ hiện khi máy chủ trả `expired` |
| IA Dashboard, tab Form mua | Bỏ "trường bổ sung" |
| IA Dashboard, Cài đặt BTC | Thêm "kênh liên hệ (SĐT, email) hiện cho Người mua" |
| Voice and Tone | "QR thanh toán" trong danh sách thuật ngữ → "link thanh toán". Ví dụ mã Đơn `TK8F3Q2A` → `TK8F3Q2AXM` (AD-20). Thêm cặp "Đang xác nhận thanh toán…" / "Đang đợi IPN" |
| Component Patterns, dòng minh họa | Bỏ `payment-qr-card` khỏi danh sách minh họa |
| `button-secondary` | Bỏ ví dụ "Tải ảnh QR" |
| `stage-block` | "Hero, QR, stat-card" → "Hero, màn Thanh toán, stat-card" |
| Bảng Thanh toán & Vé | Bỏ `payment-qr-card`, thêm `payment-summary`: stage chứa số tiền, `countdown-chip`, mã Đơn; nút chính "Thanh toán" redirect toàn trang; không popup, không Deep Link, không có nút "Tôi đã chuyển khoản". `countdown-chip`: về 0 thì hiện "Đang xác nhận thanh toán", không tự chuyển Hết hạn. `recipient-trust-block`: hiện trên màn Thanh toán, tên chủ tài khoản và ngân hàng lấy từ tài khoản nhận tiền của Đơn (khớp với trang Gateway hay không là câu hỏi mở với Tingee). `reassurance-line`: trên Trang Đơn. `order-card`: "Tiếp tục thanh toán" mở lại link Gateway của Đơn đó; về 0 thì "Đang xác nhận", chỉ rời nhóm chờ khi máy chủ báo |
| `needs-action-row` | Thao tác theo loại, khớp Story 4.4 |
| `wizard-stepper` | Điều kiện "Token" → điều kiện theo `publishReadiness` (Closed Beta, tài khoản nhận tiền, giá ≥ 2.000đ, chính sách hoàn vé) |
| State Patterns › Trang Sự kiện & mua vé | Hàng "Token khả dụng không đủ" → "Dịch vụ thanh toán của BTC đang tạm ngừng". Gửi Đơn lỗi → "chuyển tới màn Thanh toán của Đơn đó". Hàng "Không tạo được QR" → "Chưa tạo được link thanh toán" + "Thử lại" cho cùng Đơn trong 60 giây; timeout → Hết hạn, mua lại |
| Nhóm "QR thanh toán & sau thanh toán" | Viết lại thành "Thanh toán & Trang Đơn": Sẵn sàng thanh toán, Đang chuyển sang Tingee, Quay về từ Tingee / quay lại tab, Đang chờ, Đang xác nhận (đồng hồ về 0), Chờ lâu, Mất mạng, Thành công, Hết hạn (chỉ khi máy chủ báo), BTC đang kiểm tra, Sự kiện đã hủy. Bỏ trạng thái "QR tĩnh". Sự kiện miễn phí: bỏ "không có QR", giữ "không qua thanh toán" |
| Vé của tôi | "Tiếp tục thanh toán → QR thanh toán" → "→ màn Thanh toán của cùng Đơn". Liên hệ BTC dùng kênh liên hệ của BTC |
| Chi tiết Vé qua link chia sẻ | Viết lại theo AD-29: không cần đăng nhập, thấy Mã QR vé, không thấy SĐT/email/tên Người mua, không vào Vé của tôi của người nhận; sai, hủy hoặc hết hiệu lực trả cùng `empty-state`. Đóng Open Questions #11 |
| Tài khoản (mọi vai), dòng xác nhận lại | Thêm "Bật 2FA" vào danh sách thao tác (AD-26) |
| Interaction Primitives | "QR thanh toán" → "Trang Đơn". Bỏ Deep Link. Thêm: thanh toán mở bằng redirect toàn trang; quay về kiểm tra trạng thái ngay. Bỏ "sao chép mã Đơn (QR tĩnh)" |
| Accessibility | Bỏ nhãn ảnh QR thanh toán. Giữ quy tắc thông báo đếm ngược ở mốc 5 phút và 1 phút trên màn Thanh toán và Trang Đơn |
| Niềm tin khi thanh toán | Viết lại: tín hiệu tin cậy dồn vào màn Thanh toán trước khi rời Tickee. Ý 4 thành "không có nút Tôi đã chuyển khoản; trạng thái tự cập nhật trên Trang Đơn". Thứ tự trên màn mới. Ý 1 ghi rõ tên trên trang Gateway là câu hỏi mở |
| Flow 1, bước 5–8 và nhánh lỗi | Viết lại theo Gateway. Bỏ nhánh "ghi sai nội dung (QR tĩnh)". Thêm nhánh lỗi tạo link và nhánh "Đang xác nhận" |
| Flow 2 | Bước 1 thêm kênh liên hệ BTC. Bước 4 thêm "giá có phí ≥ 2.000đ". Nhánh lỗi "chuyển thiếu tiền" → "Tingee báo nhận thiếu tiền" |
| Flow 4, bước 3 | "trên QR thanh toán / `order-card`" → "trên Trang Đơn / `order-card`" |
| Responsive | Cột "Checkout, QR, …" → "Checkout, Thanh toán, Trang Đơn, …". Bỏ câu Deep Link trên desktop |
| Open Questions | #4: kênh liên hệ BTC đã chốt (SĐT, email nhập khi tạo BTC, Story 2.1), còn mở phần email cho mọi loại. #11: đã chốt theo AD-29. #12: "tạo QR" → "tạo link", đã chốt (AD-5, AD-31). #14: áp cho Trang Đơn |

**DESIGN.md:**

| Chỗ | Đổi |
|---|---|
| `description` (frontmatter) | "Bán vé sự kiện nhỏ qua VietQR" → "…qua Tingee Payment Gateway" |
| `components.payment-qr-card` (YAML) | Thay bằng `payment-summary` (container stage, amount, không có plate QR) |
| Overview, Bề mặt Người mua, ghi chú mockup | "QR thanh toán" → "màn Thanh toán" |
| Stage/Bar, Typography `amount`, Shapes `rounded.lg` | "thẻ QR thanh toán" → "màn Thanh toán". Bỏ "tấm QR trong thẻ" của màn thanh toán |
| Layout | "Checkout, QR thanh toán, Vé của tôi" → "Checkout, Thanh toán, Trang Đơn, Vé của tôi" |
| `button-secondary` | Ví dụ "Tải ảnh QR" → "Chia sẻ Vé" |
| `stage-block` | `payment-qr-card` → `payment-summary` |
| Mục `payment-qr-card` | Viết lại thành `payment-summary`: stage căn giữa (nhãn "Số tiền cần trả", số tiền, `countdown-chip`, "Mã Đơn"); `recipient-trust-block` ngay dưới; nút chính "Thanh toán" (`button-primary` trong vùng tối, `button-primary-on-light` trên page sáng); chân "Tickee không giữ tiền của bạn · Chính sách hoàn vé". Trạng thái chờ và `reassurance-line` thuộc Trang Đơn |
| `ticket-card`, bảng phân biệt | Cột trái thành `payment-summary` (không có QR; QR thanh toán nằm trên trang Tingee) |
| Do's and Don'ts | "QR thanh toán trong stage tối…" → "Màn Thanh toán trong stage tối, không có QR; Mã QR vé trong thẻ sáng dáng cuống vé" |

### 4.5 Spec

- **`spec-2-11-a-sellability-va-availability.md`:** thêm vào Spec Change Log (ngoài khối frozen): `09/11/2026 (E2-4, retro C8): code dùng thứ tự cancelled > locked > ended > hidden > paused (Story 2.12 đổi: "Đã kết thúc" thắng "Ẩn", sellability.ts:42-49). Dòng thứ tự trong Intent giữ nguyên văn đã duyệt; thứ tự hiện hành theo ghi chú này.`
- **`spec-2-2-totp-cho-owner.md`:** thêm `superseded_by: '{project-root}/_bmad-output/implementation-artifacts/spec-2-2-xac-thuc-hai-lop-tu-bat.md'` vào frontmatter (cùng dạng spec 2.6 cũ).

### 4.6 `sprint-status.yaml`

- Thêm `4-8-ảnh-sự-kiện-trên-object-storage: backlog` sau 4-7.
- Thêm `7-7-quản-trị-tingee-đặt-lại-totp: backlog` sau 7-6.
- Action item `epic-2-retro-e2-4-doi-chieu-spec-truoc-epic-3`: `status: done`, kèm `note` trỏ về đề xuất này.

## 5. Bàn giao

**Phạm vi:** Moderate. Có thêm story backlog (4.8, 7.7), chuyển AC giữa các epic và thu hẹp nhẹ phạm vi FR-9. Không cần lập lại kế hoạch.

| Vai | Việc |
|---|---|
| Developer agent (phiên này) | Sửa toàn bộ tài liệu ở §4; cập nhật `sprint-status.yaml`; commit trên branch `docs/e2-4-doi-chieu-spec`, không push khi Mason chưa bảo |
| Mason | Duyệt đề xuất; quyết định push/PR |
| Spec Epic 3 (3.4, 3.7) | Đọc PRD FR-14/FR-16 và EXPERIENCE nhóm "Thanh toán & Trang Đơn" mới. Mockup thanh toán chưa có, dựng theo spine UX |
| E2-8 (vệ sinh `deferred-work.md`) | Đóng hoặc gắn story cho các mục 2.5 phần sau (`ADMIN_ALLOWED_CIDRS` → 4.7; Đặt lại TOTP → 7.7), 2.7-b (→ 4.8) và trường bổ sung FR-9 (ngoài MVP) |

**Tiêu chí hoàn thành:**
- `grep -n "QR động\|QR tĩnh\|Deep Link\|billId"` trên PRD và UX chỉ còn ở các dòng ghi "bỏ" hoặc lịch sử thay đổi.
- Mỗi AC Epic 2 chưa làm có đúng một story nhận trong `epics.md` và `sprint-status.yaml`.
- AD-32, Story 4.1, 4.2 và 3.4 nói cùng một quy tắc "credential hiện hành".
- E2-4 trong `sprint-status.yaml` là `done`, có `note`.
