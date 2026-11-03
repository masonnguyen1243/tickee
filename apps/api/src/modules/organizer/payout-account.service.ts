import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  ConnectTingeeRequest,
  ErrorCode,
  isBlockedBankBin,
  maskTingeeClientId,
  SelectPayoutAccountRequest,
  tingeeIpnUrl,
  type PayoutAccount,
  type PayoutAccountOption,
  type PayoutAccountOptions,
  type PayoutAccountOverview,
  type TingeeCredentialSummary,
} from '@tickee/contracts';
import { and, isNull, sql } from 'drizzle-orm';
import pg from 'pg';
import type { z } from 'zod';
import { orgScope, type AccessContext } from '../../platform/access/index.js';
import { audit } from '../../platform/audit/index.js';
import type { ApiConfig } from '../../platform/config/index.js';
import { parseCredentialKeys, SecretBox } from '../../platform/crypto/index.js';
import { DATABASE, type Database, type DbExecutor, type Tx } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import {
  TINGEE_CLIENT,
  tingeePortalUrl,
  type TingeeAccount,
  type TingeeClient,
  type TingeeCredential,
} from '../tingee/index.js';
import { organizations, payoutAccounts, tingeeCredentials } from './schema.js';

/*
 * Tài khoản nhận tiền (FR-5, AD-6, AD-7, AD-9, Story 2.6): BTC dùng tài khoản merchant Tingee của chính mình. Owner kết
 * nối API key (Client ID + Secret Token), Tickee đọc danh sách tài khoản bằng key đó, Owner chọn một tài khoản.
 *
 * Tingee luôn được gọi NGOÀI transaction DB. Mỗi lần ghi là một transaction riêng có audit, bắt đầu bằng khóa dòng
 * `organizations FOR UPDATE` của BTC, nên hai tab của cùng BTC ghi lần lượt. Secret Token chỉ lưu dạng ciphertext và
 * chỉ được giải mã ngay trước khi gọi `tingee`; không bao giờ có trong response, log, audit hay lỗi.
 */

const cred = tingeeCredentials;
const pa = payoutAccounts;

/** Unique index một phần "một tài khoản nhận tiền hiện hành mỗi BTC". */
const CURRENT_ACCOUNT_KEY = 'payout_accounts_one_current_per_organization_key';
/** `ipnKey`: 128 bit ngẫu nhiên, base64url (AD-7). */
const IPN_KEY_BYTES = 16;

/** Token DI của `PayoutAccountSettings`. */
export const PAYOUT_ACCOUNT_SETTINGS = Symbol('PAYOUT_ACCOUNT_SETTINGS');

export interface PayoutAccountSettings {
  /** Mã hóa/giải mã Secret Token (khóa `TINGEE_CREDENTIAL_KEYS`). */
  secretBox: SecretBox;
  /** `API_PUBLIC_URL`: gốc của URL IPN. */
  apiPublicUrl: string;
  /** Portal Tingee ứng với `TINGEE_BASE_URL`. */
  tingeePortalUrl: string;
}

/** Dựng cấu hình từ env đã kiểm (Zod đã bảo đảm `TINGEE_CREDENTIAL_KEYS` hợp lệ). */
export function payoutAccountSettings(
  config: Pick<ApiConfig, 'API_PUBLIC_URL' | 'TINGEE_BASE_URL' | 'TINGEE_CREDENTIAL_KEYS'>,
): PayoutAccountSettings {
  return {
    secretBox: new SecretBox(parseCredentialKeys(config.TINGEE_CREDENTIAL_KEYS)),
    apiPublicUrl: config.API_PUBLIC_URL,
    tingeePortalUrl: tingeePortalUrl(config.TINGEE_BASE_URL),
  };
}

const credentialColumns = {
  id: cred.id,
  clientId: cred.clientId,
  secretTokenCiphertext: cred.secretTokenCiphertext,
  createdAt: cred.createdAt,
};
type CredentialRow = { id: string; clientId: string; secretTokenCiphertext: string; createdAt: Date };

