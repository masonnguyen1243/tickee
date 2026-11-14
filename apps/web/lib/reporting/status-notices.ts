import {
  organizationSectionPath,
  type OrganizationSection,
  type Role,
  type StatusNotice,
  type StatusNoticeCode,
} from '@tickee/contracts';

/*
 * Nội dung `status-banner` theo mã thông báo trạng thái (AD-34). Web chỉ ánh xạ `code` → nội dung (có thể khác theo vai
 * người xem); mức độ, đóng được hay không và thứ tự do api trả. Khác `lib/notices.ts` (toast một lần qua `?notice=`).
 */

/** Hành động dạng link tới một mục của BTC (vd. "Liên kết ngay" → Tài khoản nhận tiền). */
export type SectionNoticeAction = { label: string; section: OrganizationSection };

/**
 * Hành động dạng liên kết ngoài (tab mới, `noopener noreferrer`): URL lấy từ `notice.data[urlKey]` do api trả (vd. portal
 * Tingee của môi trường đang dùng); thiếu hoặc không phải URL http(s) thì banner không có hành động.
 */
export type ExternalNoticeAction = { label: string; urlKey: 'tingeePortalUrl' };

/** Tối đa một hành động mỗi banner. */
export type StatusNoticeAction = SectionNoticeAction | ExternalNoticeAction;

export type StatusNoticeContent = { title: string; description?: string; action?: StatusNoticeAction };

/** Nội dung riêng cho từng vai (vd. Owner có nút, Admin chỉ được nhắc nhờ Owner). */
export type StatusNoticeContentByRole = Readonly<Record<Role, StatusNoticeContent>>;

const NOT_LINKED_TITLE = 'Chưa liên kết tài khoản nhận tiền';
/** Hậu quả chung của năm mã dịch vụ thanh toán bị ngắt (Story 4.2). */
const PAID_EVENTS_PAUSED = 'Mọi Sự kiện có phí đang Tạm ngừng bán.';
const PAYOUT_ACCOUNT: OrganizationSection = 'payout-account';

/**
 * Năm mã dịch vụ thanh toán bị ngắt (Story 4.2-b, câu Mason chốt 13/11/2026; mã VA chốt 14/11/2026, Story 4.2-d): tiêu
 * đề giữ của 4.2-a, mô tả nêu hậu quả hoặc nguyên nhân. Owner có một hành động ("Mua thêm Token" mở portal Tingee ở tab
 * mới; còn lại tới trang Tài khoản nhận tiền, nơi có khối "Dịch vụ thanh toán"); Admin chỉ được nhắc nhờ Owner.
 */
const PAYMENT_SERVICE_CONTENT = {
  PAYMENT_SERVICE_SUSPENDED_TOKEN: {
    owner: {
      title: 'Mọi Sự kiện có phí đang Tạm ngừng bán',
      description: 'Tingee báo đã hết Token (gói dịch vụ hết hạn).',
      action: { label: 'Mua thêm Token', urlKey: 'tingeePortalUrl' },
    },
    admin: {
      title: 'Mọi Sự kiện có phí đang Tạm ngừng bán',
      description: 'Tingee báo đã hết Token. Nhờ Owner mua thêm Token.',
    },
  },
  PAYMENT_SERVICE_SUSPENDED_TINGEE_DISABLED: {
    owner: {
      title: 'Tingee đang tạm ngừng dịch vụ thanh toán của BTC',
      description: PAID_EVENTS_PAUSED,
      action: { label: 'Xem chi tiết', section: PAYOUT_ACCOUNT },
    },
    admin: {
      title: 'Tingee đang tạm ngừng dịch vụ thanh toán của BTC',
      description: `${PAID_EVENTS_PAUSED} Nhờ Owner liên hệ Tingee.`,
    },
  },
  PAYMENT_SERVICE_SUSPENDED_CREDENTIAL_INVALID: {
    owner: {
      title: 'Key Tingee không còn dùng được',
      description: PAID_EVENTS_PAUSED,
      action: { label: 'Nhập lại key', section: PAYOUT_ACCOUNT },
    },
    admin: {
      title: 'Key Tingee không còn dùng được',
      description: `${PAID_EVENTS_PAUSED} Nhờ Owner cập nhật key Tingee.`,
    },
  },
  PAYMENT_SERVICE_SUSPENDED_GATEWAY_PERMISSION_MISSING: {
    owner: {
      title: 'Key Tingee chưa được cấp quyền Cổng thanh toán',
      description: PAID_EVENTS_PAUSED,
      action: { label: 'Xem cách xử lý', section: PAYOUT_ACCOUNT },
    },
    admin: {
      title: 'Key Tingee chưa được cấp quyền Cổng thanh toán',
      description: `${PAID_EVENTS_PAUSED} Nhờ Owner cấp quyền Cổng thanh toán cho key Tingee.`,
    },
  },
  PAYMENT_SERVICE_SUSPENDED_PAYOUT_ACCOUNT_NOT_ALLOWED: {
    owner: {
      title: 'Tài khoản nhận tiền chưa dùng được với Cổng thanh toán',
      description: PAID_EVENTS_PAUSED,
      action: { label: 'Xem cách xử lý', section: PAYOUT_ACCOUNT },
    },
    admin: {
      title: 'Tài khoản nhận tiền chưa dùng được với Cổng thanh toán',
      description: `${PAID_EVENTS_PAUSED} Nhờ Owner cho phép tài khoản trên Cổng thanh toán Tingee hoặc chọn tài khoản nhận tiền khác.`,
    },
  },
} satisfies Partial<Record<StatusNoticeCode, StatusNoticeContentByRole>>;

