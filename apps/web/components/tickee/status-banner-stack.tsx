'use client';

import { useQuery } from '@tanstack/react-query';
import { STATUS_BANNER_LIMIT, type StatusNotice } from '@tickee/contracts';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { fetchStatusNotices, statusNoticesQueryKey } from '@/lib/reporting/api';
import {
  isStatusNoticeDismissed,
  saveStatusNoticeDismissed,
  STATUS_NOTICE_CONTENT,
  statusNoticeDismissKey,
} from '@/lib/reporting/status-notices';

import { StatusBanner } from './status-banner';

function NoticeBanner({ notice, onDismiss }: { notice: StatusNotice; onDismiss: (notice: StatusNotice) => void }) {
  const content = STATUS_NOTICE_CONTENT[notice.code];
  return (
    <StatusBanner
      tone={notice.severity}
      title={content.title}
      description={content.description}
      onDismiss={notice.dismissible ? () => onDismiss(notice) : undefined}
    />
  );
}

/**
 * Dải `status-banner` đầu vùng nội dung dashboard một BTC (UX-DR8, AD-34): dữ liệu từ `GET /v1/orgs/:orgId/notices`
 * (đã lọc theo vai và sắp theo ưu tiên ở api), web chỉ ánh xạ `code` sang nội dung. Hiện tối đa
 * `STATUS_BANNER_LIMIT` banner, còn lại gộp "+N thông báo" mở `Sheet`. Banner `dismissible` đóng được và ẩn theo
 * `code` + `version` tới hết phiên trình duyệt. Thay đổi được đọc qua `aria-live="polite"` (vùng luôn có trong DOM).
 * Lỗi tải thì không hiện gì: 401, 2FA và bị xóa khỏi BTC do khung dashboard / `Providers` xử lý.
 */
export function StatusBannerStack({ orgId }: { orgId: string }) {
  const notices = useQuery({
    queryKey: statusNoticesQueryKey(orgId),
    queryFn: ({ signal }) => fetchStatusNotices(orgId, signal),
  });
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
