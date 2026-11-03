---
title: 'Sprint Change Proposal: BTC dùng tài khoản Tingee của chính mình'
date: '2026-11-03'
author: 'Mason (duyệt) · Developer agent (soạn)'
status: 'approved'
scope: 'moderate'
trigger_story: '2.6'
---

# Sprint Change Proposal: BTC dùng tài khoản Tingee của chính mình

## 1. Tóm tắt vấn đề

**Thay đổi:** bỏ mô hình Tickee làm Master Merchant. Theo mô hình cũ, Tickee dùng key Tingee của mình để tạo Merchant con cho từng BTC và tự liên kết số tài khoản ngân hàng qua `create-va`/`confirm-va` kèm OTP ngân hàng. Mô hình mới:

- Mỗi BTC dùng **tài khoản merchant Tingee của chính mình**.
- Owner nhập Client ID và Secret Token Tingee vào Tickee.
- Tickee gọi `POST /v1/get-va-paging` bằng key đó để liệt kê các tài khoản BTC đã liên kết trên Tingee. Owner chọn một tài khoản để nhận tiền vé.
- Tạo link thanh toán, kiểm chữ ký IPN, Đối soát bù và đọc Token đều dùng key của BTC.

**Phân loại:** yêu cầu mới từ phía sản phẩm.
- BTC tự liên kết ngân hàng, làm KYC và cấu hình cổng thanh toán (logo, tên hiển thị, IPN, tài khoản cho phép thanh toán) ngay trên portal Tingee.
- Tickee không phải làm form và OTP cho từng ngân hàng, không còn giới hạn 5 ngân hàng hay chỉ tài khoản cá nhân.
- Tickee không cần quyền Master Merchant.

**Bối cảnh phát hiện:**
- Story 2.6 đã làm xong theo mô hình cũ ở commit `178bd2c`, nhánh `feat/2-6-lien-ket-tai-khoan-nhan-tien`, chưa merge, chưa deploy. Migration `0008` mới chạy trên DB local.
- Khi chạy thử, Mason muốn BTC chọn tài khoản đã có trên Tingee thay vì nhập lại số tài khoản và CCCD trên Tickee.

**Bằng chứng (developers.tingee.vn, đọc 03/11/2026):**
- `POST /v1/get-va-paging` gọi bằng key của merchant, trả `items[]` gồm `bankName`, `bankBin`, `accountType`, `accountName`, `accountNumber`, `vaAccountNumber`, `status`, `shopId`, `transactionType`, `creationTime`, kèm `totalCount`. Phân trang bằng `skipCount`/`maxResultCount`.
- Trang "Cấu hình thanh toán (Payment Gateway)" của portal Tingee yêu cầu merchant tự nhập "Đường dẫn IPN" (URL public) và chọn "Các Tài khoản cho phép thanh toán".
- `create-link` nhận `vaAccountNumber` để chỉ định tài khoản nhận tiền; `merchantId` chỉ bắt buộc khi gọi bằng key Master Merchant.
- Lỗi xác thực của Tingee: `92` (clientId không tồn tại, bị khóa), `97` (sai chữ ký, tức secret sai), `90`/`91` (timestamp).

**Gộp vào đề xuất này:** quyết định (3) của spec 2.6 (03/11): bỏ hiển thị loại QR (QR động hay chỉ QR tĩnh) và câu khuyến nghị đi kèm.

**Quyết định đã chốt với Mason (03/11/2026):**

| # | Câu hỏi | Quyết định |
|---|---|---|
| Q1 | Key Tingee của Tickee trong env | Bỏ. Mọi lời gọi Tingee dùng key của từng BTC; env chỉ còn `TINGEE_BASE_URL` và khóa mã hóa secret |
| Q2 | BTC chưa có tài khoản Tingee | Trang Tài khoản nhận tiền hướng dẫn tự đăng ký trên Tingee (các bước + link) |
| Q3 | Doanh thu Tickee | **MVP chưa thu phí.** BTC trả phí dịch vụ Tingee (Token) trực tiếp cho Tingee |
| Q4 | Định tuyến IPN | URL IPN riêng cho mỗi BTC (`/v1/payments/tingee/ipn/{ipnKey}`); chọn secret theo `ipnKey` trước khi đọc body |
| Q5 | Tài khoản VietinBank (`970415`) trong danh sách | Hiện mờ, không chọn được, ghi "Chưa hỗ trợ VietinBank", cho tới khi Tingee trả lời câu hỏi đang mở ở AD-36 |

## 2. Phân tích tác động (kết quả checklist)

