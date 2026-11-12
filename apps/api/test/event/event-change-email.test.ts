import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  EventBuyerCount,
  EventDetail,
  EventDraftInput,
  ErrorResponse,
  formatEventTimeRange,
  JobQueue,
  Role,
  type SendEventChangeEmailPayload,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { Logger as PinoNestLogger } from 'nestjs-pino';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { updateEvent } from '../../src/flows/index.js';
import { PublicPageQueues } from '../../src/modules/event/index.js';
import { buildEventChangeEmail } from '../../src/modules/ordering/buyer-email.js';
import {
  enqueueEventChangeEmail,
  EVENT_CHANGE_EMAIL_QUEUE_OPTIONS,
  EventChangeEmailQueues,
  eventChangeEmailJobId,
  fanOutEventChangeEmail,
  sendEventChangeEmail,
  type EventChangeEmailSender,
} from '../../src/modules/ordering/event-change-email-jobs.js';
import type { AccessContext } from '../../src/platform/access/index.js';
import { Database } from '../../src/platform/db/index.js';
import { EMAIL_TRANSPORT } from '../../src/platform/email/index.js';
import { BOSS, childJobId } from '../../src/platform/jobs/index.js';
import { WorkerModule } from '../../src/worker.module.js';
import { migrationDatabaseUrl, TEST_WEB_ORIGIN, workerConfig } from '../helpers.js';
import { createHarness, FakeEmailTransport, signUp, type Harness } from '../identity/harness.js';
import {
  eventOnSale,
  eventsPath,
  orderBody,
  paidReadyOrg,
  postOrder,
  rejectingTingee,
  resetOrderRateLimit,
  type Org,
  type User,
} from '../ordering/order-fixtures.js';

/*
 * Story 3.10, FR-7: sửa giờ hoặc địa điểm của Sự kiện đã phát Vé → email báo Người mua. `PATCH …/events/:eventId` ở
 * `flows` sửa Sự kiện (tăng `time_venue_version` khi đổi giờ/địa điểm) và, khi đủ điều kiện, enqueue một job gốc
 * `ordering.send-event-change-email` `{ eventId, version }` trong cùng `tx`. Worker tạo mỗi Người mua (user có Đơn
 * `paid`) một job con; job con gửi một email với giờ/địa điểm hiện tại. `GET …/buyer-count` đếm cùng định nghĩa.
 * Postgres thật; Vé lấy từ Đơn 0đ, Đơn chờ thanh toán từ Hạng vé có phí (Tingee từ chối tạo link).
 */

const QUEUE = JobQueue.ORDERING_SEND_EVENT_CHANGE_EMAIL;
const DEAD_LETTER = JobQueue.ORDERING_SEND_EVENT_CHANGE_EMAIL_DEAD_LETTER;
const ORG_NAME = 'CLB <Chạy> & "Bộ"';
const EVENT_NAME = 'Giải <Mùa thu> & "Bạn"';
const SUBJECT = `Sự kiện đổi giờ hoặc địa điểm · ${EVENT_NAME}`;
const NEW_START = '2099-11-16T08:00:00+07:00';

let h: Harness;
let org: Org;
let admin: User;
let boss: PgBoss;

beforeAll(async () => {
  h = await createHarness({}, { overrides: [rejectingTingee] });
  org = await paidReadyOrg(h, { name: ORG_NAME });
  await h.db.pool.query(
    "UPDATE organizations SET contact_phone = '0912345678', contact_email = 'btc@vidu.vn' WHERE id = $1",
    [org.orgId],
  );
  admin = await signUp(h);
  await h.db.orm.execute(
    sql`INSERT INTO members (organization_id, user_id, role) VALUES (${org.orgId}, ${admin.userId}, ${Role.ADMIN})`,
  );
  boss = h.app.get<PgBoss>(BOSS);
  await h.app.get(EventChangeEmailQueues).ready();
});
beforeEach(async () => {
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  await h.close();
});

interface Sale {
  event: EventDetail;
  freeTier: string;
  paidTier: string;
}

