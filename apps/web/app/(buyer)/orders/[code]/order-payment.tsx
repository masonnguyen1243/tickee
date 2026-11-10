'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatVnd, type BuyerOrder, type BuyerOrderPayment } from '@tickee/contracts';
import { useEffect, useState } from 'react';

import { CountdownChip } from '@/components/tickee/countdown-chip';
import { RecipientTrustBlock } from '@/components/tickee/recipient-trust-block';
import { StageBlock } from '@/components/tickee/stage-block';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { messageOf } from '@/lib/api/message-of';
import { buyerOrderQueryKey, retryPaymentLink } from '@/lib/order/api';
import { useServerCountdown } from '@/lib/order/use-server-countdown';

type OrderPaymentProps = {
  order: BuyerOrder;
  payment: BuyerOrderPayment;
  /** Giờ máy lúc nhận `order` (`dataUpdatedAt`), để bù lệch đồng hồ với `serverNow`. */
  receivedAt: number;
};

/** Chính sách hoàn vé của Đơn (bản chụp lúc đặt) trong `Sheet` từ dưới lên: đọc mà không rời Trang Đơn. */
function RefundPolicySheet({ policy }: { policy: string }) {
  return (
    <Sheet>
      {/* `sm` + `py-1`: cao vừa chữ (nút link cỡ mặc định cao 50px), vùng chạm vẫn ≥ 24px. */}
      <SheetTrigger asChild>
        <Button type="button" variant="link" size="sm" data-slot="refund-policy-link" className="self-start py-1">
          Chính sách hoàn vé
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="mx-auto max-w-content-max-buyer">
        <SheetHeader>
          <SheetTitle>Chính sách hoàn vé</SheetTitle>
          <SheetDescription>Do BTC đặt cho Sự kiện này, lúc bạn đặt Đơn.</SheetDescription>
        </SheetHeader>
        <p data-slot="refund-policy-text" className="whitespace-pre-line text-body">
          {policy}
        </p>
        <SheetClose asChild>
          <Button type="button" variant="primary-on-light" className="w-full">
            Đã hiểu
          </Button>
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}

/** Chấm 8px `brand-text` của dòng chờ (DESIGN.md › payment-summary › Trạng thái chờ). */
function WaitingDot() {
  return <span aria-hidden="true" className="mt-[5px] size-2 shrink-0 rounded-full bg-brand-text" />;
}

/**
 * Màn thanh toán của Trang Đơn khi Đơn `pending` (Story 3.4; DESIGN.md › `payment-summary`, EXPERIENCE › Niềm tin khi
 * thanh toán). Trên xuống: tên Sự kiện → stage (số tiền, `countdown-chip`, mã Đơn) → `recipient-trust-block` → link
 * "Chính sách hoàn vé" (`Sheet`) → dòng chờ → nút → "Tickee không giữ tiền của bạn"; tóm tắt Đơn nằm dưới (`OrderView`).
 * Mục đầu tới chân thấy được không cần cuộn ở 375×667.
 *
 * - Đã có link: "Thanh toán" hiện spinner rồi redirect toàn trang sang trang Tingee (không popup). Đồng hồ về 0 mà Đơn
 *   vẫn chờ → "Đang xác nhận thanh toán", ẩn nút; chỉ hiện Hết hạn khi máy chủ báo.
 * - Chưa có link: "Chưa tạo được link thanh toán" + "Thử lại" (gọi lại cho cùng Đơn, spinner, chặn bấm lặp); đồng hồ về 0
 *   thì ẩn "Thử lại" và chờ máy chủ báo hết hạn.
 */
export function OrderPayment({ order, payment, receivedAt }: OrderPaymentProps) {
  const queryClient = useQueryClient();
  const seconds = useServerCountdown(order.expiresAt, order.serverNow, receivedAt);
  const timeUp = seconds === 0;
  const checkoutUrl = payment.checkoutUrl;
  const confirming = timeUp && checkoutUrl !== null;

  // Spinner trong nút từ lúc bấm tới khi trình duyệt rời trang. Quay lại bằng nút Back (bfcache) thì bỏ spinner.
  const [redirecting, setRedirecting] = useState(false);
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setRedirecting(false);
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);
  const pay = () => {
    if (!checkoutUrl || redirecting) return;
    setRedirecting(true);
    window.location.assign(checkoutUrl);
  };

  // Xử lý kết quả trên `useMutation` (không trong `mutate(…, {})`): lần gọi lại sau 2FA cũng chạy các callback này.
  // Hủy lần hỏi lại định kỳ đang bay: nó bắt đầu trước khi có link nên kết quả (chưa có link) không được ghi đè lên
  // kết quả của "Thử lại".
  const retry = useMutation({
    mutationFn: () => retryPaymentLink(order.code),
    onMutate: () => queryClient.cancelQueries({ queryKey: buyerOrderQueryKey(order.code) }),
    onSuccess: (next) => queryClient.setQueryData(buyerOrderQueryKey(order.code), next),
  });

  return (
    <div className="flex flex-col gap-stack" data-slot="order-payment" data-link={checkoutUrl ? 'ready' : 'missing'}>
      <h1 data-slot="order-event-name" className="text-title wrap-break-word">
        {order.event.name}
      </h1>

      <StageBlock data-slot="payment-summary" className="flex flex-col items-center gap-2 text-center">
        <p className="text-label text-stage-muted">Số tiền cần trả</p>
        <p data-slot="payment-amount" className="text-amount tabular-nums">
          {formatVnd(order.totalAmount)}
        </p>
        <CountdownChip seconds={seconds} confirming={confirming} />
        <p className="text-meta text-stage-muted">
          Mã Đơn{' '}
          <span data-slot="order-code" className="font-mono text-code text-stage-foreground tabular-nums">
            {order.code}
          </span>
        </p>
      </StageBlock>

      <RecipientTrustBlock recipient={payment.recipient} />

      {order.refundPolicy ? <RefundPolicySheet policy={order.refundPolicy} /> : null}

      {/* Đổi sang "Đang xác nhận…" hay báo lỗi tạo link được đọc cho trình đọc màn hình. */}
      <div aria-live="polite" data-slot="payment-status">
        {checkoutUrl ? (
          <p data-slot="payment-waiting" className="flex gap-2 text-meta text-muted-foreground">
            <WaitingDot />
            <span>
              {confirming
                ? 'Đang xác nhận thanh toán. Nếu bạn đã trả, vé sẽ tự hiện — đừng trả lại.'
                : 'Đang chờ thanh toán — vé sẽ tự hiện khi BTC nhận được tiền.'}
            </span>
          </p>
        ) : (
          <div data-slot="payment-link-error" className="flex flex-col gap-1">
            <p className="text-label">Chưa tạo được link thanh toán</p>
            {retry.isError ? <p className="text-meta text-danger-text">{messageOf(retry.error)}</p> : null}
          </div>
        )}
      </div>

      {checkoutUrl && !confirming ? (
        <Button type="button" variant="primary-on-light" className="w-full" loading={redirecting} onClick={pay}>
          Thanh toán
        </Button>
      ) : null}
      {!checkoutUrl && !timeUp ? (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          loading={retry.isPending}
          onClick={() => retry.mutate()}
        >
          Thử lại
        </Button>
      ) : null}

      <p data-slot="payment-footer" className="text-center text-meta text-muted-foreground">
        Tickee không giữ tiền của bạn
      </p>
    </div>
  );
}
