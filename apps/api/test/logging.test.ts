import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { PII_KEYS } from '@tickee/contracts';
import { basePinoOptions, buildRedactPaths, REDACTED } from '../src/platform/logging/index.js';
import { LogCapture } from './helpers.js';

describe('che PII trong log', () => {
  it('redact sinh từ danh sách PII của contracts', () => {
    const paths = buildRedactPaths();
    for (const key of PII_KEYS) expect(paths).toContain(key);
    expect(PII_KEYS).toEqual(expect.arrayContaining(['email', 'phone']));
  });

  it('email/SĐT bị che ở mọi độ sâu thường gặp', () => {
    const out = new LogCapture();
    const log = pino(basePinoOptions('info'), out);
    log.info(
      {
        email: 'a@example.com',
        phone: '0901234567',
        user: { email: 'b@example.com', phoneNumber: '0912345678' },
        req: { body: { phone_number: '0923456789' } },
        orderCode: 'TK8F3Q2AXM',
      },
      'mua vé',
    );
    const raw = out.text;
    for (const v of ['a@example.com', '0901234567', 'b@example.com', '0912345678', '0923456789']) {
      expect(raw).not.toContain(v);
    }
    expect(raw).toContain(REDACTED);
    expect(raw).toContain('TK8F3Q2AXM');
  });
});
