---
type: review
review: reconcile-prd
target: ../ARCHITECTURE-SPINE.md
sources:
  - _bmad-output/planning-artifacts/prds/prd-tickee-2026-10-27/prd.md
  - _bmad-output/planning-artifacts/prds/prd-tickee-2026-10-27/addendum.md
  - ../.memlog.md
created: '2026-10-28'
---

# Đối chiếu Spine với PRD: Tickee MVP v1

## Kết luận

**Chưa đủ làm build substrate. Cần sửa trước khi chia Epic/Story.** Luồng tiền–Vé cốt lõi đã chắc: phát Vé trong lần chuyển trạng thái thắng (AD-1), tồn kho bằng UPDATE có điều kiện (AD-2), CAS cho Đơn (AD-3), không gọi dịch vụ ngoài trong transaction (AD-5), IPN idempotent (AD-7), check-in một lần (AD-15), Mã QR vé ký số (AD-16). Tuy vậy, khi chuyển từ PRD sang các AD, nhiều yêu cầu "lặng" đã bị rơi hoặc bị viết mâu thuẫn. Có 1 mục **critical**: AD-1 viết "held→sold" cho mọi nguồn, nên nếu làm đúng từng chữ thì bán quá số suất với tiền về muộn. Có 6 mục **high**: Đơn đang chờ khi Sự kiện bị hủy, Giữ chỗ không có trần thời gian, vòng đời "Tạm ngừng bán", sơ đồ phụ thuộc mâu thuẫn với chính các AD, thiếu máy trạng thái Sự kiện, và link chia sẻ Vé mâu thuẫn với AD-13.

| Mức | Số lượng |
| --- | --- |
| Critical | 1 |
| High | 6 |
| Medium | 13 |
| Low | 10 |

**Không tính là lỗ hổng** (sai khác có chủ đích, theo yêu cầu đối chiếu): thanh toán qua Tingee Payment Gateway thay cho QR động/tĩnh tự dựng (FR-16/17), mã Đơn của Tickee khác `billId`, không hỗ trợ VietinBank, số dư và logic Token do Tingee xử lý, nhà cung cấp hạ tầng để sau. Các mục dưới đây chỉ nêu *hệ quả chưa được xử lý* của những quyết định này khi hệ quả đó chạm tới một yêu cầu PRD khác.

## Bảng tổng hợp

| ID | Mức | PRD | Vấn đề | Loại |
| --- | --- | --- | --- | --- |
| R-01 | Critical | FR-13, FR-14, FR-21, SM-1 | Chưa chốt tác động tồn kho của từng chuyển trạng thái. AD-1 ghi "held→sold" cho cả nguồn Hết hạn, Cần xử lý và Đơn 0đ | Mâu thuẫn |
| R-02 | High | FR-33, FR-35 | Đơn Chờ thanh toán khi Sự kiện bị hủy. Tiền về sau khi hủy vẫn phát Vé hợp lệ | Thiếu |
| R-03 | High | §3 Giữ chỗ, FR-14, R-3 | Giữ chỗ không có trần thời gian vì AD-4 phụ thuộc năng lực Tingee chưa xác nhận | Mâu thuẫn |
| R-04 | High | FR-15, FR-20, §7, R-3 | Cờ "Tạm ngừng bán" không có chủ sở hữu, không có cách gỡ. Không có tín hiệu "BTC được mở lại dịch vụ" | Thiếu |
| R-05 | High | FR-8, FR-33, FR-35, FR-38 | Sơ đồ phụ thuộc (AD-10) cấm chính các lời gọi mà AD-2 và AD-24 yêu cầu | Mâu thuẫn nội bộ |
| R-06 | High | §3 trạng thái Sự kiện/Vé | Không có máy trạng thái Sự kiện, dù PRD giao cho Architecture chốt | Thiếu |
| R-07 | High | FR-22, FR-23, UJ-1 | Link chia sẻ Vé không thuộc ba đường truy cập AD-13 cho phép | Mâu thuẫn |
| R-08 | Medium | FR-8, FR-12, FR-33 | Không có quy tắc chốt giá vào Đơn, không có trường `paid_amount` | Thiếu |
| R-09 | Medium | §3, FR-11, AD-6 | Đơn 0đ trong Sự kiện có phí. "Miễn phí" lúc tính theo Sự kiện, lúc theo Đơn | Mơ hồ |
| R-10 | Medium | FR-19, FR-21 | Chưa định nghĩa xử lý IPN cho Đơn không còn chờ, "Giao dịch chưa khớp" và ghép tay | Thiếu |
| R-11 | Medium | FR-2, FR-4, NFR-7 | Chưa rõ BTC đang thao tác được xác định từ đâu, chưa có nơi thực thi ma trận quyền, chưa ràng buộc đúng một Owner | Mơ hồ |
| R-12 | Medium | FR-38, NFR-8, §10 | `audit_events` chỉ ghi thêm và IPN lưu raw có thể chứa PII, trái với yêu cầu ẩn danh hóa | Mâu thuẫn nội bộ |
| R-13 | Medium | FR-9, FR-29, NFR-8 | Chưa chốt nguồn PII Người mua (hồ sơ tài khoản hay bản chụp trên Đơn) và khóa tra cứu ở cổng | Mơ hồ |
| R-14 | Medium | FR-38 | Chưa mô hình "rút lại đồng ý" và Vé còn hiệu lực khi xóa tài khoản | Thiếu |
| R-15 | Medium | FR-5, FR-34 | AD-12 bắt mọi lời gọi Tingee thành job, trong khi liên kết tài khoản là luồng người dùng chờ kết quả | Mâu thuẫn |
| R-16 | Medium | NFR-1, FR-16 | Không có ngân sách timeout cho create-link (mục tiêu 2 giây), chưa xử lý timeout mơ hồ | Thiếu |
| R-17 | Medium | NFR-4, NFR-5 | Chỉ có PITR, không có cam kết sẵn sàng cao cho 99,9% | Thiếu |
| R-18 | Medium | FR-12, CHM #2 | Giới hạn Vé/Đơn biến mất khỏi spine | Thiếu |
| R-19 | Medium | FR-4 | Giới hạn IP của Quản trị Tingee đặt ở `/admin` của web, không ở API | Mơ hồ |
| R-20 | Medium | FR-30, FR-31, FR-33 | `reporting` cần đọc nhiều mô-đun, nhưng AD-10 cấm import schema của mô-đun khác | Mâu thuẫn nội bộ |
| R-21 | Low | FR-1, NFR-6 | 2FA của Owner: AD-19 chỉ đòi xác thực lại trước thao tác Owner, PRD ghi "bắt buộc bật" | Lệch nhẹ |
| R-22 | Low | FR-24, AD-14 | `checkIn()` không so `effective_end_at` | Lệch nhẹ |
| R-23 | Low | FR-26 | Thiết kế link mời CTV chưa vào spine | Thiếu |
| R-24 | Low | FR-27, FR-9 | Chưa có số thứ tự Vé trong Đơn. Câu trả lời form chưa chụp lại nhãn câu hỏi | Thiếu |
| R-25 | Low | FR-32 | Phạm vi kết nối Sheets (BTC hay Sự kiện), chủ OAuth, mốc "trong 1 phút" | Mơ hồ |
| R-26 | Low | FR-7, §3 | Sửa giờ sau khi bấm "Kết thúc" sớm làm hồi lại quyền CTV và Vé | Mơ hồ |
| R-27 | Low | §12 SM-2, SM-3, SM-C2, SM-C3 | Không có chỗ ghi dữ liệu để đo chỉ số thành công | Thiếu |
| R-28 | Low | FR-10, NFR-1, NFR-3 | Chưa có chính sách cache cho trang công khai khi đông người mua | Thiếu |
| R-29 | Low | — (truy vết) | `sources` dẫn tới tệp UX không có trong repo. Danh sách "Cập nhật tài liệu nguồn" chưa đủ | Truy vết |
| R-30 | Low | §13 | Một số Câu hỏi mở của PRD không được chuyển sang spine | Truy vết |

