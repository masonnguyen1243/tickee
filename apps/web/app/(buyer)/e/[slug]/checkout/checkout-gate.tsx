'use client';

import { FunnelEventType } from '@tickee/contracts';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { sendFunnelEvent } from '@/lib/event/funnel';

import { BuyerGate } from '../../../buyer-gate';

/** `funnelId` của lần bấm "Mua" dẫn tới Checkout này (gửi kèm Đơn để API ghi `order_created`); không có → `null`. */
const CheckoutFunnelContext = createContext<string | null>(null);

export const useCheckoutFunnelId = (): string | null => useContext(CheckoutFunnelContext);

type CheckoutGateProps = {
  slug: string;
  /** `f` hợp lệ trên URL lúc mở Checkout. */
  funnelId: string | null;
  /** URL có tham số `f` (kể cả sai dạng): bỏ khỏi URL sau khi đã xử lý. */
  hasFunnelParam: boolean;
  /** URL Checkout chuẩn (chỉ có `items`), để bỏ `f` khỏi URL. */
  checkoutHref: string;
  children: ReactNode;
};

/**
 * Checkout cần đăng nhập (`BuyerGate`). Đã vào được và URL có `f` ("Mua" luôn đưa `f` sang, Story 3.2) → ghi
 * `login_completed` (không chờ; API chỉ ghi khi lần "Mua" đó phải đăng nhập) đúng một lần, rồi bỏ `f` khỏi URL bằng
 * History API (không tải lại trang, tải lại hay Back không ghi lần nữa). `funnelId` giữ trong state từ lần render đầu,
 * không đọc lại từ URL, để Checkout gửi kèm Đơn.
 */
export function CheckoutGate(props: CheckoutGateProps) {
  return (
    <BuyerGate>
      <FunnelRecorder {...props} />
    </BuyerGate>
  );
}

function FunnelRecorder({ slug, funnelId: initialFunnelId, hasFunnelParam, checkoutHref, children }: CheckoutGateProps) {
  const [funnelId] = useState(initialFunnelId);
  const recorded = useRef(false);
  useEffect(() => {
    if (!hasFunnelParam || recorded.current) return;
    recorded.current = true;
    if (funnelId) sendFunnelEvent(slug, { type: FunnelEventType.LOGIN_COMPLETED, funnelId });
    window.history.replaceState(window.history.state, '', `${checkoutHref}${window.location.hash}`);
  }, [hasFunnelParam, funnelId, slug, checkoutHref]);

  return <CheckoutFunnelContext value={funnelId}>{children}</CheckoutFunnelContext>;
}
