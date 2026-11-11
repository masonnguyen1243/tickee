import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { PgBoss } from 'pg-boss';
import { describe, expect, it } from 'vitest';
import { OrderPayments } from '../src/modules/ordering/index.js';
import { IpnProcessor } from '../src/modules/payment/index.js';
import { TicketsService } from '../src/modules/ticketing/index.js';
import { TINGEE_CLIENT } from '../src/modules/tingee/index.js';
import { ConfigError, loadConfig } from '../src/platform/config/index.js';
import { BOSS } from '../src/platform/jobs/index.js';
import { WorkerModule } from '../src/worker.module.js';
import { workerConfig } from './helpers.js';

describe('vai worker', () => {
  it('pg-boss start bằng tickee_app (migrate: false), xử lý job, rồi stop graceful', async () => {
    const app = await NestFactory.createApplicationContext(
      WorkerModule.forRoot(workerConfig()),
      { logger: false },
    );
    try {
      await app.init();
      const boss = app.get<PgBoss>(BOSS);
      const queue = `platform.seed_check_${Date.now()}`;
      await boss.createQueue(queue);
      const done = new Promise<unknown>((resolve) => {
        void boss.work<{ n: number }>(queue, async ([job]) => resolve(job?.data));
      });
      await boss.send(queue, { n: 1 });
      await expect(done).resolves.toEqual({ n: 1 });
      await boss.deleteQueue(queue);
    } finally {
      await app.close();
    }
  });

  it('Story 3.5: DI resolve được lõi xử lý IPN, OrderPayments, Vé và Tingee (không có controller)', async () => {
    const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(workerConfig()), { logger: false });
    try {
      await app.init();
      expect(app.get(IpnProcessor)).toBeInstanceOf(IpnProcessor);
      expect(app.get(OrderPayments)).toBeInstanceOf(OrderPayments);
      expect(app.get(TicketsService)).toBeInstanceOf(TicketsService);
      expect(app.get(TINGEE_CLIENT)).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('Story 3.5: thiếu TINGEE_* hay TICKET_QR_KEYS → ConfigError nêu đúng tên biến', () => {
    const env: Record<string, string | undefined> = { ...workerConfig() };
    expect(loadConfig(env).APP_ROLE).toBe('worker');
    for (const variable of ['TINGEE_BASE_URL', 'TINGEE_CREDENTIAL_KEYS', 'TICKET_QR_KEYS']) {
      const error = (() => {
        try {
          loadConfig({ ...env, [variable]: undefined });
        } catch (err) {
          return err;
        }
        return null;
      })();
      expect(error, variable).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).issues, variable).toEqual([{ variable, reason: 'thiếu' }]);
    }
  });
});
