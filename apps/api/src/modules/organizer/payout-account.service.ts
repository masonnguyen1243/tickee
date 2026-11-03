import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ErrorCode,
  isSupportedPayoutBank,
  PayoutAccountStatus,
  PayoutAccountType,
  LinkPayoutAccountRequest,
  type PayoutAccount,
  type PayoutAccountOverview,
} from '@tickee/contracts';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import pg from 'pg';
import { orgScope, type AccessContext } from '../../platform/access/index.js';
import { audit } from '../../platform/audit/index.js';
import { DATABASE, type Database, type DbExecutor, type Tx } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { dbErrorSummary } from '../../platform/logging/index.js';
import { TINGEE_CLIENT, tingeeError, type LinkedVa, type TingeeClient } from '../tingee/index.js';
import { organizations, payoutAccounts } from './schema.js';

/*
 * Liên kết tài khoản nhận tiền (FR-5, AD-5, AD-6, Story 2.6). Tingee luôn được gọi NGOÀI transaction DB; mỗi lần ghi
 * trạng thái là một transaction riêng: (1) chèn dòng `linking` + audit → (2) gọi Tingee → (3) compare-and-set sang
 * `linked` / `awaiting_otp` / `failed`. Unique index một phần trên `linked` chặn đua giữa hai tab.
 */

const pa = payoutAccounts;

/** Dòng `linking` cũ hơn chừng này (api dừng giữa lúc gọi Tingee) được coi là `failed`. */
export const STALE_LINKING_MINUTES = 5;
/** Dòng `awaiting_otp` không đổi quá chừng này (Owner bỏ dở bước OTP) được coi là `failed` (`BANK_OTP_EXPIRED`). */
export const STALE_AWAITING_OTP_MINUTES = 15;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINKED_KEY = 'payout_accounts_one_linked_per_organization_key';

const staleLinking = sql<boolean>`${pa.status} = ${PayoutAccountStatus.LINKING} AND ${pa.updatedAt} < now() - make_interval(mins => ${STALE_LINKING_MINUTES})`;
const staleAwaitingOtp = sql<boolean>`${pa.status} = ${PayoutAccountStatus.AWAITING_OTP} AND ${pa.updatedAt} < now() - make_interval(mins => ${STALE_AWAITING_OTP_MINUTES})`;
/** Dòng dang dở quá hạn (`linking` hoặc `awaiting_otp`): đọc như `failed`. */
const staleAttempt = sql<boolean>`((${staleLinking}) OR (${staleAwaitingOtp}))`;

const columns = {
  id: pa.id,
  status: pa.status,
  bankBin: pa.bankBin,
  accountType: pa.accountType,
  accountLast4: pa.accountLast4,
  accountName: pa.accountName,
  vaAccountNumber: pa.vaAccountNumber,
  failureCode: pa.failureCode,
  confirmId: pa.confirmId,
  createdAt: pa.createdAt,
  linkedAt: pa.linkedAt,
  stale: staleAttempt,
};
type Row = {
  id: string;
  status: PayoutAccountStatus;
  bankBin: string;
  accountType: PayoutAccountType;
  accountLast4: string;
  accountName: string;
  vaAccountNumber: string | null;
  failureCode: string | null;
  confirmId: string | null;
  createdAt: Date;
  linkedAt: Date | null;
  stale: boolean;
};

function toDto(row: Row): PayoutAccount {
  const stale = row.stale && (row.status === PayoutAccountStatus.LINKING || row.status === PayoutAccountStatus.AWAITING_OTP);
  const staleCode =
    row.status === PayoutAccountStatus.AWAITING_OTP ? ErrorCode.BANK_OTP_EXPIRED : ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE;
  return {
    id: row.id,
    status: stale ? PayoutAccountStatus.FAILED : row.status,
    bankBin: row.bankBin,
    accountType: row.accountType,
    accountLast4: row.accountLast4,
    accountName: row.accountName,
    vaAccountNumber: row.vaAccountNumber,
    failureCode: stale ? staleCode : row.failureCode,
    createdAt: row.createdAt.toISOString(),
    linkedAt: row.linkedAt?.toISOString() ?? null,
  };
}

const attemptNotFound = () => new AppError(ErrorCode.NOT_FOUND, 'Không tìm thấy lần liên kết này.');
const alreadyLinked = () =>
  new AppError(
    ErrorCode.PAYOUT_ACCOUNT_ALREADY_LINKED,
    'BTC đã có tài khoản nhận tiền. Đổi tài khoản nhận tiền là thao tác riêng.',
  );