/** Sự kiện đã mở bán (tên có ký tự HTML, có địa điểm), một Hạng vé 0đ và một Hạng vé có phí. */
async function saleEvent(): Promise<Sale> {
  const sale = await eventOnSale(org, [
    { name: 'Vé tham dự', price: 0, capacity: 50 },
    { name: 'Vé VIP', price: 100_000, capacity: 50 },
  ]);
  await h.db.pool.query('UPDATE events SET name = $2, venue = $3 WHERE id = $1', [sale.event.id, EVENT_NAME, 'Sân A']);
  return { event: await fetchEvent(sale.event.id), freeTier: sale.tiers[0]!.id, paidTier: sale.tiers[1]!.id };
}

async function fetchEvent(eventId: string): Promise<EventDetail> {
  const res = await h.http.get(eventsPath(org, eventId)).set('cookie', org.owner.cookie).expect(200);
  return EventDetail.parse(res.body);
}

/** Người mua (mặc định mới) nhận 1 Vé 0đ: Đơn `paid`. */
async function buyFree(sale: Sale, buyer?: User): Promise<User> {
  buyer ??= await signUp(h);
  const res = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: sale.freeTier, quantity: 1 }]));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return buyer;
}

/** Người mua mới có Đơn có phí còn `pending` (không phải Người mua). */
async function buyPending(sale: Sale): Promise<User> {
  const buyer = await signUp(h);
  const res = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: sale.paidTier, quantity: 1 }]));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return buyer;
}

/** Body đầy đủ của `PATCH` từ Sự kiện hiện tại, thay các trường trong `changes`. */
const bodyOf = (event: EventDetail, changes: Record<string, unknown> = {}) => ({
  name: event.name,
  startsAt: event.startsAt,
  endsAt: event.endsAt,
  venue: event.venue,
  description: event.description,
  refundPolicy: event.refundPolicy,
  ...changes,
});

const patch = (eventId: string, body: unknown, user: User = admin) =>
  h.http.patch(eventsPath(org, eventId)).set('cookie', user.cookie).send(body as object);

async function edit(sale: Sale, changes: Record<string, unknown>): Promise<EventDetail> {
  const current = await fetchEvent(sale.event.id);
  const res = await patch(sale.event.id, bodyOf(current, changes)).expect(200);
  return EventDetail.parse(res.body);
}

const buyerCount = (eventId: string, user: User = admin, orgId = org.orgId) =>
  h.http.get(`/v1/orgs/${orgId}/events/${eventId}/buyer-count`).set('cookie', user.cookie);

async function versionOf(eventId: string): Promise<number> {
  const { rows } = await h.db.pool.query<{ v: number }>('SELECT time_venue_version AS v FROM events WHERE id = $1', [
    eventId,
  ]);
  return rows[0]!.v;
}

/** Job gốc (không `userId`) và job con của Sự kiện trong queue mới. */
async function jobsOf(eventId: string, queue: string = QUEUE) {
  const jobs = await boss.findJobs<SendEventChangeEmailPayload>(queue, { data: { eventId } });
  return {
    roots: jobs.filter((j) => j.data.userId === undefined),
    children: jobs.filter((j) => j.data.userId !== undefined),
  };
}

describe('GET …/buyer-count', () => {
  it('đếm user có Đơn paid (người hai Đơn tính một, Đơn chờ không tính); Owner và Admin đều gọi được', async () => {
    const sale = await saleEvent();
    expect(EventBuyerCount.parse((await buyerCount(sale.event.id).expect(200)).body)).toEqual({ buyers: 0 });
    const twice = await buyFree(sale);
    await buyFree(sale, twice);
    await buyFree(sale);
    await buyPending(sale);
    expect((await buyerCount(sale.event.id).expect(200)).body).toEqual({ buyers: 2 });
    expect((await buyerCount(sale.event.id, org.owner).expect(200)).body).toEqual({ buyers: 2 });
  });

  it('Sự kiện lạ, sai dạng, hoặc của BTC khác → 404 EVENT_NOT_FOUND; Owner BTC A trên đường BTC B → 403 NOT_A_MEMBER', async () => {
    const other = await paidReadyOrg(h, { name: 'BTC khác' });
    const theirs = await eventOnSale(other, [{ name: 'Vé', price: 0, capacity: 5 }]);
    for (const id of [randomUUID(), 'khong-phai-uuid', theirs.event.id]) {
      const res = await buyerCount(id).expect(404);
      expect(ErrorResponse.parse(res.body).error.code).toBe('EVENT_NOT_FOUND');
    }
    const res = await buyerCount(theirs.event.id, org.owner, other.orgId).expect(403);
    expect(ErrorResponse.parse(res.body).error.code).toBe('NOT_A_MEMBER');
    const patched = await patch(theirs.event.id, bodyOf(theirs.event, { venue: 'X' }), org.owner);
    expect(patched.status).toBe(404);
    expect(ErrorResponse.parse(patched.body).error.code).toBe('EVENT_NOT_FOUND');
  });
});

