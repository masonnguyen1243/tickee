---
title: 'Story 4.6-a: Nền quan sát (OpenTelemetry và ngữ cảnh log)'
type: 'feature'
created: '2026-11-17'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '8d42d644fa4f07a5f0759ec939ec0d760fb43ce3'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** api và worker chỉ có log pino: không có trace hay metrics, nên không đo được độ trễ tạo link, thời gian xử lý job hay độ ùn của hàng đợi, và 4.6-b không có số liệu để đặt cảnh báo. Log trong request chưa mang `organizationId`; log trong job không mang tên queue.

**Approach:** Bật OpenTelemetry (trace + metrics, xuất OTLP/HTTP, không gắn nhà cung cấp nào) cho vai `api` và `worker` khi có endpoint. Nối log với trace, gắn ngữ cảnh BTC và job vào log, và lọc mọi thuộc tính có thể chứa secret trước khi xuất.

## Boundaries & Constraints

**Always:**
- **Config** (Zod, chỉ schema `api` và `worker`):
  - `OTEL_EXPORTER_OTLP_ENDPOINT`: URL http(s), không bắt buộc. Không đặt thì không khởi SDK, không đăng ký hook, hành vi y như hiện nay;
  - `OTEL_EXPORTER_OTLP_HEADERS`: không bắt buộc, là secret (không log; lỗi không nêu giá trị);
  - `OTEL_METRIC_EXPORT_INTERVAL`: ms, mặc định 60000.
- **Khởi động và tắt:**
  - `main.ts` khởi telemetry sau `loadConfig`, trước khi `import` vai; vai `migrate` không bật;
  - `service.name` = `tickee-api` | `tickee-worker`;
  - khi tắt: flush rồi shutdown SDK trong `onApplicationShutdown`, tối đa 5 giây;
  - lỗi xuất chỉ ghi log `warn`, không bao giờ ném, chặn tắt hay làm hỏng request.
- **Instrumentation:**
  - http (chỉ phía server; bỏ `/healthz`, `/readyz`);
  - undici (fetch ra Tingee, Google, web);
  - pg (không bật `enhancedDatabaseReporting`);
  - runtime-node;
  - pg-boss: bật OTel có sẵn của nó, `propagateContext: true` với `W3CTraceContextPropagator` (chỉ trace id, không baggage);
  - lấy mẫu mọi trace.
- **Tên route:** span server và `http.server.request.duration` mang `http.route` dạng mẫu (`/v1/orgs/:orgId/token`), lấy từ route Nest đã khớp qua `RPCMetadata`. Request không đi qua handler Nest (Better Auth, 404) thì không có `http.route`, và tên span chỉ là method.
- **Lọc thuộc tính:** một hàm thuần áp cho mọi span trước khi xuất:
  - bỏ query khỏi `url.query`, `url.full`, `http.target` và `http.url`;
  - trong `/v1/shared-tickets/:token`, `/v1/payments/tingee/ipn/:ipnKey` và `/v1/auth/*`, thay đoạn nhạy cảm bằng `[REDACTED]`;
  - không ghi header hay body nào thành thuộc tính.
- **Tingee:** mỗi lời gọi `HttpTingeeClient.send` chạy trong span `tingee <operation>` và ghi histogram `tickee.tingee.request.duration` (giây):
  - `tingee.operation` lấy từ hằng của path (`create_link`, …);
  - `outcome` là `ok` | `rejected` | `timeout` | `network` | `invalid_json`.

  Đây là nền cho cảnh báo p95 tạo link của 4.6-b.
- **Log:**
  - mọi dòng log có span đang chạy mang `traceId` và `spanId`;
  - request: sau khi `PermissionGuard` xác định BTC, mọi log còn lại của request mang `organizationId`;
  - worker: mọi log trong lúc xử lý job mang `queue`, `jobId` và các id của `logContext(payload)`;
  - `requestId`, `orderCode` và các đường redact hiện có giữ nguyên.
- **Local:**
  - docker-compose thêm `otel-lgtm` (`grafana/otel-lgtm:0.38.1`) dưới profile `observability`, không chạy mặc định;
  - cổng: OTLP HTTP `4318`, Grafana `3030` trên máy;
  - `.env.example` để trống endpoint, kèm hướng dẫn bật.
