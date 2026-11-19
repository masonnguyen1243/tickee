import { randomUUID } from 'node:crypto';
import {
  EVENT_IMAGE_PRESIGN_LIMITS,
  EventImageRateLimitedDetails,
  EventImageUpload,
  ErrorResponse,
  Role,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EVENT_IMAGE_PRESIGN_ISSUED,
  EVENT_IMAGE_PRESIGN_LIMITED,
} from '../../src/modules/event/event-image-rate-limit.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';

/*
 * Story 4.7-d: giới hạn presign ảnh Sự kiện (`POST /v1/orgs/:orgId/event-images`) theo BTC (`perOrganization`) và theo
 * tài khoản gộp mọi BTC (`perUser`) trong cửa sổ trượt `windowSeconds`. Mỗi dòng của I/O Matrix, log `info` khi cấp, log
 * `warn` marker khi chặn, và dọn dòng đã ra khỏi cửa sổ. DB dùng chung giữa các file test (không truncate), nên mỗi test
 * dùng BTC và tài khoản mới; dòng đếm "đã có" chèn thẳng bằng SQL với `created_at` lùi về quá khứ.
 */

const { windowSeconds: WINDOW, perOrganization: PER_ORG, perUser: PER_USER } = EVENT_IMAGE_PRESIGN_LIMITS;
const BODY = { contentType: 'image/webp', contentLength: 1_234 };

type User = Awaited<ReturnType<typeof signUp>>;

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

async function newOrg(owner: User): Promise<string> {
  const res = await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: 'BTC ảnh' }).expect(201);
  return res.body.id as string;
}

async function addAdmin(orgId: string, user: User): Promise<void> {
  await h.db.orm.execute(
    sql`INSERT INTO members (organization_id, user_id, role) VALUES (${orgId}, ${user.userId}, ${Role.ADMIN})`,
  );
}

const presign = (user: User, orgId: string, body: unknown = BODY) =>
  h.http
    .post(`/v1/orgs/${orgId}/event-images`)
    .set('cookie', user.cookie)
    .send(body as object);

/** Chèn `n` dòng đếm của `userId` ở BTC `orgId`, cách đây `ageSeconds` giây. */
async function seed(orgId: string, userId: string, n: number, ageSeconds = 3_600): Promise<void> {
  await h.db.orm.execute(sql`
    INSERT INTO event_image_presigns (organization_id, user_id, created_at)
    SELECT ${orgId}::uuid, ${userId}::uuid, now() - make_interval(secs => ${ageSeconds})
    FROM generate_series(1, ${n}::int)`);
}

