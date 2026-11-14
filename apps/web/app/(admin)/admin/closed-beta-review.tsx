'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ADMIN_PATH,
  ClosedBetaAction,
  ClosedBetaStatus,
  ErrorCode,
  formatVnDate,
  type ClosedBetaOrganization,
  type SuspendedPaymentServiceOrganization,
} from '@tickee/contracts';
import { Building2, CircleCheck, ShieldCheck, ShieldX } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/tickee/confirm-dialog';
import { EmptyState } from '@/components/tickee/empty-state';
import { PageHeading } from '@/components/tickee/page-heading';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ADMIN_QUERY_KEY,
  changeClosedBeta,
  closedBetaQueueQueryKey,
  fetchClosedBetaQueue,
  fetchSuspendedPaymentServices,
  resumePaymentService,
  SUSPENDED_PAYMENT_SERVICES_QUERY_KEY,
} from '@/lib/admin/api';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import { LOGIN_PATH, TOTP_ENROLL_PATH, withReturnTo } from '@/lib/auth/return-to';
import { isTotpRequired } from '@/lib/auth/totp';

import { ResumeDialog, SUSPENDED_EMPTY, SUSPENDED_EMPTY_DESCRIPTION, SuspendedTable } from './suspended-payment-services';

const TABS: readonly { status: ClosedBetaStatus; label: string; empty: string; emptyDescription: string }[] = [
  {
    status: ClosedBetaStatus.PENDING,
    label: 'Chờ duyệt',
    empty: 'Không có BTC chờ duyệt.',
    emptyDescription: 'BTC mới tạo sẽ hiện ở đây.',
  },
  {
    status: ClosedBetaStatus.APPROVED,
    label: 'Đã duyệt',
    empty: 'Không có BTC đã duyệt.',
    emptyDescription: 'BTC được duyệt vào Closed Beta sẽ hiện ở đây.',
  },
  {
    status: ClosedBetaStatus.REVOKED,
    label: 'Đã thu hồi',
    empty: 'Không có BTC bị thu hồi.',
    emptyDescription: 'BTC bị thu hồi Closed Beta sẽ hiện ở đây.',
  },
];

/** Tab thứ tư (Story 4.2-b): BTC đang bị ngắt dịch vụ thanh toán. */
const PAYMENT_SERVICE_TAB = 'payment-service';
type AdminTab = ClosedBetaStatus | typeof PAYMENT_SERVICE_TAB;

const isAdminTab = (value: string): value is AdminTab =>
  value === PAYMENT_SERVICE_TAB || (Object.values(ClosedBetaStatus) as string[]).includes(value);

/** Lỗi làm cả trang đổi trạng thái (không phải lỗi của một thao tác): mất cờ, chưa bật 2FA, hết phiên. */
const isGateError = (error: unknown) =>
  hasErrorCode(error, ErrorCode.FORBIDDEN_ROLE) ||
  hasErrorCode(error, ErrorCode.TWO_FACTOR_NOT_ENABLED) ||
  hasErrorCode(error, ErrorCode.UNAUTHENTICATED);

/**
 * Trạng thái của BTC đã đổi ở nơi khác (Quản trị Tingee khác, hay dịch vụ thanh toán đã về qua đường khác) hoặc BTC không
 * còn: tải lại danh sách.
 */
const isStale = (error: unknown) =>
  hasErrorCode(error, ErrorCode.CLOSED_BETA_TRANSITION_INVALID) ||
  hasErrorCode(error, ErrorCode.PAYMENT_SERVICE_NOT_SUSPENDED) ||
  hasErrorCode(error, ErrorCode.NOT_FOUND);

function Loading() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-stack">
      <span className="sr-only">Đang tải</span>
      <div aria-hidden="true" className="h-40 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

function Contact({ organization }: { organization: ClosedBetaOrganization }) {
  if (!organization.contactPhone && !organization.contactEmail) {
    return <span className="text-muted-foreground">Chưa có</span>;
  }
  return (
    <div className="flex flex-col">
      {organization.contactPhone ? <span>{organization.contactPhone}</span> : null}
      {organization.contactEmail ? <span>{organization.contactEmail}</span> : null}
    </div>
  );
}

