import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Controller, Get, Res, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ErrorCode, ErrorResponse } from '@tickee/contracts';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import type { Response } from 'express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiModule } from '../src/api.module.js';
import { AppError, Public } from '../src/platform/http/index.js';
import { API_APP_OPTIONS, configureApiApp } from '../src/roles/api.js';
import { apiConfig, LogCapture } from './helpers.js';

/** Dữ liệu người dùng mà lỗi DB mang theo (câu SQL, params, message của `cause`): không bao giờ được vào log. */
const QUERY_MARKER = `bi_mat_${randomUUID().replaceAll('-', '')}`;
const DB_LEAK = {
  email: `ro-ri-${randomUUID()}@vidu.vn`,
  token: `tok-${randomUUID()}`,
  query: `insert into "sessions" ("token", "email") values ($1, $2) -- ${QUERY_MARKER}`,
  causeMessage: `terminating connection bi-mat-${randomUUID()}`,
};
/** Dấu không chứa `"` (JSON.stringify thoát `"` thành `\"`, nên so chuỗi có `"` với log text luôn "không chứa"). */
const DB_LEAK_MARKERS = [DB_LEAK.email, DB_LEAK.token, QUERY_MARKER, DB_LEAK.causeMessage];

@Public()
@Controller('boom')
class BoomController {
  @Get()
  boom(): never {
    throw new Error('bí mật nội bộ không được lộ');
  }

  @Get('db')
  db(): never {
    const cause = Object.assign(new Error(DB_LEAK.causeMessage), { code: '57P01' });
    throw new DrizzleQueryError(DB_LEAK.query, [DB_LEAK.email, DB_LEAK.token], cause);
  }

  @Get('app-plain')
  appPlain(): never {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'Không gửi được email.', {
      cause: Object.assign(new Error('nguyên nhân thường'), { code: 'ECONNREFUSED' }),
    });
  }

  @Get('app-db')
  appDb(): never {
    const cause = Object.assign(new pg.DatabaseError(DB_LEAK.causeMessage, 0, 'error'), { code: '23505' });
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'Không lưu được phiên.', {
      cause: new DrizzleQueryError(DB_LEAK.query, [DB_LEAK.email, DB_LEAK.token], cause),
    });
  }

  @Get('pii')
  pii(@Res({ passthrough: true }) res: Response): { ok: true } {
    res.setHeader('set-cookie', 'sid=bi-mat-phien-123; HttpOnly');
    return { ok: true };
  }
}

async function buildApp(databaseUrl?: string): Promise<{ app: INestApplication; logs: LogCapture }> {
  const logs = new LogCapture();
  const config = apiConfig(databaseUrl ? { DATABASE_URL: databaseUrl } : {});
  const moduleRef = await Test.createTestingModule({
    imports: [ApiModule.forRoot(config, { destination: logs })],
    controllers: [BoomController],
  }).compile();
  const app = configureApiApp(moduleRef.createNestApplication(API_APP_OPTIONS), { shutdownHooks: false });
  await app.init();
  return { app, logs };
}

