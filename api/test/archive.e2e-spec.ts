import type { INestApplication } from '@nestjs/common';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.factory.js';
import { CHAT_DISCLAIMER } from '../src/chat/chat.dto.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PERSON } from './person.js';
import { createTestDatabase } from './test-db.js';

const PASSWORD = 'mein-langes-Passwort';
const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dirname, '..', '..', 'fixtures', 'letters', name));

describe('Вопросы к архиву писем (e2e, L05)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let cleanup: () => Promise<void>;
  let storageDir: string;
  let contentDir: string;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function register(email: string, aiConsent = true) {
    const res = await http()
      .post('/auth/register')
      .send({ email, password: PASSWORD, consent: true, aiConsent, ...PERSON })
      .expect(201);
    const { id } = await db.cabinet.findUniqueOrThrow({ where: { email } });
    return { token: res.body.sessionToken as string, cabinetId: id };
  }

  async function upload(token: string, name: string): Promise<string> {
    const res = await http()
      .post('/letters')
      .set(auth(token))
      .attach('files', fixture(name), name)
      .expect(201);
    return res.body.letter.id as string;
  }

  const ask = (token: string, text: string) =>
    http().post('/archive/ask').set(auth(token)).send({ text });

  beforeAll(async () => {
    const test = createTestDatabase();
    cleanup = test.cleanup;
    storageDir = mkdtempSync(join(tmpdir(), 'jasno-archive-'));
    // свой справочник: один проверенный термин, один черновик
    contentDir = mkdtempSync(join(tmpdir(), 'jasno-archive-content-'));
    writeFileSync(
      join(contentDir, 'glossary.json'),
      JSON.stringify({
        terms: [
          { id: 'a', term: 'Aktenzeichen', text: { ru: 'Номер дела.', uk: 'Номер справи.', de: 'Nummer der Akte.' }, checkedAt: '2026-11-26' },
          { id: 'k', term: 'Kontoauszüge', text: { ru: 'Черновик.', uk: '', de: '' }, checkedAt: '', draft: true },
        ],
      }),
    );
    app = await createApp({
      env: {
        LLM_MODE: 'demo',
        NODE_ENV: 'test',
        DATABASE_URL: test.url,
        STORAGE_DIR: storageDir,
        CONTENT_DIR: contentDir,
        LLM_DAILY_CHAT_PER_CABINET: '6',
      },
      logger: false,
    });
    await app.init();
    db = app.get(PrismaService);
  }, 60000);

  afterAll(async () => {
    await app.close();
    await cleanup();
    rmSync(storageDir, { recursive: true, force: true });
    rmSync(contentDir, { recursive: true, force: true });
  });

  it('ответ по своим письмам: источник с точной цитатой, 2 обращения к модели, вектор без текста в журнале', async () => {
    const a = await register('archive@example.org');
    const jobcenter = await upload(a.token, '01_jobcenter_request.pdf');
    await upload(a.token, '04_buergeramt.pdf');

    const res = await ask(a.token, 'Welche Kontoauszüge soll ich einreichen?').expect(200);
    expect(res.body.disclaimer).toBe(CHAT_DISCLAIMER);
    expect(res.body.answer).toContain('Kontoauszüge');
    expect(res.body.pendingLetters).toBe(0);
    expect(res.body.sources[0]).toMatchObject({
      letterId: jobcenter,
      quote: 'Bitte reichen Sie die Kontoauszüge für September ein.',
    });
    // каждая цитата есть в тексте своего письма
    for (const s of res.body.sources as { letterId: string; quote: string }[]) {
      const l = await db.letter.findUniqueOrThrow({ where: { id: s.letterId } });
      expect(l.rawText.replace(/\s+/g, ' ')).toContain(s.quote);
    }
    // справочник: только проверенный термин, черновик не используется
    expect(res.body.terms).toEqual([{ term: 'Aktenzeichen', text: 'Номер дела.' }]);

    // векторы посчитаны для обоих писем
    expect(await db.letterChunk.count({ where: { cabinetId: a.cabinetId } })).toBeGreaterThanOrEqual(2);

    const op = await db.llmOperation.findMany({ where: { cabinetId: a.cabinetId, kind: 'CHAT' } });
    expect(op).toHaveLength(1);
    const calls = await db.llmCall.findMany({ where: { operationId: op[0].id }, orderBy: { createdAt: 'asc' } });
    expect(calls.map((c) => c.promptName)).toEqual(['embed', 'archive']);
    expect(calls.reduce((n, c) => n + c.attempts, 0)).toBeLessThanOrEqual(3);
    expect(calls[0].input).toMatch(/^embed: \d+ texts, \d+ chars$/);
    expect(calls[0].input).not.toContain('Kontoauszüge');

    // второй вопрос: письма уже готовы, векторы считаются только для вопроса
    await ask(a.token, 'Soll ich den Mietvertrag vorlegen?')
      .expect(200)
      .expect((r) => expect(r.body.sources[0].quote).toBe('Bitte legen Sie den Mietvertrag vor.'));
    const embeds = await db.llmCall.findMany({ where: { cabinetId: a.cabinetId, promptName: 'embed' }, orderBy: { createdAt: 'asc' } });
    expect(embeds[1].input).toMatch(/^embed: 1 texts/);
  });

  it('чужие письма не находятся; без писем — честный ответ без модели', async () => {
    const a = await register('archive-a@example.org');
    await upload(a.token, '01_jobcenter_request.pdf');
    await ask(a.token, 'Kontoauszüge?').expect(200);

    const b = await register('archive-b@example.org');
    const res = await ask(b.token, 'Welche Kontoauszüge soll ich einreichen?').expect(200);
    expect(res.body.sources).toEqual([]);
    expect(res.body.answer).toContain('пока нет писем');
    expect(await db.llmCall.count({ where: { cabinetId: b.cabinetId } })).toBe(0);

    // у b своё письмо: в выдаче только оно
    const own = await upload(b.token, '04_buergeramt.pdf');
    const again = await ask(b.token, 'Welche Kontoauszüge soll ich einreichen?').expect(200);
    for (const s of again.body.sources as { letterId: string }[]) expect(s.letterId).toBe(own);
  });

  it('вопрос не по письмам: пустой список источников', async () => {
    const a = await register('archive-none@example.org');
    await upload(a.token, '04_buergeramt.pdf');
    const res = await ask(a.token, 'Wie wird das Wetter morgen?').expect(200);
    expect(res.body.sources).toEqual([]);
    expect(res.body.answer).toContain('нет');
  });

  it('удаление письма и аккаунта удаляет куски; изменённый текст письма считается заново', async () => {
    const a = await register('archive-del@example.org');
    const l1 = await upload(a.token, '01_jobcenter_request.pdf');
    const l2 = await upload(a.token, '04_buergeramt.pdf');
    await ask(a.token, 'Mietvertrag').expect(200);
    expect(await db.letterChunk.count({ where: { letterId: l1 } })).toBeGreaterThan(0);

    await http().delete(`/letters/${l1}`).set(auth(a.token)).expect(204);
    expect(await db.letterChunk.count({ where: { letterId: l1 } })).toBe(0);

    // текст письма изменился (например, распознан заново): куски пересчитываются
    await db.letter.update({ where: { id: l2 }, data: { rawText: 'Bürgeramt Beispielhausen\nBitte bringen Sie Ihren Reisepass mit.' } });
    const res = await ask(a.token, 'Reisepass').expect(200);
    expect(res.body.sources[0].quote).toBe('Bitte bringen Sie Ihren Reisepass mit.');

    await http().delete('/cabinet').set(auth(a.token)).send({ password: PASSWORD }).expect(204);
    expect(await db.letterChunk.count({ where: { cabinetId: a.cabinetId } })).toBe(0);
    expect(await db.llmCall.count({ where: { cabinetId: a.cabinetId } })).toBe(0);
  });

  it('без согласия на ИИ: 403; без входа: 401; пустой вопрос: 400; лимит общий с чатом', async () => {
    const n = await register('archive-noai@example.org', false);
    await ask(n.token, 'Frist').expect(403).expect((r) => expect(r.body.code).toBe('AI_CONSENT_REQUIRED'));
    await http().post('/archive/ask').send({ text: 'Frist' }).expect(401);

    const a = await register('archive-limit@example.org');
    await ask(a.token, '   ').expect(400);
    await upload(a.token, '04_buergeramt.pdf');
    for (let i = 0; i < 3; i++) await ask(a.token, `Mietvertrag ${i}`).expect(200);
    for (let i = 0; i < 3; i++) await http().post('/chat').set(auth(a.token)).send({ text: 'Frist?' }).expect(200);
    await ask(a.token, 'Mietvertrag').expect(429);
  });
});
