import { describe, expect, it } from 'vitest';
import {
  AcceptedCheckerInvite,
  CHECKER_INVITE_ACCEPT_API_PATH,
  CHECKER_INVITE_PATH,
  CHECKER_INVITE_PREVIEW_API_PATH,
  CHECKER_INVITE_TOKEN_PATTERN,
  CHECKER_INVITE_TTL_DAYS,
  checkerInviteApiPath,
  CheckerInvitePreview,
  CheckerInviteTokenRequest,
  checkerInviteUrl,
  CheckinEvent,
  checkinEventApiPath,
  checkinScanPath,
  CreatedCheckerInvite,
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
    expect(CheckinEvent.parse({ eventId: EVENT, eventName: 'Giải chạy' })).toEqual({ eventId: EVENT, eventName: 'Giải chạy' });
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
