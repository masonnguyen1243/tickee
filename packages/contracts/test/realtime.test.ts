import { describe, expect, it } from 'vitest';
import {
  ORGANIZATION_REALTIME_TOPICS,
  REALTIME_HEARTBEAT_SECONDS,
  REALTIME_RESYNC,
  REALTIME_TOPICS,
  RealtimeSignal,
  RealtimeStreamMessage,
} from '../src/realtime.js';

const ORDER = '019a3b2c-0c00-7abc-8def-000000000001';
const ORG = '019a3b2c-0c00-7abc-8def-000000000002';
const EVENT = '019a3b2c-0c00-7abc-8def-000000000003';

describe('Realtime (AD-17)', () => {
  it('đủ 5 topic của AD-17', () => {
    expect(REALTIME_TOPICS).toEqual([
      'order_changed',
      'event_orders_changed',
      'event_checkins_changed',
      'org_review_items_changed',
      'org_status_changed',
    ]);
  });

  it('RealtimeSignal: đúng {type, id, organizationId, eventId}; topic lạ, id sai dạng hay trường thừa → không nhận', () => {
    const signal = { type: 'order_changed', id: ORDER, organizationId: ORG, eventId: EVENT };
    expect(RealtimeSignal.parse(signal)).toEqual(signal);
    expect(RealtimeSignal.safeParse({ ...signal, type: 'order_paid' }).success).toBe(false);
    expect(RealtimeSignal.safeParse({ ...signal, id: 'TK8F3Q2AXM' }).success).toBe(false);
    expect(RealtimeSignal.safeParse({ ...signal, status: 'paid' }).success).toBe(false);
    const { eventId: _eventId, ...noEvent } = signal;
    expect(RealtimeSignal.safeParse(noEvent).success).toBe(false);
  });

  it('tín hiệu cấp BTC (Story 4.2): org_status_changed không có eventId; có eventId → không nhận', () => {
    expect(ORGANIZATION_REALTIME_TOPICS).toEqual(['org_status_changed']);
    const signal = { type: 'org_status_changed', id: ORG, organizationId: ORG };
    expect(RealtimeSignal.parse(signal)).toEqual(signal);
    expect(RealtimeSignal.safeParse({ ...signal, eventId: EVENT }).success).toBe(false);
  });

  it('tin SSE chỉ có type (kể cả loại lạ); tín hiệu nối lại là resync; heartbeat 25 giây', () => {
    expect(RealtimeStreamMessage.parse({ type: 'order_changed' })).toEqual({ type: 'order_changed' });
    expect(RealtimeStreamMessage.parse({ type: 'loai_moi' })).toEqual({ type: 'loai_moi' });
    expect(RealtimeStreamMessage.safeParse({}).success).toBe(false);
    expect(REALTIME_RESYNC).toBe('resync');
    expect(REALTIME_HEARTBEAT_SECONDS).toBe(25);
  });
});
