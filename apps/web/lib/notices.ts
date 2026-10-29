/**
 * Thông báo một lần truyền qua tham số `?notice=<mã>` khi chuyển trang (vd. sau khi đăng xuất).
 * `NoticeToast` ở layout gốc hiện toast rồi xóa tham số khỏi URL.
 */
export const NOTICES = {
  'consent-declined': 'Bạn cần đồng ý để dùng Tickee.',
} as const;

export type NoticeCode = keyof typeof NOTICES;

export const NOTICE_PARAM = 'notice';

export function noticeMessage(code: string | null): string | null {
  return code !== null && Object.hasOwn(NOTICES, code) ? NOTICES[code as NoticeCode] : null;
}
