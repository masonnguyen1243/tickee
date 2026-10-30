# Epic 2 Context: BTC thiết lập và mở bán Sự kiện

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Cho phép một Tài khoản Tickee tạo BTC và trở thành Owner, tự bật/tắt xác thực hai lớp (TOTP, kèm mã khôi phục), mời Admin, liên kết (và đổi) tài khoản nhận tiền qua Tingee, chuyển quyền Owner, và được Quản trị Tingee duyệt vào Closed Beta. Trên nền đó Owner/Admin tạo Sự kiện, Hạng vé, form mua vé, mở bán và chia sẻ trang Sự kiện công khai có OG preview. Epic này dựng các cơ chế mà mọi epic sau dựa vào: guard quyền (`AccessResolver` + `@RequirePermission`), guard 2FA và xác nhận lại của `identity`, audit, cách ly dữ liệu giữa các BTC (`orgScope` + bộ test cách ly), khung dashboard, nguồn trạng thái bán duy nhất (`sellability`) và nguồn banner duy nhất (`notices`).

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
- Story 2.13: Đổi tài khoản nhận tiền
- Story 2.14: Chuyển quyền Owner

## Requirements & Constraints

- Một tài khoản tạo được BTC và thành Owner; một tài khoản thuộc được nhiều BTC và chuyển qua lại; người đã thuộc BTC khác vẫn tạo được BTC mới. Mỗi BTC có đúng một Owner. Chỉ Owner mời/xóa Admin. Mọi thay đổi phân quyền ghi nhật ký.
- Ma trận quyền: chỉ Owner liên kết/đổi tài khoản nhận tiền, mời/xóa thành viên, mua Token (Admin chỉ xem Token). Owner và Admin cùng tạo/sửa/ẩn/hủy Sự kiện, xem Đơn/doanh thu/CSV/Sheets, xử lý Cần xử lý, mời/thu hồi CTV, quét và tra tay. CTV chỉ trong Sự kiện được giao.
- Cách ly: BTC này không đọc/ghi được dữ liệu BTC khác. Quản trị Tingee là ngoại lệ duy nhất xem nhiều BTC: mọi truy cập ghi audit, bắt buộc đã bật 2FA và step-up mỗi session, giới hạn theo IP (`ADMIN_ALLOWED_CIDRS`, kiểm bằng Zod; thiếu/sai ở production thì api không khởi động). Cờ `platform_admin` chỉ cấp/thu qua CLI, không có UI/API.
- 2FA (TOTP) là tính năng **tự bật/tắt cho mọi tài khoản**, không bắt buộc với ai kể cả Owner (Owner chưa bật chỉ thấy gợi ý, không bị chặn). Tài khoản chưa bật không bao giờ bị hỏi TOTP. Tài khoản đã bật phải nhập TOTP hoặc mã khôi phục sau mỗi lần đăng nhập (Google hoặc OTP email), hiệu lực tới hết session. Tắt 2FA đòi TOTP hoặc mã khôi phục hiện tại, xóa secret và mã khôi phục, email báo, audit.
- Mất cả thiết bị lẫn mã khôi phục: Quản trị Tingee (đã step-up) "Đặt lại TOTP" cho user, bắt buộc ghi lý do; hủy mọi phiên của user, 2FA về chưa bật; audit và email cho user cùng Owner/Admin các BTC liên quan.
- Thao tác nhạy cảm (đổi tài khoản nhận tiền, chuyển quyền Owner) luôn đòi xác nhận lại ngay lúc thao tác: TOTP nếu đã bật 2FA, OTP email nếu chưa; kèm email cảnh báo.
- Closed Beta: BTC mới ở "chờ duyệt"; chưa duyệt vẫn liên kết tài khoản, tạo Sự kiện nháp và miễn phí được, nhưng không bán Vé có phí. Thu hồi làm mọi Hạng vé có phí "Tạm ngừng bán", Hạng vé 0đ vẫn bán.
- Chưa liên kết tài khoản nhận tiền thì không mở bán Sự kiện có phí. Chặn VietinBank (`BANK_NOT_SUPPORTED`). Tickee không lưu số dư hay tiền của BTC.
- Sự kiện: thiếu chính sách hoàn vé thì không mở bán; "Ẩn" vẫn mở được bằng link nhưng không nhận Đơn; tự kết thúc ở mốc muộn hơn của 23:59 ngày kết thúc và giờ kết thúc + 6 giờ; "Kết thúc" sớm được. Mọi thay đổi Sự kiện ghi audit kèm danh sách trường đổi.
- Hạng vé: giá có phí ≥ 2.000đ; số suất không giảm dưới đã bán + đang giữ; Sự kiện miễn phí trần cứng 200 Vé; giới hạn Vé/Đơn mặc định 10.
- Trang Sự kiện công khai: không cần đăng nhập, tải dưới 2 giây trên 4G, "Còn N vé" chính xác, OG đúng ảnh/tên/thời gian khi chia sẻ Facebook/Zalo.
- Tiền `bigint` theo đồng; mọi mốc thời gian `timestamptz`.

