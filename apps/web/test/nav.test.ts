import { Permission, roleHasPermission } from '@tickee/contracts';
import { describe, expect, it } from 'vitest';

import {
  activeSection,
  isOwnerOnly,
  NAV_SECTIONS,
  navAccessibleName,
  navBadgeLabel,
  navSection,
  organizationInitial,
  visibleSections,
} from '@/lib/organizer/nav';

const ORG = '019a3b2c-5678-7abc-8def-0123456789ab';
const labels = (role: 'owner' | 'admin', placement: 'sidebar' | 'tab' | 'sheet') =>
  visibleSections(role, placement).map((s) => s.label);

describe('điều hướng cấp BTC (UX-DR34)', () => {
  it('sidebar: Owner đủ 6 mục theo thứ tự UX', () => {
    expect(labels('owner', 'sidebar')).toEqual([
      'Sự kiện',
      'Cần xử lý',
      'Token',
      'Thành viên',
      'Tài khoản nhận tiền',
      'Cài đặt',
    ]);
  });

  it('Admin bị ẩn Thành viên và Tài khoản nhận tiền ở sidebar và Sheet', () => {
    expect(labels('admin', 'sidebar')).toEqual(['Sự kiện', 'Cần xử lý', 'Token', 'Cài đặt']);
    expect(labels('admin', 'sheet')).toEqual(['Token', 'Cài đặt']);
  });

  it('tab bar: Sự kiện · Cần xử lý · Quét vé; Sheet "Thêm": các mục còn lại', () => {
    expect(labels('owner', 'tab')).toEqual(['Sự kiện', 'Cần xử lý', 'Quét vé']);
    expect(labels('admin', 'tab')).toEqual(['Sự kiện', 'Cần xử lý', 'Quét vé']);
    expect(labels('owner', 'sheet')).toEqual(['Token', 'Thành viên', 'Tài khoản nhận tiền', 'Cài đặt']);
  });

  it('mục chỉ dành cho Owner suy ra từ ma trận quyền, không viết tay', () => {
    const ownerOnly = NAV_SECTIONS.filter(isOwnerOnly).map((s) => s.key);
    expect(ownerOnly).toEqual(['members', 'payout-account']);
    for (const section of NAV_SECTIONS) {
      expect(isOwnerOnly(section)).toBe(!roleHasPermission('admin', section.permission));
    }
    expect(navSection('members').permission).toBe(Permission.MEMBERS_MANAGE);
    expect(navSection('payout-account').permission).toBe(Permission.PAYOUT_ACCOUNT_MANAGE);
  });

  it.each([
    [`/btc/${ORG}`, 'events'],
    [`/btc/${ORG}/`, 'events'],
    [`/btc/${ORG}/su-kien/tao`, 'events'],
    [`/btc/${ORG}/can-xu-ly`, 'review-queue'],
    [`/btc/${ORG}/token`, 'token'],
    [`/btc/${ORG}/thanh-vien`, 'members'],
    [`/btc/${ORG}/tai-khoan-nhan-tien`, 'payout-account'],
    [`/btc/${ORG}/cai-dat`, 'settings'],
    [`/btc/${ORG}/quet-ve`, 'scan'],
    [`/btc/${ORG}/token/lich-su`, 'token'],
    [`/btc/${ORG}/khong-co`, null],
    [`/btc/${ORG}/tokens`, null],
    [`/btc/${ORG}x`, null],
    ['/tao-btc', null],
  ])('mục đang chọn của %s là %s', (pathname, expected) => {
    expect(activeSection(ORG, pathname)).toBe(expected);
  });

  it('badge "Cần xử lý" (Story 4.3): ẩn khi 0 hoặc chưa tải, số khi 1–99, "99+" khi trên 99', () => {
    expect(navBadgeLabel(undefined)).toBeNull();
    expect(navBadgeLabel(0)).toBeNull();
    expect(navBadgeLabel(1)).toBe('1');
    expect(navBadgeLabel(99)).toBe('99');
    expect(navBadgeLabel(100)).toBe('99+');
    expect(navBadgeLabel(120)).toBe('99+');
  });

  it('tên truy cập của mục có badge kèm số mục thật ("Cần xử lý, 3 mục"); không badge → chỉ tên mục', () => {
    expect(navAccessibleName('Cần xử lý', 3)).toBe('Cần xử lý, 3 mục');
    expect(navAccessibleName('Cần xử lý', 120)).toBe('Cần xử lý, 120 mục');
    expect(navAccessibleName('Cần xử lý', 0)).toBe('Cần xử lý');
    expect(navAccessibleName('Cần xử lý', undefined)).toBe('Cần xử lý');
    expect(navSection('review-queue').permission).toBe(Permission.REVIEW_QUEUE_HANDLE);
  });

  it('avatar lấy chữ cái đầu, giữ dấu tiếng Việt', () => {
    expect(organizationInitial('  clb Cờ Vua')).toBe('C');
    expect(organizationInitial('đội bóng')).toBe('Đ');
    expect(organizationInitial('ấm áp')).toBe('Ấ');
    expect(organizationInitial('   ')).toBe('?');
  });
});
