import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ACCESS_RESOLVER, PermissionGuard } from '../../platform/access/index.js';
import type { ApiConfig } from '../../platform/config/index.js';
import { MemberAccessResolver } from './access-resolver.impl.js';
import { AdminInvitationQueues } from './invitation-jobs.js';
import { InvitationsController } from './invitations.controller.js';
import { MembersController } from './members.controller.js';
import { MembersService } from './members.service.js';
import { MembershipsController } from './memberships.controller.js';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizerService } from './organizer.service.js';
import { OwnershipTransferQueues } from './ownership-transfer-jobs.js';
import { PaymentServiceController } from './payment-service.controller.js';
import {
  PAYMENT_SERVICE_SETTINGS,
  PaymentServiceProber,
  PaymentServiceQueues,
  PaymentServiceService,
  paymentServiceSettings,
} from './payment-service.js';
import { PayoutAccountController } from './payout-account.controller.js';
import { PAYOUT_ACCOUNT_SETTINGS, PayoutAccountService, payoutAccountSettings } from './payout-account.service.js';
import { DefaultPayoutQueues } from './payout-default-jobs.js';

/**
 * Cấu hình của `organizer` (env vai api): gốc URL IPN, môi trường Tingee (link portal) và khóa mã hóa Secret Token
 * Tingee của BTC (Story 2.6).
 */
export type OrganizerConfig = Pick<ApiConfig, 'API_PUBLIC_URL' | 'TINGEE_BASE_URL' | 'TINGEE_CREDENTIAL_KEYS'>;

/**
 * BTC và thành viên (FR-4). Cài cổng `AccessResolver` và đăng ký `PermissionGuard` làm guard toàn cục số 3 —
 * phải import sau `IdentityModule` để chạy sau `SessionGuard` và `ConsentGuard`. Cần `DbModule` và `JobsModule`
 * (enqueue email mời Admin, Story 2.4; email cảnh báo đổi tài khoản nhận tiền mặc định, Story 2.13-a; email báo chuyển
 * quyền Owner, Story 2.14; job "đã mở lại" dịch vụ thanh toán, Story 4.2) và `TingeeModule` (đọc danh sách tài khoản
 * Tingee của BTC, Story 2.6; dò dịch vụ thanh toán, Story 4.2) ở gốc DI.
 */
@Module({})
export class OrganizerModule {
  static forRoot(config: OrganizerConfig): DynamicModule {
    return {
      module: OrganizerModule,
      controllers: [
        OrganizationsController,
        MembershipsController,
        MembersController,
        InvitationsController,
        PayoutAccountController,
        PaymentServiceController,
      ],
      providers: [
        OrganizerService,
        MembersService,
        PayoutAccountService,
        { provide: PAYOUT_ACCOUNT_SETTINGS, useFactory: () => payoutAccountSettings(config) },
        AdminInvitationQueues,
        DefaultPayoutQueues,
        OwnershipTransferQueues,
        // Dịch vụ thanh toán (Story 4.2): "Kiểm tra lại" của Owner, tắt cờ khi lưu key mới.
        PaymentServiceQueues,
        PaymentServiceProber,
        PaymentServiceService,
        { provide: PAYMENT_SERVICE_SETTINGS, useFactory: () => paymentServiceSettings(config) },
        { provide: ACCESS_RESOLVER, useClass: MemberAccessResolver },
        { provide: APP_GUARD, useClass: PermissionGuard },
      ],
    };
  }
}
