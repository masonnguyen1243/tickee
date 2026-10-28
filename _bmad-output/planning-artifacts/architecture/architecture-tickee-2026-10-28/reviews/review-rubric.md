---
title: 'Review rubric — Architecture Spine Tickee MVP v1'
target: ../ARCHITECTURE-SPINE.md
checked_against:
  - ../.memlog.md
  - ../../../prds/prd-tickee-2026-10-27/prd.md
date: '2026-10-28'
reviewer: Claude (review độc lập theo checklist good-spine)
---

# Review rubric — Architecture Spine Tickee MVP v1

## Kết luận

**Chưa sẵn sàng để chia epic.** Lõi tiền, chỗ và Vé (AD-1/2/3/5/7/15) chặt và đúng hướng. Nhưng sơ đồ phụ thuộc mâu thuẫn với chính các AD, buộc phụ thuộc vòng mà AD-10 cấm và CI sẽ chặn. Ngoài ra không có đường hợp lệ để các mô-đun kiểm vai trò BTC, và cả mảng vận hành (CI/CD, topology cho NFR-4, backup/secret) đang im lặng. Cần sửa 2 Critical và 7 High trước khi giao cho agent.

## Tổng quan theo tiêu chí

| # | Tiêu chí | Đánh giá | Phát hiện |
| --- | --- | --- | --- |
| 1 | Chốt đủ điểm phân kỳ cho tầng dưới | Tốt ở thanh toán và tồn kho. Thiếu: điều phối liên mô-đun, đọc chéo, phân quyền, quy ước web | C1, C2, H1, M9 |
| 2 | Rule thực thi được và chặn đúng phân kỳ | Phần lớn đạt. `markPaid` chưa đủ theo từng nguồn; thiếu ràng buộc DB làm chốt chặn; AD-10 khó thực thi nguyên văn | H2, M3 |
| 3 | Deferred có gây phân kỳ không | Ít. Rate limit tạm và giao thức gửi email có thể lệch giữa các unit | M6, L8 |
| 4 | Phủ năng lực PRD | Có đủ mã FR. FR-15/FR-34, FR-21, FR-26 và FR-33 còn mỏng | H3, H4, M8 |
| 5 | Chiều vận hành | CI/CD im lặng. NFR-4, backup, secret và vận hành job lỗi còn thiếu | H7, M1, M2 |
| 6 | Nhất quán nội bộ | Sơ đồ mâu thuẫn với AD-2, AD-24 và AD-12. Cả 4 sơ đồ mermaid đúng cú pháp | C1, H6, L1, L10 |

**Điểm mạnh nên giữ:** Vé chỉ phát trong lần CAS thắng, có hai lớp chống trùng (khóa unique cộng CAS). Không gọi dịch vụ ngoài trong transaction (TX1, gọi Tingee, TX2). Realtime chỉ là tín hiệu, REST mới là sự thật. Có một adapter Tingee và một hàm `sellability`. Các AD đều có Binds/Prevents/Rule rõ ràng, phần lớn kiểm thử được.

---

## Critical

### C1 — Sơ đồ phụ thuộc buộc vòng ở những luồng mà chính các AD yêu cầu

- **Vị trí:** Design Paradigm (sơ đồ hướng phụ thuộc), AD-2, AD-10, AD-21, AD-24; dòng FR-33 của Capability map.
- **Vấn đề:** AD-10 cấm phụ thuộc vòng và CI kiểm import, nhưng một số rule đòi gọi ngược chiều mũi tên:
  - **AD-2:** "`event` đổi số suất qua `ordering`" cần cạnh `event → ordering`, trong khi sơ đồ chỉ có `ordering → event`. Tạo Hạng vé cũng phải tạo dòng `ticket_type_inventory` (do `ordering` sở hữu), nên vướng cùng vòng.
  - **AD-24:** `identity.deleteAccount()` "điều phối ẩn danh hóa thông tin cá nhân ở mọi mô-đun", và FR-38 đòi cảnh báo khi còn Vé hợp lệ. Việc này cần `identity` gọi `ordering`, `ticketing`, `checkin` và `organizer`. Nhưng trong sơ đồ `identity` không gọi mô-đun nào, còn `organizer` lại gọi `identity`, nên sẽ thành vòng.
  - **FR-33 Hủy Sự kiện:** trạng thái Sự kiện thuộc `event`, Đơn thuộc `ordering`, Vé thuộc `ticketing`. Thao tác "hủy" của người dùng nằm tự nhiên ở `event` (FR-7), nhưng `event` không được gọi `ordering` hay `ticketing`. Spine không nói ai điều phối luồng này.
  - **AD-21:** "Trang công khai và tạo Đơn đều gọi `ordering.sellability`". Capability map đặt FR-10 ở cả `event` và `ordering`. Nếu endpoint trang công khai nằm ở `event`, nó cần cạnh `event → ordering` và lại thành vòng.

  Epic Sự kiện là epic đầu tiên sau Tài khoản. Agent làm epic này sẽ phải vi phạm sơ đồ hoặc tự chế cơ chế riêng, đúng loại phân kỳ mà spine phải chặn.
