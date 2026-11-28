import { randomInt } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import {
  eventGoogleSheetsApiPath,
  eventGoogleSheetsConnectApiPath,
  EventSheetConnectionResponse,
  formatVnTimestamp,
  JobQueue,
  ORDER_CODE_ALPHABET,
  SheetConnectStartResponse,
} from '@tickee/contracts';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  GoogleApiError,
  GoogleSheetsClient,
  type CellBlock,
  type GridSize,
} from '../../src/modules/integration/google-client.js';
import { SHEET_FLUSH_QUEUE } from '../../src/modules/integration/sheet-flush-queue.js';
import { SHEETS_AUTH_REVOKED_EMAIL_QUEUE } from '../../src/modules/integration/sheet-revocation.js';
import {
  runSheetInitialSync,
  sheetInitialSyncJobId,
  SheetSyncWorker,
  type SheetSyncDeps,
} from '../../src/modules/integration/sheet-sync-jobs.js';
import { parseCredentialKeys, SecretBox } from '../../src/platform/crypto/index.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import { WorkerModule } from '../../src/worker.module.js';
import { TEST_GOOGLE_SHEETS_TOKEN_KEYS, testCredentialKey, workerConfig } from '../helpers.js';
import {
  SHEETS_ACCESS_NOT_CONFIGURED,
  SHEETS_SERVICE_DISABLED,
  startGoogleFake,
  type GoogleFake,
} from '../google-fake/server.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import { discardPendingSheetJobs } from './sheet-fixtures.js';
import {
  EVENT_DRAFT,
  eventOnSale,
  orderBody,
  paidReadyOrg,
  parseOrder,
  postOrder,
  rejectingTingee,
  resetOrderRateLimit,
  type Org,
  type SaleEvent,
} from '../ordering/order-fixtures.js';

/*
 * Story 6.4: lần đẩy đầu lên Google Sheets (`runSheetInitialSync`, vai worker) với Google fake. Đơn thật (Đơn 0đ: `paid`
 * ngay, có Vé và câu trả lời form) cùng Đơn chèn bằng SQL cho các trạng thái khác và cho số lượng lớn. Ca cuối chạy
 * worker thật qua pg-boss. Story 6.5: ghi theo `gridRange` của tab (không theo tên), cột "Check-in tay", tiêu đề và
 * metadata `tickee.column` gắn cùng một `batchUpdate`, chỉ nới lưới; cột Tickee của Sheet tạo mới, Sheet mất giữa chừng
 * và hẹn flush khi còn dòng bẩn nằm ở `sheet-flush.test.ts`.
 */

