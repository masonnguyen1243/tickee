---
status: final
stepsCompleted: [step-01-validate-prerequisites, step-02-design-epics, step-03-create-stories, step-04-final-validation]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-tickee-2026-10-27/prd.md
  - _bmad-output/planning-artifacts/prds/prd-tickee-2026-10-27/addendum.md
  - _bmad-output/planning-artifacts/architecture/architecture-tickee-2026-10-28/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-tickee-2026-10-27/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-tickee-2026-10-27/EXPERIENCE.md
---

# Tickee - Epic Breakdown

## Overview

Tài liệu này chia toàn bộ epic và story của Tickee MVP v1. Nguồn là các yêu cầu trong PRD, UX Design (DESIGN.md + EXPERIENCE.md) và Architecture Spine. Mỗi story phải đủ cụ thể để Dev agent implement được.

**Thứ tự hiệu lực khi các nguồn khác nhau:** Architecture Spine (28/10) được viết sau PRD và UX (27/10), và đã chủ động thay đổi một số điểm. Hai thay đổi chính là chuyển sang **Tingee Payment Gateway (redirect)** thay cho QR động/tĩnh tự render, và **chặn liên kết VietinBank**. Khi PRD hoặc UX mâu thuẫn với Architecture về cơ chế kỹ thuật, story theo Architecture. Hành vi sản phẩm không bị Architecture đổi thì vẫn theo PRD/UX. Các điểm bị thay đổi được ghi ở mục "Điều chỉnh do Architecture" bên dưới.

## Requirements Inventory

### Functional Requirements

**4.1 Tài khoản và phân quyền**

- FR-1: Người dùng đăng ký/đăng nhập Tài khoản Tickee bằng Google hoặc OTP qua email (BTC đăng ký bằng email). OTP dùng một lần, hiệu lực 5 phút, tối đa 5 lần nhập sai. Không có đăng nhập bằng mật khẩu hay SĐT. Owner bắt buộc bật 2FA. Cùng một email luôn ra cùng một Tài khoản Tickee.
- FR-2: Một Tài khoản Tickee tạo được BTC và trở thành Owner. Chỉ Owner được mời/xóa Admin. Một tài khoản có thể thuộc nhiều BTC và chuyển qua lại giữa chúng. Mọi thay đổi phân quyền được ghi nhật ký.
- FR-3: Người mua xem trang Sự kiện không cần đăng nhập. Khi bấm "Mua", hệ thống bắt đăng nhập rồi đưa về đúng Hạng vé và số lượng đã chọn. Email trong form được tự điền. Đồng ý xử lý dữ liệu cá nhân theo NĐ 13/2023 khi tạo tài khoản. Checkout ghi rõ thông tin trong form sẽ được chia sẻ cho BTC.
- FR-38: Người dùng xóa được Tài khoản Tickee hoặc rút lại đồng ý xử lý dữ liệu. Sau khi xóa thì không đăng nhập được nữa và không còn xuất hiện trong dữ liệu Người mua của các Sự kiện sắp diễn ra. Dữ liệu giao dịch mà pháp luật bắt buộc lưu được giữ ở dạng tối thiểu. Hệ thống cảnh báo trước nếu tài khoản còn Vé hợp lệ của Sự kiện chưa diễn ra.
- FR-4: Ma trận phân quyền Owner/Admin/CTV/Người mua theo bảng PRD §4.1. Quản trị Tingee là ngoại lệ duy nhất xem được dữ liệu nhiều BTC: mọi lần truy cập đều ghi nhật ký, bắt buộc 2FA, giới hạn theo IP. BTC không đọc được dữ liệu của BTC khác. CTV chỉ thấy dữ liệu check-in của Sự kiện được giao.

**4.2 Liên kết tài khoản nhận tiền**

- FR-5: Owner liên kết tài khoản nhận tiền của BTC qua Tingee, hệ thống tạo Merchant con. BTC chưa liên kết thì không mở bán được Sự kiện có phí (Sự kiện miễn phí không cần). Tickee không lưu số dư hay tiền của BTC.
- FR-6: *(Ngoài Closed Beta, trước khi mở công khai)* KYC BTC qua Tingee. Story không làm trong MVP, chỉ ghi để truy vết.
- FR-37: BTC chỉ bán được Vé có phí sau khi Quản trị Tingee duyệt vào Closed Beta. Khi chưa được duyệt, BTC vẫn đăng ký, liên kết tài khoản và tạo Sự kiện nháp/miễn phí được. Dashboard hiện "Chờ duyệt Closed Beta". Thu hồi trạng thái này làm mọi Sự kiện có phí của BTC chuyển "Tạm ngừng bán". Mọi lần duyệt và thu hồi đều ghi nhật ký.

**4.3 Sự kiện, Hạng vé, form mua vé**

- FR-7: Owner/Admin tạo, sửa, ẩn, hủy Sự kiện (tên, thời gian bắt đầu/kết thúc, địa điểm, mô tả, ảnh, chính sách hoàn vé). Thiếu chính sách hoàn vé thì không mở bán được. Sự kiện "Ẩn" vẫn mở được bằng link nhưng không nhận Đơn mới. Sửa thời gian hoặc địa điểm sau khi đã phát Vé thì gửi email cho Người mua. Mọi thay đổi được ghi nhật ký. Sự kiện tự kết thúc vào mốc muộn hơn của hai mốc: 23:59 ngày kết thúc, hoặc giờ kết thúc + 6 giờ. Owner/Admin bấm "Kết thúc" sớm được. Trước mốc này, check-in vẫn hoạt động.
- FR-8: Mỗi Sự kiện có nhiều Hạng vé (tên, giá, số suất, thời gian mở/đóng bán). Ngoài thời gian bán, Hạng vé hiện "Chưa mở bán" hoặc "Đã đóng bán". Số suất không được giảm dưới số đã bán + số đang Giữ chỗ. Giá được chốt vào Đơn lúc đặt.
- FR-9: Owner/Admin cấu hình form mua vé gồm trường mặc định (Tên, SĐT nếu tài khoản chưa có, email tự điền), câu hỏi riêng (văn bản hoặc lựa chọn, bắt buộc hoặc không) và trường bổ sung. Form điền một lần cho mỗi Đơn. Còn trường bắt buộc trống thì không gửi được. Câu trả lời hiện ở danh sách Đơn, CSV và Sheets.
- FR-10: Trang Sự kiện công khai không cần đăng nhập, tối ưu cho điện thoại, tải dưới 2 giây trên 4G. Chia sẻ lên Facebook/Zalo hiện đúng ảnh, tên và thời gian (OG). Mỗi Hạng vé hiện số chỗ còn lại chính xác hoặc "Hết vé".
- FR-11: Sự kiện miễn phí (mọi Hạng vé 0đ): không thanh toán, không tiêu Token, vẫn bắt đăng nhập, phát Vé ngay khi gửi Đơn. Trần cứng 200 Vé mỗi Sự kiện.

**4.4 Checkout và Giữ chỗ**

- FR-12: Một Đơn có thể gồm nhiều Vé thuộc nhiều Hạng vé. Giới hạn Vé/Đơn do BTC đặt cho từng Sự kiện, mặc định 10. Tổng tiền bằng tổng giá đã chốt.
- FR-13: Với mỗi Hạng vé, số đã bán + số đang Giữ chỗ không bao giờ vượt số suất. Đơn nhiều Hạng vé được Giữ chỗ theo kiểu được hết hoặc không được gì, và báo rõ Hạng vé nào hết. Điều này vẫn đúng khi 5.000 người cùng mua một Sự kiện 300 Vé.
- FR-14: Giữ chỗ 15 phút có đếm ngược. Hết hạn mà chưa trả tiền thì chỗ được trả lại, Đơn chuyển "Hết hạn", mời Người mua tạo Đơn mới. Nếu tiền về muộn: Hạng vé còn chỗ thì phát Vé, hết chỗ thì Đơn vào "Cần xử lý" loại Thanh toán mồ côi (báo BTC, gửi email cho Người mua). Không bao giờ phát Vé vượt số suất.
- FR-15: Chỉ tạo thanh toán khi BTC còn đủ Token và dịch vụ chưa bị ngắt. Khi không đủ thì trang Sự kiện hiện "Tạm ngừng bán". Sự kiện miễn phí không bị ảnh hưởng. *(Architecture: phát hiện qua trạng thái dịch vụ thanh toán khi tạo link, xem AD-32.)*
- FR-16: Người mua thanh toán đúng số tiền của Đơn. Trang thanh toán ghi "Tiền chuyển thẳng cho [tên BTC]" và hiện chính sách hoàn vé. Tạo thanh toán dưới 2 giây. *(Architecture: dùng link Tingee Payment Gateway, redirect toàn trang, xem AD-6.)*
- FR-17: Thanh toán khi BTC chỉ có QR tĩnh: Giữ chỗ 15 phút, tiền về muộn xử lý như FR-14. *(Architecture: Gateway tự khớp, Tickee không tự đối soát theo nội dung chuyển khoản, xem AD-6.)*
- FR-18: Khi Đơn được thanh toán, màn của Người mua tự chuyển sang "Thành công" và hiện mọi Vé, không cần reload. Từ lúc nhận IPN đến lúc Vé hiện trên trình duyệt dưới 3 giây.

**4.5 Thanh toán và đối soát**

- FR-19: Nhận IPN, xác thực chữ ký, khớp mã Đơn và số tiền thực nhận rồi phát Vé. Chỉ phát Vé khi số tiền khớp đúng. Mỗi giao dịch chỉ xử lý một lần: IPN lặp không phát thêm Vé, không gửi thêm email. IPN sai chữ ký bị từ chối và ghi lại. Ghi thanh toán, phát Vé và lên lịch gửi email diễn ra trọn gói hoặc không diễn ra gì.
- FR-20: Đối soát bù: khi IPN trễ hoặc mất, và khi BTC được mở lại dịch vụ, hệ thống chủ động hỏi Tingee rồi phát Vé bù, theo cùng quy tắc chỉ xử lý một lần.
- FR-21: Hàng "Cần xử lý" chứa Lệch số tiền, Thanh toán mồ côi, Giao dịch chưa khớp *(Architecture thêm: `event_cancelled`, `duplicate_payment`)*. Owner/Admin ghép tay, duyệt tay phát Vé (chỉ khi còn chỗ), từ chối, hoặc đánh dấu "Đã hoàn tay". Mọi thao tác ghi nhật ký. Dashboard hiện số mục đang chờ.

**4.6 Vé và gửi Vé**

- FR-22: Mỗi Vé có Mã QR vé riêng được ký số; Đơn N Vé có N mã check-in độc lập. Người mua xem mọi Vé trong "Vé của tôi" và chia sẻ từng Vé bằng link hoặc ảnh. Không có chuyển nhượng Vé sang tài khoản khác. Người mua không tra được Vé theo SĐT.
- FR-23: Gửi Vé qua email (kèm Vé hoặc link). Gửi lỗi thì tự thử lại, Vé vẫn hợp lệ. Cuối email có dòng giới thiệu Tickee.
- FR-24: Sau mốc Sự kiện kết thúc, Vé rời "Vé của tôi". Người mua chỉ còn thấy lịch sử (tên Sự kiện, ngày, đã check-in hay chưa). Dữ liệu phía BTC vẫn còn cho báo cáo.
- FR-25: *(Should)* Tải ảnh Social Ticket Card để đăng Story. Ảnh không chứa Mã QR vé hay bất kỳ thông tin nào dùng để check-in được.

**4.7 Check-in**

- FR-26: Owner/Admin tạo link mời CTV cho một Sự kiện. CTV phải đăng nhập để nhận lời mời. CTV đã nhận chỉ thấy màn check-in của Sự kiện đó. Quyền CTV tự hết ở mốc Sự kiện kết thúc. BTC thu hồi được bất kỳ lúc nào, có hiệu lực ngay ở lượt quét kế tiếp. Link mời có thời hạn và thu hồi được.
- FR-27: Quét Mã QR vé bằng camera trình duyệt. Xanh: "thành công" + tên Người mua · Vé k/N · Hạng vé. Đỏ có âm thanh: Vé đã check-in (kèm giờ và người quét lần trước), hoặc "vé không hợp lệ" (sai chữ ký, Vé đã hủy, Vé của Sự kiện khác). Không bao giờ hiện Mã QR vé. Kết quả hiện dưới 1 giây.
- FR-28: Mỗi Vé chỉ check-in thành công một lần, kể cả khi nhiều CTV quét cùng lúc: một người thấy xanh, người kia thấy đỏ kèm thông tin lượt trước.
- FR-29: CTV/Owner/Admin tra Vé theo SĐT hoặc email của Người mua rồi check-in tay. Kết quả chỉ có tên, Hạng vé và trạng thái check-in, không có Mã QR vé. CTV chỉ tra được trong Sự kiện được giao. Check-in tay cũng tuân theo quy tắc một lần và ghi lại người thực hiện.
- FR-30: Owner/Admin xem số đã check-in trên tổng số Vé, theo từng Hạng vé, cập nhật thời gian thực.

**4.8 Dashboard, dữ liệu, Token**

- FR-31: Dashboard theo từng Sự kiện: doanh thu (chỉ tính Đơn "Đã thanh toán"), số Vé theo Hạng vé, danh sách Đơn kèm câu trả lời form, xuất CSV có đủ các trường của danh sách.
- FR-32: Đồng bộ Google Sheets một chiều: mỗi Đơn một dòng, cập nhật trạng thái thanh toán và check-in trong vòng 1 phút. Ghi lỗi thì tự thử lại. Mất quyền thì dashboard báo kết nối lại. Không ghi đè cột do BTC tự thêm.
- FR-33: *(Should)* Hủy Sự kiện: ngừng bán, vô hiệu mọi Vé, gửi email cho mọi Người mua, xuất danh sách cần hoàn tiền (Người mua, SĐT, email, số tiền đã trả, mã Đơn). BTC hoàn tiền ngoài hệ thống rồi đánh dấu "Đã hoàn tay".
- FR-34: Owner xem số dư Token và hạn mức (đọc trực tiếp từ Tingee, không lưu), đặt ngưỡng cảnh báo, bấm "mua thêm Token" để sang luồng của Tingee. Admin chỉ xem. Khi Token xuống dưới ngưỡng, Owner nhận cảnh báo qua email và trên dashboard.

**4.9 Niềm tin và an toàn**

- FR-35: Người mua báo cáo Sự kiện kèm lý do. Quản trị Tingee xem báo cáo, khóa/mở khóa Sự kiện hoặc BTC. Sự kiện hay BTC bị khóa thì ngừng nhận Đơn ngay. Vé đã phát vẫn hợp lệ, trừ khi Quản trị Tingee chọn vô hiệu. Có danh sách báo cáo và lịch sử khóa. Mọi thao tác ghi nhật ký.

**4.10 Lan truyền**

- FR-36: *(Could)* Dòng giới thiệu Tickee kèm link `/` ở trang Sự kiện và email Vé.

### NonFunctional Requirements

- NFR-1 (Hiệu năng): Trang Sự kiện tải dưới 2 giây trên 4G. Tạo link/QR thanh toán dưới 2 giây.
- NFR-2 (Hiệu năng): Từ lúc nhận IPN đến lúc Vé hiện trên trình duyệt dưới 3 giây. Quét check-in phản hồi dưới 1 giây.
- NFR-3 (Chịu tải): 5.000 người cùng mua một Sự kiện 300 Vé mà không bán quá số suất. Phòng chờ đang hoãn; tạm dựa vào giới hạn tốc độ và cache trang (AD-31, AD-37).
- NFR-4 (Sẵn sàng): Uptime 99,9%/tháng cho Checkout, IPN và check-in.
- NFR-5 (Toàn vẹn): Ghi thanh toán, phát Vé và lên lịch email/Sheets diễn ra trọn gói hoặc không diễn ra gì. Có PITR (RPO ≤ 5 phút, RTO ≤ 1 giờ).
- NFR-6 (Bảo mật): HTTPS toàn bộ. Request tới Tingee và IPN đều có chữ ký được xác thực. Mã QR vé được ký số. Owner bắt buộc 2FA.
- NFR-7 (Cách ly): BTC này không đọc được dữ liệu BTC khác. CTV chỉ đọc dữ liệu check-in của Sự kiện được giao.
- NFR-8 (Dữ liệu cá nhân): Thu đồng ý theo NĐ 13/2023. Không lưu thông tin ngân hàng của Người mua. Dữ liệu Người mua chỉ dùng cho Sự kiện họ mua. Log che SĐT/email.
- NFR-9 (Khả dụng): Mobile-first, chạy trên Safari iOS và Chrome Android bản hiện hành, giao diện tiếng Việt.
- NFR-10 (Giám sát): Cảnh báo khi IPN lỗi, khi tỉ lệ phát Vé giảm bất thường, khi hàng đợi email/Sheets ùn hoặc có dead-letter, khi Đơn pending quá hạn chưa xác nhận, khi p95 tạo link > 2 giây.
- NFR-11 (Kiểm toán): Ghi nhật ký mọi thay đổi Sự kiện, phân quyền, xử lý Đơn tay và thao tác của Quản trị Tingee.
- NFR-12 (Dữ liệu tiền): Tiền lưu dạng số nguyên theo đồng (`bigint`). Mọi mốc thời gian có múi giờ (`timestamptz`).

### Additional Requirements

**Nền móng dự án (ảnh hưởng Epic 1 Story 1).** Architecture không chọn starter template có sẵn mà quy định một **Structural Seed** cần dựng từ đầu:

- Monorepo Turborepo + pnpm 12.15: `apps/web` (Next.js 16.4, React 19.3, Tailwind 4.3, shadcn/ui, TanStack Query 5), `apps/api` (NestJS 12.3, một image chạy 3 vai `api` | `worker` | `migrate` theo env), `packages/contracts` (schema Zod 4, mã lỗi, quyền, topic, queue, notices, danh mục thông báo, cột PII).
- Node 26 LTS, TypeScript 6.0. PostgreSQL 18.6, Drizzle ORM 0.45 + drizzle-kit 0.31, `pg` 8.23, pg-boss 12.38. Better Auth 1.7 + `@thallesp/nestjs-better-auth` 2.8. pino/`nestjs-pino`, OpenTelemetry, `@googleapis/sheets`, `@aws-sdk/client-s3`, nodemailer, dependency-cruiser, Vitest 5, Playwright 1.64. Phiên bản đầy đủ ở bảng Stack của Architecture.
- `docker-compose.yml` cho local: Postgres 18, Mailpit. Thư mục `apps/api/test/tingee-fake`.
- Cấu trúc mô-đun `apps/api/src/modules/{identity, organizer, event, ordering, payment, ticketing, checkin, reporting, integration, admin, tingee}`, cùng `flows/` và `platform/` (db + tx, access, audit, jobs, realtime, config, logging).

**Quy tắc kiến trúc phải tuân thủ trong mọi story:**

- AD-10: mỗi bảng có đúng một mô-đun sở hữu và chỉ mô-đun đó ghi. Mô-đun khác gọi service công khai qua `index.ts`, hoặc đọc read model (AD-33). CI kiểm hướng phụ thuộc bằng dependency-cruiser.
- AD-11: `apps/web` không chạm DB, chỉ gọi REST `/v1`.
- AD-25: luồng ghi chạm nhiều mô-đun nằm ở `flows/` (`createTicketType`, `changeCapacity`, `cancelEvent`, `lockEvent`/`lockOrganization`, `voidTickets`, `deleteAccount`, `acceptCheckerInvite`).
- AD-5: không gọi HTTP, email hay Google API bên trong transaction DB. Tạo Đơn có phí = TX1 → commit → tạo link Tingee (timeout 5 giây) → TX2.
- AD-12: hiệu ứng phụ (email, Sheets, cảnh báo) là job pg-boss enqueue bằng chính `tx`. Payload chỉ chứa id. Handler idempotent. Hết retry thì vào dead-letter, có requeue từ `/admin`.
- AD-13: mọi bảng của BTC có `organization_id NOT NULL`, truy vấn qua `orgScope(ctx)`. Chỉ có 4 đường đọc chéo: `buyerScope`, `shareScope`, `systemScope`, `platformAdminScope`. Có bộ test cách ly chạy trong CI.
- AD-17: realtime bằng Postgres `NOTIFY` → SSE chỉ là tín hiệu, REST mới là sự thật. Có 5 topic (`order_changed`, `event_orders_changed`, `event_checkins_changed`, `org_review_items_changed`, `org_status_changed`). Một hook `useLiveResource` lo SSE, `visibilitychange` và polling dự phòng (2 giây ở màn chờ thanh toán, 10 giây ở dashboard).
- AD-18: `audit_events` chỉ cho INSERT, ghi trong cùng transaction, không chứa giá trị PII.
- AD-26: `AccessResolver` + `@RequirePermission`. Ma trận quyền khai báo trong `packages/contracts`. Endpoint BTC dưới `/v1/orgs/:orgId/…`, endpoint CTV dưới `/v1/checkin/events/:eventId/…`. Owner và Quản trị Tingee cần step-up TOTP (12 giờ đối với Owner). Mã lỗi quyền: `NOT_A_MEMBER`, `FORBIDDEN_ROLE`, `TOTP_REQUIRED`, `CHECKER_REVOKED`, `EVENT_ENDED`.
- AD-31: các `POST` từ trình duyệt dùng `Idempotency-Key`. Mỗi người mua tối đa một Đơn `pending` cho mỗi Sự kiện. Giới hạn tốc độ tạo Đơn và tra tay, đếm trong Postgres.
- Quy ước chung: UUIDv7, `snake_case` cho DB, lỗi dạng `{error:{code,message,details}}`, phân trang cursor, `x-request-id`, response có hạn chót thì kèm `serverNow`, cô lập READ COMMITTED + UPDATE có điều kiện.

**Lõi tiền, tồn kho và Vé:**

