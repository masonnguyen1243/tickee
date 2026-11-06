import 'reflect-metadata';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventDetail, JobQueue, TicketTypeDetail } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  enqueuePublicPageRevalidation,
  PUBLIC_PAGE_QUEUE_OPTIONS,
  PublicPageQueues,
  REVALIDATE_TIMEOUT_MS,
  revalidatePublicPage,
  type PublicPageRevalidator,
} from '../../src/modules/event/public-page-jobs.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import { WorkerModule } from '../../src/worker.module.js';
import { TEST_REVALIDATE_SECRET, workerConfig } from '../helpers.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';

/*
 * Story 2.11-c: ghi làm đổi phần tĩnh của Sự kiện đã mở bán enqueue `event.revalidate-public-page` (payload `{ slug }`)
 * trong cùng `tx`; worker gọi `POST {WEB_ORIGIN}/api/revalidate`. Đếm job theo queue và slug (slug là duy nhất).
 */

const QUEUE = JobQueue.EVENT_REVALIDATE_PUBLIC_PAGE;

let h: Harness;
let boss: PgBoss;
let owner: Awaited<ReturnType<typeof signUp>>;
let orgId: string;

const draft = {
  name: 'Giải chạy Hà Nội 2026',
  startsAt: '2099-11-16T07:00:00+07:00',
  endsAt: '2099-11-16T17:00:00+07:00',
  refundPolicy: 'Hoàn 100% trước 7 ngày.',
};

beforeAll(async () => {
  h = await createHarness();
  boss = h.app.get<PgBoss>(BOSS);
  await h.app.get(PublicPageQueues).ready();
  owner = await signUp(h);
  orgId = (await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: 'CLB Chạy Bộ' }).expect(201)).body
    .id as string;
});
afterAll(async () => {
  await h.close();
});

const eventPath = (eventId = '') => `/v1/orgs/${orgId}/events${eventId ? `/${eventId}` : ''}`;
const ticketTypesPath = (eventId: string) => `${eventPath(eventId)}/ticket-types`;

async function newEvent(): Promise<EventDetail> {
  return EventDetail.parse((await h.http.post(eventPath()).set('cookie', owner.cookie).send(draft).expect(201)).body);
}

async function addTicketType(eventId: string, body: Record<string, unknown> = {}): Promise<TicketTypeDetail> {
  const res = await h.http
    .post(ticketTypesPath(eventId))
    .set('cookie', owner.cookie)
    .send({ name: 'Miễn phí', price: 0, capacity: 50, ...body })
    .expect(201);
  return TicketTypeDetail.parse(res.body);
}

/** Sự kiện miễn phí đã mở bán (không cần Closed Beta hay tài khoản nhận tiền). */
async function publishedEvent(): Promise<{ event: EventDetail; ticketType: TicketTypeDetail }> {
  const event = await newEvent();
  const ticketType = await addTicketType(event.id);
  await h.http.post(`${eventPath(event.id)}/publish`).set('cookie', owner.cookie).expect(200);
  return { event, ticketType };
}

const editEvent = (eventId: string, body: Record<string, unknown>) =>
  h.http.patch(eventPath(eventId)).set('cookie', owner.cookie).send({ ...draft, ...body });

async function jobsOf(slug: string) {
  return boss.findJobs<{ slug: string }>(QUEUE, { data: { slug } });
}
const jobCount = async (slug: string) => (await jobsOf(slug)).length;