- **Cách sửa:** Thêm một tầng điều phối có tên, ví dụ `apps/api/src/flows/`. Tầng này được gọi mọi mô-đun miền, còn mô-đun miền không được gọi ngược lại nó. Liệt kê rõ các luồng thuộc tầng này:
  - `createTicketType`: `event` tạo Hạng vé và `ordering` tạo dòng tồn kho trong cùng `tx`.
  - `changeCapacity`, `publishEvent`.
  - `cancelEvent`: chuỗi `event` → `ordering` → `ticketing` → enqueue email.
  - `getPublicEvent`: dữ liệu `event` cộng `sellability`.
  - `deleteAccount`: kiểm Vé hợp lệ, rồi enqueue job `<module>.anonymizeUser` cho từng mô-đun theo AD-12.

  Sau đó vẽ lại sơ đồ có tầng `flows`, sửa AD-2 và AD-24 để trỏ về luồng tương ứng, và thêm vào AD-10: "Luồng chạm từ hai mô-đun trở lên mà đi ngược chiều mũi tên thì đặt ở `flows/`."

### C2 — Phần lớn mô-đun không có đường hợp lệ để kiểm vai trò BTC/CTV

- **Vị trí:** AD-13 (`orgScope(ctx)` thuộc `platform`), AD-19 ("Vai trò BTC và CTV do `organizer`/`checkin` tra theo từng request"), sơ đồ phụ thuộc, FR-4.
- **Vấn đề:**
  - `orgScope` nằm ở `platform`, là shared kernel mà mọi mô-đun đều gọi. Nhưng dữ liệu thành viên và vai trò thuộc `organizer`, còn phân công CTV thuộc `checkin`. Nếu `platform` gọi `organizer` thì thành vòng; nếu `platform` đọc thẳng bảng thành viên thì vi phạm AD-10.
  - Nhiều mô-đun có endpoint cho Owner/Admin nhưng không có cạnh tới `organizer`: `payment` (xử lý hàng Cần xử lý, FR-21), `reporting` (dashboard và CSV, FR-31), `integration` (kết nối Sheets, FR-32). `ticketing` cũng vậy, nếu đặt việc tra Vé của Owner/Admin ở đó.
  - Mỗi agent sẽ tự viết truy vấn vai trò theo cách riêng. Đây là chỗ phân kỳ nguy hiểm nhất vì gắn thẳng với NFR-7 và ma trận FR-4.
- **Cách sửa:** Chốt một cơ chế duy nhất:
  - `platform` định nghĩa cổng `AccessResolver` (interface) và guard NestJS `@RequirePermission(perm)`. Enum quyền đặt trong `packages/contracts`, lấy từ ma trận FR-4.
  - `organizer` và `checkin` cung cấp implementation, đăng ký lúc khởi động (đảo phụ thuộc).
  - Guard dựng `ctx = { userId, organizationId, role, assignedEventIds }` trước khi vào controller. `orgScope(ctx)` chỉ đọc `ctx`.
  - Thêm rule: "Không mô-đun nào tự truy vấn vai trò. Mọi endpoint của BTC/CTV khai báo quyền bằng decorator. Bộ test cách ly đi qua mọi route có decorator."

---

## High

### H1 — Thiếu đường đọc chéo cho dữ liệu hiển thị, chưa có quy tắc read-model

- **Vị trí:** Sơ đồ phụ thuộc; AD-10 ("Mô-đun khác gọi service công khai…"); AD-15; các dòng FR-22–25, FR-26–30, FR-31–33 và FR-35 của Capability map.
- **Vấn đề:** Nhiều màn cần dữ liệu của mô-đun mà sơ đồ không cho gọi:
  - **Quét và tra tay (FR-27, FR-29):** kết quả phải có tên Người mua, "Vé 2/2" và Hạng vé; việc tra theo SĐT hay email của Người mua. Các dữ liệu này nằm ở `ordering` (form Đơn) hoặc `identity`. Cả `checkin` lẫn `ticketing` đều không gọi được hai mô-đun đó.
  - **"Vé của tôi" (FR-22):** cần số thứ tự Vé trong Đơn, cũng thuộc `ordering`.
  - **`reporting`:** cần tên Sự kiện và Hạng vé (thuộc `event`), cùng số mục Cần xử lý (thuộc `payment`; FR-21 ghi "Dashboard hiện số mục"). Sơ đồ không có hai cạnh này.
  - **`admin`:** cần vô hiệu Vé khi khóa Sự kiện (giả định ở FR-35) nhưng không có cạnh tới `ticketing`.
  - **`integration`:** gửi cảnh báo Token cho Owner và email báo sửa thời gian hoặc địa điểm (FR-7), cần `organizer` và `identity`.
  - **`markPaid`:** nằm ở `ordering` và phát hiện được "Thanh toán mồ côi", nhưng `review_item` thuộc `payment`, mà `ordering` không gọi được `payment`.
  - **Dashboard, CSV và Sheets:** cần join dữ liệu nhiều mô-đun. Làm qua service thì thành N+1, nên agent dễ query thẳng bảng của mô-đun khác.
