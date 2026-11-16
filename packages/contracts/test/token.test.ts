import { describe, expect, it } from 'vitest';
import {
  Permission,
  roleHasPermission,
  TokenOverview,
  TokenReading,
  TokenReadingStatus,
  tokenApiPath,
} from '../src/organizer.js';

/*
 * Token của BTC (Story 4.5-a): kết quả đọc (số đọc được, chưa đọc được, chưa có tài khoản nhận tiền mặc định), link
 * portal Tingee chỉ cho người mua được Token (Owner), đường API.
 */

const ID = '019a3b2c-5678-7abc-8def-0123456789ab';
const READ_AT = '2026-11-16T03:04:05.000Z';
const ok = (balance: number, creditLimit: number, available = balance + creditLimit) => ({
  status: 'ok',
  balance,
  creditLimit,
  available,
  readAt: READ_AT,
});

describe('Token (Story 4.5-a)', () => {
  it('ba trạng thái đọc', () => {
    expect(Object.values(TokenReadingStatus).sort()).toEqual(['no_payout_account', 'ok', 'unavailable']);
  });

  it('đọc được: số dư âm được, hạn mức ≥ 0, khả dụng = số dư + hạn mức; số lẻ, thiếu trường, lệch tổng bị từ chối', () => {
    expect(TokenReading.parse(ok(1200, 500))).toEqual(ok(1200, 500));
    expect(TokenReading.parse(ok(-200, 500))).toMatchObject({ available: 300 });
    expect(TokenReading.parse(ok(0, 0))).toMatchObject({ available: 0 });
    expect(TokenReading.safeParse(ok(1200, -1)).success).toBe(false);
    expect(TokenReading.safeParse(ok(1200.5, 500)).success).toBe(false);
    expect(TokenReading.safeParse(ok(1200, 500, 1000)).success).toBe(false);
    expect(TokenReading.safeParse({ ...ok(1200, 500), readAt: 'hôm qua' }).success).toBe(false);
    const { creditLimit: _creditLimit, ...missing } = ok(1200, 500);
    expect(TokenReading.safeParse(missing).success).toBe(false);
  });

  it('chưa đọc được / chưa có tài khoản: không mang số; trạng thái lạ bị từ chối', () => {
    expect(TokenReading.parse({ status: 'unavailable' })).toEqual({ status: 'unavailable' });
    expect(TokenReading.parse({ status: 'no_payout_account' })).toEqual({ status: 'no_payout_account' });
    // Số lọt vào phản hồi `unavailable` bị bỏ, không tới giao diện.
    expect(TokenReading.parse({ status: 'unavailable', balance: 1200 })).toEqual({ status: 'unavailable' });
    expect(TokenReading.safeParse({ status: 'khac' }).success).toBe(false);
  });

  it('link portal Tingee không bắt buộc (Admin không có); chỉ Owner có quyền mua Token', () => {
    const reading = ok(1200, 500);
    expect(TokenOverview.parse({ reading, tingeePortalUrl: 'https://baas.tingee.vn' })).toEqual({
      reading,
      tingeePortalUrl: 'https://baas.tingee.vn',
    });
    expect(TokenOverview.parse({ reading: { status: 'unavailable' } })).toEqual({ reading: { status: 'unavailable' } });
    expect(roleHasPermission('owner', Permission.TOKEN_PURCHASE)).toBe(true);
    expect(roleHasPermission('admin', Permission.TOKEN_PURCHASE)).toBe(false);
    expect(roleHasPermission('admin', Permission.TOKEN_VIEW)).toBe(true);
  });

  it('đường API', () => {
    expect(tokenApiPath(ID)).toBe(`/orgs/${ID}/token`);
  });
});
