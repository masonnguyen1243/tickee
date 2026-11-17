import type { IncomingMessage } from 'node:http';
import { Inject, Injectable, Logger as NestLogger, type OnModuleInit } from '@nestjs/common';
import { Logger, LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { basePinoOptions, genReqId, httpSerializers } from './pino-options.js';

const PROBE_PATHS = new Set(['/healthz', '/readyz']);

export interface LoggingOptions {
  level: string;
  /** Mặc định stdout; test truyền stream để đọc log. */
  destination?: DestinationStream;
}

/** Logger pino JSON cho mọi vai; `requestId` gắn vào mọi log trong request. */
export function createLoggerModule({ level, destination }: LoggingOptions) {
  const options = {
    ...basePinoOptions(level),
    genReqId,
    serializers: httpSerializers,
    customProps: (req: IncomingMessage & { id?: unknown }) => ({ requestId: req.id }),
    autoLogging: { ignore: (req: IncomingMessage) => PROBE_PATHS.has((req.url ?? '').split('?')[0] ?? '') },
  };
  // `assignResponse`: trường gắn bằng `assignLogContext` (vd. `organizationId` sau `PermissionGuard`, Story 4.6-a) vào cả
  // dòng log kết thúc request của pino-http.
  return LoggerModule.forRoot({ pinoHttp: destination ? [options, destination] : options, assignResponse: true });
}

/**
 * Vai worker: `NestFactory.createApplicationContext` chạy init (cả `onApplicationBootstrap`, nơi worker pg-boss bắt đầu nhận
 * job) TRƯỚC khi `runWorker` kịp `useLogger`, nên log của job xử lý lúc khởi động bị đệm rồi in lại sau, mất ngữ cảnh log
 * (`queue`, `jobId`) và `traceId` của span (Story 4.6-a). Provider này chuyển logger của Nest sang pino ngay cuối giai đoạn
 * `onModuleInit` (gốc DI chạy sau cùng), trước mọi `onApplicationBootstrap`, và in phần đã đệm.
 */
@Injectable()
export class UsePinoLoggerBeforeBootstrap implements OnModuleInit {
  constructor(@Inject(Logger) private readonly logger: Logger) {}

  onModuleInit(): void {
    NestLogger.overrideLogger(this.logger);
    NestLogger.flush();
  }
}
