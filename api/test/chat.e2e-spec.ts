import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app.factory.js';
import { DEMO_CHAT_FALLBACK } from '../src/llm/adapters/demo.adapter.js';
import { CHAT_DISCLAIMER } from '../src/chat/chat.dto.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PERSON } from './person.js';
import { createTestDatabase } from './test-db.js';

describe('Чат-помощник (e2e, 24.11)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let cleanup: () => Promise<void>;
  const http = () => request(app.getHttpServer());

  async function register(email: string, aiConsent = true) {
    const res = await http()
      .post('/auth/register')
      .send({ email, password: 'mein-langes-Passwort', consent: true, aiConsent, ...PERSON })
      .expect(201);
    return { Authorization: `Bearer ${res.body.sessionToken as string}` };
  }

  beforeAll(async () => {
    const test = createTestDatabase();
    cleanup = test.cleanup;
    app = await createApp({
      env: {
        LLM_MODE: 'demo',
        NODE_ENV: 'test',
        DATABASE_URL: test.url,
        LLM_DAILY_CHAT_PER_CABINET: '3',
      },
      logger: false,
    });
    await app.init();
    db = app.get(PrismaService);
  }, 60000);

  afterAll(async () => {
    await app.close();
    await cleanup();
  });

  it('вопрос по FAQ: ответ из FAQ, пометка, история по порядку, журнал LlmCall', async () => {
    const auth = await register('chat@example.org');
    const empty = await http().get('/chat').set(auth).expect(200);
    expect(empty.body).toEqual({ disclaimer: CHAT_DISCLAIMER, messages: [] });

    const res = await http()
      .post('/chat')
      .set(auth)
      .send({ text: 'Можно ли войти через Google или Apple?' })
      .expect(200);
    expect(res.body.disclaimer).toBe(CHAT_DISCLAIMER);
    expect(res.body.question).toMatchObject({ role: 'USER', text: 'Можно ли войти через Google или Apple?' });
    expect(res.body.answer.role).toBe('ASSISTANT');
    expect(res.body.answer.text).toContain('Можно войти через Google или Apple?');

    await http().post('/chat').set(auth).send({ text: 'Какая погода на Марсе?' }).expect(200)
      .expect((r) => expect(r.body.answer.text).toBe(DEMO_CHAT_FALLBACK));

    const hist = await http().get('/chat').set(auth).expect(200);
    expect(hist.body.messages.map((m: { role: string }) => m.role)).toEqual([
      'USER',
      'ASSISTANT',
      'USER',
      'ASSISTANT',
    ]);
    const calls = await db.llmCall.findMany({ where: { promptName: 'chat' } });
    expect(calls).toHaveLength(2);
    expect(calls[0].promptVersion).toBe(2);
  });

  it('пустой или слишком длинный вопрос: 400; без входа: 401', async () => {
    const auth = await register('chat-400@example.org');
    await http().post('/chat').set(auth).send({ text: '   ' }).expect(400);
    await http().post('/chat').set(auth).send({ text: 'x'.repeat(1001) }).expect(400);
    await http().post('/chat').send({ text: 'Привет' }).expect(401);
  });

  it('без согласия на ИИ вопрос не уходит к модели', async () => {
    const auth = await register('chat-noai@example.org', false);
    const res = await http().post('/chat').set(auth).send({ text: 'Что такое Anmeldung?' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await http().get('/chat').set(auth)).body.messages).toEqual([]);
  });

  it('свой лимит чата: 4-й вопрос — 429 LLM_DAILY_CHAT; письма и объяснения его не тратят', async () => {
    const auth = await register('chat-limit@example.org');
    for (let i = 0; i < 3; i++)
      await http().post('/chat').set(auth).send({ text: `Вопрос ${i}` }).expect(200);
    const over = await http().post('/chat').set(auth).send({ text: 'Ещё вопрос' }).expect(429);
    expect(over.body.details.reason).toBe('LLM_DAILY_CHAT');
    const ops = await db.llmOperation.groupBy({ by: ['kind'], _count: true });
    expect(ops.find((o) => o.kind === 'CHAT')).toBeDefined();
  });

  it('«Очистить разговор» удаляет только свои сообщения; удаление кабинета удаляет чат', async () => {
    const a = await register('chat-a@example.org');
    const b = await register('chat-b@example.org');
    await http().post('/chat').set(a).send({ text: 'Что такое Jobcenter?' }).expect(200);
    await http().post('/chat').set(b).send({ text: 'Что такое Jobcenter?' }).expect(200);
    await http().delete('/chat').set(a).expect(204);
    expect((await http().get('/chat').set(a)).body.messages).toEqual([]);
    expect((await http().get('/chat').set(b)).body.messages).toHaveLength(2);

    const cab = await db.cabinet.findUniqueOrThrow({ where: { email: 'chat-b@example.org' } });
    await db.cabinet.delete({ where: { id: cab.id } });
    expect(await db.chatMessage.count({ where: { cabinetId: cab.id } })).toBe(0);
  });
});
