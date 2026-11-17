import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setActiveTelemetry, shutdownTelemetry } from '../../src/platform/telemetry/index.js';
import { WorkerModule } from '../../src/worker.module.js';
import { workerConfig } from '../helpers.js';

/*
 * Story 4.6-a: `TelemetryModule` (toàn cục, đầu `imports` của gốc DI) tắt SDK SAU khi pg-boss đã dừng, để span của những
 * việc chạy lúc tắt vẫn kịp xuất. SDK giả: chỉ ghi lúc `shutdown` được gọi.
 */

afterEach(async () => {
  vi.restoreAllMocks();
  await shutdownTelemetry();
});

describe('thứ tự tắt của vai worker', () => {
  it('app.close(): pg-boss dừng ("pg-boss đã dừng") rồi mới tới shutdown của SDK OpenTelemetry', async () => {
    const order: string[] = [];
    const log = vi.spyOn(Logger.prototype, 'log');
    log.mockImplementation(function (this: Logger, message: unknown) {
      if (message === 'pg-boss đã dừng') order.push('boss-stopped');
    });
    const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(workerConfig()), { logger: false });
    const shutdown = vi.fn(async () => {
      order.push('telemetry-shutdown');
    });
    setActiveTelemetry({ shutdown, warn: () => {} });
    await app.close();
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['boss-stopped', 'telemetry-shutdown']);
  });
});
