# Tickee

Monorepo pnpm + Turborepo theo Structural Seed của Architecture Spine.

```text
apps/web            Next.js — chỉ render, gọi REST /v1 (không DB; secret duy nhất là REVALIDATE_SECRET, chỉ ở server)
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
                                   # + MinIO (ảnh Sự kiện, http://localhost:9000; console http://localhost:9001)
pnpm install

# Chế độ dev: migrate DB, rồi api (http://localhost:3001) + worker + web (http://localhost:3000) + contracts
# + Tingee fake (http://localhost:4010); tự build lại khi sửa code
pnpm dev
# Bộ giao diện "Rạp tối": http://localhost:3000/ui-kit

# Terminal khác, sau khi `pnpm dev` đã migrate: BTC demo đã duyệt Closed Beta, có tài khoản nhận tiền (xem mục dưới)
pnpm db:seed
```

`pnpm dev` chạy `turbo dev dev:worker dev:tingee` với giao diện TUI: bên trái là danh sách task, bên phải là log của task đang chọn. Dùng phím mũi tên ↑/↓ để đổi task, chuột hoặc `u`/`d` để cuộn log, `q` để thoát. Không cần build hay migrate tay.
- Trước hết turbo build contracts và api rồi chạy migration (`db:migrate`: migration Drizzle + schema pgboss + cấp quyền
  cho `tickee_app`, như vai `APP_ROLE=migrate`). Migration lỗi (vd. Postgres chưa chạy) thì api và worker không khởi
  động: turbo dừng và in lỗi kết nối.
- api: `tsc --watch` cùng `node --watch` với `APP_ROLE=api`, đọc `.env` ở gốc repo. Log in qua `pino-pretty` (cấu hình ở `apps/api/.pino-prettyrc`), chỉ ở chế độ dev; production vẫn log JSON.
- worker: `node --watch` với `APP_ROLE=worker` trên cùng `dist/` (tự chạy lại khi api build lại), đọc `.env` ở gốc repo
  (cần `REVALIDATE_SECRET`, có sẵn trong `.env.example`). Gửi email từ job (lời mời Admin…) và revalidate trang Sự kiện
  công khai.
