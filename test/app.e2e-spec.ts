import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { AppModule } from '../src/app.module.js';
import { ApiErrorFilter } from '../src/workflow/error.filter.js';
import { LLM_PROVIDER, FakeLlmProvider } from '../src/llm/provider.js';
import { DemoLlmProvider } from '../src/llm/demo.provider.js';
import { CasesService } from '../src/cases/cases.service.js';
import { draftTemplate } from '../src/drafting/templates.js';
let app: INestApplication;
let fake: FakeLlmProvider;
const demo = new DemoLlmProvider();
let queue: (string | Error)[];
async function responseFor(name: string) {
  const f = JSON.parse(readFileSync(`fixtures/letters/${name}.json`, 'utf8'));
  return (
    await demo.complete({
      promptName: 'extract',
      prompt: '',
      variables: { text: f.text },
    })
  ).content;
}
async function create(title = 'Synthetic test') {
  const r = await request(app.getHttpServer())
    .post('/cases')
    .send({ title })
    .expect(201);
  return r.body.id as string;
}
async function upload(id: string, name = '01_jobcenter_request') {
  queue.push(await responseFor(name));
  return request(app.getHttpServer())
    .post(`/cases/${id}/letters`)
    .attach('file', `fixtures/letters/${name}.pdf`)
    .expect(201);
}
beforeEach(async () => {
  queue = [];
  fake = new FakeLlmProvider(queue);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LLM_PROVIDER)
    .useValue(fake)
    .compile();
  app = module.createNestApplication();
  app.useGlobalFilters(new ApiErrorFilter());
  await app.init();
});
afterEach(async () => {
  await app.close();
});
it('ingests, stores USER/UNCONFIRMED, reviews facts and prepares a verified draft', async () => {
  const id = await create();
  await upload(id);
  let state = (
    await request(app.getHttpServer()).get(`/cases/${id}`).expect(200)
  ).body;
  expect(
    state.claims.every((c: { status: string }) => c.status === 'UNCONFIRMED'),
  ).toBe(true);
  await request(app.getHttpServer()).post(`/cases/${id}/draft`).expect(409);
  queue.push(
    JSON.stringify({
      claims: [{ text: 'Я отправил выписки по почте', topic: 'delivery' }],
      questions: ['Когда отправили?', 'Есть подтверждение?'],
    }),
  );
  const dialogue = await request(app.getHttpServer())
    .post(`/cases/${id}/messages`)
    .send({ text: 'Я отправил выписки по почте' })
    .expect(201);
  const user = dialogue.body.state.claims.find(
    (c: { basis: string }) => c.basis === 'USER',
  );
  expect(user.status).toBe('UNCONFIRMED');
  await request(app.getHttpServer())
    .post(`/cases/${id}/claims/${user.id}/confirm`)
    .expect(422);
  for (const c of state.claims)
    await request(app.getHttpServer())
      .post(`/cases/${id}/claims/${c.id}/confirm`)
      .expect(201);
  const confirmed = await app.get(CasesService).getConfirmedClaims(id);
  queue.push(JSON.stringify(draftTemplate(confirmed)));
  const prepared = await request(app.getHttpServer())
    .post(`/cases/${id}/draft`)
    .expect(201);
  expect(prepared.body.report.passed).toBe(true);
  expect(prepared.body.draft.claimIds).not.toContain(user.id);
  state = (await request(app.getHttpServer()).get(`/cases/${id}`)).body;
  expect(state.nearestDeadline.date.slice(0, 10)).toBe('2026-11-30');
  const traces = await request(app.getHttpServer())
    .get(`/cases/${id}/trace`)
    .expect(200);
  expect(traces.body).toHaveLength(3);
}, 30000);
it('moves letters only after scoped human link confirmation; repeated requests do not refute sending', async () => {
  const target = await create();
  await upload(target);
  queue.push(
    JSON.stringify({
      claims: [{ text: 'Я отправил выписки', topic: 'delivery' }],
      questions: ['Есть подтверждение?'],
    }),
  );
  await request(app.getHttpServer())
    .post(`/cases/${target}/messages`)
    .send({ text: 'Я отправил выписки' })
    .expect(201);
  const incoming = await create();
  const received = await upload(incoming, '02_jobcenter_repeat');
  const suggestion = received.body.linkSuggestions.find(
    (s: { targetCaseId: string }) => s.targetCaseId === target,
  );
  expect(suggestion.status).toBe('PENDING');
  expect((await app.get(CasesService).state(target)).letters).toHaveLength(1);
  await request(app.getHttpServer())
    .post(`/cases/${target}/links/${suggestion.id}/confirm`)
    .expect(404);
  const moved = await request(app.getHttpServer())
    .post(`/cases/${incoming}/links/${suggestion.id}/confirm`)
    .expect(201);
  expect(moved.body.letters).toHaveLength(2);
  expect(
    moved.body.claims.find((c: { basis: string }) => c.basis === 'USER').status,
  ).toBe('UNCONFIRMED');
  await request(app.getHttpServer())
    .post(`/cases/${incoming}/links/${suggestion.id}/confirm`)
    .expect(409);
}, 30000);
it('supersedes a user statement only after human review of a named-document receipt', async () => {
  const id = await create();
  queue.push(
    JSON.stringify({
      claims: [{ text: 'Я отправил выписки из банка', topic: 'delivery' }],
      questions: ['Есть подтверждение?'],
    }),
  );
  await request(app.getHttpServer())
    .post(`/cases/${id}/messages`)
    .send({ text: 'Я отправил выписки из банка' })
    .expect(201);
  await upload(id, '03_jobcenter_receipt');
  const state = await app.get(CasesService).state(id);
  const receipt = state.claims.find((c) => c.topic === 'requirement')!;
  const result = await request(app.getHttpServer())
    .post(`/cases/${id}/claims/${receipt.id}/confirm`)
    .expect(201);
  const user = result.body.claims.find(
    (c: { basis: string }) => c.basis === 'USER',
  );
  expect(user.status).toBe('SUPERSEDED');
  expect(user.supersededById).toBe(receipt.id);
  expect(user.reason).toContain('не доказывает дату отправки');
  expect(
    result.body.timeline.some((e: { type: string }) => e.type === 'REVISION'),
  ).toBe(true);
}, 30000);
it('preserves domain state on exhausted model failures and records all errors', async () => {
  const id = await create();
  queue.push('bad', '{}', new Error('offline'));
  await request(app.getHttpServer())
    .post(`/cases/${id}/letters`)
    .attach('file', 'fixtures/letters/01_jobcenter_request.pdf')
    .expect(502);
  const state = await app.get(CasesService).state(id);
  expect(state.letters).toHaveLength(0);
  expect(state.claims).toHaveLength(0);
  expect(await app.get(CasesService).trace(id)).toHaveLength(3);
  queue.push('bad', 'bad', 'bad');
  await request(app.getHttpServer())
    .post(`/cases/${id}/messages`)
    .send({ text: 'test' })
    .expect(502);
  expect((await app.get(CasesService).state(id)).messages).toHaveLength(0);
}, 30000);
it('rejects a fabricated draft and never stores it', async () => {
  const id = await create();
  await upload(id);
  for (const c of (await app.get(CasesService).state(id)).claims)
    await request(app.getHttpServer())
      .post(`/cases/${id}/claims/${c.id}/confirm`)
      .expect(201);
  queue.push(
    JSON.stringify({
      germanText: 'Ich habe 99999 EUR überwiesen.',
      russianExplanation: 'test',
      usedClaimIds: ['invented'],
    }),
  );
  const r = await request(app.getHttpServer())
    .post(`/cases/${id}/draft`)
    .expect(422);
  expect(r.body.code).toBe('DRAFT_VERIFICATION_FAILED');
  expect((await app.get(CasesService).state(id)).drafts).toHaveLength(0);
}, 30000);
it('validates DTOs, file signatures and missing cases using a unified error shape', async () => {
  const invalid = await request(app.getHttpServer())
    .post('/cases')
    .send({ title: '', extra: true })
    .expect(422);
  expect(invalid.body).toHaveProperty('code');
  const id = await create();
  await request(app.getHttpServer())
    .post(`/cases/${id}/letters`)
    .attach('file', Buffer.from('fake'), {
      filename: 'fake.pdf',
      contentType: 'application/pdf',
    })
    .expect(422);
  await request(app.getHttpServer()).post(`/cases/${id}/letters`).expect(422);
  await request(app.getHttpServer())
    .get('/cases/c000000000000000000000000')
    .expect(404);
  await request(app.getHttpServer())
    .post(`/cases/${id}/letters`)
    .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), {
      filename: 'oversized.pdf',
      contentType: 'application/pdf',
    })
    .expect(422);
  expect((await app.get(CasesService).state(id)).letters).toHaveLength(0);
});
