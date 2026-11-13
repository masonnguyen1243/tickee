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
lực ngay ở request kế tiếp. Chưa có giới hạn IP `ADMIN_ALLOWED_CIDRS` (phải xong trước khi mở `/admin` trên môi trường
thật, xem `deferred-work.md`).

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
```

### Biến build của web

`NEXT_PUBLIC_API_BASE_URL` được nhúng vào bản build web. Các lệnh dev ở gốc repo (`pnpm typecheck`, `pnpm test`,
`pnpm test:e2e`) chạy turbo qua `scripts/dev-env.sh`, script này đặt `http://localhost:3001` khi shell chưa có biến (e2e
giả lập API bằng `page.route` nên giá trị nào cũng được). Turbo băm giá trị biến (và các file `apps/web/.env.production.local`,
`.env.local`, `.env.production`, `.env` nếu có) vào hash của build web, nên cache không trả lại bản build thiếu biến.

Build để deploy (`pnpm build`, `pnpm turbo build`) không đi qua script trên: phải tự đặt biến, vd.
`NEXT_PUBLIC_API_BASE_URL=https://api.tickee.vn pnpm turbo build --filter @tickee/web`. Thiếu biến thì `next build` dừng
ngay và nêu tên biến (`apps/web/lib/build-env.ts`), không ra bản build nào để turbo cache. `next typegen` không bị kiểm.

### Dọn `.turbo`

Cache local của turbo dùng chung giữa các git worktree, nằm ở `.turbo/cache` của checkout chính. `turbo.json` đặt trần:
đầu mỗi lần `turbo run`, entry cũ hơn 7 ngày bị xóa (`cacheMaxAge`), rồi entry cũ nhất bị xóa tới khi tổng ≤ 2 GB
(`cacheMaxSize`). Build web không đưa `.next/cache` và `.next/dev` (thư mục của `next dev`) vào cache. Muốn dọn ngay:
`rm -rf .turbo/cache` ở checkout chính; lần chạy sau chỉ build lại.

Biến môi trường được kiểm bằng Zod theo vai khi khởi động; thiếu/sai thì dừng với mã ≠ 0 và chỉ nêu tên biến.

