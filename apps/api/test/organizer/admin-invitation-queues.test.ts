import 'reflect-metadata';
import { JobQueue } from '@tickee/contracts';
import type { PgBoss } from 'pg-boss';
import { describe, expect, it, vi } from 'vitest';
import { AdminInvitationQueues } from '../../src/modules/organizer/invitation-jobs.js';

/** `AdminInvitationQueues.ready()` của vai `api`: start/tạo queue lỗi thì lần gọi sau làm lại, không giữ lỗi cũ. */
describe('AdminInvitationQueues.ready', () => {
  it('lần đầu lỗi (DB chưa sẵn sàng) → reject; lần sau start lại và tạo đủ queue', async () => {
    const boss = {
      start: vi.fn().mockRejectedValueOnce(new Error('DB chưa sẵn sàng')).mockResolvedValue(undefined),
      createQueue: vi.fn().mockResolvedValue(undefined),
      updateQueue: vi.fn().mockResolvedValue(undefined),
    };
    const queues = new AdminInvitationQueues(boss as unknown as PgBoss);

    await expect(queues.ready()).rejects.toThrow('DB chưa sẵn sàng');
    expect(boss.createQueue).not.toHaveBeenCalled();

    await expect(queues.ready()).resolves.toBeUndefined();
    expect(boss.start).toHaveBeenCalledTimes(2);
    expect(boss.createQueue.mock.calls.map(([name]) => name)).toEqual([
      JobQueue.ORGANIZER_SEND_ADMIN_INVITATION_DEAD_LETTER,
      JobQueue.ORGANIZER_SEND_ADMIN_INVITATION,
    ]);
    expect(boss.updateQueue.mock.calls.map(([name]) => name)).toEqual([JobQueue.ORGANIZER_SEND_ADMIN_INVITATION]);

    // Đã xong thì không làm lại.
    await queues.ready();
    expect(boss.start).toHaveBeenCalledTimes(2);
  });
});
