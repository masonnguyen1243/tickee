import type { OrganizationSection, Role, StatusNotice, StatusNoticeCode } from '@tickee/contracts';

/*
 * Nội dung `status-banner` theo mã thông báo trạng thái (AD-34). Web chỉ ánh xạ `code` → nội dung (có thể khác theo vai
 * người xem); mức độ, đóng được hay không và thứ tự do api trả. Khác `lib/notices.ts` (toast một lần qua `?notice=`).
 */

/** Một hành động dạng link tới một mục của BTC (vd. "Liên kết ngay" → Tài khoản nhận tiền). */
export type StatusNoticeAction = { label: string; section: OrganizationSection };

export type StatusNoticeContent = { title: string; description?: string; action?: StatusNoticeAction };

/** Nội dung riêng cho từng vai (vd. Owner có nút, Admin chỉ được nhắc nhờ Owner). */
export type StatusNoticeContentByRole = Readonly<Record<Role, StatusNoticeContent>>;

const NOT_LINKED_TITLE = 'Chưa liên kết tài khoản nhận tiền';

/** Mỗi mã trong `StatusNoticeCode` bắt buộc có nội dung (thiếu thì lỗi typecheck). */
export const STATUS_NOTICE_CONTENT: Readonly<Record<StatusNoticeCode, StatusNoticeContent | StatusNoticeContentByRole>> = {
  CLOSED_BETA_REVOKED: {
    title: 'Closed Beta đã bị thu hồi',
    description: 'Hạng vé có phí của BTC đang Tạm ngừng bán. Hạng vé 0đ vẫn bán bình thường.',
  },
  // Dịch vụ thanh toán bị ngắt (Story 4.2-a): chỉ tiêu đề theo câu đã chốt; hành động theo vai ("Mua thêm Token" mở
  // `data.tingeePortalUrl`, "Nhập lại key"…) ở Story 4.2-b.
  PAYMENT_SERVICE_SUSPENDED_TOKEN: { title: 'Mọi Sự kiện có phí đang Tạm ngừng bán' },
  PAYMENT_SERVICE_SUSPENDED_CREDENTIAL_INVALID: { title: 'Key Tingee không còn dùng được' },
  PAYMENT_SERVICE_SUSPENDED_GATEWAY_PERMISSION_MISSING: { title: 'Key Tingee chưa được cấp quyền Cổng thanh toán' },
  PAYMENT_SERVICE_SUSPENDED_TINGEE_DISABLED: {
    title: 'Tingee đang tạm ngừng dịch vụ thanh toán của BTC',
    description: 'Mọi Sự kiện có phí đang Tạm ngừng bán.',
  },
  // Chưa có kênh liên hệ Tingee nên không có nút (quyết định 02/11/2026).
  CLOSED_BETA_PENDING: {
    title: 'Chờ duyệt Closed Beta',
    description: 'Tingee sẽ liên hệ qua SĐT hoặc email liên hệ của BTC để xác minh.',
  },
  PAYOUT_ACCOUNT_NOT_LINKED: {
    owner: {
      title: NOT_LINKED_TITLE,
      description: 'Liên kết tài khoản nhận tiền để bán Vé có phí.',
      action: { label: 'Liên kết ngay', section: 'payout-account' },
    },
    admin: { title: NOT_LINKED_TITLE, description: 'Nhờ Owner liên kết tài khoản nhận tiền.' },
  },
};

/** Nội dung của một mã cho vai người xem. */
export function statusNoticeContent(code: StatusNoticeCode, role: Role): StatusNoticeContent {
  const content = STATUS_NOTICE_CONTENT[code];
  return 'title' in content ? content : content[role];
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
