import { describe, expect, it } from 'vitest';
import { ErrorCode } from '../src/errors.js';
import { PII_KEYS } from '../src/pii.js';
import {
  BLOCKED_BANK_BINS,
  ConnectTingeeRequest,
  isBlockedBankBin,
  maskTingeeClientId,
  PayoutAccount,
  PayoutAccountOption,
  PayoutAccountOverview,
  ReplaceTingeeKeyRequest,
  SelectPayoutAccountRequest,
  TINGEE_IPN_PATH,
  TINGEE_KEY_MAX_LENGTH,
  TingeeCredentialSummary,
  TingeeKeyPreview,
  tingeeIpnUrl,
} from '../src/organizer.js';
import { STATUS_NOTICE_PRIORITY, StatusNoticeCode } from '../src/reporting.js';

describe('tài khoản nhận tiền: BTC dùng key Tingee của mình (Story 2.6)', () => {
  it('VietinBank không chọn được', () => {
    expect(BLOCKED_BANK_BINS).toEqual(['970415']);
    expect(isBlockedBankBin('970415')).toBe(true);
    expect(isBlockedBankBin('970422')).toBe(false);
  });

  it('form kết nối: bỏ khoảng trắng hai đầu; thiếu hoặc quá dài bị từ chối tại đúng trường', () => {
    expect(ConnectTingeeRequest.parse({ clientId: '  abc-123 ', secretToken: '\tsecret\n' })).toEqual({
      clientId: 'abc-123',
      secretToken: 'secret',
    });
    for (const [field, value] of [
      ['clientId', '   '],
      ['secretToken', ''],
      ['secretToken', 'x'.repeat(TINGEE_KEY_MAX_LENGTH + 1)],
    ] as const) {
      const result = ConnectTingeeRequest.safeParse({ clientId: 'abc', secretToken: 'def', [field]: value });
      expect(result.success, `${field}`).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual([field]);
    }
  });

  it('chọn tài khoản: cần vaAccountNumber', () => {
    expect(SelectPayoutAccountRequest.parse({ vaAccountNumber: ' 9600000001 ' })).toEqual({ vaAccountNumber: '9600000001' });
    expect(SelectPayoutAccountRequest.safeParse({ vaAccountNumber: '' }).success).toBe(false);
    expect(SelectPayoutAccountRequest.safeParse({}).success).toBe(false);
  });

  it('đổi key Tingee (Story 2.13-b): key mới như form kết nối + vaAccountNumber; xem trước không có Client ID đầy đủ', () => {
    expect(
      ReplaceTingeeKeyRequest.parse({ clientId: ' abc ', secretToken: ' def ', vaAccountNumber: ' 9600000001 ' }),
    ).toEqual({ clientId: 'abc', secretToken: 'def', vaAccountNumber: '9600000001' });
    for (const missing of ['clientId', 'secretToken', 'vaAccountNumber'] as const) {
      const body = { clientId: 'abc', secretToken: 'def', vaAccountNumber: '9600000001', [missing]: ' ' };
      const result = ReplaceTingeeKeyRequest.safeParse(body);
      expect(result.success, missing).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual([missing]);
    }
    expect(Object.keys(TingeeKeyPreview.shape).sort()).toEqual(['accounts', 'clientIdMasked']);
    expect(ErrorCode.PAYOUT_ACCOUNT_NOT_LINKED_YET).toBe('PAYOUT_ACCOUNT_NOT_LINKED_YET');
  });

  it('Client ID che còn 4 ký tự cuối; Client ID quá ngắn không lộ ký tự nào', () => {
    expect(maskTingeeClientId('tg-client-0a1b2c3d')).toBe('••••2c3d');
    expect(maskTingeeClientId('abc')).toBe('••••');
    expect(maskTingeeClientId('abcdefg')).toBe('••••');
  });

  it('URL IPN riêng của BTC', () => {
    expect(TINGEE_IPN_PATH).toBe('/v1/payments/tingee/ipn');
    expect(tingeeIpnUrl('https://api.tickee.vn', 'AbC_-123')).toBe('https://api.tickee.vn/v1/payments/tingee/ipn/AbC_-123');
    // Cùng một hằng cho URL dán vào portal và tiền tố mà parser JSON toàn cục của api bỏ qua (Story 3.5).
    expect(tingeeIpnUrl('https://api.tickee.vn', 'k').startsWith(`https://api.tickee.vn${TINGEE_IPN_PATH}/`)).toBe(true);
  });

  it('IPN sai chữ ký hoặc lệch giờ có mã lỗi riêng (Story 3.5)', () => {
    expect(ErrorCode.IPN_SIGNATURE_INVALID).toBe('IPN_SIGNATURE_INVALID');
  });

  it('DTO không có Secret Token, Client ID đầy đủ hay số tài khoản đầy đủ', () => {
    for (const shape of [TingeeCredentialSummary.shape, PayoutAccountOption.shape, PayoutAccount.shape]) {
      const keys = Object.keys(shape);
      expect(keys).not.toContain('secretToken');
      expect(keys).not.toContain('clientId');
      expect(keys).not.toContain('accountNumber');
    }
    expect(Object.keys(PayoutAccount.shape)).toContain('accountLast4');
  });

  it('nhiều tài khoản: overview có danh sách và canReplaceKey; tài khoản có isDefault; dòng danh sách có linked', () => {
    expect(Object.keys(PayoutAccountOverview.shape).sort()).toEqual([
      'accounts',
      'canReplaceKey',
      'credential',
      'ipnUrl',
      'tingeePortalUrl',
    ]);
    const account = {
      id: '019a3b2c-0300-7abc-8def-0123456789ab',
      vaAccountNumber: '9600004321',
      bankBin: '970422',
      bankName: 'MB Bank',
      accountType: 'personal-account',
      accountLast4: '4321',
      accountName: 'CLB CO VUA QUAN 3',
      isDefault: true,
      linkedAt: '2026-11-03T03:05:00.000Z',
    };
    expect(PayoutAccount.parse(account)).toEqual(account);
    const { isDefault: _isDefault, ...withoutDefault } = account;
    expect(PayoutAccount.safeParse(withoutDefault).success).toBe(false);

    const overview = {
      credential: null,
      accounts: [account, { ...account, id: '019a3b2c-0301-7abc-8def-0123456789ab', isDefault: false }],
      ipnUrl: null,
      tingeePortalUrl: 'https://baas.tingee.vn',
      canReplaceKey: false,
    };
    expect(PayoutAccountOverview.parse(overview)).toEqual(overview);
    // Dạng một tài khoản cũ (`account`) không còn hợp lệ.
    expect(
      PayoutAccountOverview.safeParse({ credential: null, account: null, ipnUrl: null, tingeePortalUrl: 'x' }).success,
    ).toBe(false);

    const option = {
      vaAccountNumber: '9600004321',
      bankBin: '970422',
      bankName: 'MB Bank',
      accountType: 'personal-account',
      accountLast4: '4321',
      accountName: 'CLB CO VUA QUAN 3',
      selectable: true,
      linked: true,
    };
    expect(PayoutAccountOption.parse(option)).toEqual(option);
    const { linked: _linked, ...withoutLinked } = option;
    expect(PayoutAccountOption.safeParse(withoutLinked).success).toBe(false);
  });

  it('mã lỗi, notice và khóa che log', () => {
    for (const code of [
      'TINGEE_CREDENTIAL_INVALID',
      'BANK_NOT_SUPPORTED',
      'PAYOUT_ACCOUNT_UNAVAILABLE',
      'PAYOUT_ACCOUNT_ALREADY_LINKED',
      'MERCHANT_SUSPENDED',
      'PAYMENT_PROVIDER_UNAVAILABLE',
    ]) {
      expect(Object.values(ErrorCode)).toContain(code);
    }
    for (const gone of ['PAYOUT_ACCOUNT_INVALID', 'PAYOUT_ACCOUNT_IN_USE', 'BANK_OTP_INVALID', 'BANK_OTP_EXPIRED']) {
      expect(Object.values(ErrorCode)).not.toContain(gone);
    }
    // Không còn trạng thái "đang liên kết": trục tài khoản nhận tiền chỉ có một mã.
    expect(Object.values(StatusNoticeCode).filter((code) => code.startsWith('PAYOUT_ACCOUNT_'))).toEqual([
      'PAYOUT_ACCOUNT_NOT_LINKED',
    ]);
    // Ưu tiên: thu hồi Closed Beta (#3) > chưa liên kết (#5) > chờ duyệt Closed Beta (#6).
    const rank = (code: StatusNoticeCode) => STATUS_NOTICE_PRIORITY.indexOf(code);
    expect(rank('CLOSED_BETA_REVOKED')).toBeLessThan(rank('PAYOUT_ACCOUNT_NOT_LINKED'));
    expect(rank('PAYOUT_ACCOUNT_NOT_LINKED')).toBeLessThan(rank('CLOSED_BETA_PENDING'));
    for (const key of [
      'account_name',
      'accountName',
      'account_last4',
      'accountLast4',
      'accountNumber',
      'va_account_number',
      'vaAccountNumber',
      'secret_token',
      'secretToken',
      'client_id',
      'clientId',
    ]) {
      expect(PII_KEYS).toContain(key);
    }
  });
});
