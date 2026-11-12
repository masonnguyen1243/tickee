'use client';

import { useMutation } from '@tanstack/react-query';
import { sharedTicketUrl } from '@tickee/contracts';
import { Share2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { messageOf } from '@/lib/api/message-of';
import { regenerateShareLink } from '@/lib/order/api';
import { shareLink } from '@/lib/share';

import { ConfirmDialog } from './confirm-dialog';

/** Câu bắt buộc của Dialog tạo lại link (AC 3.8): tạo lại link chỉ thu hồi đường xem, không đổi Mã QR vé. */
export const QR_STILL_VALID = 'Ai đã thấy hoặc chụp mã QR vẫn có thể dùng mã để vào cổng.';

type TicketShareActionsProps = {
  ticketId: string;
  /** Token link chia sẻ hiện hành của Vé (`BuyerTicket.shareToken`). */
  shareToken: string;
  eventName: string;
  seq: number;
  count: number;
  /**
   * Tạo lại link xong (token mới): nơi gọi ghi token vào cache của trang mình rồi tải lại (Trang Đơn: Đơn; Chi tiết Vé:
   * Vé), để "Chia sẻ Vé" không bao giờ ra link đã chết kể cả khi lần tải lại lỗi.
   */
  onRegenerated: (shareToken: string) => void;
};

/**
 * Hành động chia sẻ trên `ticket-card` của chủ Vé (Story 3.8, AD-29):
 * - "Chia sẻ Vé" (`button-secondary`): link `{origin}/xem-ve#<token>` qua Web Share API; không có thì sao chép + toast
 *   "Đã sao chép"; người dùng hủy bảng chia sẻ thì im lặng. Bấm lặp ra cùng một link.
 * - "Tạo lại link": `ConfirmDialog` nói rõ link cũ chết và QR vẫn dùng được; xong thì đưa token mới cho
 *   `onRegenerated` (nơi gọi ghi vào cache của trang rồi tải lại: lần tải lại có lỗi thì "Chia sẻ Vé" vẫn ra link mới,
 *   không bao giờ ra link đã chết), rồi toast. Lỗi hiện trong Dialog.
 */
export function TicketShareActions({ ticketId, shareToken, eventName, seq, count, onRegenerated }: TicketShareActionsProps) {
  const [confirming, setConfirming] = useState(false);
  const position = `Vé ${seq}/${count}`;

  const regenerate = useMutation({
    mutationFn: () => regenerateShareLink(ticketId),
    onSuccess: ({ shareToken: next }) => {
      onRegenerated(next);
      setConfirming(false);
      toast.success(`Đã tạo link mới cho ${position}`);
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
