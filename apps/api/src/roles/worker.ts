import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import type { WorkerConfig } from '../platform/config/index.js';
import { WorkerModule } from '../worker.module.js';
import { SHUTDOWN_SIGNALS } from './shared.js';

export async function runWorker(config: WorkerConfig): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(config), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // SIGTERM: boss.stop({ graceful: true }) qua shutdown hook rồi exit 0.
  app.enableShutdownHooks(SHUTDOWN_SIGNALS, { useProcessExit: true });
  await app.init();
  app.get(Logger).log('worker đã chạy', 'Bootstrap');
}
