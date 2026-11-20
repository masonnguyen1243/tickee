import { z } from 'zod';
import { CredentialKeysError, parseCredentialKeys } from '../crypto/index.js';
import { parseCidrList } from './cidr.js';
import {
  ENV_EXAMPLE_KEYS,
  ENV_EXAMPLE_SECRETS,
  hostOf,
  isCookieParent,
  isHttps,
  isLocalUrl,
  sharesKey,
  usesExampleKey,
} from './production-rules.js';

export const APP_ROLES = ['api', 'worker', 'migrate'] as const;
export type AppRole = (typeof APP_ROLES)[number];

const postgresUrl = z
  .string()
  .min(1)
  .refine((v) => /^postgres(ql)?:\/\//.test(v), { message: 'phải là URL postgres:// hoặc postgresql://' });

const common = {
  /**
   * Bắt buộc ở mọi vai, không có mặc định (Story 4.7-b): thiếu thì mọi luật production (https, giá trị mẫu, giới hạn IP
   * `/v1/admin/*`…) không được phép tự tắt. Image đặt `production` (cả staging); `.env.example` đặt `development`; test
   * đặt `test`.
   */
  NODE_ENV: z.enum(['development', 'test', 'production']),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
};

function isHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
}

/** Origin thuần (`https://tickee.vn`): không path, query hay dấu `/` cuối — trình duyệt gửi `Origin` đúng dạng này. */
const httpOrigin = z.string().refine(isHttpOrigin, {
  message: 'phải là origin http(s)://host[:port], không có path hay dấu / cuối',
});

/** Tên miền cha cho cookie (`tickee.vn`), không scheme, không cổng. */
const cookieDomain = z
  .string()
  .regex(/^\.?[a-z0-9-]+(\.[a-z0-9-]+)+$/i, { message: 'phải là tên miền, vd. tickee.vn' })
  .optional();

/** Danh sách khóa có phiên bản (`parseCredentialKeys`); lỗi chỉ nêu sai gì, không có giá trị. */
const credentialKeys = z.string().superRefine((value, ctx) => {
  try {
    parseCredentialKeys(value);
  } catch (err) {
    ctx.addIssue({ code: 'custom', message: err instanceof CredentialKeysError ? err.message : 'sai định dạng' });
  }
});

