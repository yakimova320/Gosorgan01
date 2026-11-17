import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app.factory.js';
import { hashToken } from '../src/auth/session-token.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestDatabase } from './test-db.js';

const PASSWORD = 'mein-langes-Passwort';

describe('Регистрация, вход, кабинет (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let cleanup: () => Promise<void>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const test = createTestDatabase();
    cleanup = test.cleanup;
    app = await createApp({
      env: { LLM_MODE: 'demo', NODE_ENV: 'test', DATABASE_URL: test.url },
      logger: false,
    });
    await app.init();
    db = app.get(PrismaService);
  }, 60000);

  afterAll(async () => {
    await app.close();
    await cleanup();
  });

  async function register(email: string): Promise<string> {
    const res = await http()
      .post('/auth/register')
      .send({ email, password: PASSWORD, consent: true })
      .expect(201);
    return res.body.sessionToken as string;
  }

  it('регистрация → кабинет → выход → вход тем же паролем', async () => {
    const token = await register('Anna@Example.org');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const cab = await http()
      .get('/cabinet')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(cab.body).toEqual({
      email: 'anna@example.org',
      language: 'ru',
      profile: null,
      counts: { openTasks: 0, activeCases: 0, inboxLetters: 0 },
      nextDeadline: null,
    });

    await http()
      .post('/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    await http()
      .get('/cabinet')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);

    const login = await http()
      .post('/auth/login')
      .send({ email: 'ANNA@example.org', password: PASSWORD })
      .expect(200);
    await http()
      .get('/cabinet')
      .set('Authorization', `Bearer ${login.body.sessionToken}`)
      .expect(200);
  });

  it('в базе только хэши пароля и токена', async () => {
    const token = await register('hash@example.org');
    const cabinet = await db.cabinet.findUniqueOrThrow({
      where: { email: 'hash@example.org' },
    });
    expect(cabinet.passwordHash).not.toContain(PASSWORD);
    expect(cabinet.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    const sessions = await db.session.findMany({
      where: { cabinetId: cabinet.id },
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].tokenHash).toBe(hashToken(token));
  });

  it('ошибки регистрации', async () => {
    await register('taken@example.org');
    const taken = await http()
      .post('/auth/register')
      .send({ email: 'TAKEN@example.org', password: PASSWORD, consent: true })
      .expect(409);
    expect(taken.body.code).toBe('EMAIL_TAKEN');

    const noConsent = await http()
      .post('/auth/register')
      .send({ email: 'new@example.org', password: PASSWORD })
      .expect(400);
    expect(noConsent.body.code).toBe('CONSENT_REQUIRED');

    const tooLong = await http()
      .post('/auth/register')
      .send({
        email: 'new@example.org',
        password: 'я'.repeat(40),
        consent: true,
      })
      .expect(400);
    expect(tooLong.body.code).toBe('PASSWORD_TOO_LONG');

    const short = await http()
      .post('/auth/register')
      .send({ email: 'new@example.org', password: 'short', consent: true })
      .expect(400);
    expect(short.body.code).toBe('VALIDATION_FAILED');

    expect(
      await db.cabinet.count({ where: { email: 'new@example.org' } }),
    ).toBe(0);
  });

  it('неверный пароль и неизвестный e-mail: одинаковый ответ 401', async () => {
    await register('same@example.org');
    const wrong = await http()
      .post('/auth/login')
      .send({ email: 'same@example.org', password: 'falsch-falsch' })
      .expect(401);
    const unknown = await http()
      .post('/auth/login')
      .send({ email: 'nobody@example.org', password: 'falsch-falsch' })
      .expect(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('пятая попытка входа за 15 минут: 429, даже с верным паролем', async () => {
    await register('limit@example.org');
    for (let i = 0; i < 4; i++) {
      await http()
        .post('/auth/login')
        .send({ email: 'limit@example.org', password: 'falsch-falsch' })
        .expect(401);
    }
    const blocked = await http()
      .post('/auth/login')
      .send({ email: 'limit@example.org', password: PASSWORD })
      .expect(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
  });

  it('без токена, с чужим и с истёкшим токеном: 401', async () => {
    await http().get('/cabinet').expect(401);
    const bad = await http()
      .get('/cabinet')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
    expect(bad.body.code).toBe('UNAUTHORIZED');

    const token = await register('expired@example.org');
    await db.session.updateMany({
      where: { tokenHash: hashToken(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await http()
      .get('/cabinet')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    expect(
      await db.session.count({ where: { tokenHash: hashToken(token) } }),
    ).toBe(0);
  });

  it('сессия, созданная до смены пароля, больше не работает', async () => {
    const token = await register('changed@example.org');
    await db.cabinet.update({
      where: { email: 'changed@example.org' },
      data: { passwordChangedAt: new Date(Date.now() + 1000) },
    });
    await http()
      .get('/cabinet')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('PATCH /cabinet меняет профиль и проверяет ввод', async () => {
    const token = await register('profile@example.org');
    const auth = { Authorization: `Bearer ${token}` };
    const profile = {
      firstName: 'Anna',
      lastName: 'Muster',
      numbers: [{ label: 'Kundennummer', value: '123A456' }],
    };
    const res = await http()
      .patch('/cabinet')
      .set(auth)
      .send({ profile })
      .expect(200);
    expect(res.body.profile).toEqual(profile);

    const bad = await http()
      .patch('/cabinet')
      .set(auth)
      .send({ email: 'other@example.org' })
      .expect(400);
    expect(bad.body.code).toBe('VALIDATION_FAILED');

    const cleared = await http()
      .patch('/cabinet')
      .set(auth)
      .send({ profile: null })
      .expect(200);
    expect(cleared.body.profile).toBeNull();
  });

  it('два кабинета не видят данных друг друга', async () => {
    const tokenA = await register('a@example.org');
    const tokenB = await register('b@example.org');
    const b = await db.cabinet.findUniqueOrThrow({
      where: { email: 'b@example.org' },
    });
    const kase = await db.case.create({
      data: { cabinetId: b.id, title: 'Дело B' },
    });
    await db.letter.create({
      data: {
        cabinetId: b.id,
        sourceType: 'PDF_TEXT',
        rawText: 'x',
        pages: [],
        files: [],
      },
    });
    const claim = await db.claim.create({
      data: {
        caseId: kase.id,
        kind: 'DEADLINE',
        value: '2099-01-01',
        text: 'срок',
        basis: 'DOCUMENT',
        status: 'CONFIRMED',
      },
    });
    const letter = await db.letter.create({
      data: {
        cabinetId: b.id,
        caseId: kase.id,
        sourceType: 'PDF_TEXT',
        rawText: 'y',
        pages: [],
        files: [],
      },
    });
    await db.deadline.create({
      data: {
        letterId: letter.id,
        caseId: kase.id,
        claimId: claim.id,
        date: new Date('2099-01-01T00:00:00Z'),
        kind: 'REPLY',
      },
    });

    await http()
      .patch('/cabinet')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ profile: { firstName: 'A' } })
      .expect(200);

    const a = await http()
      .get('/cabinet')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(a.body.email).toBe('a@example.org');
    expect(a.body.counts).toEqual({
      openTasks: 0,
      activeCases: 0,
      inboxLetters: 0,
    });
    expect(a.body.nextDeadline).toBeNull();

    const bView = await http()
      .get('/cabinet')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(bView.body.email).toBe('b@example.org');
    expect(bView.body.profile).toBeNull();
    expect(bView.body.counts).toEqual({
      openTasks: 1,
      activeCases: 1,
      inboxLetters: 1,
    });
    expect(bView.body.nextDeadline).toEqual({
      date: '2099-01-01',
      caseId: kase.id,
      title: 'Дело B',
    });
  });

  it('/health работает без входа', async () => {
    await http().get('/health').expect(200);
  });
});
