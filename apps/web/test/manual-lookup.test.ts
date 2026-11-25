import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api/errors';
import {
  hasUncheckedTickets,
  isRetryableCheckInError,
  lookupCountText,
  lookupRateLimitedText,
  lookupTicketMeta,
  marksCheckedIn,
  withCheckedIn,
} from '@/lib/checkin/manual-lookup';

/** Phần thuần của `manual-lookup` (Story 5.5): câu chữ, câu báo 429, cập nhật kết quả tra sau check-in tay. */

const ticket = (n: number, checkedIn = false) => ({
  ticketId: `019a3b2c-0b00-7abc-8def-${String(n).padStart(12, '0')}`,
  holderName: 'Nguyễn Văn Minh',
  ticketTypeName: 'Đôi nam',
  seq: n,
  count: 2,
  checkedIn,
});

describe('manual-lookup', () => {
  it('dòng đếm và "Hạng vé · Vé k/N" (bỏ Hạng vé rỗng)', () => {
    expect(lookupCountText(2)).toBe('2 Vé khớp');
    expect(lookupTicketMeta(ticket(1))).toBe('Đôi nam · Vé 1/2');
    expect(lookupTicketMeta({ ...ticket(2), ticketTypeName: '  ' })).toBe('Vé 2/2');
  });

  it('429: "Tra quá nhiều lần. Thử lại sau N giây." theo retryAfterSeconds; thiếu details thì 60', () => {
    const limited = (details: unknown) => new ApiError('CHECKIN_LOOKUP_RATE_LIMITED', 'x', details, 429);
    expect(lookupRateLimitedText(limited({ retryAfterSeconds: 42 }))).toBe('Tra quá nhiều lần. Thử lại sau 42 giây.');
    expect(lookupRateLimitedText(limited(null))).toBe('Tra quá nhiều lần. Thử lại sau 60 giây.');
  });

  it('chỉ lỗi mạng và 5xx mới bấm lại bằng cùng khóa', () => {
    expect(isRetryableCheckInError(new ApiError('SERVICE_UNAVAILABLE', 'x', null, null))).toBe(true);
    expect(isRetryableCheckInError(new ApiError('INTERNAL_ERROR', 'x', null, 500))).toBe(true);
    expect(isRetryableCheckInError(new ApiError('SERVICE_UNAVAILABLE', 'x', null, 503))).toBe(true);
    expect(isRetryableCheckInError(new ApiError('VALIDATION_FAILED', 'x', null, 400))).toBe(false);
    expect(isRetryableCheckInError(new ApiError('NOT_A_MEMBER', 'x', null, 403))).toBe(false);
    expect(isRetryableCheckInError(new Error('x'))).toBe(false);
  });

  it('ok/recent/already đổi hàng thành Đã check-in; invalid thì không', () => {
    expect(marksCheckedIn({ outcome: 'ok', holderName: 'A', seq: 1, count: 1, ticketTypeName: 'B' })).toBe(true);
    expect(marksCheckedIn({ outcome: 'recent' })).toBe(true);
    expect(
      marksCheckedIn({ outcome: 'already', checkedInAt: '2026-11-25T19:05:00+07:00', checkedBy: { kind: 'self' } }),
    ).toBe(true);
    expect(marksCheckedIn({ outcome: 'invalid', reason: 'EVENT_ENDED' })).toBe(false);
  });

  it('withCheckedIn chỉ đổi đúng Vé; hasUncheckedTickets quyết định mở lại Sheet', () => {
    const data = { tickets: [ticket(1), ticket(2)] };
    const after = withCheckedIn(data, ticket(1).ticketId);
    expect(after).toEqual({ tickets: [ticket(1, true), ticket(2)] });
    expect(data.tickets[0]!.checkedIn).toBe(false);
    expect(hasUncheckedTickets(after)).toBe(true);
    expect(hasUncheckedTickets(withCheckedIn(after, ticket(2).ticketId))).toBe(false);
    expect(hasUncheckedTickets({ tickets: [] })).toBe(false);
    expect(hasUncheckedTickets(undefined)).toBe(false);
  });
});
