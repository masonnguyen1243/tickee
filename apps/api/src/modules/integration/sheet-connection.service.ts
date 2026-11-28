import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ErrorCode,
  GOOGLE_SHEETS_SCOPE,
  Permission,
  RealtimeTopic,
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
import { DATABASE, type Database, type Tx } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { BOSS } from '../../platform/jobs/index.js';
import { dbErrorSummary, isDatabaseError } from '../../platform/logging/index.js';
import { realtime } from '../../platform/realtime/index.js';
import { assertEventOfOrganization } from '../event/index.js';
import { lockMemberRole, memberNamesOf, memberRoleOf } from '../organizer/index.js';
import { GoogleApiError, type GoogleSheetsClient } from './google-client.js';
import { GOOGLE_SHEETS_CLIENT, SHEETS_SECRET_BOX } from './integration.config.js';
import { hashOauthState, newOauthSecret, OAUTH_SECRET_PATTERN, pkceChallengeOf } from './oauth-secrets.js';
import { sheetConnections, sheetOauthStates } from './schema.js';
import { connectionOfEvent, hasDirty, type SheetConnectionRow } from './sheet-connection-store.js';
import { scheduleSheetFlush } from './sheet-flush-queue.js';
import { enqueueSheetInitialSync, sheetReconnectSyncJobId, SheetSyncQueues } from './sheet-sync-jobs.js';

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
 * dùng, hết hạn, khác người dùng (kể cả không có session), mất quyền `events.manage` (lúc nhận callback, hay lúc kiểm lại
 * trong transaction ghi kết nối — Story 6.6: bị xóa khỏi BTC giữa chừng), Google báo lỗi (người dùng từ chối…),
 * thiếu `code`, không giải mã được `code_verifier`, đổi token lỗi (kèm mã), thiếu refresh token, thiếu scope, dò Sheet cũ
 * khi kết nối lại lỗi tạm thời (kèm mã, Story 6.6), kết nối đã mất quyền lần mới trong lúc kết nối lại, lỗi khác.
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
  | `probe_${SheetSyncErrorCode}`
  | 'revoked_again'
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
 * Kết quả transaction kết nối lại (Story 6.6): xong, kết nối đã bị xóa, đã khác `auth_revoked`, mất quyền lần mới, hay
 * người kết nối lại không còn `events.manage` trong BTC.
 */
type ReconnectOutcome = 'reconnected' | 'gone' | 'changed' | 'revoked_again' | 'forbidden';

/** Kết quả transaction tạo kết nối: đã tạo, Sự kiện đã có kết nối (thua race), hay người cấp không còn `events.manage`. */
type CreateOutcome = 'created' | 'conflict' | 'forbidden';

/** Kết quả dò Sheet cũ bằng token mới (Story 6.6): dùng lại được, phải tạo Sheet mới, hay lỗi tạm thời (kèm mã). */
type SheetProbe = 'reachable' | 'unreachable' | { failure: SheetSyncErrorCode };

