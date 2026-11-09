---
title: 'Sprint Change Proposal: đối chiếu spec sau Epic 2 (E2-4)'
date: '2026-11-09'
author: 'Mason (duyệt) · Developer agent (soạn)'
status: 'approved'
approved: '2026-11-09'
scope: 'moderate'
trigger: 'Retro Epic 2, action item E2-4 (E1–E5, B1, C8, D1)'
---

# Sprint Change Proposal: đối chiếu spec sau Epic 2 (E2-4)

## 1. Tóm tắt vấn đề

Retro Epic 2 (`implementation-artifacts/epic-2-retro-2026-11-09.md`) thấy tài liệu kế hoạch lệch với code đã ship, cộng một mâu thuẫn kế hoạch giữa Story 2.13 và AD-32/Story 4.2. Ba sprint change proposal giữa Epic 2 (30/10, 03/11 ×2) chỉ sửa phần liên quan trực tiếp, nên PRD, `epics.md` và spine còn chỗ cũ. Epic 3 (checkout) bắt đầu ngay sau đây và đọc đúng những chỗ này.

- **Loại:** tài liệu lệch so với thực tế đã ship; một mâu thuẫn kế hoạch (B1).
- **Phát hiện khi:** retro Epic 2, 09/11/2026. E2-4 là action item "trước Epic 3".
- **Bằng chứng** (kiểm lại trên code ngày 09/11):
  - `apps/api/src/modules/ordering/sellability.ts` `blockingReason`: `ended` xét trước `hidden`; spec 2.11-a ghi ngược lại (C8).
  - `organizer/members.service.ts:221` `MembersService.transferOwnership`; `epics.md` 2.14 ghi `flows.transferOwnership` (E2).
  - `admin/closed-beta.controller.ts:12` gọi thẳng `organizer.changeClosedBetaStatus`; spine:41 ghi admin "ghi qua `flows`" (D1).
  - Không có `ADMIN_ALLOWED_CIDRS`, "Đặt lại TOTP", S3 trong `apps/api/src`; FR-9 "trường bổ sung" chưa làm (`spec-2-9:33`) (E1).
  - PRD §3, FR-14–FR-17, NFR-1, §6, SM-2 vẫn mô tả QR động/tĩnh; spine:558-561 liệt kê việc cập nhật PRD chưa làm (E4).
  - `epics.md:890-896` (2.13 "không chặn BTC bán bằng key mới") so với `epics.md:1341` và AD-32 ("lời gọi bằng key của BTC" → `suspended`) (B1).
  - `spec-2-2-totp-cho-owner.md` chưa có `superseded_by` (E5).

## 2. Phân tích tác động (kết quả checklist)

| Mục | Trạng thái | Ghi chú |
|---|---|---|
| 1.1 Nguồn | [x] | Retro Epic 2, không có story đơn lẻ |
| 1.2 Loại vấn đề | [x] | Tài liệu lệch code + mâu thuẫn kế hoạch |
| 1.3 Bằng chứng | [x] | Mục 1 |
| 2.1 Epic hiện tại | [x] | Epic 2 `done`; 5 AC chưa làm cần story nhận |
| 2.2 Thay đổi cấp epic | [!] | Thêm Story 3.12, 7.7; mở rộng 5.8; thêm AC 4.1; sửa AC 4.2 |
| 2.3 Epic tương lai | [!] | Epic 3 (PRD checkout), Epic 4 (4.1, 4.2), Epic 5 (5.8), Epic 7 (7.7) |
| 2.4 Epic lỗi thời / epic mới | [x] | Không |
| 2.5 Thứ tự epic | [x] | Không đổi |
| 3.1 PRD | [!] | QR → Gateway; FR-8 giá tối thiểu; FR-9 bỏ trường bổ sung |
| 3.2 Architecture | [!] | spine:41; AD-32 "credential hiện hành" |
| 3.3 UX | [N/A] | Mason chọn chỉ sửa PRD lần này; UX theo checklist spec 3.4/3.7 |
| 3.4 Tài liệu khác | [!] | `sprint-status.yaml`, spec 2.11-a, spec 2.2 |
| 4.1 Direct Adjustment | Khả thi | Công sức thấp–vừa, rủi ro thấp |
| 4.2 Rollback | Không khả thi | Code đúng, chỉ tài liệu cũ |
| 4.3 MVP Review | Không cần | Chỉ bỏ "trường bổ sung" của FR-9, không đổi mục tiêu MVP |

