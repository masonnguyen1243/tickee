---
review: currency (đối chiếu thực tế công nghệ và phiên bản)
target: ../ARCHITECTURE-SPINE.md (mục Stack, AD-4, AD-7, AD-8, AD-12, AD-17, AD-19, AD-22, Consistency Conventions)
companion_checked: ../.memlog.md
date: '2026-10-28'
method: 'npm view (dist-tags, time, engines, peerDependencies, exports) chạy lúc 09:50 +07 ngày 28/10/2026; đọc file .d.ts/.mjs đã publish qua unpkg/jsdelivr; tìm kiếm web cho mục không có trên npm'
verdict: 'Đạt có điều kiện: mọi phiên bản đều có thật và đang mới nhất; 1 rủi ro mức Cao về cách dùng Better Auth 2FA, 2 rủi ro mức Trung bình'
---

# Review currency — Tickee Architecture Spine

## 1. Kết luận

**Đạt có điều kiện.** Cả 21 dòng trong bảng Stack đều có thật. Bảng có 18 gói npm, và 17 gói được ghim đúng bằng tag `latest` trên npm sáng 28/10/2026. TypeScript là ngoại lệ có chủ đích: spine ghim 6.0.3 trong khi `latest` là 7.0.2, và lý do ghim là đúng. Node.js 26 và PostgreSQL 18.6 khớp với lịch phát hành chính thức. Không có công nghệ nào bịa ra, lỗi thời, hay đã bị thay thế.

Rủi ro nằm ở cách spine dùng một số thư viện, không nằm ở số phiên bản:

| # | Mức | Phát hiện | AD bị ảnh hưởng |
| --- | --- | --- | --- |
| F1 | **Cao** | Plugin `twoFactor` của Better Auth 1.7.14 chỉ chặn đăng nhập ở `/sign-in/email`, `/sign-in/username`, `/sign-in/phone-number`. Đăng nhập Google và `emailOTP` (hai cách duy nhất của Tickee) **không** bị hỏi TOTP. Bật TOTP cũng đòi mật khẩu, trừ khi đặt `allowPasswordless: true`. | AD-19 |
| F2 | Trung bình | Thư viện NestJS cho Better Auth bắt buộc `bodyParser: false`, nên `NestFactory.create({ rawBody: true })` không còn tác dụng. IPN cần raw body để kiểm chữ ký. Thư viện còn đăng ký `AuthGuard` toàn cục. Bảng Stack chưa ghi adapter HTTP (Express hay Fastify) và chưa ghi gói tích hợp này. | AD-7, AD-19 |
| F3 | Trung bình | Drizzle 0.45.4 là bản `latest`, nhưng 1.0.0-rc.5 đã ra ngày 21/10/2026 và có thay đổi phá vỡ: bỏ RQB v1, đổi API casing, đổi cấu trúc migration. Dự án sẽ phải nâng cấp sớm sau khi bắt đầu. | Stack, AD-10 |
| F4 | Thấp | Ghim TS 6.0.3 là đúng, nhưng memlog ghi sai lý do. Rào cản thật là TS 7.0 chưa có JS compiler API mà Nest CLI dùng; memlog nói là chuyện `emitDecoratorMetadata`. TS 6.0 cũng đổi một số giá trị mặc định của tsconfig, cần xử lý khi dựng khung dự án. | Stack |
| F5 | Thấp | Node 26 lên Active LTS đúng ngày hôm nay theo lịch, nhưng lúc kiểm chưa có bản v26 nào được gắn cờ LTS. Từ Node 25, Node không còn kèm Corepack. Máy local đang chạy Node 26.5.0 (thiếu 2 bản vá bảo mật) và pnpm 10.17.1. | Stack, AD-22 |
| F6 | Thấp | Cron của pg-boss chỉ chính xác đến phút. Hết hạn 60 giây (AD-4) và việc tra lại sau 2 phút theo backoff (AD-8) hợp với job hoãn riêng cho từng Đơn hơn là quét bằng cron. | AD-4, AD-8, AD-12 |
| F7 | Thấp | Ở PostgreSQL, transaction có `NOTIFY` lấy một khóa toàn cục lúc commit. Với quy mô Tickee thì không sao, nhưng không nên `NOTIFY` trong transaction giữ chỗ. | AD-17 |
| F8 | Thấp | Một số mặc định của Better Auth lệch với spine: `allowedAttempts` = 3 (spine muốn 5), `storeOTP` = `plain`, `generateId` sinh chuỗi ngẫu nhiên thay vì UUIDv7, tên field theo camelCase. | AD-19, Consistency (ID, Đặt tên) |
| F9 | Thấp | Một số thư viện spine dùng mà chưa ghim: gói tích hợp NestJS–Better Auth, `nestjs-pino`, OTel SDK, S3 SDK. `googleapis` (gói lớn) có thể thay bằng `@googleapis/sheets`. Vài bản ghim mới ra 1–2 ngày trước. | Stack |

