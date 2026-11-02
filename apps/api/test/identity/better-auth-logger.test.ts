import { Logger } from '@nestjs/common';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logBetterAuth } from '../../src/modules/identity/better-auth-logger.js';

/** Lỗi DB khi Better Auth ghi session: params mang email, token session, IP, User-Agent và tên Google. */
const QUERY_MARKER = 'bi_mat_query_7c1e9a';
const CAUSE_MARKER = 'bi_mat_cause_4d2a6f';
const LEAK = {
  email: 'nguoi-dung@vidu.vn',
  token: 'tok_bi_mat_8f3q2axm',
  ip: '203.0.113.42',
  userAgent: 'Mozilla/5.0 UA-rieng-tu',
  googleName: 'Nguyễn Văn Bí Mật',
  query: `insert into "sessions" ("token", "ip_address", "user_agent") values ($1, $2, $3) -- ${QUERY_MARKER}`,
  causeMessage: `duplicate key value violates unique constraint "sessions_token_key" ${CAUSE_MARKER}`,
};
/** Dấu không chứa `"` (JSON.stringify thoát `"` thành `\"`, nên so chuỗi có `"` với JSON luôn "không chứa"). */
const LEAK_MARKERS = [LEAK.email, LEAK.token, LEAK.ip, LEAK.userAgent, LEAK.googleName, QUERY_MARKER, CAUSE_MARKER];
const drizzleError = (): DrizzleQueryError =>
  new DrizzleQueryError(
    LEAK.query,
    [LEAK.token, LEAK.ip, LEAK.userAgent, LEAK.email, LEAK.googleName],
    Object.assign(new pg.DatabaseError(LEAK.causeMessage, 0, 'error'), { code: '23505' }),
  );
const expectNoLeak = (calls: unknown[][]): void => {
  const raw = JSON.stringify(calls);
  for (const v of LEAK_MARKERS) expect(raw).not.toContain(v);
};

describe('logBetterAuth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('thông điệp là object lỗi (Better Auth gọi logger.error(e)) → không ném, lỗi vào meta, email bị che', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const err = Object.assign(new Error('trùng khóa a@vidu.vn'), { code: '23505' });
    expect(() => logBetterAuth('error', err)).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      { errors: [{ type: 'Error', code: '23505', message: 'trùng khóa [REDACTED]' }] },
      'Error: trùng khóa [REDACTED]',
    );
  });

  it('thông điệp rỗng/không phải chuỗi → chuỗi; tham số lỗi kèm theo được che email', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    logBetterAuth('warn', 'Invalid origin cho b@vidu.vn', new TypeError('lỗi c@vidu.vn'), { email: 'd@vidu.vn' });
    expect(warn).toHaveBeenCalledWith(
      { errors: [{ type: 'TypeError', code: undefined, message: 'lỗi [REDACTED]' }] },
      'Invalid origin cho [REDACTED]',
    );
    logBetterAuth('info', undefined);
    logBetterAuth('info', 42);
    expect(log).toHaveBeenNthCalledWith(1, {}, '');
    expect(log).toHaveBeenNthCalledWith(2, {}, '42');
  });

  it('lỗi DB làm thông điệp → msg là tên lớp lỗi, meta chỉ còn `{ type, code }`', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    logBetterAuth('error', drizzleError());
    expect(error).toHaveBeenCalledWith({ errors: [{ type: 'DrizzleQueryError', code: '23505' }] }, 'DrizzleQueryError');
    expectNoLeak(error.mock.calls);
  });

  it('lỗi DB làm tham số (`Failed to create user`, e) → giữ thông điệp, lỗi chỉ còn `{ type, code }`', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const wrapped = new Error(`bọc ${LEAK.email}`, { cause: drizzleError() });
    logBetterAuth('error', 'Failed to create user', drizzleError(), wrapped);
    expect(error).toHaveBeenCalledWith(
      {
        errors: [
          { type: 'DrizzleQueryError', code: '23505' },
          { type: 'Error', code: '23505' },
        ],
      },
      'Failed to create user',
    );
    expectNoLeak(error.mock.calls);
  });

  it('chuỗi chứa `params:` (message của DrizzleQueryError) → phần từ `params:` trở đi bị che, email vẫn bị che', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    logBetterAuth('error', `Failed query: select * from "users" where "email" = ${LEAK.email}\nparams: ${LEAK.email},${LEAK.token}`);
    logBetterAuth('error', 'Lỗi', new Error(`Failed query: select 1\nparams: ${LEAK.token},${LEAK.ip}`));
    expect(error).toHaveBeenNthCalledWith(
      1,
      {},
      'Failed query: select * from "users" where "email" = [REDACTED]\nparams: [REDACTED]',
    );
    expect(error).toHaveBeenNthCalledWith(
      2,
      { errors: [{ type: 'Error', code: undefined, message: 'Failed query: select 1\nparams: [REDACTED]' }] },
      'Lỗi',
    );
    expectNoLeak(error.mock.calls);
  });

  it('`params:` không theo dạng Drizzle (`\\nparams:`) giữ nguyên', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    logBetterAuth('warn', 'Invalid params: x');
    expect(warn).toHaveBeenCalledWith({}, 'Invalid params: x');
  });
});