---

## Chi tiết

### R-01 — Chưa chốt tác động tồn kho của từng chuyển trạng thái Đơn · **Critical**

- **PRD:** FR-13 ("số Vé đã bán cộng số đang Giữ chỗ không bao giờ vượt số suất"). FR-14 ("tiền về muộn… Hạng vé còn chỗ: Giữ chỗ lại và phát Vé"; "Không bao giờ phát Vé vượt số suất, kể cả với tiền về muộn"). FR-21 ("ghép tay… phát Vé… với điều kiện Hạng vé còn chỗ"). SM-1 và điều kiện mở công khai #1 (không bán quá số suất).
- **Spine hiện tại:** AD-1 ghi rằng `markPaid` làm, trong cùng transaction, việc "phát N Vé, chuyển `held`→`sold`" với cả bốn nguồn. AD-3 có các chuyển `expired → paid` ("còn chỗ"), `review → paid` ("còn chỗ") và `[*] → paid` (miễn phí). AD-2 chỉ nói "mọi thay đổi `held`/`sold` đi cùng một lần chuyển trạng thái Đơn". AD-2 cũng có job so `held` với Vé của Đơn Chờ thanh toán, nên ngầm hiểu chỉ Đơn `pending` mới giữ chỗ.
- **Vấn đề:** Đơn `expired`, `review` và Đơn 0đ không có `held`. Nếu làm đúng chữ của AD-1 (`held -= n, sold += n`) thì `held` bị trừ hai lần, `sold + held` thấp hơn thực tế, và Đơn sau được Giữ chỗ vượt số suất. Đó là bán quá số suất, lỗi nghiêm trọng theo SM-1. Còn một cách khác: `CHECK (held >= 0)` làm rollback transaction IPN, thành ra khách đã trả tiền mà không có Vé. Spine cũng không nói `pending → review` (lệch số tiền) giữ hay nhả chỗ. Hai người build có thể làm hai kiểu khác nhau, và job đối chiếu ở AD-2 sẽ báo lệch giả.
- **Đề xuất:** Thêm vào AD-3 một bảng *chuyển trạng thái × tác động tồn kho*, rồi sửa AD-1 cho khớp:

  | Chuyển | Tồn kho (cùng transaction) |
  | --- | --- |
  | `[*] → pending` | `held += n` có điều kiện (AD-2) |
  | `[*] → paid` (Đơn 0đ) | `sold += n` với điều kiện `sold + held + n <= capacity` |
  | `pending → paid` | `held -= n, sold += n` (không cần kiểm lại) |
  | `pending → expired` | `held -= n` |
  | `pending → review` (lệch tiền) | `held -= n` (nhả chỗ, để giữ đúng bất biến của job đối chiếu) |
  | `expired → paid` / `review → paid` | `sold += n` có điều kiện. Trả 0 dòng thì `expired → review` (mồ côi), hoặc giữ `review` và báo "hết chỗ" |
  | `paid → cancelled`, `cancelled → refunded` | Không đổi (§11.2: chỗ không trả lại) |

  Thêm `CHECK (held >= 0 AND sold >= 0 AND sold + held <= capacity)` làm lớp chặn cuối, kèm cảnh báo NFR-10.

### R-02 — Đơn Chờ thanh toán khi Sự kiện bị hủy hoặc bị khóa · **High**

