import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  ConnectTingeeRequest,
  ErrorCode,
  isBlockedBankBin,
  maskTingeeClientId,
  ReplaceTingeeKeyRequest,
  SelectPayoutAccountRequest,
  tingeeIpnUrl,
  type PayoutAccount,
  type PayoutAccountOption,
  type PayoutAccountOptions,
  type PayoutAccountOverview,
  type TingeeCredentialSummary,
  type TingeeKeyPreview,
} from '@tickee/contracts';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import pg from 'pg';
import type { PgBoss } from 'pg-boss';
import type { z } from 'zod';
import { orgScope, type AccessContext } from '../../platform/access/index.js';
import { audit } from '../../platform/audit/index.js';
import type { ApiConfig } from '../../platform/config/index.js';
import { parseCredentialKeys, SecretBox } from '../../platform/crypto/index.js';
import { DATABASE, dbNow, type Database, type DbExecutor, type Tx } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { BOSS } from '../../platform/jobs/index.js';
import { assertReauth, consumeReauth, type ReauthProof } from '../identity/index.js';
import {
  TINGEE_CLIENT,
  tingeePortalUrl,
  type TingeeAccount,
  type TingeeClient,
  type TingeeCredential,
} from '../tingee/index.js';
import type { DefaultPayoutChangeReason } from './payout-default-email.js';
import { DefaultPayoutQueues, enqueueDefaultPayoutChanged } from './payout-default-jobs.js';
import { lockOrganization } from './organization-lock.js';
import {
  PaymentServiceQueues,
  paymentServiceStateDto,
  resumeAfterDefaultChanged,
  resumeAfterNewKey,
} from './payment-service.js';
import { organizations, payoutAccounts, tingeeCredentials } from './schema.js';

/*
 * Tài khoản nhận tiền (FR-5, AD-6, AD-7, AD-9, Story 2.6): BTC dùng tài khoản merchant Tingee của chính mình. Owner kết
 * nối API key (Client ID + Secret Token), Tickee đọc danh sách tài khoản bằng key đó, Owner thêm một hay nhiều tài
 * khoản (mỗi VA một lần), đặt tài khoản mặc định và hủy liên kết từng tài khoản. Hủy liên kết chỉ là Tickee ngừng dùng
 * tài khoản (`retired_at`, không xóa dòng, không gọi Tingee). Còn tài khoản thì có đúng một tài khoản mặc định. Gửi key
 * chỉ được nhận khi BTC chưa từng liên kết tài khoản nào; từ đó đổi key là luồng "Đổi key Tingee" có xác nhận lại
 * (Story 2.13-b: `beginReplacement` → `previewReplacement` → `replaceKey`).
 *
 * Tingee luôn được gọi NGOÀI transaction DB. Mỗi lần ghi là một transaction riêng có audit, bắt đầu bằng khóa dòng
 * `organizations FOR UPDATE` của BTC, nên hai tab của cùng BTC ghi lần lượt. Secret Token chỉ lưu dạng ciphertext và
 * chỉ được giải mã ngay trước khi gọi `tingee`; không bao giờ có trong response, log, audit hay lỗi.
 *
 * Đặt mặc định và hủy liên kết đổi nơi nhận tiền nên đòi xác nhận lại (Story 2.13-a): ngay sau khóa dòng BTC, transaction
 * tiêu một lần xác nhận của session (`consumeReauth`; thiếu → `REAUTH_REQUIRED`); thao tác lỗi sau đó (404) thì
 * rollback, lần xác nhận còn dùng được. Mỗi lần tài khoản mặc định đổi, cùng transaction enqueue email cảnh báo Owner và
 * mọi Admin.
 *
 * Dịch vụ thanh toán (Story 4.2): tổng quan kèm cờ `payment_service_*` của BTC; đổi key hợp lệ khi BTC đang bị ngắt vì
 * key (`credential_invalid`, `gateway_permission_missing`) hay vì VA của tài khoản mặc định
 * (`payout_account_not_allowed`) thì tắt cờ trong cùng transaction thay key. Đổi tài khoản mặc định (đặt tài khoản
 * khác, hủy tài khoản mặc định) khi BTC đang bị ngắt vì `payout_account_not_allowed` thì tắt cờ trong cùng transaction
 * (đường `default_changed`, Story 4.2-d).
 */

