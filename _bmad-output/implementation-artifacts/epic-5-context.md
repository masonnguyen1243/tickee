# Epic 5 Context: Check-in tại cổng

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Ngày diễn ra Sự kiện, khách qua cổng nhanh và không ai vào bằng Vé giả hay Vé đã dùng, chỉ bằng trình duyệt điện thoại, không cần cài app. Owner/Admin tạo một link mời CTV chung cho Sự kiện. CTV (không phải thành viên BTC) đăng nhập để nhận lời mời và chỉ thấy Màn quét của đúng Sự kiện đó. CTV quét Mã QR vé và đọc kết quả xanh/đỏ bằng một cái liếc, dưới 1 giây. Mỗi Vé chỉ check-in thành công một lần, kể cả khi nhiều CTV quét cùng lúc hay mạng chập chờn, và không có "đỏ giả". Khách không mở được Vé thì tra tay theo SĐT hoặc email. Owner/Admin theo dõi số đã vào theo từng Hạng vé theo thời gian thực, thu hồi hoặc khôi phục CTV có hiệu lực ngay lượt quét kế tiếp. Quyền CTV tự hết ở mốc Sự kiện kết thúc. Kiểm thử tải check-in (NFR-3, quét song song) đã chuyển sang Story 9.2 vì cần staging. Epic 5 chỉ dựa trên Epic 1–3. Mọi story của epic đều chưa làm, nên AC trong `epics.md` và spine áp dụng trực tiếp. Hành vi đã ship mà epic chạm tới (Vé, Mã QR vé, realtime, quyền, đăng nhập) thì theo spec của story đó và spine.

## Stories

- Story 5.1: Link mời CTV và tab Check-in
- Story 5.2: CTV nhận lời mời
- Story 5.3: Quét Mã QR vé xanh/đỏ
- Story 5.4: Quét song song và mất mạng
- Story 5.5: Tra tay và check-in tay
- Story 5.6: Thu hồi, khôi phục CTV và hết quyền
- Story 5.7: Theo dõi check-in realtime

## Requirements & Constraints

- **Phân quyền:** Owner và Admin mời/thu hồi CTV, quét và tra tay ở mọi Sự kiện của BTC mình mà không cần lời mời. CTV chỉ quét và tra tay trong Sự kiện được giao, không thấy dashboard BTC hay Sự kiện khác. Người mua không có quyền nào ở đây.
- **Link mời CTV:**
  - một link chung cho mỗi Sự kiện, có hạn và thu hồi được;
  - chỉ tạo cho Sự kiện đã đăng (`published` hoặc `hidden`) và chưa kết thúc. Sự kiện đã kết thúc hoặc đã hủy thì nút "Tạo link mới" tắt kèm lý do, link cũ hiện "Đã hết hạn";
  - DB chỉ lưu hash của token, nên link chỉ hiện trọn ngay sau khi tạo, sao chép lại được trong phiên đó;
  - tạo link mới thì link cũ hết hiệu lực ngay. Mở link cũ thấy màn "Link mời đã hết hạn".
- **Nhận lời mời:**
  - bắt buộc đăng nhập (OTP email hoặc Google), sau đó quay lại đúng link mời;
  - màn xem trước chỉ lộ tên Sự kiện và tên BTC. Token sai thì không lộ tên Sự kiện;
  - mở lại link khi đã là CTV `active` thì vào thẳng Màn quét, không tạo bản ghi mới;
  - CTV đã bị thu hồi không tự nhận lại bằng link mới (`CHECKER_REVOKED`). Chỉ Owner/Admin "Khôi phục" được.
- **Quét:**
  - xanh: tên Người mua · Vé k/N · Hạng vé;
  - đỏ có âm thanh: "Đã check-in lúc HH:MM · bởi {người}", hoặc "Vé không hợp lệ" kèm một dòng lý do (sai chữ ký, Vé đã hủy, Vé bị vô hiệu, Vé của Sự kiện khác, Sự kiện đã kết thúc);
  - cùng người quét lại trong 60 giây: kết quả trung tính "Bạn vừa check-in Vé này", không phải đỏ.
