import { Logger, type INestApplication } from '@nestjs/common';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.factory.js';
import { PasswordResetService } from '../src/auth/password-reset.service.js';
import { StorageService } from '../src/documents/storage.service.js';
import { AccountErasureService } from '../src/erasure/account-erasure.service.js';
import { MailTransport } from '../src/mail/mail-transport.js';
import { ResetMailOutbox } from '../src/mail/reset-mail.outbox.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PERSON } from './person.js';
import { createTestDatabase } from './test-db.js';

const PASSWORD = 'mein-langes-Passwort';
const NEW_PASSWORD = 'ein-neues-Passwort-1';
const APP_URL = 'http://jasno.test';
const FORGOT_TEXT = 'Если такой адрес есть, мы отправили письмо';

/*
 * A03: восстановление пароля в режиме MAIL_MODE=file. Лимиты (атомарно, не сбрасываются сбросом),
 * задания отправки (повторы, перезапуск, отмена при удалении аккаунта), одна транзакция сброса.
 */
describe('Восстановление пароля (e2e, A03)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let outbox: ResetMailOutbox;
  let storage: StorageService;
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
        MAIL_MODE: 'file',
        APP_PUBLIC_URL: APP_URL,
        // за доверенным прокси: у каждого теста свой IP клиента, лимит по IP тестов не мешает
        TRUST_PROXY: 'loopback',
        // A03 проверяет лимит по IP: он должен остаться прежним после переноса настройки (B18)
        RATE_LIMIT_IP: 'true',
        ...env,
      },
      logger: false,
    });
    await app.init();
    db = app.get(PrismaService);
    outbox = app.get(ResetMailOutbox);
    storage = app.get(StorageService);
    app.get(PasswordResetService).minResponseMs = 0;
  }

  async function register() {
    const email = `reset-${++n}@example.org`;
    const res = await http()
      .post('/auth/register')
      .set('X-Forwarded-For', clientIp)
      .send({ email, password: PASSWORD, consent: true, aiConsent: true, ...PERSON })
      .expect(201);
    const { id } = await db.cabinet.findFirstOrThrow({ where: { email } });
    return { token: res.body.sessionToken as string, email, cabinetId: id };
  }

  let clientIp = '';
  const forgot = (email: string, ip = clientIp) =>
    http().post('/auth/password/forgot').set('X-Forwarded-For', ip).send({ email });
  const reset = (token: string, newPassword = NEW_PASSWORD) =>
    http().post('/auth/password/reset').send({ token, newPassword });
  const login = (email: string, password: string) =>
    http().post('/auth/login').send({ email, password });

  const mailDir = (cabinetId: string) =>
    join(storageDir, 'mail-outbox', cabinetId);
  const mailFiles = (cabinetId: string) =>
    existsSync(mailDir(cabinetId)) ? readdirSync(mailDir(cabinetId)) : [];

  /** Токены из файлов писем кабинета (quoted-printable: мягкие переносы и =3D). */
  async function links(cabinetId: string): Promise<string[]> {
    await outbox.idle();
    return mailFiles(cabinetId).map((f) => {
      const eml = readFileSync(join(mailDir(cabinetId), f), 'utf8')
        .replace(/=\r?\n/g, '')
        .replace(/=3D/g, '=');
      const m = /\/reset\?token=([A-Za-z0-9_-]+)/.exec(eml);
      if (!m) throw new Error('в письме нет ссылки:\n' + eml);
      return m[1];
    });
  }

  async function oneLink(cabinetId: string): Promise<string> {
    const all = await links(cabinetId);
    expect(all).toHaveLength(1);
    return all[0];
  }

  /** Не отправлять сразу: задание остаётся PENDING (имитация «ещё не успели»). */
  const holdSending = () => vi.spyOn(outbox, 'kick').mockImplementation(() => undefined);

  beforeAll(async () => {
    const test = createTestDatabase();
    dbUrl = test.url;
    cleanup = test.cleanup;
    storageDir = mkdtempSync(join(tmpdir(), 'jasno-reset-'));
    await start();
  });

  afterAll(async () => {
    await app.close();
    await cleanup();
    rmSync(storageDir, { recursive: true, force: true });
  });

  let ipSeq = 0;
  beforeEach(() => {
    clientIp = `198.18.0.${++ipSeq}`;
  });
  afterEach(() => vi.restoreAllMocks());

  it('forgot → письмо файлом (права 0600) → reset → вход новым паролем; все сессии завершены; повтор ссылки 400; токена нет в логах', async () => {
    const logged: string[] = [];
    for (const level of ['log', 'warn', 'error'] as const)
      vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
    const u = await register();
    const second = (await login(u.email, PASSWORD).expect(200)).body
      .sessionToken as string;

    const res = await forgot(u.email).expect(202);
    expect(res.body).toEqual({ message: FORGOT_TEXT });
    const token = await oneLink(u.cabinetId);
    const [file] = mailFiles(u.cabinetId);
    const eml = readFileSync(join(mailDir(u.cabinetId), file), 'utf8');
    expect(eml).toContain(`To: ${u.email}`);
    expect(eml).toMatch(/Subject: /);
    // Права доступа Unix (0600 и 0700) на Windows не действуют: там Node всегда показывает 0666/0777
    if (process.platform !== 'win32') {
      expect(statSync(join(mailDir(u.cabinetId), file)).mode & 0o777).toBe(0o600);
      expect(statSync(mailDir(u.cabinetId)).mode & 0o777).toBe(0o700);
    }
    // в базе только хэш
    expect(await db.passwordResetToken.count({ where: { tokenHash: token } })).toBe(0);

    await reset(token).expect(204);
    await login(u.email, NEW_PASSWORD).expect(200);
    expect((await login(u.email, PASSWORD).expect(401)).body.code).toBe('INVALID_CREDENTIALS');
    for (const t of [u.token, second])
      expect((await http().get('/cabinet').set(auth(t)).expect(401)).body.code).toBe('UNAUTHORIZED');
    expect((await reset(token, 'noch-ein-Passwort-2').expect(400)).body.code).toBe('RESET_TOKEN_INVALID');
    // старое письмо удалено, строка задания осталась (по ней считается лимит)
    expect(mailFiles(u.cabinetId)).toEqual([]);
    expect(await db.passwordResetMail.count({ where: { cabinetId: u.cabinetId } })).toBe(1);
    await login(u.email, NEW_PASSWORD).expect(200);

    const all = logged.join('\n');
    expect(all).not.toContain(token);
    expect(all).not.toContain(u.email);
  });

  it('неизвестный адрес: тот же ответ, ни строк, ни файлов; ответ не быстрее нижней границы', async () => {
    const service = app.get(PasswordResetService);
    service.minResponseMs = 300;
    try {
      const u = await register();
      const t1 = Date.now();
      const known = await forgot(u.email).expect(202);
      const knownMs = Date.now() - t1;
      const t2 = Date.now();
      const unknown = await forgot('niemand-hier@example.org').expect(202);
      const unknownMs = Date.now() - t2;
      expect(unknown.body).toEqual(known.body);
      expect(knownMs).toBeGreaterThanOrEqual(295);
      expect(unknownMs).toBeGreaterThanOrEqual(295);
      expect(await db.passwordResetMail.count({ where: { cabinet: { email: 'niemand-hier@example.org' } } })).toBe(0);
    } finally {
      service.minResponseMs = 0;
    }
  });

  it('параллельные forgot не обходят лимит: 6 запросов из трёх «процессов» (отдельные подключения), писем 3', async () => {
    const u = await register();
    holdSending();
    // Три отдельных клиента базы, как у трёх процессов сервера. Каждая транзакция резерва сначала ждёт:
    // без атомарной проверки под блокировкой все насчитали бы 0 писем.
    const clients = Array.from({ length: 3 }, () => new PrismaService({ DATABASE_URL: dbUrl }));
    try {
      const services = clients.map((client) => {
        const original = client.$transaction.bind(client);
        vi.spyOn(client, '$transaction').mockImplementation(((fn: unknown) =>
          original(async (tx: unknown) => {
            await new Promise((done) => setTimeout(done, 150));
            return (fn as (t: unknown) => Promise<unknown>)(tx);
          })) as never);
        const service = new PasswordResetService(client, outbox);
        service.minResponseMs = 0;
        return service;
      });
      await Promise.all(
        [...services, ...services].map((service) => service.forgot(u.email)),
      );
    } finally {
      await Promise.all(clients.map((c) => c.$disconnect()));
    }
    vi.restoreAllMocks();
    expect(await db.passwordResetMail.count({ where: { cabinetId: u.cabinetId } })).toBe(3);
    outbox.kick();
    expect(await links(u.cabinetId)).toHaveLength(3);
    // и через HTTP: сверх лимита ответ тот же 202, письма нет
    expect((await forgot(u.email).expect(202)).body).toEqual({ message: FORGOT_TEXT });
    expect(await db.passwordResetMail.count({ where: { cabinetId: u.cabinetId } })).toBe(3);
  });

  it('сброс пароля не обнуляет лимит писем в час', async () => {
    const u = await register();
    for (let i = 0; i < 3; i++) await forgot(u.email).expect(202);
    const [token] = await links(u.cabinetId);
    await reset(token).expect(204);
    await forgot(u.email).expect(202);
    await outbox.idle();
    expect(await db.passwordResetMail.count({ where: { cabinetId: u.cabinetId } })).toBe(3);
    expect(mailFiles(u.cabinetId)).toEqual([]);
    expect(await db.passwordResetToken.count({ where: { cabinetId: u.cabinetId } })).toBe(0);
  });

  it('просроченная ссылка: 400 RESET_TOKEN_INVALID, пароль прежний', async () => {
    const u = await register();
    await forgot(u.email).expect(202);
    const token = await oneLink(u.cabinetId);
    await db.passwordResetToken.updateMany({
      where: { cabinetId: u.cabinetId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await reset(token).expect(400)).body.code).toBe('RESET_TOKEN_INVALID');
    expect((await reset('ausgedacht').expect(400)).body.code).toBe('RESET_TOKEN_INVALID');
    await login(u.email, PASSWORD).expect(200);
  });

  it('ошибка транзакции сброса: ничего не меняется, ссылка остаётся действительной', async () => {
    const u = await register();
    await forgot(u.email).expect(202);
    const token = await oneLink(u.cabinetId);
    const original = db.$transaction.bind(db);
    vi.spyOn(db, '$transaction').mockImplementationOnce(((fn: unknown) =>
      original(async (tx: unknown) => {
        await (fn as (t: unknown) => Promise<unknown>)(tx);
        throw new Error('commit failed');
      })) as never);
    await reset(token).expect(500);
    vi.restoreAllMocks();
    await login(u.email, PASSWORD).expect(200);
    await http().get('/cabinet').set(auth(u.token)).expect(200);
    expect(mailFiles(u.cabinetId)).toHaveLength(1);
    await reset(token).expect(204);
    await login(u.email, NEW_PASSWORD).expect(200);
  });

  it('одна ссылка дважды одновременно: срабатывает только один сброс', async () => {
    const u = await register();
    await forgot(u.email).expect(202);
    const token = await oneLink(u.cabinetId);
    const [a, b] = await Promise.all([
      reset(token, 'erstes-neues-Passwort'),
      reset(token, 'zweites-neues-Passwort'),
    ]);
    expect([a.status, b.status].sort()).toEqual([204, 400]);
    const won = a.status === 204 ? 'erstes-neues-Passwort' : 'zweites-neues-Passwort';
    const lost = a.status === 204 ? 'zweites-neues-Passwort' : 'erstes-neues-Passwort';
    await login(u.email, won).expect(200);
    await login(u.email, lost).expect(401);
  });

  it('смена пароля в профиле (A02): старые письма удалены, ожидающие отменены, ссылки не действуют', async () => {
    const u = await register();
    await forgot(u.email).expect(202);
    const token = await oneLink(u.cabinetId);
    const hold = holdSending();
    await forgot(u.email).expect(202);
    hold.mockRestore();
    await http()
      .post('/auth/password/change')
      .set(auth(u.token))
      .send({ oldPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(204);
    expect(mailFiles(u.cabinetId)).toEqual([]);
    const jobs = await db.passwordResetMail.findMany({
      where: { cabinetId: u.cabinetId },
      orderBy: { createdAt: 'asc' },
    });
    expect(jobs.map((j) => j.status)).toEqual(['SENT', 'CANCELLED']);
    await outbox.runDue();
    expect(mailFiles(u.cabinetId)).toEqual([]);
    expect((await reset(token).expect(400)).body.code).toBe('RESET_TOKEN_INVALID');
  });

  it('удаление аккаунта отменяет ожидающее задание и удаляет письма; новых файлов не появляется', async () => {
    const u = await register();
    await forgot(u.email).expect(202);
    await oneLink(u.cabinetId);
    holdSending();
    await forgot(u.email).expect(202);
    expect(await db.passwordResetMail.count({ where: { cabinetId: u.cabinetId, status: 'PENDING' } })).toBe(1);
    await http().delete('/cabinet').set(auth(u.token)).send({ password: PASSWORD }).expect(204);
    expect(await db.passwordResetMail.count({ where: { cabinetId: u.cabinetId } })).toBe(0);
    await outbox.runDue();
    expect(existsSync(mailDir(u.cabinetId))).toBe(false);
  });

  it('удаление идёт (deletingAt): задание отменяется под блокировкой, forgot не создаёт задание, reset не проходит', async () => {
    const u = await register();
    await forgot(u.email).expect(202);
    const token = await oneLink(u.cabinetId);
    holdSending();
    await forgot(u.email).expect(202);
    await db.cabinet.update({ where: { id: u.cabinetId }, data: { deletingAt: new Date() } });
    await outbox.runDue();
    const statuses = (await db.passwordResetMail.findMany({ where: { cabinetId: u.cabinetId }, orderBy: { createdAt: 'asc' } })).map((j) => j.status);
    expect(statuses).toEqual(['SENT', 'CANCELLED']);
    expect(mailFiles(u.cabinetId)).toHaveLength(1);
    await forgot(u.email).expect(202);
    expect(await db.passwordResetMail.count({ where: { cabinetId: u.cabinetId } })).toBe(2);
    expect((await reset(token).expect(400)).body.code).toBe('RESET_TOKEN_INVALID');
    await db.cabinet.update({ where: { id: u.cabinetId }, data: { deletingAt: null } });
  });

  it('ошибка очистки писем при удалении аккаунта: 202, задание удаления остаётся, повтор дочищает', async () => {
    const u = await register();
    await forgot(u.email).expect(202);
    await oneLink(u.cabinetId);
    const original = storage.removeMailDir.bind(storage);
    const spy = vi
      .spyOn(storage, 'removeMailDir')
      .mockRejectedValueOnce(Object.assign(new Error(`EBUSY ${u.email}`), { code: 'EBUSY' }));
    const res = await http().delete('/cabinet').set(auth(u.token)).send({ password: PASSWORD }).expect(202);
    expect(res.body.code).toBe('DELETION_PENDING');
    const job = await db.accountErasure.findFirstOrThrow({ where: { cabinetId: u.cabinetId } });
    expect(job.lastError).toContain('reset-mail');
    expect(job.lastError).not.toContain(u.email);
    expect(existsSync(mailDir(u.cabinetId))).toBe(true);
    spy.mockImplementation(original);
    await app.get(AccountErasureService).recoverAll();
    expect(existsSync(mailDir(u.cabinetId))).toBe(false);
    expect(await db.accountErasure.count({ where: { cabinetId: u.cabinetId } })).toBe(0);
  });

  it('SMTP: сбой → повтор с паузой, в lastError и логе только код; после трёх сбоев FAILED и ссылка удалена', async () => {
    const transport = app.get(MailTransport);
    vi.spyOn(transport, 'mode', 'get').mockReturnValue('smtp');
    const logged: string[] = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    const u = await register();
    const providerError = () =>
      Object.assign(new Error(`535 Authentication failed for ${u.email}`), {
        code: 'EAUTH',
        responseCode: 535,
      });
    const send = vi.spyOn(transport, 'sendSmtp').mockRejectedValue(providerError());
    holdSending();
    await forgot(u.email).expect(202);
    const job = await db.passwordResetMail.findFirstOrThrow({ where: { cabinetId: u.cabinetId } });

    let now = Date.now();
    outbox.now = () => new Date(now);
    try {
      expect(await outbox.process(job.id)).toBe('RETRY');
      let row = await db.passwordResetMail.findUniqueOrThrow({ where: { id: job.id } });
      expect(row).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'EAUTH/535', leaseOwner: null });
      expect(row.nextAttemptAt.getTime()).toBeGreaterThan(now);
      // пауза ещё не прошла: не берётся
      expect(await outbox.process(job.id)).toBe('BUSY');
      now += 61_000;
      expect(await outbox.process(job.id)).toBe('RETRY');
      now += 5 * 60_000 + 1000;
      expect(await outbox.process(job.id)).toBe('FAILED');
      row = await db.passwordResetMail.findUniqueOrThrow({ where: { id: job.id } });
      expect(row).toMatchObject({ status: 'FAILED', attempts: 3 });
      expect(await db.passwordResetToken.count({ where: { cabinetId: u.cabinetId } })).toBe(0);
      expect(send).toHaveBeenCalledTimes(3);
      expect(logged.join('\n')).toContain('EAUTH/535');
      expect(logged.join('\n')).not.toContain(u.email);
      expect(logged.join('\n')).not.toContain('Authentication failed');
    } finally {
      outbox.now = () => new Date();
    }
  });

  it('SMTP: успешная отправка идёт без блокировки кабинета; в базе только хэш новой ссылки', async () => {
    const transport = app.get(MailTransport);
    vi.spyOn(transport, 'mode', 'get').mockReturnValue('smtp');
    const u = await register();
    let locked: boolean | null = null;
    vi.spyOn(transport, 'sendSmtp').mockImplementation(async () => {
      // во время отправки другой запрос может взять блокировку кабинета сразу
      locked = await Promise.race([
        db.$transaction((tx) =>
          tx.cabinet.updateMany({ where: { id: u.cabinetId }, data: { lastSeenAt: new Date() } }),
        ).then(() => false),
        new Promise<boolean>((done) => setTimeout(() => done(true), 2000)),
      ]);
    });
    await forgot(u.email).expect(202);
    await outbox.idle();
    expect(locked).toBe(false);
    const row = await db.passwordResetMail.findFirstOrThrow({ where: { cabinetId: u.cabinetId } });
    expect(row.status).toBe('SENT');
    expect(await db.passwordResetToken.count({ where: { cabinetId: u.cabinetId } })).toBe(1);
    expect(mailFiles(u.cabinetId)).toEqual([]);
  });

  it('лимит по IP за доверенным прокси: 10 запросов в час, 11-й 429; другой клиент не заблокирован', async () => {
    for (let i = 0; i < 10; i++) await forgot(`ip-${i}@example.org`).expect(202);
    const res = await forgot('ip-x@example.org').expect(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    await forgot('ip-y@example.org', '198.18.1.1').expect(202);
  });

  it('перезапуск сервера: ожидающее задание отправляется при старте', async () => {
    const u = await register();
    holdSending();
    await forgot(u.email).expect(202);
    expect(await db.passwordResetMail.count({ where: { cabinetId: u.cabinetId, status: 'PENDING' } })).toBe(1);
    expect(mailFiles(u.cabinetId)).toEqual([]);
    vi.restoreAllMocks();
    await app.close();
    await start();
    const token = await oneLink(u.cabinetId);
    expect((await db.passwordResetMail.findFirstOrThrow({ where: { cabinetId: u.cabinetId } })).status).toBe('SENT');
    await reset(token).expect(204);
  });

  it('без доверенного прокси X-Forwarded-For не учитывается: подмена заголовка не обходит лимит', async () => {
    await app.close();
    await start({ TRUST_PROXY: '' });
    for (let i = 0; i < 10; i++)
      await forgot(`p-${i}@example.org`, `203.0.113.${i}`).expect(202);
    await forgot('p-x@example.org', '203.0.113.99').expect(429);
  });
});