| Biến                     | Vai         | Ghi chú                        |
| ------------------------ | ----------- | ------------------------------ |
| `APP_ROLE`               | tất cả      | `api` \| `worker` \| `migrate` |
| `NODE_ENV`, `LOG_LEVEL`  | tất cả      | mặc định `development`, `info` |
| `DATABASE_URL`           | api, worker | role `tickee_app` (DML)        |
| `MIGRATION_DATABASE_URL` | migrate     | role `tickee_migrator` (DDL); cả `pnpm db:seed`, `admin:grant`/`admin:revoke` |
| `PORT`                   | api         | mặc định `3001`                |
| `TRUST_PROXY_HOPS`       | api         | mặc định `0`; số proxy tin cậy trước api (vd. `1` sau load balancer) để `req.ip` là IP thật — bắt buộc đặt khi có LB, nếu không mọi người dùng chung giới hạn 20 OTP/giờ theo IP của LB |
| `BETTER_AUTH_SECRET`     | api         | ≥ 32 ký tự; ký session/cookie và khóa gốc HMAC bộ đếm OTP |
| `API_PUBLIC_URL`         | api         | origin công khai của api; Better Auth ở `/v1/auth`, URL IPN của BTC ở `/v1/payments/tingee/ipn/{ipnKey}`. Tingee fake (local) cũng đọc để biết URL IPN của BTC demo |
| `WEB_ORIGIN`             | api, worker | api: origin duy nhất được CORS kèm cookie; worker: gốc link trong email (lời mời Admin `<WEB_ORIGIN>/loi-moi-btc#…`) và nơi gọi `<WEB_ORIGIN>/api/revalidate` |
| `REVALIDATE_SECRET`      | worker, web | worker: bắt buộc, ≥ 32 ký tự; gửi `Authorization: Bearer …` tới `<WEB_ORIGIN>/api/revalidate`. web: server-only, cùng giá trị; thiếu thì route trả 503 (trang chỉ tự làm mới sau 30 giây). Sinh bằng `openssl rand -base64 32` |
| `AUTH_COOKIE_DOMAIN`     | api         | tùy chọn; tên miền cha cho cookie session (vd. `tickee.vn`) |
| `SMTP_URL`, `EMAIL_FROM` | api, worker | api gửi email OTP/2FA; worker gửi email từ job (lời mời Admin); local là Mailpit `smtp://localhost:1025` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | api | bắt buộc; OAuth client Google, redirect URI `<API_PUBLIC_URL>/v1/auth/callback/google` |
| `TINGEE_BASE_URL`        | api, worker | bắt buộc; origin Tingee Open API (UAT `https://uat-open-api.tingee.vn`). Env không có credential Tingee: mỗi BTC nhập API key của mình ở trang Tài khoản nhận tiền. `.env` local phải là `http://localhost:4010` (Tingee fake mà `pnpm dev` chạy sẵn): trỏ Tingee thật thì key demo lỗi và Đơn có phí báo "Chưa tạo được link thanh toán" (xem "Hai bẫy của `.env` local"). Với Tingee fake: BTC demo của `pnpm db:seed` đã liên kết sẵn, hoặc nhập key merchant demo (`demo-btc-co-tai-khoan` / `demo-secret-co-tai-khoan`: có tài khoản; `demo-btc-chua-lien-ket` / `demo-secret-chua-lien-ket`: chưa liên kết ngân hàng). Worker đọc cùng ba biến Tingee/Vé với api (cùng giá trị): Đối soát bù (Story 4.1) đi cùng đường xử lý IPN và phát Vé |
| `TINGEE_CREDENTIAL_KEYS` | api, worker | bắt buộc; khóa AES-256-GCM mã hóa Secret Token Tingee của BTC: `v<k>:<base64 của 32 byte>`, nhiều khóa cách nhau bằng dấu phẩy, không trùng `k`. Mã hóa bằng khóa có `k` lớn nhất, giải mã theo tiền tố `v<k>:` của ciphertext; xoay khóa thì thêm khóa mới và giữ khóa cũ. **Không bao giờ đổi giá trị của phiên bản đã dùng**: muốn đổi thì thêm `v<k+1>`; đổi giá trị mà giữ `k` thì api không giải mã được Secret Token đã lưu (local: `pnpm db:seed` mã hóa lại key demo, xem "Hai bẫy của `.env` local"). Sinh khóa: `openssl rand -base64 32`. `pnpm db:seed` cũng đọc biến này để mã hóa key demo |
| `TINGEE_ORDER_STATUS_QUERY` | worker   | mặc định tắt; `true` bật Đối soát bù (Story 4.1): worker tra trạng thái đơn Gateway khi IPN trễ hoặc mất, kết quả đi cùng đường xử lý IPN. Tingee chưa công bố API tra đơn: adapter theo hợp đồng tạm mà chỉ Tingee fake hiểu, nên chỉ bật ở local (`.env.example`) và test; staging bật khi đã thay bằng hợp đồng thật. Tắt: job tra xong ngay, không gọi Tingee |
| `TICKET_QR_KEYS`         | api, worker | bắt buộc; khóa HMAC-SHA256 ký Mã QR vé (`t<k>.<ticketId>.<sig>`), cùng dạng `TINGEE_CREDENTIAL_KEYS` nhưng là khóa khác. Ký Vé mới bằng khóa có `k` lớn nhất; Vé lưu `k` (không lưu chuỗi QR) nên xoay khóa thì thêm khóa mới và giữ khóa cũ tới khi không còn Vé nào dùng. **Không bao giờ đổi giá trị của phiên bản đã dùng**: muốn đổi thì thêm `v<k+1>`; đổi giá trị mà giữ `k` thì Mã QR đã gửi không còn khớp và link chia sẻ trả 404 (xem "Hai bẫy của `.env` local"). Sinh khóa: `openssl rand -base64 32` |
| `NEXT_PUBLIC_API_BASE_URL` | web       | gốc REST của api; client thêm `/v1`; nhúng lúc build. `next build` thiếu biến thì dừng; lệnh dev ở gốc tự đặt `http://localhost:3001` (xem "Biến build của web") |
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
