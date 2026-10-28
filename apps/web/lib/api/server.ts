import { cookies } from 'next/headers';
import type { z } from 'zod';

import { performApiRequest, type ApiRequestOptions } from './client';

/**
 * Bản dành cho Server Component / Route Handler: chuyển tiếp cookie của request hiện tại tới API
 * (fetch phía server không tự gửi cookie của trình duyệt). Mặc định không cache.
 */
export async function serverApiRequest<S extends z.ZodType>(
  path: string,
  { schema, init }: ApiRequestOptions<S>,
): Promise<z.output<S>> {
  const cookieHeader = (await cookies()).toString();
  return performApiRequest(
    path,
    { schema, init: { cache: 'no-store', ...init } },
    cookieHeader ? { cookie: cookieHeader } : undefined,
  );
}
