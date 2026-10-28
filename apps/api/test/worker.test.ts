import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { PgBoss } from 'pg-boss';
import { describe, expect, it } from 'vitest';
import { BOSS } from '../src/platform/jobs/index.js';
import { WorkerModule } from '../src/worker.module.js';
import { databaseUrl } from './helpers.js';

describe('vai worker', () => {
  it('pg-boss start bằng tickee_app (migrate: false), xử lý job, rồi stop graceful', async () => {
    const app = await NestFactory.createApplicationContext(
      WorkerModule.forRoot({ APP_ROLE: 'worker', NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: databaseUrl() }),
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
});
