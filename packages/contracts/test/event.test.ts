import { describe, expect, it } from 'vitest';
import { ErrorCode } from '../src/errors.js';
import {
  EVENT_SLUG_BASE_MAX,
  EventBuyerCount,
  EventDraftInput,
  EventPendingPaymentCount,
  eventBuyerCountApiPath,
  eventPendingPaymentCountApiPath,
  isEventYearInRange,
  effectiveEndAt,
  eventIsoToLocal,
  eventLocalToIso,
  eventPath,
  formatEventDateTime,
  formatEventTimeRange,
  formatVnDate,
  formatVnDateTime,
  formatVnDayTime,
  formatVnTime,
  isSameVnDay,
  notifiesBuyers,
  publicEventTag,
  slugBase,
  timeOrVenueChanged,
  toEventIso,
  type EventBeforeEdit,
} from '../src/event.js';
import { JobQueue, SendEventChangeEmailPayload } from '../src/jobs.js';

const at = (iso: string) => new Date(iso);
const effective = (endsAt: string) => toEventIso(effectiveEndAt(at(endsAt)));

describe('effectiveEndAt (giờ Asia/Ho_Chi_Minh)', () => {
  it('kết thúc trong ngày → 23:59:59 ngày kết thúc', () => {
    expect(effective('2026-11-16T17:00:00+07:00')).toBe('2026-11-16T23:59:59+07:00');
  });

  it('kết thúc khuya → giờ kết thúc + 6 giờ (sang ngày sau)', () => {
    expect(effective('2026-11-16T20:00:00+07:00')).toBe('2026-11-17T02:00:00+07:00');
  });

  it('đúng 17:59:59 thì hai mốc bằng nhau', () => {
    expect(effective('2026-11-16T17:59:59+07:00')).toBe('2026-11-16T23:59:59+07:00');
  });

  it('ngày tính theo giờ Việt Nam, không theo UTC (01:00 +07 là 18:00 UTC hôm trước)', () => {
    expect(effective('2026-11-16T01:00:00+07:00')).toBe('2026-11-16T23:59:59+07:00');
    expect(effective('2026-11-15T18:00:00Z')).toBe('2026-11-16T23:59:59+07:00');
  });

  it('ngày cuối tháng và cuối năm', () => {
    expect(effective('2026-11-30T21:30:00+07:00')).toBe('2026-12-01T03:30:00+07:00');
    expect(effective('2026-12-31T10:00:00+07:00')).toBe('2026-12-31T23:59:59+07:00');
    expect(effective('2026-12-31T23:00:00+07:00')).toBe('2027-01-01T05:00:00+07:00');
    expect(effective('2028-02-28T22:00:00+07:00')).toBe('2028-02-29T04:00:00+07:00');
  });
});

describe('slugBase', () => {
  it('bỏ dấu, đ → d, chữ thường', () => {
    expect(slugBase('Giải chạy Hà Nội 2026')).toBe('giai-chay-ha-noi-2026');
    expect(slugBase('Đêm nhạc ĐỘC LẬP')).toBe('dem-nhac-doc-lap');
    expect(slugBase('Ngày hội Ẩm thực Huế – Ổn định')).toBe('ngay-hoi-am-thuc-hue-on-dinh');
  });

  it('cụm ký tự lạ thành một dấu -, bỏ - ở hai đầu', () => {
    expect(slugBase('  !!Rock & Roll // Đà Lạt??  ')).toBe('rock-roll-da-lat');
    expect(slugBase('a__b..c')).toBe('a-b-c');
  });

  it('tên rỗng hoặc không còn chữ/số → su-kien', () => {
    expect(slugBase('')).toBe('su-kien');
    expect(slugBase('   ')).toBe('su-kien');
    expect(slugBase('🎉 !!! 🎶')).toBe('su-kien');
  });

  it(`cắt tối đa ${EVENT_SLUG_BASE_MAX} ký tự, không để - ở cuối`, () => {
    const long = slugBase('a'.repeat(100));
    expect(long).toBe('a'.repeat(EVENT_SLUG_BASE_MAX));
    const cut = slugBase(`${'b'.repeat(59)} cde`);
    expect(cut).toBe('b'.repeat(59));
    expect(cut.length).toBeLessThanOrEqual(EVENT_SLUG_BASE_MAX);
  });
});