- Tingee fake (`dev:tingee`): Tingee giả ở cổng 4010 (`.env.example` đã trỏ `TINGEE_BASE_URL` vào đây), có hai merchant
  demo (`apps/api/test/tingee-fake/demo-merchants.ts`) và trang thanh toán giả gửi IPN tới api (xem "Thanh toán Đơn có
  phí ở local"). Không bao giờ gọi Tingee thật.
- web: `next dev`, đọc `apps/web/.env.development` (`NEXT_PUBLIC_API_BASE_URL`, `TICKEE_UI_KIT=1`).
- contracts: `tsc --watch`.

### Ảnh Sự kiện ở local (MinIO)

`docker compose up -d --wait` chạy MinIO (object storage tương thích S3, Story 4.8-a) và `minio-init`: tạo bucket
`tickee-event-images`, cho đọc ẩn danh từng object (không cho liệt kê bucket) rồi đứng yên với healthcheck "đã sẵn sàng".
MinIO bật CORS cho `http://localhost:3000` (cả `GET` lẫn `PUT`, vì trình duyệt PUT thẳng lên storage). `.env.example` đã
trỏ các biến `S3_*` vào đây; `.env` chép từ trước Story 4.8-a thì thêm nhóm `S3_*` của `.env.example`, nếu không api dừng
và nêu tên biến thiếu.

- Api không tải hay đọc byte ảnh nào: `POST /v1/orgs/{orgId}/event-images` (Owner/Admin, body `{ contentType,
  contentLength }`, JPEG/PNG/WebP ≤ 5 MB) trả `{ key, uploadUrl, expiresAt }`. URL ký đúng `content-type` và
  `content-length` đã khai, hạn 5 phút: PUT file khác số byte thì MinIO trả 403.
- Giới hạn presign (Story 4.7-d, `EVENT_IMAGE_PRESIGN_LIMITS`): 50 lần mỗi BTC và 100 lần mỗi tài khoản (gộp mọi BTC)
  trong 24 giờ trượt; vượt thì `429 EVENT_IMAGE_RATE_LIMITED` kèm `retryAfterSeconds` (log `warn` marker
  `event_image_presign_limited`). Mỗi lần cấp log `info` marker `event_image_presign_issued` kèm `userId`,
  `organizationId`, `key`. Local chạm trần thì `DELETE FROM event_image_presigns`. Staging/production: chỉ gỡ chặn cho
  một BTC hay một tài khoản, bằng role có quyền `DELETE` trên bảng (`tickee_app` hoặc `tickee_migrator`):
  `DELETE FROM event_image_presigns WHERE organization_id = '<orgId>'` (hoặc `WHERE user_id = '<userId>'`).
- Lưu `key` vào Sự kiện bằng trường `imageKey` khi tạo hoặc sửa (`null` hoặc bỏ trường = gỡ ảnh). Detail, danh sách và
  trang công khai trả `imageUrl` = `<S3_PUBLIC_BASE_URL>/<key>`.
- Web (Story 4.8-b): ô "Ảnh bìa" ở wizard bước 1 và tab "Cài đặt" làm đúng hai bước trên ngay khi chọn file, rồi gửi
  `imageKey` (key đang có, key mới, hoặc `null` sau "Gỡ ảnh") cùng nút lưu. `event-card`, hero `/e/{slug}` và ảnh OG
  dùng `imageUrl`; ảnh OG do server Next tự tải ảnh (timeout 3 giây) nên `S3_PUBLIC_BASE_URL` phải mở được từ cả server
  web lẫn trình duyệt.
- Thử bằng tay (cookie session của BTC demo lấy từ trình duyệt):

  ```sh
  curl -s -X POST http://localhost:3001/v1/orgs/<orgId>/event-images -H 'content-type: application/json' \
    -H 'cookie: <cookie session>' -d "{\"contentType\":\"image/webp\",\"contentLength\":$(wc -c < anh.webp)}"
  curl -i -X PUT '<uploadUrl>' -H 'content-type: image/webp' --data-binary @anh.webp   # 200
  ```

  Rồi `PATCH` Sự kiện với `imageKey` là `key` vừa nhận; mở `imageUrl` trong trình duyệt. Object nằm dưới
  `orgs/{orgId}/events/` trong console MinIO (http://localhost:9001, `tickee-local` / `tickee-local-secret`).
- Không xóa object cũ hay mồ côi khi đổi/gỡ ảnh. `docker compose down -v` xóa cả dữ liệu MinIO.
- MinIO ngừng phát image cộng đồng (`minio/minio`, `minio/mc`) từ cuối 2025: compose dùng bản fork cộng đồng `pgsty/minio`
  và `pgsty/mc`, ghim tag.

### Hai bẫy của `.env` local

- **`TINGEE_BASE_URL` phải là `http://localhost:4010`** (Tingee fake, như `.env.example`). Trỏ Tingee thật (UAT hay
  production) thì `pnpm dev` vẫn chạy fake nhưng api không gọi nó: Tingee thật không biết key demo, Đơn có phí báo
  "Chưa tạo được link thanh toán". Hay gặp khi chép `.env` từ máy khác hoặc từ môi trường khác.
- **Không bao giờ đổi giá trị của một phiên bản khóa đã dùng** trong `TINGEE_CREDENTIAL_KEYS` và `TICKET_QR_KEYS` (vd.
  `v1:<giá trị A>` thành `v1:<giá trị B>`), cũng không gỡ phiên bản còn dữ liệu dùng. Muốn đổi khóa thì thêm
  `v<k+1>:<khóa mới>` (`openssl rand -base64 32`) và giữ khóa cũ: dữ liệu mới dùng khóa mới, dữ liệu cũ vẫn đọc bằng khóa
  cũ. Đổi giá trị mà giữ số phiên bản thì:
  - `TINGEE_CREDENTIAL_KEYS`: api không giải mã được Secret Token Tingee đã lưu (`SecretBoxError`). Đơn có phí báo "Chưa
    tạo được link thanh toán", IPN của BTC đó trả 500, trang Tài khoản nhận tiền không đọc được danh sách tài khoản.
  - `TICKET_QR_KEYS`: Mã QR của Vé đã phát (trong email, ảnh chụp) không còn khớp chữ ký; link chia sẻ đang hiện trên
    Trang Đơn và Chi tiết Vé trả 404 tới khi chủ Vé bấm "Tạo lại link".

  Sửa ở local (api và worker chỉ đọc khóa lúc khởi động: sửa `.env` xong thì khởi động lại `pnpm dev`):
  - Cách đầy đủ: khôi phục giá trị cũ của phiên bản đó.
  - Không còn giá trị cũ, với `TINGEE_CREDENTIAL_KEYS`: `pnpm db:seed` mã hóa lại key merchant demo hiện hành của BTC
    demo (xem mục dưới); BTC đã nhập key riêng thì liên kết lại key ở trang Tài khoản nhận tiền. Cả hai chỉ sửa key
    hiện hành, tức việc tạo link thanh toán mới. api kiểm chữ ký IPN bằng mọi credential của BTC, kể cả credential đã
    thay (vẫn giữ ciphertext cũ): còn dòng nào của BTC không giải mã được thì IPN của BTC đó vẫn trả 500. Khi đó dựng
    lại DB local: `docker compose down -v`, rồi `pnpm dev` và `pnpm db:seed`.
  - Với `TICKET_QR_KEYS` thì seed không sửa gì: Vé local đã phát dùng "Tạo lại link", hoặc mua Vé mới.

### Dữ liệu dev (`pnpm db:seed`)

```sh
pnpm db:seed                          # BTC demo cho btc.demo@tickee.local
pnpm db:seed --email ban@vidu.vn      # BTC demo cho tài khoản này (có sẵn hoặc tạo mới)
```

Chạy sau khi `pnpm dev` đã migrate DB: seed không tự migrate (DB chưa migrate thì báo lỗi `42P01` và không đổi gì).
Trong một transaction, seed tạo phần còn thiếu:
- Tài khoản Tickee (đã đồng ý NĐ 13; tài khoản có sẵn thì giữ nguyên);
- BTC "BTC Demo" do tài khoản đó làm Owner, đã duyệt Closed Beta;
- key Tingee của merchant demo `demo-btc-co-tai-khoan` (Secret Token mã hóa bằng `TINGEE_CREDENTIAL_KEYS` như api) và tài
  khoản nhận tiền mặc định MB Bank ••••4567, khớp VA mà Tingee fake trả về;
- khóa định tuyến IPN cố định `SEED_IPN_KEY` (`demo-merchants.ts`), nếu chưa BTC nào giữ: Tingee fake biết sẵn URL IPN
  của BTC này. BTC demo seed trước đây (khóa ngẫu nhiên) cũng nhận khóa này khi chạy lại seed. Đã có BTC khác giữ (vd.
  BTC demo của `--email` trước) thì BTC demo mới nhận khóa ngẫu nhiên (seed báo: phải dán URL IPN của BTC này vào ô
  "Đường dẫn IPN" trên trang thanh toán giả) và BTC cũ giữ nguyên khóa.

Seed cũng kiểm key Tingee hiện hành của BTC demo còn giải mã được bằng `TINGEE_CREDENTIAL_KEYS` không (hỏng khi đổi giá
trị khóa mà giữ số phiên bản, hoặc gỡ phiên bản cũ; xem "Hai bẫy của `.env` local"):
- key merchant demo của seed (`demo-btc-co-tai-khoan`): seed mã hóa lại Secret Token demo bằng khóa hiện hành ngay trên
  dòng credential đó và báo một dòng "Mã hóa lại Secret Token…". Tài khoản nhận tiền và Đơn cũ vẫn trỏ cùng dòng, Secret
  Token không đổi, nên tạo link chạy lại; IPN của BTC chỉ chạy lại khi BTC không còn credential đã thay nào mã hóa bằng
  khóa cũ (xem "Hai bẫy của `.env` local");
- key khác (BTC đã nhập key riêng ở trang Tài khoản nhận tiền, kể cả merchant demo `demo-btc-chua-lien-ket`): seed không
  biết Secret Token gốc nên thoát mã 1, không đổi gì, và in cách sửa như "Hai bẫy của `.env` local".

Seed chỉ kiểm BTC demo của `--email` đang chạy (mặc định `btc.demo@tickee.local`). BTC khác: là BTC demo của tài khoản
khác thì chạy `pnpm db:seed --email <email Owner>`, còn lại sửa như "Hai bẫy của `.env` local". Seed không kiểm hay sửa
credential đã thay (`retired_at`). Thông báo của seed không in ciphertext, Secret Token hay chuỗi kết nối.

Xong thì in email đăng nhập: đăng nhập OTP ở `http://localhost:3000/dang-nhap` (mã ở Mailpit), tạo Sự kiện có Hạng vé có
phí rồi bấm "Mở bán" được ngay. Chạy lại không tạo trùng (báo "Không đổi" khi mọi thứ đã đủ và key còn giải mã được);
tài khoản nhận tiền đã hủy liên kết hay Closed Beta đã thu hồi thì seed thêm lại. Seed chạy bằng `tickee_migrator`
(`MIGRATION_DATABASE_URL` trong `.env`), không gọi Tingee, không ghi audit, và từ chối chạy khi `NODE_ENV=production`. Key
demo là key giả, chỉ có nghĩa với Tingee fake.

Mailpit: SMTP `localhost:1025`, giao diện `http://localhost:8025`.

### Thanh toán Đơn có phí ở local

Đơn có phí nhận link thanh toán trỏ về trang thanh toán giả của Tingee fake (`http://localhost:4010/checkout/{mã Đơn}`);
không có tiền nào được chuyển. Trang có ô "Đường dẫn IPN" (như ô cùng tên trên portal Tingee) và ba nút:

- "Đã thanh toán (giả lập)": fake ký IPN `success` (số tiền đúng bằng số tiền của link) bằng Secret Token của merchant
  tạo link, gửi tới Đường dẫn IPN, rồi đưa trình duyệt về Trang Đơn. Trang Đơn hiện Vé.
- "Hết hạn" / "Hủy": IPN `expired` / `canceled`. Đơn hết hạn, chỗ được nhả.

Trang giả chỉ chuyển trang khi api trả ACK (HTTP 2xx kèm JSON `"code":"00"`). api từ chối, URL trỏ nhầm dịch vụ khác
(trả 2xx nhưng không phải ACK), không tới được hoặc quá 10 giây không trả lời thì trang giả báo lỗi (kèm HTTP status và
body nhận được) và không chuyển trang. Quá 10 giây thì IPN đã được gửi và có thể api đã xử lý: xem Trang Đơn trước khi
bấm lại. Mỗi lần bấm gửi một IPN mới (`requestId` mới). Mọi IPN `success` của một link mang cùng mã giao dịch (một lần
trả của link, như Tingee gửi lại IPN), nên bấm lại chỉ là IPN lặp; IPN `expired` / `canceled` không có mã giao dịch.

Đối soát bù (Story 4.1) ở local: fake nhớ trạng thái thanh toán của từng link (nút "Đã thanh toán (giả lập)" đánh dấu
link đã trả trước khi gửi IPN; "Hết hạn" / "Hủy" chỉ đổi link chưa trả) và trả lời API tra đơn Gateway theo hợp đồng tạm.
Với `TINGEE_ORDER_STATUS_QUERY=true` (`.env.example`), worker tra mỗi Đơn có link sau 2, 5, 10 phút kể từ lúc tạo link,
lúc hết hạn, rồi 30 phút, 2 giờ, 24 giờ sau hết hạn. Muốn thử IPN mất: sửa ô "Đường dẫn IPN" thành URL sai (vd. đổi
cổng) rồi bấm "Đã thanh toán (giả lập)" (trang giả báo lỗi gửi IPN); khoảng 2 phút sau worker tra fake, Đơn thành
`paid` và Trang Đơn hiện Vé.

Với BTC demo của `pnpm db:seed` thì không cần cấu hình gì thêm: đăng nhập bằng email BTC demo, tạo Sự kiện có Hạng vé có
phí, bấm "Mở bán", mua Vé rồi bấm "Đã thanh toán (giả lập)". Seed gán cho BTC demo khóa cố định `SEED_IPN_KEY`, nên fake
điền sẵn `{API_PUBLIC_URL}/v1/payments/tingee/ipn/{SEED_IPN_KEY}` (`API_PUBLIC_URL` đọc từ `.env`, in ra khi fake khởi
động).

BTC khác (nhập key merchant demo ở trang Tài khoản nhận tiền, hoặc BTC demo thứ hai của `--email` dùng chung merchant
demo): chép "URL IPN" ở trang Tài khoản nhận tiền của BTC đó, dán vào ô "Đường dẫn IPN" trên trang giả rồi bấm nút. Như
Tingee, mỗi merchant có một Đường dẫn IPN: api trả ACK thì fake nhớ URL đó cho merchant (Đơn sau điền sẵn) tới khi fake
khởi động lại. IPN của Đơn thuộc BTC khác gửi vào URL này thì api chỉ lưu và vẫn trả 200: trang giả vẫn về Trang Đơn
nhưng Đơn còn chờ thanh toán. Khi đó dán URL IPN của đúng BTC rồi bấm lại.

### Chạy từ bản build

Không phải bước dev (`pnpm dev` đã chạy đủ các vai). Dùng để thử từng vai như image production, trên bản build và DB đã
migrate:

```sh
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 pnpm turbo build

# API (http://localhost:3001/healthz, /readyz; REST dưới /v1)
APP_ROLE=api node --env-file=.env apps/api/dist/main.js

# Worker (pg-boss, không mở HTTP)
APP_ROLE=worker node --env-file=.env apps/api/dist/main.js

# Web từ bản build (http://localhost:3000)
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 pnpm --filter @tickee/web start
```

### Quan sát: trace và metrics ở local (OpenTelemetry)

api và worker xuất trace và metrics OpenTelemetry (OTLP/HTTP) khi có `OTEL_EXPORTER_OTLP_ENDPOINT`; để trống (mặc định của
`.env.example`) là tắt hẳn. Log không đi qua OTLP: vẫn là JSON ra stdout, và khi bật thì mỗi dòng log trong một span mang
`traceId`, `spanId` để nối sang trace. Thử ở local:

1. `docker compose --profile observability up -d otel-lgtm` (collector + Grafana, Tempo, Prometheus; không chạy mặc định).
2. Đặt `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` trong `.env` (muốn thấy metrics nhanh: `OTEL_METRIC_EXPORT_INTERVAL=5000`)
   rồi chạy lại `pnpm dev`. Dòng log `OpenTelemetry đã bật` của vai api và worker cho biết SDK đã khởi.
3. Mua một Vé có phí với Tingee fake, rồi mở Grafana ở `http://localhost:3030`: Explore › Tempo thấy trace
   `POST /v1/events/:slug/orders` → `tingee create_link`. Span `process <queue>` của worker chỉ vào trace khi job chạy:
   job Đối soát bù chạy khoảng 2 phút sau lần tạo link. Muốn thấy job của worker ngay trong cùng trace: BTC đang "Tạm
   ngừng bán" bấm "Kiểm tra lại" (`POST /v1/orgs/:orgId/payment-service/check`) → `tingee get_va_paging` →
   `process payment.service-resumed`.
4. Explore › Prometheus: tên metric là tên OpenTelemetry đã đổi sang quy ước Prometheus, vd.
   `tickee.tingee.request.duration` → `tickee_tingee_request_duration_seconds` (theo `tingee_operation`, `outcome`),
   `http.server.request.duration` → `http_server_request_duration_seconds` (theo `http_route`), `pgboss.queue.jobs` →
   `pgboss_queue_jobs` (theo queue và trạng thái).

Span không mang query, token link chia sẻ, `ipnKey`, đường dẫn `/v1/auth/*`, header, IP, User-Agent hay message lỗi.
Collector không chạy thì api, worker vẫn chạy bình thường, chỉ log `warn` mỗi lần không xuất được.

### Cảnh báo vận hành (email cho đội vận hành)

Kênh `platform/alerts` (Story 4.6-b) gửi email `[Tickee vận hành] <tiêu đề>` tới `OPS_ALERT_EMAILS` khi:

| Loại | Báo khi | Chống lặp |
| ---- | ------- | --------- |
| `payment_unmatched` | tiền về tài khoản BTC mà không khớp Đơn nào của BTC (IPN hay Đối soát bù) | một lần mỗi khoản tiền |
| `payment_reconciliation_stopped` | Đối soát bù dừng tra một Đơn | một lần mỗi mã Đơn |
| `ticket_qr_key_missing` | `TICKET_QR_KEYS` của instance thiếu khóa của Vé còn dùng: phát hiện lúc api hoặc worker khởi động (xem "Xoay khóa Mã QR vé"), hoặc khi link chia sẻ Vé trả 404 | mỗi cặp phiên bản khóa, `OPS_ALERT_COOLDOWN_MINUTES` |
| `queue_backlog` | queue pg-boss có job tới hạn quá `OPS_ALERT_QUEUE_WAIT_MINUTES` mà chưa chạy | mỗi queue, `OPS_ALERT_COOLDOWN_MINUTES` |
| `dead_letter` | có job mới trong một queue `*.dead-letter` (một email mỗi queue mỗi lượt quét) | một lần mỗi job |
| `pending_order_overdue` | lưới an toàn `ordering.safety-sweep` (mỗi phút) cho hết hạn Đơn `pending` quá hạn hơn 2 phút mà job hết hạn chưa xử lý | một lần mỗi mã Đơn |
| `inventory_drift` | đối chiếu tồn kho `ordering.inventory-check` (mỗi 10 phút) thấy `held`/`sold` của Hạng vé lệch với Đơn `pending`/Vé đã phát | một lần mỗi bộ số liệu lệch của Hạng vé |
| `ipn_failures` | một instance api nhận từ `OPS_ALERT_IPN_FAILURES` IPN lỗi trong 5 phút: 401 (chữ ký/timestamp sai, kể cả key cũ không ràng được Đơn), 400 chữ ký đúng mà body hỏng, 5xx; email nêu số lần theo lý do `signature` / `invalid_body` / `server_error`. Không đếm `ipnKey` lạ (404), body quá lớn (413), client ngắt kết nối | cả hệ thống, `OPS_ALERT_COOLDOWN_MINUTES` |
| `payment_link_slow` | một instance api có p95 (nearest-rank) thời gian `create-link` trong 5 phút vượt `OPS_ALERT_LINK_P95_MS`, khi có từ `OPS_ALERT_LINK_MIN_SAMPLES` lần gọi (mọi kết quả, kể cả timeout) | cả hệ thống, `OPS_ALERT_COOLDOWN_MINUTES` |
| `ticket_issuance_drop` | Đơn có lượt tạo link trong khung (75 → 15 phút trước) có từ `OPS_ALERT_ISSUANCE_MIN_ORDERS` Đơn mà tỉ lệ đã được trả tiền dưới `OPS_ALERT_ISSUANCE_RATIO` lần tỉ lệ của cùng khung 7 ngày trước (khung nền không có Đơn thì bỏ qua) | cả hệ thống, `OPS_ALERT_COOLDOWN_MINUTES` |

Ba loại đầu đi cùng dòng log `error` có `alert` sẵn có; `queue_backlog`, `dead_letter` và `ticket_issuance_drop` do job
cron `platform.ops-alert-scan` của worker quét mỗi phút (`ticket_issuance_drop` là luật `ordering` đăng ký vào job
quét); `pending_order_overdue`, `inventory_drift` do lưới an toàn của `ordering` báo (Story 4.6-c). `ipn_failures` và
`payment_link_slow` (Story 4.6-e) đếm trong bộ nhớ của từng instance api và xét ngay khi có lần mới: không cộng giữa các
instance, nên lỗi rải đều qua load balancer có thể báo chậm hơn. Ba loại của Story 4.6-e có một đối tượng chung cho cả
hệ thống: tối đa một email mỗi loại mỗi `OPS_ALERT_COOLDOWN_MINUTES`. Mỗi lần có đối tượng mới còn có một dòng log
`error` kèm `alert: <loại>`. Email chỉ có loại, id, mã Đơn, tên queue, số đếm, lý do, và với ba loại của Story 4.6-e
thêm số đo và ngưỡng (`p95Ms`, `thresholdMs`, `thresholdRatio`, `windowMinutes`, `threshold`). Không đặt
`OPS_ALERT_EMAILS` thì chỉ có log (worker log `warn`); cảnh báo phát hiện trong lúc đó vẫn được ghi dấu, nên đặt người
nhận sau sẽ không được gửi email lại. Email gửi lỗi thì retry 8 lần rồi vào `platform.ops-alert.dead-letter`; job quét
chỉ log `error` cho queue này, và cho chính `platform.ops-alert` khi nó ùn. Worker chết thì không có lượt quét nào.

Thử ở local: đặt `OPS_ALERT_EMAILS=van-hanh@tickee.local` trong `.env`, chạy `pnpm dev`, rồi chép tay một job vào
dead-letter (job thật chỉ vào đó sau 8 lần retry, mất vài giờ):

```sh
docker compose exec postgres psql -U tickee_app -d tickee \
  -c "INSERT INTO pgboss.job (name, data) VALUES ('ordering.send-buyer-email.dead-letter', '{}')"
```

Trong một phút Mailpit (`http://localhost:8025`) nhận đúng một email `[Tickee vận hành] Job vào dead-letter` nêu id job;
lượt quét sau không gửi lại.

Xem và chạy lại job dead-letter ở `/admin` › tab "Dead-letter" (Quản trị Tingee, Story 4.6-d): bảng 200 job mới vào
dead-letter nhất (queue gốc, id job nêu trong email, số lần đã thử, lý do lỗi đã che email và chuỗi số dài, payload).
"Requeue" chuyển đúng một job về queue gốc bằng `boss.redrive` (job mới, lượt thử từ 0; job gửi email sẽ gửi lại) và
ghi audit `dead_letter_job.requeued` trong cùng transaction. Không có xóa hay requeue hàng loạt: job không cần chạy lại
thì để đó, pg-boss tự xóa sau 14 ngày. Job chép tay như lệnh trên không có queue gốc nên không requeue được.

### Trang Sự kiện công khai cập nhật ngay khi BTC sửa

Trang `/e/{slug}` cache phần tĩnh 30 giây. BTC sửa Sự kiện đã mở bán (tên, giờ, địa điểm, Hạng vé…) hoặc bấm "Mở bán"
thì api enqueue job `event.revalidate-public-page`; worker gọi `POST <WEB_ORIGIN>/api/revalidate` kèm
`Authorization: Bearer <REVALIDATE_SECRET>` và web xóa cache theo tag `event:{slug}`. Thử ở local:

1. Đặt cùng một `REVALIDATE_SECRET` (≥ 32 ký tự) ở `.env` (worker đọc) và ở `apps/web/.env.local` (web đọc cả khi
   `pnpm dev` lẫn `pnpm --filter @tickee/web start`; file này không commit).
2. `pnpm dev` (đã chạy cả worker).
3. Mở `/e/{slug}`, sửa tên trong dashboard, tải lại trang sau ~3 giây: thấy tên mới.

Không có worker hoặc web thiếu biến (route trả 503) thì job retry 3 lần rồi bỏ; trang vẫn tự làm mới sau 30 giây.

### Đăng nhập bằng mã OTP ở local

1. Chạy docker compose và `pnpm dev` như trên. `.env` cần các biến đăng nhập/email của `.env.example`
   (`BETTER_AUTH_SECRET`, `API_PUBLIC_URL`, `WEB_ORIGIN`, `SMTP_URL`, `EMAIL_FROM`, `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`); thiếu thì api dừng và nêu tên biến.
2. Mở `http://localhost:3000/dang-nhap`, nhập email bất kỳ rồi bấm "Gửi mã".
3. Lấy mã 6 số trong Mailpit: `http://localhost:8025` (mọi email gửi ra ở local đều nằm ở đây, không tới hộp thư thật).
4. Nhập mã. Tài khoản mới phải qua màn đồng ý NĐ 13 (`/dong-y`) rồi mới về trang `returnTo`.

Giới hạn gửi mã: 1 lần/60 giây và 5 lần/giờ mỗi email, 20 lần/giờ mỗi IP. Nhập sai quá 15 lần trong 24 giờ thì email
bị khóa cả gửi lẫn xác minh (`OTP_LOCKED`). Muốn thử lại ngay ở local:
`psql postgresql://tickee_migrator:tickee_migrator@localhost:5432/tickee -c 'DELETE FROM otp_send_events; DELETE FROM otp_verify_failures'`.

### Đăng nhập bằng Google ở local

1. Vào Google Cloud Console → APIs & Services → Credentials (`https://console.cloud.google.com/apis/credentials`).
   Lần đầu phải cấu hình OAuth consent screen (loại External, chế độ Testing, thêm email của bạn vào Test users;
   scope chỉ cần `openid`, `email`, `profile`).
2. Create credentials → OAuth client ID → loại **Web application**.
   Authorized redirect URIs: `http://localhost:3001/v1/auth/callback/google` (tức `<API_PUBLIC_URL>/v1/auth/callback/google`;
   staging/production thêm URI theo `API_PUBLIC_URL` của môi trường đó). Không cần Authorized JavaScript origins.
3. Đặt `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` vào `.env` (không commit) rồi khởi động lại api.
4. Mở `http://localhost:3000/dang-nhap` → "Tiếp tục với Google". Cùng email với tài khoản OTP thì vẫn là một tài khoản
   (thêm một dòng `accounts` với `provider_id = 'google'`). Google chưa xác minh email thì không đăng nhập được.

Hai biến này bắt buộc với vai api; test và CI dùng giá trị giả (test chặn lời gọi tới token endpoint của Google).

### Quản trị Tingee (`/admin`)

Cờ `users.platform_admin` chỉ cấp/thu bằng CLI, không có UI hay API nào làm việc này. CLI chạy bằng role
`tickee_migrator` (`MIGRATION_DATABASE_URL`, như vai migrate) vì `tickee_app` không có quyền UPDATE cột này. Chạy sau
`pnpm turbo build`; tài khoản phải đã đăng nhập Tickee ít nhất một lần.

```sh
# --by: email Tài khoản Tickee của người chạy lệnh (audit ghi tài khoản này). Lần đầu thì tự cấp cho chính mình.
pnpm --filter @tickee/api admin:grant an.nguyen@vidu.vn --by an.nguyen@vidu.vn    # "Đã cấp…", chạy lại: "Không đổi…"
pnpm --filter @tickee/api admin:revoke binh.tran@vidu.vn --by an.nguyen@vidu.vn
```

Email không tồn tại hoặc thiếu `--by` thì thoát mã ≠ 0 và không đổi gì. Vào `http://localhost:3000/admin` (màn "Duyệt
Closed Beta") còn cần đã bật xác thực hai lớp (Bảo mật tài khoản) và nhập mã TOTP trong phiên đăng nhập; thu cờ có hiệu
lực ngay ở request kế tiếp.

Giới hạn IP (Story 4.7-a): api chỉ nhận request `/v1/admin` và `/v1/admin/*` (kể cả route không tồn tại và request
chưa đăng nhập) từ IP nằm trong `ADMIN_ALLOWED_CIDRS`. Mọi method đều bị chặn, trừ preflight CORS `OPTIONS`: lớp CORS
trả lời nó trước khi kiểm IP (không dữ liệu, không log chặn) để trình duyệt đọc được mã 403 của request thật. IP client
là `req.ip` của Express: `TRUST_PROXY_HOPS` phải bằng đúng số proxy trước api. Thấp hơn thì api so IP của LB (với `0`,
`X-Forwarded-For` do client gửi bị bỏ qua); cao hơn thì mục `X-Forwarded-For` do client tự gửi thành `req.ip` và ai cũng
tự nhận được một IP trong dải. Admin bị chặn sau deploy thì sửa `TRUST_PROXY_HOPS`, **không bao giờ** thêm dải nội bộ
của load balancer hay VPC vào `ADMIN_ALLOWED_CIDRS`: mọi request đi qua LB sẽ vào được. IPv4 dạng `::ffff:a.b.c.d`
được so như IPv4; dải IPv6 chồng lên `::ffff:0:0/96` (vd. `::/1`) bị từ chối vì sẽ khớp mọi client IPv4. IP ngoài dải
nhận `403 ADMIN_IP_NOT_ALLOWED` trước mọi guard (không chạm DB) và api log `warn` có marker `admin_ip_blocked` kèm
method, đường dẫn, không có IP; `/admin` hiện "Bạn đang truy cập từ mạng không được phép.". Ở `NODE_ENV=production` (cả
staging) thiếu hoặc sai biến này thì api không khởi động; có thì api log `info` một lần với số dải IPv4/IPv6 (không nêu
địa chỉ) để kiểm sau deploy; local để trống thì không giới hạn. Mọi route `@RequirePlatformAdmin()` phải nằm dưới
`/v1/admin/`, nếu không guard trả 500 (lỗi cấu hình) để route admin không lọt ra ngoài vùng bị chặn. Web `/admin` không
tự giới hạn IP.

## Cấu hình staging/production

`NODE_ENV` bắt buộc ở cả ba vai (`api`, `worker`, `migrate`) và không có mặc định: thiếu hoặc rỗng thì tiến trình dừng với
`NODE_ENV (thiếu)`, để không luật production nào tự tắt. Image đặt sẵn `NODE_ENV=production` (staging cũng chạy
production); `.env.example` đặt `development`; test và bước Migrate của CI đặt `test`. Chạy ngoài image (VM,
`node dist/main.js`, buildpack) thì phải tự đặt `production`. `pnpm db:seed`, `admin:grant` và `admin:revoke` đọc cấu
hình như vai `migrate` nên cũng cần `NODE_ENV`: `.env` local tạo từ `.env.example` đã có sẵn, trong image là
`production`, chạy CLI ở nơi khác thì phải tự đặt.

**Không chép `NODE_ENV=development` của `.env.example` lên môi trường thật** (env file, secret store): biến đặt lúc chạy
đè `production` của image, và mọi luật dưới đây tắt mà không có lỗi nào. Để dễ phát hiện (Story 4.7-f): khi `NODE_ENV`
khác `production` mà `API_PUBLIC_URL` hoặc `WEB_ORIGIN` là `https:` trên host không phải local (`localhost`,
`*.localhost`, `127.0.0.0/8`, `::1`), vai `api` và `worker` vẫn khởi động nhưng log `warn` có marker
`node_env_not_production` kèm `variables` (tên biến, không có giá trị). Thấy dòng này trên staging hay production thì sửa
`NODE_ENV` về `production`.

Khi `NODE_ENV=production`, api và worker kiểm thêm các luật dưới đây lúc khởi động; mỗi vai chỉ kiểm biến nó đọc. Vi
phạm thì tiến trình thoát mã 1 với một `ConfigError` nêu mọi biến vi phạm trong một lượt, mỗi biến một lý do, không bao
giờ nêu giá trị.

| Luật | Biến | Lý do trong log |
| ---- | ---- | --------------- |
| https | `API_PUBLIC_URL`, `WEB_ORIGIN`, `TINGEE_BASE_URL`, `S3_ENDPOINT`, `S3_PUBLIC_BASE_URL`. `OTEL_EXPORTER_OTLP_ENDPOINT` không kiểm (collector nội bộ có thể dùng http) | `phải là https khi NODE_ENV=production` |
| Không dùng giá trị mẫu của `.env.example` | `BETTER_AUTH_SECRET`, `REVALIDATE_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`: đúng giá trị mẫu. `TINGEE_CREDENTIAL_KEYS`, `TICKET_QR_KEYS`: mọi khóa trùng byte với một trong hai khóa mẫu, bất kể số phiên bản `v<k>` | `là giá trị mẫu của .env.example; môi trường thật phải sinh giá trị riêng` |
| Dải IP Quản trị Tingee (Story 4.7-a) | `ADMIN_ALLOWED_CIDRS` | `thiếu` |
| Cookie dùng chung web và api | `AUTH_COOKIE_DOMAIN`, khi host của `API_PUBLIC_URL` khác host của `WEB_ORIGIN`: SSR của web chuyển tiếp cookie của web sang api (`apps/web/lib/api/server.ts`) | `thiếu` |

Hai luật áp ở mọi môi trường, cả local:

- `TICKET_QR_KEYS` không được có khóa trùng byte với một khóa của `TINGEE_CREDENTIAL_KEYS`, bất kể số phiên bản. Lỗi:
  `TICKET_QR_KEYS (dùng chung khóa với TINGEE_CREDENTIAL_KEYS)`.
- `AUTH_COOKIE_DOMAIN`, nếu đặt, phải là miền cha của host `API_PUBLIC_URL` và host `WEB_ORIGIN`: so không phân biệt hoa
  thường, bỏ dấu `.` đầu; host phải bằng miền này hoặc kết thúc bằng `.<miền>`. Vd. `tickee.vn` (hay `.Tickee.VN`) nhận
  `https://api.tickee.vn` và `https://tickee.vn`. Không kiểm danh sách hậu tố công khai. Lỗi:
  `AUTH_COOKIE_DOMAIN (phải là miền cha của host API_PUBLIC_URL và WEB_ORIGIN)`.

Một luật chỉ chạy khi các biến nó dùng (kể cả `NODE_ENV`) không có lỗi khác, nên một biến không bị báo hai lần. Vì vậy
`API_PUBLIC_URL` còn là `http://` thì luật cookie chỉ báo ở lần khởi động sau khi đã sửa. `DATABASE_URL`,
`MIGRATION_DATABASE_URL` và `SMTP_URL` không bị kiểm giá trị mẫu.

Image không có `.env.example`, nên giá trị mẫu nằm trong `apps/api/src/platform/config/production-rules.ts`. Sửa giá trị
mẫu trong `.env.example` thì sửa cả file này: `apps/api/test/config.test.ts` đọc `.env.example` và đỏ nếu hai nơi lệch.
Mỗi môi trường sinh secret và khóa riêng bằng `openssl rand -base64 32` (khóa viết dạng `v1:<kết quả>`; sinh
`TINGEE_CREDENTIAL_KEYS` và `TICKET_QR_KEYS` riêng).

### Web chạy thật

`next build` và `next start` luôn đặt `NODE_ENV=production`, kể cả trong e2e, nên web không dựa vào biến này. Web nhận
biết "bản chạy thật" theo host (Story 4.7-f, luật ở `apps/web/lib/production-env.ts`): `NEXT_PUBLIC_API_BASE_URL` (giá
trị nhúng lúc build) hoặc `WEB_ORIGIN` có host không phải local. Host local là `localhost`, `*.localhost`, `127.0.0.0/8`,
`::1`; mọi host khác là host thật, kể cả `*.test`. Tính cả `WEB_ORIGIN` để bản build local bị đem đi chạy thật vẫn bị kiểm.

| Lúc | Luật | Lỗi |
| --- | ---- | --- |
| `next build` (`apps/web/lib/build-env.ts`) | `NEXT_PUBLIC_API_BASE_URL` có host thật thì phải là `https:` | `NEXT_PUBLIC_API_BASE_URL (phải là https khi host không phải local)`, build dừng |
| Server khởi động, web chạy thật (`register()` của `apps/web/instrumentation.ts`: `next start` và server standalone) | `WEB_ORIGIN` bắt buộc và phải là `https:`: thiếu thì `metadataBase` của `/e/{slug}` rơi về localhost, preview Zalo/Facebook mất ảnh | `WEB_ORIGIN (thiếu)`, `WEB_ORIGIN (phải là https)` |
| như trên | `REVALIDATE_SECRET` bắt buộc, ≥ 32 ký tự như worker, khác giá trị mẫu của `.env.example` (so sau khi bỏ khoảng trắng hai đầu) | `REVALIDATE_SECRET (thiếu)`, `(ngắn hơn 32 ký tự)`, `(là giá trị mẫu của .env.example; …)` |
| `POST /api/revalidate`, web chạy thật | `REVALIDATE_SECRET` vi phạm luật trên | `503`, như khi thiếu biến |

Vi phạm lúc khởi động thì server in một thông báo nêu mọi biến vi phạm, mỗi biến một lý do, không bao giờ nêu giá trị,
rồi thoát mã 1. Kiểm ở `instrumentation.ts` chứ không ở `next.config.ts`, vì server standalone dùng config đã serialize
lúc build. Server dev (`next dev`, `pnpm dev`: Next đặt `NODE_ENV=development`) không bao giờ bị kiểm, kể cả khi
`apps/web/.env.local` trỏ host thật; `pnpm test:e2e`, `pnpm test:e2e:fullstack` và CI chạy mọi origin ở localhost nên
cũng không. Khi đó hành vi như cũ, route nhận mọi secret khác rỗng. `apps/web/test/start.process.test.ts` chạy
`next start` thật trên bản build có sẵn để giữ các luật này. Giá trị mẫu nằm trong `apps/web/lib/production-env.ts` (web không import
code của api); `apps/web/test/production-env.test.ts` đọc `.env.example` và đỏ nếu hai nơi lệch. Font OG trong image web
kiểm ở Story 9.1, lúc dựng image.

### Vai `migrate` không chạy song song

Vai `migrate` giữ khóa advisory `tickee:migrate` của database suốt cả lượt chạy: migration Drizzle, schema `pgboss`,
rồi cấp quyền (Story 4.7-e). Khóa nằm trên một kết nối riêng có `application_name` `tickee-migrate-lock`.

- **Chạy chồng:** lượt migrate thứ hai trên cùng database (pipeline chạy lại, hai lượt deploy chồng nhau) log `info`
  marker `migrate_lock_wait` rồi chờ lượt đầu xong mới chạy. Hai lượt cùng phiên bản thì lượt sau không đổi gì. Khóa chỉ
  xếp hàng các lượt chạy, không sắp thứ tự deploy. Pipeline vẫn phải chặn deploy chồng nhau giữa hai phiên bản, nếu
  không bản cũ có thể chạy sau bản mới.
- **Thời gian chờ:** code không giới hạn, và `statement_timeout`/`lock_timeout` đặt theo role cũng không cắt lượt chờ.
  Job migrate trên nền tảng deploy cần có timeout.
- **Kết nối:** `MIGRATION_DATABASE_URL` phải là kết nối thẳng hoặc qua pooler chế độ session. Qua pooler chế độ
  transaction thì khóa cấp session không giữ được, và lượt migrate thoát mã 1.
- **Lượt giữ khóa chết:** Postgres nhả khóa khi kết nối đóng. Máy chạy migrate mất mạng mà không kịp đóng kết nối thì
  keepalive của kết nối giữ khóa phát hiện trong khoảng một phút.
- **Mất kết nối giữa chừng:** lượt đó log `error` marker `migrate_lock_lost` ngay khi mất, và thoát mã 1 khi chạy xong.
  Từ lúc mất, một lượt khác có thể đã chạy chồng. Chạy lại vai `migrate`.

Xem ai giữ khóa (`granted = true`) và ai đang chờ:

```sql
SELECT a.pid, l.granted, a.backend_start, a.state
FROM pg_stat_activity a JOIN pg_locks l ON l.pid = a.pid AND l.locktype = 'advisory'
WHERE a.application_name = 'tickee-migrate-lock' AND a.datname = current_database();
```

Lượt giữ khóa đã chết mà backend vẫn còn thì chạy `SELECT pg_terminate_backend(<pid>)` bằng `tickee_migrator`.

### Xoay khóa Mã QR vé

Vé lưu phiên bản khóa đã ký (`tickets.qr_key_version`), không lưu Mã QR; token link chia sẻ cũng suy ra từ khóa đó. Một
instance thiếu khóa của Vé còn dùng thì trên instance đó Trang Đơn và Chi tiết Vé trả 500, link chia sẻ trả 404, email Vé
vào dead-letter, check-in (`verifyTicketQr`, Epic 5) từ chối Mã QR của các Vé đó. Vé còn dùng là Vé `valid` của Sự kiện
chưa hủy và chưa quá `effective_end_at`.

1. Thêm khóa mới (`v<k+1>`) vào `TICKET_QR_KEYS` của **mọi** instance api và worker trước, giữ nguyên khóa cũ. Instance
   ký Vé mới bằng khóa có `k` lớn nhất, nên khi đang deploy dần, instance chưa có khóa mới không đọc được Vé vừa ký ở
   instance đã có. Instance cũ đang chạy đã kiểm lúc nó khởi động, trước khi có Vé ký bằng khóa mới, nên không báo:
   trong lúc deploy chỉ cảnh báo của link chia sẻ trả 404 phát hiện được. Lần kiểm lúc khởi động chỉ bắt instance khởi
   động sau khi đã có Vé ký bằng khóa mới (rollback, thêm instance, khởi động lại), với `qrKeyVersion` lớn hơn
   `currentVersion`.
2. Chỉ gỡ khóa cũ khi lần khởi động của mọi instance không còn báo, và câu SQL dưới đây không còn Vé nào dùng phiên bản
   cũ. Gỡ xong mà lần khởi động báo phiên bản cũ (`qrKeyVersion` nhỏ hơn `currentVersion`) thì thêm lại khóa đó.

Mỗi lần vai `api` hoặc `worker` khởi động (Story 4.7-g; vai `migrate` không kiểm), instance so phiên bản khóa của Vé còn
dùng với `TICKET_QR_KEYS` của nó. Thiếu phiên bản nào thì log `error` có marker `alert: 'ticket_qr_key_missing'`,
`qrKeyVersion` (phiên bản của Vé), `currentVersion` (phiên bản lớn nhất của instance) và `tickets` (số Vé bị ảnh
hưởng), rồi báo kênh cảnh báo vận hành. `qrKeyVersion` nhỏ hơn `currentVersion` là khóa cũ đã bị gỡ; lớn hơn là
instance chưa có khóa mới. Instance vẫn khởi động và chạy bình thường (Checkout, IPN, check-in, rollback vẫn lên được):
thêm lại khóa còn thiếu rồi khởi động lại. Mỗi câu truy vấn của lần kiểm tối đa 30 giây; truy vấn lỗi (DB lỗi, câu quá
30 giây) thì chỉ log `warn`. Lần kiểm chạy nền; tắt (SIGTERM) chờ nó tối đa 5 giây, quá thì log `warn` rồi tắt tiếp.

Tra phiên bản khóa còn dùng (cùng điều kiện với lần kiểm lúc khởi động):

```sql
SELECT t.qr_key_version, count(*) AS tickets
FROM tickets t JOIN events e ON e.id = t.event_id
WHERE t.status = 'valid' AND e.status <> 'cancelled' AND now() <= e.effective_end_at
GROUP BY 1 ORDER BY 1;
```

Không ký lại Vé sang khóa mới bằng `UPDATE tickets SET qr_key_version = …`: token link chia sẻ đổi theo nên mọi link đã
gửi trả 404. Phương án xoay khóa cho môi trường thật (giữ khóa cũ tới khi Vé hết hạn, công cụ ký lại kèm gửi lại email
Vé, hay tách khóa link chia sẻ) chốt ở runbook của Story 9.1.

## Kiểm tra

```sh
pnpm typecheck                     # build + typecheck mọi package
pnpm turbo lint:deps               # dependency-cruiser: ranh giới mô-đun (AD-10)
pnpm test                          # build trước rồi chạy Vitest của mọi package
pnpm turbo test --filter @tickee/api   # chỉ api: Vitest với Postgres thật (DB tickee_test, tự chạy migration; email OTP qua transport giả)
docker build -f apps/api/Dockerfile -t tickee-api:dev .
pnpm --filter @tickee/contracts test   # Vitest: formatVnd

# Playwright (WebKit giả lập iPhone, Chromium giả lập Android, 375×667) — chạy trên bản build sẵn.
pnpm --filter @tickee/web exec playwright install chromium webkit   # lần đầu
pnpm test:e2e                      # build web rồi chạy Playwright
# Đã có bản build từ `pnpm typecheck` hoặc `pnpm test` thì chạy thẳng:
pnpm --filter @tickee/web test:e2e  # tự chạy next start ở cổng 3100 (TICKEE_UI_KIT=1) và 3101 (tắt)

# Playwright full-stack: api, worker, Tingee fake, Mailpit thật (xem "Playwright full-stack" dưới đây).
docker compose up -d postgres mailpit   # lần đầu; tắt `pnpm dev` trước khi chạy
pnpm test:e2e:fullstack            # build api + web rồi chạy
pnpm --filter @tickee/web test:e2e:fullstack   # đã có bản build: chạy thẳng
```

### Playwright full-stack

Bộ `apps/web/e2e-fullstack/` (config `apps/web/playwright.fullstack.config.ts`, Story 4.7-c) không giả lập gì: web chạy
`next start` ở `localhost:3000`, api ở `localhost:3001`, kèm worker, Tingee fake và Mailpit. Hai luồng, mỗi luồng chạy
trên `ios-webkit` và `android-chromium`: đăng nhập OTP (`/tickets` → mã từ Mailpit → "Đồng ý" → về `returnTo`, tải lại,
đăng xuất), và Đơn có phí (Mua → đăng nhập → Gửi Đơn → trả trên trang của Tingee fake ở tab thứ hai → tab đầu tự sang
Thành công qua SSE trong ≤ 3 giây → email Vé). Sự kiện của test do BTC demo tạo và mở bán qua API thật lúc bắt đầu.

- Điều kiện: `docker compose up -d postgres mailpit` (thiếu dịch vụ nào thì dừng trước khi chạy test và nêu tên dịch
  vụ đó), và **tắt `pnpm dev`**: bộ này không dùng lại server đang chạy, cổng 3000, 3001 hay 4010 bận thì báo lỗi.
- Không cần `.env` hay bước tay nào: env lấy từ `.env.example`, chỉ đè `NODE_ENV=test` và URL DB.
- DB riêng `tickee_e2e`: mỗi lượt xóa và tạo lại bằng superuser Postgres (mặc định `postgres:postgres@localhost:5432`,
  như `docker-compose.yml` và CI), rồi migrate và `db:seed`. `E2E_POSTGRES_SUPERUSER_URL` chỉ để đổi user/mật khẩu của
  superuser và phải trỏ cùng server `localhost:5432`: migrate, api và worker luôn dùng host và cổng của `.env.example`.
  Không đụng DB `tickee` hay `tickee_test`. Mailpit giữ thư của các lượt trước; test chỉ đọc thư mới đến.
- Kết quả, trace và log của api, worker, Tingee fake, seed: `apps/web/test-results-fullstack/` (log ở `stack-logs/`). CI
  upload thư mục này khi test lỗi.
- Chỉ dựng stack (không web, không test) để thử bằng tay: `pnpm --filter @tickee/api e2e:stack` (cần `apps/api/dist`;
  log ở `apps/api/test-results/e2e-stack/`, Ctrl+C để tắt).

### Biến build của web

`NEXT_PUBLIC_API_BASE_URL` được nhúng vào bản build web. Các lệnh dev ở gốc repo (`pnpm typecheck`, `pnpm test`,
`pnpm test:e2e`, `pnpm test:e2e:fullstack`) chạy turbo qua `scripts/dev-env.sh`, script này đặt `http://localhost:3001`
khi shell chưa có biến. Bộ e2e giả lập API bằng `page.route` nên nhận mọi giá trị; bộ full-stack gọi api thật nên bản build
phải dùng đúng `http://localhost:3001`. Turbo băm giá trị biến (và các file `apps/web/.env.production.local`,
`.env.local`, `.env.production`, `.env` nếu có) vào hash của build web, nên cache không trả lại bản build thiếu biến.

Build để deploy (`pnpm build`, `pnpm turbo build`) không đi qua script trên: phải tự đặt biến, vd.
`NEXT_PUBLIC_API_BASE_URL=https://api.tickee.vn pnpm turbo build --filter @tickee/web`. Thiếu biến, hoặc biến trỏ host
không phải local mà không phải `https:` (Story 4.7-f), thì `next build` dừng ngay và nêu tên biến kèm lý do, không nêu
giá trị (`apps/web/lib/build-env.ts`), không ra bản build nào để turbo cache. `next typegen` không bị kiểm. Bản build trỏ
host thật là bản "chạy thật": `next start` còn đòi `WEB_ORIGIN` và `REVALIDATE_SECRET` hợp lệ (xem "Web chạy thật").

### Dọn `.turbo`

Cache local của turbo dùng chung giữa các git worktree, nằm ở `.turbo/cache` của checkout chính. `turbo.json` đặt trần:
đầu mỗi lần `turbo run`, entry cũ hơn 7 ngày bị xóa (`cacheMaxAge`), rồi entry cũ nhất bị xóa tới khi tổng ≤ 2 GB
(`cacheMaxSize`). Build web không đưa `.next/cache` và `.next/dev` (thư mục của `next dev`) vào cache. Muốn dọn ngay:
`rm -rf .turbo/cache` ở checkout chính; lần chạy sau chỉ build lại.

Biến môi trường được kiểm bằng Zod theo vai khi khởi động; thiếu/sai thì dừng với mã ≠ 0 và chỉ nêu tên biến.

| Biến                     | Vai         | Ghi chú                        |
| ------------------------ | ----------- | ------------------------------ |
| `APP_ROLE`               | tất cả      | `api` \| `worker` \| `migrate` |
| `NODE_ENV`               | tất cả      | bắt buộc, không có mặc định: `development` \| `test` \| `production`. Image đặt `production` (cả staging); `.env.example` đặt `development` (xem "Cấu hình staging/production") |
| `LOG_LEVEL`              | tất cả      | mặc định `info`                |
| `DATABASE_URL`           | api, worker | role `tickee_app` (DML)        |
| `MIGRATION_DATABASE_URL` | migrate     | role `tickee_migrator` (DDL); cả `pnpm db:seed`, `admin:grant`/`admin:revoke` |
| `PORT`                   | api         | mặc định `3001`                |
| `TRUST_PROXY_HOPS`       | api         | mặc định `0`; số proxy tin cậy trước api (vd. `1` sau load balancer) để `req.ip` là IP thật. Phải bằng **đúng** số proxy trước api: thấp hơn thì mọi người dùng chung giới hạn 20 OTP/giờ theo IP của LB và giới hạn IP của `/v1/admin/*` so IP của LB; **cao hơn** thì mục `X-Forwarded-For` do client tự gửi thành `req.ip`, ai cũng tự nhận được IP trong `ADMIN_ALLOWED_CIDRS` |
| `ADMIN_ALLOWED_CIDRS`    | api         | bắt buộc khi `NODE_ENV=production` (cả staging; thiếu hoặc sai thì api không khởi động); dải IP được gọi `/v1/admin/*`: CIDR IPv4/IPv6 cách nhau bằng dấu phẩy (`203.0.113.0/24,2001:db8::/32`; IP trần = `/32`/`/128`; không nhận `/0` hay dải IPv6 chồng lên `::ffff:0:0/96`). Có biến thì api log `info` số dải lúc khởi động; development/test để trống = không giới hạn, api log `warn`. Không bao giờ thêm dải nội bộ của LB/VPC (xem "Quản trị Tingee") |
| `BETTER_AUTH_SECRET`     | api         | ≥ 32 ký tự; ký session/cookie và khóa gốc HMAC bộ đếm OTP |
| `API_PUBLIC_URL`         | api         | origin công khai của api; Better Auth ở `/v1/auth`, URL IPN của BTC ở `/v1/payments/tingee/ipn/{ipnKey}`. Tingee fake (local) cũng đọc để biết URL IPN của BTC demo |
| `WEB_ORIGIN`             | api, worker, web | api: origin duy nhất được CORS kèm cookie; worker: gốc link trong email (lời mời Admin `<WEB_ORIGIN>/loi-moi-btc#…`) và nơi gọi `<WEB_ORIGIN>/api/revalidate`; web: server-only, `metadataBase` cho `og:image` của `/e/{slug}`, bắt buộc và phải `https` khi web chạy thật (xem "Web chạy thật") |
| `REVALIDATE_SECRET`      | worker, web | worker: bắt buộc, ≥ 32 ký tự; gửi `Authorization: Bearer …` tới `<WEB_ORIGIN>/api/revalidate`. web: server-only, cùng giá trị; thiếu thì route trả 503 (trang chỉ tự làm mới sau 30 giây). Web chạy thật thì bắt buộc, ≥ 32 ký tự, khác giá trị mẫu: sai thì server không khởi động và route trả 503. Sinh bằng `openssl rand -base64 32` |
| `AUTH_COOKIE_DOMAIN`     | api         | tùy chọn; tên miền cha cho cookie session (vd. `tickee.vn`). Đặt thì phải là miền cha của host `API_PUBLIC_URL` và `WEB_ORIGIN` (mọi môi trường); bắt buộc ở production khi hai host khác nhau |
| `SMTP_URL`, `EMAIL_FROM` | api, worker | api gửi email OTP/2FA; worker gửi email từ job (lời mời Admin); local là Mailpit `smtp://localhost:1025` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | api | bắt buộc; OAuth client Google, redirect URI `<API_PUBLIC_URL>/v1/auth/callback/google` |
| `TINGEE_BASE_URL`        | api, worker | bắt buộc; origin Tingee Open API (UAT `https://uat-open-api.tingee.vn`). Env không có credential Tingee: mỗi BTC nhập API key của mình ở trang Tài khoản nhận tiền. `.env` local phải là `http://localhost:4010` (Tingee fake mà `pnpm dev` chạy sẵn): trỏ Tingee thật thì key demo lỗi và Đơn có phí báo "Chưa tạo được link thanh toán" (xem "Hai bẫy của `.env` local"). Với Tingee fake: BTC demo của `pnpm db:seed` đã liên kết sẵn, hoặc nhập key merchant demo (`demo-btc-co-tai-khoan` / `demo-secret-co-tai-khoan`: có tài khoản; `demo-btc-chua-lien-ket` / `demo-secret-chua-lien-ket`: chưa liên kết ngân hàng). Worker đọc cùng ba biến Tingee/Vé với api (cùng giá trị): Đối soát bù (Story 4.1) đi cùng đường xử lý IPN và phát Vé |
| `TINGEE_CREDENTIAL_KEYS` | api, worker | bắt buộc; khóa AES-256-GCM mã hóa Secret Token Tingee của BTC: `v<k>:<base64 của 32 byte>`, nhiều khóa cách nhau bằng dấu phẩy, không trùng `k`. Mã hóa bằng khóa có `k` lớn nhất, giải mã theo tiền tố `v<k>:` của ciphertext; xoay khóa thì thêm khóa mới và giữ khóa cũ. **Không bao giờ đổi giá trị của phiên bản đã dùng**: muốn đổi thì thêm `v<k+1>`; đổi giá trị mà giữ `k` thì api không giải mã được Secret Token đã lưu (local: `pnpm db:seed` mã hóa lại key demo, xem "Hai bẫy của `.env` local"). Sinh khóa: `openssl rand -base64 32`. `pnpm db:seed` cũng đọc biến này để mã hóa key demo |
| `TINGEE_ORDER_STATUS_QUERY` | worker   | mặc định tắt; `true` bật Đối soát bù (Story 4.1): worker tra trạng thái đơn Gateway khi IPN trễ hoặc mất, kết quả đi cùng đường xử lý IPN. Tingee chưa công bố API tra đơn: adapter theo hợp đồng tạm mà chỉ Tingee fake hiểu, nên chỉ bật ở local (`.env.example`) và test; staging bật khi đã thay bằng hợp đồng thật. Tắt: job tra xong ngay, không gọi Tingee |
| `S3_ENDPOINT`            | api         | bắt buộc; endpoint S3 mà trình duyệt PUT ảnh Sự kiện tới (URL presign trỏ vào đây). Local: MinIO `http://localhost:9000`. Api chỉ ký URL, không gọi mạng tới storage (Story 4.8-a) |
| `S3_REGION`              | api         | mặc định `us-east-1`; region ký SigV4 |
| `S3_BUCKET`              | api         | bắt buộc; bucket ảnh Sự kiện: đọc ẩn danh từng object (`s3:GetObject`, không liệt kê), CORS `GET`/`PUT` cho origin web. Local: `tickee-event-images` (`minio-init` tạo sẵn) |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | api | bắt buộc; credential ký presigned PUT, chỉ cần quyền `PutObject` trên bucket. Secret: không log, không commit. Local: root user của MinIO trong `docker-compose.yml` |
| `S3_FORCE_PATH_STYLE`    | api         | mặc định `false`; `true` khi storage cần URL `<endpoint>/<bucket>/<key>` (MinIO, `.env.example`) |
| `S3_PUBLIC_BASE_URL`     | api (server web phải tới được) | bắt buộc ở api; gốc URL công khai của ảnh: `imageUrl` = `<S3_PUBLIC_BASE_URL>/<key>`. Local: `http://localhost:9000/tickee-event-images`. Server web không đọc biến này nhưng tự tải `imageUrl` để dựng ảnh OG, nên URL phải mở được từ cả server web lẫn trình duyệt (vd. `localhost:9000` không tới được từ trong container web); không tới được thì ảnh OG dùng nền gradient và server web log `warn` `[og-image]` |
| `TICKET_QR_KEYS`         | api, worker | bắt buộc; khóa HMAC-SHA256 ký Mã QR vé (`t<k>.<ticketId>.<sig>`), cùng dạng `TINGEE_CREDENTIAL_KEYS` nhưng là khóa khác (dùng chung một khóa thì api/worker dừng, ở mọi môi trường). Ký Vé mới bằng khóa có `k` lớn nhất; Vé lưu `k` (không lưu chuỗi QR) nên xoay khóa thì thêm khóa mới và giữ khóa cũ tới khi không còn Vé nào dùng. **Không bao giờ đổi giá trị của phiên bản đã dùng**: muốn đổi thì thêm `v<k+1>`; đổi giá trị mà giữ `k` thì Mã QR đã gửi không còn khớp và link chia sẻ trả 404 (xem "Hai bẫy của `.env` local"). Sinh khóa: `openssl rand -base64 32` |
| `OPS_ALERT_EMAILS`       | worker      | tùy chọn; người nhận email cảnh báo vận hành (Story 4.6-b), email cách nhau bằng dấu phẩy. Không đặt: cảnh báo chỉ ghi log, worker log `warn` lúc khởi động và mỗi lần có cảnh báo (xem "Cảnh báo vận hành") |
| `OPS_ALERT_COOLDOWN_MINUTES` | api, worker | mặc định `30` (1–1440); loại cảnh báo có cooldown (thiếu khóa QR, hàng đợi ùn, IPN lỗi tăng, tạo link chậm, tỉ lệ phát Vé giảm) báo lại cùng đối tượng sau chừng này phút |
| `OPS_ALERT_QUEUE_WAIT_MINUTES` | worker  | mặc định `5` (1–1440); job pg-boss tới hạn quá chừng này phút mà chưa chạy thì báo hàng đợi ùn |
| `OPS_ALERT_IPN_FAILURES` | api         | mặc định `5` (số nguyên ≥ 1); số IPN lỗi (401, 400 body hỏng, 5xx) trong 5 phút ở một instance api để báo `ipn_failures` |
| `OPS_ALERT_LINK_P95_MS`  | api         | mặc định `2000` (số nguyên ≥ 1); p95 thời gian `create-link` trong 5 phút ở một instance api phải vượt chừng này ms để báo `payment_link_slow` |
| `OPS_ALERT_LINK_MIN_SAMPLES` | api     | mặc định `20` (số nguyên ≥ 1); `payment_link_slow` chỉ xét khi có từ chừng này lần gọi `create-link` trong 5 phút |
| `OPS_ALERT_ISSUANCE_MIN_ORDERS` | worker | mặc định `10` (số nguyên ≥ 1); `ticket_issuance_drop` chỉ xét khi khung 75 → 15 phút trước có từ chừng này Đơn có lượt tạo link |
| `OPS_ALERT_ISSUANCE_RATIO` | worker    | mặc định `0.5` (số trong (0, 1]); báo `ticket_issuance_drop` khi tỉ lệ Đơn đã được trả tiền dưới chừng này lần tỉ lệ của cùng khung 7 ngày trước |
| `NEXT_PUBLIC_API_BASE_URL` | web       | gốc REST của api; client thêm `/v1`; nhúng lúc build. `next build` dừng khi thiếu biến, hoặc khi biến trỏ host không phải local mà không phải `https`; lệnh dev ở gốc tự đặt `http://localhost:3001` (xem "Biến build của web", "Web chạy thật") |
| `TICKEE_UI_KIT`          | web         | `1` bật `/ui-kit`; production không đặt (404) |

Nếu volume Postgres đã tồn tại từ trước khi có `docker/postgres/init.sql`, chạy `docker compose down -v` để khởi tạo lại.

## Quy trình PR

- Mọi thay đổi vào `main` đi qua PR; không push thẳng `main`. Bảo vệ nhánh `main`:
  - bắt buộc qua PR (không bắt buộc số người duyệt) và bắt buộc check `ci` xanh;
  - `strict` tắt: `ci` xanh trên base cũ vẫn đủ điều kiện merge, nên nhánh đã tụt xa `main` thì tự merge `main` vào rồi
    chờ `ci` chạy lại;
  - `enforce_admins` tắt: Owner/admin không bị chặn. `git push` thẳng lên `main` vẫn thành công, chỉ kèm thông báo
    "bypassed rule violations"; merge PR khi `ci` đỏ thì phải tick ô bypass.
- Mô tả PR theo `.github/pull_request_template.md`: Tóm tắt, Spec, Kiểm tra.
- `sprint-status.yaml` cập nhật ngay trong PR của story: Build (`bmad-build`, override ở
  `_bmad/custom/bmad-build.toml`) đặt story `done`, hoặc action item `done` kèm `note` trỏ spec, bằng một commit riêng
  trên nhánh của story. Không sửa tay sprint-status trên `main`.
- Trạng thái epic và retrospective trong sprint-status cũng chỉ đổi trong một PR (vd. PR của retro), không bao giờ sửa
  tay trên `main`.
- Không merge khi `ci` đỏ. Ngoại lệ (vd. test chập chờn đã ghi ở `deferred-work.md`) thì ghi lý do và link run CI đỏ vào
  PR trước khi merge.