- **Cách sửa:**
  1. **Snapshot khi phát Vé:** `tickets` lưu `holder_name`, `buyer_email`, `buyer_phone`, `seq`, `order_ticket_count`, `ticket_type_name`, `order_code`, ghi bên trong `markPaid`. `checkin` và `ticketing` tra trên các cột này. Thêm các cột vào danh sách ẩn danh hóa của AD-24.
  2. **Quy tắc read-model:** mô-đun sở hữu xuất view SQL chỉ đọc (`<module>_read_*`) hoặc hàm query công khai. `reporting`, `integration` và `admin` chỉ đọc qua chúng, không ghi.
  3. **Kết quả của `markPaid`:** hàm trả về `paid | orphan | mismatch | lost_race`, và `payment` tạo `review_item` theo kết quả đó.
  4. **Bổ sung cạnh vào sơ đồ:** `reporting → event, payment`, `admin → ticketing`, `integration → organizer, identity`.

### H2 — Hợp đồng `markPaid` chưa đủ cho từng nguồn và trạng thái gốc

- **Vị trí:** AD-1, AD-2, AD-3 (sơ đồ trạng thái).
- **Vấn đề:** AD-1 chỉ mô tả "chuyển `held`→`sold`". Điều này đúng cho `pending → paid`, nhưng các nhánh khác chưa được nói:
  - **`expired → paid` và `review → paid`:** chỗ đã được nhả nên `held` không còn. Nếu vẫn làm `held -= n; sold += n` thì `held` âm hoặc vượt `capacity`, tức bán quá số suất, đúng lỗi nghiêm trọng của SM-1. Phải là `sold += n` có điều kiện `sold + held + n <= capacity`; thất bại thì chuyển `review` (mồ côi).
  - **`pending → review` (Lệch số tiền):** không nói giữ hay nhả chỗ. Job đối chiếu ở AD-2 so `held` với số Vé của Đơn Chờ thanh toán, nên ngầm hiểu là nhả. Nhưng nếu nhả thì `review → paid` phải kiểm còn chỗ. Story của `payment` và story của `ordering` có thể làm khác nhau.
  - **Đơn miễn phí:** AD-3 vẽ `[*] --> paid` (insert thẳng). AD-1 lại nói Vé chỉ được tạo trong `markPaid` chạy `UPDATE … WHERE status IN …`, mà lúc đó chưa có dòng nào để UPDATE.
  - **Hai mẫu CAS:** AD-1 dùng `status IN (…)`, AD-3 dùng `status=:from`.
- **Cách sửa:**
  - Thêm bảng vào AD-1/AD-2: mỗi cặp (from → to, source) ghi phép toán tồn kho và nhánh thất bại.
    - `pending→paid`: `held-=n, sold+=n`.
    - `expired|review→paid`: `sold+=n WHERE sold+held+n<=capacity`; 0 dòng thì chuyển `review` (mồ côi).
    - `pending→review` (mismatch): `held-=n`, hoặc chốt giữ chỗ có hạn.
    - `pending→expired`: `held-=n`.
  - Đơn miễn phí: insert `pending` rồi gọi `markPaid(source='free')` trong cùng `tx`.
  - Thêm chốt chặn ở DB: `CHECK (held >= 0 AND sold >= 0 AND sold + held <= capacity)` trên `ticket_type_inventory`, và `UNIQUE (order_id, seq)` trên `tickets`.

### H3 — Máy trạng thái Đơn còn lỗ, có thể phát Vé hợp lệ cho Sự kiện đã hủy

- **Vị trí:** AD-3, AD-1, AD-7; FR-33, FR-35.
- **Vấn đề:**
  - **Hủy Sự kiện khi còn Đơn chờ:** sơ đồ chỉ có `paid → cancelled: Sự kiện bị hủy`. Đơn đang `pending` lúc hủy vẫn có link Gateway sống tới 15 phút. Người mua trả tiền thì IPN gọi `markPaid`, mà hàm này không xét trạng thái Sự kiện, nên Vé `valid` được phát cho Sự kiện đã hủy. Khi đó CTV quét ra xanh, vi phạm FR-33 ("quét Vé… đều báo vé không hợp lệ"), và Đơn này không vào danh sách hoàn tiền.
  - **Các trường hợp IPN chưa có rule:**
    - Tiền về muộn nhưng sai số tiền, trên Đơn `expired`.
    - Trả lần hai cho Đơn đã `paid` hoặc `cancelled`.
    - IPN có `orderId` không tồn tại.
    - IPN có `merchantId` khác Merchant con của Đơn.
  - **Máy trạng thái Vé:** chưa chốt trạng thái Vé (`valid`/`cancelled`) và ai được chuyển.
