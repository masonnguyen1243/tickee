import { Module } from '@nestjs/common';
import { FunnelController } from './funnel.controller.js';
import { FunnelService } from './funnel.service.js';
import {
  AVAILABILITY_CLOCK,
  AvailabilityMemo,
  PublicAvailabilityController,
} from './public-availability.controller.js';

/** Trạng thái bán công khai (Story 2.11-a) và phễu mua (Story 3.1). Cần `DbModule` ở gốc DI. */
@Module({
  controllers: [PublicAvailabilityController, FunnelController],
  providers: [AvailabilityMemo, FunnelService, { provide: AVAILABILITY_CLOCK, useValue: () => Date.now() }],
})
export class OrderingModule {}
