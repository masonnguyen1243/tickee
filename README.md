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

# API (http://localhost:3001/healthz, /readyz; REST dưới /v1)
APP_ROLE=api node --env-file=.env apps/api/dist/main.js

# Worker (pg-boss, không mở HTTP)
APP_ROLE=worker node --env-file=.env apps/api/dist/main.js

# Web (http://localhost:3000). Next chỉ đọc .env trong apps/web, nên truyền biến qua môi trường:
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 TICKEE_UI_KIT=1 pnpm --filter @tickee/web dev
# Bộ giao diện "Rạp tối": http://localhost:3000/ui-kit (chỉ khi TICKEE_UI_KIT=1)
```

Mailpit: SMTP `localhost:1025`, giao diện `http://localhost:8025`.

## Kiểm tra

```sh
pnpm turbo lint:deps               # dependency-cruiser: ranh giới mô-đun (AD-10)
pnpm turbo test --filter @tickee/api   # build trước rồi chạy Vitest với Postgres thật (DB tickee_test, tự chạy migration)
docker build -f apps/api/Dockerfile -t tickee-api:dev .
pnpm --filter @tickee/contracts test   # Vitest: formatVnd

# Playwright (WebKit giả lập iPhone, Chromium giả lập Android, 375×667) — chạy trên bản build sẵn
pnpm --filter @tickee/web exec playwright install chromium webkit   # lần đầu
pnpm turbo build --filter @tickee/web
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
| `NEXT_PUBLIC_API_BASE_URL` | web       | gốc REST của api; client thêm `/v1`; nhúng lúc build |
| `TICKEE_UI_KIT`          | web         | `1` bật `/ui-kit`; production không đặt (404) |

Nếu volume Postgres đã tồn tại từ trước khi có `docker/postgres/init.sql`, chạy `docker compose down -v` để khởi tạo lại.
