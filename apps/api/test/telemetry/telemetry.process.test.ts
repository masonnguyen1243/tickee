import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { JobQueue } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TingeeCredential } from '../../src/modules/tingee/index.js';
import { apiConfig, TEST_REVALIDATE_SECRET } from '../helpers.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import { ipnKeyOf, linkPayoutAccount, resetPaymentService } from '../ordering/order-fixtures.js';
import { startOtlpReceiver, type OtlpReceiver, type ReceivedSpan } from '../otlp-receiver.js';
import {
  freePort,
  killProcess,
  logLines,
  MAIN,
  runProcess,
  startProcess,
  stopProcess,
  waitFor,
  waitForOutput,
  type Proc,
} from '../process.js';
import { ACCOUNTS_PATH, fakeAccount, startTingeeFake, type TingeeFake } from '../tingee-fake/server.js';

/*
 * Story 4.6-a, process test: `dist/main.js` thật cho vai api và worker, xuất OTLP/HTTP (JSON) tới receiver giả. Một
 * request BTC ("Kiểm tra lại" dịch vụ thanh toán) đi trọn đường: span server có route mẫu → Tingee (`tingee get_va_paging`,
 * undici) → pg → enqueue job `payment.service-resumed` cùng `tx` → worker (khởi sau) xử lý job trong span `process <queue>`
 * cùng trace. Thêm các request mang secret (link chia sẻ, callback Google, IPN) để kiểm bộ lọc; rồi các dòng của I/O
 * Matrix: tắt, endpoint sai, collector không nghe, collector treo.
 */

/** Kind của span trong OTLP (enum của proto): 1 internal, 2 server, 3 client, 4 producer, 5 consumer. */
const KIND = { INTERNAL: 1, SERVER: 2, CLIENT: 3, PRODUCER: 4, CONSUMER: 5 } as const;

const hex = () => randomUUID().replaceAll('-', '');
const SECRET = `s3cret-otel-${hex()}`;
const OTLP_AUTH = `Bearer otlp-${hex()}`;
const SHARED_TOKEN = `shr${hex()}${hex()}`;
const QUERY_SECRET = `qry${hex()}`;
const OAUTH_CODE = `code${hex()}`;
const OAUTH_STATE = `state${hex()}`;
const IPN_SIGNATURE = `sig${hex()}`;
const MAIN_CREDENTIAL: TingeeCredential = { clientId: `tg-otel-${hex()}`, secretToken: `tg-otel-secret-${hex()}` };
const account = fakeAccount();
const RESUMED_QUEUE = JobQueue.PAYMENT_SERVICE_RESUMED;

/** Env tối thiểu của vai api (không kế thừa env của tiến trình test). */
function apiEnv(port: number, tingeeBaseUrl = 'http://127.0.0.1:1'): Record<string, string> {
  const c = apiConfig();
  return {
    APP_ROLE: 'api',
    PORT: String(port),
    DATABASE_URL: c.DATABASE_URL,
    BETTER_AUTH_SECRET: c.BETTER_AUTH_SECRET,
    API_PUBLIC_URL: c.API_PUBLIC_URL,
    WEB_ORIGIN: c.WEB_ORIGIN,
    SMTP_URL: c.SMTP_URL,
    EMAIL_FROM: c.EMAIL_FROM,
    GOOGLE_CLIENT_ID: c.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: c.GOOGLE_CLIENT_SECRET,
    TINGEE_BASE_URL: tingeeBaseUrl,
    TINGEE_CREDENTIAL_KEYS: c.TINGEE_CREDENTIAL_KEYS,
    TICKET_QR_KEYS: c.TICKET_QR_KEYS,
    // Ảnh Sự kiện (Story 4.8-a): bắt buộc ở vai api.
    S3_ENDPOINT: c.S3_ENDPOINT,
    S3_BUCKET: c.S3_BUCKET,
    S3_ACCESS_KEY_ID: c.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: c.S3_SECRET_ACCESS_KEY,
    S3_FORCE_PATH_STYLE: String(c.S3_FORCE_PATH_STYLE),
    S3_PUBLIC_BASE_URL: c.S3_PUBLIC_BASE_URL,
  };
}