/**
 * Kết nối Google Sheets của Sự kiện (Story 6.4, FR-32, AD-23): trạng thái, bắt đầu OAuth, callback OAuth và ngắt kết nối;
 * "Kết nối lại" một kết nối `auth_revoked` đi chung hai route OAuth (Story 6.6). Route BTC đã qua `PermissionGuard`
 * (`events.manage`); Sự kiện được kiểm thuộc BTC trước mọi thao tác. Không gọi Google trong transaction DB. Refresh token,
 * `code`, `state`, `code_verifier` không bao giờ được log hay trả về web.
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
   * Bắt đầu kết nối (hay "Kết nối lại" một kết nối `auth_revoked`, Story 6.6): tạo `state` (32 byte; DB chỉ giữ SHA-256)
   * và `code_verifier` PKCE (mã hóa), hạn 10 phút theo đồng hồ DB, xóa mọi lượt đã hết hạn (của bất kỳ ai: lượt bỏ dở
   * không tự mất), rồi trả URL ủy quyền. Sự kiện đã có kết nối khác `auth_revoked` → `409 SHEETS_ALREADY_CONNECTED`.
   */
  async startConnect(ctx: AccessContext, eventId: string): Promise<SheetConnectStartResponse> {
    await assertEventOfOrganization(this.db.orm, ctx, eventId);
    const existing = await connectionOfEvent(this.db.orm, ctx, eventId);
    if (existing && existing.status !== SheetConnectionStatus.AUTH_REVOKED) throw alreadyConnected();
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
   * Ngắt kết nối: xóa dòng (refresh token đi theo), ghi audit `sheet_connection.deleted` và phát `org_status_changed`
   * (Story 6.6: banner mất quyền của kết nối này mất ngay) trong một transaction. Không gọi Google (revoke sẽ hủy cả grant
   * của tài khoản Google đó, làm hỏng kết nối của Sự kiện khác do cùng người cấp). Sheet giữ nguyên trong Drive; job đang
   * chạy tự dừng trước lô kế tiếp. Không có kết nối → `404 SHEETS_NOT_CONNECTED`.
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
      // Story 6.6: banner "Mất quyền ghi Google Sheets" của kết nối này (nếu có) và mục Google Sheets của mọi dashboard
      // đang mở tải lại.
      await realtime.notifyOrganization(tx, RealtimeTopic.ORG_STATUS_CHANGED, ctx.organizationId);
    });
  }

  /**
   * Callback OAuth (`GET /v1/integrations/google-sheets/callback`). Xóa dòng `state` bằng `DELETE … RETURNING` (dùng một
   * lần) rồi kiểm: còn hạn, người dùng của session trùng người tạo `state`, người đó vẫn có `events.manage` trong BTC. Google
   * báo lỗi (`access_denied`) → `sheets-denied` (kết nối có sẵn giữ nguyên). Sự kiện đã có kết nối khác `auth_revoked` →
   * `sheets-already-connected` (không đổi `code`). Đổi `code` lấy token ngoài transaction; không có refresh token (hoặc
   * thiếu scope `drive.file`) → thất bại. Rồi:
   * - chưa có kết nối: một transaction tạo kết nối `syncing` (refresh token mã hóa; unique `event_id` — thua race thì báo
   *   "đã kết nối", không ghi đè), audit `sheet_connection.created`, enqueue lần đẩy đầu;
   * - có kết nối `auth_revoked`: kết nối lại trên chính kết nối đó (`reconnect`, Story 6.6).
   * Không bao giờ ném: lỗi bất kỳ → `sheets-failed`.
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
      const existing = await connectionOfEvent(this.db.orm, target, target.eventId);
      if (existing && existing.status !== SheetConnectionStatus.AUTH_REVOKED) {
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
      if (existing) return await this.reconnect(target, userId, existing, refreshToken, sealed);
      return await this.connectNew(target, userId, sealed);
    } catch (err) {
      this.logger.error(
        { ...target, reason: 'unexpected_error', error: isDatabaseError(err) ? dbErrorSummary(err) : errorName(err) },
        'Callback Google Sheets: lỗi không mong đợi',
      );
      return { notice: SheetsNotice.FAILED, target, failure: 'unexpected_error' };
    }
  }

  /**
   * Đường tạo kết nối của Story 6.4: kết nối mới → `sheets-connected`; thua race → `sheets-already-connected`; người cấp
   * vừa bị xóa khỏi BTC (hay mất `events.manage`) → `sheets-failed`, không ghi gì.
   */
  private async connectNew(
    target: SheetsCallbackTarget,
    userId: string,
    sealedRefreshToken: string,
  ): Promise<SheetsCallbackResult> {
    switch (await this.createConnection(target, userId, sealedRefreshToken)) {
      case 'created':
        return { notice: SheetsNotice.CONNECTED, target };
      case 'conflict':
        return { notice: SheetsNotice.ALREADY_CONNECTED, target };
      case 'forbidden':
        return this.failed(target, 'forbidden');
    }
  }

  /**
   * Kiểm lại vai của người cấp trong `tx` ghi kết nối, khóa dòng `members` `FOR SHARE` (Story 6.6): vai đã kiểm lúc nhận
   * callback, nhưng đổi `code` và dò Sheet mất vài giây; Admin bị xóa trong lúc đó không được thành người cấp (lệnh xóa
   * không thấy kết nối chưa commit nên không chuyển nó sang `auth_revoked`).
   */
  private async canGrant(tx: Tx, userId: string, organizationId: string): Promise<boolean> {
    const role = await lockMemberRole(tx, userId, organizationId);
    return role !== null && roleHasPermission(role, Permission.EVENTS_MANAGE);
  }

  /**
   * "Kết nối lại" kết nối `auth_revoked` `revoked` (Story 6.6) bằng grant vừa đổi:
   * 1. lần đẩy đầu đã xong (có Sheet và `last_synced_at`): dò Sheet cũ bằng token mới, ngoài transaction
   *    (`spreadsheetInfo`, tìm tab theo `sheet_tab_id`). Mở được, có tab → dùng lại; 404, 401, 403 hay mất tab → Sheet mới
   *    (grant mới không có quyền với file đó: `drive.file`); lỗi tạm thời (429, 5xx, timeout, mạng, quota, cấu hình) →
   *    `sheets-failed`, kết nối giữ nguyên. Lần đẩy đầu chưa xong → không dò, Sheet mới;
   * 2. một transaction: kiểm lại vai của người kết nối lại (khóa dòng thành viên; không còn `events.manage` →
   *    `sheets-failed`, kết nối giữ nguyên), rồi CAS `status = 'auth_revoked'` ở đúng lần mất quyền đã đọc: thay refresh
   *    token (đã mã hóa),
   *    `granted_by_user_id` = người kết nối lại, xóa `auth_revoked_at` và `last_error_code`, rồi
   *    - dùng lại, còn dòng bẩn → `syncing` + hẹn flush (flush xong thì về `active` như 6.5);
   *    - dùng lại, không dòng bẩn → `active` ngay;
   *    - Sheet mới → đặt lại Sheet như `resetSpreadsheet`, `syncing`, enqueue lần đẩy đầu với id job theo lần mất quyền;
   *      dòng bẩn giữ, lần đẩy đầu xong thì hẹn flush;
   *    rồi audit `sheet_connection.reconnected` và phát `org_status_changed` (banner mất);
   * 3. CAS trượt: kết nối đã bị xóa → đường tạo kết nối của 6.4; đã khác `auth_revoked` (người khác vừa kết nối lại) →
   *    `sheets-already-connected`; đã mất quyền lần mới → `sheets-failed` (bấm lại).
   * Không gọi endpoint revoke của Google; refresh token cũ chỉ bị thay trong DB.
   */
  private async reconnect(
    target: SheetsCallbackTarget,
    userId: string,
    revoked: SheetConnectionRow,
    refreshToken: string,
    sealedRefreshToken: string,
  ): Promise<SheetsCallbackResult> {
    let reuse = false;
    if (revoked.spreadsheetId && revoked.lastSyncedAt) {
      const probe = await this.probeSheet(refreshToken, revoked.spreadsheetId, revoked.sheetTabId);
      if (typeof probe === 'object') return this.failed(target, `probe_${probe.failure}`);
      reuse = probe === 'reachable';
    }
    // pg-boss đã start, queue lần đẩy đầu và queue flush đã có (ngoài transaction).
    await this.queues.ready();
    const outcome = await this.db.transaction((tx) =>
      this.reconnectInTx(tx, target, userId, revoked, sealedRefreshToken, reuse),
    );
    switch (outcome) {
      case 'reconnected':
        this.logger.log({ ...target, reuse }, 'Google Sheets: đã kết nối lại');
        return { notice: SheetsNotice.RECONNECTED, target };
      case 'gone':
        return this.connectNew(target, userId, sealedRefreshToken);
      case 'changed':
        return { notice: SheetsNotice.ALREADY_CONNECTED, target };
      case 'revoked_again':
        return this.failed(target, 'revoked_again');
      case 'forbidden':
        return this.failed(target, 'forbidden');
    }
  }

  /** Bước 2 của `reconnect` (xem chú thích ở đó), trong `tx`. */
  private async reconnectInTx(
    tx: Tx,
    target: SheetsCallbackTarget,
    userId: string,
    revoked: SheetConnectionRow,
    sealedRefreshToken: string,
    reuse: boolean,
  ): Promise<ReconnectOutcome> {
    if (!(await this.canGrant(tx, userId, target.organizationId))) return 'forbidden';
    const revokedAt = revoked.authRevokedAt!;
    const granted = {
      refreshToken: sealedRefreshToken,
      grantedByUserId: userId,
      authRevokedAt: null,
      lastErrorCode: null,
      status: SheetConnectionStatus.SYNCING,
      updatedAt: sql`now()`,
    };
    const [updated] = await tx
      .update(sheetConnections)
      .set(
        reuse
          ? granted
          : { ...granted, spreadsheetId: null, spreadsheetUrl: null, lastSyncedAt: null, sheetTabId: sql`DEFAULT` },
      )
      .where(
        and(
          eq(sheetConnections.id, revoked.id),
          eq(sheetConnections.status, SheetConnectionStatus.AUTH_REVOKED),
          // Đúng lần mất quyền đã đọc (mili giây, như `Date` của driver): đã kết nối lại rồi mất quyền lần mới thì Sheet
          // vừa dò có thể không còn là Sheet của kết nối.
          sql`date_trunc('milliseconds', ${sheetConnections.authRevokedAt}) = ${revokedAt.toISOString()}::timestamptz`,
        ),
      )
      .returning({ id: sheetConnections.id });
    if (!updated) {
      const [current] = await tx
        .select({ status: sheetConnections.status })
        .from(sheetConnections)
        .where(eq(sheetConnections.id, revoked.id));
      if (!current) return 'gone';
      return current.status === SheetConnectionStatus.AUTH_REVOKED ? 'revoked_again' : 'changed';
    }

    if (!reuse) {
      // Sheet mới (hay lần đẩy đầu chưa xong): lần đẩy đầu chạy lại với id job mới, dòng bẩn giữ.
      await enqueueSheetInitialSync(this.boss, tx, revoked.id, sheetReconnectSyncJobId(revoked.id, revokedAt));
    } else if (await hasDirty(tx, revoked.id)) {
      // Đọc sau UPDATE (đã giữ khóa dòng): handler `sheet_row_changed` khóa `FOR SHARE` nên dòng bẩn của nó đã commit
      // trước, hoặc nó chờ lệnh này commit rồi thấy kết nối không còn `auth_revoked` và tự hẹn flush.
      await scheduleSheetFlush(this.boss, tx, revoked.id);
    } else {
      await tx
        .update(sheetConnections)
        .set({ status: SheetConnectionStatus.ACTIVE, updatedAt: sql`now()` })
        .where(eq(sheetConnections.id, revoked.id));
    }
    await audit.record(tx, {
      actorUserId: userId,
      organizationId: target.organizationId,
      action: 'sheet_connection.reconnected',
      target: { type: 'event', id: target.eventId },
      changedFields: reuse
        ? ['granted_by_user_id', 'refresh_token', 'status']
        : ['granted_by_user_id', 'refresh_token', 'status', 'spreadsheet_id'],
    });
    await realtime.notifyOrganization(tx, RealtimeTopic.ORG_STATUS_CHANGED, target.organizationId);
    return 'reconnected';
  }

  /**
   * Dò Sheet cũ bằng refresh token vừa cấp, ngoài transaction: tab `sheetTabId` còn → `reachable`; spreadsheet 404, 401,
   * 403 (không vì quota/cấu hình) hay mất tab → `unreachable`; lỗi tạm thời (và lỗi khi lấy access token) → mã lỗi.
   */
  private async probeSheet(refreshToken: string, spreadsheetId: string, sheetTabId: number): Promise<SheetProbe> {
    try {
      const accessToken = await this.google.accessToken(refreshToken);
      try {
        const tabs = await this.google.spreadsheetInfo(accessToken, spreadsheetId);
        return tabs.some((tab) => tab.sheetId === sheetTabId) ? 'reachable' : 'unreachable';
      } catch (err) {
        if (err instanceof GoogleApiError && (err.kind === 'not_found' || err.kind === 'auth_revoked')) {
          return 'unreachable';
        }
        throw err;
      }
    } catch (err) {
      if (err instanceof GoogleApiError) return { failure: err.code };
      throw err;
    }
  }

  /**
   * Tạo kết nối `syncing` + audit + enqueue trong một transaction, sau khi kiểm lại vai của người cấp (`canGrant`). Sự
   * kiện đã có kết nối (thua race) → `conflict`; người cấp không còn `events.manage` → `forbidden`; không ghi gì.
   */
  private async createConnection(
    target: SheetsCallbackTarget,
    userId: string,
    sealedRefreshToken: string,
  ): Promise<CreateOutcome> {
    // pg-boss đã start và queue đã có (ngoài transaction): `boss.send` cần cả hai.
    await this.queues.ready();
    return this.db.transaction(async (tx): Promise<CreateOutcome> => {
      if (!(await this.canGrant(tx, userId, target.organizationId))) return 'forbidden';
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
      if (!created) return 'conflict';
      await audit.record(tx, {
        actorUserId: userId,
        organizationId: target.organizationId,
        action: 'sheet_connection.created',
        target: { type: 'event', id: target.eventId },
      });
      await enqueueSheetInitialSync(this.boss, tx, created.id);
      return 'created';
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
