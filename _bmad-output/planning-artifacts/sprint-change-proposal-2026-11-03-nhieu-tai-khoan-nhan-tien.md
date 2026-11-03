---
title: 'Sprint Change Proposal: nhiều tài khoản nhận tiền, tài khoản mặc định, hủy liên kết'
date: '2026-11-03'
author: 'Mason (duyệt) · Developer agent (soạn)'
status: 'approved'
scope: 'minor'
trigger_story: '2.6'
---

# Sprint Change Proposal: nhiều tài khoản nhận tiền, tài khoản mặc định, hủy liên kết

## 1. Tóm tắt vấn đề

**Thay đổi:** Story 2.6 làm thêm ở commit `904eea4` (spec `implementation-artifacts/spec-2-6-huy-lien-ket-va-nhieu-tai-khoan-nhan-tien.md`):

- Một BTC liên kết được **nhiều tài khoản nhận tiền** trong danh sách tài khoản Tingee của mình, mỗi VA một lần.
- **Q1:** tài khoản liên kết đầu tiên tự thành **mặc định**, Owner đổi bằng "Đặt làm mặc định". Đơn mới nhận tiền vào tài khoản mặc định. Hủy tài khoản mặc định thì tài khoản liên kết sớm nhất còn lại thay chỗ.
- Owner **hủy liên kết** từng tài khoản. Đây là gỡ mềm: đặt `retired_at`, không xóa, không gọi Tingee. Hủy hết thì banner "Chưa liên kết tài khoản nhận tiền" hiện lại.
- **Q2:** "Dùng key khác" chỉ còn khi BTC **chưa từng** liên kết tài khoản nào. Từ đó về sau, đổi key là việc của Story 2.13.
- **Q3:** hủy liên kết chỉ cần `Dialog` xác nhận. Bước xác nhận lại (`REAUTH_REQUIRED`) sẽ thêm ở Story 2.13.

**Phân loại:** yêu cầu mới từ phía sản phẩm (Mason, 03/11/2026). Code đã xong và đã kiểm (`pnpm turbo build typecheck lint:deps test` và e2e 372/372 pass). Tài liệu kế hoạch vẫn theo mô hình "một tài khoản nhận tiền hiện hành".

**Bằng chứng mới từ tài liệu Tingee (developers.tingee.vn, đọc 03/11/2026):**
- `create-link` nhận `vaAccountNumber` (tùy chọn) để chỉ định tài khoản nhận tiền.
- IPN của Cổng thanh toán có 14 trường (`requestId`, `orderId`, `amount`, `paidAmount`, `description`, `orderInfo`, `status`, `statusCode`, `billId`, `customerEmail`, `paymentMethod`, `providerTransactionCode`, `paidAt`, `merchantId`), **không có trường nào cho biết số tài khoản hay VA nhận tiền**.
  - Điều kiện "`vaAccountNumber` khác tài khoản đã chụp" ở AD-7 và Story 3.5/3.6 vì vậy không kiểm được. Phải bỏ điều kiện này.
  - Chính vì IPN không có VA mà mỗi Đơn phải chụp tài khoản mặc định lúc tạo link.

## 2. Phân tích tác động (kết quả checklist)

| Mục | Trạng thái | Ghi chú |
|---|---|---|
| 1.1 Story kích hoạt | [x] | Story 2.6 (commit `904eea4`) |
| 1.2 Loại vấn đề | [x] | Yêu cầu mới từ phía sản phẩm |
| 1.3 Bằng chứng | [x] | Quyết định Q1–Q3 trong spec; tài liệu Tingee ở §1 |
| 2.1 Epic hiện tại | [x] | Epic 2 vẫn hoàn thành được: sửa AC 2.6 (khớp code) và viết lại AC 2.13 |
| 2.2 Thay đổi cấp epic | [x] | Không thêm, không bỏ epic; chỉ sửa câu tóm tắt Epic 2 |
| 2.3 Epic tương lai | [!] | Epic 3: 3.4 tạo link bằng tài khoản mặc định; 3.5/3.6 bỏ điều kiện VA. Epic 4: 4.1 không đổi (vẫn dùng credential chụp trong Đơn) |
| 2.4 Epic lỗi thời / mới | [N/A] | Không |
| 2.5 Thứ tự epic | [N/A] | Giữ nguyên |
| 3.1 PRD | [!] | Định nghĩa BTC (dòng 97), thao tác nhạy cảm (dòng 158), FR-5 |
| 3.2 Architecture | [!] | AD-10 (bảng mô-đun, dòng 33), AD-6, AD-7 (bảng xử lý IPN), AD-35, danh sách xác nhận lại (dòng 300) |
| 3.3 UX | [!] | EXPERIENCE.md: IA (dòng 68), trạng thái "Đã liên kết" (dòng 306), thêm trạng thái "Hủy liên kết", dòng `REAUTH_REQUIRED` (dòng 333). DESIGN.md dòng 570: thêm badge "Mặc định" |
| 3.4 Artifact khác | [N/A] | README, env và CI không đổi; migration `0009` đã có trong code |
| 4.1 Sửa trực tiếp | Viable | Effort thấp, rủi ro thấp: chỉ sửa tài liệu |
| 4.2 Rollback | Not viable | Code đã đúng ý Mason |
| 4.3 Xem lại MVP | N/A | Không đổi phạm vi MVP |
| 4.4 Chọn hướng | [x] | Sửa trực tiếp tài liệu (Option 1) |

