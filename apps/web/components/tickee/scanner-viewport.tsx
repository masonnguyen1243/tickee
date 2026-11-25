'use client';

import { Search } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';

import { OfflineBanner } from '@/components/tickee/offline-banner';
import { Button } from '@/components/ui/button';

/** Dòng ở đáy khung camera khi `offline-banner` hiện (Story 5.4, UX-DR31). */
export const CAMERA_PAUSED_TEXT = 'Camera tạm dừng · tự thử lại';
/** Dòng ở đáy khung camera khi lần gửi quét chưa xong sau 1 giây (Story 5.4). */
export const SCAN_SENDING_TEXT = 'Đang gửi…';

/**
 * Nút "Tra tay" (`button-secondary`, vùng ngón cái): luôn hiện, mở `manual-lookup` (Story 5.5). Dùng chung cho Màn quét
 * và các màn "Bật camera", camera bị từ chối / không mở được.
 */
export function ManualLookupButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="secondary" className="w-full" aria-haspopup="dialog" onClick={onClick}>
      <Search aria-hidden="true" />
      Tra tay
    </Button>
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
  /**
   * Mất kết nối (Story 5.4): `offline-banner` trên cùng màn (trên tên Sự kiện), khung camera phủ đen 50% kèm "Camera tạm
   * dừng · tự thử lại". Không tự tắt camera: nơi gọi dừng giải mã.
   */
  offline?: boolean;
  /** Lần gửi quét đang chờ quá 1 giây: "Đang gửi…" ở đáy khung camera. `offline` thắng. */
  sending?: boolean;
  /** Chạm "Tra tay": mở `manual-lookup`. */
  onManualLookup: () => void;
};

/**
 * `scanner-viewport` (UX-DR29, DESIGN.md › Màn quét): đỉnh màn là tên Sự kiện (`text-label`) và "Đã check-in k/N"; giữa
 * là khung camera toàn chiều rộng với khung ngắm vuông bo `rounded-lg`, viền trắng 3px; đáy là "Tra tay" ở vùng ngón cái.
 * Theo theme đang dùng; chỉ khung camera luôn tối. Mất kết nối (UX-DR31): `offline-banner` trên cùng, khung camera tạm
 * dừng; "Tra tay" giữ nguyên (tra tay cũng cần mạng: `manual-lookup` tự báo). Dòng trạng thái ở đáy khung camera đọc
 * bằng `aria-live="polite"` ("Đang gửi…", "Camera tạm dừng · tự thử lại"); vùng live luôn có mặt để trình đọc màn hình
 * nhận được thay đổi.
 */
export function ScannerViewport({
  eventName,
  checkedInCount,
  validTicketCount,
  videoRef,
  notice,
  offline = false,
  sending = false,
  onManualLookup,
}: ScannerViewportProps) {
  return (
    <div data-slot="scanner-viewport" className="flex min-h-0 flex-1 flex-col">
      {offline ? (
        <div className="px-gutter-mobile pt-2">
          <OfflineBanner />
        </div>
      ) : null}
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
        data-paused={offline ? '' : undefined}
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
        {offline ? <div aria-hidden="true" data-slot="scanner-paused" className="absolute inset-0 bg-black/50" /> : null}
        <p
          aria-live="polite"
          data-slot="scanner-status"
          className="absolute inset-x-0 bottom-4 flex justify-center px-4 text-center text-meta text-white"
        >
          {offline ? (
            <span key="paused" data-slot="scanner-paused-text">
              {CAMERA_PAUSED_TEXT}
            </span>
          ) : sending ? (
            <span key="sending" data-slot="scanner-sending" className="rounded-full bg-black/60 px-3 py-1">
              {SCAN_SENDING_TEXT}
            </span>
          ) : null}
        </p>
      </div>
      <div className="px-gutter-mobile pt-3.5 pb-4">
        <ManualLookupButton onClick={onManualLookup} />
      </div>
    </div>
  );
}
