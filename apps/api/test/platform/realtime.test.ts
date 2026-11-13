import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Controller, Get, Inject, Param, Req, Res } from '@nestjs/common';
import { ErrorResponse, RealtimeTopic, type OrganizationRealtimeTopic } from '@tickee/contracts';
import type { Request, Response } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Public } from '../../src/platform/http/index.js';
import { REALTIME_CHANNEL, REALTIME_OPTIONS, RealtimeHub, realtime } from '../../src/platform/realtime/index.js';
import { databaseUrl } from '../helpers.js';
import { createHarness, type Harness } from '../identity/harness.js';
import { listen, openSse, sleep, type SseClient } from './sse-client.js';

/*
 * `platform/realtime` (Story 3.7, AD-17) trên Postgres thật và server HTTP thật: `realtime.notify` trong `tx` (commit thì
 * phát, rollback thì không), hub `LISTEN` → SSE theo bộ lọc, heartbeat, header, `LISTEN` rớt rồi nối lại (`/readyz`,
 * tín hiệu `resync`), tắt máy. Bộ lọc thật theo phạm vi Người mua nằm ở `ordering/order-live.test.ts`.
 */

/** Stream thử: mở hub với bộ lọc "id trùng `:id`", không cần đăng nhập. */
@Public()
@Controller('test-realtime')
class RealtimeProbeController {
  constructor(@Inject(RealtimeHub) private readonly hub: RealtimeHub) {}

  @Get(':id')
  open(@Param('id') id: string, @Req() req: Request, @Res() res: Response): void {
    this.hub.open(req, res, (signal) => signal.id === id);
  }
}

const HEARTBEAT_MS = 150;
/** Tên kết nối `LISTEN` riêng của file này (để cắt đúng kết nối của hub này). */
const LISTEN_APP = `tickee-realtime-test-${randomUUID().slice(0, 8)}`;

const ids = () => ({ id: randomUUID(), organizationId: randomUUID(), eventId: randomUUID() });

let h: Harness;
let http: Awaited<ReturnType<typeof listen>>;
const streams: SseClient[] = [];

beforeAll(async () => {
  h = await createHarness(
    {},
    {
      controllers: [RealtimeProbeController],
      overrides: [
        {
          provide: REALTIME_OPTIONS,
          useValue: {
            connectionString: databaseUrl(),
            applicationName: LISTEN_APP,
            heartbeatMs: HEARTBEAT_MS,
            reconnectInitialMs: 1_000,
          },
        },
      ],
    },
  );
  http = await listen(h.app);
});
afterAll(async () => {
  for (const s of streams) s.close();
  await http.close();
  await h.close();
});

async function stream(id: string): Promise<SseClient> {
  const s = await openSse(http.baseUrl, `/v1/test-realtime/${id}`);
  streams.push(s);
  return s;
}

const commit = (topic: Exclude<RealtimeTopic, OrganizationRealtimeTopic>, target: ReturnType<typeof ids>) =>
  h.db.transaction((tx) => realtime.notify(tx, topic, target));

