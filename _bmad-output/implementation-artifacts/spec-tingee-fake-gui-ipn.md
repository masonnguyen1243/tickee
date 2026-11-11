---
title: 'Tingee fake gửi IPN tới api local'
type: 'chore'
created: '2026-11-11'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'f7ba13fe67eb299d34097ddf862e70a33a9e8a1a'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Tingee fake chưa gửi IPN, nên ở local (`pnpm dev`) Đơn có phí dừng ở `pending`: không thử được luồng Checkout → trang thanh toán → Trang Đơn "Thành công" (follow-up triage #13 của review Story 3.5).

**Approach:** Trang thanh toán giả của fake có nút "Đã thanh toán (giả lập)", "Hết hạn", "Hủy"; bấm thì fake ký IPN bằng Secret Token của merchant tạo link và POST tới "Đường dẫn IPN" của merchant (như ô cùng tên trên portal Tingee), rồi đưa trình duyệt về `returnUrl`. BTC demo của `pnpm db:seed` có `ipnKey` cố định khai báo trong `demo-merchants.ts` (như VA cố định), nên fake biết sẵn URL IPN `{API_PUBLIC_URL}/v1/payments/tingee/ipn/{ipnKey}`; BTC khác thì dán URL IPN vào ô trên trang giả.

## Boundaries & Constraints

**Always:** IPN như Tingee: `paidAmount` = `amount` của link, `providerTransactionCode` và `requestId` mới mỗi lần, `paidAt` ISO `…Z`, `x-request-timestamp` `yyyyMMddHHmmssSSS` UTC+7, `x-signature` = HMAC-SHA512 hex của `timestamp:rawBody` (dùng lại `signIpn`/`fakeIpnPayload`); body gửi nguyên chuỗi đã ký. Một merchant một URL IPN (như Tingee). Không log hay hiện secret/chữ ký.

**Never:** Sửa `apps/api/src`. Fake đọc DB. Thêm biến môi trường mới. Gửi IPN khi đầu vào sai.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Thanh toán | POST form `status=success`, URL IPN hợp lệ, api trả 2xx | IPN `success` đã ký tới URL; lưu URL vào merchant; 303 về `returnUrl` (không có thì trang kết quả) | N/A |
| Hết hạn/Hủy | `status=expired` / `canceled` | IPN trạng thái: `statusCode` `01`, `paidAmount`/`providerTransactionCode`/`paidAt`/`paymentMethod` = null; 303 về `returnUrl` | N/A |
| api từ chối | api trả ≠ 2xx (401, 404…) | Không chuyển trang | 502, trang hiện HTTP status + body api và lại form |
| Không tới được | URL IPN không nghe / quá 10 giây | Không chuyển trang | 502, trang nêu lỗi mạng/timeout |
| Đầu vào sai | URL rỗng/không phải http(s), `status` lạ | Không gửi gì | 400, lại form |
| Link lạ | `orderId` fake chưa tạo link | — | 404 |
| Seed | `SEED_IPN_KEY` chưa BTC nào giữ | BTC demo (mới, hoặc cũ có khóa ngẫu nhiên) nhận `SEED_IPN_KEY` | BTC khác đang giữ: BTC demo mới nhận khóa ngẫu nhiên, BTC cũ giữ nguyên |

</frozen-after-approval>

## Code Map

- `apps/api/test/tingee-fake/server.ts` -- `startTingeeFake`: `links` (map `orderId` → `FakeLink`), `checkoutPage`, router (`GET /checkout/:orderId` xử lý trước phần kiểm header API); `fakeIpnPayload`, `signIpn` dùng lại.
- `apps/api/test/tingee-fake/demo-merchants.ts` -- mẫu dữ liệu dùng chung seed ↔ fake (`SEED_MERCHANT`, `SEED_PAYOUT_ACCOUNT`).
- `apps/api/test/tingee-fake/main.ts` -- chạy bằng `node --env-file-if-exists=../../.env`, đọc được `API_PUBLIC_URL`.
- `apps/api/test/dev-seed/seed.ts` -- `seedDevData`: insert org kèm `newIpnKey()`, rồi update `tingeeIpnKey` khi null; advisory lock tuần tự hóa; `organizations_tingee_ipn_key_key` unique.
- `apps/api/test/dev-seed/seed.test.ts` -- DB test không xóa giữa các lần chạy: test cần `SEED_IPN_KEY` phải tự giải phóng khóa trước.
- `packages/contracts/src/organizer.ts` `tingeeIpnUrl(apiPublicUrl, ipnKey)` -- dựng URL IPN.
- `apps/api/src/modules/payment/ipn-processor.ts` `TingeeIpn` -- schema api chấp nhận; `expired`/`canceled` làm Đơn `pending` hết hạn.
- `apps/api/test/payment/ipn.test.ts`, `ipn-fixtures.ts`, `test/ordering/order-fixtures.ts` -- mẫu harness + fake: `paidReadyOrg`, `ipnKeyOf`, `eventOnSale`, `postOrder`, `orderState`, `expectInvariants`. Harness không nghe cổng (supertest): test fake → api phải `listen(0)` server của `h.app`.
- `apps/web/app/(buyer)/orders/[code]/order-view.tsx` -- Trang Đơn tự poll; không sửa.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/test/tingee-fake/demo-merchants.ts` -- thêm `SEED_IPN_KEY` (22 ký tự base64url, không phải secret) và `ipnKey?` cho merchant có tài khoản -- seed và fake cùng biết URL IPN.
- [x] `apps/api/test/tingee-fake/server.ts` -- `FakeMerchant.ipnUrl?`; `FakeLink` nhớ `clientId`; `fakeStatusIpnPayload`; trang checkout có form (ô URL IPN điền sẵn, ba nút); `POST /checkout/:orderId` theo Matrix; ghi lại các lần gửi (`ipnDeliveries`) cho test; cập nhật comment đầu file.
- [x] `apps/api/test/tingee-fake/main.ts` -- `ipnUrl` của merchant có `ipnKey` = `tingeeIpnUrl(API_PUBLIC_URL ?? http://localhost:3001, ipnKey)`; in ra lúc khởi động.
- [x] `apps/api/test/dev-seed/seed.ts` -- gán `SEED_IPN_KEY` theo Matrix; báo thay đổi.
- [x] `apps/api/test/tingee-fake/checkout-ipn.test.ts` -- fake + server nhận giả: mọi dòng Matrix trừ Seed, kiểm header/chữ ký/body.
- [x] `apps/api/test/payment/ipn-dev-checkout.test.ts` -- fake → api thật: bấm `success` → Đơn `paid` đủ Vé; `expired` → Đơn hết hạn; `expectInvariants`.
- [x] `apps/api/test/dev-seed/seed.test.ts` -- ba dòng Seed của Matrix.
- [x] `README.md`, `.env.example` -- mục chạy local: luồng Đơn có phí với nút trên trang giả, ô URL IPN cho BTC khác.

**Acceptance Criteria:**
- Given `pnpm dev` và `pnpm db:seed` (DB mới hoặc BTC demo seed trước đây), when mua Vé có phí của BTC demo rồi bấm "Đã thanh toán (giả lập)", then trình duyệt về Trang Đơn và Trang Đơn hiện Vé, không cấu hình gì thêm.
- Given đã dán URL IPN của một BTC khác vào ô trên trang giả, when tạo Đơn mới với cùng merchant, then ô điền sẵn URL đó (tới khi fake khởi động lại).

## Implementation Notes

- `SEED_IPN_KEY = 'demo-btc-ipn-key-seedQ'` (22 ký tự base64url, giải mã ra 16 byte). Seed gán khóa này cho BTC demo mới hoặc BTC demo cũ (khóa ngẫu nhiên) khi chưa BTC nào giữ.
- Fake chỉ lưu URL vào merchant sau một lần gửi được api nhận (URL gõ sai không bị nhớ). `ipnTimeoutMs` là tùy chọn chỉ cho test (mặc định 10 giây).
- Test fake → api thật: harness không nghe cổng nên test `listen(0)` adapter của `h.app`.
- Kiểm tay (DB riêng `tickee_dev_ipnfake`, `pnpm dev` + `pnpm db:seed`): BTC demo mở bán Vé 150.000đ, người mua đặt Đơn `TKJVW6GDXF`, bấm "Thanh toán" → trang giả điền sẵn `http://localhost:3001/v1/payments/tingee/ipn/demo-btc-ipn-key-seedQ` → bấm "Đã thanh toán (giả lập)" → về Trang Đơn "Vé của bạn đã sẵn sàng!" kèm QR; DB: Đơn `paid`, `paid_source = ipn`, 1 Vé.
- Sau bản vá review vòng 1 (ánh xạ `fakeDemoMerchants`, ACK `code = '00'`, guard `isNull`, lời báo timeout/404, test thêm): `pnpm typecheck`, `pnpm lint:deps` pass; `pnpm test` pass trên `tickee_test_ipnfake` (contracts 247, web 177, api 891). Kiểm tay lại: Đơn `TKH650K55T` (2 Vé) → `paid`, 2 Vé.

## Spec Change Log

## Review Triage Log

Vòng 1 (Blind Hunter BH, Edge Case Hunter EC, Verification Gap VG):

| # | Phát hiện | Verdict | Bằng chứng | Route |
|---|-----------|---------|------------|-------|
| VG1, BH7 | Ánh xạ `DEMO_MERCHANTS` → `ipnUrl` nằm trong `main.ts`, không test nào chạy | medium | `main.ts` không được import; `ipn-dev-checkout.test.ts` tự đặt `ipnUrl` | patch: hàm thuần trong `demo-merchants.ts` + test |
| VG2, BH8 | Nhánh BTC demo có `ipnKey` NULL (khóa seed trống hoặc bị giữ) không có test | low | Mọi test seed bắt đầu từ khóa khác NULL hoặc BTC mới | patch: thêm hai case |
| EC9 | Update khóa ngẫu nhiên bỏ guard `isNull` nguyên tử | low | Seed đọc rồi mới update; api `connect` có thể sinh khóa giữa hai bước | patch: trả lại `isNull` trong WHERE |
| VG3 | Escape HTML của ô Đường dẫn IPN chưa được test | low | Bỏ `escapeHtml` ở input vẫn pass hết | patch: thêm case URL có `"`, `&`, `<` |
| BH3, EC1 | Mọi 2xx đều tính là đã giao | low | Dán nhầm URL của chính fake (HTTP 200, `code` 92) → chuyển trang và lưu URL | patch: cần 2xx và `code = '00'` |
| BH2 | BTC demo mới nhận khóa ngẫu nhiên (khóa seed đã có chủ) mà seed không báo | low | `--email` thứ hai: Đơn kẹt `pending` mà không có gợi ý | patch: thêm một dòng thay đổi |
| BH5 (lời báo) | Báo timeout là "Không gửi được IPN" trong khi request đã đi | low | `AbortSignal.timeout` hủy sau khi đã gửi; api có thể đã xử lý | patch: sửa lời báo |
| BH6 (gợi ý 404) | Gợi ý 404 khẳng định "không có BTC nào có ipnKey này" | low | Sai cổng hay thiếu `/v1` cũng ra 404 | patch: sửa lời gợi ý |
| BH9 | README nói mỗi lần bấm có mã giao dịch mới | low | `fakeStatusIpnPayload` đặt `providerTransactionCode: null` | patch: sửa câu |
| VG4 | Mặc định 10 giây chỉ được kiểm qua hằng số | low | Dev hiếm gặp; muốn kiểm phải chờ 10 giây hoặc lộ thêm API | reject |
| BH1, EC6 | Seed gán khóa seed cho BTC demo dùng merchant khác | low | Chỉ xảy ra với BTC demo cũ (khóa ngẫu nhiên) đã đổi key trong UI; Đơn cũ vẫn ràng qua secret cũ; sửa thì thêm guard | reject |
| BH4 | URL vừa dán thay cho merchant tới khi fake khởi động lại | false | Đúng thiết kế (một merchant một URL, như Tingee); README nói cách đặt lại | reject |
| BH5 (bấm hai lần, F5) | Bấm nhanh hai lần hoặc F5 thì gửi lại IPN | low | IPN `success` lặp chỉ được lưu (`order_not_pending`), không thêm Vé; sửa phải thêm PRG/khóa nút | reject |
| BH6 (400, test api thật) | Không có gợi ý cho 400; thiếu test api thật cho 401/404 | low | Trang vẫn hiện body api; nhánh 401/404 của api đã có trong `ipn.test.ts` | reject |
| BH10 | Không mô phỏng link hết hạn | false | Gửi `success` sau hạn là kịch bản IPN đến muộn hợp lệ, api tự xử lý | reject |
| BH11 | Bộ nhớ `ipnDeliveries` / body phản hồi không giới hạn | low | Một mục mỗi lần bấm tay; `requests` vốn đã như vậy | reject |
| BH12 | IPN trạng thái mang `customerEmail` / `description` tự chế | false | Whitelist `TingeeIpn` bỏ hai trường này | reject |
| EC2 | `returnUrl` có ký tự ngoài Latin-1 làm `writeHead` ném | false | Chỉ api gọi `create-link`, `returnUrl` = `WEB_ORIGIN` + `/orders/{mã}` (ASCII) | reject |
| EC3 | `ipnTimeoutMs` âm/NaN | false | Chỉ test truyền tùy chọn này; `main.ts` không truyền | reject |
| EC4 | URL có userinfo | low | Dev không dán URL kèm user:pass; sửa thì thêm guard | reject |
| EC5 | `tingee:fake` chạy riêng cần `@tickee/contracts` đã build | low | `pnpm dev` build contracts trước (`^build`); `db:seed` vốn đã cần; inline thì nhân đôi `tingeeIpnUrl` | reject |
| EC7 | `afterAll` ném khi `beforeAll` hỏng trước khi gán `api` | low | vitest vẫn báo lỗi của `beforeAll`; giống mẫu `ipn.test.ts` | reject |
| EC8 | Cổng vừa đóng bị tiến trình khác lấy (test lỗi mạng) | low | Cửa sổ rất ngắn, `fileParallelism: false` | reject |
| EC10 | URL dán vào rồi gửi lỗi thì không được nhớ | false | Matrix chỉ lưu URL ở dòng 2xx; không nhớ URL hỏng là chủ ý | reject |

## Design Notes

Vì sao `ipnKey` cố định thay vì fake đọc DB: giữ fake như Tingee (merchant chỉ biết URL IPN đã cấu hình) và theo mẫu VA cố định đã có. Hệ quả: hai BTC demo (`--email`) dùng chung merchant demo thì IPN về BTC giữ `SEED_IPN_KEY` (api ghi `other_organization`), BTC kia dán URL của mình vào ô trên trang giả — đúng ràng buộc một merchant một URL của Tingee.

## Verification

**Môi trường test:** DB riêng `tickee_test_ipnfake` (tạo như `tickee_test`), chạy test kèm `DATABASE_URL=postgresql://tickee_app:tickee_app@localhost:5432/tickee_test_ipnfake MIGRATION_DATABASE_URL=postgresql://tickee_migrator:tickee_migrator@localhost:5432/tickee_test_ipnfake`.

**Commands:**
- `pnpm test` -- pass.
- `pnpm typecheck && pnpm lint:deps` -- pass.

**Manual checks:**
- `pnpm dev` + `pnpm db:seed`, mua Vé có phí, bấm nút trên trang giả → Trang Đơn hiện Vé.
