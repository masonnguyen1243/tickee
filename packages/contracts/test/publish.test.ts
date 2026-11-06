import { describe, expect, it } from 'vitest';
import { ErrorCode } from '../src/errors.js';
import {
  EventNotReadyDetails,
  PUBLISH_CONDITION_ORDER,
  PublishReadiness,
  unmetConditions,
} from '../src/publish.js';

describe('điều kiện mở bán', () => {
  it('thứ tự mã: bốn mã luôn có rồi ba mã của Sự kiện có phí', () => {
    expect(PUBLISH_CONDITION_ORDER).toEqual([
      'REFUND_POLICY',
      'HAS_TICKET_TYPE',
      'EVENT_NOT_ENDED',
      'ORGANIZATION_NOT_LOCKED',
      'CLOSED_BETA_APPROVED',
      'PAYOUT_ACCOUNT_LINKED',
      'PAID_PRICE_MINIMUM',
    ]);
  });

  it('PublishReadiness từ chối mã lạ; unmetConditions giữ thứ tự', () => {
    expect(PublishReadiness.safeParse({ conditions: [{ code: 'LẠ', satisfied: true }] }).success).toBe(false);
    const readiness = PublishReadiness.parse({
      conditions: [
        { code: 'REFUND_POLICY', satisfied: false },
        { code: 'HAS_TICKET_TYPE', satisfied: true },
        { code: 'EVENT_NOT_ENDED', satisfied: false },
      ],
    });
    expect(unmetConditions(readiness)).toEqual(['REFUND_POLICY', 'EVENT_NOT_ENDED']);
  });

  it('mã lỗi mở bán và details của EVENT_NOT_READY', () => {
    expect(ErrorCode.EVENT_NOT_READY).toBe('EVENT_NOT_READY');
    expect(ErrorCode.EVENT_NOT_DRAFT).toBe('EVENT_NOT_DRAFT');
    expect(EventNotReadyDetails.parse({ unmet: ['REFUND_POLICY'] })).toEqual({ unmet: ['REFUND_POLICY'] });
    expect(EventNotReadyDetails.safeParse({ unmet: ['LẠ'] }).success).toBe(false);
  });
});
