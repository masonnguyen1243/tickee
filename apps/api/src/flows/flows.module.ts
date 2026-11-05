import { Module } from '@nestjs/common';
import { TicketTypesController } from './ticket-types.controller.js';

/**
 * Tầng flows (AD-25): controller của luồng ghi chạm từ hai mô-đun trở lên. Cần `DbModule` (toàn cục) ở gốc DI; guard
 * quyền (`@RequirePermission`) là guard toàn cục của `OrganizerModule`.
 */
@Module({ controllers: [TicketTypesController] })
export class FlowsModule {}
