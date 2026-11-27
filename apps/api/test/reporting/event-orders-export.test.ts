import { randomInt, randomUUID } from 'node:crypto';
import { request as httpRequest, ServerResponse } from 'node:http';
import {
  ErrorResponse,
  eventOrdersExportApiPath,
  formatVnFileStamp,
  IDEMPOTENCY_KEY_HEADER,
  ORDER_CODE_ALPHABET,
  type EventOrdersExportPathQuery,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventOrdersService } from '../../src/modules/reporting/event-orders.service.js';
import type { TingeeCredential } from '../../src/modules/tingee/index.js';
import { TEST_WEB_ORIGIN } from '../helpers.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import {
  eventOnSale,
  eventsPath,
  ipnKeyOf,
  orderBody,
  paidReadyOrg,
  parseOrder,
  postOrder,
  resetOrderRateLimit,
  type Org,
  type PayoutSpec,
  type SaleEvent,
  type User,
} from '../ordering/order-fixtures.js';
import { orderState, postIpn } from '../payment/ipn-fixtures.js';
import { listen } from '../platform/sse-client.js';
import {
  fakeAccount,
  fakeIpnPayload,
  signIpn,
  startTingeeFake,
  type FakeIpnPayload,
  type TingeeFake,
} from '../tingee-fake/server.js';

/*
 * Story 6.3: xuất CSV danh sách Đơn — `GET /v1/orgs/:orgId/events/:eventId/orders/export`, cùng bộ lọc với tab Đơn (6.1),
 * stream theo lô 500 Đơn, audit mỗi lần xuất. Postgres thật và Tingee fake; Đơn thật đi qua đặt Đơn + IPN + thao tác Cần
 * xử lý, ca cần nhiều Đơn hoặc ký tự lạ chèn thẳng bằng SQL.
 */

const MAIN: TingeeCredential = { clientId: 'tg-export-main-7c1e', secretToken: 'tg-export-main-secret-Qw3Er5Ty7' };
const account = fakeAccount({ accountName: 'TRAN MINH KHOA' });
const PAYOUT: PayoutSpec = {
  vaAccountNumber: String(account.vaAccountNumber),
  accountName: String(account.accountName),
  bankName: String(account.bankName),
};
const VIP = 300_000;
const NORMAL = 100_000;
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const HEADER = [
  'Mã Đơn',
  'Tên người mua',
  'Email',
  'SĐT',
  'Vé',
  'Số tiền',
  'Đã nhận',
  'Trạng thái',
  'Cần xử lý',
  'Thời gian tạo',
  'Thời gian thanh toán',
  'Đã check-in',
  'Số Vé',
] as const;
/** Vị trí các cột cố định trong một dòng. */
const COL = Object.fromEntries(HEADER.map((name, i) => [name, i])) as Record<(typeof HEADER)[number], number>;

let fake: TingeeFake;
let h: Harness;
let org: Org;
let ipnKey: string;

beforeAll(async () => {
  fake = await startTingeeFake({ merchants: [{ ...MAIN, accounts: [account] }] });
  h = await createHarness({ TINGEE_BASE_URL: fake.url });
  org = await paidReadyOrg(h, { name: 'CLB Chạy bộ Hồ Gươm', credential: MAIN, payout: PAYOUT });
  ipnKey = await ipnKeyOf(h, org.orgId);
});
beforeEach(async () => {
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  await h.close();
  await fake.close();
});

const exportPath = (eventId: string, query: EventOrdersExportPathQuery = {}, orgId = org.orgId) =>
  `/v1${eventOrdersExportApiPath(orgId, eventId, query)}`;

/**
 * Bộ đọc CSV RFC 4180 tối thiểu cho test: ô bọc `"…"` (`""` là một `"`), dòng kết thúc bằng CRLF; CR/LF trong ô bọc giữ
 * nguyên.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else cell += c;
  }
  expect(cell === '' && row.length === 0, 'file kết thúc bằng CRLF').toBe(true);
  return rows;
}

interface Exported {
  bytes: Buffer;
  /** Nội dung sau BOM. */
  text: string;
  header: string[];
  rows: string[][];
  headers: Record<string, string>;
}

async function exportOf(eventId: string, query: EventOrdersExportPathQuery = {}, cookie = org.owner.cookie): Promise<Exported> {
  const res = await h.http.get(exportPath(eventId, query)).set('cookie', cookie).responseType('blob');
  const bytes = res.body as Buffer;
  expect(res.status, bytes.toString('utf8')).toBe(200);
  expect(bytes.subarray(0, 3).equals(BOM), 'file bắt đầu bằng BOM').toBe(true);
  const text = bytes.subarray(3).toString('utf8');
  const [header, ...rows] = parseCsv(text);
  return { bytes, text, header: header!, rows, headers: res.headers as Record<string, string> };
}

const codesOf = (exported: Exported) => exported.rows.map((r) => r[COL['Mã Đơn']]);

/** Sự kiện mới đã mở bán: Hạng vé VIP 300.000đ và Thường 100.000đ, kèm câu hỏi nếu có. */
const saleEvent = (questions: Parameters<typeof eventOnSale>[2] = {}) =>
  eventOnSale(
    org,
    [
      { name: 'VIP', price: VIP, capacity: 50 },
      { name: 'Thường', price: NORMAL, capacity: 50 },
    ],
    questions,
  );

