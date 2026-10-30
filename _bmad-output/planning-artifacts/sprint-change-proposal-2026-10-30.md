---
title: 'Sprint Change Proposal: Xác thực hai lớp tự bật'
date: '2026-10-30'
author: 'Mason (duyệt) · Developer agent (soạn)'
status: 'approved'
scope: 'moderate'
trigger_story: '2.2'
---

# Sprint Change Proposal: Xác thực hai lớp tự bật

## 1. Tóm tắt vấn đề

**Thay đổi:** xác thực hai lớp (2FA, TOTP) chuyển từ "Owner bắt buộc bật" sang "tính năng mọi tài khoản tự bật hoặc tắt".

**Phân loại:** yêu cầu mới từ phía sản phẩm. Mason muốn 2FA là tính năng bảo mật chung cho mọi Tài khoản Tickee, không phải rào chắn riêng của Owner.

**Bối cảnh phát hiện:** Story 2.2 vừa làm xong theo luật bắt buộc (commit `6768753` trên `feat/2-2-totp-cho-owner`, chưa merge). Khi chạy thử, Owner bị chuyển ngay sang màn đăng ký TOTP sau khi tạo BTC, và không có cách để sau.

**Bằng chứng:**
- BRD NFR-06 và bảng §12: "Bắt buộc 2FA cho Owner".
- PRD §FR-1 dòng 154 ghi yêu cầu này là `[ASSUMPTION: giữ yêu cầu 2FA cho Owner như BRD]`; PRD Câu hỏi mở #9 và UX Open Questions PM #2 vẫn để "chưa chốt phương thức".
- Story 2.2 (epics) và AD-26 hiện thực hóa luật bắt buộc.

## 2. Phân tích tác động

### Epic

- **Epic 2:** vẫn hoàn thành được. Sửa phạm vi và AC của Story 2.2, 2.5, 2.13, 2.14. Không thêm hay bỏ story.
- **Epic 3–8:** không ảnh hưởng. Thứ tự epic giữ nguyên.

### Story

| Story | Thay đổi |
|---|---|
| 2.2 | Viết lại thành "Xác thực hai lớp tự bật (TOTP)": bật, tắt, nhập mã sau đăng nhập, mã khôi phục. Bỏ luật bắt buộc với Owner. Làm lại trên branch hiện tại. |
| 2.5 | Nhận AC "Đặt lại TOTP" (chuyển từ 2.2); thêm "Quản trị Tingee chưa bật 2FA thì phải bật trước khi vào `/admin`". |
| 2.13 | "Step-up TOTP mới" đổi thành "xác nhận lại" (`REAUTH_REQUIRED`): TOTP nếu đã bật 2FA, OTP email nếu chưa. Story này dựng cơ chế xác nhận lại. |
| 2.14 | Dùng xác nhận lại như 2.13; bỏ AC "người nhận gặp luồng bắt buộc đăng ký TOTP". |

### Tài liệu

| Tài liệu | Mục cần sửa |
|---|---|
| PRD | §FR-1 hệ quả (dòng 154), NFR-6 (dòng 515), §11.3 thêm dòng lệch BRD, §13 đóng câu hỏi #9, §14 giả định FR-1 (dòng 675) |
| Architecture | AD-26: Binds, Prevents (dòng 285), Rule TOTP (dòng 290), mã lỗi (dòng 291) |
| Epics | FR-1 (dòng 26), NFR-6 (dòng 99), AD-26 (dòng 126), UX-DR42 (dòng 237), tóm tắt Epic 2 (dòng 311, 494), Story 2.2, 2.5, 2.13, 2.14 |
| UX (EXPERIENCE.md) | IA "Tài khoản", State Patterns dashboard (dòng 320), mục mới "Tài khoản (mọi vai)", Flow 2 bước 1 (dòng 458), Open Questions PM #2 (dòng 547) |
| BRD | Không sửa. Lệch so với BRD được ghi ở PRD §11.3 |

