import type { EventAvailability } from '@tickee/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AVAILABILITY_MEMO_MAX,
  AVAILABILITY_TTL_MS,
  AvailabilityMemo,
} from '../../src/modules/ordering/public-availability.controller.js';
import type { Database } from '../../src/platform/db/index.js';

/*
 * Story 2.11-a: memo trong process của `GET /v1/events/:slug/availability`, dựng trực tiếp với đồng hồ tiêm được và
 * phần tính (`compute`) giả, không cần DB.
 */

let clock = 0;
let memo: AvailabilityMemo;
let compute: ReturnType<typeof vi.fn<(slug: string) => Promise<EventAvailability>>>;

beforeEach(() => {
  clock = 0;
  memo = new AvailabilityMemo({} as Database, () => clock);
  compute = vi.fn(async () => ({ eventReason: null, tiers: [] }));
  (memo as unknown as { compute: typeof compute }).compute = compute;
});

const slug = (i: number) => `su-kien-${i}`;

describe('AvailabilityMemo', () => {
  it('hai get(slug) cùng lúc dùng chung một promise, chỉ tính một lần; hết hạn thì tính lại', async () => {
    const a = memo.get('giai-chay-abcd');
    const b = memo.get('giai-chay-abcd');
    expect(b).toBe(a);
    await Promise.all([a, b]);
    expect(compute).toHaveBeenCalledTimes(1);
    clock += AVAILABILITY_TTL_MS;
    await memo.get('giai-chay-abcd');
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('slug sai dạng hoặc quá dài → EVENT_NOT_FOUND, không tính, không chiếm chỗ trong memo', async () => {
    await expect(memo.get('KHONG HOP LE')).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND' });
    await expect(memo.get('a'.repeat(101))).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND' });
    expect(compute).not.toHaveBeenCalled();
    expect(memo.size).toBe(0);
  });

  it('lỗi không được memo', async () => {
    compute.mockRejectedValueOnce(new Error('lỗi'));
    await expect(memo.get('giai-chay-abcd')).rejects.toThrow('lỗi');
    expect(memo.size).toBe(0);
    await memo.get('giai-chay-abcd');
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it(`giữ tối đa ${AVAILABILITY_MEMO_MAX} slug: bỏ mục hết hạn trước, rồi mới bỏ mục cũ nhất`, async () => {
    void memo.get('cu-nhat');
    clock = 1_000;
    for (let i = 1; i < AVAILABILITY_MEMO_MAX; i++) void memo.get(slug(i));
    expect(memo.size).toBe(AVAILABILITY_MEMO_MAX);

    // `cu-nhat` đã hết hạn (t = 2.000), các mục khác hết hạn ở t = 3.000: chỉ `cu-nhat` bị bỏ.
    clock = 2_500;
    void memo.get('moi-1');
    expect(memo.size).toBe(AVAILABILITY_MEMO_MAX);
    compute.mockClear();
    void memo.get(slug(1));
    expect(compute).not.toHaveBeenCalled();

    // Không còn mục hết hạn: bỏ mục cũ nhất (`su-kien-1`).
    void memo.get('moi-2');
    expect(memo.size).toBe(AVAILABILITY_MEMO_MAX);
    void memo.get(slug(2));
    expect(compute).toHaveBeenCalledTimes(1);
    void memo.get(slug(1));
    expect(compute).toHaveBeenCalledTimes(2);
    expect(memo.size).toBeLessThanOrEqual(AVAILABILITY_MEMO_MAX);
  });
});