describe('enqueue khi BTC sửa', () => {
  it('mở bán (draft → published) → 1 job, payload chỉ { slug }', async () => {
    const event = await newEvent();
    await addTicketType(event.id);
    expect(await jobCount(event.slug)).toBe(0);

    await h.http.post(`${eventPath(event.id)}/publish`).set('cookie', owner.cookie).expect(200);
    const jobs = await jobsOf(event.slug);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.data).toEqual({ slug: event.slug });
  });

  it('sửa Sự kiện đang bán (đổi tên) → thêm đúng 1 job', async () => {
    const { event } = await publishedEvent();
    const before = await jobCount(event.slug);
    await editEvent(event.id, { name: 'Giải chạy Hà Nội 2026 — đổi giờ' }).expect(200);
    expect(await jobCount(event.slug)).toBe(before + 1);
  });

  it('sửa không đổi gì (body giống hiện tại) → không job', async () => {
    const { event } = await publishedEvent();
    const before = await jobCount(event.slug);
    await editEvent(event.id, {}).expect(200);
    expect(await jobCount(event.slug)).toBe(before);
  });

  it('Sự kiện nháp: sửa, tạo/sửa/xóa Hạng vé → không job', async () => {
    const event = await newEvent();
    await editEvent(event.id, { name: 'Tên mới' }).expect(200);
    const ticketType = await addTicketType(event.id);
    await h.http
      .patch(`${ticketTypesPath(event.id)}/${ticketType.id}`)
      .set('cookie', owner.cookie)
      .send({ name: 'Đổi tên', price: 0, capacity: 60 })
      .expect(200);
    await h.http.delete(`${ticketTypesPath(event.id)}/${ticketType.id}`).set('cookie', owner.cookie).expect(204);
    expect(await jobCount(event.slug)).toBe(0);
  });

  it('Sự kiện đang bán: tạo, sửa (có đổi), xóa Hạng vé → mỗi lệnh 1 job; sửa không đổi → không job', async () => {
    const { event, ticketType } = await publishedEvent();
    let expected = await jobCount(event.slug);

    const extra = await addTicketType(event.id, { name: 'Vé thêm', capacity: 10 });
    expect(await jobCount(event.slug)).toBe(++expected);

    const ticketTypeUrl = `${ticketTypesPath(event.id)}/${ticketType.id}`;
    const body = { name: 'Miễn phí (đổi tên)', price: 0, capacity: 50 };
    await h.http.patch(ticketTypeUrl).set('cookie', owner.cookie).send(body).expect(200);
    expect(await jobCount(event.slug)).toBe(++expected);
    await h.http.patch(ticketTypeUrl).set('cookie', owner.cookie).send(body).expect(200);
    expect(await jobCount(event.slug)).toBe(expected);

    await h.http.delete(`${ticketTypesPath(event.id)}/${extra.id}`).set('cookie', owner.cookie).expect(204);
    expect(await jobCount(event.slug)).toBe(++expected);
  });

  it('đổi giới hạn Vé/Đơn và form mua vé (không có trên trang) → không job', async () => {
    const { event } = await publishedEvent();
    const before = await jobCount(event.slug);
    await h.http
      .patch(`${eventPath(event.id)}/order-limit`)
      .set('cookie', owner.cookie)
      .send({ maxTicketsPerOrder: 4 })
      .expect(200);
    await h.http
      .post(`${eventPath(event.id)}/form/questions`)
      .set('cookie', owner.cookie)
      .send({ label: 'Câu lạc bộ', kind: 'text', required: false })
      .expect(201);
    expect(await jobCount(event.slug)).toBe(before);
  });

  it('ghi lỗi (409) → không job', async () => {
    const { event, ticketType } = await publishedEvent();
    const before = await jobCount(event.slug);
    // Mở bán lại Sự kiện đã mở bán → 409 EVENT_NOT_DRAFT.
    await h.http.post(`${eventPath(event.id)}/publish`).set('cookie', owner.cookie).expect(409);
    // Số suất dưới đã bán → 409 CAPACITY_BELOW_COMMITTED (cả transaction rollback).
    await h.db.orm.execute(sql`UPDATE ticket_type_inventory SET sold = 20 WHERE ticket_type_id = ${ticketType.id}`);
    await h.http
      .patch(`${ticketTypesPath(event.id)}/${ticketType.id}`)
      .set('cookie', owner.cookie)
      .send({ name: 'Miễn phí', price: 0, capacity: 10 })
      .expect(409);
    expect(await jobCount(event.slug)).toBe(before);
  });

  it('enqueue trong tx rồi tx rollback → không job; commit → có job', async () => {
    const slug = `rollback-${Date.now().toString(36)}`;
    await expect(
      h.db.transaction(async (tx) => {
        await enqueuePublicPageRevalidation(boss, tx, slug);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await jobCount(slug)).toBe(0);

    await h.db.transaction((tx) => enqueuePublicPageRevalidation(boss, tx, slug));
    expect(await jobCount(slug)).toBe(1);
  });

  it('cấu hình queue: retry 3 lần, 2 giây, backoff; không có dead-letter', async () => {
    const queue = await boss.getQueue(QUEUE);
    expect(queue).toMatchObject({ name: QUEUE, retryLimit: 3, retryDelay: 2, retryBackoff: true });
    expect(queue?.deadLetter ?? null).toBeNull();
    expect(PUBLIC_PAGE_QUEUE_OPTIONS).toEqual({ retryLimit: 3, retryDelay: 2, retryBackoff: true });
  });
});

describe('revalidatePublicPage (handler của job)', () => {
  const ORIGIN = 'http://web.tickee.test';
  const revalidator = (fetch: PublicPageRevalidator['fetch']): PublicPageRevalidator => ({
    webOrigin: ORIGIN,
    secret: TEST_REVALIDATE_SECRET,
    fetch,
  });

  it('POST {WEB_ORIGIN}/api/revalidate, Bearer secret, body { tag: "event:{slug}" }, timeout 5 giây', async () => {
    const fetch = vi.fn<PublicPageRevalidator['fetch']>().mockResolvedValue(new Response(null, { status: 204 }));
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    try {
      await revalidatePublicPage(revalidator(fetch), 'giai-chay-ab12');
      expect(REVALIDATE_TIMEOUT_MS).toBe(5_000);
      expect(timeout).toHaveBeenCalledTimes(1);
      expect(timeout).toHaveBeenCalledWith(REVALIDATE_TIMEOUT_MS);
    } finally {
      timeout.mockRestore();
    }

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${ORIGIN}/api/revalidate`);
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${TEST_REVALIDATE_SECRET}`);
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual({ tag: 'event:giai-chay-ab12' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.redirect).toBe('error');
  });

  it('web trả 500 → ném lỗi (để pg-boss retry), lỗi không chứa secret', async () => {
    const fetch = vi.fn<PublicPageRevalidator['fetch']>().mockResolvedValue(new Response('lỗi', { status: 500 }));
    const failure = await revalidatePublicPage(revalidator(fetch), 'giai-chay-ab12').catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('500');
    expect((failure as Error).message).not.toContain(TEST_REVALIDATE_SECRET);
  });

  it('lỗi mạng / hết giờ → ném lỗi chỉ mang tên lỗi, không chứa secret hay URL', async () => {
    const networkError = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    for (const err of [networkError, new DOMException('timeout', 'TimeoutError')]) {
      const fetch = vi.fn<PublicPageRevalidator['fetch']>().mockRejectedValue(err);
      const failure = await revalidatePublicPage(revalidator(fetch), 'giai-chay-ab12').catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).not.toContain(TEST_REVALIDATE_SECRET);
      expect((failure as Error).message).not.toContain(ORIGIN);
    }
  });
});

