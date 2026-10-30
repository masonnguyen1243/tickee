import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  RecoveryCodeRequest,
  TotpCodeRequest,
  type RecoveryCodeResponse,
  type StepUpResponse,
  type TotpEnrollResponse,
  type TotpEnrollVerifyResponse,
} from '@tickee/contracts';
import { fromNodeHeaders } from 'better-auth/node';
import type { Response } from 'express';
import { parseRequest } from '../../platform/http/index.js';
import { ConsentExempt } from './consent.guard.js';
import { forwardSetCookies } from './cookies.js';
import type { RequestWithSession } from './session.guard.js';
import { TotpService } from './totp.service.js';

/**
 * TOTP của web dưới `/v1/identity/totp` (endpoint HTTP gốc của plugin `twoFactor` bị cổng HTTP chặn). Cả bốn route
 * nằm trong `TOTP_EXEMPT_ROUTES` và cần đăng nhập (`SessionGuard`).
 */
@Controller('identity/totp')
export class TotpController {
  constructor(@Inject(TotpService) private readonly totp: TotpService) {}

  /** Bắt đầu đăng ký: URI cho QR và khóa nhập tay. */
  @Post('enroll')
  @HttpCode(200)
  @ConsentExempt()
  enroll(@Req() req: RequestWithSession, @Res({ passthrough: true }) res: Response): Promise<TotpEnrollResponse> {
    // Response chứa secret TOTP: không cho cache.
    res.setHeader('cache-control', 'no-store');
    return this.totp.beginEnrollment(req.session!, fromNodeHeaders(req.headers));
  }

  /** Xác nhận đăng ký bằng mã đầu tiên → 10 mã khôi phục (hiện một lần) + cookie session mới đã step-up. */
  @Post('enroll/verify')
  @HttpCode(200)
  @ConsentExempt()
  async verifyEnrollment(
    @Body() body: unknown,
    @Req() req: RequestWithSession,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TotpEnrollVerifyResponse> {
    const { code } = parseRequest(TotpCodeRequest, body);
    const { recoveryCodes, headers } = await this.totp.confirmEnrollment(req.session!, code, fromNodeHeaders(req.headers));
    forwardSetCookies(headers, res);
    res.setHeader('cache-control', 'no-store');
    return { recoveryCodes };
  }

  /** Step-up bằng mã TOTP. */
  @Post('step-up')
  @HttpCode(200)
  @ConsentExempt()
  async stepUp(
    @Body() body: unknown,
    @Req() req: RequestWithSession,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StepUpResponse> {
    const { code } = parseRequest(TotpCodeRequest, body);
    const { stepUpAt, headers } = await this.totp.stepUp(req.session!, code, fromNodeHeaders(req.headers));
    forwardSetCookies(headers, res);
    return { stepUpAt };
  }

  /** Step-up bằng mã khôi phục: TOTP bị gỡ, web chuyển sang đăng ký lại. */
  @Post('recovery')
  @HttpCode(200)
  @ConsentExempt()
  recovery(@Body() body: unknown, @Req() req: RequestWithSession): Promise<RecoveryCodeResponse> {
    const { recoveryCode } = parseRequest(RecoveryCodeRequest, body);
    return this.totp.useRecoveryCode(req.session!, recoveryCode);
  }
}
