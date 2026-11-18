import { Global, Inject, Injectable, Module, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import { OBJECT_STORAGE, type ObjectStorage } from './object-storage.js';
import { S3ObjectStorage, type S3StorageOptions } from './s3-object-storage.js';

@Injectable()
class ObjectStorageCloser implements OnApplicationShutdown {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  onApplicationShutdown(): void {
    if (this.storage instanceof S3ObjectStorage) this.storage.close();
  }
}

/** Cung cấp `OBJECT_STORAGE` (S3 chuẩn) cho mọi mô-đun; chỉ vai api (ảnh Sự kiện, Story 4.8-a). */
@Global()
@Module({})
export class StorageModule {
  static forRoot(options: S3StorageOptions): DynamicModule {
    return {
      module: StorageModule,
      providers: [{ provide: OBJECT_STORAGE, useFactory: () => new S3ObjectStorage(options) }, ObjectStorageCloser],
      exports: [OBJECT_STORAGE],
    };
  }
}
