import 'reflect-metadata';
import { randomInt, randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventDetail, JobQueue } from '@tickee/contracts';
import pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  checkIssuanceDrop,
  ISSUANCE_BASELINE_DAYS,
  ISSUANCE_DROP_SETTINGS,
  ISSUANCE_WINDOW_FROM_MINUTES,
  ISSUANCE_WINDOW_TO_MINUTES,
  issuanceCounts,
  type IssuanceCounts,
  type IssuanceDropSettings,
} from '../../src/modules/ordering/issuance-drop-rule.js';
import {
  OPS_ALERT_SYSTEM_SUBJECT,
  OpsAlertEmailWorker,
  OpsAlertKind,
  OpsAlertPayload,
  OpsAlertQueue,
  OpsAlertRules,
  OpsAlerts,
  OpsAlertScanWorker,
  type OpsAlertScanContext,
} from '../../src/platform/alerts/index.js';
import { DATABASE, type Database } from '../../src/platform/db/index.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import { WorkerModule } from '../../src/worker.module.js';
import { migrationDatabaseUrl, workerConfig } from '../helpers.js';
import { createHarness, FakeEmailTransport, type Harness } from '../identity/harness.js';
import { EVENT_DRAFT, eventsPath, paidReadyOrg, type Org } from './order-fixtures.js';

/*
 * Story 4.6-e, luật `ticket_issuance_drop` trên Postgres thật và pg-boss thật (harness api: producer). Luật xét mọi Đơn
 * trong DB dùng chung (không truncate), nên mỗi test đặt mốc riêng ở xa trong tương lai (≥ 400 ngày, lệch ngẫu nhiên, các
 * test cách nhau 30 ngày) và chèn Đơn quanh mốc đó bằng SQL, ở trạng thái `paid`/`expired` (không phải `pending`: lưới an
 * toàn của 4.6-c không đụng). Mỗi dòng của I/O Matrix; cuối file chạy worker thật (registry của job quét). Đơn chèn được
 * xóa ở `afterAll`.
 */

const DAY = 24 * 60 * 60_000;
const MIN = 60_000;
const SETTINGS: IssuanceDropSettings = { minOrders: 10, ratio: 0.5 };
/** Bảng chữ của mã Đơn (`ORDER_CODE_PATTERN`). */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

let h: Harness;
let db: Database;
let boss: PgBoss;
let net: OpsAlertScanContext;
let org: Org;
let eventId: string;
/** Mốc đầu của file: ≥ 400 ngày tới, lệch ngẫu nhiên tới khoảng 2 năm (lần chạy khác không trùng khung). */
let base: number;
let anchors = 0;
/** Id mọi Đơn file này chèn (xóa ở `afterAll`). */
const inserted: string[] = [];
let seen = new Set<string>();

beforeAll(async () => {
  h = await createHarness();
  db = h.app.get<Database>(DATABASE);
  boss = h.app.get<PgBoss>(BOSS);
  org = await paidReadyOrg(h, { name: 'CLB Bóng đá Thủ Đức' });
  eventId = EventDetail.parse(
    (await h.http.post(eventsPath(org)).set('cookie', org.owner.cookie).send(EVENT_DRAFT).expect(201)).body,
  ).id;
  base = Date.now() + 400 * DAY + randomInt(0, 1_000_000) * MIN;
});
beforeEach(async () => {
  // Kênh mới mỗi test (bộ nhớ chống lặp rỗng) và không còn dấu `ticket_issuance_drop` trong DB.
  net = { db, alerts: new OpsAlerts(db, boss, h.app.get(OpsAlertQueue), { cooldownMinutes: 30 }) };
  await db.pool.query('DELETE FROM ops_alert_marks WHERE kind = $1', [OpsAlertKind.TICKET_ISSUANCE_DROP]);
  seen = new Set((await dropJobs(true)).map((job) => job.id));
});
afterAll(async () => {
  if (inserted.length > 0) {
    const migrator = new pg.Client({ connectionString: migrationDatabaseUrl() });
    await migrator.connect();
    try {
      await migrator.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [inserted]);
    } finally {
      await migrator.end();
    }
  }
  await h?.close();
});

