import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ACCESS_RESOLVER, PermissionGuard } from '../../platform/access/index.js';
import { MemberAccessResolver } from './access-resolver.impl.js';
import { MembershipsController } from './memberships.controller.js';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizerService } from './organizer.service.js';

/** Cấu hình của `organizer` (chưa có khóa nào; giữ chữ ký `forRoot(config)` như các mô-đun khác). */
export type OrganizerConfig = object;

/**
 * BTC và thành viên (FR-4). Cài cổng `AccessResolver` và đăng ký `PermissionGuard` làm guard toàn cục số 3 —
 * phải import sau `IdentityModule` để chạy sau `SessionGuard` và `ConsentGuard`. Cần `DbModule` ở gốc DI.
 */
@Module({})
export class OrganizerModule {
  static forRoot(_config: OrganizerConfig = {}): DynamicModule {
    return {
      module: OrganizerModule,
      controllers: [OrganizationsController, MembershipsController],
      providers: [
        OrganizerService,
        { provide: ACCESS_RESOLVER, useClass: MemberAccessResolver },
        { provide: APP_GUARD, useClass: PermissionGuard },
      ],
    };
  }
}
