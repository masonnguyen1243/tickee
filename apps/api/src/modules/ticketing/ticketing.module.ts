import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type BeforeApplicationShutdown,
  type DynamicModule,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { OpsAlerts } from '../../platform/alerts/index.js';
import type { ApiConfig } from '../../platform/config/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { errorName } from '../../platform/jobs/index.js';
import { dbErrorSummary, isDatabaseError } from '../../platform/logging/index.js';
import { missingQrKeyVersions, type MissingQrKeyVersion } from './qr-key-check.js';
import { TICKET_QR_KEYS, TicketQrKeys } from './qr.js';
import { SharedTicketsController } from './shared-tickets.controller.js';
import { TICKET_QR_KEY_MISSING_ALERT, TicketsService } from './tickets.service.js';

/** Cấu hình của `ticketing` (env vai api và worker): khóa ký Mã QR vé. */
export type TicketingConfig = Pick<ApiConfig, 'TICKET_QR_KEYS'>;

/** Transaction của lần kiểm khóa QR: mọi câu cùng một snapshot và một `now()`; chỉ đọc. */
const QR_KEY_CHECK_TRANSACTION = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const;

/** Trần thời gian mỗi câu của lần kiểm khóa QR (`statement_timeout` trong transaction): DB treo thì bỏ lần kiểm. */
const QR_KEY_CHECK_STATEMENT_TIMEOUT = '30s';

/**
 * Tắt chờ lần kiểm khóa QR (kể cả raise, chạy ngoài transaction) tối đa chừng này: DB chậm lúc SIGTERM không được giữ
 * tiến trình quá thời gian ân hạn của orchestrator.
 */
const QR_KEY_CHECK_SHUTDOWN_WAIT_MS = 5_000;

/**
 * Kiểm khóa Mã QR vé lúc khởi động (Story 4.7-g): mỗi lần vai api hoặc worker khởi động (vai migrate không nạp
 * `TicketingModule`), so phiên bản khóa của Vé còn dùng với `TICKET_QR_KEYS` của instance (`missingQrKeyVersions`).
 * Chạy nền từ `onApplicationBootstrap` (DB đã sẵn sàng; `OpsAlerts.raise` tự chờ pg-boss start), nên không làm chậm lúc
 * instance bắt đầu nhận request hay job; tắt thì chờ lần kiểm xong (`beforeApplicationShutdown`, trước khi đóng DB và
 * dừng pg-boss), tối đa `QR_KEY_CHECK_SHUTDOWN_WAIT_MS`.
 *
 * Chỉ cảnh báo, không bao giờ thoát (Mason chốt 20/11/2026): instance thiếu khóa vẫn chạy Checkout, IPN và check-in, và
 * rollback vẫn lên được. Mỗi phiên bản thiếu: một dòng log `error` có marker `TICKET_QR_KEY_MISSING_ALERT`, phiên bản của
 * Vé, phiên bản hiện hành và số Vé (không có id Vé, token hay khóa), rồi báo kênh cảnh báo vận hành với subject
 * `qrKeyVersion:currentVersion` (chống lặp `cooldown` chung với đường link chia sẻ). Truy vấn kiểm lỗi (DB lỗi, timeout)
 * thì log `warn` rồi thôi.
 */
@Injectable()
export class TicketQrKeyCheck implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger('TicketQrKeyCheck');
  private running: Promise<void> = Promise.resolve();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(TICKET_QR_KEYS) private readonly keys: TicketQrKeys,
    @Inject(OpsAlerts) private readonly alerts: OpsAlerts,
  ) {}

  onApplicationBootstrap(): void {
    this.running = this.check();
  }

  async beforeApplicationShutdown(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), QR_KEY_CHECK_SHUTDOWN_WAIT_MS);
      timer.unref();
    });
    const outcome = await Promise.race([this.running.then(() => 'done' as const), deadline]);
    clearTimeout(timer);
    if (outcome === 'timeout') {
      this.logger.warn(
        { waitedMs: QR_KEY_CHECK_SHUTDOWN_WAIT_MS },
        'Tắt khi lần kiểm khóa Mã QR vé lúc khởi động chưa xong; không chờ thêm',
      );
    }
  }

  /** Một lần kiểm. Không bao giờ ném (`OpsAlerts.raise` cũng không ném). */
  private async check(): Promise<void> {
    let missing: MissingQrKeyVersion[];
    try {
      missing = await this.db.orm.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('statement_timeout', ${QR_KEY_CHECK_STATEMENT_TIMEOUT}, true)`);
        return missingQrKeyVersions(tx, this.keys);
      }, QR_KEY_CHECK_TRANSACTION);
    } catch (err) {
      this.logger.warn(
        { error: isDatabaseError(err) ? dbErrorSummary(err) : { type: errorName(err) } },
        'Không kiểm được khóa Mã QR vé của Vé còn dùng lúc khởi động; bỏ qua lần kiểm này',
      );
      return;
    }
    const currentVersion = this.keys.currentVersion;
    for (const { qrKeyVersion, tickets } of missing) {
      // `currentVersion` phân biệt khóa cũ đã bị gỡ (Vé có phiên bản nhỏ hơn) với instance chưa có khóa mới khi đang
      // deploy dần (Vé có phiên bản lớn hơn).
      this.logger.error(
        { alert: TICKET_QR_KEY_MISSING_ALERT, qrKeyVersion, currentVersion, tickets },
        'Khởi động: TICKET_QR_KEYS của instance này không có khóa của Vé còn dùng; Trang Đơn, Chi tiết Vé, link chia sẻ, email và check-in của các Vé này sẽ lỗi',
      );
      await this.alerts.raise({
        kind: TICKET_QR_KEY_MISSING_ALERT,
        subjects: [`${qrKeyVersion}:${currentVersion}`],
        details: { qrKeyVersion, currentVersion, tickets },
      });
    }
  }
}

/**
 * Vé và Mã QR vé (Story 3.3), link chia sẻ Vé (Story 3.8), kiểm khóa Mã QR vé lúc khởi động (Story 4.7-g). Toàn cục:
 * `ordering` (phát Vé trong `markPaid`, trả Vé ở trang Đơn, email Vé ở worker) và sau này `checkin` dùng
 * `TicketsService` và `TICKET_QR_KEYS` mà không phải import module này. Cần `DbModule` và `AlertsModule` ở gốc DI. Không
 * có route: route ở `TicketingRoutesModule` (chỉ vai api).
 */
@Global()
@Module({})
export class TicketingModule {
  static forRoot(config: TicketingConfig): DynamicModule {
    return {
      module: TicketingModule,
      providers: [
        { provide: TICKET_QR_KEYS, useFactory: () => TicketQrKeys.parse(config.TICKET_QR_KEYS) },
        TicketsService,
        TicketQrKeyCheck,
      ],
      exports: [TICKET_QR_KEYS, TicketsService],
    };
  }
}

/**
 * Route của `ticketing` ở vai api (Story 3.8): link chia sẻ Vé (`GET /v1/shared-tickets/:token`, `POST
 * /v1/me/tickets/:ticketId/share-link`). Cần `TicketingModule.forRoot` (toàn cục) và `DbModule` ở gốc DI.
 */
@Module({ controllers: [SharedTicketsController] })
export class TicketingRoutesModule {}