describe('EventDraftInput', () => {
  const valid = {
    name: '  Giải chạy  ',
    startsAt: '2026-11-16T07:00:00+07:00',
    endsAt: '2026-11-16T17:00:00+07:00',
  };

  it('chỉ cần tên và giờ; trường tùy chọn trống → null', () => {
    const parsed = EventDraftInput.parse({ ...valid, venue: '   ', description: null });
    expect(parsed).toEqual({ ...valid, name: 'Giải chạy', venue: null, description: null, refundPolicy: null });
  });

  it('thiếu giờ, giờ không có offset, kết thúc ≤ bắt đầu → lỗi ở đúng trường', () => {
    const paths = (input: unknown) => {
      const result = EventDraftInput.safeParse(input);
      return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
    };
    expect(paths({ name: 'A' })).toEqual(expect.arrayContaining(['startsAt', 'endsAt']));
    expect(paths({ ...valid, startsAt: '2026-11-16T07:00' })).toEqual(['startsAt']);
    // Phần lẻ của giây hoặc thiếu giây: API trả giờ theo giây, nhận vào cũng phải theo giây.
    expect(paths({ ...valid, startsAt: '2026-11-16T07:00:00.500+07:00' })).toEqual(['startsAt']);
    expect(paths({ ...valid, startsAt: '2026-11-16T07:00+07:00' })).toEqual(['startsAt']);
    expect(paths({ ...valid, endsAt: valid.startsAt })).toEqual(['endsAt']);
    expect(paths({ ...valid, endsAt: '2026-11-16T06:00:00+07:00' })).toEqual(['endsAt']);
    expect(paths({ ...valid, name: '   ' })).toEqual(['name']);
  });

  it('năm (theo +07:00) ngoài 2000–2100 → lỗi ở đúng trường', () => {
    const paths = (input: unknown) => {
      const result = EventDraftInput.safeParse(input);
      return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
    };
    expect(paths({ ...valid, startsAt: '0026-11-16T07:00:00+07:00' })).toEqual(['startsAt']);
    expect(paths({ ...valid, endsAt: '9999-12-31T23:00:00+07:00' })).toEqual(['endsAt']);
    expect(paths({ ...valid, startsAt: '1999-12-31T23:59:00+07:00' })).toEqual(['startsAt']);
    // 31/12/2100 16:59 UTC là 23:59 ngày 31/12/2100 theo +07:00: vẫn trong khoảng.
    expect(paths({ ...valid, startsAt: '2100-12-31T22:00:00+07:00', endsAt: '2100-12-31T16:59:00Z' })).toEqual([]);
    // 2000-01-01 00:00 +07:00 là 1999 theo UTC: vẫn trong khoảng (tính theo giờ Việt Nam).
    expect(paths({ ...valid, startsAt: '2000-01-01T00:00:00+07:00' })).toEqual([]);
    expect(isEventYearInRange('2101-01-01T00:00:00+07:00')).toBe(false);
  });
});

describe('giờ nhập trên web luôn theo +07:00', () => {
  it('datetime-local ↔ ISO có offset', () => {
    expect(eventLocalToIso('2026-11-16T07:00')).toBe('2026-11-16T07:00:00+07:00');
    expect(eventLocalToIso('')).toBe('');
    expect(eventIsoToLocal('2026-11-16T07:00:00+07:00')).toBe('2026-11-16T07:00');
    expect(eventIsoToLocal('2026-11-16T00:00:00Z')).toBe('2026-11-16T07:00');
  });

  // 16/11/2026 là thứ Hai (ví dụ "Chủ nhật, 16/11/2026" trong spec/DESIGN chỉ minh họa định dạng); 15/11/2026 là Chủ nhật.
  it('hiển thị "<Thứ>, dd/mm/yyyy · HH:mm"', () => {
    expect(formatEventDateTime('2026-11-15T07:00:00+07:00')).toBe('Chủ nhật, 15/11/2026 · 07:00');
    expect(formatEventDateTime('2026-11-16T07:00:00+07:00')).toBe('Thứ hai, 16/11/2026 · 07:00');
    expect(formatEventDateTime('2026-11-17T00:30:00Z')).toBe('Thứ ba, 17/11/2026 · 07:30');
  });
});

