import { DrizzleQueryError } from 'drizzle-orm/errors';
import pg from 'pg';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { PII_KEYS } from '@tickee/contracts';
import {
  basePinoOptions,
  buildRedactPaths,
  dbErrorSummary,
  GENERIC_PII_KEYS,
  isDatabaseError,
  REDACTED,
} from '../src/platform/logging/index.js';
import { LogCapture } from './helpers.js';

describe('che PII trong log', () => {
  it('redact sinh từ danh sách PII của contracts; khóa chung chung chỉ che dưới `user`', () => {
    const paths = buildRedactPaths();
    for (const key of PII_KEYS) {
      if (GENERIC_PII_KEYS.has(key)) {
        expect(paths).not.toContain(key);
        expect(paths).not.toContain(`*.${key}`);
        expect(paths).toEqual(expect.arrayContaining([`user.${key}`, `*.user.${key}`, `*.*.user.${key}`]));
      } else {
        expect(paths).toEqual(expect.arrayContaining([key, `*.${key}`, `*.*.${key}`]));
      }
    }
    expect(PII_KEYS).toEqual(expect.arrayContaining(['email', 'phone', 'name', 'ipAddress', 'userAgent']));
    expect(GENERIC_PII_KEYS.has('name')).toBe(true);
  });

  it('email/SĐT bị che ở mọi độ sâu thường gặp', () => {
    const out = new LogCapture();
    const log = pino(basePinoOptions('info'), out);
    log.info(
      {
        email: 'a@example.com',
        phone: '0901234567',
        user: { email: 'b@example.com', phoneNumber: '0912345678' },
        req: { body: { phone_number: '0923456789' } },
        orderCode: 'TK8F3Q2AXM',
      },
      'mua vé',
    );
    const raw = out.text;
    for (const v of ['a@example.com', '0901234567', 'b@example.com', '0912345678', '0923456789']) {
      expect(raw).not.toContain(v);
    }
    expect(raw).toContain(REDACTED);
    expect(raw).toContain('TK8F3Q2AXM');
  });

  it('khóa PII không chung chung (ipAddress, userAgent, contactPhone) vẫn che theo khóa ở độ sâu 0–2', () => {
    const out = new LogCapture();
    const log = pino(basePinoOptions('info'), out);
    log.info({ ipAddress: '10.0.0.7', session: { userAgent: 'UA-bi-mat' }, a: { org: { contactPhone: '0934567890' } } });
    expect(out.lines[0]).toMatchObject({ ipAddress: REDACTED, session: { userAgent: REDACTED }, a: { org: { contactPhone: REDACTED } } });
  });

  it('IP và User-Agent của request bị che; method, url, requestId giữ nguyên', () => {
    const out = new LogCapture();
    const log = pino(basePinoOptions('info'), out);
    log.info(
      {
        requestId: 'req-ip-ua',
        req: {
          method: 'GET',
          url: '/v1/identity/me',
          remoteAddress: '203.0.113.9',
          remotePort: 51234,
          headers: {
            host: 'api.tickee.test',
            'user-agent': 'Mozilla/5.0 UA-rieng-1',
            'x-forwarded-for': '198.51.100.23, 10.0.0.1',
            'x-real-ip': '198.51.100.24',
            forwarded: 'for=198.51.100.25;proto=https',
            'cf-connecting-ip': '198.51.100.26',
            'true-client-ip': '198.51.100.27',
            'fly-client-ip': '198.51.100.28',
          },
        },
      },
      'request completed',
    );
    expect(out.lines[0]).toMatchObject({
      requestId: 'req-ip-ua',
      req: {
        method: 'GET',
        url: '/v1/identity/me',
        remoteAddress: REDACTED,
        headers: {
          host: 'api.tickee.test',
          'user-agent': REDACTED,
          'x-forwarded-for': REDACTED,
          'x-real-ip': REDACTED,
          forwarded: REDACTED,
          'cf-connecting-ip': REDACTED,
          'true-client-ip': REDACTED,
          'fly-client-ip': REDACTED,
        },
      },
    });
    const leaked = ['203.0.113.9', 'UA-rieng-1', ...[23, 24, 25, 26, 27, 28].map((n) => `198.51.100.${n}`)];
    for (const v of leaked) expect(out.text).not.toContain(v);
  });

  it('khóa `name` ở gốc và dưới đối tượng khác giữ nguyên; `user.name` bị che ở độ sâu 0–2', () => {
    const out = new LogCapture();
    const log = pino(basePinoOptions('info'), out);
    log.info(
      {
        name: 'invitation.send',
        job: { name: 'email.send' },
        organization: { name: 'BTC Rạp Tối' },
        user: { name: 'Nguyễn A' },
        actor: { user: { name: 'Trần B' } },
        a: { b: { user: { name: 'Lê C' } } },
      },
      'gửi lời mời',
    );
    expect(out.lines[0]).toMatchObject({
      name: 'invitation.send',
      job: { name: 'email.send' },
      organization: { name: 'BTC Rạp Tối' },
      user: { name: REDACTED },
      actor: { user: { name: REDACTED } },
      a: { b: { user: { name: REDACTED } } },
    });
    for (const v of ['Nguyễn A', 'Trần B', 'Lê C']) expect(out.text).not.toContain(v);
  });
});

