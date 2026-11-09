import type { EventAvailability, PublicEvent, TierAvailability } from '@tickee/contracts';
import { describe, expect, it } from 'vitest';

import {
  checkoutLines,
  checkoutSelection,
  clampSelection,
  EMPTY_SELECTION,
  isFreeEvent,
  plusCeiling,
  priceLabel,
  purchaseBarState,
  sameSelection,
  selectionFromItems,
  selectionItems,
  selectionTotals,
  setQuantity,
  withSelection,
  type Selection,
} from '@/lib/event/selection';

const A = '019a3b2c-0800-7abc-8def-00000000000a';
const B = '019a3b2c-0800-7abc-8def-00000000000b';
const C = '019a3b2c-0800-7abc-8def-00000000000c';
const UNKNOWN = '019a3b2c-0800-7abc-8def-0000000000ff';

const ticketType = (id: string, name: string, price: number) => ({
  id,
  name,
  description: null,
  price,
  saleStartsAt: null as string | null,
  saleEndsAt: null as string | null,
});

const event: PublicEvent = {
  slug: 'giai-chay-ab12',
  name: 'Giải chạy',
  status: 'published',
  startsAt: '2099-11-15T07:00:00+07:00',
  endsAt: '2099-11-15T17:00:00+07:00',
  venue: null,
  description: null,
  refundPolicy: 'Hoàn 100%.',
  organizationName: 'CLB Chạy',
  maxTicketsPerOrder: 4,
  ticketTypes: [ticketType(A, 'Vé VIP', 300_000), ticketType(B, 'Phổ thông', 100_000), ticketType(C, 'Miễn phí', 0)],
};

const tier = (ticketTypeId: string, patch: Partial<TierAvailability> = {}): TierAvailability => ({
  ticketTypeId,
  status: 'on_sale',
  remaining: 50,
  saleStartsAt: null,
  ...patch,
});
const availability = (tiers: TierAvailability[], eventReason: EventAvailability['eventReason'] = null) => ({
  eventReason,
  tiers,
});
const sel = (entries: [string, number][]): Selection => new Map(entries);
const NOW = new Date('2026-11-09T10:00:00+07:00');

describe('trần "+" = min(remaining, giới hạn − đã chọn ở hạng khác)', () => {
  it('Matrix: A còn 3, B còn 20, giới hạn 4; chọn A=3 → "+" của A chặn ở 3, của B chặn ở 1', () => {
    const selection = sel([[A, 3]]);
    expect(plusCeiling(A, selection, tier(A, { remaining: 3 }), 4)).toBe(3);
    expect(plusCeiling(B, selection, tier(B, { remaining: 20 }), 4)).toBe(1);
    expect(plusCeiling(B, sel([[A, 3], [B, 1]]), tier(B, { remaining: 20 }), 4)).toBe(1);
  });

  it('hạng không on_sale hoặc chưa có số vé → 0; không bao giờ âm', () => {
    expect(plusCeiling(A, EMPTY_SELECTION, tier(A, { status: 'sold_out', remaining: 0 }), 4)).toBe(0);
    expect(plusCeiling(A, EMPTY_SELECTION, tier(A, { status: 'paused' }), 4)).toBe(0);
    expect(plusCeiling(A, EMPTY_SELECTION, undefined, 4)).toBe(0);
    expect(plusCeiling(A, sel([[B, 6]]), tier(A), 4)).toBe(0);
  });
});

describe('setQuantity / sameSelection', () => {
  it('0 → bỏ khỏi lựa chọn; không sửa lựa chọn cũ', () => {
    const before = sel([[A, 1]]);
    const after = setQuantity(before, A, 0);
    expect([...after]).toEqual([]);
    expect([...before]).toEqual([[A, 1]]);
    expect(sameSelection(setQuantity(before, B, 2), sel([[A, 1], [B, 2]]))).toBe(true);
    expect(sameSelection(before, sel([[A, 2]]))).toBe(false);
  });
});

describe('clampSelection: kẹp theo availability và giới hạn, không bao giờ tăng', () => {
  it('remaining giảm khi refetch → kẹp xuống', () => {
    const clamped = clampSelection(sel([[A, 3]]), event.ticketTypes, availability([tier(A, { remaining: 1 })]), 4);
    expect([...clamped]).toEqual([[A, 1]]);
  });

  it('hạng hết / tạm ngừng / không còn trong Sự kiện → bỏ', () => {
    const clamped = clampSelection(
      sel([[A, 1], [B, 2], [UNKNOWN, 1]]),
      event.ticketTypes,
      availability([tier(A, { status: 'sold_out', remaining: 0 }), tier(B, { status: 'paused' })]),
      4,
    );
    expect([...clamped]).toEqual([]);
  });

  it('tổng vượt giới hạn → hạng đứng sau bị cắt trước (theo thứ tự Hạng vé)', () => {
    const clamped = clampSelection(
      sel([[C, 3], [A, 3]]),
      event.ticketTypes,
      availability([tier(A), tier(B), tier(C)]),
      4,
    );
    expect([...clamped]).toEqual([
      [A, 3],
      [C, 1],
    ]);
  });

  it('remaining tăng lại → giữ nguyên, không tự tăng', () => {
    const clamped = clampSelection(sel([[A, 1]]), event.ticketTypes, availability([tier(A, { remaining: 30 })]), 4);
    expect([...clamped]).toEqual([[A, 1]]);
  });
});

