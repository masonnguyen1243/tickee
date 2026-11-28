import { SheetsNotice } from '@tickee/contracts';

/**
 * Thông báo một lần truyền qua tham số `?notice=<mã>` khi chuyển trang (vd. sau khi đăng xuất, khi callback OAuth Google
 * Sheets của api 302 về tab Cài đặt Sự kiện — Story 6.4). `NoticeToast` ở layout gốc hiện toast rồi xóa tham số khỏi URL.
 */
export const NOTICES = {
  'consent-declined': 'Bạn cần đồng ý để dùng Tickee.',
  [SheetsNotice.CONNECTED]: 'Đã kết nối Google Sheets. Tickee đang tạo Sheet và đẩy các Đơn hiện có.',
  [SheetsNotice.DENIED]: 'Bạn chưa cho phép Tickee truy cập Google Drive nên chưa kết nối Google Sheets.',
  [SheetsNotice.FAILED]: 'Chưa kết nối được Google Sheets. Vui lòng thử lại.',
  [SheetsNotice.ALREADY_CONNECTED]: 'Sự kiện này đã kết nối Google Sheets.',
  // Story 6.6: "Kết nối lại" một kết nối mất quyền.
  [SheetsNotice.RECONNECTED]: 'Đã kết nối lại Google Sheets.',
} as const;

export type NoticeCode = keyof typeof NOTICES;

export const NOTICE_PARAM = 'notice';

export function noticeMessage(code: string | null): string | null {
  return code !== null && Object.hasOwn(NOTICES, code) ? NOTICES[code as NoticeCode] : null;
}