- AD-1: Vé chỉ được phát trong `ordering.markPaid(tx, orderId, source, paidAmount)`, với `source` ∈ {`ipn`, `reconciliation`, `manual`, `free`}. Không bao giờ phát Vé từ `returnUrl` hay request của trình duyệt.
- AD-2: tồn kho nằm ở `ticket_type_inventory(capacity, sold, held)` có CHECK. Giữ/bán có điều kiện bằng UPDATE. Đơn nhiều Hạng vé cập nhật theo id tăng dần. Có bảng phép tồn kho cho từng chuyển trạng thái. Có job đối chiếu định kỳ (chỉ cảnh báo, không tự sửa).
- AD-3: Đơn là máy trạng thái compare-and-set gồm `pending`/`paid`/`expired`/`review`/`cancelled`/`refunded`.
- AD-4: `expires_at` = now + 60 giây; gắn link xong thì bằng hạn link (15 phút). Hết hạn khi gặp điều kiện đầu tiên trong số (a) chưa có link sau 60 giây, (b) Tingee xác nhận chưa trả, (c) quá `expires_at` + 5 phút. Màn người mua: đồng hồ về 0 → "Đang xác nhận thanh toán", chỉ hiện "Hết hạn" khi API trả `expired`.
- AD-6: Tingee Payment Gateway `create-link` (`merchantId` = Merchant con, `orderId` = mã Đơn, `expireInMinute` = 15, `returnUrl` = `/orders/:code`), mở bằng redirect toàn trang. Giá Hạng vé có phí ≥ 2.000đ. Chặn VietinBank (`BANK_NOT_SUPPORTED`).
- AD-7: IPN kiểm HMAC-SHA512 trên raw body, lệch timestamp quá 10 phút thì từ chối. `payment_events` có whitelist field và khóa unique. Trả mã `00` trong dưới 5 giây. Bảng xử lý 7 trường hợp. `review_items` có `open`/`resolved` và `resolution`.
- AD-8: Đối soát bù tra trạng thái Gateway theo `orderId` sau 2 phút (backoff) và tại `expires_at`, đi chung đường xử lý với IPN.
- AD-9: chỉ mô-đun `tingee` gọi Tingee: ký request, đổi mã lỗi Tingee thành lỗi miền, chuyển giờ UTC+7. Có Tingee fake cho test.
- AD-15: check-in đúng một lần bằng UPDATE có điều kiện + `scanId`, không có đỏ giả. Schema `ScanResult` gồm các lý do `BAD_SIGNATURE`, `CANCELLED`, `VOIDED`, `OTHER_EVENT`, `EXPIRED`, `CHECKER_REVOKED`, `EVENT_ENDED`.
- AD-16: Mã QR vé dạng `t<k>.<ticketId>.<sig>` (HMAC-SHA256, khóa có phiên bản).
- AD-20: mã Đơn = `TK` + 8 ký tự Crockford base32, cũng là `orderId` gửi Gateway.
- AD-21: `ordering.sellability(eventId)` là nguồn duy nhất cho trạng thái bán.
- AD-29: link chia sẻ Vé bằng `share_token` 128 bit (DB chỉ lưu hash). `GET /v1/shared-tickets/:token` không cần đăng nhập. Email gửi Vé dùng link này.
- AD-30: `checker_invites` (mỗi Sự kiện tối đa 1 link đang hoạt động, hạn = min(7 ngày, `effective_end_at`)) và `checkers` (CTV đã bị thu hồi không tự nhận lại được).
- AD-32: `payment_service_status` (`active`/`suspended`). Job dò mỗi 5 phút khi `suspended`, có nút "Kiểm tra lại". Mở lại dịch vụ → Đối soát bù mọi Đơn còn mở. Token đọc trực tiếp từ Tingee (timeout 3 giây).
- AD-34: `reporting.notices(scope)` là nguồn duy nhất cho `status-banner`. `event.publishReadiness(eventId)` liệt kê điều kiện mở bán.
- AD-35: bản chụp bất biến trên Đơn/Vé (`unit_price`, `total_amount`, thông tin người mua, câu trả lời form kèm nhãn, `sub_merchant_id`, `seq`, `holder_name`…). Tra tay khớp đầy đủ sau chuẩn hóa.

**Thời gian và trạng thái:**

- AD-14: `events.effective_end_at` tính theo `Asia/Ho_Chi_Minh` và được so tại thời điểm request. Có `ended_manually_at`.
- AD-27: máy trạng thái Sự kiện `draft` → `published` ↔ `hidden` → `cancelled`. "Đã kết thúc" không lưu mà tính ra. Khóa là trục riêng (`locked_at`…). Vé `valid` → `cancelled` (`event_cancelled` | `voided`).
- AD-28: `flows.cancelEvent` chạy trong một transaction. Danh sách hoàn tiền là truy vấn động. Khóa chỉ chặn bán. Có `flows.voidTickets`.

**Tích hợp:**

- AD-19: Better Auth (Google + `emailOTP`), session lưu DB, cookie `httpOnly`/`Secure`/`SameSite=Lax` trên domain cha, API ở `api.<domain>`, CORS chỉ cho origin web, `returnTo` trong URL.
- AD-22: hạ tầng không phụ thuộc nhà cung cấp: Docker, PG 18 có PITR/failover, object storage S3 với presigned upload, `EmailTransport` (SMTP; Mailpit ở local).
- AD-23: Google Sheets OAuth riêng với scope `drive.file`. Refresh token mã hóa AES-GCM. Đánh dấu dòng bẩn rồi flush theo Sự kiện mỗi phút. Tìm dòng theo mã Đơn. Trạng thái kết nối `active`/`syncing`/`retrying`/`auth_revoked`.
- AD-24: `flows.deleteAccount` + `<module>.anonymize_user`. Từ chối xóa khi người dùng là Owner hoặc còn Đơn `pending`.
- AD-37: trang công khai SSR có cache (revalidate 30 giây). `GET /v1/events/:slug/availability` cache tối đa 2 giây.

**Vận hành (AD-36):**

- CI GitHub Actions: typecheck, dependency-cruiser, Vitest với Postgres thật, bộ test cách ly, Playwright với Tingee fake. Image tag theo SHA. Staging tự deploy từ `main`, production deploy thủ công theo tag. Migration chạy bằng vai `migrate` và luôn tương thích ngược.
- Topology: ≥ 2 instance api và ≥ 1 worker. `/healthz`, `/readyz`. Graceful shutdown khi nhận SIGTERM.
- Sao lưu: RPO ≤ 5 phút, RTO ≤ 1 giờ, giữ 14 ngày, diễn tập khôi phục trước Closed Beta. Secret lấy từ secret store, kiểm bằng schema Zod. Hai role DB: `tickee_migrator` và `tickee_app`.
- Ba môi trường `local` (Tingee fake), `staging` (UAT), `production` (PROD). Test hợp đồng với Tingee UAT chạy ở staging.
- Đo lường sản phẩm: bảng `checkout_funnel_events` không chứa PII (`buy_clicked`, `login_completed`, `order_created`, `paid`).
- Giám sát: OpenTelemetry và các cảnh báo theo NFR-10.

**Phụ thuộc bên ngoài và rủi ro:**

- Câu hỏi mở với Tingee (API Token, API tra trạng thái theo `orderId`, gọi lại `create-link`, hủy link) không chặn việc chia Epic, nhưng chặn test hợp đồng ở staging.
- Nhà cung cấp hạ tầng/email/giám sát đang hoãn chờ pháp chế (NĐ 53/2022). Phải chốt trước Closed Beta.

### UX Design Requirements

**Điều chỉnh do Architecture (các UX-DR dưới đây đã được sửa theo):** bỏ `payment-qr-card` tự render QR và bỏ luồng Deep Link/chọn app ngân hàng. Thay bằng màn xác nhận thanh toán rồi redirect sang Tingee Gateway, và màn `/orders/:code` (chờ/xác nhận/thành công/hết hạn). Thêm trạng thái "Đang xác nhận thanh toán", màn đăng ký TOTP và step-up TOTP, trường liên hệ BTC. Mã Đơn ví dụ 10 ký tự (`TK8F3Q2AXM`).

**Design tokens và nền tảng giao diện**

- UX-DR1: Cài đặt design tokens "Rạp tối" vào `globals.css` + Tailwind 4. Ánh xạ biến shadcn cho light/dark theo `prefers-color-scheme` (bảng Colors của DESIGN.md). Thêm biến riêng `--stage`, `--stage-foreground`, `--stage-muted`, `--bar`, `--brand-text`, các cặp `--success/warning/danger/neutral-(text|subtle)`, `--scan-success`, `--scan-danger`. Không có công tắc theme trong app.
- UX-DR2: Typography Be Vietnam Pro (400/500/700, `font-display: swap`) thay Geist qua `--font-sans`. Có các token display/headline/title/body/input(16px)/label/meta/eyebrow/button/amount/total/scan-result/scan-detail/code. Số tiền, đếm ngược và số Vé dùng `tabular-nums`. Tiền định dạng "300.000đ".
- UX-DR3: Token bo góc (sm 10, md 12, lg 18, xl 20, full), spacing có tên (gutter-mobile 16, card-padding 14, stack 10, section 24, control-height 50, stepper-button 34, tab-bar-height 64, sidebar-width 256, content-max-buyer 480, icon-button 40). Elevation: light dùng bóng ấm không viền; dark dùng vòng 1px `stage-line`.
- UX-DR4: Ràng buộc màu bắt buộc: coral `brand` chỉ đặt trên nền tối; chữ trên coral luôn là `on-brand`; chữ thương hiệu trên nền sáng dùng `brand-text`; QR luôn module đen trên tấm trắng; không dùng coral để báo lỗi. Có lint hoặc review checklist theo bảng Do's and Don'ts.
- UX-DR5: Wordmark tạm "tickee" (chữ thường, weight 700) kèm ô vuông coral xoay 45°.

**Component dùng chung**

- UX-DR6: `button-primary` / `button-primary-on-light` / `button-secondary` / `button-destructive`. Gọi mạng → spinner trong nút, giữ nguyên độ rộng, chặn bấm lặp. Không disable mà không có lý do hiển thị. `button-primary-on-light` ở dark mode trở thành coral. Hành động phá hủy luôn qua `Dialog` nêu hậu quả cụ thể.
- UX-DR7: `stage-block`, `event-card`, `status-badge`. Badge luôn có chữ. Ánh xạ tone theo bảng DESIGN.md cho Đơn, loại Cần xử lý, Vé, Sự kiện, BTC và tài khoản nhận tiền.
- UX-DR8: `status-banner` gồm 4 tone, icon khác hình theo tone, tối đa một hành động. Banner chặn bán hoặc danger không đóng được. Hiện tối đa 2 banner, còn lại gộp "+N thông báo" (mở `Sheet`). Thông báo qua `aria-live="polite"`. Thứ tự ưu tiên 11 mức. Dữ liệu lấy từ `reporting.notices()`, web chỉ ánh xạ `code` sang nội dung.
- UX-DR9: `empty-state` (một câu + tối đa một hành động). `otp-input` 6 ô, dán mã tự điền, `autocomplete="one-time-code"`, đủ 6 số tự gửi. `google-signin-button`. Toast `Sonner` không dùng cho lỗi chặn luồng.

**Bề mặt Người mua**

- UX-DR10: Trang Sự kiện `/e/{slug}`. `event-hero` dạng stage (ảnh hoặc nền fallback gradient coral, eyebrow, tên, hàng icon ngày-giờ/địa điểm; địa điểm chạm được để mở bản đồ). Có hàng BTC và nút chia sẻ (Web Share API, fallback sao chép link). Desktop ≥ lg: 2 cột, thẻ chọn vé dính khi cuộn. Có Skeleton khi tải.
- UX-DR11: `ticket-tier-row` hiện "Còn N vé" chính xác; ≤ 10 vé thì đổi sang chữ `brand-text` đậm. Biến thể `ticket-tier-row-unavailable` (viền nét đứt; "Hết vé" / "Chưa mở bán" kèm giờ mở / "Đã đóng bán"). `quantity-stepper` bắt đầu ở 0, nút "+" chặn ở min(số còn lại, giới hạn Vé/Đơn còn lại của cả Đơn) kèm dòng giải thích. Nút có aria-label "Giảm/Tăng số vé {Hạng vé}".
- UX-DR12: `purchase-bar` dính đáy, nổi, tôn trọng safe-area. Tổng tiền cập nhật tức thì. Chưa chọn vé → disabled + "Chọn vé để tiếp tục". Sự kiện miễn phí hiện "Miễn phí" / "Đăng ký". Mọi Hạng vé hết → thay bằng thông báo "Hết vé". Có `scroll-padding-bottom` để focus không bị che.
- UX-DR13: Các trạng thái trang Sự kiện: không tìm thấy (slug sai hoặc Nháp, trả cùng 404), Tạm ngừng bán, Ẩn, Bị khóa ("Sự kiện tạm thời không nhận Đơn."), Đã hủy, Đã kết thúc. Mỗi trạng thái là một `status-banner` dưới stage, kèm stepper/"Mua" bị tắt. Availability gọi lại khi `visibilitychange`.
- UX-DR14: Màn đăng nhập (Google một chạm + OTP email) với các trạng thái: đã gửi mã (đếm ngược gửi lại), sai mã ("còn N lần"), hết hạn ("Gửi mã mới"), hủy Google (ở lại màn, không báo lỗi đỏ). Quay lại đúng lựa chọn qua `returnTo`.
- UX-DR15: Checkout gồm form một lần cho cả Đơn và tóm tắt Đơn. Email tự điền, SĐT tự điền nếu đã có. Lỗi hiện tại từng trường khi rời trường và khi gửi; cuộn và focus vào trường lỗi đầu tiên; `aria-describedby`. Có dòng ghi rõ thông tin được chia sẻ cho BTC. Các trạng thái: hết chỗ khi gửi (báo đúng Hạng vé, quay lại trang với số lượng hạng đó về 0), Tạm ngừng bán, gửi lỗi mạng (thử lại cùng `Idempotency-Key`, Đơn đã có thì chuyển thẳng tới Đơn).
- UX-DR16: Màn thanh toán (thay `payment-qr-card`): stage hiện số tiền, `countdown-chip` (theo `serverNow`, màu coral bình tĩnh, không đổi đỏ), mã Đơn. `recipient-trust-block` ghi "Tiền chuyển thẳng cho {BTC}". Link chính sách hoàn vé mở trong `Sheet`. Chân trang "Tickee không giữ tiền của bạn". Nút "Thanh toán" redirect toàn trang sang Gateway. Lỗi tạo link → "Chưa tạo được link thanh toán" + "Thử lại" cho cùng Đơn trong cửa sổ 60 giây.
- UX-DR17: Màn `/orders/:code`: lấy trạng thái qua REST + `useLiveResource`, không tin tham số trên URL. Các trạng thái theo `buyerStatus`: `awaiting_payment` (đang chờ), `confirming` ("Đang xác nhận thanh toán" khi đồng hồ về 0), `paid` → Thành công, `expired` → Hết hạn, `under_review` → "BTC đang kiểm tra thanh toán", `event_cancelled`. Sau ~2 phút chờ thì hiện `reassurance-line`. Kiểm tra ngay khi `visibilitychange`. Mất mạng → dòng nhỏ trấn an.
- UX-DR18: Màn Thành công: stage chứa wordmark, tên Sự kiện, "Vé của bạn đã sẵn sàng!", "Đã gửi Vé tới {email}". `ticket-card` đầu tiên chồng mép stage khoảng 30px với hiệu ứng trượt lên và rung nhẹ (tắt khi reduced motion). Mỗi Vé có "Chia sẻ Vé". Nút "Xem Vé của tôi". Thông báo `polite`.
- UX-DR19: Màn Hết hạn: "Hết thời gian giữ chỗ. Chỗ đã được trả lại." + "Mua lại" + dòng phụ "Nếu bạn đã chuyển tiền, đừng chuyển lại".
- UX-DR20: `ticket-card` dáng cuống vé (đường xé nét đứt + hai khuyết), khác hẳn màn thanh toán. Nhãn "Mã QR vé · đưa cho CTV ở cổng". QR tối thiểu 200×200. Đã check-in/Đã hủy → QR mờ (.25) + badge. Mở Chi tiết Vé thì tăng độ sáng màn hình nếu trình duyệt cho phép.
- UX-DR21: Vé của tôi có ba nhóm (Vé còn hiệu lực · Đơn đang chờ · Lịch sử), Skeleton và empty-state không có nút khám phá. `order-card` không bao giờ có QR: Chờ thanh toán (đếm ngược + "Tiếp tục thanh toán" mở lại đúng Đơn), "BTC đang kiểm tra thanh toán" (liên hệ BTC), Đã hủy. Tự cập nhật khi trạng thái đổi.
- UX-DR22: Chi tiết Vé qua link chia sẻ (AD-29): xem được không cần đăng nhập. Vé đã check-in → QR mờ + badge. Vé đã hủy hoặc hết hiệu lực, hay link sai → `empty-state` chung, không lộ thông tin. Chủ Vé tạo lại link được (link cũ mất hiệu lực).
- UX-DR23: `social-ticket-card` 9:16 (1080×1920) trên nền stage. Không có QR, mã Vé, mã Đơn hay tên Người mua, không có hình cuống vé. Chỉ hiện với Vé hợp lệ. Spinner khi đang tạo ảnh; lỗi → toast "Chưa tạo được ảnh. Thử lại." Chia sẻ bằng Web Share API, fallback tải ảnh.
- UX-DR24: Trang Tài khoản: xóa tài khoản / rút đồng ý qua `Dialog` liệt kê Vé còn hiệu lực trước khi xác nhận. Báo rõ khi bị chặn (đang là Owner, còn Đơn pending).
- UX-DR25: Form báo cáo Sự kiện (chọn lý do + mô tả, yêu cầu đăng nhập). Gửi xong: "Cảm ơn bạn. Tingee sẽ xem xét báo cáo này." Lỗi → giữ nội dung + "Thử lại".
- UX-DR26: `tickee-referral-line` ở chân trang Sự kiện và email Vé (Could).

**Màn quét CTV**

- UX-DR27: Nhận lời mời: màn xem trước (tên Sự kiện + BTC) + "Nhận soát vé" → vào Màn quét. Link hết hạn/bị thu hồi → "Link mời đã hết hạn. Liên hệ BTC để nhận link mới."
- UX-DR28: Quyền camera: màn giải thích có nút "Bật camera" trước khi trình duyệt hỏi. Bị từ chối → hướng dẫn bật lại theo Safari iOS/Chrome Android, kèm nút "Tra tay".
- UX-DR29: `scanner-viewport`: camera chạy liên tục. Nhận được QR thì khóa quét cho tới khi kết quả đóng. Đỉnh màn hiện tên Sự kiện + số đã check-in, đáy có nút "Tra tay" ở vùng ngón cái.
- UX-DR30: `scan-result-overlay` phủ toàn màn hình. Xanh (`scan-success`, icon tích tròn 96px, "Thành công", "{tên} · Vé k/N · {Hạng vé}") tự đóng sau ~1,5 giây kèm tiếng bíp nhẹ. Đỏ (`scan-danger`, icon X bát giác, "Đã check-in lúc HH:MM · bởi {người}" hoặc "Vé không hợp lệ" + một dòng lý do) có âm thanh, giữ tới khi chạm, nút "Chạm để quét tiếp". Kết quả trung tính "Bạn vừa check-in Vé này". Đọc bằng `aria-live="assertive"`. Reduced motion → hiện tức thì.
- UX-DR31: `offline-banner` cố định trên cùng, không đóng được: "Mất kết nối — chưa quét được". Camera tạm dừng (khung mờ 50% + "Camera tạm dừng · tự thử lại"), tự thử lại cùng `scanId` (timeout 3 giây), tự ẩn khi có mạng.
- UX-DR32: `manual-lookup` dạng `Sheet` từ dưới lên. Ô tìm tự focus, nhãn luôn hiện "SĐT hoặc email Người mua". Kết quả hiện khi gõ (debounce ~200ms) và có dòng "N Vé khớp". Mỗi hàng gồm tên, Hạng vé · Vé k/N, badge, nút "Check-in" (hàng đã check-in không có nút). Không bao giờ hiện QR hay SĐT. Không có kết quả → "Không tìm thấy Vé khớp."
- UX-DR33: Màn hết quyền: "Bạn không còn quyền soát vé cho Sự kiện này." (thêm "Sự kiện đã kết thúc." khi đúng lý do đó), hiện ở lượt quét kế tiếp.

**Dashboard BTC**

- UX-DR34: Khung điều hướng responsive. ≥ lg dùng `dashboard-sidebar` (stage, BTC switcher ở đầu, mục đang chọn có thanh coral 3px; mục chỉ dành cho Owner bị ẩn với Admin). md–lg thì sidebar thu thành icon. < md dùng `bottom-tab-bar` (Sự kiện · Cần xử lý (badge realtime) · Quét vé · Thêm → `Sheet`). Tabs cấp Sự kiện: Tổng quan · Đơn · Hạng vé · Form mua · Check-in · Cài đặt.
- UX-DR35: Tổng quan Sự kiện: banner ở đầu; hàng số liệu gồm 2 `stat-card` (doanh thu; check-in đã vào/tổng, có thanh tiến độ) và `needs-action-card` (link sang tab Đơn đã lọc Cần xử lý); `recent-orders-block` hiện 5 Đơn mới nhất, realtime (< md hiển thị dạng thẻ). Mất mạng → toast một lần + nhãn "Cập nhật lúc HH:MM".
- UX-DR36: `wizard-stepper` tạo Sự kiện 4 bước (Thông tin → Hạng vé → Form mua → Xem trước & mở bán). Quay lại không mất dữ liệu, "Lưu nháp" ở mọi bước. Trên mobile hiện "Bước 2/4 · Hạng vé". Bước 4 liệt kê điều kiện còn thiếu theo `publishReadiness`, kèm link sửa nhanh. "Mở bán" chỉ bật khi đủ điều kiện, mở bán xong thì có link + "Sao chép link".
- UX-DR37: Tab Đơn: bảng (< md là danh sách thẻ), phân trang (không cuộn vô hạn), bộ lọc "Cần xử lý", xuất CSV. Empty-state: "Chưa có Đơn nào. Gửi link Sự kiện để bắt đầu bán." + "Sao chép link".
- UX-DR38: Hàng Cần xử lý (cấp BTC, có badge số) và `needs-action-row`: badge loại + mã Đơn + Người mua + số nhận/số Đơn (phần chênh tô `danger-text`) + tên Sự kiện. Mở ra `Sheet` chi tiết (giao dịch, Đơn liên quan, nhật ký). Thao tác theo loại; xong thì hàng rời hàng đợi + toast nêu kết quả. Trống → "Không có gì cần xử lý."
- UX-DR39: Tab Check-in: `checkin-progress` theo từng Hạng vé (realtime), link mời CTV chung ("Sao chép link", tạo link mới), danh sách CTV có "Thu hồi"/"Khôi phục", trạng thái link còn hạn/hết hạn.
- UX-DR40: Các trạng thái dashboard: Chờ duyệt Closed Beta, Closed Beta bị thu hồi, chưa liên kết tài khoản (Owner thấy "Liên kết ngay", Admin thấy "Nhờ Owner…"), đang liên kết, liên kết thất bại, Token dưới ngưỡng/chạm hạn mức, mất quyền Google Sheets, BTC/Sự kiện bị khóa, Đã hủy kèm "{n} Đơn cần hoàn tiền" + "Xuất danh sách hoàn tiền", đã hoàn tay hết. Admin mở URL dành cho Owner → empty-state "Chỉ Owner xem được mục này." Bị xóa khỏi BTC giữa phiên → `Dialog` rồi chuyển BTC.
- UX-DR41: Form Hạng vé có lỗi tại trường "Tối thiểu {n} — đã bán và đang giữ chỗ." và kiểm giá ≥ 2.000đ. Sửa thời gian/địa điểm khi đã phát Vé → `Dialog` báo sẽ gửi email cho Người mua. "Hủy Sự kiện" yêu cầu gõ tên Sự kiện.
- UX-DR42: Màn đăng ký TOTP khi trở thành Owner và màn step-up TOTP khi API trả `TOTP_REQUIRED` (bổ sung theo Architecture).

