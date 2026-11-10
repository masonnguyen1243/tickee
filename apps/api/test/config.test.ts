import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/platform/config/index.js';

const SECRET = 's3cret-Gi4-tri';
/** Khóa 32 byte (base64) dùng làm "giá trị bí mật" của `TINGEE_CREDENTIAL_KEYS`. */
const KEY_1 = Buffer.alloc(32, 0x5a).toString('base64');
const KEY_2 = Buffer.alloc(32, 0xa5).toString('base64');
/** Khóa 32 byte (base64) dùng làm "giá trị bí mật" của `TICKET_QR_KEYS`. */
const QR_KEY_1 = Buffer.alloc(32, 0x3c).toString('base64');
const QR_KEY_2 = Buffer.alloc(32, 0xc3).toString('base64');
const apiEnv = {
  APP_ROLE: 'api',
  DATABASE_URL: `postgresql://tickee_app:${SECRET}@db:5432/tickee`,
  BETTER_AUTH_SECRET: `${SECRET}-${'x'.repeat(32)}`,
  API_PUBLIC_URL: 'https://api.tickee.vn',
  WEB_ORIGIN: 'https://tickee.vn',
  SMTP_URL: `smtp://user:${SECRET}@smtp.tickee.vn:587`,
  EMAIL_FROM: 'Tickee <no-reply@tickee.vn>',
  GOOGLE_CLIENT_ID: '123-abc.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: `GOCSPX-${SECRET}`,
  TINGEE_BASE_URL: 'https://uat-open-api.tingee.vn',
  TINGEE_CREDENTIAL_KEYS: `v1:${KEY_1}, v2:${KEY_2}`,
  TICKET_QR_KEYS: `v1:${QR_KEY_1},v2:${QR_KEY_2}`,
};
const workerEnv = {
  APP_ROLE: 'worker',
  DATABASE_URL: apiEnv.DATABASE_URL,
  WEB_ORIGIN: apiEnv.WEB_ORIGIN,
  SMTP_URL: apiEnv.SMTP_URL,
  EMAIL_FROM: apiEnv.EMAIL_FROM,
  REVALIDATE_SECRET: `${SECRET}-${'r'.repeat(32)}`,
};

function issuesOf(env: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return err as ConfigError;
  }
  throw new Error('loadConfig phải ném lỗi');
}

