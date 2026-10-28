import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/**/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
  // pg-boss tự quản schema `pgboss`; drizzle-kit chỉ nhìn `public`.
  schemaFilter: ['public'],
  dbCredentials: {
    url: process.env.MIGRATION_DATABASE_URL ?? '',
  },
});
