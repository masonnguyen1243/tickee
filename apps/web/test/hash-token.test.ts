import { afterEach, describe, expect, it, vi } from 'vitest';

import { hashTokenStore, tokenFromHash } from '@/lib/auth/hash-token';
import {
  CHECKER_INVITE_TOKEN_STORAGE_KEY,
  forgetCheckerInviteToken,
  recallCheckerInviteToken,
  rememberCheckerInviteToken,
} from '@/lib/checkin/invite-token';
import {
  forgetInvitationToken,
  recallInvitationToken,
  rememberInvitationToken,
  tokenFromHash as invitationTokenFromHash,
} from '@/lib/organizer/invitation-token';

/** `sessionStorage` giả trong bộ nhớ (môi trường node không có `window`). */
function fakeSessionStorage(): Map<string, string> {
  const items = new Map<string, string>();
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    },
  });
  return items;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bộ lưu token theo `#` của link mời', () => {
  it('lưu, đọc lại và xóa theo đúng khóa', () => {
    const items = fakeSessionStorage();
    const store = hashTokenStore('k');
    expect(store.recall()).toBeNull();
    expect(store.remember('Abc_123')).toBe(true);
    expect(items.get('k')).toBe('Abc_123');
    expect(store.recall()).toBe('Abc_123');
    store.forget();
    expect(items.has('k')).toBe(false);
    expect(store.recall()).toBeNull();
  });

  it('giá trị trong storage rỗng hoặc dài bất thường → null', () => {
    const items = fakeSessionStorage();
    const store = hashTokenStore('k');
    items.set('k', '   ');
    expect(store.recall()).toBeNull();
    items.set('k', 'a'.repeat(257));
    expect(store.recall()).toBeNull();
  });

  it('storage ném lỗi (bị chặn): remember → false, recall → null, forget không ném', () => {
    const blocked = () => {
      throw new Error('SecurityError');
    };
    vi.stubGlobal('window', { sessionStorage: { getItem: blocked, setItem: blocked, removeItem: blocked } });
    const store = hashTokenStore('k');
    expect(store.remember('abc')).toBe(false);
    expect(store.recall()).toBeNull();
    expect(() => store.forget()).not.toThrow();
  });

  it('link mời CTV dùng khóa riêng, không đụng token của link mời Admin', () => {
    const items = fakeSessionStorage();
    expect(CHECKER_INVITE_TOKEN_STORAGE_KEY).toBe('tickee:loi-moi-ctv:token');
    rememberInvitationToken('admin-token');
    rememberCheckerInviteToken('ctv-token');
    expect(items.get('tickee:loi-moi-btc:token')).toBe('admin-token');
    expect(items.get('tickee:loi-moi-ctv:token')).toBe('ctv-token');
    expect(recallInvitationToken()).toBe('admin-token');
    expect(recallCheckerInviteToken()).toBe('ctv-token');

    forgetCheckerInviteToken();
    expect(recallCheckerInviteToken()).toBeNull();
    expect(recallInvitationToken()).toBe('admin-token');
    forgetInvitationToken();
    expect(recallInvitationToken()).toBeNull();
  });

  it('`tokenFromHash` của link mời Admin là cùng một hàm', () => {
    expect(invitationTokenFromHash).toBe(tokenFromHash);
  });
});