| Mục | Trạng thái | Ghi chú |
|---|---|---|
| 1.1 Story kích hoạt | [x] | Story 2.6 |
| 1.2 Loại vấn đề | [x] | Yêu cầu mới / đổi chiến lược tích hợp |
| 1.3 Bằng chứng | [x] | Tài liệu Tingee ở §1 |
| 2.1 Epic hiện tại | [x] | Epic 2 vẫn hoàn thành được: làm lại 2.6, viết lại AC 2.13 |
| 2.2 Thay đổi cấp epic | [x] | Không thêm, không bỏ epic |
| 2.3 Epic tương lai | [!] | Epic 3 (3.4, 3.5, 3.6), Epic 4 (4.1, 4.2, 4.5, 4.7) đổi AC |
| 2.4 Epic lỗi thời / epic mới | [N/A] | Không |
| 2.5 Thứ tự epic | [N/A] | Giữ nguyên |
| 3.1 PRD | [!] | Tổng quan (doanh thu), thuật ngữ, FR-5, FR-6, FR-34, NFR-6, phụ thuộc, rủi ro, câu hỏi mở |
| 3.2 Architecture | [!] | AD-5, AD-6, AD-7, AD-9, AD-10, AD-32, AD-35, AD-36, ER, bản đồ năng lực |
| 3.3 UX | [!] | EXPERIENCE.md (IA, banner, trạng thái Tài khoản nhận tiền, Flow 2), DESIGN.md (tone) |
| 3.4 Artifact khác | [!] | `.env.example`, README, config Zod, Tingee fake, test hợp đồng (Story 4.7) |
| 4.1 Sửa trực tiếp | Viable | Effort trung bình, rủi ro trung bình |
| 4.2 Rollback | Viable một phần | Chỉ phần luồng Merchant con/OTP của commit `178bd2c` |
| 4.3 Xem lại MVP | Viable | Không giảm phạm vi; bỏ thu phí ở MVP (Q3) |
| 4.4 Chọn hướng | [x] | Hybrid: sửa trực tiếp tài liệu + làm lại một phần Story 2.6 |

### Epic
- **Epic 2:** Story 2.6 làm lại theo AC mới (§4.3). Story 2.13 viết lại AC; Story 2.10 và 2.11 không đổi (`publishReadiness` vẫn đọc "đã liên kết").
- **Epic 3:** 3.4 tạo link bằng key của BTC và `vaAccountNumber` đã chọn. 3.5 nhận IPN theo URL riêng của BTC. 3.6 đổi nhánh "Merchant lệch" và nhánh `orderId` lạ.
- **Epic 4:** 4.1 Đối soát bù bằng key đã chụp vào Đơn. 4.2 thêm lý do `credential_invalid`. 4.5 đọc Token bằng key BTC, mua Token ở portal Tingee của BTC. 4.7 bỏ credential Tingee theo môi trường; test hợp đồng dùng tài khoản merchant UAT để thử.

### Tài liệu
- **PRD:** câu doanh thu ở §1 không còn đúng (Q3). FR-5 đổi cơ chế. FR-6 (KYC qua Tingee) thành việc BTC tự làm trên Tingee. FR-34 đổi nguồn Token. NFR-6 thêm mã hóa secret BTC. Bảng phụ thuộc, R-1, R-4 và câu hỏi mở #3, #4 cũng đổi.
- **Architecture:** trái AD-9 hiện tại ("Secret Tingee chỉ đọc từ env"). Thêm bảng credential mã hóa theo mẫu AD-23. Đổi AD-6 (`merchantId` → `vaAccountNumber`), AD-7 (định tuyến IPN, chọn secret), AD-32 (lý do mới), AD-35 (chụp tài khoản nhận tiền thay `sub_merchant_id`), AD-36 (env).
- **UX:** trang Tài khoản nhận tiền có 3 bước: nhập key → chọn tài khoản → làm theo hướng dẫn cấu hình portal. Bỏ trạng thái và banner "Chỉ QR tĩnh".

### Kỹ thuật (so với commit `178bd2c`)

| Phần | Giữ | Bỏ / thay |
|---|---|---|
| `tingee/signing.ts`, test vector | Giữ | — |
| `tingee/errors.ts` | Giữ khung, sửa bảng mã | Bỏ `BANK_OTP_*`, `PAYOUT_ACCOUNT_INVALID`, `PAYOUT_ACCOUNT_IN_USE`; thêm `TINGEE_CREDENTIAL_INVALID` (92, 97, 1133) |
| `tingee/tingee.client.ts` | Giữ `post()` (ký, timeout, envelope, log an toàn) | Client nhận credential theo từng lời gọi thay vì từ env; bỏ `createMerchant`/`createVa`/`confirmVa`, thêm `listAccounts` (`get-va-paging`) |
| Tingee fake | Giữ server, kiểm chữ ký, ghi request | Nhiều cặp key (mỗi key một danh sách tài khoản), thêm `get-va-paging`; bỏ kịch bản OTP |
| `organizer` | Giữ khung service/controller, audit, notices `PAYOUT_ACCOUNT_NOT_LINKED` | Bảng `tingee_credentials` mới; `payout_accounts` thành tài khoản đã chọn; bỏ `organizations.tingee_merchant_id`, trạng thái `linking`/`awaiting_otp` và notice `PAYOUT_ACCOUNT_LINKING` |
| Migration `0008` | — | Viết lại (chưa merge). DB local đã chạy `0008` cũ phải dọn tay: lệnh dọn ghi trong spec mới |
| Config | Giữ `TINGEE_BASE_URL` | Bỏ `TINGEE_CLIENT_ID`, `TINGEE_SECRET_TOKEN`; thêm `TINGEE_CREDENTIAL_KEYS` (khóa có phiên bản) |
| Web | Giữ khung trang, `OwnerOnly`, banner theo vai | Thay form ngân hàng + bước OTP bằng: form key → danh sách tài khoản → thẻ đã liên kết + hướng dẫn IPN |

## 3. Hướng đi đề xuất

**Chọn: Hybrid.** Sửa trực tiếp tài liệu kế hoạch, và rollback một phần Story 2.6 (luồng Merchant con/OTP). Phần dùng chung giữ lại để làm lại 2.6.

