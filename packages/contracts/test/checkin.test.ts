import { describe, expect, it } from 'vitest';
import {
  AcceptedCheckerInvite,
  CHECKER_INVITE_ACCEPT_API_PATH,
  CHECKIN_LOOKUP_QUERY_MAX,
  CHECKIN_LOOKUP_RATE_LIMITS,
  CheckinLookupRateLimitedDetails,
  CheckinLookupRequest,
  CheckinLookupResult,
  checkinLookupApiPath,
  checkinManualCheckinApiPath,
  lookupQueryKey,
  parseLookupQuery,
  CHECKER_INVITE_PATH,
  CHECKER_INVITE_PREVIEW_API_PATH,
  CHECKER_INVITE_TOKEN_PATTERN,
  CHECKER_INVITE_TTL_DAYS,
  CheckerAction,
  checkerActionApiPath,
  checkerInviteApiPath,
  CheckerList,
  CheckerListItem,
  checkersApiPath,
  CheckerStatus,
  CheckerInvitePreview,
  CheckerInviteTokenRequest,
  checkerInviteUrl,
  CheckinEvent,
  checkinEventApiPath,
  checkinEventLiveApiPath,
  CheckinTicketTypeProgress,
  checkinScanApiPath,
  checkinScanPath,
  CreatedCheckerInvite,
  SCAN_CODE_MAX,
  ScanCheckedBy,
  ScanInvalidReason,
  ScanRequest,
  ScanResult,
} from '../src/checkin.js';
import { ErrorCode } from '../src/errors.js';
import { CHECKER_PERMISSIONS, checkerHasPermission, Permission } from '../src/organizer.js';

const ORG = '019a3b2c-5678-7abc-8def-0123456789ab';
const EVENT = '019a3b2c-0712-7abc-8def-0123456789ab';
const TOKEN = 'Zx9_aB3-kLm0Qr7Tu1Vw2y';
const invite = {
  id: '019a3b2c-0b00-7abc-8def-000000000001',
  createdAt: '2026-11-22T10:04:00+07:00',
  expiresAt: '2026-11-29T10:04:00+07:00',
  active: true,
};

describe('link mời CTV (Story 5.1, AD-30)', () => {
  it('đường màn nhận lời mời và hạn 7 ngày', () => {
    expect(CHECKER_INVITE_PATH).toBe('/loi-moi-ctv');
    expect(CHECKER_INVITE_TTL_DAYS).toBe(7);
  });

  it('URL: token sau `#` của /loi-moi-ctv, bỏ `/` thừa của origin; không có query', () => {
    expect(checkerInviteUrl('https://tickee.vn', TOKEN)).toBe(`https://tickee.vn/loi-moi-ctv#${TOKEN}`);
    expect(checkerInviteUrl('https://tickee.vn//', TOKEN)).toBe(`https://tickee.vn/loi-moi-ctv#${TOKEN}`);
    expect(new URL(checkerInviteUrl('https://tickee.vn', TOKEN)).search).toBe('');
  });

  it('đường API tương đối với /v1, mã hóa từng đoạn id', () => {
    expect(checkerInviteApiPath(ORG, EVENT)).toBe(`/orgs/${ORG}/events/${EVENT}/checker-invite`);
    expect(checkerInviteApiPath('a/b', 'c?d')).toBe('/orgs/a%2Fb/events/c%3Fd/checker-invite');
  });

  it('token: đúng 22 ký tự base64url không đệm; CreatedCheckerInvite từ chối token sai dạng', () => {
    expect(CHECKER_INVITE_TOKEN_PATTERN.test(TOKEN)).toBe(true);
    expect(CreatedCheckerInvite.safeParse({ invite, token: TOKEN }).success).toBe(true);
    for (const bad of ['', TOKEN.slice(1), `${TOKEN}A`, `${TOKEN.slice(1)}=`, `${TOKEN.slice(1)}+`, `${TOKEN.slice(1)}/`]) {
      expect(CHECKER_INVITE_TOKEN_PATTERN.test(bad), bad).toBe(false);
      expect(CreatedCheckerInvite.safeParse({ invite, token: bad }).success, bad).toBe(false);
    }
  });
});