/** Mốc mới của một test: cách mốc trước 30 ngày (khung xét và khung nền của hai test không chồng nhau). */
const nextAnchor = (): Date => new Date(base + anchors++ * 30 * DAY);

const orderCode = () => `TK${Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')}`;

/**
 * Chèn `count` Đơn có lượt tạo link lúc `at − minutesBefore` (phút, có thể lẻ), `paid` Đơn đầu đã được trả tiền
 * (`paid_source` = `ipn`), còn lại `expired`. `attemptAt: null`: Đơn chưa từng có lượt tạo link (vd. Đơn 0đ).
 */
async function insertOrders(
  at: Date | 'now',
  minutesBefore: number,
  count: number,
  paid: number,
  options: { attemptAt?: null } = {},
): Promise<void> {
  for (let i = 0; i < count; i++) {
    const isPaid = i < paid;
    const { rows } = await db.pool.query<{ id: string }>(
      `INSERT INTO orders (code, user_id, event_id, organization_id, status, total_amount, buyer_name, buyer_phone,
                           buyer_email, idempotency_key, payment_link_attempt_at, expires_at,
                           paid_at, paid_amount, paid_source)
       SELECT $1, $2, $3, $4, $5, 100000, 'Nguyễn Văn An', '0912345678', 'nguoi-mua@vidu.vn', $6,
              CASE WHEN $7 THEN NULL ELSE t.attempt END, t.attempt + interval '15 minutes',
              CASE WHEN $8 THEN t.attempt + interval '1 minute' END, CASE WHEN $8 THEN 100000 END,
              CASE WHEN $8 THEN 'ipn' END
         FROM (SELECT COALESCE($9::timestamptz, now()) - make_interval(secs => $10) AS attempt) t
       RETURNING id`,
      [
        orderCode(),
        randomUUID(),
        eventId,
        org.orgId,
        isPaid ? 'paid' : 'expired',
        randomUUID(),
        options.attemptAt === null,
        isPaid,
        at === 'now' ? null : at.toISOString(),
        minutesBefore * 60,
      ],
    );
    inserted.push(rows[0]!.id);
  }
}

/** Chèn Đơn của khung xét (mốc − 30 phút) và khung nền (cùng lúc, 7 ngày trước). */
async function seed(at: Date, current: { orders: number; paid: number }, baseline: { orders: number; paid: number }) {
  await insertOrders(at, 30, current.orders, current.paid);
  await insertOrders(at, ISSUANCE_BASELINE_DAYS * 24 * 60 + 30, baseline.orders, baseline.paid);
}

/** Job email `ticket_issuance_drop` mới của test (bỏ job có trước test; `all`: mọi job). */
async function dropJobs(all = false) {
  const jobs = await boss.findJobs(JobQueue.OPS_ALERT, { data: { kind: OpsAlertKind.TICKET_ISSUANCE_DROP } });
  return jobs.filter((job) => all || !seen.has(job.id)).map((job) => ({ id: job.id, data: OpsAlertPayload.parse(job.data) }));
}

/** Số đếm mong đợi (kiểu `IssuanceCounts`). */
const counts = (orders: number, paidOrders: number, baselineOrders: number, baselinePaidOrders: number): IssuanceCounts => ({
  orders,
  paidOrders,
  baselineOrders,
  baselinePaidOrders,
});