const CLIENT_ID = 'test-sheets-client-id.apps.googleusercontent.com';
const CLIENT_SECRET = 'test-only-google-sheets-client-secret';
const HEADER = [
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
const secretBox = new SecretBox(parseCredentialKeys(TEST_GOOGLE_SHEETS_TOKEN_KEYS));

let fake: GoogleFake;
let h: Harness;
let org: Org;

const googleUrls = () => ({
  GOOGLE_SHEETS_CLIENT_ID: CLIENT_ID,
  GOOGLE_SHEETS_CLIENT_SECRET: CLIENT_SECRET,
  GOOGLE_OAUTH_AUTHORIZE_URL: fake.authorizeUrl,
  GOOGLE_OAUTH_TOKEN_URL: fake.tokenUrl,
  GOOGLE_SHEETS_API_URL: fake.url,
});

const clientOf = (overrides: { timeoutMs?: number; tokenUrl?: string } = {}) =>
  new GoogleSheetsClient({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    authorizeUrl: fake.authorizeUrl,
    tokenUrl: overrides.tokenUrl ?? fake.tokenUrl,
    sheetsApiUrl: fake.url,
    timeoutMs: overrides.timeoutMs,
  });

beforeAll(async () => {
  fake = await startGoogleFake({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  h = await createHarness(googleUrls(), { overrides: [rejectingTingee] });
  org = await paidReadyOrg(h, { name: 'CLB Bơi lội' });
  // Lần đẩy đầu xong mà còn dòng bẩn thì hẹn flush, mất quyền thì enqueue email (vai worker tạo hai queue này lúc khởi
  // động).
  await SHEET_FLUSH_QUEUE.ensure(h.app.get<PgBoss>(BOSS));
  await SHEETS_AUTH_REVOKED_EMAIL_QUEUE.ensure(h.app.get<PgBoss>(BOSS));
});
beforeEach(async () => {
  fake.reset();
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  await h.close();
  await fake.close();
});

/** Sự kiện miễn phí đã mở bán (Đơn 0đ `paid` ngay, có Vé), kèm câu hỏi form. */
const freeEvent = (questions: string[] = []) =>
  eventOnSale(org, [{ name: 'Vé thường', price: 0, capacity: 100 }], {
    questions: questions.map((label) => ({ label, kind: 'text' as const, required: false })),
  });

/** Kết nối Sự kiện qua đúng luồng api (bấm, đồng ý trên Google fake, callback): id kết nối `syncing`. */
async function connect(eventId: string): Promise<string> {
  const start = await h.http
    .post(`/v1${eventGoogleSheetsConnectApiPath(org.orgId, eventId)}`)
    .set('cookie', org.owner.cookie)
    .expect(200);
  const location = new URL(await fake.authorize(SheetConnectStartResponse.parse(start.body).authorizationUrl));
  const res = await h.http.get(`${location.pathname}${location.search}`).set('cookie', org.owner.cookie).expect(302);
  expect(res.headers.location).toContain('notice=sheets-connected');
  const { rows } = await h.db.pool.query<{ id: string }>('SELECT id FROM sheet_connections WHERE event_id = $1', [eventId]);
  fake.reset();
  return rows[0]!.id;
}

const depsOf = (google = clientOf(), box = secretBox): SheetSyncDeps => ({
  db: h.db,
  google,
  secretBox: box,
  boss: h.app.get<PgBoss>(BOSS),
  flushWindowSeconds: 45,
});

const run = (connectionId: string, google = clientOf()) => runSheetInitialSync(depsOf(google), connectionId);

interface ConnectionState {
  status: string;
  spreadsheet_id: string | null;
  spreadsheet_url: string | null;
  last_synced_at: Date | null;
  last_error_code: string | null;
}

async function stateOf(connectionId: string): Promise<ConnectionState | undefined> {
  const { rows } = await h.db.pool.query<ConnectionState>(
    'SELECT status, spreadsheet_id, spreadsheet_url, last_synced_at, last_error_code FROM sheet_connections WHERE id = $1',
    [connectionId],
  );
  return rows[0];
}

/** Các lần ghi ô (`values:batchUpdateByDataFilter`). */
const writes = () => fake.calls('POST', '/v4/spreadsheets/').filter((r) => r.path.endsWith('/values:batchUpdateByDataFilter'));

/** Vùng của từng lần ghi: `[dòng đầu, dòng cuối (không tính), cột đầu, cột cuối (không tính)]` theo `gridRange`, đếm từ 0. */
const writtenRanges = () =>
  writes().flatMap((r) =>
    (r.body as { data: { dataFilter: { gridRange: Record<string, number> } }[] }).data.map(({ dataFilter: { gridRange: g } }) => [
      g.sheetId,
      g.startRowIndex,
      g.endRowIndex,
      g.startColumnIndex,
      g.endColumnIndex,
    ]),
  );

/** Các `batchUpdate` (tiêu đề + metadata cột, nới lưới). */
const batchUpdates = () => fake.calls('POST', '/v4/spreadsheets/').filter((r) => r.path.endsWith(':batchUpdate'));
const creates = () => fake.calls('POST', '/v4/spreadsheets').filter((r) => r.path === '/v4/spreadsheets');

async function placeFree(sale: SaleEvent, options: { tickets?: number; answers?: Record<string, string> } = {}) {
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
  const { rows } = await h.db.pool.query<{ id: string; status: string; created_at: Date; paid_at: Date }>(
    'SELECT id, status, created_at, paid_at FROM orders WHERE code = $1',
    [order.code],
  );
  // Đơn 0đ: `paid` ngay trong TX1, Vé đã phát.
  expect(rows[0]!.status).toBe('paid');
  return { code: order.code, buyer, ...rows[0]! };
}

const randomCode = () =>
  `TK${Array.from({ length: 8 }, () => ORDER_CODE_ALPHABET[randomInt(ORDER_CODE_ALPHABET.length)]).join('')}`;

interface Seed {
  status: 'pending' | 'expired' | 'paid' | 'review' | 'cancelled' | 'refunded';
  createdAt: string;
  code?: string;
}

/** Chèn thẳng Đơn (không dòng, không Vé) cho Sự kiện, đúng ràng buộc của từng trạng thái. Trả mã theo thứ tự. */
async function seed(eventId: string, seeds: Seed[]): Promise<string[]> {
  const rows = seeds.map((s) => ({ code: s.code ?? randomCode(), status: s.status, created_at: s.createdAt }));
  await h.db.pool.query(
    `INSERT INTO orders (code, user_id, event_id, organization_id, status, total_amount, buyer_name, buyer_phone,
                         buyer_email, idempotency_key, expires_at, created_at, paid_at, paid_amount, paid_source,
                         cancel_reason)
     SELECT s.code, gen_random_uuid(), $1, $2, s.status, 150000, 'Người mua chèn tay', '+84987654321', 'chen-tay@vidu.vn',
            gen_random_uuid(), s.created_at, s.created_at,
            CASE WHEN s.status IN ('paid', 'refunded') THEN s.created_at END,
            CASE WHEN s.status IN ('paid', 'refunded') THEN 150000 END,
            CASE WHEN s.status IN ('paid', 'refunded') THEN 'manual' END,
            CASE WHEN s.status IN ('cancelled', 'refunded') THEN 'rejected' END
       FROM jsonb_to_recordset($3::jsonb) AS s(code text, status text, created_at timestamptz)`,
    [eventId, org.orgId, JSON.stringify(rows)],
  );
  return rows.map((r) => r.code);
}

describe('lần đẩy đầu', () => {
  it('Sự kiện chưa có Đơn: tạo Sheet "Tickee · <tên>" (vi_VN, giờ Việt Nam, tab "Đơn", cố định dòng 1), chỉ hàng tiêu đề; active', async () => {
    const sale = await freeEvent();
    const connectionId = await connect(sale.event.id);
    expect(await stateOf(connectionId)).toMatchObject({ status: 'syncing', spreadsheet_id: null });

    const outcome = await run(connectionId);
    expect(outcome).toMatchObject({ result: 'synced', orders: 0 });
    const spreadsheetId = (outcome as { spreadsheetId: string }).spreadsheetId;
    const spreadsheet = fake.spreadsheets.get(spreadsheetId)!;
    expect(spreadsheet).toMatchObject({
      title: `Tickee · ${EVENT_DRAFT.name}`,
      locale: 'vi_VN',
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    expect(spreadsheet.tabs).toHaveLength(1);
    expect(spreadsheet.tabs[0]).toMatchObject({ sheetId: 0, title: 'Đơn', frozenRowCount: 1, rowCount: 1000, columnCount: 26 });
    expect(fake.values(spreadsheetId)).toEqual([HEADER]);
    // Story 6.5: mỗi cột Tickee mang developer metadata `tickee.column` (PROJECT), tiêu đề và metadata trong một batchUpdate.
    expect(spreadsheet.metadata.map((m) => [m.metadataKey, m.metadataValue, m.column, m.visibility])).toEqual(
      [
        'order_code',
        'buyer_name',
        'buyer_email',
        'buyer_phone',
        'items',
        'total_amount',
        'paid_amount',
        'status',
        'created_at',
        'paid_at',
        'checked_in',
        'manual_checked_in',
        'ticket_count',
      ].map((value, column) => ['tickee.column', value, column, 'PROJECT']),
    );
    expect(batchUpdates()).toHaveLength(1);
    // Lưới tạo đủ lớn: không nới lại.
    expect(JSON.stringify(batchUpdates())).not.toContain('appendDimension');

    const state = await stateOf(connectionId);
    expect(state).toMatchObject({
      status: 'active',
      spreadsheet_id: spreadsheetId,
      spreadsheet_url: spreadsheet.spreadsheetUrl,
      last_error_code: null,
    });
    expect(state!.last_synced_at).toBeInstanceOf(Date);

    const status = EventSheetConnectionResponse.parse(
      (await h.http.get(`/v1${eventGoogleSheetsApiPath(org.orgId, sale.event.id)}`).set('cookie', org.owner.cookie).expect(200))
        .body,
    );
    expect(status.connection).toMatchObject({
      status: 'active',
      spreadsheetUrl: spreadsheet.spreadsheetUrl,
      lastSyncedAt: state!.last_synced_at!.toISOString(),
      lastErrorCode: null,
    });

    // Chạy lại (vd. job bị redrive) khi đã active: không gọi Google.
    fake.reset();
    expect(await run(connectionId)).toEqual({ result: 'skipped', reason: 'already_active' });
    expect(fake.requests).toEqual([]);
  });

  it('Đơn paid/review/cancelled/refunded theo thứ tự cũ → mới, không có pending/expired; giá trị như CSV; cột form; Đơn nhiều Vé đã check-in', async () => {
    const sale = await freeEvent(['CCCD', 'Cỡ áo']);
    const [cccd, size] = sale.questions;
    const [oldest, oldPending, review, oldExpired] = await seed(sale.event.id, [
      { status: 'refunded', createdAt: '2026-01-01T01:00:00.000001Z' },
      { status: 'pending', createdAt: '2026-01-01T02:00:00Z' },
      { status: 'review', createdAt: '2026-01-01T03:00:00Z' },
      { status: 'expired', createdAt: '2026-01-01T04:00:00Z' },
    ]);
    const three = await placeFree(sale, { tickets: 3, answers: { [cccd!.id]: '001203004567', [size!.id]: '=XL' } });
    const one = await placeFree(sale, { answers: { [size!.id]: 'M' } });
    const [cancelled] = await seed(sale.event.id, [{ status: 'cancelled', createdAt: '2099-01-01T00:00:00Z' }]);
    // 2 trên 3 Vé đã check-in.
    await h.db.pool.query(
      `UPDATE tickets SET checked_in_at = now() WHERE id IN (SELECT id FROM tickets WHERE order_id = $1 ORDER BY seq LIMIT 2)`,
      [three.id],
    );

    const connectionId = await connect(sale.event.id);
    const outcome = await run(connectionId);
    expect(outcome).toMatchObject({ result: 'synced', orders: 5 });
    const values = fake.values((outcome as { spreadsheetId: string }).spreadsheetId);

    expect(values[0]).toEqual([...HEADER, 'CCCD', 'Cỡ áo']);
    expect(values.slice(1).map((row) => row[0])).toEqual([oldest, review, three.code, one.code, cancelled]);
    expect(values.flat()).not.toContain(oldPending);
    expect(values.flat()).not.toContain(oldExpired);
    expect(values[3]).toEqual([
      three.code,
      'Lê Thu Trang',
      three.buyer.email,
      '0912 345 678',
      '3 × Vé thường',
      0,
      0,
      'Đã thanh toán',
      formatVnTimestamp(three.created_at),
      formatVnTimestamp(three.paid_at),
      2,
      // Check-in tay: Vé check-in trước Story 6.5 (`checkin_method` null) không tính là tay.
      0,
      3,
      // RAW: câu trả lời nguyên văn, giữ số 0 đầu, không thêm `'`.
      '001203004567',
      '=XL',
    ]);
    expect(values[4]!.slice(10)).toEqual([0, 0, 1, '', 'M']);
    // Đơn chèn tay: Cần xử lý / Đã hủy / Đã hoàn tay; số tiền là số; không có Vé → check-in trống.
    expect(values[1]!.slice(3, 13)).toEqual([
      '0987 654 321',
      '',
      150000,
      150000,
      'Đã hoàn tay',
      '2026-01-01 08:00:00',
      '2026-01-01 08:00:00',
      '',
      '',
      '',
    ]);
    expect(values[2]!.slice(5, 10)).toEqual([150000, '', 'Cần xử lý', '2026-01-01 10:00:00', '']);
    expect(values[5]![7]).toBe('Đã hủy');
    // Không id nội bộ nào.
    expect(JSON.stringify(values)).not.toContain(three.id);
    expect(await stateOf(connectionId)).toMatchObject({ status: 'active', last_error_code: null });
  });

  it('nhiều lô: 1.001 Đơn → Sheet tạo với 1.002 dòng, tiêu đề cùng metadata rồi 3 lô 500/500/1 theo gridRange của tab', async () => {
    const sale = await freeEvent();
    const base = Date.parse('2026-02-01T00:00:00Z');
    const codes = await seed(
      sale.event.id,
      Array.from({ length: 1_001 }, (_, i) => ({ status: 'paid' as const, createdAt: new Date(base + i * 1_000).toISOString() })),
    );
    const connectionId = await connect(sale.event.id);
    const outcome = await run(connectionId);
    expect(outcome).toMatchObject({ result: 'synced', orders: 1_001 });
    const spreadsheetId = (outcome as { spreadsheetId: string }).spreadsheetId;
    expect(fake.tab(spreadsheetId)).toMatchObject({ rowCount: 1_002, columnCount: 26 });
    // Theo `sheetId` (0), không theo tên tab; 13 cột Tickee (A…M).
    expect(writtenRanges()).toEqual([
      [0, 1, 501, 0, 13],
      [0, 501, 1001, 0, 13],
      [0, 1001, 1002, 0, 13],
    ]);
    expect(fake.values(spreadsheetId)[0]).toEqual(HEADER);
    const values = fake.values(spreadsheetId);
    expect(values).toHaveLength(1_002);
    expect(values.slice(1).map((row) => row[0])).toEqual(codes);
  });

  it('16 câu hỏi form đã trả lời → 29 cột: lưới quá 26 cột, vùng ghi tới cột AC', async () => {
    const sale = await freeEvent();
    const [code] = await seed(sale.event.id, [{ status: 'paid', createdAt: '2026-05-01T00:00:00Z' }]);
    // Câu trả lời chèn thẳng (bản chụp lúc đặt), mỗi câu một id câu hỏi.
    await h.db.pool.query(
      `INSERT INTO order_answers (order_id, question_id, position, label, kind, answer)
       SELECT o.id, gen_random_uuid(), i, 'Câu ' || i, 'text', 'Trả lời ' || i
         FROM orders o, generate_series(1, 16) AS i WHERE o.code = $1`,
      [code],
    );
    const connectionId = await connect(sale.event.id);
    const outcome = await run(connectionId);
    expect(outcome).toMatchObject({ result: 'synced', orders: 1 });
    const spreadsheetId = (outcome as { spreadsheetId: string }).spreadsheetId;
    expect(fake.tab(spreadsheetId)).toMatchObject({ rowCount: 1_000, columnCount: 29 });
    expect(writtenRanges()).toEqual([[0, 1, 2, 0, 29]]);
    const values = fake.values(spreadsheetId);
    expect(values[0]).toEqual([...HEADER, ...Array.from({ length: 16 }, (_, i) => `Câu ${i + 1}`)]);
    expect(values[1]!.slice(13)).toEqual(Array.from({ length: 16 }, (_, i) => `Trả lời ${i + 1}`));
    expect(fake.spreadsheets.get(spreadsheetId)!.metadata).toHaveLength(29);
  });

  it('SecretBox khác khóa (worker thiếu khóa của refresh token) → lần chạy ném lỗi, kết nối vẫn syncing, không gọi Google', async () => {
    const sale = await freeEvent();
    const connectionId = await connect(sale.event.id);
    const wrongBox = new SecretBox(parseCredentialKeys(testCredentialKey(1, 99)));
    await expect(runSheetInitialSync(depsOf(clientOf(), wrongBox), connectionId)).rejects.toThrow(
      'Không giải mã được refresh token Google (SecretBoxError)',
    );
    expect(await stateOf(connectionId)).toMatchObject({ status: 'syncing', last_error_code: null, spreadsheet_id: null });
    expect(fake.requests).toEqual([]);
  });
});

describe('lỗi Google và retry', () => {
  it('5xx sau khi tạo Sheet → retrying + server_error; lần retry dùng lại spreadsheet_id (không tạo Sheet thứ hai), giữ metadata, ghi đè cùng ô', async () => {
    const sale = await freeEvent();
    const codes = await seed(sale.event.id, [
      { status: 'paid', createdAt: '2026-03-01T00:00:00Z' },
      { status: 'paid', createdAt: '2026-03-01T00:00:01Z' },
    ]);
    const connectionId = await connect(sale.event.id);
    // Tạo Sheet được, gắn tiêu đề + metadata cột lỗi 500.
    fake.sheetsReplies.push('pass', { status: 500 });
    expect(await run(connectionId)).toEqual({ result: 'retry', code: 'server_error' });
    const failed = await stateOf(connectionId);
    expect(failed).toMatchObject({ status: 'retrying', last_error_code: 'server_error', last_synced_at: null });
    expect(failed!.spreadsheet_id).not.toBeNull();

    // Lần thứ hai: đọc tab, tìm metadata, gắn tiêu đề + metadata rồi lỗi 429 ở lô Đơn.
    fake.sheetsReplies.push('pass', 'pass', 'pass', { status: 429 });
    expect(await run(connectionId)).toEqual({ result: 'retry', code: 'rate_limited' });
    expect(await stateOf(connectionId)).toMatchObject({ status: 'retrying', last_error_code: 'rate_limited' });

    const outcome = await run(connectionId);
    expect(outcome).toEqual({ result: 'synced', orders: 2, spreadsheetId: failed!.spreadsheet_id });
    expect(creates()).toHaveLength(1);
    expect(fake.values(failed!.spreadsheet_id!).map((row) => row[0])).toEqual(['Mã Đơn', ...codes]);
    // Lần thứ ba thấy metadata của lần hai: không gắn lại (13 cột, mỗi cột một metadata).
    expect(fake.spreadsheets.get(failed!.spreadsheet_id!)!.metadata).toHaveLength(13);
    expect(await stateOf(connectionId)).toMatchObject({ status: 'active', last_error_code: null });
  });

  it('lần retry mà BTC đã xóa cột Mã Đơn (Sheet còn cột Tickee khác) → bỏ Sheet đó, tạo Sheet mới ngay, không gắn lại tại chỗ', async () => {
    const sale = await freeEvent();
    const codes = await seed(sale.event.id, [{ status: 'paid', createdAt: '2026-06-01T00:00:00Z' }]);
    const connectionId = await connect(sale.event.id);
    // Tạo Sheet, gắn tiêu đề + metadata được, ghi lô Đơn lỗi 500.
    fake.sheetsReplies.push('pass', 'pass', { status: 500 });
    expect(await run(connectionId)).toEqual({ result: 'retry', code: 'server_error' });
    const first = (await stateOf(connectionId))!.spreadsheet_id!;
    fake.deleteColumn(first, fake.columnOf(first, 'order_code')!);
    const metadataBefore = fake.spreadsheets.get(first)!.metadata.map((m) => [m.metadataValue, m.column]);

    const outcome = await run(connectionId);
    expect(outcome).toMatchObject({ result: 'synced', orders: 1 });
    const replacement = (outcome as { spreadsheetId: string }).spreadsheetId;
    expect(replacement).not.toBe(first);
    expect(fake.values(replacement)).toHaveLength(2);
    expect(fake.values(replacement)[1]![0]).toBe(codes[0]);
    expect(fake.columnOf(replacement, 'order_code')).toBe(0);
    expect(fake.spreadsheets.get(replacement)!.metadata).toHaveLength(13);
    // Sheet cũ giữ nguyên, không bị gắn lại.
    expect(fake.spreadsheets.get(first)!.metadata.map((m) => [m.metadataValue, m.column])).toEqual(metadataBefore);
    expect(await stateOf(connectionId)).toMatchObject({ status: 'active', spreadsheet_id: replacement });
  });

  it('lần retry sau khi đã gắn cột: câu hỏi form mới có câu trả lời → thêm cột ở cuối lưới (tiêu đề, metadata), ô của Đơn có câu trả lời', async () => {
    const sale = await freeEvent(['Biệt danh']);
    const question = sale.questions[0]!;
    const [code] = await seed(sale.event.id, [{ status: 'paid', createdAt: '2026-06-02T00:00:00Z' }]);
    const connectionId = await connect(sale.event.id);
    // Lần 1: chưa ai trả lời câu hỏi (13 cột); tạo Sheet, gắn tiêu đề + metadata được, ghi lô Đơn lỗi 500.
    fake.sheetsReplies.push('pass', 'pass', { status: 500 });
    expect(await run(connectionId)).toEqual({ result: 'retry', code: 'server_error' });
    const spreadsheetId = (await stateOf(connectionId))!.spreadsheet_id!;
    const columnCount = fake.tab(spreadsheetId).columnCount;
    expect(fake.spreadsheets.get(spreadsheetId)!.metadata).toHaveLength(13);
    await h.db.pool.query(
      `INSERT INTO order_answers (order_id, question_id, position, label, kind, answer)
       SELECT id, $2, 0, 'Biệt danh', 'text', 'Cá Mập' FROM orders WHERE code = $1`,
      [code, question.id],
    );

    expect(await run(connectionId)).toMatchObject({ result: 'synced', orders: 1, spreadsheetId });
    const key = `question:${question.id}`;
    expect(fake.columnOf(spreadsheetId, key)).toBe(columnCount);
    expect(fake.tab(spreadsheetId).columnCount).toBe(columnCount + 1);
    expect(fake.spreadsheets.get(spreadsheetId)!.metadata.find((m) => m.metadataValue === key)).toMatchObject({
      metadataKey: 'tickee.column',
      visibility: 'PROJECT',
      column: columnCount,
    });
    const values = fake.values(spreadsheetId);
    expect(values[0]!.slice(0, 13)).toEqual(HEADER);
    expect(values[0]![columnCount]).toBe('Biệt danh');
    expect(values[1]![0]).toBe(code);
    expect(values[1]![columnCount]).toBe('Cá Mập');
  });

  it('timeout và lỗi mạng → retrying (timeout / network)', async () => {
    const sale = await freeEvent();
    const connectionId = await connect(sale.event.id);
    fake.refreshReplies.push('hang');
    expect(await run(connectionId, clientOf({ timeoutMs: 300 }))).toEqual({ result: 'retry', code: 'timeout' });
    expect(await stateOf(connectionId)).toMatchObject({ status: 'retrying', last_error_code: 'timeout' });
    expect(await run(connectionId, clientOf({ tokenUrl: 'http://127.0.0.1:1/token' }))).toEqual({
      result: 'retry',
      code: 'network',
    });
    expect(await stateOf(connectionId)).toMatchObject({ status: 'retrying', last_error_code: 'network' });
  });

  it('invalid_grant (người cấp thu hồi quyền) → auth_revoked, không retry; chạy lại không gọi Google', async () => {
    const sale = await freeEvent();
    const connectionId = await connect(sale.event.id);
    fake.revokeAll();
    expect(await run(connectionId)).toEqual({ result: 'auth_revoked', code: 'invalid_grant' });
    expect(await stateOf(connectionId)).toMatchObject({ status: 'auth_revoked', last_error_code: 'invalid_grant' });
    fake.reset();
    expect(await run(connectionId)).toEqual({ result: 'skipped', reason: 'auth_revoked' });
    expect(fake.requests).toEqual([]);
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
  ] as const)('Sheets API trả %i không kèm lý do cấu hình → auth_revoked (%s)', async (status, code) => {
    const sale = await freeEvent();
    const connectionId = await connect(sale.event.id);
    fake.sheetsReplies.push({ status });
    expect(await run(connectionId)).toEqual({ result: 'auth_revoked', code });
    expect(await stateOf(connectionId)).toMatchObject({ status: 'auth_revoked', last_error_code: code });
  });

  it.each([
    ['token endpoint invalid_client (401)', () => fake.refreshReplies.push('invalid_client')],
    ['token endpoint unauthorized_client', () => fake.refreshReplies.push('unauthorized_client')],
    ['Sheets 403 SERVICE_DISABLED', () => fake.sheetsReplies.push(SHEETS_SERVICE_DISABLED)],
    ['Sheets 403 accessNotConfigured', () => fake.sheetsReplies.push(SHEETS_ACCESS_NOT_CONFIGURED)],
  ])('lỗi cấu hình phía Tickee (%s) → retrying + configuration, không auth_revoked', async (_name, script) => {
    const sale = await freeEvent();
    const connectionId = await connect(sale.event.id);
    script();
    expect(await run(connectionId)).toEqual({ result: 'retry', code: 'configuration' });
    expect(await stateOf(connectionId)).toMatchObject({ status: 'retrying', last_error_code: 'configuration' });
    // Sửa cấu hình xong, lần retry chạy tiếp mà không phải kết nối lại.
    expect(await run(connectionId)).toMatchObject({ result: 'synced' });
    expect(await stateOf(connectionId)).toMatchObject({ status: 'active', last_error_code: null });
  });

  it.each([
    ['Sheets 400', { status: 400 }],
    ['tạo spreadsheet 200 nhưng body sai dạng', { status: 200, body: { khong: 'dung dang' } }],
  ] as const)('%s → retrying + unexpected_response', async (_name, reply) => {
    const sale = await freeEvent();
    const connectionId = await connect(sale.event.id);
    fake.sheetsReplies.push(reply);
    expect(await run(connectionId)).toEqual({ result: 'retry', code: 'unexpected_response' });
    expect(await stateOf(connectionId)).toMatchObject({ status: 'retrying', last_error_code: 'unexpected_response' });
  });
});

describe('ngắt kết nối khi job đang chạy', () => {
  /** Client ghi xong lần thứ `after` (tiêu đề + metadata là lần 1, mỗi lô Đơn một lần) thì "Ngắt kết nối" qua api. */
  class DisconnectingClient extends GoogleSheetsClient {
    private count = 0;

    constructor(
      private readonly eventId: string,
      private readonly after: number,
    ) {
      super({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        authorizeUrl: fake.authorizeUrl,
        tokenUrl: fake.tokenUrl,
        sheetsApiUrl: fake.url,
      });
    }

    override async tagColumns(...args: Parameters<GoogleSheetsClient['tagColumns']>): Promise<void> {
      await super.tagColumns(...args);
      await this.wrote();
    }

    override async writeCells(accessToken: string, spreadsheetId: string, blocks: readonly CellBlock[]): Promise<void> {
      await super.writeCells(accessToken, spreadsheetId, blocks);
      await this.wrote();
    }

    private async wrote(): Promise<void> {
      this.count += 1;
      if (this.count === this.after) {
        await h.http.delete(`/v1${eventGoogleSheetsApiPath(org.orgId, this.eventId)}`).set('cookie', org.owner.cookie).expect(204);
      }
    }
  }

  it('dòng kết nối bị xóa sau hàng tiêu đề → dừng trước lô kế tiếp, không cập nhật trạng thái; Sheet giữ nguyên', async () => {
    const sale = await freeEvent();
    await seed(sale.event.id, [{ status: 'paid', createdAt: '2026-04-01T00:00:00Z' }]);
    const connectionId = await connect(sale.event.id);
    expect(await run(connectionId, new DisconnectingClient(sale.event.id, 1))).toEqual({ result: 'disconnected' });
    expect(batchUpdates()).toHaveLength(1);
    expect(writes()).toHaveLength(0);
    expect(await stateOf(connectionId)).toBeUndefined();
    expect(fake.spreadsheets.size).toBeGreaterThan(0);
  });

  it('ngắt sau lô cuối → bước cập nhật cuối không ghi gì', async () => {
    const sale = await freeEvent();
    await seed(sale.event.id, [{ status: 'paid', createdAt: '2026-04-02T00:00:00Z' }]);
    const connectionId = await connect(sale.event.id);
    expect(await run(connectionId, new DisconnectingClient(sale.event.id, 2))).toEqual({ result: 'disconnected' });
    expect(writes()).toHaveLength(1);
    expect(await stateOf(connectionId)).toBeUndefined();
  });

  it('kết nối đã xóa trước khi job chạy → không gọi Google', async () => {
    const sale = await freeEvent();
    const connectionId = await connect(sale.event.id);
    await h.http.delete(`/v1${eventGoogleSheetsApiPath(org.orgId, sale.event.id)}`).set('cookie', org.owner.cookie).expect(204);
    expect(await run(connectionId)).toEqual({ result: 'skipped', reason: 'not_found' });
    expect(fake.requests).toEqual([]);
  });

  it.each([
    ['lỗi tạm thời', new GoogleApiError('batch_update', 'transient', 'server_error', 500)],
    ['mất quyền', new GoogleApiError('batch_update', 'auth_revoked', 'forbidden', 403)],
  ])('kết nối bị xóa rồi Google báo %s → disconnected (không retry, không ghi trạng thái)', async (_name, error) => {
    const sale = await freeEvent();
    const connectionId = await connect(sale.event.id);
    const eventId = sale.event.id;
    class FailAfterDisconnect extends GoogleSheetsClient {
      override async expandGrid(_token: string, _id: string, _sheetId: number, _current: GridSize, _needed: GridSize): Promise<void> {
        await h.http.delete(`/v1${eventGoogleSheetsApiPath(org.orgId, eventId)}`).set('cookie', org.owner.cookie).expect(204);
        throw error;
      }
    }
    const client = new FailAfterDisconnect({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      authorizeUrl: fake.authorizeUrl,
      tokenUrl: fake.tokenUrl,
      sheetsApiUrl: fake.url,
    });
    expect(await run(connectionId, client)).toEqual({ result: 'disconnected' });
    expect(await stateOf(connectionId)).toBeUndefined();
  });
});

describe('worker thật (pg-boss)', () => {
  // Job lần đẩy đầu do các ca gọi thẳng để lại (mỗi lần `connect` một job) không được chạy trước job của ca dưới.
  beforeAll(() => discardPendingSheetJobs(h));

  it('callback enqueue job; worker tạo Sheet và chuyển active trong vài giây', async () => {
    const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(workerConfig(googleUrls())), {
      logger: false,
    });
    try {
      await app.init();
      expect(app.get(SheetSyncWorker)).toBeInstanceOf(SheetSyncWorker);
      const sale = await freeEvent(['Biệt danh']);
      await placeFree(sale, { answers: { [sale.questions[0]!.id]: 'Cá Mập' } });
      const connectionId = await connect(sale.event.id);
      await expect
        .poll(async () => (await stateOf(connectionId))?.status, { timeout: 25_000, interval: 250 })
        .toBe('active');
      const state = await stateOf(connectionId);
      const values = fake.values(state!.spreadsheet_id!);
      expect(values[0]).toEqual([...HEADER, 'Biệt danh']);
      expect(values).toHaveLength(2);
      expect(values[1]!.at(-1)).toBe('Cá Mập');
    } finally {
      await app.close();
    }
  }, 40_000);

  it('Google lỗi tạm thời (Sheets 500) → job pg-boss sang retry, kết nối retrying', async () => {
    const sale = await freeEvent();
    const connectionId = await connect(sale.event.id);
    // Chỉ lời gọi Sheets của grant này lỗi (job của kết nối khác có thể chạy cùng lúc); cài trước khi worker khởi động.
    fake.scriptSheets(fake.issued.refreshTokens.at(-1)!, { status: 500 });
    const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(workerConfig(googleUrls())), {
      logger: false,
    });
    try {
      await app.init();
      const boss = app.get<PgBoss>(BOSS);
      await expect
        .poll(
          async () => (await boss.getJobById(JobQueue.INTEGRATION_SHEET_INITIAL_SYNC, sheetInitialSyncJobId(connectionId)))?.state,
          { timeout: 25_000, interval: 250 },
        )
        .toBe('retry');
      expect(await stateOf(connectionId)).toMatchObject({ status: 'retrying', last_error_code: 'server_error' });
    } finally {
      await app.close();
    }
  }, 40_000);
});
