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
import { closedBetaStatusOf, type ClosedBetaState } from '../organizer/index.js';

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
 * `reporting.notices(scope)` (AD-34): nguồn duy nhất cho `status-banner` của dashboard. Chỉ đọc qua read model của mô-đun
 * sở hữu (Closed Beta: `organizer`); trả thông báo có vai của người xem trong `audience`, sắp theo
 * `STATUS_NOTICE_PRIORITY`. Story sau (tài khoản nhận tiền, Token, Sheets…) thêm nguồn vào đây.
 */
@Injectable()
export class NoticesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async notices(scope: OrganizationNoticeScope): Promise<StatusNotice[]> {
    const closedBeta = await closedBetaStatusOf(this.db.orm, scope);
    // Guard đã xác nhận thành viên; BTC biến mất giữa chừng thì coi như không còn là thành viên.
    if (!closedBeta) throw new AppError(ErrorCode.NOT_A_MEMBER, 'Bạn không phải thành viên của BTC này.');
    const all = [...closedBetaNotices(closedBeta)];
    return sortStatusNotices(all.filter((n) => n.audience.includes(scope.role)));
  }
}
