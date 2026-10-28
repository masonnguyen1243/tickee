import { defineConfig } from 'vitest/config';

// Postgres 18 thật (docker compose hoặc service container của CI). Mặc định DB `tickee_test`.
const TEST_DATABASE_URL = 'postgresql://tickee_app:tickee_app@localhost:5432/tickee_test';
const TEST_MIGRATION_DATABASE_URL = 'postgresql://tickee_migrator:tickee_migrator@localhost:5432/tickee_test';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/fixtures/**'],
    globalSetup: ['test/global-setup.ts'],
    // db.test và roles.process.test cùng chạy migrate trên tickee_test: không chạy song song.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? TEST_DATABASE_URL,
      MIGRATION_DATABASE_URL: process.env.MIGRATION_DATABASE_URL ?? TEST_MIGRATION_DATABASE_URL,
    },
  },
});