**Lý do:**
- Story 2.6 chưa merge và Epic 3 chưa bắt đầu, nên đổi lúc này là rẻ nhất.
- Luồng mới đơn giản hơn: không còn bộ trường riêng cho từng ngân hàng, không OTP, không Merchant con.
- Luồng mới mở cho mọi ngân hàng và mọi loại tài khoản Tingee hỗ trợ, kể cả tài khoản doanh nghiệp.

**Rủi ro và cách giảm:**
1. **Lộ secret của BTC.**
   - Secret mã hóa AES-256-GCM, khóa có phiên bản từ env (mẫu AD-23).
   - Không bao giờ trả secret về web, không log; Client ID hiện dạng che.
   - Đổi key phải xác nhận lại (`REAUTH_REQUIRED`), ghi audit và gửi email cảnh báo.
   - **Câu hỏi cho Tingee (chặn Closed Beta có phí):** key merchant có gọi được Chi hộ hoặc rút tiền không, có tạo key giới hạn quyền không?
2. **BTC cấu hình portal sai** (chưa dán URL IPN, chưa cho phép tài khoản đã chọn).
   - Tickee không kiểm tra được bằng API.
   - Trang hiện checklist cấu hình kèm URL IPN để sao chép.
   - Đối soát bù (Story 4.1) bắt các Đơn bị mất IPN.
   - Đề xuất thêm nút "Kiểm tra kết nối" ở Epic 3: tạo link thử 2.000đ rồi hủy, nếu Tingee có API hủy link.
3. **BTC thu hồi hoặc đổi key trên Tingee.** Lời gọi trả `92`/`97` thì cờ `payment_service_status` = `suspended` (`reason: credential_invalid`). Owner thấy banner danger và nhập lại key.
4. **Mất doanh thu ở MVP** (Q3): chấp nhận. Cách thu phí quyết sau MVP.

**Ước lượng:**
- Sửa tài liệu: trong phiên này, sau khi duyệt.
- Làm lại Story 2.6: một lượt `bmad-build` (khoảng 60% code `178bd2c` dùng lại được).
- Epic 3 và 4: viết theo AC mới, không tăng khối lượng đáng kể.
- Không ảnh hưởng mốc Closed Beta, nhưng câu hỏi về quyền của API key (rủi ro 1) phải có trả lời trước khi bán Vé có phí.

## 4. Chi tiết đề xuất sửa

### 4.1 PRD (`prds/prd-tickee-2026-10-27/prd.md`)

**§1 Tổng quan (dòng 26):**
- CŨ: `Tickee chỉ thu phí dịch vụ theo từng giao dịch dưới dạng Token của Tingee.`
- MỚI: `Ở MVP Tickee chưa thu phí; BTC chỉ trả phí dịch vụ của Tingee (Token) trực tiếp cho Tingee. Cách Tickee thu phí sẽ chốt sau MVP.`

**Người không dùng (dòng 48):**
- CŨ: `BTC không có tài khoản tại một trong 14 ngân hàng Tingee hỗ trợ.`
- MỚI: `BTC không có (hoặc không muốn mở) tài khoản merchant Tingee.`

**Hành trình BTC (dòng 72):**
- CŨ: `Hệ thống tạo Merchant con và báo BTC dùng được QR động hay chỉ QR tĩnh … Closed Beta chưa yêu cầu KYC`
- MỚI: `BTC nhập Client ID và Secret Token Tingee của mình, chọn tài khoản nhận tiền trong danh sách tài khoản đã liên kết trên Tingee, rồi dán URL IPN của Tickee vào portal Tingee.`

**Quy tắc (dòng 97):**
- CŨ: `Mỗi BTC có đúng một Merchant con`
- MỚI: `Mỗi BTC có tối đa một bộ credential Tingee hiện hành và một tài khoản nhận tiền hiện hành (một VA trong tài khoản Tingee của BTC)`

**Thuật ngữ:**
- Dòng 102 (`Master Merchant / Merchant con — …`): **xóa**.
- Thêm `**Credential Tingee** — Client ID và Secret Token của tài khoản merchant Tingee của BTC; Tickee lưu Secret Token đã mã hóa và không hiển thị lại.`
- Thêm `**Tài khoản nhận tiền** — Một tài khoản (VA) BTC đã liên kết trên Tingee và chọn trên Tickee để nhận tiền vé.`
- Dòng 116 (Token):
  - CŨ: `Tingee trừ Token mỗi khi gửi IPN về một giao dịch.`
  - MỚI: `Tingee trừ Token trên tài khoản Tingee của BTC mỗi khi gửi IPN về một giao dịch.`

**FR-5 (dòng 209–217), viết lại:**
> #### FR-5: Tài khoản nhận tiền
> Owner kết nối tài khoản merchant Tingee của BTC bằng Client ID và Secret Token, rồi chọn một tài khoản đã liên kết trên Tingee để nhận tiền vé.
>
> **Hệ quả:**
> - Tickee kiểm tra credential bằng cách đọc danh sách tài khoản từ Tingee. Credential sai thì báo tại chỗ, không lưu.
> - Danh sách chỉ cho chọn tài khoản đang hoạt động; tài khoản VietinBank hiện nhưng không chọn được ("Chưa hỗ trợ VietinBank").
> - Tingee chưa có tài khoản nào thì trang hướng dẫn liên kết trên Tingee rồi tải lại.
> - Sau khi chọn, trang hiện URL IPN riêng của BTC và các bước cấu hình cổng thanh toán trên portal Tingee.
> - Chưa có tài khoản nhận tiền thì không mở bán được Sự kiện có phí; Sự kiện miễn phí vẫn mở bán được.
> - Tickee không lưu số dư hay tiền của BTC; Secret Token chỉ lưu dạng mã hóa, không bao giờ hiển thị lại.
> - BTC chưa có tài khoản Tingee: trang hướng dẫn đăng ký tại Tingee (đăng ký, liên kết ngân hàng, lấy API key).

