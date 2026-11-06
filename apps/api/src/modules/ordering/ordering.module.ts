import { Module } from '@nestjs/common';
import { AVAILABILITY_CLOCK, AvailabilityMemo, PublicAvailabilityController } from './public-availability.controller.js';

/** Trạng thái bán công khai (Story 2.11-a). Cần `DbModule` ở gốc DI. */
@Module({
  controllers: [PublicAvailabilityController],
  providers: [AvailabilityMemo, { provide: AVAILABILITY_CLOCK, useValue: () => Date.now() }],
})
export class OrderingModule {}
