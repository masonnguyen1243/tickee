import { randomUUID } from 'node:crypto';
import {
  eventGoogleSheetsApiPath,
  EventSheetConnectionResponse,
  formatVnTimestamp,
  IDEMPOTENCY_KEY_HEADER,
} from '@tickee/contracts';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GoogleSheetsClient, type CellBlock } from '../../src/modules/integration/google-client.js';
import { markDirty } from '../../src/modules/integration/sheet-connection-store.js';
import { markSheetRowChanged, runSheetFlush } from '../../src/modules/integration/sheet-flush-jobs.js';
import { runSheetInitialSync, sheetInitialSyncJobId } from '../../src/modules/integration/sheet-sync-jobs.js';
import { sheetsForbidden, startGoogleFake, type FakeCell, type GoogleFake } from '../google-fake/server.js';
import { createHarness, type Harness } from '../identity/harness.js';
import { paidReadyOrg, rejectingTingee, resetOrderRateLimit, type Org, type SaleEvent } from '../ordering/order-fixtures.js';
import {
  connectAndSync,
  connectionStateOf,
  connectSheet,
  dirtyOf,
  disconnectSheet,
  flushJobsOf,
  freeSheetEvent,
  googleUrlsOf,
  initialSyncJobsOf,
  placeFreeOrder,
  prepareSheetQueues,
  seedOrders,
  SHEET_HEADER,
  SHEETS_CLIENT_ID,
  SHEETS_CLIENT_SECRET,
  sheetDeps,
  sheetsClientOf,
  type SeedStatus,
  type SheetEnv,
} from './sheet-fixtures.js';

/*
 * Story 6.5: flush dòng bẩn lên Google Sheets (`runSheetFlush`, vai worker, gọi thẳng) với Google fake, theo từng dòng
 * của I/O Matrix: Đơn mới thêm cuối Sheet, check-in (quét và tay), Cần xử lý, 20 Đơn một lượt, `version` chống mất thay
 * đổi giữa lượt, BTC sửa dòng / đổi tên tab / chèn và di chuyển cột (cột BTC không bị chạm), lưới chỉ nới, cột Tickee bị
 * xóa và câu hỏi form mới (thêm cột ở cuối), Sheet mất (cả Sheet của 6.4 chưa có metadata) → tạo Sheet mới, mất quyền,
 * lỗi tạm thời (kể cả 403 quota, không thành `auth_revoked`), ngắt kết nối giữa lượt.
 */

let fake: GoogleFake;
let h: Harness;
let org: Org;
let env: SheetEnv;

beforeAll(async () => {
  fake = await startGoogleFake({ clientId: SHEETS_CLIENT_ID, clientSecret: SHEETS_CLIENT_SECRET });
  h = await createHarness(googleUrlsOf(fake), { overrides: [rejectingTingee] });
  org = await paidReadyOrg(h, { name: 'CLB Bóng bàn Gò Vấp' });
  env = { h, fake, org };
  await prepareSheetQueues(h);
});
beforeEach(async () => {
  fake.reset();
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  await h.close();
  await fake.close();
});

const flush = (connectionId: string, google: GoogleSheetsClient = sheetsClientOf(fake)) =>
  runSheetFlush(sheetDeps(env, google), connectionId);

/** Handler `sheet_row_changed` cho các Đơn của Sự kiện (như worker nhận job). */
async function mark(eventId: string, ...orderIds: string[]): Promise<void> {
  for (const orderId of orderIds) await markSheetRowChanged(sheetDeps(env), { eventId, orderId });
}

/** Chỉ số cột (đếm từ 0) của cột Tickee `key` trên tab đầu. */
const col = (spreadsheetId: string, key: string): number => {
  const index = fake.columnOf(spreadsheetId, key);
  if (index === undefined) throw new Error(`Không có cột Tickee ${key}`);
  return index;
};

/** Mã Đơn theo thứ tự dòng (bỏ tiêu đề). */
const codesOf = (spreadsheetId: string, tab?: string): FakeCell[] =>
  fake
    .values(spreadsheetId, tab)
    .slice(1)
    .map((row) => row[col(spreadsheetId, 'order_code')] ?? '');

/** Dòng (đếm từ 0) đầu tiên có mã Đơn `code`. */
const rowOf = (spreadsheetId: string, code: string): number =>
  fake.values(spreadsheetId).findIndex((row, i) => i > 0 && row[col(spreadsheetId, 'order_code')] === code);

/** Ô của Đơn `code` ở cột Tickee `key`. */
const cellOf = (spreadsheetId: string, code: string, key: string): FakeCell => {
  const row = rowOf(spreadsheetId, code);
  expect(row, code).toBeGreaterThan(0);
  return fake.values(spreadsheetId)[row]![col(spreadsheetId, key)] ?? '';
};

const writes = () => fake.calls('POST', '/v4/spreadsheets/').filter((r) => r.path.endsWith('/values:batchUpdateByDataFilter'));
const batchUpdates = () => fake.calls('POST', '/v4/spreadsheets/').filter((r) => r.path.endsWith(':batchUpdate'));