describe('PATCH …/events/:eventId (flows): khi nào enqueue', () => {
  it('đổi giờ, có Vé: một job gốc v1 (id cố định, payload chỉ id), version 1; EventDetail không lộ version', async () => {
    const sale = await saleEvent();
    const buyer = await buyFree(sale);
    expect(await versionOf(sale.event.id)).toBe(0);
    const res = await patch(sale.event.id, bodyOf(sale.event, { startsAt: NEW_START })).expect(200);
    expect(EventDetail.parse(res.body).startsAt).toBe(NEW_START);
    expect(Object.keys(res.body as object).sort()).toEqual(Object.keys(EventDetail.shape).sort());
    expect(await versionOf(sale.event.id)).toBe(1);
    const { roots } = await jobsOf(sale.event.id);
    expect(roots.map((j) => [j.id, j.data])).toEqual([
      [eventChangeEmailJobId(sale.event.id, 1), { eventId: sale.event.id, version: 1 }],
    ]);
    expect(JSON.stringify(roots[0]!.data)).not.toContain(buyer.email);
  });

  it('đổi địa điểm (kể cả xóa trống) hoặc giờ kết thúc → mỗi lệnh một job gốc; sửa hai lần → v1, v2 khác id', async () => {
    const sale = await saleEvent();
    await buyFree(sale);
    await edit(sale, { venue: 'Sân B' });
    await edit(sale, { venue: null });
    await edit(sale, { endsAt: '2099-11-16T18:00:00+07:00' });
    expect(await versionOf(sale.event.id)).toBe(3);
    const { roots } = await jobsOf(sale.event.id);
    expect(roots.map((j) => j.data.version).sort()).toEqual([1, 2, 3]);
    expect(new Set(roots.map((j) => j.id)).size).toBe(3);
    expect(roots.map((j) => j.id).sort()).toEqual([1, 2, 3].map((v) => eventChangeEmailJobId(sale.event.id, v)).sort());
  });

  it('chỉ sửa tên, mô tả, chính sách hoàn vé → không job, version giữ nguyên', async () => {
    const sale = await saleEvent();
    await buyFree(sale);
    await edit(sale, { name: 'Tên mới', description: 'Mô tả mới', refundPolicy: 'Không hoàn.' });
    // Cùng mốc giờ viết khác offset: không phải đổi giờ.
    await edit(sale, { startsAt: '2099-11-16T00:00:00Z' });
    expect(await versionOf(sale.event.id)).toBe(0);
    expect((await jobsOf(sale.event.id)).roots).toEqual([]);
  });

  it('chưa phát Vé (chỉ có Đơn chờ): buyer-count 0, đổi giờ → không job, version vẫn tăng', async () => {
    const sale = await saleEvent();
    await buyPending(sale);
    expect((await buyerCount(sale.event.id).expect(200)).body).toEqual({ buyers: 0 });
    await edit(sale, { startsAt: NEW_START });
    expect(await versionOf(sale.event.id)).toBe(1);
    expect((await jobsOf(sale.event.id)).roots).toEqual([]);
  });

  it('nháp: đổi giờ và địa điểm → không job, version vẫn tăng', async () => {
    const created = EventDetail.parse(
      (
        await h.http
          .post(eventsPath(org))
          .set('cookie', admin.cookie)
          .send({ name: 'Nháp', startsAt: '2099-11-16T07:00:00+07:00', endsAt: '2099-11-16T17:00:00+07:00' })
          .expect(201)
      ).body,
    );
    await patch(created.id, bodyOf(created, { startsAt: NEW_START, venue: 'Sân C' })).expect(200);
    expect(await versionOf(created.id)).toBe(1);
    expect((await jobsOf(created.id)).roots).toEqual([]);
  });

  it('Ẩn, có Vé → báo như published', async () => {
    const sale = await saleEvent();
    await buyFree(sale);
    await h.http.post(`${eventsPath(org, sale.event.id)}/hide`).set('cookie', admin.cookie).expect(200);
    await edit(sale, { venue: 'Sân ẩn' });
    expect((await jobsOf(sale.event.id)).roots.map((j) => j.data)).toEqual([{ eventId: sale.event.id, version: 1 }]);
  });

  it('lưu lặp cùng body → lần sau không ghi, không job thêm', async () => {
    const sale = await saleEvent();
    await buyFree(sale);
    const body = bodyOf(sale.event, { startsAt: NEW_START });
    await patch(sale.event.id, body).expect(200);
    await patch(sale.event.id, body).expect(200);
    expect(await versionOf(sale.event.id)).toBe(1);
    expect((await jobsOf(sale.event.id)).roots).toHaveLength(1);
  });

  it('sửa xong vẫn đã kết thúc (giờ mới trong quá khứ) → không job', async () => {
    const sale = await saleEvent();
    await buyFree(sale);
    await edit(sale, {
      startsAt: '2020-11-16T07:00:00+07:00',
      endsAt: '2020-11-16T17:00:00+07:00',
      venue: 'Sân cũ',
    });
    expect(await versionOf(sale.event.id)).toBe(1);
    expect((await jobsOf(sale.event.id)).roots).toEqual([]);
  });

  it('đã bấm "Kết thúc" → dời giờ sang tương lai vẫn không job (effective_end_at giữ mốc bấm)', async () => {
    const sale = await saleEvent();
    await buyFree(sale);
    await h.db.pool.query(
      "UPDATE events SET starts_at = now() - interval '2 hours', ended_manually_at = date_trunc('second', now()) - interval '1 minute', effective_end_at = date_trunc('second', now()) - interval '1 minute' WHERE id = $1",
      [sale.event.id],
    );
    const ended = await edit(sale, { startsAt: NEW_START, venue: 'Sân mới' });
    expect(ended.endedManuallyAt).not.toBeNull();
    expect(ended.effectiveEndAt).toBe(ended.endedManuallyAt);
    expect((await jobsOf(sale.event.id)).roots).toEqual([]);
  });

  it('400 VALIDATION_FAILED → không ghi, không job, version giữ nguyên', async () => {
    const sale = await saleEvent();
    await buyFree(sale);
    await patch(sale.event.id, bodyOf(sale.event, { startsAt: NEW_START, endsAt: NEW_START })).expect(400);
    expect(await versionOf(sale.event.id)).toBe(0);
    expect((await jobsOf(sale.event.id)).roots).toEqual([]);
  });

  it('lệnh sửa đổi giờ có Vé bị rollback sau khi enqueue → không job nào trong queue mới, giờ và version giữ nguyên', async () => {
    const sale = await saleEvent();
    await buyFree(sale);
    await h.app.get(PublicPageQueues).ready();
    // `boss.send` thật vào `tx`, rồi lỗi ngay sau khi enqueue job email: cả transaction rollback.
    const failing = Object.create(boss) as PgBoss;
    failing.send = (async (...args: Parameters<PgBoss['send']>) => {
      const id = await boss.send(...args);
      if (args[0] === QUEUE) throw new Error('lỗi sau khi enqueue');
      return id;
    }) as PgBoss['send'];
    const ctx: AccessContext = {
      userId: admin.userId,
      organizationId: org.orgId,
      role: Role.ADMIN,
      assignedEventIds: [],
      stepUpAt: null,
    };
    const input = EventDraftInput.parse(bodyOf(sale.event, { startsAt: NEW_START }));
    await expect(updateEvent(h.db, failing, ctx, sale.event.id, input)).rejects.toThrow('lỗi sau khi enqueue');
    expect(await versionOf(sale.event.id)).toBe(0);
    expect((await fetchEvent(sale.event.id)).startsAt).toBe(sale.event.startsAt);
    expect(await boss.findJobs(QUEUE, { data: { eventId: sale.event.id } })).toEqual([]);
  });

  it('enqueue lặp cùng (eventId, version) → vẫn một job gốc', async () => {
    const sale = await saleEvent();
    await h.db.transaction(async (tx) => {
      await enqueueEventChangeEmail(boss, tx, { eventId: sale.event.id, version: 7 });
      await enqueueEventChangeEmail(boss, tx, { eventId: sale.event.id, version: 7 });
    });
    await h.db.transaction((tx) => enqueueEventChangeEmail(boss, tx, { eventId: sale.event.id, version: 7 }));
    expect((await jobsOf(sale.event.id)).roots.map((j) => j.id)).toEqual([eventChangeEmailJobId(sale.event.id, 7)]);
  });
});