describe('luật ticket_issuance_drop (I/O Matrix)', () => {
  it('Phát Vé giảm: 20 Đơn, 4 có paid_source; 7 ngày trước 20 Đơn, 18 có → một email kèm số Đơn của hai khung', async () => {
    const at = nextAnchor();
    await seed(at, { orders: 20, paid: 4 }, { orders: 20, paid: 18 });
    expect(await checkIssuanceDrop(net, SETTINGS, at)).toEqual(counts(20, 4, 20, 18));
    const jobs = await dropJobs();
    expect(jobs.map((job) => job.data)).toEqual([
      {
        kind: OpsAlertKind.TICKET_ISSUANCE_DROP,
        count: 1,
        subjects: [OPS_ALERT_SYSTEM_SUBJECT],
        details: { orders: 20, paidOrders: 4, baselineOrders: 20, baselinePaidOrders: 18, thresholdRatio: 0.5 },
      },
    ]);
    const email = new FakeEmailTransport();
    await new OpsAlertEmailWorker(boss, email, { recipients: ['van-hanh@tickee.test'] }).deliver(jobs[0]!.data);
    expect(email.sent[0]!.subject).toBe('[Tickee vận hành] Tỉ lệ phát Vé giảm bất thường');
    for (const part of ['Loại: ticket_issuance_drop', 'orders: 20', 'paidOrders: 4', 'baselinePaidOrders: 18']) {
      expect(email.sent[0]!.text, part).toContain(part);
    }

    // Lượt quét kế (mỗi phút), vẫn giảm: cooldown, không gửi thêm.
    await checkIssuanceDrop(net, SETTINGS, new Date(at.getTime() + MIN));
    expect(await dropJobs()).toHaveLength(1);

    // Dấu quá cooldown (31 phút), kênh mới (bộ nhớ chống lặp rỗng), vẫn giảm → báo lại (loại `cooldown`, không `once`).
    await db.pool.query(
      "UPDATE ops_alert_marks SET raised_at = raised_at - interval '31 minutes' WHERE kind = $1 AND subject = $2",
      [OpsAlertKind.TICKET_ISSUANCE_DROP, OPS_ALERT_SYSTEM_SUBJECT],
    );
    const fresh = { db, alerts: new OpsAlerts(db, boss, h.app.get(OpsAlertQueue), { cooldownMinutes: 30 }) };
    await checkIssuanceDrop(fresh, SETTINGS, new Date(at.getTime() + 2 * MIN));
    expect(await dropJobs()).toHaveLength(2);
  });

  it('Không có nền: 20 Đơn, 0 có; 7 ngày trước 0 Đơn → không báo', async () => {
    const at = nextAnchor();
    await seed(at, { orders: 20, paid: 0 }, { orders: 0, paid: 0 });
    expect(await checkIssuanceDrop(net, SETTINGS, at)).toEqual(counts(20, 0, 0, 0));
    expect(await dropJobs()).toEqual([]);
  });

  it('Ít Đơn: 9 Đơn, 0 có paid_source (nền 20 Đơn, 18 có) → không báo', async () => {
    const at = nextAnchor();
    await seed(at, { orders: 9, paid: 0 }, { orders: 20, paid: 18 });
    expect(await checkIssuanceDrop(net, SETTINGS, at)).toEqual(counts(9, 0, 20, 18));
    expect(await dropJobs()).toEqual([]);
  });

  it('tỉ lệ không dưới 0,5 lần nền (10/20 so với 18/20) → không báo; ngưỡng tỉ lệ theo cấu hình', async () => {
    const at = nextAnchor();
    await seed(at, { orders: 20, paid: 10 }, { orders: 20, paid: 18 });
    await checkIssuanceDrop(net, SETTINGS, at);
    expect(await dropJobs()).toEqual([]);
    // 10/20 = 0,5 < 0,6 × 0,9 = 0,54.
    await checkIssuanceDrop(net, { minOrders: 10, ratio: 0.6 }, at);
    expect((await dropJobs()).map((job) => job.data.details)).toEqual([
      { orders: 20, paidOrders: 10, baselineOrders: 20, baselinePaidOrders: 18, thresholdRatio: 0.6 },
    ]);
  });

  it('tỉ lệ đúng bằng ngưỡng không phải "dưới": 9/20 so với 18/20 ở 0,5 và 1/10 so với 3/3 ở 0,1 → không báo', async () => {
    const half = nextAnchor();
    await seed(half, { orders: 20, paid: 9 }, { orders: 20, paid: 18 });
    expect(await checkIssuanceDrop(net, SETTINGS, half)).toEqual(counts(20, 9, 20, 18));
    // 0,1 × 3 × 10 = 3.0000000000000004 với số thực: so phải chính xác.
    const tenth = nextAnchor();
    await seed(tenth, { orders: 10, paid: 1 }, { orders: 3, paid: 3 });
    expect(await checkIssuanceDrop(net, { minOrders: 10, ratio: 0.1 }, tenth)).toEqual(counts(10, 1, 3, 3));
    expect(await dropJobs()).toEqual([]);
  });

  it('đúng minOrders (10 Đơn), 0 có paid_source so với nền 10/10 → báo', async () => {
    const at = nextAnchor();
    await seed(at, { orders: 10, paid: 0 }, { orders: 10, paid: 10 });
    await checkIssuanceDrop(net, SETTINGS, at);
    expect((await dropJobs()).map((job) => job.data.details)).toEqual([
      { orders: 10, paidOrders: 0, baselineOrders: 10, baselinePaidOrders: 10, thresholdRatio: 0.5 },
    ]);
  });

  it('khung (mốc − 75 phút, mốc − 15 phút] theo payment_link_attempt_at: đúng −75 phút và sau −15 phút không tính; Đơn chưa có lượt tạo link không tính', async () => {
    expect([ISSUANCE_WINDOW_FROM_MINUTES, ISSUANCE_WINDOW_TO_MINUTES, ISSUANCE_BASELINE_DAYS]).toEqual([75, 15, 7]);
    const at = nextAnchor();
    const week = ISSUANCE_BASELINE_DAYS * 24 * 60;
    await insertOrders(at, 75, 1, 1); // đúng mốc − 75 phút: ngoài khung
    await insertOrders(at, 74.99, 1, 1); // trong khung
    await insertOrders(at, 15, 1, 0); // đúng mốc − 15 phút: trong khung
    await insertOrders(at, 14.99, 1, 1); // ngoài khung
    await insertOrders(at, 30, 2, 1, { attemptAt: null }); // Đơn 0đ / chưa có link: không tính
    await insertOrders(at, week + 75, 1, 1);
    await insertOrders(at, week + 15, 1, 0);
    await insertOrders(at, week + 14.99, 1, 1);
    expect(await issuanceCounts(db, at)).toEqual(counts(2, 1, 1, 0));
  });

  it('mốc mặc định là đồng hồ DB (now())', async () => {
    const before = await issuanceCounts(db);
    await insertOrders('now', 30, 3, 2);
    await insertOrders('now', ISSUANCE_BASELINE_DAYS * 24 * 60 + 30, 2, 2);
    const after = await issuanceCounts(db);
    expect(after.orders - before.orders).toBe(3);
    expect(after.paidOrders - before.paidOrders).toBe(2);
    expect(after.baselineOrders - before.baselineOrders).toBe(2);
    expect(after.baselinePaidOrders - before.baselinePaidOrders).toBe(2);
  });
});