describe('SSE và notify', () => {
  it('header chống cache/buffer, retry ngẫu nhiên 1–5 giây, comment mở đầu, heartbeat là dòng comment', async () => {
    const s = await stream(randomUUID());
    expect(s.status).toBe(200);
    expect(s.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(s.headers['cache-control']).toBe('no-store, no-transform');
    expect(s.headers['x-accel-buffering']).toBe('no');
    await expect.poll(() => s.text()).toMatch(/^retry: \d+\n/);
    const retry = Number(/^retry: (\d+)\n/.exec(s.text())![1]);
    expect(retry).toBeGreaterThanOrEqual(1_000);
    expect(retry).toBeLessThanOrEqual(5_000);
    await sleep(HEARTBEAT_MS * 3 + 100);
    expect(s.comments[0]).toBe('connected');
    expect(s.comments.filter((c) => c === 'heartbeat').length).toBeGreaterThanOrEqual(2);
    expect(s.messages).toEqual([]);
  });

  it('notify trong tx đã commit → stream có bộ lọc khớp nhận đúng {type} trong < 1 giây; stream khác không nhận', async () => {
    const target = ids();
    const mine = await stream(target.id);
    const other = await stream(randomUUID());
    const sent = Date.now();
    await commit(RealtimeTopic.ORDER_CHANGED, target);
    const [message] = await mine.waitForMessages(1, 1_000);
    expect(message!.raw).toBe('{"type":"order_changed"}');
    expect(message!.at - sent).toBeLessThan(1_000);
    await sleep(200);
    expect(other.messages).toEqual([]);
  });

  it('rollback → không có tín hiệu; một tx phát cùng payload hai lần → một tín hiệu', async () => {
    const target = ids();
    const s = await stream(target.id);
    await expect(
      h.db.transaction(async (tx) => {
        await realtime.notify(tx, RealtimeTopic.ORDER_CHANGED, target);
        throw new Error('lỗi sau khi Đơn đổi');
      }),
    ).rejects.toThrow('lỗi sau khi Đơn đổi');
    await sleep(300);
    expect(s.messages).toEqual([]);

    await h.db.transaction(async (tx) => {
      await realtime.notify(tx, RealtimeTopic.ORDER_CHANGED, target);
      await realtime.notify(tx, RealtimeTopic.ORDER_CHANGED, target);
    });
    await s.waitForMessages(1, 1_000);
    await sleep(200);
    expect(s.messages).toHaveLength(1);
  });

  it('tín hiệu cấp BTC (Story 4.2): notifyOrganization không có eventId; stream lọc theo BTC nhận, topic cấp Sự kiện → ném', async () => {
    const organizationId = randomUUID();
    const s = await stream(organizationId);
    await h.db.transaction((tx) => realtime.notifyOrganization(tx, RealtimeTopic.ORG_STATUS_CHANGED, organizationId));
    const [message] = await s.waitForMessages(1, 1_000);
    expect(message!.raw).toBe('{"type":"org_status_changed"}');
    // Topic cấp Sự kiện bị chặn ở kiểu; lách kiểu thì payload sai dạng → ném.
    await expect(
      h.db.transaction((tx) =>
        realtime.notifyOrganization(tx, RealtimeTopic.ORDER_CHANGED as typeof RealtimeTopic.ORG_STATUS_CHANGED, organizationId),
      ),
    ).rejects.toThrow();
    // `org_status_changed` kèm Sự kiện: bị chặn ở kiểu; lách kiểu thì payload sai dạng → ném.
    const orgTopic = RealtimeTopic.ORG_STATUS_CHANGED as unknown as typeof RealtimeTopic.ORDER_CHANGED;
    await expect(
      h.db.transaction((tx) => realtime.notify(tx, orgTopic, { ...ids(), organizationId, id: organizationId })),
    ).rejects.toThrow();
  });

  it('payload sai dạng: notify ném (tx rollback); NOTIFY lạ trên kênh bị bỏ qua kèm log, không làm hỏng hub', async () => {
    await expect(
      h.db.transaction((tx) => realtime.notify(tx, RealtimeTopic.ORDER_CHANGED, { ...ids(), id: 'TK8F3Q2AXM' })),
    ).rejects.toThrow();

    const target = ids();
    const s = await stream(target.id);
    await h.db.pool.query('SELECT pg_notify($1, $2)', [REALTIME_CHANNEL, 'khong-phai-json']);
    await h.db.pool.query('SELECT pg_notify($1, $2)', [REALTIME_CHANNEL, JSON.stringify({ ...target, type: 'loai_la' })]);
    await expect.poll(() => h.logs.lines.filter((l) => l.msg === 'Tín hiệu realtime sai dạng; bỏ qua').length).toBe(2);
    await commit(RealtimeTopic.ORDER_CHANGED, target);
    await s.waitForMessages(1, 1_000);
    expect(s.messages.map((m) => m.data)).toEqual([{ type: 'order_changed' }]);
  });

  it('client đóng stream → hub bỏ người đăng ký', async () => {
    const hub = h.app.get(RealtimeHub);
    const before = hub.streamCount;
    const s = await stream(randomUUID());
    await expect.poll(() => hub.streamCount).toBe(before + 1);
    s.close();
    await expect.poll(() => hub.streamCount).toBe(before);
  });
});

describe('LISTEN rớt', () => {
  it('/readyz 503 + stream mới 503 + log warn; nối lại → /readyz 200 và mọi stream đang mở nhận resync; tín hiệu sau đó vẫn tới', async () => {
    await h.http.get('/readyz').expect(200);
    const target = ids();
    const s = await stream(target.id);
    const { rows } = await h.db.pool.query<{ ok: boolean }>(
      `SELECT pg_terminate_backend(pid) AS ok FROM pg_stat_activity
        WHERE application_name = $1 AND datname = current_database() AND pid <> pg_backend_pid()`,
      [LISTEN_APP],
    );
    expect(rows).toEqual([{ ok: true }]);

    await expect.poll(async () => (await h.http.get('/readyz')).status, { interval: 25 }).toBe(503);
    // Chưa LISTEN: không nhận stream mới (client tiếp tục polling thay vì tưởng đã kết nối).
    const refused = await openSse(http.baseUrl, `/v1/test-realtime/${randomUUID()}`);
    await refused.ended;
    expect(refused.status).toBe(503);
    expect(ErrorResponse.parse(JSON.parse(refused.text())).error.code).toBe('SERVICE_UNAVAILABLE');
    expect(h.logs.lines.some((l) => l.msg === 'Mất kết nối LISTEN realtime; sẽ nối lại' && l.level === 40)).toBe(true);

    await expect.poll(async () => (await h.http.get('/readyz')).status, { timeout: 5_000 }).toBe(200);
    const [resync] = await s.waitForMessages(1, 2_000);
    expect(resync!.raw).toBe('{"type":"resync"}');
    expect(s.isEnded()).toBe(false);

    await commit(RealtimeTopic.ORDER_CHANGED, target);
    await s.waitForMessages(2, 1_000);
    expect(s.messages.map((m) => m.data)).toEqual([{ type: 'resync' }, { type: 'order_changed' }]);
  });
});

describe('tắt máy (SIGTERM)', () => {
  it('app.close() khi còn stream mở: hub đóng stream trước khi đóng HTTP, stream mới 503, server đóng không cần cắt kết nối', async () => {
    const own = await createHarness({}, { controllers: [RealtimeProbeController] });
    const server = await listen(own.app);
    const s = await openSse(server.baseUrl, `/v1/test-realtime/${randomUUID()}`);
    expect(s.status).toBe(200);
    const started = Date.now();
    // Đúng thứ tự Nest chạy khi nhận SIGTERM: `onModuleDestroy` (hub đóng stream, từ chối stream mới) → đóng HTTP →
    // `onApplicationShutdown` (đóng LISTEN).
    await own.app.close();
    await s.ended;
    const rejected = await openSse(server.baseUrl, `/v1/test-realtime/${randomUUID()}`);
    await rejected.ended;
    expect(rejected.status).toBe(503);
    expect(ErrorResponse.parse(JSON.parse(rejected.text())).error.code).toBe('SERVICE_UNAVAILABLE');
    // Không `closeAllConnections`: còn stream SSE nào mở thì server treo ở đây.
    await server.close({ force: false });
    expect(Date.now() - started).toBeLessThan(5_000);
    await own.db.close();
  });
});
