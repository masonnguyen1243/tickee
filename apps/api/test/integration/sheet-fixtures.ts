import { randomInt, randomUUID } from 'node:crypto';
import {
  eventGoogleSheetsApiPath,
  eventGoogleSheetsConnectApiPath,
  JobQueue,
  ORDER_CODE_ALPHABET,
  SheetConnectStartResponse,
} from '@tickee/contracts';
import type { PgBoss } from 'pg-boss';
import { expect } from 'vitest';
import { GoogleSheetsClient } from '../../src/modules/integration/google-client.js';
import { SHEET_FLUSH_QUEUE } from '../../src/modules/integration/sheet-flush-queue.js';
import { SHEETS_AUTH_REVOKED_EMAIL_QUEUE } from '../../src/modules/integration/sheet-revocation.js';
import { runSheetInitialSync, type SheetSyncDeps } from '../../src/modules/integration/sheet-sync-jobs.js';
import { parseCredentialKeys, SecretBox } from '../../src/platform/crypto/index.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import type { GoogleFake } from '../google-fake/server.js';
import { TEST_GOOGLE_SHEETS_TOKEN_KEYS } from '../helpers.js';
import { signUp, type Harness } from '../identity/harness.js';
import { eventOnSale, orderBody, parseOrder, postOrder, type Org, type SaleEvent } from '../ordering/order-fixtures.js';

/*
 * Dùng chung cho test đồng bộ Google Sheets của Story 6.5 (`sheet-row-changed`, `sheet-flush`, `sheet-flush-worker`):
 * kết nối qua đúng luồng api với Google fake, chạy lần đẩy đầu, đặt Đơn 0đ thật, chèn Đơn bằng SQL, đọc trạng thái kết
 * nối, dòng bẩn và job pg-boss.
 */

export const SHEETS_CLIENT_ID = 'test-sheets-client-id.apps.googleusercontent.com';
export const SHEETS_CLIENT_SECRET = 'test-only-google-sheets-client-secret';

/** Hàng tiêu đề của Sheet mới (13 cột cố định). */
export const SHEET_HEADER = [
  'Mã Đơn',
  'Tên người mua',
  'Email',
  'SĐT',
  'Vé',
  'Số tiền',
  'Đã nhận',
  'Trạng thái',
  'Thời gian tạo',
  'Thời gian thanh toán',
  'Đã check-in',
  'Check-in tay',
  'Số Vé',
];

export const sheetsSecretBox = new SecretBox(parseCredentialKeys(TEST_GOOGLE_SHEETS_TOKEN_KEYS));

/** Biến env Google của harness và worker trỏ vào Google fake. */
export const googleUrlsOf = (fake: GoogleFake) => ({
  GOOGLE_SHEETS_CLIENT_ID: SHEETS_CLIENT_ID,
  GOOGLE_SHEETS_CLIENT_SECRET: SHEETS_CLIENT_SECRET,
  GOOGLE_OAUTH_AUTHORIZE_URL: fake.authorizeUrl,
  GOOGLE_OAUTH_TOKEN_URL: fake.tokenUrl,
  GOOGLE_SHEETS_API_URL: fake.url,
});

export const sheetsClientOf = (fake: GoogleFake, timeoutMs?: number) =>
  new GoogleSheetsClient({
    clientId: SHEETS_CLIENT_ID,
    clientSecret: SHEETS_CLIENT_SECRET,
    authorizeUrl: fake.authorizeUrl,
    tokenUrl: fake.tokenUrl,
    sheetsApiUrl: fake.url,
    timeoutMs,
  });

/** Môi trường của một file test: harness api, Google fake, BTC. */
export interface SheetEnv {
  h: Harness;
  fake: GoogleFake;
  org: Org;
}

/** Phụ thuộc của lần đẩy đầu / flush / handler gọi thẳng (pg-boss của vai api; queue flush tạo trong `prepareSheetQueues`). */
export const sheetDeps = (env: SheetEnv, google = sheetsClientOf(env.fake), flushWindowSeconds = 45): SheetSyncDeps => ({
  db: env.h.db,
  google,
  secretBox: sheetsSecretBox,
  boss: env.h.app.get<PgBoss>(BOSS),
  flushWindowSeconds,
});

/**
 * Bỏ mọi job còn chờ (`created`, `retry`) của các queue Google Sheets trước khi một test khởi worker thật: test gọi thẳng
 * lần đẩy đầu / flush (file này và các file trước) để lại job không ai chạy, và worker sẽ xử lý chúng trước job của test
 * (lần đẩy đầu chỉ lấy 5 job mỗi lần poll 2 giây), làm test chờ quá hạn tùy thứ tự file.
 */
