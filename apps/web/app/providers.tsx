'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorCode } from '@tickee/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { StepUpDialog } from '@/components/tickee/step-up-dialog';
import { hasErrorCode, ME_QUERY_KEY } from '@/lib/auth/api';
import { CONSENT_PATH, LOGIN_PATH, withReturnTo } from '@/lib/auth/return-to';
import { isTotpRequired, RECOVERY_USED_PATH } from '@/lib/auth/totp';
import { shouldRetryQuery } from '@/lib/api/retry';

type GateHandlers = {
  onConsentRequired: () => void;
  /** `retry` có khi lỗi đến từ một mutation: gọi lại đúng mutation đó với cùng biến. */
  onTotpRequired: (retry?: () => void) => void;
};

function makeQueryClient(handlers: GateHandlers): QueryClient {
  const handle = (error: unknown, retry?: () => void) => {
    if (hasErrorCode(error, ErrorCode.CONSENT_REQUIRED)) handlers.onConsentRequired();
    if (isTotpRequired(error)) handlers.onTotpRequired(retry);
  };
  return new QueryClient({
    // Tài khoản chưa đồng ý NĐ 13 gọi API nào (ngoài me/consent/sign-out) cũng nhận CONSENT_REQUIRED → màn đồng ý.
    // Tài khoản đã bật 2FA mà session chưa qua lớp hai nhận TOTP_REQUIRED ở mọi API (ngoài danh sách miễn) → dialog
    // "Xác thực hai lớp" tại chỗ, ở bất kỳ trang nào.
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
  /** Mutation bị chặn bởi `TOTP_REQUIRED`, chờ qua lớp hai xong để gọi lại. */
  const pendingRetries = useRef<(() => void)[]>([]);

  const [queryClient] = useState(() =>
    makeQueryClient({
      onConsentRequired: () => {
        if (window.location.pathname === CONSENT_PATH) return;
        // `replace`: Back từ màn đồng ý không quay lại trang vừa báo CONSENT_REQUIRED (tránh vòng lặp).
        routerRef.current.replace(withReturnTo(CONSENT_PATH, currentLocation()));
      },
      onTotpRequired: (retry) => {
        if (retry) pendingRetries.current.push(retry);
        setStepUpOpen(true);
      },
    }),
  );

  const closeStepUp = useCallback(() => {
    pendingRetries.current = [];
    setStepUpOpen(false);
  }, []);

  /** Qua lớp hai: gửi lại các mutation bị chặn và tải lại các query đang lỗi `TOTP_REQUIRED`. */
  const onStepUpSuccess = () => {
    const retries = pendingRetries.current;
    closeStepUp();
    for (const retry of retries) retry();
    void queryClient.invalidateQueries({ predicate: (query) => isTotpRequired(query.state.error) });
  };

  /** Qua lớp hai bằng mã khôi phục: 2FA cũ đã bị gỡ → trang Bảo mật tài khoản (kèm banner) để bật lại. */
  const onRecovered = () => {
    closeStepUp();
    void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    void queryClient.invalidateQueries({ predicate: (query) => isTotpRequired(query.state.error) });
    routerRef.current.push(RECOVERY_USED_PATH);
  };

  /** Đăng xuất từ dialog: bỏ thao tác dở và cache của tài khoản, về màn đăng nhập (đăng nhập lại thì quay về đây). */
  const onSignedOut = () => {
    const here = currentLocation();
    closeStepUp();
    queryClient.clear();
    routerRef.current.replace(withReturnTo(LOGIN_PATH, here));
  };

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <StepUpDialog open={stepUpOpen} onSuccess={onStepUpSuccess} onRecovered={onRecovered} onSignedOut={onSignedOut} />
    </QueryClientProvider>
  );
}
