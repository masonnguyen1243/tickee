'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorCode } from '@tickee/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { hasErrorCode } from '@/lib/auth/api';
import { CONSENT_PATH, withReturnTo } from '@/lib/auth/return-to';
import { shouldRetryQuery } from '@/lib/api/retry';

function makeQueryClient(onConsentRequired: () => void): QueryClient {
  const onError = (error: unknown) => {
    if (hasErrorCode(error, ErrorCode.CONSENT_REQUIRED)) onConsentRequired();
  };
  return new QueryClient({
    // Tài khoản chưa đồng ý NĐ 13 gọi API nào (ngoài me/consent/sign-out) cũng nhận CONSENT_REQUIRED → màn đồng ý.
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: shouldRetryQuery,
      },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const [queryClient] = useState(() =>
    makeQueryClient(() => {
      const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (window.location.pathname === CONSENT_PATH) return;
      // `replace`: Back từ màn đồng ý không quay lại trang vừa báo CONSENT_REQUIRED (tránh vòng lặp).
      routerRef.current.replace(withReturnTo(CONSENT_PATH, here));
    }),
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