const cred = tingeeCredentials;
const pa = payoutAccounts;

/** Unique index một phần "mỗi VA hiện hành tối đa một lần mỗi BTC". */
const CURRENT_VA_KEY = 'payout_accounts_current_va_per_organization_key';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  isDefault: pa.isDefault,
  linkedAt: pa.linkedAt,
};
type AccountRow = Omit<PayoutAccount, 'linkedAt'> & { linkedAt: Date };

const credentialSummary = (row: CredentialRow): TingeeCredentialSummary => ({
  id: row.id,
  clientIdMasked: maskTingeeClientId(row.clientId),
  connectedAt: row.createdAt.toISOString(),
});

const accountDto = (row: AccountRow): PayoutAccount => ({ ...row, linkedAt: row.linkedAt.toISOString() });

/** `linkedVas`: VA của các tài khoản nhận tiền hiện hành của BTC. */
const optionOf = (account: TingeeAccount, linkedVas: ReadonlySet<string>): PayoutAccountOption => ({
  vaAccountNumber: account.vaAccountNumber,
  bankBin: account.bankBin,
  bankName: account.bankName,
  accountType: account.accountType,
  accountLast4: account.accountLast4,
  accountName: account.accountName,
  selectable: !isBlockedBankBin(account.bankBin),
  linked: linkedVas.has(account.vaAccountNumber),
});

const notAMember = () => new AppError(ErrorCode.NOT_A_MEMBER, 'Bạn không phải thành viên của BTC này.');
const noCredential = () => new AppError(ErrorCode.NOT_FOUND, 'BTC chưa kết nối tài khoản Tingee.');
/** Gửi key sau khi BTC đã từng liên kết tài khoản (kể cả đã hủy hết): đổi key qua "Đổi key Tingee" (`replaceKey`). */
const keyLocked = () =>
  new AppError(
    ErrorCode.PAYOUT_ACCOUNT_ALREADY_LINKED,
    'BTC đã liên kết tài khoản nhận tiền bằng key Tingee này. Đổi key Tingee là thao tác riêng.',
  );
const alreadyLinked = () => new AppError(ErrorCode.PAYOUT_ACCOUNT_ALREADY_LINKED, 'Tài khoản này đã được liên kết.');
const accountNotFound = () => new AppError(ErrorCode.NOT_FOUND, 'Không tìm thấy tài khoản nhận tiền này.');
const unavailable = () =>
  new AppError(
    ErrorCode.PAYOUT_ACCOUNT_UNAVAILABLE,
    'Tài khoản này không còn dùng được trên Tingee. Tải lại danh sách rồi chọn tài khoản khác.',
  );
const bankNotSupported = () =>
  new AppError(ErrorCode.BANK_NOT_SUPPORTED, 'Chưa hỗ trợ VietinBank. Chọn tài khoản ở ngân hàng khác.');