## 3. Hướng đi đề xuất

**Direct Adjustment.** Sửa tài liệu cho khớp code và quyết định đã có; chuyển các AC chưa làm sang story nhận rõ ràng. Không đổi code, không rollback.

- **Công sức:** thấp–vừa (chỉ tài liệu).
- **Rủi ro:** thấp. Rủi ro lớn nhất là không sửa: Epic 3 đọc PRD còn QR động/tĩnh, Epic 4 làm theo AD-32 cũ sẽ tạm ngừng bán BTC sai khi key cũ bị thu hồi.
- **Ảnh hưởng tiến độ:** không. Thêm 2 story backlog (3.12, 7.7), cả hai trước Closed Beta.
- **Phạm vi MVP:** giữ nguyên, trừ trường dựng sẵn của FR-9 ra ngoài MVP (quyết định Mason 09/11/2026).

## 4. Chi tiết đề xuất sửa

Mason duyệt từng đề xuất ngày 09/11/2026 (chế độ Incremental).

### 4.1 Spec đã ship

**Đề xuất 1 (E5) — `implementation-artifacts/spec-2-2-totp-cho-owner.md`, frontmatter:** thêm `superseded_by: '{project-root}/_bmad-output/implementation-artifacts/spec-2-2-xac-thuc-hai-lop-tu-bat.md'` sau `status`. Lý do: 2.2 làm lại ở `8a2c8bb`; tránh agent đọc nhầm luật bắt buộc TOTP cho Owner.

**Đề xuất 2 (C8) — `implementation-artifacts/spec-2-11-a-sellability-va-availability.md`:**
- Dòng 25: thứ tự `eventReason` → `cancelled` > `locked` > `ended` > `hidden` > `paused` > `null`, kèm "*(Đổi ở Story 2.12, xem Spec Change Log.)*".
- Spec Change Log: "09/11/2026 (retro Epic 2, C8): Story 2.12 đổi thứ tự thành `ended` > `hidden` (quyết định 06/11/2026, `spec-2-12-sua-an-va-ket-thuc-som-su-kien.md:27`). Sự kiện vừa ẩn vừa đã kết thúc trả `ended`. Code: `ordering/sellability.ts` `blockingReason`."

### 4.2 Architecture (`architecture/architecture-tickee-2026-10-28/ARCHITECTURE-SPINE.md`)

**Đề xuất 3 (D1) — dòng 41, mô-đun `admin`:**

```
OLD: | `admin` | Báo cáo vi phạm; endpoint của Quản trị Tingee (ghi qua `flows`) |
NEW: | `admin` | Báo cáo vi phạm; endpoint của Quản trị Tingee. Ghi vào một mô-đun thì gọi service công khai của mô-đun đó (vd. `organizer` cho Closed Beta); ghi nhiều mô-đun trong một transaction thì qua `flows` (AD-25, vd. `lockEvent`/`lockOrganization` ở Epic 7) |
```

**Đề xuất 5a (B1) — AD-32:**
- Prevents, thêm: "…; key cũ BTC đã thu hồi làm BTC đang bán bằng key mới bị tạm ngừng bán."
- Rule: "bật với `reason` `credential_invalid` khi lời gọi bằng key của BTC trả `TINGEE_CREDENTIAL_INVALID`" → "bật với `reason` `credential_invalid` khi lời gọi bằng credential hiện hành của BTC (`tingee_credentials.retired_at IS NULL`) trả `TINGEE_CREDENTIAL_INVALID`. Lời gọi bằng credential đã thay (Đơn cũ chụp `payout_account_id` trỏ tới credential có `retired_at`) trả lỗi này thì không đổi cờ: Đơn đó đi luồng hết hạn (AD-4) và đẩy cảnh báo vận hành."

Frontmatter `updated` → `2026-11-09`.