- **PRD:** FR-33 ("ngừng bán, vô hiệu mọi Vé"; "Sau khi hủy, quét Vé của Sự kiện này đều báo vé không hợp lệ"; danh sách hoàn tiền gồm mọi người đã trả). FR-35 ("ngừng nhận Đơn ngay"). FR-37.
- **Spine hiện tại:** AD-3 chỉ có `paid → cancelled` khi Sự kiện bị hủy. Không có `pending → cancelled`. `markPaid` (AD-1) chỉ CAS trên `orders.status`, không xét trạng thái Sự kiện. `checkIn()` (AD-15) xét `tickets.status='valid'`, không xét Sự kiện.
- **Vấn đề:** Link Gateway của Đơn đang chờ vẫn còn hạn tới 15 phút sau khi hủy. Người mua trả tiền thì CAS `pending → paid` thắng và Vé `valid` được phát cho Sự kiện đã hủy. CTV quét vẫn ra xanh, trái FR-33. Người này cũng không có trong danh sách hoàn tiền, vì danh sách lập lúc hủy. Spine cũng chưa nói việc vô hiệu Vé khi hủy có nằm cùng transaction với việc đổi trạng thái Sự kiện hay không. Nếu làm bằng job thì có một khoảng thời gian Vé vẫn quét ra xanh.
- **Đề xuất:** Mở rộng AD-3 thêm:
  - (a) `pending → cancelled` khi Sự kiện bị hủy, nhả `held`.
  - (b) Tiền về cho Đơn của Sự kiện đã hủy: không phát Vé. Chuyển sang Cần xử lý loại "Sự kiện đã hủy", hoặc `cancelled` có `paid_amount` và tự vào danh sách hoàn tiền.
  - (c) Đổi trạng thái Sự kiện, đổi Đơn `paid → cancelled` và đổi Vé sang `cancelled` trong **một** transaction. Email gửi bằng job.
  - (d) Với Sự kiện hoặc BTC bị khóa, nêu rõ Đơn đang chờ vẫn được trả tiền và phát Vé. Đây là mặc định hợp với giả định của FR-35.

  Bộ điều phối của luồng này xem R-05.

### R-03 — Giữ chỗ không có trần thời gian · **High**

- **PRD:** §3 ("Giữ chỗ… kéo dài đúng thời hạn QR thanh toán (15 phút)"). FR-14 ("Hết 15 phút mà chưa thanh toán… chỗ được trả lại… Chỗ đã trả lại được người khác mua ngay"). FR-17. R-3. NFR-10.
- **Spine hiện tại:** AD-4 (b) chỉ chuyển `pending → expired` khi Tingee đã xác nhận Đơn chưa được trả, qua IPN `expired/canceled` hoặc API tra trạng thái. Open Questions của spine lại ghi cả hai cơ chế này *chưa được xác nhận*. CHM #3 của PRD cũng hỏi API trạng thái có gọi được khi BTC bị ngắt dịch vụ hay không.
- **Vấn đề:** Nếu Tingee không gửi IPN hết hạn, API tra trạng thái lỗi, hoặc BTC đang bị ngắt dịch vụ, Đơn nằm `pending` mãi và chỗ không bao giờ được trả. Một Sự kiện 300 Vé có thể hiện "Hết vé" trong khi chưa ai trả tiền. Điều này trái FR-14, và hướng giữ chỗ quá 15 phút cũng không có trong danh sách "Cập nhật tài liệu nguồn". Ngoài ra, khi đồng hồ (AD-4) đã về 0 mà Đơn chưa được xác nhận, chưa ai định nghĩa màn người mua hiện gì.
- **Đề xuất:** Thêm vào AD-4 một trần cứng: quá `expires_at + grace` (ví dụ 10 phút) thì chuyển Hết hạn và nhả chỗ, dù Tingee chưa xác nhận. Spine đã giữ nhánh Thanh toán mồ côi làm phòng thủ, nên tiền về muộn vẫn được xử lý. Thêm cảnh báo NFR-10 cho Đơn `pending` đã quá hạn link mà chưa được xác nhận. Định nghĩa trạng thái hiển thị "Đang xác nhận thanh toán". Đưa FR-14 và §3 (Giữ chỗ) vào danh sách cập nhật PRD.

### R-04 — Vòng đời "Tạm ngừng bán" và tín hiệu "mở lại dịch vụ" · **High**

- **PRD:** FR-15 ("Khi Tingee ngắt dịch vụ của BTC… *mọi* Sự kiện có phí của BTC đó hiện Tạm ngừng bán"; "Sự kiện miễn phí không bị ảnh hưởng"). FR-20 ("khi BTC được Tingee mở lại dịch vụ… hỏi Tingee trạng thái các QR còn mở"). §7 ("Tickee ngừng tạo QR *trước* thời điểm đó"). R-3.
- **Spine hiện tại:** Theo AD-6, tạo link thất bại vì Token hoặc vì bị ngắt dịch vụ thì "Sự kiện hiện Tạm ngừng bán". AD-21 đọc một "cờ Tạm ngừng bán từ Tingee". AD-8 chạy Đối soát bù "khi BTC được mở lại dịch vụ". Không mô-đun nào sở hữu cờ này, vì bảng Design Paradigm không ghi và `tingee` thì "không sở hữu bảng".
- **Vấn đề:**
  - (1) **Kẹt vĩnh viễn:** cờ bật thì `sellability()` chặn tạo Đơn. Không có Đơn thì không gọi create-link, nên không bao giờ biết lúc nào nên gỡ cờ.
  - (2) Không có tín hiệu "mở lại dịch vụ", nên nhánh này của AD-8 không bao giờ chạy.
  - (3) AD-6 nói cờ ở mức Sự kiện, PRD nói ở mức BTC. AD-21 cũng không giới hạn cờ cho Hạng vé > 0đ như đã làm với Closed Beta, nên có thể chặn nhầm Sự kiện miễn phí.
  - (4) Theo §7, Tickee chặn *trước* khi bị ngắt để tránh R-3 (khách đã trả mà không có Vé). Spine chuyển sang chỉ phản ứng sau khi có lỗi. Việc giao số dư Token cho Tingee là quyết định có chủ đích, nhưng hệ quả với R-3 thì chưa được xử lý.
- **Đề xuất:** Thêm một AD (hoặc mở rộng AD-6 và AD-21):
  - `organizer` sở hữu `organizations.payment_suspended_at` và `reason`.
  - Adapter `tingee` ánh xạ đúng các mã lỗi Tingee sang lỗi miền `MERCHANT_SUSPENDED`.
  - Một job dò định kỳ (API trạng thái merchant hoặc Token, nếu có), hoặc nút "Thử lại" của Owner, sẽ gỡ cờ. Gỡ cờ thì enqueue AD-8 cho mọi Đơn còn mở của BTC.
  - Cờ chỉ áp cho Hạng vé > 0đ.

  Thêm câu hỏi cho Tingee vào Open Questions: có API hoặc webhook trạng thái dịch vụ của Merchant con không? Link Gateway tạo trước lúc ngắt có còn nhận tiền, và IPN có tới sau khi mở lại không?

