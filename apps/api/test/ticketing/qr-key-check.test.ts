import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JobQueue } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { Logger as PinoNestLogger } from 'nestjs-pino';
import pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TICKET_QR_KEY_MISSING_ALERT, TicketQrKeys } from '../../src/modules/ticketing/index.js';
import { missingQrKeyVersions, type MissingQrKeyVersion } from '../../src/modules/ticketing/qr-key-check.js';
import { tickets } from '../../src/modules/ticketing/schema.js';
import type { Tx } from '../../src/platform/db/index.js';
import { EMAIL_TRANSPORT } from '../../src/platform/email/index.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import { WorkerModule } from '../../src/worker.module.js';
import {
  databaseUrl,
  migrationDatabaseUrl,
  TEST_TICKET_QR_KEY_V2,
  TEST_TICKET_QR_KEYS,
  testCredentialKey,
  workerConfig,
} from '../helpers.js';
import { createHarness, FakeEmailTransport, signUp, type Harness } from '../identity/harness.js';
import {
  eventOnSale,
  orderBody,
  paidReadyOrg,
  parseOrder,
  postOrder,
  rejectingTingee,
  resetOrderRateLimit,
  type Org,
} from '../ordering/order-fixtures.js';
import { waitFor } from '../process.js';

/*
 * Story 4.7-g: kiểm khóa Mã QR vé lúc khởi động. `missingQrKeyVersions` phủ I/O Matrix trên Postgres thật: mỗi test xóa
 * mọi Vé, dựng đúng các Vé của kịch bản rồi rollback, nên DB test dùng chung không đổi. Provider `TicketQrKeyCheck` chạy
 * thật khi app api (harness) và worker khởi động, với một Vé đã phát rồi đổi sang phiên bản 6 (instance chỉ có v1: "chưa
 * có khóa mới"). Hướng ngược lại (khóa cũ đã gỡ) và vai migrate ở `roles.process.test.ts` (tiến trình thật).
 */

const V1 = TEST_TICKET_QR_KEYS;
const V2 = TEST_TICKET_QR_KEY_V2;
const V3 = testCredentialKey(3, 13);
const keysOf = (...keys: string[]) => TicketQrKeys.parse(keys.join(','));

/** Phiên bản khóa không instance nào của test có: Vé đổi sang phiên bản này là Vé của "khóa mới" instance chưa có. */
const UNKNOWN_VERSION = 6;
const PAIR = `${UNKNOWN_VERSION}:1`;
const CHECK_CONTEXT = 'TicketQrKeyCheck';

interface Sale {
  eventId: string;
  ticketTypeId: string;
}

let h: Harness;
let org: Org;
let openSale: Sale;
let endedSale: Sale;
let cancelledSale: Sale;
const harnesses: Harness[] = [];

/** nestjs-pino giữ một logger gốc cho cả process (app đầu tiên của file), nên gom log của mọi app và worker. */
const allLogs = () => harnesses.flatMap((x) => x.logs.lines);
/** Dòng log `error` của lần kiểm lúc khởi động cho phiên bản `version`. */
const checkErrors = (version: number) =>
  allLogs().filter(
    (l) => l.context === CHECK_CONTEXT && l.alert === TICKET_QR_KEY_MISSING_ALERT && l.qrKeyVersion === version,
  );

async function newHarness(...args: Parameters<typeof createHarness>): Promise<Harness> {
  const created = await createHarness(...args);
  harnesses.push(created);
  return created;
}

async function sale(name: string): Promise<Sale> {
  const created = await eventOnSale(org, [{ name, price: 0, capacity: 10 }]);
  return { eventId: created.event.id, ticketTypeId: created.tiers[0]!.id };
}

