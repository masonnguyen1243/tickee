import { fakeAccount, startTingeeFake, type FakeMerchant } from './server.js';

/*
 * `pnpm --filter @tickee/api tingee:fake`: Tingee fake cho dev local (không gọi Tingee thật). Nghe `TINGEE_FAKE_PORT`
 * (mặc định 4010); trỏ `TINGEE_BASE_URL=http://localhost:4010`. Có sẵn hai merchant demo: nhập Client ID và Secret Token
 * của một merchant ở trang Tài khoản nhận tiền. Đây là key giả, chỉ có nghĩa với fake.
 */

const DEMO_MERCHANTS: FakeMerchant[] = [
  {
    // Có tài khoản: hai tài khoản chọn được, một VietinBank (hiện mờ); một tài khoản `inactive` và một tài khoản chỉ chi
    // (`debit`) không hiện.
    clientId: 'demo-btc-co-tai-khoan',
    secretToken: 'demo-secret-co-tai-khoan',
    accounts: [
      fakeAccount({ bankName: 'MB Bank', bankBin: '970422', accountName: 'CLB CO VUA QUAN 3', accountNumber: '0901234567' }),
      fakeAccount({
        bankName: 'Vietcombank',
        bankBin: '970436',
        accountType: 'business-account',
        accountName: 'CONG TY TNHH CLB CO VUA',
        accountNumber: '1023456789',
      }),
      fakeAccount({ bankName: 'VietinBank', bankBin: '970415', accountName: 'NGUYEN VAN AN', accountNumber: '1080001234' }),
      fakeAccount({ bankName: 'BIDV', bankBin: '970418', status: 'inactive', accountNumber: '2150005678' }),
      fakeAccount({ bankName: 'ACB', bankBin: '970416', transactionType: 'debit', accountNumber: '3330009012' }),
    ],
  },
  {
    // Key đúng nhưng chưa liên kết tài khoản ngân hàng nào trên Tingee: trang hiện `empty-state`.
    clientId: 'demo-btc-chua-lien-ket',
    secretToken: 'demo-secret-chua-lien-ket',
    accounts: [],
  },
];

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