- **Đúng một lần (FR-28):** hai CTV quét cùng Vé gần như đồng thời thì đúng một người thấy xanh, người kia thấy đỏ kèm giờ và tên người quét trước. Mất phản hồi rồi thử lại cùng `scanId` thì nhận lại kết quả xanh của lần đầu.
- **Mất mạng:** client timeout 3 giây thì báo mất kết nối, tạm dừng camera và tự thử lại cùng `scanId`. Không có hàng đợi quét offline và không ghi nhận cục bộ (ngoài MVP).
- **Tra tay:**
  - tìm theo SĐT hoặc email **đầy đủ** của Người mua, chuẩn hóa ở server (SĐT về E.164, email chữ thường + trim), không khớp một phần, chỉ trong Sự kiện được giao;
  - kết quả chỉ có tên, Hạng vé · Vé k/N và trạng thái check-in;
  - check-in tay theo đúng quy tắc một lần và ghi người bấm;
  - giới hạn tốc độ theo user và IP, vượt thì `429`;
  - người đã xóa Tài khoản Tickee: Vé vẫn check-in được bằng mã nhưng không còn tra tay được.
- **Thu hồi, khôi phục, hết quyền:**
  - thu hồi có hiệu lực ngay ở lượt quét hoặc tra kế tiếp, vì quyền kiểm lại ở từng request, không cache;
  - quyền CTV tự hết ở `effective_end_at`;
  - khôi phục chỉ cho CTV vào lại khi Sự kiện chưa kết thúc;
  - Admin cũng thu hồi được.
- **Realtime (FR-30):** số "đã check-in / tổng Vé hợp lệ", tổng và theo từng Hạng vé, cập nhật trong khoảng 1 giây ở tab Check-in và ở đỉnh Màn quét của mọi CTV được giao, không cần tải lại.
- **Riêng tư:**
  - response quét và tra tay không bao giờ chứa Mã QR vé, SĐT hay email;
  - log che SĐT/email và không ghi giá trị đã tra;
  - CTV chỉ đọc dữ liệu check-in của Sự kiện được giao (NFR-7).
- **Hiệu năng và vận hành:**
  - p95 từ lúc gửi tới lúc nhận kết quả quét < 1 giây, có metric riêng (đo ở staging);
  - check-in thuộc nhóm uptime 99,9%/tháng (đo ở Story 9.1).
- **Cách ly:** mọi route mới đi qua bộ test cách ly BTC, có ca CTV truy cập Sự kiện không được giao → 403.
- **Audit:** mọi thao tác tạo/thu hồi link, nhận lời mời, thu hồi/khôi phục CTV đều ghi `audit_events`.

## Technical Decisions

**Mô-đun và ranh giới**

- `checkin` sở hữu lời mời CTV, phân công CTV theo Sự kiện, Màn quét và tra tay. `ticketing` sở hữu Vé, bản chụp trên Vé, Mã QR vé và trạng thái check-in.
- Hướng phụ thuộc: `checkin` chỉ gọi `ticketing` và `event` (cùng `platform`); dependency-cruiser kiểm trong CI. Đọc chéo mô-đun đi qua service công khai ở `index.ts` hoặc read model.
- Nhận lời mời là `flows.acceptCheckerInvite`, một transaction, kiểm lại hạn link và `effective_end_at` ngay tại request.
- Mọi bảng thuộc BTC có `organization_id NOT NULL` và truy vấn qua `orgScope(ctx)`. CTV lọc thêm theo `event_id` được giao.

**Lời mời và CTV**

- `checker_invites(event_id, token_hash, expires_at, revoked_at)`:
  - token ngẫu nhiên 128 bit, DB chỉ lưu `token_hash`;
  - `expires_at` = min(now + 7 ngày, `effective_end_at`);
  - mỗi Sự kiện tối đa một link đang hoạt động (unique index một phần). Tạo link mới thì đặt `revoked_at` cho link cũ trong cùng transaction.
- `checkers(event_id, user_id, status active|revoked, revoked_by, revoked_at)`. Đã có bản ghi `revoked` thì nhận lời mời trả `CHECKER_REVOKED` và không kích hoạt lại.
- **Endpoint:**
  - phía BTC dưới `/v1/orgs/:orgId/events/:eventId/checker-invite`;
  - phía CTV dưới `/v1/checkin/events/:eventId/…`.

**Kiểm soát truy cập**

- `platform` định nghĩa cổng `AccessResolver` và `@RequirePermission`. `organizer` đã cài cổng cho thành viên BTC; `checkin` cài thêm cổng trả `assignedEventIds`. Guard dựng `ctx = { userId, organizationId, role, assignedEventIds, stepUpAt }`; không mô-đun nào tự truy vấn vai trò.
- Enum quyền và ma trận FR-4 khai báo một lần trong `packages/contracts`.
- Mã lỗi quyền liên quan: `NOT_A_MEMBER`, `FORBIDDEN_ROLE`, `TOTP_REQUIRED`, `CHECKER_REVOKED`, `EVENT_ENDED`. Guard TOTP toàn cục vẫn áp cho tài khoản CTV đã bật 2FA.

