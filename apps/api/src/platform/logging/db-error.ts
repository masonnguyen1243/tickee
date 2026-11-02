import { DrizzleQueryError } from 'drizzle-orm/errors';
import pg from 'pg';

/** Số tầng `cause` tối đa được duyệt (chống vòng lặp và chuỗi lỗi quá dài). */
const MAX_CAUSE_DEPTH = 8;
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;
/** `code` chỉ được log khi là mã định danh (SQLSTATE, `ECONNREFUSED`…), không bao giờ là chuỗi tự do. */
const CODE_PATTERN = /^[0-9A-Za-z_]{1,64}$/;

export interface DbErrorSummary {
  /** Tên lớp của lỗi được log, cùng khóa `type` như serializer `err` chuẩn của pino. */
  type: string;
  /** SQLSTATE lấy từ lỗi hoặc một tầng `cause`. */
  code?: string;
}

/**
 * Chính lỗi rồi các tầng `cause`, dừng khi hết hoặc gặp lại một tầng đã đi qua. `truncated`: chuỗi còn tiếp nhưng bị
 * cắt ở `MAX_CAUSE_DEPTH`.
 */
function causeChain(err: unknown): { chain: object[]; truncated: boolean } {
  const chain: object[] = [];
  let current = err;
  while (typeof current === 'object' && current !== null && !chain.includes(current)) {
    if (chain.length > MAX_CAUSE_DEPTH) return { chain, truncated: true };
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return { chain, truncated: false };
}

const isDbErrorInstance = (e: object): boolean => e instanceof DrizzleQueryError || e instanceof pg.DatabaseError;

/**
 * Lỗi DB (`DrizzleQueryError` hoặc `pg.DatabaseError`, ở chính lỗi hay một tầng `cause`): message/query/params của nó
 * có thể chứa dữ liệu người dùng (email, token session), nên chỉ được log qua `dbErrorSummary`. Chuỗi `cause` dài quá
 * `MAX_CAUSE_DEPTH` cũng bị coi là lỗi DB (không kiểm hết được thì không log nguyên).
 */
export function isDatabaseError(err: unknown): boolean {
  const { chain, truncated } = causeChain(err);
  return truncated || chain.some(isDbErrorInstance);
}

/**
 * Bản rút gọn của lỗi DB để log: tên lớp và SQLSTATE, không bao giờ có câu SQL, params hay message.
 * `logger.error({ err: dbErrorSummary(e) }, …)` → `{ err: { type: 'DrizzleQueryError', code: '57P01' } }`.
 */
export function dbErrorSummary(err: unknown): DbErrorSummary {
  const ctor = typeof err === 'object' && err !== null ? (err as { constructor?: { name?: unknown } }).constructor : undefined;
  const type = typeof ctor?.name === 'string' && ctor.name !== '' ? ctor.name : typeof err;
  const codes = causeChain(err).chain
    .map((e) => (e as { code?: unknown }).code)
    .filter((c): c is string => typeof c === 'string' && CODE_PATTERN.test(c));
  const code = codes.find((c) => SQLSTATE_PATTERN.test(c)) ?? codes[0];
  return code ? { type, code } : { type };
}
