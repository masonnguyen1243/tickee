import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { InviteAdminRequest, Permission, type MemberList, type OrganizationInvitation } from '@tickee/contracts';
import { Access, RequirePermission, type AccessContext } from '../../platform/access/index.js';
import { parseRequest } from '../../platform/http/index.js';
import { MembersService } from './members.service.js';

/**
 * Thành viên và lời mời Admin của một BTC (Story 2.4). Chỉ Owner (`members.manage`): Admin nhận `FORBIDDEN_ROLE`.
 * Mọi route mang `@RequirePermission` nên tự rơi vào bộ test cách ly.
 */
@Controller('orgs/:orgId')
export class MembersController {
  constructor(@Inject(MembersService) private readonly members: MembersService) {}

  @Get('members')
  @RequirePermission(Permission.MEMBERS_MANAGE)
  list(@Access() ctx: AccessContext): Promise<MemberList> {
    return this.members.list(ctx);
  }

  /** Mời một email làm Admin; email gửi qua job (worker). */
  @Post('invitations')
  @HttpCode(201)
  @RequirePermission(Permission.MEMBERS_MANAGE)
  invite(@Access() ctx: AccessContext, @Body() body: unknown): Promise<OrganizationInvitation> {
    const { email } = parseRequest(InviteAdminRequest, body);
    return this.members.invite(ctx, email);
  }

  @Delete('invitations/:invitationId')
  @HttpCode(204)
  @RequirePermission(Permission.MEMBERS_MANAGE)
  async revoke(@Access() ctx: AccessContext, @Param('invitationId') invitationId: string): Promise<void> {
    await this.members.revokeInvitation(ctx, invitationId);
  }

  @Delete('members/:memberId')
  @HttpCode(204)
  @RequirePermission(Permission.MEMBERS_MANAGE)
  async remove(@Access() ctx: AccessContext, @Param('memberId') memberId: string): Promise<void> {
    await this.members.removeMember(ctx, memberId);
  }
}
