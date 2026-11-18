import type { INestApplication } from '@nestjs/common';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.factory.js';
import { isWebPage } from '../src/web/web-static.js';

/*
 * B13: API отдаёт собранный сайт (WEB_DIST_DIR). SPA fallback только для адресов страниц сайта;
 * API, неизвестные адреса API и отсутствующие ресурсы — как раньше (JSON, 404 без HTML).
 */
describe('Сайт из API (e2e, B13)', () => {
  let app: INestApplication;
  let dist: string;
  const INDEX = '<!doctype html><html><body><div id="root"></div></body></html>';

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), 'jasno-web-'));
    writeFileSync(join(dist, 'index.html'), INDEX);
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
    writeFileSync(join(dist, 'favicon.svg'), '<svg/>');
    app = await createApp({
      env: { LLM_MODE: 'demo', NODE_ENV: 'test', WEB_DIST_DIR: dist },
      logger: false,
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(dist, { recursive: true, force: true });
  });

  it.each(['/', '/login', '/reset', '/app', '/app/cases', '/app/cases/cmabc123/answer/draft', '/app/letters/x/check'])(
    'страница сайта %s (прямое открытие и обновление) отдаёт index.html',
    async (path) => {
      const res = await request(app.getHttpServer()).get(path).set('Accept', 'text/html').expect(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toBe(INDEX);
      expect(res.headers['cache-control']).toBe('no-cache');
    },
  );

  it('файлы сборки отдаются, assets кэшируются надолго', async () => {
    const js = await request(app.getHttpServer()).get('/assets/index-abc123.js').expect(200);
    expect(js.headers['content-type']).toMatch(/javascript/);
    expect(js.headers['cache-control']).toMatch(/immutable/);
    await request(app.getHttpServer()).get('/favicon.svg').expect(200);
  });

  it.each(['/assets/gibt-es-nicht.js', '/app/gibt-es-nicht.js', '/favicon.ico', '/nope', '/cases/x/unbekannt', '/api/cases'])(
    'нет такого ресурса или адреса API %s: 404 JSON, не HTML',
    async (path) => {
      const res = await request(app.getHttpServer()).get(path).set('Accept', 'text/html').expect(404);
      expect(res.headers['content-type']).toMatch(/json/);
      expect(res.body).toEqual({ code: 'NOT_FOUND', message: 'Не найдено' });
    },
  );

  it('API работает как раньше: /health JSON, /cases без входа 401, POST на адрес страницы не отдаёт HTML', async () => {
    const health = await request(app.getHttpServer()).get('/health').expect(200);
    expect(health.body.ok).toBe(true);
    const cases = await request(app.getHttpServer()).get('/cases').set('Accept', 'text/html').expect(401);
    expect(cases.headers['content-type']).toMatch(/json/);
    const post = await request(app.getHttpServer()).post('/login').expect(404);
    expect(post.headers['content-type']).toMatch(/json/);
  });

  it('Swagger на /docs остаётся', async () => {
    await request(app.getHttpServer()).get('/docs').expect(200);
  });

  it('список страниц не пересекается с путями API', () => {
    for (const api of ['/auth/login', '/cases', '/letters/x', '/cabinet', '/history', '/drafts/x', '/health', '/docs'])
      expect(isWebPage(api)).toBe(false);
  });

  it('WEB_DIST_DIR без index.html: сервер не стартует с понятной ошибкой', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'jasno-web-empty-'));
    try {
      await expect(
        createApp({ env: { LLM_MODE: 'demo', NODE_ENV: 'test', WEB_DIST_DIR: empty }, logger: false }),
      ).rejects.toThrow(/WEB_DIST_DIR/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
