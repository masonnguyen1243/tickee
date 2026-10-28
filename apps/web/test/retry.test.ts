import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api/errors';
import { shouldRetryQuery } from '@/lib/api/retry';

describe('shouldRetryQuery', () => {
  it('4xx không thử lại', () => {
    expect(shouldRetryQuery(0, new ApiError('NOT_FOUND', 'x', null, 404))).toBe(false);
  });

  it.each([503, null])('status %s: thử lại tối đa 2 lần', (status) => {
    const error = new ApiError('SERVICE_UNAVAILABLE', 'x', null, status);
    expect(shouldRetryQuery(0, error)).toBe(true);
    expect(shouldRetryQuery(1, error)).toBe(true);
    expect(shouldRetryQuery(2, error)).toBe(false);
  });
});
