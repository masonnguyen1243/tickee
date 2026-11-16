import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  Permission,
  roleHasPermission,
  TokenReadingStatus,
  type TokenOverview,
  type TokenReading,
} from '@tickee/contracts';
import type { AccessContext } from '../../platform/access/index.js';
import type { ApiConfig } from '../../platform/config/index.js';
import { parseCredentialKeys, SecretBox, SecretBoxError } from '../../platform/crypto/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { errorName } from '../../platform/jobs/index.js';
import { TINGEE_CLIENT, tingeePortalUrl, type TingeeClient } from '../tingee/index.js';
import { defaultPayoutTargetOf, type PayoutTarget } from './payout-targets.js';

/*
 * Token của BTC (Story 4.5-a, FR-34, AD-32): số dư và hạn mức đọc thẳng từ Tingee bằng key hiện hành của tài khoản
 * nhận tiền mặc định, mỗi lần xem một lần đọc (adapter timeout 3 giây, không retry), NGOÀI transaction. Không lưu số dư,
 * hạn mức hay Token khả dụng ở DB, audit hay cache; log chỉ ghi kết quả đọc (`status`), không ghi số.
 *
 * Lời gọi đọc Token không bao giờ bật hay tắt cờ dịch vụ thanh toán (`payment_service_*`), kể cả khi Tingee từ chối key:
 * đường dẫn của Tingee là hợp đồng tạm, Tingee thật có thể trả mã key sai cho một đường dẫn không tồn tại, và khi đó mọi
 * BTC xem trang Token sẽ bị Tạm ngừng bán sai (Design Notes của spec 4.5-a).
 */

/** Token DI của cấu hình trang Token. */
export const TOKEN_SETTINGS = Symbol('TOKEN_SETTINGS');

export interface TokenSettings {
  /** Giải mã Secret Token Tingee của BTC (khóa `TINGEE_CREDENTIAL_KEYS`). */
  secretBox: SecretBox;
  /** Portal Tingee (nơi mua Token) ứng với `TINGEE_BASE_URL`. */
  tingeePortalUrl: string;
}

/** Dựng cấu hình từ env đã kiểm (như `payoutAccountSettings`). */
export function tokenSettings(config: Pick<ApiConfig, 'TINGEE_BASE_URL' | 'TINGEE_CREDENTIAL_KEYS'>): TokenSettings {
  return {
    secretBox: new SecretBox(parseCredentialKeys(config.TINGEE_CREDENTIAL_KEYS)),
    tingeePortalUrl: tingeePortalUrl(config.TINGEE_BASE_URL),
  };
}

const UNAVAILABLE: TokenReading = { status: TokenReadingStatus.UNAVAILABLE };

/** `GET /v1/orgs/:orgId/token`. */
@Injectable()
export class TokenService {
  private readonly logger = new Logger('Token');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(TINGEE_CLIENT) private readonly tingee: TingeeClient,
    @Inject(TOKEN_SETTINGS) private readonly settings: TokenSettings,
  ) {}

  /**
   * Một lần đọc Token của BTC kèm link portal Tingee khi người gọi mua được Token (`token.purchase`: Owner). Lỗi DB →
   * ném; mọi lỗi phía Tingee hay khóa giải mã là `unavailable`.
   */
  async overview(ctx: AccessContext): Promise<TokenOverview> {
    const reading = await this.read(ctx.organizationId);
    return roleHasPermission(ctx.role, Permission.TOKEN_PURCHASE)
      ? { reading, tingeePortalUrl: this.settings.tingeePortalUrl }
      : { reading };
  }

  private async read(organizationId: string): Promise<TokenReading> {
    let target: PayoutTarget | null;
    try {
      target = await defaultPayoutTargetOf(this.db.orm, this.settings.secretBox, organizationId);
    } catch (err) {
      if (!(err instanceof SecretBoxError)) throw err;
      this.logger.warn(
        { organizationId, status: TokenReadingStatus.UNAVAILABLE, error: errorName(err) },
        'Đọc Token: không giải mã được key',
      );
      return UNAVAILABLE;
    }
    // Không có key để đọc: không gọi Tingee.
    if (!target) return { status: TokenReadingStatus.NO_PAYOUT_ACCOUNT };

    const result = await this.tingee.getTokenBalance(target.credential);
    if (result.status !== 'ok') {
      this.logger.warn({ organizationId, status: TokenReadingStatus.UNAVAILABLE }, 'Đọc Token: chưa đọc được số dư');
      return UNAVAILABLE;
    }
    const available = result.balance + result.creditLimit;
    // Số quá lớn để cộng chính xác: coi như phản hồi sai dạng.
    if (!Number.isSafeInteger(available)) {
      this.logger.warn({ organizationId, status: TokenReadingStatus.UNAVAILABLE }, 'Đọc Token: số Tingee trả quá lớn');
      return UNAVAILABLE;
    }
    return {
      status: TokenReadingStatus.OK,
      balance: result.balance,
      creditLimit: result.creditLimit,
      available,
      readAt: new Date().toISOString(),
    };
  }
}
