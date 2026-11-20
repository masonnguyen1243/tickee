import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildEnvIssues,
  ENV_EXAMPLE_REVALIDATE_SECRET,
  ENV_REASONS,
  hasRealHost,
  isLiveWeb,
  isLocalHost,
  revalidateSecretReason,
  runtimeEnvIssues,
  runtimeEnvMessage,
  usableRevalidateSecret,
  webRuntimeEnv,
} from '@/lib/production-env';

/** Luật cấu hình production phía web (Story 4.7-f). */

/** `.env.example` ở gốc repo, đúng như `.env` local được tạo từ nó. */
const envExample = parseEnv(readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8'));

const SECRET = 'r1eng-cua-moi-truong-that-0123456789abcdef';
const LIVE_API = 'https://api.tickee.vn';
/** Web chạy thật, cấu hình hợp lệ. */
const LIVE_ENV = { NEXT_PUBLIC_API_BASE_URL: LIVE_API, WEB_ORIGIN: 'https://tickee.vn', REVALIDATE_SECRET: SECRET };

describe('isLocalHost / hasRealHost', () => {
  it.each([
    'localhost',
    'LOCALHOST',
    'web.localhost',
    'a.b.localhost',
    '127.0.0.1',
    '127.1.2.3',
    '127.255.255.255',
    '::1',
    '[::1]',
  ])('%s là host local', (host) => {
    expect(isLocalHost(host)).toBe(true);
  });

  it.each([
    'tickee.vn',
    'api.tickee.vn',
    'localhost.tickee.vn',
    'mylocalhost',
    '128.0.0.1',
    '10.0.0.1',
    '0.0.0.0',
    '[::2]',
    'web.tickee.test',
  ])('%s là host thật', (host) => {
    expect(isLocalHost(host)).toBe(false);
  });

  it('hasRealHost: URL đã chuẩn hóa; không đặt, rỗng hay không phải URL thì không có host thật', () => {
    expect(hasRealHost('https://api.tickee.vn')).toBe(true);
    expect(hasRealHost('http://api.tickee.vn:8080/v1')).toBe(true);
    for (const local of ['http://localhost:3001', 'http://127.1:3001', 'http://[::1]:3001', 'http://WEB.localhost']) {
      expect(hasRealHost(local), local).toBe(false);
    }
    for (const notUrl of [undefined, '', 'api.tickee.vn', 'khong phai url']) {
      expect(hasRealHost(notUrl), String(notUrl)).toBe(false);
    }
  });
});

describe('isLiveWeb — web chạy thật theo host của origin', () => {
  it('NEXT_PUBLIC_API_BASE_URL hoặc WEB_ORIGIN có host thật → chạy thật', () => {
    expect(isLiveWeb({ NEXT_PUBLIC_API_BASE_URL: LIVE_API })).toBe(true);
    // Bản build local đem đi chạy thật vẫn bị kiểm.
    expect(isLiveWeb({ NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3001', WEB_ORIGIN: 'http://tickee.vn' })).toBe(true);
  });

  it('server dev (NODE_ENV=development) không bao giờ chạy thật, kể cả origin host thật', () => {
    expect(isLiveWeb({ ...LIVE_ENV, NODE_ENV: 'development' })).toBe(false);
    expect(runtimeEnvIssues({ NODE_ENV: 'development', WEB_ORIGIN: 'http://tickee.vn', REVALIDATE_SECRET: 'ngan' })).toEqual(
      [],
    );
    const devSample = { ...LIVE_ENV, NODE_ENV: 'development', REVALIDATE_SECRET: ENV_EXAMPLE_REVALIDATE_SECRET };
    expect(usableRevalidateSecret(devSample)).toBe(ENV_EXAMPLE_REVALIDATE_SECRET);
    // `next start` luôn production: vẫn chạy thật.
    expect(isLiveWeb({ ...LIVE_ENV, NODE_ENV: 'production' })).toBe(true);
  });

  it('local, e2e, CI full-stack: origin localhost hoặc không đặt → không chạy thật', () => {
    expect(isLiveWeb({})).toBe(false);
    expect(isLiveWeb({ NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3001' })).toBe(false);
    const e2e = { NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3001', WEB_ORIGIN: 'http://localhost:3102' };
    expect(isLiveWeb(e2e)).toBe(false);
    // `.env.example` (bộ full-stack dùng): web và api ở localhost.
    expect(isLiveWeb(envExample)).toBe(false);
  });
});

describe('runtimeEnvIssues — lúc server khởi động', () => {
  it('chạy thật, hợp lệ → không vi phạm', () => {
    expect(runtimeEnvIssues(LIVE_ENV)).toEqual([]);
    // Secret đúng 32 ký tự là đủ, như worker.
    expect(runtimeEnvIssues({ ...LIVE_ENV, REVALIDATE_SECRET: 'x'.repeat(32) })).toEqual([]);
  });

  it.each([
    ['thiếu', undefined, ENV_REASONS.missing],
    ['rỗng', '', ENV_REASONS.missing],
    ['http', 'http://tickee.vn', ENV_REASONS.https],
    ['không phải URL', 'tickee.vn', ENV_REASONS.https],
  ])('WEB_ORIGIN %s → vi phạm, không nêu giá trị', (_name, WEB_ORIGIN, reason) => {
    const issues = runtimeEnvIssues({ ...LIVE_ENV, WEB_ORIGIN });
    expect(issues).toEqual([{ variable: 'WEB_ORIGIN', reason }]);
    if (WEB_ORIGIN) expect(runtimeEnvMessage(issues)).not.toContain(WEB_ORIGIN);
  });

  it.each([
    ['giá trị mẫu', ENV_EXAMPLE_REVALIDATE_SECRET, ENV_REASONS.example],
    ['giá trị mẫu kèm dòng mới cuối', `${ENV_EXAMPLE_REVALIDATE_SECRET}\n`, ENV_REASONS.example],
    ['giá trị mẫu kèm khoảng trắng', `  ${ENV_EXAMPLE_REVALIDATE_SECRET} `, ENV_REASONS.example],
    ['20 ký tự', 'abcdefghij0123456789', ENV_REASONS.tooShort],
    ['31 ký tự', 'y'.repeat(31), ENV_REASONS.tooShort],
    ['thiếu', undefined, ENV_REASONS.missing],
    ['rỗng', '', ENV_REASONS.missing],
  ])('REVALIDATE_SECRET %s → vi phạm, không nêu giá trị', (_name, REVALIDATE_SECRET, reason) => {
    const issues = runtimeEnvIssues({ ...LIVE_ENV, REVALIDATE_SECRET });
    expect(issues).toEqual([{ variable: 'REVALIDATE_SECRET', reason }]);
    if (REVALIDATE_SECRET?.trim()) expect(runtimeEnvMessage(issues)).not.toContain(REVALIDATE_SECRET.trim());
  });

  it('nhiều lỗi → một danh sách nêu cả hai biến, theo thứ tự WEB_ORIGIN, REVALIDATE_SECRET', () => {
    const issues = runtimeEnvIssues({
      ...LIVE_ENV,
      WEB_ORIGIN: 'http://tickee.vn',
      REVALIDATE_SECRET: ENV_EXAMPLE_REVALIDATE_SECRET,
    });
    expect(issues).toEqual([
      { variable: 'WEB_ORIGIN', reason: ENV_REASONS.https },
      { variable: 'REVALIDATE_SECRET', reason: ENV_REASONS.example },
    ]);
    const message = runtimeEnvMessage(issues);
    expect(message).toContain(`WEB_ORIGIN (${ENV_REASONS.https})`);
    expect(message).toContain(`REVALIDATE_SECRET (${ENV_REASONS.example})`);
    expect(message).not.toContain('http://tickee.vn');
    expect(message).not.toContain(ENV_EXAMPLE_REVALIDATE_SECRET);
  });

  it('không chạy thật (local, e2e) → không kiểm gì, kể cả secret mẫu hay thiếu WEB_ORIGIN', () => {
    expect(runtimeEnvIssues({ ...envExample })).toEqual([]);
    expect(runtimeEnvIssues({ NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3001' })).toEqual([]);
    expect(
      runtimeEnvIssues({
        NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3001',
        WEB_ORIGIN: 'http://localhost:3102',
        REVALIDATE_SECRET: 'ngan',
      }),
    ).toEqual([]);
  });
});

describe('buildEnvIssues — luật của next build', () => {
  it('host thật phải là https; host local hoặc không phải URL thì không kiểm', () => {
    expect(buildEnvIssues({ NEXT_PUBLIC_API_BASE_URL: LIVE_API })).toEqual([]);
    expect(buildEnvIssues({ NEXT_PUBLIC_API_BASE_URL: 'http://api.tickee.vn' })).toEqual([
      { variable: 'NEXT_PUBLIC_API_BASE_URL', reason: ENV_REASONS.buildHttps },
    ]);
    for (const local of ['http://localhost:3001', 'http://127.0.0.1:3001', 'http://[::1]:3001']) {
      expect(buildEnvIssues({ NEXT_PUBLIC_API_BASE_URL: local }), local).toEqual([]);
    }
    expect(buildEnvIssues({})).toEqual([]);
  });
});

describe('usableRevalidateSecret — secret mà route /api/revalidate dùng', () => {
  it('thiếu → null (503) ở mọi chế độ', () => {
    expect(usableRevalidateSecret({})).toBeNull();
    expect(usableRevalidateSecret({ ...LIVE_ENV, REVALIDATE_SECRET: '' })).toBeNull();
  });

  it('chạy thật: secret mẫu hoặc ngắn → null; hợp lệ → secret', () => {
    expect(usableRevalidateSecret({ ...LIVE_ENV, REVALIDATE_SECRET: ENV_EXAMPLE_REVALIDATE_SECRET })).toBeNull();
    expect(usableRevalidateSecret({ ...LIVE_ENV, REVALIDATE_SECRET: 'ngan' })).toBeNull();
    expect(usableRevalidateSecret(LIVE_ENV)).toBe(SECRET);
    // Chỉ secret quyết định: WEB_ORIGIN sai đã chặn ở lúc khởi động, route không trả 503 vì nó.
    expect(usableRevalidateSecret({ ...LIVE_ENV, WEB_ORIGIN: undefined })).toBe(SECRET);
  });

  it('không chạy thật: mọi secret khác rỗng, như cũ', () => {
    expect(usableRevalidateSecret(envExample)).toBe(ENV_EXAMPLE_REVALIDATE_SECRET);
    const local = { NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3001', REVALIDATE_SECRET: 'ngan' };
    expect(usableRevalidateSecret(local)).toBe('ngan');
  });
});

describe('webRuntimeEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('đọc NODE_ENV và ba biến của server web từ process.env', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', LIVE_API);
    vi.stubEnv('WEB_ORIGIN', 'https://tickee.vn');
    vi.stubEnv('REVALIDATE_SECRET', SECRET);
    expect(webRuntimeEnv()).toEqual({ ...LIVE_ENV, NODE_ENV: 'production' });
  });
});

describe('.env.example còn khớp giá trị mẫu trong code (sửa file mà quên sửa code thì đỏ)', () => {
  it('REVALIDATE_SECRET của .env.example (bản bỏ comment ở phần web cũng vậy) là giá trị mẫu bị từ chối', () => {
    expect(envExample.REVALIDATE_SECRET).toBe(ENV_EXAMPLE_REVALIDATE_SECRET);
    expect(revalidateSecretReason(envExample.REVALIDATE_SECRET)).toBe(ENV_REASONS.example);
    // Dòng `# REVALIDATE_SECRET=…` gợi ý cho web (apps/web/.env.local) cũng phải là đúng giá trị mẫu.
    const raw = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
    const commented = [...raw.matchAll(/^#\s*REVALIDATE_SECRET=(.*)$/gm)].map((m) => m[1]?.trim());
    expect(commented.length).toBeGreaterThan(0);
    for (const value of commented) expect(value).toBe(ENV_EXAMPLE_REVALIDATE_SECRET);
  });
});
