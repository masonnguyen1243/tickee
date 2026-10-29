/**
 * Cột chứa thông tin cá nhân, theo mô-đun sở hữu (AD-24). Story thêm bảng có cột cá nhân
 * thì khai báo cột ở đây; log tự che theo danh sách này.
 */
export const PII_COLUMNS = {
  identity: ['email', 'name', 'ip_address', 'user_agent'],
} as const satisfies Record<string, readonly string[]>;

const snakeToCamel = (s: string): string => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** Khóa luôn che trong log dù chưa có cột nào dùng: email và SĐT. */
const ALWAYS_REDACTED = ['email', 'phone', 'phone_number'] as const;

/** Khóa cần che trong log: dạng snake_case và camelCase của mọi cột PII. */
export const PII_KEYS: readonly string[] = Array.from(
  new Set(
    [...ALWAYS_REDACTED, ...Object.values(PII_COLUMNS).flat()].flatMap((col) => [col, snakeToCamel(col)]),
  ),
).sort();
