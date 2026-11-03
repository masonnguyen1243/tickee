# Epic 2 Context: BTC thiết lập và mở bán Sự kiện

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Owner tạo BTC, bật 2FA (tùy chọn), mời Admin, kết nối tài khoản merchant Tingee của chính BTC (Client ID + Secret Token) để chọn một hoặc nhiều tài khoản nhận tiền (có một tài khoản mặc định), và được Quản trị Tingee duyệt vào Closed Beta. Owner/Admin tạo Sự kiện, Hạng vé, form mua vé, mở bán khi đủ điều kiện và chia sẻ trang Sự kiện công khai có OG preview. Epic này dựng các nền tảng mà mọi epic sau dựa vào: guard quyền, audit, cách ly dữ liệu giữa các BTC, `publishReadiness` và nguồn trạng thái bán duy nhất `sellability`.

## Stories

- Story 2.1: Tạo BTC và khung dashboard
- Story 2.2: Xác thực hai lớp tự bật (TOTP)
- Story 2.3: Landing BTC
- Story 2.4: Mời và xóa Admin
- Story 2.5: Quản trị Tingee duyệt BTC vào Closed Beta
- Story 2.6: Liên kết tài khoản nhận tiền
- Story 2.7: Tạo Sự kiện nháp
- Story 2.8: Hạng vé và tồn kho
- Story 2.9: Cấu hình form mua vé
- Story 2.10: Điều kiện mở bán và mở bán Sự kiện
- Story 2.11: Trang Sự kiện công khai
- Story 2.12: Sửa, ẩn và kết thúc sớm Sự kiện
- Story 2.13: Đổi key Tingee và bảo vệ thao tác đổi nơi nhận tiền
- Story 2.14: Chuyển quyền Owner

## Requirements & Constraints

**Sự kiện**
- Owner và Admin đều tạo/sửa/ẩn Sự kiện. Thông tin: tên, thời gian bắt đầu/kết thúc, địa điểm, mô tả, ảnh, chính sách hoàn vé. Chính sách hoàn vé bắt buộc để mở bán (vẫn lưu nháp được khi thiếu).
- Sự kiện tự kết thúc ở mốc muộn hơn của: 23:59:59 ngày kết thúc, hoặc giờ kết thúc + 6 giờ (giờ `Asia/Ho_Chi_Minh`). Owner/Admin bấm "Kết thúc" sớm được. "Ẩn" vẫn mở được bằng link nhưng không nhận Đơn mới.
- Mọi thay đổi Sự kiện, Hạng vé, form đều ghi audit (danh sách trường đổi, không ghi giá trị PII).

**Hạng vé và tồn kho**
- Mỗi Sự kiện nhiều Hạng vé: tên, mô tả, giá, số suất, thời gian mở/đóng bán. Ngoài cửa sổ bán hiện "Chưa mở bán" / "Đã đóng bán".
- Giá lưu `bigint` theo đồng. Hạng vé có phí phải ≥ 2.000đ (giá > 0 và < 2.000 bị từ chối). Giá chốt vào Đơn lúc đặt.
- Số suất không được giảm dưới đã bán + đang Giữ chỗ.
- Sự kiện miễn phí (mọi Hạng vé 0đ): trần cứng 200 Vé mỗi Sự kiện.
- Giới hạn Vé/Đơn đặt theo Sự kiện, mặc định 10.

**Form mua vé**
- Trường mặc định: Tên, SĐT (chỉ hỏi nếu tài khoản chưa có), email (tự điền, không sửa). Câu hỏi riêng: văn bản hoặc lựa chọn, bắt buộc hoặc không, có thứ tự. Câu hỏi có id ổn định; đổi nhãn không làm hỏng câu trả lời cũ (Đơn chụp câu trả lời kèm nhãn lúc đặt).

**Điều kiện mở bán**
- Luôn cần: có chính sách hoàn vé; BTC không bị khóa.
- Chỉ khi có Hạng vé > 0đ: Closed Beta đã duyệt; BTC có ít nhất một tài khoản nhận tiền chưa hủy liên kết; giá ≥ 2.000đ. Sự kiện miễn phí không cần Closed Beta hay tài khoản nhận tiền.
- Trạng thái dịch vụ thanh toán và khóa Sự kiện không chặn mở bán, chỉ làm "Tạm ngừng bán" sau khi đã mở bán. Closed Beta bị thu hồi → Hạng vé có phí "Tạm ngừng bán", Hạng vé 0đ vẫn bán.

**Trang công khai**
- Không cần đăng nhập, mobile-first, tải < 2 giây trên 4G, "Còn N vé" chính xác, OG đúng ảnh/tên/thời gian cho Facebook/Zalo.

