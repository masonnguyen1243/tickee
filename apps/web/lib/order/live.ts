import { BuyerOrderStatus, type BuyerOrderView } from '@tickee/contracts';

/*
 * Trang Đơn tự cập nhật (Story 3.7): chu kỳ polling theo `buyerStatus`, ngưỡng "chờ lâu" và "khoảnh khắc" Thành công.
 * Hàm thuần (trừ đọc/ghi `sessionStorage`), kiểm bằng Vitest môi trường node.
 */

/** Polling khi SSE chưa kết nối mà Đơn đang chờ tiền (AD-17: 2 giây ở màn chờ thanh toán). */
export const ORDER_WAITING_POLL_MS = 2_000;

/** Sau chừng này ms ở màn chờ trong lần mở trang, `reassurance-line` thay dòng chờ (EXPERIENCE › Chờ lâu). */
export const LONG_WAIT_MS = 120_000;

/** Đơn đang chờ tiền: `awaiting_payment` hoặc `confirming`. */
export const isWaiting = (buyerStatus: string): boolean =>
  buyerStatus === BuyerOrderStatus.AWAITING_PAYMENT || buyerStatus === BuyerOrderStatus.CONFIRMING;

/** Chu kỳ polling của Trang Đơn khi SSE chưa kết nối: 2 giây khi đang chờ tiền, trạng thái khác (hoặc chưa có) không. */
export function orderPollInterval(order: Pick<BuyerOrderView, 'buyerStatus'> | undefined): number | false {
  return order && isWaiting(order.buyerStatus) ? ORDER_WAITING_POLL_MS : false;
}

const momentKey = (code: string) => `tickee:order-moment:${code}`;

/**
 * Đặt cờ một lần "vừa thanh toán xong": Checkout (Đơn 0đ đã `paid`) hoặc nút "Thanh toán" (Đơn có phí, trước khi sang
 * Tingee) đặt, để lần vào Trang Đơn kế tiếp của Đơn này chạy "khoảnh khắc" Thành công. Không có `sessionStorage` (chế
 * độ riêng tư chặn) → bỏ qua.
 */
export function markOrderMoment(code: string): void {
  try {
    window.sessionStorage.setItem(momentKey(code), '1');
  } catch {
    // Không lưu được: Thành công vẫn hiện, chỉ không có chuyển cảnh.
  }
}

/** Có cờ "vừa thanh toán xong" của Đơn không (chỉ đọc). */
export function hasOrderMoment(code: string): boolean {
  try {
    return window.sessionStorage.getItem(momentKey(code)) === '1';
  } catch {
    return false;
  }
}

/** Xóa cờ sau lần vào trang đầu tiên: mở lại hay tải lại sau đó thì Thành công hiện ngay. */
export function clearOrderMoment(code: string): void {
  try {
    window.sessionStorage.removeItem(momentKey(code));
  } catch {
    // Bỏ qua.
  }
}

/** Trạng thái theo dõi "khoảnh khắc": `buyerStatus` lần trước thấy trong lần mở trang này, và đã chốt chạy hay chưa. */
export type MomentState = { status: string | undefined; moment: boolean };

export const INITIAL_MOMENT: MomentState = { status: undefined, moment: false };

/**
 * "Khoảnh khắc" Thành công (trượt lên + rung) chỉ chạy khi: trang đang mở thấy Đơn chuyển sang `paid`; hoặc lần đầu
 * thấy Đơn đã `paid` mà có cờ một lần (`flagged`). Không đổi `buyerStatus` → giữ nguyên state (cùng object).
 */
export function nextMoment(previous: MomentState, status: string, flagged: boolean): MomentState {
  if (previous.status === status) return previous;
  const paid = status === BuyerOrderStatus.PAID;
  if (previous.status === undefined) return { status, moment: paid && flagged };
  return { status, moment: previous.moment || paid };
}
