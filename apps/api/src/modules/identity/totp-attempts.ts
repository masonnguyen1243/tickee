import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  TOTP_LOCK_MS,
  TOTP_MAX_FAILURES,
  type TotpInvalidDetails,
  type TotpLockedDetails,
} from '@tickee/contracts';
import { eq, sql } from 'drizzle-orm';
import { audit } from '../../platform/audit/index.js';
import { DATABASE, type Database, type Tx } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { totpVerifyFailures } from './schema.js';

export function totpLocked(retryAfterMs: number): AppError {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  const details: TotpLockedDetails = { retryAfterSeconds };
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return new AppError(ErrorCode.TOTP_LOCKED, `Bạn đã nhập sai quá nhiều lần. Vui lòng thử lại sau ${minutes} phút.`, {
    details,
  });
}

function totpInvalid(remainingAttempts: number): AppError {
  const details: TotpInvalidDetails = { remainingAttempts };
  return new AppError(ErrorCode.TOTP_INVALID, `Mã chưa đúng, còn ${remainingAttempts} lần.`, { details });
}

/** Khóa advisory theo user: mọi lần đọc-sửa bộ đếm của một user chạy tuần tự. */
const lockUser = (tx: Tx, userId: string) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`totp-verify:${userId}`}, 0))`);

const dbNow = async (tx: Tx): Promise<number> => {
  const rows = await tx.execute<{ now: string | Date }>(sql`SELECT now() AS now`);
  return new Date(rows.rows[0]!.now).getTime();
};

/**
 * Bộ đếm xác minh TOTP sai liên tiếp theo user (NFR-6, AD-26), trong Postgres: TOTP và mã khôi phục, ở cả xác nhận
 * đăng ký lẫn step-up, dùng chung một bộ đếm. Sai `TOTP_MAX_FAILURES` lần liên tiếp → khóa `TOTP_LOCK_MS`; đang khóa
 * thì mọi lần thử bị từ chối, kể cả mã đúng. Đúng thì đặt lại về 0.
 *
 * Mỗi lần thử được tính TRƯỚC khi xác minh (`begin`), để request song song không đoán quá ngưỡng; xác minh lỗi
 * hệ thống thì trả lại lượt (`restore`).
 */
@Injectable()
export class TotpAttemptLimiter {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Giữ một lượt thử. Đang khóa (hoặc các lượt đang chạy đã dùng hết ngưỡng) → `TOTP_LOCKED`. */
  async begin(userId: string): Promise<void> {
    const locked = await this.db.transaction(async (tx) => {
      await lockUser(tx, userId);
      const now = await dbNow(tx);
      const [row] = await tx.select().from(totpVerifyFailures).where(eq(totpVerifyFailures.userId, userId));
      const lockedUntil = row?.lockedUntil?.getTime();
      if (lockedUntil !== undefined && lockedUntil > now) return totpLocked(lockedUntil - now);
      // Khóa đã hết hạn thì đếm lại từ đầu.
      const count = row && lockedUntil === undefined ? row.failedCount : 0;
      if (count >= TOTP_MAX_FAILURES) return this.lock(tx, userId);
      await tx
        .insert(totpVerifyFailures)
        .values({ userId, failedCount: count + 1, lockedUntil: null })
        .onConflictDoUpdate({
          target: totpVerifyFailures.userId,
          set: { failedCount: count + 1, lockedUntil: null, updatedAt: sql`now()` },
        });
      return null;
    });
    if (locked) throw locked;
  }

  /** Trả lại lượt đã giữ (xác minh không chạy được vì lỗi hệ thống hay chưa bắt đầu đăng ký). */
  async restore(userId: string): Promise<void> {
    await this.db.orm
      .update(totpVerifyFailures)
      .set({ failedCount: sql`greatest(${totpVerifyFailures.failedCount} - 1, 0)`, updatedAt: sql`now()` })
      .where(eq(totpVerifyFailures.userId, userId));
  }

  /**
   * Lượt đã giữ là mã sai. Đủ ngưỡng → khóa, ghi audit `totp.locked`, trả `TOTP_LOCKED`; chưa đủ → `TOTP_INVALID`
   * kèm số lần còn lại.
   */
  async fail(userId: string): Promise<AppError> {
    return this.db.transaction(async (tx) => {
      await lockUser(tx, userId);
      const now = await dbNow(tx);
      const [row] = await tx.select().from(totpVerifyFailures).where(eq(totpVerifyFailures.userId, userId));
      const lockedUntil = row?.lockedUntil?.getTime();
      if (lockedUntil !== undefined && lockedUntil > now) return totpLocked(lockedUntil - now);
      const count = row?.failedCount ?? 1;
      if (count >= TOTP_MAX_FAILURES) return this.lock(tx, userId);
      return totpInvalid(TOTP_MAX_FAILURES - count);
    });
  }

  /** Xác minh đúng: đặt lại bộ đếm (trong cùng transaction với thay đổi đi kèm). */
  async succeed(tx: Tx, userId: string): Promise<void> {
    await tx
      .update(totpVerifyFailures)
      .set({ failedCount: 0, lockedUntil: null, updatedAt: sql`now()` })
      .where(eq(totpVerifyFailures.userId, userId));
  }

  private async lock(tx: Tx, userId: string): Promise<AppError> {
    await tx
      .insert(totpVerifyFailures)
      .values({ userId, failedCount: TOTP_MAX_FAILURES, lockedUntil: sql`now() + make_interval(secs => ${TOTP_LOCK_MS / 1000})` })
      .onConflictDoUpdate({
        target: totpVerifyFailures.userId,
        set: {
          failedCount: TOTP_MAX_FAILURES,
          lockedUntil: sql`now() + make_interval(secs => ${TOTP_LOCK_MS / 1000})`,
          updatedAt: sql`now()`,
        },
      });
    await audit.record(tx, {
      actorUserId: userId,
      organizationId: null,
      action: 'totp.locked',
      target: { type: 'user', id: userId },
    });
    return totpLocked(TOTP_LOCK_MS);
  }
}
