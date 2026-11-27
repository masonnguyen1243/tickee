import { Inject, Injectable } from '@nestjs/common';
import { JobQueue, SheetRowChangedPayload } from '@tickee/contracts';
import type { PgBoss } from 'pg-boss';
import type { Tx } from '../../platform/db/index.js';
import { BOSS, defineQueue, QueueProducer } from '../../platform/jobs/index.js';

/*
 * Queue "một Đơn vừa đổi trên Sheet" (Story 6.5, FR-32, AD-23). Hai producer: `ordering` (Đơn chuyển `paid`, `review`,
 * `cancelled`, `refunded`) và `ticketing` (check-in thành công). Queue khai báo ở đây vì `ticketing` là producer thấp nhất
 * của đồ thị mô-đun (`ordering → ticketing` và `integration → ticketing` đều hợp lệ), như tiền lệ `RECONCILE_ORDER_QUEUE`
 * khai báo ở producer: không producer nào import `integration`. Handler ở `integration` (vai worker) chỉ đánh dấu dòng
 * bẩn của kết nối rồi hẹn flush.
 */

/**
 * Queue `integration.sheet_row_changed`. Không id cố định: mỗi thay đổi một job (handler chỉ tăng `version` dòng bẩn, nên
 * lặp không sao). Retry khi lỗi DB: 5 lần, chờ 10 giây rồi tăng gấp đôi (tối đa 5 phút), hết lượt thì sang dead-letter.
 * Worker lấy lô 50, lấy tiếp ngay khi lô đầy, poll mỗi giây (độ trễ tới Sheet tính cả bước này).
 */
export const SHEET_ROW_CHANGED_QUEUE = defineQueue({
  name: JobQueue.INTEGRATION_SHEET_ROW_CHANGED,
  deadLetter: JobQueue.INTEGRATION_SHEET_ROW_CHANGED_DEAD_LETTER,
  options: { retryLimit: 5, retryDelay: 10, retryBackoff: true, retryDelayMax: 300 },
  work: { batchSize: 50, burstWhenBatchFull: true, pollingIntervalSeconds: 1, perJobResults: true },
  payload: SheetRowChangedPayload,
});

/**
 * Enqueue "Đơn `orderId` của Sự kiện `eventId` vừa đổi" bằng chính `tx` của lệnh đổi trạng thái hay check-in (`tx`
 * rollback thì không có job). Người gọi đã `SheetRowChangedQueues.ready()` trước transaction.
 */
export async function enqueueSheetRowChanged(boss: PgBoss, tx: Tx, payload: SheetRowChangedPayload): Promise<void> {
  await SHEET_ROW_CHANGED_QUEUE.enqueue(boss, tx, payload);
}

/**
 * Mọi vai có lệnh đổi Đơn hay check-in: start pg-boss (vai api chế độ producer) và tạo queue lúc khởi động; `ready()` chờ
 * việc đó trước transaction (lần trước lỗi thì làm lại).
 */
@Injectable()
export class SheetRowChangedQueues extends QueueProducer {
  constructor(@Inject(BOSS) boss: PgBoss) {
    super(boss, SHEET_ROW_CHANGED_QUEUE, 'khi Đơn đổi trạng thái hoặc khi check-in');
  }
}