**FR-6 (dòng 219–222):**
- CŨ: `Owner hoàn tất KYC qua Tingee …`
- MỚI: `KYC do BTC làm trực tiếp với Tingee khi mở tài khoản merchant; Tickee không tham gia.` (giữ số FR để không đánh số lại)

**FR-34 · Hệ quả:**
- Dòng 481:
  - CŨ: `Số dư và hạn mức được đọc từ Tingee.`
  - MỚI: `Số dư và hạn mức được đọc từ Tingee bằng credential của BTC.`
- Dòng 484:
  - CŨ: `Nút "mua thêm Token" chuyển Owner sang luồng mua Token của Tingee. [ASSUMPTION: Tickee không tự bán Token]`
  - MỚI: `Nút "mua thêm Token" mở portal Tingee của BTC; Tickee không bán Token.`

**FR-19 (dòng 349/354):** chữ ký IPN kiểm bằng Secret Token của BTC sở hữu URL IPN đã nhận.

**NFR-6 (dòng 518):** thêm `Secret Token Tingee của BTC mã hóa khi lưu (AES-256-GCM, khóa có phiên bản), không trả về trình duyệt, không ghi log.`

**Bảng phụ thuộc (dòng 530–534):**
- Dòng `Tingee: Master Merchant` → `Tingee: Tài khoản & Định danh | Đọc danh sách tài khoản của BTC (get-va-paging) (FR-5) | Có`.
- Hai dòng QR động / QR tĩnh: **xóa** (đã bị Gateway thay, AD-6).
- Dòng Token: `Tingee chưa xác nhận API` → `Tingee chưa xác nhận API đọc Token bằng key merchant`.

**Rủi ro:**
- R-1 (dòng 562): `BTC chưa KYC` → `BTC cấu hình cổng thanh toán trên portal Tingee sai (thiếu URL IPN, chưa cho phép tài khoản đã chọn)`. Giảm thiểu bằng checklist cấu hình (FR-5) và Đối soát bù (FR-20).
- R-4 (dòng 565): xóa câu `Khuyến khích dùng tài khoản có QR động (FR-5)`.
- Thêm R mới: `Lộ Secret Token của BTC`. Giảm thiểu: mã hóa, xác nhận lại khi đổi, audit, hỏi Tingee về key giới hạn quyền.

**Phạm vi:**
- Dòng 586: `Liên kết tài khoản nhận tiền và tạo Merchant con, chưa có KYC trong Closed Beta` → `Kết nối tài khoản Tingee của BTC và chọn tài khoản nhận tiền`.
- Dòng 631: bỏ chữ `Merchant con`.

**§13 Câu hỏi mở:**
- #3: `… theo Merchant con … xác nhận … tạo Merchant con khi BTC chưa KYC` → `Tingee có API đọc số dư, hạn mức Token và trạng thái dịch vụ gọi bằng key của merchant không? Key merchant có giới hạn quyền được không (không cho Chi hộ)?`
- #4 (QR tĩnh): đánh dấu đóng — *Đã đóng 03/11/2026: thanh toán chỉ qua Gateway (AD-6), không dùng QR tĩnh.*

**§11.3 Thay đổi so với BRD (thêm dòng):** `Tickee không làm Master Merchant (BRD 43, 110, D-02): BTC dùng tài khoản merchant Tingee của mình (Sprint Change Proposal 03/11/2026).`

**Giữ nguyên:** FR-4 (chỉ Owner), dòng 157 (xác nhận lại khi đổi tài khoản nhận tiền), dòng 215 và 217, FR-16/17 (đã bị AD-6 thay; ngoài phạm vi đề xuất này).

### 4.2 Architecture (`architecture/architecture-tickee-2026-10-28/ARCHITECTURE-SPINE.md`)

**Nguồn (dòng 18, 418):** `Master Merchant` → `Tài khoản & Định danh (get-va-paging)`.

**AD-10 (dòng 33):**
- CŨ: `organizer` sở hữu `Merchant con và trạng thái liên kết tài khoản nhận tiền`
- MỚI: `organizer` sở hữu `tingee_credentials` (Client ID, Secret Token mã hóa, phiên bản khóa, `ipn_key`) và `payout_accounts` (tài khoản nhận tiền đã chọn: VA, ngân hàng, 4 số cuối, tên chủ tài khoản, credential dùng để chọn)

**AD-5 (dòng 138):** `tạo link, liên kết tài khoản và tạo Merchant con, đọc Token, dò trạng thái dịch vụ` → `tạo link, đọc danh sách tài khoản của BTC, đọc Token, dò trạng thái dịch vụ`.

