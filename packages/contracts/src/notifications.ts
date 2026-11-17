import { JobQueue } from './jobs.js';
import { Role } from './organizer.js';
import { StatusNoticeCode } from './reporting.js';

// ---------------------------------------------------------------------------------------------------------------
// Danh mục thông báo (Story 4.5-b, review kiến trúc R-18): loại, sự kiện kích hoạt, người nhận, kênh, khóa chống gửi lặp
// ---------------------------------------------------------------------------------------------------------------

/*
 * Mỗi thông báo gửi cho thành viên BTC khai báo một dòng ở đây; api đọc người nhận và khóa từ dòng đó (email và
 * `audience` của banner). Hiện chỉ có cảnh báo Token dưới ngưỡng; các thông báo khác (email Vé, đổi giờ/địa điểm, Cần xử
 * lý…) thêm sau.
 */

/** Loại thông báo. */
export const NotificationKind = {
  TOKEN_BELOW_THRESHOLD: 'token_below_threshold',
} as const;
export type NotificationKind = (typeof NotificationKind)[keyof typeof NotificationKind];

/** Kênh gửi: email (job pg-boss) hoặc banner trên dashboard (`reporting.notices`, `status-banner`). */
export const NotificationChannel = {
  EMAIL: 'email',
  BANNER: 'banner',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

/** Một dòng của danh mục. */
export interface NotificationSpec {
  /** Sự kiện kích hoạt (mô tả cho người đọc). */
  trigger: string;
  /** Vai nhận trong BTC (email gửi người đang giữ vai này lúc gửi; banner chỉ hiện cho các vai này). */
  recipients: readonly Role[];
  channels: readonly NotificationChannel[];
  /**
   * Khóa chống gửi lặp: mỗi bộ giá trị gửi tối đa một email, và banner đã đóng chỉ hiện lại khi bộ giá trị đổi. Phần tử
   * là tên trường của payload job / cột DB tạo nên khóa.
   */
  dedupeKey: readonly string[];
  /** Queue gửi email (kênh `email`). */
  emailQueue?: JobQueue;
  /** Mã `status-banner` (kênh `banner`). */
  noticeCode?: StatusNoticeCode;
}

export const NOTIFICATION_CATALOG = {
  token_below_threshold: {
    trigger:
      'Token khả dụng của BTC xuống dưới ngưỡng cảnh báo Owner đặt, ở lần đánh giá sau một lần đọc Token thành công ' +
      '(Owner/Admin xem trang Token, hoặc job dò mỗi giờ); về lại trên ngưỡng rồi xuống lần nữa là một lần vượt mới.',
    recipients: [Role.OWNER],
    channels: [NotificationChannel.EMAIL, NotificationChannel.BANNER],
    // (organization, lần vượt ngưỡng) = (`organizationId`, `token_below_threshold_since`).
    dedupeKey: ['organizationId', 'token_below_threshold_since'],
    emailQueue: JobQueue.TOKEN_ALERT_EMAIL,
    noticeCode: StatusNoticeCode.TOKEN_BELOW_THRESHOLD,
  },
} as const satisfies Record<NotificationKind, NotificationSpec>;
