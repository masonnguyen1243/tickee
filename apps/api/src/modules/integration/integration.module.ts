import { Module, type DynamicModule } from '@nestjs/common';
import { googleSheetsRedirectUri } from '@tickee/contracts';
import type { ApiConfig } from '../../platform/config/index.js';
import { integrationProviders, type IntegrationConfig } from './integration.config.js';
import { SheetConnectionController } from './sheet-connection.controller.js';
import { SHEETS_OAUTH_SETTINGS, SheetConnectionService, type SheetsOauthSettings } from './sheet-connection.service.js';
import { SheetOauthController, SheetsCallbackExceptionFilter } from './sheet-oauth.controller.js';
import { SheetSyncQueues } from './sheet-sync-jobs.js';

/** Cấu hình của `integration` ở vai api: nhóm Google Sheets, cùng origin api (redirect URI) và web (đích 302). */
export type IntegrationApiConfig = IntegrationConfig & Pick<ApiConfig, 'API_PUBLIC_URL' | 'WEB_ORIGIN'>;

/**
 * Tích hợp Google Sheets (Story 6.4, FR-32, AD-23) cho vai api: route BTC dưới `…/events/:eventId/google-sheets` (dùng
 * `PermissionGuard` toàn cục của `OrganizerModule`) và callback OAuth `GET /v1/integrations/google-sheets/callback`. Chỉ
 * enqueue lần đẩy đầu; worker tạo và ghi Sheet (`IntegrationJobsModule`). Cần `DbModule` và `JobsModule` ở gốc DI.
 */
@Module({})
export class IntegrationModule {
  static forRoot(config: IntegrationApiConfig): DynamicModule {
    return {
      module: IntegrationModule,
      controllers: [SheetConnectionController, SheetOauthController],
      providers: [
        ...integrationProviders(config),
        {
          provide: SHEETS_OAUTH_SETTINGS,
          useValue: {
            redirectUri: googleSheetsRedirectUri(config.API_PUBLIC_URL),
            webOrigin: config.WEB_ORIGIN,
          } satisfies SheetsOauthSettings,
        },
        SheetSyncQueues,
        SheetConnectionService,
        SheetsCallbackExceptionFilter,
      ],
    };
  }
}
