import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { SendOtpRequest, VerifyOtpRequest, type Me, type SendOtpResponse, type VerifyOtpResponse } from '@tickee/contracts';
import { fromNodeHeaders } from 'better-auth/node';
import type { Response } from 'express';
import { parseRequest } from '../../platform/http/index.js';
import { ConsentExempt } from './consent.guard.js';
import { forwardSetCookies } from './cookies.js';
import { IdentityService } from './identity.service.js';
import type { RequestWithSession } from './session.guard.js';

/** Endpoint Tài khoản của web, dưới `/v1/identity`. */
@Controller('identity')
export class IdentityController {
  constructor(@Inject(IdentityService) private readonly identity: IdentityService) {}

  /** Gửi mã OTP 6 số qua email. */
  @Post('otp')
  @HttpCode(200)
  @AllowAnonymous()
  sendOtp(@Body() body: unknown, @Req() req: RequestWithSession): Promise<SendOtpResponse> {
    const { email } = parseRequest(SendOtpRequest, body);
    return this.identity.sendSignInCode(email, req.ip ?? req.socket.remoteAddress ?? 'unknown');
  }

  /** Xác minh mã; đúng thì set cookie session. */
  @Post('otp/verify')
  @HttpCode(200)
  @AllowAnonymous()
  async verifyOtp(
    @Body() body: unknown,
    @Req() req: RequestWithSession,
    @Res({ passthrough: true }) res: Response,
  ): Promise<VerifyOtpResponse> {
    const { email, otp } = parseRequest(VerifyOtpRequest, body);
    const { consentRequired, headers } = await this.identity.signInWithCode(email, otp, fromNodeHeaders(req.headers));
    forwardSetCookies(headers, res);
    return { consentRequired };
  }

  @Get('me')
  @ConsentExempt()
  me(@Req() req: RequestWithSession): Me {
    return this.identity.toMe(req.session!);
  }

  /** Đồng ý xử lý dữ liệu cá nhân theo NĐ 13/2023. */
  @Post('consent')
  @HttpCode(200)
  @ConsentExempt()
  consent(@Req() req: RequestWithSession): Promise<Me> {
    return this.identity.recordConsent(req.session!);
  }

  /** Hủy session ở server và xóa cookie. */
  @Post('sign-out')
  @HttpCode(204)
  @ConsentExempt()
  async signOut(@Req() req: RequestWithSession, @Res({ passthrough: true }) res: Response): Promise<void> {
    forwardSetCookies(await this.identity.signOut(fromNodeHeaders(req.headers)), res);
  }
}
