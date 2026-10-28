# Epic 1 Context: Nền móng & Tài khoản Tickee

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Dựng nền móng kỹ thuật và giao diện mà mọi epic sau dùng chung: monorepo theo Structural Seed (web, api ba vai, `packages/contracts`), cấu hình, log, CI và hệ thống giao diện "Rạp tối". Trên nền đó, người dùng đăng ký/đăng nhập Tài khoản Tickee bằng Google hoặc OTP email, đồng ý xử lý dữ liệu cá nhân theo NĐ 13/2023, và quay lại đúng trang đang dở qua `returnTo`. Mọi quy ước đặt ra ở epic này (cấu trúc mô-đun, dạng lỗi, token giao diện, component dùng chung) trở thành ràng buộc cho các epic sau, nên phải làm đúng ngay từ đầu.

## Stories

- Story 1.1: Dựng monorepo theo Structural Seed
- Story 1.2: Hệ thống giao diện "Rạp tối" và khung web
- Story 1.3: Đăng nhập bằng OTP qua email
- Story 1.4: Đăng nhập bằng Google

## Requirements & Constraints

- Chỉ hai cách đăng nhập: Google và OTP email. Không có mật khẩu, không có SĐT. Cùng một email luôn là cùng một Tài khoản Tickee, bất kể đăng ký bằng cách nào trước. Chỉ tự liên kết Google khi `email_verified = true`.
- OTP: 6 số, lưu dạng hash, hiệu lực 5 phút, dùng một lần, tối đa 5 lần nhập sai; gửi mã mới vô hiệu mã cũ. Bản ghi user chỉ tạo khi OTP xác minh đúng lần đầu.
- Giới hạn gửi OTP: 1 lần/60 giây, tối đa 5 mã/giờ mỗi email, kèm giới hạn theo IP; đếm trong Postgres.
- Tài khoản mới phải đồng ý NĐ 13/2023 trước khi dùng; lưu thời điểm đồng ý. Chưa đồng ý thì mọi API ngoài màn đồng ý và đăng xuất trả `CONSENT_REQUIRED`.
- `returnTo` chỉ chấp nhận đường dẫn nội bộ (chống open redirect); mặc định về trang chủ.
- Đăng xuất hủy session ở server và xóa cookie.
- Bảo mật: HTTPS toàn bộ; log che SĐT/email, không log secret hay chữ ký; thiếu/sai biến môi trường thì dừng ngay, nêu tên biến nhưng không in giá trị.
- Mobile-first trên Safari iOS và Chrome Android bản hiện hành; mọi chuỗi giao diện tiếng Việt.
- Accessibility WCAG 2.2 AA: focus ring qua `:focus-visible`, vùng chạm ≥ 24px, không chỉ dựa vào màu, nhãn form luôn hiện, dùng được ở 320px không cuộn ngang và 200% chữ, `lang="vi"`, tôn trọng `prefers-reduced-motion`. OTP không phải câu đố nhận thức: hỗ trợ dán và tự điền.
- Owner bắt buộc 2FA và step-up TOTP thuộc Epic 2, không làm ở đây; nhưng cơ chế session của `identity` phải chừa chỗ cho nó.

## Technical Decisions

