/*
 * Merchant demo của Tingee fake chạy ở local (`pnpm dev`, cổng 4010). Key và tài khoản đều giả, chỉ có nghĩa với fake.
 * Số VA cố định (không sinh ngẫu nhiên như `fakeAccount`) để `pnpm db:seed` liên kết đúng VA mà fake trả về: trang Tài
 * khoản nhận tiền của BTC demo thấy tài khoản đã liên kết khớp với danh sách đọc từ fake.
 */

/** Một dòng `items[]` của `get-va-paging` theo dạng của Tingee. */
export type DemoAccount = {
  bankName: string;
  bankBin: string;
  accountType: string;
  accountName: string;
  accountNumber: string;
  vaAccountNumber: string;
  status: string;
  shopId: number;
  transactionType: string;
  creationTime: string;
};

export interface DemoMerchant {
  clientId: string;
  secretToken: string;
  accounts: DemoAccount[];
}

/** Tài khoản `active`, cá nhân, nhận tiền (`credit`) ở MB Bank; ghi đè từng trường khi cần. */
const account = (
  fields: Partial<DemoAccount> & Pick<DemoAccount, 'accountNumber' | 'vaAccountNumber' | 'shopId'>,
): DemoAccount => ({
  bankName: 'MB Bank',
  bankBin: '970422',
  accountType: 'personal-account',
  accountName: 'NGUYEN VAN AN',
  status: 'active',
  transactionType: 'credit',
  creationTime: '2026-11-01T10:00:00',
  ...fields,
});

export const DEMO_MERCHANTS: DemoMerchant[] = [
  {
    // Có tài khoản: hai tài khoản chọn được, một VietinBank (hiện mờ); một tài khoản `inactive` và một tài khoản chỉ chi
    // (`debit`) không hiện.
    clientId: 'demo-btc-co-tai-khoan',
    secretToken: 'demo-secret-co-tai-khoan',
    accounts: [
      account({
        accountName: 'CLB CO VUA QUAN 3',
        accountNumber: '0901234567',
        vaAccountNumber: '960901234567',
        shopId: 7001,
      }),
      account({
        bankName: 'Vietcombank',
        bankBin: '970436',
        accountType: 'business-account',
        accountName: 'CONG TY TNHH CLB CO VUA',
        accountNumber: '1023456789',
        vaAccountNumber: '961023456789',
        shopId: 7002,
      }),
      account({
        bankName: 'VietinBank',
        bankBin: '970415',
        accountNumber: '1080001234',
        vaAccountNumber: '961080001234',
        shopId: 7003,
      }),
      account({
        bankName: 'BIDV',
        bankBin: '970418',
        status: 'inactive',
        accountNumber: '2150005678',
        vaAccountNumber: '962150005678',
        shopId: 7004,
      }),
      account({
        bankName: 'ACB',
        bankBin: '970416',
        transactionType: 'debit',
        accountNumber: '3330009012',
        vaAccountNumber: '963330009012',
        shopId: 7005,
      }),
    ],
  },
  {
    // Key đúng nhưng chưa liên kết tài khoản ngân hàng nào trên Tingee: trang hiện `empty-state`.
    clientId: 'demo-btc-chua-lien-ket',
    secretToken: 'demo-secret-chua-lien-ket',
    accounts: [],
  },
];

/** Merchant có tài khoản: `pnpm db:seed` lưu key này cho BTC demo. */
export const SEED_MERCHANT = DEMO_MERCHANTS[0]!;
/** Tài khoản MB Bank của merchant trên: `pnpm db:seed` liên kết làm tài khoản nhận tiền mặc định của BTC demo. */
export const SEED_PAYOUT_ACCOUNT = SEED_MERCHANT.accounts[0]!;