/** Vi phạm unique index "một dòng `linked` mỗi BTC" (ở chính lỗi hoặc một tầng `cause` của Drizzle). */
function isLinkedConflict(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 8 && typeof current === 'object' && current !== null; depth++) {
    if (current instanceof pg.DatabaseError && current.code === '23505' && current.constraint === LINKED_KEY) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Lỗi Tingee mà lần thử chờ OTP vẫn còn dùng được (nhập lại OTP / thử lại xác nhận). */
const OTP_RETRYABLE: ReadonlySet<ErrorCode> = new Set([ErrorCode.BANK_OTP_INVALID, ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE]);

@Injectable()
export class PayoutAccountService {
  private readonly logger = new Logger('PayoutAccount');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(TINGEE_CLIENT) private readonly tingee: TingeeClient,
  ) {}

  /** Tài khoản đang dùng nếu đã liên kết; chưa thì lần thử gần nhất; chưa thử lần nào thì `null`. */
  async overview(ctx: AccessContext): Promise<PayoutAccountOverview> {
    const [row] = await this.db.orm
      .select(columns)
      .from(pa)
      .where(orgScope(ctx)(pa))
      .orderBy(sql`(${pa.status} = ${PayoutAccountStatus.LINKED}) DESC`, desc(pa.createdAt), desc(pa.id))
      .limit(1);
    return { current: row ? toDto(row) : null };
  }

  /**
   * Liên kết tài khoản cá nhân: kiểm ngân hàng (VietinBank bị chặn, không gọi Tingee), chèn lần thử `linking`, tạo
   * Merchant con nếu BTC chưa có, rồi `create-va`. Tingee trả `confirmId` → `awaiting_otp`; trả VA → `linked`.
   */
  async link(ctx: AccessContext, input: z.output<typeof LinkPayoutAccountRequest>): Promise<PayoutAccount> {
    if (!isSupportedPayoutBank(input.bankBin)) throw tingeeError(ErrorCode.BANK_NOT_SUPPORTED);

    // (1) Lần thử mới, trong transaction riêng.
    const { attemptId, merchantId: knownMerchantId, organizationName } = await this.db.transaction(async (tx) => {
      const [org] = await tx
        .select({ name: organizations.name, tingeeMerchantId: organizations.tingeeMerchantId })
        .from(organizations)
        .where(orgScope(ctx)({ organizationId: organizations.id }));
      if (!org) throw new AppError(ErrorCode.NOT_A_MEMBER, 'Bạn không phải thành viên của BTC này.');
      const [linked] = await tx
        .select({ id: pa.id })
        .from(pa)
        .where(and(orgScope(ctx)(pa), eq(pa.status, PayoutAccountStatus.LINKED)));
      if (linked) throw alreadyLinked();

      // Lần thử cũ còn chờ OTP (hoặc `linking` mồ côi) bị thay thế: banner "Đang liên kết" không còn treo.
      const superseded = await tx
        .update(pa)
        .set({ status: PayoutAccountStatus.FAILED, failureCode: ErrorCode.BANK_OTP_EXPIRED, confirmId: null })
        .where(and(orgScope(ctx)(pa), or(eq(pa.status, PayoutAccountStatus.AWAITING_OTP), staleLinking)))
        .returning({ id: pa.id });
      for (const { id } of superseded) await this.auditFailed(tx, ctx, id);

      const [created] = await tx
        .insert(pa)
        .values({
          organizationId: ctx.organizationId,
          status: PayoutAccountStatus.LINKING,
          bankBin: input.bankBin,
          accountType: PayoutAccountType.PERSONAL,
          accountLast4: input.accountNumber.slice(-4),
          accountName: input.accountName,
          createdBy: ctx.userId,
        })
        .returning({ id: pa.id });
      if (!created) throw new Error('INSERT payout_accounts không trả về dòng nào');
      await audit.record(tx, {
        actorUserId: ctx.userId,
        organizationId: ctx.organizationId,
        action: 'payout_account.link_started',
        target: { type: 'payout_account', id: created.id },
        changedFields: ['status', 'bank_bin', 'account_type', 'account_last4', 'account_name'],
      });
      return { attemptId: created.id, merchantId: org.tingeeMerchantId, organizationName: org.name };
    });

    // (2) Gọi Tingee, ngoài transaction.
    let result: Awaited<ReturnType<TingeeClient['createVa']>>;
    try {
      const merchantId = knownMerchantId ?? (await this.ensureMerchant(ctx, organizationName, input.phone));
      result = await this.tingee.createVa({
        merchantId,
        bankBin: input.bankBin,
        accountType: PayoutAccountType.PERSONAL,
        accountNumber: input.accountNumber,
        accountName: input.accountName,
        identityNumber: input.identityNumber,
        phone: input.phone,
      });
    } catch (err) {
      await this.fail(ctx, attemptId, PayoutAccountStatus.LINKING, err);
      throw err;
    }

    // (3) Ghi kết quả, transaction riêng.
    if (result.kind === 'otp_required') {
      const confirmId = result.confirmId;
      const row = await this.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(pa)
          .set({ status: PayoutAccountStatus.AWAITING_OTP, confirmId })
          .where(and(orgScope(ctx)(pa), eq(pa.id, attemptId), eq(pa.status, PayoutAccountStatus.LINKING)))
          .returning(columns);
        if (updated) {
          await audit.record(tx, {
            actorUserId: ctx.userId,
            organizationId: ctx.organizationId,
            action: 'payout_account.otp_requested',
            target: { type: 'payout_account', id: attemptId },
            changedFields: ['status', 'confirm_id'],
          });
        }
        return updated;
      });
      if (!row) throw await this.lostAttempt(ctx, attemptId);
      return toDto(row);
    }
    return this.markLinked(ctx, attemptId, PayoutAccountStatus.LINKING, result);
  }

  /**
   * Xác nhận OTP ngân hàng của lần thử đang chờ. OTP sai (hoặc Tingee tạm lỗi) → lần thử vẫn chờ OTP; OTP hết hạn và
   * lỗi khác → `failed`, phải gửi lại. Lần thử đã `linked` → trả lại kết quả (bấm hai lần).
   */
  async confirmOtp(ctx: AccessContext, attemptId: string, otp: string): Promise<PayoutAccount> {
    if (!UUID.test(attemptId)) throw attemptNotFound();
    const [row] = await this.db.orm
      .select({ ...columns, merchantId: organizations.tingeeMerchantId })
      .from(pa)
      .innerJoin(organizations, eq(organizations.id, pa.organizationId))
      .where(and(orgScope(ctx)(pa), eq(pa.id, attemptId)));
    if (!row) throw attemptNotFound();
    if (row.status === PayoutAccountStatus.LINKED) return toDto(row);
    // Quá hạn chờ OTP: không gọi Tingee.
    if (row.status !== PayoutAccountStatus.AWAITING_OTP || row.stale || !row.confirmId || row.merchantId === null) {
      throw tingeeError(ErrorCode.BANK_OTP_EXPIRED);
    }

    let linked: LinkedVa;
    try {
      linked = await this.tingee.confirmVa({
        merchantId: row.merchantId,
        bankBin: row.bankBin,
        confirmId: row.confirmId,
        otp,
      });
    } catch (err) {
      if (!(err instanceof AppError && OTP_RETRYABLE.has(err.code))) {
        await this.fail(ctx, attemptId, PayoutAccountStatus.AWAITING_OTP, err);
      }
      throw err;
    }
    return this.markLinked(ctx, attemptId, PayoutAccountStatus.AWAITING_OTP, linked);
  }

  /**
   * Merchant con của BTC: tạo ở lần liên kết đầu tiên và lưu ngay (CAS `tingee_merchant_id IS NULL`). Hai tab cùng tạo
   * thì tab sau dùng id đã lưu; Merchant con thừa ở Tingee bị bỏ qua.
   */
  private async ensureMerchant(ctx: AccessContext, name: string, phone: string): Promise<number> {
    const { merchantId } = await this.tingee.createMerchant({ name, phone });
    return this.db.transaction(async (tx) => {
      const [saved] = await tx
        .update(organizations)
        .set({ tingeeMerchantId: merchantId })
        .where(and(orgScope(ctx)({ organizationId: organizations.id }), sql`${organizations.tingeeMerchantId} IS NULL`))
        .returning({ merchantId: organizations.tingeeMerchantId });
      if (saved?.merchantId != null) return saved.merchantId;
      const [org] = await tx
        .select({ merchantId: organizations.tingeeMerchantId })
        .from(organizations)
        .where(orgScope(ctx)({ organizationId: organizations.id }));
      if (org?.merchantId == null) throw new AppError(ErrorCode.NOT_A_MEMBER, 'Bạn không phải thành viên của BTC này.');
      return org.merchantId;
    });
  }

  /** CAS `from → linked` kèm audit. BTC đã có dòng `linked` khác (hai tab) → lần này `failed`, 409. */
  private async markLinked(
    ctx: AccessContext,
    attemptId: string,
    from: PayoutAccountStatus,
    linked: LinkedVa,
  ): Promise<PayoutAccount> {
    let row: Row | undefined;
    try {
      row = await this.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(pa)
          .set({
            status: PayoutAccountStatus.LINKED,
            vaAccountNumber: linked.vaAccountNumber,
            tingeeShopId: linked.shopId,
            confirmId: null,
            failureCode: null,
            linkedAt: sql`now()`,
          })
          .where(and(orgScope(ctx)(pa), eq(pa.id, attemptId), eq(pa.status, from)))
          .returning(columns);
        if (updated) {
          await audit.record(tx, {
            actorUserId: ctx.userId,
            organizationId: ctx.organizationId,
            action: 'payout_account.linked',
            target: { type: 'payout_account', id: attemptId },
            changedFields: ['status', 'va_account_number', 'tingee_shop_id', 'linked_at'],
          });
        }
        return updated;
      });
    } catch (err) {
      if (!isLinkedConflict(err)) throw err;
      const conflict = alreadyLinked();
      await this.fail(ctx, attemptId, from, conflict);
      throw conflict;
    }
    if (!row) throw await this.lostAttempt(ctx, attemptId);
    return toDto(row);
  }

  /** CAS `from → failed` kèm audit, mã lỗi miền vào `failure_code`. Lỗi DB ở đây chỉ log: lỗi gốc vẫn được ném. */
  private async fail(ctx: AccessContext, attemptId: string, from: PayoutAccountStatus, err: unknown): Promise<void> {
    const failureCode = err instanceof AppError ? err.code : ErrorCode.INTERNAL_ERROR;
    try {
      await this.db.transaction(async (tx) => {
        const [failed] = await tx
          .update(pa)
          .set({ status: PayoutAccountStatus.FAILED, failureCode, confirmId: null })
          .where(and(orgScope(ctx)(pa), eq(pa.id, attemptId), eq(pa.status, from)))
          .returning({ id: pa.id });
        if (failed) await this.auditFailed(tx, ctx, failed.id);
      });
    } catch (dbErr) {
      this.logger.error({ err: dbErrorSummary(dbErr) }, 'Không ghi được lần liên kết thất bại');
    }
  }

  private auditFailed(tx: Tx, ctx: AccessContext, id: string): Promise<void> {
    return audit.record(tx, {
      actorUserId: ctx.userId,
      organizationId: ctx.organizationId,
      action: 'payout_account.failed',
      target: { type: 'payout_account', id },
      changedFields: ['status', 'failure_code'],
    });
  }

  /** CAS không khớp: lần thử đã bị thay thế (lần thử mới hơn) hoặc đã xong ở request khác. */
  private async lostAttempt(ctx: AccessContext, attemptId: string): Promise<AppError> {
    const [row] = await this.db.orm
      .select({ status: pa.status })
      .from(pa)
      .where(and(orgScope(ctx)(pa), eq(pa.id, attemptId)));
    if (row?.status === PayoutAccountStatus.LINKED) return alreadyLinked();
    return tingeeError(ErrorCode.BANK_OTP_EXPIRED);
  }
}

