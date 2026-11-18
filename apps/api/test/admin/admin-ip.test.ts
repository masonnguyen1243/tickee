import { randomUUID } from 'node:crypto';
import { Controller, Get } from '@nestjs/common';
import { ErrorResponse } from '@tickee/contracts';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ADMIN_IP_BLOCKED } from '../../src/modules/admin/admin-ip.middleware.js';
import { PlatformAdminGuard } from '../../src/modules/identity/platform-admin.guard.js';
import { SessionGuard } from '../../src/modules/identity/session.guard.js';
import { RequirePlatformAdmin } from '../../src/platform/access/index.js';
import { TEST_WEB_ORIGIN } from '../helpers.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import { signUpPlatformAdmin } from './platform-admin.js';

/*
 * Story 4.7-a: giới hạn IP của `/v1/admin/*` theo `ADMIN_ALLOWED_CIDRS` (override của harness là giá trị đã parse), IP
 * client là `req.ip` theo `TRUST_PROXY_HOPS`. Mỗi dòng của I/O Matrix trừ "Production thiếu biến" và "Mục sai"
 * (`config.test.ts`, `roles.process.test.ts`) và "Web bị chặn" (e2e web). Session dùng chung giữa các harness (cùng DB,
 * cùng `BETTER_AUTH_SECRET`). Logger gốc của nestjs-pino là một cho cả tiến trình, nên log của mọi harness trong file có
 * thể nằm ở `LogCapture` của harness tạo trước: kiểm log trên mọi harness gộp lại, ghép theo `x-request-id`.
 */

const IN_RANGE = '203.0.113.7';
const OUT_OF_RANGE = '198.51.100.1';
const BLOCKED_MESSAGE = 'Bạn đang truy cập từ mạng không được phép vào trang quản trị.';

/** Route `@RequirePlatformAdmin()` đặt sai chỗ (ngoài `/v1/admin/`): guard phải ném lỗi cấu hình. */
@Controller('test-admin-ngoai-vung')
@RequirePlatformAdmin()
class OutsideAdminController {
  @Get()
  get(): { ok: true } {
    return { ok: true };
  }
}

/** Không giới hạn (không đặt biến, như harness mặc định). */
let open: Harness;
/** Sau một proxy tin cậy: IP client lấy từ `X-Forwarded-For`. */
let proxied: Harness;
/** Nhận kết nối trực tiếp: `X-Forwarded-For` do client gửi bị bỏ qua. */
let direct: Harness;
let admin: Awaited<ReturnType<typeof signUpPlatformAdmin>>;
let member: Awaited<ReturnType<typeof signUp>>;

beforeAll(async () => {
  open = await createHarness({}, { controllers: [OutsideAdminController] });
  proxied = await createHarness({ TRUST_PROXY_HOPS: 1, ADMIN_ALLOWED_CIDRS: ['203.0.113.0/24', '2001:db8::/32'] });
  direct = await createHarness({ TRUST_PROXY_HOPS: 0, ADMIN_ALLOWED_CIDRS: ['203.0.113.0/24'] });
  admin = await signUpPlatformAdmin(open);
  member = await signUp(open);
});
afterAll(async () => {
  await Promise.all([open?.close(), proxied?.close(), direct?.close()]);
});

const errorOf = (res: Response) => ErrorResponse.parse(res.body).error;

/** Mọi dòng log của các harness trong file (xem chú thích đầu file). */
const logLines = () => [open, proxied, direct].flatMap((h) => h.logs.lines);
const blockedLines = (requestId: string) =>
  logLines().filter((l) => l.marker === ADMIN_IP_BLOCKED && l.requestId === requestId);
const NOT_CONFIGURED = 'Chưa đặt ADMIN_ALLOWED_CIDRS';
const ENABLED = 'Giới hạn IP /v1/admin/* theo ADMIN_ALLOWED_CIDRS đã bật';

function expectBlocked(res: Response) {
  expect(res.status, JSON.stringify(res.body)).toBe(403);
  expect(errorOf(res)).toEqual({ code: 'ADMIN_IP_NOT_ALLOWED', message: BLOCKED_MESSAGE, details: null });
}

/** Ba danh sách của `/admin` (Closed Beta, Tạm ngừng bán, Dead-letter). */
const ADMIN_LISTS = [
  '/v1/admin/organizations?closedBeta=pending',
  '/v1/admin/organizations/payment-service/suspended',
  '/v1/admin/dead-letters',
];

