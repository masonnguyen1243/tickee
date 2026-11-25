import { WifiOff } from 'lucide-react';

/** Câu của `offline-banner` (EXPERIENCE › Giọng với CTV). */
export const OFFLINE_BANNER_TEXT = 'Mất kết nối — chưa quét được';

/**
 * `offline-banner` (UX-DR31, DESIGN.md › Màn quét): dải trên cùng Màn quét, trên tên Sự kiện, nền `warning-subtle` chữ
 * `warning-text`, icon mất sóng, `role="status"`. Không có nút đóng: tự ẩn khi có phản hồi hoặc có mạng lại (nơi gọi
 * quyết định). Không tính vào giới hạn chồng banner.
 */
export function OfflineBanner() {
  return (
    <div
      role="status"
      data-slot="offline-banner"
      className="flex items-center gap-2.5 rounded-md bg-warning-subtle p-card-padding text-warning-text"
    >
      <WifiOff aria-hidden="true" className="size-5 shrink-0" />
      <p className="min-w-0 text-body font-bold wrap-break-word">{OFFLINE_BANNER_TEXT}</p>
    </div>
  );
}
