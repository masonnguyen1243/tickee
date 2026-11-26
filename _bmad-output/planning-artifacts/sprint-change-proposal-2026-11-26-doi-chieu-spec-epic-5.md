---
title: 'Sprint Change Proposal: đối chiếu spec sau Epic 5 (E5-4) và quyết định Cần xử lý (E4-5)'
date: '2026-11-26'
author: 'Mason (duyệt) · Developer agent (soạn)'
status: 'approved'
scope: 'minor'
trigger_story: 'retro Epic 5, action item E5-4; retro Epic 4, action item E4-5 (C1, C2, C3)'
---

# Sprint Change Proposal: đối chiếu spec sau Epic 5 (E5-4) và quyết định Cần xử lý (E4-5)

## 1. Tóm tắt vấn đề

**Nguồn:**
- Action item E5-4 của retro Epic 5 (`implementation-artifacts/epic-5-retro-2026-11-26.md:346`). Gồm các phát hiện F1, F4, F5, F6, S2, S3, S6, R7. Hạn: `epics.md` và spine trước Story 6.1; AC 7.6, 9.1, 9.2 trước các story đó. Đề xuất này làm cả hai phần.
- Action item E4-5 của retro Epic 4 (`implementation-artifacts/epic-4-retro-2026-11-20.md:425`), vế C1, C2, C3. Hạn: C1 trước Epic 6 (chặn 6.2), C2 và C3 trước 7.1. Vế B2 (Trang Đơn mời trả qua link khi BTC Tạm ngừng bán) không thuộc đề xuất này và vẫn mở.

**Phân loại:**
- Tài liệu kế hoạch lệch với code đã ship ở Epic 5: bảng sở hữu `checkin`, tầng `flows`, AD-15, AD-26, AD-31. Không có code nào sai vì các lệch này. Theo luật ở đầu `epics.md`, với story đã `done` thì spec và spine thắng. Nhưng Epic 6–9 sẽ đọc `epics.md` và spine khi lập spec.
- AC của story chưa làm (6.2, 7.1, 7.2, 7.6, 9.1, 9.2) thiếu ràng buộc mà Epic 4–5 phát hiện.
- Hai quyết định sản phẩm (doanh thu, Đơn `review` khi hủy Sự kiện) chưa có, trong đó doanh thu chặn Story 6.2.
- Ngoài một quyết định thiết kế cho 7.1 (§1, quyết định 4), đề xuất chỉ sửa tài liệu. Code thay đổi theo do story nhận làm (6.2, 7.1, 9.1).

**Bằng chứng** (đã kiểm lại trên HEAD `f47cd31`):

- **E4-5 C1, doanh thu hai con số:**
  - `ordering/event-overview-read.ts:28` cộng `SUM(total_amount)` của Đơn `paid`. Spine AD-33 (`:397`) ghi cùng cách.
  - AC 6.2 (`epics.md:1838`) đã ghi `paid_amount`. Danh sách hoàn tiền AD-28 và CSV 7.2 cũng dùng `paid_amount`.
  - Duyệt tay một khoản lệch tiền (Story 4.4-a) gọi `markPaid(…, item.receivedAmount, …)`, nên `paid_amount` ≠ `total_amount`. Đơn 300.000đ nhận 250.000đ: Tổng quan cộng 300.000đ, danh sách hoàn tiền ghi 250.000đ.
  - Đổi cột an toàn: ràng buộc DB (`ordering/schema.ts:176`) bắt Đơn `paid` có `paid_at`, nên có `paid_amount`. Đơn 0đ có `paid_amount = 0` (`mark-paid.ts:263`).
- **E4-5 C2, mục kẹt sau Ghép rồi hủy Sự kiện:**
  - `payment/review-actions.ts:70`: `closesOnly` chỉ xét Đơn `PAID`.
  - `:83-91`: `reviewActionsFor` trả `[]` cho Đơn `cancelled` (`event_cancelled`).
  - Kịch bản: Đơn `review` lệch tiền → Ghép đủ tiền → `paid`, mục lệch tiền vẫn `open` (4.4-b) → hủy Sự kiện → Đơn `cancelled` → mục không còn thao tác nào, kẹt trong hàng và badge.
  - Nếu sau đó Đơn được "Đã hoàn tay" (`refunded`), mục vẫn kẹt.
- **E4-5 C3, Đơn `review` khi hủy Sự kiện:**
  - AD-3 không có `review → refunded`, và bảng thao tác của 4.4 không có `refund` khi Đơn còn `review`.
  - AC 7.1 (`epics.md:1956`) giữ Đơn `review` nguyên trạng. Muốn hoàn, BTC phải "Từ chối" trước, nên Người mua nhận email "BTC đã hủy Đơn này", sai ngữ cảnh.
  - `deferred-work.md:845` ghi thêm một ca: tiền về sau khi hủy cho Đơn `expired` → Đơn `review` chỉ có mục `event_cancelled`. Đóng hết mục thì Đơn vẫn `review`, và Người mua thấy "BTC đang kiểm tra" mãi.