/** Đổi trạng thái Đơn bằng SQL (như các lệnh của `ordering` đã làm), đúng ràng buộc. */
async function setStatus(orderId: string, status: SeedStatus, paidAmount: number | null = null): Promise<void> {
  await h.db.pool.query(
    `UPDATE orders SET status = $2,
            paid_amount = $3::int,
            paid_at = CASE WHEN $3::int IS NULL THEN NULL ELSE now() END,
            paid_source = CASE WHEN $3::int IS NULL THEN NULL ELSE 'manual' END,
            cancel_reason = CASE WHEN $2 IN ('cancelled', 'refunded') THEN 'rejected' END
      WHERE id = $1`,
    [orderId, status, paidAmount],
  );
}

/** Sự kiện miễn phí đã kết nối và đẩy đầu xong, với `seeded` Đơn `paid` chèn sẵn trước khi kết nối. */
async function syncedEvent(seeded = 0, questions: string[] = []) {
  const sale = await freeSheetEvent(org, questions);
  const orders = await seedOrders(
    env,
    sale.event.id,
    Array.from({ length: seeded }, () => ({ status: 'paid' as const })),
  );
  const { connectionId, spreadsheetId } = await connectAndSync(env, sale.event.id);
  fake.reset();
  return { sale, orders, connectionId, spreadsheetId };
}