export async function discardPendingSheetJobs(h: Harness): Promise<void> {
  const boss = h.app.get<PgBoss>(BOSS);
  await boss.start();
  for (const name of [
    JobQueue.INTEGRATION_SHEET_INITIAL_SYNC,
    JobQueue.INTEGRATION_SHEET_FLUSH,
    JobQueue.INTEGRATION_SHEET_ROW_CHANGED,
    JobQueue.INTEGRATION_SHEETS_AUTH_REVOKED_EMAIL,
  ]) {
    if (await boss.getQueue(name)) await boss.deleteQueuedJobs(name);
  }
}

/**
 * Queue flush và queue email mất quyền (vai worker tạo lúc khởi động) phải có để gọi thẳng handler / lần đẩy đầu / flush
 * từ vai api.
 */
export async function prepareSheetQueues(h: Harness): Promise<void> {
  await SHEET_FLUSH_QUEUE.ensure(h.app.get<PgBoss>(BOSS));
  await SHEETS_AUTH_REVOKED_EMAIL_QUEUE.ensure(h.app.get<PgBoss>(BOSS));
}

/** Sự kiện miễn phí đã mở bán (Đơn 0đ `paid` ngay, có Vé), kèm câu hỏi form. */
export const freeSheetEvent = (org: Org, questions: string[] = [], capacity = 200) =>
  eventOnSale(org, [{ name: 'Vé thường', price: 0, capacity }], {
    questions: questions.map((label) => ({ label, kind: 'text' as const, required: false })),
  });

/** Kết nối Sự kiện qua đúng luồng api (bấm, đồng ý trên Google fake, callback): id kết nối `syncing`. */
export async function connectSheet({ h, fake, org }: SheetEnv, eventId: string): Promise<string> {
  const start = await h.http
    .post(`/v1${eventGoogleSheetsConnectApiPath(org.orgId, eventId)}`)
    .set('cookie', org.owner.cookie)
    .expect(200);
  const location = new URL(await fake.authorize(SheetConnectStartResponse.parse(start.body).authorizationUrl));
  const res = await h.http.get(`${location.pathname}${location.search}`).set('cookie', org.owner.cookie).expect(302);
  expect(res.headers.location).toContain('notice=sheets-connected');
  const { rows } = await h.db.pool.query<{ id: string }>('SELECT id FROM sheet_connections WHERE event_id = $1', [eventId]);
  return rows[0]!.id;
}

/** "Ngắt kết nối" qua api. */
export async function disconnectSheet({ h, org }: SheetEnv, eventId: string): Promise<void> {
  await h.http.delete(`/v1${eventGoogleSheetsApiPath(org.orgId, eventId)}`).set('cookie', org.owner.cookie).expect(204);
}

/** Kết nối rồi chạy lần đẩy đầu (gọi thẳng): kết nối `active`, trả id kết nối và id spreadsheet. */
export async function connectAndSync(env: SheetEnv, eventId: string): Promise<{ connectionId: string; spreadsheetId: string }> {
  const connectionId = await connectSheet(env, eventId);
  const outcome = await runSheetInitialSync(sheetDeps(env), connectionId);
  expect(outcome).toMatchObject({ result: 'synced' });
  return { connectionId, spreadsheetId: (outcome as { spreadsheetId: string }).spreadsheetId };
}

export interface ConnectionState {
  status: string;
  spreadsheet_id: string | null;
  spreadsheet_url: string | null;
  sheet_tab_id: number;
  last_synced_at: Date | null;
  last_error_code: string | null;
  auth_revoked_at: Date | null;
  granted_by_user_id: string;
}

export async function connectionStateOf(h: Harness, connectionId: string): Promise<ConnectionState | undefined> {
  const { rows } = await h.db.pool.query<ConnectionState>(
    `SELECT status, spreadsheet_id, spreadsheet_url, sheet_tab_id, last_synced_at, last_error_code, auth_revoked_at,
            granted_by_user_id
       FROM sheet_connections WHERE id = $1`,
    [connectionId],
  );
  return rows[0];
}

/** Dòng bẩn của kết nối: id Đơn → `version`. */
export async function dirtyOf(h: Harness, connectionId: string): Promise<Map<string, number>> {
  const { rows } = await h.db.pool.query<{ order_id: string; version: number }>(
    'SELECT order_id, version FROM sheet_dirty_rows WHERE connection_id = $1',
    [connectionId],
  );
  return new Map(rows.map((row) => [row.order_id, row.version]));
}

export interface PlacedFree {
  code: string;
  id: string;
  buyer: Awaited<ReturnType<typeof signUp>>;
  /** Vé của Đơn (id, Mã QR vé). */
  tickets: { id: string; qr: string }[];
}