describe('tổng vé/tiền, dòng Checkout, URL', () => {
  it('tổng theo giá từng hạng; 0đ hiện "Miễn phí"', () => {
    expect(selectionTotals(sel([[A, 2], [C, 1]]), event.ticketTypes)).toEqual({ count: 3, amount: 600_000 });
    expect(selectionTotals(EMPTY_SELECTION, event.ticketTypes)).toEqual({ count: 0, amount: 0 });
    expect(priceLabel(0)).toBe('Miễn phí');
    expect(priceLabel(300_000)).toBe('300.000đ');
  });

  it('dòng và URL theo thứ tự Hạng vé, không theo thứ tự chọn', () => {
    const selection = sel([[C, 1], [A, 2]]);
    expect(selectionItems(selection, event.ticketTypes)).toEqual([
      { ticketTypeId: A, quantity: 2 },
      { ticketTypeId: C, quantity: 1 },
    ]);
    expect(withSelection('/e/giai-chay-ab12/checkout', selection, event.ticketTypes)).toBe(
      `/e/giai-chay-ab12/checkout?items=${A}:2,${C}:1`,
    );
    expect(withSelection('/e/giai-chay-ab12', EMPTY_SELECTION, event.ticketTypes)).toBe('/e/giai-chay-ab12');
    expect(checkoutLines(selection, event.ticketTypes)).toEqual([
      { ticketTypeId: A, name: 'Vé VIP', price: 300_000, quantity: 2, amount: 600_000 },
      { ticketTypeId: C, name: 'Miễn phí', price: 0, quantity: 1, amount: 0 },
    ]);
  });

  it('Sự kiện miễn phí = có Hạng vé và mọi hạng 0đ', () => {
    expect(isFreeEvent([{ id: C, price: 0 }])).toBe(true);
    expect(isFreeEvent(event.ticketTypes)).toBe(false);
    expect(isFreeEvent([])).toBe(false);
  });
});

describe('hợp lệ hóa items theo PublicEvent', () => {
  it('hợp lệ → lựa chọn', () => {
    expect([...selectionFromItems(`${A}:2,${C}:2`, event)!]).toEqual([
      [A, 2],
      [C, 2],
    ]);
  });

  it.each([
    ['id lạ', `${UNKNOWN}:1`],
    ['qty 0', `${A}:0`],
    ['qty không nguyên', `${A}:1.5`],
    ['tổng > giới hạn', `${A}:3,${B}:2`],
    ['id trùng', `${A}:1,${A}:1`],
    ['chuỗi rác', 'rác'],
    ['thiếu', null],
  ])('%s → null', (_label, raw) => {
    expect(selectionFromItems(raw, event)).toBeNull();
  });

  it('Checkout: Sự kiện không bán (Ẩn, hủy, đã qua mốc tự kết thúc) → null', () => {
    const items = `${A}:1`;
    expect(checkoutSelection(event, items, NOW)).not.toBeNull();
    expect(checkoutSelection({ ...event, status: 'hidden' }, items, NOW)).toBeNull();
    expect(checkoutSelection({ ...event, status: 'cancelled' }, items, NOW)).toBeNull();
    const ended = { ...event, startsAt: '2026-11-08T07:00:00+07:00', endsAt: '2026-11-08T17:00:00+07:00' };
    expect(checkoutSelection(ended, items, NOW)).toBeNull();
    expect(checkoutSelection(event, `${UNKNOWN}:1`, NOW)).toBeNull();
  });

  it('Checkout: Hạng vé đã chọn chưa mở bán / đã đóng bán → null; hạng khác không ảnh hưởng', () => {
    const notStarted = {
      ...event,
      ticketTypes: [{ ...event.ticketTypes[0]!, saleStartsAt: '2026-11-10T08:00:00+07:00' }, ...event.ticketTypes.slice(1)],
    };
    expect(checkoutSelection(notStarted, `${A}:1`, NOW)).toBeNull();
    expect(checkoutSelection(notStarted, `${B}:1`, NOW)).not.toBeNull();
    const closed = {
      ...event,
      ticketTypes: [{ ...event.ticketTypes[0]!, saleEndsAt: '2026-11-09T10:00:00+07:00' }, ...event.ticketTypes.slice(1)],
    };
    expect(checkoutSelection(closed, `${A}:1`, NOW)).toBeNull();
  });
});

describe('purchaseBarState', () => {
  const tiers = event.ticketTypes;

  it('chưa có số vé → không có thanh', () => {
    expect(purchaseBarState(tiers, undefined, EMPTY_SELECTION)).toEqual({ kind: 'hidden' });
  });

  it('chưa chọn → empty; đã chọn → ready với tổng vé/tiền', () => {
    const onSale = availability([tier(A), tier(B), tier(C)]);
    expect(purchaseBarState(tiers, onSale, EMPTY_SELECTION)).toEqual({ kind: 'empty' });
    expect(purchaseBarState(tiers, onSale, sel([[A, 3], [B, 1]]))).toEqual({ kind: 'ready', count: 4, amount: 1_000_000 });
  });

  it('mọi Hạng vé sold_out → "Hết vé"', () => {
    const soldOut = availability([A, B, C].map((id) => tier(id, { status: 'sold_out', remaining: 0 })));
    expect(purchaseBarState(tiers, soldOut, EMPTY_SELECTION)).toEqual({ kind: 'sold-out' });
  });

  it('không hạng nào bán được nhưng không phải hết sạch → không có thanh', () => {
    const mixed = availability(
      [tier(A, { status: 'sold_out', remaining: 0 }), tier(B, { status: 'paused' }), tier(C, { status: 'paused' })],
      'paused',
    );
    expect(purchaseBarState(tiers, mixed, EMPTY_SELECTION)).toEqual({ kind: 'hidden' });
    const unavailable = availability(
      [A, B, C].map((id) => tier(id, { status: 'unavailable' })),
      'hidden',
    );
    expect(purchaseBarState(tiers, unavailable, EMPTY_SELECTION)).toEqual({ kind: 'hidden' });
  });
});
