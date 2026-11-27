import {
  Catch,
  Controller,
  Get,
  Inject,
  Injectable,
  Logger,
  Query,
  Req,
  Res,
  UseFilters,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { googleSheetsReturnPath, SheetsNotice } from '@tickee/contracts';
import type { Response } from 'express';
import { AppError } from '../../platform/http/index.js';
import { OptionalAuth } from '../identity/index.js';
import {
  SHEETS_OAUTH_SETTINGS,
  SheetConnectionService,
  type SheetsCallbackQuery,
  type SheetsOauthSettings,
} from './sheet-connection.service.js';

/** 302 về web, không cache (URL có `notice`; trình duyệt không được dùng lại phản hồi của một `state` cũ). */
function redirectToWeb(res: Response, webOrigin: string, path: string): void {
  res.setHeader('cache-control', 'no-store');
  res.redirect(302, `${webOrigin}${path}`);
}

/**
 * Callback không bao giờ trả JSON: lỗi trước handler (guard 2FA hay đồng ý NĐ 13 của session đang có, lỗi bất kỳ) → 302
 * về trang gốc web với `notice=sheets-failed`. Chỉ log mã lỗi hoặc tên lớp lỗi.
 */
@Catch()
@Injectable()
export class SheetsCallbackExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('SheetsCallbackExceptionFilter');

  constructor(@Inject(SHEETS_OAUTH_SETTINGS) private readonly settings: SheetsOauthSettings) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const error =
      exception instanceof AppError
        ? exception.code
        : ((exception as { constructor?: { name?: string } } | null)?.constructor?.name ?? 'Unknown');
    this.logger.warn({ error }, 'Callback Google Sheets bị chặn trước handler');
    if (res.headersSent) return;
    redirectToWeb(res, this.settings.webOrigin, googleSheetsReturnPath(SheetsNotice.FAILED));
  }
}

/**
 * Callback OAuth Google Sheets (Story 6.4): `GET /v1/integrations/google-sheets/callback?code=&state=` (hoặc `error=`).
 * Google điều hướng trình duyệt tới đây sau màn đồng ý. `@OptionalAuth()`: session (nếu có) gắn vào `req.user` để so với
 * người tạo `state`; không session → thất bại. Luôn 302 về web: tab Cài đặt của Sự kiện kèm `notice=sheets-connected` /
 * `sheets-denied` / `sheets-failed` / `sheets-already-connected` (không biết Sự kiện thì trang gốc web). Log request che
 * giá trị `code`/`state` (`redactUrlQuery`).
 */
@Controller('integrations/google-sheets')
@UseFilters(SheetsCallbackExceptionFilter)
export class SheetOauthController {
  constructor(
    @Inject(SheetConnectionService) private readonly sheets: SheetConnectionService,
    @Inject(SHEETS_OAUTH_SETTINGS) private readonly settings: SheetsOauthSettings,
  ) {}

  @Get('callback')
  @OptionalAuth()
  async callback(
    @Query() query: SheetsCallbackQuery,
    @Req() req: { user?: { id?: string } | null },
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.sheets.completeCallback(query ?? {}, req.user?.id ?? null);
    redirectToWeb(res, this.settings.webOrigin, googleSheetsReturnPath(result.notice, result.target));
  }
}