### Kỹ thuật (so với code Story 2.2 hiện có)

- **Giữ nguyên:** migration `0005`, `TotpStore`, `TotpAttemptLimiter` (khóa 5 lần / 15 phút), mã khôi phục (HMAC), màn đăng ký, dialog step-up, cơ chế gửi lại mutation ở `Providers`.
- **Đổi:**
  - Luật `TOTP_REQUIRED` rời `PermissionGuard`, chuyển sang một guard toàn cục của `identity` chạy ngay sau `SessionGuard`: áp cho mọi request ngoài danh sách miễn khi user đã bật 2FA và session chưa qua lớp hai.
  - Step-up hiệu lực hết session (bỏ mốc 12 giờ). `TOTP_REQUIRED` chỉ còn lý do `step_up` (bỏ `enroll`).
  - Danh sách miễn: nhập mã, dùng mã khôi phục, đăng xuất, `GET /v1/identity/me`.
  - Bật 2FA thì các session khác của user phải nhập mã lại.
- **Thêm:** endpoint tắt 2FA (đòi TOTP hoặc mã khôi phục, email báo, audit); trang "Bảo mật tài khoản" trong mục Tài khoản; thẻ gợi ý bật 2FA cho Owner trên dashboard.
- **Để sau:** `REAUTH_REQUIRED` và xác nhận lại bằng OTP email (Story 2.13).
- **Test:** các test organizer đang bắt Owner đăng ký TOTP trước (`signUpWithTotp`) quay về đăng nhập thường; bộ test `totp-required` viết lại theo luật mới.

## 3. Hướng đi đề xuất

**Chọn: Phương án 1, sửa trực tiếp.**

| Phương án | Đánh giá |
|---|---|
| 1. Sửa trực tiếp | Khả thi. Công sức vừa, rủi ro thấp. Giữ phần lớn code 2.2, chỉ đổi luật guard và thêm bật/tắt. |
| 2. Hoàn tác | Không đáng: phần lớn code dùng lại được. |
| 3. Xem lại MVP | Không cần: MVP không thu hẹp. |

**Lý do:** Story 2.2 chưa merge nên sửa lúc này tốn ít nhất. Thay đổi giảm ma sát cho BTC khi Closed Beta, đồng thời mở 2FA cho mọi người dùng.

**Rủi ro và cách giảm:** Owner không bật 2FA thì ai chiếm được email sẽ vào được tài khoản. Hai lớp giảm thiểu:
1. Thao tác nhạy cảm (đổi tài khoản nhận tiền, chuyển quyền Owner) luôn đòi xác nhận lại, kèm email cảnh báo, nên session bị đánh cắp không làm được.
2. Owner chưa bật 2FA thấy gợi ý bật trên dashboard.

Rủi ro còn lại: kẻ chiếm được hộp thư vẫn qua được bước xác nhận bằng OTP email. Đây là rủi ro chấp nhận khi bỏ luật bắt buộc.

**Ước lượng:** làm lại Story 2.2 cỡ một lượt `bmad-build` (spec mới dựa trên code hiện có). Sửa tài liệu kế hoạch: trong phiên này. Không ảnh hưởng mốc Closed Beta.

## 4. Chi tiết đề xuất sửa (đã duyệt từng mục)

### 4.1 PRD (`prds/prd-tickee-2026-10-27/prd.md`)

**FR-1 · Hệ quả (dòng 154)**

CŨ:
> - Owner bắt buộc bật xác thực hai lớp (2FA). `[ASSUMPTION: giữ yêu cầu 2FA cho Owner như BRD; phương thức do Architecture chọn]`

