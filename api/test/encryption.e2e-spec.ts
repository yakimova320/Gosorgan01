import type { INestApplication } from '@nestjs/common';
import {
  CryptoIntegrityError,
  decryptBytes,
  decryptDeep,
  generateRecoverySecret,
  isEncryptedBytes,
  isEnvelope,
  parseRecoverySecret,
  unwrapDocumentKey,
  unwrapMasterKey,
} from '@jasno/shared';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.factory.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CryptoClient } from './crypto-client.js';
import { PERSON } from './person.js';
import { createTestDatabase } from './test-db.js';

const PASSWORD = 'mein-langes-Passwort';
const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dirname, '..', '..', 'fixtures', 'letters', name));

/** Слова из письма 01: их не должно быть ни в базе, ни в хранилище. */
const PLAIN = ['Kontoauszüge', 'Musterstadt', 'September'];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

/*
 * E01 (#163): приёмка шифрования писем.
 * 1. По дампу базы и хранилища (и с секретами сервера) архив не прочитать.
 * 2. Изменённый или подменённый шифротекст: ошибка целостности.
 * 3. На «новом устройстве» архив открывается секретом восстановления; без него — нет.
 * 4. Ключи документов уходят на сервер только в запросе-действии (428 KEYS_REQUIRED → повтор с ключом).
 */
