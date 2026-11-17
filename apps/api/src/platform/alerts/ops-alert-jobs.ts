import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { PgBoss } from 'pg-boss';
import { EMAIL_TRANSPORT, type EmailTransport } from '../email/index.js';
import { BOSS, errorName, JOB_COMPLETED, registerQueueWorker, type JobOutcome } from '../jobs/index.js';
import { buildOpsAlertEmail } from './ops-alert-email.js';
import { OPS_ALERT_QUEUE, type OpsAlertPayload } from './ops-alerts.js';

/*
 * Gửi email cảnh báo vận hành (Story 4.6-b), chỉ vai worker: job `platform.ops-alert` (do `raise` enqueue) → một email
 * tới mọi địa chỉ của `OPS_ALERT_EMAILS`. Không đặt biến: worker log `warn` một lần lúc khởi động, rồi mỗi job chỉ log
 * `warn` và xong (không retry). Gửi lỗi: pg-boss retry, hết lượt thì job sang `platform.ops-alert.dead-letter`.
 */

/** Token DI của người nhận email cảnh báo vận hành. */
export const OPS_ALERT_DELIVERY = Symbol('OPS_ALERT_DELIVERY');

export interface OpsAlertDelivery {
  /** `OPS_ALERT_EMAILS`; rỗng = chỉ log. */
  recipients: readonly string[];
}

/**
 * Gửi email của một job tới `recipients` (một email, mọi người nhận cùng dòng `to`). Không có người nhận →
 * `no_recipients`, không gửi. Gửi lỗi → ném lỗi chỉ mang tên lớp (message SMTP có thể chứa địa chỉ email) để pg-boss
 * retry.
 */
export async function sendOpsAlert(
  email: EmailTransport,
  recipients: readonly string[],
  payload: OpsAlertPayload,
): Promise<'sent' | 'no_recipients'> {
  if (recipients.length === 0) return 'no_recipients';
  try {
    await email.send({ to: recipients.join(', '), ...buildOpsAlertEmail(payload) });
  } catch (err) {
    throw new Error(`Không gửi được email cảnh báo vận hành (${errorName(err)})`);
  }
  return 'sent';
}

/** Vai `worker`: tạo queue email cảnh báo vận hành (và dead-letter) rồi đăng ký handler. */
@Injectable()
export class OpsAlertEmailWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger('OpsAlertEmailWorker');

  constructor(
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(EMAIL_TRANSPORT) private readonly email: EmailTransport,
    @Inject(OPS_ALERT_DELIVERY) private readonly delivery: OpsAlertDelivery,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.delivery.recipients.length === 0) {
      this.logger.warn('Chưa đặt OPS_ALERT_EMAILS: cảnh báo vận hành chỉ ghi log, không gửi email');
    }
    await registerQueueWorker(this.boss, OPS_ALERT_QUEUE, {
      logger: this.logger,
      label: 'Gửi email cảnh báo vận hành',
      logContext: ({ kind }) => ({ alertKind: kind }),
      handle: (payload) => this.deliver(payload),
    });
  }

  /**
   * Một job: gửi email, hoặc (không có người nhận) log `warn` rồi xong. Gửi lỗi → ném (pg-boss retry). Loại cảnh báo
   * (`alertKind`) đã có trong ngữ cảnh log của job.
   */
  async deliver(payload: OpsAlertPayload): Promise<JobOutcome> {
    if ((await sendOpsAlert(this.email, this.delivery.recipients, payload)) === 'no_recipients') {
      this.logger.warn({ count: payload.count }, 'Chưa đặt OPS_ALERT_EMAILS: không gửi email cảnh báo vận hành');
    }
    return JOB_COMPLETED;
  }
}