## 3. Hướng đi đề xuất

**Chọn: sửa trực tiếp tài liệu** để khớp code và quyết định Q1–Q3.

Story 2.13 cũng được viết lại cho mô hình mới. Đổi key Tingee vẫn là trọng tâm của 2.13. Thêm vào đó là bước xác nhận lại và email cảnh báo cho các thao tác **đổi nơi nhận tiền của Đơn mới**: đặt mặc định, và hủy liên kết tài khoản mặc định. Đây là mục hoãn #11 của review 03/11.

**Rủi ro:**
- Thấp: tài liệu không còn lệch code.
- Ý mới cần Mason xác nhận trong đề xuất này: "Đặt làm mặc định" và hủy liên kết cần xác nhận lại ở Story 2.13 (Q3 đã hẹn phần hủy liên kết).

## 4. Chi tiết đề xuất sửa

### 4.1 PRD (`prds/prd-tickee-2026-10-27/prd.md`)

**Dòng 97, định nghĩa BTC:**
- CŨ: `Mỗi BTC có tối đa một bộ credential Tingee hiện hành và một tài khoản nhận tiền hiện hành (một VA trong tài khoản Tingee của BTC), và có một hoặc nhiều thành viên.`
- MỚI: `Mỗi BTC có tối đa một bộ credential Tingee hiện hành và một hoặc nhiều tài khoản nhận tiền (mỗi tài khoản là một VA trong tài khoản Tingee của BTC), trong đó đúng một tài khoản mặc định nhận tiền của Đơn mới; BTC có một hoặc nhiều thành viên.`

**Dòng 158, thao tác nhạy cảm:**
- CŨ: `Thao tác nhạy cảm (đổi tài khoản nhận tiền, chuyển quyền Owner) luôn yêu cầu xác nhận lại …`
- MỚI: `Thao tác nhạy cảm (đổi key Tingee, đổi tài khoản nhận tiền mặc định, hủy liên kết tài khoản nhận tiền, chuyển quyền Owner) luôn yêu cầu xác nhận lại …` (phần sau giữ nguyên)

**FR-5 (dòng 212–222):**
- Câu mở đầu:
  - CŨ: `… rồi chọn một tài khoản đã liên kết trên Tingee để nhận tiền vé.`
  - MỚI: `… rồi chọn một hoặc nhiều tài khoản đã liên kết trên Tingee để nhận tiền vé.`
- Thêm vào **Hệ quả** (sau dòng "Sau khi chọn, …"):
  - `Tài khoản liên kết đầu tiên là tài khoản mặc định; Đơn mới nhận tiền vào tài khoản mặc định. Owner đổi tài khoản mặc định được.`
  - `Owner hủy liên kết được từng tài khoản; Tickee chỉ ngừng dùng tài khoản đó (không xóa, không đổi gì trên Tingee). Hủy tài khoản mặc định thì tài khoản liên kết sớm nhất còn lại thành mặc định; hủy hết thì BTC quay về "chưa có tài khoản nhận tiền".`
  - `Đổi key Tingee chỉ làm được trên trang này khi BTC chưa từng liên kết tài khoản nào; sau đó là thao tác nhạy cảm, cần xác nhận lại.`

### 4.2 Architecture (`architecture/architecture-tickee-2026-10-28/ARCHITECTURE-SPINE.md`)

