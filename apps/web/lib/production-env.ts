/*
 * Luật cấu hình production phía web (Story 4.7-f), dùng chung cho `next build` (`build-env.ts`), lúc server khởi động
 * (`instrumentation.ts`) và route `/api/revalidate`. `next build` và `next start` luôn đặt `NODE_ENV=production`, kể cả
 * trong e2e, nên web nhận biết "bản chạy thật" theo host: origin trỏ tới host không phải local là chạy thật. Không hàm
 * nào trả hay ném giá trị của biến.
 */

/** Một vi phạm: tên biến và lý do, không bao giờ kèm giá trị. */
export interface EnvIssue {
  readonly variable: string;
  readonly reason: string;
}

export type WebEnv = Readonly<Record<string, string | undefined>>;

/**
 * Giá trị mẫu của `REVALIDATE_SECRET` trong `.env.example`: ai đọc repo cũng biết. Web không import `apps/api`
 * (dependency-cruiser) và bản deploy không có `.env.example`, nên giá trị nằm ở đây. Sửa giá trị trong `.env.example` thì
 * sửa cả ở đây: `test/production-env.test.ts` đọc file thật và đỏ nếu hai nơi lệch.
 */
export const ENV_EXAMPLE_REVALIDATE_SECRET = 'local-dev-only-revalidate-doi-khoa-nay-o-moi-truong-that';

/** Độ dài tối thiểu của `REVALIDATE_SECRET`, như schema của worker (`z.string().min(32)`). */
export const REVALIDATE_SECRET_MIN_LENGTH = 32;

/** Lý do trong thông báo lỗi. */
export const ENV_REASONS = {
  missing: 'thiếu',
  https: 'phải là https',
  buildHttps: 'phải là https khi host không phải local',
  example: 'là giá trị mẫu của .env.example; môi trường thật phải sinh giá trị riêng',
  tooShort: `ngắn hơn ${REVALIDATE_SECRET_MIN_LENGTH} ký tự`,
} as const;

/** `127.0.0.0/8` dạng chấm thập phân đầy đủ (dạng `URL.hostname` trả sau khi chuẩn hóa). */
function isLoopbackV4(host: string): boolean {
  const parts = host.split('.');
  return parts.length === 4 && parts[0] === '127' && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/**
 * Host local: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1` (có hoặc không ngoặc vuông: `URL.hostname` trả `[::1]`).
 * Không phân biệt hoa thường. Mọi host khác là host thật.
 */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    isLoopbackV4(host) ||
    host === '::1' ||
    host === '[::1]'
  );
}

/** URL có host thật (host khác rỗng và không phải local). Không đặt, rỗng hoặc không phải URL thì `false`. */
export function hasRealHost(url: string | undefined): boolean {
  const host = url ? URL.parse(url)?.hostname : undefined;
  return !!host && !isLocalHost(host);
}

/** URL có scheme `https:` không; không đặt hoặc không phải URL thì `false`. */
export function isHttps(url: string | undefined): boolean {
  return !!url && URL.parse(url)?.protocol === 'https:';
}

/**
 * Web đang chạy thật: `NEXT_PUBLIC_API_BASE_URL` (giá trị nhúng lúc build) hoặc `WEB_ORIGIN` có host thật. Tính cả
 * `WEB_ORIGIN` để bản build local bị đem đi chạy thật vẫn bị kiểm. Local, e2e và CI full-stack chạy trên localhost.
 * Server dev (`next dev` đặt `NODE_ENV=development`) không bao giờ là chạy thật, kể cả khi `apps/web/.env.local` trỏ host
 * thật; `next build`/`next start` luôn đặt `production` nên không tắt được luật bằng `NODE_ENV`.
 */
export function isLiveWeb(env: WebEnv): boolean {
  if (env.NODE_ENV === 'development') return false;
  return hasRealHost(env.NEXT_PUBLIC_API_BASE_URL) || hasRealHost(env.WEB_ORIGIN);
}