MỚI:
> - Mọi Tài khoản Tickee tự bật hoặc tắt xác thực hai lớp (2FA) bằng ứng dụng xác thực (TOTP) ở trang "Bảo mật tài khoản". Owner được khuyến khích bật nhưng không bắt buộc.
> - Tài khoản đã bật 2FA phải nhập mã TOTP sau mỗi lần đăng nhập (Google hoặc OTP email) mới dùng được tài khoản. Có 10 mã khôi phục dùng một lần cho trường hợp mất thiết bị.
> - Tắt 2FA phải nhập mã TOTP (hoặc mã khôi phục) hiện tại; hệ thống gửi email báo.
> - Thao tác nhạy cảm (đổi tài khoản nhận tiền, chuyển quyền Owner) luôn yêu cầu xác nhận lại ngay lúc thao tác: nhập mã TOTP nếu đã bật 2FA, nếu chưa bật thì nhập mã OTP gửi qua email; kèm email cảnh báo.

**NFR-6 (dòng 515):** `Owner bắt buộc 2FA` → `Mọi tài khoản tự bật được 2FA (TOTP); Quản trị Tingee bắt buộc 2FA; thao tác nhạy cảm luôn xác nhận lại (FR-1)`

**§11.3 Thay đổi so với BRD (thêm dòng):**

| BRD | PRD | Lý do |
|---|---|---|
| Bắt buộc 2FA cho Owner (NFR-06, §12) | 2FA là tính năng tự bật cho mọi tài khoản; Owner được khuyến khích; thao tác nhạy cảm luôn xác nhận lại bằng TOTP hoặc OTP email | Đưa 2FA thành tính năng bảo mật chung, không chặn BTC ngay khi vừa tạo BTC (Mason chốt 30/10/2026) |

**§13 Câu hỏi mở #9:** đánh dấu đã đóng — *Đã chốt: TOTP qua ứng dụng xác thực, tự bật cho mọi tài khoản (xem FR-1).*

**§14 Danh mục giả định (dòng 675):** `Giữ 2FA cho Owner.` → `2FA (TOTP) tự bật cho mọi tài khoản, không bắt buộc với Owner.`

**Giữ nguyên:** dòng 202 và 677 (Quản trị Tingee bắt buộc 2FA).

### 4.2 Architecture (`architecture/architecture-tickee-2026-10-28/ARCHITECTURE-SPINE.md`, AD-26)

**Binds:** thêm `FR-1`.

**Prevents (dòng 285):** `… Owner xem PII mà chưa qua 2FA.` → `… tài khoản đã bật 2FA dùng được mà chưa nhập mã; session bị đánh cắp đổi được tài khoản nhận tiền hay chuyển quyền Owner mà không xác nhận lại.`

**Rule · TOTP (dòng 290)**

CŨ:
> - TOTP: trở thành Owner yêu cầu đăng ký TOTP (Better Auth `twoFactor`, `allowPasswordless: true`). Mọi request với vai Owner, và mọi request của Quản trị Tingee, yêu cầu step-up TOTP trong session còn hiệu lực (12 giờ; Quản trị Tingee: mỗi session); thiếu → `TOTP_REQUIRED`. Step-up do `identity` tự dựng vì Better Auth không hỏi TOTP khi đăng nhập bằng Google hay OTP email.

MỚI:
> - 2FA (TOTP, Better Auth `twoFactor`, `allowPasswordless: true`) là tính năng mọi tài khoản tự bật/tắt (`users.two_factor_enabled`). Tài khoản đã bật: session mới (Google hoặc OTP email) chưa qua lớp hai (`sessions.step_up_at` rỗng); mọi request ngoài danh sách miễn trả `TOTP_REQUIRED` cho tới khi nhập TOTP hoặc mã khôi phục; hiệu lực hết session. Luật này nằm ở một guard toàn cục của `identity`, chạy ngay sau `SessionGuard`, không nằm trong `PermissionGuard`. Danh sách miễn khai báo một chỗ trong `packages/contracts`. Step-up do `identity` tự dựng vì Better Auth không hỏi TOTP khi đăng nhập bằng Google hay OTP email.
> - Tắt 2FA: endpoint riêng, đòi mã TOTP hoặc mã khôi phục hiện tại; email báo; audit.
> - Quản trị Tingee: bắt buộc đã bật 2FA; mọi request `/v1/admin/*` cần step-up trong session hiện tại.
> - Xác nhận lại cho thao tác nhạy cảm (đổi tài khoản nhận tiền, chuyển quyền Owner): `identity` cấp một lần xác nhận ngắn hạn, dùng một lần (hiệu lực 5 phút), sau khi nhập TOTP (nếu đã bật 2FA) hoặc OTP email (nếu chưa). Thiếu → `REAUTH_REQUIRED`. Không dùng `step_up_at` cho việc này.

