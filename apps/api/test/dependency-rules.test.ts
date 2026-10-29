import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const apiRoot = fileURLToPath(new URL('..', import.meta.url));
const fixtureRoot = fileURLToPath(new URL('./fixtures/depcruise-violation', import.meta.url));
const depcruise = fileURLToPath(new URL('../node_modules/.bin/depcruise', import.meta.url));
const config = fileURLToPath(new URL('../.dependency-cruiser.cjs', import.meta.url));

function cruise(cwd: string) {
  const res = spawnSync(depcruise, ['src', '--config', config, '--output-type', 'err'], { cwd, encoding: 'utf8' });
  return { status: res.status, output: `${res.stdout}${res.stderr}` };
}

describe('dependency-cruiser (AD-10, AD-25)', () => {
  it('mã nguồn thật không vi phạm', () => {
    const { status, output } = cruise(apiRoot);
    expect(output).toContain('no dependency violations');
    expect(status).toBe(0);
  });

  it('fixture import sai hướng làm lệnh thất bại', () => {
    const { status, output } = cruise(fixtureRoot);
    expect(status).not.toBe(0);
    expect(output).toContain('module-direction-identity');
    expect(output).toMatch(/module-public-api-only.*event\/index\.ts.*organizer\/internal\.ts/);
    expect(output).toContain('module-not-to-flows');
    expect(output).toMatch(/platform-not-to-domain: src\/platform\/x\.ts/);
    expect(output).toMatch(/outside-public-api-only: src\/flows\/x\.ts.*organizer\/internal\.ts/);
    expect(output).toMatch(/no-circular: src\/modules\/tingee\/[ab]\.ts/);
    // File không phải schema.ts import schema.ts của mô-đun khác → vi phạm.
    expect(output).toMatch(/module-public-api-only: src\/modules\/ordering\/index\.ts.*event\/schema\.ts/);
    // schema.ts → schema.ts của mô-đun được phép: không bị báo.
    expect(output).not.toMatch(/src\/modules\/event\/schema\.ts →/);
    // Import trong cùng mô-đun (ngoại lệ $1): không bị báo.
    expect(output).not.toContain('organizer/a.ts');
    // Better Auth chỉ được import trong modules/identity.
    expect(output).toMatch(/better-auth-only-in-identity: src\/platform\/auth-leak\.ts → .*better-auth/);
    expect(output).toMatch(/better-auth-only-in-identity: src\/modules\/organizer\/auth-guard\.ts → .*@thallesp\/nestjs-better-auth/);
    expect(output).not.toContain('src/modules/identity/auth.ts');
  });
});
