import type { EventStatus } from '@tickee/contracts';
import { describe, expect, it } from 'vitest';

import { eventBadge, isEventEnded } from '@/app/(dashboard)/btc/[orgId]/su-kien/event-status';

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

  it('effectiveEndAt đúng bằng bây giờ tính là đã kết thúc', () => {
    expect(isEventEnded(event('published', '2026-11-16T10:00:00+07:00'), NOW)).toBe(true);
  });
});
