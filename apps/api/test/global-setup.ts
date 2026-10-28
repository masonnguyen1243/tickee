import { runMigrations } from '../src/roles/migrate.js';

const DEFAULT_URL = 'postgresql://tickee_migrator:tickee_migrator@localhost:5432/tickee_test';

/** Chạy migration một lần trước toàn bộ test, đúng như vai `migrate`. */
export default async function setup(): Promise<void> {
  await runMigrations({ MIGRATION_DATABASE_URL: process.env.MIGRATION_DATABASE_URL ?? DEFAULT_URL });
}
