import type { INestApplication } from '@nestjs/common';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.factory.js';
import { StorageService } from '../src/documents/storage.service.js';
import { LettersService } from '../src/letters/letters.service.js';
import { DemoAdapter } from '../src/llm/adapters/demo.adapter.js';
import { AdapterError } from '../src/llm/llm.types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { encryptedPdf, mixedPdf, textPdf } from './pdf-fixtures.js';
import { PERSON } from './person.js';
import { createTestDatabase } from './test-db.js';

const fixture = (name: string) =>
  readFileSync(
    resolve(import.meta.dirname, '..', '..', 'fixtures', 'letters', name),
  );

/** Все файлы в папке хранения (рекурсивно). */
function storedFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => join(d.parentPath, d.name));
  } catch {
    return [];
  }
}

describe('Приём письма POST /letters (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let cleanup: () => Promise<void>;
  let storageDir: string;
  let token: string;
  let cabinetId: string;
  const http = () => request(app.getHttpServer());
  const upload = (data: Buffer, name: string, field = 'files') =>
    http()
      .post('/letters')
      .set('Authorization', `Bearer ${token}`)
      .attach(field, data, name);

  beforeAll(async () => {
    const test = createTestDatabase();
    cleanup = test.cleanup;
    storageDir = mkdtempSync(join(tmpdir(), 'jasno-storage-'));
    app = await createApp({
      env: {
        LLM_MODE: 'demo',
        NODE_ENV: 'test',
        DATABASE_URL: test.url,
        STORAGE_DIR: storageDir,
        UPLOAD_MAX_FILE_MB: '1',
      },
      logger: false,
    });
    await app.init();
    db = app.get(PrismaService);
    const res = await http()
      .post('/auth/register')
      .send({
        email: 'letters@example.org',
        password: 'mein-langes-Passwort',
        consent: true,
        aiConsent: true,
        ...PERSON,
      })
      .expect(201);
    token = res.body.sessionToken;
    cabinetId = (
      await db.cabinet.findFirstOrThrow({
        where: { email: 'letters@example.org' },
      })
    ).id;
  }, 60000);

  afterAll(async () => {
    await app.close();
    await cleanup();
    rmSync(storageDir, { recursive: true, force: true });
  });

  afterEach(() => vi.restoreAllMocks());

  /** Отказ без письма, без файла и (если модель не нужна) без обращения к модели. */
  async function expectRejected(
    req: request.Test,
    status: number,
    code: string,
    modelCalled = false,
  ) {
    const lettersBefore = await db.letter.count();
    const filesBefore = storedFiles(storageDir).length;
    const callsBefore = await db.llmCall.count();
    const spy = vi.spyOn(DemoAdapter.prototype, 'complete');
    const res = await req.expect(status);
    expect(res.body.code).toBe(code);
    expect(await db.letter.count()).toBe(lettersBefore);
    expect(storedFiles(storageDir)).toHaveLength(filesBefore);
    if (!modelCalled) {
      expect(spy).not.toHaveBeenCalled();
      expect(await db.llmCall.count()).toBe(callsBefore);
    }
    return res;
  }

  it('PDF с текстом: 201, письмо во входящих, оригинал на диске, ответ без ключей хранения', async () => {
    const res = await upload(
      fixture('01_jobcenter_request.pdf'),
      'brief.pdf',
    ).expect(201);
    const { letter } = res.body;
    expect(letter.caseId).toBeNull();
    expect(letter.sourceType).toBe('PDF_TEXT');
    expect(letter.text).toContain('Jobcenter');
    expect(letter.pages).toEqual([
      { n: 1, readable: true, chars: expect.any(Number) },
    ]);
    expect(letter.files).toEqual([
      { n: 1, mime: 'application/pdf', bytes: expect.any(Number) },
    ]);
    expect(res.body.claims.length).toBeGreaterThan(0);
    expect(res.body).toMatchObject({
      suggestions: [],
      extraction: { dropped: 0 },
    });
    expect(JSON.stringify(res.body)).not.toMatch(
      /fileKey|letters\/|brief\.pdf|jasno-storage/,
    );

    const row = await db.letter.findUniqueOrThrow({ where: { id: letter.id } });
    expect(row.cabinetId).toBe(cabinetId);
    const key = (row.files as { fileKey: string }[])[0].fileKey;
    expect(key).toMatch(
      new RegExp(`^letters/${cabinetId}/[0-9a-f]{32}\\.pdf$`),
    );
    expect(readFileSync(join(storageDir, key))).toEqual(
      fixture('01_jobcenter_request.pdf'),
    );
  });

  it('фото 08: текст через transcribe, LlmCall связан с письмом и кабинетом', async () => {
    const res = await upload(fixture('08_photo.jpg'), 'foto.jpg').expect(201);
    expect(res.body.letter.sourceType).toBe('IMAGE');
    expect(res.body.letter.text).toContain('Aktenzeichen');
    const calls = await db.llmCall.findMany({
      where: { letterId: res.body.letter.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(calls.map((c) => c.promptName)).toEqual(['transcribe', 'extract']);
    expect(calls[1]).toMatchObject({ cabinetId, ok: true });
    expect(calls[0]).toMatchObject({
      cabinetId,
      promptName: 'transcribe',
      ok: true,
    });
    expect(calls[0].input).toMatch(/image, \d+ KB/);
  });

  it('нечитаемое фото 11: 422 UNREADABLE с кодом причины, журнал остаётся', async () => {
    const res = await expectRejected(
      upload(fixture('11_bad_photo.jpg'), 'x.jpg'),
      422,
      'UNREADABLE',
      true,
    );
    expect(res.body.details).toEqual({ pages: [1], reason: 'BLURRY' });
    expect(res.body.message).toContain('Фото размыто');
    const call = await db.llmCall.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
    });
    expect(call).toMatchObject({ cabinetId, promptName: 'transcribe' });
    expect(call.letterId).toEqual(expect.any(String));
  });

  it('неизвестное фото в demo: честный отказ без придуманного текста', async () => {
    const png = Buffer.from(fixture('10_medium_scan.png'));
    png[png.length - 20] ^= 0xff; // другой хэш, структура цела
    const res = await expectRejected(
      upload(png, 'x.png'),
      422,
      'UNREADABLE',
      true,
    );
    expect(res.body.details.reason).toBe('DEMO_UNKNOWN');
    expect(res.body.message).toContain('демо-режиме');
  });

  it('ошибка модели: LLM_FAILED, письма и файла нет, LlmCall сохранён', async () => {
    vi.spyOn(DemoAdapter.prototype, 'complete').mockRejectedValue(
      new AdapterError('SERVER', 'demo: сбой'),
    );
    const before = await db.llmCall.count({ where: { cabinetId } });
    await expectRejected(
      upload(fixture('08_photo.jpg'), 'x.jpg'),
      502,
      'LLM_FAILED',
      true,
    );
    const calls = await db.llmCall.findMany({
      where: { cabinetId },
      orderBy: { createdAt: 'desc' },
    });
    expect(calls).toHaveLength(before + 1);
    expect(calls[0]).toMatchObject({
      ok: false,
      attempts: 2, // transcribe: не больше 2 из общих 3
      promptName: 'transcribe',
    });
    expect(await db.letter.count({ where: { id: calls[0].letterId! } })).toBe(
      0,
    );
  });

  it('квота модели: LLM_QUOTA, а не UNREADABLE', async () => {
    vi.spyOn(DemoAdapter.prototype, 'complete').mockRejectedValue(
      new AdapterError('QUOTA', 'demo: 429', 60_000),
    );
    await expectRejected(
      upload(fixture('08_photo.jpg'), 'x.jpg'),
      503,
      'LLM_QUOTA',
      true,
    );
  });

  /** Несколько файлов в одном запросе, по порядку страниц. */
  const uploadMany = (files: [Buffer, string][], t = token) => {
    let req = http().post('/letters').set('Authorization', `Bearer ${t}`);
    for (const [data, name] of files) req = req.attach('files', data, name);
    return req;
  };
  const getFile = (letterId: string, page?: number, t = token) =>
    http()
      .get(`/letters/${letterId}/file${page ? `?page=${page}` : ''}`)
      .set('Authorization', `Bearer ${t}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

  it('B11: 3 фото = одно письмо с 3 страницами по порядку; один transcribe.v2 + extract', async () => {
    const photos: [Buffer, string][] = [
      [fixture('08_photo.jpg'), 'a.jpg'],
      [fixture('09_scan.png'), 'b.png'],
      [fixture('10_medium_scan.png'), 'c.png'],
    ];
    const res = await uploadMany(photos).expect(201);
    const { letter } = res.body;
    expect(letter.sourceType).toBe('IMAGE');
    expect(letter.pages.map((p: { n: number }) => p.n)).toEqual([1, 2, 3]);
    expect(letter.files).toEqual([
      { n: 1, mime: 'image/jpeg', bytes: photos[0][0].length },
      { n: 2, mime: 'image/png', bytes: photos[1][0].length },
      { n: 3, mime: 'image/png', bytes: photos[2][0].length },
    ]);
    // порядок страниц в тексте: 08 → 09 → 10
    const text = letter.text as string;
    expect(text.indexOf('--- Seite 1 ---')).toBeLessThan(
      text.indexOf('SA-2026-8810'),
    );
    expect(text.indexOf('--- Seite 2 ---')).toBeLessThan(
      text.indexOf('SA-2026-8810'),
    );
    expect(text.indexOf('SA-2026-8810')).toBeLessThan(
      text.indexOf('--- Seite 3 ---'),
    );
    const calls = await db.llmCall.findMany({
      where: { letterId: letter.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(calls.map((c) => [c.promptName, c.promptVersion])).toEqual([
      ['transcribe', 2],
      ['extract', 3],
    ]);
    expect(calls[0].input.match(/image, \d+ KB/g)).toHaveLength(3);
    // факты со страницы 2 ссылаются на страницу 2
    const caseNumber = res.body.claims.find(
      (c: { kind: string; value: string }) =>
        c.kind === 'CASE_NUMBER' && c.value === 'SA-2026-8810',
    );
    if (caseNumber) expect(caseNumber.page).toBe(2);

    // оригиналы: каждая страница отдельно, байт в байт, только владельцу
    for (const [i, [data]] of photos.entries()) {
      const file = await getFile(letter.id, i + 1).expect(200);
      expect(file.headers['content-type']).toBe(
        i === 0 ? 'image/jpeg' : 'image/png',
      );
      expect(file.headers['cache-control']).toBe('private, no-store');
      expect(file.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.compare(file.body as Buffer, data)).toBe(0);
    }
    expect((await getFile(letter.id).expect(200)).body).toEqual(photos[0][0]);
    expect((await getFile(letter.id, 4).expect(404)).body).toBeDefined();
    await http()
      .get(`/letters/${letter.id}/file?page=abc`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    await http().get(`/letters/${letter.id}/file?page=1`).expect(401);
    const other = await http()
      .post('/auth/register')
      .send({
        email: 'fremd-file@example.org',
        password: 'mein-langes-Passwort',
        consent: true,
        aiConsent: true,
        ...PERSON,
      })
      .expect(201);
    const foreign = await http()
      .get(`/letters/${letter.id}/file?page=1`)
      .set('Authorization', `Bearer ${other.body.sessionToken}`)
      .expect(404);
    expect(foreign.headers['content-type']).toMatch(/json/);
  });

  it('B11: нечитаемая страница 2 из 2: 422 UNREADABLE с номером, письмо не сохраняется частично', async () => {
    const res = await expectRejected(
      uploadMany([
        [fixture('08_photo.jpg'), 'a.jpg'],
        [fixture('11_bad_photo.jpg'), 'b.jpg'],
      ]),
      422,
      'UNREADABLE',
      true,
    );
    expect(res.body.details).toEqual({ pages: [2], reason: 'BLURRY' });
    expect(res.body.message).toMatch(/^Страница 2 не читается\. Фото размыто/);
  });

  it('B11: скан PDF 09 распознаётся постранично: PDF_SCAN, факты, оригинал PDF', async () => {
    const pdf = fixture('09_scan.pdf');
    const res = await upload(pdf, 'scan.pdf').expect(201);
    expect(res.body.letter.sourceType).toBe('PDF_SCAN');
    expect(res.body.letter.text).toContain('SA-2026-8810');
    expect(res.body.letter.files).toEqual([
      { n: 1, mime: 'application/pdf', bytes: pdf.length },
    ]);
    expect(
      res.body.claims.some(
        (c: { kind: string; value: string }) =>
          c.kind === 'CASE_NUMBER' && c.value === 'SA-2026-8810',
      ),
    ).toBe(true);
    const calls = await db.llmCall.findMany({
      where: { letterId: res.body.letter.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(calls.map((c) => c.promptName)).toEqual(['transcribe', 'extract']);
    const file = await getFile(res.body.letter.id, 1).expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(Buffer.compare(file.body as Buffer, pdf)).toBe(0);
  });

  it('B11: смешанный PDF: распознаётся только страница-скан; в demo она незнакома — отказ называет страницу 2', async () => {
    const spy = vi.spyOn(DemoAdapter.prototype, 'complete');
    const res = await expectRejected(
      upload(await mixedPdf(fixture('09_scan.png')), 'mixed.pdf'),
      422,
      'UNREADABLE',
      true,
    );
    expect(res.body.details).toEqual({ pages: [2], reason: 'DEMO_UNKNOWN' });
    expect(res.body.message).toMatch(/^Страница 2 не читается\. /);
    // одно изображение (страница 2) одним обращением transcribe.v2; extract не вызывается
    expect(spy).toHaveBeenCalledTimes(1);
    const req = spy.mock.calls[0][0];
    expect([req.promptName, req.promptVersion, req.images.length]).toEqual([
      'transcribe',
      1,
      1,
    ]);
  });

  it('PDF на 21 страницу: 413 LETTER_TOO_LARGE', async () => {
    const res = await expectRejected(
      upload(await textPdf(21), 'long.pdf'),
      413,
      'LETTER_TOO_LARGE',
    );
    expect(res.body.details).toEqual({ pages: 21, maxPages: 20 });
  });

  it('повреждённый PDF, PDF с паролем, обрезанное фото, пустой файл: понятные отказы', async () => {
    await expectRejected(
      upload(Buffer.from('%PDF-1.4\n kaputt'), 'a.pdf'),
      422,
      'FILE_DAMAGED',
    );
    await expectRejected(upload(encryptedPdf(), 'b.pdf'), 422, 'PDF_ENCRYPTED');
    const jpg = fixture('08_photo.jpg');
    await expectRejected(
      upload(jpg.subarray(0, jpg.length / 2), 'c.jpg'),
      422,
      'FILE_DAMAGED',
    );
    await expectRejected(upload(Buffer.alloc(0), 'd.pdf'), 422, 'FILE_DAMAGED');
  });

  it('текст под видом PDF: 415 UNSUPPORTED_TYPE', async () => {
    await expectRejected(
      upload(fixture('01_jobcenter_request.txt'), 'fake.pdf'),
      415,
      'UNSUPPORTED_TYPE',
    );
  });

  it('файл больше предела: 413 FILE_TOO_LARGE при приёме', async () => {
    const big = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.alloc(1024 * 1024 + 10, 0x20),
    ]);
    const res = await expectRejected(
      upload(big, 'big.pdf'),
      413,
      'FILE_TOO_LARGE',
    );
    expect(res.body.details).toEqual({ maxMb: 1 });
  });

  it('два PDF или PDF с фото: 400 MIXED_FILES; 11 фото: TOO_MANY_FILES; нет поля files: NO_FILE; не multipart: NO_FILE', async () => {
    await expectRejected(
      uploadMany([
        [fixture('01_jobcenter_request.pdf'), 'a.pdf'],
        [fixture('04_buergeramt.pdf'), 'b.pdf'],
      ]),
      400,
      'MIXED_FILES',
    );
    await expectRejected(
      uploadMany([
        [fixture('08_photo.jpg'), 'a.jpg'],
        [fixture('01_jobcenter_request.pdf'), 'b.pdf'],
      ]),
      400,
      'MIXED_FILES',
    );
    const many = Array.from(
      { length: 11 },
      (_, i) => [fixture('11_bad_photo.jpg'), `p${i}.jpg`] as [Buffer, string],
    );
    const tooMany = await expectRejected(
      uploadMany(many),
      400,
      'TOO_MANY_FILES',
    );
    expect(tooMany.body.details).toEqual({ max: 10 });
    // повреждённый второй файл: номер файла в ответе, модель не вызывается
    const jpg = fixture('08_photo.jpg');
    const damaged = await expectRejected(
      uploadMany([
        [jpg, 'a.jpg'],
        [jpg.subarray(0, jpg.length / 2), 'b.jpg'],
      ]),
      422,
      'FILE_DAMAGED',
    );
    expect(damaged.body.details).toMatchObject({ file: 2 });
    expect(damaged.body.message).toMatch(/^Файл 2: /);
    await expectRejected(
      upload(fixture('01_jobcenter_request.pdf'), 'a.pdf', 'file'),
      400,
      'NO_FILE',
    );
    await expectRejected(
      http()
        .post('/letters')
        .set('Authorization', `Bearer ${token}`)
        .send({ files: 'x' }),
      400,
      'NO_FILE',
    );
  });

  it('без входа: 401, файл не читается', async () => {
    await expectRejected(
      http()
        .post('/letters')
        .attach('files', fixture('01_jobcenter_request.pdf'), 'a.pdf'),
      401,
      'UNAUTHORIZED',
    );
  });

  it('ошибка базы после записи файла: файл удаляется, письма нет', async () => {
    // транзакция письма падает уже после записи файла (журнал LlmCall тоже пишется транзакцией)
    let written = false;
    const storage = app.get(StorageService);
    const write = storage.write.bind(storage);
    vi.spyOn(storage, 'write').mockImplementation(async (k, d) => {
      await write(k, d);
      written = true;
    });
    const original = db.$transaction.bind(db) as (
      fn: (tx: unknown) => Promise<unknown>,
    ) => Promise<unknown>;
    vi.spyOn(db, '$transaction').mockImplementation(((fn: unknown) =>
      original(async (tx) => {
        const result = await (fn as (t: unknown) => Promise<unknown>)(tx);
        if (written) throw new Error('db down');
        return result;
      })) as never);
    await expectRejected(
      upload(fixture('01_jobcenter_request.pdf'), 'a.pdf'),
      500,
      'INTERNAL_ERROR',
      true, // extract уже был вызван
    );
  });

  it('удаление письма удаляет файл и журнал LlmCall по письму', async () => {
    const res = await upload(fixture('08_photo.jpg'), 'foto.jpg').expect(201);
    const id = res.body.letter.id as string;
    const row = await db.letter.findUniqueOrThrow({ where: { id } });
    const key = (row.files as { fileKey: string }[])[0].fileKey;
    expect(await db.llmCall.count({ where: { letterId: id } })).toBe(2);

    expect(await app.get(LettersService).removeLetter(cabinetId, id)).toBe(
      true,
    );
    expect(await db.letter.count({ where: { id } })).toBe(0);
    expect(await db.llmCall.count({ where: { letterId: id } })).toBe(0);
    expect(
      storedFiles(storageDir).some((f) => f.endsWith(key.split('/').pop()!)),
    ).toBe(false);
  });

  it('удаление аккаунта (A01) найдёт все записи журнала и файлы по cabinetId', async () => {
    const calls = await db.llmCall.findMany({ where: { cabinetId } });
    expect(calls.length).toBeGreaterThan(0);
    // и успешные, и неудачные операции связаны с кабинетом
    expect(calls.some((c) => !c.ok)).toBe(true);
    await app.get(StorageService).removeCabinet(cabinetId);
    expect(storedFiles(join(storageDir, 'letters', cabinetId))).toHaveLength(0);
  });

  it('K11: без согласия на анализ ИИ загрузка и объяснение 403, без файла и без модели; согласие дать и отозвать', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const ok = await upload(
      fixture('01_jobcenter_request.pdf'),
      'brief.pdf',
    ).expect(201);
    const before = await http().get('/cabinet').set(auth).expect(200);
    expect(before.body.aiConsent).toEqual({
      given: true,
      at: expect.any(String),
      version: 1,
    });

    const off = await http()
      .patch('/cabinet')
      .set(auth)
      .send({ aiConsent: false })
      .expect(200);
    expect(off.body.aiConsent).toEqual({ given: false, at: null, version: 1 });
    await expectRejected(
      upload(fixture('01_jobcenter_request.pdf'), 'brief.pdf'),
      403,
      'AI_CONSENT_REQUIRED',
    );
    const expl = await http()
      .post(`/letters/${ok.body.letter.id}/explain`)
      .set(auth)
      .expect(403);
    expect(expl.body.code).toBe('AI_CONSENT_REQUIRED');
    // уже загруженное письмо остаётся доступным
    await http().get(`/letters/${ok.body.letter.id}`).set(auth).expect(200);

    // согласие на старую версию текста не действует
    await db.cabinet.update({
      where: { id: cabinetId },
      data: { aiConsentAt: new Date(), aiConsentVersion: 0 },
    });
    await expectRejected(
      upload(fixture('01_jobcenter_request.pdf'), 'brief.pdf'),
      403,
      'AI_CONSENT_REQUIRED',
    );

    const on = await http()
      .patch('/cabinet')
      .set(auth)
      .send({ aiConsent: true })
      .expect(200);
    expect(on.body.aiConsent.given).toBe(true);
    await upload(fixture('01_jobcenter_request.pdf'), 'brief.pdf').expect(201);
  });

  it('K11: регистрация без aiConsent — кабинет без согласия', async () => {
    const res = await http()
      .post('/auth/register')
      .send({
        email: 'no-ai@example.org',
        password: 'mein-langes-Passwort',
        consent: true,
        ...PERSON,
      })
      .expect(201);
    const cab = await http()
      .get('/cabinet')
      .set('Authorization', `Bearer ${res.body.sessionToken}`)
      .expect(200);
    expect(cab.body.aiConsent.given).toBe(false);
  });
});
