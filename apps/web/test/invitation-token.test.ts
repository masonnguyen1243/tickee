import { describe, expect, it } from 'vitest';

import {
  forgetInvitationToken,
  recallInvitationToken,
  rememberInvitationToken,
  tokenFromHash,
} from '@/lib/organizer/invitation-token';

describe('token của link mời Admin', () => {
  it('lấy token sau dấu #', () => {
    expect(tokenFromHash('#Abc_123-xyz')).toBe('Abc_123-xyz');
    expect(tokenFromHash('Abc_123-xyz')).toBe('Abc_123-xyz');
    expect(tokenFromHash('#  Abc  ')).toBe('Abc');
  });

  it.each(['', '#', '#   '])('hash rỗng "%s" → null', (hash) => {
    expect(tokenFromHash(hash)).toBeNull();
  });

  it('hash dài bất thường → null', () => {
    expect(tokenFromHash(`#${'a'.repeat(257)}`)).toBeNull();
    expect(tokenFromHash(`#${'a'.repeat(256)}`)).toHaveLength(256);
  });

  it('không có sessionStorage (storage bị chặn): không ném lỗi, coi như không có token', () => {
    expect(rememberInvitationToken('abc')).toBe(false);
    expect(recallInvitationToken()).toBeNull();
    expect(() => forgetInvitationToken()).not.toThrow();
  });
});
