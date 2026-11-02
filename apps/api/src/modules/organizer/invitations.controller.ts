import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { InvitationTokenRequest, type AcceptedInvitation, type InvitationPreview } from '@tickee/contracts';
import { parseRequest, Public } from '../../platform/http/index.js';
import { MembersService, type SessionUser } from './members.service.js';

/**
 * Link mời Admin (`/loi-moi-btc#token` của web), ngoài `/v1/orgs` vì người mở link chưa là thành viên. Token luôn đi
 * trong body, không bao giờ trong đường dẫn hay query.
 */
@Controller('org-invitations')
export class InvitationsController {
  constructor(@Inject(MembersService) private readonly members: MembersService) {}

  /** Công khai: người chưa đăng nhập vẫn thấy được lời mời của BTC nào, hay link đã hết hạn/đã dùng/không hợp lệ. */
  @Post('preview')
  @Public()
  @HttpCode(200)
  preview(@Body() body: unknown): Promise<InvitationPreview> {
    const { token } = parseRequest(InvitationTokenRequest, body);
    return this.members.preview(token);
  }

  /** Cần đăng nhập (OTP hoặc Google), đã qua lớp hai nếu bật 2FA, và đã đồng ý NĐ 13 (guard toàn cục). */
  @Post('accept')
  @HttpCode(200)
  accept(@Body() body: unknown, @Req() req: { user: SessionUser }): Promise<AcceptedInvitation> {
    const { token } = parseRequest(InvitationTokenRequest, body);
    return this.members.accept({ id: req.user.id, email: req.user.email }, token);
  }
}
