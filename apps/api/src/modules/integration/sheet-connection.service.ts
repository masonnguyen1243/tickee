import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ErrorCode,
  GOOGLE_SHEETS_SCOPE,
  Permission,
  roleHasPermission,
  SheetConnectionStatus,
  SHEETS_OAUTH_STATE_TTL_SECONDS,
  SheetsNotice,
  type EventSheetConnectionResponse,
  type SheetConnectStartResponse,
  type SheetSyncErrorCode,
} from '@tickee/contracts';
import { and, eq, lte, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import type { AccessContext } from '../../platform/access/index.js';
import { audit } from '../../platform/audit/index.js';
import type { SecretBox } from '../../platform/crypto/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { BOSS } from '../../platform/jobs/index.js';
import { dbErrorSummary, isDatabaseError } from '../../platform/logging/index.js';
import { assertEventOfOrganization } from '../event/index.js';
import { memberNamesOf, memberRoleOf } from '../organizer/index.js';
import { GoogleApiError, type GoogleSheetsClient } from './google-client.js';
import { GOOGLE_SHEETS_CLIENT, SHEETS_SECRET_BOX } from './integration.config.js';
import { hashOauthState, newOauthSecret, OAUTH_SECRET_PATTERN, pkceChallengeOf } from './oauth-secrets.js';
import { sheetConnections, sheetOauthStates } from './schema.js';
import { connectionOfEvent } from './sheet-connection-store.js';
import { enqueueSheetInitialSync, SheetSyncQueues } from './sheet-sync-jobs.js';

/** Token DI: redirect URI của OAuth client Google Sheets (`<API_PUBLIC_URL>/v1/integrations/google-sheets/callback`). */
export const SHEETS_OAUTH_SETTINGS = Symbol('SHEETS_OAUTH_SETTINGS');

export interface SheetsOauthSettings {
  redirectUri: string;
  /** Origin web (`WEB_ORIGIN`): đích 302 của callback. */
  webOrigin: string;
}

/** Sự kiện của một lượt OAuth: đích 302 về tab Cài đặt. */
export interface SheetsCallbackTarget {
  organizationId: string;
  eventId: string;
}

/**
 * Lý do callback không tạo kết nối (chỉ cho log; không bao giờ có `code`, `state` hay token): `state` sai dạng, lạ hoặc đã
 * dùng, hết hạn, khác người dùng (kể cả không có session), mất quyền `events.manage`, Google báo lỗi (người dùng từ chối…),
 * thiếu `code`, không giải mã được `code_verifier`, đổi token lỗi (kèm mã), thiếu refresh token, thiếu scope, lỗi khác.
 */
export type SheetsCallbackFailure =
  | 'state_invalid'
  | 'state_unknown'
  | 'state_expired'
  | 'user_mismatch'
  | 'forbidden'
  | 'google_error'
  | 'code_missing'
  | 'verifier_unreadable'
  | `token_${SheetSyncErrorCode}`
  | 'refresh_token_missing'
  | 'scope_missing'
  | 'unexpected_error';

/** Kết quả callback: mã notice cho web, Sự kiện (khi biết) và lý do khi không tạo kết nối. */
export interface SheetsCallbackResult {
  notice: SheetsNotice;
  target?: SheetsCallbackTarget;
  failure?: SheetsCallbackFailure;
}

/** Query của callback như Express đưa (giá trị có thể là mảng hay object khi bị giả mạo). */
export type SheetsCallbackQuery = Record<string, unknown>;

/**
 * Mã `error` OAuth Google có thể gửi về callback, được ghi nguyên vào log (vd. tách `admin_policy_enforced` của Google
 * Workspace khỏi người dùng tự hủy). Giá trị khác ghi `other`: query do trình duyệt gửi, không log chuỗi tùy ý.
 */
const KNOWN_OAUTH_ERRORS: ReadonlySet<string> = new Set([
  'access_denied',
  'admin_policy_enforced',
  'org_internal',
  'invalid_scope',
  'invalid_request',
  'invalid_client',
  'unauthorized_client',
  'unsupported_response_type',
  'disallowed_useragent',
  'server_error',
  'temporarily_unavailable',
]);

/** Độ dài tối đa của `code` nhận từ query (Google ~ 100 ký tự). */
const MAX_CODE_LENGTH = 2048;

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

const alreadyConnected = () =>
  new AppError(ErrorCode.SHEETS_ALREADY_CONNECTED, 'Sự kiện này đã kết nối Google Sheets.');
const notConnected = () => new AppError(ErrorCode.SHEETS_NOT_CONNECTED, 'Sự kiện này chưa kết nối Google Sheets.');

/**
 * Kết nối Google Sheets của Sự kiện (Story 6.4, FR-32, AD-23): trạng thái, bắt đầu OAuth, callback OAuth và ngắt kết nối.
 * Route BTC đã qua `PermissionGuard` (`events.manage`); Sự kiện được kiểm thuộc BTC trước mọi thao tác. Không gọi Google
 * trong transaction DB. Refresh token, `code`, `state`, `code_verifier` không bao giờ được log hay trả về web.
 */
@Injectable()
export class SheetConnectionService {
  private readonly logger = new Logger('SheetConnectionService');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(SheetSyncQueues) private readonly queues: SheetSyncQueues,
    @Inject(GOOGLE_SHEETS_CLIENT) private readonly google: GoogleSheetsClient,
    @Inject(SHEETS_SECRET_BOX) private readonly secretBox: SecretBox,
    @Inject(SHEETS_OAUTH_SETTINGS) private readonly settings: SheetsOauthSettings,
  ) {}

  /**
   * Kết nối của Sự kiện (`connection: null` khi chưa kết nối). Tên người cấp chỉ khi người đó còn trong BTC và có tên.
   * Sự kiện lạ, sai dạng hoặc của BTC khác → `404 EVENT_NOT_FOUND`.
   */
  async status(ctx: AccessContext, eventId: string): Promise<EventSheetConnectionResponse> {
    await assertEventOfOrganization(this.db.orm, ctx, eventId);
    const row = await connectionOfEvent(this.db.orm, ctx, eventId);
    if (!row) return { connection: null };
    const names = await memberNamesOf(this.db.orm, ctx, [row.grantedByUserId]);
    return {
      connection: {
        status: row.status,
        spreadsheetUrl: row.spreadsheetUrl,
        lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
        lastErrorCode: row.lastErrorCode as SheetSyncErrorCode | null,
        connectedByName: names.get(row.grantedByUserId) || null,
        createdAt: row.createdAt.toISOString(),
      },
    };
  }

  /**
   * Bắt đầu kết nối: tạo `state` (32 byte; DB chỉ giữ SHA-256) và `code_verifier` PKCE (mã hóa), hạn 10 phút theo đồng hồ
   * DB, xóa mọi lượt đã hết hạn (của bất kỳ ai: lượt bỏ dở không tự mất), rồi trả URL ủy quyền. Sự kiện đã có kết nối →
   * `409 SHEETS_ALREADY_CONNECTED`.
   */
  async startConnect(ctx: AccessContext, eventId: string): Promise<SheetConnectStartResponse> {
    await assertEventOfOrganization(this.db.orm, ctx, eventId);
    if (await connectionOfEvent(this.db.orm, ctx, eventId)) throw alreadyConnected();
    const state = newOauthSecret();
    const codeVerifier = newOauthSecret();
    await this.db.transaction(async (tx) => {
      await tx.delete(sheetOauthStates).where(lte(sheetOauthStates.expiresAt, sql`now()`));
      await tx.insert(sheetOauthStates).values({
        stateHash: hashOauthState(state),
        organizationId: ctx.organizationId,
        eventId,
        userId: ctx.userId,
        codeVerifier: this.secretBox.seal(codeVerifier),
        expiresAt: sql`now() + make_interval(secs => ${SHEETS_OAUTH_STATE_TTL_SECONDS})`,
      });
    });
    return {
      authorizationUrl: this.google.authorizationUrl({
        state,
        codeChallenge: pkceChallengeOf(codeVerifier),
        redirectUri: this.settings.redirectUri,
      }),
    };
  }

  /**
   * Ngắt kết nối: xóa dòng (refresh token đi theo) và ghi audit `sheet_connection.deleted` trong một transaction. Không gọi
   * Google (revoke sẽ hủy cả grant của tài khoản Google đó, làm hỏng kết nối của Sự kiện khác do cùng người cấp). Sheet
   * giữ nguyên trong Drive; job đang chạy tự dừng trước lô kế tiếp. Không có kết nối → `404 SHEETS_NOT_CONNECTED`.
   */
  async disconnect(ctx: AccessContext, eventId: string): Promise<void> {
    await assertEventOfOrganization(this.db.orm, ctx, eventId);
    await this.db.transaction(async (tx) => {
      const deleted = await tx
        .delete(sheetConnections)
        .where(and(eq(sheetConnections.organizationId, ctx.organizationId), eq(sheetConnections.eventId, eventId)))
        .returning({ id: sheetConnections.id });
      if (deleted.length === 0) throw notConnected();
      await audit.record(tx, {
        actorUserId: ctx.userId,
        organizationId: ctx.organizationId,
        action: 'sheet_connection.deleted',
        target: { type: 'event', id: eventId.toLowerCase() },
      });
    });
  }

  /**
   * Callback OAuth (`GET /v1/integrations/google-sheets/callback`). Xóa dòng `state` bằng `DELETE … RETURNING` (dùng một
   * lần) rồi kiểm: còn hạn, người dùng của session trùng người tạo `state`, người đó vẫn có `events.manage` trong BTC. Google
   * báo lỗi (`access_denied`) → `sheets-denied`. Sự kiện đã có kết nối → `sheets-already-connected` (không đổi `code`). Đổi
   * `code` lấy token ngoài transaction; không có refresh token (hoặc thiếu scope `drive.file`) → thất bại. Rồi một
   * transaction: tạo kết nối `syncing` (refresh token mã hóa; unique `event_id` — thua race thì báo "đã kết nối", không ghi
   * đè), audit `sheet_connection.created`, enqueue lần đẩy đầu. Không bao giờ ném: lỗi bất kỳ → `sheets-failed`.
   */
  async completeCallback(query: SheetsCallbackQuery, userId: string | null): Promise<SheetsCallbackResult> {
    const state = text(query.state);
    if (!state || !OAUTH_SECRET_PATTERN.test(state)) return this.failed(undefined, 'state_invalid');
    let target: SheetsCallbackTarget | undefined;
    try {
      const [row] = await this.db.orm
        .delete(sheetOauthStates)
        .where(eq(sheetOauthStates.stateHash, hashOauthState(state)))
        .returning({
          organizationId: sheetOauthStates.organizationId,
          eventId: sheetOauthStates.eventId,
          userId: sheetOauthStates.userId,
          codeVerifier: sheetOauthStates.codeVerifier,
          live: sql<boolean>`${sheetOauthStates.expiresAt} > now()`,
        });
      if (!row) return this.failed(undefined, 'state_unknown');
      target = { organizationId: row.organizationId, eventId: row.eventId };
      if (!row.live) return this.failed(target, 'state_expired');
      if (!userId || userId !== row.userId) return this.failed(target, 'user_mismatch');
      const role = await memberRoleOf(this.db.orm, userId, row.organizationId);
      if (!role || !roleHasPermission(role, Permission.EVENTS_MANAGE)) return this.failed(target, 'forbidden');

      const googleError = text(query.error);
      if (googleError) {
        this.logger.log(
          {
            ...target,
            reason: 'google_error',
            googleError: KNOWN_OAUTH_ERRORS.has(googleError) ? googleError : 'other',
          },
          'Callback Google Sheets: Google báo lỗi',
        );
        return {
          notice: googleError === 'access_denied' ? SheetsNotice.DENIED : SheetsNotice.FAILED,
          target,
          failure: 'google_error',
        };
      }
      const code = text(query.code);
      if (!code || code.length > MAX_CODE_LENGTH) return this.failed(target, 'code_missing');
      if (await connectionOfEvent(this.db.orm, target, target.eventId)) {
        return { notice: SheetsNotice.ALREADY_CONNECTED, target };
      }

      let codeVerifier: string;
      try {
        codeVerifier = this.secretBox.open(row.codeVerifier);
      } catch {
        return this.failed(target, 'verifier_unreadable');
      }
      let refreshToken: string;
      try {
        const grant = await this.google.exchangeCode({ code, codeVerifier, redirectUri: this.settings.redirectUri });
        if (!grant.refreshToken) return this.failed(target, 'refresh_token_missing');
        if (grant.scope !== null && !grant.scope.split(' ').includes(GOOGLE_SHEETS_SCOPE)) {
          return this.failed(target, 'scope_missing');
        }
        refreshToken = grant.refreshToken;
      } catch (err) {
        if (err instanceof GoogleApiError) return this.failed(target, `token_${err.code}`);
        throw err;
      }

      const sealed = this.secretBox.seal(refreshToken);
      const created = await this.createConnection(target, userId, sealed);
      return created ? { notice: SheetsNotice.CONNECTED, target } : { notice: SheetsNotice.ALREADY_CONNECTED, target };
    } catch (err) {
      this.logger.error(
        { ...target, reason: 'unexpected_error', error: isDatabaseError(err) ? dbErrorSummary(err) : errorName(err) },
        'Callback Google Sheets: lỗi không mong đợi',
      );
      return { notice: SheetsNotice.FAILED, target, failure: 'unexpected_error' };
    }
  }

  /** Tạo kết nối `syncing` + audit + enqueue trong một transaction; Sự kiện đã có kết nối (thua race) → `false`. */
  private async createConnection(target: SheetsCallbackTarget, userId: string, sealedRefreshToken: string): Promise<boolean> {
    // pg-boss đã start và queue đã có (ngoài transaction): `boss.send` cần cả hai.
    await this.queues.ready();
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(sheetConnections)
        .values({
          organizationId: target.organizationId,
          eventId: target.eventId,
          grantedByUserId: userId,
          status: SheetConnectionStatus.SYNCING,
          refreshToken: sealedRefreshToken,
        })
        .onConflictDoNothing({ target: sheetConnections.eventId })
        .returning({ id: sheetConnections.id });
      if (!created) return false;
      await audit.record(tx, {
        actorUserId: userId,
        organizationId: target.organizationId,
        action: 'sheet_connection.created',
        target: { type: 'event', id: target.eventId },
      });
      await enqueueSheetInitialSync(this.boss, tx, created.id);
      return true;
    });
  }

  private failed(target: SheetsCallbackTarget | undefined, failure: SheetsCallbackFailure): SheetsCallbackResult {
    this.logger.warn({ ...target, reason: failure }, 'Callback Google Sheets: không tạo kết nối');
    return { notice: SheetsNotice.FAILED, target, failure };
  }
}

/** Tên lớp lỗi, không bao giờ message (message có thể mang tham số request). */
function errorName(err: unknown): string {
  return (err as { constructor?: { name?: string } } | null)?.constructor?.name ?? 'Unknown';
}
