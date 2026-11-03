import { describe, expect, it } from 'vitest';
import { ErrorCode } from '../src/errors.js';
import { PII_KEYS } from '../src/pii.js';
import {
  BLOCKED_BANK_BINS,
  ConfirmPayoutOtpRequest,
  isSupportedPayoutBank,
  LinkPayoutAccountRequest,
  PayoutAccount,
  payoutBankName,
  SUPPORTED_PAYOUT_BANKS,
} from '../src/organizer.js';
import { STATUS_NOTICE_PRIORITY, StatusNoticeCode } from '../src/reporting.js';

const ID = '019a3b2c-5678-7abc-8def-0123456789ab';

const valid = {
  bankBin: '970422',
  accountNumber: '0123 4567 890',
  accountName: '  Nguyễn  Văn Đạt ',
  identityNumber: '0792 0300 1234',
  phone: '+84 901 234 567',
};

describe('liên kết tài khoản nhận tiền (Story 2.6)', () => {
  it('5 ngân hàng luồng form + OTP; VietinBank bị chặn', () => {
    expect(SUPPORTED_PAYOUT_BANKS.map((b) => b.bin)).toEqual(['970418', '970422', '970416', '970432', '970448']);
    expect(BLOCKED_BANK_BINS).toEqual(['970415']);
    expect(isSupportedPayoutBank('970415')).toBe(false);
    expect(isSupportedPayoutBank('970436')).toBe(false);
    expect(isSupportedPayoutBank('970422')).toBe(true);
    expect(payoutBankName('970418')).toBe('BIDV');
    expect(payoutBankName('999999')).toBe('999999');
  });

  it('chuẩn hóa form: số tài khoản, tên in hoa không dấu, CCCD, SĐT', () => {
    expect(LinkPayoutAccountRequest.parse(valid)).toEqual({
      bankBin: '970422',
      accountNumber: '01234567890',
      accountName: 'NGUYEN VAN DAT',
      identityNumber: '079203001234',
      phone: '0901234567',
    });
  });

  it('BIN không hỗ trợ vẫn qua schema (server trả BANK_NOT_SUPPORTED), BIN sai dạng thì không', () => {
    expect(LinkPayoutAccountRequest.safeParse({ ...valid, bankBin: '970415' }).success).toBe(true);
    expect(LinkPayoutAccountRequest.safeParse({ ...valid, bankBin: 'abc' }).success).toBe(false);
  });

  it.each([
    ['accountNumber', '12345'],
    ['accountNumber', '12a4567890'],
    ['accountName', ''],
    ['accountName', 'NGUYEN VAN 2'],
    ['identityNumber', '12345678901'],
    ['phone', '123'],
  ])('%s "%s" bị từ chối tại đúng trường', (field, value) => {
    const result = LinkPayoutAccountRequest.safeParse({ ...valid, [field]: value });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([field]);
  });

  it('OTP 4–8 chữ số, có id lần thử', () => {
    expect(ConfirmPayoutOtpRequest.parse({ attemptId: ID, otp: ' 123 456 ' })).toEqual({ attemptId: ID, otp: '123456' });
    expect(ConfirmPayoutOtpRequest.safeParse({ attemptId: ID, otp: '12' }).success).toBe(false);
    expect(ConfirmPayoutOtpRequest.safeParse({ attemptId: 'x', otp: '123456' }).success).toBe(false);
  });

  it('DTO không có số tài khoản đầy đủ hay CCCD', () => {
    const keys = Object.keys(PayoutAccount.shape);
    expect(keys).not.toContain('accountNumber');
    expect(keys).not.toContain('identityNumber');
    expect(keys).toContain('accountLast4');
  });

  it('mã lỗi, notice và khóa che log', () => {
    for (const code of [
      'PAYOUT_ACCOUNT_INVALID',
      'BANK_NOT_SUPPORTED',
      'PAYOUT_ACCOUNT_IN_USE',
      'PAYOUT_ACCOUNT_ALREADY_LINKED',
      'BANK_OTP_INVALID',
      'BANK_OTP_EXPIRED',
      'MERCHANT_SUSPENDED',
      'PAYMENT_PROVIDER_UNAVAILABLE',
    ]) {
      expect(Object.values(ErrorCode)).toContain(code);
    }
    // Ưu tiên: thu hồi Closed Beta (#3) > chưa liên kết (#5) > chờ duyệt Closed Beta (#6).
    const rank = (code: StatusNoticeCode) => STATUS_NOTICE_PRIORITY.indexOf(code);
    expect(rank('CLOSED_BETA_REVOKED')).toBeLessThan(rank('PAYOUT_ACCOUNT_NOT_LINKED'));
    expect(rank('PAYOUT_ACCOUNT_NOT_LINKED')).toBeLessThan(rank('PAYOUT_ACCOUNT_LINKING'));
    expect(rank('PAYOUT_ACCOUNT_LINKING')).toBeLessThan(rank('CLOSED_BETA_PENDING'));
    for (const key of ['account_name', 'accountName', 'account_last4', 'accountLast4', 'accountNumber', 'identityNumber']) {
      expect(PII_KEYS).toContain(key);
    }
  });
});
