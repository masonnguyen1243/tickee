import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { SecretBox } from '../../platform/crypto/index.js';
import type { DbExecutor } from '../../platform/db/index.js';
import type { TingeeCredential } from '../tingee/index.js';
import { organizations, payoutAccounts, tingeeCredentials } from './schema.js';

/*
 * Read model tài khoản nhận tiền cho `ordering` (Story 3.4, AD-6, AD-35), người nhận IPN cho `payment` (Story 3.5,
 * AD-7), credential đã chụp của Đơn cho Đối soát bù (Story 4.1) và credential hiện hành cho dò dịch vụ (Story 4.2). `organizer` chỉ đọc: không ghi gì, không giữ secret. Khóa giải mã (`SecretBox`) do bên gọi truyền vào;
 * credential đã giải mã chỉ sống trong lời gọi Tingee hay lần kiểm chữ ký của bên gọi, không bao giờ được lưu hay log.
 */

const pa = payoutAccounts;
const cred = tingeeCredentials;

/** Nơi nhận tiền của Đơn mới: tài khoản mặc định của BTC và credential (đã giải mã) để ký `create-link`. */
export interface PayoutTarget {
  payoutAccountId: string;
  /** VA Tingee dùng để nhận tiền (`create-link` truyền số này). */
  vaAccountNumber: string;
  /**
   * `tingee_credentials.id` của credential hiện hành (Story 4.2): lời gọi bằng key này bị từ chối thì chỉ bật cờ dịch vụ
   * thanh toán khi credential vẫn hiện hành lúc ghi (`suspendPaymentService`).
   */
  credentialId: string;
  credential: TingeeCredential;
  /** Tên chủ tài khoản (PII). */
  accountName: string;
  bankName: string;
}

/**
 * Tài khoản nhận tiền mặc định hiện hành của BTC cùng credential của nó (credential hiện hành: tài khoản mặc định luôn
 * thuộc credential hiện hành), Secret Token giải mã bằng `secretBox`. BTC không còn tài khoản mặc định (chưa liên kết,
 * hoặc đã hủy liên kết hết) → `null`. Ciphertext hỏng hay thiếu khóa giải mã → ném `SecretBoxError`.
 */
export async function defaultPayoutTargetOf(
  db: DbExecutor,
  secretBox: SecretBox,
  organizationId: string,
): Promise<PayoutTarget | null> {
  const [row] = await db
    .select({
      payoutAccountId: pa.id,
      vaAccountNumber: pa.vaAccountNumber,
      accountName: pa.accountName,
      bankName: pa.bankName,
      credentialId: cred.id,
      clientId: cred.clientId,
      secretTokenCiphertext: cred.secretTokenCiphertext,
    })
    .from(pa)
    .innerJoin(cred, eq(cred.id, pa.tingeeCredentialId))
    .where(
      and(
        eq(pa.organizationId, organizationId),
        eq(pa.isDefault, true),
        isNull(pa.retiredAt),
        eq(cred.organizationId, organizationId),
        isNull(cred.retiredAt),
      ),
    );
  if (!row) return null;
  return {
    payoutAccountId: row.payoutAccountId,
    vaAccountNumber: row.vaAccountNumber,
    credentialId: row.credentialId,
    credential: { clientId: row.clientId, secretToken: secretBox.open(row.secretTokenCiphertext) },
    accountName: row.accountName,
    bankName: row.bankName,
  };
}

/** Một credential Tingee của BTC với Secret Token đã giải mã, để kiểm chữ ký IPN. */
export interface IpnCredential {
  /** `tingee_credentials.id`: IPN chỉ khớp secret của credential đã thay thì phải ràng được Đơn của credential này. */
  id: string;
  secretToken: string;
  /** Credential hiện hành (`retired_at IS NULL`). */
  current: boolean;
}

/** BTC sở hữu một `ipnKey` và các credential để kiểm chữ ký IPN, theo thứ tự thử. */
export interface IpnRecipient {
  organizationId: string;
  /**
   * Credential hiện hành trước, rồi các credential đã thay (`retired_at`), mới thay nhất trước. Secret của credential
   * đã thay chỉ có hiệu lực với IPN của Đơn có link tạo bằng chính credential đó (AD-35, Story 3.5). Rỗng khi BTC chưa
   * từng lưu credential.
   */
  credentials: IpnCredential[];
}