- **Cách sửa:**
  1. Thêm chuyển `pending → cancelled` khi hủy Sự kiện (kèm gọi hủy link Gateway nếu Tingee có API). Thêm quy tắc: nếu Sự kiện đã `cancelled` thì `markPaid` chuyển Đơn sang `review` loại "Sự kiện đã hủy" và đưa vào danh sách hoàn tiền.
  2. Ghi rõ máy trạng thái Vé: `valid → cancelled` chỉ qua `ticketing.cancelByOrder(tx, orderId)`. Check-in dựa trên `status='valid'` và `checked_in_at`.
  3. Thêm bảng xử lý IPN biên:

     | Trường hợp | Xử lý |
     | --- | --- |
     | Không tìm thấy Đơn | Lưu `payment_events` với `order_id` null, cảnh báo |
     | `merchantId` lệch | Từ chối, cảnh báo |
     | Tiền về cho Đơn đã `paid` hoặc `cancelled` | `review` loại "Thanh toán trùng" |
     | Đơn `expired` và lệch tiền | `review` loại "Lệch số tiền" |

### H4 — Vòng đời "Tạm ngừng bán" và BTC bị ngắt dịch vụ không có chủ

- **Vị trí:** AD-6 ("Tạo link thất bại vì Token hoặc BTC bị ngắt dịch vụ → … Tạm ngừng bán"), AD-21 ("cờ Tạm ngừng bán từ Tingee"), AD-8 ("khi BTC được mở lại dịch vụ"); FR-15, FR-20, FR-34, FR-37.
- **Vấn đề:**
  - Cờ "Tạm ngừng bán" không có mô-đun sở hữu, không có bảng hay cột, không nói mã lỗi Tingee nào bật nó, và không có cách tắt.
  - Tickee không có tín hiệu nào cho biết BTC "được mở lại dịch vụ", nên điều kiện kích hoạt Đối soát bù ở AD-8 không cài đặt được.
  - Hậu quả có thể xảy ra: Sự kiện kẹt ở "Tạm ngừng bán" mãi; hoặc cờ không bao giờ bật, khiến người mua nào cũng giữ chỗ ở TX1 rồi mới gặp lỗi.
  - FR-15 đòi kiểm Token trước khi tạo QR. Spine chuyển sang phát hiện khi tạo link lỗi nhưng không ghi đây là thay đổi so với PRD.
  - Thu hồi Closed Beta (FR-37) cũng dẫn tới "Tạm ngừng bán" nhưng là một nguồn khác, chưa được tách bạch.
- **Cách sửa:**
  - `organizer` sở hữu `organizations.payment_suspended_at` và `payment_suspended_reason` (`tingee_token` | `tingee_disabled`).
  - `tingee` ánh xạ một danh sách mã lỗi Tingee cụ thể thành lỗi miền `MERCHANT_SUSPENDED`. `ordering` gọi `organizer.markSuspended(tx, …)` trong transaction bù.
  - Tắt cờ: job worker `organizer.probeTingeeService` chạy mỗi N phút khi BTC đang bị ngắt (hoặc Quản trị Tingee bấm mở lại). Khi thành công thì xóa cờ và enqueue Đối soát bù cho mọi Đơn còn mở.
  - Thêm Open Question về API Tingee đọc trạng thái dịch vụ và Token của Merchant con. Câu hỏi mở #3 và R-9 của PRD chưa được mang sang spine.
  - Thêm FR-15 và §3 "Token khả dụng" vào danh sách cập nhật PRD.

### H5 — AD-4 có thể giữ chỗ vô thời hạn

- **Vị trí:** AD-4, AD-8; Open Questions mục 2 và 3.
- **Vấn đề:**
  - AD-4 chỉ nhả chỗ khi Tingee xác nhận Đơn chưa được trả. Cả hai đường xác nhận (IPN `expired` và API tra trạng thái) đều đang là câu hỏi mở.
  - Khi Tingee sự cố, hoặc BTC bị ngắt API, không có xác nhận nào, nên Đơn `pending` giữ chỗ mãi. Với Sự kiện 300 suất bán hết trong vài phút, kho sẽ kẹt hàng loạt.
  - memlog ghi giữ nhánh Thanh toán mồ côi "làm phòng thủ", nhưng theo rule hiện tại, không có xác nhận thì Đơn không bao giờ đi tới nhánh đó.
- **Cách sửa:**
  - Thêm trần cứng: quá `expires_at + grace` (ví dụ 5 phút, đủ bù lệch giờ) thì chuyển `expired` và nhả chỗ vô điều kiện. Xác nhận từ Tingee chỉ để nhả sớm hơn và chính xác hơn. Tiền về sau đó đi theo nhánh `expired → paid | review` đã có.
  - Ghi timeout HTTP cho `createPaymentLink` (dưới 10 giây, nhỏ hơn hẳn 60 giây của `expires_at` ban đầu).
  - Lấy hạn link từ response của Tingee thay vì tự tính `now() + 15 phút`.

### H6 — AD-12 buộc mọi lần gọi Tingee (trừ tạo link) thành job, mâu thuẫn với luồng tương tác

