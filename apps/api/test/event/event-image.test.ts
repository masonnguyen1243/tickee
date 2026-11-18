import { randomUUID } from 'node:crypto';
import {
  EVENT_IMAGE_MAX_BYTES,
  EventDetail,
  EventImageUpload,
  EventList,
  ErrorResponse,
  JobQueue,
  PublicEvent,
  Role,
  type EventImageType,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PublicPageQueues } from '../../src/modules/event/index.js';
import { EventChangeEmailQueues } from '../../src/modules/ordering/index.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import { TEST_S3_BUCKET, TEST_S3_ENDPOINT, TEST_S3_PUBLIC_BASE_URL } from '../helpers.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import {
  EVENT_DRAFT,
  eventOnSale,
  orderBody,
  postOrder,
  resetOrderRateLimit,
  type Org,
  type User,
} from '../ordering/order-fixtures.js';

/*
 * Story 4.8-a: ảnh Sự kiện trên object storage tương thích S3. `POST /v1/orgs/:orgId/event-images` cấp presigned PUT
 * theo BTC (key `orgs/{orgId}/events/{uuid}.{ext}`, URL ký `content-type` và `content-length`, hạn 5 phút); tạo/sửa Sự
 * kiện nhận `imageKey` đúng tiền tố BTC; detail, danh sách và trang công khai trả `imageUrl` = `S3_PUBLIC_BASE_URL/{key}`.
 * Endpoint S3 của test (`storage.tickee.test`) không bao giờ phân giải: api không gọi mạng tới storage.
 */

let h: Harness;
let boss: PgBoss;
let org: Org;
let admin: User;
let ownerB: User;
let orgB: string;

beforeAll(async () => {
  h = await createHarness();
  boss = h.app.get<PgBoss>(BOSS);
  await Promise.all([h.app.get(PublicPageQueues).ready(), h.app.get(EventChangeEmailQueues).ready()]);
  const owner = await signUp(h);
  const orgId = (await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: 'CLB Chạy Bộ' }).expect(201))
    .body.id as string;
  org = { h, owner, orgId };
  admin = await signUp(h);
  await h.db.orm.execute(
    sql`INSERT INTO members (organization_id, user_id, role) VALUES (${orgId}, ${admin.userId}, ${Role.ADMIN})`,
  );
  ownerB = await signUp(h);
  orgB = (await h.http.post('/v1/orgs').set('cookie', ownerB.cookie).send({ name: 'BTC B' }).expect(201)).body
    .id as string;
});
beforeEach(async () => {
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  await h.close();
});

const presign = (body: unknown, cookie = admin.cookie, orgId = org.orgId) =>
  h.http
    .post(`/v1/orgs/${orgId}/event-images`)
    .set('cookie', cookie)
    .send(body as object);

/** Presign hợp lệ → key do api cấp cho BTC. */
async function uploadKey(contentType: EventImageType = 'image/webp', cookie = admin.cookie): Promise<string> {
  return EventImageUpload.parse((await presign({ contentType, contentLength: 1_234 }, cookie).expect(200)).body).key;
}

const eventsUrl = (eventId = '') => `/v1/orgs/${org.orgId}/events${eventId ? `/${eventId}` : ''}`;
const createEvent = (body: Record<string, unknown>) =>
  h.http
    .post(eventsUrl())
    .set('cookie', admin.cookie)
    .send({ ...EVENT_DRAFT, ...body });

/** Body đầy đủ của `PATCH` từ Sự kiện hiện tại (gồm cả `imageKey`, như web 4.8-b), thay các trường trong `changes`. */
const bodyOf = (event: EventDetail, changes: Record<string, unknown> = {}) => ({
  name: event.name,
  startsAt: event.startsAt,
  endsAt: event.endsAt,
  venue: event.venue,
  description: event.description,
  refundPolicy: event.refundPolicy,
  imageKey: event.imageKey,
  ...changes,
});
const patchEvent = (eventId: string, body: unknown) =>
  h.http
    .patch(eventsUrl(eventId))
    .set('cookie', admin.cookie)
    .send(body as object);

