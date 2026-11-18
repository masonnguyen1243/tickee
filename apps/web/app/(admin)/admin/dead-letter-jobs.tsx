'use client';

import { formatVnDateTime, type DeadLetterJob } from '@tickee/contracts';

import { ConfirmDialog } from '@/components/tickee/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { messageOf } from '@/lib/api/message-of';

/*
 * Tab "Dead-letter" của `/admin` (Story 4.6-d, AD-12): bảng job pg-boss hết retry đang nằm trong dead-letter và `Dialog`
 * "Requeue" từng job về queue gốc. Gọi api, cổng quyền và toast ở `ClosedBetaReview` (dùng chung cách xử lý với các tab
 * khác). Không có xóa hay requeue hàng loạt: job không muốn chạy lại thì để đó, pg-boss tự xóa sau 14 ngày.
 */

export const DEAD_LETTER_EMPTY = 'Không có job nào trong dead-letter.';
export const DEAD_LETTER_EMPTY_DESCRIPTION = 'Job hết lượt thử lại sẽ hiện ở đây.';

/** Job có queue gốc thì requeue được (pg-boss không ghi queue gốc cho job chép tay vào dead-letter). */
export type RequeueableDeadLetterJob = DeadLetterJob & { sourceQueue: string };

const isRequeueable = (job: DeadLetterJob): job is RequeueableDeadLetterJob => job.sourceQueue !== null;

/**
 * Bảng job theo thứ tự api trả (mới vào dead-letter nhất trước). Api chỉ trả tối đa 200 job: còn nhiều hơn thì ghi rõ
 * đang hiện bao nhiêu. Giờ theo giờ Việt Nam.
 */
export function DeadLetterTable({
  jobs,
  total,
  onRequeue,
}: {
  jobs: DeadLetterJob[];
  total: number;
  onRequeue: (job: RequeueableDeadLetterJob) => void;
}) {
  return (
    <div className="flex flex-col gap-stack">
      {total > jobs.length ? (
        <p data-slot="dead-letter-truncated" className="text-meta text-muted-foreground">
          Đang hiện {jobs.length}/{total} job mới nhất
        </p>
      ) : null}
      <div className="rounded-lg bg-card px-card-padding shadow-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Queue gốc</TableHead>
              <TableHead>Vào dead-letter</TableHead>
              <TableHead>Số lần đã thử</TableHead>
              <TableHead>Lý do lỗi</TableHead>
              <TableHead>Payload</TableHead>
              <TableHead>
                <span className="sr-only">Thao tác</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.id} data-slot="dead-letter-row" className="align-top">
                <TableCell className="align-top">
                  <div className="flex flex-col gap-0.5">
                    {job.sourceQueue ? (
                      <span className="font-medium">{job.sourceQueue}</span>
                    ) : (
                      <span className="text-muted-foreground">Không rõ queue gốc</span>
                    )}
                    {/* Id job dead-letter: id mà email cảnh báo nêu. */}
                    <span className="font-mono text-meta text-muted-foreground tabular-nums">{job.id}</span>
                    {job.sourceJobId ? (
                      <span data-slot="dead-letter-source-job" className="text-meta text-muted-foreground">
                        Job gốc: <span className="font-mono tabular-nums">{job.sourceJobId}</span>
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="align-top">{formatVnDateTime(job.createdAt)}</TableCell>
                {/* `retryCount` là số lần thử lại; pg-boss bỏ job khi đủ `retry_limit` lần, nên số lần đã thử = +1. */}
                <TableCell data-slot="dead-letter-attempts" className="align-top tabular-nums">
                  {job.retryCount === null ? <span className="text-muted-foreground">Không rõ</span> : job.retryCount + 1}
                </TableCell>
                <TableCell className="max-w-80 min-w-48 align-top break-words whitespace-normal">
                  {job.reason ?? <span className="text-muted-foreground">Không có</span>}
                </TableCell>
                <TableCell className="max-w-80 min-w-48 align-top whitespace-normal">
                  <code className="font-mono text-meta break-all">{job.payload}</code>
                </TableCell>
                <TableCell className="text-right align-top">
                  {isRequeueable(job) ? (
                    <Button
                      type="button"
                      size="sm"
                      aria-label={`Requeue job ${job.id} vào ${job.sourceQueue}`}
                      onClick={() => onRequeue(job)}
                    >
                      Requeue
                    </Button>
                  ) : (
                    <span className="text-meta text-muted-foreground">Không requeue được</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** Xác nhận "Requeue": nêu queue gốc và hậu quả; lỗi của lần thử hiện trong `Dialog`. */
export function RequeueDialog({
  job,
  pending,
  failure,
  onConfirm,
  onClose,
}: {
  job: RequeueableDeadLetterJob | null;
  pending: boolean;
  failure: unknown;
  onConfirm: (job: RequeueableDeadLetterJob) => void;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      open={job !== null}
      onOpenChange={(open) => !open && onClose()}
      title={job ? `Requeue job vào ${job.sourceQueue}?` : null}
      titleClassName="break-words"
      descriptionClassName="break-words"
      description={
        job
          ? `Job chạy lại từ đầu ở ${job.sourceQueue} với payload cũ, lượt thử tính lại từ 0. Job gửi email sẽ gửi lại email.`
          : null
      }
      confirmLabel="Requeue"
      confirmVariant="primary-on-light"
      onConfirm={() => job && onConfirm(job)}
      pending={pending}
      failureTitle="Chưa requeue được"
      failure={Boolean(failure) && messageOf(failure)}
    />
  );
}
