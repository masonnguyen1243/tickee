'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ErrorCode,
  EventStatus,
  MIN_PAID_PRICE,
  organizationSectionPath,
  unmetConditions,
  type EventDetail,
  type PublishConditionCode,
} from '@tickee/contracts';
import { CircleCheck, Copy } from 'lucide-react';
import Link from 'next/link';
import { useId, useSyncExternalStore } from 'react';
import { toast } from 'sonner';

import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/errors';
import { hasErrorCode } from '@/lib/auth/api';
import { copyWithToast } from '@/lib/clipboard';
import {
  eventQueryKey,
  eventReadinessQueryKey,
  eventsQueryKey,
  fetchPublishReadiness,
  publishEvent,
} from '@/lib/event/api';

import { handledElsewhere } from './handled-elsewhere';

/*
 * Wizard bước 4, phần mở bán (Story 2.10, AD-34): server quyết định điều kiện (`GET …/publish-readiness`), web chỉ ánh
 * xạ `code` sang câu và lối sửa nhanh. Chỉ liệt kê điều kiện chưa đạt. "Mở bán" tắt khi còn thiếu, có lý do ngay cạnh
 * nút; server kiểm lại khi mở bán, nên 409 `EVENT_NOT_READY` thì báo lỗi và tải lại danh sách. Mở bán xong (hoặc Sự kiện
 * đã `published`) thì hiện link công khai `{origin}/e/{slug}` và "Sao chép link".
 */

/** Lối sửa của một điều kiện: về một bước của wizard, sang một trang khác, hoặc không có (chỉ hướng dẫn). */
type Fix = { kind: 'step'; step: number; label: string } | { kind: 'page'; href: (orgId: string) => string; label: string };

type ConditionCopy = { message: string; hint?: string; fix?: Fix };

const STEP_INFO = 0;
const STEP_TICKET_TYPES = 1;

/** Câu và lối sửa của từng mã điều kiện (thứ tự hiển thị theo thứ tự server trả). */
export const PUBLISH_CONDITION_COPY: Readonly<Record<PublishConditionCode, ConditionCopy>> = {
  REFUND_POLICY: {
    message: 'Thiếu chính sách hoàn vé — chưa mở bán được.',
    fix: { kind: 'step', step: STEP_INFO, label: 'Thêm chính sách hoàn vé' },
  },
  HAS_TICKET_TYPE: {
    message: 'Chưa có Hạng vé nào.',
    fix: { kind: 'step', step: STEP_TICKET_TYPES, label: 'Thêm Hạng vé' },
  },
  EVENT_NOT_ENDED: {
    message: 'Sự kiện đã kết thúc.',
    fix: { kind: 'step', step: STEP_INFO, label: 'Sửa thời gian' },
  },
  ORGANIZATION_NOT_LOCKED: {
    message: 'BTC đang bị khóa.',
    hint: 'Liên hệ Tingee để được hỗ trợ.',
  },
  CLOSED_BETA_APPROVED: {
    message: 'Chờ duyệt Closed Beta',
    hint: 'Sự kiện có Hạng vé có phí cần BTC được Tingee duyệt vào Closed Beta. Liên hệ Tingee để được duyệt.',
  },
  PAYOUT_ACCOUNT_LINKED: {
    message: 'Chưa có tài khoản nhận tiền.',
    fix: {
      kind: 'page',
      href: (orgId) => organizationSectionPath(orgId, 'payout-account'),
      label: 'Liên kết tài khoản nhận tiền',
    },
  },
  PAID_PRICE_MINIMUM: {
    message: `Có Hạng vé có phí giá dưới ${MIN_PAID_PRICE.toLocaleString('vi-VN')}đ.`,
    fix: { kind: 'step', step: STEP_TICKET_TYPES, label: 'Sửa giá Hạng vé' },
  },
};

const messageOf = (error: unknown) => (error instanceof ApiError ? error.message : 'Đã có lỗi xảy ra. Vui lòng thử lại.');

/** `window.location.origin` sau khi hydrate (server render ra chuỗi rỗng). */
const subscribeNoop = () => () => {};
function useOrigin(): string {
  return useSyncExternalStore(
    subscribeNoop,
    () => window.location.origin,
    () => '',
  );
}

type PublishPanelProps = {
  orgId: string;
  event: EventDetail;
  /** Chuyển wizard sang bước `step` (0 = Thông tin); dữ liệu đang nhập giữ nguyên. */
  onGoToStep: (step: number) => void;
};

