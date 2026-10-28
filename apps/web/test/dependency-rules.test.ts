import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const fixtureRoot = fileURLToPath(new URL('./fixtures/depcruise-violation', import.meta.url));
const depcruise = fileURLToPath(new URL('../node_modules/.bin/depcruise', import.meta.url));
const config = fileURLToPath(new URL('../.dependency-cruiser.cjs', import.meta.url));

function cruise(cwd: string, dirs: string[]) {
  const res = spawnSync(depcruise, [...dirs, '--config', config, '--output-type', 'err'], { cwd, encoding: 'utf8' });
  return { status: res.status, output: `${res.stdout}${res.stderr}` };
}

describe('dependency-cruiser apps/web (AD-11)', () => {
  it('mã nguồn thật không vi phạm', () => {
    const { status, output } = cruise(webRoot, ['app', 'components', 'lib']);
    expect(output).toContain('no dependency violations');
    expect(status).toBe(0);
  });

  it('fixture import driver DB và apps/api làm lệnh thất bại', () => {
    const { status, output } = cruise(fixtureRoot, ['lib']);
    expect(status).not.toBe(0);
    expect(output).toMatch(/web-no-db-driver: lib\/violations\.ts → pg\b/);
    expect(output).toMatch(/web-no-db-driver: lib\/violations\.ts → pg-boss/);
    expect(output).toMatch(/web-no-db-driver: lib\/violations\.ts → drizzle-orm/);
    expect(output).toMatch(/web-no-api-import: lib\/violations\.ts → @tickee\/api/);
  });
});