**Landing và Quản trị Tingee**

- UX-DR43: Landing `/`: `landing-hero` (stage, display title có cụm từ nhấn coral, 4 `value-tile`, CTA "Đăng ký Closed Beta" → đăng nhập → tạo BTC; đã có BTC thì CTA thành "Vào dashboard"), các section theo hành trình BTC, CTA cuối trang.
- UX-DR44: Quản trị Tingee (desktop, shadcn mặc định): hàng duyệt Closed Beta (Duyệt/Thu hồi qua `Dialog` nêu hậu quả), danh sách báo cáo vi phạm, `Dialog` khóa (chọn khóa Sự kiện hay BTC, lý do bắt buộc, tùy chọn vô hiệu Vé), chi tiết có badge "Bị khóa" + nhật ký, mở khóa, requeue dead-letter.

**Accessibility và responsive (áp dụng cho mọi story UI)**

- UX-DR45: WCAG 2.2 AA. Focus ring 2px `ring` dùng `:focus-visible`. Vùng chạm ≥ 24px. Không chỉ dựa vào màu. Nhãn form luôn hiển thị. Dùng tốt ở 200% chữ và 320px không cuộn ngang. `lang="vi"`. Tôn trọng `prefers-reduced-motion`. Đếm ngược chỉ thông báo ở mốc 5 phút và 1 phút.
- UX-DR46: Ràng buộc tương tác: một hành động chính mỗi màn, đặt ở vùng ngón cái. Không thao tác chỉ-hover. Cấm carousel tự chạy, cuộn vô hạn, kéo-thả, modal chồng modal, xác nhận "Bạn có chắc?" cho thao tác không phá hủy. Sao chép luôn kèm toast "Đã sao chép".

### FR Coverage Map

| FR | Epic | Ghi chú |
|---|---|---|
| FR-1 | E1 | Đăng ký/đăng nhập Google + OTP email |
| FR-2 | E2 | BTC, Owner, Admin, chuyển BTC |
| FR-3 | E3 | Đăng nhập khi bấm Mua, giữ lựa chọn |
| FR-4 | E2 | Ma trận quyền; áp dụng xuyên suốt mọi epic |
| FR-5 | E2 | Liên kết tài khoản nhận tiền, Merchant con |
| FR-6 | — | Ngoài Closed Beta, không có story |
| FR-7 | E2 | Tạo/sửa/ẩn Sự kiện, kết thúc (hủy ở E7) |
| FR-8 | E2 | Hạng vé |
| FR-9 | E2 | Form mua vé |
| FR-10 | E2 | Trang Sự kiện công khai, OG |
| FR-11 | E3 | Sự kiện miễn phí |
| FR-12 | E3 | Đơn nhiều Vé, nhiều Hạng vé |
| FR-13 | E3 | Không bán quá số suất |
| FR-14 | E3 | Giữ chỗ 15 phút, hết hạn, tiền về muộn |
| FR-15 | E4 | Tạm ngừng bán theo trạng thái dịch vụ (`sellability` dựng ở E2) |
| FR-16 | E3 | Thanh toán qua Gateway |
| FR-17 | E3 | QR tĩnh do Gateway tự khớp |
| FR-18 | E3 | Tự chuyển Thành công |
| FR-19 | E3 | IPN đủ 7 nhánh AD-7 |
| FR-20 | E4 | Đối soát bù |
| FR-21 | E4 | Xử lý Cần xử lý (mục được tạo từ E3) |
| FR-22 | E3 | Vé, Mã QR vé, Vé của tôi, link chia sẻ |
| FR-23 | E3 | Email Vé |
| FR-24 | E3 | Vé sau khi Sự kiện kết thúc |
| FR-25 | E8 | Social Ticket Card (Should) |
| FR-26 | E5 | Mời/thu hồi CTV |
| FR-27 | E5 | Quét Mã QR vé |
| FR-28 | E5 | Check-in một lần, song song |
| FR-29 | E5 | Tra tay |
| FR-30 | E5 | Check-in realtime |
| FR-31 | E3 + E6 | E3: doanh thu + Đơn gần đây; E6: tab Đơn, CSV |
| FR-32 | E6 | Google Sheets |
| FR-33 | E7 | Hủy Sự kiện, danh sách hoàn tiền |
| FR-34 | E4 | Token, ngưỡng cảnh báo |
| FR-35 | E7 | Báo cáo, khóa/mở khóa, vô hiệu Vé |
| FR-36 | E8 | Dòng giới thiệu Tickee (Could) |
| FR-37 | E2 | Duyệt Closed Beta (thu hồi → Tạm ngừng bán ở E4) |
| FR-38 | E7 | Xóa tài khoản, rút đồng ý |

Phủ 37/38 FR (FR-6 ngoài phạm vi MVP).

**Phụ thuộc giữa các epic:**
- E1 → E2 → E3 → E4 (tuần tự).
- E5 chỉ dựa trên E1–E3.
- E6 dựa trên E3 và E4: Story 6.5 đồng bộ cả Đơn do `markPaid` của E4 phát (Đối soát bù, duyệt tay) và trạng thái Cần xử lý.
- E7 dựa trên E4 và E6: Story 7.1 dựa vào Đối soát bù (4.1); Story 7.2 dùng thao tác "Đã hoàn tay" (4.4) và chuẩn CSV (6.3); Story 7.4 dùng `notices` và banner của E4.
- E8 chỉ dựa trên E3.

Phase 1 = E1–E4; Phase 2 = E5–E8. E7 thuộc Phase 2 về thứ tự làm, nhưng là điều kiện bắt buộc trước khi mở Closed Beta.

## Epic List

### Epic 1: Nền móng & Tài khoản Tickee
Người dùng đăng ký/đăng nhập bằng Google hoặc OTP email và đồng ý NĐ 13. BTC tìm hiểu Tickee qua landing. Epic dựng Structural Seed (monorepo, `packages/contracts`, khung `platform`, Tingee fake, docker-compose), design tokens "Rạp tối" và CI.
**FRs covered:** FR-1
**UX-DR chính:** UX-DR1–9, UX-DR14, UX-DR43, UX-DR45–46

### Epic 2: BTC thiết lập và mở bán Sự kiện
Owner tạo BTC, bật TOTP (kèm mã khôi phục), mời Admin, liên kết và đổi tài khoản nhận tiền, chuyển quyền Owner, được Quản trị Tingee duyệt Closed Beta. Sau đó tạo Sự kiện, Hạng vé, form mua, mở bán và chia sẻ link có OG preview.
**FRs covered:** FR-2, FR-4, FR-5, FR-7, FR-8, FR-9, FR-10, FR-37
**UX-DR chính:** UX-DR10–13, UX-DR34, UX-DR36, UX-DR40–42, UX-DR44 (phần duyệt Closed Beta)

### Epic 3: Người mua mua Vé và nhận Vé ngay
Người mua chọn Vé, đăng nhập, điền form, thanh toán qua Gateway, tự thấy "Thành công", nhận email, xem "Vé của tôi" và chia sẻ Vé. Sự kiện miễn phí đi trọn luồng. IPN xử lý đủ 7 nhánh AD-7 (tạo `review_item`), Người mua thấy "BTC đang kiểm tra thanh toán". Kết thúc bằng khung dashboard tối thiểu: `stat-card` doanh thu và "Đơn gần đây" realtime (không có bộ lọc, không CSV). Test đồng thời chạy trong CI.
**FRs covered:** FR-3, FR-11, FR-12, FR-13, FR-14, FR-16, FR-17, FR-18, FR-19, FR-22, FR-23, FR-24, FR-31 (một phần)
**UX-DR chính:** UX-DR15–22, UX-DR35 (một phần)

### Epic 4: Thanh toán đáng tin khi có sự cố
Đối soát bù khi IPN trễ/mất; Sự kiện tự "Tạm ngừng bán" khi BTC hết Token hoặc bị ngắt dịch vụ và tự mở lại; BTC xử lý hàng Cần xử lý; Owner theo dõi Token và nhận cảnh báo; cảnh báo giám sát NFR-10; staging/production, deploy an toàn và diễn tập khôi phục (NFR-4, NFR-5). Xong E4 là đạt tiêu chí hoàn thành Phase 1.
**FRs covered:** FR-15, FR-20, FR-21, FR-34
**UX-DR chính:** UX-DR38, UX-DR40 (Token, Closed Beta bị thu hồi)

### Epic 5: Check-in tại cổng
CTV nhận link mời, quét Vé xanh/đỏ dưới 1 giây, tra tay; Owner/Admin theo dõi check-in realtime và thu hồi CTV. Story cuối: kiểm thử tải NFR-3 trên staging.
**FRs covered:** FR-26, FR-27, FR-28, FR-29, FR-30
**UX-DR chính:** UX-DR27–33, UX-DR39

### Epic 6: Báo cáo Đơn và Google Sheets
Tab Đơn đầy đủ (câu trả lời form, bộ lọc, phân trang, Vé theo Hạng vé), xuất CSV, đồng bộ Google Sheets một chiều.
**FRs covered:** FR-31 (phần còn lại), FR-32
**UX-DR chính:** UX-DR35, UX-DR37, UX-DR40 (Google Sheets)

### Epic 7: Niềm tin, an toàn và vòng đời dữ liệu *(bắt buộc trước Closed Beta)*
Người mua báo cáo Sự kiện; Quản trị Tingee khóa/mở khóa Sự kiện hoặc BTC và vô hiệu Vé; BTC hủy Sự kiện kèm danh sách hoàn tiền; người dùng xóa tài khoản hoặc rút đồng ý.
**FRs covered:** FR-33, FR-35, FR-38
**UX-DR chính:** UX-DR24, UX-DR25, UX-DR40 (khóa, đã hủy), UX-DR41 (hủy), UX-DR44

### Epic 8: Lan truyền *(Should/Could, cắt được)*
Social Ticket Card cho Story; dòng giới thiệu Tickee ở trang Sự kiện và email Vé.
**FRs covered:** FR-25, FR-36
**UX-DR chính:** UX-DR23, UX-DR26

## Epic 1: Nền móng & Tài khoản Tickee

Người dùng đăng ký và đăng nhập Tài khoản Tickee bằng Google hoặc OTP email, đồng ý xử lý dữ liệu theo NĐ 13/2023, và quay lại đúng trang đang dở. Epic dựng nền móng monorepo, cấu hình, CI và hệ thống giao diện "Rạp tối" mà mọi epic sau dùng chung.

### Story 1.1: Dựng monorepo theo Structural Seed

As a thành viên đội phát triển,
I want một monorepo chạy được ngay ở local và trong CI theo đúng Structural Seed của Architecture,
So that mọi story sau có chung cấu trúc, công cụ và quy ước, không ai phải tự dựng lại.

**Acceptance Criteria:**

**Given** repo mới clone về máy có Node 26 và pnpm 12.15
**When** chạy `pnpm install` rồi `pnpm turbo build`
**Then** build thành công `apps/web` (Next.js 16.4), `apps/api` (NestJS 12.3) và `packages/contracts` (Zod 4), với TypeScript 6.0 ở chế độ strict
**And** phiên bản thư viện khớp bảng Stack của Architecture

**Given** Docker đang chạy
**When** chạy `docker compose up`
**Then** có Postgres 18 và Mailpit ở local

**Given** image `apps/api` đã build
**When** khởi động với biến môi trường vai `api`, `worker` hoặc `migrate`
**Then** vai `api` mở HTTP với `/healthz` (liveness) và `/readyz` (kiểm DB); vai `worker` khởi động pg-boss; vai `migrate` chạy migration Drizzle, khởi tạo schema `pgboss` rồi thoát với mã 0
**And** nhận `SIGTERM` thì tắt êm (`boss.stop({ graceful })`)

**Given** thiếu hoặc sai một biến môi trường bắt buộc
**When** khởi động bất kỳ vai nào
**Then** tiến trình dừng ngay với thông báo nêu đúng tên biến (schema Zod của `config`), không in giá trị secret

**Given** mã nguồn `apps/api/src`
**When** xem cấu trúc thư mục
**Then** có `modules/`, `flows/`, `platform/` (db + tx, config, logging) theo Structural Seed; `platform/db` cung cấp `db.transaction(async (tx) => …)` với READ COMMITTED và PK UUIDv7 (`uuidv7()` của PG 18)
**And** migration dùng role `tickee_migrator`, app dùng role `tickee_app`; drizzle-kit bỏ qua schema `pgboss`

**Given** một request bất kỳ tới api
**When** request được log
**Then** log là JSON pino kèm `x-request-id`, và SĐT/email bị che (NFR-8)
**And** response lỗi có dạng `{ "error": { "code", "message", "details" } }`, mã lỗi khai báo trong `packages/contracts`

**Given** một PR được mở trên GitHub
**When** GitHub Actions chạy
**Then** pipeline chạy typecheck, dependency-cruiser (luật hướng phụ thuộc sinh từ sơ đồ mô-đun AD-10), Vitest với Postgres thật trong container, và build image gắn tag commit SHA
**And** một import vi phạm hướng phụ thuộc làm CI đỏ

### Story 1.2: Hệ thống giao diện "Rạp tối" và khung web

As a người dùng Tickee,
I want giao diện nhất quán, dễ đọc trên điện thoại, theo sáng/tối của máy,
So that mọi màn hình đều quen thuộc và dễ dùng.

**Acceptance Criteria:**

**Given** `apps/web` với shadcn/ui và Tailwind 4
**When** mở bất kỳ trang nào
**Then** biến CSS shadcn ánh xạ đúng bảng Colors của DESIGN.md cho light và dark theo `prefers-color-scheme`, kèm biến riêng `--stage`, `--stage-foreground`, `--stage-muted`, `--bar`, `--brand-text`, các cặp `--success/warning/danger/neutral-(text|subtle)`, `--scan-success`, `--scan-danger` (UX-DR1)
**And** không có công tắc theme trong app

**Given** trang đã tải
**When** kiểm tra font
**Then** dùng Be Vietnam Pro 400/500/700 (`font-display: swap`) qua `--font-sans`; có đủ token typography của DESIGN.md; ô nhập 16px; số tiền định dạng "300.000đ" bằng một hàm dùng chung, hiển thị `tabular-nums` (UX-DR2)

**Given** bộ token bo góc, spacing có tên và elevation (UX-DR3)
**When** dựng các component dùng chung `button-primary`, `button-primary-on-light`, `button-secondary`, `button-destructive`, `stage-block`, `status-badge`, `status-banner`, `empty-state`
**Then** mỗi component theo đúng spec DESIGN.md và hành vi EXPERIENCE.md: nút gọi mạng hiện spinner trong nút, giữ độ rộng, chặn bấm lặp; `button-primary-on-light` ở dark mode hiện như `button-primary`; `status-badge` luôn có chữ; `status-banner` có 4 tone với icon khác hình theo tone (UX-DR6, UX-DR7, UX-DR8 phần hiển thị, UX-DR9)
**And** coral `brand` chỉ xuất hiện trên nền tối; chữ trên coral là `on-brand` (UX-DR4)

**Given** cấu trúc `apps/web`
**When** xem thư mục app
**Then** có route groups `(public)`, `(buyer)`, `(dashboard)`, `(checkin)`, `(admin)`; API client typed sinh từ `packages/contracts`; TanStack Query; `Sonner` cho toast; wordmark tạm "tickee" kèm ô vuông coral xoay 45° (UX-DR5)
**And** `apps/web` không có driver DB hay secret Tingee (AD-11)

**Given** trang dùng bàn phím hoặc trình đọc màn hình
**When** điều hướng
**Then** focus ring 2px `ring` hiện qua `:focus-visible`; `lang="vi"`; tôn trọng `prefers-reduced-motion`; dùng được ở 320px không cuộn ngang và ở 200% chữ (UX-DR45)

**Given** pipeline CI của Story 1.1
**When** chạy Playwright
**Then** có hai project mobile-first: WebKit giả lập iPhone (Safari iOS) và Chromium giả lập Android, viewport 375×667; mọi chuỗi giao diện là tiếng Việt (NFR-9)

### Story 1.3: Đăng nhập bằng OTP qua email

As a người dùng chưa có tài khoản hoặc đã có,
I want nhận mã OTP qua email để đăng ký hoặc đăng nhập,
So that tôi vào được Tickee mà không cần nhớ mật khẩu.

**Acceptance Criteria:**

**Given** màn đăng nhập
**When** tôi nhập email và bấm gửi mã
**Then** hệ thống gửi mã 6 số qua `EmailTransport` (Mailpit ở local) bằng Better Auth `emailOTP` (gắn vào NestJS qua `@thallesp/nestjs-better-auth`), và màn hiện "Mã đã gửi tới {email}" kèm đếm ngược gửi lại (FR-1, UX-DR14)
**And** bản ghi user chỉ được tạo khi OTP được xác minh đúng lần đầu, không tạo lúc gửi mã
**And** OTP lưu dạng hash, hiệu lực 5 phút, dùng một lần; gửi mã mới làm mã cũ hết hiệu lực
**And** giới hạn gửi mã: 1 lần mỗi 60 giây và tối đa 5 mã mỗi giờ cho mỗi email, kèm giới hạn theo IP (tối đa 20 mã mỗi giờ), đếm trong Postgres; vượt giới hạn hiện "Bạn đã yêu cầu quá nhiều mã. Thử lại sau {n} phút." (NFR-6)
**And** một email nhập sai hơn 15 lần trong 24 giờ thì bị khóa cả gửi mã lẫn xác minh mã tới khi lần sai cũ nhất ra khỏi cửa sổ 24 giờ; API trả `OTP_LOCKED`, màn hiện "Bạn đã nhập sai quá nhiều lần. Thử lại sau {n} giờ." (NFR-6)

**Given** ô `otp-input` 6 ô
**When** tôi dán cả mã vào ô đầu hoặc trình duyệt tự điền (`autocomplete="one-time-code"`)
**Then** cả 6 ô được điền và tự gửi khi đủ 6 số (UX-DR9)

**Given** tôi nhập sai mã
**When** gửi mã
**Then** ô hiện "Mã chưa đúng, còn N lần"; sau 5 lần sai mã bị vô hiệu
**And** mã hết hạn hiện "Mã đã hết hạn" kèm nút "Gửi mã mới"

**Given** lần đầu đăng nhập của một email mới
**When** OTP đúng
**Then** tôi phải đồng ý điều khoản xử lý dữ liệu cá nhân theo NĐ 13/2023 trước khi tài khoản được dùng, và thời điểm đồng ý được lưu (FR-3, NFR-8)
**And** chưa đồng ý thì mọi API ngoài màn đồng ý và đăng xuất trả `CONSENT_REQUIRED`; bấm "Không đồng ý" thì đăng xuất, quay về trang trước với thông báo "Bạn cần đồng ý để dùng Tickee."

**Given** OTP đúng
**When** đăng nhập thành công
**Then** session lưu DB; cookie `httpOnly`, `Secure`, `SameSite=Lax` trên domain cha; API ở `api.<domain>` chỉ cho CORS từ origin web (AD-19)
**And** tôi được chuyển về đúng `returnTo` trong URL nếu có (chỉ chấp nhận đường dẫn nội bộ), không thì về trang chủ

**Given** đã đăng nhập
**When** tôi bấm "Đăng xuất" ở menu tài khoản
**Then** session bị hủy ở server và cookie bị xóa

### Story 1.4: Đăng nhập bằng Google

As a người mua đang vội,
I want đăng nhập một chạm bằng Google,
So that tôi không phải chờ mã email.

**Acceptance Criteria:**

**Given** màn đăng nhập
**When** xem bố cục
**Then** có `google-signin-button` "Tiếp tục với Google" ở trên, ngăn với ô email OTP bằng `Separator` "hoặc" (UX-DR9)

**Given** tôi bấm "Tiếp tục với Google" và đồng ý trên Google
**When** quay về Tickee
**Then** tôi được đăng nhập và chuyển về đúng `returnTo`
**And** tài khoản mới vẫn phải đồng ý NĐ 13 như Story 1.3

**Given** email Google trùng email đã đăng ký bằng OTP
**When** đăng nhập bằng Google
**Then** vẫn là cùng một Tài khoản Tickee, không tạo bản ghi user thứ hai (FR-1)
**And** chiều ngược lại (đăng ký Google trước, sau đó dùng OTP) cũng ra cùng tài khoản
**And** chỉ tự liên kết khi Google trả `email_verified = true`; email chưa xác minh thì từ chối đăng nhập Google với thông báo "Email Google chưa được xác minh. Hãy dùng mã qua email.", không tạo hay nối tài khoản
**And** Tickee không lưu token của Google (`access_token`, `refresh_token`, `id_token` luôn null); `users.name` lấy theo Google

**Given** tôi hủy giữa chừng trên màn Google
**When** quay về Tickee
**Then** tôi ở lại màn đăng nhập, không có thông báo lỗi đỏ (UX-DR14)

## Epic 2: BTC thiết lập và mở bán Sự kiện

Owner tạo BTC, bật TOTP, mời Admin, liên kết tài khoản nhận tiền và được Quản trị Tingee duyệt vào Closed Beta. Owner/Admin tạo Sự kiện, Hạng vé, form mua vé, mở bán và chia sẻ trang Sự kiện công khai có OG preview. Epic dựng guard quyền, audit, cách ly BTC và nguồn trạng thái bán mà mọi epic sau dựa vào.

### Story 2.1: Tạo BTC và khung dashboard

As a người dùng đã đăng nhập,
I want tạo BTC của mình và vào dashboard với vai Owner,
So that tôi bắt đầu chuẩn bị bán Vé cho CLB.

**Acceptance Criteria:**

**Given** tôi đã đăng nhập và chưa thuộc BTC nào
**When** tôi nhập tên BTC (và kênh liên hệ BTC) rồi bấm "Tạo BTC"
**Then** hệ thống tạo `organizations` và `members` (role `owner`) trong một transaction; unique index một phần bảo đảm mỗi BTC có đúng một Owner (FR-2, AD-26)
**And** `audit.record(tx, …)` ghi actor, `organization_id`, hành động, đối tượng, tên trường đổi, không ghi giá trị PII; role `tickee_app` không có UPDATE/DELETE trên `audit_events` (AD-18)

**Given** `platform` khai báo cổng `AccessResolver` và decorator `@RequirePermission(perm)`, `organizer` cài đặt cổng
**When** một request tới `/v1/orgs/:orgId/…`
**Then** guard dựng `ctx = { userId, organizationId, role, assignedEventIds, stepUpAt }` trước controller; ma trận quyền FR-4 và enum quyền khai báo một lần trong `packages/contracts`
**And** người không phải thành viên nhận `NOT_A_MEMBER`, sai vai nhận `FORBIDDEN_ROLE` (FR-4)

**Given** dữ liệu của hai BTC khác nhau
**When** chạy bộ test cách ly trong CI
**Then** bộ test đi qua mọi route có `@RequirePermission` và khẳng định thành viên BTC A không đọc hoặc ghi được dữ liệu BTC B; mọi bảng thuộc BTC có `organization_id NOT NULL` và truy vấn đi qua `orgScope(ctx)` (AD-13, NFR-7)
**And** route mới thêm ở các story sau tự động nằm trong bộ test này

