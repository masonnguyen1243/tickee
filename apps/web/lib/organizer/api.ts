import {
  AcceptedInvitation,
  CreatedOrganization,
  InvitationPreview,
  MemberList,
  MembershipList,
  Organization,
  OrganizationInvitation,
  PayoutAccount,
  PayoutAccountOptions,
  PayoutAccountOverview,
  TingeeKeyPreview,
  type ConnectTingeeRequest,
  type CreateOrganizationRequest,
  type InviteAdminRequest,
  type ReplaceTingeeKeyRequest,
  type SelectPayoutAccountRequest,
} from '@tickee/contracts';
import { z } from 'zod';

import { apiRequest } from '@/lib/api/client';
import { withReauthHeader } from '@/lib/auth/reauth';

/** Khóa TanStack Query: BTC mà tài khoản đang đăng nhập là thành viên. */
export const MEMBERSHIPS_QUERY_KEY = ['organizer', 'memberships'] as const;
export const organizationQueryKey = (orgId: string) => ['organizer', 'organization', orgId] as const;
/** Thành viên + lời mời đang chờ của một BTC (chỉ Owner). */
export const membersQueryKey = (orgId: string) => ['organizer', 'members', orgId] as const;
/** Credential Tingee, các tài khoản nhận tiền hiện hành và URL IPN của một BTC (chỉ Owner; không gọi Tingee). */
export const payoutAccountQueryKey = (orgId: string) => ['organizer', 'payout-account', orgId] as const;
/**
 * Danh sách tài khoản đọc từ Tingee bằng credential `credentialId` (mỗi lần tải là một lời gọi Tingee). Nằm dưới
 * `payoutAccountQueryKey`: invalidate không `exact` ở khóa đó cũng làm mới danh sách.
 */
export const payoutAccountOptionsQueryKey = (orgId: string, credentialId: string) =>
  ['organizer', 'payout-account', orgId, 'options', credentialId] as const;

