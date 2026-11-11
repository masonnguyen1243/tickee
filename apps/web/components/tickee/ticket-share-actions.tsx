'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sharedTicketUrl, type BuyerOrderView } from '@tickee/contracts';
import { Share2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { messageOf } from '@/lib/api/message-of';
import { buyerOrderQueryKey, regenerateShareLink } from '@/lib/order/api';
import { shareLink } from '@/lib/share';

import { ConfirmDialog } from './confirm-dialog';

/** Câu bắt buộc của Dialog tạo lại link (AC 3.8): tạo lại link chỉ thu hồi đường xem, không đổi Mã QR vé. */
export const QR_STILL_VALID = 'Ai đã thấy hoặc chụp mã QR vẫn có thể dùng mã để vào cổng.';

type TicketShareActionsProps = {
  /** Mã Đơn: tạo lại link xong thì tải lại Đơn này. */
  orderCode: string;
  ticketId: string;
  /** Token link chia sẻ hiện hành của Vé (`BuyerTicket.shareToken`). */
  shareToken: string;
  eventName: string;
  seq: number;
  count: number;
};

/**
 * Hành động chia sẻ trên `ticket-card` của chủ Vé (Story 3.8, AD-29):
 * - "Chia sẻ Vé" (`button-secondary`): link `{origin}/xem-ve#<token>` qua Web Share API; không có thì sao chép + toast
 *   "Đã sao chép"; người dùng hủy bảng chia sẻ thì im lặng. Bấm lặp ra cùng một link.
 * - "Tạo lại link": `ConfirmDialog` nói rõ link cũ chết và QR vẫn dùng được; xong thì ghi token mới vào Đơn trong cache
 *   (lần tải lại Đơn có lỗi thì "Chia sẻ Vé" vẫn ra link mới, không bao giờ ra link đã chết), toast, rồi tải lại Đơn.
 *   Lỗi hiện trong Dialog.
 */
export function TicketShareActions({ orderCode, ticketId, shareToken, eventName, seq, count }: TicketShareActionsProps) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const position = `Vé ${seq}/${count}`;

  const regenerate = useMutation({
    mutationFn: () => regenerateShareLink(ticketId),
    onSuccess: ({ shareToken: next }) => {
      const queryKey = buyerOrderQueryKey(orderCode);
      queryClient.setQueryData<BuyerOrderView>(queryKey, (order) =>
        order
          ? { ...order, tickets: order.tickets.map((t) => (t.id === ticketId ? { ...t, shareToken: next } : t)) }
          : order,
      );
      setConfirming(false);
      toast.success(`Đã tạo link mới cho ${position}`);
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        aria-label={`Chia sẻ Vé ${seq}/${count}`}
        onClick={() => {
          void shareLink({ title: `${position} · ${eventName}`, url: sharedTicketUrl(window.location.origin, shareToken) });
        }}
      >
        <Share2 aria-hidden="true" />
        Chia sẻ Vé
      </Button>
      <Button
        type="button"
        variant="link"
        size="sm"
        aria-label={`Tạo lại link Vé ${seq}/${count}`}
        onClick={() => {
          regenerate.reset();
          setConfirming(true);
        }}
      >
        Tạo lại link
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open) setConfirming(false);
        }}
        title={`Tạo lại link ${position}?`}
        description={`Link cũ sẽ không mở được nữa. ${QR_STILL_VALID}`}
        confirmLabel="Tạo lại link"
        onConfirm={() => regenerate.mutate()}
        pending={regenerate.isPending}
        failureTitle="Chưa tạo lại được link"
        failure={regenerate.isError && messageOf(regenerate.error)}
      />
    </>
  );
}
