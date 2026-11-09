'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ErrorCode,
  EventStatus,
  MIN_PAID_PRICE,
  Permission,
  StatusNoticeCode,
  organizationSectionPath,
  roleHasPermission,
  unmetConditions,
  type EventDetail,
  type PublishConditionCode,
  type Role,
} from '@tickee/contracts';
import { CircleCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { toast } from 'sonner';

import { useCurrentOrganization } from '@/components/tickee/current-organization';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { handledElsewhere } from '@/lib/api/handled-elsewhere';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import {
  eventQueryKey,
  eventReadinessQueryKey,
  eventsQueryKey,
  fetchPublishReadiness,
  publishEvent,
} from '@/lib/event/api';
import { fetchStatusNotices, statusNoticesQueryKey } from '@/lib/reporting/api';
import { statusNoticeContent } from '@/lib/reporting/status-notices';

import { PublicEventLink } from './public-event-link';

/*
 * Wizard bước 4, phần mở bán (Story 2.10, AD-34): server quyết định điều kiện (`GET …/publish-readiness`), web chỉ ánh
 * xạ `code` sang câu và lối sửa nhanh. Chỉ liệt kê điều kiện chưa đạt. "Mở bán" chỉ bật khi danh sách điều kiện vừa tải
 * xong và đạt hết (không dựa vào cache cũ đang tải lại hoặc tải lại lỗi), có lý do ngay cạnh nút khi tắt; server kiểm
 * lại khi mở bán, nên 409 `EVENT_NOT_READY` thì báo lỗi và tải lại danh sách. Mở bán xong (hoặc Sự kiện đã `published`)
 * thì hiện link công khai `{origin}/e/{slug}` và "Sao chép link". Sau mở bán và sau 409, focus chuyển sang tiêu đề của
 * panel để bàn phím không rơi về đầu trang.
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
  // Câu thật lấy theo banner trạng thái (chờ duyệt / bị thu hồi) trong `conditionCopy`.
  CLOSED_BETA_APPROVED: { message: 'Chờ duyệt Closed Beta' },
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

/** Ngữ cảnh của người xem để chọn câu: vai ở BTC và BTC có đang bị thu hồi Closed Beta không. */
type CopyContext = { role: Role; closedBetaRevoked: boolean };

/**
 * Câu và lối sửa của một mã theo người xem.
 * - Closed Beta: dùng đúng câu của banner trạng thái (`CLOSED_BETA_PENDING`/`CLOSED_BETA_REVOKED`). Chưa có kênh liên
 *   hệ Tingee nên không có link (quyết định 02/11/2026).
 * - Tài khoản nhận tiền: chỉ ai có quyền quản lý (Owner) mới có link; Admin được nhắc nhờ Owner, như banner.
 */
function conditionCopy(code: PublishConditionCode, { role, closedBetaRevoked }: CopyContext): ConditionCopy {
  if (code === 'CLOSED_BETA_APPROVED') {
    const notice = statusNoticeContent(
      closedBetaRevoked ? StatusNoticeCode.CLOSED_BETA_REVOKED : StatusNoticeCode.CLOSED_BETA_PENDING,
      role,
    );
    return { message: notice.title, hint: notice.description };
  }
  if (code === 'PAYOUT_ACCOUNT_LINKED' && !roleHasPermission(role, Permission.PAYOUT_ACCOUNT_MANAGE)) {
    return { message: PUBLISH_CONDITION_COPY[code].message, hint: 'Nhờ Owner liên kết tài khoản nhận tiền.' };
  }
  return PUBLISH_CONDITION_COPY[code];
}

/** Focus `ref` một lần sau khi mount nếu `enabled` (vd. tiêu đề "Đang mở bán" thay cho nút "Mở bán" vừa bị gỡ). */
function useFocusOnMount(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    if (enabled) ref.current?.focus();
    // Chỉ lúc mount: lần render sau (invalidate, refetch) không kéo focus về lại.
  }, []);
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
  const titleRef = useRef<HTMLHeadingElement>(null);
  const queryClient = useQueryClient();
  const organization = useCurrentOrganization();
  const published = event.status === EventStatus.PUBLISHED;
  const isDraft = event.status === EventStatus.DRAFT;
  /** Vừa thấy Sự kiện chuyển sang `published` từ panel này (mở bán xong hoặc 409 `EVENT_NOT_DRAFT`): focus tiêu đề link. */
  const [focusPublished, setFocusPublished] = useState(false);

  const readiness = useQuery({
    queryKey: eventReadinessQueryKey(orgId, event.id),
    queryFn: ({ signal }) => fetchPublishReadiness(orgId, event.id, signal),
    // Điều kiện đổi theo bước 1–2 và trang khác (Closed Beta, tài khoản nhận tiền): mỗi lần vào bước 4 đều tải lại.
    staleTime: 0,
    refetchOnMount: 'always',
    enabled: isDraft,
  });
  // Cùng khóa với dải banner của dashboard (thường đã có sẵn trong cache): chỉ dùng để chọn câu Closed Beta.
  const notices = useQuery({
    queryKey: statusNoticesQueryKey(orgId),
    queryFn: ({ signal }) => fetchStatusNotices(orgId, signal),
    enabled: isDraft,
  });
  const copyContext: CopyContext = {
    role: organization.role,
    closedBetaRevoked: (notices.data ?? []).some((n) => n.code === StatusNoticeCode.CLOSED_BETA_REVOKED),
  };

  const publish = useMutation({
    mutationFn: () => publishEvent(orgId, event.id),
    onSuccess: (saved) => {
      setFocusPublished(true);
      queryClient.setQueryData(eventQueryKey(orgId, saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: eventQueryKey(orgId, saved.id) });
      void queryClient.invalidateQueries({ queryKey: eventsQueryKey(orgId) });
      toast.success('Đã mở bán Sự kiện.');
    },
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.EVENT_NOT_READY)) {
        toast.error('Sự kiện chưa đủ điều kiện mở bán. Đang tải lại danh sách điều kiện.');
        // Nút sắp bị tắt (focus sẽ rơi về `body`): chuyển focus sang tiêu đề, ngay trên danh sách điều kiện.
        titleRef.current?.focus();
        void readiness.refetch();
      } else if (hasErrorCode(error, ErrorCode.EVENT_NOT_DRAFT)) {
        // Người khác vừa mở bán (hoặc trạng thái đã đổi): tải lại Sự kiện để hiện đúng trạng thái.
        toast.info('Sự kiện không còn ở trạng thái nháp. Đã tải lại Sự kiện.');
        setFocusPublished(true);
        void queryClient.invalidateQueries({ queryKey: eventQueryKey(orgId, event.id) });
        void queryClient.invalidateQueries({ queryKey: eventsQueryKey(orgId) });
      }
    },
  });

  if (published) return <PublishedLink titleId={titleId} slug={event.slug} focusTitle={focusPublished} />;

  // Không dùng dữ liệu cũ khi lần tải lại lỗi; đang tải lại thì vẫn hiện danh sách cũ nhưng chưa cho mở bán.
  const unmet = readiness.data && !readiness.isError ? unmetConditions(readiness.data) : null;
  const checking = readiness.isFetching;
  const ready = !checking && unmet !== null && unmet.length === 0;

  let reason: string | null = null;
  if (!isDraft) reason = 'Chỉ mở bán được Sự kiện nháp.';
  else if (readiness.isError && !checking) reason = 'Chưa tải được điều kiện mở bán.';
  else if (unmet === null || checking) reason = 'Đang kiểm tra điều kiện…';
  else if (unmet.length > 0) reason = `Chưa mở bán được: còn ${unmet.length} điều kiện chưa đạt.`;

  const failure =
    publish.error &&
    !hasErrorCode(publish.error, ErrorCode.EVENT_NOT_READY) &&
    !hasErrorCode(publish.error, ErrorCode.EVENT_NOT_DRAFT) &&
    !handledElsewhere(publish.error)
      ? publish.error
      : null;

  let body;
  if (readiness.isError && !checking && !handledElsewhere(readiness.error)) {
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
  } else if (unmet) {
    body =
      unmet.length === 0 ? (
        <p className="flex items-start gap-2 text-body text-success-text" data-slot="publish-ready">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <span>Đã đủ điều kiện mở bán.</span>
        </p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-stack" aria-label="Điều kiện còn thiếu" data-slot="publish-unmet">
          {unmet.map((code) => (
            <ConditionRow
              key={code}
              code={code}
              copy={conditionCopy(code, copyContext)}
              orgId={orgId}
              onGoToStep={onGoToStep}
            />
          ))}
        </ul>
      );
  } else if (isDraft) {
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
      <h2 id={titleId} ref={titleRef} tabIndex={-1} className="text-title outline-none">
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
  copy,
  orgId,
  onGoToStep,
}: {
  code: PublishConditionCode;
  copy: ConditionCopy;
  orgId: string;
  onGoToStep: (step: number) => void;
}) {
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

function PublishedLink({ titleId, slug, focusTitle }: { titleId: string; slug: string; focusTitle: boolean }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useFocusOnMount(titleRef, focusTitle);
  return (
    <section
      aria-labelledby={titleId}
      data-slot="publish-panel"
      className="flex min-w-0 flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card"
    >
      <h2 id={titleId} ref={titleRef} tabIndex={-1} className="text-title outline-none">
        Đang mở bán
      </h2>
      <p className="text-meta text-muted-foreground">Gửi link này cho Người mua để họ đặt vé.</p>
      <PublicEventLink slug={slug} />
    </section>
  );
}
