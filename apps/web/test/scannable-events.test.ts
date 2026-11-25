import type { EventStatus, EventSummary } from '@tickee/contracts';
import { describe, expect, it } from 'vitest';

import { scannableEvents } from '@/app/(dashboard)/btc/[orgId]/quet-ve/scannable-events';

/*
 * Sự kiện của tab "Quét vé" (Story 5.3): chỉ `published`/`hidden` chưa kết thúc; giờ bắt đầu gần bây giờ nhất trước
 * (khoảng cách tuyệt đối, không phải tăng dần); hòa thì theo tên, so theo tiếng Việt.
 */

const NOW = Date.parse('2026-11-25T10:00:00+07:00');
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const FAR_END = iso(NOW + 30 * 24 * HOUR);

let seq = 0;
const event = (
  name: string,
  { status = 'published', startsAt = iso(NOW), effectiveEndAt = FAR_END }: { status?: EventStatus; startsAt?: string; effectiveEndAt?: string } = {},
): EventSummary => {
  seq += 1;
  return {
    id: `019a3b2c-0e00-7abc-8def-${String(seq).padStart(12, '0')}`,
    slug: `su-kien-${seq}`,
    name,
    status,
    startsAt,
    endsAt: startsAt,
    effectiveEndAt,
    imageUrl: null,
  };
};
const names = (events: EventSummary[]) => events.map((e) => e.name);

describe('scannableEvents', () => {
  it('giữ published và hidden chưa kết thúc; bỏ nháp, đã hủy, đã kết thúc (kể cả effectiveEndAt đúng bằng bây giờ)', () => {
    const events = [
      event('Nháp', { status: 'draft' }),
      event('Đã hủy', { status: 'cancelled' }),
      event('Đã kết thúc', { effectiveEndAt: iso(NOW - HOUR) }),
      event('Kết thúc đúng lúc này', { effectiveEndAt: iso(NOW) }),
      event('Đang mở bán', { status: 'published', startsAt: iso(NOW + HOUR) }),
      event('Đang ẩn', { status: 'hidden', startsAt: iso(NOW + 2 * HOUR) }),
    ];
    expect(names(scannableEvents(events, NOW))).toEqual(['Đang mở bán', 'Đang ẩn']);
  });

  it('gần bây giờ nhất trước theo khoảng cách tuyệt đối: bắt đầu sau 1 giờ đứng trước bắt đầu 5 giờ trước', () => {
    const events = [event('Bắt đầu 5 giờ trước', { startsAt: iso(NOW - 5 * HOUR) }), event('Sau 1 giờ', { startsAt: iso(NOW + HOUR) })];
    expect(names(scannableEvents(events, NOW))).toEqual(['Sau 1 giờ', 'Bắt đầu 5 giờ trước']);
  });

  it('cùng giờ bắt đầu: theo tên, so theo tiếng Việt (Ă sau A trước B, Đ sau D)', () => {
    const startsAt = iso(NOW + HOUR);
    const events = ['Giải B', 'Đêm nhạc', 'Ăn tối', 'Dạ tiệc', 'An vui'].map((name) => event(name, { startsAt }));
    expect(names(scannableEvents(events, NOW))).toEqual(['An vui', 'Ăn tối', 'Dạ tiệc', 'Đêm nhạc', 'Giải B']);
  });

  it('không đổi mảng đầu vào', () => {
    const events = [event('B', { startsAt: iso(NOW + 2 * HOUR) }), event('A', { startsAt: iso(NOW + HOUR) })];
    scannableEvents(events, NOW);
    expect(names(events)).toEqual(['B', 'A']);
  });
});
