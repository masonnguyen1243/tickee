import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from 'next/constants';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertBuildEnv, InvalidBuildEnvError, MissingBuildEnvError } from '@/lib/build-env';
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

describe('assertBuildEnv — host thật phải là https (Story 4.7-f)', () => {
  it('build để deploy với https → không ném', () => {
    expect(() =>
      assertBuildEnv(PHASE_PRODUCTION_BUILD, argv('build'), { NEXT_PUBLIC_API_BASE_URL: 'https://api.tickee.vn' }),
    ).not.toThrow();
  });

  it.each(['http://api.tickee.vn', 'http://API.tickee.vn:8080/v1', ' http://api.tickee.vn '])(
    'next build với %j (http, host thật) → ném lỗi nêu tên biến và lý do https, không nêu giá trị',
    (value) => {
      let error: unknown;
      try {
        assertBuildEnv(PHASE_PRODUCTION_BUILD, argv('build'), { NEXT_PUBLIC_API_BASE_URL: value });
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(InvalidBuildEnvError);
      expect((error as InvalidBuildEnvError).issues).toEqual([
        { variable: 'NEXT_PUBLIC_API_BASE_URL', reason: 'phải là https khi host không phải local' },
      ]);
      expect((error as Error).message).toContain('NEXT_PUBLIC_API_BASE_URL (phải là https');
      expect((error as Error).message).not.toContain(value.trim());
    },
  );

  it.each(['http://localhost:3001', 'http://127.0.0.1:3001', 'http://[::1]:3001', 'http://web.localhost:3001'])(
    'next build với %s (host local) → build như cũ',
    (value) => {
      expect(() => assertBuildEnv(PHASE_PRODUCTION_BUILD, argv('build'), { NEXT_PUBLIC_API_BASE_URL: value })).not.toThrow();
    },
  );

  it('next typegen, next dev, next start với http host thật → không ném', () => {
    const env = { NEXT_PUBLIC_API_BASE_URL: 'http://api.tickee.vn' };
    expect(() => assertBuildEnv(PHASE_PRODUCTION_BUILD, argv('typegen'), env)).not.toThrow();
    expect(() => assertBuildEnv(PHASE_DEVELOPMENT_SERVER, argv('dev'), env)).not.toThrow();
    expect(() => assertBuildEnv(PHASE_PRODUCTION_SERVER, argv('start'), env)).not.toThrow();
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

  it('next build với http host thật → config ném InvalidBuildEnvError', () => {
    process.argv = argv('build');
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.tickee.vn');
    expect(() => nextConfig(PHASE_PRODUCTION_BUILD)).toThrow(InvalidBuildEnvError);
  });

  it('next typegen thiếu biến → trả config', () => {
    process.argv = argv('typegen');
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', undefined);
    expect(nextConfig(PHASE_PRODUCTION_BUILD)).toMatchObject({ poweredByHeader: false, reactStrictMode: true });
  });
});