beforeAll(async () => {
  // Vé phiên bản 6 của lần chạy trước bị dừng giữa chừng (afterAll không chạy): trả về v1 như lúc phát, trước khi app đầu
  // tiên của file khởi động (và kiểm).
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    await client.query('UPDATE tickets SET qr_key_version = 1 WHERE qr_key_version = $1', [UNKNOWN_VERSION]);
  } finally {
    await client.end();
  }
  h = await newHarness({}, { overrides: [rejectingTingee] });
  org = await paidReadyOrg(h, { name: 'CLB Cờ vua Quận 3' });
  openSale = await sale('Vé Sự kiện còn mở');
  endedSale = await sale('Vé Sự kiện đã kết thúc');
  cancelledSale = await sale('Vé Sự kiện đã hủy');
});
afterAll(async () => {
  for (const x of harnesses.reverse()) await x.close();
});

/** Mã Đơn hợp lệ (`TK` + 8 ký tự Crockford base32) cho Vé dựng tay. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const orderCode = () => `TK${Array.from(randomBytes(8), (b) => CROCKFORD[b % 32]).join('')}`;

interface TicketSpec {
  sale: Sale;
  qrKeyVersion: number;
  status?: 'valid' | 'cancelled';
  /** Số Vé giống nhau (mỗi Vé một Đơn). Mặc định 1. */
  count?: number;
}

const ticketRow = ({ sale: s, qrKeyVersion, status = 'valid' }: TicketSpec): typeof tickets.$inferInsert => ({
  orderId: randomUUID(),
  eventId: s.eventId,
  organizationId: org.orgId,
  userId: randomUUID(),
  ticketTypeId: s.ticketTypeId,
  seq: 1,
  orderTicketCount: 1,
  holderName: 'Nguyễn Văn An',
  ticketTypeName: 'Vé tham dự',
  orderCode: orderCode(),
  issuedAt: new Date(),
  qrKeyVersion,
  status,
});

class Rollback extends Error {}

/**
 * `missingQrKeyVersions(tx, keys)` khi bảng `tickets` chỉ có các Vé `specs` (và Vé `setup` chèn thêm), Sự kiện
 * `endedSale` đã quá `effective_end_at` (đồng hồ DB) và `cancelledSale` đã hủy. Mọi thay đổi trong một transaction rồi
 * rollback.
 */