describe('worker thật', () => {
  let worker: INestApplicationContext;

  beforeAll(async () => {
    const config = workerConfig({ OPS_ALERT_ISSUANCE_MIN_ORDERS: 25, OPS_ALERT_ISSUANCE_RATIO: 0.3 });
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule.forRoot(config)] }).compile();
    worker = await moduleRef.init();
  });
  afterAll(async () => {
    await worker?.close();
  });

  it('WorkerModule khởi động → OpsAlertRules có ticket_issuance_drop cùng hai luật pg-boss; lượt quét chạy luật trên DB thật', async () => {
    expect(
      worker
        .get(OpsAlertRules)
        .list()
        .map((rule) => rule.name),
    ).toEqual([OpsAlertKind.QUEUE_BACKLOG, OpsAlertKind.DEAD_LETTER, OpsAlertKind.TICKET_ISSUANCE_DROP]);
    // Ngưỡng của luật lấy từ cấu hình của worker.
    expect(worker.get(ISSUANCE_DROP_SETTINGS)).toEqual({ minOrders: 25, ratio: 0.3 });
    const outcomes = await worker.get(OpsAlertScanWorker).scan();
    expect(outcomes.get(OpsAlertKind.TICKET_ISSUANCE_DROP)).toBe('ok');
    // Vai api không quét: registry rỗng.
    expect(h.app.get(OpsAlertRules).list()).toEqual([]);
  });
});
