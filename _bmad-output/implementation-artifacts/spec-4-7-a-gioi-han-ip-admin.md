---
title: 'Story 4.7-a: Giới hạn IP cho /v1/admin/*'
type: 'feature'
created: '2026-11-18'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '230357f93ccb31af82fa086c93b944e48575742a'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Mọi route `/v1/admin/*` (xem dữ liệu nhiều BTC, duyệt Closed Beta, mở lại dịch vụ thanh toán, requeue dead-letter) hiện nhận request từ mọi IP. Chỉ cần lộ session của một Quản trị Tingee là dùng được từ bất kỳ đâu. FR-4 và AD-26 đòi giới hạn IP tại API, và việc này phải xong trước khi mở `/admin` trên môi trường thật.

**Approach:** Thêm env `ADMIN_ALLOWED_CIDRS` (danh sách CIDR), kiểm bằng Zod lúc khởi động; ở `NODE_ENV=production` thì bắt buộc. Một middleware chặn mọi request `/v1/admin/*` có IP client (lấy qua `trust proxy` theo `TRUST_PROXY_HOPS`) nằm ngoài danh sách, trước mọi guard và trước khi chạm DB.

## Boundaries & Constraints

**Always:**
- **Định dạng:** các mục cách nhau bằng dấu phẩy, bỏ khoảng trắng hai bên, trùng thì gộp. Mỗi mục là `ip/prefix` IPv4 (prefix 1–32) hoặc IPv6 (1–128). IP trần được hiểu là `/32` hoặc `/128`. Danh sách rỗng, mục sai, hoặc prefix `/0` thì bị loại với issue `{ variable: 'ADMIN_ALLOWED_CIDRS', reason }`, không bao giờ nêu giá trị.
- **Theo môi trường:**
  - `NODE_ENV=production` (staging cũng chạy production) mà thiếu biến thì issue `thiếu` và api không khởi động.
  - `development`/`test` mà thiếu biến thì không giới hạn; vai api log `warn` một lần lúc khởi động.
  - Chỉ vai api đọc biến này.
- **Phạm vi chặn:**
  - Chặn theo đường dẫn: mọi request khớp `/v1/admin` hoặc `/v1/admin/*`, kể cả route không tồn tại và request ẩn danh. Request bị chặn không đi tới `SessionGuard` hay DB.
  - IP so khớp là `req.ip` của Express. IPv4 dạng ánh xạ `::ffff:a.b.c.d` được so như IPv4. IP không phân tích được thì bị chặn.
- **Log và ràng buộc:**
  - Request bị chặn được log `warn` có marker `admin_ip_blocked`, kèm method và path, không kèm IP (IP là PII, AD-18).
  - `PlatformAdminGuard` ném lỗi cấu hình nếu route mang `@RequirePlatformAdmin()` mà đường dẫn không bắt đầu bằng `/v1/admin/`, theo mẫu kiểm `@Public()` đã có. Nhờ vậy route admin không thể nằm ngoài vùng bị chặn.
- **Phản hồi khi bị chặn (Mason chốt 18/11/2026):**
  - API trả `403` với mã mới `ADMIN_IP_NOT_ALLOWED`, message "Bạn đang truy cập từ mạng không được phép vào trang quản trị.", theo dạng `ErrorResponse` chuẩn.
  - Web `/admin` coi mã này là lỗi chặn cả trang. Trang hiện `EmptyState` "Bạn đang truy cập từ mạng không được phép." với mô tả "Kết nối mạng được cấp quyền của Tingee rồi tải lại trang.".

