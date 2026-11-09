import {
  EventSaleReason,
  formatEventDateTime,
  TierSaleStatus,
  type EventAvailability,
  type TierAvailability,
} from '@tickee/contracts';

import type { StatusTone } from '@/components/tickee/tone';

/** Id của khối "Chính sách hoàn vé" trên trang Sự kiện (dòng ghi chú dưới danh sách Hạng vé trỏ tới đây). */
export const REFUND_POLICY_ANCHOR = 'chinh-sach-hoan-ve';

/** "Còn N vé" đậm màu thương hiệu khi còn từ chừng này vé trở xuống. */
export const LOW_STOCK_THRESHOLD = 10;

export type SaleBanner = { tone: StatusTone; title: string };

/**
 * Banner trạng thái của trang Sự kiện công khai, theo `eventReason` (không đóng được). `null` khi Sự kiện bán bình
 * thường. Người mua không bao giờ thấy banner hệ thống của BTC.
 */
export function saleBanner(availability: EventAvailability): SaleBanner | null {
  switch (availability.eventReason) {
    case EventSaleReason.CANCELLED:
      return { tone: 'danger', title: 'Sự kiện đã hủy' };
    case EventSaleReason.LOCKED:
      return { tone: 'danger', title: 'Sự kiện tạm thời không nhận Đơn.' };
    case EventSaleReason.HIDDEN:
      return { tone: 'warning', title: 'Sự kiện tạm dừng nhận Đơn' };
    case EventSaleReason.ENDED:
      return { tone: 'neutral', title: 'Sự kiện đã kết thúc' };
    case EventSaleReason.PAUSED:
      return availability.tiers.some((t) => t.status === TierSaleStatus.ON_SALE)
        ? { tone: 'warning', title: 'Một số Hạng vé đang tạm ngừng bán.' }
        : { tone: 'warning', title: 'Sự kiện tạm ngừng bán. Bạn thử lại sau nhé.' };
    case null:
      return null;
  }
}

export type TierStatusText = { text: string; available: boolean; lowStock: boolean };

/** Dòng trạng thái của một `ticket-tier-row`. `available: false` → `ticket-tier-row-unavailable` (viền nét đứt). */
export function tierStatusText(tier: TierAvailability): TierStatusText {
  switch (tier.status) {
    case TierSaleStatus.ON_SALE:
      return { text: `Còn ${tier.remaining} vé`, available: true, lowStock: tier.remaining <= LOW_STOCK_THRESHOLD };
    case TierSaleStatus.NOT_STARTED:
      return {
        text: tier.saleStartsAt ? `Chưa mở bán · mở ${formatEventDateTime(tier.saleStartsAt)}` : 'Chưa mở bán',
        available: false,
        lowStock: false,
      };
    case TierSaleStatus.CLOSED:
      return { text: 'Đã đóng bán', available: false, lowStock: false };
    case TierSaleStatus.SOLD_OUT:
      return { text: 'Hết vé', available: false, lowStock: false };
    case TierSaleStatus.PAUSED:
      return { text: 'Tạm ngừng bán', available: false, lowStock: false };
    case TierSaleStatus.UNAVAILABLE:
      return { text: 'Không nhận Đơn', available: false, lowStock: false };
  }
}
