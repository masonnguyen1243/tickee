import { ErrorCode } from '@tickee/contracts';
import type { z } from 'zod';
import { AppError } from './app-error.js';

/**
 * Kiểm body/query bằng schema Zod của `@tickee/contracts`. Sai → 400 `VALIDATION_FAILED`,
 * `details.issues` chỉ có đường dẫn trường và mã lỗi (không lặp lại giá trị người dùng gửi).
 */
export function parseRequest<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new AppError(ErrorCode.VALIDATION_FAILED, 'Yêu cầu không hợp lệ.', {
    details: { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })) },
  });
}
