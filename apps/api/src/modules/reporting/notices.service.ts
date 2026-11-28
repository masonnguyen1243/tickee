import { Inject, Injectable } from '@nestjs/common';
import {
  ClosedBetaStatus,
  ErrorCode,
  NOTIFICATION_CATALOG,
  PAYMENT_SERVICE_NOTICE_CODES,
  PaymentServiceReason,
  PaymentServiceStatus,
  Role,
  sortStatusNotices,
  StatusNoticeCode,
  StatusNoticeScope,
  StatusNoticeSeverity,
  type StatusNotice,
} from '@tickee/contracts';
import type { AccessContext } from '../../platform/access/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { ticketEventsByIds } from '../event/index.js';
import { revokedSheetConnectionsOf, type RevokedSheetConnection } from '../integration/index.js';
import {
  closedBetaStatusOf,
  paymentServiceStateOf,
  payoutAccountStatusOf,
  tokenAlertStateOf,
  type ClosedBetaState,
  type PaymentServiceRow,
  type PayoutAccountState,
  type TokenAlertRow,
} from '../organizer/index.js';

/** Token DI của cấu hình `notices`. */
export const NOTICES_SETTINGS = Symbol('NOTICES_SETTINGS');

export interface NoticesSettings {
  /**
   * Portal Tingee ứng với `TINGEE_BASE_URL` (link "Mua thêm Token" của banner hết Token, Story 4.2, và banner Token dưới
   * ngưỡng, Story 4.5-b).
   */
  tingeePortalUrl: string;
}

/** Phạm vi một BTC: thông báo cấp BTC, lọc theo vai của người xem. */
export type OrganizationNoticeScope = Pick<AccessContext, 'organizationId' | 'role'>;

const MEMBERS = [Role.OWNER, Role.ADMIN];

/** Thông báo của trục Closed Beta; `version` là mốc đổi trạng thái gần nhất (chưa đổi thì là lúc tạo BTC). */
function closedBetaNotices(state: ClosedBetaState): StatusNotice[] {
  const version = (state.changedAt ?? state.createdAt).toISOString();
  switch (state.status) {
    case ClosedBetaStatus.PENDING:
      return [
        {
          code: StatusNoticeCode.CLOSED_BETA_PENDING,
          severity: StatusNoticeSeverity.WARNING,
          blocking: false,
          dismissible: false,
          scope: StatusNoticeScope.ORGANIZATION,
          audience: MEMBERS,
          data: {},
          version,
        },
      ];
    case ClosedBetaStatus.REVOKED:
      return [
        {
          code: StatusNoticeCode.CLOSED_BETA_REVOKED,
          severity: StatusNoticeSeverity.DANGER,
          blocking: true,
          dismissible: false,
          scope: StatusNoticeScope.ORGANIZATION,
          audience: MEMBERS,
          data: {},
          version,
        },
      ];
    case ClosedBetaStatus.APPROVED:
      return [];
  }
}

/**
 * Thông báo của trục tài khoản nhận tiền: BTC không có tài khoản nhận tiền hiện hành nào (chưa kết nối Tingee, kết nối
 * rồi nhưng chưa chọn tài khoản, hoặc đã hủy liên kết hết) → `PAYOUT_ACCOUNT_NOT_LINKED` (danger, chặn bán Vé có phí);
 * có ít nhất một → không có. `version` là lúc tài khoản cuối cùng bị hủy (chưa từng có tài khoản thì là lúc tạo BTC).
 * Web chọn câu theo vai (Owner có nút "Liên kết ngay").
 */
function payoutNotices(state: PayoutAccountState, organizationCreatedAt: Date): StatusNotice[] {
  if (state.status === 'linked') return [];
  return [
    {
      code: StatusNoticeCode.PAYOUT_ACCOUNT_NOT_LINKED,
      severity: StatusNoticeSeverity.DANGER,
      blocking: true,
      dismissible: false,
      scope: StatusNoticeScope.ORGANIZATION,
      audience: MEMBERS,
      data: {},
      version: (state.changedAt ?? organizationCreatedAt).toISOString(),
    },
  ];
}

/**
 * Thông báo của trục dịch vụ thanh toán (Story 4.2, AD-32): BTC `suspended` → đúng một mã theo lý do
 * (`PAYMENT_SERVICE_NOTICE_CODES`; danger, chặn bán, không đóng được, Owner và Admin); `active` → không có. Mã hết Token
 * kèm `data.tingeePortalUrl` (portal Tingee để mua thêm Token). `version` = lúc bắt đầu ngắt kèm lý do: đổi khi trạng
 * thái gốc đổi.
 */
function paymentServiceNotices(state: PaymentServiceRow, tingeePortalUrl: string): StatusNotice[] {
  if (state.status !== PaymentServiceStatus.SUSPENDED || !state.reason || !state.since) return [];
  return [
    {
      code: PAYMENT_SERVICE_NOTICE_CODES[state.reason],
      severity: StatusNoticeSeverity.DANGER,
      blocking: true,
      dismissible: false,
      scope: StatusNoticeScope.ORGANIZATION,
      audience: MEMBERS,
      data: state.reason === PaymentServiceReason.TOKEN ? { tingeePortalUrl } : {},
      version: `${state.since.toISOString()}:${state.reason}`,
    },
  ];
}