**Thời gian và trạng thái**

- `events.effective_end_at` = max(23:59:59 ngày kết thúc, giờ kết thúc + 6 giờ) theo `Asia/Ho_Chi_Minh`. Bấm "Kết thúc" sớm thì bằng lúc bấm, và sửa giờ sau đó không đổi giá trị này.
- Quyền CTV và check-in so `now()` với giá trị này **tại request**; job chỉ cập nhật hiển thị. "Đã kết thúc" không lưu, luôn tính ra.
- Check-in là cột `checked_in_at` trên Vé `valid`, không phải một trạng thái. Vé: `valid` → `cancelled` với `cancel_reason` `event_cancelled` | `voided`. Vé đã check-in vẫn chuyển `cancelled` khi Sự kiện bị hủy.
- Khóa Sự kiện/BTC chỉ chặn bán: Vé đã phát vẫn check-in được, trừ khi Quản trị Tingee vô hiệu.

**Mã QR vé**

- Nội dung `t<k>.<ticketId>.<sig>`, `sig` = base64url(HMAC-SHA256(key_k, `t<k>.<ticketId>`)). Khóa đánh số phiên bản trong `TICKET_QR_KEYS`; giữ khóa cũ để verify khi xoay. Vé lưu `qr_key_version`.
- Quét thì kiểm chữ ký trước. Sai thì trả `BAD_SIGNATURE` mà không truy vấn DB.
- Lúc khởi động, `qr_key_version` của Vé `valid` thuộc Sự kiện còn mở mà thiếu trong env thì chỉ log cảnh báo `ticket_qr_key_missing`, instance vẫn chạy.

**Check-in đúng một lần**

- Mọi check-in (quét hay tay) đi qua `ticketing.checkIn(tx, ticketId, eventId, userId, scanId)`. Hàm gọi `event.assertCheckinOpen(tx, eventId)` (chưa quá `effective_end_at`, chưa hủy) rồi chạy:
  `UPDATE tickets SET checked_in_at=now(), checked_in_by=:user, checkin_scan_id=:scanId WHERE id=:id AND event_id=:event AND status='valid' AND checked_in_at IS NULL`.
- **UPDATE trả 0 dòng** thì đọc lại Vé:
  - cùng `scanId` → trả lại kết quả lần đầu;
  - cùng người quét trong 60 giây → kết quả trung tính;
  - còn lại → đỏ "đã check-in lúc X bởi Y", hoặc "Vé không hợp lệ" theo lý do.
- Schema `ScanResult` nằm trong `packages/contracts`, với lý do `BAD_SIGNATURE`, `CANCELLED`, `VOIDED`, `OTHER_EVENT`, `EXPIRED`, `CHECKER_REVOKED`, `EVENT_ENDED`.
- **Chống trùng:** quét dùng `scanId` (UUID client sinh). Check-in tay là `POST` nhận `Idempotency-Key`. Cô lập READ COMMITTED; an toàn đồng thời dựa vào UPDATE có điều kiện, không dựa SERIALIZABLE.

**Bản chụp và tra tay**

- `markPaid` đã ghi lên mỗi Vé: `seq`, `order_ticket_count`, `holder_name`, `ticket_type_name`, `order_code`, `issued_at`. Kết quả quét và tra tay chỉ đọc bản chụp này, trong `orgScope` và `event_id`.
- Tra tay khớp đầy đủ sau chuẩn hóa và trả `{ticketId, holderName, ticketTypeName, seq, count, checkedIn}`.
- Giới hạn tốc độ tra tay theo user và IP, đếm trong Postgres.
- **Điểm spec 5.5 phải chốt:** SĐT (E.164) và email Người mua nằm ở bản chụp trên Đơn (`ordering`), trong khi `checkin` chỉ được gọi `ticketing` và `event`. Cần đường đọc không phá hướng phụ thuộc.

**Realtime**

- `realtime.notify(tx, 'event_checkins_changed', …)` phát trong cùng transaction với check-in. Payload chỉ có `{type, id, organizationId, eventId}`. Người được đăng ký: Owner, Admin, CTV được giao.
- **SSE theo mẫu đã có:** mỗi mô-đun mở endpoint của mình, kiểm phiên và quyền, trả `404` cho Sự kiện lạ hoặc của BTC khác trước khi mở stream, rồi đăng ký với hub bằng bộ lọc trên payload.
- Stream Tổng quan hiện có đòi `orders.view`, mà CTV không có quyền này, nên số liệu check-in cần stream mà CTV được giao cũng đăng ký được.
- Client dùng `useLiveResource`: gọi REST khi kết nối, khi nhận tín hiệu (gom trong 1 giây) và khi `visibilitychange`; mất SSE thì polling 10 giây ở dashboard. Server gửi heartbeat mỗi 25 giây và gửi `resync` sau khi `LISTEN` nối lại.

