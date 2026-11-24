import type { INestApplication } from '@nestjs/common';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.factory.js';
import { DeadlineReminders } from '../src/calendar/deadline-reminders.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PERSON } from './person.js';
import { createTestDatabase } from './test-db.js';

/*
 * K12: подписка на календарь сроков и напоминание по e-mail за 3 дня. Настоящий API, модель demo.
 * «Сегодня» закреплено: срок письма 01 — 30.11.2026.
 */

const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dirname, '..', '..', 'fixtures', 'letters', name));

type Claim = { id: string; kind: string };

describe('Календарь и напоминания (e2e, K12)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let reminders: DeadlineReminders;
  let cleanup: () => Promise<void>;
  let storageDir: string;
  let token: string;
  let other: string;
  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });

  async function register(email: string) {
    const res = await http()
      .post('/auth/register')
      .send({ email, password: 'mein-langes-Passwort', consent: true, aiConsent: true, ...PERSON })
      .expect(201);
    return res.body.sessionToken as string;
  }

  /** Письмо 01 в новом деле; confirmAll=false: срок не подтверждён. */
  async function letter01(confirmAll = true, t = token) {
    const up = await http()
      .post('/letters')
      .set(auth(t))
      .attach('files', fixture('01_jobcenter_request.pdf'), 'a.pdf')
      .expect(201);
    const claims = up.body.claims as Claim[];
    await http()
      .post(`/letters/${up.body.letter.id}/claims/confirm`)
      .set(auth(t))
      .send({ confirm: claims.filter((c) => confirmAll || c.kind !== 'DEADLINE').map((c) => c.id) })
      .expect(200);
    const assigned = await http()
      .post(`/letters/${up.body.letter.id}/assign`)
      .set(auth(t))
      .send({ newCase: {} })
      .expect(200);
    const letter = await http().get(`/letters/${up.body.letter.id}`).set(auth(t)).expect(200);
    return {
      caseId: assigned.body.caseId as string,
      deadlineId: (letter.body.deadlines as { id: string }[])[0]?.id,
    };
  }

  const feedOf = (path: string) => http().get(path);
  const unfold = (text: string) => text.replace(/\r\n /g, '');

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T10:00:00.000Z'));
    const test = createTestDatabase();
    cleanup = test.cleanup;
    storageDir = mkdtempSync(join(tmpdir(), 'jasno-calendar-'));
    app = await createApp({
      env: {
        LLM_MODE: 'demo',
        NODE_ENV: 'test',
        DATABASE_URL: test.url,
        STORAGE_DIR: storageDir,
        APP_PUBLIC_URL: 'http://jasno.test',
        REMINDERS_ENABLED: 'false',
      },
      logger: false,
    });
    await app.init();
    db = app.get(PrismaService);
    reminders = app.get(DeadlineReminders);
    token = await register('kalender@example.org');
    other = await register('fremd-kalender@example.org');
  }, 60000);

  afterAll(async () => {
    await app.close();
    await cleanup();
    rmSync(storageDir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it('ссылка: нет → создать → лента с подтверждённым сроком → сброс → отключить', async () => {
    const start = await http().get('/cabinet/calendar').set(auth()).expect(200);
    expect(start.body).toEqual({ feedPath: null, reminderEmail: true });
    await http().get('/cabinet/calendar').expect(401);

    const { caseId, deadlineId } = await letter01();
    await letter01(false); // неподтверждённый срок в ленту не попадает

    const created = await http().post('/cabinet/calendar/token').set(auth()).expect(201);
    expect(created.body.feedPath).toMatch(/^\/calendar\/[A-Za-z0-9_-]{43}\.ics$/);
    const path = created.body.feedPath as string;
    expect((await http().get('/cabinet/calendar').set(auth()).expect(200)).body.feedPath).toBe(path);

    const feed = await feedOf(path).expect(200);
    expect(feed.headers['content-type']).toBe('text/calendar; charset=utf-8');
    const text = unfold(feed.text);
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(text).toContain(`UID:${deadlineId}@jasno`);
    expect(text).toContain('DTSTART;VALUE=DATE:20261130');
    expect(text).toContain('SUMMARY:Срок: ответить — Jobcenter Musterstadt');
    expect(text).toContain(`URL:http://jasno.test/app/cases/${caseId}`);
    expect(text).toContain('TRIGGER:-P3D');
    // текста письма в ленте нет
    expect(text).not.toMatch(/Sehr geehrte/i);

    // выполненный срок пропадает из ленты, открытый снова — возвращается
    await http().patch(`/deadlines/${deadlineId}`).set(auth()).send({ done: true }).expect(200);
    expect(unfold((await feedOf(path).expect(200)).text)).not.toContain('BEGIN:VEVENT');
    await http().patch(`/deadlines/${deadlineId}`).set(auth()).send({ done: false }).expect(200);
    expect(unfold((await feedOf(path).expect(200)).text)).toContain(`UID:${deadlineId}@jasno`);

    // сброс: старый адрес 404, новый работает
    const reset = await http().post('/cabinet/calendar/token').set(auth()).expect(201);
    expect(reset.body.feedPath).not.toBe(path);
    await feedOf(path).expect(404);
    await feedOf(reset.body.feedPath).expect(200);

    // отключение
    const off = await http().delete('/cabinet/calendar/token').set(auth()).expect(200);
    expect(off.body.feedPath).toBeNull();
    await feedOf(reset.body.feedPath).expect(404);
  });

  it('чужой и кривой токен: 404', async () => {
    await feedOf('/calendar/abc.ics').expect(404);
    await feedOf(`/calendar/${'a'.repeat(43)}.ics`).expect(404);
    await feedOf(`/calendar/${'a'.repeat(43)}`).expect(404);
    const mine = await http().post('/cabinet/calendar/token').set(auth(other)).expect(201);
    // лента другого кабинета не содержит моих сроков
    expect(unfold((await feedOf(mine.body.feedPath).expect(200)).text)).not.toContain('BEGIN:VEVENT');
    await http().patch('/cabinet/calendar').set(auth()).send({ reminderEmail: 'ja' }).expect(400);
    await http().patch('/cabinet/calendar').set(auth()).send({ reminderEmail: true, x: 1 }).expect(400);
  });

  it('напоминание: одно письмо за 3 дня, днём, не для выключивших и не для выполненных', async () => {
    const me = await db.cabinet.findUniqueOrThrow({ where: { email: 'kalender@example.org' } });
    const deadlines = await db.deadline.findMany({
      where: { letter: { cabinetId: me.id }, claim: { status: 'CONFIRMED' } },
    });
    expect(deadlines).toHaveLength(1);
    const id = deadlines[0].id;
    const file = join(storageDir, 'mail-outbox', me.id, `reminder-${id}.eml`);

    // за 4 дня рано
    reminders.now = () => new Date('2026-11-26T09:00:00.000Z');
    expect(await reminders.runDue()).toEqual({ sent: 0, failed: 0 });
    // за 3 дня, но ночью по Берлину: ждём утра
    reminders.now = () => new Date('2026-11-27T02:00:00.000Z');
    expect(await reminders.runDue()).toEqual({ sent: 0, failed: 0 });

    // напоминания выключены
    await http().patch('/cabinet/calendar').set(auth()).send({ reminderEmail: false }).expect(200);
    reminders.now = () => new Date('2026-11-27T09:00:00.000Z');
    expect(await reminders.runDue()).toEqual({ sent: 0, failed: 0 });

    // включены: одно письмо
    const on = await http().patch('/cabinet/calendar').set(auth()).send({ reminderEmail: true }).expect(200);
    expect(on.body.reminderEmail).toBe(true);
    expect(await reminders.runDue()).toEqual({ sent: 1, failed: 0 });
    expect(existsSync(file)).toBe(true);
    const eml = readFileSync(file, 'utf8');
    expect(eml).toContain('kalender@example.org');
    expect(eml).toMatch(/Subject: =\?UTF-8\?/);
    expect((await db.deadline.findUniqueOrThrow({ where: { id } })).reminderSentAt).not.toBeNull();

    // повтора нет
    reminders.now = () => new Date('2026-11-28T09:00:00.000Z');
    expect(await reminders.runDue()).toEqual({ sent: 0, failed: 0 });
  });

  it('выполненный срок напоминание не получает', async () => {
    const t = await register('erledigt@example.org');
    const { deadlineId } = await letter01(true, t);
    await http().patch(`/deadlines/${deadlineId}`).set(auth(t)).send({ done: true }).expect(200);
    reminders.now = () => new Date('2026-11-27T09:00:00.000Z');
    expect(await reminders.runDue()).toEqual({ sent: 0, failed: 0 });
    expect((await db.deadline.findUniqueOrThrow({ where: { id: deadlineId } })).reminderSentAt).toBeNull();
  });
});
