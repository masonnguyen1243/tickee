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

export const apiConfig = (overrides: Partial<ApiConfig> = {}): ApiConfig => ({
  APP_ROLE: 'api',
  NODE_ENV: 'test',
  LOG_LEVEL: 'info',
  PORT: 0,
  DATABASE_URL: databaseUrl(),
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