- **Ghim phiên bản chính xác:**
  - `@opentelemetry/api` 1.10.0, `sdk-node` 0.300.0, `instrumentation-http` 0.300.0;
  - `instrumentation-undici` 0.34.0, `instrumentation-pg` 0.77.0, `instrumentation-runtime-node` 0.37.0;
  - gói con nếu cần dùng đúng bộ 0.300.0/3.0.0.

**Never:**
- Không gửi log qua OTLP; log vẫn là JSON ra stdout.
- Không thêm metrics nghiệp vụ hay luật cảnh báo (4.6-b). Không chọn backend giám sát (4.7).
- Không dùng `auto-instrumentations-node`, instrumentation express hay nestjs-core.
- Không đổi lệnh `node`, Dockerfile hay script (không `--import`).
- Không đặt vào thuộc tính span hay metric: PII, secret, chữ ký, token, query, `Idempotency-Key`.
- Không đặt id có nhiều giá trị (BTC, mã Đơn, job) vào thuộc tính metric.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tắt | Không có `OTEL_*` | Không SDK, không hook; log không có `traceId` | N/A |
| Endpoint sai | `OTEL_EXPORTER_OTLP_ENDPOINT=abc` | api/worker không khởi động; lỗi nêu tên biến, không nêu giá trị | exit 1 |
| Collector không nghe | Endpoint đúng, không có gì ở cổng | api phục vụ bình thường | log `warn`, không ném |
| Route BTC | `GET /v1/orgs/:orgId/token` | Span `GET /v1/orgs/:orgId/token`; log của request có `requestId`, `organizationId`, `traceId` | N/A |
| Link chia sẻ | `GET /v1/shared-tickets/<token>?a=b` | Không span hay metric nào chứa token hoặc `a=b` | N/A |
| Google callback | `GET /v1/auth/callback/google?code=…&state=…` | Không span nào chứa `code` hay `state` | N/A |
| IPN | POST IPN kèm `x-signature` | Không span nào chứa chữ ký hay `ipnKey` | N/A |
| Tạo link | Checkout Hạng vé có phí | Span `tingee create_link` là con của span request; histogram có `create_link` | timeout → `outcome=timeout` |
| Job | Request enqueue → worker xử lý | Span `process <queue>` cùng trace với request; log có `queue`, `jobId` và `orderId`/`organizationId` | Job lỗi: span lỗi; log `warn` hiện có kèm ngữ cảnh |
| SIGTERM | Đang có span chưa xuất | Flush ≤ 5 giây rồi thoát như cũ | Collector chết: vẫn thoát |

</frozen-after-approval>

## Code Map

- `apps/api/src/main.ts:12-42`:
  - khởi telemetry sau `loadConfig` (:15), trước `await import` vai (:26, :31);
  - static import chỉ có pino, config và logging, nên express và pg nạp sau khi hook đăng ký.
- `apps/api/src/platform/config/config.schema.ts`:
  - `common` :12-15; spread nhóm mới như `tingeeAndTickets` (:54) vào api (:75) và worker (:106), không vào migrate (:134);
  - `load-config.ts:51` coi chuỗi rỗng là chưa đặt;
  - config test ở `test/helpers.ts:28,59`.
- Mới `apps/api/src/platform/telemetry/` (theo `.dependency-cruiser.cjs:70-76`, platform không import `modules`):
  - khởi và tắt SDK, hook ESM;
  - lọc thuộc tính;
  - interceptor gán route vào `RPCMetadata`;
  - helper đo span + histogram;
  - module Nest lo shutdown.

  Lắp vào `api.module.ts` và `worker.module.ts`.
- pg-boss 12.38 có sẵn OTel (`node_modules/.pnpm/pg-boss@12.38.0*/dist/telemetry.js`):
  - span `process <queue>`;
  - metrics `messaging.process.duration` và `pgboss.queue.jobs` (theo trạng thái, gồm `failed`);
  - option `openTelemetry` truyền ở `platform/jobs/boss.ts:24-33` (`createBoss`).
- `apps/api/src/platform/jobs/queue.ts:178-216` (`registerQueueWorker`, `run` :187): bọc `handle` bằng `PinoLogger.runInContext(fn, { bindings })` (nestjs-pino 5.3.1). `identity-janitor.ts:61` gọi `boss.work` trực tiếp; job này vẫn có span của pg-boss.
- `apps/api/src/platform/access/permission.guard.ts:65-71`: chỗ biết `organizationId`; gán vào log bằng `PinoLogger.assign` (chỉ chạy trong request).
- `apps/api/src/platform/logging/pino-options.ts:53-58` (`basePinoOptions`): thêm `mixin` đọc span đang chạy. Giữ nguyên:
  - `customProps` `requestId` (`logging.module.ts:20`);
  - redact (:36-51) và serializer (:73-125), vốn đã che query và token link chia sẻ.