- **Vị trí:** AD-12 ("mọi lần gọi Tingee ngoài luồng tạo link đều là job pg-boss"), sơ đồ container (`api → Tingee` chỉ có "tạo link"); FR-5, FR-34.
- **Vấn đề:**
  - Liên kết tài khoản nhận tiền (FR-5) qua API Master Merchant là thao tác Owner phải chờ kết quả, có thể kèm bước xác nhận phía ngân hàng.
  - Xem số dư và hạn mức Token (FR-34) là đọc đồng bộ khi mở dashboard: PRD ghi "đọc từ Tingee, Tickee không lưu".
  - Đẩy hai việc này qua job thì UX không chạy được, hoặc agent buộc phải phá rule.
- **Cách sửa:**
  - Viết lại AD-12: "Hiệu ứng phụ phát sinh từ một thay đổi nghiệp vụ là job. Lệnh hoặc lần đọc do người dùng chủ động và cần kết quả ngay (tạo link, liên kết tài khoản, đọc số dư Token) được gọi đồng bộ từ vai `api` qua `tingee`, ngoài transaction (AD-5), có timeout và trả mã lỗi miền."
  - Cập nhật sơ đồ container: `api → Tingee Open API: tạo link, liên kết tài khoản, đọc Token`.

### H7 — Mảng vận hành im lặng: CI/CD và topology cho NFR-4

- **Vị trí:** Toàn spine; Deferred; Structural Seed (Môi trường).
- **Vấn đề:** Ba nhóm sau không được chốt mà cũng không được hoãn:
  - **CI/CD:** nền tảng CI; các cổng bắt buộc (lint ranh giới AD-10, typecheck, Vitest với Postgres, bộ test cách ly AD-13, Playwright, test hợp đồng UAT); build và registry cho image; cách chạy "bước migration riêng trước deploy"; cách đưa staging lên production; rollback.
  - **NFR-4 (99,9% cho Checkout, IPN và check-in):** số instance tối thiểu của `api` và `worker`; endpoint health và readiness; deploy không gián đoạn (SSE và pg-boss cần graceful shutdown); HA của PostgreSQL.
  - **Vận hành job:** job hết retry thì đi đâu (dead-letter, cảnh báo, ai requeue); runbook chạy Đối soát bù tay.

  CI là thứ story đầu tiên phải dựng. Để trống thì mỗi agent sẽ dựng một kiểu.
- **Cách sửa:** Thêm mục "Vận hành" (hoặc AD-25) gồm ba phần.
  - **CI/CD:**
    - Dùng GitHub Actions (repo đã ở GitHub), kèm danh sách job bắt buộc trên PR.
    - Image gắn tag theo commit SHA.
    - Migration chạy bằng một job một lần, dùng cùng image (thêm vai `migrate` vào `main.ts`).
    - Staging deploy tự động từ `main`; production deploy thủ công theo tag.
  - **Topology tối thiểu:**
    - Ít nhất 2 instance `api` và 1 instance `worker`.
    - `/healthz` (liveness) và `/readyz` (kiểm DB và LISTEN).
    - Khi nhận `SIGTERM`: ngừng nhận kết nối SSE mới và gọi `boss.stop({ graceful })`.
  - **Vận hành job:** job pg-boss hết retry thì vào dead-letter queue, bắn cảnh báo NFR-10, và có màn `/admin` để requeue.

  Phần phụ thuộc nhà cung cấp (HA của DB, load balancer) để ở Deferred cùng dòng hạ tầng, kèm tiêu chí chấp nhận.

---

## Medium

### M1 — Sao lưu, secret và quyền DB mới chốt một nửa

- **Vị trí:** AD-22 (PITR), AD-16, AD-18, AD-23; dòng "Cấu hình và secret" của Consistency Conventions.
- **Vấn đề:**
  - Có PITR nhưng không có RPO/RTO, thời gian giữ bản sao lưu hay diễn tập khôi phục, trong khi NFR-5 đòi "khôi phục được".
  - Secret: không nói lưu và tiêm ở đâu cho từng môi trường, ai xoay vòng.
  - Khóa AES-GCM của refresh token Sheets không có phiên bản, nên đổi khóa là mất mọi kết nối Sheets. Khóa Mã QR vé thì có phiên bản.
  - AD-18 ("quyền DB chặn UPDATE/DELETE") đòi tách role DB, nhưng chưa chốt.
- **Cách sửa:**
  - Chốt RPO ≤ 5 phút, RTO ≤ 1 giờ, giữ bản sao lưu 14 ngày, diễn tập khôi phục trước Closed Beta.
  - Secret tiêm qua secret store của nền tảng (hoãn cùng hạ tầng), nhưng tên biến và danh sách đầy đủ cố định ngay trong schema Zod của `config`.
  - Khóa AES-GCM đánh số phiên bản như AD-16 (ciphertext có tiền tố `v<k>:`).
  - Hai role DB: `tickee_migrator` (DDL) và `tickee_app` (DML, không có UPDATE/DELETE trên `audit_events`).

### M2 — Local và staging dùng chung Tingee UAT: IPN không tới local, có thể đụng nhau

- **Vị trí:** Structural Seed › Môi trường; dòng "Kiểm thử" của Consistency Conventions.
- **Vấn đề:**
  - Local dùng UAT, nhưng IPN từ UAT không tới được máy local nếu không có tunnel.
  - Nếu mỗi clientId UAT chỉ có một URL webhook, IPN của Đơn tạo ở local sẽ về staging, hoặc ngược lại.
  - Agent làm các story thanh toán sẽ mỗi người tự chế một mock IPN.