const smtpUrl = z
  .string()
  .refine((v) => /^smtps?:\/\//.test(v), { message: 'phải là URL smtp:// hoặc smtps://' });

/**
 * Tingee và khóa Vé, chung cho vai api (tạo link, IPN, phát Vé) và worker (Đối soát bù của Story 4.1 đi cùng đường xử lý
 * IPN: gọi Tingee bằng credential của BTC và phát Vé trong `markPaid`; Story 3.5 cấu hình sẵn).
 */
const tingeeAndTickets = {
  /**
   * Open API của Tingee (AD-9, Story 2.6): origin thuần, vd. `https://uat-open-api.tingee.vn`. Mọi lời gọi ký bằng API
   * key của từng BTC (lưu mã hóa trong DB); env không có credential Tingee nào. Local chạy
   * `pnpm --filter @tickee/api tingee:fake` và trỏ vào fake. `NODE_ENV=development` thì phải có host local (AD-36:
   * `local` dùng Tingee fake), trừ khi bật `TINGEE_ALLOW_REAL_IN_DEVELOPMENT` (E4-3).
   */
  TINGEE_BASE_URL: httpOrigin,
  /**
   * Cờ opt-in (E4-3): `true` cho `NODE_ENV=development` gọi Tingee thật (host không phải local, kể cả UAT), vd. thử UAT
   * qua đường hầm cho E3-3. Chỉ có tác dụng khi `NODE_ENV=development`; `test` và `production` bỏ qua cờ. Mặc định tắt.
   */
  TINGEE_ALLOW_REAL_IN_DEVELOPMENT: z.stringbool().default(false),
  /**
   * Khóa AES-256-GCM mã hóa Secret Token Tingee của BTC (AD-9, AD-23): `v<k>:<base64 của 32 byte>`, nhiều khóa cách
   * nhau bằng dấu phẩy, không trùng `k`. Mã hóa bằng khóa có `k` lớn nhất; giữ khóa cũ tới khi không còn dòng nào dùng.
   * Sinh khóa: `openssl rand -base64 32`. Không bao giờ log.
   */
  TINGEE_CREDENTIAL_KEYS: credentialKeys,
  /**
   * Khóa HMAC-SHA256 ký Mã QR vé (AD-16, Story 3.3): cùng dạng `TINGEE_CREDENTIAL_KEYS` (`v<k>:<base64 của 32 byte>`,
   * nhiều khóa cách nhau bằng dấu phẩy, không trùng `k`). Ký Vé mới bằng khóa có `k` lớn nhất; Vé lưu `k` nên QR không
   * đổi khi xoay khóa, miễn khóa cũ còn trong danh sách. Khác khóa của `TINGEE_CREDENTIAL_KEYS`. Không bao giờ log.
   */
  TICKET_QR_KEYS: credentialKeys,
};

/** Tên header HTTP (token theo RFC 9110). */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * `OTEL_EXPORTER_OTLP_HEADERS` (dạng chuẩn của OpenTelemetry): `key=value` cách nhau bằng dấu phẩy, giá trị có thể
 * percent-encode, vd. `authorization=Bearer%20abc,x-scope=tickee`. Lỗi chỉ nêu sai gì, không bao giờ nêu giá trị.
 */
export function parseOtlpHeaders(raw: string): Record<string, string> | null {
  const headers: Record<string, string> = {};
  for (const entry of raw.split(',')) {
    const eq = entry.indexOf('=');
    if (eq < 0) return null;
    const key = entry.slice(0, eq).trim();
    let value: string;
    try {
      value = decodeURIComponent(entry.slice(eq + 1).trim());
    } catch {
      return null;
    }
    if (!HEADER_NAME.test(key) || value === '' || /[\r\n]/.test(value)) return null;
    headers[key.toLowerCase()] = value;
  }
  return headers;
}

const otlpHeaders = z.string().transform((raw, ctx) => {
  const headers = parseOtlpHeaders(raw);
  if (headers) return headers;
  ctx.addIssue({ code: 'custom', message: 'phải là danh sách key=value cách nhau bằng dấu phẩy' });
  return z.NEVER;
});

/**
 * OpenTelemetry (Story 4.6-a), chỉ vai api và worker: trace và metrics xuất OTLP/HTTP (JSON) tới một collector bất kỳ, không
 * gắn nhà cung cấp nào. Log không đi qua OTLP (vẫn là JSON ra stdout). Không đặt endpoint thì không khởi SDK, không đăng
 * ký hook nào: hành vi như trước 4.6-a.
 */
const telemetry = {
  /** Gốc OTLP/HTTP của collector, vd. `http://localhost:4318` (local: `otel-lgtm`); trace gửi tới `/v1/traces`, metrics tới `/v1/metrics`. */
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  /** Header gửi kèm mỗi lần xuất (khóa API của collector…). Là secret: không bao giờ log. */
  OTEL_EXPORTER_OTLP_HEADERS: otlpHeaders.optional(),
  /** Chu kỳ xuất metrics (ms). */
  OTEL_METRIC_EXPORT_INTERVAL: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
};

const emailAddress = z.email();

/**
 * Danh sách email cách nhau bằng dấu phẩy (khoảng trắng quanh dấu phẩy bỏ qua, trùng thì gộp). Lỗi chỉ nêu sai gì, không
 * bao giờ nêu giá trị.
 */
const emailList = z.string().transform((raw, ctx) => {
  const emails = raw
    .split(',')
    .map((email) => email.trim())
    .filter((email) => email !== '');
  if (emails.length > 0 && emails.every((email) => emailAddress.safeParse(email).success)) return [...new Set(emails)];
  ctx.addIssue({ code: 'custom', message: 'phải là danh sách email cách nhau bằng dấu phẩy' });
  return z.NEVER;
});

/**
 * Cảnh báo vận hành (Story 4.6-b, `platform/alerts`), chung cho vai api và worker: cả hai `raise` (api: link chia sẻ thiếu
 * khóa QR, tiền về không khớp Đơn; worker: Đối soát bù dừng, luật của job quét).
 */
const opsAlerts = {
  /**
   * Loại cảnh báo `cooldown` (thiếu khóa QR, hàng đợi ùn, IPN lỗi tăng, tạo link chậm, tỉ lệ phát Vé giảm): cùng subject
   * báo lại sau chừng này phút.
   */
  OPS_ALERT_COOLDOWN_MINUTES: z.coerce.number().int().min(1).max(1_440).default(30),
};

/** Ngưỡng cảnh báo: số nguyên ≥ 1. */
const alertThreshold = (fallback: number) => z.coerce.number().int().min(1).default(fallback);

/**
 * Luật cảnh báo nghiệp vụ đếm trong bộ nhớ của vai api (Story 4.6-e): cửa sổ 5 phút, mỗi instance api đếm riêng.
 */
const opsAlertApiRules = {
  /** Luật `ipn_failures`: số IPN lỗi (401, 400 body hỏng, 5xx) trong 5 phút để báo. */
  OPS_ALERT_IPN_FAILURES: alertThreshold(5),
  /** Luật `payment_link_slow`: p95 thời lượng `create-link` trong 5 phút phải vượt chừng này mili giây để báo. */
  OPS_ALERT_LINK_P95_MS: alertThreshold(2_000),
  /** Luật `payment_link_slow`: chỉ xét khi có từ chừng này lời gọi `create-link` trong 5 phút. */
  OPS_ALERT_LINK_MIN_SAMPLES: alertThreshold(20),
};

/** Cảnh báo vận hành, chỉ vai worker: gửi email và job quét mỗi phút. */
const opsAlertDelivery = {
  /**
   * Người nhận email cảnh báo vận hành (đội vận hành), cách nhau bằng dấu phẩy. Bắt buộc khi `NODE_ENV=production` (kể cả
   * staging; E4-3): cảnh báo phát hiện lúc không có người nhận vẫn ghi dấu chống lặp, đặt biến sau cũng không gửi lại.
   * `development`/`test` không đặt: cảnh báo chỉ ghi log (worker log `warn` một lần lúc khởi động và mỗi job).
   */
  OPS_ALERT_EMAILS: emailList.optional(),
  /** Luật `queue_backlog`: job tới hạn (`start_after`) quá chừng này phút mà chưa chạy thì báo hàng đợi ùn. */
  OPS_ALERT_QUEUE_WAIT_MINUTES: z.coerce.number().int().min(1).max(1_440).default(5),
  /**
   * Luật `ticket_issuance_drop` (Story 4.6-e): chỉ xét khi khung 75 → 15 phút trước có từ chừng này Đơn có link thanh
   * toán.
   */
  OPS_ALERT_ISSUANCE_MIN_ORDERS: alertThreshold(10),
  /**
   * Luật `ticket_issuance_drop`: báo khi tỉ lệ Đơn có link được trả tiền dưới chừng này lần tỉ lệ của cùng khung 7 ngày
   * trước. Số trong (0, 1].
   */
  OPS_ALERT_ISSUANCE_RATIO: z.coerce.number().gt(0).max(1).default(0.5),
};

/** URL http(s) tuyệt đối, có thể có path (gốc URL công khai của ảnh). */
const httpUrl = z.url({ protocol: /^https?$/ });

/** Tên bucket S3 (3–63 ký tự chữ thường, số, `.` và `-`; đầu và cuối là chữ hoặc số). */
const bucketName = z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, { message: 'phải là tên bucket S3 hợp lệ' });

