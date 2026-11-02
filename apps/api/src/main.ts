import 'reflect-metadata';
import { pino } from 'pino';
import { ConfigError, loadConfig, type AppConfig } from './platform/config/index.js';
import { basePinoOptions } from './platform/logging/index.js';

// `context` thay cho `name` của pino: trùng khóa mà log Nest dùng (`context: 'ErrorFilter'`…), nên log khởi động đọc
// cùng kiểu với log của app. (`name` không bị che ở gốc, chỉ `user.name` bị che.)
const bootLog = pino(basePinoOptions(process.env.LOG_LEVEL === 'silent' ? 'silent' : 'info')).child({
  context: 'Bootstrap',
});

async function main(): Promise<void> {
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      bootLog.fatal({ issues: err.issues }, err.message);
      process.exit(1);
    }
    throw err;
  }

  switch (config.APP_ROLE) {
    case 'api': {
      const { runApi } = await import('./roles/api.js');
      await runApi(config);
      return;
    }
    case 'worker': {
      const { runWorker } = await import('./roles/worker.js');
      await runWorker(config);
      return;
    }
    case 'migrate': {
      const { runMigrations } = await import('./roles/migrate.js');
      await runMigrations(config, bootLog);
      bootLog.info('migrate xong');
      process.exit(0);
    }
  }
}

main().catch((err: unknown) => {
  bootLog.fatal({ err }, 'Khởi động thất bại');
  process.exit(1);
});
