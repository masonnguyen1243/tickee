import { DEMO_MERCHANTS } from './demo-merchants.js';
import { startTingeeFake } from './server.js';

/*
 * Tingee fake cho dev local (không gọi Tingee thật): `pnpm dev` chạy sẵn (task `dev:tingee`), hoặc chạy riêng bằng
 * `pnpm --filter @tickee/api tingee:fake`. Nghe `TINGEE_FAKE_PORT` (mặc định 4010); trỏ
 * `TINGEE_BASE_URL=http://localhost:4010`. Merchant demo ở `demo-merchants.ts`: nhập Client ID và Secret Token của một
 * merchant ở trang Tài khoản nhận tiền, hoặc dùng BTC demo của `pnpm db:seed` (đã liên kết sẵn). Đây là key giả, chỉ có
 * nghĩa với fake. Đơn có phí (Story 3.4) nhận link thanh toán trỏ về chính fake (`/checkout/:orderId`): trang giả có link
 * quay về Trang Đơn, không có tiền nào được chuyển.
 */

const port = Number(process.env.TINGEE_FAKE_PORT ?? 4010);
const fake = await startTingeeFake({
  merchants: DEMO_MERCHANTS,
  port,
  host: '127.0.0.1',
  log: (line) => console.log(`[tingee-fake] ${line}`),
});
console.log(`[tingee-fake] đang nghe ${fake.url}. Merchant demo (Client ID / Secret Token):`);
for (const merchant of DEMO_MERCHANTS) {
  console.log(`[tingee-fake]   ${merchant.clientId} / ${merchant.secretToken} (${merchant.accounts.length} tài khoản)`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void fake.close().then(() => process.exit(0));
  });
}
