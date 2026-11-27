'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorCode, type EventSheetConnection } from '@tickee/contracts';
import { ExternalLink, Loader2Icon } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/tickee/confirm-dialog';
import { StatusBadge } from '@/components/tickee/status-badge';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { handledElsewhere } from '@/lib/api/handled-elsewhere';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import { useGoToLogin } from '@/lib/auth/use-go-to-login';
import {
  disconnectSheets,
  fetchGoogleSheets,
  googleSheetsQueryKey,
  sheetsConnectionView,
  sheetsRefetchInterval,
  SHEETS_ALREADY_CONNECTED_TOAST,
  SHEETS_ALREADY_DISCONNECTED_TOAST,
  SHEETS_CONNECT_FAILED,
  SHEETS_CONNECT_LABEL,
  SHEETS_CREATING_LABEL,
  SHEETS_DESCRIPTION,
  SHEETS_DISCONNECT_CONSEQUENCES,
  SHEETS_DISCONNECT_LABEL,
  SHEETS_DISCONNECT_TITLE,
  SHEETS_DISCONNECTED_TOAST,
  SHEETS_KEEP_LABEL,
  SHEETS_OPEN_LABEL,
  SHEETS_TITLE,
  startSheetsConnect,
} from '@/lib/integration/google-sheets';

/*
 * Mục "Google Sheets" của tab Cài đặt Sự kiện (Story 6.4, FR-32, UX Cài đặt › Google Sheets):
 * - chưa kết nối: mô tả ngắn + nút viền "Kết nối Google Sheets" (không phải hành động chính của màn). Bấm → `POST
 *   …/connect` (spinner, chặn bấm lặp) rồi chuyển cả trang tới URL ủy quyền của Google; lỗi đi qua luồng mutation thường
 *   (2FA tự hỏi rồi chạy lại, 401 sang đăng nhập, lỗi khác toast). Quay lại bằng Back (bfcache) thì bỏ spinner.
 * - đã kết nối: badge trạng thái, "Mở Google Sheet" (tab mới; "Đang tạo Sheet…" khi worker chưa tạo xong), "Đồng bộ lần
 *   cuối", "Kết nối bởi <tên>", câu nhắc Sheet nằm trong Drive của người cấp (thành viên khác phải được chia sẻ trên
 *   Google), "Ngắt kết nối" qua `ConfirmDialog` nêu hậu quả (dừng đồng bộ, Sheet giữ nguyên trong Drive). "Đang tạo
 *   Sheet…" chỉ khi chưa có link mà còn `syncing`/`retrying`. Tải lại trạng thái mỗi 3 giây khi `syncing`, 15 giây khi
 *   `retrying`.
 * Kết quả của lượt OAuth (callback 302 về `?tab=cai-dat&notice=sheets-…`) do `NoticeToast` ở layout gốc báo.
 */

const cardClass = 'flex min-w-0 flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card';

function SheetsSkeleton() {
  return (
    <div role="status" aria-busy="true" data-slot="google-sheets-skeleton" className="flex flex-col gap-stack">
      <span className="sr-only">Đang tải kết nối Google Sheets</span>
      <Skeleton className="h-5 w-full max-w-80" />
      <Skeleton className="h-control-height w-52" />
    </div>
  );
}

