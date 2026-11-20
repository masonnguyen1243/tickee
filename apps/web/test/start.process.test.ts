import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

import { beforeAll, describe, expect, it } from 'vitest';

/*
 * `next start` thật trên bản build có sẵn (Story 4.7-f): giữ việc Next nạp `instrumentation.ts` lúc khởi động và nhúng
 * `process.env.NEXT_PUBLIC_API_BASE_URL` lúc build vào bundle server. Test có mock (`instrumentation.test.ts`) không bắt
 * được hai điều này. Turbo `test` phụ thuộc `build`; lệnh gốc và CI build với `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001`.
 */

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUILD_ID = fileURLToPath(new URL('../.next/BUILD_ID', import.meta.url));
const NEXT_BIN = createRequire(import.meta.url).resolve('next/dist/bin/next');
/** Giá trị mẫu của `REVALIDATE_SECRET` trong `.env.example`. */
const SAMPLE_SECRET = parseEnv(readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8')).REVALIDATE_SECRET ?? '';
const TIMEOUT_MS = 60_000;

interface Proc {
  child: ChildProcess;
  output: () => string;
  exit: Promise<number | null>;
}

async function freePort(): Promise<number> {
  const srv = createServer();
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  const address = srv.address();
  srv.close();
  if (!address || typeof address === 'string') throw new Error('Không lấy được cổng trống');
  return address.port;
}

/**
 * `next start -p <port>` với env tối thiểu (không kế thừa env của tiến trình test; `NODE_ENV=production` như mọi lần
 * `next start`, thay cho `test` của Vitest). Biến đặt `''` coi như thiếu, và Next không lấy giá trị từ
 * `apps/web/.env.local` cho biến đã có trong env (kể cả rỗng).
 */
function start(env: Record<string, string>, port: number): Proc {
  const child = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(port)], {
    cwd: WEB_ROOT,
    env: { PATH: process.env.PATH ?? '', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout?.on('data', (d: Buffer) => (out += d.toString('utf8')));
  child.stderr?.on('data', (d: Buffer) => (out += d.toString('utf8')));
  const exit = once(child, 'exit').then(([code]) => code as number | null);
  return { child, output: () => out, exit };
}

function killIfRunning(p: Proc): void {
  if (p.child.exitCode === null && p.child.signalCode === null) p.child.kill('SIGKILL');
}

/** Chờ tiến trình tự thoát; quá hạn thì ném lỗi kèm output. */
async function exitCode(p: Proc, timeoutMs = 30_000): Promise<number | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`next start không thoát sau ${timeoutMs}ms:\n${p.output()}`)), timeoutMs);
  });
  try {
    return await Promise.race([p.exit, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

describe('next start thật (Story 4.7-f)', () => {
  beforeAll(() => {
    if (!existsSync(BUILD_ID)) {
      throw new Error(
        `Thiếu bản build web (${BUILD_ID}): chạy build trước, vd. \`pnpm test\` ở gốc repo (turbo build rồi test) hoặc ` +
          '`NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 pnpm --filter @tickee/web build`',
      );
    }
    expect(SAMPLE_SECRET.length).toBeGreaterThan(0);
  });

  it(
    'WEB_ORIGIN host thật, REVALIDATE_SECRET là giá trị mẫu → thoát mã 1, nêu lý do, không in giá trị',
    async () => {
      const p = start({ WEB_ORIGIN: 'https://tickee.example', REVALIDATE_SECRET: SAMPLE_SECRET }, await freePort());
      try {
        expect(await exitCode(p), p.output()).toBe(1);
        expect(p.output()).toContain('REVALIDATE_SECRET (là giá trị mẫu');
        expect(p.output()).not.toContain(SAMPLE_SECRET);
      } finally {
        killIfRunning(p);
      }
    },
    TIMEOUT_MS,
  );

  it(
    'WEB_ORIGIN host thật, không có REVALIDATE_SECRET → thoát mã 1, "thiếu"',
    async () => {
      const p = start({ WEB_ORIGIN: 'https://tickee.example', REVALIDATE_SECRET: '' }, await freePort());
      try {
        expect(await exitCode(p), p.output()).toBe(1);
        expect(p.output()).toContain('REVALIDATE_SECRET (thiếu)');
      } finally {
        killIfRunning(p);
      }
    },
    TIMEOUT_MS,
  );

  it(
    'NEXT_PUBLIC_API_BASE_URL host thật chỉ lúc chạy, không WEB_ORIGIN, không secret → giá trị nhúng (localhost) thắng, server lên',
    async () => {
      const port = await freePort();
      const p = start(
        { NEXT_PUBLIC_API_BASE_URL: 'https://api.example.test', WEB_ORIGIN: '', REVALIDATE_SECRET: '' },
        port,
      );
      try {
        // Next chờ `register()` xong rồi mới xử lý request: có phản hồi là đã qua bước kiểm lúc khởi động.
        const deadline = Date.now() + 30_000;
        let status: number | undefined;
        while (status === undefined) {
          if (p.child.exitCode !== null || p.child.signalCode !== null) {
            throw new Error(`next start thoát sớm (${p.child.exitCode ?? p.child.signalCode}):\n${p.output()}`);
          }
          if (Date.now() > deadline) throw new Error(`next start không phản hồi sau 30 giây:\n${p.output()}`);
          try {
            status = (await fetch(`http://localhost:${port}/api/revalidate`, { method: 'POST' })).status;
          } catch {
            await new Promise((r) => setTimeout(r, 200));
          }
        }
        // Không chạy thật, thiếu secret → 503 như trước 4.7-f.
        expect(status, p.output()).toBe(503);
        expect(p.child.exitCode).toBeNull();
        expect(p.output()).not.toContain('Cấu hình web không hợp lệ');
        p.child.kill('SIGTERM');
        await exitCode(p);
      } finally {
        killIfRunning(p);
      }
    },
    TIMEOUT_MS,
  );
});
