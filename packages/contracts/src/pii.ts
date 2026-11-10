/**
 * Cột chứa thông tin cá nhân, theo mô-đun sở hữu (AD-24). Story thêm bảng có cột cá nhân
 * thì khai báo cột ở đây; log tự che theo danh sách này.
 */
export const PII_COLUMNS = {
  identity: ['email', 'name', 'ip_address', 'user_agent'],
  // `email`: email người được mời (`organization_invitations.email`).
  // `account_name`, `account_last4`: tên chủ và 4 số cuối tài khoản nhận tiền (`payout_accounts`).
  organizer: ['contact_phone', 'contact_email', 'email', 'account_name', 'account_last4'],
  // Bản chụp Người mua của Đơn (`orders.buyer_*`) và câu trả lời form (`order_answers.answer`).
  ordering: ['buyer_name', 'buyer_phone', 'buyer_email', 'answer'],
} as const satisfies Record<string, readonly string[]>;

const snakeToCamel = (s: string): string => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/**
 * Khóa luôn che trong log dù chưa có cột nào dùng: email, SĐT, số tài khoản đầy đủ, CCCD; số VA nhận tiền và API key
 * Tingee của BTC (`client_id`, `secret_token`; Secret Token chỉ lưu dạng mã hóa, không bao giờ được log).
 */
const ALWAYS_REDACTED = [
  'email',
  'phone',
  'phone_number',
  'account_number',
  'identity_number',
  'va_account_number',
  'secret_token',
  'client_id',
] as const;

/** Khóa cần che trong log: dạng snake_case và camelCase của mọi cột PII. */
export const PII_KEYS: readonly string[] = Array.from(
  new Set(
    [...ALWAYS_REDACTED, ...Object.values(PII_COLUMNS).flat()].flatMap((col) => [col, snakeToCamel(col)]),
  ),
).sort();
