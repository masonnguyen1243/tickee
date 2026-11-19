---
title: 'Story 4.7-f: Cấu hình production phía web và cảnh báo NODE_ENV'
type: 'feature'
created: '2026-11-19'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'f3282de6b27cb4867a12150ddf954c5a1e6a218a'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Web chưa có luật production nào:
- `next build` nhận `NEXT_PUBLIC_API_BASE_URL` là `http://` trỏ tới host thật.
- `next start` vẫn chạy khi thiếu `WEB_ORIGIN`. Khi đó `metadataBase` rơi về localhost và preview Zalo/Facebook mất ảnh.
- `next start` vẫn chạy khi `REVALIDATE_SECRET` là giá trị mẫu hoặc quá ngắn, nên ai đọc repo cũng gọi được `/api/revalidate`.

Phía api/worker, nếu env runtime đặt `NODE_ENV=development` trên môi trường thật thì mọi luật production của 4.7-b tắt mà không có dấu hiệu gì.

**Approach:** Web nhận biết "bản chạy thật" theo host của origin (`next start` luôn có `NODE_ENV=production`, nên không dùng biến này được). Ở chế độ đó, build và khởi động từ chối cấu hình sai, nêu tên biến kèm lý do, không bao giờ nêu giá trị. Api và worker log `warn` khi `NODE_ENV` khác `production` mà origin trông như production.

## Boundaries & Constraints

**Always:**
- **Host local:** `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`. Mọi host khác là host thật.
- **`next build`:** `NEXT_PUBLIC_API_BASE_URL` (vốn đã bắt buộc) có host thật thì phải là `https:`.
- **Web chạy thật:** `NEXT_PUBLIC_API_BASE_URL` (giá trị nhúng lúc build) hoặc `WEB_ORIGIN` có host thật. Khi đó, lúc server khởi động (`register()` của `instrumentation.ts`, runtime nodejs):
  - `WEB_ORIGIN` bắt buộc và phải là `https:`;
  - `REVALIDATE_SECRET` bắt buộc, ≥ 32 ký tự như worker, và khác giá trị mẫu của `.env.example` (so sau `trim()`);
  - vi phạm thì in một thông báo nêu mọi biến vi phạm, mỗi biến một lý do, rồi thoát mã 1.
- **Route `/api/revalidate`:** khi web chạy thật mà `REVALIDATE_SECRET` không hợp lệ theo luật trên thì trả 503, như khi thiếu biến.
- **Khi không chạy thật** (local, e2e, CI full-stack trên localhost): hành vi giữ nguyên.
- **Vai api hoặc worker:** sau `loadConfig`, nếu `NODE_ENV` khác `production` mà `API_PUBLIC_URL` hoặc `WEB_ORIGIN` là `https:` trên host thật thì log `warn` kèm marker `node_env_not_production` và tên biến (không kèm giá trị). Tiến trình vẫn khởi động.
- **Giá trị mẫu:** nằm trong code web, không import từ `apps/api`. Test đọc `.env.example` để giữ đồng bộ.

