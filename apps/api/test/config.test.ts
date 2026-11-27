import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  apiConfigSchema,
  ConfigError,
  ENV_EXAMPLE_KEYS,
  ENV_EXAMPLE_SECRETS,
  isCookieParent,
  isLocalHost,
  isLocalUrl,
  loadConfig,
  productionLookingOrigins,
  sharesKey,
  workerConfigSchema,
} from '../src/platform/config/index.js';

const SECRET = 's3cret-Gi4-tri';
/** Khóa 32 byte (base64) dùng làm "giá trị bí mật" của `TINGEE_CREDENTIAL_KEYS`. */
const KEY_1 = Buffer.alloc(32, 0x5a).toString('base64');
const KEY_2 = Buffer.alloc(32, 0xa5).toString('base64');
/** Khóa 32 byte (base64) dùng làm "giá trị bí mật" của `TICKET_QR_KEYS`. */
const QR_KEY_1 = Buffer.alloc(32, 0x3c).toString('base64');
const QR_KEY_2 = Buffer.alloc(32, 0xc3).toString('base64');
/** Khóa 32 byte (base64) dùng làm "giá trị bí mật" của `GOOGLE_SHEETS_TOKEN_KEYS` (Story 6.4). */
const SHEETS_KEY_1 = Buffer.alloc(32, 0x66).toString('base64');
const apiEnv = {
  APP_ROLE: 'api',
  NODE_ENV: 'test',
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
  GOOGLE_SHEETS_CLIENT_ID: '456-sheets.apps.googleusercontent.com',
  GOOGLE_SHEETS_CLIENT_SECRET: `GOCSPX-sheets-${SECRET}`,
  GOOGLE_SHEETS_TOKEN_KEYS: `v1:${SHEETS_KEY_1}`,
  S3_ENDPOINT: 'https://s3.tickee.vn',
  S3_BUCKET: 'tickee-event-images',
  S3_ACCESS_KEY_ID: 'AKIA-tickee-api',
  S3_SECRET_ACCESS_KEY: `s3-${SECRET}`,
  S3_PUBLIC_BASE_URL: 'https://anh.tickee.vn',
};
const workerEnv = {
  APP_ROLE: 'worker',
  NODE_ENV: 'test',
  DATABASE_URL: apiEnv.DATABASE_URL,
  WEB_ORIGIN: apiEnv.WEB_ORIGIN,
  SMTP_URL: apiEnv.SMTP_URL,
  EMAIL_FROM: apiEnv.EMAIL_FROM,
  REVALIDATE_SECRET: `${SECRET}-${'r'.repeat(32)}`,
  TINGEE_BASE_URL: apiEnv.TINGEE_BASE_URL,
  TINGEE_CREDENTIAL_KEYS: apiEnv.TINGEE_CREDENTIAL_KEYS,
  TICKET_QR_KEYS: apiEnv.TICKET_QR_KEYS,
  GOOGLE_SHEETS_CLIENT_ID: apiEnv.GOOGLE_SHEETS_CLIENT_ID,
  GOOGLE_SHEETS_CLIENT_SECRET: apiEnv.GOOGLE_SHEETS_CLIENT_SECRET,
  GOOGLE_SHEETS_TOKEN_KEYS: apiEnv.GOOGLE_SHEETS_TOKEN_KEYS,
};
/** Production hợp lệ (Story 4.7-b): https, secret riêng, dải IP admin, cookie ở miền cha của `api.tickee.vn` và `tickee.vn`. */
const apiProdEnv = {
  ...apiEnv,
  NODE_ENV: 'production',
  ADMIN_ALLOWED_CIDRS: '203.0.113.0/24',
  AUTH_COOKIE_DOMAIN: 'tickee.vn',
};
/** Worker production hợp lệ: thêm người nhận cảnh báo vận hành, bắt buộc ở production (E4-3). */
const workerProdEnv = { ...workerEnv, NODE_ENV: 'production', OPS_ALERT_EMAILS: 'ops@tickee.vn' };

/** Tingee fake của `.env.example`: host local, nên `NODE_ENV=development` nhận (E4-3). */
const TINGEE_FAKE_URL = 'http://localhost:4010';
const TINGEE_UAT_URL = 'https://uat-open-api.tingee.vn';

/**
 * `env` chạy ở `NODE_ENV`. `development` thì trỏ thêm Tingee fake: các env mẫu ở đây dùng URL UAT, mà development từ chối
 * Tingee thật khi không bật `TINGEE_ALLOW_REAL_IN_DEVELOPMENT` (E4-3), nên test luật khác không bị báo thêm.
 */
function inNodeEnv(env: Record<string, string | undefined>, NODE_ENV: string): Record<string, string | undefined> {
  return NODE_ENV === 'development' ? { ...env, NODE_ENV, TINGEE_BASE_URL: TINGEE_FAKE_URL } : { ...env, NODE_ENV };
}

