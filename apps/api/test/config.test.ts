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
  S3_ENDPOINT: 'https://s3.tickee.vn',
  S3_BUCKET: 'tickee-event-images',
  S3_ACCESS_KEY_ID: 'AKIA-tickee-api',
  S3_SECRET_ACCESS_KEY: `s3-${SECRET}`,
  S3_PUBLIC_BASE_URL: 'https://anh.tickee.vn',
};
const workerEnv = {
  APP_ROLE: 'worker',
  DATABASE_URL: apiEnv.DATABASE_URL,
  WEB_ORIGIN: apiEnv.WEB_ORIGIN,
  SMTP_URL: apiEnv.SMTP_URL,
  EMAIL_FROM: apiEnv.EMAIL_FROM,
  REVALIDATE_SECRET: `${SECRET}-${'r'.repeat(32)}`,
  TINGEE_BASE_URL: apiEnv.TINGEE_BASE_URL,
  TINGEE_CREDENTIAL_KEYS: apiEnv.TINGEE_CREDENTIAL_KEYS,
  TICKET_QR_KEYS: apiEnv.TICKET_QR_KEYS,
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

  it('cảnh báo vận hành (Story 4.6-b): mặc định cooldown 30 phút (api, worker), ngưỡng ùn 5 phút và không người nhận (worker)', () => {
    const api = loadConfig(apiEnv);
    expect(api).toMatchObject({ OPS_ALERT_COOLDOWN_MINUTES: 30 });
    // Vai api chỉ raise: không gửi email, không quét.
    expect(api).not.toHaveProperty('OPS_ALERT_EMAILS');
    expect(loadConfig({ ...apiEnv, OPS_ALERT_QUEUE_WAIT_MINUTES: '9' })).not.toHaveProperty('OPS_ALERT_QUEUE_WAIT_MINUTES');
    const worker = loadConfig(workerEnv);
    expect(worker).toMatchObject({ OPS_ALERT_COOLDOWN_MINUTES: 30, OPS_ALERT_QUEUE_WAIT_MINUTES: 5 });
    expect(worker).not.toHaveProperty('OPS_ALERT_EMAILS');
    expect(loadConfig({ ...workerEnv, OPS_ALERT_EMAILS: '' })).not.toHaveProperty('OPS_ALERT_EMAILS');
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
    // Key Tingee là của từng BTC (lưu mã hóa trong DB): env Tingee chỉ còn URL và khóa mã hóa.
    const tingeeKeys = Object.keys(loadConfig(apiEnv)).filter((k) => k.startsWith('TINGEE_'));
    expect(tingeeKeys.sort()).toEqual(['TINGEE_BASE_URL', 'TINGEE_CREDENTIAL_KEYS']);
    // Worker thêm cờ Đối soát bù (Story 4.1), không phải credential.
    const workerTingeeKeys = Object.keys(loadConfig(workerEnv)).filter((k) => k.startsWith('TINGEE_'));
    expect(workerTingeeKeys.sort()).toEqual(['TINGEE_BASE_URL', 'TINGEE_CREDENTIAL_KEYS', 'TINGEE_ORDER_STATUS_QUERY']);
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