describe('formatEventTimeRange', () => {
  it('cùng ngày → chỉ ghi giờ kết thúc', () => {
    expect(formatEventTimeRange('2026-11-15T07:00:00+07:00', '2026-11-15T17:00:00+07:00')).toBe(
      'Chủ nhật, 15/11/2026 · 07:00 – 17:00',
    );
  });

  it('khác ngày → ghi đủ hai đầu', () => {
    expect(formatEventTimeRange('2026-11-15T19:00:00+07:00', '2026-11-16T01:00:00+07:00')).toBe(
      'Chủ nhật, 15/11/2026 · 19:00 – Thứ hai, 16/11/2026 · 01:00',
    );
  });

  it('so ngày theo giờ Việt Nam, không theo UTC', () => {
    // 16/11 23:00 UTC = 17/11 06:00 giờ VN; cùng ngày 17/11 với 17/11 10:00 giờ VN.
    expect(formatEventTimeRange('2026-11-16T23:00:00Z', '2026-11-17T10:00:00+07:00')).toBe(
      'Thứ ba, 17/11/2026 · 06:00 – 10:00',
    );
  });
});

describe('formatVnDateTime / formatVnDate (offset +07:00 cố định, không Intl)', () => {
  it('HH:mm dd/MM/yyyy và dd/MM/yyyy; nhận Date hoặc chuỗi ISO', () => {
    expect(formatVnDateTime(new Date('2026-11-08T03:04:00.000Z'))).toBe('10:04 08/11/2026');
    expect(formatVnDateTime('2026-11-08T10:04:00+07:00')).toBe('10:04 08/11/2026');
    expect(formatVnDate(new Date('2026-11-08T03:04:00.000Z'))).toBe('08/11/2026');
    expect(formatVnDate('2026-11-08T10:04:00+07:00')).toBe('08/11/2026');
  });

  it('qua nửa đêm giờ Việt Nam: 17:00 UTC là 00:00 hôm sau; 16:59 UTC vẫn là hôm trước', () => {
    expect(formatVnDateTime('2026-11-16T17:00:00Z')).toBe('00:00 17/11/2026');
    expect(formatVnDate('2026-11-16T17:00:00Z')).toBe('17/11/2026');
    expect(formatVnDateTime('2026-11-16T16:59:00Z')).toBe('23:59 16/11/2026');
    expect(formatVnDate('2026-11-16T16:59:00Z')).toBe('16/11/2026');
  });

  it('qua năm mới giờ Việt Nam khi UTC vẫn là 31/12', () => {
    expect(formatVnDateTime('2026-12-31T17:30:00Z')).toBe('00:30 01/01/2027');
    expect(formatVnDate('2026-12-31T17:30:00Z')).toBe('01/01/2027');
    expect(formatVnDateTime('2026-12-31T16:59:00Z')).toBe('23:59 31/12/2026');
    expect(formatVnDate('2026-12-31T16:59:00Z')).toBe('31/12/2026');
  });
});

