'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ErrorCode,
  InviteAdminRequest,
  ORGANIZATION_INVITATION_DAILY_LIMIT,
  ORGANIZATION_INVITATION_TTL_DAYS,
  organizationDashboardPath,
  Role,
  type OrganizationInvitation,
  type OrganizationMember,
} from '@tickee/contracts';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/tickee/confirm-dialog';
import { useCurrentOrganization } from '@/components/tickee/current-organization';
import { FieldError } from '@/components/tickee/field-error';
import { PageHeading } from '@/components/tickee/page-heading';
import { StatusBadge } from '@/components/tickee/status-badge';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { handledElsewhere } from '@/lib/api/handled-elsewhere';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import { isReauthRequired, withReauth } from '@/lib/auth/reauth';
import { useGoToLogin } from '@/lib/auth/use-go-to-login';
import {
  fetchMembers,
  inviteAdmin,
  MEMBERSHIPS_QUERY_KEY,
  membersQueryKey,
  organizationQueryKey,
  removeMember,
  revokeInvitation,
  transferOwnership,
} from '@/lib/organizer/api';
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
    <ConfirmDialog
      open={member !== null}
      onOpenChange={(open) => {
        if (open) return;
        remove.reset();
        onClose();
      }}
      title="Xóa Admin khỏi BTC?"
      descriptionClassName="break-words"
      description={
        member
          ? `${member.email} sẽ không còn quản lý Sự kiện, Đơn và các mục khác của ${organizationName}. Muốn họ quay lại thì mời lại.`
          : null
      }
      confirmLabel="Xóa"
      onConfirm={() => member && remove.mutate(member)}
      pending={remove.isPending}
      failureTitle="Chưa xóa được"
      failure={failure && messageOf(failure)}
    />
  );
}

/** Tên hiển thị của thành viên: tên, chưa có thì email. */
const memberLabel = (member: OrganizationMember) => member.name.trim() || member.email;

/**
 * `Dialog` chuyển quyền Owner (Story 2.14): nêu hậu quả, Owner gõ đúng tên BTC (so khớp chính xác sau trim, chỉ kiểm ở
 * web) mới bật nút. Gửi qua `withReauth`: api trả `REAUTH_REQUIRED` thì `Dialog` này đóng, dialog "Xác nhận để tiếp tục"
 * mở và thao tác tự gửi lại sau khi xác nhận. Xong → toast, làm mới cache vai trò và về trang tổng quan BTC.
 */
