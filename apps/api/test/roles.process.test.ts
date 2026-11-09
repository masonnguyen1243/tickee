import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../src/platform/db/index.js';
import { apiConfig, databaseUrl, migrationDatabaseUrl, TEST_REVALIDATE_SECRET } from './helpers.js';

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
    TINGEE_BASE_URL: c.TINGEE_BASE_URL,
    TINGEE_CREDENTIAL_KEYS: c.TINGEE_CREDENTIAL_KEYS,
  };
}

// Chạy đúng artefact sẽ vào image: dist/main.js (turbo `test` phụ thuộc `build`).
const MAIN = fileURLToPath(new URL('../dist/main.js', import.meta.url));
const ADMIN_CLI = fileURLToPath(new URL('../dist/roles/admin-cli.js', import.meta.url));
const SECRET = 's3cret-Gi4-tri';

interface Proc {
  child: ChildProcess;
  output: () => string;
  exit: Promise<number | null>;
}

/** Chạy main.js (hoặc `script` kèm `args`) với env tối thiểu (không kế thừa DATABASE_URL… của tiến trình test). */
function start(env: Record<string, string>, script = MAIN, args: readonly string[] = []): Proc {
  const child = spawn(process.execPath, [script, ...args], {
    env: { PATH: process.env.PATH ?? '', LOG_LEVEL: 'info', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout?.on('data', (d: Buffer) => (out += d.toString('utf8')));
  child.stderr?.on('data', (d: Buffer) => (out += d.toString('utf8')));
  const exit = once(child, 'exit').then(([code]) => code as number | null);
  return { child, output: () => out, exit };
}

async function run(
  env: Record<string, string>,
  script = MAIN,
  args: readonly string[] = [],
): Promise<{ code: number | null; output: string }> {
  const p = start(env, script, args);
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
      [
        'APP_ROLE=worker thiếu REVALIDATE_SECRET',
        {
          APP_ROLE: 'worker',
          DATABASE_URL: `postgresql://tickee_app:${SECRET}@127.0.0.1:1/tickee_test`,
          WEB_ORIGIN: 'http://web.tickee.test',
          SMTP_URL: 'smtp://127.0.0.1:1',
          EMAIL_FROM: 'Tickee <no-reply@tickee.test>',
        },
        'REVALIDATE_SECRET',
      ],
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
    const c = apiConfig();
    const p = start({
      APP_ROLE: 'worker',
      DATABASE_URL: databaseUrl(),
      WEB_ORIGIN: c.WEB_ORIGIN,
      SMTP_URL: c.SMTP_URL,
      EMAIL_FROM: c.EMAIL_FROM,
      REVALIDATE_SECRET: TEST_REVALIDATE_SECRET,
    });
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

describe('CLI admin:grant / admin:revoke (tiến trình thật, role tickee_migrator)', () => {
  let db: Database;

  beforeAll(() => {
    if (!existsSync(ADMIN_CLI)) throw new Error(`Thiếu ${ADMIN_CLI}: chạy build trước (pnpm turbo test tự làm)`);
    db = new Database({ connectionString: databaseUrl(), max: 1 });
  });
  afterAll(async () => {
    await db.close();
  });

  const cli = (args: readonly string[], env: Record<string, string> = { MIGRATION_DATABASE_URL: migrationDatabaseUrl() }) =>
    run(env, ADMIN_CLI, args);

  /** Tài khoản mới; mặc định đã bật 2FA (`admin:grant` chỉ cấp cho tài khoản đã bật, AD-26). */
  async function createUser({ twoFactor = true } = {}): Promise<{ id: string; email: string }> {
    const email = `cli-${randomUUID()}@vidu.vn`;
    const { rows } = await db.pool.query<{ id: string }>(
      'INSERT INTO users (email, two_factor_enabled) VALUES ($1, $2) RETURNING id',
      [email, twoFactor],
    );
    return { id: rows[0]!.id, email };
  }

  async function flagOf(userId: string): Promise<boolean> {
    const { rows } = await db.pool.query<{ platform_admin: boolean }>('SELECT platform_admin FROM users WHERE id = $1', [
      userId,
    ]);
    return rows[0]!.platform_admin;
  }

  async function audits(targetId: string) {
    const { rows } = await db.pool.query<{
      action: string;
      actor_user_id: string;
      organization_id: string | null;
      target_type: string;
      changed_fields: string[];
    }>(
      `SELECT action, actor_user_id, organization_id, target_type, changed_fields FROM audit_events
       WHERE target_id = $1 AND action LIKE 'platform_admin.%' ORDER BY created_at, id`,
      [targetId],
    );
    return rows;
  }

  it('lần đầu tự cấp cho chính mình; chạy lại → "không đổi", không audit thêm', async () => {
    const me = await createUser();
    const first = await cli(['grant', me.email.toUpperCase(), '--by', me.email]);
    expect(first.code, first.output).toBe(0);
    expect(first.output).toMatch(/đã cấp/i);
    expect(await flagOf(me.id)).toBe(true);
    expect(await audits(me.id)).toEqual([
      {
        action: 'platform_admin.granted',
        actor_user_id: me.id,
        organization_id: null,
        target_type: 'user',
        changed_fields: ['platform_admin'],
      },
    ]);

    // `--` tách tham số (như `pnpm … admin:grant -- <email> --by …`) được bỏ qua.
    const again = await cli(['grant', '--', me.email, `--by=${me.email}`]);
    expect(again.code, again.output).toBe(0);
    expect(again.output).toMatch(/không đổi/i);
    expect(await audits(me.id)).toHaveLength(1);
  });

  it('cấp rồi thu cho người khác: actor là tài khoản --by', async () => {
    const operator = await createUser();
    const target = await createUser();
    expect((await cli(['grant', target.email, '--by', operator.email])).code).toBe(0);
    const revoked = await cli(['revoke', target.email, '--by', operator.email]);
    expect(revoked.code, revoked.output).toBe(0);
    expect(revoked.output).toMatch(/đã thu/i);
    expect(await flagOf(target.id)).toBe(false);
    expect((await audits(target.id)).map((a) => [a.action, a.actor_user_id])).toEqual([
      ['platform_admin.granted', operator.id],
      ['platform_admin.revoked', operator.id],
    ]);

    const noop = await cli(['revoke', target.email, '--by', operator.email]);
    expect(noop.code).toBe(0);
    expect(noop.output).toMatch(/không đổi/i);
    expect(await audits(target.id)).toHaveLength(2);
  });

  it.each([
    ['email không tồn tại', (u: { email: string }) => ['grant', `khong-co-${randomUUID()}@vidu.vn`, '--by', u.email]],
    ['--by không tồn tại', (u: { email: string }) => ['grant', u.email, '--by', `khong-co-${randomUUID()}@vidu.vn`]],
    ['thiếu --by', (u: { email: string }) => ['grant', u.email]],
    ['--by thiếu giá trị', (u: { email: string }) => ['grant', u.email, '--by']],
    ['thiếu email', (u: { email: string }) => ['grant', '--by', u.email]],
    ['lệnh lạ', (u: { email: string }) => ['promote', u.email, '--by', u.email]],
  ])('%s → thoát ≠ 0, không đổi gì', async (_name, argsOf) => {
    const user = await createUser();
    const { code, output } = await cli(argsOf(user));
    expect(code, output).not.toBe(0);
    expect(output.trim()).not.toBe('');
    expect(await flagOf(user.id)).toBe(false);
    expect(await audits(user.id)).toEqual([]);
  });

  it('grant cho tài khoản chưa bật 2FA → thoát ≠ 0, báo cần bật 2FA, không đổi cờ, không audit; revoke vẫn chạy', async () => {
    const operator = await createUser();
    const target = await createUser({ twoFactor: false });
    const refused = await cli(['grant', target.email, '--by', operator.email]);
    expect(refused.code, refused.output).not.toBe(0);
    expect(refused.output).toMatch(/chưa bật xác thực hai lớp/i);
    expect(await flagOf(target.id)).toBe(false);
    expect(await audits(target.id)).toEqual([]);

    // Người chạy lệnh không cần bật 2FA; chỉ tài khoản được cấp.
    const plainOperator = await createUser({ twoFactor: false });
    const ok = await createUser();
    expect((await cli(['grant', ok.email, '--by', plainOperator.email])).code).toBe(0);
    expect(await flagOf(ok.id)).toBe(true);

    // revoke không đổi: thu được cả khi target đã tắt 2FA.
    await db.pool.query('UPDATE users SET two_factor_enabled = false WHERE id = $1', [ok.id]);
    const revoked = await cli(['revoke', ok.email, '--by', operator.email]);
    expect(revoked.code, revoked.output).toBe(0);
    expect(await flagOf(ok.id)).toBe(false);
  });

  it('thiếu MIGRATION_DATABASE_URL hoặc DB không tới được → thoát ≠ 0, không in mật khẩu', async () => {
    const user = await createUser();
    const missing = await cli(['grant', user.email, '--by', user.email], {});
    expect(missing.code).not.toBe(0);
    expect(missing.output).toContain('MIGRATION_DATABASE_URL');

    const unreachable = await cli(['grant', user.email, '--by', user.email], {
      MIGRATION_DATABASE_URL: `postgresql://tickee_migrator:${SECRET}@127.0.0.1:1/tickee_test`,
    });
    expect(unreachable.code).not.toBe(0);
    expect(unreachable.output).not.toContain(SECRET);
    expect(await flagOf(user.id)).toBe(false);
  });

  it('gọi qua symlink vẫn chạy (không thoát 0 trong im lặng)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tickee-admin-cli-'));
    try {
      const link = join(dir, 'admin-cli.js');
      symlinkSync(ADMIN_CLI, link);
      const user = await createUser();
      const missingBy = await run({ MIGRATION_DATABASE_URL: migrationDatabaseUrl() }, link, ['grant', user.email]);
      expect(missingBy.code, missingBy.output).toBe(2);
      expect(missingBy.output).toContain('--by');
      const granted = await run({ MIGRATION_DATABASE_URL: migrationDatabaseUrl() }, link, [
        'grant',
        user.email,
        '--by',
        user.email,
      ]);
      expect(granted.code, granted.output).toBe(0);
      expect(await flagOf(user.id)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('chạy bằng DATABASE_URL của tickee_app thì Postgres từ chối (không có UPDATE trên cột)', async () => {
    const user = await createUser();
    const { code, output } = await cli(['grant', user.email, '--by', user.email], { MIGRATION_DATABASE_URL: databaseUrl() });
    expect(code, output).not.toBe(0);
    expect(output).toContain('42501');
    expect(await flagOf(user.id)).toBe(false);
    expect(await audits(user.id)).toEqual([]);
  });
});