## Technical Decisions

- **Sở hữu mô-đun:** `organizer` sở hữu `organizations`, `members` (role `owner`/`admin`), Merchant con và trạng thái liên kết, `closed_beta_status`, `payment_service_status`, ngưỡng Token, khóa BTC, kênh liên hệ BTC. `event` sở hữu Sự kiện, Hạng vé, giới hạn Vé/Đơn, form, `effective_end_at`. `ordering` sở hữu `ticket_type_inventory` và `sellability`. `identity` sở hữu 2FA/TOTP, step-up, mã khôi phục, xác nhận lại. `tingee` là adapter duy nhất gọi Tingee, không sở hữu bảng. Hướng phụ thuộc: `organizer → identity, tingee`; `event → organizer`; `ordering → event, organizer, tingee`; `reporting` chỉ đọc qua read model.
- **Kiểm soát truy cập:** `platform` khai báo cổng `AccessResolver` và decorator `@RequirePermission(perm)`; `organizer` (và sau này `checkin`) cài đặt cổng, đăng ký lúc khởi động. Guard dựng `ctx = { userId, organizationId, role, assignedEventIds, stepUpAt }` trước controller; không mô-đun nào tự truy vấn vai trò. Enum quyền và ma trận khai báo một lần trong `packages/contracts`. Endpoint BTC dưới `/v1/orgs/:orgId/…`; endpoint CTV dưới `/v1/checkin/events/:eventId/…`. Mã lỗi quyền: `NOT_A_MEMBER`, `FORBIDDEN_ROLE`, `TOTP_REQUIRED`, `REAUTH_REQUIRED`, `CHECKER_REVOKED`, `EVENT_ENDED`. `GET /v1/me/memberships` trả vai trò ở từng BTC.
- **2FA (TOTP):** Better Auth `twoFactor` với `allowPasswordless: true`, cờ `users.two_factor_enabled`. Step-up do `identity` tự dựng (Better Auth không hỏi TOTP khi đăng nhập Google/OTP), ghi `sessions.step_up_at`. Luật `TOTP_REQUIRED` nằm ở **guard toàn cục của `identity` chạy ngay sau `SessionGuard`, không nằm trong `PermissionGuard`**: áp cho mọi request ngoài danh sách miễn khi user đã bật 2FA và `step_up_at` rỗng; hiệu lực hết session (không có mốc 12 giờ). Danh sách miễn (nhập mã, dùng mã khôi phục, đăng xuất, `GET /v1/identity/me`) khai báo một chỗ trong `packages/contracts` và có test. Bật 2FA: session hiện tại coi như đã qua lớp hai, các session khác phải nhập mã ở request kế tiếp. 10 mã khôi phục dùng một lần, DB chỉ lưu hash; dùng mã khôi phục thì gỡ 2FA cũ, đưa về trang Bảo mật để bật lại. Sai 5 lần liên tiếp khóa xác minh 15 phút theo user, ghi audit. Tắt 2FA là endpoint riêng.
- **Xác nhận lại (`REAUTH_REQUIRED`):** `identity` cấp một lần xác nhận ngắn hạn, dùng một lần, hiệu lực 5 phút, sau khi nhập TOTP (đã bật 2FA) hoặc OTP email (chưa bật). Không dùng `step_up_at` cho việc này.
- **Một Owner:** unique index một phần `members(organization_id) WHERE role='owner'`. Chuyển quyền Owner chạy trong `flows.transferOwnership` một transaction; phải giữ index đúng sau commit (đổi thứ tự cập nhật hoặc ràng buộc deferrable).
- **Cách ly BTC:** mọi bảng thuộc BTC có `organization_id NOT NULL`; truy vấn trong request đi qua `orgScope(ctx)`. Chỉ bốn đường đọc chéo có tên: `buyerScope`, `shareScope`, `systemScope`, `platformAdminScope` (mỗi lần dùng ghi audit). Bộ test cách ly trong CI tự duyệt mọi route có `@RequirePermission`, nên route mới tự động được kiểm. RLS Postgres hoãn sau MVP.
- **Audit:** `audit.record(tx, …)` trong cùng transaction với thay đổi; ghi actor, `organization_id` (nullable cho thao tác nền tảng), hành động, đối tượng, danh sách tên trường đổi — không ghi giá trị PII. `audit_events` chỉ INSERT; role `tickee_app` không có UPDATE/DELETE trên bảng này.
- **Luồng nhiều mô-đun ở `flows/`:** `createTicketType` (tạo `ticket_types` + `ticket_type_inventory(capacity, sold, held)` có `CHECK (held >= 0 AND sold >= 0 AND sold + held <= capacity)`), `changeCapacity` (UPDATE có điều kiện `sold + held <= :c`), `transferOwnership`. Kiểm trần 200 Vé miễn phí khóa mọi dòng tồn kho của Sự kiện `FOR UPDATE` theo thứ tự id.
- **Không gọi ngoài trong transaction:** liên kết/đổi tài khoản gọi Tingee ngoài transaction DB. Email (mời Admin, tắt 2FA, dùng mã khôi phục, đặt lại TOTP, cảnh báo đổi tài khoản, báo chuyển quyền) là job pg-boss enqueue bằng chính `tx` (`fromDrizzle(tx)`), payload chỉ id, handler idempotent, hết retry vào dead-letter. Token lời mời ngẫu nhiên, DB lưu hash, có hạn.
- **Adapter Tingee:** ký request (thời gian `yyyyMMddHHmmssSSS` UTC+7), secret chỉ từ env, timeout có giới hạn, đổi mã lỗi Tingee thành lỗi miền (`BANK_NOT_SUPPORTED`, `MERCHANT_SUSPENDED`), đổi giờ UTC+7 sang `timestamptz`. Test tự động dùng `apps/api/test/tingee-fake` (trừ test hợp đồng). Đổi tài khoản: Merchant con mới chỉ áp dụng cho Đơn tạo sau; Merchant con cũ giữ lại, không xóa.
- **Máy trạng thái Sự kiện:** `draft → published ↔ hidden`, `published/hidden → cancelled`, compare-and-set. "Đã kết thúc" không lưu, tính từ `effective_end_at` (theo `Asia/Ho_Chi_Minh`) tại thời điểm request; có `ended_manually_at`. Khóa là trục riêng (`locked_at`, `locked_by`, `lock_reason` trên `events` và `organizations`). Sự kiện nháp và slug sai trả cùng `404 EVENT_NOT_FOUND`. Slug duy nhất.
- **Nguồn sự thật duy nhất:** `event.publishReadiness(eventId)` trả `[{code, satisfied}]` (chính sách hoàn vé, BTC không bị khóa; với Hạng vé > 0đ: Closed Beta đã duyệt, đã liên kết tài khoản, giá ≥ 2.000đ); lệnh mở bán gọi lại đúng hàm này ở server. `ordering.sellability(eventId)` là nguồn duy nhất cho trạng thái bán theo Hạng vé + `eventReason`. `reporting.notices(scope)` là nguồn duy nhất cho `status-banner`, trả `[{code, severity, blocking, dismissible, scope, audience, data, version}]`; enum `code` và thứ tự ưu tiên trong `packages/contracts`, web chỉ ánh xạ `code` sang nội dung.
- **Ảnh và trang công khai:** ảnh Sự kiện upload thẳng S3 bằng presigned URL do API cấp (bucket bật CORS `GET` cho origin web). `/e/{slug}` SSR có cache (revalidate 30 giây, revalidate ngay khi BTC sửa); `GET /v1/events/:slug/availability` cache tối đa 2 giây, gọi lúc tải và khi `visibilitychange`. Ảnh OG do `apps/web` sinh.
- **Form mua:** câu hỏi riêng có id ổn định; câu trả lời của Đơn sẽ chụp kèm nhãn lúc đặt nên sửa nhãn không làm hỏng Đơn cũ.

