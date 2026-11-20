import type { INestApplication } from '@nestjs/common';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.factory.js';
import { AuthService } from '../src/auth/auth.service.js';
import { StorageService } from '../src/documents/storage.service.js';
import { AccountErasureService } from '../src/erasure/account-erasure.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PERSON } from './person.js';
import { createTestDatabase } from './test-db.js';

const fixture = (name: string) =>
  readFileSync(
    resolve(import.meta.dirname, '..', '..', 'fixtures', 'letters', name),
  );
const PASSWORD = 'mein-langes-Passwort';
type Claim = { id: string };

/*
 * A01: полное удаление аккаунта. Проверка связей по сохранённым ID, сбои на каждом этапе,
 * повтор очистки, два обработчика одновременно, загрузка во время удаления.
 */
describe('Удаление аккаунта (e2e, A01)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let storage: StorageService;
  let erasure: AccountErasureService;
  let cleanup: () => Promise<void>;
  let storageDir: string;
  let n = 0;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function register() {
    const email = `erase-${++n}@example.org`;
    const res = await http()
      .post('/auth/register')
      .send({ email, password: PASSWORD, consent: true, aiConsent: true, ...PERSON })
      .expect(201);
    const token = res.body.sessionToken as string;
    const { id } = await db.cabinet.findFirstOrThrow({ where: { email } });
    return { token, email, cabinetId: id };
  }

  /** Письмо с подтверждёнными фактами в деле и черновик: строки во всех таблицах. */
  async function fullAccount() {
    const u = await register();
    const up = await http()
      .post('/letters')
      .set(auth(u.token))
      .attach('files', fixture('01_jobcenter_request.pdf'), 'a.pdf')
      .expect(201);
    const letterId = up.body.letter.id as string;
    await http()
      .post(`/letters/${letterId}/claims/confirm`)
      .set(auth(u.token))
      .send({ confirm: (up.body.claims as Claim[]).map((c) => c.id) })
      .expect(200);
    const { caseId } = (
      await http()
        .post(`/letters/${letterId}/assign`)
        .set(auth(u.token))
        .send({ newCase: {} })
        .expect(200)
    ).body;
    await http()
      .post(`/cases/${caseId}/draft`)
      .set(auth(u.token))
      .send({
        kind: 'CLARIFICATION',
        letterId,
        questionId: 'WHICH_DOCUMENTS',
      })
      .expect(201);
    await db.passwordResetToken.create({
      data: {
        cabinetId: u.cabinetId,
        tokenHash: `hash-${u.cabinetId}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    // журнал только с letterId или только с caseId тоже принадлежит кабинету
    const base = {
      promptName: 'x',
      promptVersion: 1,
      provider: 'demo',
      model: 'demo',
      input: 'x',
      ok: true,
      attempts: 1,
      durationMs: 1,
    };
    await db.llmCall.createMany({
      data: [
        { ...base, letterId },
        { ...base, caseId },
      ],
    });
    return { ...u, letterId, caseId };
  }

  /** Все ID строк кабинета (собираются до удаления). */
  async function idsOf(cabinetId: string, letterId: string, caseId: string) {
    const pick = <T extends { id: string }>(rows: T[]) => rows.map((r) => r.id);
    return {
      sessions: pick(await db.session.findMany({ where: { cabinetId } })),
      resetTokens: pick(
        await db.passwordResetToken.findMany({ where: { cabinetId } }),
      ),
      cases: pick(await db.case.findMany({ where: { cabinetId } })),
      letters: pick(await db.letter.findMany({ where: { cabinetId } })),
      claims: pick(await db.claim.findMany({ where: { letterId } })),
      deadlines: pick(await db.deadline.findMany({ where: { letterId } })),
      events: pick(await db.event.findMany({ where: { caseId } })),
      drafts: pick(await db.draft.findMany({ where: { caseId } })),
      llmCalls: pick(
        await db.llmCall.findMany({
          where: { OR: [{ cabinetId }, { letterId }, { caseId }] },
        }),
      ),
    };
  }

  async function countIds(ids: Awaited<ReturnType<typeof idsOf>>) {
    const q = (list: string[]) => ({ where: { id: { in: list } } });
    return {
      sessions: await db.session.count(q(ids.sessions)),
      resetTokens: await db.passwordResetToken.count(q(ids.resetTokens)),
      cases: await db.case.count(q(ids.cases)),
      letters: await db.letter.count(q(ids.letters)),
      claims: await db.claim.count(q(ids.claims)),
      deadlines: await db.deadline.count(q(ids.deadlines)),
      events: await db.event.count(q(ids.events)),
      drafts: await db.draft.count(q(ids.drafts)),
      llmCalls: await db.llmCall.count(q(ids.llmCalls)),
    };
  }

  const zero = {
    sessions: 0,
    resetTokens: 0,
    cases: 0,
    letters: 0,
    claims: 0,
    deadlines: 0,
    events: 0,
    drafts: 0,
    llmCalls: 0,
  };
  const lengths = (ids: Record<string, string[]>) =>
    Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, v.length]));

  const lettersDir = (cabinetId: string) =>
    join(storageDir, 'letters', cabinetId);
  const trashEntries = () =>
    existsSync(join(storageDir, 'trash'))
      ? readdirSync(join(storageDir, 'trash'))
      : [];
  const del = (token: string, password = PASSWORD) =>
    http().delete('/cabinet').set(auth(token)).send({ password });

  beforeAll(async () => {
    const test = createTestDatabase();
    cleanup = test.cleanup;
    storageDir = mkdtempSync(join(tmpdir(), 'jasno-erase-'));
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
    storage = app.get(StorageService, { strict: false });
    erasure = app.get(AccountErasureService, { strict: false });
  }, 60000);

  afterAll(async () => {
    await app.close();
    await cleanup();
    rmSync(storageDir, { recursive: true, force: true });
  });

  afterEach(() => vi.restoreAllMocks());

  it('204: удалены все строки по ID, журнал, файлы; другой кабинет цел; старая сессия и вход не работают', async () => {
    const a = await fullAccount();
    const b = await fullAccount();
    const ids = await idsOf(a.cabinetId, a.letterId, a.caseId);
    for (const [k, v] of Object.entries(lengths(ids)))
      expect(v, k).toBeGreaterThan(0);
    const bIds = await idsOf(b.cabinetId, b.letterId, b.caseId);
    expect(existsSync(lettersDir(a.cabinetId))).toBe(true);

    await del(a.token).expect(204);

    expect(await db.cabinet.count({ where: { id: a.cabinetId } })).toBe(0);
    expect(await countIds(ids)).toEqual(zero);
    expect(existsSync(lettersDir(a.cabinetId))).toBe(false);
    expect(trashEntries()).toEqual([]);
    expect(await db.accountErasure.count()).toBe(0);
    // другой кабинет не тронут
    expect(await countIds(bIds)).toEqual(lengths(bIds));
    expect(existsSync(lettersDir(b.cabinetId))).toBe(true);

    expect(
      (await http().get('/cabinet').set(auth(a.token)).expect(401)).body.code,
    ).toBe('UNAUTHORIZED');
    await http()
      .post('/auth/login')
      .send({ email: a.email, password: PASSWORD })
      .expect(401);
    // повтор с той же сессией: сессии нет
    await del(a.token).expect(401);
  });

  it('неверный пароль: 401 INVALID_CREDENTIALS, сессия жива; после 4 ошибок 429; без пароля 400', async () => {
    const u = await register();
    const res = await del(u.token, 'falsches-Passwort').expect(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
    await http().get('/cabinet').set(auth(u.token)).expect(200);
    for (let i = 0; i < 3; i++) await del(u.token, 'falsches-Passwort');
    expect((await del(u.token).expect(429)).body.code).toBe('RATE_LIMITED');
    await http().delete('/cabinet').set(auth(u.token)).send({}).expect(400);
    expect(await db.cabinet.count({ where: { id: u.cabinetId } })).toBe(1);
  });

  it('сбой переноса файлов: 500, всё на месте, блокировка снята; повтор удаляет', async () => {
    const u = await fullAccount();
    const ids = await idsOf(u.cabinetId, u.letterId, u.caseId);
    vi.spyOn(storage.ops, 'rename').mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'EACCES' }),
    );
    expect((await del(u.token).expect(500)).body.code).toBe('ERASURE_FAILED');
    expect(await countIds(ids)).toEqual(lengths(ids));
    expect(readdirSync(lettersDir(u.cabinetId))).toHaveLength(1);
    expect(
      (await db.cabinet.findUniqueOrThrow({ where: { id: u.cabinetId } }))
        .deletingAt,
    ).toBeNull();
    expect(await db.accountErasure.count()).toBe(0);
    await http().get('/cabinet').set(auth(u.token)).expect(200);

    await del(u.token).expect(204);
    expect(await countIds(ids)).toEqual(zero);
  });

  it('откат транзакции базы: файлы возвращаются из корзины, строки на месте', async () => {
    const u = await fullAccount();
    const ids = await idsOf(u.cabinetId, u.letterId, u.caseId);
    const files = readdirSync(lettersDir(u.cabinetId));
    vi.spyOn(
      AccountErasureService.prototype as unknown as {
        deleteRows: () => Promise<void>;
      },
      'deleteRows',
    ).mockRejectedValueOnce(new Error('db down'));

    expect((await del(u.token).expect(500)).body.code).toBe('ERASURE_FAILED');
    expect(await countIds(ids)).toEqual(lengths(ids));
    expect(readdirSync(lettersDir(u.cabinetId))).toEqual(files);
    expect(trashEntries()).toEqual([]);
    expect(await db.accountErasure.count()).toBe(0);
    await http().get('/cabinet').set(auth(u.token)).expect(200);
    await del(u.token).expect(204);
  });

  it('транзакция удаления падает внутри (FK): статус не меняется, файлы возвращаются', async () => {
    const u = await fullAccount();
    const ids = await idsOf(u.cabinetId, u.letterId, u.caseId);
    // падение уже внутри транзакции после смены статуса: откатывается и статус
    const original = db.$transaction.bind(db);
    let calls = 0;
    vi.spyOn(db, '$transaction').mockImplementation(((fn: unknown) =>
      original(async (tx: unknown) => {
        const result = await (fn as (t: unknown) => Promise<unknown>)(tx);
        // вторая транзакция задания = этап C (первая — этап A)
        if (++calls === 2) throw new Error('commit failed');
        return result;
      })) as never);
    expect((await del(u.token).expect(500)).body.code).toBe('ERASURE_FAILED');
    vi.restoreAllMocks();
    expect(await countIds(ids)).toEqual(lengths(ids));
    expect(readdirSync(lettersDir(u.cabinetId))).toHaveLength(1);
    expect(await db.accountErasure.count()).toBe(0);
  });

  it('не удалось вернуть файлы: задание и блокировка остаются (409 ACCOUNT_DELETING), фон возвращает', async () => {
    const u = await fullAccount();
    const ids = await idsOf(u.cabinetId, u.letterId, u.caseId);
    vi.spyOn(
      AccountErasureService.prototype as unknown as {
        deleteRows: () => Promise<void>;
      },
      'deleteRows',
    ).mockRejectedValueOnce(new Error('db down'));
    vi.spyOn(storage, 'restoreCabinetFromTrash').mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'EIO' }),
    );

    expect((await del(u.token).expect(500)).body.code).toBe('ERASURE_FAILED');
    const job = await db.accountErasure.findUniqueOrThrow({
      where: { cabinetId: u.cabinetId },
    });
    expect(job.status).toBe('RESTORING');
    expect(job.lastError).toBe('restore: EIO');
    expect(job.leaseOwner).toBeNull();
    expect(existsSync(lettersDir(u.cabinetId))).toBe(false);
    expect(trashEntries()).toEqual([job.id]);
    // записи заблокированы
    expect(
      (await http().get('/cabinet').set(auth(u.token)).expect(409)).body.code,
    ).toBe('ACCOUNT_DELETING');
    expect(
      (
        await http()
          .post('/letters')
          .set(auth(u.token))
          .attach('files', fixture('01_jobcenter_request.pdf'), 'a.pdf')
          .expect(409)
      ).body.code,
    ).toBe('ACCOUNT_DELETING');

    expect(await erasure.recoverAll()).toEqual(['RESTORED']);
    expect(await db.accountErasure.count()).toBe(0);
    expect(readdirSync(lettersDir(u.cabinetId))).toHaveLength(1);
    expect(trashEntries()).toEqual([]);
    expect(await countIds(ids)).toEqual(lengths(ids));
    await http().get('/cabinet').set(auth(u.token)).expect(200);
  });

  it('сбой окончательной очистки: 202 DELETION_PENDING, база удалена; повтор в фоне доочищает', async () => {
    const u = await fullAccount();
    const ids = await idsOf(u.cabinetId, u.letterId, u.caseId);
    let mailCalls = 0;
    erasure.registerCleaner({
      name: 'mail-test',
      clean: async (id) => {
        if (id !== u.cabinetId) return;
        if (++mailCalls === 1)
          throw Object.assign(new Error('x'), { code: 'EBUSY' });
      },
    });
    const res = await del(u.token).expect(202);
    expect(res.body).toEqual({
      code: 'DELETION_PENDING',
      message: 'Удаление аккаунта продолжается. Повторять запрос не нужно',
    });
    expect(await countIds(ids)).toEqual(zero);
    const job = await db.accountErasure.findUniqueOrThrow({
      where: { cabinetId: u.cabinetId },
    });
    expect(job.status).toBe('DB_DELETED');
    // ошибка без путей и персональных данных
    expect(job.lastError).toBe('cleanup: mail-test/EBUSY');
    expect(job.lastError).not.toContain(u.email);
    await http().get('/cabinet').set(auth(u.token)).expect(401);

    expect(await erasure.recoverAll()).toEqual(['DONE']);
    expect(mailCalls).toBe(2);
    expect(await db.accountErasure.count()).toBe(0);
    expect(trashEntries()).toEqual([]);
    expect(existsSync(lettersDir(u.cabinetId))).toBe(false);
  });

  it('сбой процесса между переносом и записью статуса: повтор находит файлы в корзине и доводит до конца', async () => {
    const u = await fullAccount();
    const ids = await idsOf(u.cabinetId, u.letterId, u.caseId);
    // этап A и перенос выполнены, статус остался PREPARING, аренда умершего процесса истекла
    await db.cabinet.update({
      where: { id: u.cabinetId },
      data: { deletingAt: new Date() },
    });
    const job = await db.accountErasure.create({
      data: {
        cabinetId: u.cabinetId,
        leaseOwner: 'dead-process',
        leaseUntil: new Date(Date.now() - 1000),
      },
    });
    await storage.moveCabinetToTrash(u.cabinetId, job.id);
    expect(existsSync(lettersDir(u.cabinetId))).toBe(false);

    expect(await erasure.recoverAll()).toEqual(['DONE']);
    expect(await countIds(ids)).toEqual(zero);
    expect(await db.cabinet.count({ where: { id: u.cabinetId } })).toBe(0);
    expect(trashEntries()).toEqual([]);
    expect(await db.accountErasure.count()).toBe(0);
  });

  it('аренда занята живым обработчиком: фон не берёт задание', async () => {
    const u = await register();
    await db.cabinet.update({
      where: { id: u.cabinetId },
      data: { deletingAt: new Date() },
    });
    const job = await db.accountErasure.create({
      data: {
        cabinetId: u.cabinetId,
        leaseOwner: 'other',
        leaseUntil: new Date(Date.now() + 60_000),
      },
    });
    expect(await erasure.recoverAll()).toEqual([]);
    expect(await erasure.run(job.id)).toBe('BUSY');
    await db.accountErasure.update({
      where: { id: job.id },
      data: { leaseUntil: null, leaseOwner: null },
    });
    expect(await erasure.run(job.id)).toBe('DONE');
    expect(await db.cabinet.count({ where: { id: u.cabinetId } })).toBe(0);
  });

  it('два обработчика одновременно: выполняет один, второй получает BUSY; одно задание', async () => {
    const u = await fullAccount();
    await db.cabinet.update({
      where: { id: u.cabinetId },
      data: { deletingAt: new Date() },
    });
    const job = await db.accountErasure.create({
      data: { cabinetId: u.cabinetId },
    });
    const outcomes = await Promise.all([
      erasure.run(job.id),
      erasure.run(job.id),
    ]);
    expect(outcomes.sort()).toEqual(['BUSY', 'DONE']);
    expect(await db.cabinet.count({ where: { id: u.cabinetId } })).toBe(0);
    expect(trashEntries()).toEqual([]);
  });

  it('два DELETE одновременно: одно задание, ни одного 500, кабинет удалён', async () => {
    const u = await fullAccount();
    const results = await Promise.all([del(u.token), del(u.token)]);
    const statuses = results.map((r) => r.status);
    expect(statuses).toContain(204);
    for (const s of statuses) expect([204, 202, 401]).toContain(s);
    expect(await db.cabinet.count({ where: { id: u.cabinetId } })).toBe(0);
    expect(await db.accountErasure.count()).toBe(0);
    expect(trashEntries()).toEqual([]);
  });

  it('загрузка во время удаления: удаление ждёт записи файла, файл тоже удаляется; без сирот', async () => {
    const u = await register();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const inWrite = new Promise<void>((r) => (entered = r));
    const write = storage.write.bind(storage);
    vi.spyOn(storage, 'write').mockImplementationOnce(async (key, data) => {
      entered();
      await gate; // загрузка держит блокировку кабинета
      return write(key, data);
    });
    const upload = http()
      .post('/letters')
      .set(auth(u.token))
      .attach('files', fixture('01_jobcenter_request.pdf'), 'a.pdf')
      .then((r) => r);
    await inWrite;
    let deleted = false;
    const deletion = del(u.token).then((r) => {
      deleted = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 600));
    expect(deleted).toBe(false); // ждёт транзакцию загрузки
    release();
    expect((await upload).status).toBe(201);
    expect((await deletion).status).toBe(204);
    expect(await db.letter.count({ where: { cabinetId: u.cabinetId } })).toBe(
      0,
    );
    expect(existsSync(lettersDir(u.cabinetId))).toBe(false);
    expect(trashEntries()).toEqual([]);
  });

  it('загрузка после начала удаления: 409, файл не пишется', async () => {
    const u = await register();
    await db.cabinet.update({
      where: { id: u.cabinetId },
      data: { deletingAt: new Date() },
    });
    await db.accountErasure.create({
      data: {
        cabinetId: u.cabinetId,
        leaseOwner: 'other',
        leaseUntil: new Date(Date.now() + 60_000),
      },
    });
    const written = vi.spyOn(storage, 'write');
    // отметка появилась уже после проверки сессии: срабатывает проверка под блокировкой в самой загрузке
    const authenticate = AuthService.prototype.authenticate;
    vi.spyOn(AuthService.prototype, 'authenticate').mockImplementation(
      async function (this: AuthService, token: string) {
        const ctx = await authenticate.call(this, token);
        return ctx && { ...ctx, deleting: false };
      },
    );
    await http()
      .post('/letters')
      .set(auth(u.token))
      .attach('files', fixture('01_jobcenter_request.pdf'), 'a.pdf')
      .expect(409);
    expect(written).not.toHaveBeenCalled();
    expect(await db.llmCall.count({ where: { cabinetId: u.cabinetId } })).toBe(
      0,
    );
    expect(existsSync(lettersDir(u.cabinetId))).toBe(false);
    await db.accountErasure.deleteMany({ where: { cabinetId: u.cabinetId } });
  });
});