**Given** tôi thuộc một hoặc nhiều BTC
**When** mở dashboard
**Then** `GET /v1/me/memberships` trả vai trò ở từng BTC; ≥ `lg` có `dashboard-sidebar` với BTC switcher ở đầu; < `md` có `bottom-tab-bar` (Sự kiện · Cần xử lý · Quét vé · Thêm); `md`–`lg` sidebar thu thành icon (UX-DR34)
**And** đổi BTC trong switcher đưa về danh sách Sự kiện của BTC đó; mục chỉ dành cho Owner bị ẩn với Admin
**And** danh sách Sự kiện trống hiện `empty-state` "Chưa có Sự kiện nào." + "Tạo Sự kiện"
**And** cuối BTC switcher có mục "Tạo BTC mới", mở cùng màn tạo BTC; người đã thuộc BTC khác vẫn tạo được BTC mới và trở thành Owner của BTC đó (FR-2)

### Story 2.2: TOTP cho Owner

As a Owner,
I want bật xác thực hai lớp bằng ứng dụng TOTP,
So that không ai chiếm được tài khoản nhận tiền của BTC chỉ bằng email.

**Acceptance Criteria:**

**Given** tôi vừa trở thành Owner và chưa đăng ký TOTP
**When** tôi gọi bất kỳ API nào với vai Owner
**Then** API trả `TOTP_REQUIRED` và web đưa tôi tới màn đăng ký TOTP: mã QR + khóa nhập tay, nhập mã 6 số để xác nhận (Better Auth `twoFactor`, `allowPasswordless: true`) (FR-1, NFR-6, UX-DR42)

**Given** tôi đã đăng ký TOTP và đăng nhập bằng Google hoặc OTP email
**When** request với vai Owner mà session chưa có step-up hoặc step-up đã quá 12 giờ
**Then** API trả `TOTP_REQUIRED`; web hiện màn step-up nhập mã TOTP; xác nhận đúng thì ghi `stepUpAt` vào session và thử lại thao tác dở (AD-26)
**And** sai mã hiện lỗi tại ô, không mất thao tác đang làm
**And** xác minh TOTP có giới hạn tốc độ: sai 5 lần liên tiếp thì khóa xác minh 15 phút theo user; ghi audit

**Given** luật `TOTP_REQUIRED`
**When** Owner chưa đăng ký hoặc chưa step-up gọi API
**Then** các endpoint sau được miễn: đăng ký TOTP (enroll, verify enroll), step-up, dùng mã khôi phục, đăng xuất, `GET /v1/me/memberships`, `GET /v1/me`; danh sách miễn khai báo một chỗ trong `packages/contracts` và có test

**Given** tôi vừa đăng ký TOTP thành công
**When** màn xác nhận hiện
**Then** hệ thống sinh 10 mã khôi phục dùng một lần (DB chỉ lưu hash), hiện một lần duy nhất kèm nút "Tải xuống" và "Sao chép", và yêu cầu tôi xác nhận "Tôi đã lưu mã khôi phục" trước khi tiếp tục

**Given** tôi mất thiết bị TOTP
**When** nhập một mã khôi phục ở màn step-up
**Then** step-up thành công, mã đó hết hiệu lực, tôi được đưa tới màn đăng ký lại TOTP; audit ghi lại và email báo cho tôi

**Given** tôi mất cả thiết bị TOTP lẫn mã khôi phục
**When** liên hệ Tingee
**Then** Quản trị Tingee (đã step-up) có thao tác "Đặt lại TOTP" cho một user ở `/admin`, bắt buộc ghi lý do; TOTP và mã khôi phục cũ bị xóa, mọi phiên của user bị hủy, user phải đăng ký lại ở lần đăng nhập kế tiếp; audit ghi lại và email báo cho user và các Owner/Admin của BTC liên quan

**Given** tôi là Admin hoặc chỉ là Người mua
**When** dùng Tickee
**Then** không bị yêu cầu TOTP

### Story 2.3: Landing BTC

As a chủ nhiệm CLB biết đến Tickee qua Tingee,
I want một trang giới thiệu nói rõ lợi ích và cho tôi đăng ký Closed Beta,
So that tôi quyết định thử Tickee trong vài giây.

**Acceptance Criteria:**

**Given** khách mở `/`
**When** trang tải
**Then** hiện `landing-hero` (stage, tiêu đề `display` có một cụm từ nhấn coral, 4 `value-tile`: tiền về thẳng tài khoản, phí thấp, tạo trong vài phút, tự khớp giao dịch), các section theo hành trình BTC, và CTA cuối trang (UX-DR43)

**Given** khách chưa đăng nhập
**When** bấm "Đăng ký Closed Beta"
**Then** vào màn đăng nhập với `returnTo` là màn tạo BTC; đăng nhập xong vào thẳng màn tạo BTC (Story 2.1)
**And** đã đăng nhập nhưng chưa có BTC thì bỏ qua đăng nhập, vào thẳng màn tạo BTC

**Given** người dùng đã thuộc ít nhất một BTC
**When** mở `/`
**Then** CTA đổi thành "Vào dashboard"

### Story 2.4: Mời và xóa Admin

As a Owner,
I want mời người khác làm Admin và xóa họ khi cần,
So that tôi có người cùng quản lý Sự kiện mà không giao quyền tiền.

**Acceptance Criteria:**

**Given** tôi là Owner ở trang Thành viên
**When** tôi nhập email và bấm "Mời"
**Then** hệ thống tạo lời mời có token ngẫu nhiên (DB lưu hash) và hạn dùng, enqueue job gửi email bằng chính `tx` (pg-boss, `fromDrizzle(tx)`, payload chỉ chứa id, handler idempotent, hết retry vào dead-letter) (FR-2, AD-12)
**And** audit ghi thao tác mời

**Given** người được mời mở link
**When** họ đăng nhập (bất kỳ cách nào) bằng tài khoản có cùng email với lời mời và bấm nhận
**Then** họ thành `member` role `admin` của BTC; lời mời hết hiệu lực; audit ghi lại
**And** link hết hạn, đã dùng hoặc sai email hiện thông báo rõ, không tạo thành viên

**Given** tôi là Owner
**When** tôi xóa một Admin
**Then** bản ghi thành viên bị xóa, audit ghi lại; request kế tiếp của người đó vào BTC nhận `NOT_A_MEMBER`
**And** web của người đó hiện `Dialog` "Bạn không còn là thành viên của {BTC}." rồi chuyển sang BTC khác hoặc Vé của tôi (UX-DR40)

**Given** tôi là Admin
**When** tôi mở URL trang Thành viên
**Then** thấy `empty-state` "Chỉ Owner xem được mục này." + nút về Tổng quan; API trả `FORBIDDEN_ROLE` (FR-4)

### Story 2.5: Quản trị Tingee duyệt BTC vào Closed Beta

As a Quản trị Tingee,
I want duyệt hoặc thu hồi trạng thái Closed Beta của BTC,
So that chỉ BTC được tin cậy mới bán được Vé có phí khi chưa có KYC.

**Acceptance Criteria:**

**Given** tài khoản có cờ `platform_admin`
**When** truy cập `/v1/admin/*` hoặc `/admin` của web
**Then** API chỉ nhận request từ dải IP cho phép (cấu hình trusted proxy để lấy đúng IP) và yêu cầu step-up TOTP cho mỗi session; mọi lần đọc dữ liệu qua `platformAdminScope` đều ghi audit (FR-4, AD-26)
**And** tài khoản không có cờ nhận `FORBIDDEN_ROLE`

**Given** cần cấp hoặc thu hồi quyền Quản trị Tingee
**When** người vận hành chạy lệnh CLI `pnpm --filter api admin:grant <email>` hoặc `admin:revoke <email>` (chạy bằng role DB `migrate`, không có trên web)
**Then** cờ `platform_admin` được bật/tắt cho đúng user theo email; audit ghi người chạy lệnh, thời điểm, user bị đổi; không có UI hay API nào tự cấp quyền này
**And** dải IP cho phép đọc từ biến env `ADMIN_ALLOWED_CIDRS`, được kiểm bằng schema Zod khi khởi động; thiếu hoặc sai định dạng thì api không khởi động ở production

**Given** BTC mới tạo
**When** xem trạng thái
**Then** `closed_beta_status` = chờ duyệt; dashboard BTC hiện `status-banner` warning "Chờ duyệt Closed Beta" + hướng dẫn liên hệ Tingee, không đóng được (FR-37, UX-DR40)
**And** banner lấy từ `reporting.notices(scope)`, trả `[{code, severity, blocking, dismissible, scope, audience, data, version}]`; enum `code` và thứ tự ưu tiên khai báo trong `packages/contracts`; web chỉ ánh xạ `code` sang nội dung, hiện tối đa 2 banner, còn lại gộp "+N thông báo" mở `Sheet` (AD-34, UX-DR8)

**Given** màn "Duyệt Closed Beta" của Quản trị Tingee
**When** bấm "Duyệt" một BTC
**Then** `closed_beta_status` = đã duyệt, banner biến mất ở dashboard BTC; audit ghi lại
**And** hàng chờ rỗng hiện `empty-state` "Không có BTC chờ duyệt." (UX-DR44)

**Given** BTC đã được duyệt
**When** Quản trị Tingee bấm "Thu hồi" và xác nhận trong `Dialog` "Sự kiện có phí của {BTC} sẽ Tạm ngừng bán."
**Then** `closed_beta_status` = đã thu hồi; dashboard BTC hiện banner danger không đóng được; audit ghi lại (FR-37)

### Story 2.6: Liên kết tài khoản nhận tiền

As a Owner,
I want liên kết tài khoản ngân hàng của CLB qua Tingee,
So that tiền vé chuyển thẳng vào tài khoản của tôi.

**Acceptance Criteria:**

**Given** mô-đun `tingee` là nơi duy nhất gọi Tingee
**When** gọi API Master Merchant / liên kết tài khoản
**Then** adapter ký request (thời gian `yyyyMMddHHmmssSSS` UTC+7), đọc secret chỉ từ env, timeout có giới hạn, đổi mã lỗi Tingee thành lỗi miền (gồm `BANK_NOT_SUPPORTED`, `MERCHANT_SUSPENDED`), đổi giờ UTC+7 thành `timestamptz` (AD-9)
**And** repo có Tingee fake ở `apps/api/test/tingee-fake` giả lập liên kết tài khoản và tạo Merchant con; mọi test tự động (trừ test hợp đồng) dùng fake

**Given** tôi là Owner ở trang Tài khoản nhận tiền
**When** tôi nhập thông tin tài khoản và gửi
**Then** lời gọi Tingee chạy ngoài transaction DB (AD-5); trong lúc chờ, `status-badge` "Đang liên kết", tôi rời trang được và banner cập nhật khi xong
**And** thành công thì `organizer` lưu Merchant con và trạng thái liên kết; dashboard hiện loại QR thanh toán dùng được; chỉ QR tĩnh thì kèm khuyến nghị đổi sang tài khoản hỗ trợ QR động (FR-5, UX-DR40)

**Given** tài khoản thuộc VietinBank (`970415`)
**When** gửi liên kết
**Then** bị từ chối với `BANK_NOT_SUPPORTED` và thông báo rõ tại chỗ (AD-6)

**Given** Tingee trả lỗi
**When** liên kết thất bại
**Then** lỗi tại chỗ nêu lý do hành động được + "Thử lại", dữ liệu đã nhập giữ nguyên; `status-banner` danger "Chưa liên kết tài khoản nhận tiền" vẫn còn
**And** Tickee không lưu số dư hay tiền của BTC

**Given** BTC chưa liên kết
**When** Owner xem dashboard
**Then** thấy banner "Liên kết tài khoản nhận tiền để bán Vé có phí." + "Liên kết ngay"; Admin thấy "Nhờ Owner liên kết tài khoản nhận tiền."; Admin mở trang Tài khoản nhận tiền nhận `empty-state` "Chỉ Owner xem được mục này." (FR-4)

### Story 2.7: Tạo Sự kiện nháp

As a Owner hoặc Admin,
I want tạo Sự kiện với đầy đủ thông tin và chính sách hoàn vé,
So that tôi chuẩn bị trang bán vé cho giải đấu.

**Acceptance Criteria:**

**Given** tôi bấm "Tạo Sự kiện"
**When** mở `wizard-stepper` bước 1 "Thông tin"
**Then** tôi nhập tên, thời gian bắt đầu/kết thúc, địa điểm, mô tả, ảnh và chính sách hoàn vé; "Lưu nháp" ở mọi bước; quay lại bước trước không mất dữ liệu; mobile hiện "Bước 1/4 · Thông tin" (FR-7, UX-DR36)

**Given** tôi chọn ảnh Sự kiện
**When** upload
**Then** web upload thẳng lên object storage S3 bằng presigned URL do API cấp; bucket ảnh bật CORS `GET` cho origin web (AD-22)

**Given** lưu Sự kiện
**When** dữ liệu được ghi
**Then** `events` có `organization_id`, slug duy nhất, `status` = `draft`, thời gian `timestamptz`; `effective_end_at` = max(23:59:59 ngày kết thúc, giờ kết thúc + 6 giờ) theo `Asia/Ho_Chi_Minh` (AD-14, NFR-12)
**And** audit ghi việc tạo

**Given** danh sách Sự kiện của BTC
**When** đã có Sự kiện
**Then** mỗi Sự kiện là `event-card` (thumbnail, tên, ngày-giờ, `status-badge` "Nháp"); chạm cả hàng vào tab Tổng quan của Sự kiện (UX-DR7)

**Given** Sự kiện đang `draft` hoặc slug sai
**When** ai đó gọi API công khai theo slug
**Then** trả cùng `404 EVENT_NOT_FOUND` (AD-27)

### Story 2.8: Hạng vé và tồn kho

As a Owner hoặc Admin,
I want tạo các Hạng vé với giá, số suất và thời gian bán,
So that Người mua chọn đúng loại vé tôi muốn bán.

**Acceptance Criteria:**

**Given** wizard bước 2 "Hạng vé" hoặc tab Hạng vé
**When** tôi thêm Hạng vé (tên, mô tả, giá, số suất, thời gian mở/đóng bán)
**Then** `flows.createTicketType` tạo `ticket_types` (của `event`) và `ticket_type_inventory(capacity, sold, held)` (của `ordering`) trong một transaction, có `CHECK (held >= 0 AND sold >= 0 AND sold + held <= capacity)` (FR-8, AD-2, AD-25)
**And** giá lưu `bigint` theo đồng (NFR-12)

**Given** tôi nhập giá
**When** giá > 0 và < 2.000đ
**Then** không lưu được, lỗi tại trường (AD-6, UX-DR41)

**Given** mọi Hạng vé của Sự kiện có giá 0đ
**When** tổng số suất vượt 200
**Then** không lưu được, báo trần 200 Vé cho Sự kiện miễn phí; phép kiểm khóa mọi dòng tồn kho của Sự kiện `FOR UPDATE` theo thứ tự id rồi mới cộng tổng (FR-11, AD-2)

**Given** Hạng vé đã có
**When** tôi đổi số suất
**Then** `flows.changeCapacity` chạy `UPDATE … SET capacity = :c WHERE … AND sold + held <= :c`; 0 dòng thì lỗi tại trường "Tối thiểu {n} — đã bán và đang giữ chỗ." (FR-8, UX-DR41)

**Given** cài đặt Sự kiện
**When** tôi đặt giới hạn Vé/Đơn
**Then** mặc định 10, lưu ở `event` (FR-12)
**And** mọi thay đổi Hạng vé được ghi audit

### Story 2.9: Cấu hình form mua vé

As a Owner hoặc Admin,
I want thêm câu hỏi riêng vào form mua vé,
So that tôi thu được thông tin cần cho giải (ví dụ "Trình độ").

**Acceptance Criteria:**

**Given** wizard bước 3 "Form mua" hoặc tab Form mua
**When** tôi xem form
**Then** có trường mặc định: Tên, SĐT (chỉ hỏi nếu tài khoản người mua chưa có), email (tự điền từ tài khoản, không sửa được) (FR-9)

**Given** tôi thêm câu hỏi riêng
**When** chọn dạng văn bản hoặc lựa chọn (nhiều phương án), đặt bắt buộc hoặc không, sắp thứ tự
**Then** câu hỏi được lưu với id ổn định; sửa nhãn về sau không làm hỏng câu trả lời của Đơn cũ (câu trả lời sẽ chụp kèm nhãn lúc đặt, AD-35)
**And** thay đổi form được ghi audit

**Given** form đã cấu hình
**When** xem trước ở bước 4
**Then** thấy form đúng như Người mua sẽ thấy

### Story 2.10: Điều kiện mở bán và mở bán Sự kiện

As a Owner hoặc Admin,
I want thấy rõ còn thiếu gì và mở bán khi đủ điều kiện,
So that tôi không bao giờ mở bán một Sự kiện chưa sẵn sàng.

**Acceptance Criteria:**

**Given** `event.publishReadiness(eventId)`
**When** gọi cho một Sự kiện
**Then** trả `[{code, satisfied}]` cho: có chính sách hoàn vé; BTC không bị khóa; và với Hạng vé > 0đ: Closed Beta đã duyệt, đã liên kết tài khoản nhận tiền, giá ≥ 2.000đ (AD-34)

**Given** wizard bước 4 "Xem trước & mở bán"
**When** còn điều kiện chưa đạt
**Then** danh sách nêu từng điều kiện thiếu kèm link sửa nhanh (vd. "Thiếu chính sách hoàn vé — chưa mở bán được." → bước 1); nút "Mở bán" tắt và có lý do hiển thị gần đó (FR-7, FR-37, UX-DR36)

**Given** mọi điều kiện đạt
**When** bấm "Mở bán"
**Then** lệnh gọi lại đúng `publishReadiness` ở server; đạt thì `events.status` `draft` → `published` bằng compare-and-set; audit ghi lại
**And** web hiện link Sự kiện + "Sao chép link" (toast "Đã sao chép")

**Given** `ordering.sellability(eventId)`
**When** gọi cho một Sự kiện
**Then** trả trạng thái bán theo từng Hạng vé và một `eventReason` (Đang bán / Chưa mở bán / Đã đóng bán / Hết vé / Tạm ngừng bán / Ẩn / Bị khóa / Đã hủy / Đã kết thúc), xét: trạng thái và khóa Sự kiện, khóa BTC, Closed Beta và liên kết tài khoản (chỉ Hạng vé > 0đ), chính sách hoàn vé, cửa sổ bán, tồn kho, `payment_service_status` (chỉ Hạng vé > 0đ, mặc định `active`), giới hạn Vé/Đơn (AD-21)
**And** Closed Beta bị thu hồi làm Hạng vé có phí trả "Tạm ngừng bán", Hạng vé 0đ vẫn bán (FR-37)

### Story 2.11: Trang Sự kiện công khai

As a người nhận link trên Zalo,
I want mở trang Sự kiện thật nhanh trên điện thoại và thấy còn bao nhiêu vé,
So that tôi quyết định mua ngay.

**Acceptance Criteria:**

**Given** Sự kiện đã mở bán
**When** mở `/e/{slug}` trên điện thoại, chưa đăng nhập
**Then** phần nội dung tĩnh SSR có cache (revalidate 30 giây, revalidate ngay khi BTC sửa Sự kiện); trang tải dưới 2 giây trên 4G (FR-10, NFR-1, AD-37)
**And** `event-hero` dạng stage: ảnh hoặc nền fallback gradient coral, eyebrow, tên, hàng icon ngày-giờ ("Chủ nhật, 16/11/2026 · 07:00 – 17:00") và địa điểm (chạm mở bản đồ); dưới stage là hàng BTC; nút chia sẻ dùng Web Share API, fallback sao chép link (UX-DR10)

**Given** trang đã tải
**When** web gọi `GET /v1/events/:slug/availability` (gọi `sellability`, cache tối đa 2 giây) lúc tải và khi `visibilitychange`
**Then** mỗi `ticket-tier-row` hiện giá và "Còn N vé" chính xác; ≤ 10 vé thì chữ `brand-text` đậm; Hạng vé không bán được dùng `ticket-tier-row-unavailable` với nhãn "Hết vé" / "Chưa mở bán" (kèm giờ mở) / "Đã đóng bán" (UX-DR11)

**Given** `eventReason` là Tạm ngừng bán, Ẩn, Bị khóa, Đã hủy hoặc Đã kết thúc
**When** trang hiển thị
**Then** `status-banner` tương ứng nằm dưới stage ("Sự kiện tạm dừng nhận Đơn", "Sự kiện tạm thời không nhận Đơn.", "Sự kiện đã hủy", "Sự kiện đã kết thúc"…); Người mua không bao giờ thấy banner hệ thống của BTC (UX-DR13)

**Given** chia sẻ link lên Facebook hoặc Zalo
**When** nền tảng đọc OG
**Then** preview hiện đúng ảnh, tên và thời gian Sự kiện; ảnh OG do `apps/web` sinh (FR-10, AD-11)

**Given** desktop ≥ `lg`
**When** mở trang
**Then** bố cục 2 cột: trái ảnh bìa + mô tả, phải thẻ Hạng vé dính khi cuộn; trạng thái tải dùng `Skeleton` theo bố cục stage + 2 thẻ Hạng vé

**Given** slug sai hoặc Sự kiện nháp
**When** mở `/e/{slug}`
**Then** `empty-state` "Không tìm thấy Sự kiện này. Kiểm tra lại link BTC gửi bạn.", không có nút khám phá

### Story 2.12: Sửa, ẩn và kết thúc sớm Sự kiện

As a Owner hoặc Admin,
I want sửa thông tin, tạm ẩn hoặc kết thúc Sự kiện sớm,
So that tôi kiểm soát được Sự kiện khi kế hoạch thay đổi.

**Acceptance Criteria:**

**Given** Sự kiện bất kỳ trạng thái nào trừ `cancelled`
**When** tôi sửa thông tin ở Cài đặt Sự kiện
**Then** thay đổi được lưu và audit ghi danh sách trường đã đổi (FR-7, NFR-11)
**And** sửa giờ thì `effective_end_at` được tính lại, trừ khi `ended_manually_at` đã có (AD-14)

**Given** Sự kiện `published`
**When** tôi bấm "Ẩn"
**Then** `status` → `hidden` bằng compare-and-set; trang công khai vẫn mở được bằng link nhưng hiện "Sự kiện tạm dừng nhận Đơn" và không mua được; bấm "Hiện lại" thì về `published` (FR-7, AD-27)

**Given** Sự kiện đang diễn ra
**When** tôi bấm "Kết thúc" và xác nhận
**Then** `ended_manually_at` và `effective_end_at` = thời điểm bấm; từ đó `sellability` trả "Đã kết thúc"; sửa giờ về sau không đổi `effective_end_at` (FR-7, AD-14)
**And** "Đã kết thúc" không lưu thành `status` mà luôn tính từ `effective_end_at` tại thời điểm request (AD-27)

### Story 2.13: Đổi tài khoản nhận tiền

