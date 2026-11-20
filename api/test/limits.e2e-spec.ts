import type { INestApplication } from '@nestjs/common';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.factory.js';
import { APP_CONFIG } from '../src/config/config.module.js';
import { parseEnv, type Env } from '../src/config/env.schema.js';
import { DemoAdapter } from '../src/llm/adapters/demo.adapter.js';
import { LlmLimitsService } from '../src/llm/llm-limits.service.js';
import { LlmOperationHandle } from '../src/llm/llm-operation.js';
import { LLM_ADAPTER, type LlmAdapter } from '../src/llm/llm.types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PERSON } from './person.js';
import { createTestDatabase } from './test-db.js';

const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dirname, '..', '..', 'fixtures', 'letters', name));
const PASSWORD = 'mein-langes-Passwort';
const DAY_MS = 24 * 60 * 60 * 1000;
type Claim = { id: string };

/*
 * B18: лимит операций с моделью на кабинет (скользящие 24 часа, резерв до вызова модели),
 * мягкий общий порог токенов (учёт без пользовательских данных), лимиты по IP.
 */
describe('Лимиты (e2e, B18)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let config: Env;
  let dbUrl: string;
  let cleanup: () => Promise<void>;
  let storageDir: string;
  let n = 0;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function start(env: NodeJS.ProcessEnv = {}) {
    app = await createApp({
      env: {
        LLM_MODE: 'demo',
        NODE_ENV: 'test',
        DATABASE_URL: dbUrl,
        STORAGE_DIR: storageDir,
        LLM_DAILY_OPS_PER_CABINET: '2',
        LLM_DAILY_TOKEN_BUDGET: '0',
        RATE_LIMIT_IP: 'false',
        ...env,
      },
      logger: false,
    });
    await app.init();
    db = app.get(PrismaService);
    config = app.get<Env>(APP_CONFIG);
  }

  async function register(ip?: string) {
    const email = `limit-${++n}@example.org`;
    const req = http().post('/auth/register');
    if (ip) req.set('X-Forwarded-For', ip);
    const res = await req
      .send({ email, password: PASSWORD, consent: true, aiConsent: true, ...PERSON })
      .expect(201);
    const { id } = await db.cabinet.findFirstOrThrow({ where: { email } });
    return { token: res.body.sessionToken as string, email, cabinetId: id };
  }

  const upload = (token: string, file = '01_jobcenter_request.pdf', name = 'a.pdf') =>
    http().post('/letters').set(auth(token)).attach('files', fixture(file), name);

  /** Сколько раз вызвана модель (адаптер demo). */
  const modelCalls = () => vi.spyOn(DemoAdapter.prototype, 'complete');

  beforeAll(async () => {
    const test = createTestDatabase();
    dbUrl = test.url;
    cleanup = test.cleanup;
    storageDir = mkdtempSync(join(tmpdir(), 'jasno-limits-'));
    await start();
  });

  afterAll(async () => {
    await app.close();
    await cleanup();
    rmSync(storageDir, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    config.LLM_DAILY_TOKEN_BUDGET = 0;
    config.LLM_DAILY_OPS_PER_CABINET = 2;
  });

  it('лимит операций: третья загрузка — 429 с временем ожидания и Retry-After, модель не вызывается, ничего не пишется', async () => {
    const u = await register();
    await upload(u.token).expect(201);
    await upload(u.token).expect(201);
    const calls = modelCalls();
    const before = {
      llmCalls: await db.llmCall.count({ where: { cabinetId: u.cabinetId } }),
      letters: await db.letter.count({ where: { cabinetId: u.cabinetId } }),
    };
    const res = await upload(u.token).expect(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(res.body.details).toMatchObject({ reason: 'LLM_DAILY_OPS', limit: 2 });
    expect(res.body.message).toMatch(/не больше 2 писем и объяснений за 24 часа\. Следующее будет доступно через (2[34] ч|\d+ ч \d+ мин)/);
    expect(res.body.message).not.toMatch(/завтра/);
    const retry = Number(res.headers['retry-after']);
    expect(retry).toBeGreaterThan(DAY_MS / 1000 - 120);
    expect(retry).toBeLessThanOrEqual(DAY_MS / 1000);
    expect(calls).not.toHaveBeenCalled();
    expect(await db.llmCall.count({ where: { cabinetId: u.cabinetId } })).toBe(before.llmCalls);
    expect(await db.letter.count({ where: { cabinetId: u.cabinetId } })).toBe(before.letters);
    expect(await db.llmOperation.count({ where: { cabinetId: u.cabinetId } })).toBe(2);
  });

  it('неверный файл и недопустимое сочетание файлов лимит модели не тратят', async () => {
    const u = await register();
    await http().post('/letters').set(auth(u.token)).attach('files', Buffer.from('kein PDF'), 'a.txt').expect(415);
    // B11: PDF вместе с фото отклоняется до модели
    await http()
      .post('/letters')
      .set(auth(u.token))
      .attach('files', fixture('08_photo.jpg'), 'a.jpg')
      .attach('files', fixture('01_jobcenter_request.pdf'), 'b.pdf')
      .expect(400);
    expect(await db.llmOperation.count({ where: { cabinetId: u.cabinetId } })).toBe(0);
    await upload(u.token).expect(201);
    await upload(u.token).expect(201);
  });

  it('объяснение из кэша лимит не тратит; у другого кабинета свой счётчик', async () => {
    const u = await register();
    const up = await upload(u.token).expect(201);
    const letterId = up.body.letter.id as string;
    await http()
      .post(`/letters/${letterId}/claims/confirm`)
      .set(auth(u.token))
      .send({ confirm: (up.body.claims as Claim[]).map((c) => c.id) })
      .expect(200);
    await http().post(`/letters/${letterId}/explain`).set(auth(u.token)).expect(200);
    expect(await db.llmOperation.count({ where: { cabinetId: u.cabinetId } })).toBe(2);
    const calls = modelCalls();
    const cached = await http().post(`/letters/${letterId}/explain`).set(auth(u.token)).expect(200);
    expect(cached.body.cached).toBe(true);
    expect(calls).not.toHaveBeenCalled();
    await upload(u.token).expect(429);
    calls.mockRestore();

    const other = await register();
    await upload(other.token).expect(201);
  });

  it('фото: transcribe и extract — одна операция, один operationId, общий предел 3 обращений', async () => {
    config.LLM_DAILY_OPS_PER_CABINET = 1;
    const u = await register();
    const res = await upload(u.token, '08_photo.jpg', 'a.jpg').expect(201);
    const ops = await db.llmOperation.findMany({ where: { cabinetId: u.cabinetId } });
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('UPLOAD');
    const traced = await db.llmCall.findMany({ where: { letterId: res.body.letter.id } });
    expect(traced.map((c) => c.promptName).sort()).toEqual(['extract', 'transcribe']);
    expect(new Set(traced.map((c) => c.operationId))).toEqual(new Set([ops[0].id]));
    expect(traced.reduce((sum, c) => sum + c.attempts, 0)).toBeLessThanOrEqual(3);
  });

  it('граница 24 часов: место освобождается ровно через 24 часа после самой старой операции', async () => {
    const u = await register();
    await upload(u.token).expect(201);
    await upload(u.token).expect(201);
    const [oldest, newest] = await db.llmOperation.findMany({
      where: { cabinetId: u.cabinetId },
      orderBy: { createdAt: 'asc' },
    });
    const now = Date.now();
    await db.llmOperation.update({ where: { id: oldest.id }, data: { createdAt: new Date(now - DAY_MS + 90_000) } });
    await db.llmOperation.update({ where: { id: newest.id }, data: { createdAt: new Date(now - 60 * 60 * 1000) } });
    const res = await upload(u.token).expect(429);
    const retry = Number(res.headers['retry-after']);
    expect(retry).toBeGreaterThan(30);
    expect(retry).toBeLessThanOrEqual(90);
    expect(res.body.message).toMatch(/через [12] мин/);
    // старейшей операции больше 24 часов: она вне окна
    await db.llmOperation.update({ where: { id: oldest.id }, data: { createdAt: new Date(now - DAY_MS - 1000) } });
    await upload(u.token).expect(201);
  });

  it('параллельные операции из трёх «процессов» (отдельные подключения) не обходят лимит', async () => {
    const u = await register();
    const clients = Array.from({ length: 3 }, () => new PrismaService({ DATABASE_URL: dbUrl }));
    try {
      const services = clients.map((client) => {
        const original = client.$transaction.bind(client);
        vi.spyOn(client, '$transaction').mockImplementation(((fn: unknown) =>
          original(async (tx: unknown) => {
            await new Promise((done) => setTimeout(done, 150));
            return (fn as (t: unknown) => Promise<unknown>)(tx);
          })) as never);
        return new LlmLimitsService(client, config);
      });
      const results = await Promise.allSettled(
        [...services, ...services].map((s) => s.reserve(new LlmOperationHandle(u.cabinetId, 'UPLOAD'))),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(4);
    } finally {
      await Promise.all(clients.map((c) => c.$disconnect()));
    }
    expect(await db.llmOperation.count({ where: { cabinetId: u.cabinetId } })).toBe(2);
  });

  it('идёт удаление аккаунта: резерв не создаётся (409), модель не вызывается', async () => {
    const u = await register();
    await db.cabinet.update({ where: { id: u.cabinetId }, data: { deletingAt: new Date() } });
    const calls = modelCalls();
    const reserve = new LlmOperationHandle(u.cabinetId, 'UPLOAD');
    await expect(app.get(LlmLimitsService).reserve(reserve)).rejects.toMatchObject({ code: 'ACCOUNT_DELETING' });
    expect(calls).not.toHaveBeenCalled();
    expect(await db.llmOperation.count({ where: { cabinetId: u.cabinetId } })).toBe(0);
    await db.cabinet.update({ where: { id: u.cabinetId }, data: { deletingAt: null } });
  });

  describe('общий порог токенов (провайдер не demo)', () => {
    let adapter: LlmAdapter;
    beforeEach(() => {
      adapter = app.get<LlmAdapter>(LLM_ADAPTER);
      (adapter as { provider: string }).provider = 'paid-test';
    });
    afterEach(async () => {
      (adapter as { provider: string }).provider = 'demo';
      await db.llmUsageHour.deleteMany({ where: { provider: 'paid-test' } });
    });

    it('порог исчерпан: 503 LLM_QUOTA, модель не вызывается', async () => {
      const u = await register();
      await upload(u.token).expect(201);
      const spent = await app.get(LlmLimitsService).spentLast24h();
      expect(spent).toBeGreaterThan(0); // demo без usage: ответ оценён по длине, а не нулём
      config.LLM_DAILY_TOKEN_BUDGET = spent;
      const calls = modelCalls();
      const res = await upload(u.token).expect(503);
      expect(res.body).toMatchObject({ code: 'LLM_QUOTA', message: 'Ja!sno сейчас перегружен. Попробуйте позже' });
      expect(calls).not.toHaveBeenCalled();
    });

    it('порог проверяется и перед повтором: неверный ответ сверх порога — повтора нет', async () => {
      const u = await register();
      config.LLM_DAILY_TOKEN_BUDGET = 1000;
      const calls = vi
        .spyOn(DemoAdapter.prototype, 'complete')
        .mockResolvedValue({ text: 'kein JSON', tokensIn: 900, tokensOut: 200 });
      const res = await upload(u.token).expect(503);
      expect(res.body.code).toBe('LLM_QUOTA');
      expect(calls).toHaveBeenCalledTimes(1);
      // неудачная операция записана в журнал с одной попыткой, резерв остался
      const traced = await db.llmCall.findFirstOrThrow({ where: { cabinetId: u.cabinetId } });
      expect(traced).toMatchObject({ ok: false, attempts: 1 });
      expect(await db.llmOperation.count({ where: { cabinetId: u.cabinetId } })).toBe(1);
    });

    it('удаление письма и аккаунта не возвращает потраченное в бюджет; LlmOperation удаляется с аккаунтом', async () => {
      const u = await register();
      const up = await upload(u.token).expect(201);
      await upload(u.token).expect(201);
      const limits = app.get(LlmLimitsService);
      const spent = await limits.spentLast24h();
      expect(spent).toBeGreaterThan(0);
      await http().delete(`/letters/${up.body.letter.id}`).set(auth(u.token)).expect(204);
      expect(await limits.spentLast24h()).toBe(spent);
      await http().delete('/cabinet').set(auth(u.token)).send({ password: PASSWORD }).expect(204);
      expect(await db.llmCall.count({ where: { cabinetId: u.cabinetId } })).toBe(0);
      expect(await db.llmOperation.count({ where: { cabinetId: u.cabinetId } })).toBe(0);
      expect(await limits.spentLast24h()).toBe(spent);
    });
  });

  describe('лимиты по IP (RATE_LIMIT_IP=true, доверенный прокси)', () => {
    beforeAll(async () => {
      await app.close();
      await start({ RATE_LIMIT_IP: 'true', TRUST_PROXY: 'loopback', LLM_DAILY_OPS_PER_CABINET: '1000' });
    });

    it('регистрация: 5 в час с одного IP, 6-я 429; другой IP не заблокирован', async () => {
      for (let i = 0; i < 5; i++) await register('198.18.10.1');
      const res = await http()
        .post('/auth/register')
        .set('X-Forwarded-For', '198.18.10.1')
        .send({ email: 'zu-viel@example.org', password: PASSWORD, consent: true, aiConsent: true, ...PERSON })
        .expect(429);
      expect(res.body.code).toBe('RATE_LIMITED');
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      await register('198.18.10.2');
    });

    it('вход: 20 за 15 минут с одного IP, 21-й 429 даже с верным паролем', async () => {
      const u = await register('198.18.11.1');
      for (let i = 0; i < 20; i++)
        await http()
          .post('/auth/login')
          .set('X-Forwarded-For', '198.18.11.2')
          .send({ email: `niemand-${i}@example.org`, password: PASSWORD })
          .expect(401);
      await http()
        .post('/auth/login')
        .set('X-Forwarded-For', '198.18.11.2')
        .send({ email: u.email, password: PASSWORD })
        .expect(429);
      await http()
        .post('/auth/login')
        .set('X-Forwarded-For', '198.18.11.3')
        .send({ email: u.email, password: PASSWORD })
        .expect(200);
    });

    it('загрузка письма: 30 в час с одного IP, 31-я 429 до чтения файла', async () => {
      const u = await register('198.18.12.1');
      for (let i = 0; i < 30; i++)
        await http()
          .post('/letters')
          .set(auth(u.token))
          .set('X-Forwarded-For', '198.18.12.2')
          .attach('files', Buffer.from('kein PDF'), 'a.txt')
          .expect(415);
      await http()
        .post('/letters')
        .set(auth(u.token))
        .set('X-Forwarded-For', '198.18.12.2')
        .attach('files', fixture('01_jobcenter_request.pdf'), 'a.pdf')
        .expect(429);
    });
  });

  it('конфигурация: TRUST_PROXY только явные прокси; RATE_LIMIT_IP=false в production запрещён', () => {
    const base = { DATABASE_URL: 'postgresql://x@localhost/y' };
    for (const bad of ['true', '1', '2', 'irgendwas', '10.0.0.0/99'])
      expect(() => parseEnv({ ...base, TRUST_PROXY: bad })).toThrow(/TRUST_PROXY/);
    for (const good of ['loopback', 'loopback, 10.0.0.0/8', '192.168.1.10', 'uniquelocal,::1'])
      expect(parseEnv({ ...base, TRUST_PROXY: good }).TRUST_PROXY).toBe(good);
    expect(() =>
      parseEnv({ ...base, NODE_ENV: 'production', MAIL_MODE: 'smtp', SMTP_HOST: 'smtp.example.org', RATE_LIMIT_IP: 'false' }),
    ).toThrow(/RATE_LIMIT_IP/);
  });
});