/** Mỗi mã trong `StatusNoticeCode` bắt buộc có nội dung (thiếu thì lỗi typecheck). */
export const STATUS_NOTICE_CONTENT: Readonly<Record<StatusNoticeCode, StatusNoticeContent | StatusNoticeContentByRole>> = {
  CLOSED_BETA_REVOKED: {
    title: 'Closed Beta đã bị thu hồi',
    description: 'Hạng vé có phí của BTC đang Tạm ngừng bán. Hạng vé 0đ vẫn bán bình thường.',
  },
  ...PAYMENT_SERVICE_CONTENT,
  // Chưa có kênh liên hệ Tingee nên không có nút (quyết định 02/11/2026).
  CLOSED_BETA_PENDING: {
    title: 'Chờ duyệt Closed Beta',
    description: 'Tingee sẽ liên hệ qua SĐT hoặc email liên hệ của BTC để xác minh.',
  },
  PAYOUT_ACCOUNT_NOT_LINKED: {
    owner: {
      title: NOT_LINKED_TITLE,
      description: 'Liên kết tài khoản nhận tiền để bán Vé có phí.',
      action: { label: 'Liên kết ngay', section: PAYOUT_ACCOUNT },
    },
    admin: { title: NOT_LINKED_TITLE, description: 'Nhờ Owner liên kết tài khoản nhận tiền.' },
  },
};

/** Nội dung của một mã cho vai người xem. */
export function statusNoticeContent(code: StatusNoticeCode, role: Role): StatusNoticeContent {
  const content = STATUS_NOTICE_CONTENT[code];
  return 'title' in content ? content : content[role];
}

/** Hành động đã có đích: `external` → mở tab mới (`noopener noreferrer`), không thì điều hướng trong app. */
export type StatusNoticeLink = { label: string; href: string; external: boolean };

/** URL tuyệt đối http(s), không thì `null` (không bao giờ đặt `javascript:`… vào `href`). */
function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Đích của hành động: mục của BTC `orgId`, hoặc URL ngoài đọc từ `notice.data`. URL ngoài thiếu hay sai dạng → `null`
 * (banner hiện không có hành động thay vì một nút hỏng).
 */
export function statusNoticeLink(
  action: StatusNoticeAction,
  notice: Pick<StatusNotice, 'data'>,
  orgId: string,
): StatusNoticeLink | null {
  if ('section' in action) {
    return { label: action.label, href: organizationSectionPath(orgId, action.section), external: false };
  }
  const href = httpUrl(notice.data[action.urlKey]);
  return href ? { label: action.label, href, external: true } : null;
}

const DISMISSED_PREFIX = 'tickee:thong-bao-da-dong:';

/** Khóa `sessionStorage` của một banner đã đóng: theo `code` + `version`, nên trạng thái đổi thì banner hiện lại. */
export const statusNoticeDismissKey = (notice: Pick<StatusNotice, 'code' | 'version'>): string =>
  `${DISMISSED_PREFIX}${notice.code}:${notice.version}`;

/** Đã đóng trong phiên trình duyệt này chưa; storage bị chặn thì coi như chưa (banner vẫn hiện). */
export function isStatusNoticeDismissed(notice: Pick<StatusNotice, 'code' | 'version'>): boolean {
  try {
    return window.sessionStorage.getItem(statusNoticeDismissKey(notice)) === '1';
  } catch {
    return false;
  }
}

export function saveStatusNoticeDismissed(notice: Pick<StatusNotice, 'code' | 'version'>): void {
  try {
    window.sessionStorage.setItem(statusNoticeDismissKey(notice), '1');
  } catch {
    // Không lưu được: banner chỉ ẩn tới khi tải lại trang.
  }
}
