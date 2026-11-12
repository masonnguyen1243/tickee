import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcRoot = fileURLToPath(new URL('../../src', import.meta.url));
const CLOCK_FILE = 'platform/db/clock.ts';
const HAND_WRITTEN_CLOCK = /SELECT\s+(now|clock_timestamp)\(\)/i;

describe('đồng hồ DB chỉ nằm ở platform/db/clock.ts', () => {
  it('không file nguồn nào khác tự viết SELECT now() / SELECT clock_timestamp()', () => {
    const files = readdirSync(srcRoot, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts'))
      .map((file) => file.split(sep).join('/'));
    const source = (file: string) => readFileSync(join(srcRoot, file), 'utf8');
    // Regex còn bắt được hai câu gốc: test không âm thầm qua vì đổi tên file hay đổi cách viết.
    expect(files).toContain(CLOCK_FILE);
    expect(source(CLOCK_FILE)).toMatch(HAND_WRITTEN_CLOCK);

    const offenders = files.filter((file) => file !== CLOCK_FILE && HAND_WRITTEN_CLOCK.test(source(file)));
    expect(offenders, 'dùng dbNow/dbClock của platform/db thay vì tự viết').toEqual([]);
  });
});
