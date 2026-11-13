import { Inject, Injectable } from '@nestjs/common';
import {
  ClosedBetaStatus,
  ErrorCode,
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
import {
  closedBetaStatusOf,
  paymentServiceStateOf,
  payoutAccountStatusOf,
  type ClosedBetaState,
  type PaymentServiceRow,
  type PayoutAccountState,
} from '../organizer/index.js';

/** Token DI của cấu hình `notices`. */
export const NOTICES_SETTINGS = Symbol('NOTICES_SETTINGS');

export interface NoticesSettings {
  /** Portal Tingee ứng với `TINGEE_BASE_URL` (link "Mua thêm Token" của banner hết Token, Story 4.2). */
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
 * `reporting.notices(scope)` (AD-34): nguồn duy nhất cho `status-banner` của dashboard. Chỉ đọc qua read model của mô-đun
 * sở hữu (Closed Beta, tài khoản nhận tiền, dịch vụ thanh toán: `organizer`); trả thông báo có vai của người xem trong
 * `audience`, sắp theo `STATUS_NOTICE_PRIORITY`. Story sau (Token dưới ngưỡng, Sheets…) thêm nguồn vào đây.
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
    const all = [
      ...closedBetaNotices(closedBeta),
      ...(paymentService ? paymentServiceNotices(paymentService, this.settings.tingeePortalUrl) : []),
      ...payoutNotices(payout, closedBeta.createdAt),
    ];
    return sortStatusNotices(all.filter((n) => n.audience.includes(scope.role)));
  }
}