function workerEnv(tingeeBaseUrl = 'http://127.0.0.1:1'): Record<string, string> {
  const c = apiConfig();
  return {
    APP_ROLE: 'worker',
    DATABASE_URL: c.DATABASE_URL,
    WEB_ORIGIN: c.WEB_ORIGIN,
    SMTP_URL: c.SMTP_URL,
    EMAIL_FROM: c.EMAIL_FROM,
    REVALIDATE_SECRET: TEST_REVALIDATE_SECRET,
    TINGEE_BASE_URL: tingeeBaseUrl,
    TINGEE_CREDENTIAL_KEYS: c.TINGEE_CREDENTIAL_KEYS,
    TICKET_QR_KEYS: c.TICKET_QR_KEYS,
  };
}

const otelEnv = (endpoint: string): Record<string, string> => ({
  OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
  OTEL_EXPORTER_OTLP_HEADERS: `authorization=${encodeURIComponent(OTLP_AUTH)}`,
  OTEL_METRIC_EXPORT_INTERVAL: '1000',
});

beforeAll(() => {
  if (!existsSync(MAIN)) throw new Error(`Thiếu ${MAIN}: chạy build trước (pnpm turbo test tự làm)`);
});

describe('OpenTelemetry bật: api và worker xuất trace + metrics (tiến trình thật)', () => {
  let receiver: OtlpReceiver;
  let fake: TingeeFake;
  let h: Harness;
  let api: Proc | undefined;
  let worker: Proc | undefined;
  let orgId: string;
  let ipnKey: string;
  let ownerCookie: string;
  let ownerEmail: string;
  const checkRequestId = `req-otel-check-${hex()}`;
  const statuses: Record<string, number> = {};
  let apiExit: number | null;
  let workerExit: number | null;

  beforeAll(async () => {
    receiver = await startOtlpReceiver();
    fake = await startTingeeFake({ merchants: [{ ...MAIN_CREDENTIAL, accounts: [account] }] });
    // Dựng dữ liệu bằng app trong tiến trình test (cùng DB, cùng khóa): Owner, BTC có key Tingee, cờ dịch vụ `suspended`.
    h = await createHarness({ TINGEE_BASE_URL: fake.url });
    const owner = await signUp(h);
    ownerCookie = owner.cookie;
    ownerEmail = owner.email;
    orgId = (await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: 'CLB Quan sát' }).expect(201)).body
      .id as string;
    await linkPayoutAccount({ h, owner, orgId }, MAIN_CREDENTIAL, {
      vaAccountNumber: String(account.vaAccountNumber),
      accountName: String(account.accountName),
      bankName: String(account.bankName),
    });
    ipnKey = await ipnKeyOf(h, orgId);
    await h.db.orm.execute(sql`
      UPDATE organizations
         SET payment_service_status = 'suspended', payment_service_reason = 'token', payment_service_since = now()
       WHERE id = ${orgId}`);
    // Job "đã mở lại" còn chờ của file khác: worker lấy chung một lô thì span `process` mở trace riêng (kèm link).
    await h.db.pool.query(`DELETE FROM pgboss.job WHERE name = $1 AND state IN ('created', 'retry')`, [RESUMED_QUEUE]);

    const port = await freePort();
    api = startProcess({ ...apiEnv(port, fake.url), ...otelEnv(receiver.url) });
    await waitForOutput(api, `api đang nghe cổng ${port}`);
    const base = `http://127.0.0.1:${port}`;
    const call = async (name: string, path: string, init: RequestInit = {}) => {
      const res = await fetch(`${base}${path}`, { redirect: 'manual', ...init });
      statuses[name] = res.status;
      return res;
    };

    const check = await call('check', `/v1/orgs/${orgId}/payment-service/check`, {
      method: 'POST',
      headers: { cookie: owner.cookie, 'x-request-id': checkRequestId },
    });
    expect(check.status, await check.clone().text()).toBe(200);
    expect(((await check.json()) as { outcome: string }).outcome).toBe('resumed');
    // Bị guard từ chối trên route đã khớp: chưa qua interceptor, `ErrorFilter` vẫn đặt route mẫu.
    await call('checkNoSession', `/v1/orgs/${orgId}/payment-service/check`, { method: 'POST' });
    await call('checkNotMember', `/v1/orgs/${orgId}/payment-service/check`, {
      method: 'POST',
      headers: { cookie: (await signUp(h)).cookie },
    });
    await call('shared', `/v1/shared-tickets/${SHARED_TOKEN}?a=${QUERY_SECRET}`);
    await call('google', `/v1/auth/callback/google?code=${OAUTH_CODE}&state=${OAUTH_STATE}`);
    await call('ipn', `/v1/payments/tingee/ipn/${ipnKey}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-client-id': MAIN_CREDENTIAL.clientId,
        'x-request-timestamp': '20261117090000000',
        'x-signature': IPN_SIGNATURE,
      },
      body: JSON.stringify({ orderId: 'TKOTELTEST1', amount: 300_000 }),
    });
    await call('healthz', '/healthz');
    await call('notFound', '/v1/khong-co');
    // SIGTERM: span còn trong hàng đợi của BatchSpanProcessor được flush trước khi thoát.
    apiExit = await stopProcess(api);

    // Worker khởi sau khi request đã enqueue: job mang context của trace lúc enqueue.
    worker = startProcess({ ...workerEnv(fake.url), ...otelEnv(receiver.url) });
    await waitForOutput(worker, 'worker đã chạy');
    await waitFor(
      () => logLines(worker!).some((l) => l.queue === RESUMED_QUEUE && l.organizationId === orgId),
      `worker xử lý job ${RESUMED_QUEUE} của BTC:\n${worker.output()}`,
    );
    // Gauge `pgboss.queue.jobs` chỉ có ở lần xuất định kỳ (pg-boss gỡ callback khi dừng, trước lần xuất cuối).
    await waitFor(
      () => receiver.dataPoints().some((d) => d.service === 'tickee-worker' && d.metric === 'pgboss.queue.jobs'),
      'worker xuất metrics định kỳ (pgboss.queue.jobs)',
    );
    workerExit = await stopProcess(worker);
  }, 120_000);

  afterAll(async () => {
    killProcess(api);
    killProcess(worker);
    if (orgId) await resetPaymentService(h, orgId);
    await h?.close();
    await fake?.close();
    await receiver?.close();
  });

  const spansOf = (service: string) => receiver.spans().filter((s) => s.service === service);
  const serverSpan = (name: string) => spansOf('tickee-api').find((s) => s.kind === KIND.SERVER && s.name === name);
  const serverSpanByPath = (path: string) =>
    spansOf('tickee-api').find((s) => s.kind === KIND.SERVER && s.attributes['url.path'] === path);
  /** `span` nằm dưới `ancestor` (theo chuỗi parent trong cùng trace). */
  function isDescendant(span: ReceivedSpan, ancestor: ReceivedSpan): boolean {
    const byId = new Map(receiver.spans().map((s) => [s.spanId, s]));
    let parent = span.parentSpanId;
    for (let depth = 0; parent && depth < 50; depth++) {
      if (parent === ancestor.spanId) return true;
      parent = byId.get(parent)?.parentSpanId;
    }
    return false;
  }

  it('api và worker thoát 0 sau SIGTERM; cả hai xuất trace lẫn metrics, kèm header OTLP, service.name đúng vai', () => {
    expect(apiExit, api?.output()).toBe(0);
    expect(workerExit, worker?.output()).toBe(0);
    expect(worker?.output()).toContain('pg-boss đã dừng');
    expect(statuses.check).toBe(200);
    for (const service of ['tickee-api', 'tickee-worker']) {
      expect(spansOf(service).length, service).toBeGreaterThan(0);
      expect(receiver.dataPoints().some((d) => d.service === service), service).toBe(true);
    }
    expect(new Set(receiver.spans().map((s) => s.service))).toEqual(new Set(['tickee-api', 'tickee-worker']));
    expect(receiver.requests.length).toBeGreaterThan(0);
    for (const request of receiver.requests) {
      expect(['/v1/traces', '/v1/metrics']).toContain(request.path);
      expect(request.headers.authorization).toBe(OTLP_AUTH);
      expect(request.headers['content-type']).toContain('application/json');
    }
    // Không gửi log qua OTLP.
    expect(receiver.requests.some((r) => r.path === '/v1/logs')).toBe(false);
    expect(api?.output()).toContain('OpenTelemetry đã bật');
  });

  it('request bị guard từ chối (401, 403) trên route đã khớp vẫn mang route mẫu, cả span lẫn metric', () => {
    const route = '/v1/orgs/:orgId/payment-service/check';
    expect([statuses.checkNoSession, statuses.checkNotMember]).toEqual([401, 403]);
    for (const status of [401, 403]) {
      const span = spansOf('tickee-api').find(
        (s) => s.kind === KIND.SERVER && s.attributes['http.response.status_code'] === status && s.attributes['url.path'] === `/v1/orgs/${orgId}/payment-service/check`,
      );
      expect(span?.name, String(status)).toBe(`POST ${route}`);
      expect(span?.attributes['http.route']).toBe(route);
    }
    const statusesOfRoute = receiver
      .dataPoints()
      .filter((d) => d.service === 'tickee-api' && d.metric === 'http.server.request.duration' && d.attributes['http.route'] === route)
      .map((d) => d.attributes['http.response.status_code']);
    expect(statusesOfRoute).toEqual(expect.arrayContaining([200, 401, 403]));
  });

  it('span server mang route mẫu; Better Auth và 404 chỉ mang method; /healthz không có span', () => {
    const check = serverSpan('POST /v1/orgs/:orgId/payment-service/check');
    expect(check?.attributes).toMatchObject({
      'http.route': '/v1/orgs/:orgId/payment-service/check',
      'http.request.method': 'POST',
      'http.response.status_code': 200,
    });
    expect(serverSpan('GET /v1/shared-tickets/:token')?.attributes).toMatchObject({
      'http.route': '/v1/shared-tickets/:token',
      'url.path': '/v1/shared-tickets/[REDACTED]',
    });
    expect(serverSpan('POST /v1/payments/tingee/ipn/:ipnKey')?.attributes).toMatchObject({
      'http.route': '/v1/payments/tingee/ipn/:ipnKey',
      'url.path': '/v1/payments/tingee/ipn/[REDACTED]',
    });
    const google = serverSpanByPath('/v1/auth/[REDACTED]');
    expect(google?.name).toBe('GET');
    expect(google?.attributes).not.toHaveProperty('http.route');
    const notFound = serverSpanByPath('/v1/khong-co');
    expect(statuses.notFound).toBe(404);
    expect(notFound?.name).toBe('GET');
    expect(notFound?.attributes).not.toHaveProperty('http.route');
    expect(statuses.healthz).toBe(200);
    expect(receiver.spans().some((s) => String(s.attributes['url.path']).includes('healthz'))).toBe(false);

    const httpRoutes = receiver
      .dataPoints()
      .filter((d) => d.service === 'tickee-api' && d.metric === 'http.server.request.duration')
      .map((d) => d.attributes['http.route']);
    expect(httpRoutes).toEqual(
      expect.arrayContaining(['/v1/orgs/:orgId/payment-service/check', '/v1/shared-tickets/:token', '/v1/payments/tingee/ipn/:ipnKey']),
    );
  });

  it('Tingee: span `tingee get_va_paging` là con của span request, có span undici con; histogram theo operation và outcome', () => {
    const check = serverSpan('POST /v1/orgs/:orgId/payment-service/check')!;
    const tingee = spansOf('tickee-api').find((s) => s.name === 'tingee get_va_paging');
    expect(tingee).toBeDefined();
    expect(tingee!.traceId).toBe(check.traceId);
    expect(isDescendant(tingee!, check)).toBe(true);
    expect(tingee!.attributes).toEqual({ 'tingee.operation': 'get_va_paging', outcome: 'ok' });
    const fetchSpan = spansOf('tickee-api').find((s) => s.kind === KIND.CLIENT && s.parentSpanId === tingee!.spanId);
    expect(fetchSpan?.attributes['url.full']).toBe(`${fake.url}${ACCOUNTS_PATH}`);
    expect(fake.calls(ACCOUNTS_PATH)).toHaveLength(1);

    const points = receiver
      .dataPoints()
      .filter((d) => d.service === 'tickee-api' && d.metric === 'tickee.tingee.request.duration');
    expect(points.map((d) => d.attributes)).toContainEqual({ 'tingee.operation': 'get_va_paging', outcome: 'ok' });
  });

  it('pg và pg-boss: query trong trace của request; enqueue cùng trace; worker xử lý job trong `process <queue>` cùng trace; metrics pg-boss có mặt', () => {
    const check = serverSpan('POST /v1/orgs/:orgId/payment-service/check')!;
    const inTrace = spansOf('tickee-api').filter((s) => s.traceId === check.traceId);
    expect(inTrace.some((s) => s.attributes['db.system.name'] === 'postgresql')).toBe(true);
    const send = inTrace.find((s) => s.kind === KIND.PRODUCER && s.name === `send ${RESUMED_QUEUE}`);
    expect(send).toBeDefined();
    const processed = spansOf('tickee-worker').find((s) => s.kind === KIND.CONSUMER && s.name === `process ${RESUMED_QUEUE}`);
    expect(processed?.traceId).toBe(check.traceId);
    expect(processed?.parentSpanId).toBe(send!.spanId);

    const metricsOf = (service: string) =>
      new Set(receiver.dataPoints().filter((d) => d.service === service).map((d) => d.metric));
    expect([...metricsOf('tickee-api')]).toEqual(expect.arrayContaining(['messaging.client.sent.messages']));
    // `pgboss.queue.jobs`: gauge theo queue và trạng thái (gồm `failed`), 4.6-b đọc để cảnh báo ùn và dead-letter.
    expect([...metricsOf('tickee-worker')]).toEqual(
      expect.arrayContaining(['messaging.process.duration', 'pgboss.queue.jobs']),
    );
    const states = new Set(
      receiver
        .dataPoints()
        .filter((d) => d.metric === 'pgboss.queue.jobs' && d.attributes['messaging.destination.name'] === RESUMED_QUEUE)
        .map((d) => d.attributes['pgboss.job.state']),
    );
    expect([...states]).toEqual(expect.arrayContaining(['ready', 'active', 'failed']));
    const processPoints = receiver
      .dataPoints()
      .filter((d) => d.metric === 'messaging.process.duration' && d.attributes['messaging.destination.name'] === RESUMED_QUEUE);
    expect(processPoints.length).toBeGreaterThan(0);
  });

  it('log: request BTC mang requestId, organizationId và traceId; log trong job mang queue, jobId, id của payload và traceId', () => {
    const check = serverSpan('POST /v1/orgs/:orgId/payment-service/check')!;
    const requestLines = logLines(api!).filter((l) => l.requestId === checkRequestId);
    expect(requestLines.length).toBeGreaterThan(0);
    const completed = requestLines.find((l) => 'res' in l);
    expect(completed).toMatchObject({ organizationId: orgId, traceId: check.traceId });
    expect(completed?.spanId).toEqual(expect.stringMatching(/^[0-9a-f]{16}$/));

    const jobLine = logLines(worker!).find((l) => l.queue === RESUMED_QUEUE && l.organizationId === orgId);
    expect(jobLine).toMatchObject({ jobId: expect.any(String), traceId: check.traceId });
  });

  it('không payload nào chứa secret đã gieo; không thuộc tính query, header, IP hay User-Agent', () => {
    const payloads = receiver.requests.map((r) => r.body).join('\n');
    const sessionToken = ownerCookie.split('=').slice(1).join('=');
    const seeded = {
      SHARED_TOKEN,
      QUERY_SECRET,
      OAUTH_CODE,
      OAUTH_STATE,
      ipnKey,
      IPN_SIGNATURE,
      sessionToken,
      sessionTokenId: sessionToken.split('.')[0]!,
      ownerEmail,
      tingeeSecret: MAIN_CREDENTIAL.secretToken,
      tingeeClientId: MAIN_CREDENTIAL.clientId,
      OTLP_AUTH,
      betterAuthSecret: apiConfig().BETTER_AUTH_SECRET,
      databasePassword: new URL(apiConfig().DATABASE_URL).password,
      googleClientSecret: apiConfig().GOOGLE_CLIENT_SECRET,
      revalidateSecret: TEST_REVALIDATE_SECRET,
      credentialKey: apiConfig().TINGEE_CREDENTIAL_KEYS.split(':')[1]!,
      ticketQrKey: apiConfig().TICKET_QR_KEYS.split(':')[1]!,
      va: String(account.vaAccountNumber),
    };
    for (const [name, value] of Object.entries(seeded)) expect(payloads.includes(value), name).toBe(false);
    const keys = new Set(receiver.spans().flatMap((s) => Object.keys(s.attributes)));
    for (const key of keys) {
      expect(key).not.toMatch(/^http\.(request|response)\.header\./);
      expect(['url.query', 'user_agent.original', 'client.address', 'network.peer.address']).not.toContain(key);
    }
  });
});

describe('OpenTelemetry: các dòng còn lại của I/O Matrix (tiến trình thật)', () => {
  it('tắt (không OTEL_*): không SDK, log không có traceId', async () => {
    const port = await freePort();
    const p = startProcess(apiEnv(port));
    try {
      await waitForOutput(p, `api đang nghe cổng ${port}`);
      const requestId = `req-otel-off-${hex()}`;
      expect((await fetch(`http://127.0.0.1:${port}/v1/khong-co`, { headers: { 'x-request-id': requestId } })).status).toBe(404);
      expect(await stopProcess(p), p.output()).toBe(0);
      const lines = logLines(p).filter((l) => l.requestId === requestId);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of logLines(p)) {
        expect(line).not.toHaveProperty('traceId');
        expect(line).not.toHaveProperty('spanId');
      }
      expect(p.output()).not.toContain('OpenTelemetry');
    } finally {
      killProcess(p);
    }
  });

  it.each([
    ['api: endpoint không phải URL', 'api', { OTEL_EXPORTER_OTLP_ENDPOINT: `khong-phai-url-${SECRET}` }, 'OTEL_EXPORTER_OTLP_ENDPOINT'],
    ['worker: endpoint ftp://', 'worker', { OTEL_EXPORTER_OTLP_ENDPOINT: `ftp://${SECRET}.vn` }, 'OTEL_EXPORTER_OTLP_ENDPOINT'],
    ['api: header sai dạng', 'api', { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318', OTEL_EXPORTER_OTLP_HEADERS: SECRET }, 'OTEL_EXPORTER_OTLP_HEADERS'],
    ['worker: chu kỳ metrics âm', 'worker', { OTEL_METRIC_EXPORT_INTERVAL: '-987654321' }, 'OTEL_METRIC_EXPORT_INTERVAL'],
  ] as const)('%s → exit 1, nêu tên biến, không in giá trị', async (_name, role, env, variable) => {
    const base = role === 'api' ? apiEnv(1) : workerEnv();
    const { code, output } = await runProcess({ ...base, ...env });
    expect(code).toBe(1);
    expect(output).toContain(variable);
    expect(output).not.toContain(SECRET);
    for (const value of Object.values(env)) expect(output).not.toContain(value);
  });

  it('collector không nghe: api phục vụ bình thường, lỗi xuất chỉ log warn, SIGTERM vẫn thoát 0', async () => {
    const port = await freePort();
    const deadCollector = `http://127.0.0.1:${await freePort()}`;
    const p = startProcess({ ...apiEnv(port), ...otelEnv(deadCollector) });
    try {
      await waitForOutput(p, `api đang nghe cổng ${port}`);
      expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
      expect((await fetch(`http://127.0.0.1:${port}/v1/khong-co`)).status).toBe(404);
      await waitFor(
        () => logLines(p).some((l) => l.level === 40 && l.msg === 'OpenTelemetry: không xuất được dữ liệu'),
        'warn lỗi xuất (metrics xuất mỗi giây)',
      );
      expect(await stopProcess(p), p.output()).toBe(0);
      const warn = logLines(p).find((l) => l.msg === 'OpenTelemetry: không xuất được dữ liệu');
      expect(warn).toMatchObject({ level: 40, err: { type: expect.any(String) } });
      expect(p.output()).not.toContain(OTLP_AUTH);
      expect(logLines(p).some((l) => (l.level as number) >= 50)).toBe(false);
    } finally {
      killProcess(p);
    }
  });

  it('collector treo: SIGTERM chờ xuất tối đa 5 giây rồi thoát 0 như cũ', async () => {
    const hanging = await startOtlpReceiver();
    hanging.mode = 'hang';
    const port = await freePort();
    // Chu kỳ metrics dài: chỉ lần xuất lúc tắt chạm vào collector treo.
    const p = startProcess({ ...apiEnv(port), ...otelEnv(hanging.url), OTEL_METRIC_EXPORT_INTERVAL: '600000' });
    try {
      await waitForOutput(p, `api đang nghe cổng ${port}`);
      expect((await fetch(`http://127.0.0.1:${port}/v1/khong-co`)).status).toBe(404);
      const startedAt = Date.now();
      expect(await stopProcess(p), p.output()).toBe(0);
      const elapsed = Date.now() - startedAt;
      expect(elapsed).toBeLessThan(9_000);
      expect(logLines(p).some((l) => l.level === 40 && String(l.msg).includes('quá hạn'))).toBe(true);
    } finally {
      killProcess(p);
      await hanging.close();
    }
  });
});