**AD-6 (dòng 142–144):**
- `với merchantId = Merchant con của BTC` → `ký bằng credential của BTC (chụp vào Đơn), vaAccountNumber = tài khoản nhận tiền hiện hành của BTC (không gửi merchantId)`.
- `Không cho liên kết tài khoản VietinBank (970415, mã lỗi BANK_NOT_SUPPORTED)` → `Không cho chọn tài khoản VietinBank (970415) làm tài khoản nhận tiền (BANK_NOT_SUPPORTED) cho tới khi Tingee trả lời câu hỏi ở AD-36`.

**AD-7 (dòng 150, 159):**
- Endpoint IPN là `POST /v1/payments/tingee/ipn/:ipnKey`. `ipnKey` là chuỗi ngẫu nhiên 128 bit (base64url), mỗi BTC một chuỗi, không phải secret.
- Server tìm BTC theo `ipnKey` **trước khi** đọc body. `ipnKey` lạ thì trả 404 và log.
- Kiểm `x-signature` bằng Secret Token hiện hành của BTC, rồi tới các credential cũ còn giữ (AD-35).
- Dòng 159 (`merchantId` khác `orders.sub_merchant_id` …) → `Đơn của orderId không thuộc BTC sở hữu ipnKey, hoặc vaAccountNumber khác orders.payout_account → nhánh Tài khoản lệch`.
- `orderId` không theo định dạng mã Đơn Tickee (AD-20) → lưu event, trả `00`, không tạo `review_item` (BTC dùng Tingee cho việc khác).

**AD-9 (dòng 174), viết lại:**
> Chỉ mô-đun `tingee` gọi HTTP sang Tingee và biết tên field của Tingee. Mọi lời gọi nhận credential của một BTC làm tham số (do `organizer` giải mã ngay trước khi gọi, không giữ trong bộ nhớ lâu hơn lời gọi).
>
> Adapter làm các việc:
> - Ký request. Gateway dùng timestamp UNIX ms; API Tài khoản & Định danh dùng `yyyyMMddHHmmssSSS` UTC+7.
> - Đổi mã lỗi Tingee thành lỗi miền: `TINGEE_CREDENTIAL_INVALID` (92, 97, 1133), `MERCHANT_SUSPENDED` (1007, 1034), `BANK_NOT_SUPPORTED`.
> - Đổi chuỗi thời gian UTC+7 thành `timestamptz`.
>
> Server đồng bộ giờ bằng NTP. Env chỉ có `TINGEE_BASE_URL` và `TINGEE_CREDENTIAL_KEYS` (danh sách khóa AES-256-GCM có phiên bản, mẫu AD-23); không có credential Tingee nào trong env. Secret Token không bao giờ trả về web hay ghi log; Client ID hiển thị dạng che.
>
> Repo có Tingee fake (`apps/api/test/tingee-fake`) với nhiều cặp key, mỗi cặp có một danh sách tài khoản. Fake ký IPN bằng secret của từng BTC, giả lập đọc danh sách tài khoản, tạo link và tra trạng thái. Mọi test tự động trừ test hợp đồng dùng fake.

**AD-32 (dòng 331):**
- `reason` thêm `credential_invalid`: bật khi lời gọi bằng key của BTC trả `TINGEE_CREDENTIAL_INVALID`. Tắt khi Owner lưu credential mới hợp lệ, hoặc bấm "Kiểm tra lại" mà Tingee chấp nhận key.
- `tingee.getMerchantServiceStatus()` → `tingee.getMerchantServiceStatus(credential)`.
- `Token đọc trực tiếp từ Tingee` → `Token đọc trực tiếp từ Tingee bằng credential của BTC`.

**AD-35 (dòng 349):**
- CŨ: `orders.sub_merchant_id chụp lúc tạo link`
- MỚI: `orders.payout_account_id chụp lúc tạo link (trỏ tới tài khoản nhận tiền và credential đã dùng)`
- Thêm: `Credential và tài khoản nhận tiền cũ không xóa khi đổi; secret cũ giữ (mã hóa) cho IPN và Đối soát bù của Đơn còn mở.`

**AD-36 (dòng 360, Story 4.7):** `mỗi nơi một bộ credential Tingee riêng (UAT/UAT/PROD)` → `mỗi nơi một TINGEE_BASE_URL (fake/UAT/PROD) và một bộ TINGEE_CREDENTIAL_KEYS riêng; credential là của từng BTC. Test hợp đồng ở staging dùng một tài khoản merchant UAT để thử (secret trong secret store của CI).`

**Thuật ngữ, ER, bảng năng lực:**
- Dòng 372: xóa `Merchant con = sub_merchant`.
- Dòng 453: `liên kết tài khoản` → `đọc danh sách tài khoản`.
- Dòng 476: `ORGANIZATION ||--o| SUB_MERCHANT : "liên kết"` → `ORGANIZATION ||--o{ TINGEE_CREDENTIAL : "kết nối"` và `TINGEE_CREDENTIAL ||--o{ PAYOUT_ACCOUNT : "chọn"`.
- Dòng 500: sửa theo AD-9 mới.

**Câu hỏi cho Tingee (dòng 528–535):**
- Thay câu `trạng thái dịch vụ và Token của Merchant con` bằng `… gọi bằng key của merchant`.
- Giữ câu VietinBank.
- Thêm `create-link với vaAccountNumber không nằm trong "Tài khoản cho phép thanh toán" thì trả lỗi gì?`
- Thêm `Key merchant có giới hạn quyền được không (không cho Chi hộ)?`
- Thêm `URL IPN chỉ cấu hình được qua portal hay có API?`

