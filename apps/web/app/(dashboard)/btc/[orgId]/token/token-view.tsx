'use client';

import { useQuery } from '@tanstack/react-query';
import {
  OrganizationSection,
  organizationSectionPath,
  TokenReadingStatus,
  type Role,
  type TokenBalanceReading,
  type TokenOverview,
} from '@tickee/contracts';
import { Landmark } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { useCurrentOrganization } from '@/components/tickee/current-organization';
import { EmptyState } from '@/components/tickee/empty-state';
import { PageHeading } from '@/components/tickee/page-heading';
import { StatCard } from '@/components/tickee/stat-card';
import { StatusBanner } from '@/components/tickee/status-banner';
import { TingeeLink } from '@/components/tickee/tingee-link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { handledElsewhere } from '@/lib/api/handled-elsewhere';
import { messageOf } from '@/lib/api/message-of';
import { navSection } from '@/lib/organizer/nav';
import { fetchToken, tokenQueryKey } from '@/lib/organizer/api';
import {
  canLinkPayoutAccount,
  formatTokenCount,
  TOKEN_AVAILABLE_CAPTION,
  TOKEN_AVAILABLE_LABEL,
  TOKEN_BALANCE_LABEL,
  TOKEN_CREDIT_LIMIT_LABEL,
  TOKEN_INTRO,
  TOKEN_NO_PAYOUT_ACCOUNT_ACTION,
  TOKEN_NO_PAYOUT_ACCOUNT_ADMIN,
  TOKEN_NO_PAYOUT_ACCOUNT_OWNER,
  TOKEN_NO_PAYOUT_ACCOUNT_TITLE,
  TOKEN_PURCHASE_ADMIN,
  TOKEN_PURCHASE_LABEL,
  TOKEN_PURCHASE_NOTE,
  TOKEN_UNAVAILABLE_DESCRIPTION,
  TOKEN_UNAVAILABLE_TITLE,
  tokenPurchaseOf,
  tokenReadAtLabel,
} from '@/lib/organizer/token';

/*
 * Trang Token (Story 4.5-a, FR-34), Owner và Admin. Mỗi lần mở trang api đọc số dư và hạn mức từ Tingee một lần (không
 * lưu); trang không tự đọc lại (không chu kỳ, không khi focus hay có mạng lại), chỉ khi bấm "Tải lại"/"Thử lại", và rời
 * trang thì bỏ số đã đọc. Các trạng thái: đang tải → skeleton; đọc được → `stat-card` "Token khả dụng", hai `card` sáng
 * "Số dư" và "Hạn mức trả sau", "Đọc lúc {HH:mm:ss}" + "Tải lại"; chưa đọc được → "Chưa đọc được số dư" + "Thử lại";
 * chưa có tài khoản nhận tiền mặc định → `empty-state` theo vai. Khối "Mua thêm Token" hiện ở mọi trạng thái đã tải
 * (kể cả chưa đọc được): Owner có link portal Tingee (tab mới), Admin thấy "Chỉ Owner mua thêm Token.". Lỗi của chính
 * api (không tự thử lại) → banner "Chưa tải được Token" + "Thử lại", nằm trên số cũ nếu đã có.
 */

const cardClass = 'flex min-w-0 flex-col gap-1 rounded-lg bg-card p-card-padding shadow-card';

function TokenSkeleton() {
  return (
    <div role="status" aria-busy="true" data-slot="token-skeleton" className="flex flex-col gap-stack">
      <span className="sr-only">Đang đọc Token</span>
      <Skeleton className="h-28" />
      <div className="grid gap-stack sm:grid-cols-2">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    </div>
  );
}

/** `card` sáng của một số phụ (Số dư, Hạn mức trả sau). */
function TokenFigure({ label, value, slot }: { label: string; value: number; slot: string }) {
  return (
    <div data-slot={slot} className={cardClass}>
      <p className="text-label text-muted-foreground">{label}</p>
      <p data-slot="token-figure-value" className="text-title tabular-nums wrap-break-word">
        {formatTokenCount(value)}
      </p>
    </div>
  );
}

function TokenFigures({
  reading,
  reloading,
  onReload,
}: {
  reading: TokenBalanceReading;
  reloading: boolean;
  onReload: () => void;
}) {
  return (
    <div data-slot="token-reading" className="flex flex-col gap-stack">
      <StatCard
        label={TOKEN_AVAILABLE_LABEL}
        value={formatTokenCount(reading.available)}
        caption={TOKEN_AVAILABLE_CAPTION}
        className="wrap-break-word"
      />
      <div className="grid gap-stack sm:grid-cols-2">
        <TokenFigure slot="token-balance" label={TOKEN_BALANCE_LABEL} value={reading.balance} />
        <TokenFigure slot="token-credit-limit" label={TOKEN_CREDIT_LIMIT_LABEL} value={reading.creditLimit} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p aria-live="polite" data-slot="token-read-at" className="text-meta text-muted-foreground tabular-nums">
          {tokenReadAtLabel(reading.readAt)}
        </p>
        <Button type="button" variant="secondary" size="sm" loading={reloading} onClick={onReload}>
          Tải lại
        </Button>
      </div>
    </div>
  );
}