## UX & Interaction Patterns

- **Khung dashboard (route group `(dashboard)`):** ≥ `lg` `dashboard-sidebar` nền stage, BTC switcher (avatar + tên + chevron, `DropdownMenu`) ở đầu, mục đang chọn có thanh coral 3px; nhóm mục cấp BTC: Sự kiện · Cần xử lý · Token · Thành viên · Tài khoản nhận tiền · Cài đặt. `md`–`lg` sidebar thu thành icon. < `md` `bottom-tab-bar` (Sự kiện · Cần xử lý · Quét vé · Thêm → `Sheet` chứa Token, Thành viên, Tài khoản nhận tiền, Cài đặt, BTC switcher). Mục chỉ dành cho Owner bị **ẩn** với Admin (không hiện rồi khóa). Tabs cấp Sự kiện: Tổng quan · Đơn · Hạng vé · Form mua · Check-in · Cài đặt (shadcn `Tabs`, gạch chân không dùng coral).
- **BTC switcher:** đổi BTC → về danh sách Sự kiện của BTC đó; cuối danh sách có "Tạo BTC mới". Danh sách Sự kiện trống: `empty-state` "Chưa có Sự kiện nào." + "Tạo Sự kiện"; có Sự kiện thì mỗi mục là `event-card` chạm cả hàng.
- **Tạo BTC:** nhập tên (và kênh liên hệ BTC); lỗi tại chỗ + "Thử lại", giữ dữ liệu đã nhập. Tạo xong hiện banner "Chờ duyệt Closed Beta".
- **Trạng thái dashboard:** Admin mở URL dành cho Owner → `empty-state` "Chỉ Owner xem được mục này." + nút về Tổng quan. Bị xóa khỏi BTC giữa phiên → `Dialog` "Bạn không còn là thành viên của {BTC}." rồi chuyển BTC khác hoặc Vé của tôi. Banner: tối đa 2, còn lại gộp "+N thông báo" mở `Sheet`; banner chặn bán/danger không đóng được.
- **Gợi ý 2FA cho Owner:** Owner chưa bật 2FA thấy thẻ gợi ý đóng được trên danh sách Sự kiện: "Bật xác thực hai lớp để bảo vệ tài khoản nhận tiền." + "Bật ngay" → Bảo mật tài khoản. Không chặn thao tác; không dùng `status-banner` (không đi qua `notices`).
- **Bảo mật tài khoản (menu Tài khoản, dùng chung mọi vai):** bật 2FA = mã QR + khóa nhập tay (nhóm 4 ký tự, chỉ xuống dòng giữa các nhóm) + ô mã 6 số; đúng → màn 10 mã khôi phục với "Tải xuống", "Sao chép", checkbox "Tôi đã lưu mã khôi phục" mở "Xong". Tắt 2FA qua `Dialog` nêu hậu quả "Tài khoản chỉ còn được bảo vệ bằng email." + ô TOTP hoặc mã khôi phục → toast "Đã tắt xác thực hai lớp". Vừa dùng mã khôi phục → `status-banner` warning "Xác thực hai lớp cũ đã được gỡ. Bật lại với thiết bị mới."
- **Nhập mã sau đăng nhập:** API trả `TOTP_REQUIRED` ở bất kỳ trang nào → `Dialog` "Xác thực hai lớp": mã 6 số, link "Dùng mã khôi phục", nút "Đăng xuất"; đúng → tự thử lại thao tác dở; sai → lỗi tại ô, không mất thao tác; bị khóa → "Thử lại sau N phút".
- **Xác nhận lại:** API trả `REAUTH_REQUIRED` (đổi tài khoản nhận tiền, chuyển quyền Owner) → `Dialog` "Xác nhận để tiếp tục": đã bật 2FA → mã TOTP; chưa bật → "Gửi mã tới {email}" + ô OTP; đúng → thực hiện thao tác, giữ dữ liệu đã nhập.
- **Wizard tạo Sự kiện:** 4 bước (Thông tin → Hạng vé → Form mua → Xem trước & mở bán), "Lưu nháp" ở mọi bước, quay lại không mất dữ liệu, mobile "Bước 2/4 · Hạng vé". Bước 4 liệt kê điều kiện thiếu kèm link sửa nhanh; "Mở bán" tắt kèm lý do hiển thị; mở bán xong có link + "Sao chép link" (toast "Đã sao chép").
- **Lỗi tại trường:** "Tối thiểu {n} — đã bán và đang giữ chỗ.", giá < 2.000đ. Hành động phá hủy qua `Dialog` nêu hậu quả cụ thể; chuyển quyền Owner yêu cầu gõ tên BTC.
- **Trang Sự kiện công khai:** `event-hero` dạng stage, `ticket-tier-row` ("Còn N vé", ≤ 10 vé chữ `brand-text` đậm) và biến thể unavailable; `status-banner` dưới stage cho Tạm ngừng bán/Ẩn/Bị khóa/Đã hủy/Đã kết thúc; desktop 2 cột thẻ Hạng vé dính; `Skeleton` khi tải; 404 dùng `empty-state` không có nút khám phá.
- **Landing `/`:** `landing-hero` + 4 `value-tile`; CTA "Đăng ký Closed Beta" → đăng nhập với `returnTo` = màn tạo BTC (đã đăng nhập chưa có BTC thì vào thẳng); đã có BTC thì CTA "Vào dashboard".
- **Quản trị Tingee:** desktop, shadcn mặc định; hàng duyệt Closed Beta với Duyệt/Thu hồi qua `Dialog` nêu hậu quả; trống → "Không có BTC chờ duyệt."; thao tác "Đặt lại TOTP" cho một user, lý do bắt buộc.