export function PublishPanel({ orgId, event, onGoToStep }: PublishPanelProps) {
  const titleId = useId();
  const reasonId = useId();
  const queryClient = useQueryClient();
  const published = event.status === EventStatus.PUBLISHED;

  const readiness = useQuery({
    queryKey: eventReadinessQueryKey(orgId, event.id),
    queryFn: ({ signal }) => fetchPublishReadiness(orgId, event.id, signal),
    // Điều kiện đổi theo bước 1–2 và trang khác (Closed Beta, tài khoản nhận tiền): mỗi lần vào bước 4 đều tải lại.
    staleTime: 0,
    refetchOnMount: 'always',
    enabled: event.status === EventStatus.DRAFT,
  });

  const publish = useMutation({
    mutationFn: () => publishEvent(orgId, event.id),
    onSuccess: (saved) => {
      queryClient.setQueryData(eventQueryKey(orgId, saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: eventQueryKey(orgId, saved.id) });
      void queryClient.invalidateQueries({ queryKey: eventsQueryKey(orgId) });
      toast.success('Đã mở bán Sự kiện.');
    },
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.EVENT_NOT_READY)) {
        toast.error('Sự kiện chưa đủ điều kiện mở bán. Đã tải lại danh sách điều kiện.');
        void readiness.refetch();
      } else if (hasErrorCode(error, ErrorCode.EVENT_NOT_DRAFT)) {
        // Người khác vừa mở bán (hoặc trạng thái đã đổi): tải lại Sự kiện để hiện đúng trạng thái.
        toast.info('Sự kiện không còn ở trạng thái nháp. Đã tải lại Sự kiện.');
        void queryClient.invalidateQueries({ queryKey: eventQueryKey(orgId, event.id) });
        void queryClient.invalidateQueries({ queryKey: eventsQueryKey(orgId) });
      }
    },
  });

  if (published) return <PublishedLink titleId={titleId} slug={event.slug} />;

  const unmet = readiness.data ? unmetConditions(readiness.data) : null;
  const ready = unmet !== null && unmet.length === 0;

  let reason: string | null = null;
  if (event.status !== EventStatus.DRAFT) reason = 'Chỉ mở bán được Sự kiện nháp.';
  else if (unmet === null) reason = readiness.isError ? 'Chưa tải được điều kiện mở bán.' : 'Đang kiểm tra điều kiện…';
  else if (unmet.length > 0) reason = `Chưa mở bán được: còn ${unmet.length} điều kiện chưa đạt.`;

  const failure =
    publish.error &&
    !hasErrorCode(publish.error, ErrorCode.EVENT_NOT_READY) &&
    !hasErrorCode(publish.error, ErrorCode.EVENT_NOT_DRAFT) &&
    !handledElsewhere(publish.error)
      ? publish.error
      : null;

  let body;
  if (unmet) {
    body =
      unmet.length === 0 ? (
        <p className="flex items-start gap-2 text-body text-success-text" data-slot="publish-ready">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <span>Đã đủ điều kiện mở bán.</span>
        </p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-stack" aria-label="Điều kiện còn thiếu" data-slot="publish-unmet">
          {unmet.map((code) => (
            <ConditionRow key={code} code={code} orgId={orgId} onGoToStep={onGoToStep} />
          ))}
        </ul>
      );
  } else if (readiness.isError && !handledElsewhere(readiness.error)) {
    body = (
      <StatusBanner
        tone="danger"
        title="Chưa tải được điều kiện mở bán"
        description={messageOf(readiness.error)}
        action={
          <Button type="button" variant="link" size="sm" onClick={() => void readiness.refetch()}>
            Thử lại
          </Button>
        }
      />
    );
  } else if (event.status === EventStatus.DRAFT) {
    body = (
      <div role="status" aria-busy="true" className="flex flex-col gap-stack">
        <span className="sr-only">Đang tải</span>
        <div aria-hidden="true" className="h-16 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  return (
    <section
      aria-labelledby={titleId}
      data-slot="publish-panel"
      className="flex min-w-0 flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card"
    >
      <h2 id={titleId} className="text-title">
        Mở bán
      </h2>
      {body}
      {failure ? (
        <StatusBanner
          tone="danger"
          title="Chưa mở bán được"
          description={messageOf(failure)}
          action={
            <Button type="button" variant="link" size="sm" onClick={() => publish.mutate()}>
              Thử lại
            </Button>
          }
        />
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-stack">
        <Button
          type="button"
          disabled={!ready && !publish.isPending}
          loading={publish.isPending}
          aria-describedby={reason ? reasonId : undefined}
          onClick={() => {
            if (ready && !publish.isPending) publish.mutate();
          }}
        >
          Mở bán
        </Button>
        {reason ? (
          <p id={reasonId} className="min-w-0 text-meta text-muted-foreground" data-slot="publish-reason">
            {reason}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ConditionRow({
  code,
  orgId,
  onGoToStep,
}: {
  code: PublishConditionCode;
  orgId: string;
  onGoToStep: (step: number) => void;
}) {
  const copy = PUBLISH_CONDITION_COPY[code];
  const fix = copy.fix;
  return (
    <li
      data-code={code}
      className="flex min-w-0 flex-col gap-1 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-stack"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-label break-words">{copy.message}</p>
        {copy.hint ? <p className="text-meta text-muted-foreground break-words">{copy.hint}</p> : null}
      </div>
      {fix?.kind === 'step' ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="self-start sm:self-auto"
          onClick={() => onGoToStep(fix.step)}
        >
          {fix.label}
        </Button>
      ) : fix?.kind === 'page' ? (
        <Button asChild variant="link" size="sm" className="self-start sm:self-auto">
          <Link href={fix.href(orgId)}>{fix.label}</Link>
        </Button>
      ) : null}
    </li>
  );
}

function PublishedLink({ titleId, slug }: { titleId: string; slug: string }) {
  const origin = useOrigin();
  const url = `${origin}/e/${slug}`;
  return (
    <section
      aria-labelledby={titleId}
      data-slot="publish-panel"
      className="flex min-w-0 flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card"
    >
      <h2 id={titleId} className="text-title">
        Đang mở bán
      </h2>
      <p className="text-meta text-muted-foreground">Gửi link này cho Người mua để họ đặt vé.</p>
      <div className="flex min-w-0 flex-col gap-stack sm:flex-row sm:items-center">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 break-all text-body text-brand-text underline underline-offset-2"
          data-slot="public-event-link"
        >
          {url}
        </a>
        <Button type="button" variant="secondary" className="self-start sm:self-auto" onClick={() => void copyWithToast(url)}>
          <Copy aria-hidden="true" />
          Sao chép link
        </Button>
      </div>
    </section>
  );
}
