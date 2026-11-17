import type { INestApplication } from '@nestjs/common';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.factory.js';
import { DemoAdapter } from '../src/llm/adapters/demo.adapter.js';
import { AdapterError, type AdapterRequest } from '../src/llm/llm.types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PERSON } from './person.js';
import { createTestDatabase } from './test-db.js';

const fixture = (name: string) =>
  readFileSync(
    resolve(import.meta.dirname, '..', '..', 'fixtures', 'letters', name),
  );
const expected = (id: string) =>
  (
    JSON.parse(fixture(`${id}.json`).toString('utf8')) as {
      expected: Record<string, unknown>;
    }
  ).expected as {
    authority: string;
    caseNumber: string;
    letterDate: string;
    requirements: string[];
    deadlines: string[];
  };

type Claim = {
  id: string;
  kind: string;
  value: string;
  quote: string | null;
  status: string;
  basis: string;
  supersedesId: string | null;
  relativeDeadline: boolean;
};

const EMPTY_EXTRACT = JSON.stringify({
  authority: { value: null, quote: null, page: null },
  caseNumber: { value: null, quote: null, page: null },
  letterDate: { value: null, quote: null, page: null },
  requirements: [],
  deadlines: [],
  amounts: [],
  relativeDeadlines: [],
});

describe('Факты письма (e2e, B06)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let cleanup: () => Promise<void>;
  let storageDir: string;
  let token: string;
  let otherToken: string;
  let cabinetId: string;
  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const upload = (name: string) =>
    http().post('/letters').set(auth()).attach('files', fixture(name), name);
  const realComplete = DemoAdapter.prototype.complete;

  /** demo-адаптер, где ответы отдельных промптов подменены (остальное — как обычно). */
  function scriptAdapter(
    script: Partial<Record<string, (string | AdapterError)[]>>,
  ) {
    const calls: string[] = [];
    vi.spyOn(DemoAdapter.prototype, 'complete').mockImplementation(
      async function (this: DemoAdapter, req: AdapterRequest) {
        calls.push(req.promptName);
        const next = script[req.promptName]?.shift();
        if (next instanceof AdapterError) throw next;
        if (typeof next === 'string') return { text: next };
        return realComplete.call(this, req);
      },
    );
    return calls;
  }

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

  beforeAll(async () => {
    const test = createTestDatabase();
    cleanup = test.cleanup;
    storageDir = mkdtempSync(join(tmpdir(), 'jasno-claims-'));
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
    token = await register('claims@example.org');
    otherToken = await register('fremd@example.org');
    cabinetId = (
      await db.cabinet.findFirstOrThrow({
        where: { email: 'claims@example.org' },
      })
    ).id;
  }, 60000);

  afterAll(async () => {
    await app.close();
    await cleanup();
    rmSync(storageDir, { recursive: true, force: true });
  });

  afterEach(() => vi.restoreAllMocks());

  it.each(['01_jobcenter_request', '04_buergeramt', '06_multiple_deadlines'])(
    '%s в demo: ведомство, номер, дата письма и сроки как в эталоне',
    async (id) => {
      const res = await upload(`${id}.pdf`).expect(201);
      const exp = expected(id);
      const claims = res.body.claims as Claim[];
      const one = (k: string) => claims.find((c) => c.kind === k)?.value;
      expect(one('AUTHORITY')).toBe(exp.authority);
      expect(one('CASE_NUMBER')).toBe(exp.caseNumber);
      expect(one('LETTER_DATE')).toBe(exp.letterDate);
      expect(
        res.body.deadlines.map((d: { date: string }) => d.date).sort(),
      ).toEqual([...exp.deadlines].sort());
      expect(
        claims.every(
          (c) =>
            c.basis === 'DOCUMENT' && c.status === 'UNCONFIRMED' && c.quote,
        ),
      ).toBe(true);
      expect(
        res.body.deadlines.every((d: { active: boolean }) => !d.active),
      ).toBe(true); // кандидаты
      expect(res.body.extraction).toEqual({ dropped: 0 });
    },
  );

  it('14_prompt_injection в demo: только факты письма (поведение модели проверяется live)', async () => {
    const res = await upload('14_prompt_injection.pdf').expect(201);
    const exp = expected('14_prompt_injection');
    expect(res.body.deadlines.map((d: { date: string }) => d.date)).toEqual(
      exp.deadlines,
    );
    expect(
      (res.body.claims as Claim[]).find((c) => c.kind === 'AUTHORITY')?.value,
    ).toBe(exp.authority);
  });

  it('15: срок без даты — отдельный факт без даты, срока-даты нет', async () => {
    const res = await upload('15_relative_deadline.pdf').expect(201);
    expect(res.body.deadlines).toEqual([]);
    const rel = (res.body.claims as Claim[]).find((c) => c.relativeDeadline);
    expect(rel).toMatchObject({
      kind: 'OTHER',
      value: 'innerhalb von zwei Wochen',
      status: 'UNCONFIRMED',
    });
  });

  it('цитата не из письма и выдуманный номер отбрасываются, считаются в dropped', async () => {
    scriptAdapter({
      extract: [
        JSON.stringify({
          ...JSON.parse(EMPTY_EXTRACT),
          authority: {
            value: 'Jobcenter Musterstadt',
            quote: 'Jobcenter Musterstadt',
            page: 1,
          },
          caseNumber: {
            value: 'JC-2026-9999',
            quote: 'Aktenzeichen: JC-2026-1001',
            page: 1,
          },
          requirements: [
            { value: 'Zahlen Sie 500 €.', quote: 'Zahlen Sie 500 €.', page: 1 },
          ],
        }),
      ],
    });
    const res = await upload('01_jobcenter_request.pdf').expect(201);
    expect((res.body.claims as Claim[]).map((c) => c.kind)).toEqual([
      'AUTHORITY',
    ]);
    expect(res.body.extraction).toEqual({ dropped: 2 });
  });

  it('фактов не найдено: нормальный ответ 201, а не ошибка', async () => {
    scriptAdapter({ extract: [EMPTY_EXTRACT] });
    const res = await upload('01_jobcenter_request.pdf').expect(201);
    expect(res.body.claims).toEqual([]);
  });

  it('сбой extract: LLM_FAILED, письма нет, журнал есть; квота: LLM_QUOTA', async () => {
    const before = await db.letter.count();
    scriptAdapter({
      extract: [
        new AdapterError('SERVER', 'x'),
        new AdapterError('SERVER', 'x'),
        new AdapterError('SERVER', 'x'),
      ],
    });
    await upload('01_jobcenter_request.pdf').expect(502);
    const call = await db.llmCall.findFirstOrThrow({
      where: { promptName: 'extract' },
      orderBy: { createdAt: 'desc' },
    });
    expect(call).toMatchObject({ ok: false, cabinetId, attempts: 3 });
    expect(await db.letter.count()).toBe(before);
    vi.restoreAllMocks();
    scriptAdapter({ extract: [new AdapterError('QUOTA', '429', 60_000)] });
    const quota = await upload('01_jobcenter_request.pdf').expect(503);
    expect(quota.body.code).toBe('LLM_QUOTA');
  });

  it('фото: на всю загрузку не больше 3 обращений к модели', async () => {
    // transcribe: неверный ответ, затем верный (2) → на extract остаётся 1
    let calls = scriptAdapter({
      transcribe: ['не JSON'],
      extract: ['не JSON'],
    });
    await upload('08_photo.jpg').expect(502);
    expect(calls).toEqual(['transcribe', 'transcribe', 'extract']);
    vi.restoreAllMocks();
    // transcribe дважды неверно: на extract не идёт, всего 2
    calls = scriptAdapter({ transcribe: ['не JSON', 'не JSON'] });
    await upload('08_photo.jpg').expect(502);
    expect(calls).toEqual(['transcribe', 'transcribe']);
    vi.restoreAllMocks();
    // всё с первого раза: 2 обращения
    calls = scriptAdapter({});
    await upload('08_photo.jpg').expect(201);
    expect(calls).toEqual(['transcribe', 'extract']);
  });

  describe('подтверждение, исправление, удаление', () => {
    let letterId: string;
    let claims: Claim[];
    const byKind = (k: string) => claims.find((c) => c.kind === k)!;

    beforeEach(async () => {
      const res = await upload('06_multiple_deadlines.pdf').expect(201);
      letterId = res.body.letter.id;
      claims = res.body.claims;
    });

    it('входящие и письмо; чужой кабинет: 404 везде', async () => {
      const inbox = await http()
        .get('/letters?inbox=true')
        .set(auth())
        .expect(200);
      expect(inbox.body.some((l: { id: string }) => l.id === letterId)).toBe(
        true,
      );
      await http().get(`/letters/${letterId}`).set(auth()).expect(200);
      const other = auth(otherToken);
      await http().get(`/letters/${letterId}`).set(other).expect(404);
      await http()
        .post(`/letters/${letterId}/claims/confirm`)
        .set(other)
        .send({ confirm: [claims[0].id] })
        .expect(404);
      await http()
        .post(`/letters/${letterId}/claims/${claims[0].id}/correct`)
        .set(other)
        .send({ value: 'x' })
        .expect(404);
      await http().delete(`/letters/${letterId}`).set(other).expect(404);
      await http().get('/letters?inbox=yes').set(auth()).expect(400);
    });

    it('confirm/reject одной транзакцией; повтор без изменений; противоположное решение: 409 и ничего не записано', async () => {
      const deadline = claims.filter((c) => c.kind === 'DEADLINE')[0];
      const authority = byKind('AUTHORITY');
      const caseNo = byKind('CASE_NUMBER');
      const res = await http()
        .post(`/letters/${letterId}/claims/confirm`)
        .set(auth())
        .send({ confirm: [deadline.id, authority.id], reject: [caseNo.id] })
        .expect(200);
      expect(
        res.body.deadlines.find(
          (d: { claimId: string }) => d.claimId === deadline.id,
        ).active,
      ).toBe(true);

      const again = await http()
        .post(`/letters/${letterId}/claims/confirm`)
        .set(auth())
        .send({ confirm: [deadline.id], reject: [caseNo.id] })
        .expect(200);
      expect(again.body.claims).toEqual(res.body.claims);

      const letterDate = byKind('LETTER_DATE');
      const conflict = await http()
        .post(`/letters/${letterId}/claims/confirm`)
        .set(auth())
        .send({ confirm: [letterDate.id, caseNo.id] })
        .expect(409);
      expect(conflict.body.code).toBe('CLAIM_STATE');
      const row = await db.claim.findUniqueOrThrow({
        where: { id: letterDate.id },
      });
      expect(row.status).toBe('UNCONFIRMED'); // транзакция откатилась

      await http()
        .post(`/letters/${letterId}/claims/confirm`)
        .set(auth())
        .send({ confirm: [authority.id], reject: [authority.id] })
        .expect(400);
    });

    it('исправление: новая USER-версия без цитаты, старая скрыта, срок заменён; повторное исправление старой: 409', async () => {
      const deadline = claims.filter((c) => c.kind === 'DEADLINE')[0];
      const res = await http()
        .post(`/letters/${letterId}/claims/${deadline.id}/correct`)
        .set(auth())
        .send({ value: '2026-12-24' })
        .expect(200);
      const fresh = (res.body.claims as Claim[]).find(
        (c) => c.supersedesId === deadline.id,
      )!;
      expect(fresh).toMatchObject({
        basis: 'USER',
        status: 'UNCONFIRMED',
        quote: null,
        value: '2026-12-24',
      });
      expect(
        (res.body.claims as Claim[]).some((c) => c.id === deadline.id),
      ).toBe(false);
      expect(
        res.body.deadlines.some(
          (d: { date: string; claimId: string }) =>
            d.date === '2026-12-24' && d.claimId === fresh.id,
        ),
      ).toBe(true);
      expect(
        (await db.claim.findUniqueOrThrow({ where: { id: deadline.id } }))
          .status,
      ).toBe('SUPERSEDED');

      await http()
        .post(`/letters/${letterId}/claims/${deadline.id}/correct`)
        .set(auth())
        .send({ value: '2026-12-25' })
        .expect(409);
      await http()
        .post(`/letters/${letterId}/claims/confirm`)
        .set(auth())
        .send({ confirm: [deadline.id] })
        .expect(409);
      const bad = await http()
        .post(`/letters/${letterId}/claims/${fresh.id}/correct`)
        .set(auth())
        .send({ value: '2026-02-30' })
        .expect(400);
      expect(bad.body.details.fields).toHaveProperty('value');
    });

    it('два одновременных исправления: одна действующая версия', async () => {
      const caseNo = byKind('CASE_NUMBER');
      const results = await Promise.all(
        ['FA-2026-0001', 'FA-2026-0002'].map((value) =>
          http()
            .post(`/letters/${letterId}/claims/${caseNo.id}/correct`)
            .set(auth())
            .send({ value }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const versions = await db.claim.findMany({
        where: { supersedesId: caseNo.id },
      });
      expect(versions).toHaveLength(1);
    });

    it('изменение фактов сбрасывает объяснение и помечает черновики дела stale', async () => {
      const kase = await db.case.create({
        data: { cabinetId, title: 'Finanzamt' },
      });
      await db.letter.update({
        where: { id: letterId },
        data: { caseId: kase.id, explanation: { about: 'x' } },
      });
      const used = byKind('CASE_NUMBER');
      const draft = await db.draft.create({
        data: {
          caseId: kase.id,
          kind: 'CLARIFICATION',
          germanText: 'x',
          russianText: 'x',
          claimIds: [used.id],
          claimSnapshot: {},
          verification: {},
        },
      });
      const other = await db.draft.create({
        data: {
          caseId: kase.id,
          kind: 'CLARIFICATION',
          germanText: 'y',
          russianText: 'y',
          claimIds: ['nope'],
          claimSnapshot: {},
          verification: {},
        },
      });
      await http()
        .post(`/letters/${letterId}/claims/confirm`)
        .set(auth())
        .send({ reject: [used.id] })
        .expect(200);
      expect(
        (await db.letter.findUniqueOrThrow({ where: { id: letterId } }))
          .explanation,
      ).toBeNull();
      expect(
        (await db.draft.findUniqueOrThrow({ where: { id: draft.id } })).stale,
      ).toBe(true);
      expect(
        (await db.draft.findUniqueOrThrow({ where: { id: other.id } })).stale,
      ).toBe(false);

      // возврат во входящие: письмо, факты и сроки без дела, черновики дела с его фактами stale
      await db.letter.update({
        where: { id: letterId },
        data: { explanation: { about: 'y' } },
      });
      await db.claim.updateMany({
        where: { letterId },
        data: { caseId: kase.id },
      });
      await http()
        .delete(`/letters/${letterId}?mode=inbox`)
        .set(auth())
        .expect(204);
      const after = await db.letter.findUniqueOrThrow({
        where: { id: letterId },
      });
      expect(after.caseId).toBeNull();
      expect(after.explanation).toBeNull();
      expect(
        await db.claim.count({ where: { letterId, caseId: { not: null } } }),
      ).toBe(0);
    });

    it('неизвестный mode: 400, письмо на месте; без mode: полное удаление', async () => {
      await http()
        .delete(`/letters/${letterId}?mode=inboks`)
        .set(auth())
        .expect(400);
      expect(await db.letter.count({ where: { id: letterId } })).toBe(1);
      await http().delete(`/letters/${letterId}`).set(auth()).expect(204);
      expect(await db.letter.count({ where: { id: letterId } })).toBe(0);
      expect(await db.claim.count({ where: { letterId } })).toBe(0);
      expect(await db.llmCall.count({ where: { letterId } })).toBe(0);
      await http().get(`/letters/${letterId}`).set(auth()).expect(404);
    });
  });
});
