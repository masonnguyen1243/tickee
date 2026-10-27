# BRD Extract – Tickee MVP v1

Sources (read in full):
- `_bmad-output/planning-artifacts/brd-tickee.md` ("Tickee – Tài liệu Đặc tả Yêu cầu Nghiệp vụ (BRD) – MVP v1", dated Oct 26, 2026, v1.0, status "Bản nháp chờ phê duyệt", owner Tingee). Version note: "1.0 – Nghiên cứu thị trường và ý tưởng sản phẩm ban đầu".
- `_bmad-output/planning-artifacts/brd-data-model-notes.md` ("Ghi chú rà soát mô hình dữ liệu – BRD Tickee v1.0", 2026-10-27).

Conventions: Vietnamese text in quotes or tables is verbatim from the BRD. English glosses are translations, not additions. `[INFERRED]` marks anything not stated outright. Section references are written as §N.

---

## 0. Document Metadata (§0, §1.1)

- Project: "Tickee – nền tảng bán vé sự kiện trên hạ tầng Tingee"
- Type: BRD for the MVP. Version 1.0. Status: draft awaiting approval.
- Owner: Tingee.
- Purpose (§1.1): "làm cơ sở thống nhất giữa kinh doanh, sản phẩm, thiết kế, phát triển và kiểm thử".
- The BRD names four diagrams that are not in the markdown (images missing). Only their captions survive:
  - §4: "kiến trúc Tickee trên Tingee · dòng tiền tách khỏi dòng dữ liệu"
  - §5.2: "luồng thanh toán · 6 bước, 1 rẽ nhánh"
  - §10: "kiến trúc dữ liệu · mũi tên = một → nhiều"
  - §15: "lộ trình MVP · 3 phase, 1 cửa mở công khai"

## 1. Product Overview

### 1.1 One-liner (§0, §4)
- "Tickee – nền tảng bán vé sự kiện trên hạ tầng Tingee"
- §4: "Tickee là ứng dụng chuyên ngành nằm trên Tingee: Tickee lo sự kiện, vé, gửi vé và check-in; Tingee lo QR, đối soát, Token và kết nối 14 ngân hàng."
- Gloss: an event-ticketing SaaS built on top of Tingee, a Vietnamese payment and QR-reconciliation infrastructure. Tickee owns events, tickets, delivery and check-in. Tingee owns QR, reconciliation, Token and the links to 14 banks.

### 1.2 Problem Statement (§2.1, §5.1)
Small and mid-size organisers ("BTC sự kiện vừa và nhỏ (30–300 khách)") collect money through Google Forms plus screenshots of bank transfers:
- "Phải dò sao kê bằng mắt để xác nhận từng khách, dễ sót và bị lừa ảnh giả."
- "Không có vé QR, check-in bằng danh sách giấy hoặc Sheets."
- "Sàn vé lớn thu phí 8–15% + phí cố định và giữ tiền 7–14 ngày (số liệu nghiên cứu ban đầu, cần kiểm tra lại)."

As-is process (§5.1):
1. "BTC đăng bài kèm link Google Forms và số tài khoản."
2. "Người mua điền form, chuyển khoản, gửi ảnh chụp giao dịch."
3. "BTC đối chiếu ảnh với sao kê bằng tay, nhắn xác nhận qua Zalo."
4. "Ngày sự kiện, BTC điểm danh theo danh sách Sheets."

### 1.3 Business Objectives (§2.3)
| ID | Objective (verbatim) | Metric (verbatim) |
|---|---|---|
| BO-01 | Thay thế quy trình Google Forms + duyệt tay | Tỉ lệ đơn được duyệt tự động |
| BO-02 | Tiền về tài khoản BTC ngay, Tickee không giữ tiền | Thời gian từ chuyển khoản đến phát vé |
| BO-03 | Chi phí thấp hơn sàn vé nhiều lần | Phí trên mỗi vé so với đối thủ |
| BO-04 | Tăng trưởng qua mạng lưới merchant Tingee và lan truyền từ vé | Số BTC mới mỗi tháng, tỉ lệ BTC quay lại |
| BO-05 | Tạo doanh thu Token cho hệ sinh thái Tingee | Token tiêu thụ mỗi tháng qua Tickee |

None of the metrics has a numeric target.

### 1.4 Target Market and Segments (§2.2)
Size: "BTC sự kiện vừa và nhỏ (30–300 khách)". Geography is Vietnam `[INFERRED]` from VietQR, Vietnamese banks, Vietnamese decrees (NĐ 13/2023, NĐ 117/2025), Zalo, and the requirement "giao diện tiếng Việt".

| Segment | Examples | Key needs |
|---|---|---|
| Thể thao phong trào | Pickleball, cầu lông, bóng đá phủi, chạy CLB | Form tùy chỉnh, Sheets để chia bảng |
| Workshop & networking | BNI, JCI, CLB khởi nghiệp, AI | Sự kiện định kỳ, hóa đơn |
| Phòng trà, livehouse, hài độc thoại | Acoustic bar, kịch ngách | Giữ chỗ, nhận tiền ngay |
| Sinh viên | Prom, CLB đại học | Phí rất thấp hoặc miễn phí |

Closed Beta niche (D-09): "Mọi mô hình tương tự: thể thao, workshop, phòng trà, sinh viên".

### 1.5 Form Factor (§1.2, FR-07, FR-19, NFR-09)
- Web only. "App mobile native" is out of scope.
- Public event page and checkout: "mobile-first" (FR-07, NFR-09).
- Check-in: PWA ("Ứng dụng web chạy trên trình duyệt, không cần cài đặt") using the browser camera.
- Supported browsers: "Safari iOS và Chrome Android hiện hành"; "giao diện tiếng Việt" (NFR-09).
- BTC dashboard: web. The BRD gives no device target for it `[INFERRED]`.

### 1.6 Design Principles (§4)
1. **"Không giữ tiền"**: "tiền vé chảy thẳng từ ngân hàng người mua vào tài khoản BTC; Tickee chỉ nhận trạng thái qua IPN."
2. **"Master Merchant"**: "Tickee là Master Merchant, mỗi BTC là merchant con liên kết tài khoản nhận tiền khi onboarding."
3. **"Tingee là nguồn sự thật về tiền và Token"**: "Tickee không lưu sổ Token, chỉ đọc số dư qua API."
4. **"QR động ưu tiên, QR tĩnh dự phòng"**: "QR động tùy ngân hàng và loại tài khoản (thường là doanh nghiệp); BTC không có QR động dùng QR tĩnh."

## 2. Glossary (§1.3)
| Term | Meaning (verbatim) |
|---|---|
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

## 3. Stakeholders, Roles and Personas

### 3.1 Actors (§3.1)
| Actor | Description | Main goal |
|---|---|---|
| Người mua | Khách mua vé, không cần tài khoản | Mua nhanh, nhận vé ngay |
| BTC Owner | Chủ tài khoản BTC | Quản lý sự kiện, tài khoản nhận tiền, Token |
| BTC Admin | Thành viên quản lý của BTC | Tạo sự kiện, xử lý đơn |
| Staff / CTV | Người soát vé | Quét vé nhanh, đúng |
| Quản trị Tingee | Nhân sự vận hành nội bộ | KYC, hỗ trợ, xử lý vi phạm |
| Tingee (hệ thống) | Hạ tầng thanh toán, Token | Tạo QR, gửi IPN, trừ Token |
| Zalo ZNS, Email, Google Sheets (hệ thống) | Kênh gửi vé và đồng bộ dữ liệu | Nhận yêu cầu từ Tickee |

