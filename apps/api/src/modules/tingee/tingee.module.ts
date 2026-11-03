import { Global, Module, type DynamicModule } from '@nestjs/common';
import { HttpTingeeClient, TINGEE_CLIENT, type TingeeClientOptions } from './tingee.client.js';

/** Cấu hình của `tingee` (từ env `TINGEE_*` của vai api). */
export type TingeeConfig = Pick<TingeeClientOptions, 'baseUrl' | 'clientId' | 'secretToken'>;

/** Cung cấp `TINGEE_CLIENT` cho mọi mô-đun (adapter duy nhất gọi Tingee, AD-9). Không sở hữu bảng nào. */
@Global()
@Module({})
export class TingeeModule {
  static forRoot(config: TingeeConfig): DynamicModule {
    return {
      module: TingeeModule,
      providers: [{ provide: TINGEE_CLIENT, useFactory: () => new HttpTingeeClient(config) }],
      exports: [TINGEE_CLIENT],
    };
  }
}