- **Cách sửa:**
  - Chốt mỗi môi trường một bộ credential UAT riêng, hoặc ghi rõ local không nhận IPN thật.
  - Dựng một Tingee fake dùng chung trong repo (`apps/api/test/tingee-fake`): ký IPN bằng secret test, giả lập tạo link và tra trạng thái.
  - Vitest và Playwright dùng fake. Chỉ test hợp đồng mới chạm UAT, và chạy ở staging.

### M3 — AD-10 khó thực thi nguyên văn

- **Vị trí:** AD-10, AD-12; dòng "Đặt tên" của Consistency Conventions.
- **Vấn đề:**
  - Drizzle khai báo khóa ngoại bằng `references(() => events.id)`, tức phải import schema của mô-đun khác, trái với "Không import schema".
  - Không nêu công cụ kiểm import trong CI.
  - Tên queue `<module>.<action>`: chưa rõ `module` là bên enqueue hay bên xử lý.
- **Cách sửa:**
  - Cho một ngoại lệ hẹp: `modules/<x>/schema.ts` được `schema.ts` của mô-đun khác import, chỉ để khai báo FK (có lint rule riêng). Hoặc bỏ FK liên mô-đun và dùng cột id thuần.
  - Chốt công cụ (`dependency-cruiser` hoặc `eslint-plugin-boundaries`), cấu hình ranh giới lấy từ sơ đồ.
  - Chốt `module` trong tên queue là mô-đun xử lý.

### M4 — Ẩn danh hóa (AD-24) đụng với các kho chỉ-append

- **Vị trí:** AD-18, AD-7 (`payment_events` lưu raw), AD-24; FR-38, NFR-8.
- **Vấn đề:**
  - `audit_events` không cho UPDATE, mà phần "tóm tắt trước/sau" dễ chứa email hay SĐT (mời CTV, đổi thành viên, duyệt tay Đơn).
  - Raw IPN có thể chứa tên hoặc số tài khoản của người trả, trong khi NFR-8 cấm lưu thông tin ngân hàng của Người mua.
  - Xóa Tài khoản Tickee không chạm được hai kho này.
- **Cách sửa:**
  - Thêm rule: `audit_events` và `payment_events` chỉ tham chiếu `user_id` hoặc mã Đơn, không ghi thông tin cá nhân.
  - Raw IPN chỉ lưu sau khi bỏ các field nhạy cảm. Liệt kê các field này khi có schema IPN Gateway.
  - Danh sách cột chứa thông tin cá nhân của từng mô-đun đặt trong `packages/contracts`, để job ẩn danh hóa của các mô-đun dùng chung.

### M5 — Giới hạn IP cho Quản trị Tingee đặt sai lớp

- **Vị trí:** AD-19 ("`/admin` giới hạn IP"), Structural Seed (`apps/web` có `/admin`), AD-11.
- **Vấn đề:**
  - `/admin` là route của web, còn dữ liệu đi qua API. Giới hạn ở web không chặn được việc gọi thẳng `api.<domain>/v1/admin/*`.
  - Spine không nói cách lấy IP thật của client khi đứng sau proxy hoặc load balancer.
- **Cách sửa:**
  - Bắt buộc giới hạn IP ở API cho mọi route `/v1/admin/*` (guard trong `admin`), cấu hình `trust proxy` theo hạ tầng.
  - Giới hạn ở `/admin` của web chỉ là lớp phụ.

### M6 — Bảo vệ lúc mở bán đông: cache trang công khai, rate limit, chống tạo Đơn đúp

- **Vị trí:** AD-11, AD-21; dòng "Phòng chờ" của Deferred; NFR-1, NFR-3.
- **Vấn đề:**
  - Không có quy tắc cache cho trang Sự kiện công khai. Mỗi request SSR gọi API và `sellability` chạm DB, trong khi có thể có 5.000 người cùng vào.
  - "Tạm giới hạn tốc độ ở endpoint tạo Đơn" không nói cơ chế. Với nhiều instance `api`, limiter trong bộ nhớ sẽ cho kết quả khác nhau giữa các instance.
  - Không có khóa idempotent cho POST tạo Đơn. Người mua bấm "Mua" hai lần sẽ ra hai Đơn cùng giữ chỗ.
- **Cách sửa:**
  - Trang công khai: phần tĩnh SSR với `revalidate` ngắn (ví dụ 30 giây); client gọi `GET /v1/events/:id/sellability` (cache 2–5 giây).
  - Rate limit lưu ở Postgres (hoặc đặt ở load balancer), theo user và IP.
  - Tạo Đơn nhận header `Idempotency-Key`. Mỗi user tối đa một Đơn `pending` cho mỗi Sự kiện (partial unique index).

### M7 — Chưa chốt cách mở Gateway: popup `tingee.js` hay redirect