**Dòng 33, bảng mô-đun (`organizer`):**
- CŨ: `payout_accounts (tài khoản nhận tiền đã chọn: VA, ngân hàng, 4 số cuối, tên chủ tài khoản, credential dùng để chọn)`
- MỚI: `payout_accounts (các tài khoản nhận tiền đã chọn: VA, ngân hàng, 4 số cuối, tên chủ tài khoản, credential dùng để chọn, is_default, retired_at; mỗi VA hiện hành một lần, đúng một mặc định khi còn tài khoản)`

**AD-6, Rule:**
- CŨ: `` `vaAccountNumber` = tài khoản nhận tiền hiện hành của BTC (không gửi `merchantId`) ``
- MỚI: `` `vaAccountNumber` = VA của tài khoản nhận tiền mặc định của BTC lúc tạo link, ký bằng credential của chính tài khoản đó (không gửi `merchantId`) ``

**AD-7, bảng xử lý:**
- CŨ: `` | Đơn của `orderId` không thuộc BTC sở hữu `ipnKey`, hoặc `vaAccountNumber` khác tài khoản nhận tiền chụp ở `orders.payout_account_id` | nhánh Tài khoản lệch … | ``
- MỚI: `` | Đơn của `orderId` không thuộc BTC sở hữu `ipnKey` | nhánh Tài khoản lệch … | ``
- Thêm một câu dưới bảng: `IPN của Cổng thanh toán không có trường số tài khoản/VA, nên không kiểm được tiền vào VA nào; tài khoản nhận tiền của Đơn lấy từ orders.payout_account_id.`

**AD-35, Rule:**
- CŨ: `` `orders.payout_account_id` chụp lúc tạo link (trỏ tới tài khoản nhận tiền và credential đã dùng), nên đổi tài khoản nhận tiền không ảnh hưởng Đơn đang mở. Credential và tài khoản nhận tiền cũ không xóa khi đổi; … ``
- MỚI: `` `orders.payout_account_id` chụp lúc tạo link (tài khoản mặc định lúc đó, trỏ tới credential đã dùng), nên đổi tài khoản mặc định hay hủy liên kết không ảnh hưởng Đơn đang mở. Credential và tài khoản nhận tiền cũ không xóa: hủy liên kết là gỡ mềm (`retired_at`); … ``

**Dòng 300, xác nhận lại:**
- CŨ: `Xác nhận lại cho thao tác nhạy cảm (đổi tài khoản nhận tiền, chuyển quyền Owner)`
- MỚI: `Xác nhận lại cho thao tác nhạy cảm (đổi key Tingee, đổi tài khoản nhận tiền mặc định, hủy liên kết tài khoản nhận tiền, chuyển quyền Owner)`

### 4.3 Epics (`epics.md`)

**Tóm tắt yêu cầu:**
- **Dòng 34 (FR-5):**
  - `chọn một tài khoản` → `chọn một hoặc nhiều tài khoản`.
  - Thêm câu: `Tài khoản liên kết đầu tiên là mặc định (Đơn mới nhận tiền vào đây), Owner đổi được; hủy liên kết từng tài khoản (gỡ mềm); đổi key chỉ khi BTC chưa từng liên kết, sau đó qua xác nhận lại.`
- **Dòng 136 (AD-6):** `` `vaAccountNumber` = tài khoản nhận tiền hiện hành `` → `` `vaAccountNumber` = VA của tài khoản nhận tiền mặc định ``.
- **Dòng 148 (AD-35):** `Credential và tài khoản nhận tiền cũ không xóa khi đổi.` → `Credential và tài khoản nhận tiền cũ không xóa khi đổi hay hủy liên kết (gỡ mềm).`
- **Dòng 311 (Epic 2):** `liên kết và đổi tài khoản nhận tiền` → `liên kết, đặt mặc định và hủy liên kết tài khoản nhận tiền, đổi key Tingee`.

**Story 2.6:**
- AC "Given danh sách tài khoản đã hiện":
  - CŨ: `Then organizer lưu tài khoản nhận tiền (VA, ngân hàng, 4 số cuối, tên chủ tài khoản); dashboard hết banner "Chưa liên kết"; …`
  - MỚI: `Then organizer lưu tài khoản nhận tiền (VA, ngân hàng, 4 số cuối, tên chủ tài khoản); tài khoản đầu tiên của BTC thành mặc định; dashboard hết banner "Chưa liên kết"; …`
