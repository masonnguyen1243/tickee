import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { register } from '@/instrumentation';
import { ENV_EXAMPLE_REVALIDATE_SECRET } from '@/lib/production-env';

/**
 * `register()` của `instrumentation.ts` (Story 4.7-f): Next gọi một lần lúc server khởi động. Web chạy thật mà cấu hình
 * sai thì in một thông báo rồi thoát mã 1; `process.exit` được mock để tiến trình test không thoát.
 */

const SECRET = 'r1eng-cua-moi-truong-that-0123456789abcdef';

let exit: MockInstance<typeof process.exit>;
let error: MockInstance<typeof console.error>;

/** Đặt env của server web; `undefined` = không đặt. */
function serverEnv(env: { NEXT_PUBLIC_API_BASE_URL?: string; WEB_ORIGIN?: string; REVALIDATE_SECRET?: string }) {
  for (const name of ['NEXT_PUBLIC_API_BASE_URL', 'WEB_ORIGIN', 'REVALIDATE_SECRET'] as const) {
    vi.stubEnv(name, env[name]);
  }
}

/** Mọi output của các lần `console.error`. */
const printed = () => error.mock.calls.map((args) => args.join(' ')).join('\n');

const LIVE = { NEXT_PUBLIC_API_BASE_URL: 'https://api.tickee.vn', WEB_ORIGIN: 'https://tickee.vn', REVALIDATE_SECRET: SECRET };

describe('instrumentation register()', () => {
  beforeEach(() => {
    // Như `next start`: runtime nodejs, NODE_ENV=production (không phụ thuộc NODE_ENV của shell chạy test).
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('NODE_ENV', 'production');
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('chạy thật, hợp lệ → khởi động, không in lỗi', async () => {
    serverEnv(LIVE);
    await register();
    expect(exit).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it.each([
    ['thiếu', undefined, 'WEB_ORIGIN (thiếu)'],
    ['http', 'http://tickee.vn', 'WEB_ORIGIN (phải là https)'],
  ])('WEB_ORIGIN %s → thoát mã 1, nêu WEB_ORIGIN, không in giá trị', async (_name, WEB_ORIGIN, expected) => {
    serverEnv({ ...LIVE, WEB_ORIGIN });
    await register();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(printed()).toContain(expected);
    if (WEB_ORIGIN) expect(printed()).not.toContain(WEB_ORIGIN);
  });

  it.each([
    ['giá trị mẫu', ENV_EXAMPLE_REVALIDATE_SECRET, 'REVALIDATE_SECRET (là giá trị mẫu của .env.example'],
    ['20 ký tự', 'abcdefghij0123456789', 'REVALIDATE_SECRET (ngắn hơn 32 ký tự)'],
    ['thiếu', undefined, 'REVALIDATE_SECRET (thiếu)'],
  ])('REVALIDATE_SECRET %s → thoát mã 1, không in giá trị', async (_name, REVALIDATE_SECRET, expected) => {
    serverEnv({ ...LIVE, REVALIDATE_SECRET });
    await register();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(printed()).toContain(expected);
    if (REVALIDATE_SECRET) expect(printed()).not.toContain(REVALIDATE_SECRET);
  });

  it('nhiều lỗi → một thông báo nêu cả hai biến, thoát một lần', async () => {
    serverEnv({ ...LIVE, WEB_ORIGIN: 'http://tickee.vn', REVALIDATE_SECRET: ENV_EXAMPLE_REVALIDATE_SECRET });
    await register();
    expect(error).toHaveBeenCalledTimes(1);
    expect(printed()).toContain('WEB_ORIGIN (phải là https)');
    expect(printed()).toContain('REVALIDATE_SECRET (là giá trị mẫu');
    expect(printed()).not.toContain(ENV_EXAMPLE_REVALIDATE_SECRET);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('WEB_ORIGIN host thật bật chế độ chạy thật dù bản build trỏ api local', async () => {
    serverEnv({ NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3001', WEB_ORIGIN: 'https://tickee.vn' });
    await register();
    expect(printed()).toContain('REVALIDATE_SECRET (thiếu)');
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it.each([
    ['local (.env.development, không WEB_ORIGIN)', { NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3001' }],
    [
      'e2e giả lập',
      {
        NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3001',
        WEB_ORIGIN: 'http://localhost:3102',
        REVALIDATE_SECRET: 'e2e-only-revalidate-secret-0123456789abcdef',
      },
    ],
    [
      'e2e full-stack (.env.example)',
      {
        NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3001',
        WEB_ORIGIN: 'http://localhost:3000',
        REVALIDATE_SECRET: ENV_EXAMPLE_REVALIDATE_SECRET,
      },
    ],
  ])('không chạy thật: %s → khởi động như cũ', async (_name, env) => {
    serverEnv(env);
    await register();
    expect(exit).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('next dev (NODE_ENV=development) với origin host thật, cấu hình sai → không kiểm, không thoát', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    serverEnv({ ...LIVE, WEB_ORIGIN: 'http://tickee.vn', REVALIDATE_SECRET: ENV_EXAMPLE_REVALIDATE_SECRET });
    await register();
    expect(exit).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('runtime edge → không kiểm (không có process.exit)', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    serverEnv({ ...LIVE, WEB_ORIGIN: undefined, REVALIDATE_SECRET: undefined });
    await register();
    expect(exit).not.toHaveBeenCalled();
  });
});
