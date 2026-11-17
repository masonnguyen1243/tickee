import { Global, Module, type DynamicModule, type Provider } from '@nestjs/common';
import { OpsAlerts } from '../../platform/alerts/index.js';
import { PaymentLinkLatencyMonitor, type PaymentLinkLatencyAlertSettings } from './link-latency-alert.js';
import { HttpTingeeClient, TINGEE_CLIENT, type TingeeClientOptions } from './tingee.client.js';

/**
 * Cấu hình của `tingee` (từ `TINGEE_BASE_URL` của vai api và worker). Credential là của từng BTC, truyền theo từng lời
 * gọi. `linkLatencyAlert` (chỉ vai api, nơi gọi `create-link`): ngưỡng của luật cảnh báo `payment_link_slow` (Story
 * 4.6-e); không đặt thì không có cửa sổ p95 (vai worker).
 */
export type TingeeConfig = Pick<TingeeClientOptions, 'baseUrl'> & {
  linkLatencyAlert?: Pick<PaymentLinkLatencyAlertSettings, 'p95Ms' | 'minSamples'>;
};

/**
 * Cung cấp `TINGEE_CLIENT` cho mọi mô-đun (adapter duy nhất gọi Tingee, AD-9). Không sở hữu bảng nào. Có
 * `linkLatencyAlert`: thêm `PaymentLinkLatencyMonitor` (báo qua `OpsAlerts` toàn cục của `AlertsModule`) và nối thời
 * lượng `create-link` của adapter vào đó.
 */
@Global()
@Module({})
export class TingeeModule {
  static forRoot(config: TingeeConfig): DynamicModule {
    const alert = config.linkLatencyAlert;
    const providers: Provider[] = alert
      ? [
          {
            provide: PaymentLinkLatencyMonitor,
            useFactory: (alerts: OpsAlerts) => new PaymentLinkLatencyMonitor(alerts, alert),
            inject: [OpsAlerts],
          },
          {
            provide: TINGEE_CLIENT,
            useFactory: (monitor: PaymentLinkLatencyMonitor) =>
              new HttpTingeeClient({
                baseUrl: config.baseUrl,
                onPaymentLinkDuration: (seconds, outcome) => void monitor.record(seconds, outcome),
              }),
            inject: [PaymentLinkLatencyMonitor],
          },
        ]
      : [{ provide: TINGEE_CLIENT, useFactory: () => new HttpTingeeClient({ baseUrl: config.baseUrl }) }];
    return {
      module: TingeeModule,
      providers,
      exports: [TINGEE_CLIENT, ...(alert ? [PaymentLinkLatencyMonitor] : [])],
    };
  }
}
