import { describe, expect, it } from 'vitest';
import {
  CredentialKeysError,
  parseCredentialKeys,
  SecretBox,
  SecretBoxError,
  sealedKeyVersion,
} from '../../src/platform/crypto/index.js';

/* Khóa có phiên bản cho bí mật lưu trong DB (AD-9, AD-23): AES-256-GCM, tiền tố `v<k>:` chọn khóa khi giải mã. */

const key = (fill: number) => Buffer.alloc(32, fill).toString('base64');
const SECRET = 'secret-token-cua-btc-0123456789';

function errorOf(fn: () => unknown): Error {
  try {
    fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error('phải ném lỗi');
}

describe('parseCredentialKeys', () => {
  it('đọc nhiều khóa, bỏ khoảng trắng và mục rỗng, sắp theo phiên bản', () => {
    const keys = parseCredentialKeys(` v3:${key(3)} ,v1:${key(1)},`);
    expect(keys.map((k) => k.version)).toEqual([1, 3]);
    expect(keys[0]?.key).toEqual(Buffer.alloc(32, 1));
  });

  it.each([
    ['rỗng', ''],
    ['thiếu tiền tố', key(1)],
    ['phiên bản 0', `v0:${key(1)}`],
    ['không đủ 32 byte', `v1:${Buffer.alloc(31, 1).toString('base64')}`],
    ['quá 32 byte', `v1:${Buffer.alloc(33, 1).toString('base64')}`],
    ['base64 lỏng', `v1:${key(1).replace('=', '')}`],
    ['trùng phiên bản', `v1:${key(1)},v1:${key(2)}`],
  ])('%s → CredentialKeysError, không in khóa', (_name, raw) => {
    const err = errorOf(() => parseCredentialKeys(raw));
    expect(err).toBeInstanceOf(CredentialKeysError);
    expect(err.message).not.toContain(key(1));
    expect(err.message).not.toContain(key(2));
  });
});

describe('SecretBox', () => {
  it('seal/open: tiền tố v<k>:, IV ngẫu nhiên, không chứa plaintext', () => {
    const box = new SecretBox(parseCredentialKeys(`v1:${key(1)}`));
    const a = box.seal(SECRET);
    const b = box.seal(SECRET);
    expect(a).toMatch(/^v1:[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain(SECRET);
    expect(box.open(a)).toBe(SECRET);
    expect(box.open(b)).toBe(SECRET);
    expect(sealedKeyVersion(a)).toBe(1);
    expect(box.open(box.seal(''))).toBe('');
    expect(box.open(box.seal('Bí mật có dấu ✓'))).toBe('Bí mật có dấu ✓');
  });

  it('thêm khóa v2: ciphertext cũ (v1) vẫn mở được, ciphertext mới dùng v2', () => {
    const v1Only = new SecretBox(parseCredentialKeys(`v1:${key(1)}`));
    const old = v1Only.seal(SECRET);
    const rotated = new SecretBox(parseCredentialKeys(`v1:${key(1)},v2:${key(2)}`));
    expect(rotated.currentVersion).toBe(2);
    expect(rotated.open(old)).toBe(SECRET);
    const fresh = rotated.seal(SECRET);
    expect(fresh.startsWith('v2:')).toBe(true);
    expect(rotated.open(fresh)).toBe(SECRET);
    // Bỏ khóa v1 khỏi env thì ciphertext cũ không mở được nữa.
    const v2Only = new SecretBox(parseCredentialKeys(`v2:${key(2)}`));
    expect(errorOf(() => v2Only.open(old))).toBeInstanceOf(SecretBoxError);
  });

  it('ciphertext bị sửa, sai dạng hoặc sai khóa → SecretBoxError, không lộ plaintext', () => {
    const box = new SecretBox(parseCredentialKeys(`v1:${key(1)}`));
    const sealed = box.seal(SECRET);
    const [prefix, iv, tag, ct] = sealed.split(/[:.]/) as [string, string, string, string];
    const flipped = `${ct[0] === 'A' ? 'B' : 'A'}${ct.slice(1)}`;
    const other = new SecretBox([{ version: 1, key: Buffer.alloc(32, 9) }]);
    for (const bad of [
      `${prefix}:${iv}.${tag}.${flipped}`,
      `${prefix}:${iv}.${tag}`,
      SECRET,
      `v9:${iv}.${tag}.${ct}`,
    ]) {
      const err = errorOf(() => box.open(bad));
      expect(err, bad).toBeInstanceOf(SecretBoxError);
      expect(err.message).not.toContain(SECRET);
    }
    expect(errorOf(() => other.open(sealed))).toBeInstanceOf(SecretBoxError);
  });

  it('không có khóa nào hoặc khóa sai độ dài → CredentialKeysError', () => {
    expect(errorOf(() => new SecretBox([]))).toBeInstanceOf(CredentialKeysError);
    expect(errorOf(() => new SecretBox([{ version: 1, key: Buffer.alloc(16) }]))).toBeInstanceOf(CredentialKeysError);
  });
});