/** Đổi key Tingee khi BTC chưa từng liên kết tài khoản nào: dùng form kết nối (không cần xác nhận lại). */
const notLinkedYet = () =>
  new AppError(
    ErrorCode.PAYOUT_ACCOUNT_NOT_LINKED_YET,
    'BTC chưa liên kết tài khoản nhận tiền nào. Nhập key Tingee ở form kết nối.',
  );

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
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(DefaultPayoutQueues) private readonly defaultPayoutQueues: DefaultPayoutQueues,
    @Inject(PaymentServiceQueues) private readonly paymentServiceQueues: PaymentServiceQueues,
  ) {}

  /** Credential, các tài khoản nhận tiền hiện hành, URL IPN, link portal. Không gọi Tingee. */
  overview(ctx: AccessContext): Promise<PayoutAccountOverview> {
    return this.overviewOf(this.db.orm, ctx);
  }

  /**
   * Kết nối API key Tingee: đọc danh sách tài khoản bằng key (key sai → `TINGEE_CREDENTIAL_INVALID`, không ghi gì), rồi
   * trong một transaction lưu credential mới làm hiện hành (credential cũ, nếu có, chuyển `retired_at`) và sinh `ipnKey`
   * nếu BTC chưa có. BTC đã từng liên kết tài khoản nhận tiền (kể cả đã hủy hết) → 409, không gọi Tingee (đổi key qua
   * `beginReplacement` → `previewReplacement` → `replaceKey`, có xác nhận lại).
   */
  async connect(ctx: AccessContext, input: z.output<typeof ConnectTingeeRequest>): Promise<PayoutAccountOptions> {
    if (await this.hasEverLinked(this.db.orm, ctx)) throw keyLocked();

    const accounts = await this.tingee.listAccounts({ clientId: input.clientId, secretToken: input.secretToken });
    const secretTokenCiphertext = this.settings.secretBox.seal(input.secretToken);

    const saved = await this.db.transaction(async (tx) => {
      await lockOrganization(tx, ctx);
      if (await this.hasEverLinked(tx, ctx)) throw keyLocked();
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
    // Transaction vừa kiểm BTC chưa từng liên kết tài khoản nào: không dòng nào `linked`.
    const noneLinked = new Set<string>();
    return { credential: credentialSummary(saved), accounts: accounts.map((account) => optionOf(account, noneLinked)) };
  }

  /** Đọc lại danh sách tài khoản bằng credential hiện hành, đánh dấu VA đã liên kết. BTC chưa kết nối → 404. */
  async options(ctx: AccessContext): Promise<PayoutAccountOptions> {
    const credential = await this.currentCredential(this.db.orm, ctx);
    if (!credential) throw noCredential();
    const accounts = await this.tingee.listAccounts(this.tingeeCredentialOf(credential));
    const linkedVas = await this.linkedVas(this.db.orm, ctx);
    return {
      credential: credentialSummary(credential),
      accounts: accounts.map((account) => optionOf(account, linkedVas)),
    };
  }

  /**
   * Thêm tài khoản nhận tiền: VA đang liên kết rồi → 409, không gọi Tingee. Đọc lại danh sách từ Tingee bằng
   * credential hiện hành (không tin danh sách web đang giữ): VA không còn `active` → `PAYOUT_ACCOUNT_UNAVAILABLE`;
   * VietinBank → `BANK_NOT_SUPPORTED`; cả hai không lưu gì. Rồi trong một transaction: credential vẫn là bản vừa dùng
   * (đổi giữa chừng → `PAYOUT_ACCOUNT_UNAVAILABLE`), VA chưa liên kết (tab khác vừa thêm → 409), chèn tài khoản kèm
   * audit. Tài khoản đầu tiên của BTC tự thành mặc định.
   */
  async select(ctx: AccessContext, input: z.output<typeof SelectPayoutAccountRequest>): Promise<PayoutAccount> {
    const credential = await this.currentCredential(this.db.orm, ctx);
    if (!credential) throw noCredential();
    if ((await this.linkedVas(this.db.orm, ctx)).has(input.vaAccountNumber)) throw alreadyLinked();

    const accounts = await this.tingee.listAccounts(this.tingeeCredentialOf(credential));
    const chosen = accounts.find((account) => account.vaAccountNumber === input.vaAccountNumber);
    if (!chosen) throw unavailable();
    if (isBlockedBankBin(chosen.bankBin)) throw bankNotSupported();

    let row: AccountRow;
    try {
      row = await this.db.transaction(async (tx) => {
        await lockOrganization(tx, ctx);
        const current = await this.currentCredential(tx, ctx);
        if (current?.id !== credential.id) throw unavailable();
        const linkedVas = await this.linkedVas(tx, ctx);
        if (linkedVas.has(chosen.vaAccountNumber)) throw alreadyLinked();
        const isDefault = linkedVas.size === 0;
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
            isDefault,
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
            ...(isDefault ? ['is_default'] : []),
            'linked_at',
          ],
        });
        return created;
      });
    } catch (err) {
      // Khóa dòng BTC đã xếp hàng hai tab; unique index một phần là lưới an toàn cuối cùng.
      if (isUniqueViolation(err, CURRENT_VA_KEY)) throw alreadyLinked();
      throw err;
    }
    return accountDto(row);
  }

  /**
   * Hủy liên kết một tài khoản nhận tiền: đặt `retired_at` (không xóa dòng, không gọi Tingee). Hủy tài khoản mặc định
   * thì tài khoản liên kết sớm nhất còn lại thành mặc định, email cảnh báo được enqueue (kể cả khi đó là tài khoản cuối
   * cùng: "không còn tài khoản nhận tiền"), và BTC đang bị ngắt vì VA của tài khoản đó (`payout_account_not_allowed`)
   * được mở lại (đường `default_changed`). Cần lần xác nhận lại (`REAUTH_REQUIRED`). Id lạ, đã hủy hoặc của BTC khác →
   * 404 (lần xác nhận không bị tiêu). Trả tổng quan mới.
   */
  async unlink(ctx: AccessContext, accountId: string, reauth: ReauthProof): Promise<PayoutAccountOverview> {
    if (!UUID.test(accountId)) throw accountNotFound();
    // pg-boss đã start và queue đã có (ngoài transaction): `boss.send` cần cả hai.
    await this.defaultPayoutQueues.ready();
    // Tắt cờ dịch vụ thanh toán (nếu có) enqueue job "đã mở lại" bằng `tx` bên dưới.
    await this.paymentServiceQueues.ready();
    return this.db.transaction(async (tx) => {
      await lockOrganization(tx, ctx);
      await consumeReauth(tx, { userId: ctx.userId, ...reauth });
      const target = await this.currentAccount(tx, ctx, accountId);
      if (!target) throw accountNotFound();
      // Dòng đã hủy không bao giờ là mặc định: "mặc định" luôn chỉ một tài khoản đang dùng.
      await tx
        .update(pa)
        .set({ retiredAt: sql`now()`, isDefault: false })
        .where(and(orgScope(ctx)(pa), eq(pa.id, target.id)));
      await audit.record(tx, {
        actorUserId: ctx.userId,
        organizationId: ctx.organizationId,
        action: 'payout_account.unlinked',
        target: { type: 'payout_account', id: target.id },
        changedFields: ['retired_at', ...(target.isDefault ? ['is_default'] : [])],
      });
      if (target.isDefault) {
        const [next] = await tx
          .select({ id: pa.id })
          .from(pa)
          .where(and(orgScope(ctx)(pa), isNull(pa.retiredAt)))
          .orderBy(asc(pa.linkedAt), asc(pa.id))
          .limit(1);
        if (next) await this.makeDefault(tx, ctx, next.id);
        await this.notifyDefaultChanged(tx, ctx, target.id, next?.id ?? null);
        // VA bị Tingee từ chối không còn là nơi nhận tiền; không còn tài khoản thì "Chưa liên kết" chặn bán thay cờ.
        await resumeAfterDefaultChanged(this.boss, tx, ctx);
      }
      return this.overviewOf(tx, ctx);
    });
  }

  /**
   * Đặt một tài khoản hiện hành làm mặc định (tài khoản mặc định cũ thôi là mặc định) và enqueue email cảnh báo; BTC
   * đang bị ngắt vì VA của tài khoản mặc định cũ (`payout_account_not_allowed`) được mở lại (đường `default_changed`).
   * Cần lần xác nhận lại (`REAUTH_REQUIRED`), kể cả khi tài khoản đã là mặc định (khi đó không đổi gì, không gửi email,
   * cờ giữ). Id lạ, đã hủy hoặc của BTC khác → 404 (lần xác nhận không bị tiêu). Trả tổng quan mới.
   */
  async setDefault(ctx: AccessContext, accountId: string, reauth: ReauthProof): Promise<PayoutAccountOverview> {
    if (!UUID.test(accountId)) throw accountNotFound();
    await this.defaultPayoutQueues.ready();
    // Tắt cờ dịch vụ thanh toán (nếu có) enqueue job "đã mở lại" bằng `tx` bên dưới.
    await this.paymentServiceQueues.ready();
    return this.db.transaction(async (tx) => {
      await lockOrganization(tx, ctx);
      await consumeReauth(tx, { userId: ctx.userId, ...reauth });
      const target = await this.currentAccount(tx, ctx, accountId);
      if (!target) throw accountNotFound();
      if (!target.isDefault) {
        // Bỏ mặc định cũ trước: unique index một phần chặn hai tài khoản mặc định cùng lúc.
        const previous = await tx
          .update(pa)
          .set({ isDefault: false })
          .where(and(orgScope(ctx)(pa), eq(pa.isDefault, true), isNull(pa.retiredAt)))
          .returning({ id: pa.id });
        await this.makeDefault(tx, ctx, target.id);
        // Còn tài khoản thì luôn có đúng một mặc định; thiếu (dữ liệu lệch) thì không có "tài khoản cũ" để báo.
        const [old] = previous;
        if (old) await this.notifyDefaultChanged(tx, ctx, old.id, target.id);
        // VA mới chưa được Tingee kiểm: còn bị từ chối thì lần tạo link kế bật cờ lại.
        await resumeAfterDefaultChanged(this.boss, tx, ctx);
      }
      return this.overviewOf(tx, ctx);
    });
  }

  /**
   * Bước đầu của "Đổi key Tingee" (Story 2.13-b): BTC đã từng liên kết tài khoản (chưa →
   * `PAYOUT_ACCOUNT_NOT_LINKED_YET`) và request mang lần xác nhận lại còn hiệu lực (`REAUTH_REQUIRED`). Không tiêu lần
   * xác nhận, không gọi Tingee, không ghi gì: web mở form nhập key mới và giữ lần xác nhận cho các bước sau.
   */
  async beginReplacement(ctx: AccessContext, reauth: ReauthProof): Promise<void> {
    await this.assertCanReplaceKey(ctx, reauth);
  }

  /**
   * Xem trước key mới: đọc danh sách tài khoản bằng key mới (key sai → `TINGEE_CREDENTIAL_INVALID`, Tingee lỗi →
   * `PAYMENT_PROVIDER_UNAVAILABLE`, merchant bị khóa → `MERCHANT_SUSPENDED`). Không ghi gì, không tiêu lần xác nhận:
   * key và tài khoản cũ vẫn hiện hành. Mọi dòng `linked: false` (đổi key xong, tài khoản hiện hành đều bị hủy liên
   * kết).
   */
  async previewReplacement(
    ctx: AccessContext,
    input: z.output<typeof ConnectTingeeRequest>,
    reauth: ReauthProof,
  ): Promise<TingeeKeyPreview> {
    await this.assertCanReplaceKey(ctx, reauth);
    const accounts = await this.tingee.listAccounts({ clientId: input.clientId, secretToken: input.secretToken });
    const noneLinked = new Set<string>();
    return {
      clientIdMasked: maskTingeeClientId(input.clientId),
      accounts: accounts.map((account) => optionOf(account, noneLinked)),
    };
  }

  /**
   * Đổi key Tingee: đọc lại danh sách bằng key mới (không tin danh sách web giữ; key sai, Tingee lỗi, VA không còn
   * `active` → `PAYOUT_ACCOUNT_UNAVAILABLE`, VietinBank → `BANK_NOT_SUPPORTED`: không ghi gì, lần xác nhận không bị
   * tiêu). Rồi trong một transaction: tiêu lần xác nhận, credential cũ `retired_at` (giữ ciphertext cho IPN/Đối soát bù
   * của Đơn cũ), mọi tài khoản hiện hành bị hủy liên kết (gỡ mềm), credential mới (Secret Token mã hóa) và tài khoản đã
   * chọn (mặc định) được chèn, kèm audit và email cảnh báo (tài khoản mặc định cũ, hoặc "chưa có", → tài khoản mới).
   * BTC đang bị ngắt dịch vụ thanh toán vì key (`credential_invalid`, `gateway_permission_missing`) hay vì VA của tài
   * khoản mặc định (`payout_account_not_allowed`) → tắt cờ trong cùng transaction (đường `new_key`, Story 4.2); lý do
   * khác giữ cờ. `ipnKey` không đổi. Trả tổng quan mới.
   */
  async replaceKey(
    ctx: AccessContext,
    input: z.output<typeof ReplaceTingeeKeyRequest>,
    reauth: ReauthProof,
  ): Promise<PayoutAccountOverview> {
    await this.assertCanReplaceKey(ctx, reauth);
    const accounts = await this.tingee.listAccounts({ clientId: input.clientId, secretToken: input.secretToken });
    const chosen = accounts.find((account) => account.vaAccountNumber === input.vaAccountNumber);
    if (!chosen) throw unavailable();
    if (isBlockedBankBin(chosen.bankBin)) throw bankNotSupported();
    const secretTokenCiphertext = this.settings.secretBox.seal(input.secretToken);
    await this.defaultPayoutQueues.ready();
    // Tắt cờ dịch vụ thanh toán (nếu có) enqueue job "đã mở lại" bằng `tx` bên dưới.
    await this.paymentServiceQueues.ready();

    try {
      return await this.db.transaction(async (tx) => {
        await lockOrganization(tx, ctx);
        await consumeReauth(tx, { userId: ctx.userId, ...reauth });
        if (!(await this.hasEverLinked(tx, ctx))) throw notLinkedYet();

        const retired = await tx
          .update(cred)
          .set({ retiredAt: sql`now()` })
          .where(and(orgScope(ctx)(cred), isNull(cred.retiredAt)))
          .returning({ id: cred.id });
        // Khóa dòng BTC giữ danh sách này đứng yên tới khi gỡ mềm bên dưới.
        const current = await tx
          .select({ id: pa.id, isDefault: pa.isDefault })
          .from(pa)
          .where(and(orgScope(ctx)(pa), isNull(pa.retiredAt)))
          .orderBy(asc(pa.linkedAt), asc(pa.id));
        // Gỡ mềm trước khi chèn: unique index một phần (VA hiện hành, mặc định hiện hành) cho phép key mới có lại cùng
        // VA (cùng merchant, chỉ thay key).
        await tx
          .update(pa)
          .set({ retiredAt: sql`now()`, isDefault: false })
          .where(and(orgScope(ctx)(pa), isNull(pa.retiredAt)));

        const [credential] = await tx
          .insert(cred)
          .values({
            organizationId: ctx.organizationId,
            clientId: input.clientId,
            secretTokenCiphertext,
            createdBy: ctx.userId,
          })
          .returning({ id: cred.id });
        if (!credential) throw new Error('INSERT tingee_credentials không trả về dòng nào');
        const [account] = await tx
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
            isDefault: true,
            createdBy: ctx.userId,
          })
          .returning({ id: pa.id });
        if (!account) throw new Error('INSERT payout_accounts không trả về dòng nào');

        await audit.record(tx, {
          actorUserId: ctx.userId,
          organizationId: ctx.organizationId,
          action: 'tingee_credential.replaced',
          target: { type: 'tingee_credential', id: credential.id },
          changedFields: ['client_id', 'secret_token_ciphertext', ...(retired.length > 0 ? ['retired_at'] : [])],
        });
        for (const old of current) {
          await audit.record(tx, {
            actorUserId: ctx.userId,
            organizationId: ctx.organizationId,
            action: 'payout_account.unlinked',
            target: { type: 'payout_account', id: old.id },
            changedFields: ['retired_at', ...(old.isDefault ? ['is_default'] : [])],
          });
        }
        await audit.record(tx, {
          actorUserId: ctx.userId,
          organizationId: ctx.organizationId,
          action: 'payout_account.linked',
          target: { type: 'payout_account', id: account.id },
          changedFields: [
            'tingee_credential_id',
            'va_account_number',
            'bank_bin',
            'bank_name',
            'account_type',
            'account_last4',
            'account_name',
            'tingee_shop_id',
            'is_default',
            'linked_at',
          ],
        });
        await audit.record(tx, {
          actorUserId: ctx.userId,
          organizationId: ctx.organizationId,
          action: 'payout_account.default_changed',
          target: { type: 'payout_account', id: account.id },
          changedFields: ['is_default'],
        });
        // BTC đã hủy hết tài khoản trước khi đổi key: không có tài khoản mặc định cũ ("chưa có tài khoản nhận tiền").
        const previousDefault = current.find((row) => row.isDefault)?.id ?? null;
        await this.notifyDefaultChanged(tx, ctx, previousDefault, account.id, 'tingee_key_replaced');
        // `credential_invalid`: Tingee vừa nhận key mới (`listAccounts` ở trên). `gateway_permission_missing`,
        // `payout_account_not_allowed`: `listAccounts` không thấy được quyền "Cổng thanh toán" hay VA được cho phép,
        // nên tin Owner; lần tạo link kế kiểm lại (còn lỗi thì bật cờ lại). Lý do khác key mới không chữa được.
        await resumeAfterNewKey(this.boss, tx, ctx);
        return this.overviewOf(tx, ctx);
      });
    } catch (err) {
      // Khóa dòng BTC và gỡ mềm trước khi chèn đã loại trùng VA; unique index một phần là lưới an toàn cuối cùng.
      if (isUniqueViolation(err, CURRENT_VA_KEY)) throw alreadyLinked();
      throw err;
    }
  }

  /** Điều kiện chung của các bước đổi key, theo thứ tự: đã từng liên kết tài khoản, rồi lần xác nhận còn hiệu lực. */
  private async assertCanReplaceKey(ctx: AccessContext, reauth: ReauthProof): Promise<void> {
    if (!(await this.hasEverLinked(this.db.orm, ctx))) throw notLinkedYet();
    await assertReauth(this.db.orm, { userId: ctx.userId, ...reauth });
  }

  /**
   * Enqueue email cảnh báo đổi tài khoản mặc định trong `tx` (rollback thì không có email). `previousAccountId` `null`:
   * trước đó BTC không có tài khoản nào; `nextAccountId` `null`: BTC không còn tài khoản nào. `reason`
   * `tingee_key_replaced`: email nói key Tingee vừa đổi và mọi tài khoản cũ đã bị hủy liên kết.
   */
  private async notifyDefaultChanged(
    tx: Tx,
    ctx: AccessContext,
    previousAccountId: string | null,
    nextAccountId: string | null,
    reason: DefaultPayoutChangeReason = 'default_changed',
  ): Promise<void> {
    // `now()` của transaction: cùng mốc với `retired_at` của lần hủy liên kết.
    const changedAt = await dbNow(tx);
    await enqueueDefaultPayoutChanged(this.boss, tx, {
      organizationId: ctx.organizationId,
      previousAccountId,
      nextAccountId,
      actorUserId: ctx.userId,
      changedAt: changedAt.toISOString(),
      reason,
    });
  }

  /** `accountId` thành mặc định, kèm audit. BTC không còn tài khoản mặc định nào khác (người gọi đã bỏ). */
  private async makeDefault(tx: Tx, ctx: AccessContext, accountId: string): Promise<void> {
    await tx
      .update(pa)
      .set({ isDefault: true })
      .where(and(orgScope(ctx)(pa), eq(pa.id, accountId)));
    await audit.record(tx, {
      actorUserId: ctx.userId,
      organizationId: ctx.organizationId,
      action: 'payout_account.default_changed',
      target: { type: 'payout_account', id: accountId },
      changedFields: ['is_default'],
    });
  }

  private async overviewOf(db: DbExecutor, ctx: AccessContext): Promise<PayoutAccountOverview> {
    const [org] = await db
      .select({
        ipnKey: organizations.tingeeIpnKey,
        status: organizations.paymentServiceStatus,
        reason: organizations.paymentServiceReason,
        since: organizations.paymentServiceSince,
        checkedAt: organizations.paymentServiceCheckedAt,
      })
      .from(organizations)
      .where(orgScope(ctx)({ organizationId: organizations.id }));
    if (!org) throw notAMember();
    const credential = await this.currentCredential(db, ctx);
    const accounts = await db
      .select(accountColumns)
      .from(pa)
      .where(and(orgScope(ctx)(pa), isNull(pa.retiredAt)))
      .orderBy(asc(pa.linkedAt), asc(pa.id));
    return {
      credential: credential ? credentialSummary(credential) : null,
      accounts: accounts.map(accountDto),
      canReplaceKey: !(await this.hasEverLinked(db, ctx)),
      ipnUrl: org.ipnKey ? tingeeIpnUrl(this.settings.apiPublicUrl, org.ipnKey) : null,
      tingeePortalUrl: this.settings.tingeePortalUrl,
      paymentService: paymentServiceStateDto(org),
    };
  }

  private async currentCredential(db: DbExecutor, ctx: AccessContext): Promise<CredentialRow | undefined> {
    const [row] = await db
      .select(credentialColumns)
      .from(cred)
      .where(and(orgScope(ctx)(cred), isNull(cred.retiredAt)));
    return row;
  }

  /** Tài khoản hiện hành `accountId` của BTC (đã hủy hoặc của BTC khác → `undefined`). */
  private async currentAccount(
    db: DbExecutor,
    ctx: AccessContext,
    accountId: string,
  ): Promise<{ id: string; isDefault: boolean } | undefined> {
    const [row] = await db
      .select({ id: pa.id, isDefault: pa.isDefault })
      .from(pa)
      .where(and(orgScope(ctx)(pa), eq(pa.id, accountId), isNull(pa.retiredAt)));
    return row;
  }

  /** VA của các tài khoản nhận tiền hiện hành của BTC. */
  private async linkedVas(db: DbExecutor, ctx: AccessContext): Promise<Set<string>> {
    const rows = await db
      .select({ vaAccountNumber: pa.vaAccountNumber })
      .from(pa)
      .where(and(orgScope(ctx)(pa), isNull(pa.retiredAt)));
    return new Set(rows.map((row) => row.vaAccountNumber));
  }

  /** BTC đã từng liên kết tài khoản nhận tiền nào chưa, kể cả tài khoản đã hủy (luật đổi key, quyết định Q2). */
  private async hasEverLinked(db: DbExecutor, ctx: AccessContext): Promise<boolean> {
    const [row] = await db.select({ id: pa.id }).from(pa).where(orgScope(ctx)(pa)).limit(1);
    return row !== undefined;
  }

  /** Giải mã Secret Token ngay trước lời gọi; kết quả không được giữ lại sau lời gọi. */
  private tingeeCredentialOf(row: CredentialRow): TingeeCredential {
    return { clientId: row.clientId, secretToken: this.settings.secretBox.open(row.secretTokenCiphertext) };
  }
}

