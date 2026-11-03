import { Global, Module, type DynamicModule } from '@nestjs/common';
import { HttpTingeeClient, TINGEE_CLIENT, type TingeeClientOptions } from './tingee.client.js';

/** Cấu hình của `tingee` (từ `TINGEE_BASE_URL` của vai api). Credential là của từng BTC, truyền theo từng lời gọi. */
export type TingeeConfig = Pick<TingeeClientOptions, 'baseUrl'>;

/** Cung cấp `TINGEE_CLIENT` cho mọi mô-đun (adapter duy nhất gọi Tingee, AD-9). Không sở hữu bảng nào. */
@Global()
@Module({})
export class TingeeModule {
  static forRoot(config: TingeeConfig): DynamicModule {
    return {
      module: TingeeModule,
      providers: [{ provide: TINGEE_CLIENT, useFactory: () => new HttpTingeeClient({ baseUrl: config.baseUrl }) }],
      exports: [TINGEE_CLIENT],
    };
  }
}