As a Owner,
I want đổi sang tài khoản ngân hàng khác của CLB,
So that tiền vé về đúng tài khoản khi CLB đổi ngân hàng mà không phải nhờ Tingee sửa tay.

**Acceptance Criteria:**

**Given** BTC đã liên kết tài khoản nhận tiền
**When** Owner bấm "Đổi tài khoản nhận tiền"
**Then** yêu cầu step-up TOTP mới (không dùng step-up cũ) rồi mới hiện form liên kết như Story 2.6; cùng quy tắc chặn VietinBank và lỗi tại chỗ (FR-5, AD-6, AD-26)

**Given** liên kết tài khoản mới thành công
**When** lưu
**Then** Merchant con mới thành Merchant con hiện hành cho mọi Đơn tạo **sau** thời điểm đổi; Đơn đã có link giữ `orders.sub_merchant_id` cũ, nên IPN và Đối soát bù của các Đơn đó vẫn khớp Merchant con cũ (AD-7)
**And** Merchant con cũ được lưu lại (không xóa) để tra cứu và để nhận diện BTC cho giao dịch `unmatched` về sau
**And** audit ghi người đổi, thời điểm, 4 số cuối tài khoản cũ và mới; email cảnh báo gửi cho Owner và mọi Admin của BTC

**Given** liên kết tài khoản mới thất bại
**When** Tingee trả lỗi
**Then** tài khoản cũ vẫn là tài khoản hiện hành, không gián đoạn bán Vé

**Given** Merchant con cũ bị Tingee vô hiệu trong khi còn Đơn `pending` dùng nó
**When** IPN hoặc Đối soát bù tới cho các Đơn đó
**Then** xử lý như bình thường theo Story 3.5–3.6; nếu tra trạng thái trả `MERCHANT_SUSPENDED` thì Đơn đi theo luồng hết hạn và cảnh báo vận hành, không chặn BTC bán bằng tài khoản mới

**Given** Admin
**When** mở thao tác đổi tài khoản
**Then** không thấy nút; API trả `FORBIDDEN_ROLE` (FR-4)

### Story 2.14: Chuyển quyền Owner

As a Owner,
I want chuyển quyền Owner cho một Admin của BTC,
So that BTC vẫn có người chịu trách nhiệm khi tôi rời CLB hoặc muốn xóa tài khoản.

**Acceptance Criteria:**

**Given** tôi là Owner, BTC có ít nhất một Admin
**When** tôi chọn một Admin ở trang Thành viên và bấm "Chuyển quyền Owner"
**Then** yêu cầu step-up TOTP mới; `Dialog` nêu hậu quả ("{tên} sẽ là Owner, quản lý tài khoản nhận tiền và Token. Bạn sẽ thành Admin.") và yêu cầu gõ tên BTC để xác nhận (FR-2, AD-26)

**Given** đã xác nhận
**When** gọi `flows.transferOwnership(orgId, toUserId)`
**Then** trong một transaction: Owner cũ → `admin`, Admin được chọn → `owner`; unique index "mỗi BTC đúng một Owner" vẫn đúng sau commit (đổi thứ tự cập nhật hoặc dùng ràng buộc deferrable); audit ghi lại (FR-2, AD-26)
**And** email báo cho cả hai người và mọi Admin còn lại

**Given** người nhận chưa đăng ký TOTP
**When** họ dùng vai Owner lần đầu
**Then** gặp luồng bắt buộc đăng ký TOTP của Story 2.2

**Given** BTC không có Admin nào
**When** Owner mở thao tác
**Then** thao tác bị tắt, kèm hướng dẫn "Mời một Admin trước rồi chuyển quyền." (Story 2.4)

## Epic 3: Người mua mua Vé và nhận Vé ngay

Người mua chọn Vé, đăng nhập, điền form một lần, thanh toán qua Tingee Payment Gateway và tự thấy "Thành công" cùng từng Mã QR vé. Vé đến email, nằm trong "Vé của tôi" và chia sẻ được. Sự kiện miễn phí đi trọn luồng không thanh toán. IPN xử lý đủ mọi nhánh của AD-7, không để tiền về mà im lặng. Epic kết thúc bằng khung dashboard tối thiểu để BTC thấy Đơn đầu tiên realtime.

### Story 3.1: Chọn Vé và đăng nhập khi bấm "Mua"

As a Người mua,
I want chọn số Vé theo từng Hạng vé rồi đăng nhập mà không mất lựa chọn,
So that tôi đi tiếp tới bước điền thông tin ngay.

**Acceptance Criteria:**

**Given** trang Sự kiện đang bán
**When** tôi dùng `quantity-stepper` của từng Hạng vé
**Then** stepper bắt đầu ở 0; nút "+" bị chặn ở min(số còn lại, giới hạn Vé/Đơn còn lại của cả Đơn) kèm dòng giải thích ("Tối đa 4 vé mỗi Đơn"); nút có aria-label "Giảm/Tăng số vé {Hạng vé}" (FR-12, UX-DR11)
**And** một Đơn chọn được nhiều Hạng vé

**Given** `purchase-bar` dính đáy (tôn trọng safe-area, `scroll-padding-bottom` để focus không bị che)
**When** tôi đổi số lượng
**Then** tổng tiền cập nhật tức thì; chưa chọn vé thì nút tắt kèm "Chọn vé để tiếp tục"; Sự kiện miễn phí hiện "Miễn phí" và nút "Đăng ký"; mọi Hạng vé hết thì thanh thay bằng thông báo "Hết vé" (UX-DR12)

**Given** tôi chưa đăng nhập
**When** bấm "Mua"
**Then** vào màn đăng nhập với `returnTo` mang Hạng vé và số lượng đã chọn; đăng nhập xong vào thẳng Checkout với đúng lựa chọn đó (FR-3, AD-19)
**And** đã đăng nhập thì vào thẳng Checkout

**Given** bảng `checkout_funnel_events` không chứa PII
**When** tôi bấm "Mua" và khi đăng nhập xong
**Then** ghi `buy_clicked` và `login_completed` (đo SM-C2)

### Story 3.2: Checkout và Giữ chỗ không bao giờ bán quá số suất

As a Người mua,
I want điền form một lần cho cả Đơn và được giữ chỗ ngay,
So that không ai lấy mất vé của tôi trong lúc tôi thanh toán.

**Acceptance Criteria:**

**Given** Checkout
**When** màn hiện
**Then** có tóm tắt Đơn và form của BTC điền một lần cho cả Đơn; email tự điền từ tài khoản; SĐT tự điền nếu tài khoản đã có; dòng ghi rõ "thông tin trong form sẽ được chia sẻ cho {BTC}" (FR-3, FR-9, UX-DR15)
**And** lỗi hiện tại từng trường khi rời trường và khi gửi; trường bắt buộc trống thì không gửi được; cuộn và focus vào trường lỗi đầu tiên; lỗi gắn `aria-describedby`

**Given** tôi bấm "Gửi Đơn"
**When** server xử lý TX1
**Then** gọi lại `sellability` trong TX1; giữ chỗ có điều kiện `UPDATE … SET held = held + :n WHERE … AND sold + held + :n <= capacity` theo `ticket_type_id` tăng dần; một dòng trả 0 thì rollback cả Đơn (FR-13, AD-2)
**And** tạo Đơn `pending` với mã Đơn `TK` + 8 ký tự Crockford base32 (sinh lại tối đa 3 lần nếu trùng), `orders.expires_at` = now + 60 giây, và bản chụp bất biến: `order_items.unit_price`, `orders.total_amount`, tên, SĐT (E.164), email, câu trả lời form kèm nhãn câu hỏi (FR-8, FR-12, AD-20, AD-35)
**And** TX1 không gọi Tingee, không gửi email, không `NOTIFY` (AD-5, AD-17); ghi `order_created` vào `checkout_funnel_events`

**Given** một Hạng vé trong Đơn đã hết
**When** gửi Đơn
**Then** không tạo Đơn; màn báo "Hạng vé {tên} vừa hết. Bạn chọn lại nhé." và quay về trang Sự kiện với số lượng hạng đó về 0, các hạng khác giữ nguyên (FR-13)

**Given** request gửi Đơn kèm `Idempotency-Key`
**When** mạng lỗi và tôi bấm "Thử lại" (cùng khóa)
**Then** `UNIQUE (user_id, idempotency_key)` bảo đảm không tạo Đơn thứ hai; request trùng khóa trả Đơn đã có với trạng thái hiện tại; form giữ nguyên dữ liệu (AD-31, UX-DR15)
**And** mỗi người mua tối đa một Đơn `pending` cho mỗi Sự kiện (unique index một phần); có giới hạn tốc độ tạo Đơn theo user và IP, đếm trong Postgres

**Given** Đơn `pending` chưa có link thanh toán
**When** quá `expires_at`
**Then** job hoãn của `ordering` (`startAfter` = `expires_at`) chuyển Đơn → `expired` bằng compare-and-set `WHERE status='pending' AND payment_link IS NULL AND expires_at < now()` và `held -= n` trong cùng transaction (AD-3, AD-4 (a))
**And** Đơn đã được TX2 gắn link (và `expires_at` đã lùi theo hạn link) thì câu compare-and-set trả 0 dòng và job không làm gì

**Given** tôi đã có một Đơn `pending` cho Sự kiện này
**When** gửi Đơn mới (đổi số lượng hoặc bấm "Mua lại" trước khi Đơn cũ hết hạn)
**Then** API trả `409 PENDING_ORDER_EXISTS` kèm mã Đơn đang có; web chuyển tới `/orders/:code` của Đơn đó với thông báo "Bạn đang có một Đơn chờ thanh toán cho Sự kiện này."

**Given** payload gửi Đơn
**When** server kiểm bằng schema Zod trong `packages/contracts`
**Then** từ chối khi không có dòng nào, khi số lượng một dòng không phải số nguyên ≥ 1, hoặc khi tổng số Vé vượt giới hạn Vé/Đơn của Sự kiện; client sửa request cũng không vượt được

**Given** test Vitest với Postgres thật trong CI
**When** hai Người mua cùng gửi Đơn cho chỗ cuối cùng, và khi Đơn nhiều Hạng vé thiếu chỗ ở một hạng
**Then** đúng một Đơn được giữ chỗ; Đơn thiếu chỗ không giữ bất kỳ hạng nào; `sold + held` không bao giờ vượt `capacity` (FR-13)

### Story 3.3: Đăng ký Sự kiện miễn phí và nhận Vé ngay

As a Người mua Sự kiện miễn phí,
I want gửi Đơn và nhận Vé có Mã QR vé ngay,
So that tôi có vé vào cổng mà không cần thanh toán.

**Acceptance Criteria:**

**Given** Đơn tổng 0đ
**When** gửi Đơn
**Then** trong một transaction: bán có điều kiện `sold += n`, Đơn `pending` → `paid` qua `ordering.markPaid(tx, orderId, 'free', 0)`; không gọi Tingee, không tiêu Token (FR-11, AD-1, AD-2)

**Given** `markPaid` trả `paid`
**When** phát Vé
**Then** tạo N `tickets` (`valid`) với bản chụp `seq` (1..N, `UNIQUE (order_id, seq)`), `order_ticket_count`, `holder_name`, `ticket_type_name`, `order_code`, `issued_at`; ghi audit — tất cả trong cùng transaction (FR-22, AD-35)
**And** Vé chỉ được tạo bên trong `markPaid`; không có đường nào khác phát Vé (AD-1)

**Given** một Vé
**When** sinh Mã QR vé
**Then** nội dung `t<k>.<ticketId>.<sig>`, `sig` = base64url(HMAC-SHA256(key_k, `t<k>.<ticketId>`)), khóa có phiên bản từ env, không chứa thông tin cá nhân (AD-16, NFR-6)

**Given** Đơn đã có Vé
**When** màn "Thành công" hiện
**Then** stage có wordmark, tên Sự kiện, "Vé của bạn đã sẵn sàng!"; mỗi Vé là một `ticket-card` dáng cuống vé (đường xé nét đứt + hai khuyết), nhãn "Mã QR vé · đưa cho CTV ở cổng", QR đen trên tấm trắng tối thiểu 200×200, "Vé k/N", Hạng vé, tên Người mua, ngày-giờ; thẻ đầu chồng mép stage ~30px với hiệu ứng trượt lên và rung nhẹ (tắt khi reduced motion); nút "Xem Vé của tôi"; thông báo `aria-live="polite"` (FR-22, UX-DR18, UX-DR20)

**Given** Sự kiện miễn phí đã phát đủ số suất (tối đa 200)
**When** có người gửi Đơn tiếp
**Then** báo "Hết vé" như Story 3.2

**Given** Sự kiện miễn phí
**When** một Người mua gửi thêm Đơn
**Then** tổng số Vé của Người mua đó trên Sự kiện (cộng mọi Đơn `paid`) không vượt giới hạn Vé/Đơn của Sự kiện; vượt thì báo "Bạn đã nhận đủ số Vé tối đa cho Sự kiện này."; kiểm trong cùng transaction với bán có điều kiện

### Story 3.4: Tạo link thanh toán Gateway và màn thanh toán

As a Người mua Sự kiện có phí,
I want thấy rõ số tiền, người nhận tiền và thời gian giữ chỗ trước khi sang trang thanh toán,
So that tôi yên tâm chuyển tiền.

**Acceptance Criteria:**

**Given** TX1 đã commit một Đơn có phí
**When** server tạo link
**Then** `tingee.createPaymentLink()` gọi `POST /v1/payment-gateway/create-link` ngoài transaction (timeout 5 giây) với `merchantId` = Merchant con của BTC, `orderId` = mã Đơn, `amount` = `orders.total_amount`, `expireInMinute` = 15, `returnUrl` = `/orders/:code`; adapter ký timestamp UNIX ms (FR-16, AD-5, AD-6, AD-9)
**And** TX2 lưu link bằng `WHERE status='pending' AND payment_link IS NULL`, chụp `orders.sub_merchant_id`, đặt `expires_at` = hạn link do Tingee trả; checkout URL chỉ trả cho trình duyệt sau khi TX2 commit; p95 dưới 2 giây (NFR-1)
**And** nếu TX2 cập nhật 0 dòng (job hết hạn 60 giây đã thắng) thì không trả checkout URL; API trả `ORDER_EXPIRED` và web hiện màn Hết hạn của Story 3.7; link Tingee đã tạo tự hết hạn sau 15 phút, tiền nếu vẫn về sẽ đi nhánh tiền về muộn của Story 3.6

**Given** Tingee trả lỗi rõ ràng (không phải timeout)
**When** màn thanh toán hiện
**Then** "Chưa tạo được link thanh toán" + nút "Thử lại" gọi `POST /v1/me/orders/:code/payment-link` cho cùng Đơn trong cửa sổ 60 giây; `recipient-trust-block` và đếm ngược vẫn hiện (UX-DR16)
**And** timeout hoặc kết quả mơ hồ thì không thử lại với cùng `orderId`; Đơn chuyển `expired`, Người mua tạo Đơn mới (AD-5)

**Given** link đã có
**When** màn thanh toán hiện
**Then** stage có số tiền (`amount`), `countdown-chip` "Giữ chỗ còn mm:ss" tính theo `serverNow` (coral, không đổi đỏ, trình đọc màn hình chỉ thông báo ở mốc 5 phút và 1 phút), mã Đơn; `recipient-trust-block` "Tiền chuyển thẳng cho {BTC}"; link chính sách hoàn vé mở trong `Sheet`; chân "Tickee không giữ tiền của bạn" — tất cả thấy được không cần cuộn trên 375×667 (FR-16, UX-DR16)
**And** nút "Thanh toán" mở link Gateway bằng redirect toàn trang, không popup (AD-6)

**Given** Đơn `pending` có link nhưng chưa có xác nhận
**When** quá `expires_at` + 5 phút
**Then** job hoãn chuyển Đơn → `expired` và nhả chỗ (AD-4 (c))

**Given** tạo link trả `MERCHANT_SUSPENDED`
**When** xử lý
**Then** Đơn chuyển `expired`, nhả chỗ, Người mua thấy "Sự kiện tạm ngừng bán. Bạn thử lại sau nhé." (FR-15; bật cờ `payment_service_status` làm ở Epic 4)

**Given** BTC chỉ có QR tĩnh (tài khoản cá nhân không có QR động)
**When** Người mua thanh toán
**Then** vẫn đi cùng luồng Gateway ở trên, Gateway tự khớp giao dịch theo `orderId`; Tickee không tự đối soát theo nội dung chuyển khoản; Giữ chỗ 15 phút; tiền về sau khi Đơn hết hạn xử lý như FR-14 (FR-17, AD-6)
**And** test với Tingee fake có kịch bản Merchant con chỉ có QR tĩnh

### Story 3.5: Nhận IPN và phát Vé đúng một lần

As a Người mua đã chuyển khoản,
I want Vé được phát tự động ngay khi tiền về,
So that tôi không phải gửi ảnh chụp chuyển khoản cho BTC.

**Acceptance Criteria:**

**Given** endpoint IPN công khai, không qua guard đăng nhập người dùng
**When** Tingee gửi IPN
**Then** server đọc raw body, kiểm `x-signature` = `HMAC_SHA512(x-request-timestamp + ':' + rawBody, secret)` bằng `timingSafeEqual`; sai chữ ký hoặc timestamp lệch quá 10 phút thì từ chối và ghi lại (FR-19, NFR-6, AD-7)

**Given** IPN hợp lệ
**When** lưu
**Then** `payment_events` chỉ giữ các field trong whitelist (bỏ dữ liệu ngân hàng của người trả), khóa unique `providerTransactionCode` cho sự kiện thanh toán và `(orderId, status)` cho sự kiện trạng thái; trùng khóa trả thành công mà không làm gì (FR-19, NFR-8)
**And** ghi event và gọi `ordering` trong một transaction, trả `{"code":"00","message":"Success"}` dưới 5 giây

**Given** IPN `success`, Đơn `pending`, `paidAmount` = `total_amount`
**When** xử lý
**Then** (sau khi đi qua thứ tự kiểm của Story 3.6) `markPaid(tx, orderId, 'ipn', paidAmount)` đọc Sự kiện `FOR SHARE`, compare-and-set `pending` → `paid`, `held -= n`, `sold += n`, ghi `paid_amount`, `paid_at` (giờ Tingee báo), phát N Vé như Story 3.3, enqueue email Vé, ghi audit và `checkout_funnel_events` `paid` — trọn gói hoặc không gì (FR-19, NFR-5, AD-1)

**Given** cùng IPN gửi lặp, hoặc hai IPN đến gần như đồng thời
**When** xử lý
**Then** chỉ một lần thắng compare-and-set; không phát thêm Vé, không enqueue thêm email (FR-19)

**Given** IPN `canceled` hoặc `expired` cho Đơn `pending`
**When** xử lý
**Then** `payment` gọi `ordering.markExpired(tx, …)`: Đơn → `expired`, nhả chỗ (AD-4 (b))
**And** IPN `canceled` hoặc `expired` cho Đơn không còn `pending` (đã `paid`, `expired`, `review`, `cancelled`, `refunded`) chỉ được lưu vào `payment_events`, không đổi trạng thái Đơn

**Given** endpoint IPN
**When** cấu hình route
**Then** route được đánh dấu `@Public` (bỏ qua guard đăng nhập người dùng) và dùng raw body parser riêng; body parser JSON toàn cục không áp vào route này; có test xác nhận chữ ký được kiểm trên đúng byte Tingee gửi

**Given** Tingee fake trong test
**When** chạy test tích hợp
**Then** fake ký IPN bằng secret test, phủ: IPN đúng, sai chữ ký, lệch timestamp, lặp, đồng thời

### Story 3.6: IPN cho các trường hợp biên

As a BTC,
I want mọi khoản tiền không khớp đều được ghi lại thành mục cần xử lý,
So that không có khoản tiền nào về tài khoản mà không ai biết.

**Acceptance Criteria:**

**Thứ tự kiểm cố định** cho mọi IPN `success` (và kết quả Đối soát bù ở Story 4.1), dừng ở nhánh đầu tiên khớp:
1. `orderId` không tồn tại → nhánh `unmatched`
2. `merchantId` khác `orders.sub_merchant_id` → nhánh Merchant lệch
3. Sự kiện đã hủy → nhánh `event_cancelled`
4. Đơn `paid`, `cancelled`, `refunded` hoặc `review` → nhánh `duplicate_payment`
5. `paidAmount` ≠ `total_amount` → nhánh `amount_mismatch`
6. Đơn `expired`, hoặc `now()` > `effective_end_at` → nhánh tiền về muộn
7. Đơn `pending` → `markPaid` (Story 3.5)

**Given** IPN `success` với `paidAmount` ≠ `total_amount` cho Đơn `pending` hoặc `expired`
**When** xử lý
**Then** Đơn → `review` loại `amount_mismatch`, `held -= n` nếu Đơn đang `pending`, không phát Vé, tạo `review_item` (`open`) cùng `organization_id` với Đơn trong cùng `tx` (FR-19, FR-21, AD-7)
**And** nhánh này được kiểm trước nhánh tiền về muộn, nên không bao giờ phát Vé khi số tiền lệch

**Given** IPN `success` đúng số tiền cho Đơn `expired`, Sự kiện chưa kết thúc (`now()` ≤ `effective_end_at`) và không bị khóa
**When** mọi Hạng vé trong Đơn còn chỗ
**Then** bán có điều kiện `+n` cho từng Hạng vé theo `ticket_type_id` tăng dần, Đơn → `paid`, phát Vé bình thường (FR-14)
**And** chỉ cần một Hạng vé trả 0 dòng thì rollback toàn bộ phần bán; Đơn → `review` loại `orphan`, không phát Vé (kể cả một phần), enqueue email báo Người mua; không bao giờ phát Vé vượt số suất (FR-14)

**Given** IPN `success` đúng số tiền nhưng Sự kiện đã kết thúc (`now()` > `effective_end_at`), dù Đơn đang `pending` hay `expired`
**When** xử lý
**Then** Đơn → `review` loại `orphan` (nhả `held` nếu còn), không phát Vé; `review_item` ghi lý do "Sự kiện đã kết thúc" để BTC hoàn tiền (FR-14, FR-24)

**Given** IPN `success` cho Đơn `expired` của Sự kiện đang bị khóa (Story 7.4)
**When** xử lý
**Then** Đơn → `review` loại `orphan`, không phát Vé; Đơn `pending` của Sự kiện bị khóa vẫn đi theo `markPaid` bình thường (AD-21, AD-28)

**Given** IPN `success` cho Đơn đã `paid`, `cancelled` (lý do `rejected`), `refunded` hoặc đang `review`
**When** xử lý
**Then** tạo `review_item` loại `duplicate_payment` gắn Đơn, không đổi trạng thái Đơn, không phát Vé