describe('nhận diện lỗi DB', () => {
  const pgError = (code: string): pg.DatabaseError =>
    Object.assign(new pg.DatabaseError('duplicate key value a@vidu.vn', 0, 'error'), { code });

  it('DrizzleQueryError và pg.DatabaseError là lỗi DB, ở chính lỗi hay ở tầng `cause` bất kỳ', () => {
    const drizzle = new DrizzleQueryError('select 1', ['a@vidu.vn'], pgError('23505'));
    expect(isDatabaseError(drizzle)).toBe(true);
    expect(isDatabaseError(pgError('23505'))).toBe(true);
    expect(isDatabaseError(new Error('bọc', { cause: drizzle }))).toBe(true);
    expect(isDatabaseError(new Error('a', { cause: new Error('b', { cause: pgError('57P01') }) }))).toBe(true);
  });

  it('lỗi thường, giá trị không phải object và vòng `cause` không bị coi là lỗi DB', () => {
    expect(isDatabaseError(new Error('x'))).toBe(false);
    expect(isDatabaseError(Object.assign(new Error('x'), { code: '23505' }))).toBe(false);
    expect(isDatabaseError(new TypeError('y', { cause: new Error('z') }))).toBe(false);
    for (const v of [undefined, null, 'Failed query', 42]) expect(isDatabaseError(v)).toBe(false);
    const loop = new Error('vòng') as Error & { cause?: unknown };
    loop.cause = new Error('vòng 2', { cause: loop });
    expect(isDatabaseError(loop)).toBe(false);
  });

  it('chuỗi `cause` dài hơn giới hạn bị coi là lỗi DB (không kiểm hết được thì không log nguyên)', () => {
    let deep: unknown = new DrizzleQueryError('select 1', [], undefined);
    for (let i = 0; i < 50; i++) deep = new Error(`tầng ${i}`, { cause: deep });
    expect(isDatabaseError(deep)).toBe(true);
  });

  it('bản rút gọn chỉ có tên lớp và SQLSTATE (lấy từ lỗi hoặc `cause`)', () => {
    const cause = Object.assign(new Error('terminating connection a@vidu.vn'), { code: '57P01' });
    expect(dbErrorSummary(new DrizzleQueryError('select "email"', ['a@vidu.vn', 'tok'], cause))).toEqual({
      type: 'DrizzleQueryError',
      code: '57P01',
    });
    expect(dbErrorSummary(pgError('23505'))).toEqual({ type: 'DatabaseError', code: '23505' });
    expect(dbErrorSummary(new DrizzleQueryError('select 1', [], undefined))).toEqual({ type: 'DrizzleQueryError' });
    // SQLSTATE được ưu tiên hơn mã khác ở tầng ngoài; `code` không phải mã định danh thì bỏ.
    const wrapped = Object.assign(new Error('bọc'), { code: 'ERR_WRAPPED' });
    wrapped.cause = new DrizzleQueryError('select 1', [], pgError('40001'));
    expect(dbErrorSummary(wrapped)).toEqual({ type: 'Error', code: '40001' });
    const freeText = new DrizzleQueryError('select 1', [], Object.assign(new Error('x'), { code: 'a@vidu.vn tok' }));
    expect(dbErrorSummary(freeText)).toEqual({ type: 'DrizzleQueryError' });
  });
});
