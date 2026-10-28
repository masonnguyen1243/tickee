import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/platform/config/index.js';

const SECRET = 's3cret-Gi4-tri';
const apiEnv = { APP_ROLE: 'api', DATABASE_URL: `postgresql://tickee_app:${SECRET}@db:5432/tickee` };

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
    expect(config).toMatchObject({ APP_ROLE: 'api', PORT: 3001, LOG_LEVEL: 'info', NODE_ENV: 'development' });
  });

  it('vai migrate chỉ cần MIGRATION_DATABASE_URL, không cần DATABASE_URL', () => {
    const config = loadConfig({ APP_ROLE: 'migrate', MIGRATION_DATABASE_URL: 'postgres://m:p@db/tickee' });
    expect(config.APP_ROLE).toBe('migrate');
  });

  it('biến tùy chọn đặt rỗng → dùng mặc định; biến bắt buộc rỗng → "thiếu"', () => {
    const config = loadConfig({ ...apiEnv, PORT: '', LOG_LEVEL: '', NODE_ENV: '' });
    expect(config).toMatchObject({ PORT: 3001, LOG_LEVEL: 'info', NODE_ENV: 'development' });
    const err = issuesOf({ APP_ROLE: 'api', DATABASE_URL: '' });
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

  it('thiếu MIGRATION_DATABASE_URL ở vai migrate', () => {
    const err = issuesOf({ APP_ROLE: 'migrate', DATABASE_URL: apiEnv.DATABASE_URL });
    expect(err.issues).toEqual([{ variable: 'MIGRATION_DATABASE_URL', reason: 'thiếu' }]);
  });

  it('giá trị sai không bao giờ lọt vào thông báo lỗi', () => {
    const err = issuesOf({
      APP_ROLE: 'api',
      DATABASE_URL: `mysql://root:${SECRET}@db/x`,
      PORT: `${SECRET}`,
      LOG_LEVEL: SECRET,
    });
    expect(err.issues.map((i) => i.variable).sort()).toEqual(['DATABASE_URL', 'LOG_LEVEL', 'PORT']);
    expect(err.message).not.toContain(SECRET);
    expect(JSON.stringify(err.issues)).not.toContain(SECRET);
  });
});