describe('job gốc và job con (gọi thẳng)', () => {
  let email: FakeEmailTransport;
  const sender = (): EventChangeEmailSender => ({ db: h.db, email, webOrigin: TEST_WEB_ORIGIN });
  beforeEach(() => {
    email = new FakeEmailTransport();
  });

  it('job gốc chạy lại không tạo thêm job con: id con = childJobId(id gốc, userId)', async () => {
    const sale = await saleEvent();
    const a = await buyFree(sale);
    await buyFree(sale, a);
    const b = await buyFree(sale);
    await buyPending(sale);
    const rootId = randomUUID();
    const payload = { eventId: sale.event.id, version: 1 };
    expect(await fanOutEventChangeEmail(h.db, boss, rootId, payload)).toBe(2);
    expect(await fanOutEventChangeEmail(h.db, boss, rootId, payload)).toBe(2);
    const children = (await jobsOf(sale.event.id)).children;
    expect(children.map((j) => j.id).sort()).toEqual([a, b].map((u) => childJobId(rootId, u.userId)).sort());
    expect(children.map((j) => j.data.userId).sort()).toEqual([a.userId, b.userId].sort());
    for (const child of children) expect(Object.keys(child.data).sort()).toEqual(['eventId', 'userId', 'version']);
  });

  it('job con gửi một email tới buyer_email của Đơn paid mới nhất, với giờ và địa điểm hiện tại (sửa hai lần → dữ liệu mới nhất)', async () => {
    const sale = await saleEvent();
    const buyer = await buyFree(sale);
    await buyFree(sale, buyer);
    // Đơn cũ hơn mang email cũ: chỉ Đơn paid mới nhất được dùng. `buyer_email` là bản chụp, `tickee_app` không sửa
    // được: sửa bằng role `tickee_migrator`.
    const migrator = new Database({ connectionString: migrationDatabaseUrl(), max: 1, applicationName: 'tickee-test' });
    try {
      await migrator.pool.query(
        `UPDATE orders SET buyer_email = 'cu@vidu.vn'
          WHERE id = (SELECT id FROM orders WHERE event_id = $1 AND user_id = $2 ORDER BY paid_at, created_at LIMIT 1)`,
        [sale.event.id, buyer.userId],
      );
    } finally {
      await migrator.close();
    }
    await edit(sale, { venue: 'Sân B' });
    const latest = await edit(sale, { startsAt: NEW_START, endsAt: '2099-11-16T20:00:00+07:00', venue: 'Sân <C>' });
    // Job của lượt v1 chạy sau lượt v2 vẫn mang dữ liệu hiện tại.
    expect(await sendEventChangeEmail(sender(), { eventId: sale.event.id, version: 1 }, buyer.userId)).toBe('sent');
    expect(email.sent).toHaveLength(1);
    const message = email.sent[0]!;
    expect(message.to).toBe(buyer.email);
    expect(message.subject).toBe(SUBJECT);
    expect(message.text).toContain(`Thời gian: ${formatEventTimeRange(latest.startsAt, latest.endsAt)} (giờ Việt Nam)`);
    expect(message.text).toContain('Địa điểm: Sân <C>');
    expect(message.text).not.toContain('Sân B');
    expect(message.html).toContain('Sân &lt;C&gt;');
  });

  it('bỏ qua (không gửi) khi Sự kiện đã hủy, đã quá effective_end_at, hoặc người đó không còn Đơn paid', async () => {
    const sale = await saleEvent();
    const buyer = await buyFree(sale);
    const stranger = await signUp(h);
    const payload = { eventId: sale.event.id, version: 1 };
    expect(await sendEventChangeEmail(sender(), payload, stranger.userId)).toBe('skipped');
    expect(await sendEventChangeEmail(sender(), { eventId: randomUUID(), version: 1 }, buyer.userId)).toBe('skipped');

    await h.db.pool.query("UPDATE orders SET status = 'cancelled' WHERE event_id = $1 AND user_id = $2", [
      sale.event.id,
      buyer.userId,
    ]);
    expect(await sendEventChangeEmail(sender(), payload, buyer.userId)).toBe('skipped');
    await h.db.pool.query("UPDATE orders SET status = 'paid' WHERE event_id = $1 AND user_id = $2", [
      sale.event.id,
      buyer.userId,
    ]);

    await h.db.pool.query("UPDATE events SET effective_end_at = now() - interval '1 second' WHERE id = $1", [
      sale.event.id,
    ]);
    expect(await sendEventChangeEmail(sender(), payload, buyer.userId)).toBe('skipped');
    expect(await fanOutEventChangeEmail(h.db, boss, randomUUID(), payload)).toBe('skipped');
    await h.db.pool.query("UPDATE events SET effective_end_at = '2099-11-16T23:59:59+07:00' WHERE id = $1", [
      sale.event.id,
    ]);

    await h.db.pool.query("UPDATE events SET status = 'cancelled' WHERE id = $1", [sale.event.id]);
    expect(await sendEventChangeEmail(sender(), payload, buyer.userId)).toBe('skipped');
    expect(await fanOutEventChangeEmail(h.db, boss, randomUUID(), payload)).toBe('skipped');
    expect(email.sent).toEqual([]);
  });

  it('SMTP lỗi → ném lỗi chỉ có tên lớp (không email)', async () => {
    const sale = await saleEvent();
    const buyer = await buyFree(sale);
    class SmtpRejected extends Error {}
    email.failWith = new SmtpRejected(`550 hộp thư ${buyer.email} không tồn tại`);
    const failure = await sendEventChangeEmail(sender(), { eventId: sale.event.id, version: 1 }, buyer.userId).catch(
      (err: unknown) => err,
    );
    expect((failure as Error).message).toBe('Không gửi được email đổi giờ/địa điểm (SmtpRejected)');
  });
});

