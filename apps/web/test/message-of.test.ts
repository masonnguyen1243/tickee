import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api/errors';
import { GENERIC_ERROR, messageOf } from '@/lib/api/message-of';

describe('messageOf', () => {
  it('ApiError → lời của api', () => {
    expect(messageOf(new ApiError('NOT_FOUND', 'Không tìm thấy Sự kiện.', null, 404))).toBe('Không tìm thấy Sự kiện.');
  });

  it('Error thường → câu chung, không lộ lời lập trình', () => {
    expect(messageOf(new Error('Cannot read properties of undefined'))).toBe(GENERIC_ERROR);
  });

  it('undefined, null, chuỗi → câu chung', () => {
    expect(messageOf(undefined)).toBe(GENERIC_ERROR);
    expect(messageOf(null)).toBe(GENERIC_ERROR);
    expect(messageOf('lỗi')).toBe(GENERIC_ERROR);
  });

  it('câu chung giữ nguyên chữ', () => {
    expect(GENERIC_ERROR).toBe('Đã có lỗi xảy ra. Vui lòng thử lại.');
  });
});
