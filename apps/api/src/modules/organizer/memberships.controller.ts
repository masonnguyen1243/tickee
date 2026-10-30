import { Controller, Get, Inject, Req } from '@nestjs/common';
import type { Membership } from '@tickee/contracts';
import { OrganizerService } from './organizer.service.js';

/** `GET /v1/me/memberships`: vai trò của tài khoản ở từng BTC. */
@Controller('me')
export class MembershipsController {
  constructor(@Inject(OrganizerService) private readonly organizer: OrganizerService) {}

  @Get('memberships')
  memberships(@Req() req: { user: { id: string } }): Promise<Membership[]> {
    return this.organizer.listMemberships(req.user.id);
  }
}
