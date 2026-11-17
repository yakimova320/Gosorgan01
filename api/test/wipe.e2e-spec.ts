import type { INestApplication } from '@nestjs/common';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.factory.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  describeTarget,
  executeWipe,
  planWipe,
  targetId,
} from '../src/scripts/wipe-accounts.lib.js';
import { PERSON } from './person.js';
import { createTestDatabase } from './test-db.js';

const fixture = (name: string) =>
  readFileSync(
    resolve(import.meta.dirname, '..', '..', 'fixtures', 'letters', name),
  );

describe('Разовая очистка аккаунтов (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let cleanup: () => Promise<void>;
  let storageDir: string;
  let url: string;
  const http = () => request(app.getHttpServer());

  async function userWithLetter(email: string) {
    const res = await http()
      .post('/auth/register')
      .send({
        email,
        password: 'mein-langes-Passwort',
        consent: true,
        ...PERSON,
      })
      .expect(201);
    const token = res.body.sessionToken as string;
    await http()
      .post('/letters')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', fixture('08_photo.jpg'), 'f.jpg')
      .expect(201);
    return (await db.cabinet.findUniqueOrThrow({ where: { email } })).id;
  }

  beforeAll(async () => {
    const test = createTestDatabase();
    cleanup = test.cleanup;
    url = test.url;
    storageDir = mkdtempSync(join(tmpdir(), 'jasno-wipe-'));
    app = await createApp({
      env: {
        LLM_MODE: 'demo',
        NODE_ENV: 'test',
        DATABASE_URL: url,
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

  it('цель описана хостом, портом, базой и схемой, без пароля', () => {
    const t = describeTarget(url, storageDir);
    expect(targetId(t)).toMatch(/^localhost:\d+\/jasno\/test_\d+_[0-9a-f]+$/);
    expect(JSON.stringify(t)).not.toContain('jasno:jasno@');
  });

  it('удаляет только выбранный аккаунт: строки, LlmCall и файлы; другой цел; повтор показывает 0', async () => {
    const a = await userWithLetter('wipe-a@example.org');
    const b = await userWithLetter('wipe-b@example.org');
    const bCalls = await db.llmCall.count({ where: { cabinetId: b } });
    expect(bCalls).toBeGreaterThan(0);

    const plan = await planWipe(db, storageDir, {
      emails: ['WIPE-A@example.org'],
    });
    expect(plan.cabinets.map((c) => c.id)).toEqual([a]);
    expect(plan.counts).toMatchObject({
      letters: 1,
      sessions: 1,
      letterDirs: 1,
    });
    expect(plan.counts.llmCalls).toBe(2);

    await executeWipe(db, storageDir, plan);
    expect(await db.cabinet.count({ where: { id: a } })).toBe(0);
    expect(await db.session.count({ where: { cabinetId: a } })).toBe(0);
    expect(await db.letter.count({ where: { cabinetId: a } })).toBe(0);
    expect(await db.llmCall.count({ where: { cabinetId: a } })).toBe(0);
    expect(existsSync(join(storageDir, 'letters', a))).toBe(false);

    expect(await db.cabinet.count({ where: { id: b } })).toBe(1);
    expect(await db.llmCall.count({ where: { cabinetId: b } })).toBe(bCalls);
    expect(existsSync(join(storageDir, 'letters', b))).toBe(true);

    const again = await planWipe(db, storageDir, {
      emails: ['wipe-a@example.org'],
    });
    expect(again.cabinets).toEqual([]);
  });

  it('ошибка удаления файлов: кабинет остаётся в базе, повторный запуск его находит', async () => {
    const c = await userWithLetter('wipe-c@example.org');
    const plan = await planWipe(db, storageDir, {
      emails: ['wipe-c@example.org'],
    });
    await expect(executeWipe(db, '\u0000bad', plan)).rejects.toThrow();
    expect(await db.cabinet.count({ where: { id: c } })).toBe(1);
    const retry = await planWipe(db, storageDir, {
      emails: ['wipe-c@example.org'],
    });
    await executeWipe(db, storageDir, retry);
    expect(await db.cabinet.count({ where: { id: c } })).toBe(0);
  });
});