**Never:**
- Không thêm thư viện IP. Dùng `node:net` (`BlockList`, `isIP`).
- Không giới hạn IP ở tầng web `/admin` (spine coi đó là lớp phụ). Không làm endpoint chẩn đoán IP hay kiểm `TRUST_PROXY_HOPS` sau deploy.
- Không làm các mục 4.7 khác đã tách vào `deferred-work.md`: siết cấu hình production, presign ảnh, CI e2e full-stack, khóa migrate.
- Không đổi luật step-up, 2FA hay audit của `/v1/admin/*`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| IP trong dải | CIDR `203.0.113.0/24`, hops 1, XFF `203.0.113.7`, Quản trị Tingee đã step-up | Như trước: 200 | N/A |
| IP ngoài dải | Cùng cấu hình, XFF `198.51.100.1`, Quản trị Tingee đã step-up | 403 `ADMIN_IP_NOT_ALLOWED`, có log `admin_ip_blocked` | N/A |
| Ẩn danh ngoài dải | Không có cookie, XFF ngoài dải | 403 `ADMIN_IP_NOT_ALLOWED`, không phải 401 | N/A |
| Giả XFF khi hops 0 | hops 0, socket `127.0.0.1` ngoài dải, XFF `203.0.113.7` | 403 `ADMIN_IP_NOT_ALLOWED`: XFF bị bỏ qua | N/A |
| Web bị chặn | Mock `/v1/admin/*` trả 403 `ADMIN_IP_NOT_ALLOWED` | `/admin` hiện `EmptyState` mạng không được phép, không hiện tab | N/A |
| IPv4 ánh xạ | `req.ip` = `::ffff:203.0.113.7` | Coi như `203.0.113.7`: qua | N/A |
| IPv6 | CIDR `2001:db8::/32`, XFF `2001:db8::1` | Qua | N/A |
| Route không phải admin | XFF ngoài dải, gọi `/v1/me`, `/healthz` | Không đổi hành vi | N/A |
| Không đặt biến (test) | Harness mặc định | `/v1/admin/*` như trước | N/A |
| Production thiếu biến | `NODE_ENV=production`, không có `ADMIN_ALLOWED_CIDRS` | `ConfigError`, api thoát mã 1 | issue `thiếu` |
| Mục sai | `10.0.0.0/33`, `abc`, `0.0.0.0/0`, `,` | `ConfigError` | issue có lý do, không có giá trị |

</frozen-after-approval>

## Code Map

Đường dẫn dưới `apps/api/` trừ khi ghi khác.

- `src/platform/config/config.schema.ts` -- `apiConfigSchema` (`:215`). `TRUST_PROXY_HOPS` ở `:224`. Mẫu danh sách cách nhau bằng dấu phẩy: `emailList` (`:127`). Chưa có `superRefine` mức object nào. Issue mức object phải đặt `path: ['ADMIN_ALLOWED_CIDRS']`, nếu không `toIssues` (`load-config.ts:24`) ghi "(không rõ)". `loadConfig` bỏ chuỗi rỗng (`:51`), nên `VAR=` tính là thiếu.
- `src/roles/api.ts` -- `configureApiApp`: `trust proxy` ở `:22`, `setGlobalPrefix('v1')` ở `:25`. `listen` không có host, nên IPv4 thật ra dạng `::ffff:`. Supertest nghe `127.0.0.1`.
- `src/modules/admin/admin.module.ts` -- 3 controller `admin/organizations` và `admin/dead-letters`. Middleware gắn ở đây (`NestModule.configure`, `forRoutes` theo path; global prefix tự áp).
- `src/modules/identity/platform-admin.guard.ts` -- chỗ kiểm `@Public()` (`:38-40`) là mẫu cho kiểm đường dẫn.
- `src/modules/identity/auth-http-gate.ts` -- tiền lệ middleware tự ghi body `ErrorResponse`.
- `src/platform/http/app-error.ts` (`DEFAULT_STATUS`), `src/platform/http/error.filter.ts`, `../../packages/contracts/src/errors.ts` -- thêm `ADMIN_IP_NOT_ALLOWED` ở contracts và `DEFAULT_STATUS`. 403 không phải `AppError` sẽ bị đổi thành `VALIDATION_FAILED`, nên middleware ném `AppError` hoặc tự ghi body như `authHttpGate`.
- `test/identity/harness.ts:83` `createHarness(overrides)` -- override là giá trị đã parse. `test/admin/platform-admin.ts` `signUpPlatformAdmin`. XFF mẫu: `test/identity/otp-login.test.ts:213-238`. Mẫu config: `test/config.test.ts:426`.
- `../web/app/(admin)/admin/closed-beta-review.tsx` -- `isGateError` (`:85`) và các `EmptyState` gate (`:348-371`). Web client từ chối mã lạ (`lib/api/client.ts:77`). Mock e2e: `../web/e2e/admin-mock.ts`.
- `../../.env.example`, `../../README.md:303-318` -- tài liệu env và mục "Quản trị Tingee".

