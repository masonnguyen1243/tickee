import { Body, Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import {
  CreateOrganizationRequest,
  Permission,
  type CreatedOrganization,
  type Organization,
} from '@tickee/contracts';
import { Access, RequirePermission, type AccessContext } from '../../platform/access/index.js';
import { parseRequest } from '../../platform/http/index.js';
import { OrganizerService } from './organizer.service.js';

/** Request đã qua `SessionGuard` (route không công khai nên luôn có `user`). */
type AuthedRequest = { user: { id: string } };

/** Endpoint BTC dưới `/v1/orgs`. Route dưới `/v1/orgs/:orgId` bắt buộc mang `@RequirePermission`. */
@Controller('orgs')
export class OrganizationsController {
  constructor(@Inject(OrganizerService) private readonly organizer: OrganizerService) {}

  /** Tạo BTC; người gọi thành Owner. */
  @Post()
  @HttpCode(201)
  create(@Body() body: unknown, @Req() req: AuthedRequest): Promise<CreatedOrganization> {
    const input = parseRequest(CreateOrganizationRequest, body);
    return this.organizer.createOrganization(req.user.id, input);
  }

  @Get(':orgId')
  @RequirePermission(Permission.ORG_READ)
  get(@Access() ctx: AccessContext): Promise<Organization> {
    return this.organizer.getOrganization(ctx);
  }
}