function ConnectedBody({
  connection,
  onDisconnect,
}: {
  connection: EventSheetConnection;
  onDisconnect: () => void;
}) {
  const view = sheetsConnectionView(connection);
  return (
    <div className="flex min-w-0 flex-col gap-stack" data-slot="google-sheets-connected">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusBadge tone={view.badge.tone}>{view.badge.label}</StatusBadge>
        </div>
        {view.error ? (
          <p className="text-meta wrap-break-word text-muted-foreground" data-slot="google-sheets-error">
            {view.error}
          </p>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-body wrap-break-word tabular-nums" data-slot="google-sheets-last-synced">
          {view.lastSynced}
        </p>
        <p className="text-meta wrap-break-word text-muted-foreground" data-slot="google-sheets-connected-by">
          {view.connectedBy}
        </p>
        <p className="text-meta wrap-break-word text-muted-foreground" data-slot="google-sheets-drive-note">
          {view.driveNote}
        </p>
      </div>
      <div className="flex flex-col gap-stack sm:flex-row sm:flex-wrap sm:items-center">
        {connection.spreadsheetUrl ? (
          <Button asChild variant="secondary" className="self-start sm:self-auto">
            <a href={connection.spreadsheetUrl} target="_blank" rel="noopener noreferrer" data-slot="google-sheets-open">
              {SHEETS_OPEN_LABEL}
              <ExternalLink aria-hidden="true" />
              <span className="sr-only">(mở trong tab mới)</span>
            </a>
          </Button>
        ) : view.creating ? (
          <p
            role="status"
            className="inline-flex items-center gap-2 text-body text-muted-foreground"
            data-slot="google-sheets-creating"
          >
            <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
            {SHEETS_CREATING_LABEL}
          </p>
        ) : null}
        <Button type="button" variant="secondary" className="self-start sm:self-auto" onClick={onDisconnect}>
          {SHEETS_DISCONNECT_LABEL}
        </Button>
      </div>
    </div>
  );
}

/** Mục "Google Sheets" của tab Cài đặt. */
export function GoogleSheetsSection({ orgId, eventId }: { orgId: string; eventId: string }) {
  const titleId = useId();
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  const key = googleSheetsQueryKey(orgId, eventId);
  const [confirming, setConfirming] = useState(false);
  /** Đã nhận URL ủy quyền và đang rời trang: giữ spinner tới khi trình duyệt chuyển đi. */
  const [redirecting, setRedirecting] = useState(false);

  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchGoogleSheets(orgId, eventId, signal),
    refetchInterval: (q) => sheetsRefetchInterval(q.state.data?.connection),
  });

  // Quay lại bằng nút Back (bfcache) thì trang được khôi phục nguyên trạng: bỏ spinner để bấm lại được.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setRedirecting(false);
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  const connect = useMutation({
    mutationFn: () => startSheetsConnect(orgId, eventId),
    onSuccess: ({ authorizationUrl }) => {
      setRedirecting(true);
      window.location.assign(authorizationUrl);
    },
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
      else if (hasErrorCode(error, ErrorCode.SHEETS_ALREADY_CONNECTED)) {
        toast.info(SHEETS_ALREADY_CONNECTED_TOAST);
        void queryClient.invalidateQueries({ queryKey: key });
      } else if (!handledElsewhere(error)) toast.error(`${SHEETS_CONNECT_FAILED} ${messageOf(error)}`);
    },
  });

  const disconnect = useMutation({
    mutationFn: () => disconnectSheets(orgId, eventId),
    onSuccess: async () => {
      setConfirming(false);
      // Poll đang chạy (`syncing`) không được ghi đè trạng thái vừa ngắt.
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData(key, { connection: null });
      toast.success(SHEETS_DISCONNECTED_TOAST);
    },
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
      else if (hasErrorCode(error, ErrorCode.SHEETS_NOT_CONNECTED)) {
        setConfirming(false);
        toast.info(SHEETS_ALREADY_DISCONNECTED_TOAST);
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
  const disconnectFailure =
    disconnect.error &&
    !handledElsewhere(disconnect.error) &&
    !hasErrorCode(disconnect.error, ErrorCode.SHEETS_NOT_CONNECTED)
      ? messageOf(disconnect.error)
      : null;

  const connection = query.data?.connection;
  let body;
  if (query.data && connection) {
    body = (
      <ConnectedBody
        connection={connection}
        onDisconnect={() => {
          disconnect.reset();
          setConfirming(true);
        }}
      />
    );
  } else if (query.data) {
    body = (
      <div className="flex min-w-0 flex-col gap-stack" data-slot="google-sheets-not-connected">
        <p className="text-body wrap-break-word text-muted-foreground">{SHEETS_DESCRIPTION}</p>
        <div>
          <Button
            type="button"
            variant="secondary"
            loading={connect.isPending || redirecting}
            onClick={() => connect.mutate()}
          >
            {SHEETS_CONNECT_LABEL}
          </Button>
        </div>
      </div>
    );
  } else if (query.isError && !handledElsewhere(query.error)) {
    body = (
      <StatusBanner
        tone="danger"
        title="Chưa tải được kết nối Google Sheets"
        description={messageOf(query.error)}
        action={
          <Button type="button" variant="link" size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
            Thử lại
          </Button>
        }
      />
    );
  } else {
    body = <SheetsSkeleton />;
  }

  return (
    <section aria-labelledby={titleId} data-slot="google-sheets" className={cardClass}>
      <h2 id={titleId} className="text-title">
        {SHEETS_TITLE}
      </h2>
      {body}
      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => {
          if (open) return;
          disconnect.reset();
          setConfirming(false);
        }}
        title={SHEETS_DISCONNECT_TITLE}
        description={SHEETS_DISCONNECT_CONSEQUENCES}
        confirmLabel={SHEETS_DISCONNECT_LABEL}
        cancelLabel={SHEETS_KEEP_LABEL}
        onConfirm={() => disconnect.mutate()}
        pending={disconnect.isPending}
        failureTitle="Chưa ngắt kết nối được"
        failure={disconnectFailure}
      />
    </section>
  );
}
