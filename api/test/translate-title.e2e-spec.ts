import type { INestApplication } from '@nestjs/common';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.factory.js';
import { DEMO_TRANSLATE_NOTE } from '../src/llm/adapters/demo.adapter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PERSON } from './person.js';
import { createTestDatabase } from './test-db.js';

const fixture = (name: string) =>
  readFileSync(
    resolve(import.meta.dirname, '..', '..', 'fixtures', 'letters', name),
  );

describe('Перевод и название письма (e2e, поправки 7 и 8)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let cleanup: () => Promise<void>;
  let storageDir: string;
  let token: string;
  let other: string;
  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });

  async function register(email: string) {
    const res = await http()
      .post('/auth/register')
      .send({
        email,
        password: 'mein-langes-Passwort',
        consent: true,
        aiConsent: true,
        ...PERSON,
      })
      .expect(201);
    return res.body.sessionToken as string;
  }

  async function upload(name: string) {
    const res = await http()
      .post('/letters')
      .set(auth())
      .attach('files', fixture(name), name)
      .expect(201);
    return res.body as { letter: { id: string; title: string | null } };
  }

  beforeAll(async () => {
    const test = createTestDatabase();
    cleanup = test.cleanup;
    storageDir = mkdtempSync(join(tmpdir(), 'jasno-translate-'));
    app = await createApp({
      env: {
        LLM_MODE: 'demo',
        NODE_ENV: 'test',
        DATABASE_URL: test.url,
        STORAGE_DIR: storageDir,
      },
      logger: false,
    });
    await app.init();
    db = app.get(PrismaService);
    token = await register('translate@example.org');
    other = await register('fremd-translate@example.org');
  }, 60000);

  afterAll(async () => {
    await app.close();
    await cleanup();
    rmSync(storageDir, { recursive: true, force: true });
  });

  it('название: модель предлагает по строке Betreff (extract.v4), видно в письме и во входящих', async () => {
    const up = await upload('01_jobcenter_request.pdf');
    expect(up.letter.title).toBe('Jobcenter: документы к заявлению');
    const inbox = await http().get('/letters?inbox=true').set(auth()).expect(200);
    expect(inbox.body.find((l: { id: string }) => l.id === up.letter.id).title).toBe(
      'Jobcenter: документы к заявлению',
    );
    const call = await db.llmCall.findFirstOrThrow({
      where: { letterId: up.letter.id, promptName: 'extract' },
    });
    expect(call.promptVersion).toBe(4);
  });

  it('название можно изменить; пустое — 400; чужое письмо — 404', async () => {
    const up = await upload('04_buergeramt.pdf');
    const res = await http()
      .patch(`/letters/${up.letter.id}`)
      .set(auth())
      .send({ title: '  Договор аренды для Bürgeramt ' })
      .expect(200);
    expect(res.body.letter.title).toBe('Договор аренды для Bürgeramt');
    await http()
      .patch(`/letters/${up.letter.id}`)
      .set(auth())
      .send({ title: '' })
      .expect(400);
    await http()
      .patch(`/letters/${up.letter.id}`)
      .set(auth(other))
      .send({ title: 'чужое' })
      .expect(404);
  });

  it('перевод: весь текст по-русски с пометкой, второй раз из кэша без модели', async () => {
    const up = await upload('01_jobcenter_request.pdf');
    const first = await http()
      .post(`/letters/${up.letter.id}/translate`)
      .set(auth())
      .expect(200);
    expect(first.body).toMatchObject({ lang: 'ru', machine: true, cached: false });
    expect(first.body.text.startsWith(DEMO_TRANSLATE_NOTE)).toBe(true);
    expect(first.body.text).toContain('Пожалуйста, ответьте до 30.11.2026.');
    expect(first.body.text).toContain('Jobcenter Musterstadt');

    const calls = () =>
      db.llmCall.count({ where: { letterId: up.letter.id, promptName: 'translate' } });
    expect(await calls()).toBe(1);
    const second = await http()
      .post(`/letters/${up.letter.id}/translate`)
      .set(auth())
      .expect(200);
    expect(second.body.cached).toBe(true);
    expect(second.body.text).toBe(first.body.text);
    expect(await calls()).toBe(1);
    const ops = await db.llmOperation.findMany({ where: { kind: 'TRANSLATE' } });
    expect(ops).toHaveLength(1);
  });

  it('перевод: чужое письмо — 404, неизвестный язык — 400', async () => {
    const up = await upload('04_buergeramt.pdf');
    await http()
      .post(`/letters/${up.letter.id}/translate`)
      .set(auth(other))
      .expect(404);
    await http().post(`/letters/${up.letter.id}/translate?lang=fr`).set(auth()).expect(400);
  });
});
