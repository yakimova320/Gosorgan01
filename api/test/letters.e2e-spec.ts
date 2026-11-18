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

  it('скан PDF 09: 422 SCAN_PDF_NOT_SUPPORTED, модель не вызывалась', async () => {
    const res = await expectRejected(
      upload(fixture('09_scan.pdf'), 'scan.pdf'),
      422,
      'SCAN_PDF_NOT_SUPPORTED',
    );
    expect(res.body.details).toEqual({ pages: [1], totalPages: 1 });
  });

  it('смешанный PDF: отказ с номером страницы-скана', async () => {
    const res = await expectRejected(
      upload(await mixedPdf(fixture('09_scan.png')), 'mixed.pdf'),
      422,
      'SCAN_PDF_NOT_SUPPORTED',
    );
    expect(res.body.details).toEqual({ pages: [2], totalPages: 2 });
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

  it('два файла: 400 TOO_MANY_FILES; нет поля files: 400 NO_FILE; не multipart: NO_FILE', async () => {
    await expectRejected(
      http()
        .post('/letters')
        .set('Authorization', `Bearer ${token}`)
        .attach('files', fixture('01_jobcenter_request.pdf'), 'a.pdf')
        .attach('files', fixture('04_buergeramt.pdf'), 'b.pdf'),
      400,
      'TOO_MANY_FILES',
    );
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
});
