import { DEAD_LETTER_TEXT_MAX_LENGTH, type DeadLetterJob, type DeadLetterJobList } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import type { PlatformAdminReader } from '../access/index.js';
import type { Tx } from '../db/index.js';
import { REDACTED } from '../logging/index.js';
import { PGBOSS_SCHEMA } from './boss.js';

/*
 * Dead-letter của pg-boss cho Quản trị Tingee (Story 4.6-d, AD-12): đọc job đang nằm trong mọi queue `*.dead-letter` và
 * requeue từng job về queue gốc bằng `boss.redrive`. Đọc thẳng bảng `pgboss.job` (`tickee_app` có đủ DML trên schema
 * `pgboss`); không đăng ký worker nào cho queue dead-letter.
 */

/** Hậu tố tên queue dead-letter (mọi queue dead-letter của Tickee khai ở `JobQueue` đều theo quy ước này). */
export const DEAD_LETTER_SUFFIX = '.dead-letter';

const job = sql`${sql.identifier(PGBOSS_SCHEMA)}.job`;
const deadLetterName = `%${DEAD_LETTER_SUFFIX}`;

/** Địa chỉ email (phần tên, `@`, tên miền có ít nhất một dấu chấm), kể cả ký tự Unicode. */
const EMAIL_PATTERN = /[\p{L}\p{N}._%+'-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
/** Chuỗi từ 9 chữ số liền nhau trở lên (SĐT, số tài khoản, CCCD…). */
const LONG_NUMBER_PATTERN = /\d{9,}/g;

/** Thay chuỗi dạng email và chuỗi từ 9 chữ số trở lên bằng `[REDACTED]`. */
export function redactDeadLetterText(text: string): string {
  return text.replace(EMAIL_PATTERN, REDACTED).replace(LONG_NUMBER_PATTERN, REDACTED);
}

/** Cắt còn tối đa `max` đơn vị UTF-16, không để lại nửa cặp surrogate ở cuối. */
function truncate(text: string, max = DEAD_LETTER_TEXT_MAX_LENGTH): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** JSON bỏ mọi khóa `stack` (ở mọi độ sâu). */
const jsonWithoutStack = (value: unknown): string =>
  JSON.stringify(value, (key, inner: unknown) => (key === 'stack' ? undefined : inner)) ?? 'null';

/**
 * Phần đầu của lý do được đem che PII: biểu thức email chạy O(n²) trên chuỗi dài không có `@`, nên chỉ che một đoạn đủ
 * dài (che xong vẫn còn đủ `DEAD_LETTER_TEXT_MAX_LENGTH` ký tự để cắt), không bao giờ cả output.
 */
const REDACT_PREFIX_LENGTH = 4 * DEAD_LETTER_TEXT_MAX_LENGTH;

/**
 * Lý do lỗi từ output của job gốc (`source_output`): `message` nếu là chuỗi khác rỗng, không thì JSON của cả output (bỏ
 * `stack`). Lấy `REDACT_PREFIX_LENGTH` ký tự đầu, che email và chuỗi số dài (trước khi cắt, để số bị cắt dở không lọt
 * ra), rồi cắt còn `DEAD_LETTER_TEXT_MAX_LENGTH` ký tự. Không có output → `null`. Không bao giờ trả stack.
 */
export function deadLetterReason(output: unknown): string | null {
  if (output === null || output === undefined) return null;
  const message =
    typeof output === 'object' && !Array.isArray(output) ? (output as { message?: unknown }).message : undefined;
  const text = typeof message === 'string' && message !== '' ? message : jsonWithoutStack(output);
  return truncate(redactDeadLetterText(truncate(text, REDACT_PREFIX_LENGTH)));
}

/** JSON của payload, cắt còn `DEAD_LETTER_TEXT_MAX_LENGTH` ký tự. */
export const deadLetterPayload = (data: unknown): string => truncate(JSON.stringify(data ?? null));

interface DeadLetterRow extends Record<string, unknown> {
  id: string;
  queue: string;
  source_name: string | null;
  source_id: string | null;
  source_retry_count: number | null;
  created_at: string;
  source_output: unknown;
  data: unknown;
  total: number;
}

/**
 * Job `created` trong mọi queue `*.dead-letter`, mới vào dead-letter nhất trước (rồi id), tối đa `limit` job, kèm tổng
 * số job. Chỉ đọc qua `platformAdminScope` (có audit `platform_admin.read` trong cùng `tx`).
 */
export async function listDeadLetterJobs(reader: PlatformAdminReader, limit: number): Promise<DeadLetterJobList> {
  const { rows } = await reader.execute<DeadLetterRow>(sql`
    SELECT id::text AS id,
           name AS queue,
           source_name,
           source_id::text AS source_id,
           source_retry_count,
           to_char(created_on AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
           source_output,
           data,
           count(*) OVER ()::int AS total
      FROM ${job}
     WHERE state = 'created'
       AND name LIKE ${deadLetterName}
     ORDER BY created_on DESC, id DESC
     LIMIT ${limit}`);
  const items = rows.map(
    (row): DeadLetterJob => ({
      id: row.id,
      queue: row.queue,
      sourceQueue: row.source_name,
      sourceJobId: row.source_id,
      retryCount: row.source_retry_count,
      createdAt: row.created_at,
      reason: deadLetterReason(row.source_output),
      payload: deadLetterPayload(row.data),
    }),
  );
  return { items, total: rows[0]?.total ?? 0 };
}

/** Job dead-letter vừa được requeue: queue dead-letter và id (dạng chuẩn của Postgres) của dòng đã chuyển. */
export interface RequeuedDeadLetterJob {
  queue: string;
  id: string;
}

/**
 * Requeue một job dead-letter về queue gốc trong `tx` của người gọi (`id` đã kiểm là uuid). Khóa dòng `created` của job
 * trong một queue `*.dead-letter` (lần requeue đua nhau chờ nhau, bên sau thấy dòng đã mất), rồi `boss.redrive` trên chính
 * `tx` đó: pg-boss tạo job mới cùng payload ở queue gốc (lượt thử từ 0, cấu hình hiện tại của queue gốc) và xóa dòng
 * dead-letter. `tx` rollback thì cả hai không xảy ra. Trả `null` khi không có dòng như vậy (id của job thường, job đã
 * requeue hay đã bị xóa) hoặc pg-boss không chuyển được (không ghi queue gốc, queue gốc không còn, trùng job
 * singleton): người gọi rollback để mọi thay đổi dở dang của `redrive` cũng bỏ. Người gọi đã `boss.start()` trước.
 */
export async function requeueDeadLetterJob(boss: PgBoss, tx: Tx, id: string): Promise<RequeuedDeadLetterJob | null> {
  const { rows } = await tx.execute<{ id: string; queue: string }>(sql`
    SELECT id::text AS id, name AS queue
      FROM ${job}
     WHERE id = ${id}::uuid
       AND state = 'created'
       AND name LIKE ${deadLetterName}
       FOR UPDATE`);
  const row = rows[0];
  if (!row) return null;
  const moved = await boss.redrive(row.queue, { ids: [row.id], limit: 1, db: fromDrizzle(tx, sql) });
  return moved === 1 ? { queue: row.queue, id: row.id } : null;
}