**Tài khoản nhận tiền (liên quan 2.10, 2.13)**
- Mỗi BTC có tối đa một credential Tingee hiện hành và một hoặc nhiều tài khoản nhận tiền; đúng một tài khoản mặc định khi còn tài khoản. Đơn mới nhận tiền vào tài khoản mặc định. Hủy liên kết là gỡ mềm; hủy hết thì BTC quay về "chưa có tài khoản nhận tiền".
- Thao tác nhạy cảm cần xác nhận lại (TOTP nếu đã bật 2FA, chưa bật thì OTP email) + email cảnh báo: đổi key Tingee, đặt mặc định, hủy liên kết tài khoản nhận tiền, chuyển quyền Owner. Chỉ Owner làm được; Admin nhận `FORBIDDEN_ROLE`.

## Technical Decisions

- **Sở hữu bảng:** mô-đun `event` sở hữu Sự kiện, Hạng vé (giá, thời gian bán), giới hạn Vé/Đơn, form mua vé, trạng thái Sự kiện, `effective_end_at`, khóa Sự kiện. `ordering` sở hữu `ticket_type_inventory`. `organizer` sở hữu `tingee_credentials` và `payout_accounts` (`is_default`, `retired_at`). Mô-đun khác chỉ gọi service công khai qua `index.ts`; dependency-cruiser kiểm trong CI.
- **Flows:** ghi chạm nhiều mô-đun đặt ở `flows/`: `flows.createTicketType` (tạo `ticket_types` + `ticket_type_inventory(capacity, sold, held)` trong một transaction, CHECK `held >= 0 AND sold >= 0 AND sold + held <= capacity`), `flows.changeCapacity` (`UPDATE … SET capacity = :c WHERE … AND sold + held <= :c`, 0 dòng → lỗi "Tối thiểu {n} — đã bán và đang giữ chỗ."), `flows.transferOwnership`. Kiểm trần 200 Vé miễn phí: khóa mọi dòng tồn kho của Sự kiện `FOR UPDATE` theo thứ tự id rồi mới cộng tổng.
- **Bảng `events`:** `organization_id NOT NULL`, slug duy nhất, `status` (`draft` → `published` ↔ `hidden`; `published`/`hidden` → `cancelled`) chuyển bằng compare-and-set. Thời gian `timestamptz`. `effective_end_at` tính lại khi sửa giờ trừ khi `ended_manually_at` đã có; "Kết thúc" đặt cả hai = thời điểm bấm. "Đã kết thúc" không lưu thành status, luôn tính từ `effective_end_at` tại request. Khóa là trục riêng (`locked_at`, `locked_by`, `lock_reason`), không đụng `status`.
- **404 thống nhất:** Sự kiện `draft` và slug sai trả cùng `404 EVENT_NOT_FOUND` ở API công khai.
- **Ảnh:** web upload thẳng lên object storage S3 bằng presigned URL do API cấp; bucket bật CORS `GET` cho origin web. Ảnh OG do `apps/web` sinh.
- **`event.publishReadiness(eventId)`** trả `[{code, satisfied}]`; lệnh mở bán gọi lại đúng hàm này ở server rồi CAS `draft` → `published`.
- **`ordering.sellability(eventId)`** là nguồn duy nhất cho trạng thái bán: trạng thái theo Hạng vé + `eventReason` (Đang bán / Chưa mở bán / Đã đóng bán / Hết vé / Tạm ngừng bán / Ẩn / Bị khóa / Đã hủy / Đã kết thúc). Xét: trạng thái và khóa Sự kiện, khóa BTC, Closed Beta và tài khoản nhận tiền (chỉ Hạng vé > 0đ), chính sách hoàn vé, cửa sổ bán, tồn kho, `payment_service_status` (chỉ Hạng vé > 0đ, mặc định `active`), giới hạn Vé/Đơn. Trang công khai và tạo Đơn (Epic 3) đều gọi hàm này.
- **Trang công khai:** SSR phần tĩnh, revalidate 30 giây và revalidate ngay khi BTC sửa Sự kiện; `GET /v1/events/:slug/availability` gọi `sellability`, cache tối đa 2 giây, gọi lúc tải và khi `visibilitychange`. Web không chạm DB, chỉ gọi REST `/v1`.
- **Banner:** `reporting.notices(scope)` là nguồn duy nhất cho `status-banner` (`{code, severity, blocking, dismissible, scope, audience, data, version}`); enum `code` và thứ tự ưu tiên ở `packages/contracts`.
- **Quyền và cách ly:** endpoint BTC dưới `/v1/orgs/:orgId/…` có `@RequirePermission`; truy vấn qua `orgScope(ctx)`; route mới tự vào bộ test cách ly. Mã lỗi `NOT_A_MEMBER`, `FORBIDDEN_ROLE`, `TOTP_REQUIRED`, `REAUTH_REQUIRED`.
- **Audit:** `audit.record(tx, …)` trong cùng transaction; `audit_events` chỉ INSERT, không chứa giá trị PII.
- **Tingee (2.13):** chỉ mô-đun `tingee` gọi Tingee, mỗi lời gọi nhận credential của BTC. Đổi key: credential mới thành hiện hành, tài khoản của credential cũ bị gỡ mềm, credential cũ giữ (mã hóa) cho IPN/Đối soát bù của Đơn đã có link (`orders.payout_account_id`); `ipnKey` không đổi. Key mới sai/Tingee lỗi thì giữ nguyên key và tài khoản cũ. VietinBank (`970415`) bị chặn với `BANK_NOT_SUPPORTED`.
- **Chuyển Owner (2.14):** một transaction, Owner cũ → `admin`, Admin được chọn → `owner`; unique index "mỗi BTC đúng một Owner" phải đúng sau commit (đổi thứ tự cập nhật hoặc ràng buộc deferrable).
- **Quy ước chung:** UUIDv7, `snake_case`, lỗi `{error:{code,message,details}}`, `POST` từ trình duyệt dùng `Idempotency-Key`, hiệu ứng phụ (email) là job pg-boss enqueue bằng chính `tx`, không gọi HTTP/email trong transaction DB.

