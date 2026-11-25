import { ErrorCode, type CheckerListItem } from '@tickee/contracts';
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api/errors';
import { GENERIC_ERROR } from '@/lib/api/message-of';
import {
  CHECKER_STATUS_BADGE,
  checkerDialogView,
  checkerName,
  checkerRowView,
  DELETED_ACCOUNT,
  EVENT_ENDED_NOTE,
  isCheckerGone,
  isNoAccessError,
  isRestoreEnded,
  NO_CHECKERS,
  NO_LONGER_CHECKER,
  noAccessView,
  RESTORE_DISABLED_ENDED,
} from '@/lib/checkin/checker-view';

/*
 * Khối "CTV soát vé" của tab Check-in và màn hết quyền của Màn quét (Story 5.6): nhãn hàng, nút và lý do tắt, hộp xác
 * nhận, phân loại lỗi.
 */

const checker = (overrides: Partial<CheckerListItem> = {}): CheckerListItem => ({
  id: '019a3b2c-0d00-7abc-8def-000000000001',
  name: 'Trần Thị Bình',
  email: 'binh@vidu.vn',
  acceptedAt: '2026-11-22T10:04:00+07:00',
  status: 'active',
  revokedAt: null,
  ...overrides,
});

const apiError = (code: ErrorCode, message = 'Câu của api.') => new ApiError(code, message, null, 403);

describe('checkerRowView', () => {
  it('CTV active có tên: tên, email ở dòng phụ, "Nhận lúc" giờ Việt Nam, "Đang hoạt động" success, "Thu hồi" bấm được', () => {
    expect(checkerRowView(checker(), false)).toEqual({
      label: 'Trần Thị Bình',
      email: 'binh@vidu.vn',
      accepted: 'Nhận lúc 10:04 22/11/2026',
      badge: { label: 'Đang hoạt động', tone: 'success' },
      action: 'revoke',
      actionLabel: 'Thu hồi',
      disabledReason: null,
    });
  });

  it('giờ nhận theo giờ Việt Nam dù api trả offset khác', () => {
    expect(checkerRowView(checker({ acceptedAt: '2026-11-22T03:04:00Z' }), false).accepted).toBe(
      'Nhận lúc 10:04 22/11/2026',
    );
  });

  it('không có tên (tài khoản OTP): dòng chính là email, không lặp email ở dòng phụ', () => {
    const view = checkerRowView(checker({ name: null }), false);
    expect(view.label).toBe('binh@vidu.vn');
    expect(view.email).toBeNull();
  });

  it('tài khoản không còn: "Tài khoản đã xóa", không email', () => {
    const view = checkerRowView(checker({ name: null, email: null }), false);
    expect(view.label).toBe(DELETED_ACCOUNT);
    expect(DELETED_ACCOUNT).toBe('Tài khoản đã xóa');
    expect(view.email).toBeNull();
  });

  it('CTV đã thu hồi: "Đã thu hồi" neutral, "Khôi phục"; Sự kiện đã kết thúc → tắt kèm lý do', () => {
    const revoked = checker({ status: 'revoked', revokedAt: '2026-11-23T08:00:00+07:00' });
    expect(checkerRowView(revoked, false)).toMatchObject({
      badge: { label: 'Đã thu hồi', tone: 'neutral' },
      action: 'restore',
      actionLabel: 'Khôi phục',
      disabledReason: null,
    });
    expect(checkerRowView(revoked, true).disabledReason).toBe(RESTORE_DISABLED_ENDED);
    expect(RESTORE_DISABLED_ENDED).toBe('Sự kiện đã kết thúc');
  });

  it('Sự kiện đã kết thúc: "Thu hồi" vẫn bấm được', () => {
    expect(checkerRowView(checker(), true)).toMatchObject({ action: 'revoke', disabledReason: null });
  });

  it('nhãn trạng thái và câu danh sách trống', () => {
    expect(CHECKER_STATUS_BADGE).toEqual({
      active: { label: 'Đang hoạt động', tone: 'success' },
      revoked: { label: 'Đã thu hồi', tone: 'neutral' },
    });
    expect(NO_CHECKERS).toBe('Chưa có CTV nào nhận lời mời.');
  });
});