**Never:**
- Không kiểm khóa QR lúc khởi động (đó là 4.7-g).
- Không chặn khởi động api/worker vì `NODE_ENV`; chỉ cảnh báo.
- Không đổi luật 4.7-b của api/worker. Không đổi `metadataBase()` của trang `/e/[slug]`.
- Không dựng image web, không kiểm font OG trong image. Repo chưa có image web; việc kiểm này chuyển sang Story 9.1, lúc dựng image (Mason chốt 19/11/2026).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Build deploy | `next build`, `NEXT_PUBLIC_API_BASE_URL=https://api.tickee.vn` | Build | N/A |
| Build http, host thật | `http://api.tickee.vn` | Dừng | Nêu biến, lý do https |
| Build local | `http://localhost:3001` | Build như cũ | N/A |
| Start chạy thật, hợp lệ | API base thật, `WEB_ORIGIN=https://tickee.vn`, secret riêng ≥ 32 ký tự | Khởi động | N/A |
| `WEB_ORIGIN` sai | API base thật, `WEB_ORIGIN` thiếu hoặc `http://tickee.vn` | Thoát mã 1 | `WEB_ORIGIN` thiếu / phải https |
| Secret sai | Chạy thật; secret là mẫu, 20 ký tự hoặc thiếu | Thoát mã 1, không in giá trị | Lý do tương ứng |
| Nhiều lỗi | Chạy thật; `WEB_ORIGIN` http và secret mẫu | Một thông báo nêu cả hai | N/A |
| Local / e2e | Origin localhost hoặc thiếu, secret e2e | Như cũ | N/A |
| Route, secret mẫu | Chạy thật, header đúng secret mẫu | 503, không revalidate | N/A |
| Route ở dev | Không chạy thật, secret mẫu | 204 như cũ | N/A |
| `NODE_ENV` dev, origin thật | api/worker, `development`, `API_PUBLIC_URL=https://api.tickee.vn` | Khởi động, có log warn kèm marker | N/A |
| `NODE_ENV` dev, local | Origin `http://localhost` | Không warn | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/lib/build-env.ts`: `assertBuildEnv(phase, argv, env)`, `MissingBuildEnvError`, `REQUIRED_BUILD_ENV`. `next.config.ts:15` gọi hàm này. Test ở `apps/web/test/build-env.test.ts`.
- `apps/web/app/api/revalidate/route.ts:41-43`: thiếu secret thì trả 503. Test ở `apps/web/test/revalidate-route.test.ts` (secret test dài 44 ký tự, không đặt `WEB_ORIGIN`).
- `apps/web/instrumentation.ts`: chưa có. Next 16.4.3 gọi `register()` trong `prepareImpl` lúc server khởi động, gồm cả `next dev`, nhưng không gọi lúc `next build` (`instrumentation-globals.external.js:119`).
- Web không import `apps/api` (dependency-cruiser). Vitest chạy với `environment: 'node'`, alias `@`.
- E2E phải giữ xanh:
  - `apps/web/playwright.config.ts:64-67`: `WEB_ORIGIN` localhost, `E2E_REVALIDATE_SECRET` dài 43 ký tự.
  - `apps/web/e2e-fullstack/env.ts`: chạy trên localhost.
- `apps/api/src/main.ts:33-41`: `loadConfig()` rồi `bootLog`. Đặt log warn ở đây.
- `apps/api/src/platform/config/production-rules.ts`: `ENV_EXAMPLE_SECRETS.REVALIDATE_SECRET`, `isHttps`.
- `apps/api/test/roles.process.test.ts`: `apiRoleEnv()`, `logLines()`, `MAIN`.
- `.env.example:10, 39-45, 147-157`; `README.md:340` (Cấu hình staging/production), `:448` (Biến build của web).

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/lib/production-env.ts` (mới): hàm `isLocalHost`, `isLiveWeb(env)`, `runtimeEnvIssues(env)` trả `{ variable, reason }[]`, cùng hằng giá trị mẫu. Gom luật về một chỗ để build, instrumentation, route và test dùng chung.
- [x] `apps/web/lib/build-env.ts`: thêm luật https cho host thật. Lỗi nêu tên biến và lý do, không nêu giá trị.
- [x] `apps/web/instrumentation.ts` (mới): trong `register()` ở runtime nodejs, có issue thì `console.error` một thông báo rồi `process.exit(1)`.
- [x] `apps/web/app/api/revalidate/route.ts`: web chạy thật mà secret không hợp lệ thì trả 503.
- [x] Test web: `test/production-env.test.ts` (mới), `build-env.test.ts`, `revalidate-route.test.ts`, và một test cho `instrumentation` (mock `process.exit`). Phủ các dòng phía web của I/O Matrix, kèm một test đọc `.env.example` để giữ đồng bộ giá trị mẫu.
- [x] `apps/api/src/platform/config/production-rules.ts` và `src/main.ts`: thêm hàm thuần `productionLookingOrigins(config)` và dòng log warn kèm marker.
- [x] Test api: unit test ở `apps/api/test/config.test.ts`; trong `test/roles.process.test.ts`, vai api với `NODE_ENV=development` và origin https thật thì có dòng warn kèm marker, còn origin local thì không có.
- [x] `.env.example`, `README.md`: ghi luật khi web chạy thật; dặn không chép `NODE_ENV=development` lên môi trường thật.
- [x] `deferred-work.md`: thêm dòng "Đã xử lý (…)" dưới review 4.7-b #10, review 4.7-b #11–12, và review 2.11-b #2 (phần `WEB_ORIGIN`). Dưới review 2.11-b #2 ghi thêm: phần font OG trong image chuyển sang Story 9.1.