describe('formatVnTime / formatVnDayTime / isSameVnDay (Story 3.11, offset +07:00 cố định)', () => {
  it('HH:mm và dd/MM · HH:mm; nhận Date, chuỗi ISO hoặc mili giây', () => {
    expect(formatVnTime(new Date('2026-11-08T03:04:00.000Z'))).toBe('10:04');
    expect(formatVnTime('2026-11-08T10:04:00+07:00')).toBe('10:04');
    expect(formatVnTime(Date.parse('2026-11-08T03:04:59.999Z'))).toBe('10:04');
    expect(formatVnDayTime('2026-11-08T10:04:00+07:00')).toBe('08/11 · 10:04');
    expect(formatVnDayTime(new Date('2026-01-02T00:05:00.000Z'))).toBe('02/01 · 07:05');
  });

  it('qua nửa đêm giờ Việt Nam: 17:00 UTC là 00:00 hôm sau', () => {
    expect(formatVnTime('2026-11-16T17:00:00Z')).toBe('00:00');
    expect(formatVnDayTime('2026-11-16T17:00:00Z')).toBe('17/11 · 00:00');
    expect(formatVnDayTime('2026-11-16T16:59:00Z')).toBe('16/11 · 23:59');
  });

  it('cùng ngày lịch giờ Việt Nam, không theo UTC', () => {
    // 16/11 23:30 UTC và 17/11 01:00 UTC: đều là ngày 17/11 giờ Việt Nam.
    expect(isSameVnDay('2026-11-16T23:30:00Z', '2026-11-17T01:00:00Z')).toBe(true);
    // 16/11 16:59 UTC (23:59 giờ VN) và 16/11 17:00 UTC (00:00 hôm sau giờ VN): khác ngày dù cùng ngày UTC.
    expect(isSameVnDay('2026-11-16T16:59:00Z', '2026-11-16T17:00:00Z')).toBe(false);
    expect(isSameVnDay(new Date('2026-11-08T10:04:00+07:00'), Date.parse('2026-11-08T00:00:00+07:00'))).toBe(true);
    // Cùng ngày và tháng nhưng khác năm.
    expect(isSameVnDay('2026-11-08T10:04:00+07:00', '2027-11-08T10:04:00+07:00')).toBe(false);
  });
});

describe('đường dẫn và mã lỗi', () => {
  it('publicEventTag', () => {
    expect(publicEventTag('giai-chay-ab12')).toBe('event:giai-chay-ab12');
  });

  it('eventPath', () => {
    expect(eventPath('o1', 'e1')).toBe('/btc/o1/su-kien/e1');
    expect(eventPath('o1', 'e1', 'thiet-lap')).toBe('/btc/o1/su-kien/e1/thiet-lap');
  });

  it('EVENT_NOT_FOUND', () => {
    expect(ErrorCode.EVENT_NOT_FOUND).toBe('EVENT_NOT_FOUND');
  });
});

