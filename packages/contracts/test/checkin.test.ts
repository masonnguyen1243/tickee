import { describe, expect, it } from 'vitest';
import {
  CHECKER_INVITE_PATH,
  CHECKER_INVITE_TOKEN_PATTERN,
  CHECKER_INVITE_TTL_DAYS,
  checkerInviteApiPath,
  checkerInviteUrl,
  CreatedCheckerInvite,
} from '../src/checkin.js';

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
