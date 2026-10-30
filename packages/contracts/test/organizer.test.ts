import { describe, expect, it } from 'vitest';
import { PII_KEYS } from '../src/pii.js';
import {
  CreateOrganizationRequest,
  ORGANIZATION_SECTION_SEGMENTS,
  OrganizationSection,
  organizationSectionPath,
  Permission,
  ROLE_PERMISSIONS,
  roleHasPermission,
} from '../src/organizer.js';

describe('ma trận quyền FR-4', () => {
  it('Owner có mọi quyền', () => {
    expect([...ROLE_PERMISSIONS.owner].sort()).toEqual(Object.values(Permission).sort());
  });

  it('Admin thiếu đúng members.manage, payout_account.manage, token.purchase', () => {
    const missing = Object.values(Permission).filter((p) => !ROLE_PERMISSIONS.admin.includes(p));
    expect(missing.sort()).toEqual(['members.manage', 'payout_account.manage', 'token.purchase']);
    expect(roleHasPermission('admin', Permission.TOKEN_VIEW)).toBe(true);
    expect(roleHasPermission('admin', Permission.EVENTS_MANAGE)).toBe(true);
    expect(roleHasPermission('admin', Permission.MEMBERS_MANAGE)).toBe(false);
  });

  it('danh sách quyền đúng FR-4', () => {
    expect(Object.values(Permission).sort()).toEqual(
      [
        'org.read',
        'members.manage',
        'payout_account.manage',
        'token.view',
        'token.purchase',
        'events.manage',
        'orders.view',
        'review_queue.handle',
        'checkers.manage',
        'checkin.scan',
        'checkin.lookup',
      ].sort(),
    );
  });
});

describe('CreateOrganizationRequest', () => {
  it('tên được trim; bỏ trống cả hai ô liên hệ vẫn hợp lệ', () => {
    expect(CreateOrganizationRequest.parse({ name: '  CLB Cờ Vua  ' })).toEqual({
      name: 'CLB Cờ Vua',
      contactPhone: null,
      contactEmail: null,
    });
    expect(CreateOrganizationRequest.parse({ name: 'A', contactPhone: '', contactEmail: '   ' })).toMatchObject({
      contactPhone: null,
      contactEmail: null,
    });
    expect(CreateOrganizationRequest.parse({ name: 'A', contactPhone: null, contactEmail: null })).toMatchObject({
      contactPhone: null,
      contactEmail: null,
    });
  });

  it.each(['', '   ', 'a'.repeat(101)])('tên "%s" bị từ chối', (name) => {
    expect(CreateOrganizationRequest.safeParse({ name }).success).toBe(false);
  });

  it('tên 100 ký tự sau trim hợp lệ', () => {
    expect(CreateOrganizationRequest.safeParse({ name: ` ${'a'.repeat(100)} ` }).success).toBe(true);
  });

  it.each([
    ['0901 234 567', '0901234567'],
    ['+84 901234567', '0901234567'],
    ['+84901234567', '0901234567'],
    ['0901.234.567', '0901234567'],
    ['0901-234-567', '0901234567'],
    ['0901234567', '0901234567'],
  ])('SĐT "%s" → "%s"', (input, output) => {
    expect(CreateOrganizationRequest.parse({ name: 'A', contactPhone: input }).contactPhone).toBe(output);
  });

  it.each(['123', '090123456', '09012345678', '+8490123456', '84901234567', '+840901234567', 'abcdefghij'])(
    'SĐT "%s" bị từ chối',
    (contactPhone) => {
      const result = CreateOrganizationRequest.safeParse({ name: 'A', contactPhone });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['contactPhone']);
    },
  );

  it('email liên hệ chuẩn hóa; email hỏng bị từ chối tại đúng trường', () => {
    expect(CreateOrganizationRequest.parse({ name: 'A', contactEmail: ' LH@Vidu.VN ' }).contactEmail).toBe('lh@vidu.vn');
    const result = CreateOrganizationRequest.safeParse({ name: 'A', contactEmail: 'khong-phai-email' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['contactEmail']);
  });

  it('cột liên hệ BTC được che trong log', () => {
    for (const key of ['contact_phone', 'contactPhone', 'contact_email', 'contactEmail']) {
      expect(PII_KEYS).toContain(key);
    }
  });
});

describe('organizationSectionPath', () => {
  const id = '019a3b2c-5678-7abc-8def-0123456789ab';

  it('đường dẫn các mục cấp BTC đúng UX-DR34', () => {
    expect(organizationSectionPath(id, OrganizationSection.EVENTS)).toBe(`/btc/${id}`);
    expect(organizationSectionPath(id, OrganizationSection.CREATE_EVENT)).toBe(`/btc/${id}/su-kien/tao`);
    expect(organizationSectionPath(id, OrganizationSection.REVIEW_QUEUE)).toBe(`/btc/${id}/can-xu-ly`);
    expect(organizationSectionPath(id, OrganizationSection.TOKEN)).toBe(`/btc/${id}/token`);
    expect(organizationSectionPath(id, OrganizationSection.MEMBERS)).toBe(`/btc/${id}/thanh-vien`);
    expect(organizationSectionPath(id, OrganizationSection.PAYOUT_ACCOUNT)).toBe(`/btc/${id}/tai-khoan-nhan-tien`);
    expect(organizationSectionPath(id, OrganizationSection.SETTINGS)).toBe(`/btc/${id}/cai-dat`);
    expect(organizationSectionPath(id, OrganizationSection.SCAN)).toBe(`/btc/${id}/quet-ve`);
  });

  it('mỗi mục một đoạn đường dẫn riêng', () => {
    const segments = Object.values(ORGANIZATION_SECTION_SEGMENTS);
    expect(new Set(segments).size).toBe(segments.length);
    expect(Object.keys(ORGANIZATION_SECTION_SEGMENTS).sort()).toEqual(Object.values(OrganizationSection).sort());
  });
});
