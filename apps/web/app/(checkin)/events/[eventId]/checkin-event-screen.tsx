'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorCode, ScanOutcome, type CheckinEvent, type ScanRequest } from '@tickee/contracts';
import { Camera, CameraOff, ShieldX, type LucideIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { ScanResultOverlay } from '@/components/tickee/scan-result-overlay';
import { ManualLookupButton, ScannerViewport } from '@/components/tickee/scanner-viewport';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import { LOGIN_PATH, withReturnTo } from '@/lib/auth/return-to';
import { isTotpRequired } from '@/lib/auth/totp';
import { checkinEventQueryKey, fetchCheckinEvent, submitScan } from '@/lib/checkin/api';
import { createScanSound, type ScanSound } from '@/lib/checkin/scan-sound';
import { scanView, type ScanView } from '@/lib/checkin/scan-view';
import { useQrScanner, type QrScanner } from '@/lib/checkin/use-qr-scanner';

/** Gửi kết quả quét lỗi (mạng, 5xx, lỗi khác): không hiện đỏ, quét lại bằng `scanId` mới. */
export const SCAN_SEND_FAILED = 'Chưa gửi được kết quả quét. Quét lại mã.';

/**
 * `403` của route CTV: người xem không quét được Sự kiện này (`NOT_A_MEMBER`, cả Sự kiện lạ hay id sai dạng), hoặc CTV
 * đã bị thu hồi (`CHECKER_REVOKED`). Hiện câu của api, không lộ tên Sự kiện. Không dùng `handledElsewhere`: ở đây
 * `NOT_A_MEMBER` không có dashboard nào xử lý thay.
 */
const NO_ACCESS_CODES = [ErrorCode.NOT_A_MEMBER, ErrorCode.CHECKER_REVOKED];
const noAccess = (error: unknown): boolean => NO_ACCESS_CODES.some((code) => hasErrorCode(error, code));

/** Lỗi do nơi khác xử lý: 401 (sang đăng nhập ngay dưới), 2FA và đồng ý NĐ 13 (`Providers`). */
const handledByGateOrProviders = (error: unknown): boolean =>
  hasErrorCode(error, ErrorCode.UNAUTHENTICATED) ||
  isTotpRequired(error) ||
  hasErrorCode(error, ErrorCode.CONSENT_REQUIRED);

/** Trang hiện tại làm `returnTo` của màn đăng nhập. */
const loginHere = () => withReturnTo(LOGIN_PATH, `${window.location.pathname}${window.location.search}`);

/** Khung một cột cho các màn không phải camera (tải, lỗi, hết quyền). */
function Screen({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-gutter-mobile pt-4">
      <Icon aria-hidden="true" strokeWidth={1.5} className="size-icon-button text-muted-foreground" />
      <h1 className="text-headline wrap-break-word">{title}</h1>
      {children}
    </div>
  );
}

function Loading() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-section px-gutter-mobile pt-4">
      <span className="sr-only">Đang tải</span>
      <div aria-hidden="true" className="h-9 w-2/3 animate-pulse rounded-md bg-muted" />
      <div aria-hidden="true" className="h-24 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

/**
 * Màn trước camera: tên Sự kiện ở đỉnh, nội dung giữa, các nút ở vùng ngón cái. Cao trọn màn để nút đáy luôn nằm ở đáy.
 */
function CameraStep({ eventName, children, actions }: { eventName: string; children: ReactNode; actions: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="px-gutter-mobile pt-2 pb-3">
        <h1 className="text-label wrap-break-word">{eventName}</h1>
      </header>
      <div className="flex flex-1 flex-col justify-center gap-2 px-gutter-mobile py-section">{children}</div>
      <div className="flex flex-col gap-stack px-gutter-mobile pt-3.5 pb-4">{actions}</div>
    </div>
  );
}

function StepIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon aria-hidden="true" strokeWidth={1.5} className="size-icon-button text-muted-foreground" />;
}

/**
 * Màn "Bật camera", hiện ở mọi lần vào: chạm nút này vừa xin camera vừa mở khóa âm thanh (Safari iOS chỉ cho phát âm
 * thanh sau một cử chỉ của người dùng).
 */
function EnableCamera({ eventName, onEnable }: { eventName: string; onEnable: () => void }) {
  return (
    <CameraStep
      eventName={eventName}
      actions={
        <>
          <Button type="button" variant="primary-on-light" className="w-full" onClick={onEnable}>
            <Camera aria-hidden="true" />
            Bật camera
          </Button>
          <ManualLookupButton />
        </>
      }
    >
      <StepIcon icon={Camera} />
      <h2 className="text-title">Bật camera để quét Mã QR vé</h2>
      <p className="text-body text-muted-foreground">
        Trình duyệt sẽ hỏi quyền dùng camera. Chọn &quot;Cho phép&quot; để bắt đầu quét.
      </p>
    </CameraStep>
  );
}

