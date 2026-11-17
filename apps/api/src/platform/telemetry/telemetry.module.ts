import { Global, Injectable, Module, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { HttpRouteInterceptor } from './http-route.js';
import { shutdownTelemetry } from './state.js';

/**
 * Tắt SDK OpenTelemetry (do `main.ts` khởi trước khi nạp vai): flush rồi shutdown, tối đa 5 giây, không bao giờ ném.
 * Telemetry tắt thì không làm gì.
 */
@Injectable()
class TelemetryLifecycle implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await shutdownTelemetry();
  }
}

export interface TelemetryModuleOptions {
  /** Vai api: đặt mẫu route Nest lên span server (`HttpRouteInterceptor`). */
  httpRoutes: boolean;
}

/**
 * Phần Nest của OpenTelemetry (Story 4.6-a). SDK khởi trong `main.ts` (trước khi nạp express, pg), không ở đây.
 *
 * Toàn cục và nằm ĐẦU `imports` của gốc DI: Nest gọi `onApplicationShutdown` theo thứ tự ngược lúc khởi, nên mô-đun này
 * tắt sau cùng, sau pg-boss (`JobsModule`), để span của những việc chạy lúc tắt vẫn kịp xuất.
 */
@Global()
@Module({})
export class TelemetryModule {
  static forRoot({ httpRoutes }: TelemetryModuleOptions): DynamicModule {
    return {
      module: TelemetryModule,
      providers: [TelemetryLifecycle, ...(httpRoutes ? [{ provide: APP_INTERCEPTOR, useClass: HttpRouteInterceptor }] : [])],
    };
  }
}
