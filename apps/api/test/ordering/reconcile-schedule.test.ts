import { describe, expect, it } from 'vitest';
import {
  firstCheckAt,
  nextCheckAt,
  RECONCILE_MAX_FAILURES,
  RECONCILE_RETRY_DELAYS_MS,
  reconcileCheckpoints,
  reconcileJobId,
  reconcileRetryJobId,
  type ReconcileSchedule,
} from '../../src/modules/ordering/reconciliation-jobs.js';

/*
 * Story 4.1: lịch tra của Đối soát bù là hàm thuần của trạng thái Đơn, `payment_link_attempt_at`, `expires_at` và đồng hồ
 * DB (truyền vào). Không cần DB.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const attemptAt = new Date('2026-11-13T03:00:00.123Z');
/** Sau TX2: `expires_at` = lượt + 15 phút. */
const expiresAt = new Date(attemptAt.getTime() + 15 * MIN);
const at = (base: Date, ms: number) => new Date(base.getTime() + ms);
const pending: ReconcileSchedule = { status: 'pending', attemptAt, expiresAt };
const expired: ReconcileSchedule = { status: 'expired', attemptAt, expiresAt };

describe('reconcileCheckpoints', () => {
  it('pending: lượt + 2, + 5, + 10 phút, expires_at, rồi expires_at + 30 phút, + 2 giờ, + 24 giờ', () => {
    expect(reconcileCheckpoints(pending)).toEqual([
      at(attemptAt, 2 * MIN),
      at(attemptAt, 5 * MIN),
      at(attemptAt, 10 * MIN),
      expiresAt,
      at(expiresAt, 30 * MIN),
      at(expiresAt, 2 * HOUR),
      at(expiresAt, 24 * HOUR),
    ]);
  });

  it('expired: chỉ 3 mốc sau hết hạn (bỏ các mốc pending còn lại)', () => {
    expect(reconcileCheckpoints(expired)).toEqual([at(expiresAt, 30 * MIN), at(expiresAt, 2 * HOUR), at(expiresAt, 24 * HOUR)]);
  });

  it('Đơn không còn chờ tiền (paid, review, cancelled, refunded) → không mốc nào', () => {
    for (const status of ['paid', 'review', 'cancelled', 'refunded'] as const) {
      expect(reconcileCheckpoints({ status, attemptAt, expiresAt }), status).toEqual([]);
    }
  });

  it('thiếu payment_link_attempt_at (không xảy ra sau TX2) → chỉ các mốc theo expires_at', () => {
    expect(reconcileCheckpoints({ status: 'pending', attemptAt: null, expiresAt })[0]).toEqual(expiresAt);
  });
});

describe('nextCheckAt', () => {
  it('mốc đầu tiên lớn hơn đồng hồ DB; đúng bằng mốc thì sang mốc sau', () => {
    expect(nextCheckAt(pending, attemptAt)).toEqual(at(attemptAt, 2 * MIN));
    expect(nextCheckAt(pending, at(attemptAt, 2 * MIN))).toEqual(at(attemptAt, 5 * MIN));
    expect(nextCheckAt(pending, at(attemptAt, 2 * MIN + 1))).toEqual(at(attemptAt, 5 * MIN));
    expect(nextCheckAt(pending, at(attemptAt, 11 * MIN))).toEqual(expiresAt);
  });

  it('worker chậm: mốc đã qua bị bỏ, không chạy dồn', () => {
    // Job của mốc + 2 phút chạy lúc + 12 phút: mốc + 5 và + 10 đã qua.
    expect(nextCheckAt(pending, at(attemptAt, 12 * MIN))).toEqual(expiresAt);
    // Đơn còn pending sau expires_at (job (c) chưa chạy): sang mốc sau hết hạn.
    expect(nextCheckAt(pending, at(expiresAt, 1))).toEqual(at(expiresAt, 30 * MIN));
  });

  it('expired: từ lúc hết hạn → + 30 phút → + 2 giờ → + 24 giờ → hết mốc (null)', () => {
    expect(nextCheckAt(expired, at(attemptAt, 3 * MIN))).toEqual(at(expiresAt, 30 * MIN));
    expect(nextCheckAt(expired, at(expiresAt, 30 * MIN))).toEqual(at(expiresAt, 2 * HOUR));
    expect(nextCheckAt(expired, at(expiresAt, 2 * HOUR))).toEqual(at(expiresAt, 24 * HOUR));
    expect(nextCheckAt(expired, at(expiresAt, 24 * HOUR))).toBeNull();
    expect(nextCheckAt(pending, at(expiresAt, 25 * HOUR))).toBeNull();
  });

  it('Đơn không còn chờ tiền → null', () => {
    expect(nextCheckAt({ status: 'paid', attemptAt, expiresAt }, attemptAt)).toBeNull();
  });
});

describe('mốc đầu, tra lại và id job', () => {
  it('mốc đầu = lượt + 2 phút; tra lại sau 1, 2, 4 phút; lỗi lần thứ 4 thì dừng', () => {
    expect(firstCheckAt(attemptAt)).toEqual(at(attemptAt, 2 * MIN));
    expect(RECONCILE_RETRY_DELAYS_MS).toEqual([MIN, 2 * MIN, 4 * MIN]);
    expect(RECONCILE_MAX_FAILURES).toBe(4);
  });

  it('id cố định theo (Đơn, mốc) và theo (job gốc, số lần lỗi): cùng đầu vào cùng id, khác thì khác', () => {
    const orderId = '0b0f6f5e-6a4e-4d43-9a39-1d2f6b8f2c11';
    const other = '6c1b7a8e-3f2d-4e5a-8b9c-0d1e2f3a4b5c';
    const first = reconcileJobId(orderId, firstCheckAt(attemptAt));
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(reconcileJobId(orderId, new Date(firstCheckAt(attemptAt).getTime()))).toBe(first);
    expect(reconcileJobId(orderId, at(attemptAt, 5 * MIN))).not.toBe(first);
    expect(reconcileJobId(other, firstCheckAt(attemptAt))).not.toBe(first);
    const retry1 = reconcileRetryJobId(first, 1);
    expect(reconcileRetryJobId(first, 1)).toBe(retry1);
    expect(new Set([first, retry1, reconcileRetryJobId(first, 2), reconcileRetryJobId(retry1, 2)]).size).toBe(4);
  });
});