**Dòng 548:** `FR-5 (chặn VietinBank)` → `FR-5 (không cho chọn tài khoản VietinBank)`.

### 4.3 Epics (`epics.md`)

**Tóm tắt yêu cầu:** đồng bộ các dòng 18, 34, 35, 136, 139, 146, 148, 168–169, 175, 193, 235, 257 theo §4.1–4.2:
- FR-5, FR-6 viết lại;
- AD-6, AD-9, AD-32, AD-35 theo bản mới;
- UX-DR40 thêm trạng thái "credential sai" và "chưa có tài khoản trên Tingee", bỏ "đang liên kết", "liên kết thất bại" và QR.

Các dòng 53 và 269 (FR-17 QR tĩnh): đánh dấu đã bị AD-6 thay.

**Story 2.6 (viết lại toàn bộ, giữ key `2-6-liên-kết-tài-khoản-nhận-tiền`):**

> ### Story 2.6: Liên kết tài khoản nhận tiền
>
> As a Owner,
> I want kết nối tài khoản Tingee của CLB và chọn tài khoản nhận tiền,
> So that tiền vé chuyển thẳng vào tài khoản của tôi.
>
> **Acceptance Criteria:**
>
> **Given** mô-đun `tingee` là nơi duy nhất gọi Tingee
> **When** gọi `POST /v1/get-va-paging`
> **Then** adapter nhận credential của BTC làm tham số, ký request (`yyyyMMddHHmmssSSS` UTC+7, HMAC-SHA512), timeout có giới hạn, đổi mã lỗi Tingee thành lỗi miền (`TINGEE_CREDENTIAL_INVALID`, `MERCHANT_SUSPENDED`, `PAYMENT_PROVIDER_UNAVAILABLE`) (AD-9)
> **And** env chỉ có `TINGEE_BASE_URL` và `TINGEE_CREDENTIAL_KEYS`; Tingee fake ở `apps/api/test/tingee-fake` có nhiều cặp key, mỗi cặp một danh sách tài khoản; mọi test tự động (trừ test hợp đồng) dùng fake
>
> **Given** tôi là Owner ở trang Tài khoản nhận tiền, BTC chưa kết nối Tingee
> **When** tôi nhập Client ID và Secret Token rồi bấm "Kết nối"
> **Then** server gọi Tingee ngoài transaction DB (AD-5); key đúng thì lưu credential (Secret Token mã hóa AES-256-GCM, khóa có phiên bản) và hiện danh sách tài khoản `active` của BTC trên Tingee (ngân hàng, 4 số cuối, tên chủ tài khoản)
> **And** key sai → lỗi tại chỗ "Client ID hoặc Secret Token không đúng." và không lưu gì; Tingee tạm lỗi → "Tingee tạm lỗi, thử lại sau ít phút." + "Thử lại", dữ liệu đã nhập giữ nguyên
> **And** Secret Token không bao giờ trả về trình duyệt hay ghi log; Client ID hiện dạng che
>
> **Given** danh sách tài khoản đã hiện
> **When** tôi chọn một tài khoản và bấm "Dùng tài khoản này"
> **Then** `organizer` lưu tài khoản nhận tiền (VA, ngân hàng, 4 số cuối, tên chủ tài khoản); dashboard hết banner "Chưa liên kết"; trang hiện thẻ tài khoản đã liên kết; audit ghi lại (không ghi giá trị)
> **And** tài khoản VietinBank (`970415`) hiện mờ kèm "Chưa hỗ trợ VietinBank", không chọn được; API cũng từ chối với `BANK_NOT_SUPPORTED` (AD-6)
> **And** Tingee chưa có tài khoản nào → `empty-state` "Tài khoản Tingee của bạn chưa liên kết tài khoản ngân hàng nào." + link tới portal Tingee + "Tải lại"
>
> **Given** BTC đã có tài khoản nhận tiền
> **When** Owner mở trang
> **Then** thấy URL IPN riêng của BTC (`/v1/payments/tingee/ipn/{ipnKey}`) với nút "Sao chép" và các bước cấu hình cổng thanh toán trên portal Tingee: dán URL IPN, chọn tài khoản vừa chọn trong "Các tài khoản cho phép thanh toán"
>
> **Given** BTC chưa có tài khoản Tingee
> **When** Owner mở trang
> **Then** thấy hướng dẫn ngắn: đăng ký tài khoản merchant Tingee, liên kết tài khoản ngân hàng, lấy API key, kèm link tới Tingee
>
> **Given** BTC chưa có tài khoản nhận tiền
> **When** Owner hoặc Admin xem dashboard
> **Then** Owner thấy banner danger "Liên kết tài khoản nhận tiền để bán Vé có phí." + "Liên kết ngay"; Admin thấy "Nhờ Owner liên kết tài khoản nhận tiền."; Admin mở trang Tài khoản nhận tiền nhận `empty-state` "Chỉ Owner xem được mục này."; API trả `FORBIDDEN_ROLE` (FR-4)

**Story 2.13 (viết lại AC, giữ key):**