### R-05 — Sơ đồ phụ thuộc mâu thuẫn với các AD và luồng PRD · **High**

- **PRD:** FR-8 (đổi số suất; tạo Hạng vé cần có dòng tồn kho). FR-33 (hủy Sự kiện chạm `event`, `ordering`, `ticketing` và email). FR-35 (Quản trị Tingee "chọn vô hiệu" Vé của Sự kiện bị khóa). FR-38 (xóa tài khoản; cảnh báo nếu còn Vé hợp lệ).
- **Spine hiện tại:** AD-10 cấm phụ thuộc vòng và cho CI kiểm import. Sơ đồ có `ordering → event` nhưng **không** có `event → ordering`. Thế nhưng AD-2 ghi "`event` đổi số suất qua `ordering`", và việc tạo Hạng vé (do `event` sở hữu) cũng cần tạo dòng `ticket_type_inventory` (do `ordering` sở hữu). `admin` chỉ được gọi `organizer` và `event`, không gọi được `ticketing`. `identity` là lá của sơ đồ, nhưng AD-24 lại giao `identity.deleteAccount()` "điều phối… ở mọi mô-đun".
- **Vấn đề:** Làm đúng AD-2 và AD-24 thì CI chặn. Mỗi người build sẽ tự lách theo một kiểu: import vòng, ghi thẳng vào bảng của mô-đun khác, hoặc chuyển sang job mà không biết bước nào bắt buộc nằm cùng transaction (FR-33, xem R-02).
- **Đề xuất:** Nêu bộ điều phối cho từng luồng trong AD-10. Có hai cách:
  - (a) Thêm một lớp use-case ở trên các mô-đun, được gọi nhiều mô-đun và tự giữ `tx`.
  - (b) Đặt luồng vào mô-đun có hướng phụ thuộc phù hợp:
    - Đổi số suất và tạo hoặc xóa Hạng vé đi qua `ordering`, vì `ordering → event` là hướng hợp lệ.
    - `ordering.cancelEvent()` gọi `event` và `ticketing` trong một transaction.
    - FR-35: thêm cạnh `admin → ticketing`, hoặc gọi qua `ordering`.
    - FR-38: `identity` enqueue job `identity.account_deleted`, rồi mỗi mô-đun tự ẩn danh dữ liệu của mình (AD-12). Phần cảnh báo "còn Vé hợp lệ" do web gọi API của `ticketing` theo `buyerScope`.

  Cập nhật sơ đồ cho khớp.

### R-06 — Thiếu máy trạng thái Sự kiện (và Vé) · **High**

- **PRD:** §3 ("Nháp → Đang mở bán → Đã kết thúc. Từ Đang mở bán… Ẩn, Đã hủy, Bị khóa"; "[ASSUMPTION: … Architecture chốt máy trạng thái chi tiết]"). FR-7 (Ẩn, Kết thúc sớm). FR-35 (khóa và mở khóa). FR-37. Trạng thái Vé: Hợp lệ → Đã check-in, hoặc Hợp lệ → Đã hủy.
- **Spine hiện tại:** Chỉ có máy trạng thái của Đơn (AD-3). `event` sở hữu "trạng thái Sự kiện" và "khóa Sự kiện" như hai thứ riêng. AD-21 liệt kê 9 *nhãn hiển thị*, trộn giá trị lưu trong DB với giá trị tính ra. AD-14 nói "Đã kết thúc" tính tại request, còn job chỉ "cập nhật trạng thái hiển thị".
- **Vấn đề:** Hai người build có thể làm khác nhau ở nhiều chỗ:
  - "Bị khóa" là một giá trị của `status` (mở khóa thì không biết quay về trạng thái nào) hay là cờ riêng?
  - Ẩn có quay lại Đang mở bán được không?
  - Có khóa được Sự kiện Nháp, hủy được Sự kiện đã kết thúc không?
  - `status='ended'` có được lưu không, hay `ended` chỉ tính từ `effective_end_at`?
  - Vé đã check-in có chuyển sang Đã hủy được khi Sự kiện bị hủy giữa giờ không?

  `sellability()`, `checkin` và `admin` đều phụ thuộc vào câu trả lời.
- **Đề xuất:** Thêm một AD "Máy trạng thái Sự kiện":
  - Trạng thái lưu: `draft`, `published`, `hidden`, `cancelled`, kèm danh sách chuyển hợp lệ, viết bằng CAS như AD-3.
  - `ended` luôn tính từ `effective_end_at` (AD-14).
  - Khóa là trục riêng: `locked_at`, `locked_by`, `reason` trên `events` và `organizations`. Mở khóa không đụng tới `status`.
  - Thứ tự ưu tiên khi `sellability()` chọn nhãn.

  Thêm trạng thái Vé (`valid`, `cancelled`, cùng `checked_in_at`) và quy tắc cho Vé đã check-in khi Sự kiện bị hủy.

### R-07 — Link chia sẻ Vé không thuộc đường truy cập nào AD-13 cho phép · **High**

- **PRD:** FR-22 ("Người mua chia sẻ từng Vé cho người đi cùng, bằng cách gửi link Vé hoặc ảnh Vé"). FR-23 ("kèm Vé hoặc link tới Vé"). UJ-1 (Minh gửi một Vé cho bạn).
- **Spine hiện tại:** Theo AD-13, ngoài phạm vi BTC chỉ có ba đường truy cập. Trong đó `buyerScope` "theo `user_id`, chỉ Đơn/Vé của chính người mua".
- **Vấn đề:** Người bạn nhận link không phải là người mua, nên `buyerScope` từ chối. Muốn đáp ứng FR-22, người build sẽ tự mở một endpoint công khai `/tickets/:id`, với id là UUIDv7 có một phần theo thời gian. Như vậy có thêm một đường truy cập không tên, không giới hạn hạn dùng, có thể lộ Mã QR vé.
- **Đề xuất:** Thêm đường thứ tư có tên, ví dụ `ticketLinkScope`, vào AD-13:
  - Link mang token ngẫu nhiên ≥ 128 bit (hoặc chính chuỗi đã ký của AD-16).
  - Chỉ hiện một Vé: Mã QR vé, Sự kiện, Hạng vé. Không hiện SĐT hay email của Người mua.
  - Hết hiệu lực tại `effective_end_at` (AD-14).
  - Email gửi Vé (FR-23) dùng chung cơ chế này.

