import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api/errors';
import { handledElsewhere } from '@/lib/api/handled-elsewhere';

const apiError = (code: ConstructorParameters<typeof ApiError>[0], status: number) =>
  new ApiError(code, 'x', null, status);

describe('handledElsewhere', () => {
  it.each([
    ['TOTP_REQUIRED', 403],
    ['CONSENT_REQUIRED', 403],
    ['UNAUTHENTICATED', 401],
    ['NOT_A_MEMBER', 403],
  ] as const)('%s → nơi khác xử lý', (code, status) => {
    expect(handledElsewhere(apiError(code, status))).toBe(true);
  });

  it('mã lỗi khác → trang tự báo', () => {
    expect(handledElsewhere(apiError('VALIDATION_FAILED', 400))).toBe(false);
    expect(handledElsewhere(apiError('FORBIDDEN_ROLE', 403))).toBe(false);
    expect(handledElsewhere(apiError('REAUTH_REQUIRED', 403))).toBe(false);
    expect(handledElsewhere(apiError('SERVICE_UNAVAILABLE', 503))).toBe(false);
  });

  it('không phải ApiError → trang tự báo', () => {
    expect(handledElsewhere(new Error('UNAUTHENTICATED'))).toBe(false);
    expect(handledElsewhere(undefined)).toBe(false);
    expect(handledElsewhere(null)).toBe(false);
  });
});
