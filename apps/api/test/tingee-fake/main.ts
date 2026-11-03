import { startTingeeFake } from './server.js';

/*
 * `pnpm --filter @tickee/api tingee:fake`: Tingee fake cho dev local khi chưa có credential UAT. Đọc `TINGEE_CLIENT_ID`,
 * `TINGEE_SECRET_TOKEN` từ `.env` (cùng giá trị api dùng để ký) và nghe `TINGEE_FAKE_PORT` (mặc định 4010). Trỏ
 * `TINGEE_BASE_URL=http://localhost:4010`. Kịch bản theo 4 số cuối số tài khoản: xem `server.ts`.
 */

const port = Number(process.env.TINGEE_FAKE_PORT ?? 4010);
const fake = await startTingeeFake({
  clientId: process.env.TINGEE_CLIENT_ID ?? 'local-fake-client',
  secretToken: process.env.TINGEE_SECRET_TOKEN ?? 'local-fake-secret',
  port,
  host: '127.0.0.1',
  log: (line) => console.log(`[tingee-fake] ${line}`),
});
console.log(`[tingee-fake] đang nghe ${fake.url} — OTP đúng: 123456, OTP hết hạn: 000000`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void fake.close().then(() => process.exit(0));
  });
}
