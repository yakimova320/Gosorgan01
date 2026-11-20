import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app.factory.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PERSON } from './person.js';
import { createTestDatabase } from './test-db.js';

const PASSWORD = 'mein-langes-Passwort';
const NEW_PASSWORD = 'ein-neues-Passwort-1';

/*
 * A02: смена пароля. Текущая сессия остаётся, остальные сессии и ссылки восстановления
 * аннулируются; повторная проверка состояния под блокировкой; гонки со входом и второй сменой.
 */
describe('Смена пароля (e2e, A02)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let cleanup: () => Promise<void>;
  let n = 0;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function register() {
    const email = `pw-${++n}@example.org`;
    const res = await http()
      .post('/auth/register')
      .send({ email, password: PASSWORD, consent: true, aiConsent: true, ...PERSON })
      .expect(201);
    const { id } = await db.cabinet.findFirstOrThrow({ where: { email } });
    return { token: res.body.sessionToken as string, email, cabinetId: id };
  }

  const login = (email: string, password: string) =>
    http().post('/auth/login').send({ email, password });

  const change = (token: string, oldPassword: string, newPassword: string) =>
    http()
      .post('/auth/password/change')
      .set(auth(token))
      .send({ oldPassword, newPassword });

  const resetToken = (cabinetId: string, tag: string) =>
    db.passwordResetToken.create({
      data: {
        cabinetId,
        tokenHash: `hash-${tag}-${++n}`,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });

  /** Выполнить hook перед следующей транзакцией (имитация параллельного запроса). */
  function beforeNextTransaction(hook: () => Promise<unknown>) {
    const original = db.$transaction.bind(db);
    vi.spyOn(db, '$transaction').mockImplementationOnce(((fn: unknown) =>
      hook().then(() => original(fn as never))) as never);
  }

  beforeAll(async () => {
    const test = createTestDatabase();
    cleanup = test.cleanup;
    app = await createApp({
      env: { LLM_MODE: 'demo', NODE_ENV: 'test', DATABASE_URL: test.url },
      logger: false,
    });
    await app.init();
    db = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
    await cleanup();
  });

  afterEach(() => vi.restoreAllMocks());

  it('204: текущая сессия жива, вторая получает 401; старый пароль не подходит, новый подходит; ссылки восстановления аннулированы', async () => {
    const u = await register();
    const second = (await login(u.email, PASSWORD).expect(200)).body
      .sessionToken as string;
    const other = await register();
    await resetToken(u.cabinetId, 'own');
    const foreign = await resetToken(other.cabinetId, 'foreign');
    const before = await db.session.findFirstOrThrow({
      where: { cabinetId: u.cabinetId },
      orderBy: { createdAt: 'asc' },
    });

    await change(u.token, PASSWORD, NEW_PASSWORD).expect(204);

    await http().get('/cabinet').set(auth(u.token)).expect(200);
    const res = await http().get('/cabinet').set(auth(second)).expect(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect((await login(u.email, PASSWORD).expect(401)).body.code).toBe(
      'INVALID_CREDENTIALS',
    );
    await login(u.email, NEW_PASSWORD).expect(200);

    // текущая сессия: момент пароля = passwordChangedAt; createdAt и expiresAt не тронуты
    const cabinet = await db.cabinet.findUniqueOrThrow({
      where: { id: u.cabinetId },
    });
    const after = await db.session.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(after.passwordAt).toEqual(cabinet.passwordChangedAt);
    expect(after.createdAt).toEqual(before.createdAt);
    expect(after.expiresAt).toEqual(before.expiresAt);

    expect(
      await db.passwordResetToken.count({ where: { cabinetId: u.cabinetId } }),
    ).toBe(0);
    // чужой кабинет не тронут
    expect(
      await db.passwordResetToken.count({ where: { id: foreign.id } }),
    ).toBe(1);
    await http().get('/cabinet').set(auth(other.token)).expect(200);
  });

  it('неверный текущий пароль: 401 INVALID_CREDENTIALS у поля oldPassword, сессия жива, пароль прежний; после 4 ошибок 429', async () => {
    const u = await register();
    const res = await change(u.token, 'falsches-Passwort', NEW_PASSWORD).expect(
      401,
    );
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
    expect(res.body.details.fields).toEqual({ oldPassword: 'Неверный пароль' });
    await http().get('/cabinet').set(auth(u.token)).expect(200);
    await login(u.email, PASSWORD).expect(200);

    for (let i = 0; i < 3; i++)
      await change(u.token, 'falsches-Passwort', NEW_PASSWORD).expect(401);
    expect(
      (await change(u.token, PASSWORD, NEW_PASSWORD).expect(429)).body.code,
    ).toBe('RATE_LIMITED');
    await http().get('/cabinet').set(auth(u.token)).expect(200);
    await login(u.email, PASSWORD).expect(200);
  });

  it('проверка входа: короткий новый пароль 400, больше 72 байт 400 PASSWORD_TOO_LONG, без сессии 401', async () => {
    const u = await register();
    const short = (await change(u.token, PASSWORD, 'kurz').expect(400)).body;
    expect(short.code).toBe('VALIDATION_FAILED');
    expect(short.details.fields).toHaveProperty('newPassword');
    expect(
      (await change(u.token, PASSWORD, 'ж'.repeat(37)).expect(400)).body.code,
    ).toBe('PASSWORD_TOO_LONG');
    await http()
      .post('/auth/password/change')
      .send({ oldPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(401);
    await login(u.email, PASSWORD).expect(200);
  });

  it('две одновременные смены из одной сессии: применяется только одна', async () => {
    const u = await register();
    const [a, b] = await Promise.all([
      change(u.token, PASSWORD, 'erstes-neues-Passwort'),
      change(u.token, PASSWORD, 'zweites-neues-Passwort'),
    ]);
    expect([a.status, b.status].sort()).toEqual([204, 401]);
    const loser = a.status === 401 ? a : b;
    expect(loser.body.code).toBe('INVALID_CREDENTIALS');
    const won = a.status === 204 ? 'erstes-neues-Passwort' : 'zweites-neues-Passwort';
    const lost = a.status === 204 ? 'zweites-neues-Passwort' : 'erstes-neues-Passwort';
    await login(u.email, won).expect(200);
    await login(u.email, lost).expect(401);
    await http().get('/cabinet').set(auth(u.token)).expect(200);
  });

  it('две одновременные смены из разных сессий: применяется только одна, проигравшая сессия завершена', async () => {
    const u = await register();
    const second = (await login(u.email, PASSWORD).expect(200)).body
      .sessionToken as string;
    const [a, b] = await Promise.all([
      change(u.token, PASSWORD, 'erstes-neues-Passwort'),
      change(second, PASSWORD, 'zweites-neues-Passwort'),
    ]);
    expect([a.status, b.status].sort()).toEqual([204, 401]);
    const [winner, loserToken, won, lost] =
      a.status === 204
        ? [u.token, second, 'erstes-neues-Passwort', 'zweites-neues-Passwort']
        : [second, u.token, 'zweites-neues-Passwort', 'erstes-neues-Passwort'];
    await login(u.email, won).expect(200);
    await login(u.email, lost).expect(401);
    await http().get('/cabinet').set(auth(winner)).expect(200);
    await http().get('/cabinet').set(auth(loserToken)).expect(401);
  });

  it('под блокировкой: пароль уже сменён другим запросом → 401 INVALID_CREDENTIALS, ничего не меняется', async () => {
    const u = await register();
    const other = (await login(u.email, PASSWORD).expect(200)).body
      .sessionToken as string;
    const foreignHash = (
      await db.cabinet.findFirstOrThrow({ where: { id: { not: u.cabinetId } } })
    ).passwordHash;
    beforeNextTransaction(() =>
      db.cabinet.update({
        where: { id: u.cabinetId },
        data: { passwordHash: foreignHash },
      }),
    );
    const res = await change(u.token, PASSWORD, NEW_PASSWORD).expect(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
    const cabinet = await db.cabinet.findUniqueOrThrow({
      where: { id: u.cabinetId },
    });
    expect(cabinet.passwordHash).toBe(foreignHash);
    expect(cabinet.passwordChangedAt).toBeNull();
    // другая сессия не завершена
    await http().get('/cabinet').set(auth(other)).expect(200);
  });

  it('под блокировкой: текущая сессия отозвана → 401 UNAUTHORIZED, сессия не создаётся заново, пароль прежний', async () => {
    const u = await register();
    const session = await db.session.findFirstOrThrow({
      where: { cabinetId: u.cabinetId },
    });
    beforeNextTransaction(() =>
      db.session.delete({ where: { id: session.id } }),
    );
    const res = await change(u.token, PASSWORD, NEW_PASSWORD).expect(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(await db.session.count({ where: { cabinetId: u.cabinetId } })).toBe(
      0,
    );
    await login(u.email, PASSWORD).expect(200);
  });

  it('под блокировкой: сессия подтверждена старым паролем (смена после проверки) → 401 UNAUTHORIZED', async () => {
    const u = await register();
    beforeNextTransaction(() =>
      db.cabinet.update({
        where: { id: u.cabinetId },
        data: { passwordChangedAt: new Date(Date.now() + 1000) },
      }),
    );
    expect((await change(u.token, PASSWORD, NEW_PASSWORD).expect(401)).body.code).toBe(
      'UNAUTHORIZED',
    );
    await login(u.email, PASSWORD).expect(200);
  });

  it('под блокировкой: начато удаление аккаунта → 409 ACCOUNT_DELETING, пароль прежний', async () => {
    const u = await register();
    beforeNextTransaction(() =>
      db.cabinet.update({
        where: { id: u.cabinetId },
        data: { deletingAt: new Date() },
      }),
    );
    expect((await change(u.token, PASSWORD, NEW_PASSWORD).expect(409)).body.code).toBe(
      'ACCOUNT_DELETING',
    );
    const cabinet = await db.cabinet.findUniqueOrThrow({
      where: { id: u.cabinetId },
    });
    expect(cabinet.passwordChangedAt).toBeNull();
    await db.cabinet.update({
      where: { id: u.cabinetId },
      data: { deletingAt: null },
    });
    await login(u.email, PASSWORD).expect(200);
  });

  it('вход: пароль сменили между проверкой и созданием сессии → 401, сессия не создаётся', async () => {
    const u = await register();
    const sessions = await db.session.count({ where: { cabinetId: u.cabinetId } });
    beforeNextTransaction(() => change(u.token, PASSWORD, NEW_PASSWORD).expect(204));
    expect((await login(u.email, PASSWORD).expect(401)).body.code).toBe(
      'INVALID_CREDENTIALS',
    );
    expect(await db.session.count({ where: { cabinetId: u.cabinetId } })).toBe(
      sessions,
    );
  });

  it('вход: начато удаление аккаунта → 409 ACCOUNT_DELETING, сессия не создаётся', async () => {
    const u = await register();
    beforeNextTransaction(() =>
      db.cabinet.update({
        where: { id: u.cabinetId },
        data: { deletingAt: new Date() },
      }),
    );
    expect((await login(u.email, PASSWORD).expect(409)).body.code).toBe(
      'ACCOUNT_DELETING',
    );
    expect(await db.session.count({ where: { cabinetId: u.cabinetId } })).toBe(1);
  });
});
