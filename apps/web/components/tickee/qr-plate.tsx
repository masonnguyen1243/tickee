'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

/** Màu QR cố định mọi chế độ (`--qr-module` / `--qr-plate`, DESIGN.md › Colors): không bao giờ đảo ở dark mode. */
const QR_MODULE = '#000000ff';
const QR_PLATE = '#ffffffff';

type QrPlateProps = {
  /** Nội dung mã hóa vào QR. */
  value: string;
  /** Tên của ảnh QR cho trình đọc màn hình. */
  label: string;
  /** Cạnh ảnh QR (px CSS), không gồm đệm của tấm. Mã QR vé tối thiểu 200 (DESIGN.md › ticket-card). */
  size?: number;
  className?: string;
};

/**
 * Tấm QR dùng chung (Mã QR vé, QR đăng ký TOTP): module đen trên tấm trắng `qr-plate`, bo `lg`, đệm `qr-plate-padding`,
 * ở cả theme sáng lẫn tối. Ảnh vẽ gấp đôi độ phân giải để nét trên màn hình mật độ cao. Đang vẽ → ô giữ chỗ cùng cỡ.
 */
export function QrPlate({ value, label, size = 200, className }: QrPlateProps) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      margin: 1,
      width: size * 2,
      errorCorrectionLevel: 'M',
      color: { dark: QR_MODULE, light: QR_PLATE },
    })
      .then((url) => !cancelled && setSrc(url))
      .catch(() => !cancelled && setSrc(null));
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  return (
    <div data-slot="qr-plate" className={cn('flex w-fit rounded-lg bg-qr-plate p-qr-plate-padding', className)}>
      {src ? (
        <img src={src} width={size} height={size} alt={label} className="block" style={{ width: size, height: size }} />
      ) : (
        <div aria-hidden="true" className="animate-pulse rounded-sm bg-black/10" style={{ width: size, height: size }} />
      )}
    </div>
  );
}