- AC "Given BTC đã có tài khoản nhận tiền":
  - CŨ: `… chọn tài khoản vừa chọn trong "Các tài khoản cho phép thanh toán"`
  - MỚI: `… chọn mọi tài khoản đã liên kết trong "Các tài khoản cho phép thanh toán"`
- **Thêm AC:**

  > **Given** BTC đã có tài khoản nhận tiền
  > **When** Owner bấm "Thêm tài khoản" và chọn một tài khoản khác trong danh sách
  > **Then** tài khoản được thêm (không phải mặc định); tài khoản đã liên kết hiện "Đã liên kết" thay cho nút; chọn lại VA đang liên kết → `PAYOUT_ACCOUNT_ALREADY_LINKED`
  >
  > **Given** BTC có nhiều tài khoản
  > **When** Owner bấm "Đặt làm mặc định" ở một tài khoản
  > **Then** tài khoản đó thành mặc định (badge "Mặc định"), tài khoản cũ thôi là mặc định; Đơn mới nhận tiền vào tài khoản mặc định; audit ghi lại
  >
  > **Given** BTC đã có tài khoản nhận tiền
  > **When** Owner bấm "Hủy liên kết" và xác nhận trong `Dialog` nêu hậu quả
  > **Then** Tickee ngừng dùng tài khoản (gỡ mềm, không gọi Tingee); tài khoản mặc định bị hủy thì tài khoản liên kết sớm nhất còn lại thành mặc định; hủy hết thì banner "Chưa liên kết" hiện lại; trang nhắc bỏ chọn tài khoản đó trên portal Tingee
  >
  > **Given** BTC đã từng liên kết tài khoản (kể cả đã hủy hết)
  > **When** Owner mở trang
  > **Then** không có "Dùng key khác"; API từ chối gửi key với `PAYOUT_ACCOUNT_ALREADY_LINKED` (đổi key là Story 2.13)

**Story 2.13 (viết lại, giữ key):**

> ### Story 2.13: Đổi key Tingee và bảo vệ thao tác đổi nơi nhận tiền
>
> As a Owner,
> I want đổi key Tingee của CLB, và mọi thao tác đổi nơi nhận tiền đều phải xác nhận lại,
> So that tiền vé về đúng tài khoản khi CLB thay key, và phiên đăng nhập bị lộ không tự đổi được nơi nhận tiền.
>
> **Acceptance Criteria:**
>
> **Given** BTC đã từng liên kết tài khoản nhận tiền
> **When** Owner bấm "Đổi key Tingee"
> **Then** yêu cầu xác nhận lại (`REAUTH_REQUIRED`: TOTP nếu đã bật 2FA, chưa bật thì OTP email); rồi form key → danh sách tài khoản của key mới như Story 2.6; cùng quy tắc VietinBank và lỗi tại chỗ
>
> **Given** key mới đúng và Owner chọn tài khoản (tài khoản đầu tiên thành mặc định)
> **When** lưu
> **Then** credential mới thành hiện hành; mọi tài khoản của credential cũ bị hủy liên kết (gỡ mềm); Đơn đã có link giữ `orders.payout_account_id` cũ nên IPN và Đối soát bù vẫn dùng credential cũ (AD-35); `ipnKey` không đổi
> **And** audit ghi người đổi, thời điểm, 4 số cuối tài khoản mặc định cũ và mới; email cảnh báo gửi Owner và mọi Admin
>
> **Given** key mới sai hoặc Tingee lỗi
> **When** lưu
> **Then** key và các tài khoản cũ vẫn là hiện hành, không gián đoạn bán Vé
>
> **Given** BTC có tài khoản nhận tiền
> **When** Owner bấm "Đặt làm mặc định", hoặc "Hủy liên kết" (Story 2.6)
> **Then** yêu cầu xác nhận lại như trên trước khi thực hiện; đổi tài khoản mặc định (kể cả do hủy tài khoản mặc định) gửi email cảnh báo Owner và mọi Admin kèm 4 số cuối cũ và mới
>
> **Given** BTC đã thu hồi key cũ trên Tingee mà còn Đơn `pending` dùng nó
> **When** Đối soát bù gọi Tingee bằng key cũ
> **Then** nhận `TINGEE_CREDENTIAL_INVALID` → Đơn đi luồng hết hạn và cảnh báo vận hành; IPN đã ký vẫn kiểm được bằng secret cũ; không chặn BTC bán bằng key mới
>
> **Given** Admin
> **When** mở các thao tác trên
> **Then** không thấy nút; API trả `FORBIDDEN_ROLE` (FR-4)