### R-08 — Chốt giá vào Đơn và các trường tiền trên Đơn · **Medium**

- **PRD:** FR-8 ("Giá được chốt vào Đơn tại thời điểm đặt. Đổi giá về sau không ảnh hưởng đến Đơn đã tạo"). FR-12 (tổng tiền bằng tổng giá đã chốt). FR-33 (danh sách hoàn tiền có "số tiền đã trả"). FR-31.
- **Spine hiện tại:** AD-6 và AD-7 so với "tổng Đơn". Quy ước "Tiền" chỉ nói `bigint` và "tổng tiền chỉ tính ở server".
- **Vấn đề:** Không có quy tắc rằng `order_items.unit_price` và `orders.total_amount` được chụp lại trong TX1. Nếu "tổng Đơn" tính lại từ giá Hạng vé hiện tại, BTC đổi giá giữa chừng sẽ làm IPN khớp đúng bị xếp nhầm vào "Lệch số tiền". Spine cũng không có `paid_amount` cho Đơn được duyệt tay khi lệch tiền, hoặc Đơn trong danh sách hoàn tiền.
- **Đề xuất:** Ghi rõ trong AD-3 hoặc trong Quy ước "Tiền": `order_items.unit_price`, `orders.total_amount` (bất biến sau TX1) và `orders.paid_amount` (ghi khi `markPaid` hoặc khi vào `review`). Mọi so sánh và báo cáo dùng các cột này.

### R-09 — Đơn 0đ và định nghĩa "miễn phí" · **Medium**

- **PRD:** §3 ("Sự kiện miễn phí: mọi Hạng vé đều có giá 0đ"). FR-11 (không QR, không Token, trần 200 Vé).
- **Spine hiện tại:** AD-1 có nguồn "Đơn miễn phí". AD-3 lại ghi "Sự kiện miễn phí". AD-6 đặt giá tối thiểu 2.000đ cho Hạng vé *có phí*. AD-21 xét Closed Beta theo "Hạng vé > 0đ", tức ngầm cho phép Sự kiện có cả Hạng vé 0đ lẫn Hạng vé có phí. AD-2 đặt trần 200 cho "Sự kiện miễn phí".
- **Vấn đề:** Sự kiện có phí mà có Hạng vé 0đ, và người mua chỉ chọn Hạng 0đ: tổng Đơn bằng 0, Gateway từ chối (tối thiểu 2.000). Một người build sẽ đi đường miễn phí, người kia gọi Gateway và lỗi. Trần 200 cũng chưa được kiểm lại khi BTC đổi giá làm Sự kiện chuyển giữa miễn phí và có phí.
- **Đề xuất:** Chọn một trong hai: (a) cấm Hạng vé 0đ trong Sự kiện có phí, hoặc (b) Đơn có tổng 0đ luôn đi đường `[*] → paid`. Sửa nhãn AD-3 cho khớp với AD-1. Kiểm trần 200 mỗi khi đổi giá hoặc số suất.

### R-10 — IPN cho Đơn không còn chờ, "Giao dịch chưa khớp", ghép tay · **Medium**

- **PRD:** FR-19. FR-21 ("Owner hoặc Admin ghép tay giao dịch với Đơn"). §3 Cần xử lý có ba loại, gồm "Giao dịch chưa khớp".
- **Spine hiện tại:** AD-3 ghi "0 dòng → đọc lại trạng thái hiện tại và xử lý theo nó", nhưng không nói xử lý thế nào. Sơ đồ thực thể có `ORDER ||--o{ REVIEW_ITEM`, nên mục Cần xử lý luôn phải gắn với một Đơn. Open Questions ghi FR-21 "phần lớn" do Gateway lo, nhưng không quyết.
- **Vấn đề:** Chưa định nghĩa xử lý cho IPN `success` khi Đơn đang `paid` (trả hai lần, khác `providerTransactionCode`), `cancelled`, `refunded` hay `review`. Cũng chưa định nghĩa IPN có `orderId` lạ hoặc `merchantId` khác Merchant con của BTC. Tiền đã vào tài khoản BTC nhưng không hiện ở đâu, và BTC không biết để hoàn.
- **Đề xuất:** Thêm vào AD-7 một bảng *trạng thái hiện tại × loại IPN → hành động*. Ví dụ: `paid` + giao dịch mới thì vào `review` loại "Thanh toán trùng". Đơn `cancelled` hoặc `refunded` thì vào `review` hoặc danh sách hoàn tiền. Không tìm thấy Đơn thì lưu `payment_events` với `order_id` NULL, kèm cảnh báo. Kiểm `merchantId` của IPN bằng Merchant con của BTC sở hữu Đơn. Ghép tay: hoặc đưa vào Deferred kèm lý do (Gateway tự khớp), hoặc cho `review_items.order_id` được NULL và thêm thao tác "ghép".

### R-11 — Ngữ cảnh BTC trong request và thực thi ma trận phân quyền · **Medium**

- **PRD:** FR-2 ("thành viên của nhiều BTC và chuyển qua lại giữa các BTC"). FR-4 (ma trận: Admin chỉ xem Token; liên kết tài khoản, mời và xóa thành viên chỉ Owner làm). §3 ("Mỗi BTC có đúng một Owner"). NFR-7.
- **Spine hiện tại:** AD-13 dùng `orgScope(ctx)`. AD-19 ghi vai trò "không lưu trong session".
- **Vấn đề:** Chưa nói `ctx.organizationId` lấy từ đâu: path, header hay "active organization" trong session (plugin organization của Better Auth lưu `activeOrganizationId` trong session). Mỗi mô-đun có thể làm một kiểu. Kiểu lấy theo header hoặc session dễ lọt kiểm tra thành viên. Ma trận FR-4 không có nơi khai báo duy nhất. Không có ràng buộc DB cho "đúng một Owner".
- **Đề xuất:** Thêm vào Quy ước: id BTC nằm trong path `/v1/orgs/:orgId/…`. Một guard chung tra membership và vai trò ở mỗi request. Ma trận quyền khai báo một lần trong `packages/contracts` theo dạng hành động → vai trò. Đường của CTV có guard riêng theo `event_id`. Thêm unique index một phần cho `members(organization_id) WHERE role='owner'`.

