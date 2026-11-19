import 'reflect-metadata';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import pg from 'pg';
import { runDevSeed } from '../dev-seed/seed.js';
import { fakeDemoMerchants } from '../tingee-fake/demo-merchants.js';
import { startTingeeFake, type TingeeFake } from '../tingee-fake/server.js';
import { describeExit, LogSink, startChild, type Child } from './children.js';

/*
 * Stack cho Playwright full-stack (Story 4.7-c, `apps/web/playwright.fullstack.config.ts`):
 * `pnpm --filter @tickee/api e2e:stack`. Theo thứ tự:
 *   1. kiểm Postgres, Mailpit và cổng api/Tingee fake còn trống (thiếu gì thì dừng, nêu tên dịch vụ);
 *   2. tạo lại DB `tickee_e2e` từ đầu bằng superuser Postgres, cấp quyền như `docker/postgres/init.sql`;
 *   3. migrate bằng `tickee_migrator` (`runMigrations` của bản build `dist/`);
 *   4. `db:seed` (BTC demo đã duyệt, có key và tài khoản nhận tiền trỏ vào Tingee fake);
 *   5. Tingee fake (trong tiến trình này), worker và api (`node dist/main.js`, `APP_ROLE=worker|api`).
 * `SIGTERM`/`SIGINT` tắt hết. Không đụng DB `tickee` hay `tickee_test`: tên DB là hằng, không đọc từ env.
 *
 * Env lấy từ `.env.example` ở gốc repo (không đọc `.env`), chỉ đè `NODE_ENV=test` và hai URL DB (sang `tickee_e2e`).
 * Log của từng nguồn có tiền tố trên terminal và nằm ở `E2E_STACK_LOG_DIR` (mặc định
 * `apps/api/test-results/e2e-stack`).
 * Cần `apps/api/dist` (build trước). Code nằm ngoài `src/` nên không vào image.
 */

/** `apps/api`: file này chạy từ `apps/api/node_modules/.cache/e2e-stack/test/e2e-stack/` (outDir của tsconfig). */
const API_DIR = fileURLToPath(new URL('../../../../../', import.meta.url));
const REPO_ROOT = join(API_DIR, '../..');
/** DB của stack; luôn tạo lại từ đầu. */
const E2E_DATABASE = 'tickee_e2e';
/**
 * Superuser Postgres (tạo lại DB), như `docker-compose.yml` và service Postgres của CI. `E2E_POSTGRES_SUPERUSER_URL`
 * chỉ để đổi user/mật khẩu superuser: phải trỏ cùng server `localhost:5432` với `.env.example`, vì migrate, seed, api
 * và worker giữ host và cổng của `DATABASE_URL`/`MIGRATION_DATABASE_URL` trong `.env.example`.
 */
const SUPERUSER_URL =
  process.env.E2E_POSTGRES_SUPERUSER_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';
/** API HTTP của Mailpit (`docker-compose.yml`): api và worker gửi email qua SMTP của nó, test đọc thư ở đây. */
const MAILPIT_URL = 'http://localhost:8025';
const LOG_DIR = process.env.E2E_STACK_LOG_DIR || join(API_DIR, 'test-results', 'e2e-stack');
const READY_TIMEOUT_MS = 120_000;

/** Lỗi dừng stack trước khi chạy test: chỉ in `message` (không stack trace, không chuỗi kết nối). */
class StackError extends Error {}

type StackEnv = Record<string, string>;

/** `.env.example` + `NODE_ENV=test` + DB `tickee_e2e` (giữ user/mật khẩu của `.env.example`). */
function stackEnv(): StackEnv {
  const example = parseEnv(readFileSync(join(REPO_ROOT, '.env.example'), 'utf8'));
  const env: StackEnv = {};
  for (const [key, value] of Object.entries(example)) if (value !== undefined) env[key] = value;
  const onE2eDatabase = (name: string): string => {
    const raw = env[name];
    if (!raw) throw new StackError(`.env.example thiếu ${name}`);
    const url = new URL(raw);
    url.pathname = `/${E2E_DATABASE}`;
    return url.toString();
  };
  return {
    ...env,
    NODE_ENV: 'test',
    DATABASE_URL: onE2eDatabase('DATABASE_URL'),
    MIGRATION_DATABASE_URL: onE2eDatabase('MIGRATION_DATABASE_URL'),
  };
}

