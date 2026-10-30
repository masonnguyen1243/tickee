import {
  CreatedOrganization,
  MembershipList,
  Organization,
  type CreateOrganizationRequest,
} from '@tickee/contracts';

import { apiRequest } from '@/lib/api/client';

/** Khóa TanStack Query: BTC mà tài khoản đang đăng nhập là thành viên. */
export const MEMBERSHIPS_QUERY_KEY = ['organizer', 'memberships'] as const;
export const organizationQueryKey = (orgId: string) => ['organizer', 'organization', orgId] as const;

export const createOrganization = (body: CreateOrganizationRequest) =>
  apiRequest('/orgs', { schema: CreatedOrganization, init: { method: 'POST', body: JSON.stringify(body) } });

export const fetchMemberships = (signal?: AbortSignal) =>
  apiRequest('/me/memberships', { schema: MembershipList, init: { signal } });

export const fetchOrganization = (orgId: string, signal?: AbortSignal) =>
  apiRequest(`/orgs/${encodeURIComponent(orgId)}`, { schema: Organization, init: { signal } });
