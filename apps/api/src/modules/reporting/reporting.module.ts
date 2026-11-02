import { Module } from '@nestjs/common';
import { NoticesController } from './notices.controller.js';
import { NoticesService } from './notices.service.js';

/** Báo cáo và thông báo trạng thái — chỉ đọc qua read model của mô-đun khác (AD-34). Cần `DbModule` ở gốc DI. */
@Module({ controllers: [NoticesController], providers: [NoticesService] })
export class ReportingModule {}