**Audit và quy ước**

- `audit.record(tx, …)` ghi trong cùng transaction, chỉ INSERT, không chứa giá trị cá nhân (chỉ id và tên trường).
- Tên action mới từ Epic 5 theo dạng `<đối tượng snake_case>.<động từ quá khứ>` (vd. `member.invited`), khai báo trong union `AuditAction`.
- **Đăng nhập:** Better Auth (Google + `emailOTP`), lựa chọn trước khi đăng nhập giữ trong `returnTo` trên URL.
- Request/response là schema Zod trong `packages/contracts`. Lỗi `{error:{code,message,details}}`. Thời gian `timestamptz`, API trả ISO 8601 có offset.
- **Kiểm thử:**
  - Vitest với Postgres thật: N request check-in song song (khác `scanId`, khác người quét) trên cùng một Vé thì đúng 1 thành công, `checked_in_at` không đổi sau lượt đầu; thử lại cùng `scanId` trả cùng kết quả;
  - Playwright gồm ca quét khi mất phản hồi.

## UX & Interaction Patterns

- **Tab Check-in (Owner/Admin):**
  - `checkin-progress` theo từng Hạng vé, realtime: tổng ở `stat-card`, mỗi Hạng vé một thanh tiến độ trên `card`;
  - link mời CTV chung: trạng thái còn hạn/hết hạn kèm thời điểm hết hạn, "Sao chép link" (luôn kèm toast "Đã sao chép"), "Tạo link mới";
  - danh sách CTV gồm tên, email, thời điểm nhận, trạng thái và nút "Thu hồi"/"Khôi phục".
- **Lối vào Màn quét:** Owner/Admin vào qua "Quét vé". Trên `bottom-tab-bar` < `md`, "Quét vé" mở Màn quét của Sự kiện đang chọn; nhiều Sự kiện đang diễn ra thì chọn Sự kiện trước `[ASSUMPTION]`.
- **Nhận lời mời:**
  - màn xem trước có tên Sự kiện, tên BTC và nút "Nhận soát vé";
  - link hết hạn, bị thu hồi hoặc sai: "Link mời đã hết hạn. Liên hệ BTC để nhận link mới.";
  - CTV bị thu hồi: "Bạn không còn quyền soát vé cho Sự kiện này."
- **Màn quét** (route group `(checkin)`, `/(checkin)/events/:eventId`):
  - toàn màn, dọc, mobile-first; không tối ưu desktop;
  - theo theme đang dùng; chỉ kết quả quét phủ màu cố định;
  - camera qua `getUserMedia`. Trước khi trình duyệt hỏi quyền có màn giải thích "Bật camera". Bị từ chối thì hiện hướng dẫn bật lại cho Safari iOS/Chrome Android kèm nút "Tra tay".
- **`scanner-viewport`:**
  - camera chạy liên tục, khung ngắm vuông;
  - đỉnh màn: tên Sự kiện + số đã check-in;
  - đáy: nút "Tra tay" ở vùng ngón cái;
  - nhận được QR thì khóa quét tới khi kết quả đóng.
- **`scan-result-overlay`** phủ toàn màn, dùng token `scan-success`/`scan-danger`:
  - xanh: icon tích tròn 96px, "Thành công", "{tên} · Vé k/N · {Hạng vé}", tiếng bíp nhẹ, tự đóng sau ~1,5 giây;
  - đỏ: icon X bát giác, có âm thanh, giữ tới khi chạm "Chạm để quét tiếp". Dòng lý do: "Mã QR vé không đúng" / "Vé đã hủy" / "Vé của Sự kiện khác"…;
  - không chỉ dựa vào màu: màu + chữ lớn + icon khác hình + âm thanh khi đỏ;
  - đọc bằng `aria-live="assertive"`; reduced motion thì hiện tức thì;
  - rung trên Màn quét chưa quyết; Safari iOS không hỗ trợ Vibration API.
- **`offline-banner`:**
  - dải cố định trên cùng, tone warning, không đóng được: "Mất kết nối — chưa quét được";
  - khung ngắm mờ 50% + "Camera tạm dừng · tự thử lại";
  - nút "Tra tay" vẫn hiện, nhưng tra tay cũng cần mạng;
  - tự ẩn khi có mạng; không tính vào giới hạn 2 banner.
