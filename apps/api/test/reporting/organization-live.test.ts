import { randomUUID } from 'node:crypto';
import { ErrorResponse, organizationLiveApiPath, RealtimeTopic, Role } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RealtimeHub, realtime } from '../../src/platform/realtime/index.js';
import { signUpPlatformAdmin } from '../admin/platform-admin.js';
import { TEST_WEB_ORIGIN } from '../helpers.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import { resetPaymentService } from '../ordering/order-fixtures.js';
import { listen, openSse, sleep, type SseClient } from '../platform/sse-client.js';

/*
 * Story 4.2-b: stream SSE cấp BTC `GET /v1/orgs/:orgId/live` (`reporting`, `org.read`) trên Postgres thật, server HTTP
 * thật và client SSE thật. Chỉ đẩy `org_status_changed` của đúng BTC (tín hiệu cấp BTC, không có `eventId`); tín hiệu cấp
 * Sự kiện của cùng BTC hay tín hiệu của BTC khác không tới. Owner và Admin mở được; người ngoài → 403, chưa đăng nhập →
 * 401 (JSON, không treo); hub chưa `LISTEN` → 503.
 */

let h: Harness;
let http: Awaited<ReturnType<typeof listen>>;
let owner: Awaited<ReturnType<typeof signUp>>;
let admin: Awaited<ReturnType<typeof signUp>>;
let platformAdmin: Awaited<ReturnType<typeof signUpPlatformAdmin>>;
let orgA: string;
let orgB: string;
const streams: SseClient[] = [];

const createOrg = async (cookie: string, name: string): Promise<string> =>
  (await h.http.post('/v1/orgs').set('cookie', cookie).send({ name }).expect(201)).body.id as string;