## Tasks & Acceptance

**Execution:**
- [x] `src/platform/config/cidr.ts` (mới, export qua `index.ts`) -- parse danh sách CIDR, và `isAllowedIp(list, ip)` chuẩn hóa `::ffff:` dựa trên `BlockList` -- dùng chung cho schema và middleware.
- [x] `src/platform/config/config.schema.ts` -- trường `ADMIN_ALLOWED_CIDRS` tùy chọn, cộng luật bắt buộc khi production -- AC môi trường.
- [x] `src/modules/admin/admin-ip.middleware.ts` (mới) + `admin.module.ts` -- chặn `/v1/admin/*`, log `admin_ip_blocked`; vai api log warn khi không đặt biến.
- [x] `src/modules/identity/platform-admin.guard.ts` -- kiểm route admin nằm dưới `/v1/admin/`.
- [x] `../../packages/contracts/src/errors.ts`, `src/platform/http/app-error.ts` -- mã `ADMIN_IP_NOT_ALLOWED` (403).
- [x] `../web/app/(admin)/admin/closed-beta-review.tsx` + `../web/e2e/admin-mock.ts` và spec e2e admin -- thêm vào `isGateError`, `EmptyState` mạng không được phép, kèm e2e.
- [x] `test/config.test.ts`, `test/platform/cidr.test.ts`, `test/admin/admin-ip.test.ts` -- phủ toàn bộ I/O Matrix.
- [x] `.env.example`, `README.md`, `deferred-work.md` (đánh dấu đã xử lý mục "Story 2.5 phần sau — giới hạn `/v1/admin/*`"), `sprint-status.yaml` (4.7 → `in-progress`).

**Acceptance Criteria:**
- Given cấu hình hợp lệ, when Quản trị Tingee trong dải dùng `/admin`, then mọi tab hoạt động như trước và toàn bộ test admin hiện có vẫn xanh.
- Given route mang `@RequirePlatformAdmin()` nằm ngoài `/v1/admin/`, when gọi route đó, then guard ném lỗi cấu hình (có test).

## Implementation Notes

- `AdminModule` thành `AdminModule.forRoot(config)`; middleware chỉ gắn khi có `ADMIN_ALLOWED_CIDRS`. Preflight `OPTIONS` do `cors` (đăng ký trong `configureApiApp` trước module middleware) trả lời trước khi kiểm IP; đây là hành vi cần để web đọc được 403, có test ghim.
- Sau review vòng 1: loại dải IPv6 chồng lên `::ffff:0:0/96` (Node `BlockList` so client IPv4 với các dải này), log `info` lúc khởi động khi giới hạn bật, test kiểm kê route soát chiều "route `@RequirePlatformAdmin()` phải dưới `/v1/admin/`".
- Log của mọi harness trong cùng file test API có thể nằm ở `LogCapture` của harness tạo trước (logger gốc nestjs-pino dùng chung tiến trình); `admin-ip.test.ts` gộp log mọi harness và ghép theo `x-request-id`. Các test kiểu "harness này không log gì" ở file khác có thể đang kiểm rỗng.
- Sprint-status: 4.7-a là story con, nên `4-7-…` giữ `in-progress` (như 4.8-a), không đặt `review`/`done` ở bước cuối của Build.
- Verification 18/11/2026: `build typecheck` (web cần `NEXT_PUBLIC_API_BASE_URL`, như CI), `lint:deps`, API 94 file/1527 test, e2e admin 64 test đều xanh.

