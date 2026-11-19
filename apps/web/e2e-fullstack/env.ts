import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

/*
 * Env của bộ Playwright full-stack (Story 4.7-c): đọc `.env.example` ở gốc repo, như stack của api
 * (`apps/api/test/e2e-stack/main.ts`) — không đọc `.env` local, không chép secret vào code test. Web và api đều ở host
 * `localhost` (cookie phiên của api dùng chung cho web theo host, không theo cổng), không trộn với `127.0.0.1`.
 */

const example = parseEnv(readFileSync(path.join(__dirname, '..', '..', '..', '.env.example'), 'utf8'));

function required(name: string): string {
  const value = example[name];
  if (!value) throw new Error(`.env.example thiếu ${name}`);
  return value;
}

/** Origin của web (`next start`), cũng là `WEB_ORIGIN` của api (CORS kèm cookie) và worker (link trong email). */
export const WEB_ORIGIN = required('WEB_ORIGIN');
export const WEB_PORT = Number(new URL(WEB_ORIGIN).port);
/**
 * Origin của api (stack). Bản build web phải nhúng đúng giá trị này ở `NEXT_PUBLIC_API_BASE_URL` (lệnh gốc
 * `pnpm test:e2e:fullstack` và CI đặt `http://localhost:3001`).
 */
export const API_ORIGIN = required('API_PUBLIC_URL');
/** API HTTP của Mailpit (`docker-compose.yml`, service `mailpit` của CI). */
export const MAILPIT_URL = 'http://localhost:8025';

/** Biến server của web khi chạy `next start`: gốc URL tuyệt đối và bí mật chung với worker cho `/api/revalidate`. */
export const WEB_SERVER_ENV = {
  WEB_ORIGIN,
  REVALIDATE_SECRET: required('REVALIDATE_SECRET'),
};

/** BTC demo mà `db:seed` của stack tạo (đã duyệt Closed Beta, có tài khoản nhận tiền trỏ vào Tingee fake). */
export const ORGANIZER_EMAIL = 'btc.demo@tickee.local';

/** Sự kiện có phí mà `global-setup.ts` tạo và mở bán qua API thật; chuyển sang worker bằng biến môi trường. */
export type TestEvent = { slug: string; name: string; tierName: string };

const EVENT_ENV = { slug: 'E2E_EVENT_SLUG', name: 'E2E_EVENT_NAME', tierName: 'E2E_TIER_NAME' } as const;

export function saveTestEvent(event: TestEvent): void {
  for (const key of Object.keys(EVENT_ENV) as (keyof TestEvent)[]) process.env[EVENT_ENV[key]] = event[key];
}

export function testEvent(): TestEvent {
  const read = (name: string): string => {
    const value = process.env[name];
    if (!value) throw new Error(`Thiếu ${name}: global-setup.ts chưa tạo Sự kiện`);
    return value;
  };
  return { slug: read(EVENT_ENV.slug), name: read(EVENT_ENV.name), tierName: read(EVENT_ENV.tierName) };
}