## Cross-Story Dependencies

- Story 2.1 là tiền đề của cả epic: guard quyền, `orgScope`, audit, bộ test cách ly, `GET /v1/me/memberships` và khung dashboard được mọi story sau dùng. Route mới ở các story sau phải mang `@RequirePermission` để tự rơi vào bộ test cách ly.
- 2.2 thêm guard `TOTP_REQUIRED` toàn cục của `identity` (sau `SessionGuard`, tách khỏi `PermissionGuard` của 2.1), điền `stepUpAt`, trang Bảo mật tài khoản và thẻ gợi ý trên dashboard của 2.1. 2.5 dùng 2FA/step-up của 2.2 cho Quản trị Tingee và nhận thao tác "Đặt lại TOTP". 2.13 dựng cơ chế `REAUTH_REQUIRED` (TOTP của 2.2 hoặc OTP email của Epic 1); 2.14 dùng lại xác nhận lại của 2.13 và cần Admin từ 2.4.
- 2.3 dẫn vào màn tạo BTC của 2.1 qua `returnTo` của Epic 1.
- 2.5 dựng `reporting.notices` mà 2.6, 2.10 và các epic sau dùng cho banner. 2.6 dựng adapter `tingee` + Tingee fake; 2.13 dùng lại form và quy tắc của 2.6.
- 2.7 → 2.8 → 2.9 → 2.10 nối theo wizard; 2.10 cần trạng thái Closed Beta (2.5) và liên kết tài khoản (2.6). 2.11 dùng `sellability` của 2.10; 2.12 dùng máy trạng thái và `effective_end_at` của 2.7.
- Phụ thuộc Epic 1: session/`identity` của Better Auth, OTP email, dạng lỗi và `packages/contracts`, component dùng chung (`empty-state`, `status-banner`, `status-badge`, nút, toast).
- Epic sau dựa vào: Epic 3 (Checkout, Giữ chỗ, `markPaid`) dùng `ticket_type_inventory`, `sellability`, Merchant con hiện hành; Epic 4 dùng `payment_service_status`; Epic 5 cài `AccessResolver` cho `checkin`; Epic 7 dùng khóa BTC/Sự kiện và từ chối xóa tài khoản khi đang là Owner.
- Phụ thuộc ngoài: API Master Merchant/liên kết tài khoản của Tingee (test hợp đồng ở staging); object storage S3 cho ảnh Sự kiện.