interface Placed {
  code: string;
  orderId: string;
  total: number;
  buyer: User;
}

async function place(
  sale: SaleEvent,
  options: { vip?: number; normal?: number; name?: string; phone?: string; answers?: Record<string, string> } = {},
): Promise<Placed> {
  const buyer = await signUp(h);
  const items = [
    ...((options.vip ?? 1) > 0 ? [{ ticketTypeId: sale.tiers[0]!.id, quantity: options.vip ?? 1 }] : []),
    ...(options.normal ? [{ ticketTypeId: sale.tiers[1]!.id, quantity: options.normal }] : []),
  ];
  const res = await postOrder(
    h,
    buyer,
    sale.event.slug,
    orderBody(items, {
      buyer: { name: options.name ?? 'Nguyễn Văn Minh', phone: options.phone ?? '0912 345 678' },
      answers: options.answers ?? {},
    }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const order = parseOrder(res.body);
  return { code: order.code, orderId: (await orderState(h, order.code)).id, total: order.totalAmount, buyer };
}

async function ipn(code: string, amount: number): Promise<FakeIpnPayload> {
  const payload = fakeIpnPayload(code, amount);
  await postIpn(h, ipnKey, signIpn(MAIN.secretToken, payload)).expect(200);
  return payload;
}

async function itemIdOf(payload: FakeIpnPayload): Promise<string> {
  const { rows } = await h.db.pool.query<{ id: string }>(
    `SELECT r.id FROM review_items r JOIN payment_events e ON e.id = r.payment_event_id
      WHERE e.provider_transaction_code = $1`,
    [payload.providerTransactionCode],
  );
  expect(rows).toHaveLength(1);
  return rows[0]!.id;
}

async function approve(itemId: string): Promise<void> {
  const res = await h.http
    .post(`/v1/orgs/${org.orgId}/review-items/${itemId}/approve`)
    .set('cookie', org.owner.cookie)
    .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
    .send({});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

const randomCode = () =>
  `TK${Array.from({ length: 8 }, () => ORDER_CODE_ALPHABET[randomInt(ORDER_CODE_ALPHABET.length)]).join('')}`;

interface Seed {
  createdAt: string;
  code?: string;
  /** `expired` (mặc định), `pending` hoặc `paid` (Đơn 0đ, nguồn `free`). */
  status?: 'expired' | 'pending' | 'paid';
  name?: string;
  phone?: string;
  email?: string;
}

/** Chèn thẳng Đơn (không dòng, không Vé) cho Sự kiện `sale`, giờ tạo cố định đủ micro giây. Trả mã theo thứ tự `seeds`. */
async function seed(sale: SaleEvent, seeds: Seed[]): Promise<string[]> {
  const rows = seeds.map((s) => ({
    code: s.code ?? randomCode(),
    created_at: s.createdAt,
    status: s.status ?? 'expired',
    name: s.name ?? 'Người mua chèn tay',
    phone: s.phone ?? '+84900000000',
    email: s.email ?? 'chen-tay@vidu.vn',
  }));
  await h.db.pool.query(
    `INSERT INTO orders (code, user_id, event_id, organization_id, status, total_amount, buyer_name, buyer_phone,
                         buyer_email, idempotency_key, expires_at, created_at, paid_at, paid_amount, paid_source)
     SELECT s.code, gen_random_uuid(), $1, $2, s.status, 0, s.name, s.phone, s.email, gen_random_uuid(), s.created_at,
            s.created_at,
            CASE WHEN s.status = 'paid' THEN s.created_at END,
            CASE WHEN s.status = 'paid' THEN 0 END,
            CASE WHEN s.status = 'paid' THEN 'free' END
       FROM jsonb_to_recordset($3::jsonb)
         AS s(code text, created_at timestamptz, status text, name text, phone text, email text)`,
    [sale.event.id, org.orgId, JSON.stringify(rows)],
  );
  return rows.map((r) => r.code);
}

/** Giờ tạo thứ `i` (giây tăng dần) kèm phần micro giây `micros`. */
const at = (i: number, micros = '000000') =>
  `2026-11-26T${String(Math.floor(i / 3600)).padStart(2, '0')}:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.${micros}Z`;

/** Mới nhất trước: `created_at` rồi mã Đơn, giảm dần (như api). */
const newestFirst = (seeds: { createdAt: string; code: string }[]) =>
  [...seeds]
    .sort((a, b) => (a.createdAt === b.createdAt ? (a.code < b.code ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1))
    .map((s) => s.code);

describe('định dạng file', () => {
  it('lọc "Đã thanh toán" (3 paid, 2 pending): BOM, hàng tiêu đề, 3 dòng; header text/csv, tên file don-<slug>-<giờ VN>.csv, no-store', async () => {
    const sale = await saleEvent();
    const [p1, , p2, , p3] = await seed(sale, [
      { createdAt: at(1), status: 'paid' },
      { createdAt: at(2), status: 'pending' },
      { createdAt: at(3), status: 'paid' },
      { createdAt: at(4), status: 'pending' },
      { createdAt: at(5), status: 'paid' },
    ]);
    const before = Date.now();
    const exported = await exportOf(sale.event.id, { status: 'paid' });
    const after = Date.now();

    expect(exported.text.startsWith(`${HEADER.join(',')}\r\n`)).toBe(true);
    expect(exported.header).toEqual(HEADER);
    expect(codesOf(exported)).toEqual([p3, p2, p1]);
    expect(exported.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(exported.headers['cache-control']).toBe('no-store');
    const disposition = exported.headers['content-disposition']!;
    const stamp = /^attachment; filename="don-(.+)-(\d{8}-\d{4})\.csv"$/.exec(disposition);
    expect(stamp, disposition).not.toBeNull();
    expect(stamp![1]).toBe(sale.event.slug);
    expect([formatVnFileStamp(new Date(before)), formatVnFileStamp(new Date(after))]).toContain(stamp![2]);
  });

  it('Đơn chèn tay: SĐT "0912 345 678", thời gian yyyy-MM-dd HH:mm:ss giờ Việt Nam; Đơn 0đ: Số tiền 0, Đã nhận 0', async () => {
    const sale = await saleEvent();
    const [code] = await seed(sale, [
      { createdAt: '2026-11-26T16:59:59.123456Z', status: 'paid', name: 'Lê Thu Trang', phone: '+84912345678', email: 'trang@vidu.vn' },
    ]);
    const { rows } = await exportOf(sale.event.id);
    expect(rows).toEqual([
      [code, 'Lê Thu Trang', 'trang@vidu.vn', '0912 345 678', '', '0', '0', 'Đã thanh toán', '', '2026-11-26 23:59:59', '2026-11-26 23:59:59', '', ''],
    ]);
  });

  it('Sự kiện không có câu hỏi và không Đơn nào khớp (q là email không có Đơn) → BOM + hàng tiêu đề', async () => {
    const sale = await saleEvent();
    await seed(sale, [{ createdAt: at(1), email: 'co-don@vidu.vn' }]);
    const exported = await exportOf(sale.event.id, { q: 'khong-co-don@vidu.vn' });
    expect(exported.bytes.equals(Buffer.concat([BOM, Buffer.from(`${HEADER.join(',')}\r\n`, 'utf8')]))).toBe(true);
    expect(exported.rows).toEqual([]);
  });

  it("câu trả lời toàn chữ số: bắt đầu bằng 0 hoặc từ 12 chữ số → thêm ' ở đầu (Excel giữ đủ chữ số); số ngắn giữ nguyên", async () => {
    const sale = await saleEvent({
      questions: ['CCCD', 'SĐT người thân', 'Mã thành viên', 'Số người'].map((label) => ({
        label,
        kind: 'text' as const,
        required: false,
      })),
    });
    const [id, relative, member, count] = sale.questions;
    await place(sale, {
      answers: { [id!.id]: '001203004567', [relative!.id]: '0987654321', [member!.id]: '123456789012', [count!.id]: '42' },
    });
    const exported = await exportOf(sale.event.id);
    expect(exported.text).toContain(`,'001203004567,'0987654321,'123456789012,42\r\n`);
    expect(exported.rows[0]!.slice(HEADER.length)).toEqual(["'001203004567", "'0987654321", "'123456789012", '42']);
  });

  it('ô nguy hiểm được thoát: tên =HYPERLINK("x"), câu trả lời -1, @a, \\tb; ô có dấu phẩy, ngoặc kép, xuống dòng được bọc', async () => {
    const sale = await saleEvent({
      questions: [
        { label: 'Số áo', kind: 'text', required: false },
        { label: 'Biệt danh', kind: 'text', required: false },
        { label: 'Ghi chú', kind: 'text', required: false },
        { label: '=Mã nhóm', kind: 'text', required: false },
      ],
    });
    const [shirt, nick, note, group] = sale.questions;
    const placed = await place(sale, {
      name: '=HYPERLINK("x")',
      answers: { [shirt!.id]: '-1', [nick!.id]: '@a', [note!.id]: 'A, "B"\nC' },
    });
    // Câu trả lời bị trim khi đặt Đơn: tab ở đầu chỉ có được bằng SQL.
    await h.db.pool.query(
      `INSERT INTO order_answers (order_id, question_id, position, label, kind, answer) VALUES ($1, $2, 3, '=Mã nhóm', 'text', $3)`,
      [placed.orderId, group!.id, '\tb'],
    );

    const exported = await exportOf(sale.event.id);
    expect(exported.text).toContain(`${placed.code},"'=HYPERLINK(""x"")",`);
    expect(exported.text).toContain(`,'-1,'@a,"A, ""B""\nC",'\tb\r\n`);
    expect(exported.text.split('\r\n')[0]).toBe(`${HEADER.join(',')},Số áo,Biệt danh,Ghi chú,'=Mã nhóm`);
    expect(exported.rows).toHaveLength(1);
    const row = exported.rows[0]!;
    expect(row[COL['Tên người mua']]).toBe(`'=HYPERLINK("x")`);
    expect(row.slice(HEADER.length)).toEqual(["'-1", "'@a", 'A, "B"\nC', "'\tb"]);
  });
});

describe('cột theo trạng thái Đơn', () => {
  it('duyệt tay lệch tiền (300.000đ, nhận 250.000đ): Số tiền 300000, Đã nhận 250000, "Đã thanh toán", Cần xử lý trống; Đã check-in 0, Số Vé 1', async () => {
    const sale = await saleEvent();
    const placed = await place(sale, { vip: 1, name: 'Võ Minh Thư', phone: '0987.654.321' });
    await approve(await itemIdOf(await ipn(placed.code, 250_000)));
    const { rows } = await exportOf(sale.event.id);
    const { rows: db } = await h.db.pool.query<{ created_at: Date; paid_at: Date }>(
      'SELECT created_at, paid_at FROM orders WHERE id = $1',
      [placed.orderId],
    );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.slice(0, HEADER.length)).toEqual([
      placed.code,
      'Võ Minh Thư',
      placed.buyer.email,
      '0987 654 321',
      '1 × VIP',
      '300000',
      '250000',
      'Đã thanh toán',
      '',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
      '0',
      '1',
    ]);
    const vn = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
    expect(row[COL['Thời gian tạo']]).toBe(vn(db[0]!.created_at));
    expect(row[COL['Thời gian thanh toán']]).toBe(vn(db[0]!.paid_at));
  });

  it('Đơn chờ thanh toán: Đã nhận, Thời gian thanh toán, Đã check-in, Số Vé trống; Vé "2 × VIP, 1 × Thường"', async () => {
    const sale = await saleEvent();
    const placed = await place(sale, { vip: 2, normal: 1 });
    const { rows } = await exportOf(sale.event.id);
    const row = rows[0]!;
    expect(row[COL['Trạng thái']]).toBe('Chờ thanh toán');
    expect(row[COL['Vé']]).toBe('2 × VIP, 1 × Thường');
    expect(row[COL['Số tiền']]).toBe(String(placed.total));
    expect(row[COL['Đã nhận']]).toBe('');
    expect(row[COL['Thời gian thanh toán']]).toBe('');
    expect(row[COL['Đã check-in']]).toBe('');
    expect(row[COL['Số Vé']]).toBe('');
  });

  it('Check-in: 3 Vé valid, 2 đã check-in → Đã check-in 2, Số Vé 3 (hai cột số); Vé đã hủy (kể cả đã check-in) không tính', async () => {
    const sale = await saleEvent();
    const three = await place(sale, { vip: 3 });
    await ipn(three.code, three.total);
    const two = await place(sale, { vip: 2 });
    await ipn(two.code, two.total);
    await h.db.pool.query(
      `UPDATE tickets SET checked_in_at = now() WHERE id IN (SELECT id FROM tickets WHERE order_id = $1 ORDER BY seq LIMIT 2)`,
      [three.orderId],
    );
    // Đơn hai Vé: một Vé đã check-in rồi bị vô hiệu → 0 trên 1.
    await h.db.pool.query(
      `UPDATE tickets SET checked_in_at = now(), status = 'cancelled', cancel_reason = 'voided' WHERE order_id = $1 AND seq = 1`,
      [two.orderId],
    );
    const exported = await exportOf(sale.event.id);
    const checkinOf = (code: string) =>
      exported.rows.find((r) => r[COL['Mã Đơn']] === code)!.slice(COL['Đã check-in'], COL['Số Vé'] + 1);
    expect(checkinOf(three.code)).toEqual(['2', '3']);
    expect(checkinOf(two.code)).toEqual(['0', '1']);
    expect(exported.text).not.toMatch(/,\d+\/\d+,/);
  });

  it('Cần xử lý: tên loại của mục open cũ nhất ở mọi trạng thái Đơn (review lệch tiền, paid trả trùng); bộ lọc needs_action', async () => {
    const sale = await saleEvent();
    const mismatch = await place(sale, { name: 'Lệch tiền' });
    await ipn(mismatch.code, 250_000);
    const duplicate = await place(sale, { name: 'Trả trùng' });
    await ipn(duplicate.code, duplicate.total);
    await ipn(duplicate.code, duplicate.total);
    const clean = await place(sale, { name: 'Bình thường' });
    await ipn(clean.code, clean.total);

    const all = await exportOf(sale.event.id);
    const byCode = new Map(all.rows.map((r) => [r[COL['Mã Đơn']], r]));
    expect(byCode.get(mismatch.code)!.slice(COL['Trạng thái'], COL['Cần xử lý'] + 1)).toEqual(['Cần xử lý', 'Lệch số tiền']);
    expect(byCode.get(duplicate.code)!.slice(COL['Trạng thái'], COL['Cần xử lý'] + 1)).toEqual([
      'Đã thanh toán',
      'Thanh toán trùng',
    ]);
    expect(byCode.get(clean.code)!.slice(COL['Trạng thái'], COL['Cần xử lý'] + 1)).toEqual(['Đã thanh toán', '']);
    expect(codesOf(await exportOf(sale.event.id, { status: 'needs_action' }))).toEqual([duplicate.code, mismatch.code]);
  });
});

describe('cột câu hỏi form', () => {
  it('theo id câu hỏi: đổi nhãn vẫn một cột (nhãn của Đơn mới nhất), câu đã xóa vẫn có cột; thứ tự theo position của lần đặt đó; cột không theo bộ lọc', async () => {
    const sale = await saleEvent({
      questions: [
        { label: 'Size áo', kind: 'text', required: true },
        { label: 'Câu lạc bộ', kind: 'text', required: false },
      ],
    });
    const [size, club] = sale.questions;
    const older = await place(sale, { name: 'Đơn cũ', answers: { [size!.id]: 'L', [club!.id]: 'CLB Hồ Tây' } });

    // Sau khi đã có Đơn: đổi nhãn câu đầu, xóa câu sau, thêm câu mới (chiếm vị trí 1 của câu đã xóa).
    await h.http
      .patch(`${eventsPath(org, sale.event.id)}/form/questions/${size!.id}`)
      .set('cookie', org.owner.cookie)
      .send({ label: 'Cỡ áo thi đấu', kind: 'text', required: true, options: [] })
      .expect(200);
    await h.http.delete(`${eventsPath(org, sale.event.id)}/form/questions/${club!.id}`).set('cookie', org.owner.cookie).expect(204);
    const blood = (
      await h.http
        .post(`${eventsPath(org, sale.event.id)}/form/questions`)
        .set('cookie', org.owner.cookie)
        .send({ label: 'Nhóm máu', kind: 'choice', required: false, options: [{ label: 'O' }, { label: 'A' }] })
        .expect(201)
    ).body as { id: string; options: { id: string; label: string }[] };
    const newer = await place(sale, {
      name: 'Đơn mới',
      answers: { [size!.id]: 'M', [blood.id]: blood.options[0]!.id },
    });
    await ipn(newer.code, newer.total);

    const all = await exportOf(sale.event.id);
    // Cùng position 1: câu của Đơn mới hơn ("Nhóm máu") trước câu đã xóa ("Câu lạc bộ").
    expect(all.header).toEqual([...HEADER, 'Cỡ áo thi đấu', 'Nhóm máu', 'Câu lạc bộ']);
    const answersOf = (exported: Awaited<ReturnType<typeof exportOf>>, code: string) =>
      exported.rows.find((r) => r[COL['Mã Đơn']] === code)!.slice(HEADER.length);
    expect(answersOf(all, newer.code)).toEqual(['M', 'O', '']);
    expect(answersOf(all, older.code)).toEqual(['L', '', 'CLB Hồ Tây']);

    // Lọc chỉ còn Đơn mới: vẫn đủ ba cột (cột tính trên mọi Đơn của Sự kiện).
    const paid = await exportOf(sale.event.id, { status: 'paid' });
    expect(paid.header).toEqual(all.header);
    expect(codesOf(paid)).toEqual([newer.code]);
    // Không có Đơn nào khớp: vẫn đủ cột.
    expect((await exportOf(sale.event.id, { status: 'refunded' })).header).toEqual(all.header);
  });
});

describe('stream theo lô', () => {
  it('1.201 Đơn, Đơn trùng created_at ở ranh giới lô 500 và 1000 → 1.201 dòng, mới nhất trước, không mất, không lặp; lọc theo tìm vẫn đúng', async () => {
    const sale = await saleEvent();
    // 7 Đơn một mốc giờ: ranh giới lô (vị trí 500 và 1000 tính từ mới nhất) rơi giữa một nhóm cùng `created_at`.
    const seeds: (Seed & { code: string })[] = Array.from({ length: 1201 }, (_, i) => ({
      createdAt: at(Math.floor(i / 7), '123456'),
      code: randomCode(),
    }));
    seeds[3]!.status = 'paid';
    seeds[3]!.phone = '+84987000111';
    await seed(sale, seeds);
    const expected = newestFirst(seeds);
    const boundary = (p: number) => seeds.find((s) => s.code === expected[p])!.createdAt;
    expect(boundary(499)).toBe(boundary(500));
    expect(boundary(999)).toBe(boundary(1000));

    const exported = await exportOf(sale.event.id);
    expect(codesOf(exported)).toEqual(expected);
    expect(new Set(codesOf(exported)).size).toBe(1201);
    expect(codesOf(await exportOf(sale.event.id, { q: '0987 000 111' }))).toEqual([seeds[3]!.code]);
  });

  it('số câu truy vấn mỗi lô cố định: 3 Đơn và 500 Đơn (một lô) bằng nhau; 1.201 Đơn (ba lô) thêm đúng 2 lô', async () => {
    const countQueries = async (eventId: string): Promise<{ queries: number; rows: number }> => {
      const spy = vi.spyOn(pg.Client.prototype, 'query');
      try {
        const { rows } = await exportOf(eventId);
        return { queries: spy.mock.calls.length, rows: rows.length };
      } finally {
        spy.mockRestore();
      }
    };
    const sizes = [3, 500, 1201];
    const events: SaleEvent[] = [];
    for (const size of sizes) {
      const sale = await saleEvent();
      await seed(sale, Array.from({ length: size }, (_, i) => ({ createdAt: at(i) })));
      events.push(sale);
    }
    await countQueries(events[0]!.event.id);
    const [small, full, big] = [
      await countQueries(events[0]!.event.id),
      await countQueries(events[1]!.event.id),
      await countQueries(events[2]!.event.id),
    ];
    expect([small.rows, full.rows, big.rows]).toEqual(sizes);
    expect(full.queries).toBe(small.queries);
    // Mỗi lô: Đơn, dòng, câu trả lời, đếm check-in, mục Cần xử lý `open`.
    expect(big.queries - small.queries).toBe(2 * 5);
  });

  it('client ngắt sau phần đầu: api thôi đọc DB (không đọc lô sau), không 500, không log lỗi', async () => {
    const sale = await saleEvent();
    await seed(sale, Array.from({ length: 1201 }, (_, i) => ({ createdAt: at(i) })));
    const http = await listen(h.app);
    const before = h.logs.lines.length;
    // Giữ câu đọc lô đầu tới khi client đã ngắt hẳn: server chỉ thấy kết nối đóng lúc ghi lô đó.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const original = pg.Client.prototype.query;
    let batchReads = 0;
    const spy = vi.spyOn(pg.Client.prototype, 'query').mockImplementation(function (this: pg.Client, ...args: unknown[]) {
      const config = args[0] as { text?: string } | string;
      const text = typeof config === 'string' ? config : (config.text ?? '');
      if (/from "orders"/i.test(text) && /limit \$\d+/i.test(text) && text.includes('"buyer_name"')) {
        batchReads += 1;
        return gate.then(() => (original as (...a: unknown[]) => unknown).apply(this, args)) as never;
      }
      return (original as (...a: unknown[]) => unknown).apply(this, args) as never;
    });
    // Giữ lại `chunks` của lần xuất để kiểm handler đã dừng sạch (generator kết thúc), không treo chờ `drain` mãi.
    const exportCsv = EventOrdersService.prototype.exportCsv;
    let chunks: AsyncGenerator<string, void, undefined> | undefined;
    const exportSpy = vi
      .spyOn(EventOrdersService.prototype, 'exportCsv')
      .mockImplementation(async function (this: EventOrdersService, ...args: Parameters<typeof exportCsv>) {
        const opened = await exportCsv.apply(this, args);
        chunks = opened.chunks;
        return opened;
      });
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(`${http.baseUrl}${exportPath(sale.event.id)}`, { headers: { cookie: org.owner.cookie } }, (res) => {
          res.once('data', () => {
            req.destroy();
            resolve(res.statusCode ?? 0);
          });
        });
        req.on('error', () => undefined);
        req.on('close', () => undefined);
        req.end();
        setTimeout(() => reject(new Error('không nhận được phần đầu')), 5_000).unref();
      });
      expect(status).toBe(200);
      await expect.poll(() => new Promise((r) => http.server.getConnections((_, n) => r(n)))).toBe(0);
      release();
      // Đủ lâu để server kịp đọc thêm lô nếu không dừng.
      await new Promise((r) => setTimeout(r, 300));
      expect(batchReads).toBe(1);
      // Handler đã `return` khỏi vòng lặp: generator đã kết thúc (handler treo thì `next()` sẽ đọc tiếp lô sau).
      expect(chunks).toBeDefined();
      expect(await chunks!.next()).toEqual({ done: true, value: undefined });
      expect(batchReads).toBe(1);
    } finally {
      release();
      spy.mockRestore();
      exportSpy.mockRestore();
      await http.close();
    }
    const logged = h.logs.lines.slice(before);
    expect(logged.filter((line) => Number(line.level) >= 50)).toEqual([]);
    expect(JSON.stringify(logged)).not.toContain('dừng giữa chừng');
    expect(logged.map((line) => (line.res as { statusCode?: number } | undefined)?.statusCode).filter((s) => s !== undefined)).not.toContain(500);
  });

  it('backpressure: client tạm dừng đọc → res.write trả false, server chờ drain rồi gửi tiếp; file tới đủ 1.201 dòng, đúng thứ tự', async () => {
    const sale = await saleEvent({ questions: [{ label: 'Ghi chú', kind: 'text', required: false }] });
    const codes = await seed(sale, Array.from({ length: 1201 }, (_, i) => ({ createdAt: at(i) })));
    // Câu trả lời dài (~9,6 MB cả file): vượt bộ đệm socket khi client dừng đọc.
    await h.db.pool.query(
      `INSERT INTO order_answers (order_id, question_id, position, label, kind, answer)
       SELECT id, $2, 0, 'Ghi chú', 'text', repeat('x', 8000) FROM orders WHERE event_id = $1`,
      [sale.event.id, sale.questions[0]!.id],
    );
    const http = await listen(h.app);
    const writes = vi.spyOn(ServerResponse.prototype, 'write');
    const backpressured = () => writes.mock.results.some((result) => result.type === 'return' && result.value === false);
    try {
      const received = await new Promise<{ status: number; body: Buffer; complete: boolean }>((resolve, reject) => {
        const req = httpRequest(`${http.baseUrl}${exportPath(sale.event.id)}`, { headers: { cookie: org.owner.cookie } }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks), complete: res.complete }));
          // Dừng đọc sau phần đầu tới khi server thấy `write` trả `false` (tối đa 5 giây), rồi đọc tiếp.
          res.once('data', () => {
            res.pause();
            const startedAt = Date.now();
            const poll = setInterval(() => {
              if (backpressured() || Date.now() - startedAt > 5_000) {
                clearInterval(poll);
                res.resume();
              }
            }, 20);
          });
        });
        req.on('error', reject);
        req.end();
        setTimeout(() => reject(new Error('không nhận đủ file')), 20_000).unref();
      });
      expect(backpressured()).toBe(true);
      expect(received.status).toBe(200);
      expect(received.complete).toBe(true);
      expect(received.body.subarray(0, 3).equals(BOM)).toBe(true);
      const [header, ...rows] = parseCsv(received.body.subarray(3).toString('utf8'));
      expect(header).toEqual([...HEADER, 'Ghi chú']);
      expect(rows.map((r) => r[COL['Mã Đơn']])).toEqual([...codes].reverse());
      expect(rows.every((r) => r.at(-1) === 'x'.repeat(8000))).toBe(true);
    } finally {
      writes.mockRestore();
      await http.close();
    }
  });

  it('lỗi DB giữa chừng (lô thứ hai): đã gửi lô đầu, rồi cắt kết nối (file cụt, không có dòng lỗi); log lỗi không chứa giá trị tìm hay dữ liệu cá nhân', async () => {
    const sale = await saleEvent();
    // 600 Đơn cùng email: tìm theo email ra hai lô, câu đọc lô mang email trong tham số.
    await seed(
      sale,
      Array.from({ length: 600 }, (_, i) => ({ createdAt: at(i), email: 'loi.giua.chung@vidu.vn', name: 'Tên Riêng Tư' })),
    );
    const http = await listen(h.app);
    const before = h.logs.lines.length;
    const original = pg.Client.prototype.query;
    let batchReads = 0;
    const spy = vi.spyOn(pg.Client.prototype, 'query').mockImplementation(function (this: pg.Client, ...args: unknown[]) {
      const config = args[0] as { text?: string } | string;
      const text = typeof config === 'string' ? config : (config.text ?? '');
      if (/from "orders"/i.test(text) && /limit \$\d+/i.test(text) && text.includes('"buyer_name"')) {
        batchReads += 1;
        if (batchReads === 2) {
          const failure = new pg.DatabaseError('canceling statement due to user request', 0, 'error');
          failure.code = '57014';
          const callback = args.find((arg) => typeof arg === 'function') as ((err: Error) => void) | undefined;
          if (callback) {
            setImmediate(() => callback(failure));
            return undefined as never;
          }
          return Promise.reject(failure) as never;
        }
      }
      return (original as (...a: unknown[]) => unknown).apply(this, args) as never;
    });
    try {
      const received = await new Promise<{ status: number; body: Buffer; complete: boolean }>((resolve, reject) => {
        const req = httpRequest(
          `${http.baseUrl}${exportPath(sale.event.id, { q: 'loi.giua.chung@vidu.vn' })}`,
          { headers: { cookie: org.owner.cookie } },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('error', () => undefined);
            res.on('close', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks), complete: res.complete }));
          },
        );
        req.on('error', () => undefined);
        req.end();
        setTimeout(() => reject(new Error('kết nối không đóng')), 10_000).unref();
      });
      expect(received.status).toBe(200);
      expect(received.complete).toBe(false);
      expect(batchReads).toBe(2);
      const text = received.body.subarray(3).toString('utf8');
      const lines = text.split('\r\n');
      // Hàng tiêu đề + 500 dòng của lô đầu, không có dòng lỗi.
      expect(lines.slice(0, -1)).toHaveLength(1 + 500);
      expect(lines.at(-1)).toBe('');
      expect(text).not.toMatch(/lỗi|error/i);
    } finally {
      spy.mockRestore();
      await http.close();
    }
    const logged = h.logs.lines.slice(before);
    const failure = logged.find((line) => line.msg === 'Xuất CSV danh sách Đơn dừng giữa chừng');
    expect(failure).toMatchObject({ level: 50, organizationId: org.orgId, eventId: sale.event.id, err: { code: '57014' } });
    const text = JSON.stringify(logged);
    for (const value of ['loi.giua.chung', 'Tên Riêng Tư', '+84900000000']) expect(text, value).not.toContain(value);
  });
});