- **F1, spine lệch cách Epic 5 được dựng:**
  - Bảng sở hữu (`ARCHITECTURE-SPINE.md:38`) giao màn quét và tra tay cho `checkin`. Thực tế điều phối quét, tra tay và check-in tay nằm ở `flows/checkin-scan.flow.ts` và `flows/checkin-lookup.flow.ts`.
  - `flows/` giờ có cả luồng đọc ghép nhiều mô-đun (`listCheckers`, `previewCheckerInvite`).
  - AD-25 (`:320`) thiếu `scanTicket`, `lookupTickets`, `manualCheckIn`, `listCheckers`, `previewCheckerInvite`.
  - AD-26 (`:327`): spine ghi một cổng `AccessResolver` do `organizer` và `checkin` cùng cài, và một ctx. Code có hai cổng (`AccessResolver`, `CheckerAccessResolver`, `platform/access/access-resolver.ts:10-50`) và một `EventAccessContext` riêng (`platform/access/org-scope.ts:21-30`).
  - `CheckinModule` là `@Global()` (`checkin.module.ts:18`), như `TicketingModule` và `TingeeModule`.
  - AD-15 (`:239`): danh sách lý do có `EXPIRED`, `CHECKER_REVOKED`. `ScanInvalidReason` (`packages/contracts/src/checkin.ts:241-247`) không có hai lý do này: CTV bị thu hồi nhận `403 CHECKER_REVOKED` từ guard.
  - Phát lại của AD-15 yếu đi với CTV sau mốc kết thúc (spec 5.6, Design Notes). Spine chưa ghi.
  - AD-31 (`:369`) đòi `Idempotency-Key` cho mọi `POST` đổi trạng thái. Tạo link mời và thu hồi/khôi phục CTV không nhận header này (`checker-invite.controller.ts:9`, `checkers.controller.ts:10`).
- **F4:**
  - AC 5.3 (`epics.md:1683`) đòi "p95 < 1 giây ở staging". Epic 5 chưa có staging, và metric `tickee.checkin.scan.duration` (`flows/checkin-scan.flow.ts:24`) chỉ đo thân flow.
  - AC 9.2 (`:2269-2271`) không nói đo ở đâu.
- **F5:** `epics.md:329, :1588` gọi kiểm thử tải phần quét là "NFR-3". Trong PRD đó là NFR-2 (`prd.md:527`); NFR-3 là tải 5.000 Người mua.
- **F6:** AC 5.3 và 5.4 (`epics.md:1676, :1703`) đòi tên người quét lần trước. Spec 5.3-a (`:25`) chốt: tài khoản không có tên (OTP) hiện nhãn vai trò Owner, Admin hoặc "CTV khác".
- **S2, S3:** lệnh quét nhận mọi phiên bản khóa có trong `TICKET_QR_KEYS`, không so với `tickets.qr_key_version`. Instance thiếu khóa thì trả đỏ `BAD_SIGNATURE` mà không phát marker. AC 9.1 chưa có runbook xoay khóa, dù `deferred-work.md:464` giao runbook cho 9.1.
- **S6:**
  - Tra tay khớp đúng `orders.buyer_phone` và `lower(buyer_email)` (`ordering/buyer-contact-read.ts:28-33`). Hai cột `NOT NULL` (`ordering/schema.ts:117-118`).
  - AC 7.6 (`epics.md:2101`) chỉ ghi "thay bằng giá trị ẩn danh".
  - Nếu giá trị ẩn danh parse được thành SĐT/email, tra giá trị đó sẽ ra Vé của mọi Người mua đã ẩn danh.
- **R7:** mục 9.2 ở `deferred-work.md:1275` đếm 3 câu SQL mỗi lần tải lại sau check-in. Thực tế khoảng 7 câu (session không có `cookieCache` `identity/auth.ts:59`, guard, handler), và máy vừa quét xanh tải hai lần.

**Quyết định của Mason (26/11/2026, trước khi soạn):**
1. **Doanh thu** (E4-5 C1, câu hỏi mở 2 của retro Epic 5): Tổng quan tính theo `paid_amount`, là tiền đã nhận.
2. **Phạm vi:** gộp C2, C3 của E4-5 vào AC 7.1/7.2. B2 để mở.
3. **p95 quét ở 9.2** (F4, câu hỏi mở 6): đo phía client bằng script tải, từ lúc gửi tới lúc nhận response, và đó là tiêu chí. `http.server.request.duration` và `tickee.checkin.scan.duration` ghi kèm để chẩn đoán.
4. **Đơn `review` khi hủy Sự kiện** (C3): chuyển sang `cancelled` (`event_cancelled`), cả lúc hủy lẫn khi tiền về sau khi hủy cho Đơn `expired`. Mục `open` giữ nguyên và có "Đã hoàn tay"/"Bỏ qua", cả hai chỉ đóng mục (chung luật với C2).
5. **Cách duyệt:** batch.

## 2. Phân tích tác động (kết quả checklist)

