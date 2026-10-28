import { z } from 'zod';
import { APP_ROLES, roleSchemas, type AppConfig } from './config.schema.js';

export interface ConfigIssue {
  variable: string;
  reason: string;
}

/** Lỗi cấu hình: chỉ nêu tên biến và lý do, không bao giờ chứa giá trị. */
export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: ConfigIssue[]) {
    super(
      `Cấu hình môi trường không hợp lệ: ${issues.map((i) => `${i.variable} (${i.reason})`).join('; ')}`,
    );
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

type Env = Record<string, string | undefined>;

function toIssues(error: z.ZodError, env: Env): ConfigIssue[] {
  return error.issues.map((issue) => {
    const variable = String(issue.path[0] ?? '(không rõ)');
    const missing = env[variable] === undefined || env[variable] === '';
    // Không dùng issue.message của Zod cho mọi trường hợp để chắc chắn không có giá trị nào lọt vào.
    let reason: string;
    if (missing) reason = 'thiếu';
    else if (issue.code === 'invalid_value') reason = 'giá trị không thuộc danh sách cho phép';
    else if (issue.code === 'custom') reason = issue.message;
    else if (issue.code === 'too_small' || issue.code === 'too_big') reason = 'ngoài khoảng cho phép';
    else reason = 'sai định dạng';
    return { variable, reason };
  });
}

/** Đọc và kiểm biến môi trường theo vai `APP_ROLE`. Ném `ConfigError` nếu thiếu/sai. */
export function loadConfig(env: Env = process.env): AppConfig {
  const role = z.enum(APP_ROLES).safeParse(env.APP_ROLE);
  if (!role.success) {
    throw new ConfigError([
      {
        variable: 'APP_ROLE',
        reason: env.APP_ROLE ? `phải là một trong ${APP_ROLES.join(' | ')}` : 'thiếu',
      },
    ]);
  }
  // Biến đặt rỗng (`PORT=` trong .env) coi như chưa đặt: biến tùy chọn lấy mặc định, biến bắt buộc báo "thiếu".
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = roleSchemas[role.data].safeParse(cleaned);
  if (!parsed.success) throw new ConfigError(toIssues(parsed.error, env));
  return parsed.data;
}
