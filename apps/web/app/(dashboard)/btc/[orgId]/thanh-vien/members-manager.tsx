'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ErrorCode,
  InviteAdminRequest,
  ORGANIZATION_INVITATION_DAILY_LIMIT,
  ORGANIZATION_INVITATION_TTL_DAYS,
  Role,
  type OrganizationInvitation,
  type OrganizationMember,
} from '@tickee/contracts';
import { OctagonAlert } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { useCurrentOrganization } from '@/components/tickee/current-organization';
import { PageHeading } from '@/components/tickee/page-heading';
import { StatusBadge } from '@/components/tickee/status-badge';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api/errors';
import { hasErrorCode } from '@/lib/auth/api';
import { LOGIN_PATH, withReturnTo } from '@/lib/auth/return-to';
import { isTotpRequired } from '@/lib/auth/totp';
import { fetchMembers, inviteAdmin, membersQueryKey, removeMember, revokeInvitation } from '@/lib/organizer/api';
import { roleLabel } from '@/lib/organizer/nav';

const EXPIRES_FORMAT = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/**
 * Lỗi do nơi khác xử lý: 2FA (`Providers` mở dialog rồi gửi lại), đồng ý NĐ 13 (`Providers` chuyển trang), 401 (sang
 * đăng nhập), `NOT_A_MEMBER` (`DashboardShell` mở `Dialog` bị xóa khỏi BTC giữa phiên).
 */
const handledElsewhere = (error: unknown) =>
  isTotpRequired(error) ||
  hasErrorCode(error, ErrorCode.CONSENT_REQUIRED) ||
  hasErrorCode(error, ErrorCode.UNAUTHENTICATED) ||
  hasErrorCode(error, ErrorCode.NOT_A_MEMBER);

const messageOf = (error: unknown) => (error instanceof ApiError ? error.message : 'Đã có lỗi xảy ra. Vui lòng thử lại.');

function FieldError({ id, message }: { id: string; message: string | null }) {
  return (
    <p id={id} role="alert" className="flex min-h-0 items-start gap-1.5 text-meta text-danger-text empty:hidden">
      {message ? (
        <>
          <OctagonAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{message}</span>
        </>
      ) : null}
    </p>
  );
}

/** 401 khi đang thao tác: sang đăng nhập rồi quay lại đúng trang này. */
function useGoToLogin() {
  const router = useRouter();
  const pathname = usePathname();
  return () => router.replace(withReturnTo(LOGIN_PATH, pathname));
}

/**
 * Form mời Admin bằng email. Xử lý kết quả đặt trên `useMutation` (không `mutateAsync`): session chưa qua lớp hai thì
 * api trả `TOTP_REQUIRED`, `Providers` mở dialog rồi gửi lại đúng mutation này, ô email vẫn giữ nguyên.
 */
function InviteForm({ orgId }: { orgId: string }) {
  const ids = useId();
  const inputId = `${ids}-email`;
  const errorId = `${ids}-email-error`;
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: (body: { email: string }) => inviteAdmin(orgId, body),
    onSuccess: (invitation) => {
      toast.success(`Đã gửi lời mời tới ${invitation.email}.`);
      setEmail('');
      void queryClient.invalidateQueries({ queryKey: membersQueryKey(orgId) });
    },
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
      else if (hasErrorCode(error, ErrorCode.ALREADY_A_MEMBER)) setFieldError('Email này đã là thành viên của BTC.');
      else if (hasErrorCode(error, ErrorCode.VALIDATION_FAILED)) setFieldError('Email chưa đúng định dạng.');
    },
  });

  const submit = () => {
    if (invite.isPending) return;
    const parsed = InviteAdminRequest.safeParse({ email });
    if (!parsed.success) {
      setFieldError(email.trim() === '' ? 'Nhập email người bạn muốn mời.' : 'Email chưa đúng định dạng.');
      invite.reset();
      return;
    }
    setFieldError(null);
    invite.mutate({ email: parsed.data.email });
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  const error = invite.error;
  const limited = hasErrorCode(error, ErrorCode.INVITATION_LIMIT_REACHED);
  const failure =
    error &&
    !limited &&
    !handledElsewhere(error) &&
    !hasErrorCode(error, ErrorCode.ALREADY_A_MEMBER) &&
    !hasErrorCode(error, ErrorCode.VALIDATION_FAILED)
      ? error
      : null;

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-stack">
      <div className="flex flex-col gap-2">
        <Label htmlFor={inputId}>Email</Label>
        <Input
          id={inputId}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="admin@vidu.vn"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (fieldError) setFieldError(null);
          }}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={errorId}
        />
        <FieldError id={errorId} message={fieldError} />
      </div>
      {limited ? (
        <StatusBanner
          tone="warning"
          title="Đã đạt giới hạn lời mời"
          description={`Mỗi BTC gửi tối đa ${ORGANIZATION_INVITATION_DAILY_LIMIT} lời mời trong 24 giờ. Vui lòng thử lại sau.`}
        />
      ) : null}
      {failure ? (
        <StatusBanner
          tone="danger"
          title="Chưa gửi được lời mời"
          description={messageOf(failure)}
          action={
            <Button type="button" variant="link" size="sm" onClick={submit}>
              Thử lại
            </Button>
          }
        />
      ) : null}
      <Button type="submit" className="self-start" loading={invite.isPending}>
        Mời
      </Button>
    </form>
  );
}

