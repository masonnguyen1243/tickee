import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logBetterAuth } from '../../src/modules/identity/auth.js';

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
});
