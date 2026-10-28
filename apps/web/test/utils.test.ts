import { describe, expect, it } from 'vitest';

import { cn } from '@/lib/utils';

describe('cn — cỡ chữ có tên của Tickee', () => {
  it('cỡ chữ và màu chữ không gộp nhau', () => {
    expect(cn('text-label', 'text-success-text')).toBe('text-label text-success-text');
  });

  it('hai cỡ chữ có tên: cái sau thắng', () => {
    expect(cn('text-button', 'text-label')).toBe('text-label');
  });
});
