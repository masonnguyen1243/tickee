---
title: 'Sprint Change Proposal: đối chiếu spec sau Epic 4 (E4-7)'
date: '2026-11-21'
author: 'Mason (duyệt) · Developer agent (soạn)'
status: 'approved'
scope: 'minor'
trigger_story: 'retro Epic 4, action item E4-7'
---

# Sprint Change Proposal: đối chiếu spec sau Epic 4 (E4-7)

## 1. Tóm tắt vấn đề

**Nguồn:** action item E4-7 của retro Epic 4 (`implementation-artifacts/epic-4-retro-2026-11-20.md:427`), gồm các phát hiện E2, E3, D6, F1, F4, F5, F6. Hạn: `epics.md` và spine trước Story 5.1; AC 9.1 trước Story 9.1. Đề xuất này làm cả hai phần.

**Phân loại:**
- Tài liệu kế hoạch lệch với code đã ship ở Epic 4. Trong cả epic, `epics.md` chỉ được sửa một lần (`cd1be9f`, tách 4.7) và spine cũng chỉ một lần (`cd1be9f`, AD-36). Spec của 24 story con đã diễn giải lại AC nhưng chưa ghi ngược về.
- Ba quy ước trong spine bị lệch hoặc thiếu: bảng sở hữu `platform`, tên queue, tên action audit.
- Một số việc hạ tầng không có story nhận sau khi tách 4.7, và AC 9.1 chưa có.
- Không có code nào sai vì các lệch này. Theo luật ở đầu `epics.md` (từ 13/11), với story đã `done` thì spec và spine thắng. Nhưng Epic 5–7 sẽ đọc `epics.md` và spine khi lập spec, nên phải sửa trước 5.1.
- Đề xuất này chỉ sửa tài liệu.

**Bằng chứng** (đã kiểm lại trên HEAD `f277ae2`):

- **F5, Epic 4 diễn giải lại trong spec mà `epics.md` chưa cập nhật:**
  - 4.1: lịch tra cố định 2/5/10 phút, rồi `expires_at`, rồi +30 phút/+2 giờ/+24 giờ (`ordering/reconciliation-jobs.ts:27-36`); dừng sau 4 lỗi liên tiếp; cờ `TINGEE_ORDER_STATUS_QUERY` tắt ngoài local (spec 4.1:40). `epics.md:1334` vẫn ghi "lặp theo backoff".
  - 4.2-a, 4.2-d: năm lý do (`contracts/src/organizer.ts:390-412`), `epics.md:1364` chỉ có ba. Chỉ `create-link` bật cờ (spec 4.2-a:26). Với hai lý do mới, "Kiểm tra lại" tắt cờ mà không hỏi Tingee.
  - 4.4-a: "Từ chối" giữ mục `open` tới khi "Đã hoàn tay" (spec 4.4-a:26), `epics.md:1433` ghi mục `resolved` (`rejected`). `Idempotency-Key` bắt buộc nhưng không lưu (spec 4.4-a:42-44).
  - 4.4-b: Đơn được ghép không nằm trong audit, đọc qua liên kết giao dịch → Đơn (`platform/audit/audit.ts:157-168`). Ghép hết chỗ thì Đơn giữ nguyên trạng thái. Mục lệch tiền của Đơn đã `paid` chỉ còn "Đã hoàn tay"/"Bỏ qua".
  - 4.6-e: "IPN lỗi tăng" là ngưỡng tuyệt đối 5 lần trong 5 phút, mỗi instance api đếm riêng (spec 4.6-e:24-27).
  - 4.7-g: chỉ cảnh báo, chỉ xét Vé `valid` của Sự kiện còn mở (spec 4.7-g:29-30). `epics.md:1532` vẫn ghi "chốt ở spec".
  - 4.7-d: không có Given/When/Then trong `epics.md`.
- **E3:** `epics.md:1530` vẫn ghi "font OG có trong image *(4.7-f)*", trong khi spec 4.7-f:44 đã chuyển việc này sang 9.1.
- **E8, đã sửa ở E4-3 phần A:** "`local` không nhận IPN thật" ở `epics.md:1513` ghi `(4.7-b)`, nhưng 4.7-b không làm. Luật này có từ `spec-epic-4-e4-3-luat-cau-hinh-tingee-va-canh-bao.md`.
- **E2:** `epics.md:1518` giao "`TRUST_PROXY_HOPS` đúng số proxy thật" cho 4.7-a. 4.7-a không làm phần này (cần hạ tầng thật), còn AC 9.1 và danh sách bàn giao 9.1 (`deferred-work.md:933`) cũng không có.
- **F6:** câu "Xong epic này là đạt tiêu chí hoàn thành Phase 1" (`epics.md:1322`) không đúng. Bốn tiêu chí mới đạt trên Tingee fake, trong khi PRD ghi "Trên sandbox Tingee" (`prd.md:647`).
- **F1:**
  - AD-8 vẫn ghi "backoff".
  - AD-32 có ba lý do, code có năm. AD-32 ghi tên trường `last_checked_at`, cột thật là `payment_service_checked_at`.
  - Bảng sở hữu `platform` chưa có `alerts` (`ops_alert_marks`), `telemetry`, `storage`, dead-letter, luật cấu hình production, khóa migrate.