const json = (method: 'POST', body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
const orgPath = (orgId: string) => `/orgs/${encodeURIComponent(orgId)}`;

export const createOrganization = (body: CreateOrganizationRequest) =>
  apiRequest('/orgs', { schema: CreatedOrganization, init: json('POST', body) });

export const fetchMemberships = (signal?: AbortSignal) =>
  apiRequest('/me/memberships', { schema: MembershipList, init: { signal } });

export const fetchOrganization = (orgId: string, signal?: AbortSignal) =>
  apiRequest(orgPath(orgId), { schema: Organization, init: { signal } });

export const fetchMembers = (orgId: string, signal?: AbortSignal) =>
  apiRequest(`${orgPath(orgId)}/members`, { schema: MemberList, init: { signal } });

export const inviteAdmin = (orgId: string, body: InviteAdminRequest) =>
  apiRequest(`${orgPath(orgId)}/invitations`, { schema: OrganizationInvitation, init: json('POST', body) });

/** 204 No Content. */
export const revokeInvitation = (orgId: string, invitationId: string) =>
  apiRequest(`${orgPath(orgId)}/invitations/${encodeURIComponent(invitationId)}`, {
    schema: z.undefined(),
    init: { method: 'DELETE' },
  });

/** 204 No Content. `memberId` là id dòng thành viên (không phải id tài khoản). */
export const removeMember = (orgId: string, memberId: string) =>
  apiRequest(`${orgPath(orgId)}/members/${encodeURIComponent(memberId)}`, {
    schema: z.undefined(),
    init: { method: 'DELETE' },
  });

/**
 * Chuyển quyền Owner cho Admin `memberId` (id dòng thành viên; Story 2.14); 204 No Content. Cần lần xác nhận lại
 * (`reauthToken`): gọi qua `withReauth`.
 */
export const transferOwnership = (orgId: string, memberId: string, reauthToken?: string) =>
  apiRequest(`${orgPath(orgId)}/members/${encodeURIComponent(memberId)}/ownership-transfer`, {
    schema: z.undefined(),
    init: withReauthHeader({ method: 'POST' }, reauthToken),
  });

/** Lời mời Admin: token luôn đi trong body (không bao giờ trong URL của request). */
export const previewInvitation = (token: string) =>
  apiRequest('/org-invitations/preview', { schema: InvitationPreview, init: json('POST', { token }) });

export const acceptInvitation = (token: string) =>
  apiRequest('/org-invitations/accept', { schema: AcceptedInvitation, init: json('POST', { token }) });

export const fetchPayoutAccount = (orgId: string, signal?: AbortSignal) =>
  apiRequest(`${orgPath(orgId)}/payout-account`, { schema: PayoutAccountOverview, init: { signal } });

/** Kết nối API key Tingee của BTC: key đúng thì api lưu credential và trả danh sách tài khoản. */
export const connectTingee = (orgId: string, body: ConnectTingeeRequest) =>
  apiRequest(`${orgPath(orgId)}/payout-account/credential`, { schema: PayoutAccountOptions, init: json('POST', body) });

export const fetchPayoutAccountOptions = (orgId: string, signal?: AbortSignal) =>
  apiRequest(`${orgPath(orgId)}/payout-account/options`, { schema: PayoutAccountOptions, init: { signal } });

/** Thêm một tài khoản trong danh sách làm tài khoản nhận tiền (tài khoản đầu tiên tự thành mặc định). */
export const selectPayoutAccount = (orgId: string, body: SelectPayoutAccountRequest) =>
  apiRequest(`${orgPath(orgId)}/payout-account`, { schema: PayoutAccount, init: json('POST', body) });

/**
 * Hủy liên kết một tài khoản nhận tiền (Tickee ngừng dùng, không gọi Tingee); trả tổng quan mới. Cần lần xác nhận lại
 * (`reauthToken`, Story 2.13): gọi qua `withReauth`.
 */
export const unlinkPayoutAccount = (orgId: string, accountId: string, reauthToken?: string) =>
  apiRequest(`${orgPath(orgId)}/payout-account/${encodeURIComponent(accountId)}`, {
    schema: PayoutAccountOverview,
    init: withReauthHeader({ method: 'DELETE' }, reauthToken),
  });

/** Đặt một tài khoản nhận tiền làm mặc định; trả tổng quan mới. Cần lần xác nhận lại: gọi qua `withReauth`. */
export const setDefaultPayoutAccount = (orgId: string, accountId: string, reauthToken?: string) =>
  apiRequest(`${orgPath(orgId)}/payout-account/${encodeURIComponent(accountId)}/default`, {
    schema: PayoutAccountOverview,
    init: withReauthHeader({ method: 'POST' }, reauthToken),
  });

/**
 * Đổi key Tingee (Story 2.13-b), mỗi bước cần lần xác nhận lại (`reauthToken`): gọi qua `withReauth`. Bước 1 kiểm lần
 * xác nhận còn hiệu lực (không tiêu; 204 No Content).
 */
export const beginTingeeKeyReplacement = (orgId: string, reauthToken?: string) =>
  apiRequest(`${orgPath(orgId)}/payout-account/credential/replacement/begin`, {
    schema: z.undefined(),
    init: withReauthHeader({ method: 'POST' }, reauthToken),
  });

/** Bước 2: danh sách tài khoản của key mới; api không lưu gì, không tiêu lần xác nhận. */
export const previewTingeeKeyReplacement = (orgId: string, body: ConnectTingeeRequest, reauthToken?: string) =>
  apiRequest(`${orgPath(orgId)}/payout-account/credential/replacement/preview`, {
    schema: TingeeKeyPreview,
    init: withReauthHeader(json('POST', body), reauthToken),
  });

/**
 * Bước 3: lưu key mới và tài khoản đã chọn làm mặc định (mọi tài khoản hiện hành bị hủy liên kết); tiêu lần xác nhận;
 * trả tổng quan mới.
 */
export const replaceTingeeKey = (orgId: string, body: ReplaceTingeeKeyRequest, reauthToken?: string) =>
  apiRequest(`${orgPath(orgId)}/payout-account/credential/replacement`, {
    schema: PayoutAccountOverview,
    init: withReauthHeader(json('POST', body), reauthToken),
  });
