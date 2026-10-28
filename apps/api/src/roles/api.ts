import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { ApiModule } from '../api.module.js';
import type { ApiConfig } from '../platform/config/index.js';
import { SHUTDOWN_SIGNALS } from './shared.js';


/** Cấu hình dùng chung cho app HTTP (cả khi chạy thật lẫn trong test). */
export function configureApiApp<T extends INestApplication>(app: T, options: { shutdownHooks?: boolean } = {}): T {
  app.useLogger(app.get(Logger));
  (app as unknown as NestExpressApplication).disable('x-powered-by');
  app.setGlobalPrefix('v1', { exclude: ['healthz', 'readyz'] });
  if (options.shutdownHooks ?? true) {
    // SIGTERM: đóng HTTP, chạy shutdown hook rồi exit 0.
    app.enableShutdownHooks(SHUTDOWN_SIGNALS, { useProcessExit: true });
  }
  return app;
}

export async function runApi(config: ApiConfig): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(ApiModule.forRoot(config), { bufferLogs: true });
  configureApiApp(app);
  await app.listen(config.PORT);
  app.get(Logger).log(`api đang nghe cổng ${config.PORT}`, 'Bootstrap');
}
