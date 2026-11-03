import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/*
 * Mã hóa bí mật lưu trong DB bằng AES-256-GCM với khóa có phiên bản (AD-9, AD-23). Khóa đọc từ env dạng
 * `v<k>:<base64 của 32 byte>`, nhiều khóa cách nhau bằng dấu phẩy. Mã hóa luôn dùng khóa có `k` lớn nhất; ciphertext
 * mang tiền tố `v<k>:` nên giải mã tự chọn đúng khóa, và thêm khóa mới không làm hỏng dữ liệu cũ. Thông báo lỗi không bao
 * giờ chứa khóa, plaintext hay ciphertext.
 */

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ALGORITHM = 'aes-256-gcm';

/** Một mục của env: `v<k>:<base64 chuẩn>` (`k` là số nguyên dương). */
const KEY_ENTRY = /^v([1-9]\d{0,8}):([A-Za-z0-9+/]+={0,2})$/;
/** `v<k>:<iv>.<tag>.<ciphertext>`, ba phần base64url. */
const SEALED = /^v([1-9]\d{0,8}):([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]*)$/;

/** Một khóa AES-256-GCM có phiên bản. */
export interface CredentialKey {
  readonly version: number;
  readonly key: Buffer;
}

/** Danh sách khóa trong env sai; `message` chỉ nêu lỗi gì, không có giá trị. */
export class CredentialKeysError extends Error {
  override readonly name = 'CredentialKeysError';
}

/** Ciphertext sai dạng, không có khóa của phiên bản đó, hoặc không qua được kiểm tra toàn vẹn. */
export class SecretBoxError extends Error {
  override readonly name = 'SecretBoxError';
}

/**
 * Đọc `TINGEE_CREDENTIAL_KEYS` (hoặc biến cùng dạng): ít nhất một khóa, mỗi khóa đúng 32 byte, không trùng phiên bản.
 * Mục rỗng (dấu phẩy thừa) bị bỏ qua. Trả về theo phiên bản tăng dần.
 */
export function parseCredentialKeys(raw: string): CredentialKey[] {
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (entries.length === 0) throw new CredentialKeysError('cần ít nhất một khóa dạng v<số>:<base64 của 32 byte>');
  const keys: CredentialKey[] = [];
  entries.forEach((entry, index) => {
    const position = `khóa thứ ${index + 1}`;
    const match = KEY_ENTRY.exec(entry);
    if (!match) throw new CredentialKeysError(`${position} phải có dạng v<số>:<base64>`);
    const [, version, encoded] = match as unknown as [string, string, string];
    const key = Buffer.from(encoded, 'base64');
    // So lại bản mã hóa để từ chối base64 lỏng (Node bỏ qua ký tự thừa khi giải mã).
    if (key.length !== KEY_BYTES || key.toString('base64') !== encoded) {
      throw new CredentialKeysError(`${position} phải là base64 của đúng ${KEY_BYTES} byte`);
    }
    if (keys.some((k) => k.version === Number(version))) {
      throw new CredentialKeysError(`${position} trùng phiên bản với một khóa trước`);
    }
    keys.push({ version: Number(version), key });
  });
  return keys.sort((a, b) => a.version - b.version);
}

/** Phiên bản khóa của một ciphertext do `SecretBox.seal` tạo; sai dạng thì `null`. */
export function sealedKeyVersion(sealed: string): number | null {
  const match = SEALED.exec(sealed);
  return match ? Number(match[1]) : null;
}

/** Mã hóa/giải mã chuỗi bí mật bằng các khóa có phiên bản. */
export class SecretBox {
  private readonly keys: ReadonlyMap<number, Buffer>;
  /** Phiên bản dùng để mã hóa: lớn nhất trong danh sách. */
  readonly currentVersion: number;

  constructor(keys: readonly CredentialKey[]) {
    if (keys.length === 0) throw new CredentialKeysError('cần ít nhất một khóa');
    const map = new Map<number, Buffer>();
    for (const { version, key } of keys) {
      if (key.length !== KEY_BYTES) throw new CredentialKeysError(`khóa v${version} phải đúng ${KEY_BYTES} byte`);
      if (map.has(version)) throw new CredentialKeysError(`trùng phiên bản khóa v${version}`);
      map.set(version, Buffer.from(key));
    }
    this.keys = map;
    this.currentVersion = Math.max(...map.keys());
  }

  /** `v<k>:<iv>.<tag>.<ciphertext>` bằng khóa hiện hành; IV ngẫu nhiên mỗi lần nên cùng plaintext ra chuỗi khác nhau. */
  seal(plaintext: string): string {
    const key = this.keys.get(this.currentVersion)!;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v${this.currentVersion}:${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
  }

  /** Giải mã bằng khóa theo tiền tố `v<k>:`. Sai dạng, thiếu khóa hoặc bị sửa → `SecretBoxError`. */
  open(sealed: string): string {
    const match = SEALED.exec(sealed);
    if (!match) throw new SecretBoxError('ciphertext sai dạng');
    const [, version, ivPart, tagPart, ciphertextPart] = match as unknown as [string, string, string, string, string];
    const key = this.keys.get(Number(version));
    if (!key) throw new SecretBoxError(`không có khóa phiên bản v${version}`);
    const iv = Buffer.from(ivPart, 'base64url');
    const tag = Buffer.from(tagPart, 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new SecretBoxError('ciphertext sai dạng');
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(Buffer.from(ciphertextPart, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      throw new SecretBoxError('không giải mã được ciphertext');
    }
  }
}