### 4.3 Epics (`epics.md`)

**Đề xuất 4 (E2):**
- **4a, Story 2.14, AC thứ hai:** `flows.transferOwnership(orgId, toUserId)` → `organizer.MembersService.transferOwnership(ctx, memberId, reauth)` (chỉ ghi một mô-đun nên không qua `flows`, AD-25). Then: "trong một transaction: `lockOrganization` → tiêu lần xác nhận lại → hạ Owner đang gọi thành `admin` (không còn là Owner thì `FORBIDDEN_ROLE`) → nâng Admin được chọn thành `owner`; hạ trước nâng sau vì unique index "mỗi BTC đúng một Owner" không deferrable; lỗi bất kỳ thì rollback và lần xác nhận lại còn dùng được; audit ghi lại (FR-2, AD-26)".
- **4b, Story 2.10, sau AC `sellability`:** "*(Thực tế: `sellability` và `GET /v1/events/:slug/availability` làm ở Story 2.11-a; `publishReadiness` và `sellability` dùng chung `event/sale-rules.ts`. Thứ tự `eventReason`: `cancelled` > `locked` > `ended` > `hidden` > `paused`, theo spec 2.11-a. Giới hạn Vé/Đơn chưa xét trong 2.11-a, chuyển sang biến thể TX1 của Story 3.2.)*"
- **4c, Story 2.13, dưới tiêu đề:** "*(Làm thành hai spec: 2.13-a "Xác nhận lại trước khi đổi nơi nhận tiền" — Đặt làm mặc định, Hủy liên kết; 2.13-b "Đổi key Tingee". AC "Đối soát bù bằng key cũ" chuyển sang Story 4.1.)*"

**Đề xuất 5 (B1):**
- **5b, Story 4.2, AC đầu:** "hoặc một lời gọi bằng key của BTC trả" → "hoặc một lời gọi bằng credential hiện hành của BTC trả". Thêm `**And** lời gọi bằng credential đã thay (`retired_at` khác null) trả `TINGEE_CREDENTIAL_INVALID` thì không đổi cờ (Story 4.1, AD-32)`.
- **5c, Story 4.1, thêm AC trước AC "Tingee fake…":**

  ```
  **Given** BTC đã đổi key (Story 2.13) và thu hồi key cũ trên Tingee, còn Đơn `pending` hoặc `expired` đang được tra có `orders.payout_account_id` trỏ tới credential cũ
  **When** Đối soát bù tra trạng thái bằng credential đó và nhận `TINGEE_CREDENTIAL_INVALID`
  **Then** dừng tra Đơn đó (không thử lại); Đơn `pending` đi luồng hết hạn (`ordering.markExpired`, AD-4) và đẩy cảnh báo vận hành kèm mã Đơn (Story 4.6); không đổi `payment_service_status`, BTC vẫn bán bằng key mới (AD-32; chuyển từ Story 2.13)
  **And** IPN ký bằng secret cũ vẫn kiểm được (Story 3.5, AD-7), nên tiền về muộn của Đơn đó vẫn được xử lý
  ```
- **5d, Story 2.13:** trước AC "BTC đã thu hồi key cũ…" thêm "*(AC dưới đây chuyển sang Story 4.1; phần IPN ký bằng secret cũ đã có ở Story 3.5.)*"
- Story 3.4 không sửa: link luôn ký bằng tài khoản mặc định thuộc credential hiện hành (đổi key gỡ mọi tài khoản của credential cũ), nên `TINGEE_CREDENTIAL_INVALID` lúc tạo link đúng là trường hợp tạm ngừng bán.

**Đề xuất 6 (E1) — AC Epic 2 chưa làm.** Ở story gốc giữ AC, thêm "*(chưa làm ở Epic 2 — chuyển sang Story X, E2-4)*"; chép AC sang story nhận.