| Mục | Trạng thái | Ghi chú |
|---|---|---|
| 1.1 Story kích hoạt | [x] | Retro Epic 5 E5-4 (F1, F4, F5, F6, S2, S3, S6, R7); retro Epic 4 E4-5 (C1, C2, C3) |
| 1.2 Loại vấn đề | [x] | Tài liệu lệch code đã ship; AC story chưa làm thiếu ràng buộc; hai quyết định sản phẩm còn treo |
| 1.3 Bằng chứng | [x] | §1, dẫn file:dòng, đã kiểm lại trên HEAD `f47cd31` |
| 2.1 Epic hiện tại | [x] | Epic 5 vẫn `done`, không mở lại. Chỉ sửa câu mục tiêu (NFR) và AC 5.3, 5.4 cho khớp spec |
| 2.2 Thay đổi cấp epic | [N/A] | Không thêm, bỏ hay đổi phạm vi epic |
| 2.3 Epic tương lai | [!] | Epic 6: AC 6.2 (doanh thu). Epic 7: AC 7.1, 7.2 (C2, C3), 7.6 (S6). Epic 9: AC 9.1 thêm runbook xoay khóa QR, AC 9.2 nói rõ cách đo và fan-out |
| 2.4 Epic lỗi thời / mới | [N/A] | Không |
| 2.5 Thứ tự epic | [N/A] | Giữ nguyên |
| 3.1 PRD | [N/A] | FR-31 "chỉ tính Đơn Đã thanh toán" vẫn đúng với `paid_amount`. NFR-2, NFR-3 không đổi |
| 3.2 Architecture | [!] | Bảng mô-đun (`checkin`), AD-3 (sơ đồ), AD-7 (bước 3), AD-15, AD-16, AD-25, AD-26, AD-28, AD-31, AD-33 |
| 3.3 UX | [N/A] | Nhãn người quét đã ở spec 5.3-a. Câu chữ hủy Sự kiện và hoàn tiền (UX-DR40, UX-DR41) không đổi |
| 3.4 Artifact khác | [!] | `deferred-work.md` (3 mục ghi thêm, 1 mục mới), `sprint-status.yaml` (E5-4, E4-5), câu hỏi mở của retro Epic 5. Không sửa `epic-5-context.md` (tài liệu của epic đã đóng, như tiền lệ E4-7) |
| 4.1 Sửa trực tiếp | Viable | Effort thấp, rủi ro thấp. Chỉ sửa tài liệu |
| 4.2 Rollback | Not viable | Không có code cần lùi |
| 4.3 Xem lại MVP | Not viable | MVP không đổi |
| 4.4 Chọn hướng | [x] | Sửa trực tiếp |

## 3. Hướng đi đề xuất

**Chọn: sửa trực tiếp tài liệu.**

- Story 6.2 bắt đầu được: doanh thu có một định nghĩa, và AC nói rõ phải đổi hàm và thêm test.
- Story 7.1 nhận một luật chung cho Sự kiện đã hủy: mọi Đơn có mục `open` đều ở `cancelled` (`event_cancelled`) hoặc `refunded`, và mục của chúng chỉ còn "Đã hoàn tay"/"Bỏ qua". Đóng luôn C2, C3 và mục `deferred-work.md:845`.
- Spine mô tả đúng hai cổng quyền, tầng `flows` sau Epic 5 và ngoại lệ `Idempotency-Key`. Epic 6 thêm route BTC mới và đọc ghép nhiều mô-đun (tab Đơn, CSV), nên cần đúng phần này.
- AC 9.1, 9.2 và 7.6 nhận các ràng buộc retro tìm thấy. Khi bắt đầu các story đó không cần lục retro.

**Rủi ro:**
- Thấp: chỉ đổi tài liệu.
- Quyết định 4 đổi hành vi đã viết sẵn trong `markPaid` (nhánh `event_cancelled` chuyển Đơn `expired` → `review`). Nhánh này hiện chưa chạy được vì chưa có hủy Sự kiện. Story 7.1 sửa nhánh này kèm test; AC 7.1 đã ghi.
- AD-16 ghi trước luật "quét ràng `qr_key_version`" với mốc "từ Story 9.1". Trước 9.1, spine và code vẫn khác nhau ở điểm này, có chủ đích.

**Ngoài phạm vi** (retro có nêu nhưng thuộc action item khác):
- `checkin_method` (`scan` | `manual`) trên Vé: E5-5, "cùng 6.1 hoặc 6.5".
- Gom bộ giới hạn tốc độ, hash token, tách `checkin-event-screen.tsx`: E5-5.
- Sửa quy trình Build: E5-6.
- B2 của E4-5.

## 4. Chi tiết đề xuất sửa

### 4.1 Epics (`epics.md`)

**E1. Mục tiêu Epic 5 (`:329` và `:1588`, cùng một câu)**

OLD:
> CTV nhận link mời, quét Vé xanh/đỏ dưới 1 giây, tra tay; Owner/Admin theo dõi check-in realtime và thu hồi CTV. Kiểm thử tải NFR-3 chuyển sang Story 9.2.

NEW:
> CTV nhận link mời, quét Vé xanh/đỏ dưới 1 giây, tra tay; Owner/Admin theo dõi check-in realtime và thu hồi CTV. Kiểm thử tải phần quét (NFR-2) và đo p95 ở staging chuyển sang Story 9.2.

Lý do: F5, F4.

**E2. Story 5.3, AC đọc lại Vé (`:1676`)**

OLD:
> …đã check-in bởi lượt khác → đỏ "Đã check-in lúc HH:MM · bởi {người}"; …

