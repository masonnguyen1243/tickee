import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from 'next/constants';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertBuildEnv, MissingBuildEnvError } from '@/lib/build-env';
import nextConfig from '@/next.config';

const NEXT_BIN = '/repo/node_modules/next/dist/bin/next';
const argv = (command: string, ...rest: string[]) => ['/usr/local/bin/node', NEXT_BIN, command, ...rest];
const WITH_VAR = { NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3001' };

describe('assertBuildEnv — biến bắt buộc của next build', () => {
  it('next build thiếu biến → ném lỗi nêu tên biến và cách đặt', () => {
    let error: unknown;
    try {
      assertBuildEnv(PHASE_PRODUCTION_BUILD, argv('build'), {});
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(MissingBuildEnvError);
    expect((error as MissingBuildEnvError).variables).toEqual(['NEXT_PUBLIC_API_BASE_URL']);
    expect((error as Error).message).toContain('NEXT_PUBLIC_API_BASE_URL=');
    expect((error as Error).message).toContain('pnpm typecheck');
  });

  it('next build với biến rỗng hoặc chỉ khoảng trắng → coi như thiếu', () => {
    expect(() => assertBuildEnv(PHASE_PRODUCTION_BUILD, argv('build'), { NEXT_PUBLIC_API_BASE_URL: '' })).toThrow(
      MissingBuildEnvError,
    );
    expect(() => assertBuildEnv(PHASE_PRODUCTION_BUILD, argv('build'), { NEXT_PUBLIC_API_BASE_URL: '  ' })).toThrow(
      MissingBuildEnvError,
    );
  });

  it('next build có tùy chọn đứng trước lệnh vẫn được kiểm', () => {
    expect(() => assertBuildEnv(PHASE_PRODUCTION_BUILD, argv('--debug', 'build'), {})).toThrow(MissingBuildEnvError);
  });

  it('next build có biến → không ném', () => {
    expect(() => assertBuildEnv(PHASE_PRODUCTION_BUILD, argv('build'), WITH_VAR)).not.toThrow();
  });

  it('next typegen (cũng ở PHASE_PRODUCTION_BUILD) thiếu biến → không ném', () => {
    expect(() => assertBuildEnv(PHASE_PRODUCTION_BUILD, argv('typegen'), {})).not.toThrow();
  });

  it('next dev và next start thiếu biến → không ném', () => {
    expect(() => assertBuildEnv(PHASE_DEVELOPMENT_SERVER, argv('dev'), {})).not.toThrow();
    expect(() => assertBuildEnv(PHASE_PRODUCTION_SERVER, argv('start', '-p', '3100'), {})).not.toThrow();
  });
});

describe('next.config.ts gọi assertBuildEnv', () => {
  const originalArgv = process.argv;
  afterEach(() => {
    process.argv = originalArgv;
    vi.unstubAllEnvs();
  });

  it('next build thiếu biến → config ném MissingBuildEnvError', () => {
    process.argv = argv('build');
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', undefined);
    expect(() => nextConfig(PHASE_PRODUCTION_BUILD)).toThrow(MissingBuildEnvError);
  });

  it('next typegen thiếu biến → trả config', () => {
    process.argv = argv('typegen');
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', undefined);
    expect(nextConfig(PHASE_PRODUCTION_BUILD)).toMatchObject({ poweredByHeader: false, reactStrictMode: true });
  });
});