| AC | Gốc | Nhận |
|---|---|---|
| `ADMIN_ALLOWED_CIDRS`, trusted proxy | 2.5 (AC đầu, phần giới hạn IP; AND `ADMIN_ALLOWED_CIDRS`) | Story mới **7.7** |
| "Đặt lại TOTP" | 2.5 (AC cuối) | Story mới **7.7** |
| Ảnh Sự kiện qua S3 (2.7-b) | 2.7 (AC upload ảnh); 2.11 (AC OG "đúng ảnh", nay là nền gradient) | Story mới **3.12** |
| FR-9 "Các trường bổ sung khác" | FR-9 (Requirements Inventory dòng 42) | **Ngoài MVP** (sửa PRD, Đề xuất 7) |
| NFR-1 "tải dưới 2 giây trên 4G" | 2.11 (AC đầu) | **5.8**, đổi tên |

Story mới 3.12 (thêm cuối Epic 3):

```
### Story 3.12: Ảnh Sự kiện

As a Owner hoặc Admin,
I want gắn ảnh cho Sự kiện,
So that trang Sự kiện và link chia sẻ trên Facebook/Zalo trông đáng tin và thu hút người mua.

**Acceptance Criteria:**

**Given** wizard bước 1 hoặc tab Cài đặt của Sự kiện
**When** tôi chọn ảnh
**Then** web upload thẳng lên object storage S3 bằng presigned PUT do API cấp (JPEG/PNG/WebP ≤ 5 MB, key `orgs/{orgId}/events/{uuid}.{ext}`; API chỉ nhận key đúng tiền tố của BTC); `events.image_key` lưu key; bucket ảnh bật CORS `GET` cho origin web (FR-7, AD-22) *(chuyển từ Story 2.7, phần 2.7-b)*
**And** local dùng MinIO trong docker-compose; biến `S3_*` kiểm bằng schema Zod của `config`
**And** file sai định dạng hoặc quá 5 MB báo lỗi tại chỗ, không upload

**Given** Sự kiện có ảnh
**When** mở `/e/{slug}` hoặc chia sẻ link lên Facebook/Zalo
**Then** `event-hero` và ảnh OG dùng ảnh Sự kiện; chưa có ảnh thì giữ nền gradient coral (FR-10, UX-DR10, AD-11) *(AC OG "đúng ảnh" của Story 2.11)*
**And** `event-card` ở dashboard hiện thumbnail; đổi ảnh thì revalidate trang công khai như Story 2.11-c
```

Story mới 7.7 (thêm cuối Epic 7):

