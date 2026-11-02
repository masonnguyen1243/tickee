---
title: 'Epic 1 AI-1: Bịt rò PII trong log'
type: 'bugfix'
created: '2026-11-02'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '26ca940b740b7da029a958460f080fc691d8db3b'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-retro-2026-10-29.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Log của api còn rò PII qua bốn đường: pino-http ghi IP/User-Agent dạng rõ ở mọi request; redact theo khóa trần `name` che nhầm mọi trường `name` (tên logger, tên queue pg-boss); `ErrorFilter` log nguyên `err` cho lỗi 5xx nên `DrizzleQueryError` đưa params (email, token session) vào log; `logBetterAuth` giữ `e.message` của lỗi DB nên params lọt qua đường thứ hai (retro C1, deferred Triage #7, #8, #31). Story 2.6 sẽ thêm PII ngân hàng, nên phải bịt trước.

**Approach:** Thêm đường dẫn redact cho IP/UA của request; khóa chung chung như `name` chỉ bị che dưới đối tượng người dùng; một helper ở `platform/logging` nhận diện lỗi DB và rút gọn còn `{ type, code }`, được `ErrorFilter` và `logBetterAuth` dùng chung. Có test cho cả đường `ErrorFilter` và đường Better Auth.

## Boundaries & Constraints

**Always:** Che bằng `REDACTED` (`[REDACTED]`) như hiện tại. Lỗi DB = `DrizzleQueryError` hoặc `pg.DatabaseError` ở chính lỗi hay bất kỳ tầng `cause` nào (giới hạn độ sâu để tránh vòng lặp). `code` của bản rút gọn là SQLSTATE lấy từ lỗi hoặc `cause`. Lỗi 5xx không phải lỗi DB vẫn log `{ err }` đầy đủ (giữ stack để gỡ lỗi). Khóa PII không chung chung (`email`, `phone`, `contactPhone`, `ipAddress`, `userAgent`…) vẫn che theo khóa ở độ sâu 0–2 như cũ.

**Never:** Không log câu SQL hay params của lỗi DB. Không đổi dạng log `errName/code` của `identity.controller.ts` (test 1.4 đang ghim). Không đổi `PII_COLUMNS`/`PII_KEYS` trong `@tickee/contracts`. Không xử lý log của pg-boss (`jobs.module.ts`) hay `database.ts` trong story này.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Request log | Request có `user-agent`, `x-forwarded-for`, `x-real-ip`, `forwarded` | `req.remoteAddress` và các header trên là `[REDACTED]`; `method`, `url`, `requestId` giữ nguyên | N/A |
| Khóa `name` | `log.info({ name: 'invitation.send', user: { name: 'Nguyễn A' } })` | `name` giữ nguyên; `user.name` bị che (cả `*.user.name`, `*.*.user.name`) | N/A |
| 5xx lỗi DB | Handler ném `DrizzleQueryError(query, [email], cause{code:'57P01'})` | 500 `INTERNAL_ERROR`; log `err: { type: 'DrizzleQueryError', code: '57P01' }`, không có query/params/message của cause | N/A |
| 5xx AppError bọc lỗi DB | `AppError(INTERNAL_ERROR, …, { cause: DrizzleQueryError })` | Log `{ err: { type, code: SQLSTATE }, code: 'INTERNAL_ERROR' }` | N/A |
| 5xx lỗi thường | `new Error('x')` | Log `{ err }` đầy đủ như cũ | N/A |
| Better Auth lỗi DB | `logBetterAuth('error', drizzleErr)` hoặc `logBetterAuth('error', 'Failed to create user', drizzleErr)` | `errors: [{ type, code }]` không có `message`; nếu thông điệp chính là lỗi DB thì `msg` = tên lớp lỗi | N/A |
| Better Auth chuỗi chứa params | `msg` có dạng `Failed query: …\nparams: a@b.vn,tok` | Phần từ `params:` trở đi bị thay bằng `params: [REDACTED]`; email vẫn bị che | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/platform/logging/pino-options.ts` -- `buildRedactPaths()` sinh `k`, `*.k`, `*.*.k` từ `PII_KEYS`; thêm đường dẫn IP/UA cạnh `req.headers.authorization`; tách khóa chung chung (`name`) sang đường dẫn dưới `user`.
- `apps/api/src/platform/logging/index.ts` -- barrel; export thêm helper mới.
- `apps/api/src/platform/http/error.filter.ts:54,62` -- hai chỗ `this.logger.error({ err: … })` cần đi qua helper.
- `apps/api/src/modules/identity/better-auth-logger.ts` -- `logBetterAuth`; giữ che email bằng `EMAIL_PATTERN`.
- `apps/api/src/modules/identity/identity.controller.ts:23-35` -- `errorSummary` (đã lấy SQLSTATE từ `cause.code`): tham khảo cách lấy `code`, **không đổi**.
- `apps/api/src/main.ts:6` -- comment nói `name` bị che; sửa comment cho đúng (giữ `context`, trùng khóa của log Nest).
- `drizzle-orm/errors` (`DrizzleQueryError`), `pg` (`pg.DatabaseError`, import mặc định như `platform/db/database.ts`).
- Test: `apps/api/test/logging.test.ts` (unit pino, dòng 10 đang kiểm mọi `PII_KEYS` có trong paths: sửa theo quy tắc mới), `apps/api/test/http.test.ts` (`BoomController` + `LogCapture`), `apps/api/test/identity/better-auth-logger.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/platform/logging/db-error.ts` -- tạo `isDatabaseError(err)` và `dbErrorSummary(err): { type: string; code?: string }`; export qua `index.ts` -- một chỗ nhận diện cho cả hai đường.
- [x] `apps/api/src/platform/logging/pino-options.ts` -- thêm `req.remoteAddress`, `req.headers["user-agent"]`, `req.headers["x-forwarded-for"]`, `req.headers["x-real-ip"]`, `req.headers.forwarded`; khóa thuộc tập chung chung (`name`) chỉ sinh `user.<k>`, `*.user.<k>`, `*.*.user.<k>` -- bịt Triage #7, #8.
- [x] `apps/api/src/platform/http/error.filter.ts` -- lỗi DB (ở `exception` hoặc `exception.cause`) log `err: dbErrorSummary(...)`; lỗi khác giữ nguyên -- Triage #31.
- [x] `apps/api/src/modules/identity/better-auth-logger.ts` -- lỗi DB chỉ còn `{ type, code }`; `msg` từ lỗi DB = tên lớp; cắt phần `params:` trong chuỗi -- retro C1.
- [x] `apps/api/src/main.ts` -- sửa comment dòng 6.
- [x] Test -- `logging.test.ts`: IP/UA, khóa `name`, `isDatabaseError` qua `cause`, lỗi thường không bị coi là lỗi DB; `http.test.ts`: route ném `DrizzleQueryError` và `AppError` bọc lỗi DB, request có UA/XFF; `better-auth-logger.test.ts`: lỗi DB làm thông điệp và làm tham số, chuỗi có `params:`.

**Acceptance Criteria:**
- Given api chạy với `LogCapture`, when request kèm `user-agent`/`x-forwarded-for` riêng, then toàn bộ log không chứa hai giá trị đó.
- Given lỗi DB mang email và token trong params, when nó đi qua `ErrorFilter` hoặc `logBetterAuth`, then log không chứa email, token, câu SQL hay message của `cause`, nhưng có tên lớp lỗi và SQLSTATE.
- Given toàn bộ test api hiện có, when chạy lại, then vẫn pass (gồm test 1.4 `DB lỗi khi đếm → 302 start_failed`).

## Implementation Notes

- `dbErrorSummary(err).type` là tên lớp (`constructor.name`) của chính lỗi được truyền vào, như serializer `err` của pino; không dùng `e.name` vì `pg.DatabaseError.name` là `'error'` và `DrizzleQueryError` không đặt `name`. `ErrorFilter` truyền `exception.cause ?? exception` như trước, nên `AppError` bọc lỗi DB ra `type: 'DrizzleQueryError'`.
- `code`: ưu tiên chuỗi dạng SQLSTATE (`/^[0-9A-Z]{5}$/`) ở bất kỳ tầng nào trong chuỗi `cause`; không có thì lấy mã định danh đầu tiên (ví dụ `ECONNREFUSED` khi Drizzle bọc lỗi kết nối); `code` là chuỗi tự do thì bỏ. Duyệt tối đa 8 tầng `cause` và dừng khi gặp lại một tầng đã đi qua; chuỗi bị cắt vì quá 8 tầng thì coi là lỗi DB (fail closed: serializer `err` của pino sẽ nối message của mọi tầng `cause`).
- `logBetterAuth` chỉ cắt từ `\nparams:` (đúng dạng message của Drizzle; `Invalid params: x` giữ nguyên), cả ở `msg` lẫn `message` của lỗi không phải lỗi DB trong `errors[]` (Better Auth có thể bọc message của lỗi Drizzle vào lỗi của nó mà không giữ `cause`).
- Tập khóa chung chung là `GENERIC_PII_KEYS` (export từ `pino-options.ts`, hiện chỉ có `name`).
- Ngoài các header trong spec, che thêm header IP của CDN/LB: `cf-connecting-ip`, `true-client-ip`, `x-client-ip`, `x-cluster-client-ip`, `fastly-client-ip`, `fly-client-ip`.

## Spec Change Log

## Review Triage Log

Lượt 1 (2026-11-02). Lớp: blind-hunter (BH), edge-case-hunter (EC), verification-gap (VG).

| # | Lớp | Phát hiện | Verdict | Bằng chứng | Hướng |
|---|-----|-----------|---------|------------|-------|
| 1 | BH, EC, VG | Quá 8 tầng `cause` thì `isDatabaseError` trả false (fail-open), trong khi serializer `err` của pino nối message của mọi tầng `cause` | low | `pino-std-serializers@7.1.0` nối message/stack theo `cause` không giới hạn; repo hiện không có chuỗi sâu như vậy, nhưng sửa chỉ là đảo kết quả khi bị cắt | patch |
| 2 | BH, EC | `AggregateError.errors` / thuộc tính khác `cause` chứa lỗi DB không bị nhận diện | low | Serializer có ghi `aggregateErrors` và thuộc tính lỗi khác, nhưng không đường code nào trong repo tạo lỗi như vậy; sửa phải thêm duyệt cây | reject |
| 3 | BH, VG | Worker `invitation-jobs.ts:192-194` log `err.message` (có `Failed query … params:`) và ghi vào `output` của job; `main.ts` `bootLog.fatal({ err })` | medium | Đã đọc code: đúng, nhưng là code có từ trước (Story 2.4/1.1), diff này không đụng tới | defer |
| 4 | BH | Kiểm `not.toContain(query)` / `causeMessage` có dấu `"` luôn pass vì `JSON.stringify` escape `"` | medium | Đã chạy thử: chuỗi stringify không bao giờ chứa nguyên văn chuỗi có `"`; kiểm SQL trong `http.test.ts` và `better-auth-logger.test.ts` là kiểm rỗng | patch |
| 5 | BH, EC | `logBetterAuth` vẫn giữ SQL trước `params:` trong chuỗi | low | Đúng như dòng I/O Matrix đã duyệt; SQL của Drizzle/Better Auth được tham số hóa, `src` không có `sql.raw`; sửa phải đổi spec | reject |
| 6 | BH, EC | Chỉ che `name` dưới `user`, bỏ sót `invitee.name`, `profile.name`… | low | Intent đã chốt "chỉ che dưới đối tượng người dùng"; không log nào trong `src` đặt tên người dưới khóa khác; đảo sang danh sách loại trừ là đổi thiết kế | reject |
| 7 | BH | `instanceof` phụ thuộc một bản `drizzle-orm` | false | Lỗi do session của instance `db` mà api tạo ra ném ra, nên cùng lớp với import của api; Better Auth gọi qua `db` đó | reject |
| 8 | BH | Bản rút gọn thiếu `constraint`/`table`/stack | low | Intent chốt `{ type, code }`; thêm trường là đổi spec | reject |
| 9 | BH, EC | Nhánh lỗi không phải DB của `logBetterAuth` dùng `e.name`, `code` không lọc; `CODE_PATTERN` lỏng | low | Nhánh này có từ trước; `code` của lỗi Better Auth/Node là mã cố định, không gặp chuỗi tự do trong thực tế | reject |
| 10 | BH, EC | Thiếu header IP của CDN/LB (`cf-connecting-ip`, `true-client-ip`, `x-client-ip`, `x-cluster-client-ip`, `fastly-client-ip`, `fly-client-ip`) | low | Topology AD-36 có load balancer, nhà cung cấp chưa chốt; sửa chỉ là thêm phần tử vào danh sách | patch |
| 11 | VG | AppError 5xx có `cause` không phải lỗi DB: không test nào kiểm vẫn log `err` đầy đủ | medium | Đã xem: `http.test.ts` "HTTP khi DB xuống" bỏ `logs`; đổi dòng 59 thành luôn rút gọn thì không test nào fail | patch |
| 12 | EC | Lỗi thường chép message của lỗi DB mà không giữ `cause` | low | Không thấy đường nào trong repo làm vậy tới `ErrorFilter`; sửa phải thêm heuristic | reject |
| 13 | EC | Mã errno 5 ký tự (`EPIPE`) ở tầng ngoài khớp `SQLSTATE_PATTERN`, che mất SQLSTATE thật | low | Đúng về regex, nhưng cần lỗi ngoài có `EPIPE` bọc lỗi DB, thực tế không gặp; sửa phải thêm nhánh ưu tiên | reject |
| 14 | EC | `PARAMS_PATTERN` khớp `params:` ở bất kỳ đâu (`Invalid params: x`) nên che nhầm chẩn đoán | low | Đúng; định dạng Drizzle là `\nparams:`; sửa là neo regex vào xuống dòng | patch |
| 15 | EC | Lỗi DB bị bọc cho `type: 'Error'` | low | Đúng thiết kế ghi ở Design Notes (tên lớp như serializer pino); SQLSTATE vẫn còn | reject |
| 16 | EC | `code` không luôn là SQLSTATE (`ECONNREFUSED`) | low | Lỗi kết nối bị Drizzle bọc; mã errno có ích, không lộ dữ liệu | reject |

## Design Notes

Khóa chung chung là khóa PII trùng tên với trường log thông dụng (`name`: tên logger của pino, tên queue/job của pg-boss, `Error.name`). Đặt tập này ở `pino-options.ts` (không ở contracts) vì đây là chuyện của log; bảng sau thêm cột `name` thì vẫn được che dưới `user`. Không che `organization.name` (tên BTC công khai).

Bản rút gọn dùng khóa `type` như serializer `err` chuẩn của pino để đọc log thống nhất:

```ts
logger.error({ err: dbErrorSummary(e) }, 'Lỗi không bắt được'); // { err: { type: 'DrizzleQueryError', code: '57P01' } }
```

## Verification

**Commands:**
- `pnpm --filter @tickee/api typecheck` -- expected: không lỗi
- `pnpm --filter @tickee/api test` -- expected: pass toàn bộ (cần Postgres test đang chạy)
- `pnpm --filter @tickee/api lint:deps` -- expected: không vi phạm ranh giới