describe('worker', () => {
  interface Received {
    method?: string;
    url?: string;
    authorization?: string;
    body: string;
  }

  let server: Server;
  let received: Received[];
  let status = 204;
  let worker: INestApplicationContext;

  beforeAll(async () => {
    received = [];
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      req.on('end', () => {
        received.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body });
        res.statusCode = status;
        res.end();
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Không lấy được cổng');
    const moduleRef = await Test.createTestingModule({
      imports: [WorkerModule.forRoot(workerConfig({ WEB_ORIGIN: `http://127.0.0.1:${address.port}` }))],
    }).compile();
    worker = await moduleRef.init();
  });
  afterAll(async () => {
    await worker?.close();
    server.closeAllConnections();
    server.close();
  });

  const callsFor = (slug: string) => received.filter((r) => r.body === JSON.stringify({ tag: `event:${slug}` }));

  async function stateOf(slug: string, index: number): Promise<string | undefined> {
    const jobs = await worker.get<PgBoss>(BOSS).findJobs(QUEUE, { data: { slug } });
    return jobs[index]?.state;
  }

  it('mở bán qua api → worker gọi web với đúng header và tag, job completed', async () => {
    status = 204;
    const { event } = await publishedEvent();
    await expect.poll(() => callsFor(event.slug).length, { timeout: 15_000, interval: 100 }).toBe(1);
    expect(callsFor(event.slug)[0]).toMatchObject({
      method: 'POST',
      url: '/api/revalidate',
      authorization: `Bearer ${TEST_REVALIDATE_SECRET}`,
    });
    await expect.poll(() => stateOf(event.slug, 0), { timeout: 10_000, interval: 100 }).toBe('completed');
  });

  it('payload hỏng → job hỏng hẳn ngay (không retry), không gọi web', async () => {
    const workerBoss = worker.get<PgBoss>(BOSS);
    const slug = 'Sai Dang';
    const jobId = await workerBoss.send(QUEUE, { slug });
    await expect
      .poll(async () => (await workerBoss.findJobs(QUEUE, { id: jobId! }))[0]?.state, { timeout: 15_000, interval: 100 })
      .toBe('failed');
    expect((await workerBoss.findJobs(QUEUE, { id: jobId! }))[0]?.retryCount).toBe(0);
    expect(received.some((r) => r.body.includes(slug))).toBe(false);
  });

  it('web trả 500 → job sang retry (pg-boss thử lại)', async () => {
    const event = await newEvent();
    await addTicketType(event.id);
    status = 500;
    try {
      await h.http.post(`${eventPath(event.id)}/publish`).set('cookie', owner.cookie).expect(200);
      await expect.poll(() => stateOf(event.slug, 0), { timeout: 15_000, interval: 100 }).toBe('retry');
      expect(callsFor(event.slug).length).toBeGreaterThanOrEqual(1);
    } finally {
      status = 204;
    }
  });
});
