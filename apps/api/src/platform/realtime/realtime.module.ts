import { Global, Module, type DynamicModule } from '@nestjs/common';
import { REALTIME_OPTIONS, RealtimeHub, type RealtimeOptions } from './realtime-hub.js';

/**
 * Hub realtime (AD-17), chỉ vai api: một kết nối `LISTEN` mỗi instance, SSE theo bộ lọc của từng mô-đun. Toàn cục để
 * controller của mô-đun miền (`ordering`, sau này `reporting`…) và `/readyz` dùng chung một hub. Vai worker chỉ phát
 * tín hiệu bằng `realtime.notify(tx, …)`, không cần mô-đun này.
 */
@Global()
@Module({})
export class RealtimeModule {
  static forRoot(options: RealtimeOptions): DynamicModule {
    return {
      module: RealtimeModule,
      providers: [{ provide: REALTIME_OPTIONS, useValue: options }, RealtimeHub],
      exports: [RealtimeHub],
    };
  }
}
