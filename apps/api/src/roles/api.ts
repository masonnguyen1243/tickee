import type { INestApplication, NestApplicationOptions } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { ApiModule } from '../api.module.js';
import { APP_CONFIG, type ApiConfig } from '../platform/config/index.js';
import { SHUTDOWN_SIGNALS } from './shared.js';

/**
 * Tùy chọn tạo app HTTP (cả khi chạy thật lẫn trong test). Tắt body parser của Nest: Better Auth tự đọc body
 * ở `/v1/auth/*`, còn `AuthModule` gắn lại parser JSON (kèm `rawBody`) cho các route khác.
 */
export const API_APP_OPTIONS = { bufferLogs: true, bodyParser: false } as const satisfies NestApplicationOptions;

/** Cấu hình dùng chung cho app HTTP (cả khi chạy thật lẫn trong test). */
export function configureApiApp<T extends INestApplication>(app: T, options: { shutdownHooks?: boolean } = {}): T {
  const config = app.get<ApiConfig>(APP_CONFIG);
  app.useLogger(app.get(Logger));
  const express = app as unknown as NestExpressApplication;
  express.disable('x-powered-by');
  // Sau load balancer: `req.ip` lấy từ X-Forwarded-For, bỏ qua đúng số hop tin cậy (không tin header do client tự gửi).
  if (config.TRUST_PROXY_HOPS > 0) express.set('trust proxy', config.TRUST_PROXY_HOPS);
  // Chỉ web origin được gọi kèm cookie; origin lạ không nhận header Access-Control-Allow-Origin.
  app.enableCors({ origin: [config.WEB_ORIGIN], credentials: true });
  app.setGlobalPrefix('v1', { exclude: ['healthz', 'readyz'] });
  if (options.shutdownHooks ?? true) {
    // SIGTERM: đóng HTTP, chạy shutdown hook rồi exit 0.
    app.enableShutdownHooks(SHUTDOWN_SIGNALS, { useProcessExit: true });
  }
  return app;
}

export async function runApi(config: ApiConfig): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(ApiModule.forRoot(config), API_APP_OPTIONS);
  configureApiApp(app);
  await app.listen(config.PORT);
  app.get(Logger).log(`api đang nghe cổng ${config.PORT}`, 'Bootstrap');
}
