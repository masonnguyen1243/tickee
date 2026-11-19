---
title: 'Story 4.7-c: CI chạy e2e full-stack'
type: 'chore'
created: '2026-11-19'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '84a1b786308b171abcfbafddb68b2fd71cc892d1'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Mọi Playwright hiện giả lập API bằng `page.route`. Vì vậy chưa có gì trong CI kiểm chuỗi thật: cookie qua hai cổng → `/me`, `returnTo`, IPN của Tingee fake → `markPaid` → SSE `EventSource` cross-origin → Trang Đơn, và email Vé do worker gửi. AC 4.7 đòi Playwright với Tingee fake trong pipeline trước khi staging tự deploy. Action item AI-6 (retro Epic 1) còn mở đúng phần này. Ngoài ra, triage #24 của 4.7-b ghi: chưa gì kiểm image chạy với `NODE_ENV=production` thật.

**Approach:** Thêm một bộ Playwright full-stack riêng. Bộ này chạy web build thật, api + worker từ `dist`, Tingee fake, Mailpit và một DB `tickee_e2e` tạo lại mỗi lượt. Có hai luồng: đăng nhập, và Đơn có phí. CI chạy bộ này trong job `ci` (gate bắt buộc), kèm một bước kiểm image vai worker ở production.

## Boundaries & Constraints

**Always:**
- **Tách khỏi bộ giả lập:** bộ mới ở `apps/web/e2e-fullstack/`, có config riêng `apps/web/playwright.fullstack.config.ts`. Hai bộ không chạy lẫn spec của nhau. Bộ giả lập giữ nguyên hành vi.
- **Mọi thứ chạy thật:** web chạy `next start` trên `localhost:3000`, api trên `localhost:3001` (khớp `NEXT_PUBLIC_API_BASE_URL` đã nhúng lúc build). Không `page.route` nào chặn `/v1/*` hay Tingee fake. Web và api đều dùng host `localhost`, không trộn với `127.0.0.1`.
- **Dựng stack bằng một lệnh** (`pnpm --filter @tickee/api e2e:stack`), theo thứ tự:
  1. Tạo lại DB `tickee_e2e` từ đầu bằng tài khoản superuser Postgres (mặc định `postgres:postgres@localhost:5432`, giống docker-compose và CI), cấp quyền như `init.sql`.
  2. Migrate bằng vai migrate.
  3. Chạy `db:seed` có sẵn.
  4. Chạy Tingee fake, api, worker.

  Gửi `SIGTERM` thì tắt hết. Không đụng DB `tickee` hay `tickee_test`.
- **Env lấy từ `.env.example`** (đọc file). Chỉ đè URL DB, `NODE_ENV=test` và các biến web cần. Không chép secret vào code test.
- **Sự kiện của test** do BTC demo tạo và mở bán qua API thật, trong global setup: đăng nhập OTP qua Mailpit, tạo Sự kiện, đặt chính sách hoàn vé, thêm Hạng vé có phí, rồi "Mở bán".
- **Chạy trên cả hai project** `ios-webkit` và `android-chromium`. Mỗi test dùng một email Người mua riêng (giới hạn OTP 60 giây/email).
- **Luồng đăng nhập (AI-6):**
  1. Mở `/tickets` (Vé của tôi, `buyer-gate.tsx`), bị chuyển sang `/dang-nhap?returnTo=…`.
  2. Nhập mã OTP lấy từ Mailpit, bấm "Đồng ý", về đúng `returnTo`.
  3. Tải lại trang: vẫn đăng nhập.
  4. Đăng xuất, tải lại trang: vẫn đăng xuất.
- **Luồng Đơn có phí:**
  1. Người mua chọn Hạng vé có phí, bấm "Mua", đăng nhập, rồi "Gửi Đơn".
  2. Trang Đơn mở ở tab A.
  3. Tab B mở cùng Đơn, bấm "Thanh toán", sang Tingee fake, bấm "Đã thanh toán (giả lập)", rồi về Trang Đơn và thấy Thành công.
  4. Tab A tự chuyển sang Thành công trong ≤ 3 giây mà không tải lại.
  5. Mailpit nhận email Vé gửi tới Người mua.
