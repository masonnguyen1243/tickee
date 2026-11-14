import { Controller, Get, HttpCode, Inject, Param, Post, Res } from '@nestjs/common';
import type { SuspendedPaymentServiceOrganization } from '@tickee/contracts';
import type { Response } from 'express';
import type { PgBoss } from 'pg-boss';
import {
  PlatformAdminAccess,
  platformAdminScope,
  RequirePlatformAdmin,
  type PlatformAdminContext,
} from '../../platform/access/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { BOSS } from '../../platform/jobs/index.js';
import {
  listSuspendedPaymentServices,
  PaymentServiceQueues,
  resumePaymentServiceByPlatformAdmin,
} from '../organizer/index.js';

/**
 * Dịch vụ thanh toán của BTC cho Quản trị Tingee (Story 4.2-a, AD-32): danh sách BTC đang bị ngắt và mở lại thủ công.
 * Cả controller mang `@RequirePlatformAdmin()` (cờ `platform_admin`, 2FA đã bật, session đã qua lớp hai). Đọc qua
 * `platformAdminScope` (một dòng audit `platform_admin.read` mỗi request đọc); mở lại đi qua hàm tắt cờ duy nhất của
 * `organizer` (audit đường `platform_admin`, Đối soát bù mọi Đơn còn mở qua job "đã mở lại").
 */
@Controller('admin/organizations')
@RequirePlatformAdmin()
export class PaymentServiceAdminController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(PaymentServiceQueues) private readonly queues: PaymentServiceQueues,
  ) {}

  /** `GET /v1/admin/organizations/payment-service/suspended`: BTC `suspended`, ngắt lâu nhất trước. */
  @Get('payment-service/suspended')
  suspended(
    @PlatformAdminAccess() ctx: PlatformAdminContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SuspendedPaymentServiceOrganization[]> {
    // Danh sách nhiều BTC: không cho cache.
    res.setHeader('cache-control', 'no-store');
    return this.db.transaction(async (tx) => {
      const reader = await platformAdminScope(tx, ctx, { type: 'payment_service_suspended', id: 'suspended' });
      return listSuspendedPaymentServices(reader);
    });
  }

  /**
   * `POST /v1/admin/organizations/:id/payment-service/resume` → 204. BTC đang `active` → 409
   * `PAYMENT_SERVICE_NOT_SUSPENDED`; id lạ → 404.
   */
  @Post(':id/payment-service/resume')
  @HttpCode(204)
  async resume(@PlatformAdminAccess() ctx: PlatformAdminContext, @Param('id') id: string): Promise<void> {
    await resumePaymentServiceByPlatformAdmin(this.db, this.boss, this.queues, ctx, id);
  }
}