describe('audit và riêng tư', () => {
  it('mỗi lần xuất đúng một event_orders.exported (actor, BTC, Sự kiện); changedFields ghi chip và loại q, không bao giờ giá trị', async () => {
    const sale = await saleEvent();
    const auditOf = async () =>
      (
        await h.db.pool.query<{ actor_user_id: string; organization_id: string; changed_fields: string[] }>(
          `SELECT actor_user_id, organization_id, changed_fields FROM audit_events
            WHERE action = 'event_orders.exported' AND target_type = 'event' AND target_id = $1 ORDER BY created_at, id`,
          [sale.event.id],
        )
      ).rows;

    await exportOf(sale.event.id, { q: '0912 345 678' });
    let rows = await auditOf();
    expect(rows).toEqual([{ actor_user_id: org.owner.userId, organization_id: org.orgId, changed_fields: ['q:phone'] }]);

    await exportOf(sale.event.id, { status: 'needs_action', q: 'Bi.Mat@VIDU.vn' });
    await exportOf(sale.event.id, { q: 'tk1234abcd' });
    await exportOf(sale.event.id);
    rows = await auditOf();
    expect(rows.map((r) => r.changed_fields)).toEqual([['q:phone'], ['status:needs_action', 'q:email'], ['q:code'], []]);
    const stored = JSON.stringify(rows);
    for (const value of ['0912', '912345678', 'bi.mat', 'Bi.Mat', 'TK1234', 'tk1234']) expect(stored, value).not.toContain(value);
  });

  it('không lộ id nội bộ, Mã QR vé hay token; không log giá trị tìm, email, SĐT hay tên', async () => {
    const sale = await saleEvent({ questions: [{ label: 'Size áo', kind: 'text', required: false }] });
    const placed = await place(sale, {
      vip: 2,
      name: 'Riêng Tư Một',
      phone: '0977 111 222',
      answers: { [sale.questions[0]!.id]: 'XL' },
    });
    await ipn(placed.code, placed.total);
    const before = h.logs.lines.length;
    const exported = await exportOf(sale.event.id, { q: '0977 111 222' });
    expect(codesOf(exported)).toEqual([placed.code]);

    const { rows: tickets } = await h.db.pool.query<{ id: string; share_token_hash: string | null }>(
      'SELECT id, share_token_hash FROM tickets WHERE order_id = $1',
      [placed.orderId],
    );
    expect(tickets).toHaveLength(2);
    for (const leak of [
      placed.orderId,
      placed.buyer.userId,
      sale.event.id,
      sale.tiers[0]!.id,
      sale.questions[0]!.id,
      org.orgId,
      ...tickets.flatMap((t) => [t.id, t.share_token_hash ?? t.id]),
    ]) {
      expect(exported.text, leak).not.toContain(leak);
    }
    // Mã QR vé: `t<k>.<ticketId>.<sig>`.
    expect(exported.text).not.toMatch(/t\d+\.[0-9a-f-]{36}\./);

    const logged = JSON.stringify(h.logs.lines.slice(before));
    for (const value of ['0977', '977111222', 'Riêng Tư', placed.buyer.email, 'XL']) expect(logged, value).not.toContain(value);
  });

  it('web origin đọc được Content-Disposition qua CORS', async () => {
    const sale = await saleEvent();
    const res = await h.http
      .get(exportPath(sale.event.id))
      .set('cookie', org.owner.cookie)
      .set('origin', TEST_WEB_ORIGIN)
      .responseType('blob')
      .expect(200);
    expect(res.headers['access-control-allow-origin']).toBe(TEST_WEB_ORIGIN);
    expect(res.headers['access-control-expose-headers']).toBe('Content-Disposition');
  });
});

