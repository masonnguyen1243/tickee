---
title: 'Sprint Change Proposal: đối chiếu spec sau Epic 3 (E3-5, E3-6)'
date: '2026-11-13'
author: 'Mason (duyệt) · Developer agent (soạn)'
status: 'approved'
scope: 'minor'
trigger_story: 'retro Epic 3, action item E3-5 và E3-6'
---

# Sprint Change Proposal: đối chiếu spec sau Epic 3 (E3-5, E3-6)

## 1. Tóm tắt vấn đề

**Nguồn:** action item E3-5 và E3-6 của retro Epic 3 (`implementation-artifacts/epic-3-retro-2026-11-12.md`).
- E3-5 gồm các phát hiện B2, D1, E1, E5.
- E3-6 gồm các mục hoãn B4–B7, C2, C4–C6, D4, D5, A2 và NFR-1.
- Cả hai phải xong trước Epic 4.

**Phân loại:**
- Tài liệu kế hoạch lệch với code đã ship ở Epic 3, và lệch nhau.
- Định nghĩa danh sách hoàn tiền có một lỗ. Chưa có code nào bị ảnh hưởng, vì Story 7.1 và 7.2 còn ở backlog.
- Một số mục hoãn chưa có story nhận.
- Đề xuất này chỉ sửa tài liệu. Phần vá code nhỏ của D1 tách thành một spec riêng (§4.6).

**Bằng chứng:**

- **B2. Danh sách hoàn tiền bỏ sót khoản tiền đã về trước khi hủy mà không thành Vé.**
  - Nguồn của luật: AD-28 tính "Đơn có `paid_amount` > 0 + mục `event_cancelled` chưa `resolved`". AC 7.2 dùng cùng định nghĩa.
  - Nguồn của lỗ: `moveToReview` (`mark-paid.ts:126`) không ghi `paid_amount`.
  - Hệ quả, ba khoản bị sót:
    - mục `amount_mismatch` mở trước khi hủy;
    - mục `orphan` mở trước khi hủy;
    - khoản thứ hai của mục `duplicate_payment`.
  - AC 7.1 còn ghi Đơn `review` "có `paid_amount` > 0 vẫn nằm trong danh sách", trong khi Đơn `review` không bao giờ có `paid_amount`.