describe('nhận lời mời CTV và quyền CTV (Story 5.2)', () => {
  it('body token: chuỗi 1–256 ký tự; không kiểm dạng token (sai dạng xử lý như token sai ở api)', () => {
    for (const token of [TOKEN, 'a', 'khong-phai-token', 'x'.repeat(256)]) {
      expect(CheckerInviteTokenRequest.safeParse({ token }).success, token).toBe(true);
    }
    for (const body of [{}, { token: '' }, { token: 'x'.repeat(257) }, { token: 42 }, null]) {
      expect(CheckerInviteTokenRequest.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it('preview: scanEventId là uuid hoặc null', () => {
    const base = { eventName: 'Giải chạy', organizationName: 'CLB Chạy Bộ' };
    expect(CheckerInvitePreview.parse({ ...base, scanEventId: null })).toEqual({ ...base, scanEventId: null });
    expect(CheckerInvitePreview.parse({ ...base, scanEventId: EVENT }).scanEventId).toBe(EVENT);
    expect(CheckerInvitePreview.safeParse({ ...base, scanEventId: 'abc' }).success).toBe(false);
    expect(CheckerInvitePreview.safeParse(base).success).toBe(false);
  });

  it('accept và Sự kiện của Màn quét', () => {
    expect(AcceptedCheckerInvite.parse({ eventId: EVENT })).toEqual({ eventId: EVENT });
    expect(AcceptedCheckerInvite.safeParse({ eventId: 'abc' }).success).toBe(false);
    const event = { eventId: EVENT, eventName: 'Giải chạy', checkedInCount: 0, validTicketCount: 0, ticketTypes: [] };
    expect(CheckinEvent.parse(event)).toEqual(event);
  });

  it('đường Màn quét trên web: /events/<id>, mã hóa id', () => {
    expect(checkinScanPath(EVENT)).toBe(`/events/${EVENT}`);
    expect(checkinScanPath('a/b?c#d')).toBe('/events/a%2Fb%3Fc%23d');
  });

  it('đường API tương đối với /v1: token không bao giờ trong đường dẫn; id Sự kiện được mã hóa', () => {
    expect(CHECKER_INVITE_PREVIEW_API_PATH).toBe('/checkin/invites/preview');
    expect(CHECKER_INVITE_ACCEPT_API_PATH).toBe('/checkin/invites/accept');
    expect(checkinEventApiPath(EVENT)).toBe(`/checkin/events/${EVENT}`);
    expect(checkinEventApiPath('a/b?c')).toBe('/checkin/events/a%2Fb%3Fc');
  });

  it('mã lỗi mới', () => {
    expect(ErrorCode.CHECKER_INVITE_INVALID).toBe('CHECKER_INVITE_INVALID');
    expect(ErrorCode.CHECKER_REVOKED).toBe('CHECKER_REVOKED');
  });

  it('CTV chỉ có checkin.scan và checkin.lookup', () => {
    expect([...CHECKER_PERMISSIONS].sort()).toEqual(['checkin.lookup', 'checkin.scan']);
    const allowed = Object.values(Permission).filter(checkerHasPermission);
    expect(allowed.sort()).toEqual(['checkin.lookup', 'checkin.scan']);
  });
});

describe('quét Mã QR vé (Story 5.3-a)', () => {
  const SCAN_ID = '019a3b2c-0c00-7abc-8def-000000000001';

  it('Sự kiện của Màn quét: số đã check-in và tổng số Vé hợp lệ là số nguyên không âm, bắt buộc', () => {
    const base = { eventId: EVENT, eventName: 'Giải chạy', ticketTypes: [] };
    expect(CheckinEvent.parse({ ...base, checkedInCount: 3, validTicketCount: 120 })).toEqual({
      ...base,
      checkedInCount: 3,
      validTicketCount: 120,
    });
    for (const bad of [
      base,
      { ...base, checkedInCount: 0 },
      { ...base, validTicketCount: 0 },
      { ...base, checkedInCount: -1, validTicketCount: 0 },
      { ...base, checkedInCount: 1.5, validTicketCount: 2 },
      { ...base, checkedInCount: '1', validTicketCount: 2 },
    ]) {
      expect(CheckinEvent.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('đường API quét tương đối với /v1, mã hóa id Sự kiện; mã QR không bao giờ trong đường dẫn', () => {
    expect(checkinScanApiPath(EVENT)).toBe(`/checkin/events/${EVENT}/scans`);
    expect(checkinScanApiPath('a/b?c')).toBe('/checkin/events/a%2Fb%3Fc/scans');
  });

  it('body quét: code là chuỗi 1–512 ký tự (không kiểm dạng QR), scanId là uuid', () => {
    expect(SCAN_CODE_MAX).toBe(512);
    for (const code of ['x', 'khong-phai-ma-qr', 'x'.repeat(SCAN_CODE_MAX)]) {
      expect(ScanRequest.safeParse({ code, scanId: SCAN_ID }).success, code).toBe(true);
    }
    for (const body of [
      {},
      { scanId: SCAN_ID },
      { code: 'x' },
      { code: '', scanId: SCAN_ID },
      { code: 'x'.repeat(SCAN_CODE_MAX + 1), scanId: SCAN_ID },
      { code: 42, scanId: SCAN_ID },
      { code: 'x', scanId: 'khong-phai-uuid' },
      { code: 'x', scanId: '' },
      null,
    ]) {
      expect(ScanRequest.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it('ScanResult: union theo outcome', () => {
    const ok = { outcome: 'ok', holderName: 'Nguyễn Văn An', seq: 1, count: 2, ticketTypeName: 'Vé thường' };
    expect(ScanResult.parse(ok)).toEqual(ok);
    expect(ScanResult.parse({ outcome: 'recent' })).toEqual({ outcome: 'recent' });
    const already = { outcome: 'already', checkedInAt: '2026-11-23T19:05:00+07:00', checkedBy: { kind: 'self' } };
    expect(ScanResult.parse(already)).toEqual(already);
    for (const reason of Object.values(ScanInvalidReason)) {
      expect(ScanResult.parse({ outcome: 'invalid', reason })).toEqual({ outcome: 'invalid', reason });
    }
    expect(Object.values(ScanInvalidReason).sort()).toEqual([
      'BAD_SIGNATURE',
      'CANCELLED',
      'EVENT_ENDED',
      'OTHER_EVENT',
      'VOIDED',
    ]);
    for (const bad of [
      { outcome: 'ok', holderName: 'A', seq: 0, count: 2, ticketTypeName: 'B' },
      { outcome: 'ok', holderName: 'A', seq: 1, ticketTypeName: 'B' },
      { outcome: 'already', checkedInAt: '2026-11-23T19:05:00', checkedBy: { kind: 'self' } },
      { outcome: 'already', checkedInAt: '2026-11-23T19:05:00+07:00' },
      { outcome: 'invalid', reason: 'EXPIRED' },
      { outcome: 'invalid', reason: 'CHECKER_REVOKED' },
      { outcome: 'invalid' },
      { outcome: 'green' },
    ]) {
      expect(ScanResult.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('checkedBy: self, tên (không rỗng), hoặc vai owner/admin/checker', () => {
    for (const by of [
      { kind: 'self' },
      { kind: 'name', name: 'Trần Thị Bình' },
      { kind: 'role', role: 'owner' },
      { kind: 'role', role: 'admin' },
      { kind: 'role', role: 'checker' },
    ]) {
      expect(ScanCheckedBy.parse(by)).toEqual(by);
    }
    for (const bad of [
      { kind: 'name', name: '' },
      { kind: 'name' },
      { kind: 'role', role: 'buyer' },
      { kind: 'email', email: 'a@vidu.vn' },
    ]) {
      expect(ScanCheckedBy.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('tra tay và check-in tay (Story 5.5, FR-29, AD-31, AD-35)', () => {
  const TICKET = '019a3b2c-0b00-7abc-8def-000000000001';

  it('đường API tương đối với /v1, mã hóa từng đoạn id; giá trị tra không bao giờ trong đường dẫn', () => {
    expect(checkinLookupApiPath(EVENT)).toBe(`/checkin/events/${EVENT}/lookups`);
    expect(checkinLookupApiPath('a/b?c')).toBe('/checkin/events/a%2Fb%3Fc/lookups');
    expect(checkinManualCheckinApiPath(EVENT, TICKET)).toBe(`/checkin/events/${EVENT}/tickets/${TICKET}/check-in`);
    expect(checkinManualCheckinApiPath('a/b', 'c?d')).toBe('/checkin/events/a%2Fb/tickets/c%3Fd/check-in');
  });

  it('parseLookupQuery: có @ → email trim + chữ thường; còn lại → SĐT E.164 cùng luật form mua', () => {
    expect(parseLookupQuery('  Minh@Gmail.com ')).toEqual({ kind: 'email', email: 'minh@gmail.com' });
    for (const phone of ['0912 345 678', '0912345678', '0912.345.678', '0912-345-678', '+84 912 345 678', '(0912) 345678']) {
      expect(parseLookupQuery(phone), phone).toEqual({ kind: 'phone', phone: '+84912345678' });
    }
  });

  it('parseLookupQuery: không đủ dạng → null (không khớp một phần, không theo tên)', () => {
    for (const raw of [
      '',
      '   ',
      '0912345',
      '091234567',
      '09123456789',
      '84912345678',
      '+8491234567',
      '0012345678',
      'minh@',
      '@gmail.com',
      'minh@gmail',
      'Nguyễn Văn Minh',
      '678',
      `${'a'.repeat(CHECKIN_LOOKUP_QUERY_MAX)}@x.vn`,
    ]) {
      expect(parseLookupQuery(raw), raw).toBeNull();
    }
  });

  it('lookupQueryKey: một khóa cho mọi cách gõ cùng giá trị', () => {
    expect(lookupQueryKey(parseLookupQuery('0912 345 678')!)).toBe('phone:+84912345678');
    expect(lookupQueryKey(parseLookupQuery('+84912345678')!)).toBe('phone:+84912345678');
    expect(lookupQueryKey(parseLookupQuery(' MINH@gmail.com')!)).toBe('email:minh@gmail.com');
  });

  it('body tra tay: query chuẩn hóa ở đầu ra; sai dạng → lỗi không mang giá trị', () => {
    expect(CheckinLookupRequest.parse({ query: '0912 345 678' })).toEqual({ query: { kind: 'phone', phone: '+84912345678' } });
    expect(CheckinLookupRequest.parse({ query: 'A@B.VN' })).toEqual({ query: { kind: 'email', email: 'a@b.vn' } });
    for (const body of [{}, { query: '' }, { query: '0912345' }, { query: 'minh@' }, { query: 42 }, null]) {
      const parsed = CheckinLookupRequest.safeParse(body);
      expect(parsed.success, JSON.stringify(body)).toBe(false);
    }
    const failed = CheckinLookupRequest.safeParse({ query: '0912345' });
    expect(JSON.stringify(failed.error?.issues.map((i) => ({ path: i.path, code: i.code, message: i.message })))).not.toContain(
      '0912345',
    );
  });

  it('kết quả tra: chỉ bản chụp trên Vé và checkedIn; ticketId uuid, seq/count ≥ 1', () => {
    const row = {
      ticketId: TICKET,
      holderName: 'Nguyễn Văn Minh',
      ticketTypeName: 'Đôi nam',
      seq: 1,
      count: 2,
      checkedIn: false,
    };
    expect(CheckinLookupResult.parse({ tickets: [row] })).toEqual({ tickets: [row] });
    expect(CheckinLookupResult.parse({ tickets: [] })).toEqual({ tickets: [] });
    for (const bad of [
      { ...row, ticketId: 'abc' },
      { ...row, seq: 0 },
      { ...row, count: 0 },
      { ...row, checkedIn: 'no' },
      { holderName: 'A', ticketTypeName: 'B', seq: 1, count: 1, checkedIn: true },
    ]) {
      expect(CheckinLookupResult.safeParse({ tickets: [bad] }).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('giới hạn: cửa sổ 10 phút, 60 lần mỗi tài khoản, 600 lần mỗi IP; 429 kèm retryAfterSeconds dương', () => {
    expect(CHECKIN_LOOKUP_RATE_LIMITS).toEqual({ windowSeconds: 600, perUser: 60, perIp: 600 });
    expect(ErrorCode.CHECKIN_LOOKUP_RATE_LIMITED).toBe('CHECKIN_LOOKUP_RATE_LIMITED');
    expect(CheckinLookupRateLimitedDetails.parse({ retryAfterSeconds: 42 })).toEqual({ retryAfterSeconds: 42 });
    for (const bad of [{}, { retryAfterSeconds: 0 }, { retryAfterSeconds: 1.5 }]) {
      expect(CheckinLookupRateLimitedDetails.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('CTV của Sự kiện: danh sách, thu hồi, khôi phục (Story 5.6)', () => {
  const CHECKER = '019a3b2c-0d00-7abc-8def-000000000001';
  const row = {
    id: CHECKER,
    name: 'Trần Thị Bình',
    email: 'binh@vidu.vn',
    acceptedAt: '2026-11-22T10:04:00+07:00',
    status: 'active',
    revokedAt: null,
  };

  it('đường API tương đối với /v1, mã hóa từng đoạn id', () => {
    expect(checkersApiPath(ORG, EVENT)).toBe(`/orgs/${ORG}/events/${EVENT}/checkers`);
    expect(checkersApiPath('a/b', 'c?d')).toBe('/orgs/a%2Fb/events/c%3Fd/checkers');
    expect(checkerActionApiPath(ORG, EVENT, CHECKER, CheckerAction.REVOKE)).toBe(
      `/orgs/${ORG}/events/${EVENT}/checkers/${CHECKER}/revoke`,
    );
    expect(checkerActionApiPath(ORG, EVENT, 'x/y', CheckerAction.RESTORE)).toBe(
      `/orgs/${ORG}/events/${EVENT}/checkers/x%2Fy/restore`,
    );
  });

  it('trạng thái CTV: active, revoked', () => {
    expect(Object.values(CheckerStatus).sort()).toEqual(['active', 'revoked']);
    expect(Object.values(CheckerAction).sort()).toEqual(['restore', 'revoke']);
  });

  it('một hàng: tên/email null được (tài khoản OTP, tài khoản không còn); tên rỗng không hợp lệ; revokedAt có offset', () => {
    expect(CheckerListItem.parse(row)).toEqual(row);
    const revoked = { ...row, status: 'revoked', revokedAt: '2026-11-23T08:00:00+07:00' };
    expect(CheckerListItem.parse(revoked)).toEqual(revoked);
    expect(CheckerListItem.parse({ ...row, name: null }).name).toBeNull();
    expect(CheckerListItem.parse({ ...row, name: null, email: null })).toMatchObject({ name: null, email: null });
    for (const bad of [
      { ...row, id: 'abc' },
      { ...row, name: '' },
      { ...row, status: 'pending' },
      { ...row, acceptedAt: '2026-11-22T10:04:00' },
      { ...row, revokedAt: undefined },
    ]) {
      expect(CheckerListItem.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(CheckerList.parse({ checkers: [row] })).toEqual({ checkers: [row] });
    expect(CheckerList.parse({ checkers: [] })).toEqual({ checkers: [] });
  });

  it('mã lỗi mới: EVENT_ENDED', () => {
    expect(ErrorCode.EVENT_ENDED).toBe('EVENT_ENDED');
  });
});

describe('theo dõi check-in realtime (Story 5.7)', () => {
  const TYPE = '019a3b2c-0e00-7abc-8def-000000000001';
  const progress = { ticketTypeId: TYPE, name: 'Vé thường', checkedInCount: 2, validTicketCount: 5 };

  it('một Hạng vé: id uuid, tên, hai số nguyên không âm (0/0 hợp lệ), bắt buộc đủ', () => {
    expect(CheckinTicketTypeProgress.parse(progress)).toEqual(progress);
    const empty = { ...progress, checkedInCount: 0, validTicketCount: 0 };
    expect(CheckinTicketTypeProgress.parse(empty)).toEqual(empty);
    for (const bad of [
      { ...progress, ticketTypeId: 'abc' },
      { ...progress, name: undefined },
      { ...progress, checkedInCount: -1 },
      { ...progress, validTicketCount: 1.5 },
      { ...progress, checkedInCount: '2' },
    ]) {
      expect(CheckinTicketTypeProgress.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('CheckinEvent: ticketTypes bắt buộc, giữ thứ tự api trả', () => {
    const base = { eventId: EVENT, eventName: 'Giải chạy', checkedInCount: 2, validTicketCount: 5 };
    const second = {
      ticketTypeId: '019a3b2c-0e00-7abc-8def-000000000002',
      name: 'Vé mời',
      checkedInCount: 0,
      validTicketCount: 0,
    };
    expect(CheckinEvent.parse({ ...base, ticketTypes: [progress, second] }).ticketTypes).toEqual([progress, second]);
    expect(CheckinEvent.safeParse(base).success).toBe(false);
    expect(CheckinEvent.safeParse({ ...base, ticketTypes: [{ ...progress, ticketTypeId: 'abc' }] }).success).toBe(false);
  });

  it('đường SSE: …/checkin/events/<id>/live, mã hóa id', () => {
    expect(checkinEventLiveApiPath(EVENT)).toBe(`/checkin/events/${EVENT}/live`);
    expect(checkinEventLiveApiPath('a/b?c#d')).toBe('/checkin/events/a%2Fb%3Fc%23d/live');
  });
});
