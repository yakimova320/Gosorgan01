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

type Claim = { id: string; kind: string; value: string; status: string };

describe('Объяснение письма (e2e, B08)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let cleanup: () => Promise<void>;
  let storageDir: string;
  let token: string;
  let other: string;
  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const realComplete = DemoAdapter.prototype.complete;

  async function register(email: string) {
    const res = await http()
      .post('/auth/register')
      .send({
        email,
        password: 'mein-langes-Passwort',
        consent: true,
        aiConsent: true,
        ...PERSON,
      })
      .expect(201);
    return res.body.sessionToken as string;
  }

  async function upload(name: string) {
    const res = await http()
      .post('/letters')
      .set(auth())
      .attach('files', fixture(name), name)
      .expect(201);
    return res.body as { letter: { id: string }; claims: Claim[] };
  }

  /** Подменить ответы промпта explain; остальное — обычный demo. */
  function scriptExplain(
    handler: (req: AdapterRequest) => Promise<string | AdapterError>,
  ) {
    const calls: AdapterRequest[] = [];
    vi.spyOn(DemoAdapter.prototype, 'complete').mockImplementation(
      async function (this: DemoAdapter, req: AdapterRequest) {
        if (req.promptName !== 'explain') return realComplete.call(this, req);
        calls.push(req);
        const next = await handler(req);
        if (next instanceof AdapterError) throw next;
        return { text: next };
      },
    );
    return calls;
  }

  beforeAll(async () => {
    const test = createTestDatabase();
    cleanup = test.cleanup;
    storageDir = mkdtempSync(join(tmpdir(), 'jasno-explain-'));
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
    token = await register('explain@example.org');
    other = await register('fremd-explain@example.org');
  }, 60000);

  afterAll(async () => {
    await app.close();
    await cleanup();
    rmSync(storageDir, { recursive: true, force: true });
  });

  afterEach(() => vi.restoreAllMocks());

  it('объяснение 01: утверждения со ссылками на факты; второй раз из кэша без модели', async () => {
    const up = await upload('01_jobcenter_request.pdf');
    const first = await http()
      .post(`/letters/${up.letter.id}/explain`)
      .set(auth())
      .expect(200);
    expect(first.body.cached).toBe(false);
    expect(first.body.about.claimIds.length).toBeGreaterThan(0);
    expect(
      first.body.actions.every(
        (a: { claimIds: string[] }) => a.claimIds.length > 0,
      ),
    ).toBe(true);
    // K08: требование письма по-русски и немецкий оригинал из факта
    expect(first.body.requests).toEqual([
      {
        claimId: expect.any(String),
        ru: 'Прислать: выписки с банковского счёта за сентябрь.',
        de: 'Bitte reichen Sie die Kontoauszüge für September ein.',
        unconfirmed: true,
      },
    ]);
    expect(first.body.deadlines).toEqual([
      {
        date: '2026-11-30',
        claimId: expect.any(String),
        kind: expect.any(String),
        confirmed: false,
      },
    ]);
    expect(first.body.unconfirmed).toBe(true);

    const calls = scriptExplain(async () => 'не должно вызываться');
    const second = await http()
      .post(`/letters/${up.letter.id}/explain?lang=ru`)
      .set(auth())
      .expect(200);
    expect(second.body.cached).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('изменение фактов: кэш не используется; отклонённый факт не уходит в модель', async () => {
    const up = await upload('01_jobcenter_request.pdf');
    await http()
      .post(`/letters/${up.letter.id}/explain`)
      .set(auth())
      .expect(200);
    const caseNo = up.claims.find((c) => c.kind === 'CASE_NUMBER')!;
    await http()
      .post(`/letters/${up.letter.id}/claims/confirm`)
      .set(auth())
      .send({ reject: [caseNo.id] })
      .expect(200);

    const calls = scriptExplain(async (req) =>
      realComplete.call(new DemoAdapter(), req).then((r) => r.text),
    );
    const again = await http()
      .post(`/letters/${up.letter.id}/explain`)
      .set(auth())
      .expect(200);
    expect(again.body.cached).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].variables.facts).not.toContain(caseNo.id);
  });

  it('06: все подтверждённые сроки письма в объяснении', async () => {
    const up = await upload('06_multiple_deadlines.pdf');
    const deadlines = up.claims.filter((c) => c.kind === 'DEADLINE');
    expect(deadlines).toHaveLength(2);
    await http()
      .post(`/letters/${up.letter.id}/claims/confirm`)
      .set(auth())
      .send({ confirm: deadlines.map((d) => d.id) })
      .expect(200);
    const res = await http()
      .post(`/letters/${up.letter.id}/explain`)
      .set(auth())
      .expect(200);
    expect(
      res.body.deadlines.map((d: { date: string; confirmed: boolean }) => [
        d.date,
        d.confirmed,
      ]),
    ).toEqual([
      ['2026-12-01', true],
      ['2026-12-10', true],
    ]);
  });

  it('факты изменились, пока модель отвечала: 409 CLAIMS_CHANGED, результат не кэшируется', async () => {
    const up = await upload('01_jobcenter_request.pdf');
    const authority = up.claims.find((c) => c.kind === 'AUTHORITY')!;
    scriptExplain(async (req) => {
      await db.claim.update({
        where: { id: authority.id },
        data: { status: 'CONFIRMED' },
      });
      return (await realComplete.call(new DemoAdapter(), req)).text;
    });
    const res = await http()
      .post(`/letters/${up.letter.id}/explain`)
      .set(auth())
      .expect(409);
    expect(res.body.code).toBe('CLAIMS_CHANGED');
    expect(res.body.about).toBeUndefined();
    expect(
      (await db.letter.findUniqueOrThrow({ where: { id: up.letter.id } }))
        .explanation,
    ).toBeNull();
  });

  it('дата не из фактов 3 раза: 422 DATES_NOT_VERIFIED, журнал есть', async () => {
    const up = await upload('01_jobcenter_request.pdf');
    const authority = up.claims.find((c) => c.kind === 'AUTHORITY')!;
    const bad = JSON.stringify({
      about: { text: 'Срок до 15.12.2099.', claimIds: [authority.id] },
      actions: [],
    });
    const calls = scriptExplain(async () => bad);
    const res = await http()
      .post(`/letters/${up.letter.id}/explain`)
      .set(auth())
      .expect(422);
    expect(res.body.code).toBe('DATES_NOT_VERIFIED');
    expect(calls).toHaveLength(3);
    const log = await db.llmCall.findFirstOrThrow({
      where: { letterId: up.letter.id, promptName: 'explain' },
    });
    expect(log).toMatchObject({ ok: false, attempts: 3 });
  });

  it('квота: LLM_QUOTA; нет действующих фактов: NO_CLAIMS; lang=fr: 400; чужое: 404', async () => {
    const up = await upload('01_jobcenter_request.pdf');
    scriptExplain(async () => new AdapterError('QUOTA', '429', 60_000));
    expect(
      (
        await http()
          .post(`/letters/${up.letter.id}/explain`)
          .set(auth())
          .expect(503)
      ).body.code,
    ).toBe('LLM_QUOTA');
    vi.restoreAllMocks();

    await http()
      .post(`/letters/${up.letter.id}/explain?lang=fr`)
      .set(auth())
      .expect(400);
    await http()
      .post(`/letters/${up.letter.id}/explain`)
      .set(auth(other))
      .expect(404);

    await http()
      .post(`/letters/${up.letter.id}/claims/confirm`)
      .set(auth())
      .send({ reject: up.claims.map((c) => c.id) })
      .expect(200);
    expect(
      (
        await http()
          .post(`/letters/${up.letter.id}/explain`)
          .set(auth())
          .expect(409)
      ).body.code,
    ).toBe('NO_CLAIMS');
  });
});
