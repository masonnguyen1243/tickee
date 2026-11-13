import 'reflect-metadata';
import { JobQueue } from '@tickee/contracts';
import type { PgBoss } from 'pg-boss';
import { describe, expect, it, vi } from 'vitest';
import { OrderQueues } from '../../src/modules/ordering/order-jobs.js';

/** `OrderQueues.ready()` của vai `api`: start/tạo queue lỗi thì lần gọi sau làm lại, không giữ lỗi cũ. */
describe('OrderQueues.ready', () => {
  it('lần đầu lỗi (DB chưa sẵn sàng) → reject; lần sau start lại và tạo queue hết hạn Đơn, queue Đối soát bù cùng dead-letter', async () => {
    const boss = {
      start: vi.fn().mockRejectedValueOnce(new Error('DB chưa sẵn sàng')).mockResolvedValue(undefined),
      createQueue: vi.fn().mockResolvedValue(undefined),
      updateQueue: vi.fn().mockResolvedValue(undefined),
    };
    const queues = new OrderQueues(boss as unknown as PgBoss);

    await expect(queues.ready()).rejects.toThrow('DB chưa sẵn sàng');
    expect(boss.createQueue).not.toHaveBeenCalled();

    await expect(queues.ready()).resolves.toBeUndefined();
    expect(boss.start).toHaveBeenCalledTimes(2);
    // TX2 enqueue cả job (c) lẫn job Đối soát bù đầu tiên (Story 4.1).
    expect(boss.createQueue.mock.calls.map(([name]) => name)).toEqual([
      JobQueue.ORDERING_EXPIRE_ORDER_DEAD_LETTER,
      JobQueue.ORDERING_EXPIRE_ORDER,
      JobQueue.PAYMENT_RECONCILE_ORDER_DEAD_LETTER,
      JobQueue.PAYMENT_RECONCILE_ORDER,
    ]);
    expect(boss.updateQueue.mock.calls.map(([name]) => name)).toEqual([
      JobQueue.ORDERING_EXPIRE_ORDER,
      JobQueue.PAYMENT_RECONCILE_ORDER,
    ]);

    // Đã xong thì không làm lại.
    await queues.ready();
    expect(boss.start).toHaveBeenCalledTimes(2);
    expect(boss.createQueue).toHaveBeenCalledTimes(4);
  });
});