### R-12 — PII trong kho chỉ ghi thêm, trái với ẩn danh hóa · **Medium**

- **PRD:** FR-38. NFR-8 ("Không lưu thông tin tài khoản ngân hàng của Người mua"). §10 Non-Goals.
- **Spine hiện tại:** Theo AD-18, `audit_events` chỉ cho INSERT, có "tóm tắt trước/sau", và quyền DB chặn UPDATE. AD-7 lưu IPN "raw + chuẩn hóa". AD-24 ẩn danh hóa mọi mô-đun nhưng không xóa `payment_events` và `audit_events`.
- **Vấn đề:** Tóm tắt audit của các thao tác như duyệt tay Đơn hay sửa Sự kiện dễ chứa tên hoặc SĐT, và không ẩn danh được. IPN raw từ Gateway có thể chứa thông tin người trả (tên, số tài khoản, thẻ đã che), trái với NFR-8.
- **Đề xuất:** Thêm vào AD-18: tóm tắt audit chỉ chứa id và tên trường, không chứa giá trị PII. Thêm vào AD-7: chỉ lưu các trường raw nằm trong whitelist, bỏ dữ liệu người trả trước khi ghi. Nếu buộc phải giữ, định nghĩa một đường xóa bớt có kiểm soát (hàm DB riêng, ghi audit).

### R-13 — Nguồn PII Người mua và khóa tra cứu ở cổng · **Medium**

- **PRD:** FR-9 (SĐT "hỏi nếu Tài khoản Tickee chưa có"; form điền một lần cho mỗi Đơn). FR-29 (tra theo SĐT hoặc email). UJ-1 ("SĐT hoặc email của Tài khoản Tickee"). NFR-8 ("Dữ liệu Người mua chỉ dùng cho Sự kiện họ đã mua").
- **Spine hiện tại:** `identity` giữ hồ sơ, `ordering` giữ câu trả lời form. Spine không nói BTC thấy dữ liệu nào.
- **Vấn đề:** Dashboard, CSV, Sheets và màn tra ở cổng có thể đọc từ hồ sơ tài khoản (dữ liệu hiện tại, không theo phạm vi BTC) hoặc từ Đơn (bản chụp). Nếu tìm theo SĐT trên bảng `users` toàn hệ thống, BTC hoặc CTV biết được người đó có tài khoản, tức lộ dữ liệu chéo. Hai nguồn có thể lệch nhau khi người dùng sửa hồ sơ.
- **Đề xuất:** Thêm vào AD-24 hoặc AD-13: TX1 chụp lại tên, SĐT (chuẩn hóa E.164) và email vào Đơn. Mọi màn phía BTC và màn tra ở cổng chỉ đọc bản chụp này, trong `orgScope` và `event_id`. Tra cứu chỉ khớp chính xác và có giới hạn tốc độ. FR-38 ẩn danh cả hai nguồn.

### R-14 — Ngữ nghĩa của FR-38 · **Medium**

- **PRD:** FR-38 ("xóa Tài khoản Tickee *hoặc rút lại đồng ý*"; "không còn xuất hiện trong dữ liệu Người mua của các Sự kiện sắp diễn ra"; "cảnh báo trước khi xóa" nếu còn Vé hợp lệ).
- **Spine hiện tại:** AD-24 chỉ nói về xóa tài khoản.
- **Vấn đề:** Spine chưa trả lời:
  - "Rút lại đồng ý" có tương đương xóa tài khoản không?
  - Vé hợp lệ của Sự kiện sắp diễn ra bị hủy hay vẫn giữ (Vé ẩn danh vẫn check-in được bằng mã)?
  - Đơn đã ẩn danh còn hiện ở dashboard của BTC dưới dạng nào?
- **Đề xuất:** Mở rộng AD-24 với các quyết định trên (gợi ý: rút đồng ý = xóa; Vé đã phát vẫn hợp lệ theo mã, không tra tay được nữa). Phần điều phối xem R-05.

### R-15 — AD-12 và các luồng Tingee người dùng phải chờ · **Medium**

- **PRD:** FR-5 (Owner liên kết tài khoản, tạo Merchant con, nhận kết quả ngay). FR-34 (Owner xem số dư Token, nếu Tickee vẫn hiển thị).
- **Spine hiện tại:** AD-12: "mọi lần gọi Tingee ngoài luồng tạo link đều là job pg-boss".
- **Vấn đề:** Liên kết tài khoản là luồng có người dùng đang chờ, có thể có bước xác nhận của ngân hàng. Đưa vào job thì cần thêm cơ chế đẩy kết quả về. Người build sẽ hoặc phá AD-12, hoặc dựng một kiểu bất đồng bộ riêng.
- **Đề xuất:** Thêm vào AD-12 danh sách ngoại lệ được gọi đồng bộ (create-link, liên kết tài khoản, tạo Merchant con, đọc số dư), mỗi cái có timeout, và vẫn ngoài transaction DB (AD-5). Nếu FR-34 (hiển thị số dư, ngưỡng cảnh báo) nay do Tingee làm, ghi rõ trong spine. Nếu Tickee vẫn làm, nêu mô-đun nào lưu ngưỡng (`organizer`).

### R-16 — NFR-1: tạo link thanh toán dưới 2 giây · **Medium**

- **PRD:** NFR-1 ("Tạo QR thanh toán dưới 2 giây"). FR-16.
- **Spine hiện tại:** AD-5 ghi "Tingee lỗi hoặc timeout → transaction bù". AD-4 (a) cho Đơn chưa có link hạn 60 giây.
- **Vấn đề:** Không có timeout cụ thể. Nếu timeout xảy ra nhưng Tingee *đã* tạo link, spine không nói có được trả URL cho người mua trước khi TX2 commit hay không. Nếu được, người mua có thể trả tiền cho một Đơn sẽ bị hết hạn ở bước (a).
- **Đề xuất:** Thêm vào AD-5: timeout create-link (ví dụ 5 giây, mục tiêu p95 < 2 giây). Chỉ trả checkout URL sau khi TX2 commit. Timeout thì chạy transaction bù và không thử lại với cùng mã Đơn. Theo dõi p95 trong mục Giám sát.

