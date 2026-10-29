import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { apiConfig, databaseUrl, migrationDatabaseUrl } from './helpers.js';

/** Env tối thiểu cho vai api, lấy từ cấu hình test (không kế thừa env của tiến trình test). */
function apiRoleEnv(): Record<string, string> {
  const c = apiConfig();
  return {
    APP_ROLE: 'api',
    DATABASE_URL: c.DATABASE_URL,
    BETTER_AUTH_SECRET: c.BETTER_AUTH_SECRET,
    API_PUBLIC_URL: c.API_PUBLIC_URL,
    WEB_ORIGIN: c.WEB_ORIGIN,
    SMTP_URL: c.SMTP_URL,
    EMAIL_FROM: c.EMAIL_FROM,
    GOOGLE_CLIENT_ID: c.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: c.GOOGLE_CLIENT_SECRET,
  };
}

// Chạy đúng artefact sẽ vào image: dist/main.js (turbo `test` phụ thuộc `build`).
const MAIN = fileURLToPath(new URL('../dist/main.js', import.meta.url));
const SECRET = 's3cret-Gi4-tri';

interface Proc {
  child: ChildProcess;
  output: () => string;
  exit: Promise<number | null>;
}

/** Chạy main.js với env tối thiểu (không kế thừa DATABASE_URL… của tiến trình test). */
function start(env: Record<string, string>): Proc {
  const child = spawn(process.execPath, [MAIN], {
    env: { PATH: process.env.PATH ?? '', LOG_LEVEL: 'info', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout?.on('data', (d: Buffer) => (out += d.toString('utf8')));
  child.stderr?.on('data', (d: Buffer) => (out += d.toString('utf8')));
  const exit = once(child, 'exit').then(([code]) => code as number | null);
  return { child, output: () => out, exit };
}

async function run(env: Record<string, string>): Promise<{ code: number | null; output: string }> {
  const p = start(env);
  const code = await p.exit;
  return { code, output: p.output() };
}

async function waitForOutput(p: Proc, text: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!p.output().includes(text)) {
    if (p.child.exitCode !== null || p.child.signalCode !== null) {
      throw new Error(`Tiến trình thoát sớm (${p.child.exitCode ?? p.child.signalCode}):\n${p.output()}`);
    }
    if (Date.now() > deadline) throw new Error(`Không thấy "${text}" sau ${timeoutMs}ms:\n${p.output()}`);
    await new Promise((r) => setTimeout(r, 100));
  }
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

describe('main.js theo APP_ROLE (tiến trình thật)', () => {
  beforeAll(() => {
    if (!existsSync(MAIN)) throw new Error(`Thiếu ${MAIN}: chạy build trước (pnpm turbo test tự làm)`);
  });

  describe('vai migrate', () => {
    it('MIGRATION_DATABASE_URL hợp lệ → exit 0', async () => {
      const { code, output } = await run({ APP_ROLE: 'migrate', MIGRATION_DATABASE_URL: migrationDatabaseUrl() });
      expect(code, output).toBe(0);
      expect(output).toContain('migrate xong');
    });

    it('DB không tới được → exit ≠ 0, không in mật khẩu', async () => {
      const { code, output } = await run({
        APP_ROLE: 'migrate',
        MIGRATION_DATABASE_URL: `postgresql://tickee_migrator:${SECRET}@127.0.0.1:1/tickee_test`,
      });
      expect(code).not.toBe(0);
      expect(output).not.toContain(SECRET);
    });
  });

  describe('thiếu/sai env → dừng ngay, nêu tên biến, không in giá trị', () => {
    it.each([
      ['APP_ROLE=foo', { APP_ROLE: `foo-${SECRET}` }, 'APP_ROLE'],
      ['APP_ROLE=api thiếu DATABASE_URL', { APP_ROLE: 'api' }, 'DATABASE_URL'],
      ['DATABASE_URL mysql://', { APP_ROLE: 'api', DATABASE_URL: `mysql://root:${SECRET}@db/x` }, 'DATABASE_URL'],
      ['APP_ROLE=migrate thiếu MIGRATION_DATABASE_URL', { APP_ROLE: 'migrate' }, 'MIGRATION_DATABASE_URL'],
    ])('%s', async (_name, env, variable) => {
      const { code, output } = await run(env);
      expect(code).not.toBe(0);
      expect(output).toContain(variable);
      expect(output).not.toContain(SECRET);
    });
  });

  it('vai api: /healthz 200 có x-request-id, SIGTERM → exit 0', async () => {
    const port = await freePort();
    const p = start({ ...apiRoleEnv(), PORT: String(port) });
    try {
      await waitForOutput(p, `api đang nghe cổng ${port}`);
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-request-id')).toBeTruthy();
      p.child.kill('SIGTERM');
      expect(await p.exit, p.output()).toBe(0);
    } finally {
      if (p.child.exitCode === null && p.child.signalCode === null) p.child.kill('SIGKILL');
    }
  });

  it('vai worker: chạy, không mở HTTP, SIGTERM → stop graceful, exit 0', async () => {
    const p = start({ APP_ROLE: 'worker', DATABASE_URL: databaseUrl() });
    try {
      await waitForOutput(p, 'worker đã chạy');
      const out = p.output();
      expect(out).not.toContain('Nest application successfully started');
      expect(out).not.toContain('Mapped {');
      expect(out).not.toContain('đang nghe cổng');
      p.child.kill('SIGTERM');
      expect(await p.exit, p.output()).toBe(0);
      expect(p.output()).toContain('pg-boss đã dừng');
    } finally {
      if (p.child.exitCode === null && p.child.signalCode === null) p.child.kill('SIGKILL');
    }
  });
});