describe('loadConfig', () => {
  it('vai api: đọc đủ biến và áp mặc định', () => {
    const config = loadConfig(apiEnv);
    expect(config).toMatchObject({
      APP_ROLE: 'api',
      PORT: 3001,
      LOG_LEVEL: 'info',
      NODE_ENV: 'development',
      TRUST_PROXY_HOPS: 0,
    });
  });

  it('vai migrate chỉ cần MIGRATION_DATABASE_URL, không cần DATABASE_URL', () => {
    const config = loadConfig({ APP_ROLE: 'migrate', MIGRATION_DATABASE_URL: 'postgres://m:p@db/tickee' });
    expect(config.APP_ROLE).toBe('migrate');
  });

  it('biến tùy chọn đặt rỗng → dùng mặc định; biến bắt buộc rỗng → "thiếu"', () => {
    const config = loadConfig({ ...apiEnv, PORT: '', LOG_LEVEL: '', NODE_ENV: '' });
    expect(config).toMatchObject({ PORT: 3001, LOG_LEVEL: 'info', NODE_ENV: 'development' });
    const err = issuesOf({ ...apiEnv, DATABASE_URL: '' });
    expect(err.issues).toEqual([{ variable: 'DATABASE_URL', reason: 'thiếu' }]);
  });

  it('thiếu APP_ROLE → nêu tên biến', () => {
    const err = issuesOf({});
    expect(err.issues).toEqual([{ variable: 'APP_ROLE', reason: 'thiếu' }]);
  });

  it('APP_ROLE=foo → lỗi, không in giá trị', () => {
    const err = issuesOf({ APP_ROLE: 'foo' });
    expect(err.issues[0]?.variable).toBe('APP_ROLE');
    expect(err.message).not.toContain('foo');
  });

  it('thiếu DATABASE_URL ở vai api/worker', () => {
    for (const role of ['api', 'worker']) {
      const err = issuesOf({ APP_ROLE: role });
      expect(err.issues).toContainEqual({ variable: 'DATABASE_URL', reason: 'thiếu' });
      expect(err.message).toContain('DATABASE_URL');
    }
  });

  it('vai worker cần WEB_ORIGIN, SMTP_URL, EMAIL_FROM (gửi email lời mời Admin), REVALIDATE_SECRET (revalidate trang Sự kiện)', () => {
    const err = issuesOf({ APP_ROLE: 'worker', DATABASE_URL: apiEnv.DATABASE_URL });
    expect(err.issues).toEqual(
      expect.arrayContaining([
        { variable: 'WEB_ORIGIN', reason: 'thiếu' },
        { variable: 'SMTP_URL', reason: 'thiếu' },
        { variable: 'EMAIL_FROM', reason: 'thiếu' },
        { variable: 'REVALIDATE_SECRET', reason: 'thiếu' },
      ]),
    );
    const config = loadConfig(workerEnv);
    expect(config).toMatchObject({ APP_ROLE: 'worker', WEB_ORIGIN: 'https://tickee.vn' });
  });

  it('vai worker: thiếu REVALIDATE_SECRET → dừng và nêu tên biến; ngắn hơn 32 ký tự → lỗi, không in giá trị', () => {
    const missing = issuesOf({ ...workerEnv, REVALIDATE_SECRET: undefined });
    expect(missing.issues).toEqual([{ variable: 'REVALIDATE_SECRET', reason: 'thiếu' }]);
    expect(missing.message).toContain('REVALIDATE_SECRET');
    const short = issuesOf({ ...workerEnv, REVALIDATE_SECRET: SECRET });
    expect(short.issues).toEqual([{ variable: 'REVALIDATE_SECRET', reason: 'ngoài khoảng cho phép' }]);
    expect(short.message).not.toContain(SECRET);
    // Vai api không cần biến này.
    expect(loadConfig(apiEnv)).not.toHaveProperty('REVALIDATE_SECRET');
  });

  it('thiếu MIGRATION_DATABASE_URL ở vai migrate', () => {
    const err = issuesOf({ APP_ROLE: 'migrate', DATABASE_URL: apiEnv.DATABASE_URL });
    expect(err.issues).toEqual([{ variable: 'MIGRATION_DATABASE_URL', reason: 'thiếu' }]);
  });

  it('giá trị sai không bao giờ lọt vào thông báo lỗi', () => {
    const err = issuesOf({
      ...apiEnv,
      DATABASE_URL: `mysql://root:${SECRET}@db/x`,
      PORT: `${SECRET}`,
      LOG_LEVEL: SECRET,
      BETTER_AUTH_SECRET: SECRET,
      API_PUBLIC_URL: `https://api.tickee.vn/${SECRET}`,
      WEB_ORIGIN: `ftp://${SECRET}.vn`,
      SMTP_URL: `http://${SECRET}@smtp.vn`,
      AUTH_COOKIE_DOMAIN: `https://${SECRET}`,
    });
    expect(err.issues.map((i) => i.variable).sort()).toEqual([
      'API_PUBLIC_URL',
      'AUTH_COOKIE_DOMAIN',
      'BETTER_AUTH_SECRET',
      'DATABASE_URL',
      'LOG_LEVEL',
      'PORT',
      'SMTP_URL',
      'WEB_ORIGIN',
    ]);
    expect(err.message).not.toContain(SECRET);
    expect(JSON.stringify(err.issues)).not.toContain(SECRET);
  });

  it('vai api: thiếu biến đăng nhập/email → nêu đủ tên biến', () => {
    const err = issuesOf({ APP_ROLE: 'api', DATABASE_URL: apiEnv.DATABASE_URL });
    expect(err.issues.map((i) => i.variable).sort()).toEqual([
      'API_PUBLIC_URL',
      'BETTER_AUTH_SECRET',
      'EMAIL_FROM',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'SMTP_URL',
      'TICKET_QR_KEYS',
      'TINGEE_BASE_URL',
      'TINGEE_CREDENTIAL_KEYS',
      'WEB_ORIGIN',
    ]);
    expect(err.issues.every((i) => i.reason === 'thiếu')).toBe(true);
  });

  it('vai api: biến Tingee bắt buộc; URL phải là origin; không còn credential Tingee nào trong env', () => {
    const err = issuesOf({ ...apiEnv, TINGEE_CREDENTIAL_KEYS: '', TINGEE_BASE_URL: 'https://uat-open-api.tingee.vn/v1' });
    expect(err.issues.map((i) => i.variable)).toEqual(['TINGEE_BASE_URL', 'TINGEE_CREDENTIAL_KEYS']);
    expect(err.issues[1]?.reason).toBe('thiếu');
    // Key Tingee là của từng BTC (lưu mã hóa trong DB): env Tingee chỉ còn URL và khóa mã hóa.
    const tingeeKeys = Object.keys(loadConfig(apiEnv)).filter((k) => k.startsWith('TINGEE_'));
    expect(tingeeKeys.sort()).toEqual(['TINGEE_BASE_URL', 'TINGEE_CREDENTIAL_KEYS']);
    // Vai worker không cần Tingee.
    const worker = loadConfig(workerEnv);
    expect(worker.APP_ROLE).toBe('worker');
  });

  it('TINGEE_CREDENTIAL_KEYS: ít nhất 1 khóa, mỗi khóa đúng 32 byte, không trùng phiên bản; lỗi không in khóa', () => {
    expect(loadConfig({ ...apiEnv, TINGEE_CREDENTIAL_KEYS: `v1:${KEY_1}` })).toMatchObject({
      TINGEE_CREDENTIAL_KEYS: `v1:${KEY_1}`,
    });
    const short = Buffer.alloc(16, 0x5a).toString('base64');
    for (const value of [
      ',',
      KEY_1,
      `v0:${KEY_1}`,
      `x1:${KEY_1}`,
      `v1:${short}`,
      `v1:${KEY_1}!`,
      `v1:${KEY_1},v1:${KEY_2}`,
      `v1:${KEY_1},v2:${short}`,
    ]) {
      const err = issuesOf({ ...apiEnv, TINGEE_CREDENTIAL_KEYS: value });
      expect(err.issues.map((i) => i.variable), value).toEqual(['TINGEE_CREDENTIAL_KEYS']);
      expect(err.message).not.toContain(KEY_1);
      expect(err.message).not.toContain(KEY_2);
      expect(err.message).not.toContain(short);
    }
  });

  it('TICKET_QR_KEYS (Story 3.3): bắt buộc ở vai api; trống hoặc sai dạng → dừng, nêu tên biến, không in khóa', () => {
    expect(loadConfig({ ...apiEnv, TICKET_QR_KEYS: `v1:${QR_KEY_1}` })).toMatchObject({
      TICKET_QR_KEYS: `v1:${QR_KEY_1}`,
    });
    for (const value of [undefined, '']) {
      const err = issuesOf({ ...apiEnv, TICKET_QR_KEYS: value });
      expect(err.issues).toEqual([{ variable: 'TICKET_QR_KEYS', reason: 'thiếu' }]);
      expect(err.message).toContain('TICKET_QR_KEYS');
    }
    const short = Buffer.alloc(16, 0x3c).toString('base64');
    for (const value of [
      ' ',
      ',',
      QR_KEY_1,
      `v0:${QR_KEY_1}`,
      `t1:${QR_KEY_1}`,
      `v1:${short}`,
      `v1:${QR_KEY_1}!`,
      `v1:${QR_KEY_1},v1:${QR_KEY_2}`,
    ]) {
      const err = issuesOf({ ...apiEnv, TICKET_QR_KEYS: value });
      expect(err.issues.map((i) => i.variable), value).toEqual(['TICKET_QR_KEYS']);
      expect(err.message).not.toContain(QR_KEY_1);
      expect(err.message).not.toContain(QR_KEY_2);
      expect(err.message).not.toContain(short);
    }
    // Vai worker chưa cần khóa này.
    expect(loadConfig(workerEnv)).not.toHaveProperty('TICKET_QR_KEYS');
  });

  it('vai api: thiếu hoặc rỗng biến Google → dừng, chỉ nêu tên biến, không in giá trị', () => {
    const err = issuesOf({ ...apiEnv, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: undefined });
    expect(err.issues).toEqual([
      { variable: 'GOOGLE_CLIENT_ID', reason: 'thiếu' },
      { variable: 'GOOGLE_CLIENT_SECRET', reason: 'thiếu' },
    ]);
    const other = issuesOf({ ...apiEnv, GOOGLE_CLIENT_ID: undefined });
    expect(other.message).toContain('GOOGLE_CLIENT_ID');
    expect(other.message).not.toContain(SECRET);
  });

  it('TRUST_PROXY_HOPS: số nguyên ≥ 0, mặc định 0', () => {
    expect(loadConfig({ ...apiEnv, TRUST_PROXY_HOPS: '2' })).toMatchObject({ TRUST_PROXY_HOPS: 2 });
    expect(loadConfig({ ...apiEnv, TRUST_PROXY_HOPS: '' })).toMatchObject({ TRUST_PROXY_HOPS: 0 });
    expect(issuesOf({ ...apiEnv, TRUST_PROXY_HOPS: '-1' }).issues).toEqual([
      { variable: 'TRUST_PROXY_HOPS', reason: 'ngoài khoảng cho phép' },
    ]);
    expect(issuesOf({ ...apiEnv, TRUST_PROXY_HOPS: '1.5' }).issues.map((i) => i.variable)).toEqual(['TRUST_PROXY_HOPS']);
    expect(issuesOf({ ...apiEnv, TRUST_PROXY_HOPS: 'hai' }).issues.map((i) => i.variable)).toEqual(['TRUST_PROXY_HOPS']);
  });

  it('BETTER_AUTH_SECRET phải ≥ 32 ký tự; AUTH_COOKIE_DOMAIN tùy chọn', () => {
    expect(issuesOf({ ...apiEnv, BETTER_AUTH_SECRET: 'ngan' }).issues).toEqual([
      { variable: 'BETTER_AUTH_SECRET', reason: 'ngoài khoảng cho phép' },
    ]);
    expect(loadConfig({ ...apiEnv, AUTH_COOKIE_DOMAIN: 'tickee.vn' })).toMatchObject({ AUTH_COOKIE_DOMAIN: 'tickee.vn' });
    expect(loadConfig(apiEnv)).not.toHaveProperty('AUTH_COOKIE_DOMAIN');
  });
});