/** `.env.example` ở gốc repo, đúng như `.env` local được tạo từ nó. */
const envExample = parseEnv(readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8'));

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
      NODE_ENV: 'test',
      TRUST_PROXY_HOPS: 0,
    });
  });

  it('vai migrate chỉ cần MIGRATION_DATABASE_URL, không cần DATABASE_URL', () => {
    const config = loadConfig({ APP_ROLE: 'migrate', NODE_ENV: 'test', MIGRATION_DATABASE_URL: 'postgres://m:p@db/tickee' });
    expect(config.APP_ROLE).toBe('migrate');
  });

  it('biến tùy chọn đặt rỗng → dùng mặc định; biến bắt buộc rỗng → "thiếu"', () => {
    const config = loadConfig({ ...apiEnv, PORT: '', LOG_LEVEL: '' });
    expect(config).toMatchObject({ PORT: 3001, LOG_LEVEL: 'info' });
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

  it('vai worker: TINGEE_ORDER_STATUS_QUERY (Story 4.1) mặc định tắt; nhận true/false, 1/0…; giá trị lạ → lỗi, không in giá trị', () => {
    const flag = (value: string | undefined) => {
      const config = loadConfig({ ...workerEnv, TINGEE_ORDER_STATUS_QUERY: value });
      return config.APP_ROLE === 'worker' ? config.TINGEE_ORDER_STATUS_QUERY : null;
    };
    expect(flag(undefined)).toBe(false);
    expect(flag('')).toBe(false);
    expect(flag('true')).toBe(true);
    expect(flag('1')).toBe(true);
    expect(flag('false')).toBe(false);
    expect(flag('0')).toBe(false);
    const err = issuesOf({ ...workerEnv, TINGEE_ORDER_STATUS_QUERY: SECRET });
    expect(err.issues.map((i) => i.variable)).toEqual(['TINGEE_ORDER_STATUS_QUERY']);
    expect(err.message).not.toContain(SECRET);
    // Vai api không đọc biến này.
    expect(loadConfig({ ...apiEnv, TINGEE_ORDER_STATUS_QUERY: 'true' })).not.toHaveProperty('TINGEE_ORDER_STATUS_QUERY');
  });

  it('cảnh báo vận hành (Story 4.6-b): mặc định cooldown 30 phút (api, worker), ngưỡng ùn 5 phút và không người nhận (worker, test/development)', () => {
    const api = loadConfig(apiEnv);
    expect(api).toMatchObject({ OPS_ALERT_COOLDOWN_MINUTES: 30 });
    // Vai api chỉ raise: không gửi email, không quét.
    expect(api).not.toHaveProperty('OPS_ALERT_EMAILS');
    expect(loadConfig({ ...apiEnv, OPS_ALERT_QUEUE_WAIT_MINUTES: '9' })).not.toHaveProperty('OPS_ALERT_QUEUE_WAIT_MINUTES');
    const worker = loadConfig(workerEnv);
    expect(worker).toMatchObject({ OPS_ALERT_COOLDOWN_MINUTES: 30, OPS_ALERT_QUEUE_WAIT_MINUTES: 5 });
    // Người nhận chỉ bắt buộc ở production (E4-3): test/development không đặt hoặc rỗng thì không có.
    for (const NODE_ENV of ['test', 'development']) {
      expect(loadConfig(inNodeEnv(workerEnv, NODE_ENV)), NODE_ENV).not.toHaveProperty('OPS_ALERT_EMAILS');
      expect(loadConfig({ ...inNodeEnv(workerEnv, NODE_ENV), OPS_ALERT_EMAILS: '' }), NODE_ENV).not.toHaveProperty(
        'OPS_ALERT_EMAILS',
      );
    }
    expect(
      loadConfig({ ...workerEnv, OPS_ALERT_COOLDOWN_MINUTES: '45', OPS_ALERT_QUEUE_WAIT_MINUTES: '10' }),
    ).toMatchObject({ OPS_ALERT_COOLDOWN_MINUTES: 45, OPS_ALERT_QUEUE_WAIT_MINUTES: 10 });
  });

  it('OPS_ALERT_EMAILS: danh sách email cách nhau bằng dấu phẩy (bỏ khoảng trắng, gộp trùng); sai → lỗi, không in giá trị', () => {
    const emails = (value: string) => {
      const config = loadConfig({ ...workerEnv, OPS_ALERT_EMAILS: value });
      return config.APP_ROLE === 'worker' ? config.OPS_ALERT_EMAILS : null;
    };
    expect(emails('ops@tickee.vn')).toEqual(['ops@tickee.vn']);
    expect(emails(' ops@tickee.vn , oncall@tickee.vn,ops@tickee.vn ')).toEqual(['ops@tickee.vn', 'oncall@tickee.vn']);
    for (const value of [`${SECRET}`, `ops@tickee.vn,${SECRET}`, ' , ', `ops@tickee.vn;${SECRET}@x.vn`]) {
      const err = issuesOf({ ...workerEnv, OPS_ALERT_EMAILS: value });
      expect(err.issues, value).toEqual([
        { variable: 'OPS_ALERT_EMAILS', reason: 'phải là danh sách email cách nhau bằng dấu phẩy' },
      ]);
      expect(err.message).not.toContain(SECRET);
    }
  });

  it('OPS_ALERT_COOLDOWN_MINUTES, OPS_ALERT_QUEUE_WAIT_MINUTES: số nguyên 1–1440 phút; sai → lỗi, nêu tên biến', () => {
    for (const value of ['0', '-5', '1.5', '1441', 'ba-muoi']) {
      expect(issuesOf({ ...apiEnv, OPS_ALERT_COOLDOWN_MINUTES: value }).issues.map((i) => i.variable), value).toEqual([
        'OPS_ALERT_COOLDOWN_MINUTES',
      ]);
      expect(issuesOf({ ...workerEnv, OPS_ALERT_QUEUE_WAIT_MINUTES: value }).issues.map((i) => i.variable), value).toEqual(
        ['OPS_ALERT_QUEUE_WAIT_MINUTES'],
      );
    }
  });

  it('luật cảnh báo nghiệp vụ (Story 4.6-e): mặc định IPN lỗi 5, p95 tạo link 2000 ms / 20 mẫu (chỉ api); 10 Đơn, tỉ lệ 0,5 (chỉ worker)', () => {
    const api = loadConfig(apiEnv);
    expect(api).toMatchObject({ OPS_ALERT_IPN_FAILURES: 5, OPS_ALERT_LINK_P95_MS: 2000, OPS_ALERT_LINK_MIN_SAMPLES: 20 });
    expect(
      loadConfig({ ...apiEnv, OPS_ALERT_IPN_FAILURES: '12', OPS_ALERT_LINK_P95_MS: '1500', OPS_ALERT_LINK_MIN_SAMPLES: '50' }),
    ).toMatchObject({ OPS_ALERT_IPN_FAILURES: 12, OPS_ALERT_LINK_P95_MS: 1500, OPS_ALERT_LINK_MIN_SAMPLES: 50 });
    // Biến của vai kia không được đọc.
    const apiWithWorkerVars = loadConfig({ ...apiEnv, OPS_ALERT_ISSUANCE_MIN_ORDERS: '3', OPS_ALERT_ISSUANCE_RATIO: '0.2' });
    expect(apiWithWorkerVars).not.toHaveProperty('OPS_ALERT_ISSUANCE_MIN_ORDERS');
    expect(apiWithWorkerVars).not.toHaveProperty('OPS_ALERT_ISSUANCE_RATIO');

    const worker = loadConfig(workerEnv);
    expect(worker).toMatchObject({ OPS_ALERT_ISSUANCE_MIN_ORDERS: 10, OPS_ALERT_ISSUANCE_RATIO: 0.5 });
    expect(loadConfig({ ...workerEnv, OPS_ALERT_ISSUANCE_MIN_ORDERS: '25', OPS_ALERT_ISSUANCE_RATIO: '1' })).toMatchObject({
      OPS_ALERT_ISSUANCE_MIN_ORDERS: 25,
      OPS_ALERT_ISSUANCE_RATIO: 1,
    });
    for (const variable of ['OPS_ALERT_IPN_FAILURES', 'OPS_ALERT_LINK_P95_MS', 'OPS_ALERT_LINK_MIN_SAMPLES']) {
      expect(loadConfig({ ...workerEnv, [variable]: '7' })).not.toHaveProperty(variable);
    }
  });

  it('ngưỡng luật cảnh báo nghiệp vụ: số nguyên ≥ 1; OPS_ALERT_ISSUANCE_RATIO trong (0, 1]; sai → lỗi nêu tên biến, không in giá trị', () => {
    for (const value of ['0', '-3', '1.5', 'nam', SECRET]) {
      for (const variable of ['OPS_ALERT_IPN_FAILURES', 'OPS_ALERT_LINK_P95_MS', 'OPS_ALERT_LINK_MIN_SAMPLES']) {
        const err = issuesOf({ ...apiEnv, [variable]: value });
        expect(err.issues.map((i) => i.variable), `${variable}=${value}`).toEqual([variable]);
        expect(err.message).not.toContain(SECRET);
      }
      const err = issuesOf({ ...workerEnv, OPS_ALERT_ISSUANCE_MIN_ORDERS: value });
      expect(err.issues.map((i) => i.variable), value).toEqual(['OPS_ALERT_ISSUANCE_MIN_ORDERS']);
    }
    for (const value of ['0', '-0.5', '1.01', '2', 'nua', SECRET]) {
      const err = issuesOf({ ...workerEnv, OPS_ALERT_ISSUANCE_RATIO: value });
      expect(err.issues.map((i) => i.variable), value).toEqual(['OPS_ALERT_ISSUANCE_RATIO']);
      expect(err.message).not.toContain(SECRET);
    }
    const ratio = (value: string) => {
      const config = loadConfig({ ...workerEnv, OPS_ALERT_ISSUANCE_RATIO: value });
      return config.APP_ROLE === 'worker' ? config.OPS_ALERT_ISSUANCE_RATIO : null;
    };
    expect(ratio('0.25')).toBe(0.25);
    expect(ratio('1')).toBe(1);
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
    const err = issuesOf({ APP_ROLE: 'migrate', NODE_ENV: 'test', DATABASE_URL: apiEnv.DATABASE_URL });
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
      'GOOGLE_SHEETS_CLIENT_ID',
      'GOOGLE_SHEETS_CLIENT_SECRET',
      'GOOGLE_SHEETS_TOKEN_KEYS',
      'NODE_ENV',
      'S3_ACCESS_KEY_ID',
      'S3_BUCKET',
      'S3_ENDPOINT',
      'S3_PUBLIC_BASE_URL',
      'S3_SECRET_ACCESS_KEY',
      'SMTP_URL',
      'TICKET_QR_KEYS',
      'TINGEE_BASE_URL',
      'TINGEE_CREDENTIAL_KEYS',
      'WEB_ORIGIN',
    ]);
    expect(err.issues.every((i) => i.reason === 'thiếu')).toBe(true);
  });

  it('object storage (Story 4.8-a): chỉ vai api; mặc định region us-east-1, path-style tắt; sai → nêu tên biến, không in giá trị', () => {
    expect(loadConfig(apiEnv)).toMatchObject({
      S3_ENDPOINT: 'https://s3.tickee.vn',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'tickee-event-images',
      S3_ACCESS_KEY_ID: 'AKIA-tickee-api',
      S3_SECRET_ACCESS_KEY: `s3-${SECRET}`,
      S3_FORCE_PATH_STYLE: false,
      S3_PUBLIC_BASE_URL: 'https://anh.tickee.vn',
    });
    expect(
      loadConfig({
        ...apiEnv,
        S3_REGION: 'ap-southeast-1',
        S3_FORCE_PATH_STYLE: 'true',
        S3_PUBLIC_BASE_URL: 'http://localhost:9000/anh',
      }),
    ).toMatchObject({
      S3_REGION: 'ap-southeast-1',
      S3_FORCE_PATH_STYLE: true,
      S3_PUBLIC_BASE_URL: 'http://localhost:9000/anh',
    });
    const err = issuesOf({
      ...apiEnv,
      S3_ENDPOINT: `ftp://${SECRET}.vn`,
      S3_BUCKET: `Bucket_${SECRET}`,
      S3_FORCE_PATH_STYLE: SECRET,
      S3_PUBLIC_BASE_URL: SECRET,
      S3_SECRET_ACCESS_KEY: '',
    });
    expect(err.issues.map((i) => i.variable).sort()).toEqual([
      'S3_BUCKET',
      'S3_ENDPOINT',
      'S3_FORCE_PATH_STYLE',
      'S3_PUBLIC_BASE_URL',
      'S3_SECRET_ACCESS_KEY',
    ]);
    expect(err.message).not.toContain(SECRET);
    expect(JSON.stringify(err.issues)).not.toContain(SECRET);
    // Worker không đọc nhóm `S3_*`.
    const worker = loadConfig({ ...workerEnv, S3_ENDPOINT: 'https://s3.tickee.vn', S3_BUCKET: 'tickee-event-images' });
    expect(Object.keys(worker).filter((k) => k.startsWith('S3_'))).toEqual([]);
  });

  it('vai api: biến Tingee bắt buộc; URL phải là origin; không còn credential Tingee nào trong env', () => {
    const err = issuesOf({ ...apiEnv, TINGEE_CREDENTIAL_KEYS: '', TINGEE_BASE_URL: 'https://uat-open-api.tingee.vn/v1' });
    expect(err.issues.map((i) => i.variable)).toEqual(['TINGEE_BASE_URL', 'TINGEE_CREDENTIAL_KEYS']);
    expect(err.issues[1]?.reason).toBe('thiếu');
    // Key Tingee là của từng BTC (lưu mã hóa trong DB): env Tingee chỉ còn URL, khóa mã hóa và cờ opt-in Tingee thật ở
    // development (E4-3), không phải credential.
    const tingeeKeys = Object.keys(loadConfig(apiEnv)).filter((k) => k.startsWith('TINGEE_'));
    expect(tingeeKeys.sort()).toEqual(['TINGEE_ALLOW_REAL_IN_DEVELOPMENT', 'TINGEE_BASE_URL', 'TINGEE_CREDENTIAL_KEYS']);
    // Worker thêm cờ Đối soát bù (Story 4.1), không phải credential.
    const workerTingeeKeys = Object.keys(loadConfig(workerEnv)).filter((k) => k.startsWith('TINGEE_'));
    expect(workerTingeeKeys.sort()).toEqual([
      'TINGEE_ALLOW_REAL_IN_DEVELOPMENT',
      'TINGEE_BASE_URL',
      'TINGEE_CREDENTIAL_KEYS',
      'TINGEE_ORDER_STATUS_QUERY',
    ]);
  });

  it('vai worker (Story 3.5): cần TINGEE_BASE_URL, TINGEE_CREDENTIAL_KEYS, TICKET_QR_KEYS như vai api; lỗi không in giá trị', () => {
    const config = loadConfig(workerEnv);
    expect(config).toMatchObject({
      APP_ROLE: 'worker',
      TINGEE_BASE_URL: 'https://uat-open-api.tingee.vn',
      TINGEE_CREDENTIAL_KEYS: apiEnv.TINGEE_CREDENTIAL_KEYS,
      TICKET_QR_KEYS: apiEnv.TICKET_QR_KEYS,
    });
    const missing = issuesOf({
      ...workerEnv,
      TINGEE_BASE_URL: undefined,
      TINGEE_CREDENTIAL_KEYS: '',
      TICKET_QR_KEYS: undefined,
    });
    expect(missing.issues).toEqual([
      { variable: 'TINGEE_BASE_URL', reason: 'thiếu' },
      { variable: 'TINGEE_CREDENTIAL_KEYS', reason: 'thiếu' },
      { variable: 'TICKET_QR_KEYS', reason: 'thiếu' },
    ]);
    const short = Buffer.alloc(16, 0x3c).toString('base64');
    const invalid = issuesOf({
      ...workerEnv,
      TINGEE_BASE_URL: `https://uat-open-api.tingee.vn/${SECRET}`,
      TINGEE_CREDENTIAL_KEYS: `v1:${short}`,
      TICKET_QR_KEYS: QR_KEY_1,
    });
    expect(invalid.issues.map((i) => i.variable)).toEqual(['TINGEE_BASE_URL', 'TINGEE_CREDENTIAL_KEYS', 'TICKET_QR_KEYS']);
    for (const value of [SECRET, short, QR_KEY_1]) expect(invalid.message).not.toContain(value);
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

  it('Google Sheets (Story 6.4): client, secret, khóa bắt buộc ở cả api và worker; ba URL Google mặc định là endpoint thật', () => {
    for (const env of [apiEnv, workerEnv]) {
      expect(loadConfig(env), env.APP_ROLE).toMatchObject({
        GOOGLE_SHEETS_CLIENT_ID: '456-sheets.apps.googleusercontent.com',
        GOOGLE_SHEETS_TOKEN_KEYS: `v1:${SHEETS_KEY_1}`,
        GOOGLE_OAUTH_AUTHORIZE_URL: 'https://accounts.google.com/o/oauth2/v2/auth',
        GOOGLE_OAUTH_TOKEN_URL: 'https://oauth2.googleapis.com/token',
        GOOGLE_SHEETS_API_URL: 'https://sheets.googleapis.com',
      });
      const err = issuesOf({
        ...env,
        GOOGLE_SHEETS_CLIENT_ID: '',
        GOOGLE_SHEETS_CLIENT_SECRET: undefined,
        GOOGLE_SHEETS_TOKEN_KEYS: undefined,
      });
      expect(err.issues, env.APP_ROLE).toEqual([
        { variable: 'GOOGLE_SHEETS_CLIENT_ID', reason: 'thiếu' },
        { variable: 'GOOGLE_SHEETS_CLIENT_SECRET', reason: 'thiếu' },
        { variable: 'GOOGLE_SHEETS_TOKEN_KEYS', reason: 'thiếu' },
      ]);
      // Trỏ vào Google fake (test, stack e2e).
      expect(
        loadConfig({
          ...env,
          GOOGLE_OAUTH_AUTHORIZE_URL: 'http://127.0.0.1:4020/o/oauth2/v2/auth',
          GOOGLE_OAUTH_TOKEN_URL: 'http://127.0.0.1:4020/token',
          GOOGLE_SHEETS_API_URL: 'http://127.0.0.1:4020',
        }),
      ).toMatchObject({ GOOGLE_SHEETS_API_URL: 'http://127.0.0.1:4020' });
    }
  });

  it('Google Sheets: khóa sai dạng, URL sai → lỗi nêu tên biến, không in giá trị; GOOGLE_SHEETS_API_URL phải là origin', () => {
    const short = Buffer.alloc(16, 0x66).toString('base64');
    const err = issuesOf({
      ...apiEnv,
      GOOGLE_SHEETS_TOKEN_KEYS: `v1:${short}`,
      GOOGLE_OAUTH_AUTHORIZE_URL: `ftp://${SECRET}.vn/auth`,
      GOOGLE_OAUTH_TOKEN_URL: SECRET,
      GOOGLE_SHEETS_API_URL: `https://sheets.googleapis.com/${SECRET}`,
    });
    expect(err.issues.map((i) => i.variable)).toEqual([
      'GOOGLE_SHEETS_TOKEN_KEYS',
      'GOOGLE_OAUTH_AUTHORIZE_URL',
      'GOOGLE_OAUTH_TOKEN_URL',
      'GOOGLE_SHEETS_API_URL',
    ]);
    expect(err.message).not.toContain(SECRET);
    expect(err.message).not.toContain(short);
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

  it('ADMIN_ALLOWED_CIDRS (Story 4.7-a): danh sách CIDR đã chuẩn hóa; development/test không đặt → không có; worker không đọc', () => {
    const cidrsOf = (env: Record<string, string | undefined>) => {
      const config = loadConfig(env);
      return config.APP_ROLE === 'api' ? config.ADMIN_ALLOWED_CIDRS : 'không phải api';
    };
    expect(cidrsOf({ ...apiEnv, ADMIN_ALLOWED_CIDRS: ' 203.0.113.0/24 , 2001:DB8::/32,198.51.100.7,203.0.113.0/24' })).toEqual([
      '203.0.113.0/24',
      '2001:db8::/32',
      '198.51.100.7/32',
    ]);
    for (const NODE_ENV of ['development', 'test']) {
      expect(cidrsOf(inNodeEnv(apiEnv, NODE_ENV)), NODE_ENV).toBeUndefined();
      expect(cidrsOf({ ...inNodeEnv(apiEnv, NODE_ENV), ADMIN_ALLOWED_CIDRS: '' }), NODE_ENV).toBeUndefined();
    }
    expect(loadConfig({ ...workerEnv, ADMIN_ALLOWED_CIDRS: '203.0.113.0/24' })).not.toHaveProperty('ADMIN_ALLOWED_CIDRS');
    // Worker ở production không cần biến này.
    expect(loadConfig(workerProdEnv)).not.toHaveProperty('ADMIN_ALLOWED_CIDRS');
  });

  it('ADMIN_ALLOWED_CIDRS: NODE_ENV=production thiếu hoặc rỗng → "thiếu"; đặt đúng thì khởi động được', () => {
    for (const value of [undefined, '']) {
      const err = issuesOf({ ...apiProdEnv, ADMIN_ALLOWED_CIDRS: value });
      expect(err.issues).toEqual([{ variable: 'ADMIN_ALLOWED_CIDRS', reason: 'thiếu' }]);
      expect(err.message).toContain('ADMIN_ALLOWED_CIDRS');
    }
    expect(loadConfig(apiProdEnv)).toMatchObject({
      NODE_ENV: 'production',
      ADMIN_ALLOWED_CIDRS: ['203.0.113.0/24'],
    });
    // Báo cùng lượt với biến khác đang lỗi (không phải sửa từng biến một).
    const both = issuesOf({ ...apiProdEnv, ADMIN_ALLOWED_CIDRS: undefined, DATABASE_URL: undefined });
    expect(both.issues).toEqual(
      expect.arrayContaining([
        { variable: 'DATABASE_URL', reason: 'thiếu' },
        { variable: 'ADMIN_ALLOWED_CIDRS', reason: 'thiếu' },
      ]),
    );
    expect(both.issues).toHaveLength(2);
  });

  it('ADMIN_ALLOWED_CIDRS: mục sai, prefix /0 hay danh sách rỗng → lỗi có lý do, không in giá trị (cả production lẫn dev)', () => {
    const cases: [string, string][] = [
      ['10.0.0.0/33', 'mục thứ 1 có prefix ngoài 1–32 của IPv4'],
      ['abc', 'mục thứ 1 không phải IP hoặc CIDR IPv4/IPv6 hợp lệ'],
      ['0.0.0.0/0', 'mục thứ 1 có prefix /0 (mở cho mọi IP)'],
      [',', 'danh sách CIDR rỗng'],
      [' ', 'danh sách CIDR rỗng'],
      [`203.0.113.0/24,${SECRET}`, 'mục thứ 2 không phải IP hoặc CIDR IPv4/IPv6 hợp lệ'],
    ];
    for (const NODE_ENV of ['production', 'development']) {
      for (const [value, reason] of cases) {
        const err = issuesOf({ ...inNodeEnv(apiProdEnv, NODE_ENV), ADMIN_ALLOWED_CIDRS: value });
        // Một issue: lỗi định dạng, không thêm "thiếu" ở production.
        expect(err.issues, `${NODE_ENV} ${value}`).toEqual([{ variable: 'ADMIN_ALLOWED_CIDRS', reason }]);
        expect(err.message).not.toContain(SECRET);
        if (value.trim() !== '' && value !== ',') expect(err.message).not.toContain(value);
      }
    }
  });

  it('BETTER_AUTH_SECRET phải ≥ 32 ký tự; AUTH_COOKIE_DOMAIN tùy chọn', () => {
    expect(issuesOf({ ...apiEnv, BETTER_AUTH_SECRET: 'ngan' }).issues).toEqual([
      { variable: 'BETTER_AUTH_SECRET', reason: 'ngoài khoảng cho phép' },
    ]);
    expect(loadConfig({ ...apiEnv, AUTH_COOKIE_DOMAIN: 'tickee.vn' })).toMatchObject({ AUTH_COOKIE_DOMAIN: 'tickee.vn' });
    expect(loadConfig(apiEnv)).not.toHaveProperty('AUTH_COOKIE_DOMAIN');
  });
});

const HTTPS_REASON = 'phải là https khi NODE_ENV=production';
const EXAMPLE_REASON = 'là giá trị mẫu của .env.example; môi trường thật phải sinh giá trị riêng';
const SHARED_KEY_REASON = 'dùng chung khóa với TINGEE_CREDENTIAL_KEYS';
const COOKIE_REASON = 'phải là miền cha của host API_PUBLIC_URL và WEB_ORIGIN';

/** Env production hợp lệ của từng vai, kèm danh sách biến vai đó đọc. */
const prodRoles = [
  ['api', apiProdEnv, apiConfigSchema.shape],
  ['worker', workerProdEnv, workerConfigSchema.shape],
] as const;

describe('siết cấu hình production (Story 4.7-b)', () => {
  it('production hợp lệ: api và worker khởi động; OTEL_EXPORTER_OTLP_ENDPOINT http vẫn nhận (collector nội bộ)', () => {
    expect(loadConfig(apiProdEnv)).toMatchObject({ NODE_ENV: 'production', AUTH_COOKIE_DOMAIN: 'tickee.vn' });
    expect(loadConfig(workerProdEnv)).toMatchObject({ APP_ROLE: 'worker', NODE_ENV: 'production' });
    for (const env of [apiProdEnv, workerProdEnv]) {
      expect(loadConfig({ ...env, OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel-collector:4318' })).toMatchObject({
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel-collector:4318',
      });
    }
  });

  it('NODE_ENV bắt buộc ở cả ba vai: không đặt hoặc rỗng → "thiếu", không mặc định development', () => {
    const migrateEnv = { APP_ROLE: 'migrate', MIGRATION_DATABASE_URL: 'postgres://m:p@db/tickee' };
    for (const env of [apiEnv, workerEnv, migrateEnv]) {
      for (const NODE_ENV of [undefined, '']) {
        expect(issuesOf({ ...env, NODE_ENV }).issues, `${env.APP_ROLE} ${String(NODE_ENV)}`).toEqual([
          { variable: 'NODE_ENV', reason: 'thiếu' },
        ]);
      }
    }
    // Giá trị lạ: một issue ở NODE_ENV, không in giá trị; luật dùng NODE_ENV bỏ qua nên http và secret mẫu không báo thêm.
    const err = issuesOf({
      ...apiProdEnv,
      NODE_ENV: `prod-${SECRET}`,
      API_PUBLIC_URL: 'http://api.tickee.vn',
      BETTER_AUTH_SECRET: ENV_EXAMPLE_SECRETS.BETTER_AUTH_SECRET,
    });
    expect(err.issues).toEqual([{ variable: 'NODE_ENV', reason: 'giá trị không thuộc danh sách cho phép' }]);
    expect(err.message).not.toContain(SECRET);
  });

  it.each([
    ['api', 'API_PUBLIC_URL', 'http://api.tickee.vn'],
    ['api', 'WEB_ORIGIN', 'http://tickee.vn'],
    ['api', 'TINGEE_BASE_URL', 'http://uat-open-api.tingee.vn'],
    ['api', 'S3_ENDPOINT', 'http://s3.tickee.vn'],
    ['api', 'S3_PUBLIC_BASE_URL', 'http://anh.tickee.vn/anh'],
    ['worker', 'WEB_ORIGIN', 'http://tickee.vn'],
    ['worker', 'TINGEE_BASE_URL', 'http://uat-open-api.tingee.vn'],
    // Story 6.4: ba URL Google của Google Sheets, ở cả hai vai.
    ['api', 'GOOGLE_OAUTH_AUTHORIZE_URL', 'http://accounts.google.com/o/oauth2/v2/auth'],
    ['api', 'GOOGLE_OAUTH_TOKEN_URL', 'http://oauth2.googleapis.com/token'],
    ['api', 'GOOGLE_SHEETS_API_URL', 'http://sheets.googleapis.com'],
    ['worker', 'GOOGLE_OAUTH_AUTHORIZE_URL', 'http://accounts.google.com/o/oauth2/v2/auth'],
    ['worker', 'GOOGLE_OAUTH_TOKEN_URL', 'http://oauth2.googleapis.com/token'],
    ['worker', 'GOOGLE_SHEETS_API_URL', 'http://sheets.googleapis.com'],
  ])('vai %s: %s http ở production → lỗi, không in giá trị; development/test vẫn nhận', (role, variable, value) => {
    const prod = role === 'api' ? apiProdEnv : workerProdEnv;
    const err = issuesOf({ ...prod, [variable]: value });
    expect(err.issues).toEqual([{ variable, reason: HTTPS_REASON }]);
    expect(err.message).not.toContain(value);
    // `TINGEE_BASE_URL` là host thật: development cần cờ opt-in (E4-3).
    for (const NODE_ENV of ['development', 'test']) {
      const optIn = variable === 'TINGEE_BASE_URL' && NODE_ENV === 'development' ? { TINGEE_ALLOW_REAL_IN_DEVELOPMENT: 'true' } : {};
      expect(() => loadConfig({ ...inNodeEnv(prod, NODE_ENV), ...optIn, [variable]: value }), NODE_ENV).not.toThrow();
    }
  });

  it.each(Object.entries(ENV_EXAMPLE_SECRETS))(
    '%s đúng giá trị mẫu ở production → lỗi, không in giá trị; development vẫn nhận',
    (variable, example) => {
      let checked = 0;
      for (const [role, prod, shape] of prodRoles) {
        if (!(variable in shape)) continue;
        checked += 1;
        const err = issuesOf({ ...prod, [variable]: example });
        expect(err.issues, role).toEqual([{ variable, reason: EXAMPLE_REASON }]);
        expect(err.message).not.toContain(example);
        // Khoảng trắng hai đầu (secret tạo từ file kèm dòng mới cuối) vẫn là giá trị mẫu.
        for (const padded of [`${example}\n`, ` ${example} `]) {
          expect(issuesOf({ ...prod, [variable]: padded }).issues, `${role} ${JSON.stringify(padded)}`).toEqual([
            { variable, reason: EXAMPLE_REASON },
          ]);
        }
        expect(() => loadConfig({ ...inNodeEnv(prod, 'development'), [variable]: example }), role).not.toThrow();
      }
      expect(checked).toBeGreaterThan(0);
    },
  );

  it('TINGEE_CREDENTIAL_KEYS, TICKET_QR_KEYS, GOOGLE_SHEETS_TOKEN_KEYS: khóa trùng byte với một trong các khóa mẫu, bất kể phiên bản → lỗi ở production', () => {
    const exampleKeys = Object.values(ENV_EXAMPLE_KEYS).map((list) => list.slice(list.indexOf(':') + 1));
    expect(exampleKeys).toHaveLength(3);
    for (const [role, prod] of prodRoles) {
      for (const example of exampleKeys) {
        for (const [variable, value] of [
          ['TINGEE_CREDENTIAL_KEYS', `v1:${KEY_1},v2:${example}`],
          ['TICKET_QR_KEYS', `v7:${example}`],
          ['GOOGLE_SHEETS_TOKEN_KEYS', `v3:${example}`],
        ] as const) {
          const err = issuesOf({ ...prod, [variable]: value });
          expect(err.issues, `${role} ${variable}`).toEqual([{ variable, reason: EXAMPLE_REASON }]);
          expect(err.message).not.toContain(example);
          expect(
            () => loadConfig({ ...inNodeEnv(prod, 'development'), [variable]: value }),
            `${role} ${variable}`,
          ).not.toThrow();
        }
      }
    }
  });

  it('TICKET_QR_KEYS có khóa trùng byte với TINGEE_CREDENTIAL_KEYS → lỗi ở TICKET_QR_KEYS, ở mọi môi trường', () => {
    for (const [role, prod] of prodRoles) {
      for (const NODE_ENV of ['development', 'test', 'production']) {
        const err = issuesOf({ ...inNodeEnv(prod, NODE_ENV), TICKET_QR_KEYS: `v1:${QR_KEY_1},v3:${KEY_2}` });
        expect(err.issues, `${role} ${NODE_ENV}`).toEqual([{ variable: 'TICKET_QR_KEYS', reason: SHARED_KEY_REASON }]);
        expect(err.message).not.toContain(KEY_2);
      }
    }
    // Một danh sách sai dạng: chỉ báo lỗi định dạng, không so khóa.
    const invalid = issuesOf({ ...apiEnv, TINGEE_CREDENTIAL_KEYS: `v1:${QR_KEY_1}x`, TICKET_QR_KEYS: `v1:${QR_KEY_1}` });
    expect(invalid.issues.map((i) => i.variable)).toEqual(['TINGEE_CREDENTIAL_KEYS']);
  });

  it('GOOGLE_SHEETS_TOKEN_KEYS (Story 6.4) có khóa trùng byte với TINGEE_CREDENTIAL_KEYS hoặc TICKET_QR_KEYS → lỗi, ở mọi môi trường', () => {
    for (const [role, prod] of prodRoles) {
      for (const NODE_ENV of ['development', 'test', 'production']) {
        for (const [shared, other] of [
          [KEY_2, 'TINGEE_CREDENTIAL_KEYS'],
          [QR_KEY_1, 'TICKET_QR_KEYS'],
        ] as const) {
          const err = issuesOf({ ...inNodeEnv(prod, NODE_ENV), GOOGLE_SHEETS_TOKEN_KEYS: `v1:${SHEETS_KEY_1},v4:${shared}` });
          expect(err.issues, `${role} ${NODE_ENV} ${other}`).toEqual([
            { variable: 'GOOGLE_SHEETS_TOKEN_KEYS', reason: `dùng chung khóa với ${other}` },
          ]);
          expect(err.message).not.toContain(shared);
        }
      }
    }
  });

  it('AUTH_COOKIE_DOMAIN đặt thì phải là miền cha của host API_PUBLIC_URL và WEB_ORIGIN, ở mọi môi trường', () => {
    for (const NODE_ENV of ['development', 'test', 'production']) {
      for (const domain of ['khac.vn', 'api.tickee.vn', 'ckee.vn', 'tickee.vn.khac.vn']) {
        const err = issuesOf({ ...inNodeEnv(apiProdEnv, NODE_ENV), AUTH_COOKIE_DOMAIN: domain });
        expect(err.issues, `${NODE_ENV} ${domain}`).toEqual([{ variable: 'AUTH_COOKIE_DOMAIN', reason: COOKIE_REASON }]);
        expect(err.message).not.toContain(domain);
      }
      // Không phân biệt hoa thường, bỏ dấu `.` đầu; giá trị giữ nguyên như đã đặt.
      for (const domain of ['tickee.vn', '.Tickee.VN', 'TICKEE.vn']) {
        expect(loadConfig({ ...inNodeEnv(apiProdEnv, NODE_ENV), AUTH_COOKIE_DOMAIN: domain }), `${NODE_ENV} ${domain}`).toMatchObject({
          AUTH_COOKIE_DOMAIN: domain,
        });
      }
    }
  });

  it('production, hai host khác nhau mà không đặt AUTH_COOKIE_DOMAIN → "thiếu"; cùng host thì không cần; development/test không bắt buộc', () => {
    for (const value of [undefined, '']) {
      expect(issuesOf({ ...apiProdEnv, AUTH_COOKIE_DOMAIN: value }).issues).toEqual([
        { variable: 'AUTH_COOKIE_DOMAIN', reason: 'thiếu' },
      ]);
    }
    // Cookie không tách theo cổng: cùng host là đủ.
    for (const API_PUBLIC_URL of ['https://tickee.vn', 'https://tickee.vn:8443']) {
      expect(loadConfig({ ...apiProdEnv, AUTH_COOKIE_DOMAIN: undefined, API_PUBLIC_URL }), API_PUBLIC_URL).not.toHaveProperty(
        'AUTH_COOKIE_DOMAIN',
      );
    }
    for (const NODE_ENV of ['development', 'test']) {
      expect(loadConfig({ ...inNodeEnv(apiProdEnv, NODE_ENV), AUTH_COOKIE_DOMAIN: undefined }), NODE_ENV).not.toHaveProperty(
        'AUTH_COOKIE_DOMAIN',
      );
    }
  });

  it('luật cookie bỏ qua khi origin nó dùng đã lỗi: chỉ báo https ở origin đó', () => {
    for (const [origin, value] of [
      ['WEB_ORIGIN', 'http://khac.vn'],
      ['API_PUBLIC_URL', 'http://api.khac.vn'],
    ] as const) {
      for (const AUTH_COOKIE_DOMAIN of ['tickee.vn', undefined]) {
        expect(issuesOf({ ...apiProdEnv, AUTH_COOKIE_DOMAIN, [origin]: value }).issues, `${origin} ${String(AUTH_COOKIE_DOMAIN)}`).toEqual([
          { variable: origin, reason: HTTPS_REASON },
        ]);
      }
    }
  });

  it('nhiều lỗi ở production → một ConfigError nêu đủ, mỗi biến một issue, không in giá trị', () => {
    const err = issuesOf({
      ...apiProdEnv,
      API_PUBLIC_URL: 'http://api.tickee.vn',
      BETTER_AUTH_SECRET: ENV_EXAMPLE_SECRETS.BETTER_AUTH_SECRET,
      DATABASE_URL: undefined,
    });
    expect(err.issues).toEqual([
      { variable: 'DATABASE_URL', reason: 'thiếu' },
      { variable: 'API_PUBLIC_URL', reason: HTTPS_REASON },
      { variable: 'BETTER_AUTH_SECRET', reason: EXAMPLE_REASON },
    ]);
    expect(err.message).not.toContain('http://api.tickee.vn');
    expect(err.message).not.toContain(ENV_EXAMPLE_SECRETS.BETTER_AUTH_SECRET);
  });

  it('.env.example (NODE_ENV=development): api, worker, migrate khởi động như trước', () => {
    expect(envExample.NODE_ENV).toBe('development');
    expect(loadConfig(envExample)).toMatchObject({ APP_ROLE: 'api', NODE_ENV: 'development' });
    expect(loadConfig({ ...envExample, APP_ROLE: 'worker' })).toMatchObject({ APP_ROLE: 'worker' });
    expect(loadConfig({ ...envExample, APP_ROLE: 'migrate' })).toMatchObject({ APP_ROLE: 'migrate' });
  });

  it('.env.example: giá trị mẫu trong file của từng biến bị từ chối ở production (sửa file mà quên sửa code thì đỏ)', () => {
    for (const variable of [...Object.keys(ENV_EXAMPLE_SECRETS), ...Object.keys(ENV_EXAMPLE_KEYS)]) {
      const value = envExample[variable];
      expect(value, `${variable} có trong .env.example`).toBeTruthy();
      let checked = 0;
      for (const [role, prod, shape] of prodRoles) {
        if (!(variable in shape)) continue;
        checked += 1;
        expect(issuesOf({ ...prod, [variable]: value }).issues, `${role} ${variable}`).toEqual([
          { variable, reason: EXAMPLE_REASON },
        ]);
      }
      expect(checked, variable).toBeGreaterThan(0);
    }
    // Từng khóa của danh sách mẫu, đứng riêng, cũng bị từ chối: thêm `v2:<khóa mới>` vào file mà quên code thì đỏ.
    for (const variable of Object.keys(ENV_EXAMPLE_KEYS)) {
      const entries = (envExample[variable] ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '');
      expect(entries.length, variable).toBeGreaterThan(0);
      for (const entry of entries) {
        for (const [role, prod] of prodRoles) {
          expect(issuesOf({ ...prod, [variable]: entry }).issues, `${role} ${variable}`).toEqual([
            { variable, reason: EXAMPLE_REASON },
          ]);
        }
      }
    }
  });

  it('env của image (NODE_ENV=production) với giá trị y .env.example → api, worker không khởi động, nêu đủ biến vi phạm, không in giá trị', () => {
    const expected = {
      api: [
        'ADMIN_ALLOWED_CIDRS',
        'API_PUBLIC_URL',
        'BETTER_AUTH_SECRET',
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'GOOGLE_SHEETS_CLIENT_ID',
        'GOOGLE_SHEETS_CLIENT_SECRET',
        'GOOGLE_SHEETS_TOKEN_KEYS',
        'S3_ACCESS_KEY_ID',
        'S3_ENDPOINT',
        'S3_PUBLIC_BASE_URL',
        'S3_SECRET_ACCESS_KEY',
        'TICKET_QR_KEYS',
        'TINGEE_BASE_URL',
        'TINGEE_CREDENTIAL_KEYS',
        'WEB_ORIGIN',
      ],
      // E4-3: `.env.example` để trống người nhận cảnh báo và bật Đối soát bù (hợp đồng tạm).
      worker: [
        'GOOGLE_SHEETS_CLIENT_ID',
        'GOOGLE_SHEETS_CLIENT_SECRET',
        'GOOGLE_SHEETS_TOKEN_KEYS',
        'OPS_ALERT_EMAILS',
        'REVALIDATE_SECRET',
        'TICKET_QR_KEYS',
        'TINGEE_BASE_URL',
        'TINGEE_CREDENTIAL_KEYS',
        'TINGEE_ORDER_STATUS_QUERY',
        'WEB_ORIGIN',
      ],
    };
    for (const [role, variables] of Object.entries(expected)) {
      const env: Record<string, string | undefined> = { ...envExample, APP_ROLE: role, NODE_ENV: 'production' };
      const err = issuesOf(env);
      expect(err.issues.map((i) => i.variable).sort(), role).toEqual(variables);
      for (const { variable } of err.issues) {
        const value = env[variable];
        if (value) expect(err.message, `${role} ${variable}`).not.toContain(value);
      }
    }
  });

  it('isCookieParent và sharesKey (hàm thuần dùng chung với schema)', () => {
    expect(isCookieParent('.Tickee.VN', 'https://API.tickee.vn')).toBe(true);
    expect(isCookieParent('tickee.vn', 'https://tickee.vn:8443')).toBe(true);
    expect(isCookieParent('tickee.vn', 'https://xtickee.vn')).toBe(false);
    expect(isCookieParent('tickee.vn', 'khong-phai-url')).toBe(false);
    expect(sharesKey(`v1:${KEY_1}`, `v9:${QR_KEY_1},v2:${KEY_1}`)).toBe(true);
    expect(sharesKey(`v1:${KEY_1},v2:${KEY_2}`, `v1:${QR_KEY_1},v2:${QR_KEY_2}`)).toBe(false);
  });
});

const ORDER_QUERY_REASON = 'phải tắt khi NODE_ENV=production cho tới khi API tra đơn của Tingee có hợp đồng thật';
const REAL_TINGEE_REASON =
  'phải trỏ Tingee fake trên host local khi NODE_ENV=development; staging/production phải đặt NODE_ENV=production; cố ý gọi Tingee thật từ máy dev thì đặt TINGEE_ALLOW_REAL_IN_DEVELOPMENT=true';

describe('luật cấu hình cảnh báo vận hành, Đối soát bù và Tingee ở local (E4-3)', () => {
  const roleEnvs = [
    ['api', apiEnv],
    ['worker', workerEnv],
  ] as const;

  it('worker production thiếu hoặc rỗng OPS_ALERT_EMAILS → "thiếu", báo cùng lượt với biến khác; api production không đọc biến này', () => {
    for (const value of [undefined, '']) {
      const err = issuesOf({ ...workerProdEnv, OPS_ALERT_EMAILS: value });
      expect(err.issues, String(value)).toEqual([{ variable: 'OPS_ALERT_EMAILS', reason: 'thiếu' }]);
      expect(err.message).toContain('OPS_ALERT_EMAILS (thiếu)');
    }
    expect(loadConfig(workerProdEnv)).toMatchObject({ NODE_ENV: 'production', OPS_ALERT_EMAILS: ['ops@tickee.vn'] });
    // Sai dạng: chỉ một issue định dạng, không thêm "thiếu".
    expect(issuesOf({ ...workerProdEnv, OPS_ALERT_EMAILS: ' , ' }).issues).toEqual([
      { variable: 'OPS_ALERT_EMAILS', reason: 'phải là danh sách email cách nhau bằng dấu phẩy' },
    ]);
    const both = issuesOf({ ...workerProdEnv, OPS_ALERT_EMAILS: undefined, DATABASE_URL: undefined });
    expect(both.issues).toEqual(
      expect.arrayContaining([
        { variable: 'DATABASE_URL', reason: 'thiếu' },
        { variable: 'OPS_ALERT_EMAILS', reason: 'thiếu' },
      ]),
    );
    expect(both.issues).toHaveLength(2);
    // Vai api chỉ raise, không gửi email cảnh báo.
    expect(loadConfig(apiProdEnv)).not.toHaveProperty('OPS_ALERT_EMAILS');
  });

  it('worker production bật TINGEE_ORDER_STATUS_QUERY → lỗi "phải tắt khi NODE_ENV=production", không in giá trị; tắt thì khởi động', () => {
    for (const value of ['true', '1', 'yes', 'on']) {
      const err = issuesOf({ ...workerProdEnv, TINGEE_ORDER_STATUS_QUERY: value });
      expect(err.issues, value).toEqual([{ variable: 'TINGEE_ORDER_STATUS_QUERY', reason: ORDER_QUERY_REASON }]);
      expect(err.issues[0]?.reason).toContain('phải tắt khi NODE_ENV=production');
      // `1`, `on` là chuỗi con của chữ thường gặp ("production"), nên chỉ kiểm hai giá trị dài.
      if (value === 'true' || value === 'yes') expect(err.message).not.toContain(value);
    }
    for (const value of [undefined, '', 'false', '0']) {
      expect(loadConfig({ ...workerProdEnv, TINGEE_ORDER_STATUS_QUERY: value }), String(value)).toMatchObject({
        TINGEE_ORDER_STATUS_QUERY: false,
      });
    }
    // Giá trị sai dạng: một issue định dạng, luật production không báo thêm.
    const invalid = issuesOf({ ...workerProdEnv, TINGEE_ORDER_STATUS_QUERY: SECRET });
    expect(invalid.issues.map((i) => i.variable)).toEqual(['TINGEE_ORDER_STATUS_QUERY']);
    expect(invalid.issues[0]?.reason).not.toBe(ORDER_QUERY_REASON);
    expect(invalid.message).not.toContain(SECRET);
    // test/development (Tingee fake) vẫn bật được; vai api không đọc cờ.
    for (const NODE_ENV of ['test', 'development']) {
      expect(loadConfig({ ...inNodeEnv(workerProdEnv, NODE_ENV), TINGEE_ORDER_STATUS_QUERY: 'true' }), NODE_ENV).toMatchObject({
        TINGEE_ORDER_STATUS_QUERY: true,
      });
    }
    expect(loadConfig({ ...apiProdEnv, TINGEE_ORDER_STATUS_QUERY: 'true' })).not.toHaveProperty('TINGEE_ORDER_STATUS_QUERY');
  });

  it.each(roleEnvs)(
    'vai %s, development, TINGEE_BASE_URL host không phải local → lỗi nêu cờ TINGEE_ALLOW_REAL_IN_DEVELOPMENT, không in URL',
    (_role, env) => {
      for (const url of [TINGEE_UAT_URL, 'https://open-api.tingee.vn', 'http://192.168.1.20:4010', 'http://localhost.tingee.vn']) {
        const err = issuesOf({ ...env, NODE_ENV: 'development', TINGEE_BASE_URL: url });
        expect(err.issues, url).toEqual([{ variable: 'TINGEE_BASE_URL', reason: REAL_TINGEE_REASON }]);
        expect(err.issues[0]?.reason).toContain('TINGEE_ALLOW_REAL_IN_DEVELOPMENT');
        expect(err.message).not.toContain(url);
        expect(err.message).not.toContain(new URL(url).host);
      }
    },
  );

  it.each(roleEnvs)('vai %s, development + TINGEE_ALLOW_REAL_IN_DEVELOPMENT=true → khởi động với Tingee thật; cờ tắt thì vẫn chặn', (_role, env) => {
    const dev = { ...env, NODE_ENV: 'development', TINGEE_BASE_URL: TINGEE_UAT_URL };
    for (const flag of ['true', '1']) {
      expect(loadConfig({ ...dev, TINGEE_ALLOW_REAL_IN_DEVELOPMENT: flag }), flag).toMatchObject({
        NODE_ENV: 'development',
        TINGEE_BASE_URL: TINGEE_UAT_URL,
        TINGEE_ALLOW_REAL_IN_DEVELOPMENT: true,
      });
    }
    for (const flag of [undefined, '', 'false', '0']) {
      expect(issuesOf({ ...dev, TINGEE_ALLOW_REAL_IN_DEVELOPMENT: flag }).issues, String(flag)).toEqual([
        { variable: 'TINGEE_BASE_URL', reason: REAL_TINGEE_REASON },
      ]);
    }
    // Cờ sai dạng: chỉ báo ở cờ, không in giá trị; luật Tingee thật bỏ qua (không báo hai lần).
    const invalid = issuesOf({ ...dev, TINGEE_ALLOW_REAL_IN_DEVELOPMENT: SECRET });
    expect(invalid.issues.map((i) => i.variable)).toEqual(['TINGEE_ALLOW_REAL_IN_DEVELOPMENT']);
    expect(invalid.message).not.toContain(SECRET);
  });

  it('development với Tingee fake trên host local (.env.example nguyên trạng) → api, worker khởi động như trước, cờ mặc định tắt', () => {
    expect(envExample.TINGEE_BASE_URL).toBe(TINGEE_FAKE_URL);
    // `.env.example` không bật cờ opt-in.
    expect(envExample.TINGEE_ALLOW_REAL_IN_DEVELOPMENT).toBeUndefined();
    for (const APP_ROLE of ['api', 'worker']) {
      expect(loadConfig({ ...envExample, APP_ROLE }), APP_ROLE).toMatchObject({
        NODE_ENV: 'development',
        TINGEE_BASE_URL: TINGEE_FAKE_URL,
        TINGEE_ALLOW_REAL_IN_DEVELOPMENT: false,
      });
    }
    for (const url of ['http://127.0.0.1:4010', 'http://127.8.9.10:4010', 'http://[::1]:4010', 'https://tingee.localhost']) {
      for (const [role, env] of roleEnvs) {
        expect(() => loadConfig({ ...env, NODE_ENV: 'development', TINGEE_BASE_URL: url }), `${role} ${url}`).not.toThrow();
      }
    }
  });

  it('test với URL Tingee thật → khởi động như trước (luật chỉ áp development)', () => {
    for (const [role, env] of roleEnvs) {
      expect(env.NODE_ENV).toBe('test');
      expect(loadConfig({ ...env, TINGEE_BASE_URL: TINGEE_UAT_URL }), role).toMatchObject({
        NODE_ENV: 'test',
        TINGEE_BASE_URL: TINGEE_UAT_URL,
        TINGEE_ALLOW_REAL_IN_DEVELOPMENT: false,
      });
    }
  });

  it('production đặt cờ opt-in → cờ bị bỏ qua: https host thật khởi động, http (kể cả localhost) vẫn bị luật https từ chối', () => {
    for (const [role, prod] of prodRoles) {
      expect(loadConfig({ ...prod, TINGEE_ALLOW_REAL_IN_DEVELOPMENT: 'true' }), role).toMatchObject({ NODE_ENV: 'production' });
      for (const url of ['http://uat-open-api.tingee.vn', TINGEE_FAKE_URL]) {
        const err = issuesOf({ ...prod, TINGEE_ALLOW_REAL_IN_DEVELOPMENT: 'true', TINGEE_BASE_URL: url });
        expect(err.issues, `${role} ${url}`).toEqual([{ variable: 'TINGEE_BASE_URL', reason: HTTPS_REASON }]);
      }
    }
  });

  it('nhiều vi phạm → một ConfigError nêu đủ, mỗi biến một issue', () => {
    const prod = issuesOf({
      ...workerProdEnv,
      OPS_ALERT_EMAILS: undefined,
      TINGEE_ORDER_STATUS_QUERY: 'true',
      WEB_ORIGIN: 'http://tickee.vn',
    });
    expect(prod.issues).toEqual([
      { variable: 'OPS_ALERT_EMAILS', reason: 'thiếu' },
      { variable: 'TINGEE_ORDER_STATUS_QUERY', reason: ORDER_QUERY_REASON },
      { variable: 'WEB_ORIGIN', reason: HTTPS_REASON },
    ]);
    const dev = issuesOf({ ...apiEnv, NODE_ENV: 'development', DATABASE_URL: undefined });
    expect(dev.issues).toEqual([
      { variable: 'DATABASE_URL', reason: 'thiếu' },
      { variable: 'TINGEE_BASE_URL', reason: REAL_TINGEE_REASON },
    ]);
  });

  it('isLocalUrl: URL có host local (isLocalHost); mọi host khác và chuỗi không phải URL → false', () => {
    for (const url of ['http://localhost:4010', 'http://127.0.0.1:4010', 'http://[::1]:4010', 'https://tingee.localhost']) {
      expect(isLocalUrl(url), url).toBe(true);
    }
    for (const url of [TINGEE_UAT_URL, 'http://192.168.1.20:4010', 'http://localhost.tingee.vn', 'khong-phai-url', '']) {
      expect(isLocalUrl(url), url).toBe(false);
    }
  });
});

describe('productionLookingOrigins — NODE_ENV khác production mà origin trông như môi trường thật (Story 4.7-f)', () => {
  const migrateEnv = { APP_ROLE: 'migrate', MIGRATION_DATABASE_URL: 'postgres://m:p@db/tickee' };

  it('development/test với API_PUBLIC_URL, WEB_ORIGIN là https trên host thật → nêu tên biến, không nêu giá trị', () => {
    for (const NODE_ENV of ['development', 'test']) {
      // `apiEnv`: https://api.tickee.vn, https://tickee.vn.
      const api = productionLookingOrigins(loadConfig(inNodeEnv(apiEnv, NODE_ENV)));
      expect(api, NODE_ENV).toEqual(['API_PUBLIC_URL', 'WEB_ORIGIN']);
      expect(api.join(' ')).not.toContain('tickee.vn');
      // Worker chỉ đọc WEB_ORIGIN.
      expect(productionLookingOrigins(loadConfig(inNodeEnv(workerEnv, NODE_ENV))), NODE_ENV).toEqual(['WEB_ORIGIN']);
    }
    expect(
      productionLookingOrigins(loadConfig({ ...inNodeEnv(apiEnv, 'development'), WEB_ORIGIN: 'http://localhost:3000' })),
    ).toEqual(['API_PUBLIC_URL']);
  });

  it('NODE_ENV=production → [] (luật production đã chạy)', () => {
    expect(productionLookingOrigins(loadConfig(apiProdEnv))).toEqual([]);
    expect(productionLookingOrigins(loadConfig(workerProdEnv))).toEqual([]);
  });

  it('origin local hoặc http → [], kể cả http trên host thật', () => {
    for (const origin of [
      'https://localhost:3001',
      'https://api.localhost',
      'https://127.0.0.1:3001',
      'https://127.8.9.10',
      'https://[::1]:3001',
      'http://api.tickee.vn',
      'http://localhost:3001',
    ]) {
      const config = loadConfig({ ...inNodeEnv(apiEnv, 'development'), API_PUBLIC_URL: origin, WEB_ORIGIN: origin });
      expect(productionLookingOrigins(config), origin).toEqual([]);
    }
  });

  it('.env.example (development, localhost) và vai migrate → []', () => {
    expect(productionLookingOrigins(loadConfig(envExample))).toEqual([]);
    expect(productionLookingOrigins(loadConfig({ ...envExample, APP_ROLE: 'worker' }))).toEqual([]);
    expect(productionLookingOrigins(loadConfig({ ...migrateEnv, NODE_ENV: 'development' }))).toEqual([]);
  });

  it('isLocalHost: localhost, *.localhost, 127.0.0.0/8, ::1; mọi host khác là host thật', () => {
    for (const host of ['localhost', 'LocalHost', 'api.localhost', '127.0.0.1', '127.255.0.9', '::1', '[::1]']) {
      expect(isLocalHost(host), host).toBe(true);
    }
    for (const host of ['tickee.vn', 'localhost.tickee.vn', 'mylocalhost', '128.0.0.1', '0.0.0.0', '[::2]', 'api.tickee.test']) {
      expect(isLocalHost(host), host).toBe(false);
    }
  });
});
