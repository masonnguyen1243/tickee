'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ACCOUNT_SECURITY_PATH,
  eventPath,
  formatEventDateTime,
  OrganizationSection,
  organizationSectionPath,
  Role,
  type EventSummary,
} from '@tickee/contracts';
import { CalendarDays, Plus, ShieldCheck, X } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import { useCurrentOrganization } from '@/components/tickee/current-organization';
import { EmptyState } from '@/components/tickee/empty-state';
import { PageHeading } from '@/components/tickee/page-heading';
import { StatusBadge } from '@/components/tickee/status-badge';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/errors';
import { fetchMe, ME_QUERY_KEY } from '@/lib/auth/api';
import { eventsQueryKey, fetchEvents } from '@/lib/event/api';

import { EVENT_STATUS_BADGE } from './su-kien/event-status';
import { handledElsewhere } from './su-kien/handled-elsewhere';

/** Khóa `localStorage` ghi nhớ Owner đã đóng thẻ gợi ý bật 2FA, theo từng tài khoản trên trình duyệt này. */
const hintDismissedKey = (userId: string) => `tickee:goi-y-2fa:da-dong:${userId}`;

/** Đọc trạng thái đóng; storage bị chặn (chế độ riêng tư…) thì coi như chưa đóng: thẻ vẫn hiện. */
function readHintDismissed(userId: string): boolean {
  try {
    return window.localStorage.getItem(hintDismissedKey(userId)) === '1';
  } catch {
    return false;
  }
}

function saveHintDismissed(userId: string): void {
  try {
    window.localStorage.setItem(hintDismissedKey(userId), '1');
  } catch {
    // Không lưu được: lần tải sau thẻ hiện lại.
  }
}

/**
 * Thẻ gợi ý bật 2FA (UX-DR42): chỉ Owner chưa bật 2FA thấy; không chặn thao tác, đóng được (nhớ theo user trên
 * trình duyệt này). Không dùng `status-banner` vì banner chỉ đi qua `reporting.notices`.
 */
function TwoFactorHint() {
  const organization = useCurrentOrganization();
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: ({ signal }) => fetchMe(signal) });
  const [closed, setClosed] = useState(false);

  if (organization.role !== Role.OWNER || !me.data || me.data.twoFactorEnabled) return null;
  const userId = me.data.id;
  if (closed || readHintDismissed(userId)) return null;

  return (
    <section
      aria-label="Gợi ý bảo mật"
      data-slot="two-factor-hint"
      className="flex items-start gap-3 rounded-lg bg-card p-card-padding shadow-card"
    >
      <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand-text" />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <p className="text-body">Bật xác thực hai lớp để bảo vệ tài khoản nhận tiền.</p>
        <Button asChild variant="link" size="sm">
          <Link href={ACCOUNT_SECURITY_PATH}>Bật ngay</Link>
        </Button>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Đóng gợi ý"
        className="-my-2.5 -mr-2.5"
        onClick={() => {
          saveHintDismissed(userId);
          setClosed(true);
        }}
      >
        <X aria-hidden="true" />
      </Button>
    </section>
  );
}

/** `event-card` (DESIGN.md): chạm cả hàng mở tab Tổng quan của Sự kiện. Chưa có ảnh (Story 2.7-b): ô 56px nền thay thế. */
function EventCard({ orgId, event }: { orgId: string; event: EventSummary }) {
  const badge = EVENT_STATUS_BADGE[event.status];
  return (
    <li>
      <Link
        href={eventPath(orgId, event.id)}
        data-slot="event-card"
        className="flex min-w-0 items-center gap-3 rounded-lg bg-card px-card-padding py-card-padding shadow-card transition-[filter] active:brightness-95"
      >
        <span aria-hidden="true" className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted">
          <CalendarDays strokeWidth={1.5} className="size-6 text-muted-foreground" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-title">{event.name}</span>
          <span className="text-meta text-muted-foreground tabular-nums">{formatEventDateTime(event.startsAt)}</span>
        </span>
        <StatusBadge tone={badge.tone} className="shrink-0">
          {badge.label}
        </StatusBadge>
      </Link>
    </li>
  );
}

function EventListSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-stack">
      <span className="sr-only">Đang tải</span>
      {[0, 1].map((n) => (
        <div key={n} aria-hidden="true" className="h-[84px] animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

/** Danh sách Sự kiện của BTC (Story 2.7): `event-card` mới tạo trước; trống thì `empty-state` + "Tạo Sự kiện". */
function EventListSection() {
  const organization = useCurrentOrganization();
  const createHref = organizationSectionPath(organization.id, OrganizationSection.CREATE_EVENT);
  const events = useQuery({
    queryKey: eventsQueryKey(organization.id),
    queryFn: ({ signal }) => fetchEvents(organization.id, signal),
  });

  let body: ReactNode;
  if (events.data && events.data.length > 0) {
    body = (
      <ul className="flex flex-col gap-stack" aria-labelledby="org-events">
        {events.data.map((event) => (
          <EventCard key={event.id} orgId={organization.id} event={event} />
        ))}
      </ul>
    );
  } else if (events.data) {
    body = (
      <EmptyState
        icon={CalendarDays}
        title="Chưa có Sự kiện nào."
        description="Sự kiện bạn tạo sẽ hiện ở đây."
        className="rounded-lg bg-card px-card-padding shadow-card"
        action={
          <Button asChild variant="primary-on-light">
            <Link href={createHref}>Tạo Sự kiện</Link>
          </Button>
        }
      />
    );
  } else if (events.isError && !handledElsewhere(events.error)) {
    // Lỗi do nơi khác xử lý (2FA, đồng ý, 401, bị xóa khỏi BTC) giữ khung chờ, không báo lại ở đây.
    body = (
      <StatusBanner
        tone="danger"
        title="Chưa tải được danh sách Sự kiện"
        description={events.error instanceof ApiError ? events.error.message : 'Đã có lỗi xảy ra. Vui lòng thử lại.'}
        action={
          <Button type="button" variant="link" size="sm" onClick={() => void events.refetch()}>
            Thử lại
          </Button>
        }
      />
    );
  } else {
    body = <EventListSkeleton />;
  }

  return (
    <section aria-labelledby="org-events" className="flex flex-col gap-stack">
      <div className="flex flex-wrap items-center justify-between gap-stack">
        <h2 id="org-events" className="text-title">
          Sự kiện
        </h2>
        {events.data && events.data.length > 0 ? (
          <Button asChild variant="primary-on-light" size="sm">
            <Link href={createHref}>
              <Plus aria-hidden="true" />
              Tạo Sự kiện
            </Link>
          </Button>
        ) : null}
      </div>
      {body}
    </section>
  );
}

/** Tên BTC + danh sách Sự kiện. */
export function OrganizationHome() {
  const organization = useCurrentOrganization();
  return (
    <div className="flex flex-col gap-section pt-2">
      <PageHeading eyebrow="Dashboard BTC" title={organization.name} />
      <TwoFactorHint />
      <EventListSection />
    </div>
  );
}
