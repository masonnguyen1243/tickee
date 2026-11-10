import type { Locator } from '@playwright/test';
import QRCode from 'qrcode';

import { expect } from './fixtures';

/** Lề (số module trắng) mà `components/tickee/qr-plate.tsx` vẽ quanh QR (`margin: 1`). */
const QR_MARGIN = 1;

/**
 * Ảnh QR `image` (do `QrPlate` vẽ: `qrcode`, mức sửa lỗi M, lề 1 module, rộng `size × 2`) mã hóa đúng `value`: vẽ ảnh lên
 * canvas trong trang, lấy màu ở tâm từng module rồi so với ma trận `QRCode.create(value)` (cùng thư viện, cùng mức sửa
 * lỗi, nên cùng phiên bản và mặt nạ).
 */
export async function expectQrImageEncodes(image: Locator, value: string): Promise<void> {
  const { modules } = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const expected = Array.from(modules.data, (bit) => (bit ? 1 : 0));
  const actual = await image.evaluate(
    async (img: HTMLImageElement, { size, margin }) => {
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(img, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const scale = canvas.width / (size + 2 * margin);
      const bits: number[] = [];
      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
          const x = Math.floor((col + margin + 0.5) * scale);
          const y = Math.floor((row + margin + 0.5) * scale);
          bits.push(data[(y * canvas.width + x) * 4]! < 128 ? 1 : 0);
        }
      }
      return bits;
    },
    { size: modules.size, margin: QR_MARGIN },
  );
  expect(actual).toEqual(expected);
}
