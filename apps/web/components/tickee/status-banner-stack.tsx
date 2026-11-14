'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  organizationLiveApiPath,
  PAYMENT_SERVICE_NOTICE_CODES,
  STATUS_BANNER_LIMIT,
  type StatusNotice,
  type StatusNoticeCode,
} from '@tickee/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { payoutAccountQueryKey } from '@/lib/organizer/api';
import { useLiveResource } from '@/lib/realtime/use-live-resource';
import { fetchStatusNotices, STATUS_NOTICES_POLL_MS, statusNoticesQueryKey } from '@/lib/reporting/api';
import {
  isStatusNoticeDismissed,
  saveStatusNoticeDismissed,
  statusNoticeContent,
  statusNoticeDismissKey,
  statusNoticeLink,
} from '@/lib/reporting/status-notices';

import { useCurrentOrganization } from './current-organization';
import { StatusBanner } from './status-banner';
import { TingeeLink } from './tingee-link';

const PAYMENT_SERVICE_CODES: ReadonlySet<StatusNoticeCode> = new Set(Object.values(PAYMENT_SERVICE_NOTICE_CODES));
const pollInterval = () => STATUS_NOTICES_POLL_MS;

function NoticeBanner({ notice, onDismiss }: { notice: StatusNotice; onDismiss: (notice: StatusNotice) => void }) {
  const organization = useCurrentOrganization();
  const content = statusNoticeContent(notice.code, organization.role);
  const link = content.action ? statusNoticeLink(content.action, notice, organization.id) : null;
  return (
    <StatusBanner
      tone={notice.severity}
      title={content.title}
      description={content.description}
      action={
        link ? (
          <Button asChild variant="link" size="sm">
            {link.external ? (
              <TingeeLink href={link.href}>{link.label}</TingeeLink>
            ) : (
              <Link href={link.href}>{link.label}</Link>
            )}
          </Button>
        ) : undefined
      }
      onDismiss={notice.dismissible ? () => onDismiss(notice) : undefined}
    />
  );
}

/**
 * Dải `status-banner` đầu vùng nội dung dashboard một BTC (UX-DR8, AD-34): dữ liệu từ `GET /v1/orgs/:orgId/notices`
 * (đã lọc theo vai và sắp theo ưu tiên ở api), web chỉ ánh xạ `code` (+ vai người xem) sang nội dung và nút (link trong
 * app, hoặc liên kết ngoài mở tab mới). Hiện tối đa `STATUS_BANNER_LIMIT` banner, còn lại gộp "+N thông báo" mở `Sheet`.
 * Banner `dismissible` đóng được và ẩn theo `code` + `version` tới hết phiên trình duyệt. Thay đổi được đọc qua
 * `aria-live="polite"` (vùng luôn có trong DOM). Lỗi tải thì không hiện gì: 401, 2FA và bị xóa khỏi BTC do khung
 * dashboard / `Providers` xử lý.
 *
 * Tự cập nhật (Story 4.2-b, AD-17): `useLiveResource` + stream cấp BTC `GET /v1/orgs/:orgId/live`; mỗi tín hiệu
 * (`org_status_changed`, `resync`) tải lại `notices` và tổng quan Tài khoản nhận tiền (khối "Dịch vụ thanh toán", chỉ khi
 * trang đó đang mở). Không có SSE thì polling `notices` 10 giây; banner dịch vụ thanh toán đổi giữa hai lần polling thì
 * tổng quan Tài khoản nhận tiền cũng tải lại.
 */
export function StatusBannerStack({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const refreshPayoutOverview = () =>
    void queryClient.invalidateQueries({ queryKey: payoutAccountQueryKey(orgId), exact: true });
  const { query: notices, connected } = useLiveResource({
    queryKey: statusNoticesQueryKey(orgId),
    queryFn: (signal) => fetchStatusNotices(orgId, signal),
    livePath: organizationLiveApiPath(orgId),
    pollInterval,
    onSignal: refreshPayoutOverview,
  });

  // Polling (không có SSE nên không có `onSignal`): khối "Dịch vụ thanh toán" theo kịp banner khi cờ đổi.
  const paymentServiceKey = notices.data
    ?.filter((n) => PAYMENT_SERVICE_CODES.has(n.code))
    .map(statusNoticeDismissKey)
    .join('|');
  const lastPaymentServiceKey = useRef(paymentServiceKey);
  const refreshPayoutRef = useRef(refreshPayoutOverview);
  refreshPayoutRef.current = refreshPayoutOverview;
  useEffect(() => {
    if (paymentServiceKey === undefined) return;
    const previous = lastPaymentServiceKey.current;
    lastPaymentServiceKey.current = paymentServiceKey;
    if (!connected && previous !== undefined && previous !== paymentServiceKey) refreshPayoutRef.current();
  }, [paymentServiceKey, connected]);
  /** Đã đóng ở lần render này của trang (sessionStorage giữ cho lần tải sau). */
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [sheetOpen, setSheetOpen] = useState(false);

  const visible = (notices.data ?? []).filter(
    (n) => !(n.dismissible && (dismissed.has(statusNoticeDismissKey(n)) || isStatusNoticeDismissed(n))),
  );
  const shown = visible.slice(0, STATUS_BANNER_LIMIT);
  const rest = visible.slice(STATUS_BANNER_LIMIT);
  // Đóng hết thông báo trong Sheet thì Sheet cũng đóng (chỉnh state lúc render, không cần effect).
  if (sheetOpen && rest.length === 0) setSheetOpen(false);

  const dismiss = (notice: StatusNotice) => {
    saveStatusNoticeDismissed(notice);
    setDismissed((prev) => new Set(prev).add(statusNoticeDismissKey(notice)));
  };

  return (
    <div
      aria-live="polite"
      data-slot="status-banner-stack"
      className="flex flex-col gap-2 [&:not(:empty)]:pt-2 [&:not(:empty)]:pb-4"
    >
      {shown.map((notice) => (
        <NoticeBanner key={statusNoticeDismissKey(notice)} notice={notice} onDismiss={dismiss} />
      ))}
      {rest.length > 0 ? (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button type="button" variant="secondary" size="sm" className="self-start">
              +{rest.length} thông báo
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" data-slot="status-banner-sheet">
            <SheetHeader>
              <SheetTitle>Thông báo khác</SheetTitle>
              <SheetDescription>{`${rest.length} thông báo khác của BTC.`}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-2">
              {rest.map((notice) => (
                <NoticeBanner key={statusNoticeDismissKey(notice)} notice={notice} onDismiss={dismiss} />
              ))}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}
