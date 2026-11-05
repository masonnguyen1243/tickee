import { describe, expect, it } from 'vitest';
import { ErrorCode } from '../src/errors.js';
import {
  EVENT_SLUG_BASE_MAX,
  EventDraftInput,
  isEventYearInRange,
  effectiveEndAt,
  eventIsoToLocal,
  eventLocalToIso,
  eventPath,
  formatEventDateTime,
  slugBase,
  toEventIso,
} from '../src/event.js';

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

describe('đường dẫn và mã lỗi', () => {
  it('eventPath', () => {
    expect(eventPath('o1', 'e1')).toBe('/btc/o1/su-kien/e1');
    expect(eventPath('o1', 'e1', 'thiet-lap')).toBe('/btc/o1/su-kien/e1/thiet-lap');
  });

  it('EVENT_NOT_FOUND', () => {
    expect(ErrorCode.EVENT_NOT_FOUND).toBe('EVENT_NOT_FOUND');
  });
});
