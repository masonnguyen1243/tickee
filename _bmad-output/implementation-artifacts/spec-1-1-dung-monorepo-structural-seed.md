---
title: 'Story 1.1: Dựng monorepo theo Structural Seed'
type: 'feature'
created: '2026-10-28'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'cad53cef07310eb0e8b3cbd15c173eaaff414d6f'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-tickee-2026-10-28/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Repo chưa có code. Mọi story sau cần chung một monorepo, cùng quy ước DB, config, log, lỗi và CI, nếu không mỗi story sẽ tự dựng một kiểu.

**Approach:** Dựng pnpm + Turborepo monorepo đúng Structural Seed (`apps/web`, `apps/api` ba vai, `packages/contracts`), ghim phiên bản theo bảng Stack, kèm docker-compose, Dockerfile api và GitHub Actions. Chỉ dựng nền móng, chưa có tính năng miền.

## Boundaries & Constraints

**Always:**
- Phiên bản đúng bảng Stack (TypeScript **6.0.3**, không lấy 7.x dù npm `latest` là 7). `packageManager: pnpm@12.15.0`. TS strict ở mọi package.
- Một image `apps/api`, vai chọn bằng `APP_ROLE` = `api` | `worker` | `migrate`. Config kiểm bằng Zod theo vai; lỗi nêu tên biến, không in giá trị.
- `platform/db`: `db.transaction(async (tx) => …)` mức READ COMMITTED; PK mặc định `uuidv7()`; `snake_case`; `timestamptz`.
- Hai role DB: `tickee_migrator` (DDL, dùng ở `migrate`) và `tickee_app` (DML, dùng ở `api`/`worker`). drizzle-kit `schemaFilter` bỏ `pgboss`.
- Lỗi HTTP luôn `{ "error": { "code", "message", "details" } }`; mã lỗi `UPPER_SNAKE` khai báo trong `packages/contracts`.
- Log pino JSON có `requestId` (đọc hoặc sinh `x-request-id`, trả lại trong response header); che email/SĐT theo danh sách cột PII trong `packages/contracts`.
- Sơ đồ hướng phụ thuộc mô-đun (AD-10) khai báo **một lần**; luật dependency-cruiser sinh từ đó.

**Never:**
- Không làm Better Auth, đăng nhập, bảng `users` (Story 1.3), design system/token (Story 1.2), Tingee fake, Playwright, OpenTelemetry, deploy staging.
- Không thêm bảng miền; migration đầu chỉ cần chứng minh role, quyền và `uuidv7()` chạy được.
- Không đặt driver DB hay secret trong `apps/web`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Vai api | `APP_ROLE=api`, env đủ | HTTP mở; `GET /healthz` 200; `GET /readyz` 200 khi DB lên | DB xuống → `/readyz` 503 dạng lỗi chuẩn, `/healthz` vẫn 200 |
| Vai worker | `APP_ROLE=worker` | pg-boss start (`migrate: false`), không mở HTTP | — |
| Vai migrate | `APP_ROLE=migrate` | chạy migration Drizzle, khởi tạo schema `pgboss`, cấp quyền cho `tickee_app`, exit 0 | lỗi migration → exit ≠ 0 |
| Thiếu/sai env | vd. thiếu `DATABASE_URL`, `APP_ROLE=foo` | dừng ngay, exit ≠ 0, message nêu tên biến | không in giá trị secret |
| SIGTERM | tiến trình api/worker đang chạy | đóng HTTP, `boss.stop({ graceful: true })`, exit 0 | — |
| Route lạ | `GET /v1/khong-co` | 404 `{ error: { code: "NOT_FOUND", … } }` | lỗi không bắt được → 500 `INTERNAL_ERROR`, không lộ stack |
| Log PII | log object có `email`/`phone` | giá trị bị che | — |
| Import sai hướng | `modules/identity` import `modules/organizer` | dependency-cruiser exit ≠ 0 | — |

