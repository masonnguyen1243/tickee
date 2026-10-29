import { Body, Controller, Get, HttpCode, Inject, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import {
  GoogleSignInError,
  safeReturnTo,
  SendOtpRequest,
  VerifyOtpRequest,
  type Me,
  type SendOtpResponse,
  type VerifyOtpResponse,
} from '@tickee/contracts';
import { fromNodeHeaders } from 'better-auth/node';
import type { Response } from 'express';
import { parseRequest } from '../../platform/http/index.js';
import { ConsentExempt } from './consent.guard.js';
import { forwardSetCookies } from './cookies.js';
import { IdentityService } from './identity.service.js';
import type { RequestWithSession } from './session.guard.js';

/** IP của request như `sendOtp`: `req.ip` theo `TRUST_PROXY_HOPS`. */
const clientIp = (req: RequestWithSession): string => req.ip ?? req.socket.remoteAddress ?? 'unknown';

/**
 * Chỉ tên lớp lỗi và `code` (nếu có): `message` của lỗi DB/Better Auth có thể chứa tham số truy vấn (email, state).
 */
function errorSummary(err: unknown): { errName: string; code?: string } {
  if (typeof err !== 'object' || err === null) return { errName: typeof err };
  const errName = (err as { constructor?: { name?: unknown } }).constructor?.name;
  const own = (err as { code?: unknown }).code;
  const body = (err as { body?: { code?: unknown } }).body?.code;
  // DrizzleQueryError: SQLSTATE của pg nằm ở `cause.code` (message/params của lỗi không bao giờ được log).
  const cause = (err as { cause?: { code?: unknown } }).cause?.code;
  const code = [own, body, cause].find((c): c is string => typeof c === 'string');
  return { errName: typeof errName === 'string' && errName !== '' ? errName : 'Object', ...(code ? { code } : {}) };
}

/** Endpoint Tài khoản của web, dưới `/v1/identity`. */
@Controller('identity')
export class IdentityController {
  private readonly logger = new Logger('IdentityController');

  constructor(@Inject(IdentityService) private readonly identity: IdentityService) {}

  /** Gửi mã OTP 6 số qua email. */
  @Post('otp')
  @HttpCode(200)
  @AllowAnonymous()
  sendOtp(@Body() body: unknown, @Req() req: RequestWithSession): Promise<SendOtpResponse> {
    const { email } = parseRequest(SendOtpRequest, body);
    return this.identity.sendSignInCode(email, clientIp(req));
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

  /**
   * Bắt đầu đăng nhập Google bằng điều hướng cả trang: đặt cookie state rồi 302 sang Google. `returnTo` sai → `/`.
   * Miễn consent: người đã đăng nhập mà chưa đồng ý vẫn bắt đầu được (điều hướng, không phải lời gọi API).
   * Không bao giờ trả JSON (không qua `ErrorFilter`): chạm giới hạn theo IP → 302 `/dang-nhap?error=rate_limited`,
   * lỗi bất kỳ → 302 `/dang-nhap?error=start_failed`, cả hai giữ `returnTo`.
   */
  @Get('google')
  @AllowAnonymous()
  @ConsentExempt()
  async google(
    @Query('returnTo') returnTo: unknown,
    @Req() req: RequestWithSession,
    @Res() res: Response,
  ): Promise<void> {
    const target = safeReturnTo(returnTo);
    res.setHeader('cache-control', 'no-store');
    try {
      const start = await this.identity.startGoogleSignIn(target, clientIp(req), fromNodeHeaders(req.headers));
      if (!start.ok) {
        res.redirect(302, this.identity.googleSignInErrorUrl(start.error, target));
        return;
      }
      forwardSetCookies(start.headers, res);
      res.redirect(302, start.url);
    } catch (err) {
      this.logger.error(errorSummary(err), 'Không bắt đầu được đăng nhập Google');
      if (res.headersSent) return;
      res.redirect(302, this.identity.googleSignInErrorUrl(GoogleSignInError.START_FAILED, target));
    }
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
