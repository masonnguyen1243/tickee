import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { JobQueue } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { purgeExpired, PURGE_EXPIRED_CRON } from '../../src/modules/identity/identity-janitor.js';
import { Database } from '../../src/platform/db/index.js';
import { BOSS, PGBOSS_SCHEMA } from '../../src/platform/jobs/index.js';
import { WorkerModule } from '../../src/worker.module.js';
import { databaseUrl } from '../helpers.js';
import { createHarness } from './harness.js';

/** Job `identity.purge-expired` (retro Epic 1, AI-2): dọn rác ở vai `worker`, không trong transaction gửi OTP. */

const QUEUE = JobQueue.IDENTITY_PURGE_EXPIRED;

let db: Database;

beforeAll(() => {
  db = new Database({ connectionString: databaseUrl(), max: 2 });
});
afterAll(async () => {
  await db.close();
});

const startWorker = async () => {
  const app = await NestFactory.createApplicationContext(
    WorkerModule.forRoot({ APP_ROLE: 'worker', NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: databaseUrl() }),
    { logger: false },
  );
  await app.init();
  return app;
};

interface Seeded {
  tag: string;
  userId: string;
}

/** Mỗi bảng một dòng đã quá hạn giữ (`cu`) và một dòng còn hạn (`moi`), gắn `tag` riêng của test. */
async function seed(): Promise<Seeded> {
  const tag = randomUUID();
  const owner = await db.orm.execute<{ id: string }>(
    sql`INSERT INTO users (email) VALUES (${`don-rac-${tag}@vidu.vn`}) RETURNING id`,
  );
  const userId = owner.rows[0]!.id;
  await db.orm.execute(sql`INSERT INTO otp_send_events (email_hmac, ip_hmac, created_at) VALUES
    (${`cu-${tag}`}, ${tag}, now() - interval '61 minutes'), (${`moi-${tag}`}, ${tag}, now() - interval '59 minutes')`);
  await db.orm.execute(sql`INSERT INTO google_start_events (ip_hmac, created_at) VALUES
    (${`cu-${tag}`}, now() - interval '61 minutes'), (${`moi-${tag}`}, now() - interval '59 minutes')`);
  await db.orm.execute(sql`INSERT INTO otp_verify_failures (email_hmac, created_at) VALUES
    (${`cu-${tag}`}, now() - interval '25 hours'), (${`moi-${tag}`}, now() - interval '23 hours')`);
  // Verification vừa hết hạn (< 24 giờ) phải còn để người dùng nhận OTP_EXPIRED.
  await db.orm.execute(sql`INSERT INTO verifications (identifier, value, expires_at) VALUES
    (${`cu-${tag}`}, 'x:0', now() - interval '25 hours'), (${`moi-${tag}`}, 'x:0', now() - interval '23 hours')`);
  await db.orm.execute(sql`INSERT INTO sessions (user_id, token, expires_at) VALUES
    (${userId}, ${`cu-${tag}`}, now() - interval '25 hours'), (${userId}, ${`moi-${tag}`}, now() - interval '23 hours')`);
  return { tag, userId };
}

/** Khóa còn lại của từng bảng (bỏ tiền tố `cu-`/`moi-` → chỉ giữ tiền tố). */
async function remaining({ tag, userId }: Seeded): Promise<Record<string, string[]>> {
  const pick = async (query: ReturnType<typeof sql>) =>
    (await db.orm.execute<{ k: string }>(query)).rows.map((r) => r.k.replace(`-${tag}`, '')).sort();
  return {
    otpSendEvents: await pick(sql`SELECT email_hmac AS k FROM otp_send_events WHERE ip_hmac = ${tag}`),
    googleStartEvents: await pick(
      sql`SELECT ip_hmac AS k FROM google_start_events WHERE ip_hmac IN (${`cu-${tag}`}, ${`moi-${tag}`})`,
    ),
    otpVerifyFailures: await pick(
      sql`SELECT email_hmac AS k FROM otp_verify_failures WHERE email_hmac IN (${`cu-${tag}`}, ${`moi-${tag}`})`,
    ),
    verifications: await pick(
      sql`SELECT identifier AS k FROM verifications WHERE identifier IN (${`cu-${tag}`}, ${`moi-${tag}`})`,
    ),
    sessions: await pick(sql`SELECT token AS k FROM sessions WHERE user_id = ${userId}`),
  };
}

const ONLY_FRESH = {
  otpSendEvents: ['moi'],
  googleStartEvents: ['moi'],
  otpVerifyFailures: ['moi'],
  verifications: ['moi'],
  sessions: ['moi'],
};

describe('purgeExpired', () => {
  it('xóa rác quá hạn giữ, giữ dòng còn hạn; chạy lại không đổi gì (idempotent)', async () => {
    const seeded = await seed();
    await purgeExpired(db);
    expect(await remaining(seeded)).toEqual(ONLY_FRESH);
    await purgeExpired(db);
    expect(await remaining(seeded)).toEqual(ONLY_FRESH);
  });
});

describe('job identity.purge-expired', () => {
  it('vai api không đăng ký lịch nào; vai worker đăng ký đúng một lịch mỗi 10 phút, khởi động lại vẫn một', async () => {
    // Boss riêng chỉ để đọc/xóa lịch: không chạy cron hay bảo trì, không migrate (chỉ worker thật mới gửi job).
    const reader = new PgBoss({
      connectionString: databaseUrl(),
      schema: PGBOSS_SCHEMA,
      application_name: 'tickee-test',
      migrate: false,
      createSchema: false,
      schedule: false,
      supervise: false,
    });
    await reader.start();
    try {
      await reader.unschedule(QUEUE);
      const api = await createHarness();
      await api.close();
      expect(await reader.getSchedules(QUEUE)).toEqual([]);

      for (let run = 0; run < 2; run += 1) {
        const worker = await startWorker();
        await worker.close();
      }
      const schedules = await reader.getSchedules(QUEUE);
      expect(schedules).toHaveLength(1);
      expect(schedules[0]).toMatchObject({ name: QUEUE, cron: PURGE_EXPIRED_CRON });
    } finally {
      // Không để lịch */10 sống trong DB test dùng chung.
      await reader.unschedule(QUEUE);
      await reader.stop({ graceful: false, close: true });
    }
  });

  it('worker xử lý job: rác cũ bị xóa, dòng còn hạn còn nguyên', async () => {
    const seeded = await seed();
    const worker = await startWorker();
    try {
      const boss = worker.get<PgBoss>(BOSS);
      const jobId = await boss.send(QUEUE, {});
      expect(jobId).toBeTruthy();
      await expect
        .poll(async () => (await boss.getJobById(QUEUE, jobId!))?.state, { timeout: 15_000, interval: 200 })
        .toBe('completed');
      expect(await remaining(seeded)).toEqual(ONLY_FRESH);
    } finally {
      // Worker vừa đăng ký lại lịch: gỡ đi để không để lịch sống trong DB test dùng chung.
      await worker.get<PgBoss>(BOSS).unschedule(QUEUE);
      await worker.close();
    }
  });
});