function TransferOwnershipDialog({
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
  const ids = useId();
  const inputId = `${ids}-org-name`;
  const hintId = `${ids}-org-name-hint`;
  const queryClient = useQueryClient();
  const router = useRouter();
  const goToLogin = useGoToLogin();
  const [typed, setTyped] = useState('');
  /** Lần bấm hiện tại đã qua dialog xác nhận lại (`Dialog` này đã đóng): lỗi báo bằng toast thay vì banner. */
  const prompted = useRef(false);

  const refreshRoles = () => {
    void queryClient.invalidateQueries({ queryKey: organizationQueryKey(orgId) });
    void queryClient.invalidateQueries({ queryKey: MEMBERSHIPS_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: membersQueryKey(orgId) });
  };

  const transfer = useMutation({
    mutationFn: (target: OrganizationMember) => {
      prompted.current = false;
      return withReauth((reauthToken) => transferOwnership(orgId, target.id, reauthToken), {
        onPrompt: () => {
          prompted.current = true;
          setTyped('');
          onClose();
        },
      });
    },
    onSuccess: (_data, target) => {
      onClose();
      setTyped('');
      toast.success(`Đã chuyển quyền Owner cho ${memberLabel(target)}.`);
      refreshRoles();
      router.push(organizationDashboardPath(orgId));
    },
    onError: (error) => {
      // Đóng dialog xác nhận lại: không chuyển gì, không báo lỗi.
      if (isReauthRequired(error)) return;
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
      else if (hasErrorCode(error, ErrorCode.NOT_FOUND)) {
        onClose();
        toast.info('Thành viên này không còn là Admin của BTC.');
        void queryClient.invalidateQueries({ queryKey: membersQueryKey(orgId) });
      } else if (hasErrorCode(error, ErrorCode.FORBIDDEN_ROLE)) {
        // Bạn không còn là Owner (vd. đã chuyển ở tab khác): làm mới vai, `OwnerOnly` hiện empty-state.
        onClose();
        toast.info('Bạn không còn là Owner của BTC này.');
        refreshRoles();
      } else if (prompted.current && !handledElsewhere(error)) {
        toast.error(`Chưa chuyển quyền được. ${messageOf(error)}`);
      }
    },
  });
  const failure =
    transfer.error &&
    !prompted.current &&
    !handledElsewhere(transfer.error) &&
    !isReauthRequired(transfer.error) &&
    !hasErrorCode(transfer.error, ErrorCode.NOT_FOUND) &&
    !hasErrorCode(transfer.error, ErrorCode.FORBIDDEN_ROLE)
      ? transfer.error
      : null;

  const matches = typed.trim().normalize('NFC') === organizationName.trim().normalize('NFC');

  const close = () => {
    if (transfer.isPending) return;
    transfer.reset();
    setTyped('');
    onClose();
  };

  return (
    <ConfirmDialog
      open={member !== null}
      onOpenChange={(open) => !open && close()}
      title="Chuyển quyền Owner?"
      descriptionClassName="break-words"
      description={
        member ? `${memberLabel(member)} sẽ là Owner, quản lý tài khoản nhận tiền và Token. Bạn sẽ thành Admin.` : null
      }
      asForm
      confirmLabel="Chuyển quyền"
      confirmDisabled={!matches}
      onConfirm={() => member && transfer.mutate(member)}
      pending={transfer.isPending}
      failureTitle="Chưa chuyển quyền được"
      failure={failure && messageOf(failure)}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={inputId}>Gõ tên BTC để xác nhận</Label>
        <Input
          id={inputId}
          name="organizationName"
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          aria-describedby={hintId}
        />
        <p id={hintId} className="text-meta text-muted-foreground break-words">
          {matches ? 'Tên BTC đã khớp.' : `Gõ đúng "${organizationName}" để bật nút Chuyển quyền.`}
        </p>
      </div>
    </ConfirmDialog>
  );
}

/**
 * Mục "Chuyển quyền Owner" (chỉ Owner thấy trang này): chọn một Admin rồi bấm nút mở `Dialog` xác nhận. Chưa có Admin
 * thì nút tắt kèm hướng dẫn.
 */
function TransferOwnershipSection({
  orgId,
  organizationName,
  members,
}: {
  orgId: string;
  organizationName: string;
  members: OrganizationMember[];
}) {
  const ids = useId();
  const titleId = `${ids}-title`;
  const selectId = `${ids}-admin`;
  const hintId = `${ids}-hint`;
  const admins = members.filter((m) => m.role === Role.ADMIN);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [target, setTarget] = useState<OrganizationMember | null>(null);
  // Mặc định Admin đầu tiên; Admin đã chọn rời BTC thì quay về Admin đầu tiên.
  const selected = admins.find((m) => m.id === selectedId) ?? admins[0] ?? null;

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card">
      <h2 id={titleId} className="text-title">
        Chuyển quyền Owner
      </h2>
      <p className="text-meta text-muted-foreground">
        Owner mới quản lý tài khoản nhận tiền, Token và thành viên. Sự kiện, Đơn và tài khoản nhận tiền vẫn thuộc BTC. Bạn
        sẽ thành Admin.
      </p>
      {admins.length > 0 ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={selectId}>Admin nhận quyền</Label>
          <select
            id={selectId}
            name="admin"
            value={selected?.id ?? ''}
            onChange={(event) => setSelectedId(event.target.value)}
            className="h-control-height w-full min-w-0 rounded-md border border-transparent bg-muted px-3 text-foreground focus:border-ring"
          >
            {admins.map((admin) => (
              <option key={admin.id} value={admin.id}>
                {admin.name.trim() ? `${admin.name.trim()} (${admin.email})` : admin.email}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          disabled={!selected}
          aria-describedby={selected ? undefined : hintId}
          onClick={() => selected && setTarget(selected)}
        >
          Chuyển quyền Owner
        </Button>
        {selected ? null : (
          <p id={hintId} className="text-meta text-muted-foreground">
            Mời một Admin trước rồi chuyển quyền.
          </p>
        )}
      </div>
      <TransferOwnershipDialog
        orgId={orgId}
        member={target}
        organizationName={organizationName}
        onClose={() => setTarget(null)}
      />
    </section>
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
 * Trang Thành viên (chỉ Owner, FR-2/FR-4): mời Admin bằng email, danh sách thành viên (xóa Admin qua `Dialog`), lời
 * mời đang chờ (hạn hoặc "Đã hết hạn", "Thu hồi") và chuyển quyền Owner cho một Admin (Story 2.14).
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
        <TransferOwnershipSection orgId={orgId} organizationName={organization.name} members={members} />
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