function QueueTable({
  organizations,
  approvingId,
  onApprove,
  onRevoke,
}: {
  organizations: ClosedBetaOrganization[];
  /** Hàng đang được duyệt (`null` khi không có lần duyệt nào đang chạy). */
  approvingId: string | null;
  onApprove: (organization: ClosedBetaOrganization) => void;
  onRevoke: (organization: ClosedBetaOrganization) => void;
}) {
  return (
    <div className="rounded-lg bg-card px-card-padding shadow-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Tên BTC</TableHead>
            <TableHead>Email Owner</TableHead>
            <TableHead>SĐT / email liên hệ</TableHead>
            <TableHead>Ngày tạo</TableHead>
            <TableHead>
              <span className="sr-only">Thao tác</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {organizations.map((organization) => (
            <TableRow key={organization.id} data-slot="closed-beta-row">
              <TableCell className="font-medium whitespace-normal break-words">{organization.name}</TableCell>
              <TableCell>{organization.ownerEmail ?? <span className="text-muted-foreground">Không có Owner</span>}</TableCell>
              <TableCell>
                <Contact organization={organization} />
              </TableCell>
              <TableCell>{formatVnDate(organization.createdAt)}</TableCell>
              <TableCell className="text-right">
                {organization.closedBetaStatus === ClosedBetaStatus.APPROVED ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    aria-label={`Thu hồi ${organization.name}`}
                    onClick={() => onRevoke(organization)}
                  >
                    Thu hồi
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    aria-label={`Duyệt ${organization.name}`}
                    loading={approvingId === organization.id}
                    // Một lần duyệt mỗi lúc: hàng khác tắt hẳn (không nhận bấm mà im lặng) tới khi lần đang chạy xong.
                    disabled={approvingId !== null && approvingId !== organization.id}
                    onClick={() => onApprove(organization)}
                  >
                    Duyệt
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RevokeDialog({
  organization,
  pending,
  failure,
  onConfirm,
  onClose,
}: {
  organization: ClosedBetaOrganization | null;
  pending: boolean;
  failure: unknown;
  onConfirm: (organization: ClosedBetaOrganization) => void;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      open={organization !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Thu hồi Closed Beta?"
      descriptionClassName="break-words"
      description={organization ? `Sự kiện có phí của ${organization.name} sẽ Tạm ngừng bán.` : null}
      confirmLabel="Thu hồi"
      onConfirm={() => organization && onConfirm(organization)}
      pending={pending}
      failureTitle="Chưa thu hồi được"
      failure={Boolean(failure) && messageOf(failure)}
    />
  );
}

/**
 * Màn "Duyệt Closed Beta" (FR-37, UX-DR44): tab Chờ duyệt / Đã duyệt / Đã thu hồi; "Duyệt" ở Chờ duyệt và Đã thu hồi
 * (duyệt lại), "Thu hồi" ở Đã duyệt qua `Dialog` nêu hậu quả. Tab "Tạm ngừng bán" (Story 4.2-b): BTC đang bị ngắt dịch vụ
 * thanh toán (ngắt lâu nhất trước), "Mở lại" qua `Dialog`. Chưa đăng nhập → đăng nhập rồi quay về `/admin`; không
 * có quyền → `empty-state`; có quyền mà chưa bật 2FA → `empty-state` + "Bật xác thực hai lớp" (xong quay về `/admin`);
 * chưa qua lớp hai → `Providers` mở dialog "Xác thực hai lớp", xong thì tự tải lại. Cổng quyền đọc theo danh sách của tab
 * đang mở; thao tác của mọi tab dùng chung cách xử lý lỗi. Mỗi thao tác đặt xử lý kết quả trên `useMutation` để
 * `Providers` gửi lại được sau khi qua lớp hai.
 */
export function ClosedBetaReview() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<AdminTab>(ClosedBetaStatus.PENDING);
  const [revoking, setRevoking] = useState<ClosedBetaOrganization | null>(null);
  const [resuming, setResuming] = useState<SuspendedPaymentServiceOrganization | null>(null);

  const closedBetaTab = tab === PAYMENT_SERVICE_TAB ? null : tab;
  const queue = useQuery({
    queryKey: closedBetaQueueQueryKey(closedBetaTab ?? ClosedBetaStatus.PENDING),
    queryFn: ({ signal }) => fetchClosedBetaQueue(closedBetaTab ?? ClosedBetaStatus.PENDING, signal),
    enabled: closedBetaTab !== null,
  });
  const suspended = useQuery({
    queryKey: SUSPENDED_PAYMENT_SERVICES_QUERY_KEY,
    queryFn: ({ signal }) => fetchSuspendedPaymentServices(signal),
    enabled: tab === PAYMENT_SERVICE_TAB,
  });
  /** Danh sách của tab đang mở: quyết định cổng quyền (không quyền, chưa bật 2FA, hết phiên). */
  const active = tab === PAYMENT_SERVICE_TAB ? suspended : queue;

  const unauthenticated = hasErrorCode(active.error, ErrorCode.UNAUTHENTICATED);
  useEffect(() => {
    if (!unauthenticated) return;
    // Bỏ cache để quay lại sau đăng nhập thì tải mới, không giữ lỗi 401 cũ.
    queryClient.removeQueries({ queryKey: ADMIN_QUERY_KEY });
    router.replace(withReturnTo(LOGIN_PATH, ADMIN_PATH));
  }, [unauthenticated, queryClient, router]);

  /** Tải lại danh sách của tab đang mở (các tab khác đọc lại khi được mở). */
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEY });

  /** Lỗi chung của một thao tác; trả `true` nếu đã xử lý (không cần hiện lỗi tại chỗ). */
  const handleActionError = (error: unknown): boolean => {
    if (isTotpRequired(error) || hasErrorCode(error, ErrorCode.CONSENT_REQUIRED)) return true;
    if (isGateError(error)) {
      // Tải lại để trang chuyển sang đúng trạng thái (không quyền, chưa bật 2FA, hoặc sang đăng nhập).
      refresh();
      return true;
    }
    if (isStale(error)) {
      toast.info(
        hasErrorCode(error, ErrorCode.NOT_FOUND)
          ? 'BTC này không còn tồn tại. Đã tải lại danh sách.'
          : 'Trạng thái của BTC đã đổi. Đã tải lại danh sách.',
      );
      refresh();
      return true;
    }
    return false;
  };

  const approve = useMutation({
    mutationFn: (organization: ClosedBetaOrganization) => changeClosedBeta(organization.id, ClosedBetaAction.APPROVE),
    onSuccess: (_data, organization) => {
      toast.success(`Đã duyệt ${organization.name} vào Closed Beta.`);
      refresh();
    },
    onError: (error) => {
      if (!handleActionError(error)) toast.error(messageOf(error));
    },
  });

  const revoke = useMutation({
    mutationFn: (organization: ClosedBetaOrganization) => changeClosedBeta(organization.id, ClosedBetaAction.REVOKE),
    onSuccess: (_data, organization) => {
      setRevoking(null);
      toast.success(`Đã thu hồi Closed Beta của ${organization.name}.`);
      refresh();
    },
    onError: (error) => {
      if (handleActionError(error) && !isTotpRequired(error)) setRevoking(null);
    },
  });
  const revokeFailure =
    revoke.error && !isTotpRequired(revoke.error) && !isGateError(revoke.error) && !isStale(revoke.error)
      ? revoke.error
      : null;

  const resume = useMutation({
    mutationFn: (organization: SuspendedPaymentServiceOrganization) => resumePaymentService(organization.id),
    onSuccess: (_data, organization) => {
      setResuming(null);
      toast.success(`Đã mở lại dịch vụ thanh toán cho ${organization.name}.`);
      refresh();
    },
    onError: (error) => {
      if (handleActionError(error) && !isTotpRequired(error)) setResuming(null);
    },
  });
  const resumeFailure =
    resume.error && !isTotpRequired(resume.error) && !isGateError(resume.error) && !isStale(resume.error)
      ? resume.error
      : null;

  if (hasErrorCode(active.error, ErrorCode.FORBIDDEN_ROLE)) {
    return (
      <EmptyState
        icon={ShieldX}
        title="Bạn không có quyền vào trang này."
        description="Trang này chỉ dành cho Quản trị Tingee."
      />
    );
  }
  if (hasErrorCode(active.error, ErrorCode.TWO_FACTOR_NOT_ENABLED)) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Bật xác thực hai lớp để vào trang quản trị."
        description="Quản trị Tingee bắt buộc bật xác thực hai lớp. Bật xong bạn sẽ quay lại đây."
        action={
          <Button asChild>
            <Link href={withReturnTo(TOTP_ENROLL_PATH, ADMIN_PATH)}>Bật xác thực hai lớp</Link>
          </Button>
        }
      />
    );
  }
  // 401 chuyển sang đăng nhập ở effect trên; CONSENT_REQUIRED do `Providers` chuyển sang màn đồng ý.
  if (unauthenticated || hasErrorCode(active.error, ErrorCode.CONSENT_REQUIRED)) return <Loading />;

  let body;
  if (tab === PAYMENT_SERVICE_TAB) {
    if (suspended.data) {
      body =
        suspended.data.length === 0 ? (
          <EmptyState
            icon={CircleCheck}
            title={SUSPENDED_EMPTY}
            description={SUSPENDED_EMPTY_DESCRIPTION}
            className="rounded-lg bg-card px-card-padding shadow-card"
          />
        ) : (
          <SuspendedTable
            organizations={suspended.data}
            onResume={(organization) => {
              resume.reset();
              setResuming(organization);
            }}
          />
        );
    } else if (suspended.isError) {
      body = (
        <StatusBanner
          tone="danger"
          title="Chưa tải được danh sách BTC"
          description={messageOf(suspended.error)}
          action={
            <Button type="button" variant="link" size="sm" onClick={() => void suspended.refetch()}>
              Thử lại
            </Button>
          }
        />
      );
    } else {
      body = <Loading />;
    }
  } else if (queue.data) {
    const current = TABS.find((t) => t.status === tab)!;
    body =
      queue.data.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={current.empty}
          description={current.emptyDescription}
          className="rounded-lg bg-card px-card-padding shadow-card"
        />
      ) : (
        <QueueTable
          organizations={queue.data}
          approvingId={approve.isPending ? (approve.variables?.id ?? null) : null}
          onApprove={(organization) => !approve.isPending && approve.mutate(organization)}
          onRevoke={(organization) => {
            revoke.reset();
            setRevoking(organization);
          }}
        />
      );
  } else if (queue.isError) {
    body = (
      <StatusBanner
        tone="danger"
        title="Chưa tải được danh sách BTC"
        description={messageOf(queue.error)}
        action={
          <Button type="button" variant="link" size="sm" onClick={() => void queue.refetch()}>
            Thử lại
          </Button>
        }
      />
    );
  } else {
    body = <Loading />;
  }

  return (
    <div className="flex flex-col gap-section pt-2">
      <PageHeading eyebrow="Quản trị Tingee" title="Duyệt Closed Beta" />
      <Tabs value={tab} onValueChange={(value) => isAdminTab(value) && setTab(value)}>
        <TabsList aria-label="Danh sách BTC">
          {TABS.map((t) => (
            <TabsTrigger key={t.status} value={t.status}>
              {t.label}
            </TabsTrigger>
          ))}
          <TabsTrigger value={PAYMENT_SERVICE_TAB}>Tạm ngừng bán</TabsTrigger>
        </TabsList>
        {TABS.map((t) => (
          <TabsContent key={t.status} value={t.status}>
            {t.status === tab ? body : null}
          </TabsContent>
        ))}
        <TabsContent value={PAYMENT_SERVICE_TAB}>{tab === PAYMENT_SERVICE_TAB ? body : null}</TabsContent>
      </Tabs>
      <RevokeDialog
        organization={revoking}
        pending={revoke.isPending}
        failure={revokeFailure}
        onConfirm={(organization) => !revoke.isPending && revoke.mutate(organization)}
        onClose={() => {
          revoke.reset();
          setRevoking(null);
        }}
      />
      <ResumeDialog
        organization={resuming}
        pending={resume.isPending}
        failure={resumeFailure}
        onConfirm={(organization) => !resume.isPending && resume.mutate(organization)}
        onClose={() => {
          resume.reset();
          setResuming(null);
        }}
      />
    </div>
  );
}
