import { Controller, Get, HttpCode, Inject, Param, Post, Res } from '@nestjs/common';
import {
  DEAD_LETTER_JOBS_LIMIT,
  DeadLetterJobParams,
  ErrorCode,
  type DeadLetterJobList,
} from '@tickee/contracts';
import type { Response } from 'express';
import type { PgBoss } from 'pg-boss';
import {
  PlatformAdminAccess,
  platformAdminScope,
  RequirePlatformAdmin,
  type PlatformAdminContext,
} from '../../platform/access/index.js';
import { audit } from '../../platform/audit/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { AppError, parseRequest } from '../../platform/http/index.js';
import { BOSS, listDeadLetterJobs, requeueDeadLetterJob } from '../../platform/jobs/index.js';

/**
 * Dead-letter của pg-boss cho Quản trị Tingee (Story 4.6-d, AD-12): xem job đang nằm trong mọi queue `*.dead-letter` và
 * requeue từng job về queue gốc. Cả controller mang `@RequirePlatformAdmin()` (cờ `platform_admin`, 2FA đã bật, session
 * đã qua lớp hai). Đọc qua `platformAdminScope` (một dòng audit `platform_admin.read` mỗi request đọc); requeue và audit
 * `dead_letter_job.requeued` chạy trong cùng một transaction. Không có xóa, bỏ qua hay requeue hàng loạt.
 */
@Controller('admin/dead-letters')
@RequirePlatformAdmin()
export class DeadLetterAdminController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
  ) {}

  /** `GET /v1/admin/dead-letters`: tối đa `DEAD_LETTER_JOBS_LIMIT` job mới vào dead-letter nhất trước, kèm `total`. */
  @Get()
  list(
    @PlatformAdminAccess() ctx: PlatformAdminContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DeadLetterJobList> {
    // Lý do lỗi và payload của job nhiều BTC: không cho cache.
    res.setHeader('cache-control', 'no-store');
    return this.db.transaction(async (tx) => {
      const reader = await platformAdminScope(tx, ctx, { type: 'dead_letter_jobs', id: 'all' });
      return listDeadLetterJobs(reader, DEAD_LETTER_JOBS_LIMIT);
    });
  }

  /**
   * `POST /v1/admin/dead-letters/:id/requeue` → 204: job mới cùng payload ở queue gốc, dòng dead-letter bị xóa, audit
   * `dead_letter_job.requeued`. Id sai dạng → 400 `VALIDATION_FAILED`; job không còn trong dead-letter (kể cả khi hai
   * người bấm cùng lúc và bên kia thắng) hoặc pg-boss không chuyển được → 409 `DEAD_LETTER_JOB_GONE`, không đổi gì,
   * không audit.
   */
  @Post(':id/requeue')
  @HttpCode(204)
  async requeue(@PlatformAdminAccess() ctx: PlatformAdminContext, @Param('id') rawId: string): Promise<void> {
    const { id } = parseRequest(DeadLetterJobParams, { id: rawId });
    // Vai `api` start pg-boss chạy nền (chế độ `producer`); `redrive` cần pg-boss đã start (gọi lại không sao).
    await this.boss.start();
    await this.db.transaction(async (tx) => {
      const requeued = await requeueDeadLetterJob(this.boss, tx, id);
      if (!requeued) throw new AppError(ErrorCode.DEAD_LETTER_JOB_GONE, 'Job không còn trong dead-letter.');
      await audit.record(tx, {
        actorUserId: ctx.userId,
        organizationId: null,
        action: 'dead_letter_job.requeued',
        target: { type: 'dead_letter_job', id: `${requeued.queue}:${requeued.id}` },
      });
    });
  }
}
