import type { INestApplication } from '@nestjs/common';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.factory.js';
import { VerificationService } from '../src/drafting/drafts.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PERSON } from './person.js';
import { createTestDatabase } from './test-db.js';

const fixture = (name: string) =>
  readFileSync(
    resolve(import.meta.dirname, '..', '..', 'fixtures', 'letters', name),
  );

type Claim = { id: string; kind: string };

describe('Черновик «запрос уточнения» (e2e, B10)', () => {
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

  /** Письмо в новом деле; confirm: подтвердить все факты. */
  async function letterInCase(file: string, confirm: boolean, t = token) {
    const up = await http()
      .post('/letters')
      .set(auth(t))
      .attach('files', fixture(file), file)
      .expect(201);
    const claims = up.body.claims as Claim[];
    if (confirm)
      await http()
        .post(`/letters/${up.body.letter.id}/claims/confirm`)
        .set(auth(t))
        .send({ confirm: claims.map((c) => c.id) })
        .expect(200);
    const assigned = await http()
      .post(`/letters/${up.body.letter.id}/assign`)
      .set(auth(t))
      .send({ newCase: {} })
      .expect(200);
    return {
      letterId: up.body.letter.id as string,
      caseId: assigned.body.caseId as string,
      claims,
    };
  }

  const draft = (caseId: string, body: object, t = token) =>
    http().post(`/cases/${caseId}/draft`).set(auth(t)).send(body);

  beforeAll(async () => {
    const test = createTestDatabase();
    cleanup = test.cleanup;
    storageDir = mkdtempSync(join(tmpdir(), 'jasno-drafts-'));
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
    token = await register('drafts@example.org');
    other = await register('fremd-drafts@example.org');
    cabinetId = (
      await db.cabinet.findFirstOrThrow({
        where: { email: 'drafts@example.org' },
      })
    ).id;
  }, 60000);

  afterAll(async () => {
    await app.close();
    await cleanup();
    rmSync(storageDir, { recursive: true, force: true });
  });

  afterEach(() => vi.restoreAllMocks());

  it('письмо 01: черновик DE и RU из подтверждённых фактов, проверка пройдена, событие в деле', async () => {
    const { caseId, letterId } = await letterInCase(
      '01_jobcenter_request.pdf',
      true,
    );
    const q = await http()
      .get(`/letters/${letterId}/draft-questions`)
      .set(auth())
      .expect(200);
    expect(q.body.questions.map((x: { id: string }) => x.id)).toEqual([
      'WHICH_DOCUMENTS',
      'DEADLINE',
      'REASON',
      'FORMAT',
    ]);

    const res = await draft(caseId, {
      kind: 'CLARIFICATION',
      letterId,
      questionId: 'WHICH_DOCUMENTS',
    }).expect(201);
    expect(res.body).toMatchObject({
      kind: 'CLARIFICATION',
      letterId,
      questionId: 'WHICH_DOCUMENTS',
      stale: false,
    });
    expect(res.body.germanText).toContain('Ihr Zeichen: JC-2026-1001');
    expect(res.body.germanText).toContain('Anna Muster');
    expect(res.body.russianText).toContain('цитата из письма на немецком');
    expect(res.body.verification.passed).toBe(true);
    expect(
      res.body.verification.checks.some((c: { name: string }) =>
        c.name.startsWith('ru:'),
      ),
    ).toBe(true);

    const got = await http()
      .get(`/drafts/${res.body.id}`)
      .set(auth())
      .expect(200);
    expect(got.body.germanText).toBe(res.body.germanText);
    const kase = await http().get(`/cases/${caseId}`).set(auth()).expect(200);
    expect(kase.body.timeline[0].type).toBe('DRAFT_PREPARED');
  });

  it('нет подтверждённых фактов: 409; недоступный вопрос: 422', async () => {
    const { caseId, letterId } = await letterInCase(
      '01_jobcenter_request.pdf',
      false,
    );
    expect(
      (
        await draft(caseId, {
          kind: 'CLARIFICATION',
          letterId,
          questionId: 'REASON',
        }).expect(409)
      ).body.code,
    ).toBe('NO_CONFIRMED_CLAIMS');
    const confirmed = await letterInCase('01_jobcenter_request.pdf', true);
    expect(
      (
        await draft(confirmed.caseId, {
          kind: 'CLARIFICATION',
          letterId: confirmed.letterId,
          questionId: 'AMOUNT',
        }).expect(422)
      ).body.code,
    ).toBe('QUESTION_NOT_AVAILABLE');
  });

  it('WIDERSPRUCH: 422 LEGAL_REFERRAL со списком консультаций, ничего не сохраняется', async () => {
    const { caseId } = await letterInCase('04_buergeramt.pdf', true);
    const before = await db.draft.count();
    const res = await draft(caseId, { kind: 'WIDERSPRUCH' }).expect(422);
    expect(res.body.code).toBe('LEGAL_REFERRAL');
    expect(res.body.details.places).toContain('Verbraucherzentrale');
    expect(await db.draft.count()).toBe(before);
  });

  it('смешение писем: письмо другого дела или из входящих — 404', async () => {
    const a = await letterInCase('01_jobcenter_request.pdf', true);
    const b = await letterInCase('04_buergeramt.pdf', true);
    await draft(a.caseId, {
      kind: 'CLARIFICATION',
      letterId: b.letterId,
      questionId: 'REASON',
    }).expect(404);
    const inbox = await http()
      .post('/letters')
      .set(auth())
      .attach('files', fixture('06_multiple_deadlines.pdf'), 'x.pdf')
      .expect(201);
    await draft(a.caseId, {
      kind: 'CLARIFICATION',
      letterId: inbox.body.letter.id,
      questionId: 'REASON',
    }).expect(404);
    expect(await db.draft.count({ where: { caseId: a.caseId } })).toBe(0);
  });

  it('профиль или факт изменились во время сборки: 409, ни черновика, ни события', async () => {
    const { caseId, letterId, claims } = await letterInCase(
      '01_jobcenter_request.pdf',
      true,
    );
    const original = VerificationService.prototype.verify;
    const changeDuringBuild = (change: () => Promise<unknown>) =>
      vi
        .spyOn(VerificationService.prototype, 'verify')
        .mockImplementation(async function (this: VerificationService, input) {
          await change();
          return original.call(this, input);
        });

    changeDuringBuild(() =>
      db.cabinet.update({
        where: { id: cabinetId },
        data: { profile: { ...PERSON, address: 'Neue Str. 2, 20095 Hamburg' } },
      }),
    );
    const profileChanged = await draft(caseId, {
      kind: 'CLARIFICATION',
      letterId,
      questionId: 'REASON',
    }).expect(409);
    expect(profileChanged.body.code).toBe('DRAFT_SOURCES_CHANGED');
    vi.restoreAllMocks();

    const authority = claims.find((c) => c.kind === 'AUTHORITY')!;
    changeDuringBuild(() =>
      db.claim.update({
        where: { id: authority.id },
        data: { status: 'REJECTED' },
      }),
    );
    const factChanged = await draft(caseId, {
      kind: 'CLARIFICATION',
      letterId,
      questionId: 'REASON',
    }).expect(409);
    expect(factChanged.body.code).toBe('DRAFT_SOURCES_CHANGED');

    expect(await db.draft.count({ where: { caseId } })).toBe(0);
    expect(
      await db.event.count({ where: { caseId, type: 'DRAFT_PREPARED' } }),
    ).toBe(0);
  });

  it('чужой черновик и чужое дело: 404; изменение факта делает черновик устаревшим', async () => {
    const { caseId, letterId, claims } = await letterInCase(
      '01_jobcenter_request.pdf',
      true,
    );
    const res = await draft(caseId, {
      kind: 'CLARIFICATION',
      letterId,
      questionId: 'DEADLINE',
    }).expect(201);
    await http().get(`/drafts/${res.body.id}`).set(auth(other)).expect(404);
    await draft(
      caseId,
      { kind: 'CLARIFICATION', letterId, questionId: 'DEADLINE' },
      other,
    ).expect(404);
    await http()
      .get(`/letters/${letterId}/draft-questions`)
      .set(auth(other))
      .expect(404);

    const caseNo = claims.find((c) => c.kind === 'CASE_NUMBER')!;
    await http()
      .post(`/letters/${letterId}/claims/${caseNo.id}/correct`)
      .set(auth())
      .send({ value: 'JC-2026-1002' })
      .expect(200);
    expect(
      (await http().get(`/drafts/${res.body.id}`).set(auth()).expect(200)).body
        .stale,
    ).toBe(true);
  });

  it('изменение имени или адреса в профиле делает черновики устаревшими; язык — нет', async () => {
    const { caseId, letterId } = await letterInCase('04_buergeramt.pdf', true);
    const res = await draft(caseId, {
      kind: 'CLARIFICATION',
      letterId,
      questionId: 'REASON',
    }).expect(201);
    await http()
      .patch('/cabinet')
      .set(auth())
      .send({ language: 'ru' })
      .expect(200);
    expect(
      (await http().get(`/drafts/${res.body.id}`).set(auth())).body.stale,
    ).toBe(false);
    await http()
      .patch('/cabinet')
      .set(auth())
      .send({ profile: { address: 'Andere Str. 3, 50667 Köln' } })
      .expect(200);
    expect(
      (await http().get(`/drafts/${res.body.id}`).set(auth())).body.stale,
    ).toBe(true);
    await db.cabinet.update({
      where: { id: cabinetId },
      data: { profile: PERSON },
    });
  });
});
