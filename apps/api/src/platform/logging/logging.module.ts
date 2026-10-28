import type { IncomingMessage } from 'node:http';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { basePinoOptions, genReqId } from './pino-options.js';

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
    customProps: (req: IncomingMessage & { id?: unknown }) => ({ requestId: req.id }),
    autoLogging: { ignore: (req: IncomingMessage) => PROBE_PATHS.has((req.url ?? '').split('?')[0] ?? '') },
  };
  return LoggerModule.forRoot({ pinoHttp: destination ? [options, destination] : options });
}
