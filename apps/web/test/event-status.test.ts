import type { EventSaleReason, EventStatus } from '@tickee/contracts';
import { describe, expect, it } from 'vitest';

import { eventBadge, eventSaleBadge, isEventEnded } from '@/app/(dashboard)/btc/[orgId]/su-kien/event-status';

/* Badge "Đã kết thúc" (Story 2.12): chỉ `published`/`hidden` có `effectiveEndAt` ≤ bây giờ. */

const NOW = Date.parse('2026-11-16T10:00:00+07:00');
const PAST = '2026-11-16T09:59:59+07:00';
const FUTURE = '2026-11-16T23:59:59+07:00';
const event = (status: EventStatus, effectiveEndAt: string) => ({ status, effectiveEndAt });

describe('isEventEnded / eventBadge', () => {
  it.each([
    ['published', PAST, true, 'Đã kết thúc', 'neutral'],
    ['hidden', PAST, true, 'Đã kết thúc', 'neutral'],
    ['published', FUTURE, false, 'Đang mở bán', 'success'],
    ['hidden', FUTURE, false, 'Ẩn', 'warning'],
    ['draft', PAST, false, 'Nháp', 'neutral'],
    ['draft', FUTURE, false, 'Nháp', 'neutral'],
    ['cancelled', PAST, false, 'Đã hủy', 'danger'],
    ['cancelled', FUTURE, false, 'Đã hủy', 'danger'],
  ] as const)('%s, effectiveEndAt %s → ended %s, badge %s', (status, end, ended, label, tone) => {
    expect(isEventEnded(event(status, end), NOW)).toBe(ended);
    expect(eventBadge(event(status, end), NOW)).toEqual({ label, tone });
  });

  it.each(['published', 'hidden'] as const)(
    '%s có endedManuallyAt, effectiveEndAt còn tương lai (đồng hồ máy khách chậm) → đã kết thúc',
    (status) => {
      const ended = { ...event(status, FUTURE), endedManuallyAt: FUTURE };
      expect(isEventEnded(ended, NOW)).toBe(true);
      expect(eventBadge(ended, NOW)).toEqual({ label: 'Đã kết thúc', tone: 'neutral' });
    },
  );

  it('cancelled có endedManuallyAt → không tính là đã kết thúc, badge "Đã hủy"', () => {
    const cancelled = { ...event('cancelled', PAST), endedManuallyAt: PAST };
    expect(isEventEnded(cancelled, NOW)).toBe(false);
    expect(eventBadge(cancelled, NOW).label).toBe('Đã hủy');
  });

  it('endedManuallyAt null vẫn dùng đồng hồ', () => {
    expect(isEventEnded({ ...event('published', FUTURE), endedManuallyAt: null }, NOW)).toBe(false);
    expect(isEventEnded({ ...event('published', PAST), endedManuallyAt: null }, NOW)).toBe(true);
  });

  it('effectiveEndAt đúng bằng bây giờ tính là đã kết thúc', () => {
    expect(isEventEnded(event('published', '2026-11-16T10:00:00+07:00'), NOW)).toBe(true);
  });
});

/* Story 4.2-c (retro Epic 2 C5): nhãn lấy từ trạng thái bán của api (`reason`, `partial`), dự phòng bằng `eventBadge`. */
describe('eventSaleBadge', () => {
  const sale = (reason: EventSaleReason | null, partial = false) => ({ reason, partial });

  it.each([
    [null, false, 'Đang mở bán', 'success'],
    ['paused', false, 'Tạm ngừng bán', 'warning'],
    ['paused', true, 'Tạm ngừng bán một phần', 'warning'],
    ['hidden', false, 'Ẩn', 'warning'],
    ['ended', false, 'Đã kết thúc', 'neutral'],
    ['locked', false, 'Bị khóa', 'danger'],
    ['cancelled', false, 'Đã hủy', 'danger'],
  ] as const)('reason %s, partial %s → %s (%s)', (reason, partial, label, tone) => {
    expect(eventSaleBadge(event('published', FUTURE), sale(reason, partial), NOW)).toEqual({ label, tone });
  });

  it('api thắng cách tính ở máy khách: đồng hồ máy khách chậm (effectiveEndAt còn tương lai) mà api báo ended', () => {
    expect(eventSaleBadge(event('published', FUTURE), sale('ended'), NOW)).toEqual({
      label: 'Đã kết thúc',
      tone: 'neutral',
    });
    // Ngược lại: đồng hồ máy khách nhanh, api (đồng hồ máy chủ) vẫn đang bán.
    expect(eventSaleBadge(event('published', PAST), sale(null), NOW)).toEqual({ label: 'Đang mở bán', tone: 'success' });
  });

  it('nháp → "Nháp" không cần api (kể cả khi có dữ liệu)', () => {
    expect(eventSaleBadge(event('draft', FUTURE), undefined, NOW)).toEqual({ label: 'Nháp', tone: 'neutral' });
    expect(eventSaleBadge(event('draft', FUTURE), sale(null), NOW)).toEqual({ label: 'Nháp', tone: 'neutral' });
  });

  it.each([
    ['published', FUTURE],
    ['published', PAST],
    ['hidden', FUTURE],
    ['hidden', PAST],
    ['cancelled', FUTURE],
  ] as const)('chưa có trạng thái bán (đang tải, lỗi, không có trong danh sách): %s, %s → như eventBadge', (status, end) => {
    expect(eventSaleBadge(event(status, end), undefined, NOW)).toEqual(eventBadge(event(status, end), NOW));
  });

  it('dự phòng giữ "Đã kết thúc" theo endedManuallyAt', () => {
    expect(eventSaleBadge({ ...event('published', FUTURE), endedManuallyAt: FUTURE }, undefined, NOW).label).toBe(
      'Đã kết thúc',
    );
  });
});
