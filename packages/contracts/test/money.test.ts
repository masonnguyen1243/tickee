import { describe, expect, it } from 'vitest';
import { formatVnd } from '../src/money.js';

describe('formatVnd', () => {
  it.each([
    [300000, '300.000đ'],
    [0, '0đ'],
    [1234567, '1.234.567đ'],
    [999, '999đ'],
    [1000, '1.000đ'],
  ])('%d → %s', (amount, expected) => {
    expect(formatVnd(amount)).toBe(expected);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('ném RangeError với %d', (amount) => {
    expect(() => formatVnd(amount)).toThrow(RangeError);
  });
});