/** Cổng của một origin trong env (`PORT` của api, `TINGEE_BASE_URL` của fake). */
function portOf(env: StackEnv, name: 'API_PUBLIC_URL' | 'TINGEE_BASE_URL'): number {
  const url = new URL(env[name] ?? '');
  return Number(url.port || (url.protocol === 'https:' ? 443 : 80));
}

function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : err instanceof Error ? err.name : 'không rõ';
}

/** Postgres nhận superuser chưa; `null` = được. Không in chuỗi kết nối (có mật khẩu). */
async function postgresProblem(): Promise<string | null> {
  const client = new pg.Client({ connectionString: SUPERUSER_URL, connectionTimeoutMillis: 3_000 });
  try {
    await client.connect();
    return null;
  } catch (err) {
    const code = errorCode(err);
    if (code === 'ECONNREFUSED') return 'Postgres chưa chạy ở localhost:5432: `docker compose up -d postgres mailpit`.';
    if (code === '28P01') {
      return 'Postgres từ chối superuser (sai mật khẩu): đặt E2E_POSTGRES_SUPERUSER_URL (mặc định postgres:postgres).';
    }
    return `Không kết nối được Postgres bằng superuser (${code}).`;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function mailpitProblem(): Promise<string | null> {
  try {
    const res = await fetch(`${MAILPIT_URL}/api/v1/info`, { signal: AbortSignal.timeout(3_000) });
    if (res.ok) return null;
    return `Mailpit ở ${MAILPIT_URL} trả HTTP ${res.status}.`;
  } catch {
    return `Mailpit chưa chạy ở ${MAILPIT_URL}: \`docker compose up -d postgres mailpit\`.`;
  }
}

/** Đã có gì nghe ở `localhost:<port>` chưa (vd. `pnpm dev` đang chạy). */
function portBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: 'localhost', port });
    socket.setTimeout(1_000, () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function checkPrerequisites(env: StackEnv): Promise<void> {
  if (!existsSync(join(API_DIR, 'dist', 'main.js'))) {
    throw new StackError(
      'Chưa build api (thiếu apps/api/dist): `pnpm --filter @tickee/api build`, ' +
        'hoặc `pnpm test:e2e:fullstack` ở gốc repo.',
    );
  }
  const ports: [string, number][] = [
    ['api', portOf(env, 'API_PUBLIC_URL')],
    ['Tingee fake', portOf(env, 'TINGEE_BASE_URL')],
  ];
  const problems = await Promise.all([
    postgresProblem(),
    mailpitProblem(),
    ...ports.map(async ([label, port]) =>
      (await portBusy(port)) ? `Cổng ${port} (${label}) đang bận: tắt \`pnpm dev\` rồi chạy lại.` : null,
    ),
  ]);
  const found = problems.filter((p): p is string => p !== null);
  if (found.length > 0) {
    throw new StackError(['Chưa đủ điều kiện dựng stack e2e:', ...found.map((p) => `  - ${p}`)].join('\n'));
  }
}

/** Xóa và tạo lại `tickee_e2e`, chủ là role của `MIGRATION_DATABASE_URL`; quyền như `docker/postgres/init.sql`. */
async function recreateDatabase(env: StackEnv): Promise<void> {
  const owner = decodeURIComponent(new URL(env.MIGRATION_DATABASE_URL!).username);
  const appRole = decodeURIComponent(new URL(env.DATABASE_URL!).username);
  const admin = new pg.Client({ connectionString: SUPERUSER_URL });
  await admin.connect();
  const database = admin.escapeIdentifier(E2E_DATABASE);
  try {
    // FORCE: ngắt kết nối còn sót của lượt trước (api/worker bị giết giữa chừng).
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${database} OWNER ${admin.escapeIdentifier(owner)}`);
  } catch (err) {
    if (errorCode(err) === '42704') {
      throw new StackError(
        `Postgres chưa có role ${owner}: volume được tạo trước docker/postgres/init.sql ` +
          '(`docker compose down -v` rồi up lại).',
      );
    }
    throw err;
  } finally {
    await admin.end();
  }

  const url = new URL(SUPERUSER_URL);
  url.pathname = `/${E2E_DATABASE}`;
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  try {
    await db.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await db.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
    await db.query(`GRANT CONNECT ON DATABASE ${database} TO ${db.escapeIdentifier(appRole)}`);
  } finally {
    await db.end();
  }
}

/**
 * `runMigrations` của bản build: bản biên dịch lại trong `.cache` không tìm được `apps/api/drizzle` (đường dẫn tính
 * theo vị trí file), còn `dist/roles/migrate.js` thì có, đúng như vai `migrate` của image.
 */
async function migrate(env: StackEnv): Promise<void> {
  type MigrateModule = typeof import('../../src/roles/migrate.js');
  const { runMigrations } = (await import(
    pathToFileURL(join(API_DIR, 'dist', 'roles', 'migrate.js')).href
  )) as MigrateModule;
  await runMigrations({ MIGRATION_DATABASE_URL: env.MIGRATION_DATABASE_URL! });
}

async function seed(env: StackEnv, log: LogSink): Promise<void> {
  const code = await runDevSeed([], env, { out: (line) => log.line(line), err: (line) => log.error(line) });
  if (code !== 0) throw new StackError(`db:seed thoát mã ${code} (xem dòng [seed] ở trên).`);
}

/** Chờ `GET /readyz` của api trả 200 (DB + LISTEN) hoặc hết giờ; `false` khi hết giờ. */
async function waitForApi(env: StackEnv): Promise<boolean> {
  const url = `${env.API_PUBLIC_URL}/readyz`;
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2_000) })).ok) return true;
    } catch {
      // api chưa nghe cổng
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function main(): Promise<void> {
  mkdirSync(LOG_DIR, { recursive: true });
  const log = new LogSink('e2e-stack', LOG_DIR);
  /** Nguồn log không thuộc tiến trình con nào (tiến trình con tự đóng log của nó). */
  const sinks: LogSink[] = [];
  const sink = (name: string): LogSink => {
    const created = new LogSink(name, LOG_DIR);
    sinks.push(created);
    return created;
  };
  const children: Child[] = [];
  let fake: TingeeFake | null = null;
  let stopping = false;

  const shutdown = async (exitCode: number): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await Promise.all(children.map((child) => child.stop()));
    await fake?.close().catch(() => undefined);
    await Promise.all([...sinks, log].map((s) => s.close()));
    process.exit(exitCode);
  };
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      log.line(`Nhận ${signal}: tắt stack.`);
      void shutdown(0);
    });
  }

  try {
    const env = stackEnv();
    await checkPrerequisites(env);
    log.line(`Tạo lại DB ${E2E_DATABASE}`);
    await recreateDatabase(env);
    log.line('Migrate (tickee_migrator)');
    await migrate(env);
    await seed(env, sink('seed'));
    // SIGTERM giữa lúc dựng: không khởi thêm gì.
    if (stopping) return;

    const fakeLog = sink('tingee-fake');
    fake = await startTingeeFake({
      merchants: fakeDemoMerchants(env.API_PUBLIC_URL),
      port: portOf(env, 'TINGEE_BASE_URL'),
      host: '127.0.0.1',
      log: (line) => fakeLog.line(line),
    });
    for (const role of ['worker', 'api'] as const) {
      const child = startChild(role, ['dist/main.js'], {
        cwd: API_DIR,
        env: { ...process.env, ...env, APP_ROLE: role },
        logDir: LOG_DIR,
      });
      children.push(child);
      void child.exited.then((exit) => {
        if (stopping) return;
        log.error(`${role} thoát (${describeExit(exit)}): xem ${child.log.path}. Tắt stack.`);
        void shutdown(1);
      });
    }
    if (await waitForApi(env)) {
      log.line(
        `Sẵn sàng: api ${env.API_PUBLIC_URL}, Tingee fake ${fake.url}, DB ${E2E_DATABASE}, Mailpit ${MAILPIT_URL}. ` +
          `Log ở ${LOG_DIR}. Ctrl+C để tắt.`,
      );
    } else if (!stopping) {
      log.error(`api chưa sẵn sàng sau ${READY_TIMEOUT_MS / 1000} giây: xem ${LOG_DIR}/api.log. Tắt stack.`);
      await shutdown(1);
    }
  } catch (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.error(err instanceof StackError ? err.message : `Không dựng được stack: ${detail}`);
    await shutdown(1);
  }
}

await main();