/**
 * Object storage tương thích S3 cho ảnh Sự kiện (Story 4.8-a, AD-22), chỉ vai api: ký presigned PUT (tính tại chỗ,
 * không gọi mạng) và dựng URL công khai của ảnh. Chỉ dùng API S3 chuẩn, không gắn nhà cung cấp nào. Local: MinIO của
 * docker compose. Worker không đọc nhóm này.
 */
const storage = {
  /** Endpoint S3 mà trình duyệt PUT tới (URL ký trỏ vào đây), vd. `http://localhost:9000` (MinIO local). */
  S3_ENDPOINT: httpOrigin,
  /** Region ký SigV4; MinIO nhận mọi giá trị. */
  S3_REGION: z.string().min(1).default('us-east-1'),
  /** Bucket ảnh Sự kiện: cho đọc ẩn danh từng object, CORS `GET`/`PUT` cho origin web. */
  S3_BUCKET: bucketName,
  /** Access key chỉ cần quyền `PutObject` trên bucket. Là secret: không bao giờ log. */
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  /** `true`: URL dạng `<endpoint>/<bucket>/<key>` (MinIO); `false`: `<bucket>.<host>/<key>`. */
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),
  /**
   * Gốc URL công khai của ảnh: `imageUrl` = `<S3_PUBLIC_BASE_URL>/<key>`, vd.
   * `http://localhost:9000/tickee-event-images` (sau CDN thì là gốc của CDN).
   */
  S3_PUBLIC_BASE_URL: httpUrl,
};

