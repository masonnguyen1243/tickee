/** Tab cấp Sự kiện (UX: Tổng quan · Đơn · Hạng vé · Form mua · Check-in · Cài đặt), chọn bằng `?tab=`. */
export const EVENT_TABS = [
  { key: 'tong-quan', label: 'Tổng quan' },
  { key: 'don', label: 'Đơn', soon: 'Đơn của Người mua sẽ hiện ở đây.' },
  { key: 'hang-ve', label: 'Hạng vé' },
  { key: 'form-mua', label: 'Form mua', soon: 'Chọn thông tin hỏi Người mua khi đặt vé.' },
  { key: 'check-in', label: 'Check-in', soon: 'Theo dõi check-in của Sự kiện.' },
  { key: 'cai-dat', label: 'Cài đặt', soon: 'Ẩn, kết thúc sớm và các cài đặt khác của Sự kiện.' },
] as const;
export type EventTab = (typeof EVENT_TABS)[number]['key'];
export const DEFAULT_EVENT_TAB: EventTab = 'tong-quan';

export const isEventTab = (value: unknown): value is EventTab => EVENT_TABS.some((t) => t.key === value);