Internal stakeholders named in §1.1: kinh doanh, sản phẩm, thiết kế, phát triển, kiểm thử. Legal ("pháp chế") is a dependency (DEP-02, §10.3, R-05).

### 3.2 Permission Matrix (§12.1, verbatim)
| Function | Owner | Admin | Staff / CTV | Người mua |
|---|---|---|---|---|
| Liên kết tài khoản nhận tiền, KYC | Có | Không | Không | Không |
| Mua Token, xem số dư Token | Có | Xem | Không | Không |
| Mời / xóa thành viên | Có | Không | Không | Không |
| Tạo, sửa, hủy sự kiện | Có | Có | Không | Không |
| Xem đơn, doanh thu, xuất CSV | Có | Có | Không | Không |
| Xử lý đơn "Cần xử lý" | Có | Có | Không | Không |
| Mời CTV soát vé | Có | Có | Không | Không |
| Quét check-in | Có | Có | Sự kiện được giao | Không |
| Xem vé | – | – | – | Vé của mình |

Quản trị Tingee is not in the matrix. Its capabilities come from §3.1 and FR-26: KYC, support, and locking events or BTCs that violate rules.

### 3.3 Authentication per Role (§12.2)
| Group | Login method (verbatim) |
|---|---|
| Người mua | Không cần tài khoản; xem vé qua link có chữ ký, tra lại bằng OTP qua SĐT hoặc email |
| Owner / Admin BTC | SSO tài khoản Tingee nếu có; nếu không: email + mật khẩu, Google hoặc magic link. Bắt buộc 2FA cho Owner |
| Staff / CTV | Link hoặc mã mời theo sự kiện, có hạn, thu hồi được; có thể kèm OTP |
| Quản trị Tingee | SSO nội bộ + 2FA, giới hạn IP |

Session handling: "Phiên đăng nhập lưu cookie httpOnly, access token ngắn hạn, refresh token xoay vòng. IPN từ Tingee luôn kiểm tra chữ ký và giới hạn IP nguồn nếu được."

## 4. Scope

### 4.1 In and Out of MVP Scope (§1.2, verbatim)
| Trong phạm vi MVP | Ngoài phạm vi MVP |
|---|---|
| Tạo trang sự kiện, hạng vé, voucher, form tùy chỉnh | Hoàn tiền tự động / hàng loạt |
| Checkout không cần tài khoản, thanh toán QR động/tĩnh qua Tingee | Chợ vé (marketplace) khám phá sự kiện |
| Phát vé tự động, gửi qua Zalo ZNS và email | App mobile native |
| Check-in bằng PWA, chống quét trùng | Check-in offline, in thẻ |
| Đồng bộ Google Sheets theo thời gian thực | Đồng bộ Sheets hai chiều |
| Dashboard BTC, hiển thị số dư Token từ Tingee | Báo cáo nâng cao, Apple/Google Wallet |

Other scope statements:
- D-06 Hoàn tiền: "Làm ở giai đoạn sau".
- C-03: "API Chi hộ không hỗ trợ hoàn tiền hàng loạt."
- Tickee never stores Token, money, or buyers' bank-account information (§10.1, D-10, NFR-08).

### 4.2 Phases and Roadmap (§15)
The MVP takes about 6 weeks ("vì thanh toán đã có sẵn trên Tingee"). The Zalo and legal procedures run in parallel from week 1.

| Phase | Requirements covered | Exit criteria |
|---|---|---|
| Phase 1 · Tuần 1–2 | FR-01 → FR-15, BR-01 → BR-07 | US-01, US-02, US-03, US-05 đạt trên sandbox Tingee |
| Phase 2 · Tuần 3–4 | FR-16 → FR-27 | US-04, US-06 đạt; kiểm thử tải NFR-03 đạt |
| Phase 3 · Tuần 5–6 | Closed Beta 5–10 sự kiện, mọi mô hình tương tự | Không có lỗi nghiêm trọng mở |

Public-launch criteria (week 7), verbatim:
- "Không có vé phát trùng hoặc bán vé khi BTC đã hết Token trong beta"
- "Đa số đơn tự duyệt, không cần BTC can thiệp"
- "Mẫu ZNS đã duyệt"
- "Pháp chế xác nhận mô hình Token và nghĩa vụ TMĐT"

Priority scheme (§6): MoSCoW. "Must = bắt buộc cho MVP, Should = nên có, Could = có thì tốt."

## 5. Business Processes

### 5.1 To-be Ticket Purchase Flow (§5.2)
Core rule: "Mỗi đơn là một QR động Tingee với billId = mã đơn; thời hạn QR (15 phút) cũng là thời gian giữ vé."

| Step | Actor | Description (verbatim) |
|---|---|---|
| 1 | Người mua | Chọn hạng vé, điền Tên, SĐT Zalo, email và câu hỏi của BTC |
| 2 | Tickee | Kiểm tra Token khả dụng và tồn kho; giữ vé 15 phút; gọi Tingee tạo QR động |
| 3 | Người mua | Quét QR hoặc bấm Deep Link mở app ngân hàng, chuyển khoản |
| 4 | Tingee | Nhận biến động từ ngân hàng, gửi IPN về Tickee, tự trừ Token |
| 5 | Tickee | Xác thực IPN, khớp billId và số tiền, phát vé, hiển thị vé trên trình duyệt |
| 6 | Tickee | Gửi vé qua ZNS + email, ghi một dòng vào Google Sheets của BTC |
| 7 | Staff / CTV | Ngày sự kiện quét QR trên vé bằng PWA, hệ thống báo xanh hoặc đỏ |

### 5.2 BTC Onboarding (§5.3)
1. "BTC đăng ký tài khoản Tickee."
2. "Xác minh danh tính (KYC) và liên kết tài khoản nhận tiền qua Tingee; hệ thống tạo merchant con."
3. "Tickee báo BTC dùng được QR động hay chỉ QR tĩnh."
4. "BTC mua Token hoặc được cấp hạn mức trả sau."
5. "BTC tạo sự kiện đầu tiên và mở bán."

### 5.3 Worked Data-flow Example (§10.2)
Scenario: "CLB ABC mở giải Pickleball, hạng 'Đơn nam' giá 300.000đ, 64 suất; anh Minh mua 1 vé."

| Step | What happens | Entities written |
|---|---|---|
| 1. BTC tạo sự kiện | Tạo giải, hạng vé, câu hỏi "Trình độ" | events, ticket_types (64 suất), form_fields |
| 2. Minh bấm mua (10:00) | Tạo đơn #T1024, giữ 1 chỗ đến 10:15 | orders, attendees, reservations; ticket_types.reserved +1 |
| 3. Hiện QR | Tingee tạo QR động 300.000đ, billId = T1024 | payments (chờ) |
| 4. Minh chuyển khoản (10:03) | Tiền vào TK CLB ABC; Tingee gửi IPN, tự trừ Token | payment_events |
| 5. Xử lý (1 transaction) | Khớp billId và số tiền, phát vé | payments, orders → đã thanh toán; xóa reservations; tickets +1; outbox +3 |
| 6. Gửi vé | ZNS + email, ghi Google Sheets | outbox → xong |
| 7. CTV quét (7:30) | Báo xanh | tickets.checked_in_at; checkins (hợp lệ) |
| 8. Quét lại (7:42) | Báo đỏ, đã check-in lúc 7:30 | checkins (trùng) |

