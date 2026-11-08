import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ReauthRequest, type ReauthEmailCodeResponse, type ReauthGrant } from '@tickee/contracts';
import { fromNodeHeaders } from 'better-auth/node';
import type { Response } from 'express';
import { parseRequest } from '../../platform/http/index.js';
import { forwardSetCookies } from './cookies.js';
import { clientIp } from './identity.controller.js';
import { ReauthService } from './reauth.service.js';
import type { RequestWithSession } from './session.guard.js';

/**
 * Xác nhận lại trước thao tác nhạy cảm (Story 2.13) dưới `/v1/identity/reauth`. Cần đăng nhập, đã qua lớp hai (nếu đã
 * bật 2FA) và đã đồng ý NĐ 13 như mọi route khác (guard toàn cục).
 */
@Controller('identity/reauth')
export class ReauthController {
  constructor(@Inject(ReauthService) private readonly reauth: ReauthService) {}

  /** Gửi mã xác nhận 6 số qua email (chỉ khi chưa bật 2FA; đã bật → 409 `REAUTH_METHOD_MISMATCH`). */
  @Post('email-code')
  @HttpCode(200)
  sendEmailCode(@Req() req: RequestWithSession): Promise<ReauthEmailCodeResponse> {
    return this.reauth.sendEmailCode(req.session!, clientIp(req));
  }

  /** Nhập mã (TOTP nếu đã bật 2FA, mã email nếu chưa) → lần xác nhận cho session hiện tại. */
  @Post()
  @HttpCode(200)
  async confirm(
    @Body() body: unknown,
    @Req() req: RequestWithSession,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReauthGrant> {
    const { code } = parseRequest(ReauthRequest, body);
    const { headers, ...grant } = await this.reauth.confirm(req.session!, code, fromNodeHeaders(req.headers));
    forwardSetCookies(headers, res);
    // Response chứa token xác nhận lại: không cho cache.
    res.setHeader('cache-control', 'no-store');
    return grant;
  }
}