describe('HTTP khi DB sẵn sàng', () => {
  let app: INestApplication;
  let logs: LogCapture;

  beforeAll(async () => {
    ({ app, logs } = await buildApp());
  });
  afterAll(async () => {
    await app.close();
  });

  it('GET /healthz → 200 và sinh x-request-id', async () => {
    const res = await request(app.getHttpServer()).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('GET /readyz → 200', async () => {
    const res = await request(app.getHttpServer()).get('/readyz');
    expect(res.status).toBe(200);
  });

  it('dùng lại x-request-id hợp lệ và gắn requestId vào log', async () => {
    const res = await request(app.getHttpServer()).get('/v1/khong-co').set('x-request-id', 'req-abc_123');
    expect(res.headers['x-request-id']).toBe('req-abc_123');
    const line = logs.lines.find((l) => l.requestId === 'req-abc_123');
    expect(line).toBeDefined();
  });

  it('che header authorization, cookie, set-cookie trong log', async () => {
    const secret = 'bi-mat-phien-123';
    await request(app.getHttpServer())
      .get('/v1/boom/pii')
      .set('x-request-id', 'req-headers')
      .set('authorization', `Bearer ${secret}`)
      .set('cookie', `sid=${secret}`);
    const line = logs.lines.find((l) => l.requestId === 'req-headers' && 'res' in l);
    expect(line).toBeDefined();
    expect(logs.text).not.toContain(secret);
    expect(JSON.stringify(line)).toContain('[REDACTED]');
  });

  it('x-request-id không hợp lệ bị thay bằng id mới', async () => {
    for (const bad of ['dau cach "va" <ngoac>', 'x'.repeat(200)]) {
      const res = await request(app.getHttpServer()).get('/healthz').set('x-request-id', bad);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('route lạ → 404 NOT_FOUND đúng dạng lỗi chuẩn', async () => {
    const res = await request(app.getHttpServer()).get('/v1/khong-co');
    expect(res.status).toBe(404);
    expect(ErrorResponse.parse(res.body).error.code).toBe('NOT_FOUND');
    expect(res.body.error.details).toBeNull();
  });

  it('lỗi không bắt được → 500 INTERNAL_ERROR, không lộ stack hay message gốc; log giữ `err` đầy đủ', async () => {
    const res = await request(app.getHttpServer()).get('/v1/boom').set('x-request-id', 'req-boom');
    expect(res.status).toBe(500);
    expect(ErrorResponse.parse(res.body).error.code).toBe('INTERNAL_ERROR');
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('bí mật');
    expect(raw).not.toContain('at ');
    // Lỗi không phải lỗi DB: log nguyên để gỡ lỗi (message + stack).
    const line = logs.lines.find((l) => l.requestId === 'req-boom' && l.msg === 'Lỗi không bắt được');
    expect(line).toMatchObject({ level: 50, context: 'ErrorFilter', err: { type: 'Error', message: 'bí mật nội bộ không được lộ' } });
    expect((line?.err as { stack?: unknown }).stack).toEqual(expect.stringContaining('BoomController'));
  });

  it('lỗi DB không bắt được → 500 INTERNAL_ERROR; log chỉ có tên lớp và SQLSTATE, không SQL/params/message của cause', async () => {
    const res = await request(app.getHttpServer()).get('/v1/boom/db').set('x-request-id', 'req-boom-db');
    expect(res.status).toBe(500);
    expect(ErrorResponse.parse(res.body).error.code).toBe('INTERNAL_ERROR');
    const line = logs.lines.find((l) => l.requestId === 'req-boom-db' && l.msg === 'Lỗi không bắt được');
    expect(line).toMatchObject({ level: 50, context: 'ErrorFilter' });
    expect(line?.err).toEqual({ type: 'DrizzleQueryError', code: '57P01' });
    for (const v of DB_LEAK_MARKERS) expect(logs.text).not.toContain(v);
    expect(JSON.stringify(res.body)).not.toContain(DB_LEAK.email);
  });

  it('AppError 5xx bọc lỗi DB → log `{ err: { type, code: SQLSTATE }, code: INTERNAL_ERROR }`', async () => {
    const res = await request(app.getHttpServer()).get('/v1/boom/app-db').set('x-request-id', 'req-boom-app-db');
    expect(res.status).toBe(500);
    expect(ErrorResponse.parse(res.body).error.code).toBe('INTERNAL_ERROR');
    const line = logs.lines.find((l) => l.requestId === 'req-boom-app-db' && l.msg === 'Không lưu được phiên.');
    expect(line).toMatchObject({ level: 50, context: 'ErrorFilter', code: 'INTERNAL_ERROR' });
    expect(line?.err).toEqual({ type: 'DrizzleQueryError', code: '23505' });
    for (const v of DB_LEAK_MARKERS) expect(logs.text).not.toContain(v);
  });

  it('AppError 5xx có `cause` không phải lỗi DB → log giữ `err` đầy đủ (message, code, stack)', async () => {
    const res = await request(app.getHttpServer()).get('/v1/boom/app-plain').set('x-request-id', 'req-boom-app-plain');
    expect(res.status).toBe(500);
    const line = logs.lines.find((l) => l.requestId === 'req-boom-app-plain' && l.msg === 'Không gửi được email.');
    expect(line).toMatchObject({
      level: 50,
      context: 'ErrorFilter',
      code: 'INTERNAL_ERROR',
      err: { type: 'Error', message: 'nguyên nhân thường', code: 'ECONNREFUSED' },
    });
    expect((line?.err as { stack?: unknown }).stack).toEqual(expect.stringContaining('BoomController'));
  });

  it('che IP và User-Agent của request; method, url, requestId giữ nguyên', async () => {
    const userAgent = `TickeeTest/1.0 ua-${randomUUID()}`;
    const forwardedFor = '198.51.100.77';
    const realIp = '198.51.100.78';
    const cdnIp = '198.51.100.79';
    await request(app.getHttpServer())
      .get('/v1/boom/pii')
      .set('x-request-id', 'req-ip-ua')
      .set('user-agent', userAgent)
      .set('x-forwarded-for', forwardedFor)
      .set('x-real-ip', realIp)
      .set('forwarded', `for=${forwardedFor}`)
      .set('cf-connecting-ip', cdnIp);
    const line = logs.lines.find((l) => l.requestId === 'req-ip-ua' && 'res' in l);
    expect(line).toMatchObject({
      req: {
        method: 'GET',
        url: '/v1/boom/pii',
        remoteAddress: '[REDACTED]',
        headers: {
          'user-agent': '[REDACTED]',
          'x-forwarded-for': '[REDACTED]',
          'x-real-ip': '[REDACTED]',
          forwarded: '[REDACTED]',
          'cf-connecting-ip': '[REDACTED]',
        },
      },
    });
    for (const v of [userAgent, forwardedFor, realIp, cdnIp]) expect(logs.text).not.toContain(v);
  });

  it('JSON hỏng → 400 VALIDATION_FAILED', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/boom')
      .set('content-type', 'application/json')
      .send('{"hỏng":');
    expect(res.status).toBe(400);
    expect(ErrorResponse.parse(res.body).error.code).toBe('VALIDATION_FAILED');
  });
});

describe('HTTP khi DB xuống', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await buildApp('postgresql://tickee_app:tickee_app@127.0.0.1:1/tickee_test'));
  });
  afterAll(async () => {
    await app.close();
  });

  it('/readyz → 503 SERVICE_UNAVAILABLE, /healthz vẫn 200', async () => {
    const ready = await request(app.getHttpServer()).get('/readyz');
    expect(ready.status).toBe(503);
    expect(ErrorResponse.parse(ready.body).error.code).toBe('SERVICE_UNAVAILABLE');
    const health = await request(app.getHttpServer()).get('/healthz');
    expect(health.status).toBe(200);
  });
});