- **Vị trí:** AD-6, AD-17; memlog dòng 44 ("popup tingee.js hoặc redirect").
- **Vấn đề:** Hai cách khác nhau ở `returnUrl`, CSP (script từ domain Tingee), luồng màn chờ và kịch bản Playwright "tab ở nền". Story web và story thanh toán có thể chọn khác nhau.
- **Cách sửa:** Chốt redirect toàn trang: ổn định trên Safari iOS, không cần script bên thứ ba. `returnUrl` là `/orders/:code` của Tickee, trang này luôn gọi REST để lấy trạng thái. Nếu chưa chốt được thì đưa vào Open Questions, có hạn trả lời.

### M8 — Capability map và danh sách cập nhật PRD còn hở

- **Vị trí:** Capability → Architecture Map; mục "Cập nhật tài liệu nguồn" trong Open Questions.
- **Vấn đề:**
  - **FR-15/FR-34:** được đặt ở `tingee` (không sở hữu bảng) và `ordering`. Ngưỡng cảnh báo Token do Owner đặt cần nơi lưu (`organizer`) và job cảnh báo (`integration`); không AD nào chi phối.
  - **FR-21:** chưa chốt "Giao dịch chưa khớp" còn tồn tại không khi đã dùng Gateway, và `review_item` có loại này không.
  - **FR-26:** UX đã chốt link mời CTV chung theo Sự kiện, có hạn, thu hồi được; spine không ghi định dạng token hay hạn của link.
  - **Danh sách cập nhật PRD còn thiếu:** §3 "Token khả dụng", FR-15, FR-34, R-9; Glossary "QR thanh toán" và "QR động/tĩnh"; FR-14 ("thời hạn QR động"); bảng tích hợp §6 (QR động, QR tĩnh, Deep Link nay thành Gateway).
- **Cách sửa:**
  - Thêm `organizer` và `integration` vào dòng FR-15/FR-34.
  - Thêm một dòng nêu rõ các loại `review_item` trong MVP: `amount_mismatch`, `orphan`, `event_cancelled`, `duplicate_payment`.
  - Thêm rule ngắn cho lời mời CTV: token ngẫu nhiên ít nhất 128 bit; mỗi Sự kiện một link còn hiệu lực; tạo link mới thì link cũ hết hiệu lực; hạn không quá `effective_end_at`.
  - Bổ sung các mục còn thiếu vào danh sách cập nhật PRD.

### M9 — Thiếu quy ước cho `apps/web`

- **Vị trí:** Consistency Conventions, Stack, Structural Seed.
- **Vấn đề:** Mọi quy ước hiện tại đều hướng về API. Web có bốn bề mặt (người mua, dashboard, màn quét, `/admin`) do nhiều story dựng, nhưng chưa chốt:
  - Client gọi API (có sinh từ `packages/contracts` không).
  - Thư viện fetch và cache phía client.
  - Hook SSE kèm polling theo AD-17.
  - Cách giữ lựa chọn Vé qua bước đăng nhập (FR-3, `returnTo`).
  - Bộ UI: DESIGN.md dùng shadcn/ui + Tailwind, còn Stack chỉ có Tailwind.
  - Cấu trúc route group.
- **Cách sửa:** Thêm hàng "Web" vào Consistency Conventions:
  - Một API client typed trong `packages/contracts` (hoặc `apps/web/lib/api`).
  - TanStack Query (ghim phiên bản) cho phía client.
  - Một hook `useLiveResource` duy nhất xử lý SSE, `visibilitychange` và polling.
  - Route groups: `(public)`, `(buyer)`, `(dashboard)`, `(checkin)`, `(admin)`.
  - Thêm shadcn/ui vào Stack.

### M10 — "Đơn miễn phí" còn mơ hồ khi Sự kiện có phí có Hạng vé 0đ

- **Vị trí:** AD-1 (`source` "Đơn miễn phí"), AD-6 (giá ≥ 2.000đ), AD-2 (trần 200), AD-21 (Closed Beta xét "Hạng vé > 0đ").
- **Vấn đề:**
  - PRD định nghĩa Sự kiện miễn phí là Sự kiện mà mọi Hạng vé đều 0đ. AD-21 xét theo từng Hạng vé, tức ngầm cho phép Hạng vé 0đ trong Sự kiện có phí.
  - Spine không nói Đơn tổng 0đ trong Sự kiện có phí đi đường nào, mà Gateway từ chối số tiền dưới 2.000đ.
  - Không rõ trần 200 Vé được kiểm ở đâu: lúc tạo Hạng vé hay lúc đổi số suất.
- **Cách sửa:**
  - Chốt một trong hai: (a) cấm Hạng vé 0đ trong Sự kiện có phí; hoặc (b) "đường miễn phí" áp cho mọi Đơn có tổng 0đ, bất kể loại Sự kiện.
  - Kiểm trần 200 trong luồng `createTicketType` và `changeCapacity` (xem C1).

---

## Low

- **L1 — Structural Seed thiếu `reporting`.**
  - *Vấn đề:* chú thích `modules/` liệt kê các mô-đun nhưng thiếu `reporting`, dù bảng ở Design Paradigm có.
  - *Sửa:* thêm `reporting` vào danh sách.
