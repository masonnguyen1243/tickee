'use client';

import { Search } from 'lucide-react';
import { useId, type ReactNode, type RefObject } from 'react';

import { Button } from '@/components/ui/button';

/** "Tra tay" luôn hiện ở Màn quét nhưng chưa dùng được (Story 5.5 nối `manual-lookup`). */
export const MANUAL_LOOKUP_PENDING = 'Tra tay sắp có';

/**
 * Nút "Tra tay" (`button-secondary`, vùng ngón cái): luôn hiện, bị tắt, kèm dòng lý do hiển thị. Dùng chung cho Màn quét
 * và các màn camera bị từ chối / không mở được.
 */
export function ManualLookupButton() {
  const reasonId = useId();
  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant="secondary" className="w-full" disabled aria-describedby={reasonId}>
        <Search aria-hidden="true" />
        Tra tay
      </Button>
      <p id={reasonId} className="text-center text-meta text-muted-foreground">
        {MANUAL_LOOKUP_PENDING}
      </p>
    </div>
  );
}

type ScannerViewportProps = {
  eventName: string;
  checkedInCount: number;
  validTicketCount: number;
  /** Gắn vào `<video>`: stream camera của `useQrScanner`. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Dải báo ngay dưới đỉnh màn (vd. gửi kết quả quét lỗi). */
  notice?: ReactNode;
};

/**
 * `scanner-viewport` (UX-DR29, DESIGN.md › Màn quét): đỉnh màn là tên Sự kiện (`text-label`) và "Đã check-in k/N"; giữa
 * là khung camera toàn chiều rộng với khung ngắm vuông bo `rounded-lg`, viền trắng 3px; đáy là "Tra tay" ở vùng ngón cái.
 * Theo theme đang dùng; chỉ khung camera luôn tối.
 */
export function ScannerViewport({ eventName, checkedInCount, validTicketCount, videoRef, notice }: ScannerViewportProps) {
  return (
    <div data-slot="scanner-viewport" className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-end justify-between gap-stack px-gutter-mobile pt-2 pb-3">
        <h1 className="min-w-0 text-label wrap-break-word">{eventName}</h1>
        <p data-slot="scanner-count" className="shrink-0 text-right">
          <span className="block text-meta text-muted-foreground">Đã check-in</span>{' '}
          <span className="block text-total tabular-nums">
            {checkedInCount}/{validTicketCount}
          </span>
        </p>
      </header>
      {notice ? <div className="px-gutter-mobile pb-3">{notice}</div> : null}
      <div
        data-slot="scanner-camera"
        className="relative mx-gutter-mobile min-h-40 flex-1 overflow-hidden rounded-lg bg-stage"
      >
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          aria-label="Camera đang quét Mã QR vé"
          className="absolute inset-0 size-full object-cover"
        />
        <div
          aria-hidden="true"
          data-slot="scanner-frame"
          className="absolute top-1/2 left-1/2 size-[min(17.5rem,70vw,48dvh)] -translate-1/2 rounded-lg border-3 border-white shadow-[0_0_0_9999px_rgb(0_0_0/0.28)]"
        />
      </div>
      <div className="px-gutter-mobile pt-3.5 pb-4">
        <ManualLookupButton />
      </div>
    </div>
  );
}