const get = (h: Harness, path: string, ip?: string, cookie?: string) => {
  let req = h.http.get(path);
  if (ip !== undefined) req = req.set('x-forwarded-for', ip);
  if (cookie !== undefined) req = req.set('cookie', cookie);
  return req;
};

describe('ADMIN_ALLOWED_CIDRS đặt, TRUST_PROXY_HOPS=1', () => {
  it('IP trong dải, Quản trị Tingee đã step-up → mọi danh sách 200 như trước; thao tác đi tiếp tới handler', async () => {
    const requestId = `admin-ip-${randomUUID()}`;
    for (const path of ADMIN_LISTS) {
      const res = await get(proxied, path, IN_RANGE, admin.cookie).set('x-request-id', requestId);
      expect(res.status, `${path} ${JSON.stringify(res.body)}`).toBe(200);
    }
    // Duyệt BTC không tồn tại: tới được handler (404 của miền), không bị chặn.
    const approve = await proxied.http
      .post(`/v1/admin/organizations/${randomUUID()}/closed-beta/approve`)
      .set('x-forwarded-for', IN_RANGE)
      .set('x-request-id', requestId)
      .set('cookie', admin.cookie);
    expect(approve.status, JSON.stringify(approve.body)).toBe(404);
    expect(errorOf(approve).code).toBe('NOT_FOUND');
    expect(blockedLines(requestId)).toEqual([]);
  });

  it('IP ngoài dải, Quản trị Tingee đã step-up → 403 ADMIN_IP_NOT_ALLOWED ở mọi route; log warn admin_ip_blocked, không có IP', async () => {
    for (const path of ADMIN_LISTS) expectBlocked(await get(proxied, path, OUT_OF_RANGE, admin.cookie));
    const requestId = `admin-ip-${randomUUID()}`;
    const approvePath = `/v1/admin/organizations/${randomUUID()}/closed-beta/approve`;
    expectBlocked(
      await proxied.http
        .post(`${approvePath}?a=1`)
        .set('x-forwarded-for', OUT_OF_RANGE)
        .set('x-request-id', requestId)
        .set('cookie', admin.cookie),
    );
    const lines = blockedLines(requestId);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 40, context: 'AdminIpMiddleware', method: 'POST', path: approvePath });
    // Không có IP nào (IP là PII, AD-18) trong cả dòng chặn lẫn log request của pino-http.
    expect(JSON.stringify(logLines())).not.toContain(OUT_OF_RANGE);
  });

  it('chặn trước SessionGuard và PlatformAdminGuard (không tới DB)', async () => {
    const session = vi.spyOn(SessionGuard.prototype, 'canActivate');
    const platformAdmin = vi.spyOn(PlatformAdminGuard.prototype, 'canActivate');
    try {
      expectBlocked(await get(proxied, ADMIN_LISTS[0]!, OUT_OF_RANGE, admin.cookie));
      expect(session).not.toHaveBeenCalled();
      expect(platformAdmin).not.toHaveBeenCalled();
      // Đối chứng: request trong dải đi qua cả hai guard.
      await get(proxied, ADMIN_LISTS[0]!, IN_RANGE, admin.cookie).expect(200);
      expect(session).toHaveBeenCalled();
      expect(platformAdmin).toHaveBeenCalled();
    } finally {
      session.mockRestore();
      platformAdmin.mockRestore();
    }
  });

  it('ẩn danh ngoài dải → 403 ADMIN_IP_NOT_ALLOWED, không phải 401; trong dải → 401 như trước', async () => {
    expectBlocked(await get(proxied, ADMIN_LISTS[0]!, OUT_OF_RANGE));
    expectBlocked(
      await proxied.http.post(`/v1/admin/organizations/${randomUUID()}/closed-beta/approve`).set('x-forwarded-for', OUT_OF_RANGE),
    );
    const anonymous = await get(proxied, ADMIN_LISTS[0]!, IN_RANGE);
    expect(anonymous.status).toBe(401);
    expect(errorOf(anonymous).code).toBe('UNAUTHENTICATED');
  });

  it('tài khoản thường ngoài dải → 403 ADMIN_IP_NOT_ALLOWED (không lộ FORBIDDEN_ROLE); trong dải → FORBIDDEN_ROLE như trước', async () => {
    expectBlocked(await get(proxied, ADMIN_LISTS[0]!, OUT_OF_RANGE, member.cookie));
    const res = await get(proxied, ADMIN_LISTS[0]!, IN_RANGE, member.cookie);
    expect(res.status).toBe(403);
    expect(errorOf(res).code).toBe('FORBIDDEN_ROLE');
  });

  it('chặn theo đường dẫn: /v1/admin, /v1/admin/, route không tồn tại, chữ hoa, mọi method trừ preflight OPTIONS', async () => {
    for (const path of ['/v1/admin', '/v1/admin/', '/v1/admin/khong-ton-tai', '/v1/admin/a/b/c?x=1', '/V1/ADMIN/organizations']) {
      expectBlocked(await get(proxied, path, OUT_OF_RANGE, admin.cookie));
    }
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      expectBlocked(await proxied.http[method]('/v1/admin/dead-letters').set('x-forwarded-for', OUT_OF_RANGE));
    }
    // Trong dải: route không tồn tại vẫn 404 như trước; chữ hoa vẫn khớp route (router Express không phân biệt hoa thường).
    const missing = await get(proxied, '/v1/admin/khong-ton-tai', IN_RANGE, admin.cookie);
    expect(missing.status).toBe(404);
    await get(proxied, '/V1/ADMIN/dead-letters', IN_RANGE, admin.cookie).expect(200);
  });

  it('CORS: 403 bị chặn vẫn mang header CORS của WEB_ORIGIN (trình duyệt đọc được mã lỗi)', async () => {
    const res = await get(proxied, ADMIN_LISTS[0]!, OUT_OF_RANGE, admin.cookie).set('origin', TEST_WEB_ORIGIN);
    expectBlocked(res);
    expect(res.headers['access-control-allow-origin']).toBe(TEST_WEB_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('CORS: preflight OPTIONS ngoài dải do lớp CORS trả (2xx, không dữ liệu, không log chặn) trước khi kiểm IP', async () => {
    const requestId = `admin-preflight-${randomUUID()}`;
    const res = await proxied.http
      .options(`/v1/admin/organizations/${randomUUID()}/closed-beta/approve`)
      .set('x-forwarded-for', OUT_OF_RANGE)
      .set('x-request-id', requestId)
      .set('origin', TEST_WEB_ORIGIN)
      .set('access-control-request-method', 'POST')
      .set('access-control-request-headers', 'content-type');
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe(TEST_WEB_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.text).toBe('');
    expect(blockedLines(requestId)).toEqual([]);
  });

  it('đường dẫn chỉ trùng tiền tố chữ (/v1/administrator, /v1/admin-x) không bị chặn', async () => {
    for (const path of ['/v1/administrator', '/v1/admin-x/organizations']) {
      const res = await get(proxied, path, OUT_OF_RANGE, admin.cookie);
      expect(res.status, path).toBe(404);
      expect(errorOf(res).code).toBe('NOT_FOUND');
    }
  });

  it('IPv4 ánh xạ ::ffff:a.b.c.d so như IPv4: trong dải qua, ngoài dải chặn', async () => {
    await get(proxied, ADMIN_LISTS[2]!, `::ffff:${IN_RANGE}`, admin.cookie).expect(200);
    expectBlocked(await get(proxied, ADMIN_LISTS[2]!, `::ffff:${OUT_OF_RANGE}`, admin.cookie));
  });

  it('IPv6: 2001:db8::1 trong 2001:db8::/32 qua; 2001:db9::1 chặn', async () => {
    await get(proxied, ADMIN_LISTS[2]!, '2001:db8::1', admin.cookie).expect(200);
    expectBlocked(await get(proxied, ADMIN_LISTS[2]!, '2001:db9::1', admin.cookie));
  });

  it('chỉ tin đúng một hop: IP client là mục cuối của X-Forwarded-For (mục trước do client tự gửi)', async () => {
    expectBlocked(await get(proxied, ADMIN_LISTS[2]!, `${IN_RANGE}, ${OUT_OF_RANGE}`, admin.cookie));
    await get(proxied, ADMIN_LISTS[2]!, `${OUT_OF_RANGE}, ${IN_RANGE}`, admin.cookie).expect(200);
  });

  it('IP không phân tích được → chặn', async () => {
    expectBlocked(await get(proxied, ADMIN_LISTS[2]!, 'khong-phai-ip', admin.cookie));
  });

  it('route không phải admin ngoài dải không đổi hành vi (/v1/me/memberships, /v1/identity/me, /healthz)', async () => {
    await get(proxied, '/v1/me/memberships', OUT_OF_RANGE, admin.cookie).expect(200);
    await get(proxied, '/v1/identity/me', OUT_OF_RANGE, admin.cookie).expect(200);
    await get(proxied, '/healthz', OUT_OF_RANGE).expect(200);
    const anonymous = await get(proxied, '/v1/me/memberships', OUT_OF_RANGE);
    expect(anonymous.status).toBe(401);
  });

});

describe('ADMIN_ALLOWED_CIDRS đặt, TRUST_PROXY_HOPS=0', () => {
  it('X-Forwarded-For giả bị bỏ qua: socket 127.0.0.1 ngoài dải → 403 dù XFF trong dải', async () => {
    expectBlocked(await get(direct, ADMIN_LISTS[0]!, IN_RANGE, admin.cookie));
    expectBlocked(await get(direct, ADMIN_LISTS[0]!, undefined, admin.cookie));
  });

  // supertest nghe 127.0.0.1, nên `req.ip` là `127.0.0.1` thường (không phải `::ffff:127.0.0.1`); đường `::ffff:` đã có
  // test qua XFF ở trên và ở `cidr.test.ts`.
  it('IP socket (hops 0, `127.0.0.1`) khớp dải 127.0.0.1/32 → qua, dù XFF ngoài dải', async () => {
    const loopback = await createHarness({ TRUST_PROXY_HOPS: 0, ADMIN_ALLOWED_CIDRS: ['127.0.0.1/32'] });
    try {
      await get(loopback, ADMIN_LISTS[0]!, OUT_OF_RANGE, admin.cookie).expect(200);
    } finally {
      await loopback.close();
    }
  });
});

describe('không đặt ADMIN_ALLOWED_CIDRS (development/test)', () => {
  it('/v1/admin/* như trước với mọi IP, không dòng chặn nào', async () => {
    const requestId = `admin-open-${randomUUID()}`;
    for (const path of ADMIN_LISTS) {
      await get(open, path, undefined, admin.cookie).set('x-request-id', requestId).expect(200);
      await get(open, path, OUT_OF_RANGE, admin.cookie).set('x-request-id', requestId).expect(200);
    }
    expect((await get(open, ADMIN_LISTS[0]!).set('x-request-id', requestId)).status).toBe(401);
    expect(blockedLines(requestId)).toEqual([]);
  });

  it('api log warn đúng một lần lúc khởi động; harness có biến thì log info số dải, không nêu địa chỉ', () => {
    // Trong ba harness chỉ `open` không đặt biến.
    const warnings = logLines().filter((l) => String(l.msg).includes(NOT_CONFIGURED));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ level: 40, context: 'AdminModule' });
    const enabled = logLines().filter((l) => l.msg === ENABLED);
    for (const line of enabled) expect(line).toMatchObject({ level: 30, context: 'AdminModule' });
    // `proxied` (một dải IPv4, một IPv6) và `direct` (một dải IPv4).
    expect(enabled.map((l) => ({ ipv4Ranges: l.ipv4Ranges, ipv6Ranges: l.ipv6Ranges }))).toEqual(
      expect.arrayContaining([
        { ipv4Ranges: 1, ipv6Ranges: 1 },
        { ipv4Ranges: 1, ipv6Ranges: 0 },
      ]),
    );
    expect(JSON.stringify(enabled)).not.toMatch(/203\.0\.113|2001:db8/);
  });
});

describe('PlatformAdminGuard: route admin phải nằm dưới /v1/admin/', () => {
  it('route @RequirePlatformAdmin() ngoài /v1/admin/ → 500 lỗi cấu hình, kể cả với Quản trị Tingee đã step-up', async () => {
    const requestId = `admin-outside-${randomUUID()}`;
    const res = await open.http
      .get('/v1/test-admin-ngoai-vung')
      .set('cookie', admin.cookie)
      .set('x-request-id', requestId);
    expect(res.status).toBe(500);
    expect(errorOf(res).code).toBe('INTERNAL_ERROR');
    const line = logLines().find((l) => l.requestId === requestId && l.msg === 'Lỗi không bắt được');
    expect(line).toMatchObject({
      level: 50,
      context: 'ErrorFilter',
      err: { message: 'Route @RequirePlatformAdmin() nằm ngoài /v1/admin/: cấu hình sai' },
    });
  });
});