**Mã lỗi quyền (dòng 291):** thêm `REAUTH_REQUIRED`.

**Giữ nguyên:** dòng 32, dòng 516, trường `stepUpAt` trong `ctx`.

### 4.3 Epics (`epics.md`)

**Tóm tắt yêu cầu:**
- FR-1 (dòng 26): `Owner bắt buộc bật 2FA.` → `Mọi tài khoản tự bật/tắt được 2FA (TOTP); thao tác nhạy cảm luôn xác nhận lại bằng TOTP hoặc OTP email.`
- NFR-6 (dòng 99): `Owner bắt buộc 2FA.` → `Mọi tài khoản tự bật được 2FA; Quản trị Tingee bắt buộc 2FA.`
- AD-26 (dòng 126): `Owner và Quản trị Tingee cần step-up TOTP (12 giờ đối với Owner).` → `Tài khoản đã bật 2FA nhập TOTP sau mỗi lần đăng nhập (hiệu lực hết session); Quản trị Tingee bắt buộc 2FA; thao tác nhạy cảm cần xác nhận lại (REAUTH_REQUIRED).` Thêm `REAUTH_REQUIRED` vào danh sách mã lỗi.
- UX-DR42 (dòng 237): → `Trang "Bảo mật tài khoản" bật/tắt 2FA (QR, khóa nhập tay, mã khôi phục); màn nhập mã TOTP khi API trả TOTP_REQUIRED; màn xác nhận lại (TOTP hoặc OTP email) khi API trả REAUTH_REQUIRED.`
- Tóm tắt Epic 2 (dòng 311, 494): `bật TOTP` → `có thể bật 2FA`.

**Story 2.2 (viết lại):**