### R-17 — NFR-4 (99,9%) không có cam kết sẵn sàng cao · **Medium**

- **PRD:** NFR-4 (99,9%/tháng cho Checkout, IPN, check-in, tức khoảng 43 phút ngừng chạy mỗi tháng). NFR-5 (khôi phục về một thời điểm).
- **Spine hiện tại:** AD-22 gắn NFR-4 nhưng chỉ nêu PITR, tức sao lưu chứ không phải sẵn sàng cao.
- **Vấn đề:** Không có yêu cầu về số instance api, failover cho Postgres, health check hay rolling deploy. Không có RPO/RTO. Việc chọn nhà cung cấp được hoãn có chủ đích, nhưng các yêu cầu tối thiểu không phụ thuộc nhà cung cấp thì vẫn nên chốt ngay.
- **Đề xuất:** Thêm vào AD-22: ≥ 2 instance api sau load balancer, worker an toàn khi khởi động lại, Postgres có failover tự động, rolling deploy kèm readiness check, RPO và RTO cụ thể. Hoặc ghi các tiêu chí này vào dòng Deferred "Nhà cung cấp hạ tầng".

### R-18 — Giới hạn Vé mỗi Đơn · **Medium**

- **PRD:** FR-12 ("Mỗi Đơn có giới hạn số Vé tối đa… BTC đặt cho từng Sự kiện, mặc định 10"). CHM #2 (giới hạn theo tài khoản).
- **Spine hiện tại:** Không nhắc tới.
- **Vấn đề:** Không có giới hạn phía server thì một Đơn có thể giữ toàn bộ 300 suất trong 15 phút, lâu hơn nữa nếu dính R-03. Khi 5.000 người cùng vào mua (NFR-3), điều này phá tính công bằng.
- **Đề xuất:** `events.max_tickets_per_order` (mặc định 10) do `event` sở hữu. `ordering` kiểm trong TX1, `sellability()` trả về để giao diện hiển thị. Chuyển CHM #2 vào Open Questions.

### R-19 — Giới hạn IP cho Quản trị Tingee · **Medium**

- **PRD:** FR-4 Hệ quả ("chỉ truy cập được từ dải IP cho phép", 2FA).
- **Spine hiện tại:** AD-19 ghi "`/admin` giới hạn IP". `/admin` là route của web (theo Structural Seed). API nằm ở `api.<domain>`.
- **Vấn đề:** Nếu chỉ chặn ở web, các endpoint API dùng `platformAdminScope` vẫn mở với mọi IP.
- **Đề xuất:** Chặn IP ở api cho mọi endpoint dùng `platformAdminScope`. Cấu hình trusted proxy để lấy đúng IP client. Có thể giữ thêm lớp chặn ở web.

### R-20 — Đường đọc của `reporting` · **Medium**

- **PRD:** FR-30 (đếm check-in thời gian thực). FR-31 (CSV đủ trường, kèm câu trả lời form). FR-33 (danh sách hoàn tiền). FR-21 (số mục Cần xử lý).
- **Spine hiện tại:** AD-10 cấm import schema hay repository của mô-đun khác. `reporting` "chỉ đọc", phụ thuộc `ordering` và `ticketing`.
- **Vấn đề:** Dashboard và CSV cần join Đơn, dòng Đơn, câu trả lời form và Vé. Người build sẽ hoặc phá AD-10 bằng SQL join, hoặc gọi service rồi gặp N+1. Mỗi màn có thể làm một kiểu.
- **Đề xuất:** Thêm ngoại lệ có tên vào AD-10: mô-đun sở hữu xuất các read model chỉ đọc (view SQL hoặc hàm truy vấn), và `reporting` chỉ được đọc qua đó.

### R-21 — Phạm vi 2FA của Owner · **Low**

- **PRD:** FR-1 và NFR-6 ("Owner bắt buộc bật 2FA").
- **Spine hiện tại:** AD-19: "TOTP trước mọi thao tác chỉ Owner được làm".
- **Vấn đề:** Spine không nói Owner có phải đăng ký TOTP ngay khi tạo BTC hay không, và lúc đăng nhập có phải nhập TOTP hay không. Nếu không, Owner vẫn xem và xuất được PII của Người mua chỉ với OTP email.
- **Đề xuất:** Ghi rõ: đăng ký TOTP là bắt buộc khi trở thành Owner, mỗi phiên đăng nhập của Owner yêu cầu TOTP, và các thao tác chỉ Owner làm thì xác thực lại.

### R-22 — `checkIn()` không xét `effective_end_at` · **Low**

- **PRD:** FR-24 (giả định "vô hiệu Mã QR vé" sau khi Sự kiện kết thúc). AD-14 ("hiệu lực Mã QR vé… so `now()`").
- **Vấn đề:** Câu SQL của AD-15 không có điều kiện thời gian, nên Owner hoặc Admin quét sau khi Sự kiện kết thúc vẫn ra xanh.
- **Đề xuất:** Thêm điều kiện `now() < effective_end_at` vào AD-15, hoặc ghi rõ Owner và Admin được miễn.

### R-23 — Link mời CTV · **Low**

- **PRD:** FR-26 ("Link mời có thời hạn và thu hồi được"; giả định "một link dùng cho nhiều CTV hay mỗi CTV một link — để UX/Architecture quyết").
- **Vấn đề:** Memlog ghi UX đã chọn "link mời CTV chung theo Sự kiện", nhưng spine không ghi. Spine cũng chưa định nghĩa token, hạn dùng mặc định, việc thu hồi link khác gì thu hồi một CTV, và có lưu hash của token hay không.
- **Đề xuất:** Thêm vài dòng vào AD-14 hoặc thành một AD nhỏ cho `checkin`.

### R-24 — Số thứ tự Vé và bản chụp form · **Low**

