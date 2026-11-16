import { describe, expect, it } from 'vitest';
import { JobQueue, TokenAlertEmailPayload } from '../src/jobs.js';
import { NOTIFICATION_CATALOG, NotificationKind } from '../src/notifications.js';
import {
  Permission,
  roleHasPermission,
  TOKEN_ALERT_SCAN_CRON,
  TOKEN_ALERT_THRESHOLD_MAX,
  TOKEN_ALERT_THRESHOLD_MIN,
  TokenAlert,
  TokenAlertThresholdInput,
  tokenAlertThresholdApiPath,
  TokenOverview,
  TokenReading,
  TokenReadingStatus,
  tokenApiPath,
} from '../src/organizer.js';
import { STATUS_NOTICE_PRIORITY, StatusNoticeCode } from '../src/reporting.js';

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
    const alert = { threshold: null, belowThresholdSince: null };
    expect(TokenOverview.parse({ reading, tingeePortalUrl: 'https://baas.tingee.vn', alert })).toEqual({
      reading,
      tingeePortalUrl: 'https://baas.tingee.vn',
      alert,
    });
    expect(TokenOverview.parse({ reading: { status: 'unavailable' }, alert })).toEqual({
      reading: { status: 'unavailable' },
      alert,
    });
    expect(roleHasPermission('owner', Permission.TOKEN_PURCHASE)).toBe(true);
    expect(roleHasPermission('admin', Permission.TOKEN_PURCHASE)).toBe(false);
    expect(roleHasPermission('admin', Permission.TOKEN_VIEW)).toBe(true);
  });

  it('đường API', () => {
    expect(tokenApiPath(ID)).toBe(`/orgs/${ID}/token`);
  });
});

describe('Cảnh báo Token (Story 4.5-b)', () => {
  it('ngưỡng: số nguyên 1…10^12 hoặc null (tắt); 0, âm, số lẻ, chuỗi, quá lớn, thiếu → bị từ chối', () => {
    expect(TOKEN_ALERT_THRESHOLD_MIN).toBe(1);
    expect(TOKEN_ALERT_THRESHOLD_MAX).toBe(10 ** 12);
    for (const threshold of [1, 500, 10 ** 12, null]) {
      expect(TokenAlertThresholdInput.parse({ threshold }), String(threshold)).toEqual({ threshold });
    }
    for (const threshold of [0, -1, 1.5, 'abc', '500', 10 ** 12 + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(TokenAlertThresholdInput.safeParse({ threshold }).success, String(threshold)).toBe(false);
    }
    expect(TokenAlertThresholdInput.safeParse({}).success).toBe(false);
  });

  it('trạng thái cảnh báo: mốc dưới ngưỡng chỉ có khi đã đặt ngưỡng', () => {
    const since = '2026-11-16T03:04:05.123Z';
    expect(TokenAlert.parse({ threshold: 500, belowThresholdSince: since })).toEqual({
      threshold: 500,
      belowThresholdSince: since,
    });
    expect(TokenAlert.parse({ threshold: 500, belowThresholdSince: null }).belowThresholdSince).toBeNull();
    expect(TokenAlert.parse({ threshold: null, belowThresholdSince: null }).threshold).toBeNull();
    expect(TokenAlert.safeParse({ threshold: null, belowThresholdSince: since }).success).toBe(false);
    // `alert` bắt buộc trong `GET …/token`.
    expect(TokenOverview.safeParse({ reading: { status: 'unavailable' } }).success).toBe(false);
  });

  it('chỉ Owner đặt ngưỡng; đường API; cron mỗi giờ', () => {
    expect(Permission.TOKEN_ALERT_MANAGE).toBe('token_alert.manage');
    expect(roleHasPermission('owner', Permission.TOKEN_ALERT_MANAGE)).toBe(true);
    expect(roleHasPermission('admin', Permission.TOKEN_ALERT_MANAGE)).toBe(false);
    expect(tokenAlertThresholdApiPath(ID)).toBe(`/orgs/${ID}/token/alert-threshold`);
    expect(TOKEN_ALERT_SCAN_CRON).toBe('0 * * * *');
  });

  it('queue: dò mỗi giờ, email + dead-letter; payload email chỉ id và mốc, không số', () => {
    expect(JobQueue.TOKEN_ALERT_SCAN).toBe('organizer.token-alert-scan');
    expect(JobQueue.TOKEN_ALERT_EMAIL).toBe('organizer.token-alert-email');
    expect(JobQueue.TOKEN_ALERT_EMAIL_DEAD_LETTER).toBe('organizer.token-alert-email.dead-letter');
    const payload = { organizationId: ID, belowThresholdSince: '2026-11-16T03:04:05.123Z' };
    expect(TokenAlertEmailPayload.parse({ ...payload, available: 300 })).toEqual(payload);
    expect(TokenAlertEmailPayload.safeParse({ ...payload, belowThresholdSince: 'hôm qua' }).success).toBe(false);
  });

  it('banner warning ở bậc 9: sau chờ duyệt Closed Beta (cuối danh sách hiện có); mã trùng loại thông báo', () => {
    expect(StatusNoticeCode.TOKEN_BELOW_THRESHOLD).toBe('token_below_threshold');
    expect(STATUS_NOTICE_PRIORITY.at(-1)).toBe(StatusNoticeCode.TOKEN_BELOW_THRESHOLD);
    expect(STATUS_NOTICE_PRIORITY.indexOf(StatusNoticeCode.TOKEN_BELOW_THRESHOLD)).toBeGreaterThan(
      STATUS_NOTICE_PRIORITY.indexOf(StatusNoticeCode.CLOSED_BETA_PENDING),
    );
    expect(StatusNoticeCode.TOKEN_BELOW_THRESHOLD).toBe(NotificationKind.TOKEN_BELOW_THRESHOLD);
  });

  it('danh mục thông báo: Token dưới ngưỡng gửi Owner qua email và banner, khóa (organization, lần vượt ngưỡng)', () => {
    expect(Object.keys(NOTIFICATION_CATALOG)).toEqual(Object.values(NotificationKind));
    expect(NOTIFICATION_CATALOG.token_below_threshold).toMatchObject({
      recipients: ['owner'],
      channels: ['email', 'banner'],
      dedupeKey: ['organizationId', 'token_below_threshold_since'],
      emailQueue: JobQueue.TOKEN_ALERT_EMAIL,
      noticeCode: StatusNoticeCode.TOKEN_BELOW_THRESHOLD,
    });
    expect(NOTIFICATION_CATALOG.token_below_threshold.trigger.length).toBeGreaterThan(0);
  });
});