> ### Story 2.2: Xác thực hai lớp tự bật (TOTP)
>
> As a người dùng Tickee (đặc biệt là Owner),
> I want tự bật hoặc tắt xác thực hai lớp bằng ứng dụng TOTP,
> So that người khác không vào được tài khoản của tôi chỉ bằng email.
>
> **Acceptance Criteria:**
>
> **Given** tôi đã đăng nhập và chưa bật 2FA
> **When** mở trang "Bảo mật tài khoản" và chọn "Bật xác thực hai lớp"
> **Then** thấy mã QR và khóa nhập tay, nhập mã 6 số để xác nhận (Better Auth `twoFactor`, `allowPasswordless: true`); không ai bị buộc bật, kể cả Owner (FR-1, NFR-6, UX-DR42)
> **And** Owner chưa bật 2FA thấy gợi ý bật trong dashboard, nhưng không bị chặn thao tác
>
> **Given** tôi vừa bật 2FA thành công
> **When** màn xác nhận hiện
> **Then** hệ thống sinh 10 mã khôi phục dùng một lần (DB chỉ lưu hash), hiện một lần duy nhất kèm nút "Tải xuống" và "Sao chép", và yêu cầu tôi xác nhận "Tôi đã lưu mã khôi phục" trước khi tiếp tục
> **And** session hiện tại coi như đã qua lớp hai; các session khác của tôi phải nhập mã ở request kế tiếp
>
> **Given** tài khoản đã bật 2FA
> **When** đăng nhập bằng Google hoặc OTP email
> **Then** mọi request ngoài danh sách miễn trả `TOTP_REQUIRED` cho tới khi nhập đúng mã TOTP hoặc mã khôi phục; hiệu lực tới hết session; web hiện màn nhập mã, nhập đúng thì tiếp tục thao tác dở (AD-26)
> **And** sai mã thì báo lỗi tại ô, không mất thao tác
> **And** sai 5 lần liên tiếp thì khóa xác minh 15 phút theo user; ghi audit
>
> **Given** luật `TOTP_REQUIRED`
> **When** session chưa qua lớp hai gọi API
> **Then** các endpoint sau được miễn: nhập mã (step-up), dùng mã khôi phục, đăng xuất, `GET /v1/identity/me`; danh sách miễn khai báo một chỗ trong `packages/contracts` và có test
>
> **Given** tài khoản đã bật 2FA
> **When** chọn "Tắt xác thực hai lớp" và nhập đúng mã TOTP hoặc mã khôi phục
> **Then** 2FA tắt, secret và mã khôi phục bị xóa, email báo cho tôi, audit ghi lại
>
> **Given** tôi mất thiết bị TOTP
> **When** nhập một mã khôi phục ở màn nhập mã
> **Then** qua được lớp hai, mã đó hết hiệu lực, 2FA cũ bị gỡ, tôi được đưa tới trang Bảo mật tài khoản để bật lại; audit ghi lại và email báo cho tôi
>
> **Given** tài khoản chưa bật 2FA
> **When** dùng Tickee ở bất kỳ vai nào
> **Then** không bị hỏi TOTP (riêng Quản trị Tingee: xem Story 2.5)

**Story 2.5:** thêm "Tài khoản Quản trị Tingee chưa bật 2FA thì phải bật trước khi vào `/admin`". Nhận AC chuyển từ 2.2:

> **Given** người dùng mất cả thiết bị TOTP lẫn mã khôi phục
> **When** liên hệ Tingee
> **Then** Quản trị Tingee (đã step-up) có thao tác "Đặt lại TOTP" cho một user ở `/admin`, bắt buộc ghi lý do; TOTP và mã khôi phục cũ bị xóa, mọi phiên của user bị hủy, 2FA của user về trạng thái chưa bật; audit ghi lại và email báo cho user và các Owner/Admin của BTC liên quan

**Story 2.13 (dòng 846):** `yêu cầu step-up TOTP mới (không dùng step-up cũ)` → `yêu cầu xác nhận lại ngay lúc thao tác (REAUTH_REQUIRED): nhập mã TOTP nếu đã bật 2FA, nếu chưa thì nhập mã OTP gửi qua email`.

**Story 2.14:** dòng 876 `yêu cầu step-up TOTP mới` → `yêu cầu xác nhận lại như Story 2.13`; xóa AC dòng 883–885 ("người nhận chưa đăng ký TOTP → gặp luồng bắt buộc đăng ký TOTP của Story 2.2").

### 4.4 UX (`ux-designs/ux-tickee-2026-10-27/EXPERIENCE.md`)

**IA · Người mua (đã đăng nhập) · "Tài khoản":** `Xóa Tài khoản Tickee / rút đồng ý (FR-38)` → `**Bảo mật tài khoản**: bật/tắt xác thực hai lớp (FR-1); Xóa Tài khoản Tickee / rút đồng ý (FR-38). Dùng chung cho mọi vai (Người mua, Owner, Admin, CTV) vì cùng một Tài khoản Tickee.`

**State Patterns · Dashboard BTC (dòng 320):** thay dòng "2FA Owner" bằng:

| Owner chưa bật 2FA | Danh sách Sự kiện của BTC | Thẻ gợi ý có thể đóng "Bật xác thực hai lớp để bảo vệ tài khoản nhận tiền." + "Bật ngay" → Bảo mật tài khoản. Không chặn thao tác. Không dùng `status-banner` (banner đi qua `reporting.notices`, Story 2.5). |
|---|---|---|

