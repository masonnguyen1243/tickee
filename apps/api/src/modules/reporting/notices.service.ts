import { Inject, Injectable } from '@nestjs/common';
import {
  ClosedBetaStatus,
  ErrorCode,
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
  payoutAccountStatusOf,
  type ClosedBetaState,
  type PayoutAccountState,
} from '../organizer/index.js';

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
 * Thông báo của trục tài khoản nhận tiền: BTC chưa có tài khoản nhận tiền hiện hành (chưa kết nối Tingee, hoặc kết nối
 * rồi nhưng chưa chọn tài khoản) → `PAYOUT_ACCOUNT_NOT_LINKED` (danger, chặn bán Vé có phí); có rồi → không có. `version`
 * là mốc đổi gần nhất (chưa từng có tài khoản thì là lúc tạo BTC). Web chọn câu theo vai (Owner có nút "Liên kết ngay").
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
 * `reporting.notices(scope)` (AD-34): nguồn duy nhất cho `status-banner` của dashboard. Chỉ đọc qua read model của mô-đun
 * sở hữu (Closed Beta, tài khoản nhận tiền: `organizer`); trả thông báo có vai của người xem trong `audience`, sắp theo
 * `STATUS_NOTICE_PRIORITY`. Story sau (Token, Sheets…) thêm nguồn vào đây.
 */
@Injectable()
export class NoticesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async notices(scope: OrganizationNoticeScope): Promise<StatusNotice[]> {
    const closedBeta = await closedBetaStatusOf(this.db.orm, scope);
    // Guard đã xác nhận thành viên; BTC biến mất giữa chừng thì coi như không còn là thành viên.
    if (!closedBeta) throw new AppError(ErrorCode.NOT_A_MEMBER, 'Bạn không phải thành viên của BTC này.');
    const payout = await payoutAccountStatusOf(this.db.orm, scope);
    const all = [...closedBetaNotices(closedBeta), ...payoutNotices(payout, closedBeta.createdAt)];
    return sortStatusNotices(all.filter((n) => n.audience.includes(scope.role)));
  }
}