describe('Шифрование писем (e2e, E01)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let cleanup: () => Promise<void>;
  let storageDir: string;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function register(email: string) {
    const res = await http()
      .post('/auth/register')
      .send({ email, password: PASSWORD, consent: true, aiConsent: true, ...PERSON })
      .expect(201);
    const token = res.body.sessionToken as string;
    const vault = await http().get('/crypto/vault').set(auth(token)).expect(200);
    expect(vault.body.wrappedMaster).toBeNull();
    const client = new CryptoClient(vault.body.cabinetId as string);
    return { token, client, cabinetId: client.cabinetId };
  }

  async function withVault(email: string) {
    const u = await register(email);
    await u.client.createVault((body) => http().post('/crypto/vault').set(auth(u.token)).send(body).expect(201));
    return u;
  }

  const keys = async (token: string) =>
    (await http().get('/crypto/keys').set(auth(token)).expect(200)).body.keys as {
      keyId: string;
      wrapped: string;
    }[];

  async function upload(u: Awaited<ReturnType<typeof withVault>>, name = '01_jobcenter_request.pdf') {
    const { req, keyId } = await u.client.withNewKey(
      http().post('/letters').set(auth(u.token)).attach('files', fixture(name), name),
    );
    const res = await req.expect(201);
    return { id: res.body.letter.id as string, keyId, body: res.body };
  }

  beforeAll(async () => {
    const test = createTestDatabase();
    cleanup = test.cleanup;
    storageDir = mkdtempSync(join(tmpdir(), 'jasno-crypto-'));
    app = await createApp({
      env: {
        LLM_MODE: 'demo',
        NODE_ENV: 'test',
        ENCRYPTION_REQUIRED: 'true',
        DATABASE_URL: test.url,
        STORAGE_DIR: storageDir,
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
  });

  it('без ключа архива письмо не принимается; ключ архива создаётся один раз', async () => {
    const u = await register('crypto-setup@example.org');
    await http()
      .post('/letters')
      .set(auth(u.token))
      .attach('files', fixture('01_jobcenter_request.pdf'), 'a.pdf')
      .expect(409)
      .expect((r) => expect(r.body.code).toBe('ENCRYPTION_SETUP_REQUIRED'));
    await u.client.createVault((body) => http().post('/crypto/vault').set(auth(u.token)).send(body).expect(201));
    await http()
      .post('/crypto/vault')
      .set(auth(u.token))
      .send({ wrappedMaster: (await db.keyVault.findUniqueOrThrow({ where: { cabinetId: u.cabinetId } })).wrappedMaster })
      .expect(409)
      .expect((r) => expect(r.body.code).toBe('VAULT_EXISTS'));
    await http().post('/crypto/vault').set(auth(u.token)).send({ wrappedMaster: 'nope' }).expect(400);
    // ключ письма не прислан: 428, ничего не сохранено
    await http()
      .post('/letters')
      .set(auth(u.token))
      .attach('files', fixture('01_jobcenter_request.pdf'), 'a.pdf')
      .expect(428)
      .expect((r) => expect(r.body.details).toMatchObject({ newKey: true }));
    expect(await db.letter.count({ where: { cabinetId: u.cabinetId } })).toBe(0);
  });

  it('по дампу базы и хранилища архив не прочитать; браузер открывает его своим ключом', async () => {
    const u = await withVault('crypto-dump@example.org');
    const letter = await upload(u);
    // поиск по архиву и дело: тоже шифротекст
    const caseKey = await u.client.withNewKey(
      (
        await u.client.withKeys(
          http().post(`/letters/${letter.id}/assign`).set(auth(u.token)).send({ newCase: {} }),
          await keys(u.token),
          [letter.keyId],
        )
      ).req,
    );
    await caseKey.req.expect(200);

    // дамп всех таблиц схемы
    const tables = await db.$queryRawUnsafe<{ t: string }[]>(
      `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = $1 AND table_name <> '_prisma_migrations'`,
      db.dbSchema,
    );
    let dump = '';
    for (const { t } of tables)
      dump += (
        await db.$queryRawUnsafe<{ j: string }[]>(`SELECT row_to_json(x)::text AS j FROM "${db.dbSchema}"."${t}" x`)
      )
        .map((r) => r.j)
        .join('\n');
    for (const w of PLAIN) expect(dump).not.toContain(w);
    expect(dump).toContain('jx1.t.'); // шифротекст на месте

    // хранилище: только JXB1, без текста письма
    const stored = files(join(storageDir, 'letters', u.cabinetId));
    expect(stored.length).toBe(1);
    const bytes = readFileSync(stored[0]!);
    expect(isEncryptedBytes(bytes)).toBe(true);
    expect(bytes.includes(Buffer.from('%PDF'))).toBe(false);

    // журнал модели: размер вместо текста
    const calls = await db.llmCall.findMany({ where: { letterId: letter.id } });
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.input).toMatch(/^\[письмо зашифровано|^embed:/);

    // браузер: GET отдаёт шифротекст, открывает его мастер-ключ из памяти
    const detail = await http().get(`/letters/${letter.id}`).set(auth(u.token)).expect(200);
    expect(isEnvelope(detail.body.letter.text)).toBe(true);
    expect(detail.body.letter.keyId).toBe(letter.keyId);
    const all = await keys(u.token);
    const raw = new Map<string, Uint8Array>();
    for (const k of all) raw.set(k.keyId, await unwrapDocumentKey(u.client.master, k.wrapped, u.cabinetId, k.keyId));
    const opened = await decryptDeep(detail.body, u.cabinetId, (id) => raw.get(id) ?? null);
    expect(opened.letter.text).toContain('Kontoauszüge');
    expect(opened.claims.find((c: { kind: string }) => c.kind === 'AUTHORITY').value).toBe('Jobcenter Musterstadt');
    // дата срока открыта (напоминания), её формулировка — нет
    const deadline = opened.claims.find((c: { kind: string }) => c.kind === 'DEADLINE');
    const rawDeadline = detail.body.claims.find((c: { kind: string }) => c.kind === 'DEADLINE');
    expect(rawDeadline.value).toBe(deadline.value);
    expect(isEnvelope(rawDeadline.text)).toBe(true);

    // оригинал: шифротекст, браузер расшифровывает
    const file = await http()
      .get(`/letters/${letter.id}/file?page=1`)
      .set(auth(u.token))
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const pdf = await decryptBytes(raw.get(letter.keyId)!, u.cabinetId, file.body as Buffer);
    expect(Buffer.from(pdf).subarray(0, 4).toString()).toBe('%PDF');

    // дело: название зашифровано ключом дела
    const kase = await db.case.findFirstOrThrow({ where: { cabinetId: u.cabinetId } });
    expect(kase.keyId).toBe(caseKey.keyId);
    expect(isEnvelope(kase.title)).toBe(true);
  });

  it('действие без ключа: 428 с нужным keyId; с ключом работает', async () => {
    const u = await withVault('crypto-keys@example.org');
    const letter = await upload(u);
    await http()
      .post(`/letters/${letter.id}/explain`)
      .set(auth(u.token))
      .send({})
      .expect(428)
      .expect((r) => expect(r.body).toMatchObject({ code: 'KEYS_REQUIRED', details: { keyIds: [letter.keyId] } }));
    const res = await (
      await u.client.withKeys(
        http().post(`/letters/${letter.id}/explain`).set(auth(u.token)).send({}),
        await keys(u.token),
        [letter.keyId],
      )
    ).req.expect(200);
    expect(res.body.about.text).toBeTruthy();
    const row = await db.letter.findUniqueOrThrow({ where: { id: letter.id } });
    expect(isEnvelope(row.explanation)).toBe(true);
    // вопрос к архиву: письмо найдено по резюме, текст открыт ключом из повтора
    await http()
      .post('/archive/ask')
      .set(auth(u.token))
      .send({ text: 'Welche Kontoauszüge soll ich einreichen?' })
      .expect(428);
    const ask = await (
      await u.client.withKeys(
        http().post('/archive/ask').set(auth(u.token)).send({ text: 'Welche Kontoauszüge soll ich einreichen?' }),
        await keys(u.token),
        [letter.keyId],
      )
    ).req.expect(200);
    expect(ask.body.sources[0]).toMatchObject({ letterId: letter.id });
    const summary = await db.letterSummary.findUniqueOrThrow({ where: { letterId: letter.id } });
    expect(isEnvelope(summary.summary)).toBe(true);
  });

  it('изменённый или подменённый шифротекст: ошибка целостности', async () => {
    const u = await withVault('crypto-tamper@example.org');
    const a = await upload(u);
    const b = await upload(u, '04_buergeramt.pdf');
    const all = await keys(u.token);
    const withAB = (req: request.Test) => u.client.withKeys(req, all, [a.keyId, b.keyId]);

    // один знак шифротекста изменён
    const row = await db.letter.findUniqueOrThrow({ where: { id: a.id } });
    const parts = row.rawText.split('.');
    parts[4] = (parts[4]![0] === 'A' ? 'B' : 'A') + parts[4]!.slice(1);
    await db.letter.update({ where: { id: a.id }, data: { rawText: parts.join('.') } });
    await (await withAB(http().post(`/letters/${a.id}/translate`).set(auth(u.token)).send({}))).req
      .expect(422)
      .expect((r) => expect(r.body.code).toBe('INTEGRITY_FAILED'));
    const raw = await unwrapDocumentKey(u.client.master, all.find((k) => k.keyId === a.keyId)!.wrapped, u.cabinetId, a.keyId);
    const detail = await http().get(`/letters/${a.id}`).set(auth(u.token)).expect(200);
    await expect(decryptDeep(detail.body, u.cabinetId, () => raw)).rejects.toBeInstanceOf(CryptoIntegrityError);

    // текст письма b подставлен в письмо a (оба ключа у браузера)
    const rowB = await db.letter.findUniqueOrThrow({ where: { id: b.id } });
    await db.letter.update({ where: { id: a.id }, data: { rawText: rowB.rawText } });
    await (await withAB(http().post(`/letters/${a.id}/translate`).set(auth(u.token)).send({}))).req
      .expect(422)
      .expect((r) => expect(r.body.code).toBe('INTEGRITY_FAILED'));
  });

  it('новое устройство: архив открывается секретом восстановления; сброс пароля ключ не меняет', async () => {
    const u = await withVault('crypto-recover@example.org');
    await upload(u);
    const before = await db.keyVault.findUniqueOrThrow({ where: { cabinetId: u.cabinetId } });

    // «новое устройство»: только вход и секрет, без мастер-ключа в памяти
    const login = await http()
      .post('/auth/login')
      .send({ email: 'crypto-recover@example.org', password: PASSWORD })
      .expect(200);
    const token = login.body.sessionToken as string;
    const vault = (await http().get('/crypto/vault').set(auth(token)).expect(200)).body;
    const master = await unwrapMasterKey(vault.wrappedMaster, (await parseRecoverySecret(u.client.secret))!, vault.cabinetId);
    expect(master).toEqual(u.client.master);
    // неверный секрет не открывает
    const other = await parseRecoverySecret(await generateRecoverySecret());
    await expect(unwrapMasterKey(vault.wrappedMaster, other!, vault.cabinetId)).rejects.toBeInstanceOf(CryptoIntegrityError);

    // смена пароля: запись ключа архива та же
    await http()
      .post('/auth/password/change')
      .set(auth(token))
      .send({ oldPassword: PASSWORD, newPassword: 'ein-neues-langes-Passwort' })
      .expect((r) => expect([200, 204]).toContain(r.status));
    const after = await db.keyVault.findUniqueOrThrow({ where: { cabinetId: u.cabinetId } });
    expect(after.wrappedMaster).toBe(before.wrappedMaster);
  });

  it('письмо до шифрования шифруется по запросу браузера; удаление аккаунта удаляет ключи', async () => {
    const u = await register('crypto-legacy@example.org');
    // письмо, загруженное до E01: открытый текст в базе
    const legacy = await db.letter.create({
      data: {
        cabinetId: u.cabinetId,
        sourceType: 'PDF_TEXT',
        rawText: 'Jobcenter Musterstadt\nBitte reichen Sie die Kontoauszüge für September ein.',
        title: 'Jobcenter: Kontoauszüge',
        pages: [{ n: 1, readable: true, chars: 60 }],
        files: [],
      },
    });
    await db.claim.create({
      data: { letterId: legacy.id, kind: 'AUTHORITY', value: 'Jobcenter Musterstadt', text: 'Ведомство: Jobcenter Musterstadt', quote: 'Jobcenter Musterstadt', basis: 'DOCUMENT' },
    });
    await u.client.createVault((body) => http().post('/crypto/vault').set(auth(u.token)).send(body).expect(201));
    expect((await http().get('/crypto/keys').set(auth(u.token)).expect(200)).body.legacy).toBe(1);
    const step = await u.client.withNewKey(http().post('/crypto/legacy').set(auth(u.token)));
    await step.req.expect(200).expect((r) => expect(r.body).toMatchObject({ done: { kind: 'letter', id: legacy.id }, remaining: 0 }));
    const row = await db.letter.findUniqueOrThrow({ where: { id: legacy.id }, include: { claims: true } });
    expect(row.keyId).toBe(step.keyId);
    expect(isEnvelope(row.rawText)).toBe(true);
    expect(isEnvelope(row.claims[0]!.value)).toBe(true);
    expect(isEnvelope(row.claims[0]!.quote)).toBe(true);

    await http().delete('/cabinet').set(auth(u.token)).send({ password: PASSWORD }).expect(204);
    expect(await db.keyVault.count({ where: { cabinetId: u.cabinetId } })).toBe(0);
    expect(await db.documentKey.count({ where: { cabinetId: u.cabinetId } })).toBe(0);
  });
});