**Quyết định (28/10/2026):**
- DB local: Mason cài Docker; kiểm `docker compose up`, Vitest với PG 18 và `docker build` ngay ở local.
- Toolchain đúng spine: Mason tự nâng Node ≥ 26.12.1 và cài pnpm 12.15.0; `engines.node` = `>=26.12.1`, `.npmrc` `engine-strict=true`.
- Giữ trọn Story 1.1 trong một spec (gồm CI và Dockerfile), chấp nhận spec dài ~3.000 token.

</frozen-after-approval>

## Code Map

- `.gitignore`, `.nvmrc` (26), `.prettierignore` -- đã có từ commit `chores: init`, giữ nguyên.
- `.env.example` -- đã có, thay bằng bộ biến mới (dưới).
- `.npmrc` -- đang rỗng, thêm `engine-strict=true`.
- `.turbo/` -- cache cũ, đã ignore, không đụng.
- `_bmad/`, `_bmad-output/`, `.claude/` -- không đụng.
- Phần còn lại là file mới; repo chưa có `package.json`.

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.npmrc` -- workspace gốc; task turbo `build`, `typecheck`, `test`, `lint:deps`; script `pnpm turbo build`.
- [x] `packages/contracts/src/{errors,pii,index}.ts` -- `ErrorCode` (`NOT_FOUND`, `VALIDATION_FAILED`, `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`), schema Zod `ErrorResponse`, danh sách khóa PII (`email`, `phone`, …); build ra `dist` dùng được từ api và web.
- [x] `apps/api/src/platform/config/` -- schema Zod theo vai (`APP_ROLE`, `DATABASE_URL`, `MIGRATION_DATABASE_URL` chỉ bắt buộc ở `migrate`, `PORT`, `LOG_LEVEL`, `NODE_ENV`); `loadConfig()` ném lỗi chỉ chứa tên biến và lý do.
- [x] `apps/api/src/platform/db/` -- pool `pg`, Drizzle, `transaction()` READ COMMITTED, helper cột `id uuid default uuidv7()` và `timestamptz`.
- [x] `apps/api/src/platform/logging/` -- `nestjs-pino` với `genReqId` theo `x-request-id`, `redact` sinh từ danh sách PII.
- [x] `apps/api/src/platform/http/` -- exception filter toàn cục ra dạng lỗi chuẩn; controller `/healthz`, `/readyz` (`SELECT 1`).
- [x] `apps/api/src/platform/jobs/` -- tạo pg-boss; worker start; stop graceful.
- [x] `apps/api/src/main.ts` + `roles/{api,worker,migrate}.ts` -- dispatch theo `APP_ROLE`; `enableShutdownHooks`; migrate: drizzle `migrate()` → pg-boss khởi tạo schema → `GRANT` cho `tickee_app` → exit 0.
- [x] `apps/api/src/modules/<11 mô-đun>/index.ts`, `apps/api/src/flows/index.ts` -- thư mục rỗng có `index.ts` để giữ cấu trúc seed.
- [x] `apps/api/drizzle/`, `apps/api/drizzle.config.ts` -- migration `0000` (extension không cần; tạo bảng kỹ thuật `_seed_checks` có `id uuidv7`) + `schemaFilter: ['public']`.
- [x] `apps/api/module-graph.cjs`, `.dependency-cruiser.cjs` -- sơ đồ AD-10; luật: mô-đun chỉ import mô-đun được phép, chỉ qua `index.ts` (ngoại lệ `schema.ts`), mô-đun không import `flows`, không vòng.
- [x] `apps/api/test/` -- Vitest: config (thiếu/sai biến), lỗi chuẩn + 404, `x-request-id`, che PII, `/readyz`, transaction + `uuidv7()` trên Postgres thật, dependency-cruiser bắt fixture vi phạm.
- [x] `apps/api/Dockerfile` -- multi-stage, `pnpm deploy`, một image cho ba vai.
- [x] `apps/web/` -- Next.js 16.4 + React 19.3 tối thiểu (`app/layout.tsx` với `lang="vi"`, một trang), import được `@tickee/contracts`.
- [x] `docker-compose.yml`, `docker/postgres/init.sql` -- Postgres 18.6 tạo `tickee_migrator`, `tickee_app`, DB `tickee`; Mailpit.
- [x] `.github/workflows/ci.yml` -- service Postgres 18; typecheck, `lint:deps`, migrate, Vitest, build image tag `${{ github.sha }}`.
- [x] `.env.example`, `README.md` -- biến mới và lệnh chạy local.

**Acceptance Criteria:**
- Given clone mới có Node và pnpm đúng bản, when `pnpm install && pnpm turbo build`, then cả ba package build xong, không lỗi TS strict.
- Given Docker chạy, when `docker compose up`, then có Postgres 18 và Mailpit.
- Given PR mở trên GitHub, when CI chạy, then đủ typecheck, dependency-cruiser, Vitest với Postgres thật, build image tag SHA; một import sai hướng làm CI đỏ.

## Implementation Notes

- pnpm 12 ghi `allowBuilds: esbuild` và `minimumReleaseAgeExclude` cho `@nestjs/*@12.3.2` vào `pnpm-workspace.yaml`.
- SIGTERM exit 0 nhờ `enableShutdownHooks(signals, { useProcessExit: true })`.
- Mọi 4xx khác 404 hiện trả `VALIDATION_FAILED`; Story 1.3 cần thêm `UNAUTHORIZED`/`FORBIDDEN` vào contracts.
- Thêm `test/roles.process.test.ts` chạy `dist/main.js` thật để phủ các dòng matrix ở mức tiến trình; turbo `test` phụ thuộc `build` của chính package.

## Spec Change Log

## Review Triage Log

| # | Lớp | Finding | Verdict | Bằng chứng | Route |
|---|-----|---------|---------|-----------|-------|
| 1 | edge | `PORT=`/`LOG_LEVEL=` rỗng → lỗi "thiếu" dù có mặc định | low | Chạy `loadConfig({…, PORT: ''})` ra "PORT (thiếu)" | patch |
| 2 | edge, blind | Mọi 4xx khác 404 → `VALIDATION_FAILED` | low | Đúng, nhưng chưa có code ném 401/403/409; sửa cần thêm mã vào contracts (public surface) | reject, ghi chú cho Story 1.3 |
| 3 | edge | HttpException 3xx ra body lỗi | low | Không code nào ném HttpException 3xx; sửa là thêm nhánh | reject |
| 4 | edge | body-parser 413 → 500 | maybe-false | JSON hỏng đã ra 400 qua cùng đường; cần thử payload > limit để chắc; nếu đúng chỉ là low | reject |
| 5 | edge | `/readyz` treo khi query treo | low | `connectionTimeoutMillis` chỉ giới hạn lúc kết nối, không giới hạn query | patch |
| 6 | edge, blind | `autoLogging.ignore` so `req.url` nguyên văn | low | `/healthz?x=1` không khớp | patch |
| 7 | edge, blind | Che PII chỉ tới độ sâu 3, thiếu `password`/`token`/`otp`, IP | low | Hiện không log body nào; sửa cần serializer mới | reject, nhắc lại ở Story 1.3 (OTP) |
| 8 | edge | `createQueue` partitioned bằng `tickee_app` bị 42501 | low | Queue thường tạo được (worker test pass); chưa dùng partition | reject |
| 9 | edge | File không phải `schema.ts` import được `schema.ts` mô-đun khác | medium | Luật `module-public-api-only` cho mọi `from`; AD-10 chỉ cho `schema.ts` khai báo khóa ngoại | patch |
| 10 | edge, verif | db.test và roles.process.test cùng migrate song song | medium | Vitest mặc định `fileParallelism: true`; GRANT đồng thời có thể lỗi "tuple concurrently updated" | patch |
| 11 | edge | Hai tiến trình migrate chạy cùng lúc khi deploy | low | Pipeline AD-36 chạy migrate một lần trước deploy; sửa là thêm advisory lock | reject |
| 12 | edge | `waitFor` trong roles.process.test quay tới timeout khi child chết | low | Không kiểm `exitCode`/`signalCode` | patch |
| 13 | edge, blind | worker.test không try/finally | low | Expect lỗi thì `app.close()` không chạy | patch |
| 14 | edge | `pnpm deploy` thiếu `inject-workspace-packages` làm hỏng build image | false | `docker build` thành công, image `tickee-api:local` chạy đủ ba vai | reject |
| 15 | verif | Fixture chỉ thử 3/6 luật dependency-cruiser | medium | Xóa `platform-not-to-domain`/`no-circular` vẫn pass mọi test | patch |
| 16 | verif | Chưa test che header `authorization`/`cookie` | medium | Không test nào gửi các header này | patch |
| 17 | verif, blind | CI build image nhưng không chạy | medium | Bỏ `drizzle` khỏi `files` vẫn pass CI | patch |
| 18 | blind | CI thiếu `permissions:` | low | Dùng quyền mặc định của `GITHUB_TOKEN` | patch |
| 19 | blind | `.nvmrc` = `26` lệch bản ghim 26.12.1 | low | CI lấy 26.x mới nhất | patch |
| 20 | blind | Lỗi pool bị nuốt im lặng | low | `pool.on('error', () => undefined)` | patch |
| 21 | blind | Web không bị chặn import driver DB (AD-11) | low | Không có luật; web chưa có code nào; sửa cần cấu hình depcruise riêng cho web | reject |
| 22 | blind | `ERROR_CODE_PATTERN` không dùng | low | Không nơi nào import | patch (xóa) |
| 23 | blind | Cổng Postgres/Mailpit mở 0.0.0.0 với mật khẩu mặc định | low | `'5432:5432'` | patch |
| 24 | blind | Mailpit không có biến SMTP | false | Spec đưa Mailpit vào compose; cấu hình SMTP thuộc Story 1.3 | reject |
| 25 | blind | `freePort()` có race | low | Cửa sổ rất ngắn; sửa cần đổi cách cấp cổng | reject |
| 26 | blind | Thiếu default privileges cho function | low | `grantAppRole` cấp EXECUTE hiện có nhưng không cho function mới | patch |
| 27 | blind | `application_name` cứng `tickee-worker`; worker import `roles/api.ts` | low | Đọc code | patch |
| 28 | blind | `/readyz` lỗi log mức error mỗi lần probe | low | Ghi nhận DB xuống ở mức error là hợp lý | reject |
| 29 | blind | Thiếu ESLint/Prettier | false | Spec và AD-36 không yêu cầu lint ở story này | reject |
| 30 | verif | README `pnpm --filter @tickee/api test` có thể chạy dist cũ | low | Lệnh không build lại `dist` | patch |

## Design Notes

Sơ đồ phụ thuộc là dữ liệu, luật là hàm sinh ra từ dữ liệu, để thêm mũi tên chỉ sửa một chỗ:

```js
// apps/api/module-graph.cjs
module.exports = { identity: [], organizer: ['identity', 'tingee'], event: ['organizer'], /* … theo AD-10 */ };
// .dependency-cruiser.cjs: với mỗi A, forbidden path từ modules/A tới modules/B khi B ∉ graph[A]
```

`tickee_app` nhận quyền qua `ALTER DEFAULT PRIVILEGES` do `tickee_migrator` chạy trong migration, nên bảng mới ở story sau tự có quyền DML.

## Verification

**Commands:**
- `pnpm install && pnpm turbo build typecheck` -- expected: thành công.
- `pnpm turbo lint:deps` -- expected: pass; fixture vi phạm được test bắt.
- `pnpm --filter @tickee/api test` (cần Postgres 18) -- expected: mọi test pass.
- `APP_ROLE=migrate node apps/api/dist/main.js; echo $?` -- expected: `0`.
- `APP_ROLE=api node apps/api/dist/main.js` rồi `curl -i localhost:3001/healthz` -- expected: 200, có header `x-request-id`.
- `docker build -f apps/api/Dockerfile .` -- expected: thành công (nếu có Docker).