Order code format example: "#T1024" `[INFERRED: the format is illustrative, not specified]`.

## 6. Functional Requirements (§6), grouped by module

### 6.1 Tài khoản BTC (BTC Accounts)
| ID | Requirement (verbatim) | Priority | Gloss / linked rules |
|---|---|---|---|
| FR-01 | BTC đăng ký, đăng nhập, mời thành viên theo vai trò Owner / Admin / Staff | Must | Sign-up, login, role-based invites. Auth methods in §12.2. Only the Owner can invite or remove members (§12.1). Owner needs 2FA (NFR-06). |
| FR-02 | BTC hoàn tất KYC và liên kết tài khoản nhận tiền qua Tingee; hệ thống tạo merchant con | Must | INT-01. Owner only (§12.1). BR-10: KYC is required before a paid event can go on sale. Tickee tells the BTC whether dynamic QR is available (§5.3 step 3). |

### 6.2 Sự kiện (Events)
| ID | Requirement (verbatim) | Priority | Gloss / linked rules |
|---|---|---|---|
| FR-03 | Tạo, sửa, ẩn, hủy sự kiện: tên, thời gian, địa điểm, mô tả, ảnh, chính sách hoàn vé | Must | Create, edit, hide and cancel events. The refund policy is a field, and BR-11 shows it at checkout. R-02 calls it "chính sách hoàn vé bắt buộc". |
| FR-04 | Tạo nhiều hạng vé: giá, số lượng, thời gian mở/đóng bán | Must | Multiple ticket types, each with price, quantity and a sale window. BR-01 applies. |
| FR-05 | Thêm câu hỏi tùy chỉnh: văn bản, lựa chọn, bắt buộc/không | Must | Custom questions: text or choice, required or optional. |
| FR-06 | Tạo voucher: mức giảm, số lượt, thời hạn | Should | Vouchers with discount amount, usage count and validity period. |
| FR-07 | Trang sự kiện công khai mobile-first, có ảnh preview khi chia sẻ Facebook/Zalo | Must | Public, mobile-first event page with Open Graph preview `[INFERRED term]`. NFR-01: loads in under 2 s on 4G. |

### 6.3 Checkout
| ID | Requirement (verbatim) | Priority | Gloss / linked rules |
|---|---|---|---|
| FR-08 | Mua vé không cần tài khoản: Tên, SĐT Zalo, email + câu hỏi của BTC | Must | Guest checkout. NFR-08 requires data-processing consent (NĐ 13/2023) here. |
| FR-09 | Giữ vé trong thời hạn QR (15 phút), hiển thị đếm ngược | Must | 15-minute hold with a countdown. BR-01, BR-02. |
| FR-10 | Hiển thị QR động, nút tải ảnh QR, Deep Link mở app ngân hàng | Must | INT-02, INT-06. NFR-01: QR is created in under 2 s. |
| FR-11 | Dùng QR tĩnh với nội dung chuyển khoản chứa mã đơn khi BTC không có QR động | Must | Static-QR fallback, matched by transfer content. INT-03. EX-04/05/06. R-04: "Hướng dẫn nội dung rõ tại checkout". |
| FR-12 | Tự chuyển màn hình sang "Thành công" và hiển thị vé ngay khi đơn được thanh toán | Must | Screen switches automatically. NFR-02: under 3 s from IPN to ticket on screen. |

Checkout must also show "Tiền chuyển thẳng cho [tên BTC]" and the BTC's refund policy (BR-11). If Token is insufficient, it shows "Tạm ngừng bán" (US-05, BR-07). If the ticket type is sold out, it shows "Hết vé" (US-02).

### 6.4 Thanh toán (Payments / Reconciliation)
| ID | Requirement (verbatim) | Priority | Gloss / linked rules |
|---|---|---|---|
| FR-13 | Nhận IPN, xác thực chữ ký, khớp billId và số tiền thực nhận, phát vé | Must | BR-03, BR-04, NFR-06 (HMAC), D-04 (IPN returns the amount actually received). |
| FR-14 | Đối soát bù bằng API trạng thái QR khi IPN trễ hoặc sau khi BTC được mở lại dịch vụ | Must | Catch-up reconciliation by polling. EX-03, EX-07, A-02. |
| FR-15 | Hàng chờ "Cần xử lý" cho giao dịch lệch tiền, mồ côi, chưa khớp; BTC ghép tay hoặc duyệt tay | Must | Exception queue with manual match or manual approve. EX-02/05/06. Owner and Admin (§12.1). NFR-11 requires audit logging of manual handling. |

### 6.5 Gửi vé (Ticket Delivery)
| ID | Requirement (verbatim) | Priority | Gloss / linked rules |
|---|---|---|---|
| FR-16 | Gửi vé qua Zalo ZNS (BTC bật/tắt) và email | Must | ZNS can be switched on or off per BTC and is charged separately (§13). INT-07, INT-08. EX-09: automatic retry. |
| FR-17 | Trang vé web có QR; tra lại vé bằng OTP qua SĐT hoặc email | Must | Web ticket page via a signed link (§12.2). Ticket lookup by OTP. |
| FR-18 | Ảnh Social Ticket Card để chia sẻ Story, ẩn QR | Should | Shareable image without the QR. Viral growth (BO-04). |

### 6.6 Check-in
| ID | Requirement (verbatim) | Priority | Gloss / linked rules |
|---|---|---|---|
| FR-19 | PWA quét QR bằng camera trình duyệt; báo xanh khi hợp lệ, đỏ + âm thanh khi trùng hoặc không hợp lệ | Must | BR-08, BR-09. NFR-02: scan responds in under 1 s. |
| FR-20 | BTC mời CTV soát vé bằng link/mã theo sự kiện, có hạn, thu hồi được | Must | Per-event, expiring, revocable invites. §12.2: "có thể kèm OTP". |
| FR-21 | Tra cứu và check-in tay theo tên/SĐT khi khách không mở được QR | Should | Manual lookup and check-in. |

### 6.7 Đồng bộ (Sync)
| ID | Requirement (verbatim) | Priority | Gloss / linked rules |
|---|---|---|---|
| FR-22 | Kết nối Google Sheets của BTC; ghi từng đơn, trạng thái thanh toán, trạng thái check-in | Must | One-way only. Two-way sync is out of scope. US-06: within 1 minute. INT-09 (OAuth). EX-09 retry. |

### 6.8 Dashboard
| ID | Requirement (verbatim) | Priority | Gloss / linked rules |
|---|---|---|---|
| FR-23 | Doanh thu, số vé theo hạng, danh sách đơn, xuất CSV | Must | Owner and Admin. "Báo cáo nâng cao" is out of scope. |
| FR-24 | Hiển thị số dư và hạn mức Token từ Tingee, cảnh báo sắp hết, nút mua thêm | Must | INT-05 (API unconfirmed, A-01). US-05: threshold set by the BTC Owner; alert via Zalo, email and dashboard. Admin can only view Token (§12.1). |
| FR-25 | Hủy sự kiện: nhắn hàng loạt cho khách, xuất danh sách cần hoàn | Should | EX-08. The BTC makes refund transfers itself, outside the system. |