NEW:
> …đã check-in bởi lượt khác → đỏ "Đã check-in lúc HH:MM · bởi {người}", với {người} là tên tài khoản nếu có (Google), "bạn" nếu là chính người đang quét, còn lại là nhãn vai trò Owner, Admin hoặc "CTV khác" (tài khoản OTP không có tên); không lộ email *(spec 5.3-a)*; …

Lý do: F6.

**E3. Story 5.3, AC cuối (`:1683`)**

OLD:
> **And** p95 thời gian từ lúc gửi tới lúc nhận kết quả < 1 giây ở staging, có metric riêng (NFR-2)

NEW:
> **And** có metric riêng phía server cho lần quét (`tickee.checkin.scan.duration`). Phần "p95 từ lúc gửi tới lúc nhận kết quả < 1 giây ở staging" chuyển sang Story 9.2, vì Epic 5 chưa có staging (NFR-2) *(E5-4, retro Epic 5 F4)*

Lý do: F4.

**E4. Story 5.4, AC quét đồng thời (`:1703`)**

OLD:
> **Then** đúng một người thấy xanh, người kia thấy đỏ kèm giờ và tên người quét lần trước (FR-28)

NEW:
> **Then** đúng một người thấy xanh, người kia thấy đỏ kèm giờ và người quét lần trước (tên hoặc nhãn vai trò, như Story 5.3) (FR-28)

Lý do: F6.

**E5. Story 6.2, AC doanh thu (`:1838`)**

OLD:
> **And** doanh thu chỉ tính Đơn `paid` theo `paid_amount`; Đơn `refunded` và `cancelled` không tính (FR-31)

NEW:
> **And** doanh thu chỉ tính Đơn `paid` theo `paid_amount` (tiền đã nhận, khớp danh sách hoàn tiền AD-28); Đơn `refunded` và `cancelled` không tính (FR-31)
> **And** Story 3.11 dựng doanh thu bằng `total_amount`: story này đổi `ordering.eventRevenueOf` sang `SUM(paid_amount)` (spine AD-33) và thêm assert `revenue` vào test Duyệt tay lệch tiền (Đơn 300.000đ, nhận 250.000đ → doanh thu 250.000đ) *(Mason chốt 26/11/2026, E4-5 C1)*

Lý do: C1, quyết định 1.

**E6. Story 7.1, AC Đơn `review` (`:1956`) và một AC mới**

OLD:
> **And** Đơn đang `review` giữ nguyên `review` và loại cũ; `review_item` đang `open` của Đơn đó vẫn mở, nút "Duyệt tay phát Vé" bị tắt (Story 4.4); khoản tiền của mục đó nằm trong danh sách hoàn tiền của Story 7.2 (AD-28), vì Đơn `review` không ghi `paid_amount`

NEW:
> **And** Đơn đang `review` → `cancelled` (`event_cancelled`) trong cùng transaction; `review_item` đang `open` của Đơn đó vẫn mở, và khoản tiền của mục nằm trong danh sách hoàn tiền của Story 7.2 (AD-28), vì Đơn `review` không ghi `paid_amount` *(Mason chốt 26/11/2026, E4-5 C3)*
> **And** mục `open` gắn Đơn `cancelled` (`event_cancelled`) hoặc `refunded`, mọi loại, chỉ có "Đã hoàn tay" và "Bỏ qua". Cả hai chỉ đóng mục, Đơn giữ nguyên. Sửa `closesOnly` và `reviewActionsFor` (`payment/review-actions.ts`) cùng bảng thao tác chép ở web (`can-xu-ly/review-actions.tsx`). Có test cho kịch bản: Đơn `review` lệch tiền → Ghép đủ tiền → `paid` → hủy Sự kiện → "Đã hoàn tay" đóng được mục lệch tiền, kể cả sau khi Đơn đã `refunded` *(retro Epic 4 C2)*

Lý do: C2, C3, quyết định 4.

**E7. Story 7.1, AC tiền về sau khi hủy (`:1964`)**

OLD:
> **Then** tạo `review_item` loại `event_cancelled`, không phát Vé (AD-7, AD-28)

NEW:
> **Then** tạo `review_item` loại `event_cancelled`, không phát Vé; Đơn `expired` → `cancelled` (`event_cancelled`) thay vì `review` (sửa nhánh `event_cancelled` của `markPaid`); Đơn `cancelled`, `refunded` giữ nguyên (AD-3, AD-7, AD-28) *(E4-5 C3; đóng mục `deferred-work.md` "Đơn `review` chỉ có mục `event_cancelled`")*

Lý do: C3, quyết định 4.

**E8. Story 7.2, AC cuối (`:1993`)**

OLD:
> **And** dòng `review_item` (phần 2) dùng chung thao tác "Đã hoàn tay" của Story 4.4 (mục → `resolved` `refunded`); một khoản không bao giờ vào cả hai phần, vì "Duyệt tay phát Vé" của 4.4 đóng mục và ghi `paid_amount` qua `markPaid` trong cùng transaction

