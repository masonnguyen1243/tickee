import { z } from 'zod';

export const APP_ROLES = ['api', 'worker', 'migrate'] as const;
export type AppRole = (typeof APP_ROLES)[number];

const postgresUrl = z
  .string()
  .min(1)
  .refine((v) => /^postgres(ql)?:\/\//.test(v), { message: 'phải là URL postgres:// hoặc postgresql://' });

const common = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
};

export const apiConfigSchema = z.object({
  APP_ROLE: z.literal('api'),
  ...common,
  DATABASE_URL: postgresUrl,
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
});

export const workerConfigSchema = z.object({
  APP_ROLE: z.literal('worker'),
  ...common,
  DATABASE_URL: postgresUrl,
});

export const migrateConfigSchema = z.object({
  APP_ROLE: z.literal('migrate'),
  ...common,
  MIGRATION_DATABASE_URL: postgresUrl,
});

export const roleSchemas = {
  api: apiConfigSchema,
  worker: workerConfigSchema,
  migrate: migrateConfigSchema,
} as const;

export type ApiConfig = z.infer<typeof apiConfigSchema>;
export type WorkerConfig = z.infer<typeof workerConfigSchema>;
export type MigrateConfig = z.infer<typeof migrateConfigSchema>;
export type AppConfig = ApiConfig | WorkerConfig | MigrateConfig;