/** Bị từ chối quyền camera: hướng dẫn bật lại cho Safari iOS và Chrome Android, "Thử lại", "Tra tay". */
function CameraDenied({ eventName, onRetry }: { eventName: string; onRetry: () => void }) {
  return (
    <CameraStep
      eventName={eventName}
      actions={
        <>
          <Button type="button" variant="primary-on-light" className="w-full" onClick={onRetry}>
            Thử lại
          </Button>
          <ManualLookupButton />
        </>
      }
    >
      <StepIcon icon={CameraOff} />
      <h2 className="text-title">Chưa được dùng camera</h2>
      <p className="text-body text-muted-foreground">Bật lại quyền camera cho trang này rồi chạm &quot;Thử lại&quot;.</p>
      <div data-slot="camera-help" className="flex flex-col gap-stack pt-2">
        <section className="rounded-lg bg-card p-card-padding shadow-card">
          <h3 className="text-label">Safari trên iPhone</h3>
          <p className="text-meta text-muted-foreground">
            Chạm biểu tượng &quot;aA&quot; trên thanh địa chỉ › Cài đặt trang web › Camera › Cho phép. Nếu không thấy,
            mở Cài đặt › Ứng dụng › Safari › Camera › Cho phép.
          </p>
        </section>
        <section className="rounded-lg bg-card p-card-padding shadow-card">
          <h3 className="text-label">Chrome trên Android</h3>
          <p className="text-meta text-muted-foreground">
            Chạm biểu tượng cài đặt trang cạnh thanh địa chỉ › Quyền › Camera › Cho phép, rồi tải lại trang.
          </p>
        </section>
      </div>
    </CameraStep>
  );
}

/**
 * Không mở được camera: không có camera hay `mediaDevices`, camera đang bị ứng dụng khác dùng, hoặc lỗi khác ngoài từ chối
 * quyền. "Thử lại" xin camera lại mà không phải tải lại trang.
 */
function CameraUnavailable({ eventName, onRetry }: { eventName: string; onRetry: () => void }) {
  return (
    <CameraStep
      eventName={eventName}
      actions={
        <>
          <Button type="button" variant="primary-on-light" className="w-full" onClick={onRetry}>
            Thử lại
          </Button>
          <ManualLookupButton />
        </>
      }
    >
      <StepIcon icon={CameraOff} />
      <h2 className="text-title">Không mở được camera</h2>
      <p className="text-body text-muted-foreground">
        Camera đang được ứng dụng khác dùng, máy không có camera, hoặc trình duyệt không cho dùng camera. Đóng ứng dụng đang
        dùng camera rồi chạm &quot;Thử lại&quot;, hoặc mở Màn quét bằng Safari hay Chrome trên điện thoại.
      </p>
    </CameraStep>
  );
}

type ScanFlowProps = {
  event: CheckinEvent;
  scanner: QrScanner;
  sound: ScanSound;
  result: ScanView | null;
  sendFailed: boolean;
  onCloseResult: () => void;
};

/** Phần của Màn quét sau khi tải xong Sự kiện: Bật camera → bị từ chối / lỗi camera → đang quét → overlay. */
function ScanFlow({ event, scanner, sound, result, sendFailed, onCloseResult }: ScanFlowProps) {
  const enable = () => {
    // Trong chính lần chạm: mở khóa âm thanh trước, rồi mới xin camera.
    sound.unlock();
    scanner.start();
  };
  // Kết quả đỏ chỉ đóng bằng chạm: mở khóa âm thanh lại trong cử chỉ đó (Safari iOS có thể treo `AudioContext` sau cuộc
  // gọi hay khóa màn hình, và từ chối `resume()` ngoài cử chỉ).
  const closeByTap = () => {
    sound.unlock();
    onCloseResult();
  };

  switch (scanner.status) {
    case 'idle':
    case 'stopped':
      return <EnableCamera eventName={event.eventName} onEnable={enable} />;
    case 'denied':
      return <CameraDenied eventName={event.eventName} onRetry={enable} />;
    case 'unavailable':
      return <CameraUnavailable eventName={event.eventName} onRetry={enable} />;
    case 'starting':
    case 'running':
      return (
        <>
          <ScannerViewport
            eventName={event.eventName}
            checkedInCount={event.checkedInCount}
            validTicketCount={event.validTicketCount}
            videoRef={scanner.videoRef}
            notice={sendFailed ? <StatusBanner tone="warning" title={SCAN_SEND_FAILED} /> : null}
          />
          {result ? (
            <ScanResultOverlay view={result} onClose={result.autoCloseMs === null ? closeByTap : onCloseResult} />
          ) : null}
        </>
      );
  }
}