const accountColumns = {
  id: pa.id,
  vaAccountNumber: pa.vaAccountNumber,
  bankBin: pa.bankBin,
  bankName: pa.bankName,
  accountType: pa.accountType,
  accountLast4: pa.accountLast4,
  accountName: pa.accountName,
  linkedAt: pa.linkedAt,
};
type AccountRow = Omit<PayoutAccount, 'linkedAt'> & { linkedAt: Date };

const credentialSummary = (row: CredentialRow): TingeeCredentialSummary => ({
  id: row.id,
  clientIdMasked: maskTingeeClientId(row.clientId),
  connectedAt: row.createdAt.toISOString(),
});

const accountDto = (row: AccountRow): PayoutAccount => ({ ...row, linkedAt: row.linkedAt.toISOString() });

const optionOf = (account: TingeeAccount): PayoutAccountOption => ({
  vaAccountNumber: account.vaAccountNumber,
  bankBin: account.bankBin,
  bankName: account.bankName,
  accountType: account.accountType,
  accountLast4: account.accountLast4,
  accountName: account.accountName,
  selectable: !isBlockedBankBin(account.bankBin),
});

const notAMember = () => new AppError(ErrorCode.NOT_A_MEMBER, 'Bạn không phải thành viên của BTC này.');
const noCredential = () => new AppError(ErrorCode.NOT_FOUND, 'BTC chưa kết nối tài khoản Tingee.');
const alreadyLinked = () =>
  new AppError(
    ErrorCode.PAYOUT_ACCOUNT_ALREADY_LINKED,
    'BTC đã có tài khoản nhận tiền. Đổi tài khoản nhận tiền là thao tác riêng.',
  );
const unavailable = () =>
  new AppError(
    ErrorCode.PAYOUT_ACCOUNT_UNAVAILABLE,
    'Tài khoản này không còn dùng được trên Tingee. Tải lại danh sách rồi chọn tài khoản khác.',
  );
const bankNotSupported = () =>
  new AppError(ErrorCode.BANK_NOT_SUPPORTED, 'Chưa hỗ trợ VietinBank. Chọn tài khoản ở ngân hàng khác.');