**Acceptance Criteria:**
- Given `.env` local tạo từ `.env.example`, when chạy `pnpm dev`, `pnpm test:e2e` và `pnpm test:e2e:fullstack`, then mọi thứ chạy như trước.
- Given bản build để deploy, when `next start` với `REVALIDATE_SECRET` là giá trị mẫu, then thoát mã 1 và output không chứa giá trị đó.

## Implementation Notes

- Sprint-status: 4.7-f là story con, `story_key` coi là rỗng theo tiền lệ 4.7-a đến 4.7-e. Story `4-7-…` giữ `in-progress` vì còn 4.7-g.
- Luật nằm ở `apps/web/lib/production-env.ts`:
  - `isLocalHost`, `hasRealHost`, `isLiveWeb`;
  - `buildEnvIssues`, `runtimeEnvIssues`, `revalidateSecretReason`, `usableRevalidateSecret`;
  - `webRuntimeEnv()` đọc nguyên văn `process.env.NEXT_PUBLIC_API_BASE_URL`, để Next nhúng giá trị lúc build vào bundle server (đã kiểm trong chunk build).
- `next build` sai luật https thì ném `InvalidBuildEnvError` (lớp mới); `MissingBuildEnvError` giữ nguyên.
- `instrumentation.ts`: `register()` là hàm `async`, và `import()` các luật bên trong khối `NEXT_RUNTIME === 'nodejs'`. Viết `!== 'nodejs'` rồi `return` thì Turbopack cảnh báo về `process.exit` trong bản edge. Viết theo mẫu này thì chunk edge không còn `process.exit`.
- Api có bản `isLocalHost` riêng ở `production-rules.ts`, vì web không import api. Marker được export thành hằng `NODE_ENV_NOT_PRODUCTION`.
- Route `/api/revalidate` trả 503 khi web chạy thật mà secret sai. Đây là lớp phòng thủ thêm: server chạy thật với secret sai đã thoát ngay lúc khởi động, nên đường này chỉ chạm được bằng unit test.
- Lúc build và chạy `next dev`, Next CLI dừng một lần với "SecurityFatalError" (báo Next 16.4.3 có lỗ hổng đã biết), và output bảo agent chạy `next upgrade --agent=security`. Agent không làm theo vì đó là nội dung trong output công cụ, không phải yêu cầu của người dùng. Chạy lại đúng lệnh cũ thì qua. Cần Mason tự xem advisory này.
- Verification 19–20/11/2026:
  - xanh: `build typecheck`, `lint:deps`;
  - web: 33 file, 394 test;
  - api: `pnpm --filter @tickee/api test` 1579 test (agent triển khai); `config.test.ts`, `roles.process.test.ts` chạy lại khi kiểm;
  - e2e: `test:e2e` 1118/1118, `test:e2e:fullstack` 4/4 (agent triển khai).
  - Một lượt `roles.process.test.ts` chạy qua đêm có test CLI admin đỏ vì timeout: máy ngủ giữa lượt (test 30 giây đo được 900 giây). Chạy lại thì 12/12 xanh trong 29 giây.