> As a Owner,
> I want đổi tài khoản nhận tiền hoặc đổi key Tingee của CLB,
> So that tiền vé về đúng tài khoản khi CLB đổi ngân hàng hoặc thay key trên Tingee.
>
> **Given** BTC đã có tài khoản nhận tiền
> **When** Owner bấm "Đổi tài khoản nhận tiền" hoặc "Đổi key Tingee"
> **Then** yêu cầu xác nhận lại ngay lúc thao tác (`REAUTH_REQUIRED`): TOTP nếu đã bật 2FA, chưa bật thì OTP email; rồi hiện danh sách tài khoản (hoặc form key rồi danh sách) như Story 2.6; cùng quy tắc VietinBank và lỗi tại chỗ (FR-5, AD-6, AD-26)
>
> **Given** chọn xong tài khoản mới (với key hiện hành hoặc key mới)
> **When** lưu
> **Then** tài khoản mới thành hiện hành cho mọi Đơn tạo **sau** thời điểm đổi; Đơn đã có link giữ `orders.payout_account_id` cũ, nên IPN và Đối soát bù của các Đơn đó vẫn dùng credential cũ (AD-35)
> **And** credential và tài khoản cũ được giữ (secret vẫn mã hóa), không xóa
> **And** audit ghi người đổi, thời điểm, 4 số cuối tài khoản cũ và mới; email cảnh báo gửi Owner và mọi Admin
> **And** `ipnKey` của BTC không đổi khi đổi key (BTC không phải dán lại URL IPN)
>
> **Given** key mới sai hoặc Tingee lỗi
> **When** lưu
> **Then** tài khoản và key cũ vẫn là hiện hành, không gián đoạn bán Vé
>
> **Given** BTC đã thu hồi key cũ trên Tingee mà còn Đơn `pending` dùng nó
> **When** Đối soát bù gọi Tingee bằng key cũ
> **Then** nhận `TINGEE_CREDENTIAL_INVALID` → Đơn đi luồng hết hạn và cảnh báo vận hành; IPN đã ký vẫn kiểm được bằng secret cũ; không chặn BTC bán bằng key mới
>
> **Given** Admin
> **When** mở thao tác đổi
> **Then** không thấy nút; API trả `FORBIDDEN_ROLE` (FR-4)

**Story 3.4:**
- Dòng 1011: `với merchantId = Merchant con của BTC` → `ký bằng credential của tài khoản nhận tiền hiện hành, vaAccountNumber = VA đã chọn (không gửi merchantId)`.
- Dòng 1012: `chụp orders.sub_merchant_id` → `chụp orders.payout_account_id`.
- Dòng 1029–1031: `MERCHANT_SUSPENDED` → `MERCHANT_SUSPENDED hoặc TINGEE_CREDENTIAL_INVALID`.
- Dòng 1033–1036 (BTC chỉ có QR tĩnh): **xóa** AC này.

**Story 3.5:**
- Dòng 1048: thêm `endpoint POST /v1/payments/tingee/ipn/:ipnKey; tìm BTC theo ipnKey trước khi đọc body (ipnKey lạ → 404, log); secret = Secret Token hiện hành của BTC, rồi tới các credential cũ còn giữ`.
- Dòng 1074: `fake ký IPN bằng secret test` → `fake ký IPN bằng secret của từng BTC`; phủ thêm IPN ký bằng secret của BTC khác gửi vào URL của BTC này (từ chối).

**Story 3.6:**
- Nhánh 1: `orderId không tồn tại` → `orderId không theo định dạng mã Đơn Tickee → lưu event, trả 00, không tạo review_item; orderId đúng định dạng nhưng không tồn tại → nhánh unmatched gắn BTC sở hữu ipnKey`.
- Nhánh 2: `merchantId khác orders.sub_merchant_id → nhánh Merchant lệch` → `Đơn không thuộc BTC sở hữu ipnKey, hoặc vaAccountNumber khác tài khoản đã chụp → nhánh Tài khoản lệch`.
- Dòng 1123–1124, 1135: viết lại theo hai nhánh trên. Mọi IPN đã qua chữ ký đều xác định được BTC (theo `ipnKey`), nên bỏ trường hợp "Merchant không ứng với BTC nào".

**Story 4.1 (dòng 1288):** Đối soát bù gọi Tingee bằng credential chụp trong `orders.payout_account_id`.

**Story 4.2 (dòng 1313–1321):** `reason` thêm `credential_invalid`. `tingee.getMerchantServiceStatus()` → gọi bằng credential hiện hành. Owner lưu key mới hợp lệ cũng tắt cờ `credential_invalid`.

**Story 4.5 (dòng 1403, 1416):**
- `đọc trực tiếp từ Tingee mỗi lần xem qua adapter` → `… bằng credential của BTC`.
- `sang luồng mua Token của Tingee; Tickee không tự bán Token` → `mở portal Tingee của BTC; Tickee không bán Token`.

**Story 4.7:**
- Dòng 1456: `mỗi nơi một bộ credential Tingee riêng` → `mỗi nơi một TINGEE_BASE_URL và một bộ TINGEE_CREDENTIAL_KEYS riêng; credential Tingee là của từng BTC`.
- Dòng 1471: `liên kết tài khoản` → `đọc danh sách tài khoản (get-va-paging)`, chạy bằng tài khoản merchant UAT để thử.

### 4.4 UX

