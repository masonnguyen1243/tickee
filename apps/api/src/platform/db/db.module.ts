import { Global, Inject, Injectable, Module, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import { Database } from './database.js';

export const DATABASE = Symbol('DATABASE');

@Injectable()
class DatabaseCloser implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.close();
  }
}

@Global()
@Module({})
export class DbModule {
  static forRoot(options: { connectionString: string; applicationName?: string }): DynamicModule {
    return {
      module: DbModule,
      providers: [{ provide: DATABASE, useFactory: () => new Database(options) }, DatabaseCloser],
      exports: [DATABASE],
    };
  }
}