- `apps/api/src/modules/tingee/tingee.client.ts:495-530` (`send`, global `fetch`, header `x-signature`): bọc bằng helper đo. `createPaymentLink` ở :344.
- Route nhạy cảm:
  - `ticketing/shared-tickets.controller.ts:33`;
  - `payment/ipn.controller.ts:179,195`;
  - Better Auth ở `/v1/auth` (`identity/auth.ts:24`; callback `auth-http-gate.ts:12-15`).
- Test:
  - `test/roles.process.test.ts:13-60` (spawn `dist/main.js` với env tối thiểu): mẫu cho process test kèm receiver OTLP giả (HTTP JSON);
  - `LogCapture` `test/helpers.ts:79-92`;
  - assert `requestId` và secret ở `test/http.test.ts:98-114`;
  - spy log worker ở `test/tingee/client.test.ts:716`.
- `docker-compose.yml` (đang có `postgres`, `mailpit`), `.env.example`, `README.md`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/package.json`: thêm các gói đã ghim.
- [x] `apps/api/src/platform/config/config.schema.ts` (+ test): nhóm telemetry cho api và worker.
- [x] `apps/api/src/platform/telemetry/*`, `main.ts`, `api.module.ts`, `worker.module.ts`: khởi và tắt, instrumentation, route mẫu, lọc thuộc tính, helper đo.
- [x] `apps/api/src/platform/{logging/pino-options,access/permission.guard,jobs/queue,jobs/boss}.ts`: `traceId`/`spanId`, `organizationId`, ngữ cảnh job, OTel của pg-boss.
- [x] `apps/api/src/modules/tingee/tingee.client.ts`: span và histogram.
- [x] `docker-compose.yml`, `.env.example`, `README.md`: profile `observability`, hướng dẫn bật.
- [x] Test:
  - unit cho hàm lọc (mọi dòng nhạy cảm của I/O Matrix) và cho config;
  - process test api và worker với receiver OTLP giả: route mẫu, `service.name`, metrics của http, pg-boss và Tingee có mặt; không payload nào chứa secret đã gieo;
  - log: `organizationId` trong request BTC; `queue`/`jobId` trong job.

**Acceptance Criteria:**
- Given `pnpm lint:deps`, then sạch.
- Given không đặt `OTEL_*`, when chạy toàn bộ test hiện có, then pass mà không phải sửa test cũ.
- Given process test, then api và worker xuất cả trace lẫn metrics tới receiver giả.

## Implementation Notes

- `story_key`: `4-6-giám-sát-và-lưới-an-toàn-vận-hành`. 4.6-a xong thì story vẫn chưa xong (còn 4.6-b/c/d trong `deferred-work.md`): giữ story ở `in-progress`, không đặt `done`.
- Nhánh `feat/4-6-a-nen-quan-sat`, cắt từ `main` (`8d42d64`).
- Build 17/11/2026, chỗ làm khác hoặc thêm so với spec:
  - **Hook ESM:** dùng `module.registerHooks` (sync, qua `import-in-the-middle/register-hooks.mjs`, chỉ cho `http`, `https`, `pg`, `pg-pool`) thay cho `module.register`, vì Node 26 báo DEP0205. Thêm `import-in-the-middle@3.6.0` (ghim).
  - **Gói ghim thêm** cùng bộ 0.300.0/3.0.0: `core`, `sdk-trace`, `sdk-metrics`, `exporter-trace-otlp-http`, `exporter-metrics-otlp-http`; dev: `context-async-hooks`. `pnpm-workspace.yaml` thêm `allowBuilds: protobufjs: false` (kéo theo bởi exporter gRPC của sdk-node, không dùng).
  - **NodeSDK** mặc định gửi log qua OTLP; tắt bằng `logRecordProcessors: []`.
  - **pg** `requireParentSpan: true`: vòng poll của pg-boss và kết nối `LISTEN` không sinh trace riêng mỗi giây.
  - **Bộ lọc rộng hơn spec:** bỏ thêm IP, cổng, User-Agent, params SQL, `exception.message`, dòng message trong stack và message của trạng thái span (message của `DrizzleQueryError` mang params). `/v1/auth/*` che toàn bộ phần sau `/v1/auth/`.
  - **Route mẫu:** route bắt-tất-cả `*path` (404 của Nest) bị bỏ qua. `ErrorFilter` cũng đặt route, nên request bị guard chặn (401/403) vẫn có `http.route`.
  - **Log:**
    - `LoggerModule` bật `assignResponse: true`, để dòng kết thúc request cũng mang `organizationId`;
    - provider `UsePinoLoggerBeforeBootstrap` ở `WorkerModule` chuyển logger Nest sang pino trước `onApplicationBootstrap`, để log của job chạy lúc khởi động không mất ngữ cảnh;
    - `main.ts` import thẳng `logging/pino-options.js`, vì `logging/index` nạp pg trước hook.
  - **Test:**
    - `test/process.ts`, `test/otlp-receiver.ts`, `test/telemetry/{telemetry.process,span-redaction,config,tingee-telemetry,log-context}.test.ts`;
    - `job-span.test.ts` thêm ở bước kiểm Matrix: cột lỗi của dòng "Job" (span `process <queue>` lỗi khi `handle` ném lỗi hoặc payload hỏng);
    - `test/helpers.ts` thêm `OTEL_METRIC_EXPORT_INTERVAL` vào config test (bắt buộc theo kiểu).
  - **Rủi ro còn lại:**
    - dòng log có thể lặp khóa `organizationId` khi lời gọi log tự truyền trường đó (cùng giá trị);
    - pg-boss xử lý lô > 1 job thì span `process` mở trace mới kèm link;
    - chưa kiểm tay trên Grafana `otel-lgtm`; tên metric Prometheus trong README chưa đối chiếu.
- Review lượt 1 (17/11/2026): sửa 12 mục patch của Review Triage Log.
  - `test/platform/jobs-queue.test.ts` (test cũ) đổi hai assertion so khớp tuyệt đối (:265, :281), chỉ thêm `queue: 'test.queue'`, vì log chốt job giờ mang `queue`. AC "không phải sửa test cũ" vì vậy lệch ở đúng hai dòng này.
  - `pnpm-workspace.yaml` thêm `overrides` để ghim `@opentelemetry/core` 3.0.0; lockfile còn một bản.
  - Test mới: `test/telemetry/shutdown-order.test.ts`. Đã thử đảo thứ tự module thì test fail.

## Spec Change Log

## Review Triage Log

Lượt 1 (17/11/2026). BH = blind-hunter, ECH = edge-case-hunter, VG = verification-gap.

| # | Nguồn | Phát hiện | Verdict | Route | Bằng chứng |
|---|-------|-----------|---------|-------|------------|
| 1 | VG | Không test nào kiểm request bị guard chặn (401/403) trên route đã khớp vẫn có `http.route` (`ErrorFilter` → `setHttpRoute`) | low | patch | Gap đã kiểm: 6 request của process test không cái nào bị guard chặn; bỏ dòng `error.filter.ts:43` thì mọi test vẫn pass. |
| 2 | VG | `RedactingSpanExporter` chưa được test với message trạng thái, event `exception` hay link | low | patch | Gap đã kiểm: test chỉ gọi hàm thuần; process test không sinh span nào có message lỗi chứa secret đã gieo. |
| 3 | VG | Thứ tự tắt (telemetry sau `boss.stop`) chưa được kiểm | low | patch | Gap đã kiểm: process test chỉ dừng worker khi job đã xong, nên đảo thứ tự module thì mọi test vẫn pass. |
| 4 | VG | Nhánh `main.ts` khởi SDK lỗi → `warn` rồi chạy tiếp chưa có test | maybe-false | defer | Gap đã kiểm; muốn test cần chỗ tiêm lỗi vào `dist/main.js`. Nếu nhánh hỏng thì api sập lúc khởi (medium, chưa kiểm). |
| 5 | VG, ECH | Kết quả `retry` không đánh dấu span `process <queue>` là lỗi | false | reject | `retry` là kết quả bình thường, vd. `order-jobs.ts:197` "Đơn chưa tới hạn"; đánh lỗi sẽ làm tỉ lệ lỗi span sai. Lỗi thật và dead-letter đã có ở `pgboss.queue.jobs`. |
| 6 | BH | Metric, resource và tên span không qua bộ lọc | false | reject | Thuộc tính metric theo semconv ổn định (method, status, `http.route`, `server.address`…), không có path hay query. Tên span là method + route mẫu, tên thao tác pg và route mẫu của Better Auth. Process test quét mọi payload `/v1/metrics` lẫn `/v1/traces` tìm secret đã gieo. |
| 7 | BH, ECH | SDK còn đọc `OTEL_*` ngoài Zod (header theo tín hiệu, `OTEL_SDK_DISABLED`, `OTEL_LOG_LEVEL` thay diag logger) | low | reject | Chỉ xảy ra khi người vận hành tự đặt biến ngoài `.env.example`. Sửa phải thêm bước lọc env trước SDK. |
| 8 | BH, ECH | Endpoint nhận userinfo, query, fragment → URL tín hiệu hỏng | low | reject | Lỗi cấu hình của người vận hành; sửa phải thêm refine. |
| 9 | BH, ECH | `parseOtlpHeaders` nhận ký tự điều khiển, ký tự ngoài Latin-1 và khóa trùng | low | reject | Lỗi cấu hình hiếm; sửa phải thêm guard. |
| 10 | BH | `tingee.operation` theo path: `getMerchantServiceStatus` và `listAccounts` chung `get_va_paging` | low | reject | p95 `create_link` của 4.6-b không bị ảnh hưởng. Sửa phải đổi chữ ký `send` ở mọi nơi gọi. |
| 11 | BH, ECH | Tingee trả 5xx kèm JSON → span không lỗi | low | patch | `sendOutcome`: `replied` luôn `error: false`. Sửa trực tiếp: non-2xx → `error: true`, `outcome` vẫn `rejected` (theo tập đã khóa). |
| 12 | BH | `measured` không ghi histogram khi `fn` ném | false | reject | `sendOnce` không ném: `fetch`, `sign`, JSON đều nằm trong try và trả `failed`. |
| 13 | BH | Log `warn`/`error` lúc chốt job (`settle`) thiếu `queue` | low | patch | Hai dòng nằm ngoài `runInLogContext`. Sửa trực tiếp: thêm `queue: queue.name`. |
| 14 | BH | `identity-janitor.ts` không có ngữ cảnh log job | false | reject | Handler (`purgeExpired`) không ghi log nào; log duy nhất là dòng đăng ký, nằm ngoài job. |
| 15 | BH | Log pino còn in `ipnKey` | false | reject | Đã có từ trước; `ipnKey` được ghi rõ "không phải secret" (`packages/contracts/src/organizer.ts:251`). |
| 16 | BH | `PROBE_PATHS` khai hai nơi, chuẩn hóa khác nhau | low | reject | Chỉ lệch với probe viết hoa hay có `/` cuối, load balancer không gửi dạng đó. Sửa phải tách module. |
| 17 | BH | Thiếu test outcome `network`/`invalid_json`, nhánh `'other'`, nhánh lỗi của `shutdownTelemetry` | low | reject | `outcome` truyền thẳng từ `sent.reason`; mọi path đều có trong bảng nên `'other'` không chạm tới. Collector treo đã có test. |
| 18 | BH | Process test không đi luồng `create_link` | low | reject | Unit `tingee-telemetry.test.ts` kiểm span con và histogram `create_link`; process test kiểm cùng `measured` qua `get_va_paging`. |
| 19 | BH | Danh sách secret gieo trong process test thiếu mật khẩu DB, `GOOGLE_CLIENT_SECRET`, `REVALIDATE_SECRET` và khóa | low | patch | Sửa trực tiếp trong test. Luồng đăng ký/đăng nhập: span Better Auth chỉ mang route mẫu và operation id, không có body. |
| 20 | BH | `main.ts` catch tự rút gọn lỗi, bỏ `code` | low | patch | Sửa trực tiếp: dùng `telemetryErrorSummary` (import `telemetry/state.js`, không qua index). |
| 21 | BH, ECH | SDK khởi dở dang khi `start()` ném; `main().catch` thoát mà không flush | low | reject | Chưa có đường nào làm `start()` ném. Sửa phải thêm nhánh dọn dẹp. |
| 22 | BH | README hứa trace `create_link → process <queue>`, nhưng job Đối soát bù chạy sau 2 phút | low | patch | `RECONCILE_AFTER_ATTEMPT_MS[0]` = 2 phút (`reconciliation-jobs.ts:27`). Sửa câu chữ: chỉ luồng "Kiểm tra lại", ghi chú tên metric Prometheus là tên quy đổi. |
| 23 | BH | sdk-node kéo gRPC, proto, Zipkin vào dependency | low | reject | Không ảnh hưởng chạy; sửa phải bỏ NodeSDK. |
| 24 | BH | Hai bản `@opentelemetry/core` (3.0.0 và 3.1.1) | low | patch | Đã kiểm trong `node_modules/.pnpm`. Lệch bộ 3.0.0 của spec; sửa bằng một override pnpm. |
| 25 | BH | Helper process test trùng với bản riêng của `roles.process.test.ts` | low | reject | Chỉ là trùng lặp trong test; sửa phải refactor test cũ. |
| 26 | BH | Code chết: `telemetryEnabled()`, re-export `TINGEE_OPERATIONS` | low | patch | Không có nơi gọi; xóa trực tiếp. |
| 27 | BH | Thuộc tính `outcome` không có namespace | low | reject | Tên `outcome` do phần đã khóa của spec quy định. |
| 28 | ECH | Client công khai gửi `traceparent`/`tracestate` → chọn được traceId, `tracestate` đi tiếp sang Tingee | low | reject | Chỉ gộp được trace của chính người gửi; traceId không trả ra ngoài. Sửa phải thêm propagator riêng; để 4.7 (edge bỏ header) xét. |
| 29 | ECH | Path không chuẩn (`//`, đoạn rỗng, percent-encode) lọt token | low | reject | Các path đó không khớp route nào nên thành 404; client chuẩn không tạo ra. Sửa phải thêm chuẩn hóa. |
| 30 | ECH | `create_link` trả `00` mà URL sai → outcome `ok` | low | reject | Hiếm; sửa phải thêm logic theo từng thao tác. |
| 31 | ECH | Lô nhiều job: span lô lỗi theo job cuối | low | reject | Một span cho mỗi lô là cách của pg-boss; sửa phải thêm event. |
| 32 | ECH | `dedupeBy` gộp job → log mang `jobId` của job đầu | low | reject | Chỉ queue revalidate trang Sự kiện (`public-page-jobs.ts:133`) dùng; sửa phải gom danh sách id. |
| 33 | ECH | `stopProcess` có comment hứa SIGKILL nhưng không làm | low | patch | Sửa trực tiếp comment; `afterAll` đã `killProcess`. |
| 34 | ECH | `runProcess` không timeout; `freePort` không chờ `close` | low | reject | `testTimeout` của vitest chặn treo; trùng cổng gần như không xảy ra. |
| 35 | ECH | Dòng "chu kỳ âm" của process test không kiểm giá trị có lọt ra không | low | patch | Sửa trực tiếp: kiểm thêm `not.toContain` chính giá trị. |
| 36 | ECH | AC "không phải sửa test cũ" nhưng `test/helpers.ts` đã đổi | false | reject | Chỉ thêm giá trị mặc định mà kiểu bắt buộc, hành vi như không đặt env; không assertion cũ nào đổi. |

## Design Notes

- **Khởi trong `main.ts`, không dùng `--import`:** config đã qua Zod trước, chỉ có một điểm vào, và Dockerfile, script, process test giữ nguyên. Vai được `import` động, nên hook ESM đăng ký bằng `module.register` vẫn kịp trước khi express và pg nạp. Process test là nơi chứng minh điều này.
- **Route qua `RPCMetadata`, không dùng instrumentation express:** cách của express sinh một span cho mỗi middleware, gây nhiễu. Interceptor Nest chỉ đặt `route` lên span server mà instrumentation-http đã tạo, nên metric HTTP cũng có `http.route`.
- **Đo Tingee ngay ở 4.6-a:** undici chỉ biết host Tingee, không biết đó là thao tác nào. Histogram theo `tingee.operation` là số liệu duy nhất cho p95 tạo link. Còn ùn hàng đợi và dead-letter thì 4.6-b đọc từ `pgboss.queue.jobs`.

## Verification

**Commands:**
- `pnpm typecheck`: expected không lỗi.
- `pnpm lint:deps`: expected không vi phạm.
- `pnpm --filter @tickee/api build && pnpm --filter @tickee/api test`: expected pass, gồm process test telemetry và `roles.process.test.ts`.

**Manual checks:**
- `docker compose --profile observability up -d otel-lgtm`, đặt `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`, chạy `pnpm dev`, mua một Vé có phí với Tingee fake. Mở Grafana ở `http://localhost:3030`: thấy trace request → `tingee create_link` → `process <queue>`, và metric `tickee.tingee.request.duration`.