- **`manual-lookup`:**
  - `Sheet` từ dưới lên, ô tìm tự focus, nhãn luôn hiện "SĐT hoặc email Người mua";
  - debounce ~200ms, dòng "N Vé khớp";
  - mỗi hàng: tên, Hạng vé · Vé k/N, `status-badge` (Hợp lệ → success, Đã check-in → neutral) và nút "Check-in". Hàng đã check-in không có nút;
  - không có kết quả: "Không tìm thấy Vé khớp.";
  - kết quả check-in tay hiện bằng cùng `scan-result-overlay`.
- **Màn hết quyền:** "Bạn không còn quyền soát vé cho Sự kiện này.", thêm "Sự kiện đã kết thúc." khi lý do là `EVENT_ENDED`. Hiện ở lượt quét kế tiếp.
- **Giọng với CTV:** mệnh lệnh ngắn, đọc trong một cái liếc ("Thành công", "Đã check-in", "Vé không hợp lệ", "Chạm để quét tiếp").
- **Ràng buộc chung:**
  - nút gọi mạng hiện spinner và chặn bấm lặp;
  - nút bị tắt luôn kèm lý do hiển thị;
  - thao tác phá hủy qua `Dialog` nêu hậu quả cụ thể; không hỏi "Bạn có chắc?" cho thao tác không phá hủy;
  - một hành động chính mỗi màn, đặt ở vùng ngón cái;
  - WCAG 2.2 AA, vùng chạm ≥ 24px, chạy tốt ở 320px.

## Cross-Story Dependencies

- **Dựa trên Epic 1–3 (đã ship):**
  - đăng nhập OTP/Google kèm `returnTo` (1.3, 1.4, 3.1);
  - `AccessResolver` của `organizer`, bộ test cách ly, audit (Epic 2);
  - `effective_end_at` và "Kết thúc" sớm (2.12);
  - Vé, bản chụp trên Vé, Mã QR vé và `TICKET_QR_KEYS` (3.5, 3.8);
  - `RealtimeHub`/`useLiveResource` (3.7) và mẫu SSE theo tài nguyên (3.11);
  - hook Screen Wake Lock (3.9).
- **Trong epic:**
  - 5.2 dùng link của 5.1 và tạo `checkers`;
  - 5.3 cần quyền CTV của 5.2 (Owner/Admin quét không cần lời mời);
  - 5.4 dựng trên `ticketing.checkIn` và overlay của 5.3;
  - 5.5 dùng cùng `ticketing.checkIn` và overlay;
  - 5.6 dựng trên danh sách CTV ở tab Check-in (5.1) và `checkers` (5.2);
  - 5.7 cập nhật tab Check-in (5.1) và số ở đỉnh Màn quét (5.3).
- **Bàn giao cho 5.3 từ retro Epic 3:**
  - thêm Screen Wake Lock cho `/xem-ve` (người nhận link chia sẻ thường là người đưa QR ở cổng) bằng hook của 3.9; chấp nhận thiếu ở MVP nếu 5.3 không kịp;
  - đọc mục bàn giao 5.3 trong `deferred-work.md` khi lập spec.
- **Epic sau:**
  - 6.2 thêm `stat-card` check-in đã vào/tổng trên Tổng quan, cập nhật qua `event_checkins_changed`;
  - 6.3 xuất cột trạng thái check-in "k/N";
  - 6.5 thêm enqueue `integration.sheet_row_changed {eventId, orderId}` vào `ticketing.checkIn` trong cùng transaction;
  - 7.1: hủy Sự kiện chuyển mọi Vé `valid` (kể cả đã check-in) sang `cancelled`, quét trả đỏ `CANCELLED`, và chặn sửa link mời CTV;
  - 7.5: Vé bị vô hiệu quét ra `VOIDED`;
  - 7.6: xóa tài khoản gỡ tư cách CTV; Vé vẫn check-in bằng mã nhưng không tra tay được;
  - 9.1 đo uptime check-in và cung cấp staging để đo p95 quét;
  - 9.2 kiểm thử tải check-in song song (vd. 20 CTV quét 300 Vé, có quét trùng: p95 < 1 giây, không Vé nào check-in hai lần).
- **Câu hỏi mở còn treo (giữ mặc định hiện tại):**
  - tra tay theo tên hoặc vài số cuối SĐT chưa được duyệt, nên chỉ tìm SĐT/email đầy đủ;
  - âm thanh/rung cho kết quả xanh: AC chọn tiếng bíp nhẹ;
  - quyền còn lại của BTC bị khóa: mặc định vẫn check-in được;
  - xem Vé khi mất mạng ở cổng: hoãn sau MVP, dựa vào tra tay.