/**
 * BTC sở hữu `ipnKey` (`organizations.tingee_ipn_key`, AD-7) cùng mọi credential Tingee của BTC, Secret Token giải mã
 * bằng `secretBox`. Không có BTC nào → `null`. Ciphertext hỏng hay thiếu khóa giải mã → ném `SecretBoxError` (cấu hình
 * sai: IPN trả 500 để Tingee gửi lại).
 */
export async function ipnRecipientOf(db: DbExecutor, secretBox: SecretBox, ipnKey: string): Promise<IpnRecipient | null> {
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.tingeeIpnKey, ipnKey));
  if (!org) return null;
  const rows = await db
    .select({ id: cred.id, secretTokenCiphertext: cred.secretTokenCiphertext, retiredAt: cred.retiredAt })
    .from(cred)
    .where(eq(cred.organizationId, org.id))
    .orderBy(sql`${cred.retiredAt} DESC NULLS FIRST`, desc(cred.createdAt), desc(cred.id));
  return {
    organizationId: org.id,
    credentials: rows.map((row) => ({
      id: row.id,
      secretToken: secretBox.open(row.secretTokenCiphertext),
      current: row.retiredAt === null,
    })),
  };
}

/**
 * Id credential Tingee mà tài khoản nhận tiền `payoutAccountId` được đọc bằng (`payout_accounts.tingee_credential_id`,
 * kể cả khi tài khoản hay credential đã bị thay). Không có tài khoản → `null`. Không giải mã gì.
 */
export async function payoutAccountCredentialOf(db: DbExecutor, payoutAccountId: string): Promise<string | null> {
  const [row] = await db
    .select({ credentialId: pa.tingeeCredentialId })
    .from(pa)
    .where(eq(pa.id, payoutAccountId));
  return row?.credentialId ?? null;
}

/**
 * Credential Tingee (Secret Token giải mã bằng `secretBox`) mà tài khoản nhận tiền `payoutAccountId` của BTC
 * `organizationId` được đọc bằng: credential đã ký link của một Đơn (`orders.payout_account_id`, chụp ở TX2), kể cả khi
 * tài khoản hay credential đã bị thay hoặc gỡ mềm (`retired_at`). Đối soát bù (Story 4.1) gọi ngay trước lời gọi Tingee;
 * credential không được lưu hay log. Tài khoản không có, hoặc không thuộc BTC đó → `null`. Ciphertext hỏng hay thiếu
 * khóa giải mã → ném `SecretBoxError`.
 */
export async function payoutCredentialOf(
  db: DbExecutor,
  secretBox: SecretBox,
  input: { organizationId: string; payoutAccountId: string },
): Promise<TingeeCredential | null> {
  const [row] = await db
    .select({ clientId: cred.clientId, secretTokenCiphertext: cred.secretTokenCiphertext })
    .from(pa)
    .innerJoin(cred, eq(cred.id, pa.tingeeCredentialId))
    .where(
      and(
        eq(pa.id, input.payoutAccountId),
        eq(pa.organizationId, input.organizationId),
        eq(cred.organizationId, input.organizationId),
      ),
    );
  if (!row) return null;
  return { clientId: row.clientId, secretToken: secretBox.open(row.secretTokenCiphertext) };
}

/** Người nhận tiền hiện cho Người mua (`recipient-trust-block`). Không có credential hay VA. */
export interface PayoutRecipient {
  organizationName: string;
  /** Tên chủ tài khoản (PII); BTC không còn tài khoản nào → `null`. */
  accountName: string | null;
  bankName: string | null;
}

/**
 * Người nhận tiền của một Đơn: tên BTC, và tên chủ tài khoản + ngân hàng của tài khoản `payoutAccountId` (tài khoản đã
 * chụp lúc gắn link, kể cả khi đã hủy liên kết sau đó); `payoutAccountId` `null` (chưa chụp) → tài khoản mặc định hiện
 * hành; không có tài khoản → hai trường đó `null`. BTC không tồn tại → `null`.
 */
export async function payoutRecipientOf(
  db: DbExecutor,
  input: { organizationId: string; payoutAccountId: string | null },
): Promise<PayoutRecipient | null> {
  const account =
    input.payoutAccountId === null
      ? and(eq(pa.organizationId, organizations.id), eq(pa.isDefault, true), isNull(pa.retiredAt))
      : and(eq(pa.organizationId, organizations.id), eq(pa.id, input.payoutAccountId));
  const [row] = await db
    .select({ organizationName: organizations.name, accountName: pa.accountName, bankName: pa.bankName })
    .from(organizations)
    .leftJoin(pa, account ?? sql`false`)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (!row) return null;
  return { organizationName: row.organizationName, accountName: row.accountName, bankName: row.bankName };
}