### 6.9 Niềm tin (Trust & Safety)
| ID | Requirement (verbatim) | Priority | Gloss / linked rules |
|---|---|---|---|
| FR-26 | Người mua báo cáo sự kiện; quản trị Tingee khóa sự kiện/BTC vi phạm | Must | Mitigates R-01. Data-model note #5 says the workflow is undefined. |

### 6.10 Lan truyền (Virality)
| ID | Requirement (verbatim) | Priority | Gloss / linked rules |
|---|---|---|---|
| FR-27 | Dòng giới thiệu Tickee dưới trang mua vé và tin nhắn vé | Could | "Powered by"-style footer `[INFERRED term]`. BO-04. |

FR totals: 27. Must 22 (FR-01–05, 07–17, 19, 20, 22, 23, 24, 26). Should 4 (FR-06, 18, 21, 25). Could 1 (FR-27).

## 7. User Stories and Acceptance Criteria (§7, verbatim Given/When/Then)

**US-01 – Mua vé bằng QR động** (FR-08 → FR-13)
"Là người mua, tôi muốn quét QR và nhận vé ngay, để không phải gửi ảnh chụp giao dịch cho BTC."
- Given hạng vé còn chỗ và BTC còn Token khả dụng, When tôi gửi form, Then hệ thống giữ 1 chỗ và hiển thị QR động đúng số tiền kèm đếm ngược 15 phút.
- Given QR còn hiệu lực, When tôi chuyển đúng số tiền, Then màn hình chuyển sang "Thành công" và hiển thị vé có QR.
- Given vé đã phát, Then tôi nhận vé qua ZNS (nếu BTC bật) và email.
- Given tôi không trả trong 15 phút, Then QR hết hiệu lực, chỗ được nhả và đơn chuyển "Hết hạn".

**US-02 – Chống bán lố** (FR-09, BR-01)
"Là BTC, tôi muốn không bao giờ bán quá số suất, để không phải từ chối khách đã trả tiền."
- Given hạng vé còn 1 chỗ, When hai người cùng gửi form, Then chỉ một người được giữ chỗ, người còn lại thấy "Hết vé".

**US-03 – IPN gửi lặp** (FR-13, BR-04)
- Given một giao dịch đã được xử lý, When Tingee gửi lại cùng IPN, Then không phát thêm vé và không gửi thêm tin.

**US-04 – Check-in tại cổng** (FR-19, FR-20)
"Là CTV, tôi muốn quét vé bằng điện thoại mà không cài app, để cho khách vào nhanh."
- Given tôi mở link mời còn hiệu lực, Then tôi chỉ thấy màn hình quét của sự kiện đó.
- Given vé hợp lệ chưa check-in, When tôi quét, Then màn hình báo xanh kèm tên khách và hạng vé.
- Given vé đã check-in, When tôi quét lại, Then màn hình báo đỏ + âm thanh kèm giờ và người quét lần trước.

**US-05 – Hết Token** (FR-24, BR-06)
"Là BTC Owner, tôi muốn được báo trước khi hết Token, để việc bán vé không bị gián đoạn."
- Given Token khả dụng xuống dưới ngưỡng tôi đặt, Then tôi nhận cảnh báo qua Zalo/email và trên dashboard.
- Given Token khả dụng không đủ cho thêm một giao dịch, When người mua gửi form, Then hệ thống không tạo QR và hiển thị "Tạm ngừng bán".

**US-06 – Đồng bộ Google Sheets** (FR-22)
- Given BTC đã kết nối Sheets, When một đơn được thanh toán hoặc check-in, Then Sheets có dòng mới hoặc cập nhật trạng thái trong vòng 1 phút.

That is 6 stories and 12 acceptance criteria. Only these six stories exist. The other FRs have no acceptance criteria.

## 8. Business Rules and Exception Handling (§8)

### 8.1 Business Rules (verbatim)
| ID | Rule | Gloss |
|---|---|---|
| BR-01 | Tổng vé đã bán + đang giữ của mỗi hạng không bao giờ vượt số suất | Per ticket type, sold + held ≤ capacity. |
| BR-02 | Mỗi đơn giữ chỗ đúng bằng thời hạn QR động: 15 phút; hết hạn thì QR không quét thanh toán được và chỗ được nhả | Hold equals the 15-minute dynamic-QR lifetime. On expiry the QR can no longer be paid and the seat is released. |
| BR-03 | Vé chỉ được phát khi IPN hợp lệ và số tiền thực nhận bằng số tiền đơn | Exact amount match is required. |
| BR-04 | Mỗi giao dịch IPN chỉ được xử lý một lần, dù Tingee gửi lặp | Idempotent IPN handling. |
| BR-05 | Tingee trừ Token cho mỗi giao dịch có Webhook báo về (QR động, QR tĩnh, kể cả lệch tiền hoặc chưa khớp); Tickee không trừ hoặc lưu Token | Tingee charges Token for every webhook, including mismatched and unmatched ones. |
| BR-06 | Tickee chỉ tạo QR mới khi Token khả dụng = số dư + hạn mức âm − số QR đang mở × mức trừ ≥ mức trừ một giao dịch | Available Token = balance + negative-credit limit − (open QRs × per-transaction charge). A new QR is created only if this is ≥ one charge. |
| BR-07 | Vượt hạn mức Token, Tingee ngắt toàn bộ API + Webhook của BTC; Tickee hiển thị "Tạm ngừng bán" | Over the limit, Tingee cuts all API and webhook traffic for that BTC. |
| BR-08 | Mỗi vé chỉ check-in thành công một lần; các lần quét sau báo trùng | A ticket checks in once. Later scans report a duplicate. |
| BR-09 | Mã QR trên vé được ký; mã không kiểm tra được chữ ký báo không hợp lệ | The ticket QR is signed. HMAC per Appendix A. |
| BR-10 | BTC phải hoàn tất KYC trước khi mở bán sự kiện có phí | KYC gates paid sales. |
| BR-11 | Trang checkout ghi rõ "Tiền chuyển thẳng cho [tên BTC]" và hiển thị chính sách hoàn vé của BTC | Trust disclosure. |
| BR-12 | Sự kiện miễn phí không tạo QR và không tiêu Token; giới hạn 200 vé/sự kiện (tham khảo) | Free events have no QR and no Token cost. The 200-ticket cap is "tham khảo" (reference only). |

### 8.2 Exceptions (verbatim)
| ID | Situation | System (automatic) | BTC action |
|---|---|---|---|
| EX-01 | QR động hết hạn, khách chưa trả | Nhả vé, mời khách tạo đơn mới | Không cần |
| EX-02 | Số tiền thực nhận lệch với đơn | Giữ đơn "Lệch số tiền", không phát vé | Duyệt tay hoặc tự hoàn |
| EX-03 | IPN trễ hoặc mất | Poll API trạng thái QR, đối soát bù | Không cần |
| EX-04 | QR tĩnh: trả sau khi đã nhả vé, vé còn | Phát vé bình thường | Không cần |
| EX-05 | QR tĩnh: trả sau khi đã nhả vé, vé hết | Đánh dấu "Thanh toán mồ côi", báo BTC + nhắn khách | Tự hoàn hoặc mở thêm chỗ |
| EX-06 | QR tĩnh: sai nội dung chuyển khoản | Đưa vào "Giao dịch chưa khớp" | Ghép tay với đơn |
| EX-07 | BTC bị ngắt dịch vụ khi còn QR đang mở | Sau khi mở lại, gọi API trạng thái các QR đó để phát vé bù | Mua thêm Token |
| EX-08 | Sự kiện hủy | Nhắn hàng loạt, xuất danh sách cần hoàn | Tự chuyển hoàn theo danh sách |
| EX-09 | Gửi ZNS / email / Sheets lỗi | Thử lại tự động; vé vẫn hợp lệ trên trang web | Không cần |

