import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { StorageService } from '../src/documents/storage.service.js';
import { LlmService } from '../src/llm/llm.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  DEMO_PROFILE,
  SEED_ENV_OVERRIDES,
  SeedError,
  prepareSeed,
  seedDemo,
  type PreparedSeed,
} from '../src/seed/demo-seed.js';
import { PERSON } from './person.js';
import { createTestDatabase } from './test-db.js';

const FIXTURES = resolve(import.meta.dirname, '..', '..', 'fixtures', 'letters');
const PASSWORD = 'demo-Passwort-2026';
const EMAIL = 'demo-seed@example.org';

/*
 * B19: seed демо-кабинета. Три дела из 01, 04, 12 (у 12 просроченный срок), подтверждённые факты,
 * объяснение; повторный запуск без дублей; обычный аккаунт с тем же e-mail не трогается;
 * модель внутри seed — всегда demo; проверки до изменений базы.
 */
describe('Seed демо-кабинета (e2e, B19)', () => {
  let app: INestApplicationContext;
  let db: PrismaService;
  let cleanup: () => Promise<void>;
  let storageDir: string;
  let prepared: PreparedSeed;

  beforeAll(async () => {
    const test = createTestDatabase();
    cleanup = test.cleanup;
    storageDir = mkdtempSync(join(tmpdir(), 'jasno-seed-'));
    // в окружении «настоящая» модель — seed всё равно включает demo
    app = await NestFactory.createApplicationContext(
      AppModule.forRoot({
        NODE_ENV: 'test',
        DATABASE_URL: test.url,
        STORAGE_DIR: storageDir,
        LLM_MODE: 'openai',
        LLM_BASE_URL: 'http://127.0.0.1:9/v1',
        LLM_API_KEY: 'nicht-echt',
        LLM_MODEL: 'nicht-echt',
        ...SEED_ENV_OVERRIDES,
      }),
      { logger: false },
    );
    db = app.get(PrismaService);
    prepared = prepareSeed({ nodeEnv: 'test', email: EMAIL, password: PASSWORD, fixturesDir: FIXTURES });
  }, 60_000); // миграции схемы и запуск контекста иногда дольше 10 с

  afterAll(async () => {
    await app.close();
    await cleanup();
    rmSync(storageDir, { recursive: true, force: true });
  });

  afterEach(() => vi.restoreAllMocks());

  it('создаёт кабинет: 3 дела из 01, 04, 12, факты подтверждены, объяснения есть, срок 12 просрочен, вход работает', async () => {
    expect(app.get(LlmService).mode.provider).toBe('demo');
    const r = await seedDemo(app, prepared, { today: '2026-11-25' });
    expect(r).toMatchObject({ email: EMAIL, replaced: false, cases: 3, overdueDeadlines: 1 });

    const cabinet = await db.cabinet.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(cabinet.demo).toBe(true);
    expect(cabinet.profile).toEqual(DEMO_PROFILE);
    const letters = await db.letter.findMany({ where: { cabinetId: cabinet.id }, include: { claims: true } });
    expect(letters).toHaveLength(3);
    for (const l of letters) {
      expect(l.caseId).not.toBeNull();
      expect(l.explanation).not.toBeNull();
      expect(l.claims.length).toBeGreaterThan(0);
      expect(l.claims.every((c) => c.status === 'CONFIRMED')).toBe(true);
    }
    const authorities = letters.flatMap((l) => l.claims.filter((c) => c.kind === 'AUTHORITY').map((c) => c.value)).sort();
    expect(authorities).toEqual(['Bürgeramt Beispielhausen', 'Finanzamt Beispielhausen', 'Jobcenter Musterstadt']);
    // нет настоящих людей: только синтетические имена из писем
    const texts = JSON.stringify(await db.cabinet.findMany({ where: { id: cabinet.id }, include: { letters: true } }));
    expect(texts).not.toMatch(/@(?!example\.org)/);
    // модель: только demo, без сети
    const calls = await db.llmCall.findMany({ where: { cabinetId: cabinet.id } });
    expect(new Set(calls.map((c) => c.provider))).toEqual(new Set(['demo']));

    await expect(app.get(AuthService).login({ email: EMAIL, password: PASSWORD })).resolves.toHaveProperty('sessionToken');
  });

  it('повторный запуск пересоздаёт только демо-кабинет: без дублей, прежние строки и файлы удалены', async () => {
    const before = await db.cabinet.findUniqueOrThrow({ where: { email: EMAIL } });
    const r = await seedDemo(app, prepared, { today: '2026-11-25' });
    expect(r).toMatchObject({ replaced: true, cases: 3, overdueDeadlines: 1 });
    expect(await db.cabinet.count({ where: { email: EMAIL } })).toBe(1);
    expect(await db.cabinet.count({ where: { id: before.id } })).toBe(0);
    expect(await db.letter.count({ where: { cabinetId: before.id } })).toBe(0);
    expect(existsSync(join(storageDir, 'letters', before.id))).toBe(false);
  });

  it('удаление прежнего кабинета ответило PENDING (202): seed ждёт полной очистки, потом создаёт новый', async () => {
    const before = await db.cabinet.findUniqueOrThrow({ where: { email: EMAIL } });
    const storage = app.get(StorageService);
    vi.spyOn(storage, 'purgeErasure').mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EBUSY' }));
    const r = await seedDemo(app, prepared, { today: '2026-11-25' });
    expect(r.replaced).toBe(true);
    expect(await db.accountErasure.count({ where: { cabinetId: before.id } })).toBe(0);
    expect(await db.cabinet.count({ where: { email: EMAIL } })).toBe(1);
  });

  it('обычный аккаунт с тем же e-mail не удаляется: seed отказывает', async () => {
    const auth = app.get(AuthService);
    const email = 'normal-user@example.org';
    await auth.register({ email, password: 'normal-Passwort-1', consent: true, aiConsent: true, ...PERSON });
    const normal = await db.cabinet.findUniqueOrThrow({ where: { email } });
    await expect(seedDemo(app, { ...prepared, email })).rejects.toThrow(SeedError);
    const after = await db.cabinet.findUniqueOrThrow({ where: { email } });
    expect(after.id).toBe(normal.id);
    expect(after.demo).toBe(false);
    expect(await db.letter.count({ where: { cabinetId: normal.id } })).toBe(0);
  });

  it('проверки до изменений базы: production, нет пароля, короткий пароль, нет файлов писем', () => {
    const base = { nodeEnv: 'test', email: EMAIL, password: PASSWORD, fixturesDir: FIXTURES };
    expect(() => prepareSeed({ ...base, nodeEnv: 'production' })).toThrow(/production запрещён/);
    expect(() => prepareSeed({ ...base, password: undefined })).toThrow(/DEMO_PASSWORD/);
    expect(() => prepareSeed({ ...base, password: '' })).toThrow(/DEMO_PASSWORD/);
    expect(() => prepareSeed({ ...base, password: 'kurz' })).toThrow(/DEMO_PASSWORD не подходит/);
    expect(() => prepareSeed({ ...base, fixturesDir: join(FIXTURES, 'gibt-es-nicht') })).toThrow(/Нет файла письма/);
    expect(() => prepareSeed({ ...base, email: 'kein-email' })).toThrow(/DEMO_EMAIL/);
  });
});