## UX & Interaction Patterns

- **Danh sách Sự kiện:** `event-card` (thumbnail, tên, ngày-giờ, `status-badge` "Nháp"…), chạm cả hàng vào tab Tổng quan. Trống → `empty-state` "Chưa có Sự kiện nào." + "Tạo Sự kiện".
- **Wizard tạo Sự kiện** (`wizard-stepper`, 4 bước): Thông tin → Hạng vé → Form mua → Xem trước & mở bán. "Lưu nháp" ở mọi bước; quay lại không mất dữ liệu; mobile hiện "Bước 1/4 · Thông tin". Bước 4 liệt kê điều kiện thiếu kèm link sửa nhanh (vd. "Thiếu chính sách hoàn vé — chưa mở bán được." → bước 1; "Chờ duyệt Closed Beta" cho Sự kiện có phí); "Mở bán" tắt và có lý do hiển thị gần đó; mở bán xong hiện link + "Sao chép link" (toast "Đã sao chép").
- **Tabs cấp Sự kiện:** Tổng quan · Đơn · Hạng vé · Form mua · Check-in · Cài đặt.
- **Lỗi form:** hiện tại từng trường (giá ≥ 2.000đ, "Tối thiểu {n} — đã bán và đang giữ chỗ."). Sửa thời gian/địa điểm khi đã phát Vé → `Dialog` báo sẽ gửi email cho Người mua.
- **Nút:** gọi mạng → spinner trong nút, chặn bấm lặp; không disable mà không có lý do; hành động phá hủy qua `Dialog` nêu hậu quả. Không hỏi "Bạn có chắc?" cho thao tác không phá hủy.
- **Trang `/e/{slug}`:** `event-hero` dạng stage (ảnh hoặc gradient coral fallback, eyebrow, tên, ngày-giờ dạng "Chủ nhật, 16/11/2026 · 07:00 – 17:00", địa điểm chạm mở bản đồ), hàng BTC, chia sẻ bằng Web Share API (fallback sao chép). `ticket-tier-row` "Còn N vé" (≤ 10 thì `brand-text` đậm); `ticket-tier-row-unavailable` viền nét đứt. Banner trạng thái dưới stage; Người mua không thấy banner hệ thống của BTC. Desktop ≥ `lg`: 2 cột, thẻ Hạng vé dính khi cuộn. `Skeleton` khi tải. Không tìm thấy/Nháp → `empty-state` "Không tìm thấy Sự kiện này. Kiểm tra lại link BTC gửi bạn."
- **Dashboard theo vai:** Admin mở URL chỉ dành cho Owner → `empty-state` "Chỉ Owner xem được mục này."; mục chỉ Owner bị ẩn với Admin.
- **Tiền và giờ:** định dạng "300.000đ", `tabular-nums`; giao diện tiếng Việt, WCAG 2.2 AA, nhãn form luôn hiện, 320px không cuộn ngang.

## Cross-Story Dependencies

- 2.7 cần khung dashboard, guard quyền, audit và bộ test cách ly (2.1). 2.8 và 2.9 gắn vào Sự kiện của 2.7 (wizard bước 2, 3). 2.10 cần 2.7–2.9, trạng thái Closed Beta (2.5) và tài khoản nhận tiền (2.6). 2.11 cần 2.10 (`sellability`, Sự kiện `published`). 2.12 sửa lại dữ liệu của 2.7 và dùng `effective_end_at`.
- 2.13 dùng màn xác nhận lại (`REAUTH_REQUIRED`) và mở rộng 2.6 (thêm xác nhận lại cho "Đặt làm mặc định" và "Hủy liên kết"). 2.14 dùng lại bước xác nhận lại của 2.13 và cần có Admin (2.4).
- Epic 3 tạo Đơn dựa trên `sellability`, giới hạn Vé/Đơn, form mua (câu trả lời chụp kèm nhãn) và tồn kho của 2.8; tạo link thanh toán dùng tài khoản mặc định (BTC hết tài khoản → Hạng vé có phí "Tạm ngừng bán"). Story 3.10 gửi email khi 2.12 đổi giờ/địa điểm. Epic 4 thêm `payment_service_status` vào `sellability`. Epic 7 (hủy, khóa Sự kiện/BTC) dựa trên máy trạng thái và trục khóa của Sự kiện.
