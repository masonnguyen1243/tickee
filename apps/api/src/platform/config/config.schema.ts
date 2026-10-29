import { z } from 'zod';

export const APP_ROLES = ['api', 'worker', 'migrate'] as const;
export type AppRole = (typeof APP_ROLES)[number];

const postgresUrl = z
  .string()
  .min(1)
  .refine((v) => /^postgres(ql)?:\/\//.test(v), { message: 'phải là URL postgres:// hoặc postgresql://' });

const common = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
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

const smtpUrl = z
  .string()
  .refine((v) => /^smtps?:\/\//.test(v), { message: 'phải là URL smtp:// hoặc smtps://' });

export const apiConfigSchema = z.object({
  APP_ROLE: z.literal('api'),
  ...common,
  DATABASE_URL: postgresUrl,
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /**
   * Số proxy tin cậy đứng trước api (load balancer…) để Express lấy IP thật từ `X-Forwarded-For`
   * (giới hạn gửi OTP theo IP). 0 = api nhận kết nối trực tiếp (local).
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
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
});

export const workerConfigSchema = z.object({
  APP_ROLE: z.literal('worker'),
  ...common,
  DATABASE_URL: postgresUrl,
});

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
