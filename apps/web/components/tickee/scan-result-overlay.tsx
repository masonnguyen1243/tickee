'use client';

import { CircleCheck, Info, OctagonX, type LucideIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';

import type { ScanTone, ScanView } from '@/lib/checkin/scan-view';
import { cn } from '@/lib/utils';

/** Icon khác hình theo kết quả để không chỉ dựa vào màu: tích tròn · i tròn · X bát giác. */
const TONE_ICON: Record<ScanTone, LucideIcon> = { success: CircleCheck, neutral: Info, danger: OctagonX };

/** Nền phủ toàn màn: `scan-success` / `neutral-subtle` / `scan-danger` (xanh và đỏ giống nhau ở hai theme). */
const TONE_CLASS: Record<ScanTone, string> = {
  success: 'bg-scan-success text-scan-foreground',
  neutral: 'bg-neutral-subtle text-neutral-text',
  danger: 'bg-scan-danger text-scan-foreground',
};

type ScanResultOverlayProps = {
  view: ScanView;
  /** Đóng overlay: tự gọi sau `view.autoCloseMs` (xanh, trung tính), hoặc khi chạm (đỏ). */
  onClose: () => void;
};

/**
 * `scan-result-overlay` (UX-DR30, DESIGN.md › scan-result-success/danger): phủ toàn màn hình, che camera, đọc bằng
 * `aria-live="assertive"`. Chữ `text-scan-result` / `text-scan-detail`. Xanh và trung tính tự đóng; đỏ giữ tới khi chạm
 * bất kỳ đâu, có nút "Chạm để quét tiếp" chữ trắng viền trắng ở vùng ngón cái. Reduced motion: hiện ngay, không animation.
 */
export function ScanResultOverlay({ view, onClose }: ScanResultOverlayProps) {
  const Icon = TONE_ICON[view.tone];
  const dismissable = view.autoCloseMs === null;
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (view.autoCloseMs === null) return;
    const timer = setTimeout(() => onCloseRef.current(), view.autoCloseMs);
    return () => clearTimeout(timer);
  }, [view]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      data-slot="scan-result-overlay"
      data-tone={view.tone}
      onClick={dismissable ? onClose : undefined}
      className={cn(
        'fixed inset-0 z-50 flex flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]',
        'animate-in fade-in-0 duration-150 motion-reduce:animate-none',
        dismissable && 'cursor-pointer',
        TONE_CLASS[view.tone],
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3.5 px-7 text-center">
        <Icon aria-hidden="true" strokeWidth={1.75} className="size-24 shrink-0" />
        <p data-slot="scan-result-title" className="text-scan-result wrap-break-word">
          {view.title}
        </p>
        {view.detail ? (
          <p data-slot="scan-result-detail" className="text-scan-detail tabular-nums wrap-break-word">
            {view.detail}
          </p>
        ) : null}
      </div>
      {dismissable ? (
        <div className="px-gutter-mobile pt-3.5 pb-4">
          {/* Chạm nút hay bất kỳ đâu đều đóng (click nổi lên overlay); focus sẵn để Enter / trình đọc màn hình đóng được. */}
          <button
            type="button"
            autoFocus
            className="flex h-14 w-full items-center justify-center rounded-md border-2 border-current text-button text-scan-foreground"
          >
            Chạm để quét tiếp
          </button>
        </div>
      ) : null}
    </div>
  );
}