### 8.3 Named Statuses and UI Messages (collected from across the BRD)
- Order and payment states: "Hết hạn" (US-01), "Lệch số tiền" (EX-02), "Thanh toán mồ côi" (EX-05), "Giao dịch chưa khớp" (EX-06), "đã thanh toán" (§10.2), payments "chờ" (§10.2). The queue "Cần xử lý" (FR-15) holds lệch tiền, mồ côi and chưa khớp.
- Buyer-facing messages: "Thành công" (FR-12), "Hết vé" (US-02), "Tạm ngừng bán" (BR-07, US-05), "Tiền chuyển thẳng cho [tên BTC]" (BR-11).
- Check-in results: "báo xanh" (valid; shows guest name and ticket type), "báo đỏ + âm thanh" (duplicate or invalid; a duplicate shows the time and the previous scanner). Checkins result values: "hợp lệ", "trùng" (§10.2). BR-09 adds "không hợp lệ".
- Event actions: tạo, sửa, ẩn, hủy (FR-03). Tingee admin can "khóa" (FR-26).
- BTC state: KYC status (organizations). The BTC can be cut off or "ngắt dịch vụ" by Tingee (BR-07, EX-07) and later "mở lại dịch vụ" (FR-14).
- No complete state machine is defined for orders, payments, events or tickets `[gap]`.

## 9. Non-Functional Requirements (§9)
The BRD qualifies these numbers: "Các con số dưới đây là mục tiêu đề xuất, cần đội kỹ thuật xác nhận trước khi chốt."

| ID | Group | Requirement (verbatim) |
|---|---|---|
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

Other NFR-type statements found elsewhere:
- Sheets sync completes "trong vòng 1 phút" (US-06).
- Data conventions (§10.3): "Tiền lưu số nguyên theo đồng, không dùng số thực; thời gian có múi giờ." "Mọi bản ghi gắn organization_id để cách ly dữ liệu giữa các BTC." "Dữ liệu người mua chỉ dùng cho sự kiện đã mua; thời gian lưu trữ cần pháp chế chốt."
- Session and auth hardening (§12.2): httpOnly cookie, short-lived access token, rotating refresh token, IPN signature check, source-IP restriction "nếu được". Tingee admin uses IP restriction.
- Legal and compliance: NĐ 13/2023 (personal data), NĐ 117/2025 (e-commerce platform and tax obligations, R-05), e-commerce ("TMĐT") obligations (DEP-02). Token must not be treated as an e-wallet: "Token chỉ dùng cho dịch vụ Tingee, không quy đổi ngược ra tiền và không chuyển nhượng, để không bị coi là ví điện tử" (§13). C-04: "nghĩa vụ pháp lý xét theo pháp nhân Tingee".
- Localization: Vietnamese UI only. Currency is đồng, stored as integers.

