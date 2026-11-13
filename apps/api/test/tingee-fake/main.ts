import { fakeDemoMerchants } from './demo-merchants.js';
import { startTingeeFake } from './server.js';

/*
 * Tingee fake cho dev local (không gọi Tingee thật): `pnpm dev` chạy sẵn (task `dev:tingee`), hoặc chạy riêng bằng
 * `pnpm --filter @tickee/api tingee:fake`. Nghe `TINGEE_FAKE_PORT` (mặc định 4010); trỏ
 * `TINGEE_BASE_URL=http://localhost:4010`. Merchant demo ở `demo-merchants.ts`: nhập Client ID và Secret Token của một
 * merchant ở trang Tài khoản nhận tiền, hoặc dùng BTC demo của `pnpm db:seed` (đã liên kết sẵn). Đây là key giả, chỉ có
 * nghĩa với fake.
 *
 * Đơn có phí (Story 3.4) nhận link thanh toán trỏ về chính fake (`/checkout/:orderId`): trang giả có ba nút "Đã thanh
 * toán (giả lập)", "Hết hạn", "Hủy" gửi IPN đã ký tới "Đường dẫn IPN" của merchant rồi đưa trình duyệt về Trang Đơn.
 * Không có tiền nào được chuyển. Merchant có `ipnKey` (merchant của BTC demo) biết sẵn đường dẫn
 * `{API_PUBLIC_URL}/v1/payments/tingee/ipn/{ipnKey}` (`API_PUBLIC_URL` đọc từ `.env`, mặc định http://localhost:3001);
 * BTC khác dán URL IPN của mình (trang Tài khoản nhận tiền) vào ô trên trang giả, fake nhớ tới khi khởi động lại.
 *
 * Đối soát bù (Story 4.1): fake nhớ trạng thái thanh toán của từng link và trả lời API tra đơn Gateway theo hợp đồng tạm
 * (`GET_ORDER_PATH`), nên worker (`TINGEE_ORDER_STATUS_QUERY=true`) phát được Vé cả khi IPN không tới (Đường dẫn IPN sai).
 */

const port = Number(process.env.TINGEE_FAKE_PORT ?? 4010);
const merchants = fakeDemoMerchants(process.env.API_PUBLIC_URL);
const fake = await startTingeeFake({
  merchants,
  port,
  host: '127.0.0.1',
  log: (line) => console.log(`[tingee-fake] ${line}`),
});
console.log(`[tingee-fake] đang nghe ${fake.url}. Merchant demo (Client ID / Secret Token):`);
for (const merchant of merchants) {
  console.log(`[tingee-fake]   ${merchant.clientId} / ${merchant.secretToken} (${merchant.accounts.length} tài khoản)`);
  console.log(
    `[tingee-fake]     Đường dẫn IPN: ${merchant.ipnUrl ?? 'chưa có (dán URL IPN của BTC vào ô trên trang thanh toán giả)'}`,
  );
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void fake.close().then(() => process.exit(0));
  });
}
