import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  CheckerInviteTokenRequest,
  type AcceptedCheckerInvite,
  type CheckerInvitePreview,
} from '@tickee/contracts';
import type { Response } from 'express';
import { OptionalAuth } from '../modules/identity/index.js';
import { DATABASE, type Database } from '../platform/db/index.js';
import { parseRequest } from '../platform/http/index.js';
import { acceptCheckerInvite, previewCheckerInvite } from './checker-invite.flow.js';

/** Request sau `SessionGuard`: `user` có khi đã đăng nhập (`null`/không có khi ẩn danh ở route `@OptionalAuth()`). */
type MaybeSignedIn = { user?: { id: string } | null };

/**
 * Link mời CTV (`/loi-moi-ctv#token` của web, Story 5.2), ngoài `/v1/orgs` và `/v1/checkin/events` vì người mở link chưa
 * có quyền gì. Token chỉ đi trong body. `cache-control: no-store` đặt ở đầu handler nên có ở mọi response mà handler
 * hoặc flow tạo ra, kể cả lỗi chúng ném; lỗi của guard toàn cục (`UNAUTHENTICATED`, `CONSENT_REQUIRED`,
 * `TOTP_REQUIRED`) trả trước khi tới handler nên không mang header này.
 */
@Controller('checkin/invites')
export class CheckerInviteAcceptanceController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Không bắt buộc đăng nhập: có session thì người đã có quyền quét nhận thêm `scanEventId`. */
  @Post('preview')
  @OptionalAuth()
  @HttpCode(200)
  preview(
    @Body() body: unknown,
    @Req() req: MaybeSignedIn,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CheckerInvitePreview> {
    res.setHeader('cache-control', 'no-store');
    const { token } = parseRequest(CheckerInviteTokenRequest, body);
    return previewCheckerInvite(this.db, req.user?.id ?? null, token);
  }

  /** Cần đăng nhập (OTP hoặc Google), đã qua lớp hai nếu bật 2FA, và đã đồng ý NĐ 13 (guard toàn cục). */
  @Post('accept')
  @HttpCode(200)
  accept(
    @Body() body: unknown,
    @Req() req: { user: { id: string } },
    @Res({ passthrough: true }) res: Response,
  ): Promise<AcceptedCheckerInvite> {
    res.setHeader('cache-control', 'no-store');
    const { token } = parseRequest(CheckerInviteTokenRequest, body);
    return acceptCheckerInvite(this.db, req.user.id, token);
  }
}
