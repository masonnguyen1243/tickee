import { Body, Controller, HttpCode, Inject, Post, Res } from '@nestjs/common';
import { Permission, ScanRequest, type ScanResult } from '@tickee/contracts';
import type { Response } from 'express';
import type { PgBoss } from 'pg-boss';
import { SheetRowChangedQueues, TICKET_QR_KEYS, type TicketQrKeys } from '../modules/ticketing/index.js';
import { EventAccess, RequirePermission, type EventAccessContext } from '../platform/access/index.js';
import { DATABASE, type Database } from '../platform/db/index.js';
import { parseRequest } from '../platform/http/index.js';
import { BOSS } from '../platform/jobs/index.js';
import { scanTicket } from './checkin-scan.flow.js';

/**
 * Quét Mã QR vé ở Màn quét (`POST /v1/checkin/events/:eventId/scans`, Story 5.3): Owner/Admin của BTC sở hữu Sự kiện,
 * hoặc CTV `active` của đúng Sự kiện (`PermissionGuard`, nhánh Sự kiện, `checkin.scan`). Người khác, Sự kiện lạ → `403
 * NOT_A_MEMBER`; CTV bị thu hồi → `403 CHECKER_REVOKED`; CTV `active` khi Sự kiện đã kết thúc → `403 EVENT_ENDED` (Story
 * 5.6). Body sai schema → `400 VALIDATION_FAILED`. Mọi kết quả quét (kể cả đỏ) là `200 ScanResult`. `cache-control:
 * no-store` đặt ở đầu handler nên có ở mọi response handler hoặc flow tạo ra, kể cả lỗi chúng ném. Mã QR chỉ đi trong
 * body (không log). Check-in thành công enqueue `sheet_row_changed` (Story 6.5): flow chờ queue sẵn sàng sau khi kiểm chữ
 * ký, trước transaction.
 */
@Controller('checkin/events/:eventId/scans')
export class CheckinScanController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(TICKET_QR_KEYS) private readonly keys: TicketQrKeys,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(SheetRowChangedQueues) private readonly sheetQueues: SheetRowChangedQueues,
  ) {}

  @Post()
  @HttpCode(200)
  @RequirePermission(Permission.CHECKIN_SCAN)
  scan(
    @EventAccess() ctx: EventAccessContext,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ScanResult> {
    res.setHeader('cache-control', 'no-store');
    const input = parseRequest(ScanRequest, body);
    return scanTicket(this.db, this.keys, ctx, input, { boss: this.boss, queues: this.sheetQueues });
  }
}