NEW:
> **And** dòng `review_item` (phần 2) dùng chung thao tác "Đã hoàn tay" của Story 4.4 (mục → `resolved` `refunded`). Sau khi hủy, mọi Đơn có mục `open` đã ở `cancelled` (`event_cancelled`) hoặc `refunded` (Story 7.1). Vì vậy "Đã hoàn tay" bấm được ngay trên mọi dòng phần (2): BTC không phải "Từ chối" trước, và Người mua không nhận email "BTC đã hủy Đơn này" *(retro Epic 4 C3)*
> **And** một khoản không bao giờ vào cả hai phần, vì "Duyệt tay phát Vé" của 4.4 đóng mục và ghi `paid_amount` qua `markPaid` trong cùng transaction

Lý do: C3.

**E9. Story 7.6, AC job ẩn danh (`:2101`)**

OLD:
> **Then** tên, SĐT, email trên Đơn/Vé được thay bằng giá trị ẩn danh; Đơn, `payment_events`, `audit_events` không bị xóa cứng; số tiền, mã Đơn, thời điểm giữ lại ở dạng tối thiểu (FR-38, NFR-8)

NEW:
> **Then** tên, SĐT, email trên Đơn/Vé được thay bằng giá trị ẩn danh; Đơn, `payment_events`, `audit_events` không bị xóa cứng; số tiền, mã Đơn, thời điểm giữ lại ở dạng tối thiểu (FR-38, NFR-8)
> **And** giá trị ẩn danh của `orders.buyer_phone` và `orders.buyer_email` (hai cột `NOT NULL`) là giá trị mà `parseLookupQuery` (`packages/contracts/src/checkin.ts`) từ chối. Như vậy tra tay (Story 5.5, khớp đầy đủ sau chuẩn hóa) không bao giờ ra Vé của Người mua đã ẩn danh. Có test tra tay bằng chính giá trị ẩn danh *(retro Epic 5 S6)*

Lý do: S6.

**E10. Story 9.1, khối AC mới (thêm sau khối bucket ảnh, trước khối Postgres PITR)**

NEW:
> **Given** runbook xoay khóa Mã QR vé (`TICKET_QR_KEYS`; `deferred-work.md`, mục "Quy trình xoay khóa QR")
> **When** viết runbook và diễn tập ở staging
> **Then** runbook chọn một phương án ký lại (giữ khóa cũ tới khi mọi Vé của nó qua `effective_end_at`, công cụ ký lại tính lại `share_token_hash`, hoặc tách khóa link chia sẻ) và có lệnh tra `SELECT qr_key_version, count(*) FROM tickets WHERE status = 'valid' GROUP BY 1`. Khóa đã lộ không bao giờ được giữ lại trong `TICKET_QR_KEYS`; giữ khóa cũ chỉ áp cho xoay định kỳ (AD-16) *(retro Epic 5 S2)*
> **And** lệnh quét chỉ nhận Mã QR vé có phiên bản khóa `k` bằng `tickets.qr_key_version` (thêm điều kiện vào UPDATE check-in của AD-15)
> **And** mã đúng dạng mà instance thiếu phiên bản khóa thì phát marker `ticket_qr_key_missing` và gắn thuộc tính `unknown_key` cho metric quét, thay vì trả đỏ `BAD_SIGNATURE` mà không log gì *(retro Epic 5 S2, S3)*

Lý do: S2, S3.

**E11. Story 9.2, AC check-in song song (`:2269-2271`)**

OLD:
> **Given** kịch bản check-in song song (vd. 20 CTV quét 300 Vé, có quét trùng)
> **When** chạy
> **Then** p95 quét < 1 giây và không Vé nào check-in hai lần (NFR-2, FR-28)

NEW:
> **Given** kịch bản check-in song song (vd. 20 CTV quét 300 Vé, có quét trùng)
> **When** chạy
> **Then** p95 quét < 1 giây, đo phía client: script tải tính từ lúc gửi `POST /v1/checkin/events/:eventId/scans` tới lúc nhận đủ response (gồm mạng, session và guard), tính cả lượt đỏ; không Vé nào check-in hai lần (NFR-2, FR-28; chuyển từ AC 5.3)
> **And** báo cáo ghi kèm p95 của `http.server.request.duration` cho route quét và của `tickee.checkin.scan.duration` để chẩn đoán, không dùng làm tiêu chí *(Mason chốt 26/11/2026, E5-4)*
> **And** trong cùng lượt chạy, đo tải fan-out realtime: mỗi check-in làm mọi client đang mở tải lại `GET /v1/checkin/events/:eventId` (khoảng 7 câu SQL mỗi lần). Ghi p95 của GET này và tải DB (`deferred-work.md`, mục 5.7 có `story: 9.2`) *(retro Epic 5 R7)*

Lý do: F4, R7, quyết định 3.

### 4.2 Architecture (`ARCHITECTURE-SPINE.md`)

**A1. Bảng mô-đun, dòng `checkin` (`:38`)**

OLD:
> | `checkin` | Lời mời CTV, phân công CTV theo Sự kiện, màn quét, tra tay |

NEW:
> | `checkin` | Lời mời CTV (`checker_invites`), CTV theo Sự kiện (`checkers`), cổng `CheckerAccessResolver` (AD-26), API đọc của Màn quét và tab Check-in (số check-in theo Hạng vé, GET và SSE), bộ giới hạn tốc độ tra tay. Điều phối quét, tra tay và check-in tay nằm ở `flows` (AD-25) vì chạm nhiều mô-đun. Module `@Global()` (như `ticketing`, `tingee`) để `PermissionGuard` của `organizer` lấy được cổng |

