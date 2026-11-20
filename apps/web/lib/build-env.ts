import { PHASE_PRODUCTION_BUILD } from 'next/constants';

import { buildEnvIssues, type EnvIssue } from './production-env';

/*
 * Biến bắt buộc lúc `next build`. `NEXT_PUBLIC_*` được nhúng vào bundle lúc build, nên build thiếu biến cho ra bản
 * web hỏng (client gọi API ở `undefined`), và turbo sẽ cache bản hỏng đó. Kiểm ở `next.config.ts`: Next nạp các file
 * `.env*` của apps/web (`.env.production.local`, `.env.local`, `.env.production`, `.env`) trước khi nạp config, nên
 * biến đặt trong các file đó cũng được tính.
 */
export const REQUIRED_BUILD_ENV = ['NEXT_PUBLIC_API_BASE_URL'] as const;

/** Lệnh `next` đang chạy: tham số đầu tiên không phải tùy chọn sau đường dẫn file của CLI (`argv[2]` trở đi). */
function nextCommand(argv: readonly string[]): string | undefined {
  return argv.slice(2).find((arg) => !arg.startsWith('-'));
}

export class MissingBuildEnvError extends Error {
  override readonly name = 'MissingBuildEnvError';

  constructor(readonly variables: readonly string[]) {
    super(
      [
        `Thiếu biến môi trường khi build web: ${variables.join(', ')}.`,
        'Biến NEXT_PUBLIC_* được nhúng lúc build, nên phải đặt trước khi build, vd.',
        `  ${variables[0]}=https://api.tickee.vn pnpm turbo build --filter @tickee/web`,
        'Ở local, `pnpm typecheck`, `pnpm test` và `pnpm test:e2e` tự đặt http://localhost:3001.',
      ].join('\n'),
    );
  }
}

/** Biến build có nhưng sai luật (Story 4.7-f): mỗi biến một lý do, không bao giờ nêu giá trị. */
export class InvalidBuildEnvError extends Error {
  override readonly name = 'InvalidBuildEnvError';

  constructor(readonly issues: readonly EnvIssue[]) {
    super(
      [
        `Biến môi trường không hợp lệ khi build web: ${issues.map((i) => `${i.variable} (${i.reason})`).join('; ')}.`,
        'Host không phải local (localhost, *.localhost, 127.0.0.0/8, ::1) là host thật: bản build để deploy gọi api qua',
        'https, vd.',
        '  NEXT_PUBLIC_API_BASE_URL=https://api.tickee.vn pnpm turbo build --filter @tickee/web',
      ].join('\n'),
    );
  }
}

/**
 * Ném lỗi khi đang build production (`next build`) mà biến bắt buộc thiếu (chưa đặt hoặc rỗng: `MissingBuildEnvError`)
 * hoặc sai luật (`NEXT_PUBLIC_API_BASE_URL` có host thật mà không phải https: `InvalidBuildEnvError`). `next typegen`
 * cũng nạp config ở `PHASE_PRODUCTION_BUILD` nhưng chỉ sinh kiểu, không ra bản build: bỏ qua. `next dev` và
 * `next start` ở phase khác: bỏ qua.
 */
export function assertBuildEnv(
  phase: string,
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): void {
  if (phase !== PHASE_PRODUCTION_BUILD || nextCommand(argv) === 'typegen') return;
  const missing = REQUIRED_BUILD_ENV.filter((name) => !env[name]?.trim());
  if (missing.length > 0) throw new MissingBuildEnvError(missing);
  const issues = buildEnvIssues(env);
  if (issues.length > 0) throw new InvalidBuildEnvError(issues);
}