/**
 * Lý do `REVALIDATE_SECRET` không dùng được khi web chạy thật; hợp lệ thì `null`. So giá trị mẫu sau khi bỏ khoảng
 * trắng hai đầu (secret tạo từ file hay kèm dòng mới cuối), như api/worker; độ dài đếm như worker (không bỏ khoảng trắng).
 */
export function revalidateSecretReason(secret: string | undefined): string | null {
  if (!secret) return ENV_REASONS.missing;
  if (secret.trim() === ENV_EXAMPLE_REVALIDATE_SECRET) return ENV_REASONS.example;
  if (secret.length < REVALIDATE_SECRET_MIN_LENGTH) return ENV_REASONS.tooShort;
  return null;
}

/**
 * Vi phạm lúc server khởi động, theo thứ tự `WEB_ORIGIN`, `REVALIDATE_SECRET`. Web không chạy thật thì `[]`: local, e2e
 * và CI full-stack giữ nguyên hành vi.
 * - `WEB_ORIGIN` bắt buộc và phải là https: thiếu thì `metadataBase` của `/e/[slug]` rơi về localhost và preview
 *   Zalo/Facebook mất ảnh.
 * - `REVALIDATE_SECRET` bắt buộc, ≥ 32 ký tự và khác giá trị mẫu: không thì ai đọc repo cũng gọi được `/api/revalidate`.
 */
export function runtimeEnvIssues(env: WebEnv): EnvIssue[] {
  if (!isLiveWeb(env)) return [];
  const issues: EnvIssue[] = [];
  if (!env.WEB_ORIGIN) issues.push({ variable: 'WEB_ORIGIN', reason: ENV_REASONS.missing });
  else if (!isHttps(env.WEB_ORIGIN)) issues.push({ variable: 'WEB_ORIGIN', reason: ENV_REASONS.https });
  const secretReason = revalidateSecretReason(env.REVALIDATE_SECRET);
  if (secretReason !== null) issues.push({ variable: 'REVALIDATE_SECRET', reason: secretReason });
  return issues;
}

/** Vi phạm lúc `next build`: `NEXT_PUBLIC_API_BASE_URL` có host thật thì phải là https. */
export function buildEnvIssues(env: WebEnv): EnvIssue[] {
  const base = env.NEXT_PUBLIC_API_BASE_URL;
  return hasRealHost(base) && !isHttps(base)
    ? [{ variable: 'NEXT_PUBLIC_API_BASE_URL', reason: ENV_REASONS.buildHttps }]
    : [];
}

/**
 * Secret mà route `/api/revalidate` so với header: thiếu thì `null` (route trả 503, như trước); web chạy thật mà secret
 * vi phạm luật của `revalidateSecretReason` cũng `null`. Không chạy thật thì nhận mọi secret khác rỗng, như trước.
 */
export function usableRevalidateSecret(env: WebEnv): string | null {
  const secret = env.REVALIDATE_SECRET;
  if (!secret) return null;
  return isLiveWeb(env) && revalidateSecretReason(secret) !== null ? null : secret;
}

/**
 * Env của server web lúc chạy. Phải đọc đúng dạng `process.env.NEXT_PUBLIC_API_BASE_URL` (và `process.env.NODE_ENV`):
 * Next thay biểu thức này bằng giá trị lúc build trong cả bundle server (instrumentation, route), nên bản deploy không cần
 * đặt lại biến lúc chạy. `test/start.process.test.ts` chạy `next start` thật để giữ điều này.
 */
export function webRuntimeEnv(): WebEnv {
  return {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
    WEB_ORIGIN: process.env.WEB_ORIGIN,
    REVALIDATE_SECRET: process.env.REVALIDATE_SECRET,
  };
}

/** Thông báo một lần cho mọi vi phạm lúc khởi động: mỗi biến một lý do, không giá trị. */
export function runtimeEnvMessage(issues: readonly EnvIssue[]): string {
  return [
    'Cấu hình web không hợp lệ: web đang chạy thật (host của NEXT_PUBLIC_API_BASE_URL hoặc WEB_ORIGIN không phải local).',
    ...issues.map(({ variable, reason }) => `  - ${variable} (${reason})`),
    'Xem README › "Cấu hình staging/production" › "Web chạy thật".',
  ].join('\n');
}