Lý do: F1.

**A2. AD-25, Rule (`:320`)**

OLD (câu cuối):
> …`deleteAccount` (AD-24), `acceptCheckerInvite` (AD-30).

NEW:
> …`deleteAccount` (AD-24), `acceptCheckerInvite` (AD-30), `scanTicket` (AD-15), `lookupTickets` và `manualCheckIn` (tra tay, check-in tay).
> **Luồng đọc ghép (từ Epic 5):** `flows/` còn chứa luồng chỉ đọc cần dữ liệu của từ hai mô-đun trở lên cho một màn, kèm controller của chúng (vd. `listCheckers`, `previewCheckerInvite`, `listTicketTypes`, `eventBuyerCount`). Luồng đọc ghép không mở transaction ghi. Màn BTC đọc nhiều mô-đun theo kiểu báo cáo (dashboard, CSV, Sheets) vẫn đi qua `reporting`/`integration` và read model (AD-33).

Lý do: F1.

**A3. AD-26, gạch đầu dòng đầu của Rule (`:327`)**

OLD:
> - `platform` định nghĩa cổng `AccessResolver` và decorator `@RequirePermission(perm)`; `organizer` và `checkin` cài đặt cổng (đăng ký lúc khởi động). Guard dựng `ctx = { userId, organizationId, role, assignedEventIds, stepUpAt }` trước controller; không mô-đun nào tự truy vấn vai trò.

NEW:
> - `platform` định nghĩa decorator `@RequirePermission(perm)` và hai cổng:
>   - `AccessResolver`: vai trò của user ở một BTC, do `organizer` cài đặt.
>   - `CheckerAccessResolver`: BTC sở hữu Sự kiện, trạng thái CTV của user ở Sự kiện (`active` | `revoked` | chưa nhận), và Sự kiện đã kết thúc chưa. Do `checkin` cài đặt; `PermissionGuard` inject bằng `@Optional()`.
>
>   Hai cổng đọc lại ở mỗi request, không cache. Không mô-đun nào tự truy vấn vai trò. Guard dựng ctx trước controller:
>   - Route BTC (`/v1/orgs/:orgId/…`): `AccessContext = { userId, organizationId, role, assignedEventIds, stepUpAt }`.
>   - Route CTV (`/v1/checkin/events/:eventId/…`): `EventAccessContext = { userId, organizationId, eventId, role, assignedEventIds, stepUpAt }`. Owner/Admin của BTC có `role` là vai và `assignedEventIds: []`; CTV `active` có `role: null` và `assignedEventIds: [eventId]`.
>   - CTV `revoked` nhận `403 CHECKER_REVOKED`. Từ mốc Sự kiện kết thúc, CTV nhận `403 EVENT_ENDED` từ guard (Story 5.6).

Lý do: F1.

**A4. AD-15, Rule (`:239`)**

OLD (đoạn trong ngoặc):
> …Kết quả theo schema `ScanResult` trong `packages/contracts` (lý do: `BAD_SIGNATURE`, `CANCELLED`, `VOIDED`, `OTHER_EVENT`, `EXPIRED`, `CHECKER_REVOKED`, `EVENT_ENDED`). …

NEW:
> …Kết quả theo schema `ScanResult` trong `packages/contracts` (lý do Vé không hợp lệ: `BAD_SIGNATURE`, `CANCELLED`, `VOIDED`, `OTHER_EVENT`, `EVENT_ENDED`). Không có `EXPIRED` riêng, vì Vé hết hiệu lực đúng lúc Sự kiện kết thúc. CTV bị thu hồi không nhận kết quả quét mà nhận `403 CHECKER_REVOKED` từ guard (AD-26). …

Thêm vào cuối Rule:
> **Giới hạn của phát lại (Story 5.6):** từ mốc Sự kiện kết thúc, guard chặn CTV bằng `403 EVENT_ENDED` trước khi tới flow. Vì vậy CTV gửi lại cùng `scanId` ngay sau mốc đó nhận màn hết quyền, không nhận lại kết quả lần đầu; Owner/Admin vẫn được phát lại. Ca này chỉ xảy ra khi phản hồi mất đúng lúc BTC bấm "Kết thúc", hoặc ở mốc `effective_end_at`.

Lý do: F1.

**A5. AD-16, thêm một gạch đầu dòng sau "Quyết định (Mason, 11/11/2026, Story 3.8)"**

NEW:
> - **Ràng phiên bản khóa khi quét** *(từ Story 9.1, retro Epic 5 S2)*: phiên bản `k` trong mã phải bằng `tickets.qr_key_version`. Trước 9.1, mọi phiên bản có trong `TICKET_QR_KEYS` đều được nhận. Khóa đã lộ không được giữ lại trong env; giữ khóa cũ để verify chỉ áp cho xoay định kỳ (runbook ở Story 9.1).

Lý do: S2.

**A6. AD-31, thêm vào cuối Rule (`:369`)**

NEW:
> **Ngoại lệ có chủ đích (Story 5.1, 5.6):** tạo link mời CTV và thu hồi/khôi phục CTV không nhận `Idempotency-Key`. Gửi lại lệnh tạo link chỉ sinh thêm một link và thu hồi link trước (AD-30). Thu hồi/khôi phục khi CTV đã ở trạng thái đích trả `204`, không ghi gì. Khác tiền lệ 4.4 (bắt buộc header nhưng không lưu): ở đây không đòi header.