describe('báo Người mua khi đổi giờ hoặc địa điểm (Story 3.10)', () => {
  const START = '2099-11-16T07:00:00+07:00';
  const END = '2099-11-16T17:00:00+07:00';
  const before = (overrides: Partial<EventBeforeEdit> = {}): EventBeforeEdit => ({
    status: 'published',
    startsAt: START,
    endsAt: END,
    venue: 'Hồ Gươm',
    endedManuallyAt: null,
    ...overrides,
  });
  const same = { startsAt: START, endsAt: END, venue: 'Hồ Gươm' };
  const NOW = Date.parse('2099-11-10T00:00:00Z');

  it('timeOrVenueChanged: giờ so theo mốc (khác offset vẫn là cùng mốc), venue so giá trị', () => {
    expect(timeOrVenueChanged(before(), same)).toBe(false);
    expect(timeOrVenueChanged(before(), { ...same, startsAt: '2099-11-16T00:00:00Z' })).toBe(false);
    expect(timeOrVenueChanged(before(), { ...same, startsAt: new Date('2099-11-16T00:00:00Z') })).toBe(false);
    expect(timeOrVenueChanged(before(), { ...same, startsAt: '2099-11-16T08:00:00+07:00' })).toBe(true);
    expect(timeOrVenueChanged(before(), { ...same, endsAt: '2099-11-16T18:00:00+07:00' })).toBe(true);
    expect(timeOrVenueChanged(before(), { ...same, venue: 'Sân Mỹ Đình' })).toBe(true);
    expect(timeOrVenueChanged(before(), { ...same, venue: null })).toBe(true);
    expect(timeOrVenueChanged(before({ venue: null }), { ...same, venue: null })).toBe(false);
  });

  it('published/hidden + đổi giờ hoặc địa điểm + chưa kết thúc sau khi sửa → báo', () => {
    for (const status of ['published', 'hidden'] as const) {
      expect(notifiesBuyers(before({ status }), { ...same, startsAt: '2099-11-16T08:00:00+07:00' }, NOW)).toBe(true);
      expect(notifiesBuyers(before({ status }), { ...same, venue: 'Sân Mỹ Đình' }, new Date(NOW))).toBe(true);
    }
  });

  it('nháp hoặc đã hủy → không báo', () => {
    for (const status of ['draft', 'cancelled'] as const) {
      expect(notifiesBuyers(before({ status }), { ...same, venue: 'Sân Mỹ Đình' }, NOW)).toBe(false);
    }
  });

  it('không đổi giờ/địa điểm (chỉ tên, mô tả…) → không báo', () => {
    expect(notifiesBuyers(before(), same, NOW)).toBe(false);
    expect(notifiesBuyers(before(), { ...same, startsAt: '2099-11-16T00:00:00Z' }, NOW)).toBe(false);
  });

  it('sau khi sửa vẫn đã kết thúc (effectiveEndAt của endsAt mới ≤ now) → không báo; dời sang tương lai → báo', () => {
    const past = before({ startsAt: '2020-11-16T07:00:00+07:00', endsAt: '2020-11-16T17:00:00+07:00' });
    expect(
      notifiesBuyers(past, { startsAt: '2020-11-16T07:00:00+07:00', endsAt: '2020-11-16T17:00:00+07:00', venue: 'X' }, NOW),
    ).toBe(false);
    expect(notifiesBuyers(past, same, NOW)).toBe(true);
    // Biên: mốc kết thúc mới đúng bằng now → đã kết thúc.
    const end = effectiveEndAt(new Date(END)).getTime();
    expect(notifiesBuyers(before(), { ...same, venue: 'X' }, end)).toBe(false);
    expect(notifiesBuyers(before(), { ...same, venue: 'X' }, end - 1)).toBe(true);
  });

  it('đã bấm "Kết thúc" → không bao giờ báo, kể cả dời endsAt sang tương lai hay đồng hồ máy chậm hơn mốc bấm', () => {
    const ended = before({ endedManuallyAt: '2099-11-09T09:30:00+07:00' });
    expect(notifiesBuyers(ended, { ...same, endsAt: '2099-11-20T17:00:00+07:00' }, NOW)).toBe(false);
    expect(notifiesBuyers(ended, { ...same, venue: 'X' }, Date.parse('2099-11-09T02:00:00Z'))).toBe(false);
  });

  it('EventBuyerCount, đường API và payload job', () => {
    expect(EventBuyerCount.parse({ buyers: 3 })).toEqual({ buyers: 3 });
    expect(EventBuyerCount.safeParse({ buyers: -1 }).success).toBe(false);
    expect(eventBuyerCountApiPath('o1', 'e1')).toBe('/orgs/o1/events/e1/buyer-count');
    expect(JobQueue.ORDERING_SEND_EVENT_CHANGE_EMAIL).toBe('ordering.send-event-change-email');
    const eventId = '019a3b2c-0712-7abc-8def-0123456789ab';
    expect(SendEventChangeEmailPayload.parse({ eventId, version: 1 })).toEqual({ eventId, version: 1 });
    expect(SendEventChangeEmailPayload.safeParse({ eventId, version: 0 }).success).toBe(false);
    expect(SendEventChangeEmailPayload.safeParse({ eventId, version: 1, userId: 'x' }).success).toBe(false);
  });

  it('EventPendingPaymentCount và đường API (E3-2)', () => {
    expect(EventPendingPaymentCount.parse({ orders: 2 })).toEqual({ orders: 2 });
    expect(EventPendingPaymentCount.safeParse({ orders: -1 }).success).toBe(false);
    expect(EventPendingPaymentCount.safeParse({ orders: 1.5 }).success).toBe(false);
    expect(eventPendingPaymentCountApiPath('o1', 'e1')).toBe('/orgs/o1/events/e1/pending-payment-count');
  });
});