## 2. Kiểm phiên bản (npm, 28/10/2026 09:50 +07)

Lệnh đã chạy: `npm view <pkg> dist-tags --json` cho từng gói, cùng `npm view <pkg> time`, `engines` và `peerDependencies` cho các gói có rủi ro khớp.

| Name | Spine | `latest` trên npm | Ngày publish bản ghim | Kết quả |
| --- | --- | --- | --- | --- |
| Node.js | 26 (Active LTS) | v26.12.1 (21/10/2026, bản vá bảo mật) | Lịch: LTS 28/10/2026, hết hỗ trợ 30/4/2029 | Đúng theo lịch; xem F5 |
| pnpm | 12.15.0 | 12.15.0 (tag `next-12` = 12.16.1) | 21/10/2026 | Khớp |
| Turborepo (`turbo`) | 2.11.10 | 2.11.10 | 20/10/2026 | Khớp; 2.11.9 đã thêm hỗ trợ pnpm 12 |
| TypeScript | 6.0.3 | **7.0.2** (6.0.3 là bản mới nhất của dòng 6.0) | 16/4/2026 | Ghim có chủ đích, đúng; xem §3.1 |
| Next.js | 16.4.3 | 16.4.3 (canary 16.5.0-canary.29) | 23/10/2026 | Khớp |
| React | 19.3.1 | 19.3.1 | 14/10/2026 | Khớp; Next peer `^19.0.0` |
| Tailwind CSS | 4.3.3 | 4.3.3 | 16/7/2026 | Khớp |
| `@nestjs/core` | 12.3.2 | 12.3.2 | **27/10/2026** (hôm qua) | Khớp; ESM (`"type": "module"`), node `>= 20` |
| Zod | 4.6.7 | 4.6.7 | 12/10/2026 | Khớp; better-auth phụ thuộc `zod ^4.5.4` nên dùng chung được |
| PostgreSQL | 18.6 | 18.6 (13/8/2026) | — | Khớp; 18.7 dự kiến 12/11/2026; PG 19 đang RC1, GA dự kiến 19/11/2026 |
| Drizzle ORM | 0.45.4 | 0.45.4 (tag `rc` = 1.0.0-rc.5) | 8/10/2026 | Khớp; xem F3 |
| drizzle-kit | 0.31.11 | 0.31.11 | 21/10/2026 | Khớp |
| `pg` | 8.23.1 | 8.23.1 | 30/9/2026 | Khớp; pg-boss 12.38.0 phụ thuộc `pg ^8.23.1` |
| pg-boss | 12.38.0 | 12.38.0 | 13/10/2026 | Khớp; node `>=22.12.0`, ESM |
| Better Auth | 1.7.14 | 1.7.14 (beta 1.8.0-beta.3) | **26/10/2026** | Khớp; ESM |
| pino | 10.4.0 | 10.4.0 | 2/10/2026 | Khớp; `nestjs-pino` 5.3.1 có peer `pino ^10`, `@nestjs/core ^12.0.2` |
| `@opentelemetry/api` | 1.10.0 | 1.10.0 | 20/10/2026 | Khớp; thỏa peer `^1.9.0` của pg-boss và vitest |
| googleapis | 188.0.0 | 188.0.0 | 22/10/2026 | Khớp; xem F9 |
| Vitest | 5.0.5 | 5.0.5 | 15/10/2026 | Khớp; node `^22.12 \|\| ^24 \|\| >=26` |
| Playwright (`@playwright/test`) | 1.64.1 | 1.64.1 | 14/10/2026 | Khớp |
| Tingee Open API | v1 | — (không phải gói npm) | — | Ngoài phạm vi kiểm phiên bản; spine dẫn developers.tingee.vn, đọc 28/10/2026 |

Ràng buộc engine: Next.js `>=20.9.0`, NestJS `>= 20`, pg-boss `>=22.12.0`, Vitest `>=26.0.0`, `@thallesp/nestjs-better-auth` `>=22.22.1`, pnpm `>=18`. Node 26 thỏa tất cả.

## 3. Kiểm rủi ro khớp

### 3.1 TypeScript 6.0.3 với `@nestjs/cli` 12 và Next.js 16.4.x

