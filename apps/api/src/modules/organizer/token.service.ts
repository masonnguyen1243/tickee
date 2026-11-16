import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ErrorCode,
  Permission,
  roleHasPermission,
  TokenReadingStatus,
  type TokenAlert,
  type TokenAlertThresholdInput,
  type TokenOverview,
  type TokenReading,
} from '@tickee/contracts';
import type { PgBoss } from 'pg-boss';
import type { AccessContext } from '../../platform/access/index.js';
import type { ApiConfig } from '../../platform/config/index.js';
import { parseCredentialKeys, SecretBox, SecretBoxError } from '../../platform/crypto/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { BOSS, errorName } from '../../platform/jobs/index.js';
import { TINGEE_CLIENT, tingeePortalUrl, type TingeeClient } from '../tingee/index.js';
import { defaultPayoutTargetOf, type PayoutTarget } from './payout-targets.js';
import {
  evaluateTokenAlert,
  TokenAlertQueues,
  tokenAlertDto,
  tokenAlertStateOf,
  updateTokenAlertThreshold,
  type TokenAlertRow,
  type TokenAlertTransition,
} from './token-alert.js';

/*
 * Token của BTC (Story 4.5-a, FR-34, AD-32): số dư và hạn mức đọc thẳng từ Tingee bằng key hiện hành của tài khoản
 * nhận tiền mặc định, mỗi lần xem một lần đọc (adapter timeout 3 giây, không retry), NGOÀI transaction. Không lưu số dư,
 * hạn mức hay Token khả dụng ở DB, audit hay cache; log chỉ ghi kết quả đọc (`status`), không ghi số.
 *
 * Cảnh báo Token (Story 4.5-b): mỗi lần đọc `ok` (trang Token và job dò mỗi giờ dùng chung `TokenReader`) đánh giá ngưỡng
 * sau lời gọi Tingee (`evaluateTokenAlert`): chỉ ghi `token_below_threshold_since` khi vượt ngưỡng hoặc về trên ngưỡng,
 * không bao giờ ghi số. BTC chưa đặt ngưỡng (và không dưới ngưỡng) thì đọc Token không ghi gì vào DB, không mở
 * transaction. Đọc `unavailable` hay `no_payout_account` không đổi gì.
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

const notAMember = () => new AppError(ErrorCode.NOT_A_MEMBER, 'Bạn không phải thành viên của BTC này.');

/** Một lần đọc Token kèm trạng thái cảnh báo sau lần đánh giá ngưỡng của chính lần đọc đó. */
export interface TokenReadResult {
  reading: TokenReading;
  /** BTC không còn → `null`. */
  alert: TokenAlertRow | null;
  /** Lần đọc này vừa vượt ngưỡng, vừa về trên ngưỡng, hay không đổi gì (đọc không được cũng là `unchanged`). */
  transition: TokenAlertTransition;
}

/** Đọc Token của một BTC rồi đánh giá ngưỡng: `GET …/token` và job dò Token mỗi giờ dùng chung. */
@Injectable()
export class TokenReader {
  private readonly logger = new Logger('Token');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(TINGEE_CLIENT) private readonly tingee: TingeeClient,
    @Inject(TOKEN_SETTINGS) private readonly settings: TokenSettings,
    @Inject(TokenAlertQueues) private readonly queues: TokenAlertQueues,
  ) {}

  /**
   * Một lần đọc Token từ Tingee (ngoài transaction), rồi — khi đọc `ok` — đánh giá ngưỡng. Lỗi DB → ném; mọi lỗi phía
   * Tingee hay khóa giải mã là `unavailable` (không đổi trạng thái cảnh báo).
   */
  async readAndEvaluate(organizationId: string): Promise<TokenReadResult> {
    const reading = await this.read(organizationId);
    const state = await tokenAlertStateOf(this.db.orm, { organizationId });
    if (!state || reading.status !== TokenReadingStatus.OK) return { reading, alert: state, transition: 'unchanged' };
    // Chưa đặt ngưỡng và không dưới ngưỡng: không có gì để đổi (không mở transaction, không ghi DB).
    if (state.threshold === null && state.since === null) return { reading, alert: state, transition: 'unchanged' };

    await this.queues.ready();
    const { state: alert, transition } = await evaluateTokenAlert(this.db, this.boss, organizationId, reading.available);
    // Chỉ id và chuyển trạng thái: không số dư, hạn mức, Token khả dụng hay ngưỡng.
    if (transition === 'crossed') this.logger.log({ organizationId, transition }, 'Token xuống dưới ngưỡng cảnh báo');
    if (transition === 'recovered') this.logger.log({ organizationId, transition }, 'Token về trên ngưỡng cảnh báo');
    return { reading, alert, transition };
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

/** `GET /v1/orgs/:orgId/token`, `PUT /v1/orgs/:orgId/token/alert-threshold`. */
@Injectable()
export class TokenService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(TokenReader) private readonly reader: TokenReader,
    @Inject(TOKEN_SETTINGS) private readonly settings: TokenSettings,
  ) {}

  /**
   * Một lần đọc Token của BTC kèm trạng thái cảnh báo sau lần đánh giá ngưỡng của chính request này, và link portal
   * Tingee khi người gọi mua được Token (`token.purchase`: Owner). Lỗi DB → ném; mọi lỗi phía Tingee hay khóa giải mã là
   * `unavailable`.
   */
  async overview(ctx: AccessContext): Promise<TokenOverview> {
    const { reading, alert } = await this.reader.readAndEvaluate(ctx.organizationId);
    // Guard đã xác nhận thành viên; BTC biến mất giữa chừng thì coi như không còn là thành viên.
    if (!alert) throw notAMember();
    const base = { reading, alert: tokenAlertDto(alert) };
    return roleHasPermission(ctx.role, Permission.TOKEN_PURCHASE)
      ? { ...base, tingeePortalUrl: this.settings.tingeePortalUrl }
      : base;
  }

  /** Đặt hoặc tắt ngưỡng cảnh báo Token (chỉ Owner, `token_alert.manage`); trả trạng thái cảnh báo sau khi lưu. */
  async setAlertThreshold(ctx: AccessContext, input: TokenAlertThresholdInput): Promise<TokenAlert> {
    return tokenAlertDto(await updateTokenAlertThreshold(this.db, ctx, input.threshold));
  }
}
