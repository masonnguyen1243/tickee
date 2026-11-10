import { and, eq, isNull, sql } from 'drizzle-orm';
import type { SecretBox } from '../../platform/crypto/index.js';
import type { DbExecutor } from '../../platform/db/index.js';
import type { TingeeCredential } from '../tingee/index.js';
import { organizations, payoutAccounts, tingeeCredentials } from './schema.js';

/*
 * Read model tài khoản nhận tiền cho `ordering` (Story 3.4, AD-6, AD-35). `organizer` chỉ đọc: không ghi gì, không giữ
 * secret. Khóa giải mã (`SecretBox`) do bên gọi truyền vào; credential đã giải mã chỉ sống trong lời gọi Tingee của bên
 * gọi, không bao giờ được lưu hay log.
 */

const pa = payoutAccounts;
const cred = tingeeCredentials;

/** Nơi nhận tiền của Đơn mới: tài khoản mặc định của BTC và credential (đã giải mã) để ký `create-link`. */
export interface PayoutTarget {
  payoutAccountId: string;
  /** VA Tingee dùng để nhận tiền (`create-link` truyền số này). */
  vaAccountNumber: string;
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
    credential: { clientId: row.clientId, secretToken: secretBox.open(row.secretTokenCiphertext) },
    accountName: row.accountName,
    bankName: row.bankName,
  };
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