/**
 * Danh sách CIDR cách nhau bằng dấu phẩy (`parseCidrList`) → CIDR đã chuẩn hóa, không trùng. Lỗi chỉ nêu sai gì và ở mục
 * thứ mấy, không bao giờ nêu giá trị.
 */
const cidrList = z.string().transform((raw, ctx) => {
  const parsed = parseCidrList(raw);
  if (parsed.ok) return parsed.cidrs;
  ctx.addIssue({ code: 'custom', message: parsed.reason });
  return z.NEVER;
});

/** Biến của vai api; luật giữa các biến nằm ở `apiConfigSchema`. */
const apiConfigFields = z.object({
  APP_ROLE: z.literal('api'),
  ...common,
  DATABASE_URL: postgresUrl,
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /**
   * Số proxy tin cậy đứng trước api (load balancer…) để Express lấy IP thật từ `X-Forwarded-For`
   * (giới hạn gửi OTP theo IP, giới hạn IP của `/v1/admin/*`). 0 = api nhận kết nối trực tiếp (local).
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  /**
   * Dải IP được gọi khu Quản trị Tingee `/v1/admin/*` (Story 4.7-a, FR-4, AD-26): `ip/prefix` IPv4 (1–32) hoặc IPv6
   * (1–128) cách nhau bằng dấu phẩy, IP trần là `/32` hoặc `/128`; không nhận `/0`. IP client là `req.ip` (theo
   * `TRUST_PROXY_HOPS`). Bắt buộc khi `NODE_ENV=production` (kể cả staging); `development`/`test` không đặt thì không
   * giới hạn (api log `warn` lúc khởi động). Worker không đọc.
   */
  ADMIN_ALLOWED_CIDRS: cidrList.optional(),
  /** Khóa ký session/cookie của Better Auth và khóa gốc HMAC bộ đếm OTP. */
  BETTER_AUTH_SECRET: z.string().min(32),
  /** Origin công khai của api (vd. `https://api.tickee.vn`); Better Auth mount ở `<origin>/v1/auth`. */
  API_PUBLIC_URL: httpOrigin,
  /** Origin duy nhất được CORS (có credentials) và Better Auth tin cậy. */
  WEB_ORIGIN: httpOrigin,
  /** Tên miền cha để cookie session dùng chung web và api; bỏ trống ở local. */
  AUTH_COOKIE_DOMAIN: cookieDomain,
  /** `smtp://user:pass@host:port` — local là Mailpit `smtp://localhost:1025`. */
  SMTP_URL: smtpUrl,
  /** Người gửi email, vd. `Tickee <no-reply@tickee.vn>`. */
  EMAIL_FROM: z.string().min(3),
  /**
   * OAuth client "Web application" của Google (đăng nhập Google, Story 1.4). Redirect URI đăng ký trên Google phải
   * là `<API_PUBLIC_URL>/v1/auth/callback/google`. Test/CI dùng giá trị giả.
   */
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  ...tingeeAndTickets,
  ...storage,
  ...telemetry,
  ...opsAlerts,
  ...opsAlertApiRules,
});