**Given** IPN `success` cho Đơn thuộc Sự kiện đã hủy
**When** xử lý
**Then** tạo `review_item` loại `event_cancelled` gắn Đơn, không phát Vé; Đơn `expired` → `review` loại `event_cancelled`; Đơn đã `cancelled` (`cancel_reason = event_cancelled`) **giữ nguyên** trạng thái, không chuyển sang `review` (AD-7, AD-28)
**And** nhánh này được kiểm trước nhánh `duplicate_payment`, nên một khoản tiền về Đơn bị hủy theo Sự kiện chỉ có một mục, và luôn vào danh sách hoàn tiền của Story 7.2
**And** *Điều chỉnh so với Architecture:* sơ đồ AD-3 không có chuyển `cancelled` → `review`; cần cập nhật bảng AD-7 cho khớp quy tắc "giữ `cancelled`, chỉ tạo `review_item`"

**Given** IPN có `orderId` không tồn tại
**When** xử lý
**Then** lưu `payment_events` với `order_id` null; nếu `merchantId` ứng với Merchant con của một BTC thì tạo `review_item` loại `unmatched` gắn BTC đó và log cảnh báo
**And** nếu `merchantId` không ứng với BTC nào thì không tạo `review_item` (vì `organization_id NOT NULL`), mà đẩy cảnh báo vận hành mức cao kèm id của `payment_events` để Quản trị Tingee xử lý (Story 4.6)

**Given** IPN có `merchantId` khác `orders.sub_merchant_id`
**When** xử lý
**Then** không chạy `markPaid` và không đổi trạng thái Đơn; lưu event; tạo `review_item` loại `unmatched` gắn BTC sở hữu Merchant con đã nhận tiền (nếu xác định được, nếu không thì như nhánh trên); đẩy cảnh báo vận hành (AD-7)
**And** vẫn trả `{"code":"00","message":"Success"}` để Tingee không gửi lại vô hạn; event đã lưu là bằng chứng để xử lý

**Given** `review_items`
**When** tạo mục
**Then** mỗi Đơn tối đa một mục `open` cho mỗi loại, **trừ** `duplicate_payment`: loại này unique theo `(order_id, type, payment_event_id)`, nên mỗi khoản trả trùng là một mục riêng và BTC hoàn đủ từng khoản
**And** mục `duplicate_payment` và `unmatched` chỉ kết thúc bằng `refunded` hoặc `dismissed`
**And** test tích hợp với Tingee fake phủ đủ 7 nhánh của bảng AD-7, cộng các trường hợp: trả trùng hai lần, Đơn `review` nhận thêm tiền, tiền về muộn nhiều Hạng vé thiếu chỗ một hạng, tiền về sau `effective_end_at`, Merchant không ứng với BTC nào

### Story 3.7: Trang Đơn tự chuyển "Thành công" theo thời gian thực

As a Người mua vừa thanh toán xong,
I want quay lại trình duyệt là thấy Vé tự hiện,
So that tôi không phải tải lại trang hay đoán tiền đã về chưa.

**Acceptance Criteria:**

**Given** `platform/realtime`
**When** một thay đổi Đơn commit
**Then** `realtime.notify(tx, topic, ids)` phát Postgres `NOTIFY` trong cùng transaction với payload chỉ `{type, id, organizationId, eventId}`; mỗi instance api giữ một kết nối `LISTEN`, đẩy SSE sau khi lọc theo phạm vi người đăng ký, heartbeat 25 giây; danh mục topic khai báo trong `packages/contracts`; `/readyz` kiểm cả kết nối `LISTEN` (AD-17)
**And** topic `order_changed` chỉ đến Người mua của Đơn (`buyerScope`)

**Given** hook `useLiveResource` duy nhất ở web
**When** dùng trên `/orders/:code`
**Then** gọi `GET /v1/me/orders/:code` khi kết nối, khi nhận tín hiệu (gom trong 1 giây) và khi `visibilitychange` sang visible; không có SSE thì polling 2 giây; không bao giờ tin tham số trên URL `returnUrl` (AD-6, AD-17)

**Given** schema `BuyerOrderView` với `buyerStatus`
**When** trang hiển thị theo trạng thái
**Then** `awaiting_payment`: "Đang chờ thanh toán — vé sẽ tự hiện khi BTC nhận được tiền."; đồng hồ về 0 mà Đơn vẫn `pending`: `confirming` "Đang xác nhận thanh toán"; `expired`: màn Hết hạn "Hết thời gian giữ chỗ. Chỗ đã được trả lại." + "Mua lại" + "Nếu bạn đã chuyển tiền, đừng chuyển lại — kiểm tra Vé của tôi hoặc email."; `under_review`: "BTC đang kiểm tra thanh toán" + liên hệ BTC, không lộ loại hay số tiền lệch (FR-14, UX-DR17, UX-DR19)
**And** `paid`: tự chuyển sang màn "Thành công" của Story 3.3, kèm "Đã gửi Vé tới {email}" (FR-18)
**And** `cancelled_by_organizer` (BTC từ chối ở Story 4.4): badge "Đã hủy" + "BTC đã hủy Đơn này. Liên hệ BTC để được hoàn tiền nếu bạn đã chuyển." + kênh liên hệ BTC
**And** `event_cancelled` (Story 7.1): "Sự kiện đã hủy — BTC sẽ liên hệ hoàn tiền." + kênh liên hệ BTC, không có Mã QR vé (UX-DR17)
**And** `buyerStatus` lạ mà client chưa biết thì hiện trạng thái an toàn "Chúng tôi đang cập nhật trạng thái Đơn." + kênh liên hệ BTC, không bao giờ để màn trống hay kẹt ở màn chờ

**Given** Người mua chờ khoảng 2 phút mà chưa có kết quả
**When** vẫn ở trạng thái chờ
**Then** `reassurance-line` "Nếu bạn đã chuyển, vé sẽ về trong vài phút — đừng chuyển lại." thay dòng chờ, thông báo `polite`; mất mạng thì hiện dòng nhỏ "Mất kết nối — vé vẫn được gửi qua email và Vé của tôi."

**Given** đo từ lúc nhận IPN
**When** trang đang mở có SSE
**Then** Vé hiện trên trình duyệt dưới 3 giây (FR-18, NFR-2)
**And** có test Playwright với Tingee fake cho trường hợp tab ở nền khi IPN tới

### Story 3.8: Email Vé và link chia sẻ Vé

As a Người mua,
I want nhận Vé qua email và gửi từng Vé cho bạn đi cùng,
So that mỗi người tự vào cổng bằng Vé của mình.

**Acceptance Criteria:**

**Given** mỗi Vé
**When** được phát
**Then** có `share_token` ngẫu nhiên 128 bit, DB chỉ lưu hash (AD-29)

**Given** `markPaid` đã enqueue job email Vé
**When** worker xử lý
**Then** gửi qua `EmailTransport` một email cho Người mua, mỗi Vé một link chia sẻ; handler idempotent theo khóa (loại job + order id); lỗi thì tự retry, hết retry vào dead-letter; Vé vẫn hợp lệ dù email lỗi (FR-23, AD-12)
**And** Người mua không thấy lỗi email trên giao diện

**Given** ai đó mở link chia sẻ
**When** gọi `GET /v1/shared-tickets/:token` (không cần đăng nhập, `shareScope`)
**Then** thấy Mã QR vé, tên Sự kiện, Hạng vé, "Vé k/N", trạng thái; không có SĐT, email hay tên Người mua (FR-22, UX-DR22)
**And** Vé đã check-in hiện QR mờ + badge; token sai, Vé đã hủy hoặc quá `effective_end_at` trả `404` chung và web hiện `empty-state` không lộ thông tin
**And** người nhận link không thấy Vé trong "Vé của tôi" của mình

**Given** chủ Vé
**When** bấm "Chia sẻ Vé" trên `ticket-card`
**Then** Web Share API chia sẻ link; fallback sao chép link kèm toast "Đã sao chép"
**And** chủ Vé tạo lại được link; link cũ mất hiệu lực ngay
**And** tạo lại link chỉ thu hồi đường xem, **không** đổi Mã QR vé; `Dialog` xác nhận ghi rõ "Ai đã thấy hoặc chụp mã QR vẫn có thể dùng mã để vào cổng." *(Câu hỏi mở cho Architecture: có thêm `qr_version` vào phần được ký của AD-16 để đổi được mã khi gửi nhầm hay không.)*

### Story 3.9: Vé của tôi và Chi tiết Vé

As a Người mua,
I want một nơi xem mọi Vé và Đơn đang chờ của mình,
So that tôi không bao giờ mất dấu Đơn hay Vé.

**Acceptance Criteria:**

**Given** tôi mở "Vé của tôi"
**When** trang tải
**Then** có ba nhóm: Vé còn hiệu lực · Đơn đang chờ · Lịch sử; tải lần đầu dùng `Skeleton` theo bố cục thẻ; trống hiện "Bạn chưa có vé nào. Vé bạn mua sẽ hiện ở đây." không có nút khám phá (FR-22, UX-DR21)
**And** chỉ thấy dữ liệu của chính tôi (`buyerScope`)

**Given** Đơn `pending`
**When** hiện trong nhóm Đơn đang chờ
**Then** `order-card` (không bao giờ có QR) có đếm ngược theo `serverNow` + "Tiếp tục thanh toán" mở lại đúng Đơn đó, không tạo Đơn mới; đồng hồ về 0 thì thẻ hiện "Đang xác nhận thanh toán" (`confirming`) và vẫn ở nhóm; chỉ khi API trả `buyerStatus` = `expired` (qua `order_changed` hoặc REST) thẻ mới đổi "Hết hạn" rồi rời nhóm (AD-4, UX-DR17)
**And** Đơn `under_review` hiện "BTC đang kiểm tra thanh toán" + kênh liên hệ BTC; Đơn bị từ chối hiện badge "Đã hủy" + liên hệ BTC; thẻ tự cập nhật qua `order_changed`

**Given** Vé hợp lệ
**When** mở Chi tiết Vé
**Then** `ticket-card` + Mã QR vé đầy đủ; tăng độ sáng màn hình nếu trình duyệt cho phép; Vé đã check-in hiện QR mờ (.25) + badge "Đã check-in" (UX-DR20)

**Given** `now()` vượt `effective_end_at` của Sự kiện (so tại request)
**When** mở Vé của tôi
**Then** Vé rời nhóm hiệu lực, chỉ còn hàng lịch sử: tên Sự kiện, ngày, "Đã tham dự"/"Chưa check-in"; Chi tiết Vé không còn Mã QR vé (FR-24, AD-14)
**And** dữ liệu Đơn và Vé phía BTC vẫn còn

**Given** tôi là Người mua
**When** tìm cách tra Vé theo SĐT
**Then** không có chức năng đó (FR-22)

### Story 3.10: Báo Người mua khi Sự kiện đổi giờ hoặc địa điểm

As a Người mua đã có Vé,
I want nhận email khi BTC đổi giờ hoặc địa điểm,
So that tôi không đến sai giờ, sai chỗ.

**Acceptance Criteria:**

**Given** Sự kiện đã phát ít nhất một Vé
**When** Owner/Admin sửa thời gian hoặc địa điểm
**Then** trước khi lưu, `Dialog` báo "Email sẽ được gửi tới {n} Người mua." (FR-7, UX-DR41)
**And** sau khi lưu, enqueue job email trong cùng transaction với khóa idempotent gồm phiên bản Sự kiện, để mỗi lần sửa gửi đúng một lượt (AD-12)

**Given** Sự kiện chưa phát Vé nào, hoặc chỉ sửa trường khác
**When** lưu
**Then** không gửi email

### Story 3.11: Tổng quan Sự kiện thấy Đơn đầu tiên ngay lập tức

As a Owner hoặc Admin,
I want thấy doanh thu và Đơn mới nhất tự cập nhật,
So that tôi biết tiền đã về mà không phải dò sao kê.

**Acceptance Criteria:**

**Given** tab Tổng quan của Sự kiện
**When** trang tải
**Then** có `stat-card` doanh thu (chỉ tính Đơn `paid`, đọc qua read model của `ordering`) và `recent-orders-block` 5 Đơn mới nhất mọi trạng thái: Mã Đơn · Người mua · Vé · Số tiền · Trạng thái (Đơn `review` kèm dòng loại, vd. "Lệch số tiền · nhận 250.000đ / Đơn 300.000đ") · Thời gian; < `md` hiển thị dạng thẻ (FR-31, UX-DR35)
**And** `reporting` chỉ đọc qua view `<module>_read_*` hoặc hàm query xuất từ `index.ts`, không join thẳng bảng mô-đun khác (AD-33)

**Given** một Đơn đổi trạng thái
**When** commit
**Then** topic `event_orders_changed` báo cho Owner/Admin của BTC; `useLiveResource` tải lại; Đơn mới hiện đầu khối và doanh thu nhảy lên không cần reload; không SSE thì polling 10 giây (AD-17)
**And** mất mạng hiện toast một lần "Mất kết nối. Đang thử lại…" và nhãn "Cập nhật lúc HH:MM"

**Given** route mới của Tổng quan
**When** chạy bộ test cách ly
**Then** route nằm trong bộ test; BTC khác không đọc được, CTV không được đăng ký `event_orders_changed`

**Given** phạm vi story này
**When** xem khối "Đơn gần đây"
**Then** khối chưa có link "Xem tất cả Đơn"; link, tab Đơn đầy đủ, bộ lọc và CSV thuộc Epic 6

## Epic 4: Thanh toán đáng tin khi có sự cố

Tiền đã trả không bao giờ bị lạc: Đối soát bù khi IPN trễ hoặc mất, Sự kiện có phí tự "Tạm ngừng bán" khi BTC bị ngắt dịch vụ rồi tự mở lại, BTC xử lý hàng "Cần xử lý" bằng vài thao tác, Owner theo dõi Token, và đội vận hành được cảnh báo trước khi khách phàn nàn. Xong epic này là đạt tiêu chí hoàn thành Phase 1.

### Story 4.1: Đối soát bù khi IPN trễ hoặc mất

As a Người mua đã chuyển khoản,
I want nhận Vé ngay cả khi thông báo từ Tingee bị trễ hoặc thất lạc,
So that tôi không bao giờ trả tiền mà không có Vé.

**Acceptance Criteria:**

**Given** TX2 vừa gắn link cho một Đơn
**When** commit
**Then** enqueue job hoãn để tra trạng thái giao dịch trên Gateway theo `orderId` sau 2 phút, lặp theo backoff đến khi Đơn rời `pending`, và thêm một lần tra tại `expires_at` (FR-20, AD-8)
**And** Đơn đã từng có link mà chuyển `expired` vẫn được tra tiếp thêm 3 lần (sau 30 phút, 2 giờ, 24 giờ kể từ khi hết hạn), để bắt khoản tiền về muộn mà IPN bị mất
**And** mỗi Đơn có số lần tra tối đa; khi tra lỗi hoặc kết quả mơ hồ liên tục vượt mức này, job dừng và đẩy cảnh báo vận hành (Story 4.6) kèm mã Đơn, không lặp vô hạn

**Given** kết quả tra trạng thái
**When** xử lý
**Then** đi qua đúng hàm xử lý IPN của Story 3.5–3.6: cùng whitelist, cùng khóa unique `payment_events`, cùng bảng hành động AD-7; `markPaid` dùng `source` = `reconciliation` (AD-1)
**And** IPN và Đối soát bù cùng đến cho một giao dịch chỉ phát Vé một lần

**Given** tra trạng thái xác nhận Đơn chưa trả và link đã hết hạn
**When** xử lý
**Then** `payment` gọi `ordering.markExpired(tx, …)`, Đơn → `expired`, nhả chỗ (AD-4 (b))

**Given** Tingee fake giả lập IPN không bao giờ tới
**When** chạy test tích hợp
**Then** Vé vẫn được phát qua Đối soát bù; giả lập IPN và Đối soát bù đến đồng thời thì chỉ một lần phát Vé

### Story 4.2: Tự "Tạm ngừng bán" và tự mở lại khi dịch vụ thanh toán của BTC bị ngắt

As a Owner,
I want Sự kiện có phí tự dừng bán khi Tingee ngắt dịch vụ và tự bán lại khi được mở,
So that không ai trả tiền vào lúc tôi không nhận được thông báo giao dịch.

**Acceptance Criteria:**

**Given** `organizer` sở hữu `payment_service_status` (`active` | `suspended`, `reason` `token` | `tingee_disabled`, `since`, `last_checked_at`)
**When** tạo link trả `MERCHANT_SUSPENDED`
**Then** trong transaction bù sau lời gọi, cờ chuyển `suspended`; phát `org_status_changed` (FR-15, AD-32)
**And** `sellability` trả "Tạm ngừng bán" cho mọi Hạng vé > 0đ của BTC; Hạng vé 0đ vẫn bán; trang Sự kiện hiện banner warning "Tạm ngừng bán", stepper và "Mua" tắt

**Given** cờ `suspended`
**When** job dò `tingee.getMerchantServiceStatus()` mỗi 5 phút, hoặc Owner bấm "Kiểm tra lại", hoặc Quản trị Tingee tắt cờ
**Then** dịch vụ đã mở lại thì cờ chuyển `active` và enqueue Đối soát bù cho mọi Đơn còn mở của BTC (FR-20, AD-32)
**And** lời gọi Tingee chạy ngoài transaction, có timeout

**Given** cờ `suspended` lý do Token
**When** Owner/Admin mở dashboard
**Then** `status-banner` danger không đóng được "Mọi Sự kiện có phí đang Tạm ngừng bán" theo thứ tự ưu tiên của `notices`; Owner có hành động "Mua thêm Token" (FR-34, UX-DR40)

**Given** Closed Beta bị thu hồi
**When** tính trạng thái bán
**Then** dùng trường `closed_beta_status` riêng, không dùng cờ này (AD-32)

### Story 4.3: Hàng "Cần xử lý" của BTC

As a Owner hoặc Admin,
I want thấy ngay những Đơn hệ thống không tự phát Vé được,
So that tôi xử lý trước khi khách nhắn hỏi.

**Acceptance Criteria:**

**Given** BTC có `review_items` `open`
**When** mở mục "Cần xử lý" ở sidebar hoặc `bottom-tab-bar`
**Then** thấy hàng gộp mọi Sự kiện của BTC; mỗi mục là `needs-action-row`: `status-badge` loại ("Lệch số tiền", "Thanh toán mồ côi", "Giao dịch chưa khớp", "Thanh toán trùng", "Sự kiện đã hủy"), mã Đơn, Người mua, số tiền nhận / số tiền Đơn (chênh lệch tô `danger-text`), tên Sự kiện (FR-21, UX-DR38)
**And** trống hiện "Không có gì cần xử lý."

**Given** badge số trên "Cần xử lý" và `needs-action-card` ở Tổng quan Sự kiện
**When** có mục mới hoặc mục được xử lý
**Then** topic `org_review_items_changed` làm số cập nhật realtime, không reload (FR-21, AD-17)

**Given** tôi mở một mục
**When** `Sheet` chi tiết hiện
**Then** thấy giao dịch (từ `payment_events`), Đơn liên quan và nhật ký thao tác; dữ liệu đọc qua read model, trong `orgScope` (AD-33)

**Given** route mới
**When** chạy bộ test cách ly
**Then** BTC khác không đọc được mục của BTC này; CTV không truy cập được

### Story 4.4: Duyệt tay, từ chối và đánh dấu đã hoàn tay

As a Owner hoặc Admin,
I want quyết định từng mục Cần xử lý bằng một thao tác,
So that khách được phát Vé hoặc được biết sẽ được hoàn tiền.

**Acceptance Criteria:**

**Given** mục `amount_mismatch` hoặc `orphan` đang `open`
**When** tôi bấm "Duyệt tay phát Vé" (kèm `Idempotency-Key`)
**Then** gọi `markPaid(tx, orderId, 'manual', paidAmount)`; compare-and-set có thêm `AND organization_id = :ctxOrg`; bán có điều kiện `+n`; thành công thì phát Vé, mục `resolved` (`approved`), toast "Đã phát {n} Vé cho Đơn {mã}." (FR-21, AD-3, AD-7, AD-31)
**And** hết chỗ thì Đơn giữ `review`, mục vẫn `open` kèm lý do "hết chỗ"
**And** Sự kiện đã hủy hoặc đã kết thúc (`now()` > `effective_end_at`) thì nút "Duyệt tay phát Vé" bị tắt và API từ chối; chỉ còn "Từ chối" hoặc "Đã hoàn tay"

**Given** mục `unmatched` đang `open` (tiền về không gắn được Đơn, ví dụ Người mua chuyển tiền với mã sai)
**When** tôi bấm "Ghép với Đơn", chọn một Đơn `expired` hoặc `review` của cùng BTC có `total_amount` bằng số tiền nhận, và xác nhận (kèm `Idempotency-Key`)
**Then** trong một transaction: gắn `payment_events.order_id` vào Đơn đó, gọi `markPaid(tx, orderId, 'manual', paidAmount)` với compare-and-set có `AND organization_id = :ctxOrg`, theo đúng quy tắc tồn kho và thứ tự kiểm của Story 3.6; thành công thì phát Vé, mục `resolved` (`approved`) (FR-21, AD-3)
**And** danh sách Đơn để chọn chỉ lấy trong `orgScope`, lọc theo số tiền và Sự kiện; hết chỗ hoặc Sự kiện đã hủy/kết thúc thì không ghép được, mục vẫn `open` kèm lý do
**And** audit ghi id giao dịch, Đơn được ghép, người ghép

**Given** mục đang `open`
**When** tôi bấm "Từ chối" và xác nhận trong `Dialog` nêu hậu quả
**Then** Đơn → `cancelled` với `cancel_reason` = `rejected`, mục `resolved` (`rejected`); Người mua thấy `order-card` "Đã hủy" + liên hệ BTC và nhận email (FR-21)

**Given** Đơn `cancelled` mà khách đã trả tiền
**When** tôi đánh dấu "Đã hoàn tay"
**Then** Đơn → `refunded`; mục liên quan `resolved` (`refunded`) (FR-21)

**Given** mục `duplicate_payment`, hoặc mục `unmatched` không ghép
**When** xử lý
**Then** chỉ có thao tác "Đã hoàn tay" (`refunded`) hoặc "Bỏ qua" (`dismissed`, bắt buộc ghi lý do); không phát Vé (AD-7)
**And** "Đã hoàn tay" trên mục `duplicate_payment` chỉ đóng mục đó; Đơn gốc giữ nguyên trạng thái (Đơn `paid` vẫn `paid`, Vé vẫn hợp lệ, doanh thu không đổi)

**Given** mọi thao tác ở story này
**When** thực hiện
**Then** audit ghi ai làm, lúc nào, quyết định gì; hàng rời hàng đợi và badge giảm realtime (NFR-11)

### Story 4.5: Token và cảnh báo Token

As a Owner,
I want xem số dư và hạn mức Token, đặt ngưỡng cảnh báo,
So that tôi nạp thêm trước khi Sự kiện bị Tạm ngừng bán.

**Acceptance Criteria:**

**Given** trang Token
**When** Owner hoặc Admin mở
**Then** số dư và hạn mức âm hoặc trả sau đọc trực tiếp từ Tingee mỗi lần xem qua adapter (timeout 3 giây), không lưu; lỗi hiện "Chưa đọc được số dư" (FR-34, AD-32)
**And** Admin chỉ xem; nút đặt ngưỡng và "mua thêm Token" chỉ hiện với Owner (FR-4)