- **L2 — `sources` trỏ tới file không có trên `main`.**
  - *Vấn đề:* `DESIGN.md` và `EXPERIENCE.md` của UX chỉ có trên nhánh `docs/ux-tickee-mvp` (commit `1bec95c`, chưa merge).
  - *Sửa:* merge nhánh UX trước khi chia epic, hoặc ghi rõ nhánh và commit trong `sources`.
- **L3 — AD-7 còn ba điểm chưa chốt.**
  - *(a) Chuỗi được ký:* spine xác thực trên raw body, còn tài liệu Tingee mô tả ký trên `JSON.stringify(body)` đã minify (memlog dòng 31, 36). Nếu Tingee gửi JSON chưa minify thì raw body khác chuỗi đã ký. *Sửa:* thêm vào Open Questions và kiểm bằng test hợp đồng trên UAT.
  - *(b) Độ tươi:* không kiểm `x-request-timestamp` của IPN. *Sửa:* áp cửa sổ ±10 phút như chiều gọi sang Tingee.
  - *(c) `merchantId`:* không đối chiếu `merchantId` của IPN với Merchant con của Đơn. *Sửa:* xử lý theo bảng IPN biên ở H3.
- **L4 — Check-in chưa nói kiểm thời hạn ở đâu.**
  - *Vấn đề:* câu UPDATE ở AD-15 không xét `effective_end_at` hay trạng thái Sự kiện. AD-14 nói kiểm "ngay tại request" nhưng không nói ở bước nào.
  - *Sửa:* ghi trong AD-15 rằng `checkIn()` gọi `event.assertCheckinOpen(tx, eventId)` (kiểm `effective_end_at`, Sự kiện đã hủy, Sự kiện bị khóa có chọn vô hiệu) trong cùng `tx`, trước UPDATE.
- **L5 — Sơ đồ container thiếu cạnh.**
  - *Vấn đề:* thiếu trình duyệt → object storage (upload bằng presigned URL), web → object storage (ảnh, OG), worker → Google OAuth (làm mới token Sheets), và đường email OTP (Better Auth trong vai `api` enqueue, `worker` gửi).
  - *Sửa:* bổ sung các cạnh này.
- **L6 — AD-20 không xử lý trùng mã Đơn.**
  - *Vấn đề:* mã Đơn có 40 bit ngẫu nhiên nhưng không nói làm gì khi trùng.
  - *Sửa:* thêm "va chạm unique thì sinh lại, tối đa 3 lần".
- **L7 — Cần xác nhận lại việc cấm VietinBank.**
  - *Vấn đề:* AD-6 cấm VietinBank vì lý do QR tĩnh không tự khớp được (memlog dòng 43), quyết định trước khi chọn Gateway. Gateway lại tự khớp cho tài khoản chỉ có QR tĩnh (memlog dòng 41). Lệnh cấm cũng thu hẹp danh sách 14 ngân hàng của PRD.
  - *Sửa:* thêm vào Open Questions để Tingee xác nhận lệnh cấm còn cần không.
- **L8 — Deferred "nhà cung cấp email" chưa chốt giao thức.**
  - *Vấn đề:* chưa chốt cách gửi, nên các unit có thể viết code gửi email theo những cách khác nhau.
  - *Sửa:* chốt ngay giao thức SMTP (khớp Mailpit ở local), hoặc một interface `EmailTransport` trong `integration`, để chọn nhà cung cấp sau không phải đổi code.
- **L9 — `organization_id` của `audit_events` chưa rõ.**
  - *Vấn đề:* một số thao tác của Quản trị Tingee không thuộc BTC nào (đăng nhập, xem danh sách báo cáo). ERD lại vẽ `ORGANIZATION ||--o{ AUDIT_EVENT`, và AD-13 đòi `organization_id NOT NULL` cho bảng thuộc BTC.
  - *Sửa:* ghi rõ `audit_events.organization_id` là nullable.
- **L10 — Mermaid hợp lệ, có một node treo.**
  - *Kết quả:* cả bốn sơ đồ (flowchart TD ở Design Paradigm, stateDiagram-v2 ở AD-3, flowchart LR container, erDiagram) đúng cú pháp khi đọc tay; không có lỗi parse.
  - *Vấn đề nhỏ:* node `api_entry` không nối tới mô-đun nào.
  - *Sửa:* bỏ node này, hoặc thêm chú thích rằng mọi mô-đun nằm trong `apps/api`.

---

## Thứ tự sửa đề xuất

1. **C1 và C2 trước**, vì chúng đổi sơ đồ và AD-10, kéo theo H1 và H6.
2. **H2, H3, H5:** gom vào một bảng chuyển trạng thái Đơn đầy đủ, gồm phép toán tồn kho và các trường hợp IPN biên.
3. **H4 và M8:** chốt vòng đời "Tạm ngừng bán" và các câu hỏi Token với Tingee.
4. **H7, M1, M2:** thêm mục Vận hành trước khi tạo story scaffold.
5. **Medium và Low còn lại:** sửa trong một lượt chỉnh spine.