/**
 * Luật giữa các biến: sai thì issue gắn vào `variable` với lý do `message`. `check` chỉ đọc `variable` và các biến trong
 * `uses`; luật chỉ chạy khi các biến đó (kể cả `NODE_ENV` nếu luật dùng nó) không có issue khác, nên một biến không bị báo
 * hai lần và `check` chỉ thấy giá trị đã qua kiểm định dạng. Vai nào không đọc đủ các biến của luật thì bỏ luật đó.
 */
interface CrossRule {
  readonly variable: string;
  readonly uses: readonly string[];
  readonly check: (config: Readonly<Record<string, unknown>>) => boolean;
  readonly message: string;
}

const isProduction = (config: Readonly<Record<string, unknown>>): boolean => config.NODE_ENV === 'production';
/** Giá trị chuỗi của biến đã qua kiểm định dạng; biến tùy chọn không đặt thì `undefined`. */
const text = (config: Readonly<Record<string, unknown>>, variable: string): string | undefined => {
  const value = config[variable];
  return typeof value === 'string' ? value : undefined;
};

const EXAMPLE_VALUE_MESSAGE = 'là giá trị mẫu của .env.example; môi trường thật phải sinh giá trị riêng';

/** Biến URL phải là `https:` khi `NODE_ENV=production`. `OTEL_EXPORTER_OTLP_ENDPOINT` không kiểm (collector nội bộ). */
const HTTPS_VARIABLES = ['API_PUBLIC_URL', 'WEB_ORIGIN', 'TINGEE_BASE_URL', 'S3_ENDPOINT', 'S3_PUBLIC_BASE_URL'];

