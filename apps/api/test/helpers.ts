import { Writable } from 'node:stream';
import type { ApiConfig } from '../src/platform/config/index.js';

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
  ...overrides,
});

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