## 10. Integrations (§11)
| ID | System | Function used | Notes (verbatim) |
|---|---|---|---|
| INT-01 | Tingee – Master Merchant | Tạo merchant con, liên kết tài khoản nhận tiền của BTC | Khi onboarding |
| INT-02 | Tingee – QR động | POST /v1/generate-dynamic-qr, tra trạng thái, xóa QR | 15 phút, gắn billId (https://developers.tingee.vn/docs/qr/dynamic/) |
| INT-03 | Tingee – QR tĩnh | QR cho BTC không có QR động | Đối soát theo nội dung (https://developers.tingee.vn/docs/qr/static/) |
| INT-04 | Tingee – Webhook (IPN) | Nhận giao dịch kèm số tiền thực nhận | Mỗi Webhook bị trừ Token |
| INT-05 | Tingee – Token | Đọc số dư, hạn mức, lịch sử trừ | API cần Tingee xác nhận |
| INT-06 | Tingee – Deep Link | Mở app ngân hàng từ trang checkout | (no note) |
| INT-07 | Zalo ZNS | Gửi vé và cảnh báo theo SĐT | Cần Zalo OA xác thực + mẫu tin được duyệt |
| INT-08 | Email (Amazon SES / Resend) | Gửi vé, OTP, thông báo | Kênh dự phòng của ZNS |
| INT-09 | Google Sheets API | Ghi đơn và trạng thái check-in vào Sheets của BTC | BTC cấp quyền OAuth |

Tingee API conventions (§11): "Mọi request tới Tingee ký bằng x-client-id, x-request-timestamp, x-signature (HMAC SHA512); API luôn trả HTTP 200, thành công khi code = "00"" (https://developers.tingee.vn/docs/). Tingee connects to 14 banks (§4, A-03). Tingee also offers SSO ("SSO tài khoản Tingee nếu có", §12.2) and a Node.js SDK (Appendix A).

## 11. Fee and Token Model (§13)
The BRD notes "mọi mức phí dưới đây chỉ để tham khảo, sẽ chốt sau" (D-08).

| Component | Rule (verbatim) |
|---|---|
| Ai quản lý | Tingee: số dư, lịch sử trừ, bảng giá gói, hóa đơn. Tickee không lưu bản sao |
| Cách thanh toán | Trả trước; hoặc trả sau / cho âm Token theo hạn mức Tingee cấp cho từng BTC |
| Khi nào trừ | Mỗi Webhook báo một giao dịch (BR-05) |
| Trừ bao nhiêu | Theo mức Tingee quy định mỗi giao dịch; tham khảo tương đương 3.000–5.000đ/vé |
| Zalo ZNS | Tính riêng, BTC bật/tắt |
| Sự kiện miễn phí | Không tiêu Token (BR-12) |
| Vượt hạn mức | Tingee ngắt API + Webhook; Tickee ngừng tạo QR trước đó (BR-06, BR-07) |

Reference comparison: a ticket marketplace charging 10% + 15.000đ per ticket, a 300.000đ ticket, and Tickee at 4.000đ per ticket.
| Event size | Via Tickee | Via marketplace |
|---|---|---|
| 50 vé | 200.000đ | 2.250.000đ |
| 150 vé | 600.000đ | 6.750.000đ |
| 300 vé | 1.200.000đ | 13.500.000đ |

R-06 mitigation also says "xuất hóa đơn khi mua" Token.

## 12. Data Model

### 12.1 BRD §10: Conceptual Entities
Principle: "Database của Tickee chỉ lưu dữ liệu nghiệp vụ bán vé; tiền và Token nằm ở Tingee." Every arrow in the (missing) diagram means one-to-many.

| Group | Entity | Stores (verbatim) |
|---|---|---|
| Tổ chức | organizations | BTC (merchant con): tên, mã merchant Tingee, trạng thái KYC |
| Tổ chức | users, memberships | Tài khoản và vai trò trong từng BTC; CTV được giao sự kiện nào |
| Tổ chức | integrations | Kết nối Google Sheets, Zalo OA của BTC |
| Sự kiện | events | Tên, thời gian, địa điểm, mô tả, ảnh, chính sách hoàn vé |
| Sự kiện | ticket_types | Giá, tổng số, đã bán, đang giữ, thời gian mở bán |
| Sự kiện | form_fields, vouchers | Câu hỏi tùy chỉnh; mã giảm giá |
| Đơn & vé | orders | Người mua (tên, SĐT Zalo, email), tổng tiền, trạng thái |
| Đơn & vé | attendees | Từng người dự + câu trả lời form |
| Đơn & vé | reservations | Vé đang giữ, hết hạn sau 15 phút |
| Đơn & vé | tickets | Vé đã phát: mã QR đã ký, thời điểm check-in |
| Thanh toán | payments | Đơn ↔ billId, loại QR, số tiền, trạng thái |
| Thanh toán | payment_events | Bản gốc IPN, chống xử lý trùng, tra soát |
| Vận hành | checkins | Lượt quét: vé, người quét, thời điểm, kết quả |
| Vận hành | outbox | Việc cần gửi ZNS, email, Sheets (thử lại khi lỗi) |
| Vận hành | audit_logs | Ai thay đổi gì, lúc nào |

Not stored: "số dư và lịch sử Token (đọc từ Tingee), tiền, thông tin tài khoản ngân hàng của người mua."
D-10: "Tickee không lưu Token; chỉ lưu bản ghi đối chiếu thanh toán (payments, payment_events)".

Relationships `[INFERRED]` from the entity descriptions and §10.2, since the diagram is missing: organization → users (through memberships), events, integrations. Event → ticket_types, form_fields, vouchers. Order → attendees, reservations, payments, tickets. Payment → payment_events. Ticket → checkins. Memberships tie a CTV to the events assigned to it.

Field names that appear explicitly: `ticket_types.reserved`, `tickets.checked_in_at`, `organization_id`. From the Appendix A SQL: `ticket_types.sold`, `ticket_types.capacity`.

### 12.2 Data-model Review Notes (full summary of `brd-data-model-notes.md`)
Purpose: feeds `bmad-prd` (settle business questions) and `bmad-architecture` (detailed schema). Scope reviewed: BRD §10 and Appendix A.

**Conclusion:** "Không cần sửa BRD trước khi làm PRD." §10 is a conceptual model and is adequate for a BRD. Columns, keys, indexes and constraints will be settled during Architecture.

**Confirmed as sound:**
- Money stored as integer đồng. Timestamps carry a timezone.
- Every record carries `organization_id`, isolated by Row Level Security.
- `payment_events` is unique per transaction ID, which blocks repeated IPN processing (BR-04).
- `outbox` handles ZNS, email and Sheets with retry on failure (EX-09).
- No Token, money or buyer bank information is stored.
- Overselling and duplicate check-in are prevented by conditional UPDATEs (BR-01, BR-08).

**Business questions the PRD must settle:**
| # | Gap | Question | Related |
|---|---|---|---|
| 1 | No `order_items`. Attendee is not tied to a ticket_type. The hold SQL only does `reserved + 1`. | Can one order buy several tickets or several ticket types? Does each attendee fill in their own form? | FR-04, FR-08, BR-01 |
| 2 | Orders don't store the price at purchase time or the voucher applied. | Does a voucher apply to the whole order or per ticket? Is there a per-phone limit? | FR-06 |
| 3 | Voucher "số lượt" needs over-use protection like BR-01. | Is a voucher use held for 15 minutes like a ticket? | FR-06, BR-02 |
| 4 | CTVs enter by link or code with no account, so an invites table is missing (hashed code, expiry, revocation). It is unclear what the "người quét" field in `checkins` points to. | Does a CTV need an account or OTP? | FR-20, §12.2 |
| 5 | FR-26 has no `reports` table. There are no lock states for events or BTCs. | What is the violation-report workflow, who handles it, and at what level is the lock? | FR-26, R-01 |
| 6 | Updating status in Sheets needs a stored row-to-order mapping. OAuth tokens must be encrypted. | What happens when the BTC edits or deletes columns or rows in the Sheet? | FR-22, US-06 |
| 7 | Event cancellation plus refund list: orders have no "cần hoàn" or "đã hoàn tay" status. | Can the BTC mark an order as manually refunded? | FR-25, EX-08, D-06 |

**Technical points for Architecture:**
| # | Gap | Note |
|---|---|---|
| 8 | No storage for ticket-lookup OTP. | An OTP table or Redis with TTL and a retry limit. |
| 9 | Two sources of truth for held seats: the `ticket_types.reserved` counter and the `reservations` table. | The expiry-release job must decrement `reserved` and delete or close `reservations` in the same transaction. A periodic reconciliation is needed. |

## 13. Requirement Inventory (counts)
| Type | IDs | Count |
|---|---|---|
| Business objectives | BO-01..BO-05 | 5 |
| Functional requirements | FR-01..FR-27 | 27 (Must 22: FR-01–05, 07–17, 19, 20, 22, 23, 24, 26; Should 4: FR-06, 18, 21, 25; Could 1: FR-27) |
| User stories | US-01..US-06 | 6 (12 Given/When/Then criteria) |
| Business rules | BR-01..BR-12 | 12 |
| Exceptions | EX-01..EX-09 | 9 |
| NFRs | NFR-01..NFR-11 | 11 |
| Integrations | INT-01..INT-09 | 9 |
| Permission rows | §12.1 | 9 |
| Assumptions / Constraints / Dependencies | A-01..03 / C-01..04 / DEP-01..02 | 3 / 4 / 2 |
| Risks | R-01..R-09 | 9 |
| Decisions | D-01..D-10 | 10 |
| Data-model open items | notes #1–#9 | 9 (7 business, 2 technical) |

Core testable requirements (FR + BR + EX + NFR + INT): 68.

## 14. Success Metrics, Assumptions, Constraints, Dependencies, Risks, Decisions

### 14.1 Success Metrics / KPIs
- BO metrics (§2.3): auto-approval rate, time from transfer to ticket issue, fee per ticket vs. competitors, new BTCs per month, BTC return rate, Token consumed per month via Tickee.
- Launch gates (§15): zero duplicate tickets, zero sales after Token runs out during beta, "Đa số đơn tự duyệt", ZNS template approved, legal sign-off.
- Phase exit criteria are listed in §4.2 above.

### 14.2 Assumptions (§14.1, verbatim)
- A-01: Tingee cung cấp API đọc số dư, hạn mức và lịch sử Token theo merchant con.
- A-02: API trạng thái QR vẫn gọi được sau khi BTC được mở lại dịch vụ (để phát vé bù EX-07).
- A-03: BTC có tài khoản tại một trong 14 ngân hàng Tingee hỗ trợ.

### 14.3 Constraints (§14.2, verbatim)
- C-01: QR động hết hạn cố định sau 15 phút.
- C-02: QR động tùy ngân hàng và loại tài khoản, thường chỉ tài khoản doanh nghiệp.
- C-03: API Chi hộ không hỗ trợ hoàn tiền hàng loạt.
- C-04: Tickee là sản phẩm của Tingee; nghĩa vụ pháp lý xét theo pháp nhân Tingee.

### 14.4 Dependencies (§14.3, verbatim)
- DEP-01: Zalo OA xác thực và mẫu ZNS được duyệt trước Closed Beta.
- DEP-02: Ý kiến pháp chế về TMĐT, thuế và Token trước khi mở công khai.

### 14.5 Risks (§14.4, verbatim)
| ID | Risk | Level | Mitigation |
|---|---|---|---|
| R-01 | Sự kiện lừa đảo, tiền đã về tài khoản kẻ gian | Cao | KYC (BR-10), giới hạn vé có phí cho BTC mới, báo cáo + khóa sự kiện (FR-26) |
| R-02 | Khách đổ lỗi Tickee khi không được hoàn tiền | Cao | BR-11, chính sách hoàn vé bắt buộc |
| R-03 | BTC bị ngắt dịch vụ khi còn QR đang mở, khách trả tiền không nhận vé | Cao | BR-06, cảnh báo sớm, EX-07 |
| R-04 | BTC dùng QR tĩnh, tỉ lệ ghép tay cao và vẫn bị trừ Token cho giao dịch sai nội dung | Trung bình | Hướng dẫn nội dung rõ tại checkout; khuyến khích tài khoản có QR động |
| R-05 | Nghĩa vụ sàn TMĐT và thuế (NĐ 117/2025) | Trung bình | Pháp chế xác định SaaS hay sàn theo pháp nhân Tingee |
| R-06 | Token bị coi là ví điện tử | Trung bình | Không rút, không chuyển nhượng, xuất hóa đơn khi mua |
| R-07 | Zalo OA / ZNS duyệt chậm | Trung bình | Nộp tuần 1; email là kênh dự phòng |
| R-08 | Dữ liệu cá nhân (NĐ 13/2023) | Trung bình | NFR-08; GTM không dùng tool cào dữ liệu |
| R-09 | Đối thủ hạ phí hoặc sao chép | Trung bình | Trải nghiệm sản phẩm + mạng lưới merchant Tingee |

### 14.6 Decisions Already Made (§16.1, verbatim)
| ID | Topic | Decision |
|---|---|---|
| D-01 | Tài khoản cá nhân | Hầu hết ngân hàng hỗ trợ; QR động tùy ngân hàng và loại tài khoản, QR tĩnh là dự phòng |
| D-02 | Mô hình tài khoản | Tickee là Master Merchant, mỗi BTC là merchant con |
| D-03 | Thời hạn QR động | 15 phút; hết hạn không quét thanh toán được |
| D-04 | IPN | Trả về số tiền thực nhận |
| D-05 | Chi phí | Tingee quản lý Token, tự trừ mỗi Webhook kể cả QR tĩnh; cho trả sau hoặc âm theo hạn mức; vượt hạn mức ngắt API + Webhook |
| D-06 | Hoàn tiền | Làm ở giai đoạn sau |
| D-07 | Pháp nhân | Tickee là sản phẩm của Tingee |
| D-08 | Mức phí | Số trong tài liệu chỉ để tham khảo, chốt sau |
| D-09 | Ngách Closed Beta | Mọi mô hình tương tự: thể thao, workshop, phòng trà, sinh viên |
| D-10 | Database | Tickee không lưu Token; chỉ lưu bản ghi đối chiếu thanh toán (payments, payment_events) |

### 14.7 Open Questions Explicitly Flagged in the Sources
- §16 is titled "Quyết định đã chốt & vấn đề mở", but it has no "vấn đề mở" subsection. Only 16.1 exists.
- Items the BRD itself marks as unconfirmed or TBD:
  - Competitor fee figures "cần kiểm tra lại" (§2.1).
  - NFR numbers "cần đội kỹ thuật xác nhận" (§9).
  - Data retention "cần pháp chế chốt" (§10.3).
  - Token API "cần Tingee xác nhận" (INT-05).
  - All fees "tham khảo, sẽ chốt sau" (§13, D-08).
  - Free-event cap "200 vé/sự kiện (tham khảo)" (BR-12).
  - SaaS vs. marketplace legal classification (R-05).
- The seven business questions from the data-model notes (§12.2 above).

## 15. Qualitative Content (tone, brand, UX feel, positioning)
- **Value framing:** speed and immediacy ("Mua nhanh, nhận vé ngay"; "Tiền về tài khoản BTC ngay"; "nhận vé ngay"). It removes the screenshot-and-manual-check routine ("để không phải gửi ảnh chụp giao dịch cho BTC").
- **Low friction everywhere:** no buyer account; no app install for CTVs ("mà không cài app"); a Deep Link straight into the banking app; a button to download the QR image.
- **Trust as a product feature:** the explicit disclosure "Tiền chuyển thẳng cho [tên BTC]", a mandatory refund policy, KYC, buyer reporting, and Tingee admin locks. Tickee positions itself as never holding money, so buyers should not blame Tickee for refunds (R-02).
- **Check-in UX feel:** binary, glanceable feedback. Green means valid and shows guest name and ticket type. Red plus a sound means duplicate or invalid, and a duplicate shows the time and the previous scanner. Gate staff should be "nhanh, đúng".
- **Growth and brand:** virality through tickets: a Social Ticket Card for Stories (QR hidden), a Tickee footer on the checkout page and ticket messages, and share previews for Facebook and Zalo. Growth also rides on the Tingee merchant network. The moat is "Trải nghiệm sản phẩm + mạng lưới merchant Tingee" (R-09).
- **Price positioning:** "Chi phí thấp hơn sàn vé nhiều lần". The worked example shows about 11x lower cost (200.000đ vs 2.250.000đ for 50 tickets).
- **Ethical GTM:** "GTM không dùng tool cào dữ liệu" (R-08).
- **Vietnam-local channel choices:** Zalo-first messaging, phone number as identity ("SĐT Zalo"), VietQR, Vietnamese UI.
- **Architecture philosophy (business-level):** money flow is separate from data flow ("dòng tiền tách khỏi dòng dữ liệu"). Tingee is the source of truth for money and Token.

## 16. Extractor Observations (not in the source; my analysis)

### 16.1 Contradictions and Inconsistencies
1. **Phase mapping vs. story dependencies.**
   - US-01 must pass in Phase 1, but its third criterion needs ZNS and email delivery (FR-16), which is Phase 2.
   - US-05 must pass in Phase 1, but it needs the Token dashboard, alerts and threshold (FR-24), which is Phase 2.
   - BR-08..BR-12 are not assigned to any phase. BR-10 (KYC gate) and BR-12 (free events) are effectively Phase 1 concerns. FR-06 (Should) sits in Phase 1.
2. **Flow step count.** The §5.2 diagram caption says "6 bước, 1 rẽ nhánh", but the table has 7 steps. The branch (presumably dynamic vs. static QR `[INFERRED]`) is not shown in the text.
3. **Static QR vs. "every order is a dynamic QR".** §5.2 says "Mỗi đơn là một QR động". FR-11 and EX-04..06 define a static-QR path whose hold and expiry semantics are never stated. BR-02 ties the hold to dynamic-QR expiry. A static QR has no expiry, yet EX-04/05 speak of "trả sau khi đã nhả vé". The static-QR hold duration and release trigger are undefined.
4. **BR-06 formula vs. static QR.** "số QR đang mở × mức trừ" reserves Token only for open dynamic QRs. Static-QR orders, mismatched transfers and orphan payments also consume Token (BR-05), so the guard can be bypassed. It is also unclear whether a static QR counts as "đang mở".
5. **Staff vs. CTV.** FR-01 invites "Staff" as a member role, which implies an account. FR-20 and §12.2 treat Staff/CTV as link- or code-based with no account. memberships stores "CTV được giao sự kiện nào", which implies CTVs are users. Data-model note #4 raises the same question.
6. **"Vấn đề mở" heading has no content** (§16).

### 16.2 Gaps and Ambiguities
1. **Multi-ticket and multi-type orders are undefined** (data note #1). US-01 says "giữ 1 chỗ". The attendees entity ("Từng người dự") implies several attendees per order. No per-buyer purchase limit is stated.
2. **There is no full state machine** for order, payment, ticket, event or BTC/organization. Statuses are scattered (see §8.3). The meaning of "ẩn" (hide) is undefined when there is no marketplace. Lock states are undefined (note #5). Behaviour outside the ticket-type sale window is not specified.
3. **Free-event flow is unspecified** beyond BR-12. Open points: whether the registration flow differs, whether KYC is needed (BR-10 covers only paid events), anti-spam or abuse controls, and whether the 200 cap is hard or "tham khảo".
4. **Refunds are out of scope but referenced repeatedly** (EX-02, EX-05, EX-08, FR-25, R-02). Open points: no "cần hoàn"/"đã hoàn tay" status (note #7), no way to record a manual refund, and no rule for whether a ticket is voided after a refund or mismatch.
5. **The Token dependency is fragile.** INT-05 and A-01 are unconfirmed. BR-06 needs "mức trừ một giao dịch" and "hạn mức âm" from Tingee in real time. No fallback is defined if the Token API is unavailable. The "nút mua thêm" Token purchase flow (in-app or redirect to Tingee) is undefined.
6. **The cutoff window is not fully covered.** EX-07 covers open dynamic QRs only. Static-QR payments made while the BTC is cut off (BR-07 cuts all webhooks) have no recovery path.
7. **OTP channel for phone lookup is undefined.** FR-17 says "OTP qua SĐT", but INT-07 (ZNS) lists only "Gửi vé và cảnh báo" and INT-08 lists email for OTP. No SMS provider is listed.
8. **Low-Token alert threshold.** US-05 says "ngưỡng tôi đặt", but no FR covers setting the threshold. The alert recipients (Owner only? Admin?) and the channel to the BTC (ZNS to a BTC phone needs its own template) are unspecified.
9. **Waiting room ("phòng chờ")** appears only in NFR-03. It has no FR, no trigger criteria for "sự kiện hot", and no UX defined.
10. **"Giới hạn vé có phí cho BTC mới"** (R-01 mitigation) has no FR, no threshold and no duration.
11. **Segment needs not covered by FRs:**
    - "Sự kiện định kỳ" (recurring events or cloning) for workshops: no FR.
    - "Hóa đơn" (invoices or e-invoices for buyers) for workshops: no FR or integration. Only Token invoices from Tingee are mentioned.
    - "Giữ chỗ" for phòng trà could mean seat or table selection; only general-admission holds are specified.
    - "Sheets để chia bảng" for sports relies on FR-22 alone.
12. **Voucher semantics are undefined.** Open points: percent vs. fixed discount, behaviour at 100% off (a free order — does it skip QR and Token?), stacking, per-phone limits, reservation of voucher uses (notes #2, #3), and whether the order snapshots the price.
13. **Tingee admin console scope.** FR-26 is the only FR for Quản trị Tingee. KYC review, support tooling, report triage and unlock flow are undefined. The role is absent from the §12.1 matrix.
14. **Report-event flow** (FR-26) has no defined inputs, buyer verification, handling SLA or buyer/BTC notification.
15. **CSV export and Sheets columns** are unspecified. Sheets behaviour when the BTC edits the Sheet is open (note #6). Behaviour when Sheets OAuth is revoked or expires is not covered.
16. **Event cancellation.** FR-03 "hủy" is Must but the bulk messaging and refund list (FR-25) is Should. The effect on already-issued tickets (invalidated at check-in?) is unstated.
17. **ZNS cost billing.** "Tính riêng" does not say who bills (Tingee Token? Zalo directly? Tickee?). Behaviour when the buyer's number is not on Zalo is not described beyond the email fallback.
18. **Edge case:** a dynamic-QR payment started just before the 15-minute expiry and settled after it. BR-02 says the QR cannot be paid after expiry, but bank timing is not addressed.
19. **Duplicate-scan display.** US-04 says to show "người quét lần trước". For link/code CTVs with no account, it is unclear what identity is shown (note #4).
20. **2FA method** for the Owner is unspecified. Tingee SSO availability ("nếu có") is unspecified.
21. **No numeric targets** for BO KPIs. The launch criterion "Đa số đơn tự duyệt" is vague (majority = >50%? `[INFERRED]`).
22. **Data retention** for buyer PII awaits legal. Consent-capture specifics (text, opt-in granularity) are not given.
23. **Diagrams missing.** Four referenced diagrams are not in the markdown. Data relationships in §12.1 are partly inferred because of this.
24. **Multi-organization membership.** "vai trò trong từng BTC" implies one user can belong to several BTCs. Org switching is not described.
25. **Dashboard scope** is per event or across events — unspecified. Revenue means gross or after vouchers — unspecified.

### 16.3 Items That Read as Implementation Detail Rather Than Business Requirements
Recommend moving these to Architecture, or keeping them only as constraints:
- All of Appendix A: Next.js, Tailwind, shadcn/ui, NestJS, Tingee Node SDK, PostgreSQL (primary + standby, PITR), PgBouncer, read replica, Prisma/Drizzle, Redis + BullMQ, Server-Sent Events, ZXing/html5-qrcode, Satori/@vercel/og, Better Auth/Auth.js/Keycloak/Logto, Docker, GitHub Actions, Sentry, Grafana + Prometheus, domestic cloud or AWS Singapore, k6.
- SQL mechanisms in Appendix A:
  - `UPDATE ticket_types SET reserved = reserved + 1 WHERE id = ? AND sold + reserved < capacity`
  - IPN: write `payment_events` with a unique key per transaction ID, return 200 immediately, then a worker handles the order in one transaction
  - `UPDATE tickets SET checked_in_at = now() WHERE id = ? AND checked_in_at IS NULL`
- NFR-05 "trong một transaction" (outbox pattern). NFR-07 "Row Level Security". NFR-06 / §11 "HMAC SHA512", header names `x-client-id`, `x-request-timestamp`, `x-signature`, "HTTP 200, code = '00'".
- §12.2 session mechanics: httpOnly cookie, short-lived access token, rotating refresh token.
- INT-02 endpoint `POST /v1/generate-dynamic-qr`. INT-08 vendor choice (Amazon SES / Resend).
- §10.1 entity and table names (organizations, outbox, etc.) and §10.2 field-level writes (`ticket_types.reserved +1`, `outbox +3`).
- The data-model notes themselves recommend deferring the detailed schema to Architecture.

The underlying business outcomes are real requirements and should stay in the PRD: no overselling, idempotent IPN, single check-in, tenant isolation, signed tickets and requests, and reliable retried delivery.
