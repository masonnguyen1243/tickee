import type { MyTicketsView } from '@tickee/contracts';
import { describe, expect, it } from 'vitest';

import { myTicketQueryKey, myTicketsQueryKey } from '@/lib/tickets/api';
import { myTicketsLivePath, myTicketsPollInterval, orderCodesOf } from '@/lib/tickets/live';

/*
 * "Vé của tôi" tự cập nhật (Story 3.9): khóa của tập mã Đơn trong đường SSE (stream mở lại khi tập đổi) và chu kỳ
 * polling khi chưa có SSE. Màn hình được kiểm bằng Playwright (`e2e/my-tickets.spec.ts`).
 */

const ticket = (orderCode: string) => ({ orderCode });
const pending = (code: string, buyerStatus = 'awaiting_payment') => ({ code, buyerStatus });

type View = Pick<MyTicketsView, 'active' | 'pending'>;
const view = (active: string[], waiting: [string, string?][] = []) =>
  ({ active: active.map(ticket), pending: waiting.map(([code, status]) => pending(code, status)) }) as unknown as View;

describe('query key', () => {
  it('[domain, kind, …ids]', () => {
    expect(myTicketsQueryKey).toEqual(['tickets', 'mine']);
    expect(myTicketQueryKey('abc')).toEqual(['tickets', 'detail', 'abc']);
  });
});

describe('myTicketsLivePath', () => {
  it('chưa có dữ liệu → đường gốc /me/tickets/live', () => {
    expect(myTicketsLivePath(undefined)).toBe('/me/tickets/live');
  });

  it('khóa chỉ phụ thuộc tập mã Đơn (không trùng, không thứ tự)', () => {
    const a = myTicketsLivePath(view(['TK11111111', 'TK11111111', 'TK22222222'], [['TK33333333']]));
    const b = myTicketsLivePath(view(['TK22222222'], [['TK33333333'], ['TK11111111', 'under_review']]));
    expect(a).toMatch(/^\/me\/tickets\/live\?orders=[0-9a-f]{8}$/);
    expect(b).toBe(a);
    expect(orderCodesOf(view(['TK22222222', 'TK11111111'], [['TK11111111']]))).toEqual(['TK11111111', 'TK22222222']);
  });

  it('Đơn chờ được trả (mã chuyển từ pending sang active) → khóa không đổi; Đơn mới hiện ra → khóa đổi', () => {
    const before = myTicketsLivePath(view(['TK11111111'], [['TK22222222']]));
    expect(myTicketsLivePath(view(['TK11111111', 'TK22222222']))).toBe(before);
    expect(myTicketsLivePath(view(['TK11111111'], [['TK22222222'], ['TK44444444']]))).not.toBe(before);
    expect(myTicketsLivePath(view([], []))).not.toBe(before);
  });
});

describe('myTicketsPollInterval', () => {
  it('2 giây khi có Đơn chờ tiền (awaiting_payment/confirming); không thì không polling', () => {
    expect(myTicketsPollInterval(undefined)).toBe(false);
    expect(myTicketsPollInterval(view([], []))).toBe(false);
    expect(myTicketsPollInterval(view([], [['TK1', 'under_review'], ['TK2', 'expired']]))).toBe(false);
    expect(myTicketsPollInterval(view([], [['TK1', 'under_review'], ['TK2', 'awaiting_payment']]))).toBe(2_000);
    expect(myTicketsPollInterval(view([], [['TK1', 'confirming']]))).toBe(2_000);
  });
});
