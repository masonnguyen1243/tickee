import type { CheckerInvite, EventStatus } from '@tickee/contracts';
import { describe, expect, it } from 'vitest';

import {
  checkerInviteView,
  COPY_INVITE_EXPIRED,
  COPY_INVITE_EXPIRED_FINAL,
  COPY_INVITE_NO_TOKEN,
  CREATE_INVITE_DISABLED,
  type CheckerInviteViewInput,
} from '@/lib/checkin/invite-view';

/* Khối "Link mời CTV" của tab Check-in (Story 5.1): nhãn, hạn, lý do tắt của hai nút, có hỏi trước khi tạo không. */

const FAR_END = '2099-11-16T23:59:59+07:00';
const invite = (overrides: Partial<CheckerInvite> = {}): CheckerInvite => ({
  id: '019a3b2c-0a00-7abc-8def-000000000001',
  createdAt: '2026-11-22T10:04:00+07:00',
  expiresAt: '2026-11-29T10:04:00+07:00',
  active: true,
  ...overrides,
});
const input = (overrides: Partial<CheckerInviteViewInput> = {}): CheckerInviteViewInput => ({
  eventStatus: 'published',
  eventEnded: false,
  effectiveEndAt: FAR_END,
  invite: invite(),
  hasToken: false,
  ...overrides,
});

describe('checkerInviteView', () => {
  it('chưa có link, Sự kiện đang mở: không badge, không hạn, tạo được, không hỏi trước', () => {
    expect(checkerInviteView(input({ invite: null }))).toEqual({
      badge: null,
      expiry: null,
      active: false,
      createDisabledReason: null,
      copyDisabledReason: null,
      confirmBeforeCreate: false,
    });
  });

  it.each([
    ['draft', false, CREATE_INVITE_DISABLED.draft],
    ['cancelled', false, CREATE_INVITE_DISABLED.cancelled],
    ['cancelled', true, CREATE_INVITE_DISABLED.cancelled],
    ['published', true, CREATE_INVITE_DISABLED.ended],
    ['hidden', true, CREATE_INVITE_DISABLED.ended],
    ['hidden', false, null],
  ] as const)('chưa có link, %s (đã kết thúc: %s) → lý do tắt "Tạo link mới": %s', (status, ended, reason) => {
    const view = checkerInviteView(input({ invite: null, eventStatus: status as EventStatus, eventEnded: ended }));
    expect(view.createDisabledReason).toBe(reason);
    expect(view.confirmBeforeCreate).toBe(false);
  });

  it('câu lý do đúng chữ', () => {
    expect(CREATE_INVITE_DISABLED.draft).toBe('Đăng Sự kiện trước khi mời CTV.');
    expect(COPY_INVITE_NO_TOKEN).toBe('Link đầy đủ chỉ hiện ngay sau khi tạo. Tạo link mới để có link gửi đi.');
  });

  it('link còn hạn, vừa tạo (có token): "Còn hạn" success, hạn giờ Việt Nam, sao chép được, tạo lại thì hỏi trước', () => {
    expect(checkerInviteView(input({ hasToken: true }))).toEqual({
      badge: { label: 'Còn hạn', tone: 'success' },
      expiry: 'Hết hạn lúc 10:04 29/11/2026 (giờ Việt Nam)',
      active: true,
      createDisabledReason: null,
      copyDisabledReason: null,
      confirmBeforeCreate: true,
    });
  });

  it('hạn hiện theo giờ Việt Nam dù api trả offset khác', () => {
    const view = checkerInviteView(input({ invite: invite({ expiresAt: '2026-11-29T03:04:00Z' }) }));
    expect(view.expiry).toBe('Hết hạn lúc 10:04 29/11/2026 (giờ Việt Nam)');
  });

  it('Sự kiện chưa kết thúc nhưng mốc kết thúc sớm hơn hạn lưu của link (sửa giờ sau khi tạo) → vẫn "Còn hạn", hạn hiện mốc kết thúc', () => {
    const view = checkerInviteView(input({ effectiveEndAt: '2026-11-25T18:00:00+07:00', hasToken: true }));
    expect(view.badge).toEqual({ label: 'Còn hạn', tone: 'success' });
    expect(view.active).toBe(true);
    expect(view.expiry).toBe('Hết hạn lúc 18:00 25/11/2026 (giờ Việt Nam)');
  });

  it('link còn hạn, không còn token (tải lại trang) → "Sao chép link" tắt kèm lý do, vẫn hỏi trước khi tạo lại', () => {
    const view = checkerInviteView(input({ hasToken: false }));
    expect(view.badge?.label).toBe('Còn hạn');
    expect(view.copyDisabledReason).toBe(COPY_INVITE_NO_TOKEN);
    expect(view.confirmBeforeCreate).toBe(true);
  });

  it('link hết hạn (api active false), Sự kiện còn mở → "Đã hết hạn" neutral, tạo được không hỏi, sao chép tắt', () => {
    const view = checkerInviteView(input({ invite: invite({ active: false }), hasToken: true }));
    expect(view).toEqual({
      badge: { label: 'Đã hết hạn', tone: 'neutral' },
      expiry: 'Hết hạn lúc 10:04 29/11/2026 (giờ Việt Nam)',
      active: false,
      createDisabledReason: null,
      copyDisabledReason: COPY_INVITE_EXPIRED,
      confirmBeforeCreate: false,
    });
  });

  it('Sự kiện vừa kết thúc sớm (dữ liệu link chưa tải lại): link hết hạn ở mốc kết thúc, hai nút tắt kèm lý do', () => {
    const view = checkerInviteView(
      input({ eventEnded: true, effectiveEndAt: '2026-11-23T08:30:00+07:00', hasToken: true }),
    );
    expect(view).toEqual({
      badge: { label: 'Đã hết hạn', tone: 'neutral' },
      expiry: 'Hết hạn lúc 08:30 23/11/2026 (giờ Việt Nam)',
      active: false,
      createDisabledReason: CREATE_INVITE_DISABLED.ended,
      copyDisabledReason: COPY_INVITE_EXPIRED_FINAL,
      confirmBeforeCreate: false,
    });
  });

  it('Sự kiện đã hủy: link hết hiệu lực dù api còn trả active', () => {
    const view = checkerInviteView(input({ eventStatus: 'cancelled', hasToken: true }));
    expect(view.badge?.label).toBe('Đã hết hạn');
    expect(view.createDisabledReason).toBe(CREATE_INVITE_DISABLED.cancelled);
    expect(view.copyDisabledReason).toBe(COPY_INVITE_EXPIRED_FINAL);
    expect(view.confirmBeforeCreate).toBe(false);
  });
});
