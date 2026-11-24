import type { INestApplication } from '@nestjs/common';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.factory.js';
import { RetentionService } from '../src/erasure/retention.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PERSON } from './person.js';
import { createTestDatabase } from './test-db.js';

/*
 * B12: виды ответа, правка черновика с повторной проверкой, «Я отправил(а)», сроки (выполнено, .ics),
 * автоудаление неактивных кабинетов. Настоящий API, модель demo.
 * «Сегодня» закреплено (20.11.2026): срок письма 01 — 30.11.2026, тест не стареет.
 */

const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dirname, '..', '..', 'fixtures', 'letters', name));

type Claim = { id: string; kind: string; value: string };
const DAY_MS = 24 * 60 * 60 * 1000;

function files(dir: string): string[] {
  try {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => join(d.parentPath, d.name));
  } catch {
    return [];
  }
}

describe('Ответ и отправка (e2e, B12)', () => {
  let app: INestApplication;
  let db: PrismaService;
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

  /** Письмо 01 в новом деле; confirmAll: подтвердить все факты, иначе все, кроме срока. */
  async function letter01(confirmAll = true, t = token) {
    const up = await http()
      .post('/letters')
      .set(auth(t))
      .attach('files', fixture('01_jobcenter_request.pdf'), 'a.pdf')
      .expect(201);
    const claims = up.body.claims as Claim[];
    const confirm = claims.filter((c) => confirmAll || c.kind !== 'DEADLINE').map((c) => c.id);
    await http()
      .post(`/letters/${up.body.letter.id}/claims/confirm`)
      .set(auth(t))
      .send({ confirm })
      .expect(200);
    const assigned = await http()
      .post(`/letters/${up.body.letter.id}/assign`)
      .set(auth(t))
      .send({ newCase: {} })
      .expect(200);
    const deadlines = (
      await http().get(`/letters/${up.body.letter.id}`).set(auth(t)).expect(200)
    ).body.deadlines as { id: string; claimId: string; active: boolean }[];
    return {
      letterId: up.body.letter.id as string,
      caseId: assigned.body.caseId as string,
      claims,
      deadline: deadlines[0],
    };
  }

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T10:00:00.000Z'));
    const test = createTestDatabase();
    cleanup = test.cleanup;
    storageDir = mkdtempSync(join(tmpdir(), 'jasno-sent-'));
    app = await createApp({
      env: { LLM_MODE: 'demo', NODE_ENV: 'test', DATABASE_URL: test.url, STORAGE_DIR: storageDir },
      logger: false,
    });
    await app.init();
    db = app.get(PrismaService);
    token = await register('sent@example.org');
    other = await register('fremd-sent@example.org');
  }, 60000);

  afterAll(async () => {
    await app.close();
    await cleanup();
    rmSync(storageDir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it('виды ответа по фактам письма; DOCUMENTS, EXTENSION, STATUS_REQUEST собираются и проходят проверку', async () => {
    const { letterId, caseId, deadline } = await letter01();
    const q = await http().get(`/letters/${letterId}/draft-questions`).set(auth()).expect(200);
    expect(q.body.kinds).toEqual(['CLARIFICATION', 'DOCUMENTS', 'EXTENSION', 'STATUS_REQUEST']);
    expect(q.body.deadlines).toEqual([{ claimId: deadline.claimId, date: '2026-11-30' }]);
    expect(q.body.extensionReasons.map((r: { id: string }) => r.id)).toEqual([
      'DOCUMENTS_PENDING',
      'ADVICE',
      'NONE',
    ]);

    const docs = await http()
      .post(`/cases/${caseId}/draft`)
      .set(auth())
      .send({ kind: 'DOCUMENTS', letterId })
      .expect(201);
    expect(docs.body).toMatchObject({ kind: 'DOCUMENTS', letterId, stale: false, edited: false, status: 'PREPARED' });
    expect(docs.body.germanText).toContain('Anbei übersende ich Ihnen die angeforderten Unterlagen.');
    expect(docs.body.verification.passed).toBe(true);

    const ext = await http()
      .post(`/cases/${caseId}/draft`)
      .set(auth())
      .send({ kind: 'EXTENSION', letterId, reason: 'ADVICE' })
      .expect(201);
    expect(ext.body).toMatchObject({ kind: 'EXTENSION', reason: 'ADVICE', deadlineClaimId: deadline.claimId });
    expect(ext.body.germanText).toContain('Frist bis zum 30.11.2026 gesetzt.');
    expect(ext.body.germanText).toContain('Ich möchte mich vorher beraten lassen.');

    const status = await http()
      .post(`/cases/${caseId}/draft`)
      .set(auth())
      .send({ kind: 'STATUS_REQUEST', letterId })
      .expect(201);
    expect(status.body.germanText).toContain('Sachstandsanfrage');

    // неверные входы
    await http()
      .post(`/cases/${caseId}/draft`)
      .set(auth())
      .send({ kind: 'EXTENSION', letterId, reason: 'SONST' })
      .expect(400);
    const wrongDeadline = await http()
      .post(`/cases/${caseId}/draft`)
      .set(auth())
      .send({ kind: 'EXTENSION', letterId, reason: 'NONE', deadlineClaimId: 'nope' })
      .expect(422);
    expect(wrongDeadline.body.code).toBe('QUESTION_NOT_AVAILABLE');
  });

  it('EXTENSION недоступен без подтверждённого срока', async () => {
    const { letterId, caseId } = await letter01(false);
    const q = await http().get(`/letters/${letterId}/draft-questions`).set(auth()).expect(200);
    expect(q.body.kinds).not.toContain('EXTENSION');
    const res = await http()
      .post(`/cases/${caseId}/draft`)
      .set(auth())
      .send({ kind: 'EXTENSION', letterId, reason: 'NONE' })
      .expect(422);
    expect(res.body).toMatchObject({ code: 'QUESTION_NOT_AVAILABLE', details: { kind: 'EXTENSION' } });
  });

  it('правка черновика: проверка заново; не прошла — 422 и текст прежний; устаревший — 409; чужой — 404', async () => {
    const { letterId, caseId, claims } = await letter01();
    const draft = (
      await http().post(`/cases/${caseId}/draft`).set(auth()).send({ kind: 'STATUS_REQUEST', letterId }).expect(201)
    ).body;
    const germanText = draft.germanText.replace(
      'Vielen Dank im Voraus.',
      'Ich bin telefonisch gut erreichbar.\n\nVielen Dank im Voraus.',
    );
    const ok = await http()
      .patch(`/drafts/${draft.id}`)
      .set(auth())
      .send({ germanText, russianText: draft.russianText })
      .expect(200);
    expect(ok.body).toMatchObject({ edited: true, germanText, stale: false });
    expect(ok.body.verification.passed).toBe(true);

    const bad = await http()
      .patch(`/drafts/${draft.id}`)
      .set(auth())
      .send({ germanText: germanText + '\nBitte antworten Sie bis zum 24.12.2026.', russianText: draft.russianText })
      .expect(422);
    expect(bad.body.code).toBe('DRAFT_VERIFICATION_FAILED');
    expect(bad.body.details.passed).toBe(false);
    expect((await http().get(`/drafts/${draft.id}`).set(auth()).expect(200)).body.germanText).toBe(germanText);

    await http().patch(`/drafts/${draft.id}`).set(auth(other)).send({ germanText, russianText: draft.russianText }).expect(404);
    await http().patch(`/drafts/${draft.id}`).set(auth()).send({ germanText: 'kurz', russianText: draft.russianText }).expect(400);

    // факт исправлен → черновик устарел → правка закрыта
    const authority = claims.find((c) => c.kind === 'AUTHORITY')!;
    await http()
      .post(`/letters/${letterId}/claims/${authority.id}/correct`)
      .set(auth())
      .send({ value: 'Jobcenter Andersstadt' })
      .expect(200);
    const stale = await http()
      .patch(`/drafts/${draft.id}`)
      .set(auth())
      .send({ germanText, russianText: draft.russianText })
      .expect(409);
    expect(stale.body.code).toBe('DRAFT_STALE');
  });

  it('«Я отправил(а)»: черновик SENT, выбранный срок закрыт, события; повтор 409; будущая дата 400; чужое дело 404', async () => {
    const { letterId, caseId, deadline } = await letter01();
    const draft = (
      await http().post(`/cases/${caseId}/draft`).set(auth()).send({ kind: 'DOCUMENTS', letterId }).expect(201)
    ).body;

    await http()
      .post(`/cases/${caseId}/sent`)
      .set(auth())
      .send({ draftId: draft.id, via: 'post', date: '2026-11-21' })
      .expect(400);
    await http()
      .post(`/cases/${caseId}/sent`)
      .set(auth(other))
      .send({ draftId: draft.id, via: 'post', date: '2026-11-20' })
      .expect(404);
    await http()
      .post(`/cases/${caseId}/sent`)
      .set(auth())
      .send({ via: 'fax', date: '2026-11-20' })
      .expect(400);

    const res = await http()
      .post(`/cases/${caseId}/sent`)
      .set(auth())
      .send({ draftId: draft.id, via: 'post', date: '2026-11-19', closeDeadlineId: deadline.id })
      .expect(201);
    expect(res.body).toEqual({ caseId, draftId: draft.id, closedDeadlineId: deadline.id });

    const sent = (await http().get(`/drafts/${draft.id}`).set(auth()).expect(200)).body;
    expect(sent).toMatchObject({ status: 'SENT', sentAt: '2026-11-19', sentVia: 'post' });
    const kase = (await http().get(`/cases/${caseId}`).set(auth()).expect(200)).body;
    expect(kase.deadlines.find((d: { id: string }) => d.id === deadline.id).done).toBe(true);
    expect(kase.stage).toBe('WAITING');
    const types = kase.timeline.map((e: { type: string }) => e.type);
    expect(types.slice(0, 2).sort()).toEqual(['DEADLINE_DONE', 'USER_REPORTED_SENT']);
    expect(kase.timeline.find((e: { type: string }) => e.type === 'USER_REPORTED_SENT').subtitle).toBe(
      'Почтой · 19.11.2026',
    );

    const again = await http()
      .post(`/cases/${caseId}/sent`)
      .set(auth())
      .send({ draftId: draft.id, via: 'post', date: '2026-11-20' })
      .expect(409);
    expect(again.body.code).toBe('DRAFT_ALREADY_SENT');
    // правка отправленного закрыта
    await http()
      .patch(`/drafts/${draft.id}`)
      .set(auth())
      .send({ germanText: sent.germanText, russianText: sent.russianText })
      .expect(409);
    // без черновика: только событие; закрытый срок второй раз — 409
    const twice = await http()
      .post(`/cases/${caseId}/sent`)
      .set(auth())
      .send({ via: 'online', date: '2026-11-20', closeDeadlineId: deadline.id })
      .expect(409);
    expect(twice.body.code).toBe('DEADLINE_ALREADY_DONE');
    await http().post(`/cases/${caseId}/sent`).set(auth()).send({ via: 'online', date: '2026-11-20' }).expect(201);
  });

  it('срок: выполнен и снова открыт; .ics только подтверждённого срока владельца', async () => {
    const { caseId, deadline } = await letter01();
    const done = await http().patch(`/deadlines/${deadline.id}`).set(auth()).send({ done: true }).expect(200);
    expect(done.body).toEqual({ id: deadline.id, caseId, date: '2026-11-30', done: true });
    await http().patch(`/deadlines/${deadline.id}`).set(auth()).send({ done: true }).expect(200);
    await http().patch(`/deadlines/${deadline.id}`).set(auth()).send({ done: false }).expect(200);
    const kase = (await http().get(`/cases/${caseId}`).set(auth()).expect(200)).body;
    expect(kase.deadlines[0].done).toBe(false);
    expect(kase.timeline.filter((e: { type: string }) => e.type === 'DEADLINE_DONE')).toHaveLength(1);
    expect(kase.timeline[0].title).toBe('Срок снова открыт');
    await http().patch(`/deadlines/${deadline.id}`).set(auth(other)).send({ done: true }).expect(404);
    await http().patch(`/deadlines/${deadline.id}`).set(auth()).send({ done: 'ja' }).expect(400);

    const ics = await http().get(`/deadlines/${deadline.id}/ics`).set(auth()).expect(200);
    expect(ics.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(ics.headers['content-disposition']).toContain('.ics');
    expect(ics.headers['cache-control']).toBe('private, no-store');
    expect(ics.text).toContain('DTSTART;VALUE=DATE:20261130');
    expect(ics.text).toContain('SUMMARY:Срок: ответить — Jobcenter Musterstadt');
    expect(ics.text).toContain('TRIGGER:-P3D');
    await http().get(`/deadlines/${deadline.id}/ics`).set(auth(other)).expect(404);
    await http().get(`/deadlines/${deadline.id}/ics`).expect(401);

    const unconfirmed = await letter01(false);
    const res = await http().get(`/deadlines/${unconfirmed.deadline.id}/ics`).set(auth()).expect(409);
    expect(res.body.code).toBe('DEADLINE_NOT_CONFIRMED');
    await http().patch(`/deadlines/${unconfirmed.deadline.id}`).set(auth()).send({ done: true }).expect(409);
  });

  it('автоудаление: кабинет без активности дольше CABINET_TTL_DAYS удаляется целиком; активный и демо остаются', async () => {
    const oldToken = await register('alt@example.org');
    await letter01(true, oldToken);
    const old = await db.cabinet.findUniqueOrThrow({ where: { email: 'alt@example.org' } });
    expect(files(join(storageDir, 'letters', old.id)).length).toBeGreaterThan(0);
    const longAgo = new Date(Date.now() - 361 * DAY_MS);
    await db.cabinet.update({ where: { id: old.id }, data: { lastSeenAt: longAgo } });

    await register('demo-alt@example.org');
    await db.cabinet.update({
      where: { email: 'demo-alt@example.org' },
      data: { lastSeenAt: longAgo, demo: true },
    });
    const recent = await register('neu@example.org');
    await db.cabinet.update({
      where: { email: 'neu@example.org' },
      data: { lastSeenAt: new Date(Date.now() - 359 * DAY_MS) },
    });
    // просроченная сессия другого (активного) кабинета
    const activeCabinet = await db.cabinet.findUniqueOrThrow({ where: { email: 'sent@example.org' } });
    await db.session.create({
      data: { cabinetId: activeCabinet.id, tokenHash: 'expired-hash', expiresAt: new Date(Date.now() - DAY_MS) },
    });

    const result = await app.get(RetentionService).runOnce();
    expect(result.cabinets).toEqual([{ id: old.id, outcome: 'DONE' }]);
    expect(result.sessions).toBeGreaterThanOrEqual(1);
    expect(await db.cabinet.findUnique({ where: { id: old.id } })).toBeNull();
    for (const model of ['letter', 'case', 'llmCall', 'session'] as const)
      expect(await (db[model] as { count: (a: object) => Promise<number> }).count({ where: { cabinetId: old.id } })).toBe(0);
    expect(files(join(storageDir, 'letters', old.id))).toEqual([]);
    expect(await db.cabinet.findUnique({ where: { email: 'demo-alt@example.org' } })).not.toBeNull();
    await http().get('/cabinet').set(auth(recent)).expect(200);
    await http().get('/cabinet').set(auth()).expect(200);
    expect(await db.session.findFirst({ where: { tokenHash: 'expired-hash' } })).toBeNull();
    await http().get('/cabinet').set(auth(oldToken)).expect(401);
  });
});