- **F4:**
  - Tên queue `platform.ops-alert` và `platform.ops-alert-scan` không khớp quy ước `<module xử lý>.<action>`, vì `platform` không phải mô-đun miền.
  - Tên action audit lẫn hai kiểu: 41 tên ở thì quá khứ, 9 tên dạng mệnh lệnh thêm ở Story 4.4–4.5.
- **E3, D6, F6, AC 9.1 thiếu:**
  - image và deploy web, font OG, kiểm `instrumentation.ts` trên bản standalone (`deferred-work.md:948`);
  - bucket ảnh, kèm lặp lại phần kiểm tay presign trên nhà cung cấp thật;
  - purge CDN cho đường dẫn ảnh OG;
  - edge bỏ `traceparent`/`tracestate` (spec 4.6-a triage #28);
  - `SHOW TimeZone` của DB (spec 4.6-e triage #24);
  - `https` cho OTLP khi có header.

**Quyết định của Mason (21/11/2026, trước khi soạn):**
1. Câu Phase 1: sửa thành "đạt trên Tingee fake; phần sandbox chờ Tingee và UAT (E3-3)". Trả lời câu hỏi mở 1 của retro.
2. Tên action audit: từ Epic 5 dùng `<đối tượng>.<động từ quá khứ>`. Giữ nguyên 9 tên mệnh lệnh đã có, vì `audit_events` chỉ cho INSERT.
3. Tên queue: sửa quy ước cho phép tiền tố `platform` với job của shared kernel. Không đổi code.
4. Duyệt theo kiểu batch.

## 2. Phân tích tác động (kết quả checklist)

| Mục | Trạng thái | Ghi chú |
|---|---|---|
| 1.1 Story kích hoạt | [x] | Retro Epic 4, E4-7 (E2, E3, D6, F1, F4, F5, F6) |
| 1.2 Loại vấn đề | [x] | Tài liệu lệch code và lệch nhau; quy ước thiếu; việc hạ tầng mất story nhận sau khi tách 4.7 |
| 1.3 Bằng chứng | [x] | §1, dẫn file:dòng, đã kiểm lại trên HEAD `f277ae2` |
| 2.1 Epic hiện tại | [x] | Epic 4 vẫn `done`, không mở lại. Chỉ sửa câu mục tiêu theo verdict `accepted-with-open-items` |
| 2.2 Thay đổi cấp epic | [N/A] | Không thêm, bỏ hay đổi phạm vi epic |
| 2.3 Epic tương lai | [!] | Epic 9: AC 9.1 thêm 3 khối Given/When/Then. Epic 5–7: đọc quy ước tên audit và tên queue mới. Không đổi AC của Epic 5–8 |
| 2.4 Epic lỗi thời / mới | [N/A] | Không |
| 2.5 Thứ tự epic | [N/A] | Giữ nguyên |
| 3.1 PRD | [N/A] | Tiêu chí Phase 1 (`prd.md:647`) giữ nguyên; chỉ sửa câu Epic 4 cho khớp |
| 3.2 Architecture | [!] | Bảng mô-đun (`platform`), AD-8, AD-10, AD-18, AD-31, AD-32, Consistency Conventions (Đặt tên) |
| 3.3 UX | [N/A] | Câu chữ banner theo lý do đã có ở spec 4.2-b, 4.2-d; EXPERIENCE không nêu số lý do |
| 3.4 Artifact khác | [!] | `sprint-status.yaml` (E4-7). `deferred-work.md` không sửa ở đây (thuộc E4-8, xem §5). Không sửa `epic-4-context.md`: tài liệu của epic đã đóng |
| 4.1 Sửa trực tiếp | Viable | Effort thấp, rủi ro thấp. Chỉ sửa tài liệu |
| 4.2 Rollback | Not viable | Không có code cần lùi |
| 4.3 Xem lại MVP | Not viable | MVP không đổi |
| 4.4 Chọn hướng | [x] | Sửa trực tiếp |

## 3. Hướng đi đề xuất

**Chọn: sửa trực tiếp tài liệu.**

- AC Epic 4 trong `epics.md` khớp spec đã `done`. Epic 5–7 không đọc nhầm hành vi Đối soát bù, Tạm ngừng bán hay hàng Cần xử lý. Các story đó sẽ chạm hàng Cần xử lý ở 7.1/7.2 và cảnh báo vận hành ở 5.x.
- Spine mô tả đúng lịch Đối soát bù, năm lý do ngắt dịch vụ và đường bật/tắt cờ, phần sở hữu của `platform`, cùng hai quy ước đặt tên.
- AC 9.1 nhận mọi việc hạ tầng mà retro tìm thấy không có chủ. Khi bắt đầu 9.1 không cần lục `deferred-work.md` để biết phải làm gì.

**Rủi ro:**
- Thấp: chỉ đổi tài liệu.
- AD-32 ghi rõ "chỉ `create-link` bật cờ" là hành vi hiện tại. E4-1 sẽ thêm đường Đối soát bù bật cờ. Khi làm E4-1, spec của nó phải sửa câu này trong AD-32 (đã ghi chú ngay trong AD-32).
- Quy ước tên audit chỉ ràng buộc tên mới. 9 tên mệnh lệnh còn lại mãi, nên khi đọc audit phải biết cả hai kiểu.

**Ngoài phạm vi** (retro có nêu nhưng không thuộc E4-7; không có action item nào nhận): phân trang `cursor` + `limit` chưa dùng ở đâu (F4); `dedupeKey` không ai đọc (F2); hai import sâu trong `platform` và test so khớp `module-graph.cjs` với sơ đồ (F1). Nếu cần, E4-8 sẽ ghi các mục này vào `deferred-work.md` kèm story nhận.

## 4. Chi tiết đề xuất sửa

### 4.1 Epics (`epics.md`)

**E1. Mục tiêu Epic 4 (`:1322`)**

OLD (câu cuối):
> Xong epic này là đạt tiêu chí hoàn thành Phase 1.

NEW:
> Xong epic này, bốn tiêu chí hoàn thành Phase 1 đạt trên Tingee fake. Phần "trên sandbox Tingee" chờ Tingee trả lời các câu hỏi về API (action item Epic 4) và UAT với Tingee thật (E3-3). *(Sửa 21/11/2026, E4-7: retro Epic 4 xác nhận `accepted-with-open-items`.)*

Cùng câu ở dòng tóm tắt Epic 4 trong danh sách epic (`:324`), tìm thấy khi kiểm tiêu chí hoàn thành:

OLD:
> Xong E4 là đạt tiêu chí hoàn thành Phase 1.

NEW:
> Xong E4, bốn tiêu chí hoàn thành Phase 1 đạt trên Tingee fake; phần "trên sandbox Tingee" chờ Tingee và UAT (E3-3).

Lý do: F6, quyết định 1.

**E2. Story 4.1, AC đầu (`:1334-1336`) và AC mới về cờ**

OLD:
> **Then** enqueue job hoãn để tra trạng thái giao dịch trên Gateway theo `orderId` (gọi Tingee bằng credential chụp trong `orders.payout_account_id`) sau 2 phút, lặp theo backoff đến khi Đơn rời `pending`, và thêm một lần tra tại `expires_at` (FR-20, AD-8)
> **And** Đơn đã từng có link mà chuyển `expired` vẫn được tra tiếp thêm 3 lần (sau 30 phút, 2 giờ, 24 giờ kể từ khi hết hạn), để bắt khoản tiền về muộn mà IPN bị mất
> **And** mỗi Đơn có số lần tra tối đa; khi tra lỗi hoặc kết quả mơ hồ liên tục vượt mức này, job dừng và đẩy cảnh báo vận hành (Story 4.6) kèm mã Đơn, không lặp vô hạn

NEW:
> **Then** enqueue job hoãn để tra trạng thái giao dịch trên Gateway theo `orderId` (gọi Tingee bằng credential chụp trong `orders.payout_account_id`) theo lịch cố định: 2, 5 và 10 phút sau lần tạo link, rồi tại `expires_at`. Đơn rời `pending` thì bỏ các mốc còn lại, trừ các mốc sau hết hạn ở dưới (FR-20, AD-8)
> **And** Đơn đã từng có link mà chuyển `expired` vẫn được tra tiếp thêm 3 lần (sau 30 phút, 2 giờ, 24 giờ kể từ khi hết hạn), để bắt khoản tiền về muộn mà IPN bị mất
> **And** tra lỗi (Tingee tạm lỗi, timeout, `MERCHANT_SUSPENDED`, không tìm thấy đơn, kết quả không đọc được) thì tra lại cùng mốc sau 1, 2, 4 phút. Lỗi lần thứ 4 liên tiếp thì dừng chuỗi và đẩy cảnh báo vận hành `payment_reconciliation_stopped` kèm mã Đơn (Story 4.6), không lặp vô hạn

Thêm một AC sau AC "Tingee fake giả lập IPN không bao giờ tới" (`:1352-1354`):
> **Given** Tingee chưa công bố API tra đơn Gateway (adapter theo hợp đồng tạm, Tingee fake giả lập đúng hợp đồng đó)
> **When** cờ worker `TINGEE_ORDER_STATUS_QUERY` tắt (mặc định; ở production luật cấu hình bắt buộc cờ tắt, E4-3)
> **Then** job tra xong ngay, không gọi Tingee, không enqueue mốc kế; cờ chỉ bật ở local và test, và chỉ bật ở staging khi đã có hợp đồng thật và xong E4-1 *(spec 4.1)*

Lý do: F5 (4.1), retro B0.

**E3. Story 4.2 (`:1356-1384`)**

Thêm ghi chú dưới tiêu đề:
> *(Story con: 4.2-a cờ và tự mở lại, 4.2-b giao diện Tạm ngừng bán, 4.2-c nhãn trạng thái bán trên dashboard, 4.2-d lý do tài khoản nhận tiền.)*

OLD (`:1364-1366`):
> **Given** `organizer` sở hữu `payment_service_status` (`active` | `suspended`, `reason` `token` | `tingee_disabled` | `credential_invalid`, `since`, `last_checked_at`)
> **When** tạo link trả `MERCHANT_SUSPENDED`, hoặc một lời gọi bằng credential hiện hành của BTC trả `TINGEE_CREDENTIAL_INVALID` (lời gọi bằng credential cũ không bật cờ, xem Story 4.1)
> **Then** trong transaction bù sau lời gọi, cờ chuyển `suspended` (lý do `credential_invalid` với trường hợp sau); phát `org_status_changed` (FR-15, AD-32)

NEW:
> **Given** `organizer` sở hữu `payment_service_status` (`active` | `suspended`), `payment_service_reason` (`token` | `tingee_disabled` | `credential_invalid` | `gateway_permission_missing` | `payout_account_not_allowed`), `payment_service_since`, `payment_service_checked_at`
> **When** `create-link` bằng credential hiện hành bị Tingee từ chối: 1033 (`token`), 1007/1034 (`tingee_disabled`), 92/97/1009 (`credential_invalid`), 1133 (`gateway_permission_missing`: key chưa được cấp quyền "Cổng thanh toán"), hoặc nhóm VA 2023/1023/1045/1024/1072 khi tài khoản vừa gọi vẫn là mặc định hiện hành (`payout_account_not_allowed`, 4.2-d)
> **Then** trong transaction bù sau lời gọi, cờ chuyển `suspended` kèm lý do (đã `suspended` thì chỉ đổi lý do, giữ `since`); audit; phát `org_status_changed` (FR-15, AD-32)
> **And** chỉ `create-link` bật cờ: lời gọi bằng credential cũ (Story 4.1), job dò, đọc Token và Đối soát bù không bật cờ. E4-1 sẽ thêm đường Đối soát bù bằng credential hiện hành nhận mã ngắt thì bật cờ

OLD (`:1369-1372`):
> **Given** cờ `suspended`
> **When** job dò `tingee.getMerchantServiceStatus(credential)` bằng credential hiện hành của BTC mỗi 5 phút, hoặc Owner bấm "Kiểm tra lại", hoặc Quản trị Tingee tắt cờ, hoặc (với `credential_invalid`) Owner lưu key mới hợp lệ
> **Then** dịch vụ đã mở lại thì cờ chuyển `active` và enqueue Đối soát bù cho mọi Đơn còn mở của BTC (FR-20, AD-32)
> **And** lời gọi Tingee chạy ngoài transaction, có timeout

NEW:
> **Given** cờ `suspended` lý do `token`, `tingee_disabled` hoặc `credential_invalid`
> **When** job dò `tingee.getMerchantServiceStatus(credential)` (`get-va-paging`) bằng credential hiện hành của BTC mỗi 5 phút, hoặc Owner bấm "Kiểm tra lại", hoặc Quản trị Tingee tắt cờ, hoặc (với `credential_invalid`) Owner lưu key mới hợp lệ
> **Then** dịch vụ đã mở lại thì cờ chuyển `active` và enqueue Đối soát bù cho mọi Đơn còn mở của BTC (FR-20, AD-32)
> **And** lời gọi Tingee chạy ngoài transaction, có timeout. Job dò và "Kiểm tra lại" giành lượt bằng `payment_service_checked_at`, nên chạy chồng nhau thì chỉ gọi Tingee một lần; "Kiểm tra lại" trong vòng 30 giây sau lần trước thì trả trạng thái hiện tại
>
> **Given** cờ `suspended` lý do `gateway_permission_missing` hoặc `payout_account_not_allowed` (`get-va-paging` không phát hiện được hai lỗi này)
> **When** Owner bấm "Kiểm tra lại", Quản trị Tingee tắt cờ, Owner lưu key mới hợp lệ, hoặc (với `payout_account_not_allowed`) Owner đổi hay hủy tài khoản nhận tiền mặc định
> **Then** cờ chuyển `active` mà không cần Tingee xác nhận, và enqueue Đối soát bù như trên. Job dò bỏ qua BTC có hai lý do này. Nếu quyền hoặc VA vẫn chưa được cho phép thì lần tạo link kế tiếp bật lại cờ; banner theo lý do, câu chữ ở spec 4.2-a và 4.2-d *(4.2-a, 4.2-d)*

Lý do: F5 (4.2-a, 4.2-d), retro B1.

**E4. Story 4.4 (`:1411-1446`)**

Thêm ghi chú dưới tiêu đề:
> *(Story con: 4.4-a Duyệt tay, Từ chối, Đã hoàn tay, Bỏ qua; 4.4-b Ghép với Đơn.)*

OLD (`:1428-1429`):
> **And** danh sách Đơn để chọn chỉ lấy trong `orgScope`, lọc theo số tiền và Sự kiện; hết chỗ hoặc Sự kiện đã hủy/kết thúc thì không ghép được, mục vẫn `open` kèm lý do
> **And** audit ghi id giao dịch, Đơn được ghép, người ghép

NEW:
> **And** danh sách Đơn để chọn chỉ lấy trong `orgScope`, lọc theo số tiền và Sự kiện. Hết chỗ hoặc Sự kiện đã hủy/kết thúc thì không ghép được: mục vẫn `open` kèm lý do, Đơn giữ nguyên trạng thái (Đơn `expired` không sang `review`, không gửi email)
> **And** audit ghi `review_item.match` (đối tượng: mục), `payment_event.match` (đối tượng: giao dịch, trường `order_id`) và `order.paid` kèm người ghép. Đơn được ghép đọc qua liên kết giao dịch → Đơn, không ghi trong audit (AD-18)

OLD (`:1433`):
> **Then** Đơn → `cancelled` với `cancel_reason` = `rejected`, mục `resolved` (`rejected`); Người mua thấy `order-card` "Đã hủy" + liên hệ BTC và nhận email (FR-21)

NEW:
> **Then** Đơn → `cancelled` với `cancel_reason` = `rejected`. Mục vẫn `open` và ở lại hàng (badge vẫn đếm), chỉ còn thao tác "Đã hoàn tay", để khoản tiền khách đã trả luôn nằm trong danh sách hoàn tiền (AD-28). Người mua thấy `order-card` "Đã hủy" + liên hệ BTC và nhận email `order_rejected` (FR-21) *(4.4-a: không dùng `resolution` `rejected`)*

Thêm vào cuối AC `duplicate_payment` (`:1439-1442`):
> **And** mục `amount_mismatch` hoặc `orphan` còn `open` khi Đơn đã `paid` (nhờ Ghép một khoản khác) cũng chỉ có "Đã hoàn tay" hoặc "Bỏ qua", và chỉ đóng mục *(4.4-b)*

Thêm vào cuối AC chung (`:1444-1446`):
> **And** mọi `POST` bắt buộc header `Idempotency-Key` UUID (thiếu hoặc sai → `400`) nhưng không lưu khóa. Chống trùng dựa vào trạng thái mục: gửi lại đúng thao tác cho mục đã ở kết quả đó thì trả `200` kèm trạng thái hiện tại; thao tác không còn hợp lệ thì trả `409 REVIEW_ACTION_NOT_ALLOWED` (AD-31) *(4.4-a)*

Lý do: F5 (4.4-a, 4.4-b).

**E5. Story 4.6 (`:1473-1499`)**

Thêm ghi chú dưới tiêu đề:
> *(Story con: 4.6-a nền quan sát, 4.6-b kênh cảnh báo vận hành, 4.6-c lưới an toàn định kỳ, 4.6-d dead-letter ở `/admin`, 4.6-e luật cảnh báo nghiệp vụ.)*

Thêm sau AC điều kiện cảnh báo (`:1485-1487`):
> **And** cảnh báo gửi email tới `OPS_ALERT_EMAILS`, bắt buộc ở production (E4-3). Mỗi loại chống lặp theo cooldown
> **And** "IPN lỗi tăng" là ngưỡng tuyệt đối: trong 5 phút có từ `OPS_ALERT_IPN_FAILURES` (mặc định 5) IPN kết thúc bằng 401, 400 vì chữ ký đúng mà body hỏng, hoặc 5xx; không đếm `ipnKey` lạ (404). p95 tạo link chỉ xét khi có từ 20 lần gọi trong 5 phút. "Tỉ lệ phát Vé giảm" so với cùng cửa sổ 7 ngày trước. Hai luật đầu đếm riêng ở từng instance api, không cộng giữa các instance *(4.6-e)*

Lý do: F5 (4.6-e), retro D1.

**E6. Story 4.7 (`:1501-1532`)**

OLD (cuối `:1513`):
> …hoặc `TICKET_QR_KEYS` dùng chung khóa với `TINGEE_CREDENTIAL_KEYS` thì tiến trình dừng và nêu tên biến, không nêu giá trị; `local` không nhận IPN thật (AD-36) *(4.7-b)*

NEW:
> …hoặc `TICKET_QR_KEYS` dùng chung khóa với `TINGEE_CREDENTIAL_KEYS` thì tiến trình dừng và nêu tên biến, không nêu giá trị *(4.7-b)*
> **And** ở production, thiếu `OPS_ALERT_EMAILS` hoặc bật `TINGEE_ORDER_STATUS_QUERY` thì tiến trình dừng. `local` không nhận IPN thật: với `NODE_ENV=development`, api và worker từ chối `TINGEE_BASE_URL` có host không phải local, trừ khi đặt `TINGEE_ALLOW_REAL_IN_DEVELOPMENT=true` (AD-36) *(E4-3 phần A; 4.7-b chưa làm phần này)*

OLD (`:1518`):
> **And** IP client lấy qua trusted proxy (`TRUST_PROXY_HOPS` đúng số proxy thật trước api); có test *(chuyển từ Story 2.5, E2-4; 4.7-a)*

NEW:
> **And** IP client lấy qua trusted proxy theo `TRUST_PROXY_HOPS`; có test *(chuyển từ Story 2.5, E2-4; 4.7-a)*. Đặt đúng số proxy thật và kiểm sau deploy thuộc Story 9.1

Thêm sau AC CI (`:1520-1522`):
> **Given** Owner hoặc Admin xin URL upload ảnh Sự kiện
> **When** vượt 50 lần mỗi BTC, hoặc 100 lần mỗi tài khoản (gộp mọi BTC), trong 24 giờ trượt
> **Then** trả `429 EVENT_IMAGE_RATE_LIMITED` kèm `retryAfterSeconds`; chỉ lần cấp thành công được đếm; mỗi lần cấp log `userId`, `organizationId`, `key`, không log IP hay URL ký *(4.7-d)*

OLD (cuối `:1530`):
> **Then** build hoặc khởi động dừng và nêu tên biến; route revalidate không nhận giá trị mẫu; font OG có trong image *(4.7-f)*

NEW:
> **Then** build hoặc khởi động dừng và nêu tên biến; route revalidate không nhận giá trị mẫu *(4.7-f; kiểm font OG trong image chuyển sang Story 9.1)*

OLD (`:1532`):
> **And** lúc khởi động, mọi `qr_key_version` còn dùng ở bảng `tickets` phải có trong `TICKET_QR_KEYS`; thiếu thì báo kèm marker `ticket_qr_key_missing`, dừng hay chỉ cảnh báo chốt ở spec 4.7-g (AD-29) *(4.7-g)*

NEW:
> **And** lúc khởi động, mọi `qr_key_version` của Vé `valid` thuộc Sự kiện còn mở (chưa kết thúc, chưa hủy) phải có trong `TICKET_QR_KEYS`. Thiếu thì log `error` kèm marker `ticket_qr_key_missing` và báo kênh cảnh báo vận hành; instance vẫn khởi động, chỉ cảnh báo (Mason chốt 20/11/2026) (AD-29) *(4.7-g)*

Lý do: E2, E3, E8, F5 (4.7-d, 4.7-g).

**E7. Story 9.1: thêm AC** (sau AC email, `:2202`)

> **Given** staging và production sau load balancer
> **When** cấu hình api
> **Then** `TRUST_PROXY_HOPS` bằng đúng số proxy thật trước api. Sau lần deploy đầu và mỗi lần đổi topology, kiểm IP client mà api thấy (log đã che, hoặc endpoint chẩn đoán chỉ cho Quản trị Tingee) trước khi mở traffic (FR-4, AD-26) *(E4-7, retro Epic 4 E2)*
> **And** edge bỏ header `traceparent`/`tracestate` do client gửi trước khi tới api; chọn backend giám sát và nối endpoint OpenTelemetry. `OTEL_EXPORTER_OTLP_ENDPOINT` ra ngoài mạng nội bộ phải là `https` khi có `OTEL_EXPORTER_OTLP_HEADERS` (NFR-10) *(retro Epic 4 D6)*
> **And** `SHOW TimeZone` của Postgres là `UTC` hoặc múi giờ không có DST (luật `ticket_issuance_drop` của 4.6-e lùi cửa sổ 7 ngày bằng `make_interval(days => …)`)
>
> **Given** image `web`
> **When** pipeline build và deploy
> **Then** web có image gắn tag theo commit SHA, deploy cùng trình tự với `api`/`worker` (api trước web khi contract thêm trường bắt buộc). Image có font OG `apps/web/assets/fonts/*.ttf`. Nếu dùng `output: 'standalone'` thì chạy test tiến trình `apps/web/test/start.process.test.ts` trên image, để chắc server vẫn gọi `register()` của `instrumentation.ts` *(retro Epic 4 E3; `deferred-work.md:266, :948`)*
>
> **Given** bucket ảnh Sự kiện trên nhà cung cấp đã chốt (staging, production)
> **When** dựng bucket
> **Then** bucket bật CORS `GET` cho origin web. Trước khi mở upload ảnh, lặp lại 8 bước kiểm tay presign của spec 4.8-a trên nhà cung cấp thật: PUT dư 1 byte hoặc khác `content-type` đã ký bị từ chối, liệt kê bucket ẩn danh bị từ chối, CORS đúng origin (AD-22) *(retro Epic 4 E3)*
> **And** khi đặt CDN trước web, revalidate Sự kiện purge cả `/e/{slug}` lẫn đường dẫn ảnh OG của Sự kiện

Lý do: E2, E3, D6, F6. Đây là phần "trước 9.1" của E4-7, làm luôn để mọi việc hạ tầng có chỗ ở trong AC.

### 4.2 Architecture (`ARCHITECTURE-SPINE.md`)

**A1. Frontmatter:** `updated: '2026-11-20'` → `updated: '2026-11-21'`.

**A2. Bảng mô-đun, dòng `platform`**

OLD:
> | `platform` (shared kernel) | DB và transaction, cổng `AccessResolver` và guard quyền, `orgScope`, `audit_events`, hàng đợi job, realtime (SSE/NOTIFY), cổng gửi email `EmailTransport` (SMTP; Mailpit ở local) và `escapeHtml`, config, log |

NEW:
> | `platform` (shared kernel) | DB và transaction (`db`: đồng hồ DB, khóa migrate `tickee:migrate`), cổng `AccessResolver` và guard quyền, `orgScope` (`access`), `audit_events` (`audit`), hàng đợi job và dead-letter (`jobs`), realtime (SSE/NOTIFY), cổng gửi email `EmailTransport` (SMTP; Mailpit ở local) và `escapeHtml` (`email`), config (schema Zod và luật production), log, `SecretBox` (`crypto`), lỗi HTTP và health (`http`), cảnh báo vận hành (`alerts`: bảng `ops_alert_marks`, `OpsAlerts.raise`, queue `platform.ops-alert`, `platform.ops-alert-scan`), OpenTelemetry (`telemetry`: span qua `RedactingSpanExporter`), cổng object storage `ObjectStorage` (`storage`: S3) |

Lý do: F1. Danh sách khớp `ls apps/api/src/platform`.

**A3. AD-8, Rule**

OLD:
> Khi gắn link, enqueue job hoãn tra trạng thái đơn Gateway theo `orderId` sau 2 phút, lặp theo backoff đến khi Đơn rời `pending`; thêm một lần tra tại `expires_at`. Khi BTC được mở lại dịch vụ (AD-32), enqueue tra cho mọi Đơn còn mở của BTC. Kết quả đi qua đúng hàm xử lý IPN: cùng whitelist, cùng khóa `payment_events`, cùng bảng ở AD-7.

NEW:
> - Khi gắn link, enqueue job hoãn tra trạng thái đơn Gateway theo `orderId`, theo lịch cố định (không backoff): 2, 5, 10 phút sau lần tạo link, rồi tại `expires_at`. Đơn `expired` từng có link được tra thêm sau 30 phút, 2 giờ, 24 giờ kể từ khi hết hạn. Lịch nằm ở `ordering/reconciliation-jobs.ts`.
> - Tra lỗi thì tra lại cùng mốc sau 1, 2, 4 phút. Lỗi lần thứ 4 liên tiếp, hoặc nhận `TINGEE_CREDENTIAL_INVALID` (kể cả credential cũ), thì dừng chuỗi và cảnh báo `payment_reconciliation_stopped` kèm mã Đơn.
> - Khi BTC được mở lại dịch vụ (AD-32), enqueue tra cho mọi Đơn `pending` của BTC và Đơn `expired` hết hạn trong 24 giờ trước.
> - Kết quả đi qua đúng hàm xử lý IPN: cùng whitelist, cùng khóa `payment_events`, cùng bảng ở AD-7.
> - Tingee chưa công bố API tra đơn, nên adapter theo hợp đồng tạm. Cờ worker `TINGEE_ORDER_STATUS_QUERY` (mặc định tắt; luật production bắt buộc tắt) tắt thì job xong ngay, không gọi Tingee. Chỉ bật ở staging khi đã có hợp đồng thật và xong E4-1.

Lý do: F1, F5 (4.1).

**A4. AD-10, câu cuối**

OLD:
> Tên queue `<module>.<action>` với `module` là mô-đun xử lý.

NEW:
> Tên queue `<module>.<action>` với `module` là mô-đun xử lý. Job do shared kernel xử lý dùng tiền tố `platform` (hiện có `platform.ops-alert`, `platform.ops-alert-scan` của cảnh báo vận hành).

Lý do: F4, quyết định 3.

**A5. AD-18, thêm vào cuối Rule**

> Tên hành động theo dạng `<loại đối tượng snake_case>.<động từ quá khứ>` (vd. `order.paid`, `member.invited`, `dead_letter_job.requeued`), khai báo trong union `AuditAction` (`platform/audit/audit.ts`). Có 9 tên dạng mệnh lệnh từ Story 4.4–4.5: `review_item.approve`, `review_item.approve_sold_out`, `review_item.reject`, `review_item.refund`, `review_item.dismiss`, `review_item.match`, `review_item.match_sold_out`, `payment_event.match`, `organization.token_alert_threshold_update`. Các tên này giữ nguyên, vì `audit_events` chỉ cho INSERT nên đổi tên sẽ làm lệch dòng cũ. Tên mới từ Epic 5 dùng thì quá khứ *(quyết định 21/11/2026, E4-7)*.

Lý do: F4, quyết định 2.

**A6. AD-31, thêm vào cuối Rule**

> Thao tác Cần xử lý (Story 4.4) bắt buộc `Idempotency-Key` nhưng không lưu khóa. Chống trùng dựa vào trạng thái mục: gửi lại đúng thao tác cho mục đã ở kết quả đó thì trả trạng thái hiện tại; thao tác không còn hợp lệ thì trả `409`.

Lý do: F5 (4.4-a). AD-31 hiện chỉ mô tả cách lưu khóa của tạo Đơn.

**A7. AD-32, Rule**

OLD (hai câu đầu tới hết câu "Tắt cờ → enqueue Đối soát bù…"):
> `organizer` sở hữu `payment_service_status` của BTC (`active` | `suspended`, `reason` `token` | `tingee_disabled` | `credential_invalid`, `since`, `last_checked_at`) và `token_alert_threshold`. Bật `suspended` khi adapter trả `MERCHANT_SUSPENDED` (trong transaction bù của AD-5); bật với `reason` `credential_invalid` khi lời gọi bằng credential hiện hành của BTC trả `TINGEE_CREDENTIAL_INVALID`. Lời gọi bằng credential cũ, tức tra trạng thái hoặc Đối soát bù cho Đơn có link tạo trước khi đổi key (AD-35), trả mã này thì không bật cờ: Đơn đó hết hạn theo AD-4 (c) và vận hành được cảnh báo. Tắt bằng: job dò `tingee.getMerchantServiceStatus(credential)` mỗi 5 phút khi đang `suspended`, nút "Kiểm tra lại" của Owner, hoặc Quản trị Tingee; riêng `credential_invalid` tắt khi Owner lưu credential mới hợp lệ, hoặc bấm "Kiểm tra lại" mà Tingee chấp nhận key. Tắt cờ → enqueue Đối soát bù cho mọi Đơn còn mở của BTC (AD-8).

NEW:
> - `organizer` sở hữu trạng thái dịch vụ thanh toán của BTC (cột `payment_service_status` `active` | `suspended`, `payment_service_reason`, `payment_service_since`, `payment_service_checked_at`) và `token_alert_threshold`.
> - **Năm lý do** (enum `PaymentServiceReason` ở `packages/contracts`; chỉ `tingee` biết mã):
>   - `token`: 1033 (chưa được Tingee xác nhận);
>   - `tingee_disabled`: 1007, 1034;
>   - `credential_invalid`: 92, 97, 1009;
>   - `gateway_permission_missing`: 1133, key chưa được cấp quyền "Cổng thanh toán";
>   - `payout_account_not_allowed`: 2023, 1023, 1045, 1024, 1072, chỉ khi tài khoản vừa gọi vẫn là mặc định hiện hành.
> - **Bật:** chỉ khi `create-link` bằng credential hiện hành bị từ chối với các mã trên, trong transaction bù của AD-5. Dùng CAS `active → suspended`; đã `suspended` thì chỉ đổi lý do, giữ `since`. Lời gọi bằng credential cũ (Đơn có link tạo trước khi đổi key, AD-35) không bật cờ: Đơn đó hết hạn theo AD-4 (c) và vận hành được cảnh báo. Job dò, đọc Token và Đối soát bù không bật cờ. *E4-1 (trước khi bật Đối soát bù ở staging) sẽ cho Đối soát bù bằng credential hiện hành nhận mã ngắt bật cờ; spec của E4-1 sửa câu này.*
> - **Tắt:**
>   - `token`, `tingee_disabled`, `credential_invalid`: job dò `tingee.getMerchantServiceStatus(credential)` (`get-va-paging`) mỗi 5 phút, hoặc "Kiểm tra lại" của Owner. Hai đường giành lượt bằng `payment_service_checked_at` (quá 30 giây), nên chạy chồng nhau chỉ gọi Tingee một lần.
>   - `gateway_permission_missing`, `payout_account_not_allowed`: `get-va-paging` không phát hiện được, nên job dò bỏ qua. "Kiểm tra lại" của Owner tắt cờ mà không gọi Tingee; nếu lỗi vẫn còn thì lần tạo link kế bật lại.
>   - Mọi lý do: Quản trị Tingee tắt được. Owner lưu credential mới hợp lệ thì tắt `credential_invalid`, `gateway_permission_missing`, `payout_account_not_allowed`. Đổi hoặc hủy tài khoản mặc định thì tắt `payout_account_not_allowed`.
>   - Mọi đường tắt ghi audit `organization.payment_service_resumed` kèm tên đường.
> - Tắt cờ → enqueue Đối soát bù cho mọi Đơn còn mở của BTC (AD-8).

Phần còn lại của Rule (Closed Beta, đọc Token, single-flight) giữ nguyên.

Lý do: F1 (năm lý do, tên cột), F5 (4.2-a, 4.2-d), retro B1.

**A8. Consistency Conventions, dòng "Đặt tên"**

OLD (đoạn):
> …mã lỗi miền `UPPER_SNAKE` khai báo trong `packages/contracts`; queue `<module xử lý>.<action>`; topic realtime theo AD-17 |

NEW:
> …mã lỗi miền `UPPER_SNAKE` khai báo trong `packages/contracts`; queue `<module xử lý>.<action>` (`platform.<action>` cho job của shared kernel, AD-10); action audit `<loại đối tượng>.<động từ quá khứ>` (AD-18); topic realtime theo AD-17 |

Lý do: F4, quyết định 2 và 3.

### 4.3 `sprint-status.yaml`

- `last_updated`: ngày giờ áp đề xuất.
- `epic-4-retro-e4-7-doi-chieu-spec`: `status: done`, thêm `note`: xong qua đề xuất này (21/11/2026), gồm cả phần AC 9.1; quyết định Phase 1, tên audit, tên queue ghi ở §1.
- Không đổi epic hay story.

## 5. Bàn giao

**Phạm vi:** Minor. Chỉ sửa tài liệu, không thêm story, không đổi thứ tự epic.

| Vai | Việc |
|---|---|
| Developer agent (phiên này) | Áp §4.1–4.3; commit trên branch `docs/e4-7-doi-chieu-spec`; không push khi Mason chưa bảo |
| Mason | Duyệt đề xuất; quyết định push/PR |
| E4-8 (phiên mới) | Khi dọn `deferred-work.md`: các mục `TRUST_PROXY_HOPS` (`:33-35`), font OG (`:266`), bucket ảnh, `instrumentation.ts` standalone (`:948`), `traceparent`/`tracestate`, `TimeZone` giờ đã có AC 9.1, ghi "Đã có AC 9.1 (E4-7)" thay vì gán story mới |
| E4-1 | Sửa câu "chỉ `create-link` bật cờ" ở AD-32 và AC 4.2 khi thêm đường Đối soát bù bật cờ |
| Story 5.x–7.x | Tên action audit mới dùng thì quá khứ; queue mới theo AD-10 |

**Tiêu chí hoàn thành:**
- `grep -n "lặp theo backoff\|font OG có trong image\|dừng hay chỉ cảnh báo chốt\|là đạt tiêu chí hoàn thành Phase 1\|mục \`resolved\` (\`rejected\`)" epics.md` không còn kết quả.
- `grep -n "last_checked_at" ARCHITECTURE-SPINE.md` không còn kết quả; `backoff` chỉ còn ở AD-8 dạng "không backoff", ở AD-12 (retry job email) và AD-17 (nối lại SSE).
- AD-32 và AC 4.2 có đủ năm lý do, khớp `PaymentServiceReason` trong `packages/contracts/src/organizer.ts`.
- Dòng `platform` trong bảng mô-đun nêu đủ các thư mục của `apps/api/src/platform`.
- AC 9.1 có `TRUST_PROXY_HOPS`, image web và font OG, bucket kèm kiểm tay presign, purge CDN ảnh OG, `traceparent`/`tracestate`, `TimeZone`, `https` cho OTLP.
- Trong `sprint-status.yaml`: E4-7 `done` kèm `note`.