/** Luật chung cho mọi vai (Story 4.7-a, 4.7-b, E4-3), theo thứ tự báo lỗi. */
const CROSS_RULES: readonly CrossRule[] = [
  // Story 4.7-a; staging cũng chạy production. Biến không đặt thì lý do là "thiếu" (`toIssues`).
  {
    variable: 'ADMIN_ALLOWED_CIDRS',
    uses: ['NODE_ENV'],
    check: (c) => !isProduction(c) || c.ADMIN_ALLOWED_CIDRS !== undefined,
    message: 'bắt buộc khi NODE_ENV=production',
  },
  // E4-3, chỉ worker đọc: không có người nhận thì cảnh báo vận hành chỉ ra log mà dấu chống lặp vẫn ghi. Biến không đặt
  // (hoặc rỗng) thì lý do là "thiếu".
  {
    variable: 'OPS_ALERT_EMAILS',
    uses: ['NODE_ENV'],
    check: (c) => !isProduction(c) || c.OPS_ALERT_EMAILS !== undefined,
    message: 'bắt buộc khi NODE_ENV=production',
  },
  // E4-3, chỉ worker đọc: API tra đơn Gateway mới có hợp đồng tạm mà chỉ Tingee fake hiểu. Không có đường thoát ở
  // production; story thay bằng hợp đồng thật gỡ luật này.
  {
    variable: 'TINGEE_ORDER_STATUS_QUERY',
    uses: ['NODE_ENV'],
    check: (c) => !isProduction(c) || c.TINGEE_ORDER_STATUS_QUERY !== true,
    message: 'phải tắt khi NODE_ENV=production cho tới khi API tra đơn của Tingee có hợp đồng thật',
  },
  // E4-3, AD-36: `local` dùng Tingee fake. Mọi host không phải local là Tingee thật, kể cả UAT. Không áp cho `test` (test
  // dùng URL UAT làm giá trị giả; e2e full-stack chạy `test` với fake).
  {
    variable: 'TINGEE_BASE_URL',
    uses: ['NODE_ENV', 'TINGEE_ALLOW_REAL_IN_DEVELOPMENT'],
    check: (c) =>
      c.NODE_ENV !== 'development' ||
      c.TINGEE_ALLOW_REAL_IN_DEVELOPMENT === true ||
      isLocalUrl(text(c, 'TINGEE_BASE_URL') ?? ''),
    message:
      'phải trỏ Tingee fake trên host local khi NODE_ENV=development; staging/production phải đặt NODE_ENV=production; cố ý gọi Tingee thật từ máy dev thì đặt TINGEE_ALLOW_REAL_IN_DEVELOPMENT=true',
  },
  ...HTTPS_VARIABLES.map(
    (variable): CrossRule => ({
      variable,
      uses: ['NODE_ENV'],
      check: (c) => !isProduction(c) || isHttps(text(c, variable) ?? ''),
      message: 'phải là https khi NODE_ENV=production',
    }),
  ),
  ...Object.entries(ENV_EXAMPLE_SECRETS).map(
    ([variable, example]): CrossRule => ({
      variable,
      uses: ['NODE_ENV'],
      // So sau khi bỏ khoảng trắng hai đầu: secret tạo từ file (k8s…) hay kèm dòng mới cuối.
      check: (c) => !isProduction(c) || text(c, variable)?.trim() !== example,
      message: EXAMPLE_VALUE_MESSAGE,
    }),
  ),
  ...Object.keys(ENV_EXAMPLE_KEYS).map(
    (variable): CrossRule => ({
      variable,
      uses: ['NODE_ENV'],
      check: (c) => !isProduction(c) || !usesExampleKey(text(c, variable) ?? ''),
      message: EXAMPLE_VALUE_MESSAGE,
    }),
  ),
  // Mọi môi trường: khóa ký Mã QR vé lộ thì ai cũng giả được Vé, nên không dùng chung với khóa mã hóa credential.
  {
    variable: 'TICKET_QR_KEYS',
    uses: ['TINGEE_CREDENTIAL_KEYS'],
    check: (c) => !sharesKey(text(c, 'TICKET_QR_KEYS') ?? '', text(c, 'TINGEE_CREDENTIAL_KEYS') ?? ''),
    message: 'dùng chung khóa với TINGEE_CREDENTIAL_KEYS',
  },
  // Mọi môi trường: cookie session đặt ở miền này phải tới được cả api lẫn web.
  {
    variable: 'AUTH_COOKIE_DOMAIN',
    uses: ['API_PUBLIC_URL', 'WEB_ORIGIN'],
    check: (c) => {
      const domain = text(c, 'AUTH_COOKIE_DOMAIN');
      if (domain === undefined) return true;
      return ['API_PUBLIC_URL', 'WEB_ORIGIN'].every((origin) => isCookieParent(domain, text(c, origin) ?? ''));
    },
    message: 'phải là miền cha của host API_PUBLIC_URL và WEB_ORIGIN',
  },
  // Production, hai host khác nhau: SSR của web chuyển tiếp cookie của web sang api (`apps/web/lib/api/server.ts`), nên
  // cookie phải đặt ở miền cha chung. Chỉ báo khi biến không đặt, nên lý do luôn là "thiếu".
  {
    variable: 'AUTH_COOKIE_DOMAIN',
    uses: ['NODE_ENV', 'API_PUBLIC_URL', 'WEB_ORIGIN'],
    check: (c) =>
      !isProduction(c) ||
      c.AUTH_COOKIE_DOMAIN !== undefined ||
      hostOf(text(c, 'API_PUBLIC_URL') ?? '') === hostOf(text(c, 'WEB_ORIGIN') ?? ''),
    message: 'bắt buộc khi NODE_ENV=production và API_PUBLIC_URL, WEB_ORIGIN khác host',
  },
];

/**
 * Gắn `CROSS_RULES` vào schema của một vai, mỗi luật một `refine` có `path` và `when`. Bỏ luật có biến mà vai không đọc.
 * `when` cho luật chạy cả khi biến khác lỗi, để báo đủ mọi lỗi trong một lượt.
 */
