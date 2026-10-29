# Tickee

Monorepo pnpm + Turborepo theo Structural Seed của Architecture Spine.

```text
apps/web            Next.js — chỉ render, gọi REST /v1 (không DB, không secret)
apps/api            NestJS — một image, ba vai: APP_ROLE=api | worker | migrate
  src/modules/      11 mô-đun miền; gọi nhau chỉ qua modules/<name>/index.ts
  src/flows/        luồng ghi nhiều mô-đun (AD-25)
  src/platform/     config, db (+tx), logging, http, jobs
  drizzle/          migration
  module-graph.cjs  sơ đồ hướng phụ thuộc mô-đun (AD-10) — sửa mũi tên ở đây
packages/contracts  schema Zod, mã lỗi, danh sách cột PII, formatVnd
```

## Yêu cầu

- Node ≥ 26.12.1, pnpm 12.15.0 (`npm i -g pnpm@12.15.0`), Docker.

## Chạy local

```sh
cp .env.example .env
docker compose up -d --wait        # Postgres 18.6 (role tickee_migrator, tickee_app; DB tickee, tickee_test) + Mailpit
pnpm install
pnpm turbo build typecheck

# Migration + schema pgboss + cấp quyền cho tickee_app
APP_ROLE=migrate node --env-file=.env apps/api/dist/main.js

# Chế độ dev: api (http://localhost:3001) + web (http://localhost:3000) + contracts, tự build lại khi sửa code
pnpm dev
# Bộ giao diện "Rạp tối": http://localhost:3000/ui-kit
```

`pnpm dev` chạy `turbo dev` với giao diện TUI: bên trái là danh sách task, bên phải là log của task đang chọn. Dùng phím mũi tên ↑/↓ để đổi task, chuột hoặc `u`/`d` để cuộn log, `q` để thoát.
- api: `tsc --watch` cùng `node --watch` với `APP_ROLE=api`, đọc `.env` ở gốc repo. Log in qua `pino-pretty` (cấu hình ở `apps/api/.pino-prettyrc`), chỉ ở chế độ dev; production vẫn log JSON.
- web: `next dev`, đọc `apps/web/.env.development` (`NEXT_PUBLIC_API_BASE_URL`, `TICKEE_UI_KIT=1`).
- contracts: `tsc --watch`.

Worker không chạy trong `pnpm dev`. Muốn chạy từng vai từ bản build thì dùng các lệnh dưới:

```sh
# API (http://localhost:3001/healthz, /readyz; REST dưới /v1)
APP_ROLE=api node --env-file=.env apps/api/dist/main.js

# Worker (pg-boss, không mở HTTP)
APP_ROLE=worker node --env-file=.env apps/api/dist/main.js

# Web từ bản build (http://localhost:3000)
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 pnpm --filter @tickee/web start
```

Mailpit: SMTP `localhost:1025`, giao diện `http://localhost:8025`.

### Đăng nhập bằng mã OTP ở local

1. Chạy đủ docker compose, api (`APP_ROLE=api`) và web như trên. `.env` cần các biến đăng nhập/email của `.env.example`
   (`BETTER_AUTH_SECRET`, `API_PUBLIC_URL`, `WEB_ORIGIN`, `SMTP_URL`, `EMAIL_FROM`); thiếu thì api dừng và nêu tên biến.
2. Mở `http://localhost:3000/dang-nhap`, nhập email bất kỳ rồi bấm "Gửi mã".
3. Lấy mã 6 số trong Mailpit: `http://localhost:8025` (mọi email gửi ra ở local đều nằm ở đây, không tới hộp thư thật).
4. Nhập mã. Tài khoản mới phải qua màn đồng ý NĐ 13 (`/dong-y`) rồi mới về trang `returnTo`.

Giới hạn gửi mã: 1 lần/60 giây và 5 lần/giờ mỗi email, 20 lần/giờ mỗi IP. Nhập sai quá 15 lần trong 24 giờ thì email
bị khóa cả gửi lẫn xác minh (`OTP_LOCKED`). Muốn thử lại ngay ở local:
`psql postgresql://tickee_migrator:tickee_migrator@localhost:5432/tickee -c 'DELETE FROM otp_send_events; DELETE FROM otp_verify_failures'`.

## Kiểm tra

```sh
pnpm turbo lint:deps               # dependency-cruiser: ranh giới mô-đun (AD-10)
pnpm turbo test --filter @tickee/api   # build trước rồi chạy Vitest với Postgres thật (DB tickee_test, tự chạy migration; email OTP qua transport giả)
docker build -f apps/api/Dockerfile -t tickee-api:dev .
pnpm --filter @tickee/contracts test   # Vitest: formatVnd

# Playwright (WebKit giả lập iPhone, Chromium giả lập Android, 375×667) — chạy trên bản build sẵn.
# NEXT_PUBLIC_API_BASE_URL phải có lúc build (e2e giả lập API bằng page.route nên giá trị nào cũng được).
pnpm --filter @tickee/web exec playwright install chromium webkit   # lần đầu
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 pnpm turbo build --filter @tickee/web
pnpm --filter @tickee/web test:e2e  # tự chạy next start ở cổng 3100 (TICKEE_UI_KIT=1) và 3101 (tắt)
```

Biến môi trường được kiểm bằng Zod theo vai khi khởi động; thiếu/sai thì dừng với mã ≠ 0 và chỉ nêu tên biến.

| Biến                     | Vai         | Ghi chú                        |
| ------------------------ | ----------- | ------------------------------ |
| `APP_ROLE`               | tất cả      | `api` \| `worker` \| `migrate` |
| `NODE_ENV`, `LOG_LEVEL`  | tất cả      | mặc định `development`, `info` |
| `DATABASE_URL`           | api, worker | role `tickee_app` (DML)        |
| `MIGRATION_DATABASE_URL` | migrate     | role `tickee_migrator` (DDL)   |
| `PORT`                   | api         | mặc định `3001`                |
| `TRUST_PROXY_HOPS`       | api         | mặc định `0`; số proxy tin cậy trước api (vd. `1` sau load balancer) để `req.ip` là IP thật — bắt buộc đặt khi có LB, nếu không mọi người dùng chung giới hạn 20 OTP/giờ theo IP của LB |
| `BETTER_AUTH_SECRET`     | api         | ≥ 32 ký tự; ký session/cookie và khóa gốc HMAC bộ đếm OTP |
| `API_PUBLIC_URL`         | api         | origin công khai của api; Better Auth ở `/v1/auth` |
| `WEB_ORIGIN`             | api         | origin duy nhất được CORS kèm cookie |
| `AUTH_COOKIE_DOMAIN`     | api         | tùy chọn; tên miền cha cho cookie session (vd. `tickee.vn`) |
| `SMTP_URL`, `EMAIL_FROM` | api         | gửi email OTP; local là Mailpit `smtp://localhost:1025` |
| `NEXT_PUBLIC_API_BASE_URL` | web       | gốc REST của api; client thêm `/v1`; nhúng lúc build |
| `TICKEE_UI_KIT`          | web         | `1` bật `/ui-kit`; production không đặt (404) |

Nếu volume Postgres đã tồn tại từ trước khi có `docker/postgres/init.sql`, chạy `docker compose down -v` để khởi tạo lại.