/** Người mua mới đặt Đơn 0đ (`paid` ngay trong TX1, có Vé) ở `sale`. */
export async function placeFreeOrder(
  h: Harness,
  sale: SaleEvent,
  options: { tickets?: number; answers?: Record<string, string> } = {},
): Promise<PlacedFree> {
  const buyer = await signUp(h);
  const res = await postOrder(
    h,
    buyer,
    sale.event.slug,
    orderBody([{ ticketTypeId: sale.tiers[0]!.id, quantity: options.tickets ?? 1 }], {
      buyer: { name: 'Lê Thu Trang', phone: '0912 345 678' },
      answers: options.answers ?? {},
    }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const order = parseOrder(res.body);
  const { rows } = await h.db.pool.query<{ id: string; status: string }>('SELECT id, status FROM orders WHERE code = $1', [
    order.code,
  ]);
  expect(rows[0]!.status).toBe('paid');
  return { code: order.code, id: rows[0]!.id, buyer, tickets: order.tickets.map((t) => ({ id: t.id, qr: t.qr })) };
}

export const randomOrderCode = () =>
  `TK${Array.from({ length: 8 }, () => ORDER_CODE_ALPHABET[randomInt(ORDER_CODE_ALPHABET.length)]).join('')}`;

export type SeedStatus = 'pending' | 'expired' | 'paid' | 'review' | 'cancelled' | 'refunded';

/** Chèn thẳng Đơn (không dòng, không Vé) cho Sự kiện, đúng ràng buộc của từng trạng thái. Trả `{ code, id }` theo thứ tự. */
export async function seedOrders(
  { h, org }: SheetEnv,
  eventId: string,
  seeds: { status: SeedStatus; createdAt?: string }[],
): Promise<{ code: string; id: string }[]> {
  const base = Date.now() - 60_000;
  const rows = seeds.map((s, i) => ({
    id: randomUUID(),
    code: randomOrderCode(),
    status: s.status,
    created_at: s.createdAt ?? new Date(base + i * 10).toISOString(),
  }));
  await h.db.pool.query(
    `INSERT INTO orders (id, code, user_id, event_id, organization_id, status, total_amount, buyer_name, buyer_phone,
                         buyer_email, idempotency_key, expires_at, created_at, paid_at, paid_amount, paid_source,
                         cancel_reason)
     SELECT s.id, s.code, gen_random_uuid(), $1, $2, s.status, 150000, 'Người mua chèn tay', '+84987654321',
            'chen-tay@vidu.vn', gen_random_uuid(), s.created_at, s.created_at,
            CASE WHEN s.status IN ('paid', 'refunded') THEN s.created_at END,
            CASE WHEN s.status IN ('paid', 'refunded') THEN 150000 END,
            CASE WHEN s.status IN ('paid', 'refunded') THEN 'manual' END,
            CASE WHEN s.status IN ('cancelled', 'refunded') THEN 'rejected' END
       FROM jsonb_to_recordset($3::jsonb) AS s(id uuid, code text, status text, created_at timestamptz)`,
    [eventId, org.orgId, JSON.stringify(rows)],
  );
  return rows.map(({ code, id }) => ({ code, id }));
}

/** Job `integration.sheet_row_changed` của Đơn (payload). */
export async function rowChangedJobsOf(h: Harness, orderId: string): Promise<unknown[]> {
  const jobs = await h.app.get<PgBoss>(BOSS).findJobs(JobQueue.INTEGRATION_SHEET_ROW_CHANGED, { data: { orderId } });
  return jobs.map((job) => job.data);
}

export interface FlushJobRow {
  id: string;
  state: string;
  singleton_key: string | null;
  start_after: Date;
  data: unknown;
}

/** Job flush của kết nối (theo `singleton_key`), cũ → mới. */
export async function flushJobsOf(h: Harness, connectionId: string): Promise<FlushJobRow[]> {
  const { rows } = await h.db.pool.query<FlushJobRow>(
    `SELECT id::text, state, singleton_key, start_after, data FROM pgboss.job
      WHERE name = $1 AND singleton_key = $2 ORDER BY created_on, start_after`,
    [JobQueue.INTEGRATION_SHEET_FLUSH, connectionId],
  );
  return rows;
}

/** Job lần đẩy đầu của kết nối, cũ → mới. */
export async function initialSyncJobsOf(h: Harness, connectionId: string): Promise<{ id: string; state: string }[]> {
  const { rows } = await h.db.pool.query<{ id: string; state: string }>(
    `SELECT id::text, state FROM pgboss.job WHERE name = $1 AND data->>'connectionId' = $2 ORDER BY created_on`,
    [JobQueue.INTEGRATION_SHEET_INITIAL_SYNC, connectionId],
  );
  return rows;
}
