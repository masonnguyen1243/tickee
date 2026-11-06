import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { revalidateTag } = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag }));

import { dynamic, POST } from '@/app/api/revalidate/route';

/** Route nội bộ `POST /api/revalidate` (Story 2.11-c): worker gọi để xóa cache trang `/e/{slug}`. */

const SECRET = 'test-only-revalidate-secret-0123456789abcdef';

function call(body: unknown, authorization: string | null = `Bearer ${SECRET}`): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (authorization !== null) headers.set('authorization', authorization);
  return POST(
    new Request('http://web.tickee.test/api/revalidate', {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

describe('POST /api/revalidate', () => {
  beforeEach(() => {
    vi.stubEnv('REVALIDATE_SECRET', SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    revalidateTag.mockReset();
  });

  it('luôn chạy động (không cache route)', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('hợp lệ → revalidateTag(tag, { expire: 0 }), 204', async () => {
    const res = await call({ tag: 'event:giai-chay-ab12' });
    expect(res.status).toBe(204);
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith('event:giai-chay-ab12', { expire: 0 });
  });

  it('thiếu REVALIDATE_SECRET ở server → 503, không revalidate', async () => {
    vi.stubEnv('REVALIDATE_SECRET', '');
    const res = await call({ tag: 'event:giai-chay-ab12' });
    expect(res.status).toBe(503);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it.each([
    ['thiếu header', null],
    ['sai secret', 'Bearer test-only-revalidate-secret-0123456789abcdeX'],
    ['secret khác độ dài', 'Bearer ngan'],
    ['thiếu "Bearer "', SECRET],
    ['header rỗng', ''],
  ])('%s → 401, không revalidate', async (_name, authorization) => {
    const res = await call({ tag: 'event:giai-chay-ab12' }, authorization);
    expect(res.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('sai secret thì 401 trước cả khi đọc body', async () => {
    const res = await call('không phải JSON', 'Bearer sai');
    expect(res.status).toBe(401);
  });

  it.each([
    ['tag lạ', { tag: 'user:1' }],
    ['thiếu tag', {}],
    ['tag không phải chuỗi', { tag: 42 }],
    ['slug sai dạng', { tag: 'event:Giai Chay' }],
    ['slug rỗng', { tag: 'event:' }],
    ['slug quá dài', { tag: `event:${'a'.repeat(101)}` }],
    ['body không phải object', ['event:giai-chay-ab12']],
    ['body không phải JSON', '{tag:'],
  ])('%s → 400, không revalidate', async (_name, body) => {
    const res = await call(body);
    expect(res.status).toBe(400);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