describe('mẫu email', () => {
  it('thứ tự: BTC cập nhật → thời gian (khoảng giờ, giờ VN) → địa điểm → Vé vẫn dùng được → Vé của tôi → liên hệ BTC; HTML escape', () => {
    const startsAt = new Date('2099-11-16T00:00:00.000Z');
    const endsAt = new Date('2099-11-16T10:00:00.000Z');
    const message = buildEventChangeEmail({
      eventName: 'Giải <Mùa thu>',
      startsAt,
      endsAt,
      venue: 'Sân A & B',
      myTicketsLink: `${TEST_WEB_ORIGIN}/tickets`,
      organizer: { name: 'CLB <X>', contactPhone: '0912345678', contactEmail: 'btc@vidu.vn' },
    });
    expect(message.subject).toBe('Sự kiện đổi giờ hoặc địa điểm · Giải <Mùa thu>');
    const lines = [
      'BTC CLB <X> vừa cập nhật thời gian hoặc địa điểm của Giải <Mùa thu>.',
      'Thời gian: Thứ hai, 16/11/2099 · 07:00 – 17:00 (giờ Việt Nam)',
      'Địa điểm: Sân A & B',
      'Vé của bạn vẫn dùng được, không cần làm gì thêm.',
      `Vé của tôi: ${TEST_WEB_ORIGIN}/tickets`,
      'Liên hệ BTC: CLB <X>',
      'SĐT: 0912345678',
      'Email: btc@vidu.vn',
    ];
    const positions = lines.map((line) => message.text.indexOf(line));
    expect(positions.every((p) => p >= 0), JSON.stringify(positions)).toBe(true);
    expect([...positions].sort((x, y) => x - y)).toEqual(positions);
    expect(message.html).toContain('CLB &lt;X&gt;');
    expect(message.html).toContain('Giải &lt;Mùa thu&gt;');
    expect(message.html).toContain('Sân A &amp; B');
    expect(message.html).toContain(`href="${TEST_WEB_ORIGIN}/tickets"`);
    expect(message.html).not.toMatch(/<X>|<Mùa thu>/);

    const noVenue = buildEventChangeEmail({
      eventName: 'X',
      startsAt,
      endsAt: new Date('2099-11-17T10:00:00.000Z'),
      venue: null,
      myTicketsLink: `${TEST_WEB_ORIGIN}/tickets`,
      organizer: { name: 'CLB', contactPhone: null, contactEmail: null },
    });
    expect(noVenue.text).toContain('Địa điểm: BTC chưa công bố địa điểm');
    expect(noVenue.text).toContain('Thời gian: Thứ hai, 16/11/2099 · 07:00 – Thứ ba, 17/11/2099 · 17:00 (giờ Việt Nam)');
    expect(noVenue.text).not.toMatch(/SĐT|Email:/);
  });
});

