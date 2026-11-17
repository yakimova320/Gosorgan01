import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app.factory.js';

describe('Служебное (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp({
      env: { LLM_MODE: 'demo', NODE_ENV: 'test' },
      logger: false,
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health отвечает 200 и режимом модели', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({ ok: true, llmMode: 'demo', version: '0.1.0' });
  });

  it('GET /health не показывает секреты', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(JSON.stringify(res.body)).not.toMatch(/key|secret|password/i);
  });

  it('неизвестный адрес даёт 404 в общем формате ошибки', async () => {
    const res = await request(app.getHttpServer()).get('/nope').expect(404);
    expect(res.body).toEqual({ code: 'NOT_FOUND', message: 'Не найдено' });
  });

  it('Swagger открывается на /docs', async () => {
    await request(app.getHttpServer()).get('/docs').expect(200);
  });

  it('CORS разрешает адрес интерфейса', async () => {
    const res = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
  });

  it('CORS не разрешает чужой адрес', async () => {
    const res = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'http://evil.test');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