async function missingWith(
  keys: TicketQrKeys,
  specs: TicketSpec[],
  setup?: (tx: Tx) => Promise<void>,
): Promise<MissingQrKeyVersion[]> {
  let result: MissingQrKeyVersion[] = [];
  const run = h.db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM tickets`);
    await tx.execute(sql`UPDATE events SET effective_end_at = now() - interval '1 second' WHERE id = ${endedSale.eventId}`);
    await tx.execute(sql`UPDATE events SET status = 'cancelled' WHERE id = ${cancelledSale.eventId}`);
    const rows = specs.flatMap((spec) => Array.from({ length: spec.count ?? 1 }, () => ticketRow(spec)));
    if (rows.length > 0) await tx.insert(tickets).values(rows);
    await setup?.(tx);
    result = await missingQrKeyVersions(tx, keys);
    throw new Rollback();
  });
  await expect(run).rejects.toBeInstanceOf(Rollback);
  return result;
}

describe('missingQrKeyVersions (I/O Matrix)', () => {
  it('đủ khóa: Vé valid dùng v1 và v2, keys có v1, v2 → không báo', async () => {
    const specs = [
      { sale: openSale, qrKeyVersion: 1 },
      { sale: openSale, qrKeyVersion: 2 },
    ];
    expect(await missingWith(keysOf(V1, V2), specs)).toEqual([]);
  });

  it('khóa cũ đã gỡ: Vé valid của Sự kiện còn mở dùng v1, keys chỉ có v2 → báo v1 kèm số Vé', async () => {
    const specs = [
      { sale: openSale, qrKeyVersion: 1, count: 2 },
      { sale: openSale, qrKeyVersion: 2 },
    ];
    expect(await missingWith(keysOf(V2), specs)).toEqual([{ qrKeyVersion: 1, tickets: 2 }]);
  });

  it('instance chưa có khóa mới: Vé dùng v3, keys có v1, v2 → báo v3', async () => {
    const specs = [
      { sale: openSale, qrKeyVersion: 1 },
      { sale: openSale, qrKeyVersion: 3, count: 3 },
    ];
    expect(await missingWith(keysOf(V1, V2), specs)).toEqual([{ qrKeyVersion: 3, tickets: 3 }]);
  });

  it('hai chiều cùng lúc: Vé dùng v1 và v3, keys chỉ có v2 → báo cả hai, tăng dần theo phiên bản', async () => {
    const specs = [
      { sale: openSale, qrKeyVersion: 3 },
      { sale: openSale, qrKeyVersion: 1, count: 2 },
      { sale: openSale, qrKeyVersion: 2 },
    ];
    expect(await missingWith(keysOf(V2), specs)).toEqual([
      { qrKeyVersion: 1, tickets: 2 },
      { qrKeyVersion: 3, tickets: 1 },
    ]);
  });

  it('Vé đã hủy dùng v1, keys chỉ có v2 → không báo', async () => {
    expect(await missingWith(keysOf(V2), [{ sale: openSale, qrKeyVersion: 1, status: 'cancelled', count: 2 }])).toEqual(
      [],
    );
  });

  it('Sự kiện đã kết thúc hoặc đã hủy: Vé valid dùng v1, keys chỉ có v2 → không báo', async () => {
    const specs = [
      { sale: endedSale, qrKeyVersion: 1 },
      { sale: cancelledSale, qrKeyVersion: 1 },
    ];
    expect(await missingWith(keysOf(V2), specs)).toEqual([]);
  });

  it('trộn: v1 có Vé của Sự kiện đã kết thúc, đã hủy và còn mở → báo v1, số Vé chỉ đếm Vé của Sự kiện còn mở', async () => {
    const specs = [
      { sale: endedSale, qrKeyVersion: 1, count: 4 },
      { sale: cancelledSale, qrKeyVersion: 1, count: 2 },
      { sale: openSale, qrKeyVersion: 1, count: 3 },
      { sale: openSale, qrKeyVersion: 1, status: 'cancelled' as const },
    ];
    expect(await missingWith(keysOf(V2), specs)).toEqual([{ qrKeyVersion: 1, tickets: 3 }]);
  });

  it('chưa có Vé (bảng tickets trống) → không báo', async () => {
    expect(await missingWith(keysOf(V2), [])).toEqual([]);
  });

  it('Vé v1 ở 1.001 Sự kiện còn mở (quá một lô đọc Sự kiện), keys chỉ có v2 → đếm đủ 1.001 Vé', async () => {
    const result = await missingWith(keysOf(V2), [], async (tx) => {
      await tx.execute(sql`
        WITH clones AS (
          INSERT INTO events (organization_id, slug, name, status, starts_at, ends_at, effective_end_at, refund_policy)
          SELECT organization_id, slug || '-lo-' || g, name, status, starts_at, ends_at, effective_end_at, refund_policy
            FROM events, generate_series(1, 1001) AS g
           WHERE id = ${openSale.eventId}
          RETURNING id
        )
        INSERT INTO tickets (order_id, event_id, organization_id, user_id, ticket_type_id, seq, order_ticket_count,
                             holder_name, ticket_type_name, order_code, issued_at, qr_key_version)
        SELECT gen_random_uuid(), id, ${org.orgId}, gen_random_uuid(), ${openSale.ticketTypeId}, 1, 1,
               'Nguyễn Văn An', 'Vé tham dự', 'TK0000ZZZZ', now(), 1
          FROM clones`);
    });
    expect(result).toEqual([{ qrKeyVersion: 1, tickets: 1001 }]);
  });
});

describe('TicketQrKeyCheck lúc khởi động', () => {
  let ticketId: string;
  let shareToken: string;
  let boss: PgBoss;

  /** Job email cảnh báo vận hành của cặp `PAIR` (mọi lần chạy, mọi trạng thái). */
  const pairJobs = () =>
    boss.findJobs(JobQueue.OPS_ALERT, { data: { kind: TICKET_QR_KEY_MISSING_ALERT, subjects: [PAIR] } });
  /** Dấu chống lặp của cặp `PAIR` vừa ghi (còn trong cooldown). */
  const markPair = () =>
    h.db.pool.query(
      `INSERT INTO ops_alert_marks (kind, subject) VALUES ($1, $2)
       ON CONFLICT (kind, subject) DO UPDATE SET raised_at = now()`,
      [TICKET_QR_KEY_MISSING_ALERT, PAIR],
    );
  /** Xóa dấu chống lặp của cặp `PAIR`: lần raise kế tiếp là mới (enqueue email). */
  const unmarkPair = () =>
    h.db.pool.query('DELETE FROM ops_alert_marks WHERE kind = $1 AND subject = $2', [TICKET_QR_KEY_MISSING_ALERT, PAIR]);

  /** Worker thật (khóa test mặc định: chỉ v1), log về logger gốc của file. */
  async function startWorker(email = new FakeEmailTransport()): Promise<INestApplicationContext> {
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule.forRoot(workerConfig())] })
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue(email)
      .compile();
    moduleRef.useLogger(moduleRef.get(PinoNestLogger));
    return moduleRef.init();
  }

  beforeAll(async () => {
    boss = h.app.get<PgBoss>(BOSS);
    await resetOrderRateLimit(h);
    const buyer = await signUp(h);
    const free = await eventOnSale(org, [{ name: 'Vé tham dự', price: 0, capacity: 5 }]);
    const res = await postOrder(h, buyer, free.event.slug, orderBody([{ ticketTypeId: free.tiers[0]!.id, quantity: 1 }]));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const ticket = parseOrder(res.body).tickets[0]!;
    ticketId = ticket.id;
    shareToken = ticket.shareToken;

    // Email Vé (ký bằng v1) phải xong trước khi đổi phiên bản, để không job nào của file này lỗi ở worker chỉ có v1.
    const email = new FakeEmailTransport();
    const drain = await startWorker(email);
    try {
      await waitFor(() => email.sent.some((m) => m.to === buyer.email), 'email Vé của Đơn', 15_000);
    } finally {
      await drain.close();
    }
    await h.db.pool.query('UPDATE tickets SET qr_key_version = $1 WHERE id = $2', [UNKNOWN_VERSION, ticketId]);
    await unmarkPair();
  });
  afterAll(async () => {
    // Trả Vé về v1 (đúng hash link chia sẻ đã lưu) để app và worker của file sau không báo thiếu khóa.
    if (ticketId) await h.db.pool.query('UPDATE tickets SET qr_key_version = 1 WHERE id = $1', [ticketId]);
  });

  it('vai api, Vé còn dùng v6, keys chỉ có v1 → vẫn khởi động; log error kèm marker, v6/v1 và số Vé, không id Vé hay khóa; một email cảnh báo', async () => {
    const jobsBefore = (await pairJobs()).length;
    const api = await newHarness({}, { overrides: [rejectingTingee] });
    await expect.poll(() => checkErrors(UNKNOWN_VERSION).length, { timeout: 10_000 }).toBe(1);
    const line = checkErrors(UNKNOWN_VERSION)[0]!;
    expect(line).toMatchObject({
      level: 50,
      context: CHECK_CONTEXT,
      alert: TICKET_QR_KEY_MISSING_ALERT,
      qrKeyVersion: UNKNOWN_VERSION,
      currentVersion: 1,
      tickets: 1,
    });
    expect(line).not.toHaveProperty('ticketId');
    expect(line).not.toHaveProperty('eventId');
    const text = JSON.stringify(allLogs());
    expect(text).not.toContain(ticketId);
    expect(text).not.toContain(shareToken);
    expect(text).not.toContain(V1.slice(3));

    // Kênh cảnh báo vận hành: một job email cho cặp 6:1, chi tiết có số Vé, không id Vé.
    await expect.poll(async () => (await pairJobs()).length, { timeout: 10_000 }).toBe(jobsBefore + 1);
    const jobs = await pairJobs();
    expect(jobs.at(-1)!.data).toEqual({
      kind: TICKET_QR_KEY_MISSING_ALERT,
      count: 1,
      subjects: [PAIR],
      details: { qrKeyVersion: UNKNOWN_VERSION, currentVersion: 1, tickets: 1 },
    });

    // Chỉ cảnh báo: instance vẫn phục vụ.
    await api.http.get('/healthz').expect(200);
    await api.http.get('/readyz').expect(200);
  });

  it('vai worker cũng kiểm lúc khởi động; dấu chống lặp 6:1 còn trong cooldown nên không thêm email', async () => {
    await markPair();
    const before = checkErrors(UNKNOWN_VERSION).length;
    const jobsBefore = (await pairJobs()).length;
    const worker = await startWorker();
    try {
      await expect.poll(() => checkErrors(UNKNOWN_VERSION).length, { timeout: 10_000 }).toBe(before + 1);
      expect(checkErrors(UNKNOWN_VERSION).at(-1)).toMatchObject({ level: 50, currentVersion: 1, tickets: 1 });
    } finally {
      // Tắt chờ lần kiểm (kể cả raise) xong.
      await worker.close();
    }
    expect(await pairJobs()).toHaveLength(jobsBefore);
  });

  it('DB lỗi khi kiểm (không có quyền đọc tickets): log warn, không log error, instance vẫn khởi động', async () => {
    const before = checkErrors(UNKNOWN_VERSION).length;
    const warns = () => allLogs().filter((l) => l.context === CHECK_CONTEXT && l.level === 40);
    const warnsBefore = warns().length;
    const migrator = new pg.Client({ connectionString: migrationDatabaseUrl() });
    await migrator.connect();
    try {
      await migrator.query('REVOKE SELECT ON TABLE tickets FROM tickee_app');
      const api = await newHarness({}, { overrides: [rejectingTingee] });
      await expect.poll(() => warns().length, { timeout: 10_000 }).toBe(warnsBefore + 1);
      expect(warns().at(-1)).toMatchObject({
        msg: 'Không kiểm được khóa Mã QR vé của Vé còn dùng lúc khởi động; bỏ qua lần kiểm này',
        error: { code: '42501' },
      });
      await api.http.get('/healthz').expect(200);
    } finally {
      await migrator.query('GRANT SELECT ON TABLE tickets TO tickee_app');
      await migrator.end();
    }
    expect(checkErrors(UNKNOWN_VERSION)).toHaveLength(before);
  });

  it('tắt ngay sau khi khởi động: chờ lần kiểm và raise xong (một email 6:1), không log warn', async () => {
    await unmarkPair();
    const jobsBefore = (await pairJobs()).length;
    const before = checkErrors(UNKNOWN_VERSION).length;
    const warns = () =>
      allLogs().filter((l) => (l.context === CHECK_CONTEXT || l.context === 'OpsAlerts') && l.level === 40).length;
    const warnsBefore = warns();
    // Không qua `newHarness`: đóng ngay ở đây, không đóng lại ở afterAll.
    const api = await createHarness({}, { overrides: [rejectingTingee] });
    await api.close();
    expect(checkErrors(UNKNOWN_VERSION)).toHaveLength(before + 1);
    expect(await pairJobs()).toHaveLength(jobsBefore + 1);
    expect(warns()).toBe(warnsBefore);
  });
});
