'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  organizationLiveApiPath,
  PAYMENT_SERVICE_NOTICE_CODES,
  STATUS_BANNER_LIMIT,
  StatusNoticeCode,
  type StatusNotice,
} from '@tickee/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { refreshEventSaleStatus } from '@/lib/event/sale-status';
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

/**
 * Mã notice làm Hạng vé có phí "Tạm ngừng bán" (`paidOk` của `sellability`): bốn mã dịch vụ thanh toán, Closed Beta (thu
 * hồi, chờ duyệt) và chưa liên kết tài khoản nhận tiền. Polling thấy tập mã này đổi thì tải lại khối "Dịch vụ thanh toán"
 * và nhãn trạng thái bán (Story 4.2-c).
 */
const PAID_SALES_CODES: ReadonlySet<StatusNoticeCode> = new Set([
  ...Object.values(PAYMENT_SERVICE_NOTICE_CODES),
  StatusNoticeCode.CLOSED_BETA_REVOKED,
  StatusNoticeCode.CLOSED_BETA_PENDING,
  StatusNoticeCode.PAYOUT_ACCOUNT_NOT_LINKED,
]);
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
 * (`org_status_changed`, `resync`) tải lại `notices`, tổng quan Tài khoản nhận tiền (khối "Dịch vụ thanh toán", chỉ khi
 * trang đó đang mở) và trạng thái bán của Sự kiện (badge "Tạm ngừng bán" ở trang chủ BTC và tab Tổng quan, Story 4.2-c).
 * Không có SSE thì polling `notices` 10 giây; banner về điều kiện bán Vé có phí (dịch vụ thanh toán, Closed Beta, tài khoản
 * nhận tiền) đổi giữa hai lần polling thì hai tài nguyên kia cũng tải lại.
 */
export function StatusBannerStack({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const refreshPaymentServiceViews = () => {
    void queryClient.invalidateQueries({ queryKey: payoutAccountQueryKey(orgId), exact: true });
    void refreshEventSaleStatus(queryClient, orgId);
  };
  const { query: notices, connected } = useLiveResource({
    queryKey: statusNoticesQueryKey(orgId),
    queryFn: (signal) => fetchStatusNotices(orgId, signal),
    livePath: organizationLiveApiPath(orgId),
    pollInterval,
    onSignal: refreshPaymentServiceViews,
  });

  // Polling (không có SSE nên không có `onSignal`): khối "Dịch vụ thanh toán" và badge trạng thái bán theo kịp banner khi
  // điều kiện bán Vé có phí đổi.
  const paidSalesKey = notices.data
    ?.filter((n) => PAID_SALES_CODES.has(n.code))
    .map(statusNoticeDismissKey)
    .join('|');
  const lastPaidSalesKey = useRef(paidSalesKey);
  const refreshViewsRef = useRef(refreshPaymentServiceViews);
  refreshViewsRef.current = refreshPaymentServiceViews;
  useEffect(() => {
    if (paidSalesKey === undefined) return;
    const previous = lastPaidSalesKey.current;
    lastPaidSalesKey.current = paidSalesKey;
    if (!connected && previous !== undefined && previous !== paidSalesKey) refreshViewsRef.current();
  }, [paidSalesKey, connected]);
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