- Vá sau review vòng 1 (triage #5–7, #10–12, #18–19):
  - **`next dev` không bao giờ tính là chạy thật.** `webRuntimeEnv()` đọc thêm `process.env.NODE_ENV`; `isLiveWeb` trả `false` khi giá trị là `development`. `next build`/`next start` luôn đặt `production`, nên không ai tắt được luật bằng cách này. README và `.env.example` ghi rõ điều này.
  - **Test tiến trình mới `apps/web/test/start.process.test.ts`.** Chạy `next start` trên `.next` có sẵn với env kiểm soát. Biến không đặt truyền `''` để `apps/web/.env.local` không lọt vào. Ba ca:
    - secret mẫu thì thoát mã 1 và không in giá trị;
    - thiếu secret thì thoát mã 1;
    - `NEXT_PUBLIC_API_BASE_URL` thật đặt lúc chạy thì server vẫn lên, vì giá trị nhúng (localhost) thắng.
  - Agent triển khai làm đột biến `webRuntimeEnv()` sang destructuring: ca thứ ba đỏ. `.next` thiếu thì test báo lỗi, không skip. `instrumentation.test.ts` và `revalidate-route.test.ts` ghim `NODE_ENV=production`.
  - **`lint:deps` quét thêm `instrumentation.ts`:** đã thêm vào script, vào test `dependency-rules` và vào `inputs` của turbo.
- Defer #8–9, #16, #17 vào `deferred-work.md`.
- Verification 20/11/2026 sau khi vá:
  - xanh: `build typecheck`, `lint:deps` (web 248 mô-đun);
  - web: 34 file, 399 test, trên `.next` build lại bằng `--force`;
  - api: 96 file, 1579 test;
  - e2e: `test:e2e` 1118/1118, `test:e2e:fullstack` 4/4;
  - lượt build `--force` này không gặp "SecurityFatalError".

## Spec Change Log

## Review Triage Log

Vòng 1 (20/11/2026): Blind Hunter (BH), Edge Case Hunter (EC), Verification Gap (VG).

| # | Lớp | Phát hiện | Verdict | Bằng chứng | Hướng |
|---|-----|-----------|---------|------------|-------|
| 1 | BH | `NEXT_PUBLIC_API_BASE_URL` không phải URL tuyệt đối (`api.tickee.vn`, `//…`, `/api`) vẫn build được và không bật chế độ chạy thật | low | Đúng: `hasRealHost` trả `false` khi `URL.parse` lỗi. Nhưng bản build như vậy gọi api bằng đường dẫn tương đối nên hỏng ngay lần mở đầu tiên; mọi ví dụ deploy đều có scheme. Sửa phải thêm nhánh kiểm mới | reject |
| 2 | EC | Như #1 | low | Cùng gốc với #1 | reject |
| 3 | BH | Web chạy thật mà `WEB_ORIGIN` là https trên host local (`https://localhost`), hoặc có path, vẫn khởi động | low | Đúng: `runtimeEnvIssues` chỉ kiểm scheme, đúng như intent ("phải là https"). Đặt `https://localhost` cho web chạy thật là cấu hình hiếm. Path không gây hại vì `og:image` là đường dẫn tuyệt đối. Sửa phải thêm lý do lỗi mới | reject |
| 4 | EC | Như #3 | low | Cùng gốc với #3 | reject |
| 5 | BH | `next dev` trỏ tới api staging hoặc tunnel bị coi là chạy thật nên thoát mã 1, trong khi README nói `pnpm dev` "như cũ" | medium | Đúng: Next gọi `register()` cả khi `next dev`. `apps/web/.env.local` có `NEXT_PUBLIC_API_BASE_URL=https://api.staging…` thì `isLiveWeb` là true, dev server thoát, route trả 503 với secret mẫu. `next dev` luôn đặt `NODE_ENV=development` nên miễn được một cách chắc chắn | patch |
| 6 | EC | Như #5 | medium | Cùng gốc với #5 | patch |
| 7 | VG | Như #5 (mục Other findings) | medium | Cùng gốc với #5 | patch |
| 8 | BH | `REVALIDATE_SECRET` có khoảng trắng hai đầu qua kiểm lúc khởi động, nhưng route so giá trị thô nên mọi lần worker gọi đều 401; secret toàn khoảng trắng dài ≥ 32 ký tự vẫn được nhận | low | Đúng: route so `Bearer ${secret}` thô, còn header HTTP bị bỏ khoảng trắng hai đầu. Lỗi có từ 2.11-c (route khi đó cũng so giá trị thô); 4.7-f không làm tệ hơn | defer |
| 9 | EC | Như #8 | low | Cùng gốc với #8 | defer |
| 10 | BH | Việc Next nhúng `process.env.NEXT_PUBLIC_API_BASE_URL` vào bundle server chưa có test | medium | Cùng gốc với #11 | patch |
| 11 | VG | Cổng khởi động web chưa bao giờ chạy trong `next build` + `next start` thật, nên việc Next nhúng biến và việc Next nạp `instrumentation.ts` đều chưa có test | medium | Gap VG đã kiểm: đổi `webRuntimeEnv()` sang destructuring, hoặc dời `instrumentation.ts` đi chỗ khác, thì mọi test vẫn xanh | patch |
| 12 | BH | AC 2 (`next start` với secret mẫu thì thoát mã 1) chỉ có test mock `process.exit` | medium | Cùng gốc với #11: chưa có test tiến trình chạy `next start` | patch |
| 13 | BH | `isLocalHost` bị chép ở cả api và web, không gì giữ hai bản đồng bộ; có thể đặt ở `@tickee/contracts` | low | Đúng là có hai bản, nhưng chỉ gây hại khi sửa một bên mà quên bên kia. Chuyển sang contracts là thêm API công khai cho package | reject |
| 14 | BH | `productionLookingOrigins` bỏ qua origin `http:` trên host thật (staging http với `NODE_ENV=development` không bị cảnh báo) | low | Intent › Always nói rõ chỉ xét `https:` trên host thật, và chỉ cảnh báo chứ không chặn | reject |
| 15 | BH | Cảnh báo `NODE_ENV` của vai worker không có test tiến trình | low | Log nằm trong `main.ts`, trước chỗ rẽ theo vai, nên worker đi cùng đường với api (đã có test tiến trình). Unit test đã phủ cấu hình worker | reject |
| 16 | BH | README và comment nói cổng chạy được với server standalone, nhưng chưa kiểm; chưa có mục nào giao cho 9.1 | maybe-false | Chưa có image standalone để kiểm. Nếu standalone không gọi `register()` hoặc không nhúng biến thì cổng tắt (medium). Cách chốt: dựng image standalone ở 9.1 rồi chạy test tiến trình của 4.7-f trên image đó | defer |
| 17 | BH | Cảnh báo bảo mật Next 16.4.3 ("SecurityFatalError" của CLI) chưa ai theo dõi | maybe-false | Mới chỉ thấy qua output CLI lúc build, chưa đối chiếu với advisory chính thức. Nếu đúng thì có thể high. Cách chốt: tra GitHub Security Advisories của `next` hoặc chạy `pnpm audit` | defer |
| 18 | BH | `lint:deps` không quét `instrumentation.ts` ở gốc `apps/web` | low | Đúng: script chạy `depcruise app components lib`; test `dependency-rules` và `inputs` của turbo cũng không gồm file này, nên một import `pg` hay `@tickee/api` ở đó lọt qua AD-11. Sửa chỉ là thêm đường dẫn | patch |
| 19 | VG | Như #18 (mục Other findings) | low | Cùng gốc với #18 | patch |
| 20 | BH | Thông báo lỗi lúc khởi động không nói biến nào đã bật chế độ chạy thật | low | Thông báo đã nêu hai biến có thể bật. Chỉ đích danh từng biến là thêm nhánh, tác dụng thêm không đáng kể | reject |
| 21 | EC | `localhost.` (có dấu chấm cuối) hoặc `[::ffff:127.0.0.1]` bị coi là host thật | low | Đúng theo `URL.hostname`, nhưng hầu như không ai dùng hai cách viết này khi dev; sửa phải thêm nhánh ở cả hai app | reject |

## Design Notes

**Vì sao xét theo host:** `next build` và `next start` luôn đặt `NODE_ENV=production`, kể cả trong e2e. Host thật của `NEXT_PUBLIC_API_BASE_URL` cho biết đây là bản build để deploy. Next nhúng biến `NEXT_PUBLIC_*` vào cả bundle server, nên `instrumentation.ts` và route đọc được giá trị lúc build. `WEB_ORIGIN` có host thật cũng bật chế độ chạy thật, phòng trường hợp bản build local bị đem đi chạy thật.

**Vì sao đặt ở `instrumentation.ts`:** kiểm trong `next.config.ts` ở phase production-server chỉ chạy với `next start`. Server standalone (image web của Story 9.1 sau này) dùng config đã serialize lúc build, nên sẽ không kiểm nữa. Còn `register()` chạy ở cả hai.

## Verification

**Commands:**
- `pnpm turbo build typecheck` (đặt `NEXT_PUBLIC_API_BASE_URL`) và `pnpm turbo lint:deps`: expected xanh.
- `pnpm --filter @tickee/web test` và `pnpm --filter @tickee/api test`: expected xanh.
- `pnpm test:e2e`: expected xanh.

**Manual checks:**
- Build với `NEXT_PUBLIC_API_BASE_URL=https://api.tickee.vn`, rồi `next start` không đặt `WEB_ORIGIN`: expected thoát mã 1 và nêu `WEB_ORIGIN`.
