'use client';

import { useQuery, type QueryKey, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { apiBaseUrl } from '@/lib/api/client';
import { isNetworkError } from '@/lib/api/errors';

import { createSignalCoalescer, effectivePollInterval, reopenDelay, type SignalCoalescer } from './live-signal';

/*
 * Một hook dùng chung cho mọi tài nguyên tự cập nhật (AD-17, Story 3.7; 3.9 và 3.11 dùng lại): REST là sự thật, SSE chỉ
 * là tín hiệu nhắc tải lại.
 */

export type LiveResourceOptions<T> = {
  /** Khóa TanStack Query của tài nguyên REST. */
  queryKey: QueryKey;
  /** Hàm tải REST (parse bằng schema của contracts). */
  queryFn: (signal: AbortSignal) => Promise<T>;
  /** Đường SSE tương đối gốc `/v1` (vd. `buyerOrderLiveApiPath(code)`); mở kèm cookie phiên (`withCredentials`). */
  livePath: string;
  /** Chu kỳ polling (ms) khi SSE chưa kết nối, theo dữ liệu hiện có; `false` = không polling. */
  pollInterval: (data: T | undefined) => number | false;
};

export type LiveResource<T> = {
  query: UseQueryResult<T>;
  /** SSE đang mở (không polling). */
  connected: boolean;
  /** Trình duyệt báo offline, hoặc lần tải lại gần nhất lỗi mạng. */
  offline: boolean;
};

/**
 * Tài nguyên REST tự cập nhật:
 * - Tải lại REST khi SSE mở, khi có tín hiệu SSE, khi tab chuyển sang visible và khi có mạng lại; các lời nhắc gom trong
 *   1 giây (tải ngay ở lời nhắc đầu, các lời nhắc tới trong 1 giây sau gộp thành một lần tải).
 * - SSE chỉ mở khi đã có dữ liệu (tài nguyên tồn tại, đúng quyền). Chưa kết nối (đang nối, lỗi, bị đóng) → polling theo
 *   `pollInterval`; kết nối rồi → không polling. Stream bị đóng hẳn (lỗi HTTP, máy chủ tắt) → tự mở lại sau 1, 2, 4…
 *   giây (tối đa 30); tab visible lại hoặc có mạng lại → mở lại ngay. Mất kết nối tạm thời thì trình duyệt tự nối lại.
 * - Không đọc `returnUrl` hay search params nào để suy ra trạng thái.
 */
export function useLiveResource<T>({ queryKey, queryFn, livePath, pollInterval }: LiveResourceOptions<T>): LiveResource<T> {
  const [connected, setConnected] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(true);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => queryFn(signal),
    refetchInterval: (q) => effectivePollInterval(connected, pollInterval(q.state.data)),
    // Hook tự tải lại khi visible và khi có mạng lại (qua bộ gom), không để TanStack tải thêm lần nữa.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const refetch = useRef(query.refetch);
  refetch.current = query.refetch;
  const coalescer = useRef<SignalCoalescer | null>(null);
  /** Mở lại SSE ngay nếu đang đóng hẳn (đặt bởi effect SSE). */
  const reopenNow = useRef<() => void>(() => undefined);

  useEffect(() => {
    const c = createSignalCoalescer(() => void refetch.current());
    coalescer.current = c;
    return () => {
      c.dispose();
      coalescer.current = null;
    };
  }, []);

  useEffect(() => {
    setBrowserOnline(navigator.onLine);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      coalescer.current?.signal();
      reopenNow.current();
    };
    const onOnline = () => {
      setBrowserOnline(true);
      coalescer.current?.signal();
      reopenNow.current();
    };
    const onOffline = () => setBrowserOnline(false);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const hasData = query.data !== undefined;
  useEffect(() => {
    if (!hasData || typeof EventSource === 'undefined') return;
    const url = `${apiBaseUrl()}${livePath}`;
    let source: EventSource | null = null;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const open = () => {
      if (disposed) return;
      source?.close();
      const current = new EventSource(url, { withCredentials: true });
      source = current;
      current.onopen = () => {
        attempt = 0;
        setConnected(true);
        coalescer.current?.signal();
      };
      current.onmessage = () => coalescer.current?.signal();
      current.onerror = () => {
        setConnected(false);
        // CONNECTING: trình duyệt tự nối lại. CLOSED (lỗi HTTP, sai content-type): tự mở lại có backoff.
        if (current.readyState === EventSource.CLOSED && source === current) {
          clearTimeout(timer);
          timer = setTimeout(open, reopenDelay(attempt));
          attempt += 1;
        }
      };
    };
    reopenNow.current = () => {
      if (source && source.readyState !== EventSource.CLOSED) return;
      clearTimeout(timer);
      attempt = 0;
      open();
    };
    open();
    return () => {
      disposed = true;
      clearTimeout(timer);
      source?.close();
      reopenNow.current = () => undefined;
      setConnected(false);
    };
  }, [hasData, livePath]);

  const offline = !browserOnline || isNetworkError(query.failureReason);
  return { query, connected, offline };
}
