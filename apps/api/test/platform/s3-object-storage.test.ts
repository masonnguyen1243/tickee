import { createHash, createHmac } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { S3ObjectStorage, type S3StorageOptions } from '../../src/platform/storage/index.js';

/*
 * Story 4.8-a: `S3ObjectStorage` tính tại chỗ, không gọi mạng. Chữ ký của URL PUT được tính lại độc lập theo SigV4
 * (query string) để chắc nó ràng buộc đúng `content-type`, `content-length` đã khai và secret đã cấu hình: đó là thứ
 * khiến storage từ chối file khác loại hay khác số byte (giới hạn 5 MB nằm ở đây).
 */

const SECRET = 'test-only-secret-access-key';
const KEY = 'orgs/019a3b2c-5678-7abc-8def-0123456789ab/events/0b9e4c1a-2f3d-4e5f-8a6b-7c8d9e0f1a2b.webp';

const storages: S3ObjectStorage[] = [];
const storageWith = (overrides: Partial<S3StorageOptions> = {}): S3ObjectStorage => {
  const storage = new S3ObjectStorage({
    endpoint: 'http://storage.tickee.test',
    region: 'us-east-1',
    bucket: 'tickee-test-images',
    accessKeyId: 'test-only-access-key',
    secretAccessKey: SECRET,
    forcePathStyle: true,
    publicBaseUrl: 'http://storage.tickee.test/tickee-test-images',
    ...overrides,
  });
  storages.push(storage);
  return storage;
};
afterAll(() => {
  for (const storage of storages) storage.close();
});

/** Mã hóa RFC 3986 như SigV4 yêu cầu cho query string chuẩn tắc. */
const rfc3986 = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');
const hmac = (key: Buffer | string, value: string): Buffer => createHmac('sha256', key).update(value).digest();

/**
 * Chữ ký SigV4 của một URL PUT presign (S3, payload `UNSIGNED-PAYLOAD`) với các header ký cho trước, tính độc lập với
 * SDK: canonical request → string to sign → khóa ký dẫn xuất từ `secret`.
 */
function sigV4Of(url: URL, headers: Record<string, string>, secret: string): string {
  const query = [...url.searchParams.entries()]
    .filter(([name]) => name !== 'X-Amz-Signature')
    .map(([name, value]) => [rfc3986(name), rfc3986(value)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
  const names = Object.keys(headers).sort();
  const canonicalRequest = [
    'PUT',
    url.pathname,
    query,
    names.map((name) => `${name}:${headers[name]!.trim()}\n`).join(''),
    names.join(';'),
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const amzDate = url.searchParams.get('X-Amz-Date')!;
  const scope = url.searchParams.get('X-Amz-Credential')!.split('/').slice(1).join('/');
  const [date, region, service] = scope.split('/');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secret}`, date!), region!), service!), 'aws4_request');
  return createHmac('sha256', signingKey).update(stringToSign).digest('hex');
}

describe('S3ObjectStorage.presignPut', () => {
  it('chữ ký ràng buộc đúng content-type, content-length đã khai và secret', async () => {
    const contentLength = 204_800;
    const { url } = await storageWith().presignPut({ key: KEY, contentType: 'image/webp', contentLength });
    const parsed = new URL(url);
    const signature = parsed.searchParams.get('X-Amz-Signature');
    const headers = { 'content-length': String(contentLength), 'content-type': 'image/webp', host: parsed.host };

    expect(sigV4Of(parsed, headers, SECRET)).toBe(signature);
    // Khác số byte, khác loại hay khác secret thì chữ ký khác: storage từ chối PUT đó.
    expect(sigV4Of(parsed, { ...headers, 'content-length': String(contentLength + 1) }, SECRET)).not.toBe(signature);
    expect(sigV4Of(parsed, { ...headers, 'content-type': 'image/png' }, SECRET)).not.toBe(signature);
    expect(sigV4Of(parsed, headers, 'secret-khac')).not.toBe(signature);
  });

  it('path-style: <endpoint>/<bucket>/<key>; virtual-hosted (mặc định): <bucket>.<host>/<key>, chữ ký theo host đó', async () => {
    const pathStyle = new URL(
      (await storageWith().presignPut({ key: KEY, contentType: 'image/png', contentLength: 10 })).url,
    );
    expect(pathStyle.host).toBe('storage.tickee.test');
    expect(pathStyle.pathname).toBe(`/tickee-test-images/${KEY}`);

    const virtual = new URL(
      (
        await storageWith({ endpoint: 'https://s3.tickee.test', forcePathStyle: false }).presignPut({
          key: KEY,
          contentType: 'image/png',
          contentLength: 10,
        })
      ).url,
    );
    expect(virtual.origin).toBe('https://tickee-test-images.s3.tickee.test');
    expect(virtual.pathname).toBe(`/${KEY}`);
    const headers = { 'content-length': '10', 'content-type': 'image/png', host: virtual.host };
    expect(sigV4Of(virtual, headers, SECRET)).toBe(virtual.searchParams.get('X-Amz-Signature'));
  });
});

describe('S3ObjectStorage.publicUrlOf', () => {
  it('<S3_PUBLIC_BASE_URL>/<key>, bỏ dấu / cuối của base, mã hóa từng đoạn của key', () => {
    expect(storageWith().publicUrlOf(KEY)).toBe(`http://storage.tickee.test/tickee-test-images/${KEY}`);
    expect(storageWith({ publicBaseUrl: 'https://anh.tickee.test/su-kien//' }).publicUrlOf(KEY)).toBe(
      `https://anh.tickee.test/su-kien/${KEY}`,
    );
    expect(storageWith().publicUrlOf('orgs/a b/events/c#d.png')).toBe(
      'http://storage.tickee.test/tickee-test-images/orgs/a%20b/events/c%23d.png',
    );
  });
});