/**
 * Màn quét (Story 5.3, `/events/:eventId`): tải `GET /v1/checkin/events/:eventId` (Owner/Admin của BTC hoặc CTV `active`
 * của Sự kiện) → "Bật camera" → camera chạy liên tục, mỗi mã đọc được gửi `POST …/scans` với một `scanId` mới → overlay
 * xanh / trung tính / đỏ có âm thanh. `401` → màn đăng nhập rồi quay lại đúng trang này; `403` (lúc tải hay lúc quét) →
 * câu của api, tắt camera. Gửi quét lỗi mạng / 5xx → dải cảnh báo, quét tiếp được. Quyền kiểm lại ở mỗi request phía api.
 */
export function CheckinEventScreen({ eventId }: { eventId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const event = useQuery({
    queryKey: checkinEventQueryKey(eventId),
    queryFn: ({ signal }) => fetchCheckinEvent(eventId, signal),
  });

  const [sound] = useState(createScanSound);
  useEffect(() => () => sound.dispose(), [sound]);

  /** `403` khi gửi quét: màn hết quyền thay Màn quét. */
  const [scanNoAccessError, setScanNoAccessError] = useState<unknown>(null);
  /** Kết quả quét đang phủ màn; `ok` thì tải lại số đã check-in khi đóng. */
  const [result, setResult] = useState<{ view: ScanView; ok: boolean } | null>(null);
  const [sendFailed, setSendFailed] = useState(false);

  const submit = useMutation({
    mutationFn: (body: ScanRequest) => submitScan(eventId, body),
    onSuccess: (scanned) => {
      const view = scanView(scanned);
      setSendFailed(false);
      setResult({ view, ok: scanned.outcome === ScanOutcome.OK });
      if (view.sound) sound.play(view.sound);
    },
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) {
        scanner.stop();
        router.replace(loginHere());
        return;
      }
      if (noAccess(error)) {
        scanner.stop();
        setScanNoAccessError(error);
        return;
      }
      // 2FA và đồng ý NĐ 13 do `Providers` xử lý; mạng, 5xx và lỗi khác: không đỏ, báo rồi quét tiếp.
      if (!isTotpRequired(error) && !hasErrorCode(error, ErrorCode.CONSENT_REQUIRED)) setSendFailed(true);
      scanner.release();
    },
  });

  // Mỗi lần đọc một `scanId` mới. `mutate` của TanStack Query ổn định giữa các lần render.
  const { mutate } = submit;
  const onCode = useCallback((code: string) => mutate({ code, scanId: crypto.randomUUID() }), [mutate]);
  const scanner = useQrScanner({ onCode });

  const closeResult = useCallback(() => {
    const wasOk = result?.ok ?? false;
    setResult(null);
    if (wasOk) void queryClient.invalidateQueries({ queryKey: checkinEventQueryKey(eventId) });
  }, [result, queryClient, eventId]);

  // Mở khóa quét khi overlay đã thật sự rời màn (sau commit), để "cùng mã trong 2 giây sau khi overlay đóng" tính từ lúc
  // đóng thật. Lúc chưa có kết quả nào thì gate chưa khóa: `release()` không làm gì.
  const hasResult = result !== null;
  const releaseScanner = scanner.release;
  useEffect(() => {
    if (!hasResult) releaseScanner();
  }, [hasResult, releaseScanner]);

  const unauthenticated = hasErrorCode(event.error, ErrorCode.UNAUTHENTICATED);
  useEffect(() => {
    if (unauthenticated) router.replace(loginHere());
  }, [unauthenticated, router]);

  // Lần tải lại Sự kiện trả 403 (vd. bị thu hồi khi đang quét): tắt camera cùng lúc thay bằng màn hết quyền.
  const eventNoAccess = noAccess(event.error);
  const stopScanner = scanner.stop;
  useEffect(() => {
    if (eventNoAccess) stopScanner();
  }, [eventNoAccess, stopScanner]);

  if (scanNoAccessError) return <Screen icon={ShieldX} title={messageOf(scanNoAccessError)} />;

  // Trước `data`: lần tải lại (vd. quay lại tab sau `staleTime`) trả 403 thì bỏ tên Sự kiện đã tải.
  if (eventNoAccess) return <Screen icon={ShieldX} title={messageOf(event.error)} />;

  if (event.data) {
    return (
      <ScanFlow
        event={event.data}
        scanner={scanner}
        sound={sound}
        result={result?.view ?? null}
        sendFailed={sendFailed}
        onCloseResult={closeResult}
      />
    );
  }

  if (event.isError && !handledByGateOrProviders(event.error)) {
    return (
      <div className="px-gutter-mobile pt-4">
        <StatusBanner
          tone="danger"
          title="Chưa tải được Màn quét"
          description={messageOf(event.error)}
          action={
            <Button type="button" variant="link" size="sm" loading={event.isFetching} onClick={() => void event.refetch()}>
              Thử lại
            </Button>
          }
        />
      </div>
    );
  }

  return <Loading />;
}