async function fetchEvent(eventId: string): Promise<EventDetail> {
  return EventDetail.parse((await h.http.get(eventsUrl(eventId)).set('cookie', admin.cookie).expect(200)).body);
}

async function imageKeyColumn(eventId: string): Promise<string | null> {
  const { rows } = await h.db.pool.query<{ image_key: string | null }>('SELECT image_key FROM events WHERE id = $1', [
    eventId,
  ]);
  return rows[0]!.image_key;
}

/** Audit của một Sự kiện (cả dòng, để kiểm không có giá trị nào của key lọt vào). */
async function audits(eventId: string) {
  const { rows } = await h.db.pool.query<{ action: string; changed_fields: string[] }>(
    `SELECT action, changed_fields FROM audit_events WHERE target_type = 'event' AND target_id = $1 ORDER BY id`,
    [eventId],
  );
  return rows;
}

async function orgAuditCount(orgId: string): Promise<number> {
  const { rows } = await h.db.pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM audit_events WHERE organization_id = $1',
    [orgId],
  );
  return rows[0]!.n;
}

const revalidateJobs = async (slug: string) =>
  (await boss.findJobs<{ slug: string }>(JobQueue.EVENT_REVALIDATE_PUBLIC_PAGE, { data: { slug } })).length;
const eventChangeEmailJobs = async (eventId: string) =>
  (await boss.findJobs(JobQueue.ORDERING_SEND_EVENT_CHANGE_EMAIL, { data: { eventId } })).length;

const issuesOf = (body: unknown) =>
  (ErrorResponse.parse(body).error.details as { issues: { path: string; code: string }[] }).issues;

const imageUrlOf = (key: string) => `${TEST_S3_PUBLIC_BASE_URL}/${key}`;