**Given** tôi là Owner
**When** đặt ngưỡng cảnh báo
**Then** lưu `token_alert_threshold` của `organizer`; audit ghi lại

**Given** Token khả dụng xuống dưới ngưỡng
**When** hệ thống phát hiện (lúc xem trang Token hoặc job dò định kỳ)
**Then** Owner nhận email và dashboard hiện banner warning đóng được "Token khả dụng dưới ngưỡng cảnh báo." + "Mua thêm Token"; khóa chống gửi lặp theo `(organization, lần vượt ngưỡng)` trong danh mục thông báo của `packages/contracts` (FR-34)

**Given** Owner bấm "Mua thêm Token"
**When** chuyển hướng
**Then** sang luồng mua Token của Tingee; Tickee không tự bán Token

### Story 4.6: Giám sát và lưới an toàn vận hành

As a đội vận hành Tickee,
I want được cảnh báo khi luồng tiền hoặc hàng đợi có dấu hiệu bất thường,
So that chúng tôi xử lý trước khi khách bị ảnh hưởng.

**Acceptance Criteria:**

**Given** api và worker
**When** chạy
**Then** xuất trace và metrics OpenTelemetry; log kèm `requestId`, `organizationId`, mã Đơn, không có secret hay chữ ký (NFR-10)

**Given** các điều kiện: IPN lỗi chữ ký hoặc xử lý lỗi tăng, tỉ lệ phát Vé giảm bất thường, hàng đợi pg-boss ùn hoặc có dead-letter, Đơn `pending` quá hạn chưa xác nhận, p95 tạo link > 2 giây
**When** một điều kiện xảy ra
**Then** cảnh báo được gửi tới đội vận hành (NFR-10)

**Given** job đối chiếu tồn kho định kỳ
**When** chạy
**Then** so `held` với tổng Vé của Đơn `pending`, `sold` với số Vé đã phát; lệch thì cảnh báo, không tự sửa (AD-2)

**Given** quét định kỳ cấp phút
**When** tìm thấy Đơn `pending` đã quá mốc hết hạn mà job hoãn bỏ sót
**Then** xử lý như AD-4 (lưới an toàn)

**Given** Quản trị Tingee ở `/admin`
**When** xem dead-letter queue
**Then** thấy danh sách job lỗi và requeue được từng job; mọi thao tác ghi audit (AD-12)

### Story 4.7: Môi trường staging/production, deploy và diễn tập khôi phục

As a đội vận hành Tickee,
I want deploy an toàn lên staging và production và chứng minh khôi phục được dữ liệu,
So that Checkout, IPN và check-in luôn chạy, và một sự cố DB không làm mất tiền hay Vé.

**Acceptance Criteria:**

**Given** ba môi trường `local` (Tingee fake), `staging` (Tingee UAT), `production` (Tingee PROD)
**When** cấu hình
**Then** mỗi nơi một bộ credential Tingee riêng; secret tiêm từ secret store của nền tảng, danh sách biến khớp schema Zod của `config`; local không nhận IPN thật (AD-36)

**Given** PR được merge vào `main`
**When** CI xanh (thêm Playwright với Tingee fake và bộ test cách ly vào pipeline của Story 1.1)
**Then** staging tự deploy image tag theo commit SHA: vai `migrate` chạy trước, rồi đổi phiên bản `api`/`worker`; migration luôn tương thích ngược (AD-36)

**Given** một tag release
**When** người có quyền bấm deploy production
**Then** deploy thủ công theo tag với cùng trình tự; topology tối thiểu ≥ 2 `api` sau load balancer, ≥ 1 `worker`; load balancer dùng `/readyz` (DB và `LISTEN`) (AD-36, NFR-4)

**Given** đang deploy
**When** instance cũ nhận `SIGTERM`
**Then** ngừng nhận SSE mới, đóng SSE đang mở để client tự nối lại, `boss.stop({ graceful })`; không mất IPN nào trong lúc deploy, kiểm bằng test gửi IPN liên tục trong một lượt deploy staging (AD-36, NFR-4)

**Given** staging
**When** chạy bộ test hợp đồng với Tingee UAT (tạo link, IPN ký thật, tra trạng thái theo `orderId`, liên kết tài khoản)
**Then** bộ test chạy được bằng một lệnh và theo lịch; lỗi thì cảnh báo vận hành (AD-36)

**Given** Postgres production có PITR và failover tự động
**When** cấu hình sao lưu
**Then** RPO ≤ 5 phút, RTO ≤ 1 giờ, giữ 14 ngày (NFR-5)
**And** trước Closed Beta có một lần diễn tập khôi phục về một thời điểm sang môi trường riêng, đo thời gian thực tế và ghi biên bản trong `docs/`; không đạt RTO thì Closed Beta chưa mở

**And** uptime của Checkout, IPN và check-in được đo bằng kiểm tra từ bên ngoài, báo cáo theo tháng so với mục tiêu 99,9% (NFR-4, NFR-10)

## Epic 5: Check-in tại cổng

CTV nhận link mời, quét Vé xanh/đỏ dưới 1 giây, tra tay; Owner/Admin theo dõi check-in realtime và thu hồi CTV. Story cuối: kiểm thử tải NFR-3 trên staging.

### Story 5.1: Link mời CTV và tab Check-in

As a Owner hoặc Admin,
I want tạo một link mời CTV cho Sự kiện và sao chép gửi đi,
So that người soát vé của tôi có quyền vào màn quét mà không cần làm thành viên BTC.

**Acceptance Criteria:**

**Given** Sự kiện đã đăng (`published` hoặc `hidden`) và chưa kết thúc
**When** Owner hoặc Admin mở tab Check-in
**Then** thấy link mời CTV chung với trạng thái còn hạn/hết hạn kèm thời điểm hết hạn, nút "Sao chép link" và "Tạo link mới" (UX-DR39)

**Given** Sự kiện chưa có link đang hoạt động
**When** bấm "Tạo link mới" lần đầu
**Then** tạo bản ghi `checker_invites` với token ngẫu nhiên 128 bit (chỉ lưu `token_hash`), `expires_at` = min(now + 7 ngày, `effective_end_at`); link chỉ hiện trọn một lần sau khi tạo và có thể sao chép lại ngay trong phiên đó (FR-26, AD-30)

**Given** đã có link đang hoạt động
**When** bấm "Tạo link mới"
**Then** link cũ có `revoked_at` trong cùng transaction; mỗi Sự kiện tối đa một link hoạt động (unique index một phần); mở link cũ hiện màn "Link mời đã hết hạn" (AD-30)

**Given** Sự kiện đã kết thúc hoặc bị hủy
**When** mở tab Check-in
**Then** nút "Tạo link mới" bị vô hiệu kèm lý do; link cũ hiện "Đã hết hạn"

**And** mọi thao tác tạo/thu hồi link ghi `audit_events`; endpoint nằm dưới `/v1/orgs/:orgId/events/:eventId/checker-invite` và qua bộ test cách ly BTC (AD-13, AD-26)

### Story 5.2: CTV nhận lời mời

As a CTV,
I want mở link mời, đăng nhập và nhận soát vé,
So that tôi vào thẳng màn quét của đúng Sự kiện được giao.

**Acceptance Criteria:**

**Given** link mời còn hạn
**When** người chưa đăng nhập mở link
**Then** thấy màn xem trước chỉ có tên Sự kiện và tên BTC, nút "Nhận soát vé"; bấm thì sang đăng nhập (OTP email hoặc Google) với `returnTo` quay lại đúng link mời (UX-DR27, AD-30)

**Given** người dùng đã đăng nhập bấm "Nhận soát vé"
**When** gọi `flows.acceptCheckerInvite`
**Then** tạo `checkers(event_id, user_id, status=active)` trong một transaction, kiểm lại hạn link và `effective_end_at` tại request; chuyển vào Màn quét `/(checkin)/events/:eventId` (FR-26)

**Given** người dùng đã là CTV `active` của Sự kiện
**When** mở lại link
**Then** không tạo bản ghi mới, chuyển thẳng vào Màn quét

**Given** người dùng có bản ghi `checkers` `revoked`
**When** nhận lời mời bằng link mới
**Then** trả `CHECKER_REVOKED`, không kích hoạt lại; hiện "Bạn không còn quyền soát vé cho Sự kiện này." (AD-30, UX-DR33)

**Given** link hết hạn, bị thu hồi hoặc token sai
**When** mở link
**Then** hiện "Link mời đã hết hạn. Liên hệ BTC để nhận link mới." và không lộ tên Sự kiện khi token sai (UX-DR27)

**Given** CTV đã nhận
**When** đăng nhập lần sau
**Then** `checkin` cài đặt `AccessResolver` trả `assignedEventIds`; CTV chỉ truy cập được `/v1/checkin/events/:eventId/…` của Sự kiện được giao, không thấy dashboard BTC hay Sự kiện khác; bộ test cách ly có ca CTV truy cập Sự kiện khác → 403 (NFR-7, AD-26)

**And** Owner và Admin của BTC cũng vào được Màn quét của mọi Sự kiện trong BTC mà không cần lời mời (FR-29)

### Story 5.3: Quét Mã QR vé xanh/đỏ

As a CTV,
I want hướng camera vào Mã QR vé và biết ngay vé hợp lệ hay không,
So that hàng người ở cổng đi nhanh và không ai vào bằng vé giả hoặc vé đã dùng.

**Acceptance Criteria:**

**Given** lần đầu vào Màn quét
**When** trình duyệt chưa cấp quyền camera
**Then** hiện màn giải thích có nút "Bật camera" trước khi trình duyệt hỏi; bị từ chối → hướng dẫn bật lại theo Safari iOS/Chrome Android kèm nút "Tra tay" (UX-DR28)

**Given** camera đã bật
**When** ở Màn quét
**Then** `scanner-viewport` chạy liên tục; đỉnh màn hiện tên Sự kiện + số đã check-in; đáy có nút "Tra tay" ở vùng ngón cái; nhận được QR thì khóa quét cho tới khi kết quả đóng (UX-DR29)

**Given** client đọc được một mã
**When** gửi `POST /v1/checkin/events/:eventId/scans` với `{code, scanId}` (`scanId` UUID client sinh)
**Then** server kiểm chữ ký HMAC với khóa phiên bản `k` trước (khóa cũ còn verify được), sai → `BAD_SIGNATURE` mà không truy vấn DB; đúng → `ticketing.checkIn(tx, ticketId, eventId, userId, scanId)` gọi `event.assertCheckinOpen` rồi UPDATE có điều kiện (AD-15, AD-16)

**Given** UPDATE trả 1 dòng
**When** hiện kết quả
**Then** `scan-result-overlay` xanh toàn màn: icon tích tròn 96px, "Thành công", "{tên} · Vé k/N · {Hạng vé}" lấy từ bản chụp trên Vé, tiếng bíp nhẹ, tự đóng sau ~1,5 giây (FR-27, UX-DR30, AD-35)

**Given** UPDATE trả 0 dòng
**When** đọc lại Vé
**Then** cùng `scanId` → trả lại đúng kết quả lần đầu; cùng người quét trong 60 giây → kết quả trung tính "Bạn vừa check-in Vé này"; đã check-in bởi lượt khác → đỏ "Đã check-in lúc HH:MM · bởi {người}"; Vé `cancelled`, của Sự kiện khác, Sự kiện đã kết thúc → đỏ "Vé không hợp lệ" + một dòng lý do theo `ScanResult` (`CANCELLED`, `VOIDED`, `OTHER_EVENT`, `EVENT_ENDED`…) (FR-27, FR-28, AD-15)

**Given** kết quả đỏ
**When** hiển thị
**Then** `scan-danger`, icon X bát giác, có âm thanh, giữ tới khi chạm "Chạm để quét tiếp"; mọi kết quả đọc bằng `aria-live="assertive"`; reduced motion → hiện tức thì (UX-DR30)

**And** response quét không bao giờ chứa Mã QR vé, SĐT hay email; schema `ScanResult` trong `packages/contracts` (AD-15)
**And** p95 thời gian từ lúc gửi tới lúc nhận kết quả < 1 giây ở staging, có metric riêng (NFR-2)

### Story 5.4: Quét song song và mất mạng

As a CTV đứng ở cổng có sóng yếu,
I want kết quả quét luôn đúng kể cả khi mạng chập chờn hoặc đồng nghiệp quét cùng vé,
So that không có "đỏ giả" làm khách bị chặn oan, và không vé nào vào hai lần.

**Acceptance Criteria:**

**Given** request quét không có phản hồi sau 3 giây
**When** client timeout
**Then** hiện `offline-banner` cố định trên cùng "Mất kết nối — chưa quét được", không đóng được; camera tạm dừng (khung mờ 50% + "Camera tạm dừng · tự thử lại"); tự thử lại với cùng `scanId`; tự ẩn khi có mạng (UX-DR31, AD-15)

**Given** request đầu đã check-in thành công nhưng phản hồi bị mất
**When** client thử lại cùng `scanId`
**Then** nhận lại kết quả xanh của lần đầu, không phải đỏ "đã check-in" (AD-15)

**Given** hai CTV quét cùng một Vé gần như đồng thời
**When** cả hai request tới server
**Then** đúng một người thấy xanh, người kia thấy đỏ kèm giờ và tên người quét lần trước (FR-28)

**And** có test tích hợp chạy N request check-in song song (khác `scanId`, khác người quét) trên cùng một Vé với Postgres thật: đúng 1 thành công, `checked_in_at` không đổi sau lượt đầu; và test thử lại cùng `scanId` trả cùng kết quả (FR-28, AD-15)
**And** không có hàng đợi quét offline; khi mất mạng chỉ báo, không ghi nhận cục bộ (ngoài phạm vi MVP)

### Story 5.5: Tra tay và check-in tay

As a CTV, Owner hoặc Admin,
I want tìm Vé theo SĐT hoặc email khi khách không mở được mã,
So that khách hợp lệ vẫn vào được mà tôi không phải đoán.

**Acceptance Criteria:**

**Given** ở Màn quét
**When** bấm "Tra tay"
**Then** `manual-lookup` mở dạng `Sheet` từ dưới lên, ô tìm tự focus, nhãn luôn hiện "SĐT hoặc email Người mua" (UX-DR32)

**Given** tôi gõ SĐT hoặc email
**When** dừng gõ ~200ms
**Then** server chuẩn hóa (SĐT về E.164, email chữ thường + trim) và khớp đầy đủ với thông tin Người mua trên bản chụp Đơn/Vé của Sự kiện này; không khớp một phần; hiện "N Vé khớp" và mỗi hàng gồm tên, Hạng vé · Vé k/N, badge trạng thái, nút "Check-in" (hàng đã check-in không có nút) (FR-29, AD-35)
**And** kết quả không bao giờ có Mã QR vé, SĐT hay email; không có kết quả → "Không tìm thấy Vé khớp."

**Given** tôi bấm "Check-in" trên một hàng
**When** gửi request kèm `Idempotency-Key`
**Then** đi qua cùng `ticketing.checkIn` như quét, tuân quy tắc một lần, `checked_in_by` = người bấm; kết quả hiện bằng cùng `scan-result-overlay` (FR-29, AD-15, AD-31)

**Given** CTV tra trong Sự kiện không được giao
**When** gọi API
**Then** 403; CTV chỉ tra trong Sự kiện được giao (NFR-7)

**Given** một người tra liên tục
**When** vượt giới hạn tốc độ tra tay theo user và IP (đếm trong Postgres)
**Then** trả `429` với thông báo thử lại sau (AD-31)


### Story 5.6: Thu hồi, khôi phục CTV và hết quyền

As a Owner hoặc Admin,
I want thu hồi quyền của một CTV ngay lập tức,
So that người không còn làm việc cho tôi không quét được nữa.

**Acceptance Criteria:**

**Given** tab Check-in
**When** Owner hoặc Admin xem danh sách CTV
**Then** mỗi CTV có tên, email, thời điểm nhận, trạng thái và nút "Thu hồi" (đang hoạt động) hoặc "Khôi phục" (đã thu hồi) (UX-DR39)

**Given** tôi bấm "Thu hồi"
**When** xác nhận
**Then** `checkers.status` = `revoked`, ghi `revoked_by`, `revoked_at` và audit; lượt quét hoặc tra tay kế tiếp của CTV đó trả `CHECKER_REVOKED` vì quyền kiểm lại tại từng request, không cache (FR-26, AD-26)

**Given** CTV bị thu hồi hoặc Sự kiện đã quá `effective_end_at`
**When** CTV quét hoặc mở Màn quét
**Then** hiện màn hết quyền "Bạn không còn quyền soát vé cho Sự kiện này.", thêm "Sự kiện đã kết thúc." khi lý do là `EVENT_ENDED` (UX-DR33, AD-14)

**Given** tôi bấm "Khôi phục"
**When** xác nhận
**Then** `status` = `active`, audit ghi lại; CTV vào lại Màn quét được nếu Sự kiện chưa kết thúc (AD-30)

**And** Admin thu hồi được CTV; mọi endpoint qua bộ test cách ly BTC (AD-13)

### Story 5.7: Theo dõi check-in realtime

As a Owner hoặc Admin,
I want thấy số khách đã vào theo từng Hạng vé ngay khi CTV quét,
So that tôi biết cổng nào đông và còn bao nhiêu người chưa tới.

**Acceptance Criteria:**

**Given** tab Check-in
**When** mở
**Then** `checkin-progress` hiện "đã check-in / tổng Vé hợp lệ" tổng và theo từng Hạng vé, dạng số + thanh tiến độ (FR-30, UX-DR39)

**Given** một Vé được check-in (quét hoặc tay)
**When** transaction commit
**Then** `realtime.notify(tx, 'event_checkins_changed', …)` phát trong cùng transaction; tab Check-in và số ở đỉnh Màn quét của mọi CTV được giao cập nhật qua `useLiveResource` trong ~1 giây, không cần tải lại (FR-30, AD-17)

**Given** SSE bị cắt hoặc tab ẩn rồi hiện lại
**When** `visibilitychange`
**Then** refetch số liệu; mất SSE thì polling dự phòng theo `useLiveResource` (AD-17)

**And** CTV chỉ nhận topic của Sự kiện được giao; Owner/Admin chỉ nhận của BTC mình (NFR-7)

### Story 5.8: Kiểm thử tải NFR-3 trên staging

As a đội Tickee,
I want chứng minh hệ thống chịu được một đợt mở bán đông người trước Closed Beta,
So that chúng tôi biết không bán quá số suất và biết khi nào phải làm phòng chờ.

**Acceptance Criteria:**

**Given** staging với topology tối thiểu (≥ 2 `api`, ≥ 1 `worker`) và Tingee UAT hoặc fake Gateway có độ trễ giống thật
**When** chạy kịch bản tải 5.000 người dùng ảo cùng mua một Sự kiện 300 Vé (tải trang công khai → availability → tạo Đơn → IPN giả lập)
**Then** tổng Vé đã phát ≤ 300, `sold + held` không bao giờ vượt `capacity`, job đối chiếu tồn kho không báo lệch (NFR-3, AD-2)

**Given** cùng lượt chạy
**When** đo
**Then** báo cáo p95 trang công khai, availability, tạo Đơn, tạo link Gateway (< 2 giây) và IPN → Vé hiện trên trình duyệt (< 3 giây); tỉ lệ lỗi 5xx; số request bị giới hạn tốc độ (NFR-1, NFR-2, AD-31, AD-37)

**Given** kịch bản check-in song song (vd. 20 CTV quét 300 Vé, có quét trùng)
**When** chạy
**Then** p95 quét < 1 giây và không Vé nào check-in hai lần (NFR-2, FR-28)

