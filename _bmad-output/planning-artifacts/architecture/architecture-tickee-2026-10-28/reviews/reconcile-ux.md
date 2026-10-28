---
type: reconcile-review
target: ../ARCHITECTURE-SPINE.md
against:
  - docs/ux-tickee-mvp:_bmad-output/planning-artifacts/ux-designs/ux-tickee-2026-10-27/EXPERIENCE.md
  - docs/ux-tickee-mvp:_bmad-output/planning-artifacts/ux-designs/ux-tickee-2026-10-27/DESIGN.md
created: '2026-10-28'
---

# Đối chiếu Architecture Spine với UX — Tickee MVP v1

Số dòng `EXPERIENCE.md:Lnnn` / `DESIGN.md:Lnnn` lấy theo bản trên nhánh `docs/ux-tickee-mvp` (đọc bằng `git show`). Bỏ qua phần thuần hình ảnh. Quyết định chuyển sang Tingee Payment Gateway và không hỗ trợ VietinBank là thay đổi có chủ đích. Báo cáo không tính hai quyết định này là gap. Các thành phần UX bị ảnh hưởng nằm ở mục [UX cần cập nhật do quyết định Gateway](#ux-cần-cập-nhật-do-quyết-định-gateway).

## Kết luận

**Chưa đủ để frontend và backend build song song.** Phần lõi tiền, Vé và check-in (AD-1 đến AD-16) chặt chẽ và khớp với các rủi ro UX ưu tiên. Spine còn thiếu hợp đồng giữa web và api ở những chỗ UX đặc tả hành vi cụ thể:

- realtime: topic, phạm vi, ai nhận;
- nguồn của banner trạng thái;
- link chia sẻ Vé (UX giao cho Architecture quyết);
- link mời CTV dùng chung;
- chống trùng khi gửi lại Đơn;
- ngữ nghĩa khi đồng hồ đếm ngược về 0.

Ngoài ra có ba chỗ spine mâu thuẫn trực tiếp với UX:

- tạo link thất bại thì Đơn bị cho hết hạn ngay (R-04);
- đồng hồ về 0 không có nghĩa là Đơn đã hết hạn (R-05);
- Đơn đã thanh toán chuyển sang Đã hủy khi hủy Sự kiện (R-12).

| Mức | Số lượng |
| --- | --- |
| Critical | 1 |
| High | 9 |
| Medium | 11 |
| Low | 5 |

## Bảng tổng hợp

| ID | Vấn đề | Mức |
| --- | --- | --- |
| R-01 | Link chia sẻ Vé: spine chưa có cơ chế, `buyerScope` chặn người nhận | Critical |
| R-02 | Hợp đồng realtime (topic, phạm vi, payload, quyền, polling dự phòng) | High |
| R-03 | Khóa chống trùng khi gửi lại Đơn (UX OQ #12) | High |
| R-04 | Tạo link lỗi: UX giữ Đơn để thử lại, spine cho Hết hạn ngay | High |
| R-05 | Đếm ngược về 0 khác Hết hạn (AD-4); nguồn giờ máy chủ | High |
| R-06 | Link mời CTV dùng chung: hạn, xoay vòng, thu hồi, chặn nhận lại | High |
| R-07 | Vòng đời cờ "Tạm ngừng bán" và dữ liệu Token | High |
| R-08 | Không có read-model cho `status-banner` | High |
| R-09 | Hủy hoặc khóa Sự kiện khi còn Đơn Chờ thanh toán: vẫn phát Vé hợp lệ | High |
| R-10 | Quét khi mạng chập chờn: mất phản hồi dẫn tới đỏ giả | High |
| R-11 | Hợp đồng kết quả quét (lý do đỏ, "Vé k/N", tên hiển thị) | Medium |
| R-12 | Trạng thái Đơn sau Hủy Sự kiện: UX và AD-3 lệch nhau | Medium |
| R-13 | Trạng thái Đơn hiển thị cho Người mua (không lộ loại Cần xử lý, liên hệ BTC) | Medium |
| R-14 | Tra tay: chuẩn hóa, cách khớp, dữ liệu trả về, giới hạn tốc độ | Medium |
| R-15 | Điều kiện "Mở bán" (wizard bước 4) và `sellability()` | Medium |
| R-16 | Máy trạng thái liên kết tài khoản nhận tiền | Medium |
| R-17 | Trạng thái kết nối Google Sheets | Medium |
| R-18 | Danh mục thông báo (email và dashboard) | Medium |
| R-19 | Vai trò trên UI, mã lỗi quyền, xác thực lại TOTP của Owner | Medium |
| R-20 | Quản trị Tingee "vô hiệu Vé đã phát" vi phạm sơ đồ phụ thuộc | Medium |
| R-21 | Ngân sách hiệu năng chưa chia cho từng chặng | Medium |
| R-22 | Xem Vé khi mất mạng (UX OQ #13) | Low |
| R-23 | Sự kiện Nháp và slug sai phải trả cùng một 404 | Low |
| R-24 | `social-ticket-card` dựng ảnh ở client từ ảnh S3 (CORS) | Low |
| R-25 | Quyền còn lại của BTC bị khóa (UX OQ #9) | Low |
| R-26 | Ví dụ mã Đơn trong UX (`TK8F3Q2A`) khác AD-20 | Low |

## Phát hiện

### R-01 — Link chia sẻ Vé chưa có cơ chế · **Critical**

- **UX:**
  - `EXPERIENCE.md:L55`: Chi tiết Vé mở từ link được chia sẻ.
  - `EXPERIENCE.md:L285-293`: các trạng thái bắt buộc của Chi tiết Vé mở qua link chia sẻ.
  - `EXPERIENCE.md:L442`, Flow 1 bước 9: Minh gửi Vé cho bạn đánh đôi, mỗi người tự vào cổng.
  - `EXPERIENCE.md:L559`, OQ #11: **"Architecture quyết"**.
- **Spine:** AD-13 chỉ cho truy cập Vé qua `buyerScope` ("chỉ Đơn/Vé của chính người mua"). Spine không có token chia sẻ và không có endpoint công khai cho Vé.
- **Gap:** Với spine hiện tại, người nhận mở link sẽ bị 404 hoặc 403, nên bước kết thúc của UJ-1 và FR-22 không chạy được. Frontend sẽ làm link `/tickets/:id`, còn backend sẽ chặn theo `buyerScope`. Spine cũng chưa quyết người nhận có thấy Mã QR vé không. Đây là quyết định bảo mật vì link lúc đó chính là Vé.
- **Đề xuất:** Thêm một AD, ví dụ AD-25 "Link chia sẻ Vé":
  - Mỗi Vé có `share_token` ngẫu nhiên 128 bit. DB chỉ lưu hash. `ticketing` sở hữu. Chủ Vé tạo lại được, và tạo lại thì link cũ mất hiệu lực.
  - Endpoint `GET /v1/shared-tickets/:token` không cần đăng nhập. Endpoint trả Vé kèm nội dung Mã QR vé, vì cầm link tương đương cầm ảnh Vé, đúng như FR-22. Đây là đường truy cập chéo thứ tư cần đặt tên (`shareScope`).
  - Endpoint trả trạng thái Đã check-in, Đã hủy và hết hiệu lực theo `effective_end_at` (AD-14). Token sai trả 404 chung, không lộ thông tin.
  - Vé không vào "Vé của tôi" của người nhận (FR-22 không có chuyển nhượng).
  - Ghi rõ hệ quả: nếu Minh chia sẻ cả hai Vé thì người cầm link nào quét trước sẽ dùng được Vé đó.

### R-02 — Chưa có hợp đồng realtime · **High**

- **UX:** Nhiều chỗ cần tự cập nhật:
  - `order-card` (`L171`);
  - badge Cần xử lý cấp BTC trên `bottom-tab-bar` và sidebar (`L187`);
  - `stat-card` doanh thu và check-in (`L188`, Flow 2 bước 8 ở `L465`);
  - `needs-action-card` (`L189`);
  - `recent-orders-block`: Đơn mới hiện đầu danh sách (`L190`);
  - `checkin-progress` theo Hạng vé (`L193`);
  - số đã check-in trên Màn quét (`L355`);
  - BTC bị xóa khỏi tổ chức giữa phiên (`L316`);
  - banner cập nhật khi liên kết tài khoản xong (`L304`);
  - Interaction Primitives "Không reload" (`L368`).
- **Spine:** AD-17 quy định SSE nguồn `NOTIFY`, payload chỉ gồm loại và id, kênh `<entity>_changed`, không có SSE thì polling.
- **Gap:**
  1. Không có danh mục topic và không nói endpoint SSE đăng ký theo gì (Đơn, Sự kiện, BTC). Frontend có thể mở một stream cho mỗi màn, trong khi backend làm một stream chung.
  2. Payload chỉ có `id` thì api phải tra DB để biết gửi tới BTC hoặc Sự kiện nào. AD-13 chưa nói gì về việc lọc SSE theo phạm vi, nên id Đơn của BTC khác có thể lọt sang.
  3. Spine không nói `NOTIFY` phát trong cùng `tx` với thay đổi nghiệp vụ, như AD-12 và AD-18 đã làm cho job và audit.
  4. Spine không nêu nhịp polling dự phòng. Nếu polling chậm hơn khoảng 2 giây thì vỡ NFR-2 (dưới 3 giây từ IPN tới khi Vé hiện).
  5. Lúc đông cổng, mỗi lượt check-in làm mọi dashboard tải lại số liệu tổng hợp. Spine không có quy tắc gom tín hiệu.
- **Đề xuất:** Thêm bảng "Realtime topics" vào `packages/contracts`:

  | Topic | Phạm vi | Ai được đăng ký | REST cần tải lại | Màn UX |
  | --- | --- | --- | --- | --- |
  | `order_changed` | Đơn | Người mua của Đơn, qua `buyerScope` | `GET /v1/me/orders/:code` | `order-card`, màn chờ hoặc màn trả về |
  | `event_orders_changed` | Sự kiện | Owner và Admin | Đơn gần đây, số liệu | `recent-orders-block`, `stat-card` |
  | `event_checkins_changed` | Sự kiện | Owner, Admin, CTV được giao | Số liệu check-in | `checkin-progress`, Màn quét |
  | `org_review_items_changed` | BTC | Owner và Admin | Số Cần xử lý | badge |
  | `org_status_changed` | BTC | Thành viên | Banner (R-08), quyền thành viên | banner, "Bị xóa khỏi BTC" |

  Payload gồm `{type, id, organizationId, eventId}`. Các id này không nhạy cảm và api dùng chúng để lọc theo phạm vi người đăng ký. `NOTIFY` gửi qua `realtime.notify(tx, …)` trong cùng transaction. Client gom tín hiệu trong khoảng 1 giây. Polling dự phòng: màn chờ thanh toán khoảng 2 giây, dashboard khoảng 10 giây. Server gửi heartbeat SSE mỗi khoảng 25 giây để proxy không cắt kết nối.

### R-03 — Không có khóa chống trùng khi gửi lại Đơn · **High**

- **UX:** `EXPERIENCE.md:L248` yêu cầu: lần thử lại dùng cùng khóa chống trùng; nếu Đơn đã được tạo ở lần trước thì chuyển thẳng tới màn thanh toán của Đơn đó. Flow 1 có nhánh tương ứng ở `L449`. OQ #12 (`L560`) ghi "Architecture xác nhận".
- **Spine:** AD-5 tạo Đơn bằng TX1 rồi gọi Gateway. Spine không có khóa idempotent. Phần API trong Consistency Conventions cũng không có header `Idempotency-Key`.
- **Gap:** Frontend gửi khóa nhưng backend bỏ qua. Mạng chập chờn sẽ sinh hai Đơn và giữ gấp đôi chỗ, ngay trong kịch bản NFR-3.
- **Đề xuất:**
  - Thêm vào Consistency Conventions: mọi `POST` tạo tài nguyên từ trình duyệt (tạo Đơn, check-in tay, thao tác Cần xử lý) nhận header `Idempotency-Key` (UUID do client sinh, giữ suốt một lần Checkout).
  - Tạo ràng buộc `UNIQUE (user_id, idempotency_key)` trên `orders`.
  - Request trùng khóa trả về Đơn đã có với trạng thái hiện tại (200), kèm link Gateway nếu Đơn đã có link.

### R-04 — Tạo link lỗi: UX giữ Đơn để thử lại, spine cho Hết hạn ngay · **High**

- **UX:** `EXPERIENCE.md:L249` quy định khi tạo link lỗi:
  - Đơn và Giữ chỗ vẫn còn;
  - màn hiện "Đang thử lại…" kèm nút "Thử lại";
  - thử lại dùng cùng Đơn;
  - nếu lỗi kéo dài thì nhắc Đơn vẫn nằm trong Vé của tôi.
- **Spine:** AD-5 ghi "Tingee lỗi hoặc timeout → transaction bù chuyển Hết hạn và nhả chỗ". AD-3 có chuyển pending → expired khi "chưa có link sau 60s". AD-6 quy định mỗi Đơn có đúng một link.
- **Gap:** Hai bên mâu thuẫn trực tiếp. Frontend sẽ gọi "thử lại cho cùng Đơn" vào một Đơn mà backend đã cho Hết hạn. Spine cũng chưa nói `orderId` đã gửi Gateway một lần (timeout nhưng thực ra đã tạo ở Tingee) có gửi lại được không.
- **Đề xuất:** Chọn một trong hai hướng rồi ghi vào AD-5:
  - **(a)** Trong cửa sổ 60 giây, api tự thử lại `create-link` theo backoff với cùng `orderId`. Cần Tingee xác nhận gửi lại cùng `orderId` thì nhận lại link cũ hay báo trùng. Endpoint `POST /v1/orders/:code/payment-link` cho phép người mua thử lại. Hết 60 giây mới bù Hết hạn.
  - **(b)** Bỏ "thử lại cùng Đơn" khỏi UX. Lỗi thì Đơn Hết hạn ngay, nút "Thử lại" tạo Đơn mới bằng khóa chống trùng mới (R-03).

  Dù chọn hướng nào, Open Questions của spine cần thêm: Gateway xử lý `orderId` trùng thế nào.

### R-05 — Đếm ngược về 0 khác Hết hạn · **High**

- **UX:**
  - `countdown-chip` (`L166`): đếm theo giờ máy chủ, về 0 thì chuyển sang màn Hết hạn.
  - `order-card` (`L171`): về 0 thì thẻ chuyển "Hết hạn" rồi rời nhóm chờ.
  - Màn Hết hạn (`L264`) ghi "Chỗ đã được trả lại."
- **Spine:** AD-4 chỉ chuyển sang Hết hạn sau khi Tingee xác nhận Đơn chưa được trả (IPN `expired`/`canceled` hoặc tra trạng thái). Vì vậy sau mốc 15 phút, Đơn có thể vẫn ở trạng thái Chờ thanh toán thêm một lúc. Spine không nói API trả giờ máy chủ.
- **Gap:** Frontend sẽ tự suy ra "Hết hạn" từ đồng hồ trong khi backend vẫn trả Chờ thanh toán. Câu "Chỗ đã được trả lại" khi đó là sai. Nếu tiền về ngay sau mốc 15 phút, màn Hết hạn lại chuyển thành Thành công, mâu thuẫn với nội dung vừa hiện. Spine cũng không có nguồn giờ máy chủ để đếm "theo giờ máy chủ".
- **Đề xuất:** Thêm vào AD-4 hoặc AD-17:
  - Màn hình chỉ hiện "Hết hạn" khi REST trả `status = expired`.
  - Khi đồng hồ về 0 mà Đơn còn Chờ thanh toán, frontend hiện trạng thái trung gian "Đang xác nhận…" và chờ tín hiệu `order_changed`.
  - Mọi response có Đơn đang chờ kèm `expiresAt` và `serverNow`, hoặc header `Date` được quy định là nguồn giờ.
  - UX bổ sung trạng thái trung gian này.

### R-06 — Link mời CTV dùng chung chưa có mô hình · **High**

- **UX:**
  - `L74` và `L193`: "link mời CTV chung" với nút "Sao chép link", kèm danh sách CTV đã nhận và nút "Thu hồi" cho từng người.
  - `L314`: link chung còn hạn hoặc hết hạn, có "tạo link mới".
  - `L351-352`: màn nhận lời mời hiện tên Sự kiện và BTC; báo "Link mời đã hết hạn / bị thu hồi".
  - `L494`: thu hồi có hiệu lực ngay ở lượt quét kế tiếp.
- **Spine:** Mô-đun `checkin` sở hữu "Lời mời CTV". Bảng `CHECKER` có trong ER. AD-14 và AD-19 kiểm quyền mỗi request. Spine không có mô hình cho lời mời.
- **Gap:** Spine chưa trả lời các câu sau:
  - link chung hay mỗi người một link (FR-26 để UX/Architecture quyết, UX đã chọn link chung);
  - định dạng token và cách lưu;
  - hạn mặc định của link;
  - mỗi Sự kiện được bao nhiêu link đang hoạt động;
  - tạo link mới có vô hiệu link cũ không;
  - thu hồi link khác gì thu hồi một CTV.

  Lỗ hổng đáng lo nhất: với link chung, CTV đã bị thu hồi có thể mở lại link vẫn còn hạn và nhận lời mời lần nữa. Nếu backend làm "nhận lời mời" theo kiểu upsert thì thu hồi trở nên vô hiệu. Màn xem trước lời mời lộ tên Sự kiện và BTC cho người chưa phải thành viên, nên cũng cần quy tắc riêng.
- **Đề xuất:** Thêm một AD cho `checkin`:
  - Bảng `checker_invites(event_id, token_hash, expires_at, revoked_at)`. Mỗi Sự kiện có tối đa một link đang hoạt động. Tạo link mới thì thu hồi link cũ.
  - Hạn link = min(N ngày, `effective_end_at`).
  - Bảng `checkers(event_id, user_id, status: active|revoked, revoked_by, revoked_at)`. Nhận lời mời khi đã có bản ghi `revoked` thì trả lỗi `CHECKER_REVOKED` và không kích hoạt lại. Muốn cho người đó quay lại thì Owner hoặc Admin phải bấm "khôi phục".
  - Xem trước lời mời bắt buộc đăng nhập và chỉ trả tên Sự kiện và tên BTC.
  - Ghi audit theo AD-18.

### R-07 — Vòng đời cờ "Tạm ngừng bán" và dữ liệu Token chưa rõ · **High**

- **UX:**
  - `L237`: banner "Tạm ngừng bán" hiện trên trang Sự kiện **trước khi** người mua thử mua.
  - `L247`: Checkout báo Token không đủ.
  - `L307`: hai mức Token: dưới ngưỡng (warning, có "mua thêm Token") và chạm hạn mức (danger).
  - `L66`: trang Token hiện số dư, hạn mức và ngưỡng.
  - `L191`: wizard bước 4 liệt kê Token là điều kiện còn thiếu.
  - Flow 2 `L471`: Token dưới ngưỡng thì có banner và email.
- **Spine:** AD-6 bật "Tạm ngừng bán" khi tạo link thất bại vì Token hoặc vì BTC bị ngắt dịch vụ. AD-21 có đầu vào "cờ Tạm ngừng bán từ Tingee". AD-8 nhắc sự kiện "BTC được mở lại dịch vụ". Bảng sở hữu không có Token, ngưỡng Token hay cờ ngắt dịch vụ.
- **Gap:**
  1. Cờ chỉ được bật **sau khi** một người mua gặp lỗi. Spine không nói ai tắt cờ và khi nào. Nếu cờ chỉ tắt khi tạo link thành công thì sẽ kẹt: trang đã hiện Tạm ngừng bán nên không ai tạo Đơn, và không có lần gọi nào phát hiện được BTC đã hồi phục.
  2. Không có nguồn cho sự kiện "BTC được mở lại dịch vụ" (webhook, polling hay thao tác tay).
  3. Ngưỡng cảnh báo Token do Owner đặt chưa có mô-đun sở hữu.
  4. Không nói số dư và hạn mức đọc trực tiếp từ Tingee khi có request (FR-34 cấm lưu số dư) hay cách khác. Nếu Tingee chậm hoặc lỗi thì trang Token hiện gì?
  5. Ngưỡng dưới mức được phát hiện bằng gì và tần suất bao lâu.
  6. Wizard không biết Token có đủ hay không nếu chưa gọi Tingee.
- **Đề xuất:**
  - `organizer` sở hữu `organization_service_status(state: active|suspended, reason: token_limit|tingee_cut|closed_beta_revoked, since, last_checked_at)` và `token_alert_threshold`.
  - Bật cờ khi: tạo link lỗi với mã Token hoặc ngắt dịch vụ, hoặc job thăm dò thấy vượt ngưỡng.
  - Tắt cờ khi: job pg-boss thăm dò API Token hoặc Master Merchant theo backoff thấy dịch vụ đã mở lại. Lúc tắt cờ thì phát sự kiện "mở lại dịch vụ" để kích hoạt AD-8.
  - Trang Token đọc thẳng từ adapter `tingee` với timeout, lỗi thì hiện "Chưa đọc được số dư".
  - Cảnh báo dưới ngưỡng gửi một lần cho mỗi lần vượt ngưỡng (khóa idempotent = BTC + chu kỳ).
  - Ghi R-9 của PRD vào Open Questions của spine: chưa có tên endpoint Token.

### R-08 — Không có read-model cho `status-banner` · **High**

- **UX:**
  - `status-banner` (`L146`, `L207-223`): 11 loại banner có thứ tự ưu tiên, tối đa 2 banner, phần còn lại gộp "+N thông báo". Banner chặn bán không đóng được. Banner đã đóng thì ẩn "tới khi trạng thái đổi".
  - Người mua chỉ thấy banner trạng thái Sự kiện.
  - Banner theo vai trò: Owner thấy "Liên kết ngay", Admin thấy "Nhờ Owner…" (`L303`).
  - Banner sau khi hủy Sự kiện kèm bộ đếm "{n} Đơn cần hoàn tiền" (`L321-322`).
- **Spine:** AD-21 có `ordering.sellability(eventId)` trả trạng thái bán **theo từng Hạng vé**. Spine không có nguồn nào cho banner cấp BTC (Closed Beta chờ duyệt hoặc bị thu hồi, chưa liên kết tài khoản, Token, Google Sheets, khóa).
- **Gap:** Frontend có thể tự ghép banner từ 5–6 endpoint với logic riêng, còn backend có thể làm một endpoint tổng. Hai cách sẽ ra kết quả khác nhau. Trang công khai cần **một** lý do ở cấp Sự kiện, không phải danh sách trạng thái từng Hạng vé. Dashboard cần biết **nguyên nhân** Tạm ngừng bán (Token hay Closed Beta bị thu hồi) để chọn đúng banner. "Ẩn tới khi trạng thái đổi" cần một phiên bản trạng thái để so sánh.
- **Đề xuất:**
  - Một hàm duy nhất, ví dụ `reporting.statusNotices(scope)` hoặc đặt trong `organizer`, trả `[{code, severity, blocking, dismissible, scope: org|event, audience: owner|admin|buyer, data, version}]`.
  - Endpoint: `GET /v1/orgs/:id/notices`, `GET /v1/events/:id/notices`, và `notices` công khai đính kèm trang Sự kiện.
  - Enum `code` và thứ tự ưu tiên khai báo trong `packages/contracts`. Frontend chỉ ánh xạ `code` sang nội dung hiển thị.
  - `sellability()` trả thêm `eventReason` để trang công khai dùng.
  - Tín hiệu `org_status_changed` dùng chung với R-02.

### R-09 — Hủy hoặc khóa Sự kiện khi còn Đơn Chờ thanh toán: vẫn phát Vé hợp lệ · **High**

- **UX:** Flow 4 bước 3 (`L505`) yêu cầu Đơn đang Chờ thanh toán hết hiệu lực và người mua thấy "Sự kiện đã hủy" trên màn thanh toán hoặc `order-card` (OQ #8). `L239` và `L318` yêu cầu Sự kiện bị khóa "ngừng nhận Đơn ngay".
- **Spine:** AD-3 không có chuyển pending → cancelled. AD-1 `markPaid` chỉ so khớp trạng thái Đơn, không kiểm tra Sự kiện. AD-21 chỉ chặn ở TX1. AD-15 kiểm tra `status='valid'` của Vé, không kiểm tra trạng thái Sự kiện.
- **Gap:** Link Gateway còn sống tối đa 15 phút sau khi hủy. Nếu người mua trả tiền trong khoảng đó, IPN dẫn tới `markPaid` pending → paid và phát Vé **hợp lệ** cho Sự kiện đã hủy. Khi quét, Vé này ra xanh. Đơn này có thể không nằm trong danh sách hoàn tiền nếu danh sách được chụp lúc hủy. UX muốn ngược lại.
- **Đề xuất:**
  - `markPaid` kiểm tra trạng thái Sự kiện trong cùng `tx`. Sự kiện Đã hủy (hoặc Bị khóa, tùy PM) thì chuyển sang `review` với loại mới "Thanh toán sau hủy" thay vì phát Vé.
  - Thêm chuyển pending → cancelled (nguồn: hủy Sự kiện). Khi hủy Sự kiện, enqueue job hủy link Gateway nếu Tingee có API hủy link.
  - Danh sách hoàn tiền là truy vấn động, không chụp lúc hủy.

### R-10 — Quét khi mạng chập chờn: mất phản hồi dẫn tới đỏ giả · **High**

- **UX:**
  - `offline-banner` (`L179`): hiện ngay khi mất mạng, tạm dừng camera, tự thử lại.
  - `L424`: "camera dừng để Lan không tưởng đã quét được".
  - Nhánh lỗi Flow 3 (`L492`): sóng 4G chập chờn.
  - `scanner-viewport` (`L177`): kết quả dưới 1 giây.
- **Spine:** AD-15: lần UPDATE thứ hai được 0 dòng thì trả đỏ "đã check-in lúc X bởi Y". Spine không có khóa idempotent cho lượt quét, không có timeout phía client, không có cách phát hiện mất mạng.
- **Gap:** Request quét đã commit ở server nhưng phản hồi bị mất. CTV quét lại thì thấy **đỏ** "Đã check-in · bởi [chính mình]". Đây là đỏ giả ở cổng, đúng rủi ro UX số 2. Spine cũng không nói sau bao lâu thì coi là mất mạng (`navigator.onLine` không tin được) và có ping tới endpoint health không.
- **Đề xuất:**
  - Request quét và check-in tay mang `scanId` do client sinh, dùng làm khóa idempotent. Cùng `scanId` trả lại đúng kết quả lần đầu.
  - Bổ sung quy tắc: `checked_in_by` là người đang quét và `checked_in_at` trong vòng 60 giây thì trả kết quả riêng "Bạn vừa check-in Vé này" (xanh nhạt hoặc trung tính), không phải đỏ.
  - Thống nhất timeout client khoảng 3 giây. Hết timeout thì hiện `offline-banner` và thử lại cùng `scanId`.
  - Thêm endpoint nhẹ `GET /v1/health` để tự thử lại.

### R-11 — Hợp đồng kết quả quét chưa đủ · **Medium**

- **UX:**
  - `L356-362`: xanh hiện "Minh · Vé 2/2 · Đôi nam". Đỏ có ba lý do: "Mã QR vé không đúng", "Vé đã hủy", "Vé của Sự kiện khác".
  - Đỏ "Đã check-in" kèm giờ và **tên** người quét trước.
  - Hai màn hết quyền riêng: "không còn quyền" và "Sự kiện đã kết thúc".
  - Số đã check-in hiện trên Màn quét.
  - Phần đọc cho trình đọc màn hình ở `L386`.
- **Spine:** AD-15 chỉ có hai kết quả "đã check-in lúc X bởi Y" và "vé không hợp lệ". Spine không có enum lý do, không có số thứ tự Vé trong Đơn, không nói tên Người mua lấy từ đâu (tên trong form Checkout hay tên tài khoản), cũng không nói tên CTV hiển thị lấy từ đâu (tài khoản chỉ có OTP email có thể không có tên).
- **Gap:** Frontend sẽ đoán mã lỗi. Vé bị Quản trị Tingee vô hiệu hoặc Vé hết hiệu lực sau `effective_end_at` không có lý do tương ứng.
- **Đề xuất:**
  - Schema `ScanResult` trong `packages/contracts`:
    - `ok: {buyerName, ticketIndex, ticketCount, ticketTypeName, eventCheckinCount}`
    - `already: {checkedInAt, checkedInByName}`
    - `invalid: {reason: BAD_SIGNATURE | CANCELLED | OTHER_EVENT | VOIDED | EXPIRED}`
    - `forbidden: {reason: CHECKER_REVOKED | EVENT_ENDED}`
  - `tickets.seq` (số thứ tự trong Đơn) sinh lúc phát Vé.
  - `buyerName` lấy từ trường "Tên" của form Đơn.
  - Tên CTV lấy từ `user.name`, không có thì dùng một nhãn che bớt (không lộ email).

### R-12 — Trạng thái Đơn sau Hủy Sự kiện: UX và AD-3 lệch nhau · **Medium**

- **UX:**
  - `L321`: sau khi hủy, tab Đơn lọc sẵn "Đơn **Đã thanh toán** chưa 'Đã hoàn tay'".
  - `L322`: banner chuyển sang neutral khi đã hoàn tay hết.
  - Flow 4 `L508`: đánh dấu hàng loạt.
  - Flow 4 `L515`: bỏ đánh dấu "Đã hoàn tay" được, có ghi nhật ký.
  - `stat-card` (`L188`): doanh thu chỉ tính Đơn Đã thanh toán.
- **Spine:** AD-3 có chuyển paid → cancelled khi Sự kiện bị hủy, rồi cancelled → refunded. Không có chuyển refunded → cancelled.
- **Gap:**
  - Theo spine, sau khi hủy thì không còn Đơn nào "Đã thanh toán", nên bộ lọc UX luôn rỗng và doanh thu về 0.
  - `cancelled` dùng chung cho "BTC từ chối Đơn Cần xử lý" và "Sự kiện hủy", nên danh sách hoàn tiền và màn người mua không tách được hai trường hợp.
  - UX cho bỏ đánh dấu hoàn tay nhưng AD-3 không có chuyển này.
- **Đề xuất:**
  - Thêm `orders.cancel_reason` (`rejected | event_cancelled`) và `paid_amount` để biết số tiền đã trả.
  - UX đổi bộ lọc thành "Đã hủy do hủy Sự kiện, chưa hoàn tay".
  - Ghi rõ doanh thu sau khi hủy tính thế nào.
  - Nếu PM duyệt OQ #8 thì thêm refunded → cancelled (bỏ đánh dấu) vào AD-3. Đánh dấu hàng loạt là gọi nhiều lần CAS, mỗi Đơn một bản ghi audit.

### R-13 — Trạng thái Đơn hiển thị cho Người mua · **Medium**

- **UX:**
  - `L102` và `L277`: mọi loại Cần xử lý hiện chung một câu "BTC đang kiểm tra thanh toán", không lộ tên loại.
  - `order-card` (`L171`) và `L278`: Đã hủy kèm liên hệ BTC.
  - `L281`: Vé Đã hủy do Sự kiện hủy hiện "BTC sẽ liên hệ hoàn tiền".
  - Kênh liên hệ BTC chưa chốt (OQ #4).
- **Spine:** AD-13 có `buyerScope`. Spine không quy định dữ liệu trả cho người mua. Bảng sở hữu không có trường liên hệ BTC.
- **Gap:** Nếu API của người mua trả trạng thái nội bộ `review` kèm loại và số tiền lệch, frontend phải tự che. Rất dễ lộ chi tiết nội bộ. Màn "liên hệ BTC" chưa có dữ liệu để hiển thị.
- **Đề xuất:**
  - Schema `BuyerOrderView` trong `contracts` với `buyerStatus: awaiting_payment | confirming | under_review | paid | expired | cancelled_by_organizer | event_cancelled`. Không có trường `review_type` hay `paidAmount`.
  - `organizer` thêm `contact_email` và `contact_phone` (Owner nhập ở Cài đặt BTC). UX bổ sung trường này.

### R-14 — Tra tay chưa có hợp đồng · **Medium**

- **UX:**
  - `manual-lookup` (`L180`): tìm theo SĐT hoặc email, "kết quả hiện ngay khi gõ" (debounce khoảng 200 ms), mỗi hàng có tên, Hạng vé, "Vé 1/2" và trạng thái.
  - `DESIGN.md:L673`: hàng kết quả không hiện SĐT.
  - OQ #3: có tìm theo tên hoặc vài số cuối SĐT không.
- **Spine:** AD-13 lọc theo `event_id`. AD-15 không trả Mã QR vé. Spine không nói gì thêm.
- **Gap:**
  - "Hiện khi gõ" nghĩa là khớp tiền tố, còn FR-29 chỉ yêu cầu khớp đầy đủ. Frontend và backend sẽ hiểu khác nhau.
  - Chưa có quy tắc chuẩn hóa SĐT (`+84`/`0`, dấu cách) và email (chữ hoa/thường).
  - Chưa nói tìm trên SĐT trong form Đơn hay SĐT của tài khoản.
  - Không chặn việc dò thông tin cá nhân (CTV gõ thử nhiều số liên tiếp).
  - Response chưa bị cấm trả SĐT và email.
- **Đề xuất:**
  - Khớp **đầy đủ** sau khi chuẩn hóa sang E.164 và email viết thường, trên cả trường của form Đơn lẫn tài khoản.
  - Frontend chỉ gọi khi giá trị nhập đã hợp lệ.
  - Giới hạn tốc độ theo CTV và theo Sự kiện. Mỗi lần tra ghi log, không ghi giá trị đã tra.
  - Response chỉ gồm `{ticketId, buyerName, ticketTypeName, seq, count, checkedIn}`.
  - Ghi quyết định cho OQ #3 vào spine: hoãn, hoặc cho phép kèm giới hạn.

### R-15 — Điều kiện "Mở bán" (wizard bước 4) và `sellability()` · **Medium**

- **UX:**
  - `wizard-stepper` (`L191`), `L311` và Flow 2 (`L470-473`): "Mở bán" chỉ bật khi đủ điều kiện (chính sách hoàn vé, liên kết tài khoản, Closed Beta, Token). Mỗi điều kiện thiếu có link sửa.
  - Chưa duyệt Closed Beta vẫn mở bán được Sự kiện miễn phí.
- **Spine:** AD-21 coi Closed Beta và liên kết tài khoản là đầu vào của `sellability()`. Hiểu theo nghĩa đó thì Sự kiện **mở bán được**, chỉ hiện "Tạm ngừng bán". Spine không có API kiểm điều kiện mở bán.
- **Gap:** Frontend có thể tự tính danh sách điều kiện, trong khi backend chặn hoặc không chặn theo cách khác. Spine và UX cũng lệch nhau: UX chặn ngay lúc bấm Mở bán, spine cho mở bán rồi tính trạng thái bán sau.
- **Đề xuất:** Thêm `event.publishReadiness(eventId)` trả `[{code, satisfied, fixLink}]`. Lệnh mở bán gọi lại đúng hàm này. Quy định rõ: điều kiện chặn mở bán (chính sách hoàn vé, Closed Beta và liên kết tài khoản khi có Hạng vé có phí, giá từ 2.000đ) khác với điều kiện chỉ làm tạm ngừng bán (Token, khóa). Mã điều kiện dùng chung enum với R-08.

### R-16 — Liên kết tài khoản nhận tiền chưa có máy trạng thái · **Medium**

- **UX:**
  - `L304`: "Đang liên kết", rời trang được, banner cập nhật khi xong.
  - `L305`: thất bại kèm lý do có thể xử lý (lấy từ mã lỗi Tingee) và "Thử lại" giữ nguyên dữ liệu đã nhập.
  - Flow 2 `L472`.
- **Spine:** `organizer` sở hữu Merchant con và tài khoản nhận tiền. AD-9 đổi mã lỗi Tingee thành lỗi miền. AD-12 coi mọi lần gọi Tingee ngoài luồng tạo link là job.
- **Gap:** Theo AD-12, liên kết là job bất đồng bộ, nhưng spine không có trạng thái `linking | linked | failed(reason)`. Danh sách mã lỗi miền mà frontend cần để viết nội dung báo lỗi cũng chưa có. Spine cũng không quy định có lưu thông tin đã nhập để "Thử lại" hay không. Nếu lưu số tài khoản BTC thì đó là dữ liệu nhạy cảm.
- **Đề xuất:**
  - Bảng `sub_merchant_links(status, failure_code, attempted_at)`.
  - Enum `failure_code` trong `contracts` (gồm `BANK_NOT_SUPPORTED` cho VietinBank).
  - Khi trạng thái đổi thì phát tín hiệu `org_status_changed`.
  - Ghi rõ thông tin đã nhập được giữ ở client hay ở server.

### R-17 — Trạng thái kết nối Google Sheets · **Medium**

- **UX:** `L308`: bốn trạng thái "Đã kết nối · đang đồng bộ · lỗi/thử lại · mất quyền". Mất quyền thì hiện banner "Kết nối lại Google Sheets".
- **Spine:** AD-23 chỉ nói mất quyền thì chuyển sang "trạng thái lỗi".
- **Gap:** Frontend cần phân biệt lỗi tạm thời (job đang tự thử lại, không cần BTC làm gì) với mất quyền (BTC phải kết nối lại). Spine chỉ có một trạng thái "lỗi".
- **Đề xuất:** Thêm vào AD-23: `sheet_connections.status: active | syncing | retrying | auth_revoked`, kèm `last_synced_at` và `last_error_code`. Chỉ `auth_revoked` mới sinh banner.

### R-18 — Chưa có danh mục thông báo · **Medium**

- **UX và PRD cần các thông báo sau:**
  - email Vé (FR-23);
  - email cho người mua với **mọi** loại Cần xử lý (`L277`, OQ #4);
  - email khi đổi giờ hoặc địa điểm (`L313`);
  - email cho mọi người mua khi hủy Sự kiện (Flow 4);
  - Token dưới ngưỡng: email và dashboard (`L471`);
  - Thanh toán mồ côi: "báo cho BTC" (FR-14).
- **Spine:** AD-12 chỉ quy định email và cảnh báo chạy bằng job.
- **Gap:** Spine không nói ai nhận (mọi Owner và Admin, hay chỉ Owner), sự kiện nào kích hoạt, và khóa chống gửi lặp. Cảnh báo Token có thể bị gửi lặp mỗi lần job chạy. Frontend và backend cũng chưa thống nhất "báo cho BTC" là email, badge hay cả hai.
- **Đề xuất:** Thêm bảng "Notifications" vào `contracts`, mỗi dòng gồm: loại, sự kiện kích hoạt, người nhận, kênh, khóa idempotent, queue. Ví dụ: `notify.token_below_threshold` gửi cho Owner qua email và banner, khóa là `(org, threshold_crossing_id)`.

### R-19 — Vai trò trên UI, mã lỗi quyền và xác thực lại TOTP · **Medium**

- **UX:**
  - `L81` và `L186`: ẩn mục dành riêng cho Owner khi người dùng là Admin.
  - `L315`: Admin mở URL dành cho Owner thì thấy `empty-state` riêng.
  - `L316`: bị xóa khỏi BTC giữa phiên thì hiện Dialog.
  - `L320` và OQ #2: chưa chốt cách xác thực hai bước (2FA) cho Owner.
- **Spine:** AD-19: vai trò tra theo từng request, không lưu trong session. Owner bắt buộc TOTP trước mọi thao tác chỉ Owner được làm.
- **Gap:**
  - Không có endpoint cho frontend biết vai trò của người dùng ở BTC đang chọn.
  - Không có mã lỗi phân biệt `FORBIDDEN_ROLE`, `NOT_A_MEMBER` và `TOTP_REQUIRED`.
  - Chưa quy định TOTP xác minh một lần mỗi session hay mỗi thao tác, và hiệu lực bao lâu.
  - UX chưa có màn đăng ký TOTP và màn nhập TOTP khi cần.
- **Đề xuất:**
  - Endpoint `GET /v1/me/memberships` trả `[{orgId, role}]`.
  - Thêm các mã lỗi trên vào `contracts`.
  - Quy tắc xác thực lại (step-up): TOTP có hiệu lực 12 giờ (giá trị đề xuất) trong session. Hết hạn thì api trả `TOTP_REQUIRED` và frontend hiện màn nhập.
  - UX bổ sung màn đăng ký TOTP và màn nhập lại TOTP. OQ #2 coi như đã được spine quyết.

### R-20 — "Vô hiệu Vé đã phát" khi khóa vi phạm sơ đồ phụ thuộc · **Medium**

- **UX:** `L342`: Dialog khóa có tùy chọn vô hiệu Vé đã phát. `L318`: Vé vẫn check-in được trừ khi Quản trị Tingee vô hiệu.
- **Spine:** `admin` chỉ được gọi `organizer` và `event`. Chỉ `ticketing` được ghi trạng thái Vé (AD-10). `ticketing` đã phụ thuộc `event`, nên `event → ticketing` sẽ tạo vòng phụ thuộc.
- **Gap:** Chức năng này không làm được nếu không phá sơ đồ phụ thuộc hoặc không ghi chéo bảng.
- **Đề xuất:** Thêm `admin → ticketing` vào sơ đồ: `ticketing.voidTicketsForEvent(tx, eventId, reason)`. Thêm lý do `VOIDED` vào kết quả quét (R-11). Ghi audit theo AD-18.

### R-21 — Ngân sách hiệu năng chưa chia cho từng chặng · **Medium**

- **UX:**
  - Trang Sự kiện dưới 2 giây trên 4G, hiện skeleton (`L232`).
  - "Còn N vé" phải chính xác và cập nhật khi tải trang và khi quay lại tab (`L156`).
  - Quét dưới 1 giây (`L177`).
  - Vé hiện dưới 3 giây từ IPN (FR-18).
  - Nút có trạng thái loading khi gọi mạng (`L139`).
- **Spine:** NFR-1, NFR-2 và NFR-3 có trong `binds`. Phòng chờ đang hoãn, tạm giới hạn tốc độ ở endpoint tạo Đơn. Spine không có phân bổ thời gian và không có chính sách cache.
- **Gap:**
  - Frontend có thể dùng ISR của Next để cache cả trang, bao gồm "Còn N vé". Số vé khi đó sai, trái FR-10.
  - Nếu không cache gì, 5.000 lượt xem cùng lúc (NFR-3) đều gọi `sellability()` vào PostgreSQL.
  - Timeout của `create-link` (AD-5) chưa có giá trị, trong khi frontend cần biết giữ spinner bao lâu trước khi báo "Chưa gửi được Đơn". Nếu timeout frontend ngắn hơn backend thì người mua thấy lỗi trong khi Đơn đã được tạo.
  - Nhịp polling chưa có (xem R-02).
- **Đề xuất:**
  - Chia trang Sự kiện thành hai phần: nội dung tĩnh SSR có cache (revalidate khi sửa Sự kiện) và `GET /v1/events/:slug/availability` không cache, gọi lúc tải trang và khi `visibilitychange`. Availability có thể cache vài giây nếu PM chấp nhận.
  - Bảng ngân sách thời gian: `create-link` timeout 5 giây, frontend chờ tối đa 8 giây; quét có timeout client 3 giây; polling theo R-02.

### R-22 — Xem Vé khi mất mạng (UX OQ #13) · **Low**

- **UX:** OQ #13 (`L561`) hỏi Chi tiết Vé có cần lưu sẵn để mở khi mất mạng không.
- **Spine:** AD-16 dùng mã tĩnh có chữ ký, không phụ thuộc mạng. Spine không nói gì về cache phía client.
- **Gap:** Frontend không biết có được lưu Vé ở thiết bị không.
- **Đề xuất:** Ghi rõ: Mã QR vé là chuỗi tĩnh, client được lưu (Service Worker hoặc cache trang Chi tiết Vé), lần mở lại không bắt buộc gọi mạng. Khi đăng xuất thì xóa. Hoặc ghi "hoãn" trong Deferred.

### R-23 — Sự kiện Nháp và slug sai phải trả cùng một 404 · **Low**

- **UX:** `L233`: Sự kiện Nháp trả cùng trạng thái "không tìm thấy", không lộ là Sự kiện có tồn tại.
- **Spine:** Không có quy tắc này.
- **Gap:** Backend có thể trả `403 EVENT_DRAFT`, làm lộ việc Sự kiện tồn tại.
- **Đề xuất:** Endpoint công khai trả `404 EVENT_NOT_FOUND` cho cả Nháp lẫn slug sai. Thêm quy tắc vào AD-21 hoặc Consistency Conventions.

### R-24 — `social-ticket-card` dựng ảnh ở client từ ảnh S3 · **Low**

- **UX:** `L170`: ảnh "tạo tại chỗ" rồi chia sẻ qua Web Share. `DESIGN.md` › social-ticket-card dùng ảnh Sự kiện.
- **Spine:** AD-22 dùng object storage S3 và presigned upload. AD-11 có next/og.
- **Gap:** Bucket thiếu header CORS thì canvas bị "tainted" và không xuất được ảnh.
- **Đề xuất:** Chọn một trong hai: sinh ảnh ở server bằng next/og (`/tickets/:id/story.png`, có kiểm `buyerScope`), hoặc bắt buộc CORS `GET` cho origin web trên bucket ảnh.

### R-25 — Quyền còn lại của BTC bị khóa · **Low**

- **UX:** `L317` và OQ #9: BTC bị khóa vẫn xem Đơn, check-in và xuất CSV, nhưng không tạo hay mở bán Sự kiện.
- **Spine:** AD-21 chỉ chặn bán. Spine không quy định các thao tác quản trị khi bị khóa.
- **Gap:** Backend có thể vẫn cho tạo hoặc mở bán Sự kiện khi BTC bị khóa.
- **Đề xuất:** Khi PM chốt OQ #9, thêm "khóa BTC chặn tạo, sửa và mở bán Sự kiện" vào `publishReadiness` (R-15) và vào guard của mô-đun `event`.

### R-26 — Ví dụ mã Đơn trong UX khác AD-20 · **Low**

- **UX:** `L124` và `DESIGN.md` dùng `TK8F3Q2A`, tức `TK` + 6 ký tự.
- **Spine:** AD-20 quy định `TK` + 8 ký tự, tổng 10 ký tự.
- **Gap:** Độ rộng hiển thị của mã Đơn (`typography.code`) trên `order-card` và ở hàng 375 px chưa được kiểm với 10 ký tự.
- **Đề xuất:** UX cập nhật ví dụ (vd. `TK8F3Q2AXM`) và kiểm lại bố cục ở 375 px.

## UX cần cập nhật do quyết định Gateway

Thanh toán chuyển sang Tingee Payment Gateway (popup hoặc redirect, `returnUrl` về màn Thành công của Tickee) và không hỗ trợ VietinBank. Đây là quyết định có chủ đích. Phần dưới liệt kê các thành phần và luồng UX mà quyết định này làm mất hiệu lực.

### Thành phần và luồng bị ảnh hưởng

| Tham chiếu | Thành phần hoặc luồng | Cần đổi |
| --- | --- | --- |
| EXPERIENCE `L20` (Foundation) | Hành trình "Checkout → QR thanh toán → Vé của tôi" | Đổi thành Checkout → Xác nhận thanh toán → Gateway → Màn trả về hoặc Thành công |
| EXPERIENCE `L42` (IA) | Bề mặt "QR thanh toán" | Thay bằng màn "Xác nhận thanh toán" (trước khi mở Gateway) và "Màn trả về" (`returnUrl`) |
| EXPERIENCE `L43-44` (IA) | Thành công "tự chuyển từ QR thanh toán"; Hết hạn "tự chuyển khi hết 15 phút" | Thành công đến từ `returnUrl` kèm REST và SSE. Hết hạn chỉ hiện theo trạng thái máy chủ (R-05) |
| EXPERIENCE `L68`; `L306`; DESIGN `L570` | Tài khoản nhận tiền "QR động hay chỉ QR tĩnh"; trạng thái "Chỉ dùng được QR tĩnh"; badge "QR động / Chỉ QR tĩnh" | Bỏ phân biệt này (Gateway xử lý cả tài khoản chỉ có QR tĩnh). Badge còn "Đang liên kết / Đã liên kết / Liên kết thất bại" |
| EXPERIENCE `L305`; Flow 2 `L472` | Liên kết thất bại | Thêm lý do "Ngân hàng chưa được hỗ trợ (VietinBank)". Form chặn chọn VietinBank (`970415`) ngay khi nhập |
| EXPERIENCE `L209`, `L220` | Thứ tự `status-banner` mục 10 "Chỉ QR tĩnh"; danh sách banner đóng được | Bỏ mục này |
| EXPERIENCE `L133`; mockup `directions-2.html` | Danh sách minh họa có `payment-qr-card` | Cập nhật mockup |
| EXPERIENCE `L165`; DESIGN `L616-624` | `payment-qr-card` (QR tự dựng, "Mở app ngân hàng", "Tải ảnh QR", sao chép mã Đơn cho QR tĩnh) | **Bỏ.** Thay bằng màn Xác nhận thanh toán: số tiền, tóm tắt Đơn, nút chính "Thanh toán" mở Gateway |
| EXPERIENCE `L166`; DESIGN `L620` | `countdown-chip` | Giữ trên màn Xác nhận và `order-card`. Đếm tới hạn link (AD-4). Về 0 thì hiện "Đang xác nhận…", không tự hiện Hết hạn (R-05) |
| EXPERIENCE `L167`; DESIGN `L621`; Niềm tin `L402` | `recipient-trust-block` ("khớp đúng thứ app ngân hàng sẽ hiển thị") | Giữ trên màn Xác nhận. Cần xác minh trang Gateway và app ngân hàng hiển thị tên gì (G-4) |
| EXPERIENCE `L168`; DESIGN `L623` | `reassurance-line` | Chuyển sang Màn trả về khi đang ở trạng thái "Đang xác nhận" |
| EXPERIENCE `L171`, `L276` | `order-card` "Tiếp tục thanh toán mở lại đúng QR thanh toán" | Mở lại link Gateway của Đơn đó (G-3) |
| EXPERIENCE `L247` | Checkout: "Token khả dụng không đủ → không tạo QR" | Đổi thành "không tạo được link thanh toán". Nội dung "Tạm ngừng bán" giữ nguyên |
| EXPERIENCE `L248` | Gửi Đơn lỗi, "chuyển thẳng tới QR thanh toán của Đơn đó" | Chuyển tới màn Xác nhận của Đơn đó (R-03) |
| EXPERIENCE `L249` | "Không tạo được QR (Tingee lỗi)" | Đổi thành "Chưa mở được trang thanh toán". Quy tắc thử lại theo kết quả R-04 |
| EXPERIENCE `L252-262` | Nhóm trạng thái màn QR: Đang chờ, Chờ lâu, Quay lại từ app ngân hàng, QR tĩnh, Mất mạng khi đang chờ | Viết lại cho Màn trả về. Bỏ trạng thái "QR tĩnh". "Quay lại từ app ngân hàng" đổi thành "quay lại từ Gateway" |
| EXPERIENCE `L263` | Thành công | Thêm trạng thái trước "Đang xác nhận" (về từ `returnUrl` nhưng IPN chưa tới). Chuyển cảnh thẻ Vé vẫn dùng được |
| EXPERIENCE `L264` | Hết hạn | Chỉ hiện khi máy chủ báo `expired`. Thêm trường hợp người mua hủy trên Gateway (G-7) |
| EXPERIENCE `L192`; DESIGN `L565` | `needs-action-row` "ghép tay giao dịch với Đơn"; loại "Giao dịch chưa khớp" | Gần như không còn (mọi IPN đều có `orderId`). PM xác nhận bỏ hay giữ. Giữ "Lệch số tiền" và "Thanh toán mồ côi" |
| EXPERIENCE `L368-371` | Interaction Primitives: QR tự cập nhật, **Deep Link** sang app ngân hàng, sao chép mã Đơn (QR tĩnh) | Bỏ Deep Link và sao chép mã Đơn. Mục "không reload" áp cho Màn trả về |
| EXPERIENCE `L387` | A11y: nhãn ảnh QR thanh toán; thông báo đếm ngược ở mốc 5 phút và 1 phút | Bỏ nhãn ảnh QR. Giữ quy tắc thông báo đếm ngược trên màn Xác nhận |
| EXPERIENCE `L396-410` | Mục "Niềm tin khi thanh toán", gồm thứ tự trên màn | Viết lại. Tín hiệu tin cậy dồn vào màn Xác nhận trước khi rời Tickee ("Tiền chuyển thẳng cho …", chính sách hoàn vé trong `Sheet`, "Tickee không giữ tiền"). Ý 4 "màn hình giữ nguyên QR" không còn |
| EXPERIENCE `L438-441` (Flow 1 bước 5–8); `L446-447` | Màn QR, "Mở app ngân hàng", quay lại trình duyệt; nhánh "ghi sai nội dung (QR tĩnh)" | Viết lại theo Gateway. Bỏ nhánh QR tĩnh và sai nội dung |
| EXPERIENCE `L459`, `L461` (Flow 2) | "Kết quả hiện ngay: dùng được QR động"; Hạng vé 300.000đ | Bỏ câu về QR động. Form Hạng vé thêm kiểm **giá có phí ≥ 2.000đ** (AD-6) kèm thông báo lỗi |
| EXPERIENCE `L505` (Flow 4 bước 3) | "Người mua thấy 'Sự kiện đã hủy' trên QR thanh toán" | Hiện trên màn Xác nhận, Màn trả về và `order-card` (R-09) |
| EXPERIENCE `L533`, `L538` | Responsive "Checkout, QR"; Deep Link trên desktop ẩn "Mở app ngân hàng" | Bỏ. Thêm hành vi popup hoặc redirect trên desktop và điện thoại (G-1) |
| EXPERIENCE OQ #6 (`L551`), #12 (`L560`), #14 (`L565`) | QR tĩnh khi BTC bị ngắt dịch vụ; thử lại khi tạo QR lỗi; ngưỡng `reassurance-line` | #6 không còn. #12 đổi thành "tạo link" (R-03, R-04). #14 áp cho Màn trả về |
| DESIGN `L11` | Mô tả "Bán vé sự kiện nhỏ qua VietQR" | Đổi thành "qua Tingee Payment Gateway" |
| DESIGN `L630-635`; `L716`; mockup `key-success-ticket.html` mục 2 | Bảng phân biệt `payment-qr-card` và `ticket-card`; Do/Don't "QR thanh toán trong stage tối" | QR thanh toán giờ nằm trên trang Gateway, ngoài tầm kiểm soát của Tickee. Giữ `ticket-card` khác biệt rõ, bỏ phần mô tả `payment-qr-card` |
| DESIGN `L546` | Ví dụ `button-secondary` "Tải ảnh QR" | Chỉ còn cho Vé (nếu giữ) |
| Mới | Màn Xác nhận thanh toán; Màn trả về (Đang xác nhận / Thành công / Hết hạn / Đã hủy trên Gateway / BTC đang kiểm tra); lỗi chặn VietinBank; kiểm giá tối thiểu | UX thiết kế mới |

### Điểm kiến trúc cần chốt kèm khi viết lại UX

Đây không phải gap của quyết định Gateway. Đây là chi tiết spine còn để ngỏ, và UX mới cần chúng để frontend và backend làm khớp nhau.

| ID | Điểm cần chốt | Lý do | Mức |
| --- | --- | --- | --- |
| G-1 | **Popup (tingee.js) hay redirect.** AD-6 chưa chọn | Quyết định nội dung `returnUrl`, CSP cho script Tingee, và việc màn Tickee có sống tiếp để nghe SSE không. Popup mở **sau** một lời gọi bất đồng bộ (`create-link`) có thể bị Safari iOS chặn vì không còn nằm trong thao tác chạm của người dùng. Cần thử thật trên thiết bị | High |
| G-2 | **Hợp đồng Màn trả về.** Frontend không được tin tham số trên `returnUrl`. Trạng thái lấy từ `GET /v1/me/orders/:code` kèm `order_changed` | AD-1 chỉ cấm phát Vé từ `returnUrl`, chưa cấm *hiển thị* Thành công dựa trên query. NFR-2 (dưới 3 giây) tính từ IPN, nên màn phải chờ được IPN đến sau khi người mua đã quay về | High |
| G-3 | **"Tiếp tục thanh toán":** cần endpoint trả URL Gateway của Đơn đang chờ của chính người mua. Đơn chưa có link thì trả lỗi rõ ràng | `order-card` và luồng thử lại khi gửi Đơn lỗi (R-03) | Medium |
| G-4 | **Dữ liệu `recipient-trust-block`:** `organizer` có lưu tên chủ tài khoản và ngân hàng từ lúc liên kết không. Trang Gateway (VietQR, thẻ, Pay-by-Bank) hiển thị tên gì | Lời hứa niềm tin số 1 của UX ("khớp đúng app ngân hàng") có thể không còn đúng | Medium |
| G-5 | **Giá tối thiểu 2.000đ:** cần mã lỗi miền và kiểm ở `event` khi lưu Hạng vé, không đợi tới lúc gọi `create-link` | Form Hạng vé và wizard bước 4 | Low |
| G-6 | **Chặn VietinBank:** cần mã lỗi `BANK_NOT_SUPPORTED` và danh sách ngân hàng hỗ trợ đặt trong `contracts` để frontend lọc ngay | Form liên kết tài khoản | Low |
| G-7 | **Người mua hủy hoặc đóng trang Gateway** (IPN `canceled` trước hạn): AD-4 chỉ cho Hết hạn sau `expires_at`, nên chỗ bị giữ thêm khoảng 13 phút. Chưa biết link đã hủy có mở lại được không | `order-card` "Tiếp tục thanh toán" có thể mở một link đã chết. Cần quy tắc: IPN `canceled` thì cho Hết hạn ngay, hoặc tạo link mới cho cùng Đơn | Medium |

## Phụ lục — Những chỗ spine đã khớp UX

- Vé chỉ phát từ IPN hoặc Đối soát bù, kể cả khi người mua đóng tab hoặc chuyển app (AD-1, AD-17 với `visibilitychange`). Khớp yêu cầu không có nút "Tôi đã chuyển khoản" (`L405`).
- Hết chỗ khi gửi Đơn báo đúng Hạng vé (AD-2, `L246`). Giảm số suất dưới "đã bán + giữ chỗ" bị chặn (AD-2, `L312`).
- Check-in một lần, quét song song chỉ một người thấy xanh (AD-15, `L422`). Response không chứa Mã QR vé (AD-15, `L180`).
- Quyền CTV và hiệu lực Vé tính tại thời điểm request (AD-14). Khớp "hiệu lực ngay lượt quét kế tiếp" (`L494`) và lịch sử Vé sau khi Sự kiện kết thúc (`L282`).
- CTV chỉ thấy Sự kiện được giao (AD-13, `L92`).
- OTP 5 phút, tối đa 5 lần sai (AD-19, `L243`).
- `reassurance-line` sau khoảng 2 phút khớp mốc Đối soát bù 2 phút (AD-8, UX OQ #14).
- Phòng chờ: UX OQ #1 và spine Deferred thống nhất là chưa quyết.
- Không có check-in offline: UX Foundation và spine Deferred thống nhất.
