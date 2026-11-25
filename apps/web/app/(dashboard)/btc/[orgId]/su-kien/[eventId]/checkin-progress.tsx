'use client';

import { useQueryClient } from '@tanstack/react-query';
import { checkinEventLiveApiPath, ErrorCode, type CheckinTicketTypeProgress } from '@tickee/contracts';
import { useEffect, useId, useRef } from 'react';

import { ProgressBar } from '@/components/tickee/progress-bar';
import { StatCard } from '@/components/tickee/stat-card';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { handledElsewhere } from '@/lib/api/handled-elsewhere';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import { useGoToLogin } from '@/lib/auth/use-go-to-login';
import { checkinEventQueryKey, fetchCheckinEvent } from '@/lib/checkin/api';
import {
  CHECKIN_PROGRESS_LABEL,
  CHECKIN_PROGRESS_LOAD_FAILED,
  CHECKIN_PROGRESS_LOADING,
  CHECKIN_PROGRESS_TITLE,
  CHECKIN_PROGRESS_TOTAL,
  checkinProgressCaption,
  checkinProgressPollInterval,
  progressLabel,
  progressValueText,
} from '@/lib/checkin/progress-view';
import { useLiveResource } from '@/lib/realtime/use-live-resource';

function ProgressSkeleton() {
  return (
    <div role="status" aria-busy="true" data-slot="checkin-progress-skeleton" className="flex flex-col gap-stack">
      <span className="sr-only">{CHECKIN_PROGRESS_LOADING}</span>
      <Skeleton className="h-28" />
      <Skeleton className="h-24" />
    </div>
  );
}

/** Một hàng Hạng vé: tên (xuống dòng khi dài), "k/N" tabular không bị đẩy ra ngoài, thanh tiến độ trên `card` sáng. */
function TicketTypeRow({ type }: { type: CheckinTicketTypeProgress }) {
  return (
    <li data-slot="checkin-progress-row" className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-start justify-between gap-stack">
        <span data-slot="checkin-progress-name" className="min-w-0 text-label wrap-break-word">
          {type.name}
        </span>
        <span data-slot="checkin-progress-count" className="shrink-0 text-label tabular-nums">
          {progressLabel(type.checkedInCount, type.validTicketCount)}
        </span>
      </div>
      <ProgressBar
        tone="card"
        value={type.checkedInCount}
        max={type.validTicketCount}
        label={type.name}
        valueText={progressValueText(type.checkedInCount, type.validTicketCount)}
      />
    </li>
  );
}

/**
 * `checkin-progress` (Story 5.7, FR-30, UX-DR39): khối đầu tab Check-in. Tổng ở `stat-card` ("Check-in", "k/N", thanh
 * nền `stage-line` phần đầy `brand`), dưới đó mỗi Hạng vé một hàng trên `card` sáng, theo thứ tự api (tạo trước đứng
 * trước; Hạng vé chưa có Vé hợp lệ → "0/0", thanh rỗng). Tự cập nhật qua `useLiveResource` + `GET …/checkin/events/:id/
 * live` (tín hiệu `event_checkins_changed` → tải lại `CheckinEvent`, cùng khóa với Màn quét); không có SSE thì polling
 * 10 giây. Dòng phụ "Cập nhật liên tục"; số liệu có thể đã cũ (mất mạng, hoặc lần tải lại lỗi mà vẫn còn dữ liệu cũ) →
 * "Cập nhật lúc HH:MM:SS". Tải lần đầu → skeleton; lỗi lần đầu → `StatusBanner` kèm "Thử lại"; `401` → đăng nhập.
 */
export function CheckinProgress({ eventId }: { eventId: string }) {
  const titleId = useId();
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  const { query, offline } = useLiveResource({
    queryKey: checkinEventQueryKey(eventId),
    queryFn: (signal) => fetchCheckinEvent(eventId, signal),
    livePath: checkinEventLiveApiPath(eventId),
    pollInterval: checkinProgressPollInterval,
  });

  const unauthenticated = hasErrorCode(query.error, ErrorCode.UNAUTHENTICATED);
  const goToLoginRef = useRef(goToLogin);
  goToLoginRef.current = goToLogin;
  const redirected = useRef(false);
  useEffect(() => {
    if (!unauthenticated || redirected.current) return;
    redirected.current = true;
    // Bỏ khỏi cache: quay lại sau đăng nhập không mang theo lỗi 401 cũ (sẽ đẩy về đăng nhập lần nữa).
    queryClient.removeQueries({ queryKey: checkinEventQueryKey(eventId) });
    goToLoginRef.current();
  }, [unauthenticated, queryClient, eventId]);

  const data = query.data;
  // Số liệu đang hiện có thể đã cũ: mất mạng, hoặc lần tải lại gần nhất lỗi (vd. 5xx sau khi đã thử lại) mà vẫn còn dữ
  // liệu cũ. Lỗi do nơi khác xử lý (401, 2FA…) không tính.
  const stale = offline || (query.isError && data !== undefined && !handledElsewhere(query.error));

  let body;
  if (data) {
    body = (
      <>
        <StatCard
          label={CHECKIN_PROGRESS_LABEL}
          value={progressLabel(data.checkedInCount, data.validTicketCount)}
          meter={
            <ProgressBar
              tone="stage"
              value={data.checkedInCount}
              max={data.validTicketCount}
              label={CHECKIN_PROGRESS_TOTAL}
              valueText={progressValueText(data.checkedInCount, data.validTicketCount)}
            />
          }
          caption={
            // Vùng live luôn có trong DOM: nhãn "Cập nhật lúc…" hiện ra được đọc cho trình đọc màn hình.
            <span aria-live="polite" data-slot="checkin-progress-caption" className="tabular-nums">
              {checkinProgressCaption({ stale, updatedAt: query.dataUpdatedAt })}
            </span>
          }
        />
        {data.ticketTypes.length > 0 ? (
          <div data-slot="checkin-progress-types" className="min-w-0 rounded-lg bg-card p-card-padding shadow-card">
            <ul className="flex flex-col gap-section">
              {data.ticketTypes.map((type) => (
                <TicketTypeRow key={type.ticketTypeId} type={type} />
              ))}
            </ul>
          </div>
        ) : null}
      </>
    );
  } else if (query.isError && !handledElsewhere(query.error)) {
    body = (
      <div data-slot="checkin-progress-error">
        <StatusBanner
          tone="danger"
          title={CHECKIN_PROGRESS_LOAD_FAILED}
          description={messageOf(query.error)}
          action={
            <Button type="button" variant="link" size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
              Thử lại
            </Button>
          }
        />
      </div>
    );
  } else {
    body = <ProgressSkeleton />;
  }

  return (
    <section aria-labelledby={titleId} data-slot="checkin-progress" className="flex min-w-0 flex-col gap-stack">
      <h2 id={titleId} className="sr-only">
        {CHECKIN_PROGRESS_TITLE}
      </h2>
      {body}
    </section>
  );
}