/**
 * Thông báo Token dưới ngưỡng cảnh báo (Story 4.5-b): BTC có mốc vượt ngưỡng (`token_below_threshold_since`) →
 * `TOKEN_BELOW_THRESHOLD` (warning, không chặn bán, đóng được; audience theo danh mục thông báo: chỉ Owner), `version` =
 * mốc vượt ngưỡng (lần vượt mới thì banner đã đóng hiện lại), `data.tingeePortalUrl` để "Mua thêm Token". BTC đang Tạm
 * ngừng bán vì hết Token → không có (banner danger của 4.2 đã báo).
 */
function tokenAlertNotices(
  alert: TokenAlertRow,
  paymentService: PaymentServiceRow | null,
  tingeePortalUrl: string,
): StatusNotice[] {
  if (!alert.since) return [];
  if (paymentService?.status === PaymentServiceStatus.SUSPENDED && paymentService.reason === PaymentServiceReason.TOKEN) {
    return [];
  }
  const notification = NOTIFICATION_CATALOG.token_below_threshold;
  return [
    {
      code: notification.noticeCode,
      severity: StatusNoticeSeverity.WARNING,
      blocking: false,
      dismissible: true,
      scope: StatusNoticeScope.ORGANIZATION,
      audience: [...notification.recipients],
      data: { tingeePortalUrl },
      version: alert.since.toISOString(),
    },
  ];
}

/**
 * Thông báo mất quyền Google Sheets (Story 6.6): mỗi kết nối `auth_revoked` → một `SHEETS_AUTH_REVOKED` (warning, không
 * chặn bán, đóng được; audience theo danh mục thông báo: Owner và Admin), `data = { eventId, eventName }` (hành động "Kết
 * nối lại" tới tab Cài đặt của Sự kiện), `version` = lúc mất quyền: mỗi banner một khóa đóng, mất quyền lần mới thì hiện
 * lại. Thứ tự theo lúc mất quyền. Sự kiện không còn (hay của BTC khác) → bỏ qua.
 */
function sheetsAuthRevokedNotices(
  revoked: readonly RevokedSheetConnection[],
  eventNames: ReadonlyMap<string, string>,
): StatusNotice[] {
  const notification = NOTIFICATION_CATALOG.sheets_auth_revoked;
  return revoked.flatMap((connection) => {
    const eventName = eventNames.get(connection.eventId);
    if (eventName === undefined) return [];
    return [
      {
        code: notification.noticeCode,
        severity: StatusNoticeSeverity.WARNING,
        blocking: false,
        dismissible: true,
        scope: StatusNoticeScope.EVENT,
        audience: [...notification.recipients],
        data: { eventId: connection.eventId, eventName },
        version: connection.authRevokedAt.toISOString(),
      },
    ];
  });
}

/**
 * `reporting.notices(scope)` (AD-34): nguồn duy nhất cho `status-banner` của dashboard. Chỉ đọc qua read model của mô-đun
 * sở hữu (Closed Beta, tài khoản nhận tiền, dịch vụ thanh toán, cảnh báo Token: `organizer`; kết nối Google Sheets mất
 * quyền: `integration`, tên Sự kiện: `event`); trả thông báo có vai của người xem trong `audience`, sắp theo
 * `STATUS_NOTICE_PRIORITY`.
 */
@Injectable()
export class NoticesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(NOTICES_SETTINGS) private readonly settings: NoticesSettings,
  ) {}

  async notices(scope: OrganizationNoticeScope): Promise<StatusNotice[]> {
    const closedBeta = await closedBetaStatusOf(this.db.orm, scope);
    // Guard đã xác nhận thành viên; BTC biến mất giữa chừng thì coi như không còn là thành viên.
    if (!closedBeta) throw new AppError(ErrorCode.NOT_A_MEMBER, 'Bạn không phải thành viên của BTC này.');
    const payout = await payoutAccountStatusOf(this.db.orm, scope);
    const paymentService = await paymentServiceStateOf(this.db.orm, scope);
    const tokenAlert = await tokenAlertStateOf(this.db.orm, scope);
    const revokedSheets = await revokedSheetConnectionsOf(this.db.orm, scope);
    const eventNames = await this.eventNamesOf(scope, revokedSheets);
    const { tingeePortalUrl } = this.settings;
    const all = [
      ...closedBetaNotices(closedBeta),
      ...(paymentService ? paymentServiceNotices(paymentService, tingeePortalUrl) : []),
      ...payoutNotices(payout, closedBeta.createdAt),
      ...sheetsAuthRevokedNotices(revokedSheets, eventNames),
      ...(tokenAlert ? tokenAlertNotices(tokenAlert, paymentService, tingeePortalUrl) : []),
    ];
    return sortStatusNotices(all.filter((n) => n.audience.includes(scope.role)));
  }

  /** Tên Sự kiện của các kết nối mất quyền, chỉ Sự kiện của BTC trong `scope` (một truy vấn; rỗng → không chạm DB). */
  private async eventNamesOf(
    scope: OrganizationNoticeScope,
    revoked: readonly RevokedSheetConnection[],
  ): Promise<Map<string, string>> {
    const events = await ticketEventsByIds(
      this.db.orm,
      revoked.map((connection) => connection.eventId),
    );
    return new Map(
      [...events.values()]
        .filter((event) => event.organizationId === scope.organizationId)
        .map((event) => [event.id, event.name]),
    );
  }
}
