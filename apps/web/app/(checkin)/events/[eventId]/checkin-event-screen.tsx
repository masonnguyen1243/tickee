'use client';

import { onlineManager, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorCode, ScanOutcome, type CheckinEvent, type ScanRequest, type ScanResult } from '@tickee/contracts';
import { Camera, CameraOff, ShieldX, type LucideIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import { ManualLookup } from '@/components/tickee/manual-lookup';
import { ScanResultOverlay } from '@/components/tickee/scan-result-overlay';
import { ManualLookupButton, ScannerViewport } from '@/components/tickee/scanner-viewport';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { isNetworkError } from '@/lib/api/errors';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import { LOGIN_PATH, withReturnTo } from '@/lib/auth/return-to';
import { isTotpRequired } from '@/lib/auth/totp';
import { checkinEventQueryKey, checkinLookupQueryPrefix, fetchCheckinEvent, submitScan } from '@/lib/checkin/api';
import { createScanSound, type ScanSound } from '@/lib/checkin/scan-sound';
import { scanView, type ScanView } from '@/lib/checkin/scan-view';
import { useQrScanner, type QrScanner } from '@/lib/checkin/use-qr-scanner';

/** Gửi kết quả quét lỗi có phản hồi (5xx, lỗi khác): không hiện đỏ, quét lại bằng `scanId` mới. */
export const SCAN_SEND_FAILED = 'Chưa gửi được kết quả quét. Quét lại mã.';

/** Lỗi mạng hay hết hạn 3 giây: gửi lại cùng `code` và `scanId` sau chừng này mili giây, không giới hạn số lần. */
export const SCAN_RETRY_DELAY_MS = 1000;
/** Lần gửi chưa xong sau chừng này mili giây: "Đang gửi…" trên khung camera. */
export const SCAN_SENDING_HINT_MS = 1000;

/**
 * Trạng thái mạng theo `onlineManager` của TanStack Query (sự kiện `online`/`offline`): cùng nguồn với việc tạm dừng
 * gửi lại, nên banner và việc gửi lại không bao giờ lệch nhau.
 */
const subscribeOnline = (onChange: () => void) => onlineManager.subscribe(() => onChange());
const browserOnline = () => onlineManager.isOnline();
const onlineOnServer = () => true;

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

/** Lỗi khi tra hay check-in tay mà `manual-lookup` không tự báo: Màn quét (401, 403) hoặc `Providers` (2FA, NĐ 13). */
const isScreenHandledError = (error: unknown): boolean => noAccess(error) || handledByGateOrProviders(error);

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
function EnableCamera({
  eventName,
  onEnable,
  onManualLookup,
}: {
  eventName: string;
  onEnable: () => void;
  onManualLookup: () => void;
}) {
  return (
    <CameraStep
      eventName={eventName}
      actions={
        <>
          <Button type="button" variant="primary-on-light" className="w-full" onClick={onEnable}>
            <Camera aria-hidden="true" />
            Bật camera
          </Button>
          <ManualLookupButton onClick={onManualLookup} />
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
function CameraDenied({
  eventName,
  onRetry,
  onManualLookup,
}: {
  eventName: string;
  onRetry: () => void;
  onManualLookup: () => void;
}) {
  return (
    <CameraStep
      eventName={eventName}
      actions={
        <>
          <Button type="button" variant="primary-on-light" className="w-full" onClick={onRetry}>
            Thử lại
          </Button>
          <ManualLookupButton onClick={onManualLookup} />
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
function CameraUnavailable({
  eventName,
  onRetry,
  onManualLookup,
}: {
  eventName: string;
  onRetry: () => void;
  onManualLookup: () => void;
}) {
  return (
    <CameraStep
      eventName={eventName}
      actions={
        <>
          <Button type="button" variant="primary-on-light" className="w-full" onClick={onRetry}>
            Thử lại
          </Button>
          <ManualLookupButton onClick={onManualLookup} />
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
  sendFailed: boolean;
  /** `offline-banner` hiện: khung camera tạm dừng; dải "Chưa gửi được…" ẩn (banner thắng). */
  offline: boolean;
  /** Lần gửi quét chưa xong sau 1 giây. */
  sending: boolean;
  /** Chạm "Tra tay" (mọi màn có nút này): mở `manual-lookup`. */
  onManualLookup: () => void;
};

/**
 * Phần của Màn quét sau khi tải xong Sự kiện: Bật camera → bị từ chối / lỗi camera → đang quét. Overlay kết quả và
 * `manual-lookup` nằm ngoài (hiện được ở mọi màn).
 */
function ScanFlow({ event, scanner, sound, sendFailed, offline, sending, onManualLookup }: ScanFlowProps) {
  const enable = () => {
    // Trong chính lần chạm: mở khóa âm thanh trước, rồi mới xin camera.
    sound.unlock();
    scanner.start();
  };

  switch (scanner.status) {
    case 'idle':
    case 'stopped':
      return <EnableCamera eventName={event.eventName} onEnable={enable} onManualLookup={onManualLookup} />;
    case 'denied':
      return <CameraDenied eventName={event.eventName} onRetry={enable} onManualLookup={onManualLookup} />;
    case 'unavailable':
      return <CameraUnavailable eventName={event.eventName} onRetry={enable} onManualLookup={onManualLookup} />;
    case 'starting':
    case 'running':
      return (
        <ScannerViewport
          eventName={event.eventName}
          checkedInCount={event.checkedInCount}
          validTicketCount={event.validTicketCount}
          videoRef={scanner.videoRef}
          notice={sendFailed && !offline ? <StatusBanner tone="warning" title={SCAN_SEND_FAILED} /> : null}
          offline={offline}
          sending={sending}
          onManualLookup={onManualLookup}
        />
      );
  }
}

/**
 * Màn quét (Story 5.3, `/events/:eventId`): tải `GET /v1/checkin/events/:eventId` (Owner/Admin của BTC hoặc CTV `active`
 * của Sự kiện) → "Bật camera" → camera chạy liên tục, mỗi mã đọc được gửi `POST …/scans` với một `scanId` mới → overlay
 * xanh / trung tính / đỏ có âm thanh. `401` → màn đăng nhập rồi quay lại đúng trang này; `403` (lúc tải hay lúc quét) →
 * câu của api, tắt camera. Gửi quét lỗi có phản hồi (5xx, lỗi khác) → dải cảnh báo, quét lại bằng `scanId` mới. Quyền
 * kiểm lại ở mỗi request phía api.
 *
 * Mất mạng (Story 5.4, UX-DR31, AD-15): mỗi lần gửi có hạn 3 giây (`submitScan`); hết hạn hoặc lỗi mạng thì TanStack
 * Query gửi lại đúng biến cũ (cùng `code`, cùng `scanId`) mỗi 1 giây tới khi có phản hồi, tạm dừng khi trình duyệt báo
 * offline và gửi ngay khi có mạng lại. Trong lúc đó, hoặc khi trình duyệt báo offline, `offline-banner` hiện và không
 * giải mã mã mới (camera vẫn chạy). Không có hàng đợi quét offline. Rời Màn quét thì hủy lần gửi đang chạy và thôi gửi lại.
 *
 * Tra tay (Story 5.5, UX-DR32): "Tra tay" ở mọi màn sau khi tải Sự kiện mở `manual-lookup`; camera không giải mã khi
 * Sheet mở. Check-in tay không khóa cổng quét; kết quả hiện bằng cùng overlay (Sheet đóng khi overlay hiện). Đóng overlay:
 * kết quả tra còn Vé chưa check-in (khách đi nhóm) thì mở lại Sheet với ô tìm và kết quả cũ, hết thì về camera. `401` và
 * `403` khi tra hay check-in tay xử lý như khi quét.
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
  /**
   * Kết quả quét hay check-in tay đang phủ màn; `ok` thì tải lại số đã check-in khi đóng; `reopenLookup` thì mở lại
   * `manual-lookup` khi đóng.
   */
  const [result, setResult] = useState<{ view: ScanView; ok: boolean; reopenLookup: boolean } | null>(null);
  const [sendFailed, setSendFailed] = useState(false);
  /** `manual-lookup` đang mở; chữ trong ô tìm (giữ khi Sheet đóng vì overlay để mở lại nguyên trạng). */
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupText, setLookupText] = useState('');

  /** Hiện overlay kết quả (quét hay check-in tay): Sheet đóng để overlay chạy đúng như lúc quét. */
  const showResult = useCallback(
    (scanned: ScanResult, reopenLookup: boolean) => {
      const view = scanView(scanned);
      setLookupOpen(false);
      setResult({ view, ok: scanned.outcome === ScanOutcome.OK, reopenLookup });
      if (view.sound) sound.play(view.sound);
    },
    [sound],
  );

  /** Hủy khi rời Màn quét: lần gửi đang chạy dừng, không gửi lại nữa (tạo trong effect để chịu được StrictMode). */
  const screenAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    screenAbort.current = controller;
    return () => controller.abort();
  }, []);
  const hasLeft = () => screenAbort.current?.signal.aborted ?? false;

  const submit = useMutation({
    mutationFn: (body: ScanRequest) => submitScan(eventId, body, screenAbort.current?.signal),
    // Chỉ lỗi mạng / hết hạn mới gửi lại (cùng biến), không giới hạn số lần khi còn ở Màn quét. `onError` chỉ chạy khi
    // thôi gửi lại, nên 401/403/5xx giữ nguyên xử lý của 5.3-b.
    retry: (_failureCount, error) => !hasLeft() && isNetworkError(error),
    retryDelay: SCAN_RETRY_DELAY_MS,
    onSuccess: (scanned) => {
      setSendFailed(false);
      // Kết quả quét tới khi Sheet đang mở (mã đọc ngay trước khi bấm "Tra tay"): mở lại Sheet sau khi đóng overlay.
      showResult(scanned, lookupOpen);
    },
    onError: (error) => {
      if (hasLeft()) return;
      if (handleAccessError(error)) return;
      // 2FA và đồng ý NĐ 13 do `Providers` xử lý; 5xx và lỗi khác có phản hồi: không đỏ, báo rồi quét tiếp.
      if (!isTotpRequired(error) && !hasErrorCode(error, ErrorCode.CONSENT_REQUIRED)) setSendFailed(true);
      scanner.release();
    },
  });

  // `offline-banner`: một lần quét đang chờ gửi lại (lỗi mạng / hết hạn, kể cả lúc tạm dừng vì offline), hoặc trình
  // duyệt báo offline. Ẩn khi lần gửi lại nhận phản hồi HTTP, hoặc khi có mạng lại mà không còn lần quét nào chờ.
  const online = useSyncExternalStore(subscribeOnline, browserOnline, onlineOnServer);
  const resending = submit.isPending && isNetworkError(submit.failureReason);
  const offline = resending || !online;

  // "Đang gửi…": lần gửi (theo `submittedAt`) chưa xong sau `SCAN_SENDING_HINT_MS`; ẩn khi có kết quả hoặc banner hiện.
  const pendingSince = submit.isPending ? submit.submittedAt : null;
  const [slowSince, setSlowSince] = useState<number | null>(null);
  useEffect(() => {
    if (pendingSince === null) return;
    const timer = setTimeout(
      () => setSlowSince(pendingSince),
      Math.max(0, pendingSince + SCAN_SENDING_HINT_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [pendingSince]);
  const sending = pendingSince !== null && slowSince === pendingSince && !offline;

  // Mỗi lần đọc một `scanId` mới; lần gửi lại (TanStack) giữ nguyên `scanId` đó. `mutate` ổn định giữa các lần render.
  const { mutate } = submit;
  const onCode = useCallback((code: string) => mutate({ code, scanId: crypto.randomUUID() }), [mutate]);
  // Không giải mã khi offline, khi `manual-lookup` mở, hay khi overlay đang phủ (check-in tay không khóa cổng quét).
  const scanner = useQrScanner({ onCode, paused: offline || lookupOpen || result !== null });

  /**
   * `401` → màn đăng nhập rồi quay lại đây; `403` (`NOT_A_MEMBER`, `CHECKER_REVOKED`) → màn hết quyền. Cả hai tắt camera.
   * Trả `true` khi đã xử lý (quét, tra tay, check-in tay dùng chung).
   */
  const stopScanner = scanner.stop;
  const handleAccessError = useCallback(
    (error: unknown): boolean => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) {
        stopScanner();
        router.replace(loginHere());
        return true;
      }
      if (noAccess(error)) {
        stopScanner();
        setScanNoAccessError(error);
        return true;
      }
      return false;
    },
    [stopScanner, router],
  );
  const onLookupAccessError = useCallback((error: unknown) => void handleAccessError(error), [handleAccessError]);

  const closeResult = useCallback(() => {
    const wasOk = result?.ok ?? false;
    const reopen = result?.reopenLookup ?? false;
    setResult(null);
    if (reopen) setLookupOpen(true);
    if (wasOk) void queryClient.invalidateQueries({ queryKey: checkinEventQueryKey(eventId) });
  }, [result, queryClient, eventId]);
  // Kết quả đỏ chỉ đóng bằng chạm: mở khóa âm thanh lại trong cử chỉ đó (Safari iOS có thể treo `AudioContext` sau cuộc
  // gọi hay khóa màn hình, và từ chối `resume()` ngoài cử chỉ).
  const closeResultByTap = useCallback(() => {
    sound.unlock();
    closeResult();
  }, [sound, closeResult]);

  /**
   * "Tra tay": mở Sheet với ô tìm trống (không để lộ lần tra của khách trước) và bỏ mọi kết quả tra đã lưu của Sự kiện
   * (Người mua vừa trả tiền, Vé vừa được check-in nơi khác), nên gõ lại cùng số thì tra lại. Mở lại sau overlay không đi
   * qua đây: giữ kết quả. Chạm cũng mở khóa âm thanh.
   */
  const openLookup = useCallback(() => {
    sound.unlock();
    queryClient.removeQueries({ queryKey: checkinLookupQueryPrefix(eventId) });
    setLookupText('');
    setLookupOpen(true);
  }, [sound, queryClient, eventId]);
  const unlockSound = useCallback(() => sound.unlock(), [sound]);

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
  useEffect(() => {
    if (eventNoAccess) stopScanner();
  }, [eventNoAccess, stopScanner]);

  if (scanNoAccessError) return <Screen icon={ShieldX} title={messageOf(scanNoAccessError)} />;

  // Trước `data`: lần tải lại (vd. quay lại tab sau `staleTime`) trả 403 thì bỏ tên Sự kiện đã tải.
  if (eventNoAccess) return <Screen icon={ShieldX} title={messageOf(event.error)} />;

  if (event.data) {
    return (
      <>
        <ScanFlow
          event={event.data}
          scanner={scanner}
          sound={sound}
          sendFailed={sendFailed}
          offline={offline}
          sending={sending}
          onManualLookup={openLookup}
        />
        <ManualLookup
          eventId={eventId}
          open={lookupOpen}
          onOpenChange={setLookupOpen}
          text={lookupText}
          onTextChange={setLookupText}
          online={online}
          onResult={showResult}
          isHandledByScreen={isScreenHandledError}
          onHandledError={onLookupAccessError}
          onCheckInTap={unlockSound}
          returnFocus={result === null}
        />
        {result ? (
          <ScanResultOverlay
            view={result.view}
            onClose={result.view.autoCloseMs === null ? closeResultByTap : closeResult}
          />
        ) : null}
      </>
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