- **D1. Token link chia sẻ buộc vào khóa QR của Vé.**
  - Token là HMAC bằng khóa con suy từ khóa `qr_key_version` của Vé (`ticketing/share-token.ts:24-31`).
  - Gỡ một phiên bản khóa thì:
    - route công khai `GET /v1/shared-tickets/:token` trả 500 thay vì 404 chung (`tickets.service.ts:183`, `signTicketQr` ném lỗi);
    - Chi tiết Vé trả 500;
    - email Vé retry rồi vào dead-letter.
  - Ký lại Vé sang khóa mới (`UPDATE tickets SET qr_key_version = 2`) thì QR đúng, nhưng `share_token_hash` vẫn là hash của token cũ, nên mọi link, kể cả link trong email, 404 im lặng.
  - Mục hoãn hiện có (`deferred-work.md`, review 3.3 triage #8) mới chỉ tính Trang Đơn.
  - Chưa có test nào cho Vé ký bằng khóa cũ.
- **E1 (a). Sơ đồ mermaid trong spine thiếu cạnh `payment → organizer`.**
  - `module-graph.cjs:12` đã thêm cạnh này ở `f7ba13f` (Story 3.5, tra BTC theo `ipnKey`).
  - AD-10 ghi cấu hình CI "sinh từ sơ đồ".
- **E1 (b). Spine ghi `integration` sở hữu việc gửi email (`EmailTransport`), nhưng code làm khác:**
  - `EmailTransport` nằm ở `platform/email`;
  - mỗi mô-đun tự soạn và gửi email của nghiệp vụ mình: `identity` (OTP, mã xác nhận lại, email bảo mật 2FA), `organizer` (3 queue), `ordering` (2 queue);
  - `integration/index.ts` vẫn rỗng.
- **E5. `epics.md` không có commit nào trong Epic 3, trong khi spine được sửa 8 lần.** Các AC còn ghi bản cũ:
  - 3.3: trần Vé miễn phí "cộng mọi Đơn `paid`". Mason chốt 10/11: chỉ đếm Đơn `paid` tổng 0đ, áp cho mọi Đơn 0đ.
  - 3.4:
    - ký "timestamp UNIX ms" (code dùng `yyyyMMddHHmmssSSS`);
    - `expires_at` = "hạn link do Tingee trả" (Tingee không trả hạn link);
    - lỗi `ORDER_EXPIRED` (code trả Đơn kèm `linkError`).
  - 3.6: "tối đa một mục `open` mỗi loại". Code: mỗi khoản tiền một mục; `event_cancelled` cũng một mục cho mỗi khoản.
  - 3.8:
    - "`share_token` ngẫu nhiên 128 bit" (code dùng HMAC suy ra; PRD FR-22 cũng còn bản cũ);
    - câu hỏi mở `qr_version` đã chốt ngày 11/11.
  - 3.9: "tăng độ sáng màn hình" (code dùng Screen Wake Lock); chưa ghi việc Đơn `expired` hiện 30 phút.
  - 3.10: điều kiện gửi email (4 điều kiện, định nghĩa "Người mua") chưa ghi.
  - Mục tiêu Epic 3 vẫn liệt kê FR-17, đã bị AD-6 thay.

**Quyết định của Mason (13/11/2026):**

- **Q1 (E5):** sửa 7 điểm lệch, và ghi luật nguồn đúng vào đầu `epics.md`: story đã `done` thì spec đã duyệt + spine thắng; `epics.md` chỉ ràng buộc story chưa làm. PRD FR-22 sửa theo.
- **Q2 (E1 b):** sửa spine theo code. `EmailTransport` thuộc `platform`, mỗi mô-đun sở hữu email của nghiệp vụ mình, `integration` còn Google Sheets và danh mục thông báo. Thêm bảng email theo mô-đun vào spine. Không đổi code.
- **Q3 (D1):** phần code (route công khai trả 404 khi thiếu khóa, test Vé khóa cũ) làm bằng một spec nhỏ riêng, trước Story 4.1.
- **Q4:** duyệt theo batch.

## 2. Phân tích tác động (kết quả checklist)

| Mục | Trạng thái | Ghi chú |
|---|---|---|
| 1.1 Story kích hoạt | [x] | Retro Epic 3, E3-5 (B2, D1, E1, E5) và E3-6 |
| 1.2 Loại vấn đề | [x] | Tài liệu lệch code và lệch nhau; một lỗ đặc tả (B2) ở story chưa làm; mục hoãn chưa có story nhận |
| 1.3 Bằng chứng | [x] | §1, dẫn file:dòng theo retro và đã kiểm lại trên HEAD `be37d07` |
| 2.1 Epic hiện tại | [x] | Epic 3 vẫn `done`, không mở lại |
| 2.2 Thay đổi cấp epic | [N/A] | Không thêm, bỏ hay đổi phạm vi epic |
| 2.3 Epic tương lai | [!] | Epic 7: AC 7.1 và 7.2 theo định nghĩa danh sách hoàn tiền mới. Epic 4/5/7: nhận bàn giao trong `deferred-work.md` (4.1, 4.4, 4.6, 4.7, 5.3, 5.8, 7.1, 7.2, 7.4, 7.5). Không đổi AC của Epic 4/5 |
| 2.4 Epic lỗi thời / mới | [N/A] | Không |
| 2.5 Thứ tự epic | [N/A] | Giữ nguyên |
| 3.1 PRD | [!] | FR-22 (token link), FR-33 (danh sách hoàn tiền) |
| 3.2 Architecture | [!] | Bảng mô-đun (`integration`, `platform`), bảng email theo mô-đun (mới), sơ đồ mermaid, AD-28, AD-29, bảng FR → mô-đun (dòng FR-22–FR-25) |
| 3.3 UX | [!] | EXPERIENCE.md, dòng "Sau khi Hủy Sự kiện": danh sách gồm cả khoản ở hàng Cần xử lý. Câu banner "{n} Đơn cần hoàn tiền" giữ nguyên |
| 3.4 Artifact khác | [!] | `deferred-work.md` (mở rộng mục xoay khóa QR, thêm mục bàn giao E3-6), spec mới cho D1, `sprint-status.yaml`. Không sửa `epic-3-context.md:45`: đó là tài liệu của epic đã đóng |
| 4.1 Sửa trực tiếp | Viable | Effort thấp đến trung bình, rủi ro thấp. Chỉ sửa tài liệu; phần code D1 nhỏ và tách riêng |
| 4.2 Rollback | Not viable | Không có code cần lùi |
| 4.3 Xem lại MVP | Not viable | MVP không đổi |
| 4.4 Chọn hướng | [x] | Sửa trực tiếp |

## 3. Hướng đi đề xuất

**Chọn: sửa trực tiếp tài liệu**, cộng một spec code nhỏ cho D1.

- `epics.md` có luật nguồn đúng rõ ràng. Từ nay, lệch giữa AC của story đã `done` và spec không còn làm sai story sau, vì story sau đọc spine và spec. 7 điểm lệch đã biết được sửa luôn, để Epic 4 không đọc nhầm hành vi của Epic 3.
- AD-28, Story 7.1, Story 7.2, PRD FR-33 và EXPERIENCE dùng cùng một định nghĩa danh sách hoàn tiền, gồm hai phần:
  1. Đơn có `paid_amount` > 0 chưa `refunded`;
  2. mọi `review_item` còn `open` gắn Đơn của Sự kiện, bất kể loại và bất kể mở trước hay sau khi hủy.

  Mục `unmatched` không gắn Đơn nên không vào danh sách.
- Spine mô tả đúng chỗ đặt email và đúng đồ thị mô-đun. Luật cho email mới: mô-đun sở hữu nghiệp vụ thì gửi.
- Mỗi mục hoãn của retro Epic 3 có đúng một story nhận trong `deferred-work.md`.

**Rủi ro:**

- Thấp: chỉ đổi tài liệu.
- Banner 7.2 vẫn đếm theo Đơn ("{n} Đơn cần hoàn tiền"), trong khi danh sách và CSV liệt kê theo khoản. Một Đơn `paid` có khoản trả trùng hiện hai dòng nhưng chỉ tính là một Đơn. Nếu Mason muốn đếm theo khoản thì phải đổi câu chữ UX-DR40 và EXPERIENCE (chưa đề xuất).
- Luật nguồn đúng chỉ hiệu quả khi spec ghi đủ lệch có chủ đích. Retro F2 cho thấy Spec Change Log gần như rỗng; luật mới dựa vào Boundaries và Design Notes của spec. Quyết định giữ hay bỏ luật Spec Change Log vẫn thuộc E2-8.

## 4. Chi tiết đề xuất sửa

### 4.1 Epics (`epics.md`)

**Overview:** thêm một đoạn ngay sau đoạn "Thứ tự hiệu lực khi các nguồn khác nhau":

> `**Story đã xong (`done`):** Từ 13/11/2026 (E3-5), spec đã duyệt của story (`implementation-artifacts/spec-*.md`) và `ARCHITECTURE-SPINE.md` là nguồn đúng về hành vi đã triển khai. AC ở đây lệch với spec hoặc spine của story đã `done` thì spec và spine thắng. AC trong tài liệu này ràng buộc story chưa làm; story mới chạm hành vi đã ship thì đọc spine và spec của story đó. Lệch có chủ đích phát hiện lúc build được ghi trong spec (Boundaries, Design Notes); lần đối chiếu sau mỗi retro gom các lệch đáng kể về đây.`

**Epic List, Epic 3:** dòng `**FRs covered:**` bỏ `FR-17, `. Dòng FR-17 trong FR Coverage Map giữ nguyên ("Đã bị AD-6 thay").

**Story 3.3, AC cuối:**
- CŨ:
  - `**Given** Sự kiện miễn phí`
  - `**Then** tổng số Vé của Người mua đó trên Sự kiện (cộng mọi Đơn `paid`) không vượt giới hạn Vé/Đơn của Sự kiện; vượt thì báo "Bạn đã nhận đủ số Vé tối đa cho Sự kiện này."; kiểm trong cùng transaction với bán có điều kiện`
- MỚI:
  - `**Given** Đơn tổng 0đ, kể cả ở Sự kiện có Hạng vé có phí`
  - `**Then** số Vé trong các Đơn `paid` tổng 0đ của Người mua đó trên Sự kiện, cộng số Vé xin thêm, không vượt giới hạn Vé/Đơn của Sự kiện; Vé có phí không tính; vượt thì 409 `FREE_TICKET_LIMIT_REACHED` "Bạn đã nhận đủ số Vé tối đa cho Sự kiện này."; kiểm trong cùng transaction với bán có điều kiện *(Mason chốt 10/11, spec 3.3)*`
- Dòng `**When**` giữ nguyên.

**Story 3.4:**
- AC 1, cuối câu:
  - CŨ: `adapter ký timestamp UNIX ms (FR-16, AD-5, AD-6, AD-9)`
  - MỚI: `header `x-request-timestamp` dạng `yyyyMMddHHmmssSSS` giờ Việt Nam như các API Tingee khác (Tingee production trả `90` cho UNIX ms, 10/11) (FR-16, AD-5, AD-6, AD-9)`
- AC 3 (TX2):
  - CŨ: `đặt `expires_at` = hạn link do Tingee trả`
  - MỚI: `đặt `expires_at` = thời điểm giành lượt gọi (`payment_link_attempt_at`, đồng hồ DB) + 15 phút, vì Tingee không trả hạn link`
- AC 4:
  - CŨ: `API trả `ORDER_EXPIRED` và web hiện màn Hết hạn của Story 3.7`
  - MỚI: `API trả Đơn (`BuyerOrderView`) ở trạng thái `expired` thay vì mã lỗi, và web hiện màn Hết hạn của Story 3.7`
- Thêm AC ngay sau AC 4: `**And** kết quả tạo link nằm ở `linkError` của Đơn (`provider_error` | `sales_paused` | `timeout` | null), lưu trong DB, nên tải lại trang vẫn hiện đúng màn (spec 3.4)`

**Story 3.6, khối AC `review_items`:**
- AC đầu:
  - CŨ: `**Then** mỗi Đơn tối đa một mục `open` cho mỗi loại, **trừ** `duplicate_payment`: loại này unique theo `(order_id, type, payment_event_id)`, nên mỗi khoản trả trùng là một mục riêng và BTC hoàn đủ từng khoản`
  - MỚI: `**Then** mỗi khoản tiền (`payment_event_id`) có tối đa một mục; `amount_mismatch` và `orphan` có thêm ràng buộc tối đa một mục `open` mỗi Đơn mỗi loại; `duplicate_payment` và `event_cancelled` là một mục cho mỗi khoản (khoản trả thứ hai cho Đơn của Sự kiện đã hủy cũng vào `event_cancelled`, spec 3.6), nên BTC hoàn đủ từng khoản`
- AC kế tiếp:
  - CŨ: `**And** mục `duplicate_payment` và `unmatched` chỉ kết thúc bằng `refunded` hoặc `dismissed``
  - MỚI: `**And** mục `duplicate_payment`, `unmatched` và `event_cancelled` chỉ kết thúc bằng `refunded` hoặc `dismissed``

**Story 3.8:**
- AC 1:
  - CŨ: `**Then** có `share_token` ngẫu nhiên 128 bit, DB chỉ lưu hash (AD-29)`
  - MỚI: `**Then** có token link chia sẻ 128 bit, là HMAC của `share:<ticketId>:<share_version>` bằng khóa con suy từ khóa `TICKET_QR_KEYS` phiên bản `qr_key_version` của Vé; DB chỉ lưu `share_token_hash`; máy chủ tính lại token khi cần, nên chia sẻ lặp ra cùng một link (AD-29, Mason 11/11)`
- AC cuối:
  - CŨ: `*(Câu hỏi mở cho Architecture: có thêm `qr_version` vào phần được ký của AD-16 để đổi được mã khi gửi nhầm hay không.)*`
  - MỚI: `*(Đã chốt 11/11/2026: không thêm `qr_version`; đổi mã khi gửi nhầm chưa có ở MVP. Xem AD-16, AD-29.)*`

**Story 3.9:**
- *(Thêm khi áp, 13/11: cùng điểm "tăng độ sáng" còn ở dòng UX-DR20 của Requirements Inventory trong `epics.md` và dòng `ticket-card` trong EXPERIENCE.md; cả hai đổi sang Screen Wake Lock như AC Chi tiết Vé bên dưới.)*
- AC Đơn `pending`:
  - CŨ: `chỉ khi API trả `buyerStatus` = `expired` (qua `order_changed` hoặc REST) thẻ mới đổi "Hết hạn" rồi rời nhóm (AD-4, UX-DR17)`
  - MỚI: `chỉ khi API trả `buyerStatus` = `expired` (qua `order_changed` hoặc REST) thẻ mới đổi "Hết hạn" (không nút); API còn trả Đơn `expired` trong nhóm này 30 phút sau `expires_at` (đồng hồ DB), để tiền về muộn chuyển `paid` vẫn thấy được; quá mốc thì thẻ rời nhóm ở lần tải sau (AD-4, UX-DR17)`
- AC Chi tiết Vé:
  - CŨ: `tăng độ sáng màn hình nếu trình duyệt cho phép`
  - MỚI: `giữ màn hình không tối bằng Screen Wake Lock khi đang hiện QR (trình duyệt không có API chỉnh độ sáng; không hỗ trợ hoặc bị từ chối thì bỏ qua, không báo lỗi)`

**Story 3.10:**
- AC 1, dòng `**Given**`:
  - CŨ: `**Given** Sự kiện đã phát ít nhất một Vé`
  - MỚI: `**Given** Sự kiện không ở `draft` hay `cancelled`, có ít nhất một Người mua (một `user_id` có Đơn `paid` của Sự kiện, tính cả Đơn 0đ), và sau khi sửa Sự kiện chưa kết thúc (`effective_end_at` mới > `now()` của DB)`
- AC 1, dòng `**Then**`:
  - CŨ: `**Then** trước khi lưu, `Dialog` báo "Email sẽ được gửi tới {n} Người mua." (FR-7, UX-DR41)`
  - MỚI: `**Then** trước khi lưu, `Dialog` báo "Email sẽ được gửi tới {n} Người mua.", `n` lấy từ `GET /v1/orgs/:orgId/events/:eventId/buyer-count` theo cùng định nghĩa Người mua (FR-7, UX-DR41)`
- Thêm AC sau dòng enqueue: `**And** mỗi Người mua nhận một email dù có nhiều Đơn, gửi tới `buyer_email` của Đơn `paid` mới nhất của người đó (spec 3.10)`
- AC 2:
  - CŨ: `**Given** Sự kiện chưa phát Vé nào, hoặc chỉ sửa trường khác`
  - MỚI: `**Given** Sự kiện chưa có Người mua nào, đã kết thúc sau khi sửa, hoặc chỉ sửa trường khác`

**Story 7.1, AC `flows.cancelEvent`, dòng Đơn `review`:**
- CŨ: `Đơn có `paid_amount` > 0 vẫn nằm trong danh sách hoàn tiền của Story 7.2`
- MỚI: `khoản tiền của mục đó nằm trong danh sách hoàn tiền của Story 7.2 (AD-28), vì Đơn `review` không ghi `paid_amount``

**Story 7.2:**
- AC 1, dòng `**Then**`:
  - CŨ: `**Then** banner "{n} Đơn cần hoàn tiền" + "Xuất danh sách hoàn tiền"; `n` là truy vấn động: mọi Đơn có `paid_amount` > 0 của Sự kiện chưa `refunded`, kể cả Đơn có tiền về sau khi hủy (FR-33, UX-DR40, AD-28)`
  - MỚI: `**Then** banner "{n} Đơn cần hoàn tiền" + "Xuất danh sách hoàn tiền". Danh sách hoàn tiền là truy vấn động theo AD-28, mỗi khoản một dòng: (1) Đơn có `paid_amount` > 0 của Sự kiện chưa `refunded`; (2) mọi `review_item` còn `open` gắn Đơn của Sự kiện, mọi loại (`event_cancelled`, `amount_mismatch`, `orphan`, `duplicate_payment`), mở trước hay sau khi hủy, số tiền lấy từ `payment_events` của mục. `n` là số Đơn còn ít nhất một dòng (FR-33, UX-DR40, AD-28)`
- AC CSV:
  - CŨ: `**Then** CSV gồm Người mua, SĐT, email, số tiền đã trả, mã Đơn, thời điểm thanh toán`
  - MỚI: `**Then** CSV mỗi khoản một dòng: Người mua, SĐT, email, số tiền, mã Đơn, thời điểm thanh toán`
- AC "Đã hoàn tay", dòng `**Given**`:
  - CŨ: `**Given** một Đơn trong danh sách`
  - MỚI: `**Given** một dòng Đơn (phần 1) trong danh sách`
- AC "Đã hoàn tay hết", dòng `**Given**`:
  - CŨ: `**Given** mọi Đơn đã `refunded``
  - MỚI: `**Given** danh sách không còn dòng nào`
- AC cuối:
  - CŨ: `**And** `review_item` loại `event_cancelled` dùng chung thao tác "Đã hoàn tay" của Story 4.4, nên Đơn đó không bị tính hai lần`
  - MỚI: `**And** dòng `review_item` (phần 2) dùng chung thao tác "Đã hoàn tay" của Story 4.4 (mục → `resolved` `refunded`); một khoản không bao giờ vào cả hai phần, vì "Duyệt tay phát Vé" của 4.4 đóng mục và ghi `paid_amount` qua `markPaid` trong cùng transaction`

**Không sửa:**
- AC 3.7 "test Playwright với Tingee fake": vẫn theo dõi ở AI-6, và luật nguồn đúng đã phủ (spec 3.7 ghi lệch có chủ đích).
- Story 4.4: bất biến "duyệt thì ghi `paid_amount`" đã đúng sẵn qua `markPaid`.

### 4.2 PRD (`prds/prd-tickee-2026-10-27/prd.md`)

Frontmatter: `updated: 2026-11-13`.

**FR-22, hệ quả 3:**
- CŨ: `Link Vé chứa mã ngẫu nhiên, không đoán được.`
- MỚI: `Link Vé chứa mã 128 bit không đoán được, máy chủ tính bằng khóa bí mật, nên chia sẻ lặp lại ra cùng một link.`
- Phần sau giữ nguyên.

**FR-33:**
- Hệ quả 2:
  - CŨ: `Danh sách cần hoàn tiền gồm Người mua, SĐT, email, số tiền đã trả và mã Đơn.`
  - MỚI: `Danh sách cần hoàn tiền gồm Người mua, SĐT, email, số tiền đã trả và mã Đơn, cho mọi khoản tiền đã về mà chưa hoàn: Đơn đã thanh toán, và các khoản về mà không thành Vé (lệch số tiền, về muộn, trả trùng), dù về trước hay sau khi hủy (AD-28).`
- Hệ quả 3:
  - CŨ: `BTC tự chuyển hoàn tiền ngoài hệ thống rồi đánh dấu từng Đơn là "Đã hoàn tay".`
  - MỚI: `BTC tự chuyển hoàn tiền ngoài hệ thống rồi đánh dấu từng khoản là "Đã hoàn tay".`

### 4.3 Architecture (`ARCHITECTURE-SPINE.md`)

**Frontmatter:** `updated: '2026-11-13'`.

**Bảng mô-đun:**
- Dòng `integration`:
  - CŨ: `Gửi email (`EmailTransport`), kết nối Google Sheets và ánh xạ dòng, danh mục thông báo`
  - MỚI: `Kết nối Google Sheets và ánh xạ dòng, danh mục thông báo`
- Dòng `platform`:
  - CŨ: `…, hàng đợi job, realtime (SSE/NOTIFY), config, log`
  - MỚI: `…, hàng đợi job, realtime (SSE/NOTIFY), cổng gửi email `EmailTransport` (SMTP; Mailpit ở local) và `escapeHtml`, config, log`

**Thêm ngay sau bảng mô-đun:**

> **Email theo mô-đun** *(E3-5, 13/11/2026)*. Mô-đun sở hữu nghiệp vụ kích hoạt email thì sở hữu mẫu email, queue và handler. Queue khai báo tên trong `packages/contracts` (AD-12). Handler gửi qua `EmailTransport` của `platform` và chỉ đọc dữ liệu của mô-đun khác qua read model (AD-33). Email mới theo cùng luật.
>
> | Mô-đun | Email | Cách gửi |
> | --- | --- | --- |
> | `identity` | Mã đăng nhập OTP; mã xác nhận lại (step-up); email bảo mật khi bật/tắt 2FA | Gửi đồng bộ trong request, không qua queue |
> | `organizer` | Lời mời Admin; báo chuyển Owner; báo đổi tài khoản nhận tiền mặc định hoặc đổi key | Queue `organizer.send-admin-invitation`, `organizer.notify-ownership-transferred`, `organizer.notify-default-payout-changed` |
> | `ordering` | Email Vé (mỗi Vé một link chia sẻ); tiền về muộn khi Hạng vé đã hết (`orphan_sold_out`); báo đổi giờ/địa điểm | Queue `ordering.send-buyer-email` (phân biệt bằng `kind`), `ordering.send-event-change-email` (job gốc theo phiên bản Sự kiện, job con theo Người mua) |

**Sơ đồ mermaid:** thêm `payment --> organizer` ngay sau `payment --> ordering`, khớp `module-graph.cjs` (cạnh thêm ở `f7ba13f`, Story 3.5).

**AD-28:**
- Prevents:
  - CŨ: `danh sách hoàn tiền thiếu người trả tiền sau khi hủy.`
  - MỚI: `danh sách hoàn tiền thiếu khoản tiền đã về, dù về trước hay sau khi hủy.`
- Rule, câu danh sách hoàn tiền:
  - CŨ: `Danh sách hoàn tiền là truy vấn động: mọi Đơn có `paid_amount` > 0 thuộc Sự kiện, chưa `refunded`, cộng mọi `review_items` loại `event_cancelled` chưa `resolved` của Sự kiện (khoản tiền về sau khi hủy: Đơn `review`/`cancelled` không ghi `paid_amount`; số tiền lấy từ `payment_events` của mục).`
  - MỚI: `Danh sách hoàn tiền là truy vấn động gồm hai phần: (1) mọi Đơn có `paid_amount` > 0 thuộc Sự kiện, chưa `refunded`; (2) mọi `review_items` còn `open` gắn Đơn của Sự kiện, mọi loại (`event_cancelled`, `amount_mismatch`, `orphan`, `duplicate_payment`), mở trước hay sau khi hủy, mỗi mục một dòng, số tiền lấy từ `payment_events` của mục. Phần (2) phủ các khoản tiền đã về mà không thành `paid_amount`: Đơn `review`/`cancelled` không ghi `paid_amount`, và khoản trả thứ hai của Đơn `paid` nằm ở mục `duplicate_payment`. Mục `unmatched` không gắn Đơn nên không vào danh sách; nó ở hàng Cần xử lý của BTC. Một khoản không vào cả hai phần: duyệt tay phát Vé (Story 4.4) đóng mục và ghi `paid_amount` qua `markPaid` trong cùng transaction.`

**AD-29, mục Token:** thêm cuối mục:

> `Hệ quả: token buộc vào khóa QR của Vé. Gỡ một phiên bản khóa khỏi `TICKET_QR_KEYS` làm hỏng mọi link chia sẻ của Vé ký bằng khóa đó (route công khai trả `404` chung); ký lại Vé sang khóa mới cũng đổi token, nên link cũ, kể cả trong email đã gửi, không còn khớp. Quy trình xoay khóa (Story 4.7) phải tính cả link chia sẻ.`

**Bảng FR → mô-đun, dòng FR-22–FR-25:**
- CŨ: `` `ticketing`, `integration`, `apps/web` ``
- MỚI: `` `ticketing`, `ordering` (email Vé), `apps/web` ``

### 4.4 UX (`ux-designs/ux-tickee-2026-10-27/EXPERIENCE.md`)

Frontmatter: `updated: 2026-11-13`.

**Bảng trạng thái, dòng "Sau khi Hủy Sự kiện":**
- CŨ: `tab Đơn lọc sẵn Đơn Đã thanh toán chưa "Đã hoàn tay"; mọi thao tác bán tắt (FR-33).`
- MỚI: `tab Đơn lọc sẵn Đơn Đã thanh toán chưa "Đã hoàn tay"; khoản tiền đang ở hàng Cần xử lý của Sự kiện (lệch số tiền, về muộn, trả trùng, về sau khi hủy) cũng nằm trong danh sách hoàn tiền và được đánh dấu "Đã hoàn tay" từ hàng Cần xử lý (Story 4.4); mọi thao tác bán tắt (FR-33, AD-28).`

Câu banner "{n} Đơn cần hoàn tiền" và Flow 4 giữ nguyên.

### 4.5 `deferred-work.md`

**(a) Mở rộng mục xoay khóa QR** (mục "Story 4.7/4.6. Quy trình xoay khóa QR…" trong phần "build of spec-3-3"). Thêm ngay dưới mục:

> `- Ghi thêm (13/11/2026, retro Epic 3 D1, E3-5): phạm vi xoay khóa rộng hơn Trang Đơn. Token link chia sẻ (AD-29, `ticketing/share-token.ts`) là HMAC bằng khóa con suy từ khóa `qr_key_version` của Vé. (1) Gỡ một phiên bản khóa: route công khai `GET /v1/shared-tickets/:token` 500, Chi tiết Vé 500, job email Vé retry rồi vào dead-letter. Spec nhỏ trước 4.1 sửa route công khai về `404` chung và thêm test Vé khóa cũ (Sprint Change Proposal 13/11/2026 §4.6); Chi tiết Vé, Trang Đơn và email vẫn là lỗi cấu hình. (2) Ký lại bằng `UPDATE tickets SET qr_key_version = 2`: QR đúng nhưng `share_token_hash` vẫn là hash của token cũ, nên mọi link, kể cả trong email đã gửi, 404 im lặng. Runbook của 4.7 phải chọn một trong ba: giữ khóa cũ trong `TICKET_QR_KEYS` tới khi mọi Vé của nó qua `effective_end_at` (chỉ ngừng ký Vé mới bằng khóa đó); công cụ ký lại tính lại `share_token_hash` và gửi lại email Vé (link cũ chết); hoặc tách khóa link chia sẻ khỏi khóa QR (đổi AD-29). Kèm lệnh tra `SELECT qr_key_version, count(*) FROM tickets WHERE status = 'valid' GROUP BY 1`.`

**(b) Thêm phần mới ở cuối file:**

```markdown
## Deferred from: retrospective Epic 3 (2026-11-12) — bàn giao có story nhận (E3-6)

Mỗi mục dưới đây có đúng một story nhận. Story nhận đọc mục này khi lập spec. Nguồn: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`.

- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 4.1 (B4). IPN `expired`/`canceled` nhả chỗ ngay, bỏ qua 5 phút ân hạn mà job (c) dành cho tiền về sát hạn. 4.1 quyết: giữ nhả ngay, hay để Đối soát bù tra lại trước khi nhả.
  evidence: `payment/ipn-processor.ts:293-297` so với job (c) trong `ordering/order-jobs.ts` (chạy ở `expires_at` + 5 phút). Retro Epic 3 B4 (LOW).
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 4.1 (B5). `IpnProcessor.process` hard-code nguồn `ipn`; Đối soát bù gọi `markPaid` nguồn `reconciliation` phải truyền nguồn vào. Chống lặp giữa IPN và Đối soát bù dựa vào việc API tra trạng thái trả đúng `providerTransactionCode` như IPN (unique `(organization_id, provider_transaction_code)` của `payment_events`).
  evidence: `payment/ipn-processor.ts:274`. Xác nhận dạng mã giao dịch bằng UAT Tingee (E3-3) hoặc câu trả lời của Tingee (action item Epic 4 về API tra trạng thái theo `orderId`). Retro Epic 3 B5 (LOW).
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 4.1 (C5). Trang Đơn thôi polling khi Đơn `expired`, trong khi `expired` còn chuyển được sang `paid`/`review` khi tiền về muộn. 4.1 tra tiếp Đơn `expired` tới 24 giờ, nên Trang Đơn (và thẻ "Hết hạn" của Vé của tôi, 30 phút) cần vẫn nhận được thay đổi trong cửa sổ đó.
  evidence: `apps/web/lib/order/live.ts:19-21`. Câu "Nếu bạn đã chuyển tiền, đừng chuyển lại — kiểm tra Vé của tôi hoặc email." giảm tác hại. Retro Epic 3 C5 (LOW).
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 4.4, 7.1, 7.2, 7.5 (C6). Mọi nơi mới ghi `orders.status` (4.4 "Từ chối" và "Duyệt tay phát Vé"; 7.1 hủy Sự kiện; 7.2 "Đã hoàn tay" → `refunded`) phải phát `order_changed` và `event_orders_changed` trong cùng `tx` (AD-17). Hiện việc này chỉ dựa vào quy ước. Cân nhắc hàm chung `transitionOrder(tx, …)` phát tín hiệu sẵn. Riêng 7.5: doanh thu Tổng quan phải bỏ Đơn có toàn bộ Vé `voided`.
  evidence: `eventRevenueOf` (`ordering/event-overview-read.ts:17-29`) cộng mọi Đơn `paid`, chưa biết Vé `voided`; `epics.md` Story 7.5. Các mục 4.4 (đóng `review_item` không đổi Đơn) và 7.1 (tín hiệu khi hủy) ở phần "build of spec-3-7" và "build of spec-3-11" là trường hợp riêng của mục này. Retro Epic 3 C6 (LOW).
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 5.8 (C2). Đo trong bài test tải: commit có `NOTIFY` bị Postgres tuần tự hóa, và một số transaction vẫn `NOTIFY` khi đang giữ khóa dòng `ticket_type_inventory`; 3.11 thêm một commit `NOTIFY` cho mỗi Đơn. Nếu nghẽn thì dời `NOTIFY` ra sau khóa nóng hoặc gom.
  evidence: `ordering/order-changed.ts:36-40` (đã cấm `NOTIFY` trong TX1 vì lý do này); `notifyOrderChanged` ở `mark-paid.ts:134,336`, `order-jobs.ts:117,142`, `payment-link.ts:251`; `announceOrderCreated` ở `orders.service.ts:161`. Spec 3.11 triage #2 chỉ xét round trip. Chưa đo trên PG 18. Retro Epic 3 C2 (MEDIUM, chưa đo).
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 5.8 (D4). Fan-out email đổi giờ/địa điểm gửi tuần tự, SMTP không pool. Đo với N lớn trên Mailpit; nếu chậm thì bật pool hoặc chạy job con song song.
  evidence: vòng gửi ở `ordering/event-change-email-jobs.ts:203`, `createTransport` không pool ở `platform/email/smtp-transport.ts:15`. Retro Epic 3 D4 (LOW, chưa đo).
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 5.8 (NFR-1). AC 3.4 "p95 tạo link dưới 2 giây" chưa có test hay ghi chép nào. Đo trong 5.8 (Tingee fake có độ trễ cấu hình được, đo từ gửi Đơn tới khi có checkout URL) và ghi vào báo cáo tải.
  evidence: Spec 3.4 và các mục trước của file này không nhắc. Retro Epic 3 E5.
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 4.6 và 5.8 (A2). Giữ chỗ hàng loạt bằng nhiều tài khoản OTP. Server tạo link ngay sau TX1, nên mỗi Đơn có phí giữ chỗ khoảng 20 phút (15 phút link + 5 phút ân hạn), không phải 60 giây. Giới hạn hiện có theo user và theo IP; chưa có trần số Vé đang giữ. Cần quyết trước 4.6: trần Vé đang giữ (theo IP hoặc theo Sự kiện), hay chỉ tạo link khi Người mua bấm "Thanh toán". 4.6 nhận phần cảnh báo, 5.8 đo.
  evidence: Retro Epic 3 A2 (MEDIUM) và câu hỏi mở 5. Chưa có trong bảng triage của 3.2/3.4.
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 4.7 (C4). Checklist deploy: edge phục vụ API bằng HTTP/2. Ba loại trang giữ SSE dài hạn tới cùng origin API (Trang Đơn, Vé của tôi, Tổng quan), mà HTTP/1.1 chỉ cho 6 kết nối mỗi origin.
  evidence: Spec 3.7 #8, #28 reject với tiền đề "≥ 6 tab Trang Đơn"; 3.9 và 3.11 thêm hai loại trang. Retro Epic 3 C4 (LOW).
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 7.4 (B7). Nối cờ "BTC bị khóa" thật vào `organizationLocked` và thêm ca test nhánh "BTC bị khóa" của AD-7 bước 6 tại `markPaid`.
  evidence: `event/sale-rules.ts:20-22` (`organizationLocked` luôn `false`), `ordering/mark-paid.ts:266`. Retro Epic 3 B7 (LOW).
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 5.3 (D5). `/xem-ve` (người nhận link chia sẻ) không giữ màn hình sáng, khác Chi tiết Vé. Người đi cùng thường là người đưa QR ở cổng. Khi làm màn quét, thêm Screen Wake Lock cho `/xem-ve` bằng hook của 3.9. Chấp nhận thiếu ở MVP nếu 5.3 không kịp.
  evidence: Hook Wake Lock ở `apps/web/lib/tickets/wake-lock.ts` (spec 3.9). Đúng phạm vi spec 3.8. Retro Epic 3 D5 (LOW).
```

### 4.6 Spec mới cho D1 (làm bằng `bmad-build`, trước Story 4.1)

- **Tên gợi ý:** `spec-epic-3-e3-5-link-chia-se-thieu-khoa-qr.md`.
- **Phạm vi:**
  - `TicketsService.sharedTicket`: Vé có `qr_key_version` không còn trong `TICKET_QR_KEYS` → `404` chung (`sharedTicketNotFound`) thay vì 500, kèm log mức `error` không chứa token.
  - Test với helper có hai phiên bản khóa:
    - Vé ký bằng khóa cũ còn trong env: Trang Đơn, Chi tiết Vé, link chia sẻ và email Vé đều đúng;
    - gỡ khóa cũ: route công khai trả `404`.
- **Ngoài phạm vi:**
  - Chi tiết Vé, Trang Đơn và email khi thiếu khóa: vẫn là lỗi cấu hình, xử lý ở runbook 4.7;
  - công cụ ký lại;
  - tách khóa link chia sẻ.

### 4.7 `sprint-status.yaml`

- `last_updated`: ngày giờ áp đề xuất.
- `epic-3-retro-e3-5-doi-chieu-spec`: `status: in-progress`, thêm `note`: phần tài liệu xong qua đề xuất này (13/11); còn vá D1 bằng spec nhỏ trước 4.1 (§4.6). Spec đó merge thì chuyển `done`.
- `epic-3-retro-e3-6-ban-giao-deferred`: `status: done`, thêm `note` trỏ về đề xuất này và phần mới của `deferred-work.md`.
- Không đổi epic hay story.

## 5. Bàn giao

**Phạm vi:** Minor. Chỉ sửa tài liệu, cộng một spec code nhỏ. Không thêm story, không đổi thứ tự epic.

| Vai | Việc |
|---|---|
| Developer agent (phiên này) | Sửa tài liệu ở §4.1–4.5 và §4.7; commit trên branch `docs/e3-5-e3-6-doi-chieu-spec`, không push khi Mason chưa bảo |
| Mason | Duyệt đề xuất; quyết định push/PR |
| `bmad-build` (phiên mới) | Spec D1 ở §4.6, trước Story 4.1 |
| Story 4.1, 4.4, 4.6, 4.7, 5.3, 5.8, 7.1, 7.2, 7.4, 7.5 | Đọc mục bàn giao E3-6 trong `deferred-work.md` khi lập spec; 7.1 và 7.2 đọc AD-28 mới |

**Tiêu chí hoàn thành:**
- AD-28, Story 7.1, Story 7.2, PRD FR-33 và EXPERIENCE dùng cùng định nghĩa danh sách hoàn tiền hai phần.
- `grep -n "UNIX ms\|ORDER_EXPIRED\|ngẫu nhiên 128\|tăng độ sáng\|hạn link do Tingee trả" epics.md` chỉ còn hai kết quả có chủ đích: câu "Tingee production trả `90` cho UNIX ms" trong AC 3.4 mới, và token lời mời CTV "ngẫu nhiên 128 bit" của Story 5.1 (đúng AD-30, không liên quan link chia sẻ).
- Sơ đồ mermaid của spine có đủ các cạnh của `module-graph.cjs`.
- Spine không còn ghi `integration` gửi email; bảng email theo mô-đun khớp kết quả `grep -rl EmailTransport apps/api/src/modules`.
- Mỗi mục E3-6 của retro có đúng một mục trong `deferred-work.md`, kèm story nhận.
- Trong `sprint-status.yaml`: E3-6 `done`, E3-5 `in-progress` kèm `note`.
