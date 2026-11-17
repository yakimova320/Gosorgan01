import type { INestApplication } from '@nestjs/common';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.factory.js';
import { encodeCursor } from '../src/cases/cases.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PERSON } from './person.js';
import { createTestDatabase } from './test-db.js';

const fixture = (name: string) =>
  readFileSync(
    resolve(import.meta.dirname, '..', '..', 'fixtures', 'letters', name),
  );

type Claim = { id: string; kind: string; value: string; status: string };

describe('Дела (e2e, B07)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let cleanup: () => Promise<void>;
  let storageDir: string;
  let token: string;
  let other: string;
  let cabinetId: string;
  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });

  async function register(email: string) {
    const res = await http()
      .post('/auth/register')
      .send({
        email,
        password: 'mein-langes-Passwort',
        consent: true,
        ...PERSON,
      })
      .expect(201);
    return res.body.sessionToken as string;
  }

  async function upload(name: string, t = token) {
    const res = await http()
      .post('/letters')
      .set(auth(t))
      .attach('files', fixture(name), name)
      .expect(201);
    return res.body as { letter: { id: string }; claims: Claim[] };
  }

  const byKind = (claims: Claim[], kind: string) =>
    claims.find((c) => c.kind === kind)!;

  beforeAll(async () => {
    const test = createTestDatabase();
    cleanup = test.cleanup;
    storageDir = mkdtempSync(join(tmpdir(), 'jasno-cases-'));
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
    token = await register('cases@example.org');
    other = await register('fremd-cases@example.org');
    cabinetId = (
      await db.cabinet.findFirstOrThrow({
        where: { email: 'cases@example.org' },
      })
    ).id;
  }, 60000);

  afterAll(async () => {
    await app.close();
    await cleanup();
    rmSync(storageDir, { recursive: true, force: true });
  });

  it('новое дело без подтверждённых фактов: «Новое дело», ведомство и номер null', async () => {
    const up = await upload('01_jobcenter_request.pdf');
    const res = await http()
      .post(`/letters/${up.letter.id}/assign`)
      .set(auth())
      .send({ newCase: {} })
      .expect(200);
    const kase = await http()
      .get(`/cases/${res.body.caseId}`)
      .set(auth())
      .expect(200);
    expect(kase.body).toMatchObject({
      title: 'Новое дело',
      authority: null,
      caseNumber: null,
      stage: 'NEEDS_CHECK',
    });
  });

  it('новое дело из подтверждённых фактов; письмо, факты и сроки в деле; stage по сроку', async () => {
    const up = await upload('01_jobcenter_request.pdf');
    const claims = up.claims;
    const deadline = byKind(claims, 'DEADLINE');
    await http()
      .post(`/letters/${up.letter.id}/claims/confirm`)
      .set(auth())
      .send({
        confirm: [
          byKind(claims, 'AUTHORITY').id,
          byKind(claims, 'CASE_NUMBER').id,
          byKind(claims, 'REQUIREMENT').id,
        ],
        reject: [],
      })
      .expect(200);
    const res = await http()
      .post(`/letters/${up.letter.id}/assign`)
      .set(auth())
      .send({ newCase: {} })
      .expect(200);
    const caseId = res.body.caseId as string;
    let kase = (await http().get(`/cases/${caseId}`).set(auth()).expect(200))
      .body;
    expect(kase.title).toBe(
      'Jobcenter Musterstadt: Bitte reichen Sie die Kontoauszüge für September ein.',
    );
    expect(kase).toMatchObject({
      authority: 'Jobcenter Musterstadt',
      caseNumber: 'JC-2026-1001',
      stage: 'NEEDS_CHECK',
    });
    expect(kase.letters.map((l: { id: string }) => l.id)).toEqual([
      up.letter.id,
    ]);
    expect(
      await db.deadline.count({ where: { letterId: up.letter.id, caseId } }),
    ).toBe(1);
    expect(kase.timeline.map((t: { type: string }) => t.type).sort()).toEqual([
      'CASE_CREATED_FROM_LETTER',
      'LETTER_RECEIVED',
    ]);

    // подтверждённый срок важнее оставшейся непроверенной даты письма
    await http()
      .post(`/letters/${up.letter.id}/claims/confirm`)
      .set(auth())
      .send({ confirm: [deadline.id] })
      .expect(200);
    kase = (await http().get(`/cases/${caseId}`).set(auth()).expect(200)).body;
    expect(kase.counts.unconfirmed).toBeGreaterThan(0);
    expect(kase.stage).toMatch(/^(DOCUMENTS|REPLY|OVERDUE)$/);
    expect(kase.nextDeadline).toBe('2026-11-30');
    expect(
      kase.timeline.filter(
        (t: { type: string }) => t.type === 'CLAIM_CONFIRMED',
      ),
    ).toHaveLength(1);

    // повтор подтверждения и назначения: без событий
    await http()
      .post(`/letters/${up.letter.id}/claims/confirm`)
      .set(auth())
      .send({ confirm: [deadline.id] })
      .expect(200);
    const again = await http()
      .post(`/letters/${up.letter.id}/assign`)
      .set(auth())
      .send({ caseId })
      .expect(200);
    expect(again.body).toEqual({ caseId, changed: false });
    expect(await db.event.count({ where: { caseId } })).toBe(3);

    const list = await http().get('/cases?q=jc-2026').set(auth()).expect(200);
    expect(list.body.map((c: { id: string }) => c.id)).toContain(caseId);
  });

  it('перенос: объяснение сброшено, черновики старого дела stale, trace и письмо уходят с письмом', async () => {
    const up = await upload('04_buergeramt.pdf');
    const first = (
      await http()
        .post(`/letters/${up.letter.id}/assign`)
        .set(auth())
        .send({ newCase: { title: 'Первое' } })
        .expect(200)
    ).body.caseId as string;
    const second = (
      await db.case.create({ data: { cabinetId, title: 'Второе' } })
    ).id;
    await db.letter.update({
      where: { id: up.letter.id },
      data: { explanation: { about: 'x' } },
    });
    const draft = await db.draft.create({
      data: {
        caseId: first,
        kind: 'CLARIFICATION',
        germanText: 'x',
        russianText: 'x',
        claimIds: [up.claims[0].id],
        claimSnapshot: {},
        verification: {},
      },
    });
    expect(
      (await http().get(`/cases/${first}/trace`).set(auth()).expect(200)).body
        .length,
    ).toBeGreaterThan(0);

    await http()
      .post(`/letters/${up.letter.id}/assign`)
      .set(auth())
      .send({ caseId: second })
      .expect(200);
    expect(
      (await db.letter.findUniqueOrThrow({ where: { id: up.letter.id } }))
        .explanation,
    ).toBeNull();
    expect(
      (await db.draft.findUniqueOrThrow({ where: { id: draft.id } })).stale,
    ).toBe(true);
    expect(
      await db.claim.count({
        where: { letterId: up.letter.id, caseId: { not: second } },
      }),
    ).toBe(0);
    expect(
      (await http().get(`/cases/${first}/trace`).set(auth()).expect(200)).body,
    ).toEqual([]);
    expect(
      (await http().get(`/cases/${second}/trace`).set(auth()).expect(200)).body
        .length,
    ).toBeGreaterThan(0);
    const firstCase = (
      await http().get(`/cases/${first}`).set(auth()).expect(200)
    ).body;
    expect(firstCase.letters).toEqual([]);
    expect(firstCase.timeline[0].title).toBe('Письмо перенесено в другое дело');
  });

  it('новое дело для письма, которое уже в деле: 409; параллельно — одно новое дело', async () => {
    const up = await upload('06_multiple_deadlines.pdf');
    const before = await db.case.count({ where: { cabinetId } });
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        http()
          .post(`/letters/${up.letter.id}/assign`)
          .set(auth())
          .send({ newCase: {} }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe(
      'LETTER_IN_CASE',
    );
    expect(await db.case.count({ where: { cabinetId } })).toBe(before + 1);
  });

  it('завершённое дело: 409 CASE_CLOSED; чужое дело и письмо: 404', async () => {
    const up = await upload('01_jobcenter_request.pdf');
    const closed = await db.case.create({
      data: { cabinetId, title: 'Закрыто', status: 'CLOSED' },
    });
    const res = await http()
      .post(`/letters/${up.letter.id}/assign`)
      .set(auth())
      .send({ caseId: closed.id })
      .expect(409);
    expect(res.body.code).toBe('CASE_CLOSED');
    const foreign = await upload('01_jobcenter_request.pdf', other);
    await http()
      .post(`/letters/${foreign.letter.id}/assign`)
      .set(auth())
      .send({ newCase: {} })
      .expect(404);
    await http()
      .post(`/letters/${up.letter.id}/assign`)
      .set(auth(other))
      .send({ caseId: closed.id })
      .expect(404);
    await http().get(`/cases/${closed.id}`).set(auth(other)).expect(404);
    await http().get(`/cases/${closed.id}/trace`).set(auth(other)).expect(404);
    await http()
      .patch(`/cases/${closed.id}`)
      .set(auth(other))
      .send({ status: 'OPEN' })
      .expect(404);
    await http().delete(`/cases/${closed.id}`).set(auth(other)).expect(404);
  });

  it('PATCH: завершить и открыть снова; список по status', async () => {
    const kase = await db.case.create({ data: { cabinetId, title: 'Patch' } });
    const done = await http()
      .patch(`/cases/${kase.id}`)
      .set(auth())
      .send({ status: 'CLOSED' })
      .expect(200);
    expect(done.body.stage).toBe('CLOSED');
    expect(
      (await http().get('/cases?status=done').set(auth())).body.map(
        (c: { id: string }) => c.id,
      ),
    ).toContain(kase.id);
    expect(
      (await http().get('/cases').set(auth())).body.map(
        (c: { id: string }) => c.id,
      ),
    ).not.toContain(kase.id);
    await http()
      .patch(`/cases/${kase.id}`)
      .set(auth())
      .send({ status: 'OPEN', title: 'Снова' })
      .expect(200);
    await http().patch(`/cases/${kase.id}`).set(auth()).send({}).expect(400);
    await http().get('/cases?status=weird').set(auth()).expect(400);
  });

  it('удаление дела: письма, файлы и журнал этого дела; другие дела не трогаются', async () => {
    const keep = await upload('04_buergeramt.pdf');
    const keepCase = (
      await http()
        .post(`/letters/${keep.letter.id}/assign`)
        .set(auth())
        .send({ newCase: {} })
    ).body.caseId;
    const up = await upload('08_photo.jpg');
    const caseId = (
      await http()
        .post(`/letters/${up.letter.id}/assign`)
        .set(auth())
        .send({ newCase: {} })
    ).body.caseId;
    const row = await db.letter.findUniqueOrThrow({
      where: { id: up.letter.id },
    });
    const key = (row.files as { fileKey: string }[])[0].fileKey;
    const keepCalls = await db.llmCall.count({
      where: { letterId: keep.letter.id },
    });

    await http().delete(`/cases/${caseId}`).set(auth()).expect(204);
    expect(await db.case.count({ where: { id: caseId } })).toBe(0);
    expect(await db.letter.count({ where: { id: up.letter.id } })).toBe(0);
    expect(await db.llmCall.count({ where: { letterId: up.letter.id } })).toBe(
      0,
    );
    expect(existsSync(join(storageDir, key))).toBe(false);
    expect(await db.case.count({ where: { id: keepCase } })).toBe(1);
    expect(
      await db.llmCall.count({ where: { letterId: keep.letter.id } }),
    ).toBe(keepCalls);
  });

  it('история: стабильный порядок (at, id), фильтр, курсор без пропусков и повторов', async () => {
    const kase = await db.case.create({
      data: { cabinetId, title: 'История' },
    });
    const at = new Date('2026-11-01T10:00:00.000Z');
    // 35 событий с одинаковым временем: порядок должен держаться на id
    await db.event.createMany({
      data: Array.from({ length: 35 }, (_, i) => ({
        caseId: kase.id,
        type:
          i % 5 === 0
            ? ('QUESTION_ASKED' as const)
            : ('LETTER_RECEIVED' as const),
        at,
        details: { n: i },
      })),
    });
    const all: string[] = [];
    let cursor: string | null = null;
    do {
      const res: request.Response = await http()
        .get(`/history${cursor ? `?cursor=${cursor}` : ''}`)
        .set(auth())
        .expect(200);
      expect(res.body.items.length).toBeLessThanOrEqual(30);
      all.push(...res.body.items.map((i: { id: string }) => i.id));
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(new Set(all).size).toBe(all.length);
    const total = await db.event.count({ where: { case: { cabinetId } } });
    expect(all).toHaveLength(total);

    const questions = await http()
      .get('/history?type=question')
      .set(auth())
      .expect(200);
    expect(questions.body.items).toHaveLength(7);
    expect(
      questions.body.items.every(
        (i: { type: string }) => i.type === 'QUESTION_ASKED',
      ),
    ).toBe(true);

    await http().get('/history?type=other').set(auth()).expect(400);
    await http().get('/history?cursor=kaputt').set(auth()).expect(400);
    const foreign = await http().get('/history').set(auth(other)).expect(200);
    expect(
      foreign.body.items.some((i: { caseId: string }) => i.caseId === kase.id),
    ).toBe(false);
    void encodeCursor;
  });
});