/** Vi phạm unique index `constraint` (ở chính lỗi hoặc một tầng `cause` của Drizzle). */
function isUniqueViolation(err: unknown, constraint: string): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 8 && typeof current === 'object' && current !== null; depth++) {
    if (current instanceof pg.DatabaseError && current.code === '23505' && current.constraint === constraint) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

@Injectable()
export class PayoutAccountService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(TINGEE_CLIENT) private readonly tingee: TingeeClient,
    @Inject(PAYOUT_ACCOUNT_SETTINGS) private readonly settings: PayoutAccountSettings,
  ) {}

  /** Credential và tài khoản nhận tiền hiện hành, URL IPN, link portal. Không gọi Tingee. */
  async overview(ctx: AccessContext): Promise<PayoutAccountOverview> {
    const [org] = await this.db.orm
      .select({ ipnKey: organizations.tingeeIpnKey })
      .from(organizations)
      .where(orgScope(ctx)({ organizationId: organizations.id }));
    if (!org) throw notAMember();
    const credential = await this.currentCredential(this.db.orm, ctx);
    const [account] = await this.db.orm
      .select(accountColumns)
      .from(pa)
      .where(and(orgScope(ctx)(pa), isNull(pa.retiredAt)));
    return {
      credential: credential ? credentialSummary(credential) : null,
      account: account ? accountDto(account) : null,
      ipnUrl: org.ipnKey ? tingeeIpnUrl(this.settings.apiPublicUrl, org.ipnKey) : null,
      tingeePortalUrl: this.settings.tingeePortalUrl,
    };
  }

  /**
   * Kết nối API key Tingee: đọc danh sách tài khoản bằng key (key sai → `TINGEE_CREDENTIAL_INVALID`, không ghi gì), rồi
   * trong một transaction lưu credential mới làm hiện hành (credential cũ, nếu có, chuyển `retired_at`) và sinh `ipnKey`
   * nếu BTC chưa có. BTC đã có tài khoản nhận tiền → 409, không gọi Tingee (đổi key là Story 2.13).
   */
  async connect(ctx: AccessContext, input: z.output<typeof ConnectTingeeRequest>): Promise<PayoutAccountOptions> {
    if (await this.hasCurrentAccount(this.db.orm, ctx)) throw alreadyLinked();

    const accounts = await this.tingee.listAccounts({ clientId: input.clientId, secretToken: input.secretToken });
    const secretTokenCiphertext = this.settings.secretBox.seal(input.secretToken);

    const saved = await this.db.transaction(async (tx) => {
      await this.lockOrganization(tx, ctx);
      if (await this.hasCurrentAccount(tx, ctx)) throw alreadyLinked();
      const retired = await tx
        .update(cred)
        .set({ retiredAt: sql`now()` })
        .where(and(orgScope(ctx)(cred), isNull(cred.retiredAt)))
        .returning({ id: cred.id });
      const [created] = await tx
        .insert(cred)
        .values({ organizationId: ctx.organizationId, clientId: input.clientId, secretTokenCiphertext, createdBy: ctx.userId })
        .returning(credentialColumns);
      if (!created) throw new Error('INSERT tingee_credentials không trả về dòng nào');
      // `ipnKey` sinh một lần cho BTC; nhập key khác không đổi (BTC không phải dán lại URL IPN).
      const ipnKeyCreated = await tx
        .update(organizations)
        .set({ tingeeIpnKey: randomBytes(IPN_KEY_BYTES).toString('base64url') })
        .where(and(orgScope(ctx)({ organizationId: organizations.id }), isNull(organizations.tingeeIpnKey)))
        .returning({ id: organizations.id });
      await audit.record(tx, {
        actorUserId: ctx.userId,
        organizationId: ctx.organizationId,
        action: 'tingee_credential.connected',
        target: { type: 'tingee_credential', id: created.id },
        changedFields: [
          'client_id',
          'secret_token_ciphertext',
          ...(retired.length > 0 ? ['retired_at'] : []),
          ...(ipnKeyCreated.length > 0 ? ['tingee_ipn_key'] : []),
        ],
      });
      return created;
    });
    return { credential: credentialSummary(saved), accounts: accounts.map(optionOf) };
  }

  /** Đọc lại danh sách tài khoản bằng credential hiện hành. BTC chưa kết nối → 404. */
  async options(ctx: AccessContext): Promise<PayoutAccountOptions> {
    const credential = await this.currentCredential(this.db.orm, ctx);
    if (!credential) throw noCredential();
    const accounts = await this.tingee.listAccounts(this.tingeeCredentialOf(credential));
    return { credential: credentialSummary(credential), accounts: accounts.map(optionOf) };
  }

  /**
   * Chọn tài khoản nhận tiền: đọc lại danh sách từ Tingee bằng credential hiện hành (không tin danh sách web đang giữ).
   * VA không còn `active` → `PAYOUT_ACCOUNT_UNAVAILABLE`; VietinBank → `BANK_NOT_SUPPORTED`; cả hai không lưu gì. Rồi
   * trong một transaction: credential vẫn là bản vừa dùng (đổi giữa chừng → `PAYOUT_ACCOUNT_UNAVAILABLE`), BTC chưa có
   * tài khoản hiện hành (có rồi → 409), chèn tài khoản kèm audit.
   */
  async select(ctx: AccessContext, input: z.output<typeof SelectPayoutAccountRequest>): Promise<PayoutAccount> {
    if (await this.hasCurrentAccount(this.db.orm, ctx)) throw alreadyLinked();
    const credential = await this.currentCredential(this.db.orm, ctx);
    if (!credential) throw noCredential();

    const accounts = await this.tingee.listAccounts(this.tingeeCredentialOf(credential));
    const chosen = accounts.find((account) => account.vaAccountNumber === input.vaAccountNumber);
    if (!chosen) throw unavailable();
    if (isBlockedBankBin(chosen.bankBin)) throw bankNotSupported();

    let row: AccountRow;
    try {
      row = await this.db.transaction(async (tx) => {
        await this.lockOrganization(tx, ctx);
        if (await this.hasCurrentAccount(tx, ctx)) throw alreadyLinked();
        const current = await this.currentCredential(tx, ctx);
        if (current?.id !== credential.id) throw unavailable();
        const [created] = await tx
          .insert(pa)
          .values({
            organizationId: ctx.organizationId,
            tingeeCredentialId: credential.id,
            vaAccountNumber: chosen.vaAccountNumber,
            bankBin: chosen.bankBin,
            bankName: chosen.bankName,
            accountType: chosen.accountType,
            accountLast4: chosen.accountLast4,
            accountName: chosen.accountName,
            tingeeShopId: chosen.shopId,
            createdBy: ctx.userId,
          })
          .returning(accountColumns);
        if (!created) throw new Error('INSERT payout_accounts không trả về dòng nào');
        await audit.record(tx, {
          actorUserId: ctx.userId,
          organizationId: ctx.organizationId,
          action: 'payout_account.linked',
          target: { type: 'payout_account', id: created.id },
          changedFields: [
            'tingee_credential_id',
            'va_account_number',
            'bank_bin',
            'bank_name',
            'account_type',
            'account_last4',
            'account_name',
            'tingee_shop_id',
            'linked_at',
          ],
        });
        return created;
      });
    } catch (err) {
      // Khóa dòng BTC đã xếp hàng hai tab; unique index một phần là lưới an toàn cuối cùng.
      if (isUniqueViolation(err, CURRENT_ACCOUNT_KEY)) throw alreadyLinked();
      throw err;
    }
    return accountDto(row);
  }

  /** Khóa dòng BTC tới hết transaction: mọi lần ghi tài khoản nhận tiền của một BTC chạy lần lượt. */
  private async lockOrganization(tx: Tx, ctx: AccessContext): Promise<void> {
    const [org] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(orgScope(ctx)({ organizationId: organizations.id }))
      .for('update');
    if (!org) throw notAMember();
  }

  private async currentCredential(db: DbExecutor, ctx: AccessContext): Promise<CredentialRow | undefined> {
    const [row] = await db
      .select(credentialColumns)
      .from(cred)
      .where(and(orgScope(ctx)(cred), isNull(cred.retiredAt)));
    return row;
  }

  private async hasCurrentAccount(db: DbExecutor, ctx: AccessContext): Promise<boolean> {
    const [row] = await db
      .select({ id: pa.id })
      .from(pa)
      .where(and(orgScope(ctx)(pa), isNull(pa.retiredAt)));
    return row !== undefined;
  }

  /** Giải mã Secret Token ngay trước lời gọi; kết quả không được giữ lại sau lời gọi. */
  private tingeeCredentialOf(row: CredentialRow): TingeeCredential {
    return { clientId: row.clientId, secretToken: this.settings.secretBox.open(row.secretTokenCiphertext) };
  }
}

