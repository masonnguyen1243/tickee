import { Body, Controller, Headers, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import {
  CheckinLookupRequest,
  ErrorCode,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKey,
  Permission,
  type CheckinLookupResult,
  type ScanResult,
} from '@tickee/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CheckinLookupRateLimiter } from '../modules/checkin/index.js';
import { EventAccess, RequirePermission, type EventAccessContext } from '../platform/access/index.js';
import { DATABASE, type Database } from '../platform/db/index.js';
import { AppError, parseRequest } from '../platform/http/index.js';
import { lookupTickets, manualCheckIn } from './checkin-lookup.flow.js';

/** IP của request (`req.ip` theo `TRUST_PROXY_HOPS`), như bộ đếm tạo Đơn. */
const clientIp = (req: Request): string => req.ip ?? req.socket.remoteAddress ?? 'unknown';

/** Lỗi `400 VALIDATION_FAILED` cùng dạng với `parseRequest`: chỉ đường dẫn và mã, không lặp lại giá trị. */
const invalid = (path: string, raw: unknown) =>
  new AppError(ErrorCode.VALIDATION_FAILED, 'Yêu cầu không hợp lệ.', {
    details: { issues: [{ path, code: raw === undefined ? 'invalid_type' : 'invalid_format' }] },
  });

/** `Idempotency-Key` thiếu hoặc không phải uuid → `400 VALIDATION_FAILED`. */
function idempotencyKeyOf(raw: unknown): string {
  const parsed = IdempotencyKey.safeParse(raw);
  if (!parsed.success) throw invalid(`headers.${IDEMPOTENCY_KEY_HEADER}`, raw);
  return parsed.data;
}

/** `ticketId` trong đường dẫn không phải uuid → `400 VALIDATION_FAILED`. */
function ticketIdOf(raw: string): string {
  const parsed = z.uuid().safeParse(raw);
  if (!parsed.success) throw invalid('params.ticketId', raw);
  return parsed.data;
}

/**
 * Tra tay và check-in tay ở Màn quét (Story 5.5, FR-29): Owner/Admin của BTC sở hữu Sự kiện, hoặc CTV `active` của đúng
 * Sự kiện (`PermissionGuard`, nhánh Sự kiện, `checkin.lookup`). Người khác, CTV của Sự kiện khác, Sự kiện lạ → `403
 * NOT_A_MEMBER`; CTV bị thu hồi → `403 CHECKER_REVOKED`. `cache-control: no-store` đặt ở đầu handler nên có ở mọi
 * response handler hoặc flow tạo ra, kể cả lỗi chúng ném.
 */
@Controller('checkin/events/:eventId')
export class CheckinLookupController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CheckinLookupRateLimiter) private readonly limiter: CheckinLookupRateLimiter,
  ) {}

  /**
   * `POST /v1/checkin/events/:eventId/lookups`: body `{ query }` (SĐT hoặc email đầy đủ của Người mua; chỉ trong body,
   * không bao giờ trên URL) → `200 CheckinLookupResult`. Thứ tự: body (sai dạng → `400 VALIDATION_FAILED`, không đếm) →
   * bộ đếm theo tài khoản và IP (vượt → `429 CHECKIN_LOOKUP_RATE_LIMITED` kèm `retryAfterSeconds`) → tra.
   */
  @Post('lookups')
  @HttpCode(200)
  @RequirePermission(Permission.CHECKIN_LOOKUP)
  async lookup(
    @EventAccess() ctx: EventAccessContext,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CheckinLookupResult> {
    res.setHeader('cache-control', 'no-store');
    const { query } = parseRequest(CheckinLookupRequest, body);
    await this.limiter.consume(ctx.userId, clientIp(req));
    return lookupTickets(this.db, ctx, query);
  }

  /**
   * `POST /v1/checkin/events/:eventId/tickets/:ticketId/check-in` (header `Idempotency-Key`, không body) → `200
   * ScanResult`, mọi kết quả (kể cả đỏ). `Idempotency-Key` thiếu hoặc không phải uuid, hay `ticketId` không phải uuid →
   * `400 VALIDATION_FAILED`. Không giới hạn tốc độ.
   */
  @Post('tickets/:ticketId/check-in')
  @HttpCode(200)
  @RequirePermission(Permission.CHECKIN_LOOKUP)
  checkIn(
    @EventAccess() ctx: EventAccessContext,
    @Param('ticketId') ticketId: string,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ScanResult> {
    res.setHeader('cache-control', 'no-store');
    const idempotencyKey = idempotencyKeyOf(key);
    return manualCheckIn(this.db, ctx, ticketIdOf(ticketId), idempotencyKey);
  }
}