**State Patterns · mục mới "Tài khoản (mọi vai)":**

| Trạng thái | Bề mặt | Hành vi |
|---|---|---|
| Bật 2FA | Bảo mật tài khoản | Mã QR + khóa nhập tay (nhóm 4 ký tự, chỉ xuống dòng giữa các nhóm) + ô mã 6 số; đúng → màn 10 mã khôi phục với "Tải xuống", "Sao chép", checkbox "Tôi đã lưu mã khôi phục" mở "Xong" |
| Nhập mã sau đăng nhập | Mọi trang | API trả `TOTP_REQUIRED` → `Dialog` "Xác thực hai lớp": mã 6 số, link "Dùng mã khôi phục", nút "Đăng xuất"; đúng → tiếp tục thao tác dở; sai → lỗi tại ô; bị khóa → "Thử lại sau N phút" |
| Tắt 2FA | Bảo mật tài khoản | `Dialog` nêu hậu quả "Tài khoản chỉ còn được bảo vệ bằng email." + ô mã TOTP hoặc mã khôi phục; xong → toast "Đã tắt xác thực hai lớp", email báo |
| Đã dùng mã khôi phục | Bảo mật tài khoản | `status-banner` warning "Xác thực hai lớp cũ đã được gỡ. Bật lại với thiết bị mới." |
| Xác nhận lại (`REAUTH_REQUIRED`) | Đổi tài khoản nhận tiền, Chuyển quyền Owner | `Dialog` "Xác nhận để tiếp tục": đã bật 2FA → mã TOTP; chưa bật → "Gửi mã tới {email}" + ô OTP; đúng → thực hiện thao tác, giữ dữ liệu đã nhập |

**Flow 2 · bước 1 (dòng 458):** `Thiết lập 2FA (Open Questions #2, PRD OQ #9).` → `Dashboard gợi ý bật xác thực hai lớp; anh bật ngay (quét QR bằng Google Authenticator, lưu 10 mã khôi phục). Nếu để sau, anh vẫn làm tiếp được.`

**Open Questions · PM #2 (dòng 547):** đánh dấu đã đóng — *Đã chốt 30/10/2026: TOTP tự bật cho mọi tài khoản (PRD FR-1).*

**Giữ nguyên:** DESIGN.md.

## 5. Bàn giao triển khai

**Phạm vi:** Moderate. Không thêm hay bỏ epic; sửa AC của 4 story và làm lại một story chưa merge.

| Vai | Việc |
|---|---|
| Mason (PO) | Duyệt đề xuất này. Thông báo phía Tingee về việc lệch NFR-06 của BRD (ghi ở PRD §11.3). |
| Developer agent | Áp các sửa §4 vào PRD, Architecture, Epics, UX. Cập nhật `sprint-status.yaml`: Story 2.2 về `in-progress`, giữ key `2-2-totp-cho-owner`. |
| Developer agent (`bmad-build`, phiên mới) | Làm lại Story 2.2 trên `feat/2-2-totp-cho-owner` theo Story 2.2 mới, dựa trên code ở `6768753` (xem §2 Kỹ thuật). `epic-2-context.md` sẽ được dựng lại vì tài liệu kế hoạch mới hơn. |
| Story 2.5, 2.13, 2.14 | Khi tới lượt, làm theo AC mới; 2.13 dựng `REAUTH_REQUIRED`. |

**Tiêu chí thành công:**
- Tài liệu kế hoạch không còn chỗ nào ghi Owner bắt buộc 2FA (chỉ Quản trị Tingee).
- Sau khi làm lại Story 2.2: user chưa bật 2FA (kể cả Owner) không bao giờ nhận `TOTP_REQUIRED`; user đã bật phải nhập mã sau mỗi lần đăng nhập; bật, tắt, mã khôi phục chạy đúng; `pnpm turbo build typecheck lint:deps test` và Playwright pass.