Lý do: F1.

**A7. AD-33, phần Hiện thực (`:397`)**

OLD:
> …`ordering` xuất `eventRevenueOf` (tổng `total_amount` và số Đơn `paid`, tính cả Đơn 0đ) …

NEW:
> …`ordering` xuất `eventRevenueOf` (tổng `paid_amount` và số Đơn `paid`, tính cả Đơn 0đ; doanh thu là tiền đã nhận, khớp danh sách hoàn tiền AD-28. Story 3.11 dựng bằng `total_amount`, Story 6.2 đổi; Mason chốt 26/11/2026, E4-5 C1) …

Lý do: C1, quyết định 1.

**A8. AD-3, sơ đồ trạng thái Đơn (`:127`, `:131-133`)**

OLD:
> ```
>   pending --> review: lệch số tiền, Sự kiện đã hủy hoặc đã kết thúc
>   …
>   expired --> review: tiền về muộn mà hết chỗ, đã kết thúc hoặc bị khóa; lệch tiền; Sự kiện đã hủy
>   review --> paid: Owner/Admin duyệt tay, còn chỗ
>   review --> cancelled: Owner/Admin từ chối
> ```

NEW:
> ```
>   pending --> review: lệch số tiền hoặc Sự kiện đã kết thúc
>   …
>   expired --> review: tiền về muộn mà hết chỗ, đã kết thúc hoặc bị khóa; lệch tiền
>   expired --> cancelled: tiền về sau khi Sự kiện bị hủy
>   review --> paid: Owner/Admin duyệt tay, còn chỗ
>   review --> cancelled: Owner/Admin từ chối; Sự kiện bị hủy
> ```

Lý do: C3, quyết định 4. Đơn `pending` của Sự kiện đã hủy không còn tồn tại, vì `cancelEvent` chuyển nó sang `cancelled` dưới khóa Sự kiện `FOR UPDATE`, và `markPaid` lấy khóa `FOR SHARE`.

**A9. AD-7, bảng IPN, bước 3 (`:168`)**

OLD:
> | 3 | Sự kiện đã hủy | Đơn → `review`; `review_item` loại `event_cancelled` (mỗi khoản tiền một mục), vào danh sách hoàn tiền |

NEW:
> | 3 | Sự kiện đã hủy | Đơn `expired` → `cancelled` (`event_cancelled`) (từ Story 7.1; trước đó → `review`), trạng thái khác giữ nguyên; `review_item` loại `event_cancelled` (mỗi khoản tiền một mục), vào danh sách hoàn tiền |

Lý do: C3, quyết định 4.

**A10. AD-28, Rule (`:349`)**

OLD (hai câu đầu):
> `flows.cancelEvent` trong một transaction: khóa dòng Sự kiện `FOR UPDATE` và chuyển `cancelled`; Đơn `pending` → `cancelled` (nhả chỗ); Đơn `paid` → `cancelled` với `cancel_reason = event_cancelled`; mọi Vé `valid` → `cancelled`; enqueue email cho người mua. Tiền về sau đó đi theo AD-7 (bước 3): mỗi khoản một `review_item` loại `event_cancelled`; Đơn `pending`/`expired` → `review`, Đơn `cancelled` (và `paid`, `review`) giữ nguyên.

NEW:
> `flows.cancelEvent` trong một transaction: khóa dòng Sự kiện `FOR UPDATE` và chuyển `cancelled`; Đơn `pending` → `cancelled` (nhả chỗ); Đơn `paid` và `review` → `cancelled` với `cancel_reason = event_cancelled`, mục `open` của Đơn giữ nguyên; mọi Vé `valid` → `cancelled`; enqueue email cho người mua. Tiền về sau đó đi theo AD-7 (bước 3): mỗi khoản một `review_item` loại `event_cancelled`; Đơn `expired` → `cancelled` (`event_cancelled`), Đơn `cancelled` và `refunded` giữ nguyên. Mục `open` gắn Đơn `cancelled` (`event_cancelled`) hoặc `refunded` chỉ có "Đã hoàn tay" và "Bỏ qua", cả hai chỉ đóng mục (Mason chốt 26/11/2026, E4-5 C2, C3).

Phần còn lại của Rule (danh sách hoàn tiền hai phần, khóa Sự kiện, `voidTickets`) giữ nguyên.

Lý do: C2, C3, quyết định 4.

### 4.3 `deferred-work.md`

- **D1.** Sau mục "Quy trình xoay khóa QR" (`:464`), thêm:
  > - Ghi thêm (26/11/2026, retro Epic 5 S2, S3, E5-4): AC 9.1 đã có khối runbook xoay khóa: khóa đã lộ không được giữ, quét ràng `qr_key_version`, marker `ticket_qr_key_missing` khi thiếu khóa. Spine AD-16 ghi luật ràng phiên bản.