## Spec Change Log

## Review Triage Log

Vòng 1 (18/11/2026): Blind Hunter (BH), Edge Case Hunter (EC), Verification Gap (VG).

| # | Lớp | Phát hiện | Verdict | Bằng chứng | Hướng |
|---|-----|-----------|---------|------------|-------|
| 1 | VG | Không test nào gửi `Origin`/`OPTIONS` tới `/v1/admin/*` ngoài dải: đổi thứ tự IP check với CORS thì web không đọc được `ADMIN_IP_NOT_ALLOWED` mà mọi test vẫn xanh | medium | Gap đã kiểm sẵn: `admin-ip.test.ts` không đặt `origin`; mock e2e tự trả CORS (`admin-mock.ts:134,170`) | patch (nhóm A) |
| 2 | BH | Docs ghi "mọi method" nhưng preflight `OPTIONS` ngoài dải nhận 204 từ `cors` (chạy trước middleware module), không log chặn | medium | `enableCors` ở `roles/api.ts:24` đăng ký trước `app.init()`; hành vi đúng và cần cho web đọc 403, chỉ docs sai | patch (nhóm A) |
| 3 | EC | Như #2 (`OPTIONS` ngoài dải → 204) | medium | Cùng gốc với #2 | patch (nhóm A) |
| 4 | BH | Dải IPv6 bao IPv4 ánh xạ (`::/1`, `::ffff:0:0/96`) mở cho mọi IPv4, lách luật cấm `/0`; `cidr.test.ts` còn coi `::/1` hợp lệ | medium | Đã chạy `node:net`: `BlockList` với `::/1` hay `::ffff:0:0/96` → `check('1.2.3.4','ipv4') = true` | patch (nhóm B) |
| 5 | EC | Như #4 | medium | Cùng gốc với #4 | patch (nhóm B) |
| 6 | BH | `0.0.0.0/1,128.0.0.0/1` cũng mở cho mọi IPv4 | false | Người vận hành phải cố ý liệt kê hai nửa; luật `/0` chặn nhầm lẫn, không chặn chủ ý | reject |
| 7 | BH | CIDR có bit host (`203.0.113.7/24`) được nhận, mở cả /24 | low | Đúng nghĩa của `/24`; gõ nhầm prefix hiếm, sửa cần thêm nhánh chuẩn hóa | reject |
| 8 | BH | Regex `IPV4_MAPPED` thừa và thiếu dạng hex `::ffff:cb00:7107` | false | Đã chạy: `BlockList` khớp cả dạng hex lẫn dạng chấm với dải IPv4, nên không có IP nào bị so sai | reject |
| 9 | BH | Không đặt `NODE_ENV` thì mặc định `development` → `/v1/admin/*` mở khi chạy api ngoài image | medium | `common.NODE_ENV` mặc định `development` có từ Story 1.1; `apps/api/Dockerfile` đặt `production`. Không do story này gây ra | defer |
| 10 | BH | Docs chỉ nói `TRUST_PROXY_HOPS` thấp; đặt cao hơn số proxy thật thì client tự khai XFF qua được; thiếu cảnh báo không thêm dải của LB/VPC | medium | `README.md`, `.env.example` của diff chỉ tả trường hợp thấp; lỗi cấu hình này vô hiệu hóa giới hạn | patch |
| 11 | BH | Log chặn thiếu trường chẩn đoán (số mục XFF, họ IP, có cookie), path không cắt | low | Chẩn đoán `TRUST_PROXY_HOPS` đã có mục deferred riêng; URL bị Node giới hạn độ dài header | reject |
| 12 | BH | Không có metric/cảnh báo cho request admin bị chặn | low | Request đã bị chặn; cảnh báo là tính năng thêm, ngoài nhu cầu thường ngày | reject |
| 13 | BH | Khởi động khi đã bật giới hạn không có log nào để xác nhận sau deploy | low | `onApplicationBootstrap` chỉ log khi thiếu biến; người vận hành gặp mỗi lần deploy, sửa một dòng log | patch |
| 14 | BH | Message `'bắt buộc khi NODE_ENV=production'` của refine không bao giờ hiện (`toIssues` đổi thành `thiếu`) | low | Lý do `thiếu` đúng như I/O Matrix; chuỗi chỉ thừa | reject |
| 15 | BH | Ở dev `' '`/`','` làm api không khởi động trong khi `=` rỗng thì không | false | Đúng như spec: danh sách rỗng bị loại; `loadConfig` bỏ chuỗi rỗng từ trước | reject |
| 16 | BH | Test "socket IPv4 thật (api nghe dual-stack: ::ffff:127.0.0.1)" không thử dual-stack vì supertest nghe `127.0.0.1` | low | supertest 7.3.1 `listen(0,'127.0.0.1')`; nhánh `::ffff:` đã phủ qua XFF và `cidr.test.ts`. Tên test sai | patch |
| 17 | BH | Route `@RequirePlatformAdmin()` đặt ngoài `/v1/admin/` chỉ lộ khi có request (500), CI không bắt | low | Test kiểm kê `closed-beta.test.ts:92` chỉ lọc route khớp `ADMIN_ROUTE`, không soát chiều ngược | patch |
| 18 | BH | Tiền tố admin viết ở ba nơi | low | Cosmetic, không có chỗ nào lệch hiện nay | reject |
| 19 | BH | Route đúng `/v1/admin` bị guard trả 500 | low | Chưa có route gốc; lỗi to ngay khi chạy thử (fail closed); câu chữ spec là `/v1/admin/` | reject |
| 20 | VG | Như #19 (regex kiểm kê và tiền tố guard lệch ở `/v1/admin`) | low | Cùng gốc với #19 | reject |
| 21 | EC | Như #19 | low | Cùng gốc với #19 | reject |
| 22 | BH | EmptyState nói "tải lại trang" nhưng không có nút | low | Đúng câu chữ spec; trình duyệt có nút tải lại | reject |
| 23 | BH | E2E đổi mạng giữa phiên chưa phủ Thu hồi và Requeue | low | Mọi thao tác dùng chung `isGateError`/`handleActionError` (`closed-beta-review.tsx:279`), đã phủ qua Duyệt và Mở lại | reject |
| 24 | EC | Body JSON hỏng/quá lớn từ IP ngoài dải nhận 400/413 thay vì 403 nếu có parser chạy trước | low | Nếu đúng thì chỉ đổi mã lỗi, không lộ dữ liệu; `API_APP_OPTIONS.bodyParser=false`. Sửa cần dời middleware lên tầng Express | reject |
| 25 | EC | Lỗi nêu "mục thứ N" đếm sau khi bỏ mục rỗng (`a,,abc` báo mục 2) | low | `parseCidrList` lọc rỗng trước khi đánh số; sửa trực tiếp | patch |
| 26 | EC | `cidrBlockList` nhận mục không có `/` (override của harness) | false | Chỉ test truyền vào; `addSubnet` ném lỗi to lúc khởi tạo | reject |
| 27 | EC | Log chặn không giới hạn khi bị dội request | low | pino-http đã log mỗi request; thêm một dòng mỗi request không đổi bậc | reject |
| 28 | EC | IP client đổi qua lại IPv4/IPv6 thì thao tác lỗi không có toast | low | Cần client luân phiên họ IP giữa hai request liền nhau; hiếm | reject |

## Verification

**Commands:**
- `pnpm turbo build typecheck` và `pnpm turbo lint:deps` -- expected: xanh (như CI).
- `pnpm --filter @tickee/api test` -- expected: xanh, gồm các test mới.
- `pnpm --filter @tickee/web test:e2e -- admin` -- expected: xanh.