/** Số dòng đếm của BTC hoặc của tài khoản (mọi BTC), cả dòng đã ra khỏi cửa sổ. */
async function rowsOf(column: 'organization_id' | 'user_id', id: string): Promise<number> {
  const { rows } = await h.db.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM event_image_presigns WHERE ${column} = $1`,
    [id],
  );
  return rows[0]!.n;
}

const errorOf = (res: Response) => ErrorResponse.parse(res.body).error;

/** `429 EVENT_IMAGE_RATE_LIMITED` → `retryAfterSeconds`. */
function expectLimited(res: Response): number {
  expect(res.status, JSON.stringify(res.body)).toBe(429);
  const error = errorOf(res);
  expect(error.code).toBe('EVENT_IMAGE_RATE_LIMITED');
  return EventImageRateLimitedDetails.parse(error.details).retryAfterSeconds;
}

const linesOf = (res: Response) => h.logs.lines.filter((l) => l.requestId === res.headers['x-request-id']);
const limitedLines = (res: Response) => linesOf(res).filter((l) => l.marker === EVENT_IMAGE_PRESIGN_LIMITED);
const issuedLines = (res: Response) => linesOf(res).filter((l) => l.marker === EVENT_IMAGE_PRESIGN_ISSUED);

describe('dưới trần', () => {
  it('200 như cũ; thêm đúng một dòng đếm (BTC, tài khoản); log info có userId, organizationId, key, không có URL ký', async () => {
    const owner = await signUp(h);
    const orgId = await newOrg(owner);

    const res = await presign(owner, orgId).expect(200);
    const upload = EventImageUpload.parse(res.body);
    expect(upload.key.startsWith(`orgs/${orgId}/events/`)).toBe(true);
    const { rows } = await h.db.pool.query<{ organization_id: string; user_id: string }>(
      'SELECT organization_id, user_id FROM event_image_presigns WHERE organization_id = $1',
      [orgId],
    );
    expect(rows).toEqual([{ organization_id: orgId, user_id: owner.userId }]);

    const [line, ...rest] = issuedLines(res);
    expect(rest).toEqual([]);
    expect(line).toMatchObject({ level: 30, userId: owner.userId, organizationId: orgId, key: upload.key });
    const text = JSON.stringify(line);
    expect(text).not.toContain(upload.uploadUrl);
    expect(text).not.toContain(new URL(upload.uploadUrl).searchParams.get('X-Amz-Signature')!);
    expect(text).not.toContain(owner.email);
    expect(limitedLines(res)).toEqual([]);
  });

  it('còn một lượt (49 lần trong cửa sổ) → vẫn cấp; lần kế tiếp → 429', async () => {
    const owner = await signUp(h);
    const orgId = await newOrg(owner);
    await seed(orgId, randomUUID(), PER_ORG - 1);

    await presign(owner, orgId).expect(200);
    expect(await rowsOf('organization_id', orgId)).toBe(PER_ORG);
    expectLimited(await presign(owner, orgId));
    expect(await rowsOf('organization_id', orgId)).toBe(PER_ORG);
  });
});

describe('chạm trần BTC', () => {
  it('BTC đủ 50 lần do thành viên khác → Admin nhận 429 retryAfterSeconds, không ghi dòng; log warn marker; ở BTC khác vẫn cấp', async () => {
    const owner = await signUp(h);
    const admin = await signUp(h);
    const orgId = await newOrg(owner);
    await addAdmin(orgId, admin);
    // 50 lần của Owner, cách đây 1 giờ: được cấp lại sau 23 giờ.
    await seed(orgId, owner.userId, PER_ORG);

    const res = await presign(admin, orgId);
    const retryAfterSeconds = expectLimited(res);
    expect(retryAfterSeconds).toBeLessThanOrEqual(WINDOW - 3_600);
    expect(retryAfterSeconds).toBeGreaterThan(WINDOW - 3_600 - 60);
    expect(await rowsOf('organization_id', orgId)).toBe(PER_ORG);
    expect(await rowsOf('user_id', admin.userId)).toBe(0);

    const [line, ...rest] = limitedLines(res);
    expect(rest).toEqual([]);
    expect(line).toMatchObject({
      level: 40,
      userId: admin.userId,
      organizationId: orgId,
      limits: ['organization'],
      retryAfterSeconds,
    });
    expect(JSON.stringify(line)).not.toContain(admin.email);
    expect(issuedLines(res)).toEqual([]);

    // Giới hạn theo BTC: Admin vẫn xin được ở BTC của mình.
    await presign(admin, await newOrg(admin)).expect(200);
  });
});

describe('chạm trần tài khoản', () => {
  it('tài khoản đủ 100 lần gộp qua nhiều BTC (mỗi BTC dưới trần) → 429 ở mọi BTC của tài khoản; thành viên khác vẫn xin được', async () => {
    const owner = await signUp(h);
    const [a, b, c] = [await newOrg(owner), await newOrg(owner), await newOrg(owner)];
    await seed(a, owner.userId, 40);
    await seed(b, owner.userId, 40);
    await seed(c, owner.userId, PER_USER - 80);

    for (const orgId of [a, b, c]) {
      const res = await presign(owner, orgId);
      // 100 lần của tài khoản cách đây 1 giờ: được cấp lại sau 23 giờ.
      const retryAfterSeconds = expectLimited(res);
      expect(retryAfterSeconds).toBeLessThanOrEqual(WINDOW - 3_600);
      expect(retryAfterSeconds).toBeGreaterThan(WINDOW - 3_600 - 60);
      expect(limitedLines(res)).toMatchObject([{ userId: owner.userId, organizationId: orgId, limits: ['user'] }]);
    }
    expect(await rowsOf('user_id', owner.userId)).toBe(PER_USER);

    const admin = await signUp(h);
    await addAdmin(c, admin);
    await presign(admin, c).expect(200);
    expect(await rowsOf('organization_id', c)).toBe(PER_USER - 80 + 1);
  });

  it('chạm cả hai giới hạn → retryAfterSeconds theo giới hạn chặn lâu nhất (BTC chặn lâu hơn)', async () => {
    const owner = await signUp(h);
    const [recent, older] = [await newOrg(owner), await newOrg(owner)];
    // BTC `recent`: 50 lần cách đây 1 giờ (cấp lại sau 23 giờ). BTC `older`: 50 lần cách đây 10 giờ (sau 14 giờ). Tài
    // khoản: 100 lần, lần thứ 100 tính từ mới nhất cách đây 10 giờ (sau 14 giờ).
    await seed(recent, owner.userId, PER_ORG, 3_600);
    await seed(older, owner.userId, PER_ORG, 36_000);

    const both = await presign(owner, recent);
    const longest = expectLimited(both);
    expect(longest).toBeLessThanOrEqual(WINDOW - 3_600);
    expect(longest).toBeGreaterThan(WINDOW - 3_600 - 60);
    expect(limitedLines(both)).toMatchObject([{ limits: ['organization', 'user'] }]);

    const fourteenHours = expectLimited(await presign(owner, older));
    expect(fourteenHours).toBeLessThanOrEqual(WINDOW - 36_000);
    expect(fourteenHours).toBeGreaterThan(WINDOW - 36_000 - 60);
  });

  it('chạm cả hai giới hạn, tài khoản chặn lâu hơn → retryAfterSeconds theo giới hạn tài khoản', async () => {
    const owner = await signUp(h);
    const [target, x, y] = [await newOrg(owner), await newOrg(owner), await newOrg(owner)];
    // BTC `target`: 50 lần của thành viên khác cách đây 10 giờ (cấp lại sau 14 giờ). Tài khoản: 100 lần ở hai BTC khác
    // cách đây 1 giờ (sau 23 giờ).
    await seed(target, randomUUID(), PER_ORG, 36_000);
    await seed(x, owner.userId, PER_USER / 2, 3_600);
    await seed(y, owner.userId, PER_USER / 2, 3_600);

    const res = await presign(owner, target);
    const longest = expectLimited(res);
    expect(longest).toBeLessThanOrEqual(WINDOW - 3_600);
    expect(longest).toBeGreaterThan(WINDOW - 3_600 - 60);
    expect(limitedLines(res)).toMatchObject([{ limits: ['organization', 'user'], retryAfterSeconds: longest }]);
  });
});

describe('song song', () => {
  it('BTC còn 1 lượt, request cùng lúc của nhiều thành viên (mỗi người 2 lần) → đúng 1 lần 200, còn lại 429', async () => {
    const owner = await signUp(h);
    const orgId = await newOrg(owner);
    const admins: User[] = [];
    for (let i = 0; i < 3; i++) {
      const admin = await signUp(h);
      await addAdmin(orgId, admin);
      admins.push(admin);
    }
    await seed(orgId, randomUUID(), PER_ORG - 1);

    const members = [owner, ...admins];
    const results = await Promise.all([...members, ...members].map((u) => presign(u, orgId)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 429, 429, 429, 429, 429, 429, 429]);
    expect(await rowsOf('organization_id', orgId)).toBe(PER_ORG);
  });

  it('tài khoản còn 1 lượt, request cùng lúc ở hai BTC (mỗi BTC còn 1 lượt) → đúng 1 lần 200', async () => {
    const owner = await signUp(h);
    const [a, b, c] = [await newOrg(owner), await newOrg(owner), await newOrg(owner)];
    await seed(a, owner.userId, PER_ORG - 1);
    await seed(b, owner.userId, PER_ORG - 1);
    await seed(c, owner.userId, PER_USER - 2 * (PER_ORG - 1) - 1);

    const results = await Promise.all([a, b, a, b].map((orgId) => presign(owner, orgId)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 429, 429, 429]);
    expect(await rowsOf('user_id', owner.userId)).toBe(PER_USER);
  });
});

describe('hết cửa sổ', () => {
  it('lần cũ nhất ra khỏi cửa sổ → cấp lại được; dòng hết cửa sổ bị xóa, của chính tài khoản và BTC lẫn của nơi khác', async () => {
    const owner = await signUp(h);
    const orgId = await newOrg(owner);
    const otherOrg = await newOrg(owner);
    const stranger = await signUp(h);
    const strangerOrg = await newOrg(stranger);
    const memberId = randomUUID();
    // BTC: 49 lần trong cửa sổ + 1 lần vừa ra khỏi cửa sổ (của thành viên khác); tài khoản: 2 lần hết cửa sổ ở BTC khác.
    await seed(orgId, memberId, PER_ORG - 1, 60);
    await seed(orgId, memberId, 1, WINDOW + 1);
    await seed(otherOrg, owner.userId, 2, WINDOW + 3_600);
    // Dòng hết cửa sổ của tài khoản và BTC không liên quan: cũng bị xóa.
    await seed(strangerOrg, stranger.userId, 3, WINDOW + 3_600);

    await presign(owner, orgId).expect(200);
    expect(await rowsOf('organization_id', orgId)).toBe(PER_ORG);
    expect(await rowsOf('organization_id', otherOrg)).toBe(0);
    expect(await rowsOf('organization_id', strangerOrg)).toBe(0);
    // Đủ 50 lần trong cửa sổ: lần kế tiếp bị chặn.
    expectLimited(await presign(owner, orgId));
  });

  it('cả 50 lần đã ra khỏi cửa sổ → cấp được; bị chặn vẫn dọn dòng hết cửa sổ', async () => {
    const owner = await signUp(h);
    const orgId = await newOrg(owner);
    await seed(orgId, owner.userId, PER_ORG, WINDOW + 60);
    await presign(owner, orgId).expect(200);
    expect(await rowsOf('organization_id', orgId)).toBe(1);

    const full = await newOrg(owner);
    await seed(full, randomUUID(), PER_ORG);
    await seed(full, randomUUID(), 5, WINDOW + 60);
    expectLimited(await presign(owner, full));
    expect(await rowsOf('organization_id', full)).toBe(PER_ORG);
  });
});

describe('body sai', () => {
  it('{} → 400 VALIDATION_FAILED, không đếm; kể cả khi BTC đã chạm trần (kiểm body trước giới hạn)', async () => {
    const owner = await signUp(h);
    const orgId = await newOrg(owner);
    const res = await presign(owner, orgId, {}).expect(400);
    expect(errorOf(res).code).toBe('VALIDATION_FAILED');
    expect(await rowsOf('organization_id', orgId)).toBe(0);
    expect(await rowsOf('user_id', owner.userId)).toBe(0);

    await seed(orgId, owner.userId, PER_ORG);
    const atLimit = await presign(owner, orgId, { contentType: 'image/gif', contentLength: 100 }).expect(400);
    expect(errorOf(atLimit).code).toBe('VALIDATION_FAILED');
    expect(limitedLines(atLimit)).toEqual([]);
    expect(await rowsOf('organization_id', orgId)).toBe(PER_ORG);
  });
});