```
### Story 7.7: Khu Quản trị Tingee: giới hạn IP và Đặt lại TOTP

As a Quản trị Tingee,
I want khu quản trị chỉ vào được từ dải IP cho phép, và đặt lại được TOTP cho người dùng mất thiết bị,
So that phiên Quản trị Tingee bị lộ không dùng được từ ngoài mạng cho phép, và người dùng không bị khóa vĩnh viễn khỏi tài khoản.

**Acceptance Criteria:**

**Given** tài khoản có cờ `platform_admin`
**When** truy cập `/v1/admin/*`
**Then** API chỉ nhận request từ dải IP cho phép, lấy IP client qua cấu hình trusted proxy; ngoài dải → `FORBIDDEN_ROLE` và log; giới hạn ở `/admin` của web chỉ là lớp phụ (FR-4, AD-26) *(chuyển từ Story 2.5)*
**And** dải IP đọc từ env `ADMIN_ALLOWED_CIDRS`, kiểm bằng schema Zod khi khởi động; thiếu hoặc sai định dạng thì api không khởi động ở production

**Given** người dùng mất cả thiết bị TOTP lẫn mã khôi phục
**When** liên hệ Tingee
**Then** Quản trị Tingee (đã step-up) có thao tác "Đặt lại TOTP" cho một user ở `/admin`, bắt buộc ghi lý do; TOTP và mã khôi phục cũ bị xóa, mọi phiên của user bị hủy, 2FA của user về trạng thái chưa bật; audit ghi lại và email báo cho user và các Owner/Admin của BTC liên quan (FR-4, AD-26) *(chuyển từ Story 2.5; gốc ở Story 2.2, Sprint Change Proposal 30/10/2026)*
```

Story 5.8: đổi tiêu đề thành "Kiểm thử tải NFR-3 và đo NFR-1 trên staging"; thêm AC:

```
**Given** trang Sự kiện công khai trên staging (build production, cache như production)
**When** đo bằng Lighthouse hoặc WebPageTest với cấu hình mạng 4G và điện thoại tầm trung, cả cache lạnh và cache nóng
**Then** trang tải xong (LCP) dưới 2 giây; kết quả ghi vào cùng báo cáo trong `docs/` (NFR-1, FR-10) *(chuyển từ Story 2.11)*
```

Epic List: Epic 3 thêm FR-7 (ảnh), FR-10 (OG ảnh) vào "FRs covered"; Epic 5 "Story cuối: kiểm thử tải NFR-3 và đo NFR-1 trên staging"; Epic 7 thêm "khu Quản trị Tingee giới hạn IP và đặt lại TOTP", FR-4 (một phần). Requirements Inventory FR-9: bỏ "và trường bổ sung".

### 4.4 PRD (`prds/prd-tickee-2026-10-27/prd.md`)

**Đề xuất 7 (E4 + quyết định E1).** Theo danh sách "Cập nhật tài liệu nguồn" của spine (558-561), chỉ phần PRD. FR-5 đã có quy tắc VietinBank. Mã FR-17 giữ để không đánh số lại.

- **7a.** `updated: 2026-11-09`.
- **7b. §1, §2.3:**
  - §1: "Người mua quét VietQR là nhận Vé ngay." → "Người mua trả qua cổng thanh toán Tingee là nhận Vé ngay."
  - UJ-1 bước 4: "Màn hình hiện số tiền, người nhận tiền và đồng hồ Giữ chỗ 15 phút. Minh bấm "Thanh toán", sang trang cổng thanh toán Tingee và trả bằng app ngân hàng."
  - UJ-1 lỗi: "khi hết thời gian Giữ chỗ và Tingee xác nhận chưa trả"; "Số tiền Tingee báo về không khớp Đơn."
  - UJ-2 bước 4: bỏ "và các trường bổ sung".
- **7c. §3 Glossary và trạng thái:**
  - **Tingee:** "Hạ tầng thanh toán (cổng thanh toán Payment Gateway) và đối soát mà Tickee chạy trên đó…"
  - **Sự kiện miễn phí:** "Không tạo link thanh toán và không tiêu Token."
  - **Đơn:** "…Mỗi Đơn có một mã Đơn (`TK` + 8 ký tự), dùng làm `orderId` khi tạo link thanh toán trên Tingee…" (bỏ `billId`).
  - **Mã QR vé:** "…không liên quan tới thanh toán."
  - **QR thanh toán** → **Link thanh toán:** "Link cổng thanh toán Tingee tạo cho một Đơn có phí, gắn số tiền, mã Đơn và tài khoản nhận tiền mặc định của BTC, hết hạn sau 15 phút. Người mua mở link (chuyển hẳn sang trang Tingee) rồi trả bằng app ngân hàng. Tickee không tự tạo QR thanh toán hay deep link."
  - **Giữ chỗ:** "…kéo dài đúng thời hạn link thanh toán (15 phút). Chỗ chỉ được trả lại khi Tingee xác nhận chưa trả, hoặc khi đã quá hạn link 5 phút mà vẫn chưa có xác nhận (FR-14)."
  - **Đối soát bù:** "…trạng thái thanh toán của Đơn theo mã Đơn…"
  - **Token khả dụng:** "Số dư Token cộng hạn mức âm (hoặc hạn mức trả sau) do Tingee báo. Tickee không trừ trước cho Đơn đang Chờ thanh toán; Tingee ngắt dịch vụ của BTC khi chạm hạn mức (FR-15)."
  - **Cần xử lý:** năm loại: Lệch số tiền, Thanh toán mồ côi, Giao dịch chưa khớp (mã Đơn đúng định dạng nhưng không tìm thấy Đơn), Thanh toán trùng (tiền về cho Đơn đã thanh toán, đã hủy hoặc đã hoàn), Sự kiện đã hủy.
  - **Trạng thái Đơn:** "Chờ thanh toán" = "Đang Giữ chỗ; link thanh toán còn hiệu lực hoặc đang chờ Tingee xác nhận". "Hết hạn" = "Tingee xác nhận chưa trả, hoặc quá hạn link 5 phút mà chưa có xác nhận; đã trả lại chỗ…"
  - **"Tạm ngừng bán":** "…không tạo được link thanh toán, vì Tingee ngắt dịch vụ của BTC hoặc key Tingee hiện hành không còn dùng được (FR-15), BTC không còn tài khoản nhận tiền (FR-5), hoặc BTC bị thu hồi Closed Beta (FR-37)."
- **7d. §4.3:**
  - FR-8 thêm "Hạng vé có phí có giá tối thiểu 2.000đ (giới hạn của cổng thanh toán Tingee)."
  - FR-9 bỏ "Các trường bổ sung khác.", thêm ghi chú "*(Trường dựng sẵn như Ngày sinh, CCCD, Size áo nằm ngoài MVP; BTC dùng câu hỏi riêng. Quyết định Mason 09/11/2026, §11.2.)*"
  - FR-11 "link thanh toán".
- **7e. §4.4:**
  - Mô tả: "sang cổng thanh toán Tingee".
  - **FR-14** viết lại theo AD-4: Giữ chỗ theo thời hạn link; đồng hồ về 0 thì "Đang xác nhận thanh toán"; chỉ "Hết hạn" khi Tingee xác nhận chưa trả hoặc quá hạn link 5 phút; chưa tạo được link trong 60 giây thì hết hạn. Bỏ "cả QR động lẫn QR tĩnh" và "Với QR tĩnh: xem FR-17".
  - **FR-15** "Tạm ngừng bán khi Tingee ngắt dịch vụ": không tính trước Token; phát hiện khi tạo link bị từ chối; tự kiểm lại và mở bán lại kèm Đối soát bù; key cũ đã thay bị từ chối không làm tạm ngừng bán; Sự kiện miễn phí không ảnh hưởng; cảnh báo Token sớm ở FR-34.
  - **FR-16** "Thanh toán qua cổng thanh toán Tingee": màn xác nhận (số tiền, người nhận, mã Đơn, đồng hồ) rồi chuyển hẳn sang trang Tingee, không popup; link dưới 2 giây; "Tiền chuyển thẳng cho [tên BTC]" + chính sách hoàn vé; tiền vào tài khoản mặc định lúc tạo link; lỗi rõ ràng thử lại trong 60 giây, lỗi mơ hồ thì Đơn hết hạn; trả xong về trang Đơn của Tickee, trạng thái luôn lấy từ Tickee.
  - **FR-17** "~~Thanh toán bằng QR tĩnh~~. **Bỏ (03/11/2026):** mọi thanh toán đi qua cổng thanh toán Tingee (FR-16)."
- **7f. §4.5, §4.6:**
  - FR-19 "khớp mã Đơn"; chữ ký kiểm bằng Secret Token hiện hành rồi tới các Secret Token cũ còn giữ.
  - FR-20 "trạng thái thanh toán của các Đơn còn mở", "mọi Đơn có link còn mở"; thêm "Key cũ đã thay bị Tingee từ chối thì Đơn đó hết hạn và đẩy cảnh báo vận hành; BTC vẫn bán bằng key mới."
  - FR-21 định nghĩa mới cho Giao dịch chưa khớp, thêm Thanh toán trùng và Sự kiện đã hủy; "Thanh toán trùng chỉ đánh dấu được 'Đã hoàn tay' hoặc 'Bỏ qua' (kèm lý do); không phát thêm Vé."
  - FR-22 thêm hệ quả link Vé có token ngẫu nhiên, tạo lại được (link cũ mất hiệu lực), hết hiệu lực khi Vé hủy hoặc Sự kiện kết thúc, người nhận không cần đăng nhập.
- **7g. §5–§9:**
  - NFR-1 "Tạo link thanh toán dưới 2 giây (p95)".
  - §6: dòng Deep Link → "Tingee: Payment Gateway | Tạo link thanh toán, tra trạng thái theo mã Đơn (FR-16, FR-20) | Có; tên endpoint tra trạng thái chờ Tingee xác nhận"; dòng Token "(FR-34) và trạng thái dịch vụ (FR-15)".
  - §7: bỏ "gồm cả QR tĩnh"; "Tickee phát hiện khi tạo link bị từ chối và tạm ngừng bán (FR-15)".
  - R-3 giảm thiểu mới; R-4 "*Không còn áp dụng — không dùng QR tĩnh (03/11/2026).*"; R-9 "…FR-34 (hiển thị Token) và việc tự mở bán lại (FR-15) phải thiết kế lại".
- **7h. §11, §12:**
  - §11.1 "thanh toán qua cổng thanh toán Tingee".
  - §11.2 thêm: tự tạo QR động/tĩnh và deep link (thay bằng Gateway); trường dựng sẵn của form mua vé.
  - §11.3 thêm hai dòng (QR → Gateway; bỏ "các trường bổ sung khác").
  - §11.4 Phase 1 "link thanh toán", "mua Vé qua cổng thanh toán thành công"; "kiểm tra Token" → "tạm ngừng bán khi bị ngắt dịch vụ" (theo FR-15 mới, thêm khi áp dụng).
  - SM-2 "≥ 95%. Kiểm chứng FR-16, FR-19."

### 4.5 UX

Không sửa trong E2-4 (Mason chọn 09/11/2026). Phần UX của spine:558-561 (bỏ `payment-qr-card`, màn xác nhận rồi redirect, "Đang xác nhận thanh toán", ví dụ mã Đơn 10 ký tự…) đưa vào checklist spec 3.4/3.7 khi viết (cùng E2-6). Story 3.4 trong `epics.md` đã mô tả đúng màn Gateway.

### 4.6 Tracking (`implementation-artifacts/sprint-status.yaml`)

- Thêm `3-12-ảnh-sự-kiện: backlog` (cuối Epic 3), `7-7-khu-quản-trị-tingee-giới-hạn-ip-và-đặt-lại-totp: backlog` (cuối Epic 7).
- Đổi key `5-8-kiểm-thử-tải-nfr-3-trên-staging` → `5-8-kiểm-thử-tải-nfr-3-và-đo-nfr-1-trên-staging` (vẫn `backlog`).
- Action item `epic-2-retro-e2-4-doi-chieu-spec-truoc-epic-3` → `done`, note trỏ proposal này.

## 5. Bàn giao triển khai

- **Phạm vi: Moderate.** Chỉ tài liệu, nhưng thêm 2 story và đổi phạm vi FR-9, nên cập nhật backlog.
- **Người thực hiện:** Developer agent áp dụng ngay sau khi Mason duyệt (sửa PRD, spine, `epics.md`, hai spec, `sprint-status.yaml`). Mason là PO, đã duyệt từng đề xuất.
- **Tiêu chí hoàn thành:**
  - `grep -n 'QR động\|QR tĩnh\|billId\|Deep Link' prd.md` chỉ còn ở FR-17 (đã gạch), R-4, §11.2, §11.3 và câu hỏi mở đã chốt.
  - `grep -n 'flows.transferOwnership' epics.md` không còn kết quả.
  - `sprint-status.yaml` có 3.12, 7.7, 5.8 tên mới; E2-4 `done`.
  - Spec 2.2 cũ có `superseded_by`; spec 2.11-a khớp `sellability.ts`.

**Việc liên quan, ngoài E2-4:**
- **Mâu thuẫn mới phát hiện:** spine AD-7 nói mục `unmatched` "chỉ kết thúc bằng `refunded` hoặc `dismissed`", nhưng Story 4.4 có "Ghép với Đơn" cho `unmatched` (`epics.md:1401-1405`). PRD FR-21 giữ "ghép tay" theo 4.4. Chốt một phía trước Epic 4.
- `deferred-work.md` các mục 2.5 phần sau (`:94`, `:128`, `:131`), 2.7-b (`:194`), FR-9 (`:206`) giờ đã có story nhận hoặc ra ngoài MVP; đóng khi làm E2-8.
- Checklist Epic 3 (E2-6) và phần UX ở 4.5 đi vào spec 3.1/3.2/3.4/3.5/3.7 khi viết.