/** Trạng thái liên kết của một BTC cho `reporting` (banner). */
export interface PayoutAccountState {
  /** `linked`: đã có tài khoản; `awaiting_otp`: có lần thử chờ OTP; `not_linked`: còn lại. */
  status: 'linked' | 'awaiting_otp' | 'not_linked';
  /** Mốc đổi gần nhất của dòng quyết định trạng thái (hoặc của lần thử gần nhất khi `not_linked`); `null` khi chưa thử. */
  changedAt: Date | null;
}

/** Read model cho mô-đun khác: trạng thái tài khoản nhận tiền của BTC trong `scope` (qua `orgScope`). */
export async function payoutAccountStatusOf(
  db: DbExecutor,
  scope: Pick<AccessContext, 'organizationId'>,
): Promise<PayoutAccountState> {
  const [current] = await db
    .select({ status: pa.status, updatedAt: pa.updatedAt })
    .from(pa)
    .where(
      and(
        orgScope(scope)(pa),
        inArray(pa.status, [PayoutAccountStatus.LINKED, PayoutAccountStatus.AWAITING_OTP]),
        sql`NOT (${staleAwaitingOtp})`,
      ),
    )
    .orderBy(sql`(${pa.status} = ${PayoutAccountStatus.LINKED}) DESC`, desc(pa.updatedAt))
    .limit(1);
  if (current) {
    return {
      status: current.status === PayoutAccountStatus.LINKED ? 'linked' : 'awaiting_otp',
      changedAt: current.updatedAt,
    };
  }
  const [latest] = await db
    .select({ updatedAt: sql<Date>`max(${pa.updatedAt})`.mapWith(pa.updatedAt) })
    .from(pa)
    .where(orgScope(scope)(pa));
  return { status: 'not_linked', changedAt: latest?.updatedAt ?? null };
}
