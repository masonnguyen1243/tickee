import { Global, Inject, Injectable, Module, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import { EMAIL_TRANSPORT, type EmailTransport } from './email-transport.js';
import { SmtpEmailTransport, type SmtpTransportOptions } from './smtp-transport.js';

@Injectable()
class EmailTransportCloser implements OnApplicationShutdown {
  constructor(@Inject(EMAIL_TRANSPORT) private readonly transport: EmailTransport) {}

  onApplicationShutdown(): void {
    if (this.transport instanceof SmtpEmailTransport) this.transport.close();
  }
}

/** Cung cấp `EMAIL_TRANSPORT` (SMTP) cho mọi mô-đun. */
@Global()
@Module({})
export class EmailModule {
  static forRoot(options: SmtpTransportOptions): DynamicModule {
    return {
      module: EmailModule,
      providers: [{ provide: EMAIL_TRANSPORT, useFactory: () => new SmtpEmailTransport(options) }, EmailTransportCloser],
      exports: [EMAIL_TRANSPORT],
    };
  }
}