**EXPERIENCE.md:**
- **IA (dòng 68):** `Liên kết qua Tingee; QR động hay chỉ QR tĩnh (FR-5)` → `Kết nối tài khoản Tingee, chọn tài khoản nhận tiền, URL IPN và hướng dẫn cấu hình (FR-5)`.
- **Banner (dòng 209, 221):** bỏ `Chỉ QR tĩnh` khỏi danh sách và bỏ mục ưu tiên `10. Chỉ QR tĩnh`. Thêm banner danger `Key Tingee không còn dùng được` + "Nhập lại key" (Owner) / "Nhờ Owner cập nhật key Tingee." (Admin), cùng mức ưu tiên với `Tạm ngừng bán` (AD-32 `credential_invalid`).
- **Trạng thái Tài khoản nhận tiền (dòng 303–306)**, thay ba dòng 304–306 bằng:

| Trạng thái | Hành vi |
|---|---|
| Chưa kết nối Tingee | Hướng dẫn 3 bước (đăng ký merchant Tingee, liên kết ngân hàng, lấy API key) + form Client ID, Secret Token, nút "Kết nối" |
| Đang kiểm tra key | Nút loading; lỗi tại chỗ: "Client ID hoặc Secret Token không đúng." / "Tingee tạm lỗi, thử lại sau ít phút." + "Thử lại", giữ dữ liệu |
| Chọn tài khoản | Danh sách thẻ (ngân hàng, `•••• 1234` `tabular-nums`, tên chủ tài khoản in hoa); VietinBank mờ + "Chưa hỗ trợ VietinBank"; rỗng → `empty-state` + link portal Tingee + "Tải lại" |
| Đã liên kết | Thẻ tài khoản + `status-badge` success "Đã liên kết"; khối "Cấu hình trên Tingee": URL IPN + "Sao chép" (toast "Đã sao chép"), checklist hai bước |
| Key không còn dùng được | `status-badge` danger "Key Tingee không còn dùng được" + "Nhập lại key" (qua xác nhận lại, Story 2.13) |

- **Flow 2 (dòng 469):** `liên kết tài khoản CLB qua Tingee. Kết quả hiện ngay: dùng được QR động.` → `dán Client ID và Secret Token lấy trên Tingee, chọn tài khoản CLB trong danh sách, rồi sao chép URL IPN dán vào portal Tingee.`
- **Giữ nguyên:** dòng 216 (banner #5), 303 (copy Owner/Admin), 482, `recipient-trust-block` (dòng 167, 412, 448; dữ liệu lấy từ tài khoản đã chọn).

**DESIGN.md (dòng 570):** `Đang liên kết → neutral · QR động → success · Chỉ QR tĩnh → warning · Liên kết thất bại → danger` → `Đã liên kết → success · Key không còn dùng được → danger`.

### 4.5 Sprint status (`implementation-artifacts/sprint-status.yaml`)

- `2-6-liên-kết-tài-khoản-nhận-tiền`: `review` → `in-progress` (làm lại).
- Không thêm hay bỏ story.
- `action_items`:
  - Sửa mục epic 4 đầu tiên (API Token): `Chốt với Tingee: API đọc Token và trạng thái dịch vụ gọi bằng key merchant (Story 4.2, 4.5); create-link với vaAccountNumber ngoài "Tài khoản cho phép thanh toán" trả lỗi gì (Story 3.4)`.
  - Thêm (epic 2, chặn bán Vé có phí ở Closed Beta): `Hỏi Tingee: key merchant có gọi được Chi hộ/rút tiền không, có tạo key giới hạn quyền không; nếu không thì ghi rủi ro chấp nhận vào PRD R-mới`.
- `epic-2-context.md` sẽ được dựng lại vì tài liệu kế hoạch mới hơn.

## 5. Bàn giao triển khai

**Phạm vi:** Moderate. Không thêm hay bỏ epic. Viết lại AC của 2.6 và 2.13, sửa AC ở 6 story Epic 3–4, đổi 6 quyết định kiến trúc, làm lại một story chưa merge.

| Vai | Việc |
|---|---|
| Mason (PO) | Duyệt đề xuất này. Hỏi Tingee hai câu ở §4.5 (quyền của key merchant; API Token/trạng thái dịch vụ bằng key merchant). Báo phía Tingee việc Tickee không còn làm Master Merchant (lệch BRD 43, 110, D-02) |
| Developer agent (phiên này) | Áp các sửa §4.1–4.4 vào PRD, Architecture, Epics, UX; cập nhật `sprint-status.yaml` (§4.5); ghi vào spec 2.6 cũ rằng spec đã bị thay theo đề xuất này |
| Developer agent (`bmad-build`, phiên mới) | Làm lại Story 2.6 trên `feat/2-6-lien-ket-tai-khoan-nhan-tien` theo AC mới, dựa trên phần "Giữ" của bảng Kỹ thuật §2; viết lại migration `0008`, kèm lệnh dọn DB local |
| Story 2.13, Epic 3, Epic 4 | Khi tới lượt, làm theo AC mới |

**Tiêu chí thành công:**
- Tài liệu kế hoạch không còn chỗ nào nói Tickee tạo Merchant con, dùng key Tingee của Tickee, hay hiển thị loại QR.
- Sau khi làm lại Story 2.6:
  - Owner nhập key đúng thì thấy danh sách tài khoản và chọn được một tài khoản; key sai thì báo tại chỗ và không lưu.
  - Secret Token chỉ có dạng mã hóa trong DB, không xuất hiện trong response hay log.
  - URL IPN hiện đúng cho từng BTC.
  - `pnpm turbo build typecheck lint:deps test` và Playwright pass.