/** Trạng thái tài khoản nhận tiền của một BTC cho `reporting` (banner). */
export interface PayoutAccountState {
  /** `linked`: có tài khoản nhận tiền hiện hành; `not_linked`: chưa có (kể cả đã kết nối Tingee nhưng chưa chọn). */
  status: 'linked' | 'not_linked';
  /** `linked`: lúc chọn tài khoản; `not_linked`: lúc tài khoản hiện hành gần nhất bị thay (chưa từng có thì `null`). */
  changedAt: Date | null;
}

/** Read model cho mô-đun khác: trạng thái tài khoản nhận tiền của BTC trong `scope` (qua `orgScope`). */
export async function payoutAccountStatusOf(
  db: DbExecutor,
  scope: Pick<AccessContext, 'organizationId'>,
): Promise<PayoutAccountState> {
  const [current] = await db
    .select({ linkedAt: pa.linkedAt })
    .from(pa)
    .where(and(orgScope(scope)(pa), isNull(pa.retiredAt)));
  if (current) return { status: 'linked', changedAt: current.linkedAt };
  const [latest] = await db
    .select({ retiredAt: sql<Date | null>`max(${pa.retiredAt})`.mapWith(pa.retiredAt) })
    .from(pa)
    .where(orgScope(scope)(pa));
  return { status: 'not_linked', changedAt: latest?.retiredAt ?? null };
}
