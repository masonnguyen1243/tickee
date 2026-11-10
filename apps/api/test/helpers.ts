import { Writable } from 'node:stream';
import type { ApiConfig, WorkerConfig } from '../src/platform/config/index.js';

export const databaseUrl = (): string => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL chưa đặt cho test');
  return url;
};

export const migrationDatabaseUrl = (): string => {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL chưa đặt cho test');
  return url;
};

/** Khóa mã hóa Secret Token Tingee chỉ dùng trong test (`v<k>:<base64 của 32 byte>`). */
export const testCredentialKey = (version: number, fill: number): string =>
  `v${version}:${Buffer.alloc(32, fill).toString('base64')}`;
export const TEST_CREDENTIAL_KEYS = testCredentialKey(1, 7);
/** Khóa ký Mã QR vé chỉ dùng trong test (cùng dạng, khác giá trị với `TEST_CREDENTIAL_KEYS`). */
export const TEST_TICKET_QR_KEYS = testCredentialKey(1, 9);

/** Origin web giả lập trong test: CORS và Better Auth chỉ tin origin này. */
export const TEST_WEB_ORIGIN = 'http://web.tickee.test';

export const apiConfig = (overrides: Partial<ApiConfig> = {}): ApiConfig => ({
  APP_ROLE: 'api',
  NODE_ENV: 'test',
  LOG_LEVEL: 'info',
  PORT: 0,
  TRUST_PROXY_HOPS: 0,
  DATABASE_URL: databaseUrl(),
  BETTER_AUTH_SECRET: 'test-only-secret-khong-dung-o-dau-khac-0123456789',
  API_PUBLIC_URL: 'http://api.tickee.test',
  WEB_ORIGIN: TEST_WEB_ORIGIN,
  // Không có SMTP trong test: test thay EMAIL_TRANSPORT bằng transport giả; cổng 1 để lỡ gọi thật thì lỗi ngay.
  SMTP_URL: 'smtp://127.0.0.1:1',
  EMAIL_FROM: 'Tickee <no-reply@tickee.test>',
  // OAuth client giả: test chặn `fetch` tới token endpoint của Google, không gọi Google thật.
  GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-only-google-client-secret',
  // Không bao giờ gọi Tingee thật: cổng 1 để lỡ gọi thì lỗi ngay; test tài khoản nhận tiền trỏ vào `test/tingee-fake`.
  TINGEE_BASE_URL: 'http://127.0.0.1:1',
  TINGEE_CREDENTIAL_KEYS: TEST_CREDENTIAL_KEYS,
  TICKET_QR_KEYS: TEST_TICKET_QR_KEYS,
  ...overrides,
});

/** Bí mật revalidate trang Sự kiện công khai chỉ dùng trong test (≥ 32 ký tự). */
export const TEST_REVALIDATE_SECRET = 'test-only-revalidate-secret-0123456789abcdef';

/** Cấu hình vai `worker` cho test: cùng DB, cùng origin web và SMTP giả với `apiConfig`. */
export const workerConfig = (overrides: Partial<WorkerConfig> = {}): WorkerConfig => {
  const api = apiConfig();
  return {
    APP_ROLE: 'worker',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: api.DATABASE_URL,
    WEB_ORIGIN: api.WEB_ORIGIN,
    SMTP_URL: api.SMTP_URL,
    EMAIL_FROM: api.EMAIL_FROM,
    REVALIDATE_SECRET: TEST_REVALIDATE_SECRET,
    ...overrides,
  };
};

/** Stream gom dòng log JSON để kiểm. */
export class LogCapture extends Writable {
  readonly lines: Record<string, unknown>[] = [];

  override _write(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim()) this.lines.push(JSON.parse(line) as Record<string, unknown>);
    }
    cb();
  }

  get text(): string {
    return JSON.stringify(this.lines);
  }
}
