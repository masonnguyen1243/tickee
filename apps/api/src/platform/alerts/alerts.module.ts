import { Global, Module, type DynamicModule, type Provider } from '@nestjs/common';
import type { ApiConfig, WorkerConfig } from '../config/index.js';
import { OPS_ALERT_DELIVERY, OpsAlertEmailWorker, type OpsAlertDelivery } from './ops-alert-jobs.js';
import { OpsAlertRules, OpsAlertScanWorker, platformOpsAlertRules } from './ops-alert-scan.js';
import { OPS_ALERT_SETTINGS, OpsAlertQueue, OpsAlerts, type OpsAlertSettings } from './ops-alerts.js';

/** Cấu hình kênh cảnh báo vận hành chung cho vai api và worker. */
export type OpsAlertsConfig = Pick<ApiConfig, 'OPS_ALERT_COOLDOWN_MINUTES'>;

/** Cấu hình kênh cảnh báo vận hành của vai worker: thêm người nhận email và ngưỡng hàng đợi ùn. */
export type OpsAlertsWorkerConfig = Pick<
  WorkerConfig,
  'OPS_ALERT_COOLDOWN_MINUTES' | 'OPS_ALERT_EMAILS' | 'OPS_ALERT_QUEUE_WAIT_MINUTES'
>;

const raiseProviders = (config: OpsAlertsConfig): Provider[] => [
  {
    provide: OPS_ALERT_SETTINGS,
    useValue: { cooldownMinutes: config.OPS_ALERT_COOLDOWN_MINUTES } satisfies OpsAlertSettings,
  },
  OpsAlertQueue,
  OpsAlerts,
];

/**
 * Kênh cảnh báo vận hành (Story 4.6-b), toàn cục: mô-đun miền tiêm `OpsAlerts` để `raise` (qua `platform/alerts/index.ts`)
 * và `OpsAlertRules` để đăng ký luật cho job quét. Cần `DbModule` và `JobsModule` ở gốc DI; vai worker cần thêm
 * `EmailModule`.
 */
@Global()
@Module({})
export class AlertsModule {
  /** Vai api: chỉ `raise` (enqueue email cùng `tx` ghi dấu). Registry rỗng: vai api không quét. */
  static forRoot(config: OpsAlertsConfig): DynamicModule {
    return {
      module: AlertsModule,
      providers: [...raiseProviders(config), { provide: OpsAlertRules, useFactory: () => new OpsAlertRules() }],
      exports: [OpsAlerts, OpsAlertRules],
    };
  }

  /** Vai worker: `raise`, job gửi email tới `OPS_ALERT_EMAILS`, job quét mỗi phút với hai luật pg-boss của platform. */
  static forWorker(config: OpsAlertsWorkerConfig): DynamicModule {
    return {
      module: AlertsModule,
      providers: [
        ...raiseProviders(config),
        {
          provide: OpsAlertRules,
          useFactory: () => platformOpsAlertRules({ queueWaitMinutes: config.OPS_ALERT_QUEUE_WAIT_MINUTES }),
        },
        {
          provide: OPS_ALERT_DELIVERY,
          useValue: { recipients: config.OPS_ALERT_EMAILS ?? [] } satisfies OpsAlertDelivery,
        },
        OpsAlertEmailWorker,
        OpsAlertScanWorker,
      ],
      exports: [OpsAlerts, OpsAlertRules],
    };
  }
}