- **CI:**
  - thêm service Mailpit;
  - thêm bước "Playwright full-stack" ngay sau bước Playwright hiện có, cùng job `ci`, retries như config cũ;
  - test lỗi thì upload kết quả, trace và log của api, worker và fake.
- **CI kiểm image:** chạy image vai worker với `NODE_ENV` mặc định của image và `WEB_ORIGIN` là `http://…`. Phải thoát mã 1, output có `WEB_ORIGIN` và không có giá trị secret nào.

**Never:**
- Không sửa code sản phẩm của api hay web. Không thêm route chỉ dùng cho test. Không tạo Sự kiện bằng SQL.
  - Nếu bộ test lộ bug thật thì dừng và ghi vào Spec Change Log.
- Không dùng MinIO, đăng nhập Google, TOTP, luồng miễn phí, CTV hay `/admin`.
- Không deploy staging. Không sửa `docker/postgres/init.sql`.
- Không đổi bộ test cách ly: `apps/api/test/organizer/isolation.test.ts` đã chạy trong bước Vitest của CI.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Hai luồng | CI, PR bất kỳ | 2 spec × 2 project xanh | Fail thì job `ci` đỏ, có artifact |
| Chạy lại local | Chạy `pnpm test:e2e:fullstack` hai lần liên tiếp | Lần hai vẫn xanh (DB tạo lại, không vướng giới hạn OTP) | N/A |
| Thiếu dịch vụ | Postgres hoặc Mailpit không chạy | Dừng trước khi chạy test | Thông báo nêu tên dịch vụ thiếu |
| Trùng cổng | Đang chạy `pnpm dev` | Không dùng lại server đang chạy | Playwright báo cổng bận |
| Image production | Vai worker, `WEB_ORIGIN=http://…` | Thoát 1, output có `WEB_ORIGIN` | Không in giá trị |

</frozen-after-approval>

## Code Map

- `.github/workflows/ci.yml`:
  - Job `ci` hiện chỉ có service Postgres.
  - `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001` đặt ở cấp job (`:43`). Comment `:39-42` nói API bị giả lập; phải sửa.
  - Bước Playwright `:85`, artifact `:87-92`, build và chạy image `:94-103`.
- `apps/web/playwright.config.ts`: bộ giả lập (`testDir ./e2e`, hai project, 4 webServer). Không đổi; chép cách khai project và retries.
- `apps/web/e2e/fixtures.ts`: `test` có chờ hydrate, dùng lại.
- Selector:
  - Đăng nhập: `login.spec.ts:199-202, 303-304`.
  - Mua vé: `purchase.spec.ts:281-284, 317-321, 653, 1075`.
  - Thành công: `[data-slot="order-success"]`, tiêu đề "Vé của bạn đã sẵn sàng!".
- `apps/web/app/**/orders/[code]/order-payment.tsx:108`: "Thanh toán" chuyển cả trang tới `checkoutUrl`.
- `apps/web/lib/realtime/use-live-resource.ts:137`: `EventSource` với `withCredentials`.
- `apps/web/lib/api/client.ts:17-28`: trình duyệt gọi `NEXT_PUBLIC_API_BASE_URL`, còn SSR gọi `API_INTERNAL_URL`. Web cần thêm `WEB_ORIGIN` và `REVALIDATE_SECRET` (giống worker).
- `apps/api/test/tingee-fake/`:
  - Cổng `TINGEE_FAKE_PORT` (4010), chỉ bind `127.0.0.1`.
  - `POST /checkout/:orderId` ký IPN, chờ ACK, rồi trả 303 về `returnUrl` (`server.ts:600-695`).
  - Điền sẵn `ipnUrl` cho `SEED_IPN_KEY` (`demo-merchants.ts:39`).
- `apps/api/test/dev-seed/`: mẫu cho stack script mới (tsconfig riêng, build ra `node_modules/.cache`, chạy bằng script trong `package.json:22-23`).
  - Seed: BTC demo `btc.demo@tickee.local` đã duyệt, có key và tài khoản nhận tiền. Seed không tạo Sự kiện.