- **Kiến trúc:** modular monolith. `apps/web` (Next.js) chỉ render và gọi REST `/v1`, không có driver DB hay secret Tingee. `apps/api` (NestJS) build một image chạy vai `api` | `worker` | `migrate` theo env. `migrate` chạy migration Drizzle, khởi tạo schema `pgboss` rồi thoát mã 0. `api` có `/healthz` (liveness) và `/readyz` (DB). Nhận `SIGTERM` thì tắt êm (`boss.stop({ graceful })`).
- **Stack (ghim phiên bản theo bảng Stack):** Node 26, pnpm 12.15, Turborepo 2.11, TypeScript 6.0 strict, Next.js 16.4, React 19.3, Tailwind 4.3, shadcn/ui, TanStack Query 5, NestJS 12.3, Zod 4, PostgreSQL 18.6, Drizzle ORM 0.45 + drizzle-kit 0.31, `pg` 8.23, pg-boss 12.38, Better Auth 1.7 + `@thallesp/nestjs-better-auth` 2.8, pino/`nestjs-pino`, nodemailer, dependency-cruiser 18.7, Vitest 5, Playwright 1.64.
- **Cấu trúc:** `apps/api/src/{modules,flows,platform}`; mô-đun `identity, organizer, event, ordering, payment, ticketing, checkin, reporting, integration, admin, tingee`; `platform` gồm db + tx, access, audit, jobs, realtime, config, logging. Có `apps/api/drizzle/`, `apps/api/test/tingee-fake/`, `docker-compose.yml` (Postgres 18, Mailpit).
- **Ranh giới mô-đun:** mỗi bảng có đúng một mô-đun sở hữu và chỉ mô-đun đó ghi; mô-đun khác gọi qua `modules/<name>/index.ts`. Hướng phụ thuộc theo sơ đồ mô-đun (vd. `organizer → identity`, `integration → identity`), không vòng; CI kiểm bằng dependency-cruiser với luật sinh từ sơ đồ, import sai hướng làm CI đỏ. Mô-đun không gọi `flows`.
- **Danh tính:** `identity` sở hữu user, session, OTP, đồng ý NĐ 13 (sau này cả TOTP và xóa tài khoản). Better Auth là nơi duy nhất cấp session (Google + `emailOTP`, `allowedAttempts` = 5), cấu hình sinh ID UUIDv7 và cột snake_case. Session lưu DB; cookie `httpOnly`, `Secure`, `SameSite=Lax` trên domain cha; API ở `api.<domain>`, CORS chỉ cho origin web. Bật raw body qua `AuthModule.forRoot({ bodyParser: { rawBody: true } })` (IPN cần ở Epic 3).
- **Email:** gửi qua interface `EmailTransport` (SMTP mặc định, Mailpit ở local); không dùng dịch vụ độc quyền của cloud nào.
- **DB:** `db.transaction(async (tx) => …)`, READ COMMITTED, service nhận `tx`. PK UUIDv7 (`uuidv7()` của PG 18). Bảng/cột `snake_case`, tên bảng số nhiều; mọi mốc thời gian `timestamptz`. Hai role: `tickee_migrator` (DDL) và `tickee_app` (DML). drizzle-kit bỏ qua schema `pgboss`. Không gọi HTTP/email bên trong transaction; hiệu ứng phụ là job pg-boss enqueue bằng chính `tx`.
- **API:** REST JSON dưới `/v1`; schema request/response là Zod trong `packages/contracts`, dùng chung web và api. Lỗi `{ "error": { "code", "message", "details" } }`, mã lỗi `UPPER_SNAKE` khai báo trong `packages/contracts`. Header `x-request-id`. `packages/contracts` cũng là nơi chứa quyền, topic, queue, notices, danh mục thông báo và danh sách cột PII.
- **Cấu hình và log:** biến môi trường kiểm bằng schema Zod của `config` khi khởi động; secret không nằm trong repo. Log pino JSON kèm `requestId`, che SĐT/email.
- **Web:** route groups `(public)`, `(buyer)`, `(dashboard)`, `(checkin)`, `(admin)`; API client typed sinh từ `packages/contracts`; TanStack Query phía client; server component chuyển tiếp cookie khi gọi API.
- **CI (GitHub Actions trên mỗi PR):** typecheck, dependency-cruiser, Vitest với Postgres thật trong container, build image gắn tag commit SHA; Playwright với hai project mobile (WebKit giả lập iPhone, Chromium giả lập Android, 375×667).
- **Đo lường:** sự kiện phễu `login_completed` thuộc bảng `checkout_funnel_events` (không PII), được dùng khi luồng mua ở Epic 3 có mặt.