function NoPayoutAccount({ role, orgId }: { role: Role; orgId: string }) {
  const owner = canLinkPayoutAccount(role);
  return (
    <EmptyState
      icon={Landmark}
      title={TOKEN_NO_PAYOUT_ACCOUNT_TITLE}
      description={owner ? TOKEN_NO_PAYOUT_ACCOUNT_OWNER : TOKEN_NO_PAYOUT_ACCOUNT_ADMIN}
      className="rounded-lg bg-card px-card-padding shadow-card"
      action={
        owner ? (
          <Button asChild variant="secondary">
            <Link href={organizationSectionPath(orgId, OrganizationSection.PAYOUT_ACCOUNT)}>
              {TOKEN_NO_PAYOUT_ACCOUNT_ACTION}
            </Link>
          </Button>
        ) : undefined
      }
    />
  );
}

/** "Mua thêm Token" theo vai (`tokenPurchaseOf`) kèm câu Tickee không bán Token. */
function TokenPurchaseBlock({ role, overview }: { role: Role; overview: TokenOverview }) {
  const purchase = tokenPurchaseOf(role, overview.tingeePortalUrl);
  return (
    <section aria-label="Mua Token" data-slot="token-purchase" className={`${cardClass} gap-stack`}>
      <p className="text-body text-muted-foreground">{TOKEN_PURCHASE_NOTE}</p>
      {purchase.kind === 'link' ? (
        <Button asChild className="self-start">
          <TingeeLink href={purchase.href} className="no-underline">
            {TOKEN_PURCHASE_LABEL}
          </TingeeLink>
        </Button>
      ) : purchase.kind === 'owner_only' ? (
        <p className="text-body">{TOKEN_PURCHASE_ADMIN}</p>
      ) : null}
    </section>
  );
}

export function TokenView() {
  const organization = useCurrentOrganization();
  const orgId = organization.id;
  const { label } = navSection('token');
  const query = useQuery({
    queryKey: tokenQueryKey(orgId),
    queryFn: ({ signal }) => fetchToken(orgId, signal),
    // Một lần đọc mỗi lần mở trang; chỉ đọc lại khi người dùng bấm (không tự thử lại: mỗi lần đọc là một lời gọi
    // Tingee). Rời trang thì bỏ số (không giữ trong cache).
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 0,
  });
  const reload = () => {
    if (!query.isFetching) void query.refetch();
  };

  let body: ReactNode;
  const data = query.data;
  // Lỗi của chính api (không phải Tingee): lần tải đầu, hoặc "Tải lại"/"Thử lại" sau khi đã có số (số cũ giữ nguyên).
  const loadError =
    query.isError && !handledElsewhere(query.error) ? (
      <StatusBanner
        tone="danger"
        title="Chưa tải được Token"
        description={messageOf(query.error)}
        action={
          <Button type="button" variant="link" size="sm" loading={query.isFetching} onClick={reload}>
            Thử lại
          </Button>
        }
      />
    ) : null;
  if (!data) {
    body = loadError ?? <TokenSkeleton />;
  } else {
    const { reading } = data;
    let readingBody: ReactNode;
    if (reading.status === TokenReadingStatus.OK) {
      readingBody = <TokenFigures reading={reading} reloading={query.isFetching} onReload={reload} />;
    } else if (reading.status === TokenReadingStatus.UNAVAILABLE) {
      readingBody = (
        <div data-slot="token-unavailable">
          <StatusBanner
            tone="warning"
            title={TOKEN_UNAVAILABLE_TITLE}
            description={TOKEN_UNAVAILABLE_DESCRIPTION}
            action={
              <Button type="button" variant="link" size="sm" loading={query.isFetching} onClick={reload}>
                Thử lại
              </Button>
            }
          />
        </div>
      );
    } else {
      readingBody = <NoPayoutAccount role={organization.role} orgId={orgId} />;
    }
    body = (
      <>
        {loadError}
        {readingBody}
        <TokenPurchaseBlock role={organization.role} overview={data} />
      </>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-section pt-2">
      <div className="flex flex-col gap-2">
        <PageHeading eyebrow={organization.name} title={label} />
        <p className="text-body text-muted-foreground">{TOKEN_INTRO}</p>
      </div>
      {body}
    </div>
  );
}