- `apps/api/src/roles/migrate.ts`: `runMigrations` (cách `test/global-setup.ts` dùng). `dist/main.js` nhận `APP_ROLE=api|worker`.
  - `/readyz` kiểm DB và `LISTEN`, không có tiền tố `/v1`.
  - Worker không mở cổng.
- `apps/api/src/platform/config/config.schema.ts`: biến bắt buộc (api `:242-282`, worker `:397-426`). Để trống `AUTH_COOKIE_DOMAIN`. `.env.example` đã có giá trị chạy được ở local.
- API dùng cho global setup:
  - `/v1/identity/otp`, `/otp/verify` (`apps/web/lib/auth/api.ts:23-35`);
  - `apps/api/src/modules/event/events.controller.ts` (tạo Sự kiện, `:69` mở bán);
  - `apps/api/src/flows/event-edit.controller.ts`;
  - `apps/api/src/flows/ticket-types.controller.ts`;
  - điều kiện mở bán ở `publish.service.ts:39-59` (giá ≥ `MIN_PAID_PRICE` 2.000đ). User chưa bật 2FA thì không bị `TotpGuard` chặn.
- `docker-compose.yml`: Mailpit `axllent/mailpit:v1.29` (1025/8025). API HTTP của Mailpit có ở `:8025/api/v1`. Repo chưa có helper đọc Mailpit.
- `apps/web/e2e/order-live.spec.ts:9-13`: comment để phần full-stack cho AI-6.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/test/e2e-stack/` (mới, kèm tsconfig) và script `e2e:stack` trong `apps/api/package.json`: dựng stack theo thứ tự ở Always, dùng lại `runMigrations`, seed và Tingee fake có sẵn. Log của từng tiến trình con có tiền tố và được ghi ra file.
- [x] `apps/web/e2e-fullstack/` (mới):
  - `env.ts`: đọc `.env.example`;
  - `mailpit.ts`: chờ thư theo người nhận, lấy mã OTP;
  - `global-setup.ts`: tạo Sự kiện;
  - `login.spec.ts` và `paid-order.spec.ts`: hai luồng ở Always.
- [x] `apps/web/playwright.fullstack.config.ts` (mới): webServer stack chờ `http://localhost:3001/readyz`, rồi `next start -p 3000`. `reuseExistingServer: false`, `outputDir` riêng.
- [x] Script `test:e2e:fullstack` ở `apps/web/package.json` (chỉ chạy) và ở `package.json` gốc (build api + web qua `dev-env.sh` rồi chạy).
- [x] `.github/workflows/ci.yml`: service Mailpit, bước full-stack, artifact, bước kiểm image worker ở production, sửa comment.
- [x] `apps/web/e2e/order-live.spec.ts`: sửa comment `:9-13` để trỏ sang bộ mới.
- [x] `README.md` (mục Kiểm tra): lệnh chạy, điều kiện (`docker compose up -d postgres mailpit`, tắt `pnpm dev`), và DB `tickee_e2e`.
- [x] `deferred-work.md`: thêm dòng "Đã xử lý (…)" dưới các mục `:438` (AI-6, Trang Đơn full-stack), `:852` (story con) và `:874` (image production).
- [x] `sprint-status.yaml`: đổi action item AI-6 sang `done`, kèm note. `4-7-…` giữ `in-progress`.

**Acceptance Criteria:**
- Given PR mở trên GitHub, when job `ci` chạy, then bước "Playwright full-stack" chạy hai luồng trên hai project. Một luồng fail thì job đỏ.
- Given máy local đã chạy `docker compose up -d postgres mailpit`, when chạy `pnpm test:e2e:fullstack`, then bộ test xanh mà không cần `.env` hay bước tay nào khác.

## Implementation Notes