describe('worker', () => {
  let worker: INestApplicationContext;
  let workerEmail: FakeEmailTransport;
  let workerBoss: PgBoss;
  const workerLines = () => h.logs.lines.filter((l) => l.context === 'EventChangeEmailWorker');
  const changeEmailsTo = (to: string) => workerEmail.sent.filter((m) => m.to === to && m.subject === SUBJECT);

  beforeAll(async () => {
    workerEmail = new FakeEmailTransport();
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule.forRoot(workerConfig())] })
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue(workerEmail)
      .compile();
    moduleRef.useLogger(moduleRef.get(PinoNestLogger));
    worker = await moduleRef.init();
    workerBoss = worker.get<PgBoss>(BOSS);
  });
  afterAll(async () => {
    await worker.close();
  });

  it('cấu hình queue: retry có backoff và dead-letter', async () => {
    expect(await workerBoss.getQueue(QUEUE)).toMatchObject({
      name: QUEUE,
      deadLetter: DEAD_LETTER,
      retryLimit: EVENT_CHANGE_EMAIL_QUEUE_OPTIONS.retryLimit,
      retryBackoff: true,
    });
    expect((await workerBoss.getQueue(DEAD_LETTER))?.name).toBe(DEAD_LETTER);
  });

  it('đổi giờ, 3 Người mua (một người 2 Đơn): Dialog đếm 3 → 1 job gốc v1 → 3 job con → mỗi người đúng một email', async () => {
    const sale = await saleEvent();
    const a = await buyFree(sale);
    await buyFree(sale, a);
    const b = await buyFree(sale);
    const c = await buyFree(sale);
    const pending = await buyPending(sale);
    expect((await buyerCount(sale.event.id).expect(200)).body).toEqual({ buyers: 3 });

    const updated = await edit(sale, { startsAt: NEW_START });
    for (const buyer of [a, b, c]) {
      await expect.poll(() => changeEmailsTo(buyer.email).length, { timeout: 15_000, interval: 100 }).toBe(1);
    }
    expect(changeEmailsTo(pending.email)).toEqual([]);
    const message = changeEmailsTo(a.email)[0]!;
    expect(message.text).toContain(`BTC ${ORG_NAME} vừa cập nhật thời gian hoặc địa điểm của ${EVENT_NAME}.`);
    expect(message.text).toContain(formatEventTimeRange(updated.startsAt, updated.endsAt));
    expect(message.text).toContain('Địa điểm: Sân A');
    expect(message.text).toContain(`${TEST_WEB_ORIGIN}/tickets`);
    expect(message.text).toContain('SĐT: 0912345678');

    const rootId = eventChangeEmailJobId(sale.event.id, 1);
    await expect.poll(async () => (await workerBoss.getJobById(QUEUE, rootId))?.state, { timeout: 10_000 }).toBe('completed');
    const { roots, children } = await jobsOf(sale.event.id);
    expect(roots.map((j) => j.id)).toEqual([rootId]);
    expect(children.map((j) => j.id).sort()).toEqual([a, b, c].map((u) => childJobId(rootId, u.userId)).sort());
    for (const child of children) {
      await expect.poll(async () => (await workerBoss.getJobById(QUEUE, child.id))?.state, { timeout: 10_000 }).toBe(
        'completed',
      );
    }
    // Log chỉ có id: có dòng của worker cho Sự kiện này, không có email nào.
    await expect
      .poll(() => workerLines().filter((l) => l.eventId === sale.event.id && l.result === 'sent').length)
      .toBe(3);
    for (const buyer of [a, b, c]) expect(h.logs.text).not.toContain(buyer.email);
  });

  it('sửa hai lần → hai lượt email; email cuối mang địa điểm mới nhất', async () => {
    const sale = await saleEvent();
    const buyer = await buyFree(sale);
    await edit(sale, { venue: 'Sân lượt 1' });
    await edit(sale, { venue: 'Sân lượt 2' });
    await expect.poll(() => changeEmailsTo(buyer.email).length, { timeout: 15_000, interval: 100 }).toBe(2);
    expect(changeEmailsTo(buyer.email).at(-1)!.text).toContain('Địa điểm: Sân lượt 2');
    const { roots } = await jobsOf(sale.event.id);
    expect(roots.map((j) => j.id).sort()).toEqual([1, 2].map((v) => eventChangeEmailJobId(sale.event.id, v)).sort());
  });

  it('SMTP lỗi với một người: chỉ job con của người đó retry, người khác vẫn nhận; hết lượt → dead-letter, lỗi không có email', async () => {
    const sale = await saleEvent();
    const ok = await buyFree(sale);
    const failing = await buyFree(sale);
    workerEmail.failFor.set(failing.email, new Error(`SMTP từ chối ${failing.email}`));
    try {
      await edit(sale, { venue: 'Sân SMTP' });
      await expect.poll(() => changeEmailsTo(ok.email).length, { timeout: 15_000, interval: 100 }).toBe(1);
      const rootId = eventChangeEmailJobId(sale.event.id, 1);
      const failingChild = childJobId(rootId, failing.userId);
      await expect
        .poll(async () => (await workerBoss.getJobById(QUEUE, failingChild))?.state, { timeout: 15_000, interval: 100 })
        .toBe('retry');
      expect((await workerBoss.getJobById(QUEUE, rootId))?.state).toBe('completed');
      expect((await workerBoss.getJobById(QUEUE, childJobId(rootId, ok.userId)))?.state).toBe('completed');

      // Cùng việc với 0 lượt retry: lỗi là sang dead-letter ngay.
      const exhausted = await workerBoss.send(
        QUEUE,
        { eventId: sale.event.id, version: 1, userId: failing.userId },
        { retryLimit: 0 },
      );
      await expect
        .poll(async () => (await workerBoss.getJobById(QUEUE, exhausted!))?.state, { timeout: 15_000, interval: 100 })
        .toBe('failed');
      const failed = await workerBoss.getJobById(QUEUE, exhausted!);
      expect(JSON.stringify(failed?.output)).toContain('Không gửi được email đổi giờ/địa điểm (Error)');
      expect(JSON.stringify(failed?.output)).not.toContain(failing.email);
      await expect
        .poll(async () => (await jobsOf(sale.event.id, DEAD_LETTER)).children.length, { timeout: 10_000, interval: 100 })
        .toBe(1);
      expect(changeEmailsTo(failing.email)).toEqual([]);
      expect(h.logs.text).not.toContain(failing.email);
    } finally {
      workerEmail.failFor.delete(failing.email);
    }
  });

  it('Sự kiện hủy trước khi job chạy → không email', async () => {
    const sale = await saleEvent();
    const buyer = await buyFree(sale);
    await h.db.pool.query("UPDATE events SET status = 'cancelled' WHERE id = $1", [sale.event.id]);
    const jobId = await workerBoss.send(QUEUE, { eventId: sale.event.id, version: 1, userId: buyer.userId });
    await expect.poll(async () => (await workerBoss.getJobById(QUEUE, jobId!))?.state, { timeout: 15_000, interval: 100 }).toBe(
      'completed',
    );
    expect(changeEmailsTo(buyer.email)).toEqual([]);
  });
});
