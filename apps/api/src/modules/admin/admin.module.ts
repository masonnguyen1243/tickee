import {
  Inject,
  Logger,
  Module,
  RequestMethod,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { ApiConfig } from '../../platform/config/index.js';
import { PaymentServiceQueues } from '../organizer/index.js';
import {
  ADMIN_IP_ALLOWLIST,
  adminIpAllowlist,
  AdminIpMiddleware,
  type AdminIpAllowlist,
} from './admin-ip.middleware.js';
import { ClosedBetaController } from './closed-beta.controller.js';
import { DeadLetterAdminController } from './dead-letter.controller.js';
import { PaymentServiceAdminController } from './payment-service.controller.js';

/** Cấu hình của khu `/v1/admin/*`, chỉ vai api. */
export type AdminConfig = Pick<ApiConfig, 'ADMIN_ALLOWED_CIDRS'>;

/**
 * Khu Quản trị Tingee `/v1/admin/*` (AD-26). Mọi controller ở đây mang `@RequirePlatformAdmin()`; guard nằm ở
 * `identity` (đăng ký toàn cục), nên `admin` không phụ thuộc `identity`. Cần `DbModule` và `JobsModule` (toàn cục; mở lại
 * dịch vụ thanh toán enqueue job "đã mở lại", Story 4.2; requeue job dead-letter, Story 4.6-d) ở gốc DI.
 *
 * Giới hạn IP (Story 4.7-a): có `ADMIN_ALLOWED_CIDRS` thì `AdminIpMiddleware` chặn mọi đường dẫn `/v1/admin` và
 * `/v1/admin/*` (global prefix `v1` tự áp cho middleware) trước mọi guard; không có (chỉ `development`/`test`, schema
 * bắt buộc ở production) thì không giới hạn và log `warn` một lần lúc khởi động. Có thì log `info` một lần với số dải
 * IPv4/IPv6 (không nêu địa chỉ), để kiểm sau deploy là giới hạn đã nạp.
 */
@Module({})
export class AdminModule implements NestModule, OnApplicationBootstrap {
  private readonly logger = new Logger('AdminModule');

  constructor(@Inject(ADMIN_IP_ALLOWLIST) private readonly allowlist: AdminIpAllowlist | null) {}

  static forRoot(config: AdminConfig): DynamicModule {
    const cidrs = config.ADMIN_ALLOWED_CIDRS;
    return {
      module: AdminModule,
      controllers: [ClosedBetaController, PaymentServiceAdminController, DeadLetterAdminController],
      providers: [
        PaymentServiceQueues,
        { provide: ADMIN_IP_ALLOWLIST, useValue: cidrs ? adminIpAllowlist(cidrs) : null },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    if (!this.allowlist) return;
    consumer
      .apply(AdminIpMiddleware)
      .forRoutes({ path: 'admin', method: RequestMethod.ALL }, { path: 'admin/{*path}', method: RequestMethod.ALL });
  }

  onApplicationBootstrap(): void {
    if (!this.allowlist) {
      this.logger.warn('Chưa đặt ADMIN_ALLOWED_CIDRS: /v1/admin/* nhận request từ mọi IP (chỉ được ở development/test)');
      return;
    }
    const { ipv4Ranges, ipv6Ranges } = this.allowlist;
    this.logger.log({ ipv4Ranges, ipv6Ranges }, 'Giới hạn IP /v1/admin/* theo ADMIN_ALLOWED_CIDRS đã bật');
  }
}