- **D2.** Sau mục "Đơn `review` chỉ có mục `event_cancelled`" (`:846`), thêm:
  > - Story nhận (26/11/2026, E5-4): 7.1. Mason chốt Đơn `review` và Đơn `expired` có tiền về sau khi hủy chuyển `cancelled` (`event_cancelled`); mục của chúng chỉ đóng. AC 7.1, AD-3, AD-7, AD-28 đã ghi.
- **D3.** Sau mục fan-out check-in có `story: 9.2` (`:1277`), thêm:
  > - Ghi thêm (26/11/2026, retro Epic 5 R7, E5-4): đếm thiếu. Mỗi lần tải lại tốn khoảng 7 câu SQL, không phải 3: tra session (không có `cookieCache`, `identity/auth.ts:59`), guard (`checkinEventById`, `checkerStatusOf`, tra membership), handler (`checkinEventById` lần nữa, `ticketTypesOf`, câu `GROUP BY`). Máy vừa quét xanh tải hai lần: một lần do tín hiệu SSE, một lần do `closeResult` invalidate (`checkin-event-screen.tsx:437`). Gợi ý: bỏ invalidate khi đang connected. AC 9.2 đã ghi phép đo.
- **D4.** Mục mới ở cuối file:
  > ## Deferred from: đối chiếu spec sau Epic 5 (E5-4, 2026-11-26)
  >
  > - source_spec: `_bmad-output/implementation-artifacts/epic-5-retro-2026-11-26.md` (F6)
  >   summary: CTV đăng nhập bằng OTP không có tên, nên kết quả đỏ "đã check-in" hiện "bởi CTV khác" với mọi CTV. Khi nhiều CTV cùng cổng thì không biết ai quét trước. Cân nhắc cho CTV đặt tên hiển thị lúc nhận lời mời (Story 5.2).
  >   evidence: Spec 5.3-a (`:25`), quyết định nhãn vai trò; kiểm hành vi retro Epic 5. AC 5.3, 5.4 đã sửa theo nhãn vai trò (E5-4).
  >   story: chưa có; xét cùng E5-1 (luồng lời mời CTV).

### 4.4 `sprint-status.yaml` và retro Epic 5

- `last_updated`: ngày giờ áp đề xuất.
- `epic-5-retro-e5-4-doi-chieu-spec`: `status: done`, thêm `note`: xong qua `sprint-change-proposal-2026-11-26-doi-chieu-spec-epic-5.md`, gồm cả AC 7.6, 9.1, 9.2. p95 quét đo phía client (câu hỏi mở 6).
- `epic-4-retro-e4-5-quyet-dinh-can-xu-ly`: `status: in-progress`, thêm `note`: C1 (doanh thu theo `paid_amount`, AC 6.2, AD-33), C2 và C3 (AC 7.1/7.2, AD-3/7/28) đã chốt qua cùng đề xuất. Còn B2.
- `epic-5-retro-2026-11-26.md`, mục Câu hỏi mở: gạch câu 2 và 6, ghi câu trả lời ngắn và ngày (như câu 1).
- Không đổi epic hay story.

## 5. Bàn giao

**Phạm vi:** Minor. Chỉ sửa tài liệu, không thêm story, không đổi thứ tự epic.

| Vai | Việc |
|---|---|
| Developer agent (phiên này) | Áp §4.1–4.4 trên branch `docs/e5-4-doi-chieu-spec`; commit và mở PR khi Mason bảo |
| Mason | Duyệt đề xuất; quyết định commit, push, PR |
| Story 6.2 | Đổi `eventRevenueOf` sang `paid_amount`, thêm assert `revenue` (AC 6.2) |
| Story 7.1 | `cancelEvent` chuyển cả Đơn `review`; nhánh `event_cancelled` của `markPaid` chuyển Đơn `expired` → `cancelled`; sửa `closesOnly`/`reviewActionsFor` và bảng thao tác web (AC 7.1) |
| Story 7.6, 9.1, 9.2 | Làm theo AC mới (giá trị ẩn danh, runbook khóa QR, cách đo p95 và fan-out) |
| E5-6 (phiên riêng) | Còn lại trước Story 6.1: sửa quy trình Build |

**Tiêu chí hoàn thành:**
- `grep -n "Kiểm thử tải NFR-3 chuyển" epics.md` không còn kết quả.
- `grep -n "ở staging, có metric riêng\|tên người quét lần trước\|giữ nguyên \`review\` và loại cũ" epics.md` không còn kết quả.
- `grep -n "EXPIRED\`, \`CHECKER_REVOKED\|tổng \`total_amount\` và số Đơn" ARCHITECTURE-SPINE.md` không còn kết quả.
- AD-25 có `scanTicket`, `lookupTickets`, `manualCheckIn` và đoạn "Luồng đọc ghép"; AD-26 có `CheckerAccessResolver` và `EventAccessContext`; AD-31 có ngoại lệ lời mời CTV.
- Sơ đồ AD-3 có `expired --> cancelled` và `review --> cancelled: Owner/Admin từ chối; Sự kiện bị hủy`; AD-7 bước 3 và AD-28 khớp sơ đồ.
- AC 9.1 có khối runbook xoay khóa QR; AC 9.2 ghi đo phía client và fan-out; AC 7.6 có `parseLookupQuery`.
- `deferred-work.md` có D1–D4; `sprint-status.yaml` có E5-4 `done` và E4-5 `in-progress` kèm `note`.