**Story 3.4 (dòng 1018):** `ký bằng credential của tài khoản nhận tiền hiện hành, vaAccountNumber = VA đã chọn` → `ký bằng credential của tài khoản nhận tiền mặc định, vaAccountNumber = VA của tài khoản mặc định`. Thêm: `BTC không còn tài khoản nhận tiền nào → không tạo link, Hạng vé có phí "Tạm ngừng bán" (FR-5)`.

**Story 3.5/3.6:**
- Dòng 1088: `Đơn không thuộc BTC sở hữu ipnKey, hoặc vaAccountNumber khác tài khoản đã chụp (orders.payout_account_id) → nhánh Tài khoản lệch` → `Đơn không thuộc BTC sở hữu ipnKey → nhánh Tài khoản lệch (IPN không có trường VA, AD-7)`.
- Dòng 1129: bỏ vế `hoặc có vaAccountNumber khác tài khoản nhận tiền đã chụp ở orders.payout_account_id`.

### 4.4 UX

**EXPERIENCE.md:**
- **Dòng 68 (IA):** `chọn tài khoản nhận tiền` → `chọn, đặt mặc định và hủy liên kết tài khoản nhận tiền`.
- **Dòng 306, trạng thái "Đã liên kết":**
  - CŨ: `Thẻ tài khoản + status-badge success "Đã liên kết"; khối "Cấu hình trên Tingee": …, checklist hai bước.`
  - MỚI: `Danh sách tài khoản (ngân hàng, •••• 1234, tên chủ tài khoản); tài khoản mặc định có status-badge neutral "Mặc định", tài khoản khác có "Đặt làm mặc định"; mỗi tài khoản có "Hủy liên kết"; nút "Thêm tài khoản" mở danh sách Tingee (tài khoản đã liên kết hiện "Đã liên kết"). Khối "Cấu hình trên Tingee": URL IPN + "Sao chép" (toast "Đã sao chép"), checklist hai bước (bước 2: chọn mọi tài khoản đã liên kết).`
- **Thêm dòng:** `| Hủy liên kết | Tài khoản nhận tiền | Dialog "Hủy liên kết tài khoản này?" nêu hậu quả: tài khoản mặc định → tài khoản nào thành mặc định, hoặc hủy tài khoản cuối thì không bán được Vé có phí; nhắc bỏ chọn trên portal Tingee; nút "Hủy liên kết" (danger) và "Giữ tài khoản". |`
- **Dòng 333 (`REAUTH_REQUIRED`):** `Đổi tài khoản nhận tiền, Chuyển quyền Owner` → `Đổi key Tingee, Đặt làm mặc định, Hủy liên kết tài khoản nhận tiền, Chuyển quyền Owner (Story 2.13)`.

**DESIGN.md (dòng 570):** `Đã liên kết → success · Key không còn dùng được → danger` → `Đã liên kết → success · Mặc định → neutral · Key không còn dùng được → danger`.

## 5. Bàn giao triển khai

**Phạm vi:** Minor. Chỉ sửa tài liệu; code đã khớp (commit `904eea4`).

| Vai | Việc |
|---|---|
| Mason (PO) | Duyệt đề xuất này, đặc biệt câu "Đặt làm mặc định" và "Hủy liên kết" cần xác nhận lại ở Story 2.13 |
| Developer agent (phiên này) | Áp §4.1–4.4 vào PRD, Architecture, Epics và UX; đánh dấu hai mục hoãn liên quan trong `deferred-work.md` là đã xử lý; dựng lại `epic-2-context.md` khi `bmad-build` chạy story tiếp theo của Epic 2 |
| Story 2.13, Epic 3 | Khi tới lượt, làm theo AC mới |

**Tiêu chí thành công:**
- Tài liệu kế hoạch không còn chỗ nào nói "một tài khoản nhận tiền hiện hành".
- Không còn điều kiện kiểm `vaAccountNumber` trong IPN.
- Story 2.13 phủ đổi key, đặt mặc định và hủy liên kết.
- `sprint-status.yaml` không đổi (không thêm hay bỏ story).