- **PRD:** FR-27 ("Minh · Vé 2/2 · Đôi nam"). FR-9 (câu trả lời hiện trong danh sách, CSV và Sheets).
- **Vấn đề:** Chưa có `tickets.seq` gán lúc phát Vé. Nếu BTC sửa hoặc xóa câu hỏi sau khi đã có Đơn, câu trả lời lưu theo id câu hỏi sẽ mất nhãn.
- **Đề xuất:** `tickets.seq` (1..N trong Đơn). Câu trả lời form lưu kèm nhãn câu hỏi tại thời điểm đặt.

### R-25 — Phạm vi đồng bộ Google Sheets · **Low**

- **PRD:** FR-32 ("kết nối *một* Google Sheet của BTC"; "trong vòng 1 phút").
- **Vấn đề:**
  - AD-23 chạy job theo từng Sự kiện, trong khi PRD nói một Sheet của BTC. Chưa rõ kết nối theo BTC hay theo Sự kiện.
  - Chưa rõ những trạng thái Đơn nào được ghi lên Sheet.
  - Thành viên đã cấp OAuth bị xóa khỏi BTC thì token của họ vẫn được dùng.
  - Giới hạn "tối đa một lần mỗi phút" khiến trường hợp xấu nhất vượt mốc 1 phút.
- **Đề xuất:** Chốt các điểm trên trong AD-23. Đặt mục tiêu "≤ 1 phút + thời gian chạy job", hoặc nới giới hạn tốc độ.

### R-26 — Kết thúc sớm rồi sửa giờ · **Low**

- **PRD:** FR-7, §3.
- **Vấn đề:** AD-14 "tính lại mỗi khi sửa giờ". Nếu BTC sửa giờ sau khi đã bấm "Kết thúc" sớm, quyền CTV và Vé được bật lại.
- **Đề xuất:** Ghi rõ: Kết thúc sớm là trạng thái cố định (`ended_manually_at`). Sửa giờ sau đó không đổi `effective_end_at`.

### R-27 — Dữ liệu đo chỉ số thành công · **Low**

- **PRD:** §12. SM-2 (tỉ lệ tự duyệt), SM-3 (p95 từ lúc tiền vào tới lúc có Vé < 10 giây), SM-C2 (bỏ ngang ở bước đăng nhập), SM-C3.
- **Vấn đề:** Spine chỉ có giám sát vận hành. Không có quy định lưu `paidAt` của Tingee và thời điểm phát Vé. Không có sự kiện phễu "bấm Mua → đăng nhập xong".
- **Đề xuất:** Thêm một dòng "Đo lường sản phẩm" vào Consistency Conventions: các cột thời gian bắt buộc và một bảng sự kiện phễu tối thiểu, không có PII.

### R-28 — Cache trang Sự kiện công khai khi đông người · **Low**

- **PRD:** FR-10 (trang tải dưới 2 giây, hiện số chỗ còn lại). NFR-1. NFR-3 (5.000 người cùng vào).
- **Vấn đề:** Spine chỉ cấm cache làm *bộ đếm*. Spine không nói trang SSR có được cache hay không, và số chỗ còn lại được phép cũ bao lâu. Với 5.000 người, mỗi lần tải trang đều gọi `sellability()`.
- **Đề xuất:** Cho phép cache ngắn (vài giây) cho trang công khai và số chỗ còn lại, vì TX1 kiểm lại (AD-21). Ghi vào AD-11 hoặc AD-21.

### R-29 — Truy vết nguồn · **Low**

- **Vấn đề:**
  - `sources` của spine dẫn tới `ux-designs/ux-tickee-2026-10-27/DESIGN.md` và `EXPERIENCE.md`, nhưng thư mục đó trong repo chỉ có `imports/`.
  - Danh sách "Cập nhật tài liệu nguồn" (Open Questions) còn thiếu: §3 (Giữ chỗ, QR thanh toán, Token khả dụng), FR-14 (giữ chỗ tới khi Tingee xác nhận), FR-15 (chuyển từ chặn trước sang phản ứng sau lỗi), NFR-1 ("Tạo QR"), bảng tích hợp §6 (QR động/tĩnh, Deep Link, API Token), R-4, mục tiêu "≥ 80% với QR tĩnh" ở SM-2, và giá tối thiểu 2.000đ (AD-6). Mức giá này là ràng buộc mới mà BTC sẽ thấy.
- **Đề xuất:** Sửa đường dẫn hoặc commit tệp UX. Bổ sung danh sách cập nhật PRD.

### R-30 — Câu hỏi mở của PRD không được chuyển sang spine · **Low**

- **PRD:** §13 CHM #2 (giới hạn Vé theo tài khoản), #3 (văn bản xác nhận cho tạo Merchant con khi chưa KYC), #7 (Vé của Sự kiện bị khóa; ai trực), #11 (Token theo Đơn).
- **Đề xuất:** Đưa #2 và #7 (phần Vé bị vô hiệu) vào Open Questions của spine. Ghi #3 và #11 là thuộc Tingee hoặc kinh doanh, không ảnh hưởng kiến trúc.

---

## Đã phủ tốt (không cần sửa)

| PRD | Ở spine |
| --- | --- |
| FR-13, NFR-3 (không bán quá số suất, được hết hoặc không được gì) | AD-2 |
| FR-19, NFR-5 (một lần, trọn gói, chữ ký) | AD-1, AD-7, AD-12 |
| FR-20 (2 phút, cùng quy tắc một lần) | AD-8 (trừ phần "mở lại dịch vụ", xem R-04) |
| FR-18, NFR-2 (< 3 giây, Safari ở nền) | AD-17 |
| FR-26 (thu hồi có hiệu lực ngay), FR-24, §3 mốc kết thúc | AD-14, AD-19 (tra quyền theo request) |
| FR-27, FR-28, FR-29 (một lần, không lộ Mã QR vé) | AD-15, AD-16 |
| FR-7 (chính sách hoàn vé bắt buộc), FR-37, FR-35 (ngừng nhận Đơn) | AD-21 |
| NFR-7 | AD-13 |
| NFR-11 | AD-18 (cần sửa nội dung tóm tắt, xem R-12) |
| NFR-12 | Quy ước Tiền và Thời gian |
| FR-32 (một chiều, theo mã Đơn, không ghi đè cột của BTC) | AD-23 |