- Sprint-status: theo tiền lệ 4.7-a và 4.7-b, `story_key` coi như rỗng; chỉ sửa action item AI-6.
- **Stack** (`apps/api/test/e2e-stack/main.ts`, `children.ts`):
  - Tingee fake chạy ngay trong tiến trình stack (`startTingeeFake`), seed cũng vậy (`runDevSeed`). Worker và api là tiến trình con `node dist/main.js`.
  - `runMigrations` import từ `dist/roles/migrate.js`. Bản biên dịch lại trong `.cache` không tìm được `apps/api/drizzle`, vì đường dẫn tính theo vị trí file.
  - Tên DB `tickee_e2e` là hằng, không đọc từ env. URL superuser đổi được bằng `E2E_POSTGRES_SUPERUSER_URL`.
  - Tiến trình con nào thoát thì cả stack tắt với mã 1. Log ở `test-results-fullstack/stack-logs/`.
- **Ngoài danh sách file của spec:** thêm `apps/web/e2e-fullstack/sign-in.ts` (email Người mua theo test/project/retry, điền OTP), `.gitignore` (`test-results-fullstack/`), và sửa comment trong `scripts/dev-env.sh`.
- **Chống ăn may:** `paid-order.spec.ts` kiểm stream `/live` trả 200 `text/event-stream` (đã nối SSE thì Trang Đơn thôi polling). Nó còn kiểm một cờ trên `window` để chắc tab A không tải lại, và kiểm `data-celebrate="true"`.
- **Verification 19/11/2026** (macOS, Docker local):
  - `pnpm test:e2e:fullstack` 4/4 xanh, chạy lại ngay lần hai vẫn 4/4.
  - Tắt Mailpit: stack dừng trước khi chạy test, nêu "Mailpit chưa chạy…".
  - Giữ cổng 3001: stack báo "Cổng 3001 (api) đang bận".
  - Script bước kiểm image (trích từ `ci.yml`) chạy trên image build local: thoát 1, có `"variable":"WEB_ORIGIN"`, không lộ secret.
  - `build typecheck` và `lint:deps` xanh.
  - Bộ giả lập 1116/1116 xanh. Lượt này do agent triển khai chạy; story chỉ sửa một comment trong bộ đó.
  - Chưa chạy trên GitHub Actions (Linux WebKit, service Mailpit).