**Kết luận: ghim 6.0.3 là đúng. Next.js 16.4.3 chạy được với TS 6.0.**

- `npm view @nestjs/cli@12.0.11 dependencies` cho ra `"typescript": "~6.0.2"`. Đây là `dependency`, không phải peer. Theo mã nguồn công khai của Nest CLI, `TypeScriptBinaryLoader` tìm `typescript` từ `process.cwd()` trước, nên CLI sẽ dùng phiên bản TS của dự án. Nếu dự án dùng TS 7, CLI sẽ nạp TS 7. Mình suy ra điều này từ mã nguồn CLI chứ chưa chạy thử.
- TS 7.0 (8/7/2026) chưa có API: *"While TypeScript 7.0 is here, it does not ship with an API"*. API mới dự kiến có ở 7.1. Nguồn: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/. Trong thảo luận ở PR v12 của NestJS (https://github.com/nestjs/nest/pull/16391, 31/7/2026), cộng đồng xác nhận: *"TS 7 lacks programmatic API which NestJS CLI relies on"*.
- **Lý do ghi trong memlog chưa chính xác.** Memlog dòng 66 nói TS 7 "chưa xác nhận hỗ trợ emitDecoratorMetadata". Rào cản thật là TS 7.0 thiếu JS API. Kết luận ghim vẫn đúng.
- Dòng 6.0 chỉ có 6.0.2 (23/3/2026) và 6.0.3 (16/4/2026). 6.0.3 là bản cuối, thỏa `~6.0.2`. Microsoft công bố 6.0 là bản cuối cùng viết bằng JavaScript và chưa nói sẽ bảo trì nó bao lâu.
- Next.js 16.4.3: tài liệu đi kèm gói (`dist/docs/.../02-typescript.md`) viết *"Next.js uses the project-local `tsc` CLI by default"*. Mục "Using TypeScript 7" chỉ cần cài `typescript@^7`. Nếu đặt `experimental.useTypeScriptCli: false`, Next.js sẽ dùng JS compiler API, mà TS 6.0 vẫn có API này. Như vậy TS 6.0.3 chạy được ở cả hai chế độ. Next.js không đặt peer hay engine nào chặn TS 6. Nguồn: https://unpkg.com/next@16.4.3/dist/docs/01-app/03-api-reference/05-config/02-typescript.md
- `@thallesp/nestjs-better-auth` 2.8.0 có peer `typescript: "^5.9.2 || ^6.0.0"`, khớp.
- **Cần làm khi dựng khung dự án** (theo https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/):
  - TS 6.0 đặt `types` mặc định là `[]`, nên `apps/api` phải khai báo `"types": ["node"]`.
  - `strict` mặc định là `true`.
  - `baseUrl` và `moduleResolution: node` bị deprecate. Dùng `nodenext` cho api và `bundler` cho web.
  - Không thể đặt `esModuleInterop: false` nữa.
- Phương án dự phòng nếu muốn tách: `apps/web` lên TS 7, `apps/api` giữ 6.0.3. Gói `@typescript/typescript6@6.0.2` có trên npm, cho phép công cụ khác tiếp tục dùng API 6.0 trong khi `tsc` chạy bản 7. Xem lại khi TS 7.1 ra và Nest CLI hỗ trợ nó.

### 3.2 pg-boss 12.38.0

**Kết luận: đáp ứng đầy đủ AD-12. Có adapter Drizzle chính thức để enqueue bằng chính `tx`.**

- **Enqueue trong transaction có sẵn:**
  - `types.d.ts` khai báo `interface IDatabase { executeSql(text, values?): Promise<{ rows: any[] }> }` và `interface ConnectionOptions { db?: IDatabase }`. `SendOptions = JobOptions & QueueOptions & ConnectionOptions`.
  - `index.d.ts` export `fromDrizzle`, cùng với `fromKnex`, `fromKysely`, `fromPrisma`, `fromPglite` và `fromBunSql`.
  - `adapters/drizzle.d.ts` có ví dụ: `await db.transaction(async (tx) => { await boss.send('my-queue', data, { db: fromDrizzle(tx, sql) }) })`. Mã `adapters/drizzle.js` gọi `tx.execute(sql(strings, ...params))`, nên chạy được với transaction Drizzle trên node-postgres.
  - `insert()`, `complete()`, `fetch()` và `unschedule()` cũng nhận `ConnectionOptions`.
  - Nguồn: https://unpkg.com/pg-boss@12.38.0/dist/types.d.ts, https://unpkg.com/pg-boss@12.38.0/dist/adapters/drizzle.d.ts
- **Cron:**
  - Chữ ký là `schedule(name, cron, data?, options?: ScheduleOptions)`, với `ScheduleOptions = SendOptions & { tz?, key?, missed?: 'skip' | 'once' }`.
  - Nhiều instance cùng chạy thì vẫn chỉ gửi 1 job. Theo https://pgboss.io/api/scheduling: *"job throttling options are then used to make sure only 1 job is sent even if multiple instances are running"*. Điều này thay được `@nestjs/schedule` như memlog đã quyết.
  - `tz` mặc định là UTC. Spine tính lịch theo `Asia/Ho_Chi_Minh`, nên khi gọi `schedule()` phải truyền `tz: 'Asia/Ho_Chi_Minh'`.
- **Singleton và chống trùng:**
  - `JobOptions` có `id?`, `singletonKey?`, `singletonSeconds?` và `singletonNextSlot?`.
  - `QueuePolicy` gồm `standard`, `short`, `singleton`, `stately`, `exclusive` và `key_strict_fifo`.
  - Ngoài ra có `sendThrottled(name, data, opts, seconds, key?)` và `sendDebounced(...)`. AD-23 ("tối đa một lần mỗi phút cho mỗi Sự kiện") làm được bằng `sendThrottled(..., 60, eventId)` hoặc `singletonKey` + `singletonSeconds`.
  - Khóa idempotent của AD-12 (loại job + id thực thể) có thể đưa vào `id` hoặc `singletonKey`.
- **Engine:** `"node": ">=22.12.0"`, `"type": "module"`, peer `@opentelemetry/api ^1.9.0`. Node 26, NestJS 12 ESM và OTel 1.10.0 đều thỏa.
- **Kết nối:** `useListenNotify` của pg-boss cần *"a session-pinned connection. It will not work through PgBouncer in transaction pooling mode"* (`types.d.ts`, dòng ~502). Điều này khớp với yêu cầu kết nối session trực tiếp ở AD-22.
- **Lưu ý khớp:** xem F6 về độ chính xác của cron. Lưu ý thêm: pg-boss tự tạo và tự migrate schema riêng (mặc định `pgboss`) khi `start()`. Cần cấu hình drizzle-kit (`schemaFilter`) để bỏ qua schema này, và để bước migration riêng trước deploy (Stack/Môi trường) gồm cả việc khởi tạo pg-boss.

### 3.3 Better Auth 1.7.14

**Kết luận: chạy được với NestJS 12 ESM và Drizzle 0.45.4. Có `emailOTP`, `twoFactor` (TOTP) và cookie chia sẻ giữa các subdomain. Tuy vậy, cách hiểu "TOTP bắt buộc" trong AD-19 không khớp với hành vi mặc định của plugin (F1).**

- **ESM và NestJS 12:**
  - `better-auth@1.7.14` có `"type": "module"`.
  - Không có gói `@better-auth/nestjs` (npm trả E404). Tài liệu Better Auth (trang integrations/nestjs ở bản 1.6 và 1.8 beta) dùng gói cộng đồng `@thallesp/nestjs-better-auth`. Bản 2.8.0 (3/9/2026) là ESM, có peer `@nestjs/core: "^11.1.6 || ^12.0.0"` và `better-auth: ">=1.5.0 <2.0.0"`, engine `node >=22.22.1`.
  - Nguồn: https://better-auth.com/docs/1.6/integrations/nestjs.md, https://cdn.jsdelivr.net/npm/@thallesp/nestjs-better-auth@2.8.0/README.md
- **Drizzle adapter:**
  - Gói `better-auth` export `./adapters/drizzle`. `@better-auth/drizzle-adapter@1.7.14` có peer `drizzle-orm: "^0.45.2 || >=1.0.0-rc.1 <2.0.0"`, khớp với 0.45.4 và cả 1.0.
  - `better-auth` cũng có peer `drizzle-kit >=0.31.4`, `next ^16`, `vitest ^5`.
- **emailOTP:**
  - Có export `./plugins/email-otp` và endpoint `/sign-in/email-otp`.
  - Theo `types.d.mts`: `expiresIn` mặc định 300 giây, khớp với 5 phút trong spine. `allowedAttempts` mặc định **3**, trong khi spine muốn 5 lần sai. `storeOTP` mặc định `"plain"`. Xem F8.
- **twoFactor (TOTP):** có export `./plugins/two-factor`, với `TOTPOptions { issuer, digits: 6|8, period, backupCodes }`.
- **Cookie giữa các subdomain:** `@better-auth/core@1.7.14` `init-options.d.mts` dòng 321 có `advanced.crossSubDomainCookies { enabled, additionalCookies?, domain? }`. Thiết lập "cookie trên domain cha, API ở `api.<domain>`" của AD-19 làm được.
- **F1, chi tiết:**
  - `dist/plugins/two-factor/index.mjs` dòng 248–249: `matcher(context) { return context.path === "/sign-in/email" || context.path === "/sign-in/username" || context.path === "/sign-in/phone-number"; }`. Bản 1.8.0-beta.3 giống hệt.
  - Hệ quả: đăng nhập qua `/sign-in/email-otp` và qua callback Google tạo session ngay, **không** qua bước hỏi TOTP.
  - Cũng ở 1.7.14, `/two-factor/verify-totp` khi đã có session chỉ kiểm mã rồi trả về `valid`. Theo `verify-two-factor.mjs`, endpoint này không lưu dấu "đã xác minh 2FA lúc X". Muốn bắt Owner nhập lại TOTP trước thao tác chỉ Owner được làm (step-up), `identity` phải tự dựng, ví dụ thêm guard `requireTotp` gọi `auth.api.verifyTOTP` và ghi `two_factor_verified_at` vào session.
  - Quản trị Tingee ("2FA bắt buộc") cũng cần cơ chế tự dựng tương tự.
  - Bật 2FA: theo `types.d.mts`, `allowPasswordless?: boolean` mặc định `false`. Mô tả là *"Allow enabling and managing 2FA without a password when the user does not have a credential account"*. Tài khoản Tickee không có mật khẩu, nên phải đặt `allowPasswordless: true`. Nếu không, Owner không bật được TOTP.

### 3.4 Drizzle ORM 0.45.4, `uuidv7()` và UPDATE có điều kiện … RETURNING

**Kết luận: làm được.**

- `column-builder.d.ts` (0.45.4) khai báo `default(value: … | SQL): HasDefault<this>`. Vì vậy `uuid('id').primaryKey().default(sql\`uuidv7()\`)` hợp lệ.
  - `uuid.d.ts` chỉ có `defaultRandom()` (tức `gen_random_uuid()`, v4). Drizzle 0.45 không có helper riêng cho v7, phải dùng `sql`.
  - Đừng dùng `$defaultFn`: nó chỉ chạy lúc runtime và không vào migration (*"This value does not affect the drizzle-kit behavior"*).
- `pg-core/query-builders/update.d.ts` có `returning(): PgUpdateReturningAll`. `.where()` và `.set()` nhận biểu thức `sql`, nên viết được `set({ held: sql\`${t.held} + ${n}\` }).where(and(eq(t.ticketTypeId, id), sql\`${t.sold} + ${t.held} + ${n} <= ${t.capacity}\`)).returning()`.
- `pg-core/session.d.ts` khai báo `PgTransactionConfig { isolationLevel?: 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable' }`, khớp với quy ước READ COMMITTED.
- **F3:** `drizzle-orm` có tag `rc` = 1.0.0-rc.5 (21/10/2026). Theo hướng dẫn nâng cấp https://orm.drizzle.team/docs/v0-v1-changes, bản 1.0 bỏ RQB v1 (`relations()` / `db.query` kiểu cũ, thay bằng `defineRelations()`), đổi API `casing`, chuyển drizzle-zod vào `drizzle-orm/zod` và đổi định dạng thư mục migration của drizzle-kit. Bản 0.45.2 trở lên đã vá lỗi escape identifier, nên 0.45.4 an toàn.

### 3.5 PostgreSQL 18 có `uuidv7()` sẵn

**Kết luận: đúng.** Tài liệu chính thức https://www.postgresql.org/docs/18/functions-uuid.html ghi `uuidv7 ( [ shift interval ] ) → uuid`. PG 18 cũng thêm alias `uuidv4()` và mở rộng `uuid_extract_timestamp()` cho v7.

Về phiên bản, banner trên postgresql.org ghi "PostgreSQL 18.6, 17.11, 16.15, 15.19, 14.24 and 19 Beta 3 Released!" ngày 13/8/2026. Thông báo RC1 của PG 19 (15/10/2026, https://www.postgresql.org/about/news/postgresql-19-rc-1-released-3409/) cho biết: bản cập nhật kế tiếp là 12/11/2026 (sẽ có 18.7), GA PG 19 dự kiến 19/11/2026. Chọn PG 18 là hợp lý, vì PG 19 chưa GA và các nhà cung cấp managed thường chậm vài tháng. Nên ghim image theo major (`postgres:18`) để tự nhận 18.7.

### 3.6 LISTEN/NOTIFY với node-postgres cho SSE

**Kết luận: làm được và hợp với AD-17. Cần một lưu ý vận hành (F7).**

- node-postgres có tài liệu cho `client.on('notification', (msg) => …)` với `msg.channel` và `msg.payload`, ví dụ dùng một `Client` riêng chạy `LISTEN foo`. Nguồn: https://node-postgres.com/apis/client. Mỗi instance api cần đúng một `pg.Client` riêng, không lấy từ `Pool`, có reconnect và chạy lại `LISTEN`. Khi reconnect, client nên gọi REST để lấy lại trạng thái, đúng như AD-17 đã quy định.
- Tài liệu PG 18 (https://www.postgresql.org/docs/18/sql-notify.html):
  - payload *"must be shorter than 8000 bytes"*. Spine chỉ gửi loại và id nên không vướng.
  - Sự kiện chỉ được giao khi transaction commit, nên không có tín hiệu cho thay đổi đã rollback. Điều này khớp với AD-17 và AD-18.
  - Trong một transaction, các payload giống nhau được gộp lại thành một.
  - Hàng đợi NOTIFY đầy (8GB) thì commit thất bại.
- **F7:** transaction có `NOTIFY` lấy một khóa toàn cục lúc commit, nên các commit này chạy tuần tự. Recall.ai và DBOS đã đo được trần vài nghìn lần ghi mỗi giây khi mỗi transaction đều `NOTIFY` (https://recall.ai/blog/postgres-listen-notify-does-not-scale, https://dbos.dev/blog/postgres-listen-notify-scalability). Ở mức NFR-3 (5.000 người tranh 300 Vé) số lần commit thành công thấp, nên không đáng lo. Tuy vậy, chỉ nên `NOTIFY` khi đổi trạng thái Đơn/Vé và khi check-in, không `NOTIFY` trong TX1 giữ chỗ. Nếu sau này tải tăng, gom tín hiệu lại trước khi phát.

## 4. Các phát hiện khác

- **F5 — Node.js 26:**
  - `nodejs/Release/schedule.json` ghi `v26: start 2026-05-05, lts 2026-10-28, maintenance 2027-10-20, end 2029-04-30`. Vậy "26 (Active LTS)" đúng tính từ hôm nay.
  - Tuy vậy, `https://nodejs.org/dist/index.json` lúc kiểm chưa có bản v26 nào có `lts` khác `false`. Bản mới nhất là `v26.12.1 2026-10-21 lts=False security=True`. Bản đánh dấu LTS nhiều khả năng ra trong ngày.
  - Máy local: `/opt/homebrew/bin/node` là v26.5.0, thiếu bản vá bảo mật 26.5.1 (28/7) và 26.12.1 (21/10). `pnpm` lấy từ nvm Node 22.19.0 và là bản 10.17.1, không phải 12.15.0.
  - Từ Node 25, Node không còn đóng gói Corepack (https://nodejs.org/dist/latest/docs/api/corepack.html, https://socket.dev/blog/node-js-tsc-votes-to-stop-distributing-corepack). Image Docker `node:26` (AD-22) và CI phải tự cài pnpm 12.15.0, hoặc cài gói `corepack` từ npm.
  - Turborepo 2.11.9 có ghi chú "Provision pnpm 12 native binaries…" (https://github.com/vercel/turborepo/releases). pnpm 12 giữ nguyên định dạng lockfile của pnpm 11, nên `turbo prune` không gặp rủi ro định dạng.
- **F6 — độ chính xác của cron pg-boss:** https://pgboss.io/api/scheduling ghi *"Neither the 6-placeholder cron format's seconds field nor an RRULE's … adds precision below a minute"*. Lịch được kiểm mỗi 30 giây. Vì vậy:
  - AD-4 ("chưa có link sau 60s") nếu làm bằng cron sẽ trễ khoảng 1–1,5 phút. Lựa chọn khác là `send` một job `startAfter: expires_at`, có `singletonKey = orderId`, ngay trong TX1.
  - AD-8 ("quá 2 phút kể từ khi có link, lặp theo backoff") cũng hợp với job hoãn riêng từng Đơn. Cron chỉ nên làm lưới an toàn quét định kỳ.
  - Không có gì không tương thích, đây chỉ là chọn cơ chế cho đúng.
- **F8 — mặc định của Better Auth lệch spine:**
  - `emailOTP.allowedAttempts` mặc định 3, cần đặt 5. Nên dùng `storeOTP: 'hashed'`.
  - `advanced.database.generateId` mặc định sinh chuỗi ngẫu nhiên. Theo `init-options.d.mts` dòng 367–381, đặt `false` để DB tự sinh ID (default `uuidv7()`) đúng quy ước "Khóa chính UUIDv7".
  - Bảng và field của Better Auth mặc định ở số ít và camelCase (`emailVerified`). Cần `usePlural` và map `fields`, hoặc dùng casing `snake_case` của Drizzle, để khớp quy ước "bảng số nhiều, cột snake_case".
  - "Cùng email = một Tài khoản Tickee" cần bật `account.accountLinking` với `trustedProviders: ['google']`.
- **F2 — raw body và guard:**
  - README `@thallesp/nestjs-better-auth` 2.8.0: *"Since we disable NestJS's built-in body parser, the `rawBody: true` option in `NestFactory.create()` has no effect"*. Phải bật `bodyParser: { rawBody: true }` trong `AuthModule.forRoot()`. Nếu không, `req.rawBody` của endpoint IPN sẽ `undefined` và mọi IPN bị từ chối vì sai chữ ký (AD-7).
  - `AuthGuard` được đăng ký toàn cục, nên IPN, SSE công khai, trang Sự kiện công khai và health check phải gắn `@AllowAnonymous()`.
  - Hỗ trợ Fastify mới ở mức beta. Nên ghi rõ trong Stack: `@nestjs/platform-express` 12.3.2 (kéo theo `express` 5.3.0).
- **F9 — thư viện chưa ghim và chuỗi cung ứng:**
  - Spine dùng mà chưa ghim: `@thallesp/nestjs-better-auth` 2.8.0 (gói cộng đồng, do một người duy trì), `nestjs-pino` 5.3.1 + `pino-http` 11, OpenTelemetry SDK/exporter, S3 SDK (cho presigned URL), Mailpit.
  - `googleapis` 188.0.0 là gói rất lớn. Với AD-23, chỉ cần `@googleapis/sheets` 18.1.1 + `google-auth-library` 11.3.1.
  - `@nestjs/core` 12.3.2 ra hôm qua, `better-auth` 1.7.14 ra cách đây 2 ngày. Nên commit lockfile và cân nhắc đặt `minimumReleaseAge` của pnpm để bớt rủi ro từ gói vừa publish.
- **Chưa xác minh:** Vitest 5 (Vite 8/Oxc) có phát decorator metadata cho test NestJS mà không cần plugin SWC hay không. Khi dựng khung dự án, hãy kiểm bằng một test DI thật.

## 5. Đánh giá decision log (`.memlog.md`)

| Dòng memlog | Ghi nhận | Kết quả kiểm lại |
| --- | --- | --- |
| 15 (version, web) | NestJS 12.1.1, Next 16.4.1 (tracker), Node 26 LTS 28/10/2026 | Đã được dòng 49 thay bằng số từ npm. Lịch Node đúng. |
| 49 (version, npm) | Phiên bản các gói chính, PG 18.6, PG 19 RC | Tất cả khớp npm `latest`. PG 19 đang RC1 (15/10), GA dự kiến 19/11. |
| 50 (ORM) | Drizzle 0.45.4; Prisma latest tag là 8.0 RC | Đúng. Thiếu ghi chú rằng Drizzle 1.0 đã ở RC.5 (F3). |
| 51 (auth) | Better Auth + emailOTP + twoFactor TOTP | Plugin có thật, nhưng chưa ai kiểm luồng 2FA với Google/emailOTP (F1). |
| 61 (cron) | pg-boss cron thay `@nestjs/schedule` | Đúng: chỉ gửi 1 job khi nhiều instance. Độ chính xác chỉ đến phút (F6). |
| 66 (TS) | Ghim 6.0.3 vì `@nestjs/cli` cần `~6.0.2`; lo TS 7 thiếu emitDecoratorMetadata | Ghim đúng, lý do lệch: rào cản thật là TS 7.0 không có JS API (F4). |
| 24 (job) | Enqueue trong cùng transaction | Đã xác nhận bằng `fromDrizzle(tx, sql)` trong pg-boss 12.38.0. |

Memlog đã kiểm phiên bản thật bằng `npm view` và web. Chỗ còn thiếu là kiểm **cách dùng**. Ba điểm sau là khẳng định từ trí nhớ, chưa đối chiếu mã nguồn hay tài liệu:

1. Better Auth 2FA áp dụng cho mọi cách đăng nhập.
2. `rawBody` của NestJS vẫn hoạt động khi tích hợp Better Auth.
3. Lý do ghim TS.

## 6. Hành động đề xuất (không sửa spine trong review này)

1. **(F1, Cao)** Bổ sung vào AD-19 hoặc ghi chú cho story `identity`:
   - Better Auth không tự bắt 2FA khi đăng nhập Google hay emailOTP.
   - Tự dựng guard step-up TOTP cho thao tác chỉ Owner được làm và cho `/admin`, có lưu thời điểm xác minh.
   - Bật `twoFactor({ allowPasswordless: true })`.
   - Viết test E2E: Owner đã bật TOTP đăng nhập bằng emailOTP rồi gọi một thao tác Owner, kết quả phải bị chặn cho đến khi nhập TOTP.
2. **(F2, Trung bình)** Thêm vào Stack `@nestjs/platform-express` 12.3.2 và `@thallesp/nestjs-better-auth` 2.8.0. Ghi vào AD-7 rằng raw body lấy qua `AuthModule.forRoot({ bodyParser: { rawBody: true } })`, và IPN phải `@AllowAnonymous()`.
3. **(F3, Trung bình)** Quyết định một trong hai:
   - Bắt đầu trên 0.45.4, chỉ dùng core query builder (không dùng `relations()`/RQB v1) để nâng cấp lên 1.0 rẻ.
   - Chờ 1.0 GA rồi mới chốt schema.
   Ghi lựa chọn vào memlog.
4. **(F4–F9, Thấp)**
   - Sửa lý do ghim TS trong memlog.
   - Ghim `.nvmrc` theo bản LTS cụ thể khi bản đó ra, và cài pnpm tường minh trong Dockerfile.
   - Dùng job hoãn riêng từng Đơn cho hết hạn và Đối soát bù.
   - Không `NOTIFY` trong TX1.
   - Cấu hình `allowedAttempts: 5`, `storeOTP: 'hashed'`, `generateId: false`, map tên bảng và cột.
   - Thêm `tz: 'Asia/Ho_Chi_Minh'` cho các lịch pg-boss.
   - Cho drizzle-kit bỏ qua schema `pgboss`.

## 7. Nguồn

- npm registry: `npm view` cho từng gói trong bảng §2, chạy 28/10/2026 09:50 +07.
- https://raw.githubusercontent.com/nodejs/Release/main/schedule.json · https://nodejs.org/dist/index.json · https://endoflife.date/nodejs
- https://nodejs.org/dist/latest/docs/api/corepack.html · https://socket.dev/blog/node-js-tsc-votes-to-stop-distributing-corepack
- https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ · https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/ · https://github.com/nestjs/nest/pull/16391
- https://unpkg.com/next@16.4.3/dist/docs/01-app/03-api-reference/05-config/02-typescript.md
- https://unpkg.com/pg-boss@12.38.0/dist/types.d.ts · https://unpkg.com/pg-boss@12.38.0/dist/index.d.ts · https://unpkg.com/pg-boss@12.38.0/dist/adapters/drizzle.d.ts · https://pgboss.io/api/scheduling
- https://cdn.jsdelivr.net/npm/better-auth@1.7.14/dist/plugins/two-factor/index.mjs · https://cdn.jsdelivr.net/npm/better-auth@1.7.14/dist/plugins/two-factor/types.d.mts · https://cdn.jsdelivr.net/npm/better-auth@1.7.14/dist/plugins/two-factor/verify-two-factor.mjs · https://cdn.jsdelivr.net/npm/better-auth@1.7.14/dist/plugins/email-otp/types.d.mts · https://cdn.jsdelivr.net/npm/@better-auth/core@1.7.14/dist/types/init-options.d.mts
- https://better-auth.com/docs/1.6/integrations/nestjs.md · https://cdn.jsdelivr.net/npm/@thallesp/nestjs-better-auth@2.8.0/README.md
- https://cdn.jsdelivr.net/npm/drizzle-orm@0.45.4/column-builder.d.ts · https://cdn.jsdelivr.net/npm/drizzle-orm@0.45.4/pg-core/query-builders/update.d.ts · https://cdn.jsdelivr.net/npm/drizzle-orm@0.45.4/pg-core/session.d.ts · https://orm.drizzle.team/docs/v0-v1-changes
- https://www.postgresql.org/docs/18/functions-uuid.html · https://www.postgresql.org/docs/18/sql-notify.html · https://www.postgresql.org/about/news/postgresql-19-rc-1-released-3409/
- https://node-postgres.com/apis/client · https://recall.ai/blog/postgres-listen-notify-does-not-scale · https://dbos.dev/blog/postgres-listen-notify-scalability
- https://github.com/vercel/turborepo/releases · https://alternativeto.net/news/2026/8/pnpm-12-reaches-stable-with-rust-rewrite-and-lockfile-fixes/
