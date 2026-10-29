import 'reflect-metadata';
import { Controller, Get, Res, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ErrorResponse } from '@tickee/contracts';
import type { Response } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiModule } from '../src/api.module.js';
import { Public } from '../src/platform/http/index.js';
import { API_APP_OPTIONS, configureApiApp } from '../src/roles/api.js';
import { apiConfig, LogCapture } from './helpers.js';

@Public()
@Controller('boom')
class BoomController {
  @Get()
  boom(): never {
    throw new Error('bí mật nội bộ không được lộ');
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

  it('lỗi không bắt được → 500 INTERNAL_ERROR, không lộ stack hay message gốc', async () => {
    const res = await request(app.getHttpServer()).get('/v1/boom');
    expect(res.status).toBe(500);
    expect(ErrorResponse.parse(res.body).error.code).toBe('INTERNAL_ERROR');
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('bí mật');
    expect(raw).not.toContain('at ');
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