function RemoveDialog({
  orgId,
  member,
  organizationName,
  onClose,
}: {
  orgId: string;
  member: OrganizationMember | null;
  organizationName: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  const remove = useMutation({
    mutationFn: (target: OrganizationMember) => removeMember(orgId, target.id),
    onSuccess: (_data, target) => {
      onClose();
      toast.success(`Đã xóa ${target.email} khỏi BTC.`);
      void queryClient.invalidateQueries({ queryKey: membersQueryKey(orgId) });
    },
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
      else if (hasErrorCode(error, ErrorCode.NOT_FOUND)) {
        onClose();
        toast.info('Thành viên này không còn trong BTC.');
        void queryClient.invalidateQueries({ queryKey: membersQueryKey(orgId) });
      }
    },
  });
  const failure =
    remove.error && !handledElsewhere(remove.error) && !hasErrorCode(remove.error, ErrorCode.NOT_FOUND)
      ? remove.error
      : null;

  return (
    <Dialog
      open={member !== null}
      onOpenChange={(open) => {
        if (!open && !remove.isPending) {
          remove.reset();
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Xóa Admin khỏi BTC?</DialogTitle>
          <DialogDescription className="break-words">
            {member
              ? `${member.email} sẽ không còn quản lý Sự kiện, Đơn và các mục khác của ${organizationName}. Muốn họ quay lại thì mời lại.`
              : null}
          </DialogDescription>
        </DialogHeader>
        {failure ? <StatusBanner tone="danger" title="Chưa xóa được" description={messageOf(failure)} /> : null}
        <DialogFooter>
          <Button
            type="button"
            variant="destructive"
            className="w-full"
            loading={remove.isPending}
            onClick={() => member && remove.mutate(member)}
          >
            Xóa
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() => {
              if (remove.isPending) return;
              remove.reset();
              onClose();
            }}
          >
            Hủy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MemberRow({ member, onRemove }: { member: OrganizationMember; onRemove: (member: OrganizationMember) => void }) {
  return (
    <li className="flex items-center gap-3 py-3" data-slot="member-row">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-body break-all">{member.email}</span>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusBadge tone={member.role === Role.OWNER ? 'success' : 'neutral'}>{roleLabel(member.role)}</StatusBadge>
          {member.name ? <span className="text-meta text-muted-foreground">{member.name}</span> : null}
        </div>
      </div>
      {member.role === Role.ADMIN ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label={`Xóa ${member.email}`}
          onClick={() => onRemove(member)}
        >
          Xóa
        </Button>
      ) : null}
    </li>
  );
}

function InvitationRow({
  invitation,
  revoking,
  onRevoke,
}: {
  invitation: OrganizationInvitation;
  revoking: boolean;
  onRevoke: (invitation: OrganizationInvitation) => void;
}) {
  return (
    <li className="flex items-center gap-3 py-3" data-slot="invitation-row">
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <span className="text-body break-all">{invitation.email}</span>
        {invitation.expired ? (
          <StatusBadge tone="warning">Đã hết hạn</StatusBadge>
        ) : (
          <span className="text-meta text-muted-foreground">
            Hết hạn {EXPIRES_FORMAT.format(new Date(invitation.expiresAt))}
          </span>
        )}
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-label={`Thu hồi lời mời tới ${invitation.email}`}
        loading={revoking}
        onClick={() => onRevoke(invitation)}
      >
        Thu hồi
      </Button>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-stack">
      <span className="sr-only">Đang tải</span>
      <div aria-hidden="true" className="h-24 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

/**
 * Trang Thành viên (chỉ Owner, FR-2/FR-4): mời Admin bằng email, danh sách thành viên (xóa Admin qua `Dialog`) và lời
 * mời đang chờ (hạn hoặc "Đã hết hạn", "Thu hồi").
 */
export function MembersManager() {
  const organization = useCurrentOrganization();
  const orgId = organization.id;
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  const titleIds = useId();
  const [removing, setRemoving] = useState<OrganizationMember | null>(null);

  const list = useQuery({ queryKey: membersQueryKey(orgId), queryFn: ({ signal }) => fetchMembers(orgId, signal) });

  const revoke = useMutation({
    mutationFn: (invitation: OrganizationInvitation) => revokeInvitation(orgId, invitation.id),
    onSuccess: (_data, invitation) => {
      toast.success(`Đã thu hồi lời mời tới ${invitation.email}.`);
      void queryClient.invalidateQueries({ queryKey: membersQueryKey(orgId) });
    },
    onError: (error) => {
      if (handledElsewhere(error)) {
        if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
        return;
      }
      if (hasErrorCode(error, ErrorCode.NOT_FOUND)) toast.info('Lời mời này không còn chờ.');
      else toast.error(messageOf(error));
      void queryClient.invalidateQueries({ queryKey: membersQueryKey(orgId) });
    },
  });

  let lists;
  if (list.data) {
    const { members, invitations } = list.data;
    lists = (
      <>
        <section aria-labelledby={`${titleIds}-members`} className="flex flex-col gap-2">
          <h2 id={`${titleIds}-members`} className="text-title">
            Thành viên
          </h2>
          <ul className="flex flex-col divide-y divide-border rounded-lg bg-card px-card-padding shadow-card">
            {members.map((member) => (
              <MemberRow key={member.id} member={member} onRemove={setRemoving} />
            ))}
          </ul>
        </section>
        <section aria-labelledby={`${titleIds}-pending`} className="flex flex-col gap-2">
          <h2 id={`${titleIds}-pending`} className="text-title">
            Lời mời đang chờ
          </h2>
          {invitations.length === 0 ? (
            <p className="text-body text-muted-foreground">Không có lời mời nào đang chờ.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-lg bg-card px-card-padding shadow-card">
              {invitations.map((invitation) => (
                <InvitationRow
                  key={invitation.id}
                  invitation={invitation}
                  revoking={revoke.isPending && revoke.variables?.id === invitation.id}
                  onRevoke={(target) => !revoke.isPending && revoke.mutate(target)}
                />
              ))}
            </ul>
          )}
        </section>
      </>
    );
  } else if (list.isError && !handledElsewhere(list.error)) {
    lists = (
      <StatusBanner
        tone="danger"
        title="Chưa tải được danh sách thành viên"
        description={messageOf(list.error)}
        action={
          <Button type="button" variant="link" size="sm" onClick={() => void list.refetch()}>
            Thử lại
          </Button>
        }
      />
    );
  } else {
    lists = <ListSkeleton />;
  }

  return (
    <div className="flex flex-col gap-section pt-2">
      <div className="flex flex-col gap-2">
        <PageHeading eyebrow={organization.name} title="Thành viên" />
        <p className="text-body text-muted-foreground">
          Admin cùng bạn tạo và quản lý Sự kiện, xem Đơn và doanh thu. Chỉ Owner liên kết tài khoản nhận tiền và quản lý
          thành viên.
        </p>
      </div>
      <section
        aria-labelledby={`${titleIds}-invite`}
        className="flex flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card"
      >
        <h2 id={`${titleIds}-invite`} className="text-title">
          Mời Admin
        </h2>
        <p className="text-meta text-muted-foreground">
          Người được mời nhận email kèm link (hiệu lực {ORGANIZATION_INVITATION_TTL_DAYS} ngày) và phải đăng nhập bằng
          đúng email này để nhận.
        </p>
        <InviteForm orgId={orgId} />
      </section>
      {lists}
      <RemoveDialog
        orgId={orgId}
        member={removing}
        organizationName={organization.name}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}
