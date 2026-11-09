import 'reflect-metadata';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { EmailAddress } from '@tickee/contracts';
import { findUserIdByEmail, hasTwoFactorEnabled, setPlatformAdmin } from '../modules/identity/index.js';
import { audit } from '../platform/audit/index.js';
import { ConfigError, loadConfig, type MigrateConfig } from '../platform/config/index.js';
import { Database } from '../platform/db/index.js';

/*
 * CLI cấp/thu cờ Quản trị Tingee (`users.platform_admin`, AD-26) — không có UI hay API nào làm việc này.
 *   pnpm --filter @tickee/api admin:grant  <email> --by <email người chạy>
 *   pnpm --filter @tickee/api admin:revoke <email> --by <email người chạy>
 * Chạy bằng role `tickee_migrator` (`MIGRATION_DATABASE_URL`, như vai `migrate`): `tickee_app` không có UPDATE trên
 * cột này. `--by` là email một Tài khoản Tickee có sẵn (lần đầu thì tự cấp cho chính mình): `audit_events` chỉ có
 * `actor_user_id`, nên người vận hành phải là một tài khoản. `grant` chỉ cấp cho tài khoản đã bật xác thực hai lớp
 * (AD-26).
 */

type Command = 'grant' | 'revoke';

export interface AdminCliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

const USAGE = [
  'Cách dùng:',
  '  admin:grant  <email> --by <email người chạy>',
  '  admin:revoke <email> --by <email người chạy>',
  'Cần MIGRATION_DATABASE_URL (role tickee_migrator).',
].join('\n');

class UsageError extends Error {}

interface ParsedArgs {
  command: Command;
  email: string;
  by: string;
}

function parseEmail(raw: string | undefined, what: string): string {
  const parsed = EmailAddress.safeParse(raw ?? '');
  if (!parsed.success) throw new UsageError(raw ? `${what} không phải email hợp lệ.` : `Thiếu ${what}.`);
  return parsed.data;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command, ...rest] = argv;
  if (command !== 'grant' && command !== 'revoke') throw new UsageError('Lệnh phải là grant hoặc revoke.');
  const positional: string[] = [];
  let by: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    // `--` tách tham số (vd. `pnpm … admin:grant -- <email> --by …`): bỏ qua.
    if (arg === '--') continue;
    if (arg === '--by') {
      by = rest[++i];
    } else if (arg.startsWith('--by=')) {
      by = arg.slice('--by='.length);
    } else if (arg.startsWith('-')) {
      throw new UsageError(`Tùy chọn lạ: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 1) throw new UsageError('Chỉ nhận một email mỗi lần.');
  return {
    command,
    email: parseEmail(positional[0], 'email tài khoản cần đổi'),
    by: parseEmail(by, '--by (email người chạy lệnh)'),
  };
}

/** Mã lỗi Postgres/Node (`28P01`, `ECONNREFUSED`…) — không in message để không lộ chuỗi kết nối hay dữ liệu. */
const errorCode = (err: unknown): string => {
  const code = (err as { code?: unknown; cause?: { code?: unknown } } | null)?.code ?? (err as { cause?: { code?: unknown } })?.cause?.code;
  return typeof code === 'string' ? code : err instanceof Error ? err.name : 'không rõ';
};

/**
 * Chạy CLI; trả mã thoát (0 = xong, kể cả "không đổi"; ≠ 0 = không đổi gì trong DB). Email không tồn tại, thiếu
 * `--by`, `grant` cho tài khoản chưa bật 2FA hoặc lỗi DB đều rollback toàn bộ và không ghi audit.
 */
export async function runAdminCli(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
  io: AdminCliIo = { out: (l) => console.log(l), err: (l) => console.error(l) },
): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    io.err(`${err.message}\n${USAGE}`);
    return 2;
  }

  let config: MigrateConfig;
  try {
    const loaded = loadConfig({ ...env, APP_ROLE: 'migrate' });
    if (loaded.APP_ROLE !== 'migrate') throw new Error('loadConfig trả sai vai');
    config = loaded;
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    io.err(err.message);
    return 2;
  }

  const value = args.command === 'grant';
  const db = new Database({ connectionString: config.MIGRATION_DATABASE_URL, max: 1, applicationName: 'tickee-admin-cli' });
  try {
    const result = await db.transaction(async (tx) => {
      const actorUserId = await findUserIdByEmail(tx, args.by);
      if (!actorUserId) return { status: 'missing', email: args.by } as const;
      const targetUserId = await findUserIdByEmail(tx, args.email);
      if (!targetUserId) return { status: 'missing', email: args.email } as const;
      if (value && !(await hasTwoFactorEnabled(tx, targetUserId))) return { status: 'no_2fa' } as const;
      if (!(await setPlatformAdmin(tx, targetUserId, value))) return { status: 'unchanged' } as const;
      await audit.record(tx, {
        actorUserId,
        organizationId: null,
        action: value ? 'platform_admin.granted' : 'platform_admin.revoked',
        target: { type: 'user', id: targetUserId },
        changedFields: ['platform_admin'],
      });
      return { status: 'changed' } as const;
    });

    switch (result.status) {
      case 'missing':
        io.err(`Không có Tài khoản Tickee nào với email ${result.email}. Không đổi gì.`);
        return 1;
      case 'no_2fa':
        io.err(`${args.email} chưa bật xác thực hai lớp. Quản trị Tingee bắt buộc bật 2FA trước khi cấp quyền. Không đổi gì.`);
        return 1;
      case 'unchanged':
        io.out(
          value
            ? `Không đổi: ${args.email} đã là Quản trị Tingee.`
            : `Không đổi: ${args.email} không phải Quản trị Tingee.`,
        );
        return 0;
      case 'changed':
        io.out(
          value
            ? `Đã cấp quyền Quản trị Tingee cho ${args.email}.`
            : `Đã thu quyền Quản trị Tingee của ${args.email}.`,
        );
        return 0;
    }
  } catch (err) {
    io.err(`Lỗi khi ghi DB (${errorCode(err)}). Không đổi gì.`);
    return 1;
  } finally {
    await db.close();
  }
}

/**
 * File này được chạy trực tiếp (không phải import trong test). `import.meta.url` là đường dẫn thật (Node resolve
 * symlink), nên so với realpath của `argv[1]`; realpath lỗi thì so với đường dẫn như truyền vào.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  let resolved = entry;
  try {
    resolved = realpathSync(entry);
  } catch {
    // Giữ đường dẫn gốc.
  }
  return import.meta.url === pathToFileURL(resolved).href || import.meta.url === pathToFileURL(entry).href;
}

if (isEntryPoint()) {
  process.exitCode = await runAdminCli(process.argv.slice(2));
}
