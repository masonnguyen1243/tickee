import 'reflect-metadata';
import { pino } from 'pino';
import {
  ConfigError,
  loadConfig,
  NODE_ENV_NOT_PRODUCTION,
  productionLookingOrigins,
  type AppConfig,
} from './platform/config/index.js';
// Thẳng `pino-options` (không qua `logging/index`, vốn nạp pg): trước khi telemetry đăng ký hook, chưa nạp express hay pg.
import { basePinoOptions } from './platform/logging/pino-options.js';
// Thẳng `state.js` (không qua `telemetry/index`, vốn nạp @nestjs/common và @opentelemetry/core trước hook).
import { telemetryErrorSummary } from './platform/telemetry/state.js';

// `context` thay cho `name` của pino: trùng khóa mà log Nest dùng (`context: 'ErrorFilter'`…), nên log khởi động đọc
// cùng kiểu với log của app. (`name` không bị che ở gốc, chỉ `user.name` bị che.)
const bootLog = pino(basePinoOptions(process.env.LOG_LEVEL === 'silent' ? 'silent' : 'info')).child({
  context: 'Bootstrap',
});

/**
 * OpenTelemetry (Story 4.6-a) cho vai api và worker, khi có `OTEL_EXPORTER_OTLP_ENDPOINT`: khởi SDK và hook nạp mô-đun
 * TRƯỚC khi nạp vai (vai được `import` động, nên express và pg nạp sau hook). Không có endpoint thì không nạp SDK. Lỗi khởi
 * chỉ log `warn`: thiếu số liệu không được làm sập api.
 */
async function startTelemetryIfConfigured(config: AppConfig): Promise<void> {
  if (config.APP_ROLE === 'migrate' || !config.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  const log = pino(basePinoOptions(config.LOG_LEVEL)).child({ context: 'Telemetry' });
  try {
    const { startTelemetry } = await import('./platform/telemetry/sdk.js');
    startTelemetry(config, log);
  } catch (err) {
    log.warn({ err: telemetryErrorSummary(err) }, 'Không bật được OpenTelemetry');
  }
}

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

  // Story 4.7-f: env runtime đặt `NODE_ENV=development` (chép từ `.env.example`) đè `production` của image thì mọi luật
  // production tắt mà không lỗi gì. Chỉ cảnh báo, không chặn khởi động; log tên biến, không log giá trị.
  const productionLooking = productionLookingOrigins(config);
  if (productionLooking.length > 0) {
    bootLog.warn(
      { marker: NODE_ENV_NOT_PRODUCTION, variables: productionLooking },
      'NODE_ENV khác production nhưng origin là https trên host thật: mọi luật production đang tắt. ' +
        'Môi trường thật phải đặt NODE_ENV=production',
    );
  }

  await startTelemetryIfConfigured(config);

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
