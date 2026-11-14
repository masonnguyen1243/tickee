'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ErrorCode,
  formatVnDateTime,
  PaymentServiceReason,
  PaymentServiceStatus,
  type PaymentServiceState,
  type PayoutAccountOverview,
} from '@tickee/contracts';
import { useId } from 'react';
import { toast } from 'sonner';

import { StatusBadge } from '@/components/tickee/status-badge';
import { TingeeLink } from '@/components/tickee/tingee-link';
import { Button } from '@/components/ui/button';
import { handledElsewhere } from '@/lib/api/handled-elsewhere';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import { useGoToLogin } from '@/lib/auth/use-go-to-login';
import { refreshEventSaleStatus } from '@/lib/event/sale-status';
import { checkPaymentService, payoutAccountQueryKey } from '@/lib/organizer/api';
import {
  PAYMENT_SERVICE_CONSEQUENCE,
  PAYMENT_SERVICE_GUIDE,
  PAYMENT_SERVICE_REASON_TEXT,
  paymentServiceCheckToast,
} from '@/lib/organizer/payment-service';
import { statusNoticesQueryKey } from '@/lib/reporting/api';

import { cardClass, CHANGE_KEY, refreshOverview } from './shared';

type PaymentServiceBlockProps = {
  orgId: string;
  state: PaymentServiceState;
  portalUrl: string;
  /** "Đổi key Tingee" (luồng xác nhận lại + thay key của 2.13-b); không truyền khi luồng đó đang mở. */
  onChangeKey?: () => void;
  changeKeyPending: boolean;
};

/**
 * Khối "Dịch vụ thanh toán" đầu trang Tài khoản nhận tiền (Story 4.2-b, FR-15, UX-DR40), chỉ khi BTC `suspended`:
 * `status-badge` danger, lý do và hậu quả, "Từ {lúc ngắt}", lần kiểm tra gần nhất (giờ Việt Nam), hướng dẫn theo lý do
 * (kèm liên kết portal Tingee, hoặc "Đổi key Tingee" khi key không còn dùng được) và "Kiểm tra lại" (spinner, chặn bấm
 * lặp, toast theo `outcome`). Kết quả kiểm tra ghi thẳng vào tổng quan đã cache (dịch vụ về thì khối biến mất), rồi
 * tổng quan và dải banner tải lại. Xử lý kết quả đặt trên `useMutation` để `Providers` gửi lại được sau khi qua lớp hai.
 */
export function PaymentServiceBlock({ orgId, state, portalUrl, onChangeKey, changeKeyPending }: PaymentServiceBlockProps) {
  const titleId = useId();
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();

  const check = useMutation({
    mutationFn: () => checkPaymentService(orgId),
    onSuccess: async (result) => {
      const { kind, message } = paymentServiceCheckToast(result);
      toast[kind](message);
      // Lần đọc tổng quan đang chạy có thể về sau và ghi đè bằng trạng thái cũ: hủy nó, hiện ngay kết quả kiểm tra, rồi
      // đọc lại cả tổng quan (lần tải bị hủy có thể là lần tải lại do tín hiệu, mang thay đổi khác).
      await queryClient.cancelQueries({ queryKey: payoutAccountQueryKey(orgId), exact: true });
      queryClient.setQueryData<PayoutAccountOverview>(payoutAccountQueryKey(orgId), (prev) =>
        prev ? { ...prev, paymentService: result.state } : prev,
      );
      void queryClient.invalidateQueries({ queryKey: payoutAccountQueryKey(orgId), exact: true });
      void queryClient.invalidateQueries({ queryKey: statusNoticesQueryKey(orgId) });
      // Mở lại dịch vụ thì Sự kiện có phí bán lại: nhãn trạng thái bán (Story 4.2-c).
      void refreshEventSaleStatus(queryClient, orgId);
    },
    onError: (error) => {
      if (handledElsewhere(error)) {
        if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
        return;
      }
      // Vai vừa đổi (không còn là Owner): đọc lại để trang chuyển đúng trạng thái.
      if (hasErrorCode(error, ErrorCode.FORBIDDEN_ROLE)) refreshOverview(queryClient, orgId);
      toast.error(messageOf(error));
    },
  });

  const { reason, since } = state;
  if (state.status !== PaymentServiceStatus.SUSPENDED || !reason || !since) return null;

  let extra = null;
  if (reason === PaymentServiceReason.TOKEN || reason === PaymentServiceReason.PAYOUT_ACCOUNT_NOT_ALLOWED) {
    extra = <TingeeLink href={portalUrl}>Mở portal Tingee</TingeeLink>;
  } else if (reason === PaymentServiceReason.GATEWAY_PERMISSION_MISSING) {
    extra = <TingeeLink href={`${portalUrl}/api-credentials`}>Mở trang API key trên Tingee</TingeeLink>;
  }

  return (
    <section aria-labelledby={titleId} data-slot="payment-service-block" className={cardClass}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id={titleId} className="text-title">
          Dịch vụ thanh toán
        </h2>
        <StatusBadge tone="danger">Tạm ngừng bán</StatusBadge>
      </div>
      <p className="text-body" data-slot="payment-service-reason">
        {PAYMENT_SERVICE_REASON_TEXT[reason]} {PAYMENT_SERVICE_CONSEQUENCE}
      </p>
      <div className="flex flex-col gap-1 text-meta text-muted-foreground" data-slot="payment-service-times">
        <p>{`Từ ${formatVnDateTime(since)}`}</p>
        <p>{state.checkedAt ? `Lần kiểm tra gần nhất: ${formatVnDateTime(state.checkedAt)}` : 'Chưa kiểm tra'}</p>
      </div>
      <p className="text-body" data-slot="payment-service-guide">
        {PAYMENT_SERVICE_GUIDE[reason]}
        {extra ? <> {extra}</> : null}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" loading={check.isPending} onClick={() => check.mutate()}>
          Kiểm tra lại
        </Button>
        {reason === PaymentServiceReason.CREDENTIAL_INVALID && onChangeKey ? (
          <Button type="button" variant="secondary" loading={changeKeyPending} onClick={onChangeKey}>
            {CHANGE_KEY}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