describe('POST /v1/orgs/:orgId/event-images (presign)', () => {
  const keyPattern = (ext: string) =>
    new RegExp(`^orgs/${org.orgId}/events/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.${ext}$`);

  it('Owner và Admin: 200 {key, uploadUrl, expiresAt}; key của BTC theo loại; URL ký content-type, content-length, hạn 5 phút', async () => {
    const auditsBefore = await orgAuditCount(org.orgId);
    const cases: [User, EventImageType, number, string][] = [
      [admin, 'image/webp', 1, 'webp'],
      [org.owner, 'image/jpeg', EVENT_IMAGE_MAX_BYTES, 'jpg'],
      [admin, 'image/png', 204_800, 'png'],
    ];
    for (const [user, contentType, contentLength, ext] of cases) {
      const before = Math.floor(Date.now() / 1000) * 1000;
      const res = await presign({ contentType, contentLength }, user.cookie).expect(200);
      const after = Date.now();
      expect(Object.keys(res.body).sort()).toEqual(['expiresAt', 'key', 'uploadUrl']);
      const upload = EventImageUpload.parse(res.body);
      expect(upload.key).toMatch(keyPattern(ext));

      // URL PUT path-style lên đúng bucket và key; SigV4 trong query string.
      const url = new URL(upload.uploadUrl);
      expect(url.origin).toBe(TEST_S3_ENDPOINT);
      expect(url.pathname).toBe(`/${TEST_S3_BUCKET}/${upload.key}`);
      const query = url.searchParams;
      expect(query.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
      expect(query.get('X-Amz-Credential')).toMatch(/^test-only-access-key\/\d{8}\/us-east-1\/s3\/aws4_request$/);
      // `content-type` và `content-length` nằm trong chữ ký: PUT khác loại hoặc khác số byte thì storage từ chối.
      expect(query.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
      expect(query.get('X-Amz-Expires')).toBe('300');
      expect(query.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
      // Không checksum nào của body rỗng lọt vào URL (`requestChecksumCalculation: 'WHEN_REQUIRED'`).
      expect([...query.keys()].filter((k) => /checksum/i.test(k))).toEqual([]);
      expect(upload.uploadUrl).not.toContain('test-only-secret-access-key');

      // `expiresAt` = mốc ký (`X-Amz-Date`) + 5 phút.
      const signedAt = Date.parse(
        query.get('X-Amz-Date')!.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'),
      );
      expect(Date.parse(upload.expiresAt)).toBe(signedAt + 300_000);
      expect(signedAt).toBeGreaterThanOrEqual(before);
      expect(signedAt).toBeLessThanOrEqual(after);
    }
    // Mỗi lần một key mới; chưa đổi dữ liệu nên không audit.
    expect(await uploadKey()).not.toBe(await uploadKey());
    expect(await orgAuditCount(org.orgId)).toBe(auditsBefore);
  });

  it('loại khác 3 loại, contentLength 0 hoặc > 5 MB, sai kiểu, body {} → 400 VALIDATION_FAILED tại trường', async () => {
    const cases: [unknown, string[]][] = [
      [{ contentType: 'image/gif', contentLength: 100 }, ['contentType']],
      [{ contentType: 'image/svg+xml', contentLength: 100 }, ['contentType']],
      [{ contentType: 'IMAGE/WEBP', contentLength: 100 }, ['contentType']],
      [{ contentType: 'image/webp', contentLength: 0 }, ['contentLength']],
      [{ contentType: 'image/webp', contentLength: -1 }, ['contentLength']],
      [{ contentType: 'image/webp', contentLength: EVENT_IMAGE_MAX_BYTES + 1 }, ['contentLength']],
      [{ contentType: 'image/webp', contentLength: 10.5 }, ['contentLength']],
      [{ contentType: 'image/webp', contentLength: '100' }, ['contentLength']],
      [{}, ['contentType', 'contentLength']],
    ];
    for (const [body, paths] of cases) {
      const res = await presign(body).expect(400);
      expect(ErrorResponse.parse(res.body).error.code, JSON.stringify(body)).toBe('VALIDATION_FAILED');
      expect(
        issuesOf(res.body).map((i) => i.path),
        JSON.stringify(body),
      ).toEqual(paths);
    }
  });

  it('ngoài quyền: Owner BTC khác, người không phải thành viên (CTV) → 403 NOT_A_MEMBER; chưa đăng nhập → 401', async () => {
    const body = { contentType: 'image/webp', contentLength: 100 };
    const outsider = await signUp(h);
    for (const cookie of [ownerB.cookie, outsider.cookie]) {
      const res = await presign(body, cookie).expect(403);
      expect(ErrorResponse.parse(res.body).error.code).toBe('NOT_A_MEMBER');
    }
    await h.http.post(`/v1/orgs/${org.orgId}/event-images`).send(body).expect(401);
    // Owner BTC B xin trên BTC B thì nhận key của BTC B.
    const theirs = EventImageUpload.parse((await presign(body, ownerB.cookie, orgB).expect(200)).body);
    expect(theirs.key.startsWith(`orgs/${orgB}/events/`)).toBe(true);
  });
});

describe('lưu Sự kiện có ảnh', () => {
  it('POST với imageKey của BTC → lưu; detail, danh sách và trang công khai trả imageUrl = S3_PUBLIC_BASE_URL/{key}', async () => {
    const key = await uploadKey('image/jpeg');
    const created = EventDetail.parse((await createEvent({ imageKey: key }).expect(201)).body);
    expect(created).toMatchObject({ imageKey: key, imageUrl: imageUrlOf(key) });
    expect(await imageKeyColumn(created.id)).toBe(key);
    expect(await fetchEvent(created.id)).toMatchObject({ imageKey: key, imageUrl: imageUrlOf(key) });
    expect(await audits(created.id)).toEqual([{ action: 'event.created', changed_fields: [] }]);

    const list = EventList.parse((await h.http.get(eventsUrl()).set('cookie', admin.cookie).expect(200)).body);
    const item = list.find((e) => e.id === created.id);
    expect(item?.imageUrl).toBe(imageUrlOf(key));
    // Danh sách chỉ có URL công khai, không lộ key.
    expect(item).not.toHaveProperty('imageKey');

    // Trang công khai (sau khi mở bán).
    await h.http
      .post(`${eventsUrl(created.id)}/ticket-types`)
      .set('cookie', admin.cookie)
      .send({ name: 'Miễn phí', price: 0, capacity: 10 })
      .expect(201);
    await h.http
      .post(`${eventsUrl(created.id)}/publish`)
      .set('cookie', admin.cookie)
      .expect(200);
    const page = PublicEvent.parse((await h.http.get(`/v1/events/${created.slug}`).expect(200)).body);
    expect(page.imageUrl).toBe(imageUrlOf(key));
    expect(page).not.toHaveProperty('imageKey');
  });

  it('Sự kiện không có ảnh → imageKey và imageUrl null ở detail, danh sách và trang công khai', async () => {
    const created = EventDetail.parse((await createEvent({ name: 'Không ảnh' }).expect(201)).body);
    expect(created).toMatchObject({ imageKey: null, imageUrl: null });
    const list = EventList.parse((await h.http.get(eventsUrl()).set('cookie', admin.cookie).expect(200)).body);
    expect(list.find((e) => e.id === created.id)?.imageUrl).toBeNull();
  });

  it('PATCH đổi ảnh → audit event.updated changedFields [imageKey], không ghi giá trị; gửi lại cùng key → không audit', async () => {
    const first = await uploadKey();
    const event = EventDetail.parse((await createEvent({ imageKey: first }).expect(201)).body);
    const second = await uploadKey('image/png');
    const updated = EventDetail.parse(
      (await patchEvent(event.id, bodyOf(event, { imageKey: second })).expect(200)).body,
    );
    expect(updated).toMatchObject({ imageKey: second, imageUrl: imageUrlOf(second) });
    expect(await imageKeyColumn(event.id)).toBe(second);
    await patchEvent(event.id, bodyOf(updated)).expect(200);
    expect(await audits(event.id)).toEqual([
      { action: 'event.created', changed_fields: [] },
      { action: 'event.updated', changed_fields: ['imageKey'] },
    ]);
    const { rows } = await h.db.pool.query('SELECT * FROM audit_events WHERE target_id = $1', [event.id]);
    expect(JSON.stringify(rows)).not.toContain(first.split('/').at(-1));
    expect(JSON.stringify(rows)).not.toContain(second.split('/').at(-1));
  });

  it.each([
    ['imageKey: null', { imageKey: null }],
    ['bỏ trường imageKey', { imageKey: undefined }],
  ])('gỡ ảnh (%s) → cột null, imageUrl null, audit [imageKey]', async (_label, changes) => {
    const event = EventDetail.parse((await createEvent({ imageKey: await uploadKey() }).expect(201)).body);
    const res = await patchEvent(event.id, bodyOf(event, changes)).expect(200);
    expect(EventDetail.parse(res.body)).toMatchObject({ imageKey: null, imageUrl: null });
    expect(await imageKeyColumn(event.id)).toBeNull();
    expect((await audits(event.id)).at(-1)).toEqual({ action: 'event.updated', changed_fields: ['imageKey'] });
  });

  it('key lạ: tiền tố BTC khác hoặc sai dạng → 400 VALIDATION_FAILED tại imageKey ở POST và PATCH, không ghi gì', async () => {
    const theirs = EventImageUpload.parse(
      (await presign({ contentType: 'image/webp', contentLength: 100 }, ownerB.cookie, orgB).expect(200)).body,
    ).key;
    const image = randomUUID();
    const keys = [
      theirs,
      `orgs/${randomUUID()}/events/${image}.webp`,
      'anh.webp',
      `orgs/${org.orgId}/events/${image}.gif`,
      `orgs/${org.orgId}/events/${image.toUpperCase()}.webp`,
      `orgs/${org.orgId}/events/../${image}.webp`,
      `/orgs/${org.orgId}/events/${image}.webp`,
      `${TEST_S3_PUBLIC_BASE_URL}/orgs/${org.orgId}/events/${image}.webp`,
      '',
    ];
    const own = await uploadKey();
    const event = EventDetail.parse((await createEvent({ imageKey: own }).expect(201)).body);
    const name = `Key lạ ${randomUUID()}`;
    for (const imageKey of keys) {
      const created = await createEvent({ name, imageKey }).expect(400);
      expect(ErrorResponse.parse(created.body).error.code, imageKey).toBe('VALIDATION_FAILED');
      expect(
        issuesOf(created.body).map((i) => i.path),
        imageKey,
      ).toEqual(['imageKey']);
      const patched = await patchEvent(event.id, bodyOf(event, { imageKey })).expect(400);
      expect(
        issuesOf(patched.body).map((i) => i.path),
        imageKey,
      ).toEqual(['imageKey']);
    }
    const { rows } = await h.db.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM events WHERE name = $1', [
      name,
    ]);
    expect(rows[0]!.n).toBe(0);
    expect(await imageKeyColumn(event.id)).toBe(own);
    expect((await audits(event.id)).map((a) => a.action)).toEqual(['event.created']);
  });
});

describe('đổi ảnh Sự kiện đã mở bán', () => {
  it('có Người mua: đổi rồi gỡ ảnh → mỗi lần audit [imageKey] và 1 job revalidate /e/{slug}; không báo Người mua', async () => {
    const sale = await eventOnSale(org, [{ name: 'Vé tham dự', price: 0, capacity: 50 }]);
    const buyer = await signUp(h);
    const order = await postOrder(
      h,
      buyer,
      sale.event.slug,
      orderBody([{ ticketTypeId: sale.tiers[0]!.id, quantity: 1 }]),
    );
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const current = await fetchEvent(sale.event.id);
    let jobs = await revalidateJobs(current.slug);

    const key = await uploadKey();
    const changed = EventDetail.parse(
      (await patchEvent(current.id, bodyOf(current, { imageKey: key })).expect(200)).body,
    );
    expect(changed).toMatchObject({ status: 'published', imageUrl: imageUrlOf(key) });
    expect(await revalidateJobs(current.slug)).toBe(++jobs);
    const page = PublicEvent.parse((await h.http.get(`/v1/events/${current.slug}`).expect(200)).body);
    expect(page.imageUrl).toBe(imageUrlOf(key));

    await patchEvent(current.id, bodyOf(changed, { imageKey: null })).expect(200);
    expect(await revalidateJobs(current.slug)).toBe(++jobs);
    expect((await h.http.get(`/v1/events/${current.slug}`).expect(200)).body.imageUrl).toBeNull();

    expect((await audits(current.id)).slice(-2)).toEqual([
      { action: 'event.updated', changed_fields: ['imageKey'] },
      { action: 'event.updated', changed_fields: ['imageKey'] },
    ]);
    // Ảnh không phải giờ hay địa điểm: không job email báo Người mua (Story 3.10).
    expect(await eventChangeEmailJobs(current.id)).toBe(0);
  });

  it('Sự kiện nháp: đổi ảnh → audit nhưng không revalidate', async () => {
    const event = EventDetail.parse((await createEvent({}).expect(201)).body);
    await patchEvent(event.id, bodyOf(event, { imageKey: await uploadKey() })).expect(200);
    expect(await revalidateJobs(event.slug)).toBe(0);
    expect((await audits(event.id)).at(-1)).toEqual({ action: 'event.updated', changed_fields: ['imageKey'] });
  });

  it('Sự kiện đã hủy → 409 EVENT_CANCELLED, ảnh giữ nguyên, không audit', async () => {
    const key = await uploadKey();
    const event = EventDetail.parse((await createEvent({ imageKey: key }).expect(201)).body);
    await h.db.orm.execute(sql`UPDATE events SET status = 'cancelled' WHERE id = ${event.id}`);
    for (const imageKey of [await uploadKey(), null]) {
      const res = await patchEvent(event.id, bodyOf(event, { imageKey })).expect(409);
      expect(ErrorResponse.parse(res.body).error.code).toBe('EVENT_CANCELLED');
    }
    expect(await imageKeyColumn(event.id)).toBe(key);
    expect((await audits(event.id)).map((a) => a.action)).toEqual(['event.created']);
  });
});