- **Sau review vòng 1** (triage #1–4, #6, #9, #11–12, #16, #19, #25, #27):
  - `paid-order.spec.ts` kiểm CORS của `/live` (origin web, có credentials). Từ lúc stream mở tới ngay trước khi trả tiền, tab A không gửi GET Đơn nào trong 2,5 giây, nên đây là SSE thật chứ không phải polling.
  - `login.spec.ts` gửi lại cookie đã chụp trước khi đăng xuất: trước đó `/me` trả 200, sau đó trả 401.
  - Stack tắt với mã 1 khi `/readyz` hết giờ.
  - Tài liệu ghi `E2E_POSTGRES_SUPERUSER_URL` chỉ đổi user/mật khẩu.
  - Email Người mua có thêm `repeatEachIndex`.
  - Dòng "Đã xử lý" của deferred-work `:438` ghi rõ tab A không bị đưa xuống nền.
  - Verification 19/11/2026: `build typecheck`, `lint:deps` xanh. Full-stack 4/4 hai lượt liên tiếp. Agent triển khai chạy thêm `--repeat-each=2` được 8/8.
- **Phủ bảng I/O:**
  - "Hai luồng": hai spec × hai project.
  - "Chạy lại local": chạy hai lượt liên tiếp.
  - "Thiếu dịch vụ", "Trùng cổng": kiểm tay bằng lệnh ở trên, vì đây là hành vi của harness, không có test tự động.
  - "Image production": chính bước CI đó là test.

## Spec Change Log

## Review Triage Log

Vòng 1 (19/11/2026): Blind Hunter (BH), Edge Case Hunter (EC), Verification Gap (VG).

| # | Lớp | Phát hiện | Verdict | Bằng chứng | Hướng |
|---|-----|-----------|---------|------------|-------|
| 1 | VG | `paid-order.spec.ts` không phân biệt được tín hiệu SSE với polling 2 giây: stream đứt sau header thì tab A vẫn sang Thành công trong 3 giây | medium | Gap đã kiểm. `ORDER_WAITING_POLL_MS = 2_000`; `onerror` bật lại polling. Test chỉ kiểm phản hồi đầu của `/live` | patch |
| 2 | VG | Comment "Phiên đã hủy ở api" ở `login.spec.ts` nói quá: cookie đã bị xóa nên 401 vẫn ra dù api không xóa phiên | low | Đúng: `page.request` dùng chung cookie jar, đăng xuất trả cookie hết hạn | patch |
| 3 | BH | Như #1; thêm: không kiểm header CORS của stream | medium | Cùng gốc với #1. Thêm kiểm `access-control-allow-origin`/`-credentials` chỉ là sửa trực tiếp | patch |
| 4 | BH | Như #2: giữ cookie trước khi đăng xuất rồi gửi lại để chứng minh phiên bị hủy | low | Cùng gốc với #2 | patch |
| 5 | BH | Ngân sách 3 giây tính từ lúc tab B commit, muộn hơn lúc IPN | false | Always của spec xếp bước 4 (tab A ≤ 3 giây) sau bước 3 (tab B về Trang Đơn), đúng như deferred-work `:438` ("quay lại tab thấy Thành công < 3 giây"). Code đo đúng mốc đó | reject |
| 6 | BH | `waitForApi` hết giờ chỉ log, không tắt stack; hai ngân sách thời gian không suy ra từ nhau | low | Đúng ở nhánh `else if (!stopping)`: lệnh `e2e:stack` chạy tay sẽ treo. Phần ngân sách: chuẩn bị DB/migrate/seed chỉ mất vài giây, nên không bao giờ chạm 60 giây chênh lệch | patch |
| 7 | BH | Không kiểm bản build web có nhúng đúng `API_ORIGIN` | low | Chỉ gặp khi tự export giá trị khác trong shell; `dev-env.sh` và CI đều đặt `http://localhost:3001`. Sửa là thêm một lần kiểm | reject |
| 8 | BH | Env của shell lọt vào stack và `next start` (vd. `API_INTERNAL_URL`), khác với README | low | Có thể xảy ra nhưng hiếm (phải export biến đó trong shell). Sửa là đổi cách dựng env, nhiều hơn một sửa trực tiếp | reject |
| 9 | BH | Đổi `E2E_POSTGRES_SUPERUSER_URL` sang host/cổng khác thì DB tạo một nơi, api nối nơi khác; thông báo lỗi ghi cứng `localhost:5432` | low | Đúng: URL ứng dụng lấy host từ `.env.example`. Sửa trực tiếp: ghi rõ biến này chỉ đổi user/mật khẩu | patch |
| 10 | BH | `SIGTERM` lúc đang `startTingeeFake` làm worker/api mồ côi; `SIGTERM` lúc seed thì ghi vào sink đã đóng | low | Playwright và Ctrl+C gửi tín hiệu cho cả process group nên con cũng nhận. Cửa sổ chỉ vài ms. Sửa là thêm guard | reject |
| 11 | BH | Email Người mua không tính `repeatEachIndex` nên `--repeat-each` vướng giới hạn OTP 60 giây; mỗi lượt tốn 5 OTP trên trần 20/giờ/IP | low | Phần repeat-each đúng; sửa trực tiếp trong template email. Phần trần OTP sai: `otp_send_events` nằm trong DB, mà DB tạo lại mỗi lượt | patch |
| 12 | BH | Dòng "Đã xử lý" dưới deferred-work `:438` nói quá: tab A không hề bị đưa xuống nền, CORS chưa được chứng minh | low | Đúng: Playwright giữ mọi trang ở trạng thái hiển thị. Sửa trực tiếp nội dung ghi chú | patch |
| 13 | BH | Bước kiểm image không kiểm lý do, không kiểm `WEB_ORIGIN` là lỗi duy nhất, `docker run` không có timeout | false | Với URL http hợp lệ thì chỉ luật https sinh issue `WEB_ORIGIN` ở worker. Đã chạy image với `NODE_ENV=development`: thoát sau khoảng 1 giây (`EAI_AGAIN`, `--network none`), grep đỏ, không treo | reject |
| 14 | BH | Bước kiểm trước khi dựng thiếu bản build web và cổng 3000; harness không có test Vitest | low | Thiếu bản build hay cổng 3000 bận thì lỗi lộ ra sau vài giây dựng stack. Harness được kiểm bằng chính các lượt chạy. Sửa là thêm kiểm tra hoặc test | reject |
| 15 | EC | Như #10 (mồ côi khi `SIGTERM` giữa lúc khởi động) | low | Cùng gốc với #10 | reject |
| 16 | EC | Như #6 (`/readyz` hết giờ không tắt stack) | low | Cùng gốc với #6 | patch |
| 17 | EC | Stack chết mà không qua `shutdown` (`SIGKILL` riêng pid) thì con mồ côi | low | Phải chủ động `kill -9` riêng pid; Playwright giết cả group. Sửa là thêm handler | reject |
| 18 | EC | `WriteStream` của `LogSink` không có listener `error` | low | Đĩa đầy hay EACCES là hiếm; ghi sau khi đóng chỉ xảy ra khi đang tắt rồi. Sửa là thêm guard | reject |
| 19 | EC | Như #9 (host của superuser khác host DB) | low | Cùng gốc với #9 | patch |
| 20 | EC | `PORT` lệch với cổng của `API_PUBLIC_URL` | low | Cả hai cùng lấy từ `.env.example` và đang khớp nhau. Sửa là thêm guard | reject |
| 21 | EC | Như #8 (env của shell vào tiến trình con) | low | Cùng gốc với #8 | reject |
| 22 | EC | `WEB_ORIGIN` không ghi cổng thì `WEB_PORT` = 0 | low | `.env.example` có `:3000`. Sửa là thêm guard | reject |
| 23 | EC | Như #7 (bản build web lệch `API_ORIGIN`) | low | Cùng gốc với #7 | reject |
| 24 | EC | `fetch` tới Mailpit không có timeout nên global setup có thể treo | low | Mailpit là service local, hiếm khi treo HTTP. Sửa là thêm guard | reject |
| 25 | EC | Như #11 (`--repeat-each`) | low | Cùng gốc với #11 | patch |
| 26 | EC | `docker run` của bước kiểm image không có timeout, có thể treo tới trần 60 phút | false | Như #13: worker thoát sau khoảng 1 giây ngay cả khi luật https bị tắt | reject |
| 27 | EC | (claim) SSE đứt vẫn qua assertion 3 giây | medium | Cùng gốc với #1 | patch |
| 28 | EC | (claim) `retries: 1` cho lỗi chập chờn qua CI dưới dạng flaky | false | Intent đóng băng chọn "retries như config cũ". Luồng hỏng thật thì fail cả hai lần và job đỏ | reject |

## Design Notes

- **Một stack script thay vì nhiều webServer:** migrate và seed phải xong trước khi api và worker chạy. Tạo lại DB mỗi lượt giúp test không phụ thuộc dữ liệu cũ, và xóa luôn bộ đếm giới hạn OTP. Đặt script ở `apps/api` để dùng driver DB và code migrate, seed, fake có sẵn.
- **Hai tab:** tab B đi trọn đường chuyển trang qua Tingee fake. Nếu chỉ dùng một tab thì trang tải lại đã thấy Thành công, nên không chứng minh được SSE. Tab A còn mở thì mới chứng minh `EventSource` cross-origin có cookie nhận được tín hiệu thật.

## Verification

**Commands:**
- `pnpm turbo build typecheck` và `pnpm turbo lint:deps`: phải xanh.
- `docker compose up -d postgres mailpit && pnpm test:e2e:fullstack`, chạy hai lần liên tiếp: phải xanh cả hai lần.
- `pnpm --filter @tickee/web test:e2e`: bộ giả lập phải vẫn xanh.
- Build image, rồi `docker run --rm -e APP_ROLE=worker -e WEB_ORIGIN=http://example.test … tickee-api`: thoát 1, output có `WEB_ORIGIN`.
