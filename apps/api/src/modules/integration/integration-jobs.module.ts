import { Module, type DynamicModule } from '@nestjs/common';
import type { WorkerConfig } from '../../platform/config/index.js';
import { integrationProviders, type IntegrationConfig } from './integration.config.js';
import { SheetFlushWorker } from './sheet-flush-jobs.js';
import { SHEET_FLUSH_SETTINGS, SHEET_FLUSH_WINDOW_SECONDS, type SheetFlushSettings } from './sheet-flush-queue.js';
import {
  SHEETS_REVOKED_EMAIL_SETTINGS,
  SheetRevokedEmailWorker,
  type SheetsRevokedEmailSettings,
} from './sheet-revoked-email-jobs.js';
import { SheetSyncWorker } from './sheet-sync-jobs.js';

/** Cấu hình `integration` ở vai worker: nhóm Google Sheets và origin web (link "Kết nối lại" trong email, Story 6.6). */
export type IntegrationJobsConfig = IntegrationConfig & Pick<WorkerConfig, 'WEB_ORIGIN'>;

/** Tùy chọn của `IntegrationJobsModule` ngoài env (test rút ngắn cửa sổ debounce của flush). */
export interface IntegrationJobsOptions {
  /** Cửa sổ debounce của flush (giây); mặc định `SHEET_FLUSH_WINDOW_SECONDS` (45, Quyết định 4 của Story 6.5). */
  flushWindowSeconds?: number;
}

/**
 * Job nền của `integration` cho vai `worker`: lần đẩy đầu lên Google Sheets (Story 6.4), đánh dấu dòng bẩn
 * (`sheet_row_changed`) và flush (Story 6.5), email mất quyền cho Owner/Admin (Story 6.6). Cần `DbModule`, `JobsModule`
 * và `EmailModule` (toàn cục) ở gốc DI.
 */
@Module({})
export class IntegrationJobsModule {
  static forRoot(config: IntegrationJobsConfig, options: IntegrationJobsOptions = {}): DynamicModule {
    return {
      module: IntegrationJobsModule,
      providers: [
        ...integrationProviders(config),
        {
          provide: SHEET_FLUSH_SETTINGS,
          useValue: { windowSeconds: options.flushWindowSeconds ?? SHEET_FLUSH_WINDOW_SECONDS } satisfies SheetFlushSettings,
        },
        {
          provide: SHEETS_REVOKED_EMAIL_SETTINGS,
          useValue: { webOrigin: config.WEB_ORIGIN } satisfies SheetsRevokedEmailSettings,
        },
        SheetSyncWorker,
        SheetFlushWorker,
        SheetRevokedEmailWorker,
      ],
    };
  }
}