describe('I/O Matrix: Đơn, check-in, Cần xử lý', () => {
  it('Đơn mới paid, kết nối active → dòng mới cuối Sheet, giá trị như lần đẩy đầu; active + last_synced_at; xóa dòng bẩn', async () => {
    const sale = await freeSheetEvent(org, ['Biệt danh']);
    const question = sale.questions[0]!;
    const first = await placeFreeOrder(h, sale, { answers: { [question.id]: 'Cá Mập' } });
    const { connectionId, spreadsheetId } = await connectAndSync(env, sale.event.id);
    const before = (await connectionStateOf(h, connectionId))!.last_synced_at!;
    fake.reset();

    const order = await placeFreeOrder(h, sale, { tickets: 2, answers: { [question.id]: '=Cá Heo' } });
    await mark(sale.event.id, order.id);
    expect(await flush(connectionId)).toEqual({
      result: 'flushed',
      updated: 0,
      appended: 1,
      skipped: 0,
      columnsAdded: 0,
      more: false,
    });
    const { rows } = await h.db.pool.query<{ created_at: Date; paid_at: Date }>(
      'SELECT created_at, paid_at FROM orders WHERE id = $1',
      [order.id],
    );
    const values = fake.values(spreadsheetId);
    expect(values[0]).toEqual([...SHEET_HEADER, 'Biệt danh']);
    expect(values.map((row) => row[0])).toEqual(['Mã Đơn', first.code, order.code]);
    expect(values[2]).toEqual([
      order.code,
      'Lê Thu Trang',
      order.buyer.email,
      '0912 345 678',
      '2 × Vé thường',
      0,
      0,
      'Đã thanh toán',
      formatVnTimestamp(rows[0]!.created_at),
      formatVnTimestamp(rows[0]!.paid_at),
      0,
      0,
      2,
      '=Cá Heo',
    ]);
    // Chỉ ghi đúng một dòng, chỉ cột Tickee (A…N), theo `sheetId`.
    expect(writes()).toHaveLength(1);
    const after = await connectionStateOf(h, connectionId);
    expect(after).toMatchObject({ status: 'active', last_error_code: null });
    expect(after!.last_synced_at!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(await dirtyOf(h, connectionId)).toEqual(new Map());
    expect(JSON.stringify(values)).not.toContain(order.id);
  });

  it('Sự kiện không có kết nối → handler hoàn tất, không dòng bẩn, không gọi Google', async () => {
    const sale = await freeSheetEvent(org);
    const order = await placeFreeOrder(h, sale);
    expect(await markSheetRowChanged(sheetDeps(env), { eventId: sale.event.id, orderId: order.id })).toBe('no_connection');
    expect(fake.requests).toEqual([]);
  });

  it('check-in quét → ô "Đã check-in" của đúng dòng đổi; check-in tay → "Check-in tay" tăng (checkin_method = manual)', async () => {
    const sale = await freeSheetEvent(org);
    const other = await placeFreeOrder(h, sale);
    const order = await placeFreeOrder(h, sale, { tickets: 3 });
    const { connectionId, spreadsheetId } = await connectAndSync(env, sale.event.id);
    const counts = () =>
      ['checked_in', 'manual_checked_in', 'ticket_count'].map((key) => cellOf(spreadsheetId, order.code, key));
    expect(counts()).toEqual([0, 0, 3]);

    await h.http
      .post(`/v1/checkin/events/${sale.event.id}/scans`)
      .set('cookie', org.owner.cookie)
      .send({ code: order.tickets[0]!.qr, scanId: randomUUID() })
      .expect(200);
    await mark(sale.event.id, order.id);
    expect(await flush(connectionId)).toMatchObject({ result: 'flushed', updated: 1, appended: 0 });
    expect(counts()).toEqual([1, 0, 3]);

    await h.http
      .post(`/v1/checkin/events/${sale.event.id}/tickets/${order.tickets[1]!.id}/check-in`)
      .set('cookie', org.owner.cookie)
      .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
      .expect(200);
    await mark(sale.event.id, order.id);
    expect(await flush(connectionId)).toMatchObject({ result: 'flushed', updated: 1 });
    expect(counts()).toEqual([2, 1, 3]);
    // Dòng của Đơn khác không đổi.
    expect(cellOf(spreadsheetId, other.code, 'checked_in')).toBe(0);
    expect(codesOf(spreadsheetId)).toEqual([other.code, order.code]);
  });

  it('Cần xử lý: duyệt tay, ghép, từ chối, hoàn tay → ô "Trạng thái" và "Đã nhận" đổi; Đơn ghép (expired → paid) thêm cuối', async () => {
    const sale = await freeSheetEvent(org);
    const [approved, rejected, matched] = await seedOrders(env, sale.event.id, [
      { status: 'review' },
      { status: 'review' },
      { status: 'expired' },
    ]);
    const { connectionId, spreadsheetId } = await connectAndSync(env, sale.event.id);
    expect(codesOf(spreadsheetId)).toEqual([approved!.code, rejected!.code]);
    expect(cellOf(spreadsheetId, approved!.code, 'status')).toBe('Cần xử lý');

    await setStatus(approved!.id, 'paid', 140_000);
    await setStatus(rejected!.id, 'cancelled');
    await setStatus(matched!.id, 'paid', 150_000);
    await mark(sale.event.id, approved!.id, rejected!.id, matched!.id);
    expect(await flush(connectionId)).toMatchObject({ result: 'flushed', updated: 2, appended: 1, skipped: 0 });
    expect(codesOf(spreadsheetId)).toEqual([approved!.code, rejected!.code, matched!.code]);
    expect(['status', 'paid_amount'].map((key) => cellOf(spreadsheetId, approved!.code, key))).toEqual(['Đã thanh toán', 140000]);
    expect(['status', 'paid_amount'].map((key) => cellOf(spreadsheetId, rejected!.code, key))).toEqual(['Đã hủy', '']);
    expect(cellOf(spreadsheetId, matched!.code, 'status')).toBe('Đã thanh toán');

    await setStatus(rejected!.id, 'refunded');
    await mark(sale.event.id, rejected!.id);
    expect(await flush(connectionId)).toMatchObject({ result: 'flushed', updated: 1 });
    expect(cellOf(spreadsheetId, rejected!.code, 'status')).toBe('Đã hoàn tay');
  });

  it('Đơn rời bốn trạng thái đồng bộ, hay Đơn của Sự kiện khác cùng BTC → bỏ qua và xóa đánh dấu', async () => {
    const { sale, connectionId, spreadsheetId } = await syncedEvent();
    const [pending] = await seedOrders(env, sale.event.id, [{ status: 'pending' }]);
    const elsewhere = await freeSheetEvent(org);
    const [foreign] = await seedOrders(env, elsewhere.event.id, [{ status: 'paid' }]);
    await mark(sale.event.id, pending!.id, foreign!.id);
    expect(await flush(connectionId)).toMatchObject({ result: 'flushed', updated: 0, appended: 0, skipped: 2 });
    expect(codesOf(spreadsheetId)).toEqual([]);
    expect(await dirtyOf(h, connectionId)).toEqual(new Map());
  });

  it('20 Đơn trong một cửa sổ → một lượt flush ghi đủ 20, theo thứ tự tạo', async () => {
    const { sale, connectionId, spreadsheetId } = await syncedEvent();
    const orders = await seedOrders(
      env,
      sale.event.id,
      Array.from({ length: 20 }, () => ({ status: 'paid' as const })),
    );
    await mark(sale.event.id, ...[...orders].reverse().map((order) => order.id));
    expect(await flush(connectionId)).toMatchObject({ result: 'flushed', appended: 20, more: false });
    expect(codesOf(spreadsheetId)).toEqual(orders.map((order) => order.code));
    // Một lần ghi cho cả 20 dòng liền nhau.
    expect(writes()).toHaveLength(1);
  });

  it('hơn 500 dòng bẩn điền cột (keep) cùng một thay đổi mới → thay đổi mới được ghi ngay lượt đầu (đánh dấu gần nhất trước)', async () => {
    const { sale, connectionId, spreadsheetId } = await syncedEvent();
    const refill = await seedOrders(
      env,
      sale.event.id,
      Array.from({ length: 501 }, () => ({ status: 'paid' as const })),
    );
    await markDirty(
      h.db.orm,
      connectionId,
      refill.map((order) => order.id),
      'keep',
    );
    const [fresh] = await seedOrders(env, sale.event.id, [{ status: 'paid' }]);
    await mark(sale.event.id, fresh!.id);
    expect(await flush(connectionId)).toMatchObject({ result: 'flushed', appended: 500, more: true });
    expect(codesOf(spreadsheetId)).toContain(fresh!.code);
    expect((await dirtyOf(h, connectionId)).size).toBe(2);
    expect((await dirtyOf(h, connectionId)).has(fresh!.id)).toBe(false);
  });

  it('Đơn đổi khi flush đang ghi → version tăng, dòng bẩn còn, hẹn lượt sau; lượt sau ghi trạng thái mới', async () => {
    const { sale, orders, connectionId, spreadsheetId } = await syncedEvent(1);
    const order = orders[0]!;
    await mark(sale.event.id, order.id);
    class ChangingClient extends GoogleSheetsClient {
      override async writeCells(accessToken: string, spreadsheetId: string, blocks: readonly CellBlock[]): Promise<void> {
        // Từ chối đúng lúc flush đang ghi bản cũ.
        await setStatus(order.id, 'cancelled');
        await mark(sale.event.id, order.id);
        await super.writeCells(accessToken, spreadsheetId, blocks);
      }
    }
    const changing = new ChangingClient({
      clientId: SHEETS_CLIENT_ID,
      clientSecret: SHEETS_CLIENT_SECRET,
      authorizeUrl: fake.authorizeUrl,
      tokenUrl: fake.tokenUrl,
      sheetsApiUrl: fake.url,
    });
    expect(await flush(connectionId, changing)).toMatchObject({ result: 'flushed', updated: 1, more: true });
    expect(cellOf(spreadsheetId, order.code, 'status')).toBe('Đã thanh toán');
    expect(await dirtyOf(h, connectionId)).toEqual(new Map([[order.id, 2]]));
    expect((await flushJobsOf(h, connectionId)).length).toBeGreaterThan(0);

    expect(await flush(connectionId)).toMatchObject({ result: 'flushed', updated: 1, more: false });
    expect(cellOf(spreadsheetId, order.code, 'status')).toBe('Đã hủy');
    expect(await dirtyOf(h, connectionId)).toEqual(new Map());
  });
});

describe('I/O Matrix: BTC sửa Sheet', () => {
  it('BTC chèn, xóa, sắp xếp dòng → ghi đúng dòng theo Mã Đơn; trùng mã ghi dòng đầu; khớp nguyên chuỗi; mất dòng → thêm cuối', async () => {
    const { sale, orders, connectionId, spreadsheetId } = await syncedEvent(3);
    const [a, b, c] = orders as [(typeof orders)[0], (typeof orders)[0], (typeof orders)[0]];
    const codeCol = col(spreadsheetId, 'order_code');
    // Chèn 2 dòng trống sau tiêu đề, sắp xếp ngược, xóa dòng của B.
    fake.insertRows(spreadsheetId, 1, 2);
    fake.sortRows(spreadsheetId, (x, y) => String(y[codeCol] ?? '').localeCompare(String(x[codeCol] ?? '')));
    fake.deleteRows(spreadsheetId, rowOf(spreadsheetId, b.code));
    // BTC chép dòng của A xuống dưới (trùng mã) và gõ mã C kèm dấu cách ở một dòng khác.
    const copyRow = fake.values(spreadsheetId).length;
    fake.setCell(spreadsheetId, copyRow, codeCol, a.code);
    fake.setCell(spreadsheetId, copyRow + 1, codeCol, `${c.code} `);
    const firstA = rowOf(spreadsheetId, a.code);
    const rowC = rowOf(spreadsheetId, c.code);

    await setStatus(a.id, 'cancelled');
    await setStatus(c.id, 'cancelled');
    await mark(sale.event.id, a.id, b.id, c.id);
    expect(await flush(connectionId)).toMatchObject({ result: 'flushed', updated: 2, appended: 1 });
    const values = fake.values(spreadsheetId);
    const statusCol = col(spreadsheetId, 'status');
    expect(values[firstA]![statusCol]).toBe('Đã hủy');
    expect(values[rowC]![statusCol]).toBe('Đã hủy');
    // Dòng chép (trùng mã) và dòng mã có dấu cách không bị ghi.
    expect(values[copyRow]![statusCol] ?? '').toBe('');
    expect(values[copyRow + 1]![statusCol] ?? '').toBe('');
    // B (dòng đã bị xóa) thêm sau dòng cuối cùng có giá trị trong cột Mã Đơn.
    expect(values.length - 1).toBe(copyRow + 2);
    expect(values.at(-1)![codeCol]).toBe(b.code);
  });

  it('BTC xóa dòng tiêu đề → Đơn ở dòng 1 vẫn khớp theo Mã Đơn, không thêm dòng mới', async () => {
    const { sale, orders, connectionId, spreadsheetId } = await syncedEvent(2);
    const codeCol = col(spreadsheetId, 'order_code');
    fake.deleteRows(spreadsheetId, 0);
    expect(fake.values(spreadsheetId)[0]![codeCol]).toBe(orders[0]!.code);
    await setStatus(orders[0]!.id, 'cancelled');
    await mark(sale.event.id, orders[0]!.id);
    expect(await flush(connectionId)).toMatchObject({ result: 'flushed', updated: 1, appended: 0 });
    const values = fake.values(spreadsheetId);
    expect(values.map((row) => row[codeCol])).toEqual([orders[0]!.code, orders[1]!.code]);
    expect(values[0]![col(spreadsheetId, 'status')]).toBe('Đã hủy');
  });

  it('BTC đổi tên tab "Đơn" → "Orders" → vẫn ghi đúng tab (theo sheetId)', async () => {
    const { sale, connectionId, spreadsheetId } = await syncedEvent(1);
    fake.renameTab(spreadsheetId, 0, 'Orders');
    const [order] = await seedOrders(env, sale.event.id, [{ status: 'paid' }]);
    await mark(sale.event.id, order!.id);
    expect(await flush(connectionId)).toMatchObject({ result: 'flushed', appended: 1 });
    expect(fake.values(spreadsheetId, 'Orders').at(-1)![0]).toBe(order!.code);
  });

  it('BTC chèn cột giữa các cột Tickee và di chuyển cột → ghi đúng cột theo metadata; cột BTC không đổi, tiêu đề không ghi lại', async () => {
    const { sale, orders, connectionId, spreadsheetId } = await syncedEvent(2);
    // Cột BTC chen trước "Email"; "Trạng thái" kéo về đầu.
    const btcCol = col(spreadsheetId, 'buyer_email');
    fake.insertColumns(spreadsheetId, btcCol);
    fake.setCell(spreadsheetId, 0, btcCol, 'Ghi chú BTC');
    fake.setCell(spreadsheetId, 1, btcCol, 'VIP');
    fake.setCell(spreadsheetId, 2, btcCol, 'Đã gọi');
    fake.moveColumn(spreadsheetId, col(spreadsheetId, 'status'), 0);
    fake.setCell(spreadsheetId, 0, col(spreadsheetId, 'status'), 'Trạng thái (BTC đổi tên)');
    const btcAfterMove = fake.values(spreadsheetId)[0]!.indexOf('Ghi chú BTC');

    await setStatus(orders[0]!.id, 'cancelled');
    const [added] = await seedOrders(env, sale.event.id, [{ status: 'paid' }]);
    await mark(sale.event.id, orders[0]!.id, added!.id);
    expect(await flush(connectionId)).toMatchObject({ result: 'flushed', updated: 1, appended: 1 });

    const values = fake.values(spreadsheetId);
    expect(values.map((row) => row[btcAfterMove] ?? '')).toEqual(['Ghi chú BTC', 'VIP', 'Đã gọi', '']);
    expect(col(spreadsheetId, 'status')).toBe(0);
    expect(values[0]![0]).toBe('Trạng thái (BTC đổi tên)');
    expect(cellOf(spreadsheetId, orders[0]!.code, 'status')).toBe('Đã hủy');
    expect(cellOf(spreadsheetId, added!.code, 'status')).toBe('Đã thanh toán');
    expect(cellOf(spreadsheetId, added!.code, 'buyer_email')).toBe('chen-tay@vidu.vn');
    // Không vùng ghi nào phủ cột BTC.
    for (const request of writes()) {
      for (const { dataFilter } of (request.body as { data: { dataFilter: { gridRange: Record<string, number> } }[] }).data) {
        const g = dataFilter.gridRange;
        expect(btcAfterMove < g.startColumnIndex! || btcAfterMove >= g.endColumnIndex!, JSON.stringify(g)).toBe(true);
      }
    }
    expect(batchUpdates()).toEqual([]);
  });

  it('lưới chỉ nới: thiếu dòng → appendDimension; BTC đã nới lưới lớn hơn → không bao giờ thu nhỏ', async () => {
    const { sale, connectionId, spreadsheetId } = await syncedEvent(1);
    // BTC xóa gần hết dòng trống: lưới còn 3 dòng (tiêu đề, 1 Đơn, 1 dòng trống).
    fake.deleteRows(spreadsheetId, 3, fake.tab(spreadsheetId).rowCount - 3);
    expect(fake.tab(spreadsheetId).rowCount).toBe(3);
    const added = await seedOrders(env, sale.event.id, [{ status: 'paid' }, { status: 'paid' }, { status: 'paid' }]);
    await mark(sale.event.id, ...added.map((order) => order.id));
    expect(await flush(connectionId)).toMatchObject({ result: 'flushed', appended: 3 });
    expect(fake.tab(spreadsheetId).rowCount).toBe(5);
    expect(JSON.stringify(batchUpdates().map((r) => r.body))).toContain('"appendDimension":{"sheetId":0,"dimension":"ROWS","length":2}');

    fake.insertRows(spreadsheetId, 5, 4_995);
    fake.reset();
    const [more] = await seedOrders(env, sale.event.id, [{ status: 'paid' }]);
    await mark(sale.event.id, more!.id);
    expect(await flush(connectionId)).toMatchObject({ result: 'flushed', appended: 1 });
    expect(fake.tab(spreadsheetId)).toMatchObject({ rowCount: 5_000, columnCount: 26 });
    expect(batchUpdates()).toEqual([]);
  });

  it('BTC xóa cột Tickee "Email" → thêm lại ở cuối lưới (tiêu đề, metadata); mọi Đơn đồng bộ đánh dấu bẩn, các lượt sau điền đủ', async () => {
    const { sale, orders, connectionId, spreadsheetId } = await syncedEvent(3);
    fake.deleteColumn(spreadsheetId, col(spreadsheetId, 'buyer_email'));
    expect(fake.columnOf(spreadsheetId, 'buyer_email')).toBeUndefined();
    const gridColumns = fake.tab(spreadsheetId).columnCount;

    await mark(sale.event.id, orders[0]!.id);
    expect(await flush(connectionId)).toMatchObject({ result: 'flushed', updated: 1, columnsAdded: 1, more: true });
    expect(col(spreadsheetId, 'buyer_email')).toBe(gridColumns);
    expect(fake.tab(spreadsheetId).columnCount).toBe(gridColumns + 1);
    expect(fake.values(spreadsheetId)[0]![gridColumns]).toBe('Email');
    expect(cellOf(spreadsheetId, orders[0]!.code, 'buyer_email')).toBe('chen-tay@vidu.vn');
    expect([...(await dirtyOf(h, connectionId)).keys()].sort()).toEqual([orders[1]!.id, orders[2]!.id].sort());
    // Một batchUpdate nguyên khối: thêm cột, một ô tiêu đề (chỉ cột mới), metadata.
    const requests = (batchUpdates()[0]!.body as { requests: Record<string, unknown>[] }).requests;
    expect(requests.map((r) => Object.keys(r)[0])).toEqual(['appendDimension', 'updateCells', 'createDeveloperMetadata']);

    expect(await flush(connectionId)).toMatchObject({ result: 'flushed', updated: 2, columnsAdded: 0, more: false });
    for (const order of orders) expect(cellOf(spreadsheetId, order.code, 'buyer_email')).toBe('chen-tay@vidu.vn');
  });

  it('câu hỏi form mới (Đơn đầu tiên trả lời sau khi kết nối) → thêm cột ở cuối lưới, tiêu đề là nhãn hiện tại', async () => {
    const { sale, orders, connectionId, spreadsheetId } = await syncedEvent(1, ['Cỡ áo']);
    expect(fake.values(spreadsheetId)[0]).toEqual(SHEET_HEADER);
    const order = await placeFreeOrder(h, sale, { answers: { [sale.questions[0]!.id]: 'L' } });
    await mark(sale.event.id, order.id);
    expect(await flush(connectionId)).toMatchObject({ result: 'flushed', appended: 1, columnsAdded: 1 });
    const questionCol = col(spreadsheetId, `question:${sale.questions[0]!.id}`);
    expect(questionCol).toBe(26);
    expect(fake.values(spreadsheetId)[0]![questionCol]).toBe('Cỡ áo');
    expect(cellOf(spreadsheetId, order.code, `question:${sale.questions[0]!.id}`)).toBe('L');
    // Đơn cũ được đánh dấu để điền ô (trống) của cột mới.
    expect([...(await dirtyOf(h, connectionId)).keys()]).toEqual([orders[0]!.id]);
  });
});

describe('I/O Matrix: Sheet mất → tạo Sheet mới (Quyết định 2)', () => {
  it.each([
    ['spreadsheet bị xóa (404)', 'spreadsheet_not_found', (id: string) => fake.deleteSpreadsheet(id)],
    [
      'tab theo sheet_tab_id bị xóa',
      'tab_not_found',
      (id: string) => {
        fake.addTab(id, 'Khác');
        fake.deleteTab(id, 0);
      },
    ],
    ['cột Mã Đơn bị xóa', 'order_code_column_missing', (id: string) => fake.deleteColumn(id, col(id, 'order_code'))],
    [
      'Sheet của 6.4 chưa có metadata',
      'order_code_column_missing',
      (id: string) => {
        fake.spreadsheets.get(id)!.metadata = [];
      },
    ],
  ] as const)('%s → syncing, đặt lại Sheet, lần đẩy đầu với id job mới, giữ dòng bẩn; đẩy xong thì flush ghi', async (_name, reason, lose) => {
    const { sale, orders, connectionId, spreadsheetId } = await syncedEvent(2);
    lose(spreadsheetId);
    await setStatus(orders[1]!.id, 'cancelled');
    await mark(sale.event.id, orders[1]!.id);
    expect(await flush(connectionId)).toEqual({ result: 'recreating', reason });
    expect(await connectionStateOf(h, connectionId)).toMatchObject({
      status: 'syncing',
      spreadsheet_id: null,
      spreadsheet_url: null,
      sheet_tab_id: 0,
      last_synced_at: null,
      last_error_code: null,
    });
    expect(await dirtyOf(h, connectionId)).toEqual(new Map([[orders[1]!.id, 1]]));
    const jobs = await initialSyncJobsOf(h, connectionId);
    expect(jobs.map((job) => job.id)).toEqual([
      sheetInitialSyncJobId(connectionId),
      sheetInitialSyncJobId(connectionId, spreadsheetId),
    ]);
    // Không báo BTC; trong lúc chờ, thay đổi mới chỉ đánh dấu.
    expect(await markSheetRowChanged(sheetDeps(env), { eventId: sale.event.id, orderId: orders[0]!.id })).toBe('marked');
    expect(await flush(connectionId)).toEqual({ result: 'skipped', reason: 'initial_sync_pending' });

    const synced = await runSheetInitialSync(sheetDeps(env), connectionId);
    expect(synced).toMatchObject({ result: 'synced', orders: 2 });
    const replacement = (synced as { spreadsheetId: string }).spreadsheetId;
    expect(replacement).not.toBe(spreadsheetId);
    expect(codesOf(replacement)).toEqual(orders.map((order) => order.code));
    expect((await flushJobsOf(h, connectionId)).length).toBeGreaterThan(0);
    expect(await flush(connectionId)).toMatchObject({ result: 'flushed', updated: 2, appended: 0 });
    expect(cellOf(replacement, orders[1]!.code, 'status')).toBe('Đã hủy');
    expect(await dirtyOf(h, connectionId)).toEqual(new Map());
    // Link ở Cài đặt đổi sang Sheet mới.
    const status = EventSheetConnectionResponse.parse(
      (await h.http.get(`/v1${eventGoogleSheetsApiPath(org.orgId, sale.event.id)}`).set('cookie', org.owner.cookie).expect(200))
        .body,
    );
    expect(status.connection).toMatchObject({ status: 'active', spreadsheetUrl: fake.spreadsheets.get(replacement)!.spreadsheetUrl });
  });

  it('lần đẩy đầu đang retry mà spreadsheet bị xóa → bỏ Sheet đó, tạo Sheet mới ngay lần chạy', async () => {
    const sale = await freeSheetEvent(org);
    await seedOrders(env, sale.event.id, [{ status: 'paid' }]);
    const connectionId = await connectSheet(env, sale.event.id);
    fake.sheetsReplies.push('pass', { status: 500 });
    expect(await runSheetInitialSync(sheetDeps(env), connectionId)).toEqual({ result: 'retry', code: 'server_error' });
    const first = (await connectionStateOf(h, connectionId))!.spreadsheet_id!;
    fake.deleteSpreadsheet(first);
    const outcome = await runSheetInitialSync(sheetDeps(env), connectionId);
    expect(outcome).toMatchObject({ result: 'synced', orders: 1 });
    expect((outcome as { spreadsheetId: string }).spreadsheetId).not.toBe(first);
  });
});

describe('I/O Matrix: trạng thái kết nối và lỗi Google', () => {
  it('đang đẩy đầu (syncing) → flush không gọi Google; mất quyền (auth_revoked) → không gọi Google, giữ dòng bẩn', async () => {
    const sale = await freeSheetEvent(org);
    const [order] = await seedOrders(env, sale.event.id, [{ status: 'paid' }]);
    const connectionId = await connectSheet(env, sale.event.id);
    fake.reset();
    await mark(sale.event.id, order!.id);
    expect(await flush(connectionId)).toEqual({ result: 'skipped', reason: 'initial_sync_pending' });
    expect(fake.requests).toEqual([]);

    expect(await runSheetInitialSync(sheetDeps(env), connectionId)).toMatchObject({ result: 'synced' });
    await h.db.pool.query("UPDATE sheet_connections SET status = 'auth_revoked' WHERE id = $1", [connectionId]);
    fake.reset();
    expect(await flush(connectionId)).toEqual({ result: 'skipped', reason: 'auth_revoked' });
    expect(fake.requests).toEqual([]);
    expect(await dirtyOf(h, connectionId)).toEqual(new Map([[order!.id, 1]]));
  });

  it('lần đẩy đầu đã markSynced mà hẹn flush lỗi → pg-boss chạy lại job: already_active, hẹn lại flush cho dòng bẩn', async () => {
    const sale = await freeSheetEvent(org);
    const [order] = await seedOrders(env, sale.event.id, [{ status: 'paid' }]);
    const connectionId = await connectSheet(env, sale.event.id);
    // Đơn đổi trong lúc đẩy đầu: chỉ đánh dấu.
    await mark(sale.event.id, order!.id);
    const failing = { send: () => Promise.reject(new Error('pg-boss lỗi thử')) } as unknown as PgBoss;
    await expect(runSheetInitialSync({ ...sheetDeps(env), boss: failing }, connectionId)).rejects.toThrow('pg-boss lỗi thử');
    expect(await connectionStateOf(h, connectionId)).toMatchObject({ status: 'active' });
    expect(await flushJobsOf(h, connectionId)).toEqual([]);

    fake.reset();
    expect(await runSheetInitialSync(sheetDeps(env), connectionId)).toEqual({ result: 'skipped', reason: 'already_active' });
    expect(fake.requests).toEqual([]);
    expect((await flushJobsOf(h, connectionId)).map((job) => job.state)).toEqual(['created']);
    expect(await dirtyOf(h, connectionId)).toEqual(new Map([[order!.id, 1]]));
  });

  it('flush lỗi tạm thời (retrying, last_synced_at có) → lần đẩy đầu chạy lại bỏ qua (already_active), không gọi Google', async () => {
    const { orders, connectionId } = await syncedEvent(1);
    // Dòng bẩn chèn thẳng (không qua handler, nên chưa có job flush nào).
    await h.db.pool.query('INSERT INTO sheet_dirty_rows (connection_id, order_id) VALUES ($1, $2)', [connectionId, orders[0]!.id]);
    fake.sheetsReplies.push({ status: 500 });
    expect(await flush(connectionId)).toEqual({ result: 'retry', code: 'server_error' });
    const state = await connectionStateOf(h, connectionId);
    expect(state).toMatchObject({ status: 'retrying', last_error_code: 'server_error' });
    expect(state!.last_synced_at).not.toBeNull();

    fake.reset();
    expect(await runSheetInitialSync(sheetDeps(env), connectionId)).toEqual({ result: 'skipped', reason: 'already_active' });
    expect(fake.requests).toEqual([]);
    expect(await connectionStateOf(h, connectionId)).toMatchObject({ status: 'retrying', last_error_code: 'server_error' });
    // Dòng bẩn còn: lần đẩy đầu hẹn lại flush (chỉ ghi DB).
    expect((await flushJobsOf(h, connectionId)).map((job) => job.state)).toEqual(['created']);
  });

  it('không có dòng bẩn → không gọi Google', async () => {
    const { connectionId } = await syncedEvent(1);
    expect(await flush(connectionId)).toEqual({ result: 'skipped', reason: 'clean' });
    expect(fake.requests).toEqual([]);
  });

  it.each([
    ['invalid_grant', () => fake.refreshReplies.push('invalid_grant'), 'invalid_grant'],
    ['403 không kèm lý do quota', () => fake.sheetsReplies.push({ status: 403 }), 'forbidden'],
  ] as const)('%s khi flush → auth_revoked, không retry, giữ dòng bẩn', async (_name, script, code) => {
    const { sale, orders, connectionId } = await syncedEvent(1);
    await mark(sale.event.id, orders[0]!.id);
    script();
    expect(await flush(connectionId)).toEqual({ result: 'auth_revoked', code });
    expect(await connectionStateOf(h, connectionId)).toMatchObject({ status: 'auth_revoked', last_error_code: code });
    expect(await dirtyOf(h, connectionId)).toEqual(new Map([[orders[0]!.id, 1]]));
  });

  it.each([
    ['429', () => fake.sheetsReplies.push({ status: 429 }), 'rate_limited'],
    ['5xx', () => fake.sheetsReplies.push('pass', 'pass', { status: 503 }), 'server_error'],
    ['403 rateLimitExceeded', () => fake.sheetsReplies.push(sheetsForbidden('rateLimitExceeded')), 'rate_limited'],
    ['403 userRateLimitExceeded', () => fake.sheetsReplies.push(sheetsForbidden('userRateLimitExceeded')), 'rate_limited'],
    ['403 quotaExceeded', () => fake.sheetsReplies.push('pass', sheetsForbidden('quotaExceeded')), 'rate_limited'],
    ['403 storageQuotaExceeded', () => fake.sheetsReplies.push(sheetsForbidden('storageQuotaExceeded')), 'storage_quota'],
    [
      '403 chỉ có ErrorInfo RATE_LIMIT_EXCEEDED',
      () =>
        fake.sheetsReplies.push({
          status: 403,
          body: {
            error: {
              code: 403,
              message: "Quota exceeded for quota metric 'Write requests' of service 'sheets.googleapis.com'.",
              status: 'RESOURCE_EXHAUSTED',
              details: [
                {
                  '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
                  reason: 'RATE_LIMIT_EXCEEDED',
                  domain: 'googleapis.com',
                  metadata: { service: 'sheets.googleapis.com' },
                },
              ],
            },
          },
        }),
      'rate_limited',
    ],
  ] as const)('lỗi tạm thời (%s) → retrying + last_error_code, dòng bẩn còn; lần sau thành công → active, xóa mã lỗi', async (_name, script, code) => {
    const { sale, orders, connectionId, spreadsheetId } = await syncedEvent(1);
    await setStatus(orders[0]!.id, 'cancelled');
    await mark(sale.event.id, orders[0]!.id);
    script();
    expect(await flush(connectionId)).toEqual({ result: 'retry', code });
    expect(await connectionStateOf(h, connectionId)).toMatchObject({ status: 'retrying', last_error_code: code });
    expect(await dirtyOf(h, connectionId)).toEqual(new Map([[orders[0]!.id, 1]]));

    expect(await flush(connectionId)).toMatchObject({ result: 'flushed', updated: 1 });
    expect(await connectionStateOf(h, connectionId)).toMatchObject({ status: 'active', last_error_code: null });
    expect(cellOf(spreadsheetId, orders[0]!.code, 'status')).toBe('Đã hủy');
  });

  it('timeout khi flush → retrying + timeout', async () => {
    const { sale, orders, connectionId } = await syncedEvent(1);
    await mark(sale.event.id, orders[0]!.id);
    fake.sheetsReplies.push('hang');
    expect(await flush(connectionId, sheetsClientOf(fake, 300))).toEqual({ result: 'retry', code: 'timeout' });
    expect(await connectionStateOf(h, connectionId)).toMatchObject({ status: 'retrying', last_error_code: 'timeout' });
  });
});

describe('I/O Matrix: ngắt kết nối giữa lượt', () => {
  const clientWith = (sale: SaleEvent, when: 'read' | 'write') => {
    class DisconnectingClient extends GoogleSheetsClient {
      override async readColumn(...args: Parameters<GoogleSheetsClient['readColumn']>): Promise<string[]> {
        const column = await super.readColumn(...args);
        if (when === 'read') await disconnectSheet(env, sale.event.id);
        return column;
      }

      override async writeCells(accessToken: string, spreadsheetId: string, blocks: readonly CellBlock[]): Promise<void> {
        await super.writeCells(accessToken, spreadsheetId, blocks);
        if (when === 'write') await disconnectSheet(env, sale.event.id);
      }
    }
    return new DisconnectingClient({
      clientId: SHEETS_CLIENT_ID,
      clientSecret: SHEETS_CLIENT_SECRET,
      authorizeUrl: fake.authorizeUrl,
      tokenUrl: fake.tokenUrl,
      sheetsApiUrl: fake.url,
    });
  };

  it.each([
    ['trước khi ghi', 'read', 0],
    ['sau khi ghi, trước khi cập nhật trạng thái', 'write', 1],
  ] as const)('kết nối bị xóa %s → dừng, không cập nhật trạng thái; dòng bẩn bị xóa theo', async (_name, when, writeCount) => {
    const { sale, orders, connectionId } = await syncedEvent(1);
    await mark(sale.event.id, orders[0]!.id);
    expect(await flush(connectionId, clientWith(sale, when))).toEqual({ result: 'disconnected' });
    expect(writes()).toHaveLength(writeCount);
    expect(await connectionStateOf(h, connectionId)).toBeUndefined();
    expect(await dirtyOf(h, connectionId)).toEqual(new Map());
  });
});