describe('checkerName và checkerDialogView', () => {
  it('tên gọi: tên, không có thì email, tài khoản không còn thì "CTV này"', () => {
    expect(checkerName(checker())).toBe('Trần Thị Bình');
    expect(checkerName(checker({ name: null }))).toBe('binh@vidu.vn');
    expect(checkerName(checker({ name: null, email: null }))).toBe('CTV này');
  });

  it('thu hồi: tiêu đề, hậu quả, nút destructive "Thu hồi", toast', () => {
    expect(checkerDialogView('revoke', 'Bình')).toEqual({
      title: 'Thu hồi quyền soát vé của Bình?',
      description:
        'Bình không quét hay tra tay được nữa, có hiệu lực từ lượt quét kế tiếp. Link mời không cho người này nhận lại; bạn có thể khôi phục sau.',
      confirmLabel: 'Thu hồi',
      confirmVariant: 'destructive',
      failureTitle: 'Chưa thu hồi được',
      success: 'Đã thu hồi quyền soát vé của Bình.',
    });
  });

  it('khôi phục: tiêu đề, hậu quả, nút primary-on-light "Khôi phục", toast', () => {
    expect(checkerDialogView('restore', 'Bình')).toEqual({
      title: 'Khôi phục quyền soát vé cho Bình?',
      description: 'Bình quét và tra tay lại được cho Sự kiện này tới khi Sự kiện kết thúc.',
      confirmLabel: 'Khôi phục',
      confirmVariant: 'primary-on-light',
      failureTitle: 'Chưa khôi phục được',
      success: 'Đã khôi phục quyền soát vé cho Bình.',
    });
  });

  it('phân loại lỗi: 404 (CTV hay Sự kiện không còn) và 409 EVENT_ALREADY_ENDED', () => {
    expect(isCheckerGone(apiError(ErrorCode.NOT_FOUND))).toBe(true);
    expect(isCheckerGone(apiError(ErrorCode.EVENT_NOT_FOUND))).toBe(true);
    expect(isCheckerGone(apiError(ErrorCode.EVENT_ALREADY_ENDED))).toBe(false);
    expect(isCheckerGone(new Error('x'))).toBe(false);
    expect(isRestoreEnded(apiError(ErrorCode.EVENT_ALREADY_ENDED))).toBe(true);
    expect(isRestoreEnded(apiError(ErrorCode.NOT_FOUND))).toBe(false);
  });
});

describe('màn hết quyền của Màn quét', () => {
  it('NOT_A_MEMBER, CHECKER_REVOKED, EVENT_ENDED là lỗi hết quyền; mã khác, lỗi không phải ApiError thì không', () => {
    for (const code of [ErrorCode.NOT_A_MEMBER, ErrorCode.CHECKER_REVOKED, ErrorCode.EVENT_ENDED]) {
      expect(isNoAccessError(apiError(code)), code).toBe(true);
    }
    for (const code of [ErrorCode.FORBIDDEN_ROLE, ErrorCode.UNAUTHENTICATED, ErrorCode.INTERNAL_ERROR]) {
      expect(isNoAccessError(apiError(code)), code).toBe(false);
    }
    expect(isNoAccessError(new Error('x'))).toBe(false);
  });

  it('EVENT_ENDED: tiêu đề cố định kèm "Sự kiện đã kết thúc."', () => {
    expect(noAccessView(apiError(ErrorCode.EVENT_ENDED, 'Câu khác'))).toEqual({
      title: 'Bạn không còn quyền soát vé cho Sự kiện này.',
      description: 'Sự kiện đã kết thúc.',
    });
    expect(NO_LONGER_CHECKER).toBe('Bạn không còn quyền soát vé cho Sự kiện này.');
    expect(EVENT_ENDED_NOTE).toBe('Sự kiện đã kết thúc.');
  });

  it('CHECKER_REVOKED, NOT_A_MEMBER: câu của api, không dòng mô tả', () => {
    const revoked = 'Bạn không còn quyền soát vé cho Sự kiện này.';
    expect(noAccessView(apiError(ErrorCode.CHECKER_REVOKED, revoked))).toEqual({ title: revoked, description: null });
    const notMember = 'Bạn không có quyền soát vé cho Sự kiện này.';
    expect(noAccessView(apiError(ErrorCode.NOT_A_MEMBER, notMember))).toEqual({ title: notMember, description: null });
    expect(noAccessView(new Error('x'))).toEqual({ title: GENERIC_ERROR, description: null });
  });
});
