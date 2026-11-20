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
import { TINGEE_CLIENT, tingeePortalUrl, type TingeeClient, type TingeeCredential } from '../tingee/index.js';
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
 * nhận tiền mặc định (adapter timeout 3 giây, không retry), NGOÀI transaction. Không lưu số dư, hạn mức hay Token khả
 * dụng ở DB, Redis, audit hay log; log chỉ ghi kết quả đọc (`status`), không ghi số.
 *
 * Gộp lời gọi và cooldown (E4-3 phần B, retro Epic 4 D2): key đọc Token cũng là key ký `create-link`, mà Tingee giới
 * hạn 20 request/10 giây theo key. Các lần xem cùng BTC, cùng credential dùng chung lời gọi Tingee đang chạy, và dùng
 * lại kết quả của nó (`ok` lẫn `unavailable`, giữ `readAt` của lần đọc thật) thêm `TOKEN_READ_COOLDOWN_SECONDS` sau khi
 * lời gọi xong. Chỉ giữ trong bộ nhớ tiến trình (mỗi instance api, worker một bản riêng), xóa bằng timer khi hết
 * cooldown, nên không số nào nằm lại quá `TOKEN_READ_COOLDOWN_SECONDS` sau khi lời gọi xong, kể cả ở tiến trình rảnh.
 * Lời gọi ném lỗi bất ngờ thì mọi request đang chờ nhận cùng lỗi đó và bản ghi bị xóa ngay. Đọc DB và giải mã key vẫn
 * chạy ở mọi request: đổi key hay đổi tài khoản mặc định thì lần xem sau gọi Tingee bằng key mới ngay;
 * `no_payout_account` và "không giải mã được key" không gọi Tingee nên không có bản ghi. Không chia sẻ giữa hai BTC, kể
 * cả khi dùng chung một merchant.
 *
 * Cảnh báo Token (Story 4.5-b): mỗi lần đọc `ok` (trang Token và job dò mỗi giờ dùng chung `TokenReader`, cùng bản ghi
 * gộp lời gọi nếu ở cùng tiến trình) đánh giá ngưỡng ở chính request đó, kể cả khi dùng lại kết quả trong cooldown
 * (`evaluateTokenAlert`): chỉ ghi `token_below_threshold_since` khi vượt ngưỡng hoặc về trên ngưỡng, không bao giờ ghi
 * số. BTC chưa đặt ngưỡng (và không dưới ngưỡng) thì đọc Token không ghi gì vào DB, không mở transaction. Đọc
 * `unavailable` hay `no_payout_account` không đổi gì.
 *
 * Lời gọi đọc Token không bao giờ bật hay tắt cờ dịch vụ thanh toán (`payment_service_*`), kể cả khi Tingee từ chối key:
 * đường dẫn của Tingee là hợp đồng tạm, Tingee thật có thể trả mã key sai cho một đường dẫn không tồn tại, và khi đó mọi
 * BTC xem trang Token sẽ bị Tạm ngừng bán sai (Design Notes của spec 4.5-a).
 */

/** Token DI của cấu hình trang Token. */
export const TOKEN_SETTINGS = Symbol('TOKEN_SETTINGS');

/** Cooldown của lần đọc Token: kết quả một lời gọi Tingee được dùng lại chừng này giây sau khi lời gọi xong. */
export const TOKEN_READ_COOLDOWN_SECONDS = 5;

export interface TokenSettings {
  /** Giải mã Secret Token Tingee của BTC (khóa `TINGEE_CREDENTIAL_KEYS`). */
  secretBox: SecretBox;
  /** Portal Tingee (nơi mua Token) ứng với `TINGEE_BASE_URL`. */
  tingeePortalUrl: string;
  /** Cooldown (ms) tính từ lúc lời gọi Tingee xong; `0` = chỉ gộp các lời gọi đồng thời (test). */
  readCooldownMs: number;
}

/** Dựng cấu hình từ env đã kiểm (như `payoutAccountSettings`). */
export function tokenSettings(config: Pick<ApiConfig, 'TINGEE_BASE_URL' | 'TINGEE_CREDENTIAL_KEYS'>): TokenSettings {
  return {
    secretBox: new SecretBox(parseCredentialKeys(config.TINGEE_CREDENTIAL_KEYS)),
    tingeePortalUrl: tingeePortalUrl(config.TINGEE_BASE_URL),
    readCooldownMs: TOKEN_READ_COOLDOWN_SECONDS * 1_000,
  };
}

const UNAVAILABLE: TokenReading = { status: TokenReadingStatus.UNAVAILABLE };

/** Lời gọi đọc Token đang chạy hoặc vừa xong của một BTC với một credential. */
interface SharedRead {
  promise: Promise<TokenReading>;
  /** `null` khi lời gọi còn chạy; xong thì là mốc (ms, `Date.now()`) hết cooldown. */
  expiresAt: number | null;
}

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
  /** Khóa `${organizationId}:${credentialId}` → lời gọi đang chạy, hoặc kết quả còn trong cooldown. */
  private readonly shared = new Map<string, SharedRead>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(TINGEE_CLIENT) private readonly tingee: TingeeClient,
    @Inject(TOKEN_SETTINGS) private readonly settings: TokenSettings,
    @Inject(TokenAlertQueues) private readonly queues: TokenAlertQueues,
  ) {}

  /**
   * Một lần đọc Token từ Tingee (ngoài transaction; dùng chung lời gọi đang chạy hay kết quả còn trong cooldown), rồi —
   * khi đọc `ok` — đánh giá ngưỡng ở chính request này. Lỗi DB → ném; mọi lỗi phía Tingee hay khóa giải mã là
   * `unavailable` (không đổi trạng thái cảnh báo).
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
    return this.sharedRead(organizationId, target.credentialId, target.credential);
  }

  /** Số bản ghi đang giữ (lời gọi đang chạy hoặc còn trong cooldown); chỉ cho test. */
  get sharedReadCount(): number {
    return this.shared.size;
  }

  /**
   * Lời gọi Tingee của BTC với credential này: dùng chung lời gọi đang chạy, hoặc kết quả còn trong cooldown; không có
   * thì gọi mới. Xong thì giữ kết quả `readCooldownMs` rồi timer xóa; ném lỗi thì xóa ngay (lần sau gọi lại).
   */
  private sharedRead(organizationId: string, credentialId: string, credential: TingeeCredential): Promise<TokenReading> {
    const key = `${organizationId}:${credentialId}`;
    const hit = this.shared.get(key);
    if (hit && (hit.expiresAt === null || hit.expiresAt > Date.now())) return hit.promise;

    const entry: SharedRead = { promise: this.readFromTingee(organizationId, credential), expiresAt: null };
    this.shared.set(key, entry);
    const forget = () => {
      if (this.shared.get(key) === entry) this.shared.delete(key);
    };
    entry.promise.then(
      () => {
        const cooldownMs = this.settings.readCooldownMs;
        entry.expiresAt = Date.now() + cooldownMs;
        // Timer bảo đảm số không nằm lại trong bộ nhớ quá cooldown, kể cả khi không có lần đọc nào sau đó.
        setTimeout(forget, cooldownMs).unref();
      },
      forget,
    );
    return entry.promise;
  }

  /** Một lời gọi Tingee bằng `credential` → `TokenReading` (lỗi phía Tingee là `unavailable`; log không có số). */
  private async readFromTingee(organizationId: string, credential: TingeeCredential): Promise<TokenReading> {
    const result = await this.tingee.getTokenBalance(credential);
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