## UX & Interaction Patterns

- **Theme:** biến CSS shadcn ánh xạ bảng Colors của DESIGN.md cho light/dark theo `prefers-color-scheme`, kèm biến riêng `--stage`, `--stage-foreground`, `--stage-muted`, `--bar`, `--brand-text`, các cặp `--success/warning/danger/neutral-(text|subtle)`, `--scan-success`, `--scan-danger`. Không có công tắc theme.
- **Ràng buộc màu:** coral `brand` chỉ trên nền tối; chữ trên coral là `on-brand`; chữ thương hiệu trên nền sáng dùng `brand-text`; không dùng coral báo lỗi (dùng `danger-text`).
- **Typography và token:** chỉ Be Vietnam Pro 400/500/700 (`font-display: swap`) qua `--font-sans`; ô nhập 16px (tránh Safari iOS tự zoom); tiền dạng "300.000đ" qua một hàm dùng chung, `tabular-nums`. Có token bo góc, spacing có tên và elevation (light: bóng ấm không viền; dark: vòng 1px `stage-line`).
- **Component dùng chung:** `button-primary`, `button-primary-on-light` (dark mode hiện như `button-primary`), `button-secondary`, `button-destructive`; nút gọi mạng hiện spinner trong nút, giữ độ rộng, chặn bấm lặp, không disable mà không có lý do. `stage-block`, `status-badge` (luôn có chữ), `status-banner` (4 tone, icon khác hình theo tone, tối đa một hành động), `empty-state` (một câu + tối đa một hành động). Toast `Sonner`, không dùng cho lỗi chặn luồng. Wordmark tạm "tickee" chữ thường 700 kèm ô vuông coral xoay 45°.
- **Màn đăng nhập:** `google-signin-button` "Tiếp tục với Google" (`button-secondary` toàn chiều rộng) ở trên, `Separator` "hoặc", rồi ô email OTP. `otp-input` 6 ô, `autocomplete="one-time-code"`, dán vào ô đầu tự điền đủ, đủ 6 số tự gửi. Trạng thái: "Mã đã gửi tới {email}" + đếm ngược gửi lại; "Mã chưa đúng, còn N lần"; "Mã đã hết hạn" + "Gửi mã mới"; quá giới hạn "Bạn đã yêu cầu quá nhiều mã. Thử lại sau {n} phút."; hủy Google thì ở lại màn, không báo lỗi đỏ; Google chưa xác minh email: "Email Google chưa được xác minh. Hãy dùng mã qua email."
- **Đồng ý NĐ 13:** bấm "Không đồng ý" thì đăng xuất, quay về trang trước kèm "Bạn cần đồng ý để dùng Tickee."
- **Ràng buộc tương tác chung:** một hành động chính mỗi màn, ở vùng ngón cái; không thao tác chỉ-hover; không modal chồng modal; không hỏi "Bạn có chắc?" cho thao tác không phá hủy.

## Cross-Story Dependencies

- Story 1.1 là tiền đề cho mọi story: 1.2 cần khung `apps/web` và pipeline CI; 1.3 cần `platform/db`, `config`, logging, dạng lỗi trong `packages/contracts` và Mailpit.
- Story 1.3 và 1.4 dùng component và token của 1.2 (`otp-input`, `google-signin-button`, nút, toast). Story 1.4 dùng lại luồng đồng ý NĐ 13 và xử lý `returnTo` của 1.3.
- Epic sau phụ thuộc: Epic 2 (tạo BTC, TOTP Owner, landing) cần session và `identity`; Epic 3 dùng `returnTo` để giữ Hạng vé và số lượng đã chọn qua bước đăng nhập; Epic 7 (xóa tài khoản, rút đồng ý) mở rộng `identity`.
- Phụ thuộc ngoài: Google OAuth client cho Story 1.4; nhà cung cấp email thật cho staging/production còn chờ quyết định pháp chế (local dùng Mailpit).
