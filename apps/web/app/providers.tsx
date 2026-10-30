'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorCode, type TotpRequiredReason } from '@tickee/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { StepUpDialog } from '@/components/tickee/step-up-dialog';
import { hasErrorCode, ME_QUERY_KEY } from '@/lib/auth/api';
import { CONSENT_PATH, TOTP_ENROLL_PATH, withReturnTo } from '@/lib/auth/return-to';
import { totpRequiredReason } from '@/lib/auth/totp';
import { shouldRetryQuery } from '@/lib/api/retry';

type GateHandlers = {
  onConsentRequired: () => void;
  /** `retry` có khi lỗi đến từ một mutation: gọi lại đúng mutation đó với cùng biến. */
  onTotpRequired: (reason: TotpRequiredReason, retry?: () => void) => void;
};

function makeQueryClient(handlers: GateHandlers): QueryClient {
  const handle = (error: unknown, retry?: () => void) => {
    if (hasErrorCode(error, ErrorCode.CONSENT_REQUIRED)) handlers.onConsentRequired();
    const reason = totpRequiredReason(error);
    if (reason) handlers.onTotpRequired(reason, retry);
  };
  return new QueryClient({
    // Tài khoản chưa đồng ý NĐ 13 gọi API nào (ngoài me/consent/sign-out) cũng nhận CONSENT_REQUIRED → màn đồng ý.
    // Request mang vai Owner chưa đăng ký/step-up TOTP nhận TOTP_REQUIRED → màn đăng ký hoặc dialog step-up.
    queryCache: new QueryCache({ onError: (error) => handle(error) }),
    mutationCache: new MutationCache({
      onError: (error, variables, _context, mutation) =>
        handle(error, () => {
          // Giới hạn: `execute` chỉ chạy lại các callback khai báo trên `useMutation({ onSuccess, onError… })`.
          // Callback truyền vào `mutate(vars, { … })` và nơi `await mutateAsync(...)` KHÔNG thấy kết quả lần thử lại,
          // nên form nào có thể gặp TOTP_REQUIRED phải đặt xử lý kết quả trên `useMutation`.
          // Lỗi lần thử lại đã đi qua chính `onError` này; không để promise bị reject mà không ai bắt.
          mutation.execute(variables).catch(() => undefined);
        }),
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: shouldRetryQuery,
      },
    },
  });
}

const currentLocation = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;

export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const [stepUpOpen, setStepUpOpen] = useState(false);
  /** Mutation bị chặn bởi `TOTP_REQUIRED` `step_up`, chờ step-up xong để gọi lại. */
  const pendingRetries = useRef<(() => void)[]>([]);

  const goToEnroll = useCallback(() => {
    pendingRetries.current = [];
    setStepUpOpen(false);
    if (window.location.pathname === TOTP_ENROLL_PATH) return;
    // `replace`: Back từ màn đăng ký không quay lại trang vừa báo TOTP_REQUIRED (tránh vòng lặp).
    routerRef.current.replace(withReturnTo(TOTP_ENROLL_PATH, currentLocation()));
  }, []);

  const [queryClient] = useState(() =>
    makeQueryClient({
      onConsentRequired: () => {
        if (window.location.pathname === CONSENT_PATH) return;
        // `replace`: Back từ màn đồng ý không quay lại trang vừa báo CONSENT_REQUIRED (tránh vòng lặp).
        routerRef.current.replace(withReturnTo(CONSENT_PATH, currentLocation()));
      },
      onTotpRequired: (reason, retry) => {
        if (reason === 'enroll') {
          goToEnroll();
          return;
        }
        if (retry) pendingRetries.current.push(retry);
        setStepUpOpen(true);
      },
    }),
  );

  const isTotpBlocked = (error: unknown) => totpRequiredReason(error) !== null;

  const onStepUpSuccess = () => {
    setStepUpOpen(false);
    const retries = pendingRetries.current;
    pendingRetries.current = [];
    for (const retry of retries) retry();
    void queryClient.invalidateQueries({ predicate: (query) => isTotpBlocked(query.state.error) });
  };

  const onReenroll = () => {
    void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    goToEnroll();
  };

  const onCancel = () => {
    pendingRetries.current = [];
    setStepUpOpen(false);
  };

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <StepUpDialog open={stepUpOpen} onSuccess={onStepUpSuccess} onReenroll={onReenroll} onCancel={onCancel} />
    </QueryClientProvider>
  );
}
