import { parseCredentialKeys } from '../crypto/index.js';

/*
 * Hằng và hàm thuần cho luật giữa các biến của `config.schema.ts` (Story 4.7-b): giá trị mẫu của `.env.example`, so byte
 * khóa, kiểm miền cha của cookie. Image không có `.env.example` nên giá trị mẫu nằm ở đây; `test/config.test.ts` đọc file
 * thật để chắc hai nơi còn khớp. Không hàm nào trả hay ném giá trị của biến.
 */

/**
 * Giá trị mẫu của `.env.example`: ai đọc repo cũng biết, nên `NODE_ENV=production` từ chối đúng các giá trị này. Sửa giá
 * trị trong `.env.example` thì sửa cả ở đây (test đỏ nếu quên).
 */
export const ENV_EXAMPLE_SECRETS = {
  BETTER_AUTH_SECRET: 'local-dev-only-doi-khoa-nay-o-moi-moi-truong-that',
  REVALIDATE_SECRET: 'local-dev-only-revalidate-doi-khoa-nay-o-moi-truong-that',
  GOOGLE_CLIENT_ID: 'local-placeholder.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'local-placeholder-secret',
  GOOGLE_SHEETS_CLIENT_ID: 'local-placeholder-sheets.apps.googleusercontent.com',
  GOOGLE_SHEETS_CLIENT_SECRET: 'local-placeholder-sheets-secret',
  S3_ACCESS_KEY_ID: 'tickee-local',
  S3_SECRET_ACCESS_KEY: 'tickee-local-secret',
} as const;

/**
 * Danh sách khóa mẫu của `.env.example` (`v<k>:<base64 của 32 byte>`). Ở `NODE_ENV=production`, `TINGEE_CREDENTIAL_KEYS`,
 * `TICKET_QR_KEYS` và `GOOGLE_SHEETS_TOKEN_KEYS` không được có khóa nào trùng byte với một trong các khóa này, bất kể số
 * phiên bản.
 */
export const ENV_EXAMPLE_KEYS = {
  TINGEE_CREDENTIAL_KEYS: 'v1:H0ifJtEFLX+lF7uW8Yp0o5tbO7bfViFxKAaALW0fOWg=',
  TICKET_QR_KEYS: 'v1:XKzZ7wJ1m6M2fCq9yQb0n3T4sVhR8dLpA5eGiUoWkYc=',
  GOOGLE_SHEETS_TOKEN_KEYS: 'v1:LyyLU9MIkhSXt+ZLRItxJoibMo60B6wmznw1cIxL9I4=',
} as const;

/**
 * Hai danh sách khóa (dạng `parseCredentialKeys`) có khóa nào trùng byte không, bất kể số phiên bản. Chỉ gọi với danh sách
 * đã hợp lệ: danh sách sai dạng thì ném `CredentialKeysError`.
 */
export function sharesKey(a: string, b: string): boolean {
  const keysOfB = parseCredentialKeys(b);
  return parseCredentialKeys(a).some(({ key }) => keysOfB.some((other) => other.key.equals(key)));
}

/** Danh sách khóa có khóa nào trùng byte với một khóa mẫu của `.env.example` không. */
export function usesExampleKey(keys: string): boolean {
  return Object.values(ENV_EXAMPLE_KEYS).some((example) => sharesKey(keys, example));
}

/** URL có scheme `https:` không; chuỗi không phải URL thì `false`. */
export function isHttps(url: string): boolean {
  return URL.parse(url)?.protocol === 'https:';
}

/** Host (không cổng, chữ thường) của một origin; không phải URL thì `null`. */
export function hostOf(origin: string): string | null {
  return URL.parse(origin)?.hostname ?? null;
}

/**
 * `domain` (dạng `AUTH_COOKIE_DOMAIN`) có phải miền cha của host `origin` không: so không phân biệt hoa thường, bỏ dấu `.`
 * đầu; host bằng miền này hoặc kết thúc bằng `.<miền>`. Không kiểm danh sách hậu tố công khai.
 */
export function isCookieParent(domain: string, origin: string): boolean {
  const host = hostOf(origin);
  const parent = domain.toLowerCase().replace(/^\./, '');
  if (host === null || parent === '') return false;
  return host === parent || host.endsWith(`.${parent}`);
}

/** `127.0.0.0/8` dạng chấm thập phân đầy đủ (dạng `URL.hostname` trả sau khi chuẩn hóa). */
function isLoopbackV4(host: string): boolean {
  const parts = host.split('.');
  return parts.length === 4 && parts[0] === '127' && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/**
 * Host local (Story 4.7-f): `localhost`, `*.localhost`, `127.0.0.0/8`, `::1` (có hoặc không ngoặc vuông: `URL.hostname`
 * trả `[::1]`). Không phân biệt hoa thường. Mọi host khác là host thật. Web có bản riêng (`apps/web/lib/production-env.ts`):
 * web không import code của api.
 */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host.endsWith('.localhost') || isLoopbackV4(host) || host === '::1' || host === '[::1]';
}

/** URL có host local (`isLocalHost`) không; chuỗi không phải URL thì `false` (E4-3). */
export function isLocalUrl(url: string): boolean {
  const host = hostOf(url);
  return host !== null && isLocalHost(host);
}

/** Marker của dòng log `warn` lúc khởi động khi `productionLookingOrigins` khác rỗng (Story 4.7-f). */
export const NODE_ENV_NOT_PRODUCTION = 'node_env_not_production';

/** Origin công khai mà `productionLookingOrigins` xét, theo thứ tự báo. */
const PUBLIC_ORIGIN_VARIABLES = ['API_PUBLIC_URL', 'WEB_ORIGIN'] as const;

/**
 * Origin trông như môi trường thật (`https:` trên host không phải local) trong khi `NODE_ENV` khác `production` (Story
 * 4.7-f): env runtime chép `NODE_ENV=development` từ `.env.example` thì mọi luật production tắt mà không có lỗi gì. Trả
 * tên biến, không trả giá trị. `NODE_ENV=production`, hoặc vai không đọc origin nào (`migrate`), thì `[]`.
 */
export function productionLookingOrigins(
  config: Readonly<{ NODE_ENV: string; API_PUBLIC_URL?: string; WEB_ORIGIN?: string }>,
): string[] {
  if (config.NODE_ENV === 'production') return [];
  return PUBLIC_ORIGIN_VARIABLES.filter((variable) => {
    const origin = config[variable];
    if (origin === undefined || !isHttps(origin)) return false;
    const host = hostOf(origin);
    return !!host && !isLocalHost(host);
  });
}