**And** script tải nằm trong repo, chạy lại được bằng một lệnh; kết quả lưu thành báo cáo trong `docs/`
**And** nếu không đạt, báo cáo ghi rõ điểm nghẽn và kích hoạt điều kiện xem lại phòng chờ (AD-37, Câu hỏi mở #5 của PRD)

## Epic 6: Báo cáo Đơn và Google Sheets

Tab Đơn đầy đủ (câu trả lời form, bộ lọc, phân trang, Vé theo Hạng vé), xuất CSV, đồng bộ Google Sheets một chiều.

### Story 6.1: Tab Đơn đầy đủ

As a Owner hoặc Admin,
I want xem toàn bộ Đơn của Sự kiện kèm câu trả lời form và lọc được,
So that tôi tra cứu bất kỳ người mua nào mà không cần mở sao kê hay Sheet.

**Acceptance Criteria:**

**Given** tab Đơn của Sự kiện
**When** mở
**Then** bảng (< `md` là danh sách thẻ) gồm Mã Đơn · Người mua (tên, email, SĐT) · Vé theo Hạng vé · Số tiền · Trạng thái · Thời gian tạo/thanh toán; phân trang `cursor` + `limit`, không cuộn vô hạn (FR-31, UX-DR37, UX-DR46)
**And** dữ liệu đọc từ bản chụp trên Đơn qua read model của `ordering` (AD-33, AD-35)

**Given** tôi mở một Đơn
**When** xem chi tiết dạng `Sheet`
**Then** thấy câu trả lời form kèm nhãn câu hỏi lúc đặt, danh sách Vé (Vé k/N, Hạng vé, trạng thái check-in), lịch sử trạng thái; không hiện Mã QR vé (FR-31, AD-35)

**Given** bộ lọc
**When** chọn trạng thái (Đã thanh toán, Chờ thanh toán, Cần xử lý, Đã hủy, Đã hoàn tay) hoặc gõ mã Đơn/email/SĐT
**Then** danh sách lọc ở server, giữ bộ lọc trên URL; gõ SĐT/email khớp đầy đủ sau chuẩn hóa (FR-31, UX-DR37)

**Given** Sự kiện chưa có Đơn
**When** mở tab
**Then** empty-state "Chưa có Đơn nào. Gửi link Sự kiện để bắt đầu bán." + "Sao chép link" kèm toast "Đã sao chép" (UX-DR37)

**Given** tab Tổng quan
**When** story này xong
**Then** `recent-orders-block` có link "Xem tất cả Đơn" sang tab Đơn; `needs-action-card` dẫn sang tab Đơn đã lọc Cần xử lý (UX-DR35)

**And** route mới nằm trong bộ test cách ly; CTV bị 403 (AD-13, NFR-7)

### Story 6.2: Số liệu Vé theo Hạng vé trên Tổng quan

As a Owner hoặc Admin,
I want thấy mỗi Hạng vé đã bán, đang giữ và còn lại bao nhiêu,
So that tôi biết Hạng vé nào sắp hết để quyết định mở thêm suất.

**Acceptance Criteria:**

**Given** tab Tổng quan
**When** trang tải
**Then** có bảng Vé theo Hạng vé: đã bán · đang giữ chỗ · còn lại / sức chứa, đọc từ `ticket_type_inventory` qua read model (FR-31, AD-2, AD-33)
**And** hàng số liệu đủ bộ theo UX: `stat-card` doanh thu, `stat-card` check-in đã vào/tổng có thanh tiến độ, `needs-action-card` (UX-DR35)

**Given** một Đơn đổi trạng thái hoặc một Vé được check-in
**When** commit
**Then** số liệu cập nhật realtime qua `event_orders_changed` và `event_checkins_changed` bằng `useLiveResource` (AD-17)

**And** doanh thu chỉ tính Đơn `paid` theo `paid_amount`; Đơn `refunded` và `cancelled` không tính (FR-31)

### Story 6.3: Xuất CSV danh sách Đơn

As a Owner hoặc Admin,
I want tải toàn bộ Đơn ra file CSV,
So that tôi đối chiếu hoặc gửi kế toán bằng Excel.

**Acceptance Criteria:**

**Given** tab Đơn
**When** bấm "Xuất CSV"
**Then** tải file chứa mọi Đơn khớp bộ lọc hiện tại, mỗi Đơn một dòng, đủ các trường của danh sách cộng mỗi câu hỏi form một cột (nhãn lúc đặt), cột trạng thái check-in "k/N" (FR-31)

**Given** file CSV
**When** mở bằng Excel
**Then** UTF-8 có BOM, tiếng Việt hiển thị đúng; số tiền là số nguyên VND; thời gian theo `Asia/Ho_Chi_Minh` (NFR-12)
**And** giá trị bắt đầu bằng `=`, `+`, `-`, `@`, tab hoặc CR được thoát để chống CSV injection

**Given** Sự kiện có nhiều Đơn
**When** xuất
**Then** server stream theo cursor, không nạp hết vào bộ nhớ; mã Đơn là `TK…`, không lộ id nội bộ (AD-22)

**And** mỗi lần xuất ghi `audit_events` (ai, Sự kiện, bộ lọc); BTC bị khóa vẫn xuất được (Architecture, câu hỏi mở UX #9)

### Story 6.4: Kết nối Google Sheets

As a Owner hoặc Admin,
I want nối Sự kiện với một Google Sheet,
So that đội của tôi xem danh sách Đơn ở nơi họ đã quen dùng.

**Acceptance Criteria:**

**Given** tab Cài đặt của Sự kiện chưa có kết nối
**When** bấm "Kết nối Google Sheets"
**Then** chạy OAuth riêng với scope `drive.file` (tách khỏi Google đăng nhập); xong thì Tickee tạo một spreadsheet mới trong Drive của người cấp, ghi hàng tiêu đề các cột Tickee quản lý và đẩy toàn bộ Đơn hiện có (FR-32, AD-23)

**Given** refresh token nhận được
**When** lưu
**Then** mã hóa AES-GCM với khóa có phiên bản (ciphertext tiền tố `v<k>:`), không bao giờ log hay trả về web (AD-23, NFR-6)

**Given** kết nối đã tồn tại
**When** xem tab Cài đặt
**Then** thấy link mở Sheet, trạng thái (`active` | `syncing` | `retrying` | `auth_revoked`), `last_synced_at` và nút "Ngắt kết nối"; mỗi Sự kiện tối đa một kết nối (AD-23)

**Given** tôi ngắt kết nối
**When** xác nhận
**Then** xóa token, dừng đồng bộ, Sheet giữ nguyên trong Drive; audit ghi lại

### Story 6.5: Đồng bộ Đơn và check-in lên Sheet trong 1 phút

As a Owner hoặc Admin,
I want Sheet tự cập nhật khi Đơn được thanh toán hoặc khách check-in,
So that số liệu trong Sheet luôn khớp dashboard mà không ai phải sửa tay.

**Acceptance Criteria:**

**Given** Sự kiện có kết nối Sheet
**When** Đơn chuyển `paid`, `review`, `cancelled`, `refunded` hoặc một Vé được check-in
**Then** enqueue `integration.sheet_row_changed {eventId, orderId}` trong cùng transaction (thêm vào `markPaid`, luồng Cần xử lý, hủy Đơn và `ticketing.checkIn`); handler đánh dấu dòng bẩn trong bảng của `integration` (AD-12, AD-23)

**Given** có dòng bẩn
**When** job flush theo Sự kiện chạy (singleton, tối đa một lần mỗi phút)
**Then** tìm dòng theo cột mã Đơn, thiếu thì thêm; chỉ ghi các cột Tickee quản lý, không chạm cột BTC tự thêm; xóa đánh dấu sau khi ghi thành công; thay đổi tới trong lúc throttle không bị mất (FR-32, AD-23)

**Given** BTC chèn, xóa hoặc sắp xếp lại dòng trong Sheet
**When** flush lần sau
**Then** vẫn ghi đúng dòng theo mã Đơn

**Given** Google API lỗi tạm thời hoặc quota
**When** ghi thất bại
**Then** trạng thái `retrying`, ghi `last_error_code`, tự thử lại với backoff; không thông báo cho BTC; hết retry → dead-letter và cảnh báo vận hành (FR-32, AD-12, NFR-10)

**And** test với Google Sheets fake: P95 từ lúc Đơn `paid` tới lúc dòng xuất hiện ≤ 1 phút; dữ liệu đọc qua read model, không join chéo (AD-33)

### Story 6.6: Mất quyền Google Sheets và kết nối lại

As a Owner hoặc Admin,
I want được báo ngay khi Tickee không còn ghi được vào Sheet,
So that tôi kết nối lại trước khi đội mình làm việc với số liệu cũ.

**Acceptance Criteria:**

**Given** Google trả `invalid_grant` hoặc người cấp thu hồi quyền
**When** job flush chạy
**Then** kết nối chuyển `auth_revoked`, dừng thử lại; dòng bẩn vẫn được giữ (AD-23)

**Given** người cấp OAuth bị xóa khỏi BTC
**When** việc xóa commit
**Then** kết nối chuyển `auth_revoked` trong cùng luồng (AD-23)

**Given** kết nối `auth_revoked`
**When** Owner hoặc Admin mở dashboard
**Then** `reporting.notices` trả banner "Mất quyền ghi Google Sheets" kèm "Kết nối lại"; email báo một lần theo khóa chống gửi lặp (FR-32, UX-DR40, AD-34)

**Given** bấm "Kết nối lại"
**When** OAuth xong
**Then** dùng lại spreadsheet cũ nếu người cấp mới truy cập được, không thì tạo Sheet mới; flush mọi dòng bẩn và chuyển `active` (FR-32)

## Epic 7: Niềm tin, an toàn và vòng đời dữ liệu *(bắt buộc trước Closed Beta)*

Người mua báo cáo Sự kiện; Quản trị Tingee khóa/mở khóa Sự kiện hoặc BTC và vô hiệu Vé; BTC hủy Sự kiện kèm danh sách hoàn tiền; người dùng xóa tài khoản hoặc rút đồng ý.

### Story 7.1: Hủy Sự kiện

As a Owner hoặc Admin,
I want hủy Sự kiện khi không thể tổ chức,
So that không ai mua thêm, Vé cũ không vào cổng được và mọi Người mua được báo ngay.

**Acceptance Criteria:**

**Given** Sự kiện `published` hoặc `hidden`
**When** bấm "Hủy Sự kiện"
**Then** `Dialog` nêu hậu quả (ngừng bán, vô hiệu mọi Vé, gửi email cho Người mua, BTC tự hoàn tiền) và yêu cầu gõ đúng tên Sự kiện mới bật nút xác nhận (FR-33, UX-DR41)

**Given** đã xác nhận
**When** gọi `flows.cancelEvent`
**Then** trong một transaction: khóa dòng Sự kiện `FOR UPDATE` và chuyển `cancelled` bằng compare-and-set; Đơn `pending` → `cancelled` (nhả chỗ); Đơn `paid` → `cancelled` với `cancel_reason = event_cancelled`; mọi Vé `valid` (kể cả đã check-in) → `cancelled`; enqueue email cho từng Người mua có Vé; audit ghi lại (FR-33, AD-27, AD-28, NFR-5)
**And** Đơn đang `review` giữ nguyên `review` và loại cũ; `review_item` đang `open` của Đơn đó vẫn mở, nút "Duyệt tay phát Vé" bị tắt (Story 4.4); Đơn có `paid_amount` > 0 vẫn nằm trong danh sách hoàn tiền của Story 7.2

**Given** Sự kiện đã hủy
**When** người mua mở trang công khai, "Vé của tôi" hoặc link chia sẻ Vé
**Then** thấy "Sự kiện đã hủy", Vé hiện trạng thái Đã hủy và không còn Mã QR vé; quét Vé trả đỏ `CANCELLED` (AD-15)

**Given** tiền về cho Đơn của Sự kiện đã hủy sau thời điểm hủy
**When** IPN hoặc Đối soát bù xử lý
**Then** tạo `review_item` loại `event_cancelled`, không phát Vé (AD-7, AD-28)

**And** email hủy có tên Sự kiện, mã Đơn, số tiền đã trả và câu "BTC sẽ liên hệ hoàn tiền"; khóa idempotent theo `(event, order)` (AD-12)
**And** sửa Sự kiện, Hạng vé, link mời CTV đều bị chặn sau khi hủy; có test cho cả luồng hủy trong lúc có Đơn đang `pending`

### Story 7.2: Danh sách hoàn tiền và đánh dấu "Đã hoàn tay"

As a Owner hoặc Admin của Sự kiện đã hủy,
I want danh sách ai đã trả bao nhiêu và đánh dấu từng Đơn khi tôi hoàn xong,
So that tôi không sót người nào và biết lúc nào đã hoàn hết.

**Acceptance Criteria:**

**Given** Sự kiện `cancelled`
**When** mở dashboard của Sự kiện
**Then** banner "{n} Đơn cần hoàn tiền" + "Xuất danh sách hoàn tiền"; `n` là truy vấn động: mọi Đơn có `paid_amount` > 0 của Sự kiện chưa `refunded`, kể cả Đơn có tiền về sau khi hủy (FR-33, UX-DR40, AD-28)

**Given** bấm "Xuất danh sách hoàn tiền"
**When** tải
**Then** CSV gồm Người mua, SĐT, email, số tiền đã trả, mã Đơn, thời điểm thanh toán; cùng chuẩn CSV của Story 6.3 (UTF-8 BOM, chống CSV injection); audit ghi lại (FR-33)

**Given** một Đơn trong danh sách
**When** bấm "Đã hoàn tay" và xác nhận
**Then** Đơn → `refunded` bằng compare-and-set kèm `Idempotency-Key`, ghi người thực hiện và thời điểm; `n` giảm ngay (FR-33, AD-3, AD-31, NFR-11)

**Given** mọi Đơn đã `refunded`
**When** mở dashboard
**Then** banner chuyển sang trạng thái "Đã hoàn tay hết" (UX-DR40)

**And** `review_item` loại `event_cancelled` dùng chung thao tác "Đã hoàn tay" của Story 4.4, nên Đơn đó không bị tính hai lần

### Story 7.3: Người mua báo cáo Sự kiện

As a Người mua,
I want báo cáo một Sự kiện có dấu hiệu lừa đảo hoặc vi phạm,
So that Tingee xem xét trước khi có thêm người mất tiền.

**Acceptance Criteria:**

**Given** trang Sự kiện công khai
**When** bấm "Báo cáo Sự kiện"
**Then** yêu cầu đăng nhập (giữ `returnTo`), rồi mở form chọn lý do (danh mục trong `packages/contracts`) + mô tả (FR-35, UX-DR25)

**Given** gửi form
**When** thành công
**Then** tạo `event_reports(event_id, reporter_user_id, reason, description)`; hiện "Cảm ơn bạn. Tingee sẽ xem xét báo cáo này."; lỗi → giữ nội dung + "Thử lại" (UX-DR25)

**Given** cùng người báo cáo lại cùng Sự kiện
**When** gửi
**Then** mỗi người tối đa một báo cáo mở cho mỗi Sự kiện; có giới hạn tốc độ theo user và IP (AD-31)

**And** BTC không thấy danh tính người báo cáo

### Story 7.4: Quản trị Tingee xem báo cáo và khóa/mở khóa

As a Quản trị Tingee,
I want xem các báo cáo và khóa ngay một Sự kiện hoặc cả BTC,
So that dừng bán ngay khi có dấu hiệu lừa đảo, mà không làm hỏng Vé của người đã mua hợp lệ.

**Acceptance Criteria:**

**Given** `/admin` (desktop, shadcn mặc định, yêu cầu step-up TOTP)
**When** mở mục Báo cáo
**Then** thấy danh sách báo cáo nhóm theo Sự kiện: tên Sự kiện, BTC, số báo cáo, lý do, thời gian, trạng thái xử lý; mở chi tiết thấy nội dung và nhật ký khóa (FR-35, UX-DR44, AD-26)

**Given** bấm "Khóa"
**When** `Dialog` mở
**Then** chọn khóa Sự kiện hay cả BTC, lý do bắt buộc, tùy chọn "Vô hiệu Vé đã phát" (UX-DR44)

**Given** xác nhận khóa
**When** gọi `flows.lockEvent` hoặc `flows.lockOrganization`
**Then** ghi `locked_at`, `locked_by`, `lock_reason` (trục riêng, không đổi `status`); `sellability` trả `eventReason` = "Bị khóa" (trang Sự kiện hiện banner "Sự kiện tạm thời không nhận Đơn." như Story 2.10–2.11, UX-DR13) và tạo Đơn mới bị từ chối ngay; Đơn `pending` vẫn được trả tiền và phát Vé; Vé đã phát vẫn hợp lệ (FR-35, AD-21, AD-27, AD-28)

**Given** BTC bị khóa
**When** Owner hoặc Admin mở dashboard
**Then** banner "Bị khóa" kèm lý do; vẫn xem Đơn, check-in, xuất CSV nhưng không tạo hay mở bán Sự kiện (UX-DR40, Architecture câu hỏi mở UX #9)

**Given** bấm "Mở khóa"
**When** xác nhận
**Then** xóa khóa, `status` giữ nguyên như trước khi khóa; bán lại nếu Sự kiện còn bán được (AD-27)

**And** chi tiết Sự kiện/BTC có badge "Bị khóa" + nhật ký; mọi thao tác ghi `audit_events` (NFR-11)

### Story 7.5: Vô hiệu Vé đã phát

As a Quản trị Tingee,
I want vô hiệu toàn bộ Vé của một Sự kiện lừa đảo,
So that không ai vào cổng bằng Vé đó và Người mua biết để đòi lại tiền.

**Acceptance Criteria:**

**Given** khóa có chọn "Vô hiệu Vé đã phát" hoặc Sự kiện đã khóa
**When** gọi `flows.voidTickets`
**Then** mọi Vé `valid` → `cancelled` với `cancel_reason = voided` trong một transaction; audit ghi số Vé bị vô hiệu (FR-35, AD-28)
**And** phạm vi: khóa một Sự kiện thì chỉ Vé của Sự kiện đó; khóa cả BTC thì Vé của mọi Sự kiện chưa kết thúc của BTC đó; `Dialog` hiện số Vé theo từng Sự kiện trước khi xác nhận

**Given** Đơn `paid` có Vé bị vô hiệu
**When** BTC mở dashboard Sự kiện
**Then** các Đơn này vào danh sách hoàn tiền giống Story 7.2 (banner "{n} Đơn cần hoàn tiền", CSV, "Đã hoàn tay"); doanh thu ở Story 3.11 và 6.2 không tính Đơn có toàn bộ Vé bị `voided`

**Given** Vé đã bị vô hiệu
**When** quét hoặc tra tay
**Then** trả đỏ "Vé không hợp lệ" lý do `VOIDED`; "Vé của tôi" và link chia sẻ hiện Đã hủy, không có Mã QR vé (AD-15)

**Given** vô hiệu xong
**When** commit
**Then** enqueue email cho từng Người mua báo Vé bị vô hiệu bởi Tingee, idempotent theo `(event, order)` (AD-12)

**And** thao tác yêu cầu `Dialog` nêu số Vé sẽ bị vô hiệu và không đảo ngược được

### Story 7.6: Xóa Tài khoản Tickee hoặc rút đồng ý

As a người dùng Tickee,
I want xóa tài khoản hoặc rút lại đồng ý xử lý dữ liệu,
So that dữ liệu cá nhân của tôi không còn được dùng, đúng quyền của tôi theo NĐ 13/2023.

**Acceptance Criteria:**

**Given** trang Tài khoản
**When** bấm "Xóa tài khoản" hoặc "Rút lại đồng ý"
**Then** `Dialog` liệt kê Vé còn hiệu lực của Sự kiện chưa diễn ra và cảnh báo hậu quả trước khi xác nhận (FR-38, UX-DR24)

**Given** người dùng đang là Owner của một BTC hoặc còn Đơn `pending`
**When** xác nhận
**Then** từ chối, báo rõ lý do ("Chuyển quyền Owner trước" kèm link tới thao tác ở Story 2.14 / "Chờ Đơn đang thanh toán kết thúc") (AD-24, UX-DR24)
**And** nếu tôi là Owner của BTC chỉ có mình tôi (không có Admin), thông báo hướng dẫn mời một Admin rồi chuyển quyền, hoặc liên hệ Tingee để đóng BTC

**Given** người dùng có Đơn đang `review` hoặc có Đơn thuộc danh sách hoàn tiền chưa `refunded`
**When** xác nhận xóa
**Then** vẫn cho xóa, nhưng email và SĐT trên các Đơn đó được giữ lại (không ẩn danh) cho tới khi Đơn được `refunded` hoặc mục Cần xử lý đóng, để BTC còn liên hệ hoàn tiền; `Dialog` nói rõ điều này trước khi xác nhận; job ẩn danh chạy lại khi Đơn đóng (NĐ 13 — lưu giữ để thực hiện nghĩa vụ)

**Given** đủ điều kiện
**When** gọi `flows.deleteAccount`
**Then** `identity` vô hiệu đăng nhập và xóa mọi phiên ngay; enqueue `<module>.anonymize_user` cho từng mô-đun có cột cá nhân khai báo trong `packages/contracts`; tư cách Admin/CTV bị gỡ (FR-38, AD-24)

**Given** job `anonymize_user` chạy
**When** xong
**Then** tên, SĐT, email trên Đơn/Vé được thay bằng giá trị ẩn danh; Đơn, `payment_events`, `audit_events` không bị xóa cứng; số tiền, mã Đơn, thời điểm giữ lại ở dạng tối thiểu (FR-38, NFR-8)
**And** người đó không còn trong danh sách Đơn, CSV, Sheets của Sự kiện sắp diễn ra; Vé đã phát vẫn check-in được bằng mã nhưng không tra tay được (AD-24)
**And** handler ẩn danh của mô-đun đồng bộ Sheets enqueue `integration.sheet_row_changed` cho mọi Đơn bị ẩn danh thuộc Sự kiện có kết nối Google Sheets, để lần flush kế tiếp ghi đè các cột tên, SĐT, email trên Sheet bằng giá trị ẩn danh (Story 6.5)
**And** kết nối đang `auth_revoked` thì các dòng này được giữ trong hàng tồn đọng và ghi đè ngay khi BTC kết nối lại (Story 6.6); dashboard của BTC hiện cảnh báo "Có dữ liệu cần cập nhật lên Sheet"

**Given** người dùng đăng nhập lại bằng cùng email sau khi xóa
**When** xác thực
**Then** tạo Tài khoản Tickee mới, không nối với dữ liệu cũ
**And** việc này làm được vì `flows.deleteAccount` đã thay `users.email` của bản ghi cũ bằng giá trị ẩn danh duy nhất và gỡ mọi liên kết Google (`accounts`) ngay khi xóa, không chờ job; unique email không bị trùng

**Given** người dùng chọn "Rút lại đồng ý" (thay vì "Xóa tài khoản")
**When** xác nhận
**Then** hệ quả giống "Xóa tài khoản" ở MVP: đăng nhập bị vô hiệu, dữ liệu cá nhân bị ẩn danh theo cùng các quy tắc trên; `Dialog` nói rõ điều này; thời điểm rút đồng ý được lưu (FR-38, NFR-8)

**And** có test kiểm mỗi cột cá nhân trong danh mục đều có handler ẩn danh; thiếu thì test fail

## Epic 8: Lan truyền *(Should/Could, cắt được)*

Social Ticket Card cho Story; dòng giới thiệu Tickee ở trang Sự kiện và email Vé.

### Story 8.1: Social Ticket Card để đăng Story

As a Người mua,
I want tải một ảnh đẹp về Vé của mình để đăng Story,
So that bạn bè thấy tôi sắp đi Sự kiện mà không ai lấy được Vé của tôi.

**Acceptance Criteria:**

**Given** Chi tiết Vé của một Vé `valid` (trong "Vé của tôi")
**When** xem
**Then** có nút "Tải ảnh Story"; Vé Đã hủy, đã hết hiệu lực hoặc xem qua link chia sẻ không có nút (FR-25, UX-DR23)

**Given** bấm "Tải ảnh Story"
**When** `apps/web` sinh ảnh tại route ảnh của web (cùng cơ chế ảnh OG)
**Then** ảnh PNG 1080×1920 trên nền `stage`: ảnh Sự kiện (nếu có) bo `rounded.lg`, eyebrow, tên Sự kiện, ngày-giờ, địa điểm, Hạng vé, tên BTC, chân wordmark "tickee" + dòng giới thiệu Tickee; không có hình cuống vé (FR-25, UX-DR23, AD-11)

**Given** ảnh được tạo
**When** kiểm nội dung
**Then** không chứa Mã QR vé, mã Vé, mã Đơn, chữ ký hay tên Người mua; route ảnh chỉ nhận `ticketId` của chính người đăng nhập và đọc dữ liệu Sự kiện công khai, Vé không thuộc người dùng → 404 (FR-25, AD-16, NFR-7)
**And** có test kiểm ảnh/props đầu vào không mang trường nào trong danh sách cấm

**Given** trình duyệt hỗ trợ Web Share API có file
**When** ảnh sẵn sàng
**Then** mở bảng chia sẻ hệ thống; không hỗ trợ → tải ảnh về máy (UX-DR23)

**Given** đang tạo ảnh hoặc lỗi
**When** chờ
**Then** spinner trong nút; lỗi → toast "Chưa tạo được ảnh. Thử lại." (UX-DR23)

### Story 8.2: Dòng giới thiệu Tickee

As a Tingee,
I want mỗi trang Sự kiện và email Vé giới thiệu nhẹ Tickee,
So that người mua và BTC khác biết tới Tickee mà không làm phiền trải nghiệm mua.

**Acceptance Criteria:**

**Given** trang Sự kiện công khai
**When** cuộn tới chân trang
**Then** có `tickee-referral-line` với copy trong `packages/contracts` và link về `/` kèm tham số nguồn `utm_source=event_page` (FR-36, UX-DR26)

**Given** email Vé
**When** người mua mở
**Then** chân email có cùng dòng giới thiệu, link `/` kèm `utm_source=ticket_email` (FR-36)

**And** dòng giới thiệu không nằm trên `ticket-card`, màn thanh toán hay Màn quét; dùng `typography.meta`, không cạnh tranh với hành động chính (UX-DR46)
**And** tham số nguồn không chứa thông tin cá nhân hay mã Đơn (NFR-8)