/** Trạng thái tài khoản nhận tiền của một BTC cho `reporting` (banner). */
export interface PayoutAccountState {
  /**
   * `linked`: có ít nhất một tài khoản nhận tiền hiện hành; `not_linked`: không có (chưa kết nối Tingee, kết nối rồi
   * nhưng chưa chọn, hoặc đã hủy hết).
   */
  status: 'linked' | 'not_linked';
  /**
   * `linked`: `linked_at` của tài khoản hiện hành liên kết sớm nhất (mốc này dời đi khi tài khoản đó bị hủy, nên không
   * phải lúc BTC chuyển sang `linked`). `not_linked`: `retired_at` mới nhất, tức lúc tài khoản cuối cùng bị hủy (chưa
   * từng có tài khoản thì `null`); `reporting` dùng mốc này làm `version` của banner.
   */
  changedAt: Date | null;
}

/** Read model cho mô-đun khác: trạng thái tài khoản nhận tiền của BTC trong `scope` (qua `orgScope`). */
export async function payoutAccountStatusOf(
  db: DbExecutor,
  scope: Pick<AccessContext, 'organizationId'>,
): Promise<PayoutAccountState> {
  const [current] = await db
    .select({ linkedAt: sql<Date | null>`min(${pa.linkedAt})`.mapWith(pa.linkedAt) })
    .from(pa)
    .where(and(orgScope(scope)(pa), isNull(pa.retiredAt)));
  if (current?.linkedAt) return { status: 'linked', changedAt: current.linkedAt };
  const [latest] = await db
    .select({ retiredAt: sql<Date | null>`max(${pa.retiredAt})`.mapWith(pa.retiredAt) })
    .from(pa)
    .where(orgScope(scope)(pa));
  return { status: 'not_linked', changedAt: latest?.retiredAt ?? null };
}