function withCrossRules<Shape extends z.ZodRawShape>(fields: z.ZodObject<Shape>): z.ZodObject<Shape> {
  const known = new Set(Object.keys(fields.shape));
  return CROSS_RULES.filter((rule) => [rule.variable, ...rule.uses].every((name) => known.has(name))).reduce(
    (schema, rule) => {
      const watched = new Set([rule.variable, ...rule.uses]);
      return schema.refine((config) => rule.check(config), {
        // Issue mức object phải gắn đúng tên biến (`toIssues` đọc `path[0]`); biến không đặt thì lý do là "thiếu".
        path: [rule.variable],
        message: rule.message,
        when: (payload) => !payload.issues.some((issue) => watched.has(String(issue.path?.[0]))),
      });
    },
    fields,
  );
}

/** Vai api: luật production, khóa trùng, miền cookie (Story 4.7-a, 4.7-b) và Tingee fake ở development (E4-3). */
export const apiConfigSchema = withCrossRules(apiConfigFields);

/** Biến của vai worker; luật giữa các biến nằm ở `workerConfigSchema`. */
const workerConfigFields = z.object({
  APP_ROLE: z.literal('worker'),
  ...common,
  DATABASE_URL: postgresUrl,
  /**
   * Origin của web: link trong email (vd. lời mời Admin `<WEB_ORIGIN>/loi-moi-btc#…`) và nơi gọi revalidate trang Sự
   * kiện công khai (`<WEB_ORIGIN>/api/revalidate`).
   */
  WEB_ORIGIN: httpOrigin,
  /** Gửi email từ job (lời mời Admin); cùng dạng với vai `api`. */
  SMTP_URL: smtpUrl,
  EMAIL_FROM: z.string().min(3),
  /**
   * Bí mật dùng chung với web (Story 2.11-c): worker gửi `Authorization: Bearer <REVALIDATE_SECRET>` tới
   * `<WEB_ORIGIN>/api/revalidate`; web đặt cùng giá trị (chỉ ở server). Sinh bằng `openssl rand -base64 32`. Không log.
   */
  REVALIDATE_SECRET: z.string().min(32),
  /** Cùng giá trị với vai api (Story 3.5): worker giải mã credential Tingee của BTC và phát Vé (`markPaid`). */
  ...tingeeAndTickets,
  /**
   * Cờ Đối soát bù (Story 4.1): `true` thì job tra gọi API tra đơn Gateway của Tingee. Tingee chưa công bố API này
   * (13/11/2026): `tingee` làm theo hợp đồng tạm và Tingee fake giả lập đúng hợp đồng đó. Tắt (mặc định): job tra xong
   * ngay, không gọi Tingee, không enqueue mốc kế. Nhận `true`/`false`, `1`/`0`, `yes`/`no`, `on`/`off`. Bật ở local
   * (`.env.example`, Tingee fake) và trong test. `NODE_ENV=production` (kể cả staging) bật thì worker không khởi động
   * (E4-3); story thay hợp đồng tạm bằng hợp đồng thật gỡ luật đó.
   */
  TINGEE_ORDER_STATUS_QUERY: z.stringbool().default(false),
  ...telemetry,
  ...opsAlerts,
  ...opsAlertDelivery,
});

/**
 * Vai worker: luật production và khóa trùng của các biến worker đọc (Story 4.7-b), cùng người nhận cảnh báo, cờ Đối soát
 * bù ở production và Tingee fake ở development (E4-3).
 */
export const workerConfigSchema = withCrossRules(workerConfigFields);

export const migrateConfigSchema = z.object({
  APP_ROLE: z.literal('migrate'),
  ...common,
  MIGRATION_DATABASE_URL: postgresUrl,
});

export const roleSchemas = {
  api: apiConfigSchema,
  worker: workerConfigSchema,
  migrate: migrateConfigSchema,
} as const;

export type ApiConfig = z.infer<typeof apiConfigSchema>;
export type WorkerConfig = z.infer<typeof workerConfigSchema>;
export type MigrateConfig = z.infer<typeof migrateConfigSchema>;
export type AppConfig = ApiConfig | WorkerConfig | MigrateConfig;