describe('quyền, phạm vi và lỗi', () => {
  it('query sai (status lạ, q không nhận ra, q lặp) → 400 VALIDATION_FAILED dạng JSON, không lặp lại giá trị, không audit', async () => {
    const sale = await saleEvent();
    for (const query of ['status=abc', 'status=expired', 'q=0912', 'q=', 'q=0912345678&q=0987654321']) {
      const res = await h.http.get(`${exportPath(sale.event.id)}?${query}`).set('cookie', org.owner.cookie);
      expect(res.status, query).toBe(400);
      expect(res.headers['content-type'], query).toMatch(/^application\/json/);
      expect(res.headers['content-disposition'], query).toBeUndefined();
      expect(ErrorResponse.parse(res.body).error.code, query).toBe('VALIDATION_FAILED');
      expect(res.text, query).not.toContain('0912');
    }
    const { rows } = await h.db.pool.query(`SELECT 1 FROM audit_events WHERE action = 'event_orders.exported' AND target_id = $1`, [
      sale.event.id,
    ]);
    expect(rows).toEqual([]);
  });

  it('Sự kiện id ngẫu nhiên, sai dạng, hoặc của BTC khác → 404 EVENT_NOT_FOUND dạng JSON, không audit', async () => {
    const otherOrg = await paidReadyOrg(h, { name: 'BTC khác', credential: MAIN, payout: PAYOUT });
    const foreign = await eventOnSale(otherOrg, [{ name: 'Vé mời', price: 0, capacity: 5 }]);
    for (const id of [randomUUID(), 'khong-phai-uuid', foreign.event.id]) {
      const res = await h.http.get(exportPath(id)).set('cookie', org.owner.cookie);
      expect(res.status, id).toBe(404);
      expect(res.headers['content-type'], id).toMatch(/^application\/json/);
      expect(ErrorResponse.parse(res.body).error.code, id).toBe('EVENT_NOT_FOUND');
      const { rows } = await h.db.pool.query(
        `SELECT 1 FROM audit_events WHERE action = 'event_orders.exported' AND lower(target_id) = lower($1)`,
        [id],
      );
      expect(rows, id).toEqual([]);
    }
    // Owner BTC khác gọi trên BTC này → 403 NOT_A_MEMBER.
    const sale = await saleEvent();
    const cross = await h.http.get(exportPath(sale.event.id)).set('cookie', otherOrg.owner.cookie).expect(403);
    expect(ErrorResponse.parse(cross.body).error.code).toBe('NOT_A_MEMBER');
  });

  it('Admin xuất được; chưa đăng nhập → 401; CTV được giao Sự kiện → 403 NOT_A_MEMBER (không lộ mã Đơn)', async () => {
    const sale = await saleEvent();
    const placed = await place(sale);
    const admin = await signUp(h);
    await h.db.orm.execute(sql`INSERT INTO members (organization_id, user_id, role) VALUES (${org.orgId}, ${admin.userId}, 'admin')`);
    expect(codesOf(await exportOf(sale.event.id, {}, admin.cookie))).toEqual([placed.code]);

    await h.http.get(exportPath(sale.event.id)).expect(401);
    const checker = await signUp(h);
    await h.db.orm.execute(
      sql`INSERT INTO checkers (organization_id, event_id, user_id, status) VALUES (${org.orgId}, ${sale.event.id}, ${checker.userId}, 'active')`,
    );
    const res = await h.http.get(exportPath(sale.event.id)).set('cookie', checker.cookie).expect(403);
    expect(ErrorResponse.parse(res.body).error.code).toBe('NOT_A_MEMBER');
    expect(res.text).not.toContain(placed.code);
  });

  it('Sự kiện bị khóa vẫn xuất được (Story 7.4)', async () => {
    const sale = await saleEvent();
    const placed = await place(sale);
    await h.db.pool.query(`UPDATE events SET locked_at = now(), lock_reason = 'kiểm tra' WHERE id = $1`, [sale.event.id]);
    expect(codesOf(await exportOf(sale.event.id))).toEqual([placed.code]);
  });
});