beforeAll(async () => {
  h = await createHarness();
  http = await listen(h.app);
  owner = await signUp(h);
  admin = await signUp(h);
  platformAdmin = await signUpPlatformAdmin(h);
  orgA = await createOrg(owner.cookie, 'CLB Cờ Tướng Quận 5');
  orgB = await createOrg((await signUp(h)).cookie, 'CLB Bóng bàn Quận 1');
  await h.db.orm.execute(
    sql`INSERT INTO members (organization_id, user_id, role) VALUES (${orgA}, ${admin.userId}, ${Role.ADMIN})`,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  for (const s of streams) s.close();
  for (const orgId of [orgA, orgB]) await resetPaymentService(h, orgId);
  await http.close();
  await h.close();
});

/** Mở stream như `EventSource(url, { withCredentials: true })` từ web. */
async function live(orgId: string, cookie?: string): Promise<SseClient> {
  const headers: Record<string, string> = { origin: TEST_WEB_ORIGIN, ...(cookie ? { cookie } : {}) };
  const s = await openSse(http.baseUrl, `/v1${organizationLiveApiPath(orgId)}`, headers);
  streams.push(s);
  return s;
}

const statusChanged = (orgId: string) =>
  h.db.transaction((tx) => realtime.notifyOrganization(tx, RealtimeTopic.ORG_STATUS_CHANGED, orgId));

describe('GET /v1/orgs/:orgId/live: quyền', () => {
  it('Owner và Admin → 200 text/event-stream (CORS cho web); người ngoài → 403 NOT_A_MEMBER; chưa đăng nhập → 401; không treo', async () => {
    for (const cookie of [owner.cookie, admin.cookie]) {
      const s = await live(orgA, cookie);
      expect(s.status).toBe(200);
      expect(s.headers['content-type']).toBe('text/event-stream; charset=utf-8');
      expect(s.headers['access-control-allow-origin']).toBe(TEST_WEB_ORIGIN);
      expect(s.isEnded()).toBe(false);
    }

    const stranger = await signUp(h);
    const forbidden = await live(orgA, stranger.cookie);
    await forbidden.ended;
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers['content-type']).toMatch(/^application\/json/);
    expect(ErrorResponse.parse(JSON.parse(forbidden.text())).error.code).toBe('NOT_A_MEMBER');

    // Owner BTC A trên BTC B: cùng 403 (guard), không mở stream.
    const cross = await live(orgB, owner.cookie);
    await cross.ended;
    expect(cross.status).toBe(403);
    expect(ErrorResponse.parse(JSON.parse(cross.text())).error.code).toBe('NOT_A_MEMBER');

    const anonymous = await live(orgA);
    await anonymous.ended;
    expect(anonymous.status).toBe(401);
    expect(ErrorResponse.parse(JSON.parse(anonymous.text())).error.code).toBe('UNAUTHENTICATED');
  });

  it('hub chưa LISTEN → 503 SERVICE_UNAVAILABLE (JSON): web tiếp tục polling', async () => {
    vi.spyOn(h.app.get(RealtimeHub), 'isReady').mockReturnValue(false);
    const s = await live(orgA, owner.cookie);
    await s.ended;
    expect(s.status).toBe(503);
    expect(ErrorResponse.parse(JSON.parse(s.text())).error.code).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('GET /v1/orgs/:orgId/live: chỉ tín hiệu của BTC này', () => {
  it('org_status_changed của BTC A → stream A (Owner, Admin, id HOA trên URL) nhận {type} trong 1 giây; stream B không nhận', async () => {
    const ownerStream = await live(orgA, owner.cookie);
    const adminStream = await live(orgA, admin.cookie);
    const upperStream = await live(orgA.toUpperCase(), owner.cookie);
    const otherOwner = await signUp(h);
    const orgC = await createOrg(otherOwner.cookie, 'CLB Cầu lông Quận 2');
    const streamC = await live(orgC, otherOwner.cookie);
    expect(upperStream.status).toBe(200);

    await statusChanged(orgA);
    for (const s of [ownerStream, adminStream, upperStream]) {
      const [message] = await s.waitForMessages(1, 1_000);
      expect(message!.raw).toBe('{"type":"org_status_changed"}');
    }
    await sleep(300);
    expect(streamC.messages).toEqual([]);

    await statusChanged(orgC);
    expect((await streamC.waitForMessages(1, 1_000))[0]!.raw).toBe('{"type":"org_status_changed"}');
    await sleep(300);
    expect(ownerStream.messages).toHaveLength(1);
  });

  it('tín hiệu cấp Sự kiện của cùng BTC (Đơn, check-in, Cần xử lý) không tới stream cấp BTC', async () => {
    const s = await live(orgA, owner.cookie);
    const eventId = randomUUID();
    await h.db.transaction(async (tx) => {
      const ids = { id: randomUUID(), organizationId: orgA, eventId };
      await realtime.notify(tx, RealtimeTopic.EVENT_ORDERS_CHANGED, ids);
      await realtime.notify(tx, RealtimeTopic.ORDER_CHANGED, ids);
      await realtime.notify(tx, RealtimeTopic.EVENT_CHECKINS_CHANGED, ids);
      await realtime.notify(tx, RealtimeTopic.ORG_REVIEW_ITEMS_CHANGED, ids);
    });
    await sleep(400);
    expect(s.messages).toEqual([]);
  });

  it('đường thật: Quản trị Tingee mở lại dịch vụ thanh toán của BTC A → stream A nhận org_status_changed', async () => {
    await h.db.orm.execute(sql`
      UPDATE organizations
         SET payment_service_status = 'suspended', payment_service_reason = 'tingee_disabled',
             payment_service_since = now()
       WHERE id = ${orgA}`);
    const s = await live(orgA, admin.cookie);
    await h.http
      .post(`/v1/admin/organizations/${orgA}/payment-service/resume`)
      .set('cookie', platformAdmin.cookie)
      .expect(204);
    const [message] = await s.waitForMessages(1, 1_000);
    expect(message!.raw).toBe('{"type":"org_status_changed"}');
  });
});
