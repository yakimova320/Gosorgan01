import { readFileSync } from 'node:fs';
import { PDFParse } from 'pdf-parse';
import type { Claim, Deadline, Letter } from '@prisma/client';
import { ConfigService, environmentSchema } from './config/config.module.js';
import { DocumentsService } from './documents/documents.service.js';
import { OcrService } from './documents/ocr.service.js';
import { TimelineService } from './cases/timeline.service.js';
import { RevisionService } from './dialogue/revision.service.js';
import { DialogueService } from './dialogue/dialogue.service.js';
import type { CasesService } from './cases/cases.service.js';
import type { LlmService } from './llm/llm.service.js';
import { OpenAiProvider } from './llm/openai.provider.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('rejects a PDF above twenty pages before OCR', async () => {
  vi.spyOn(PDFParse.prototype, 'getInfo').mockResolvedValue({
    total: 21,
  } as Awaited<ReturnType<PDFParse['getInfo']>>);
  const recognize = vi.fn();
  const documents = new DocumentsService(
    { recognize } as unknown as OcrService,
    new ConfigService(environmentSchema.parse({})),
  );
  await expect(
    documents.parse({
      buffer: readFileSync('fixtures/letters/01_jobcenter_request.pdf'),
      originalname: 'test.pdf',
      mimetype: 'application/pdf',
    }),
  ).rejects.toMatchObject({ status: 422 });
  expect(recognize).not.toHaveBeenCalled();
});

it('excludes past, unconfirmed and superseded deadlines while retaining today', () => {
  const claims = [
    { id: 'a', status: 'CONFIRMED' },
    { id: 'b', status: 'UNCONFIRMED' },
    { id: 'c', status: 'SUPERSEDED' },
  ] as Claim[];
  const deadlines = [
    { date: new Date('2026-11-10'), claim: claims[0] },
    { date: new Date('2026-11-11'), claim: claims[0] },
    { date: new Date('2026-11-12'), claim: claims[1] },
    { date: new Date('2026-11-13'), claim: claims[2] },
  ] as (Deadline & { claim: Claim })[];
  const result = new TimelineService().build(
    [],
    deadlines,
    claims,
    [] as Letter[],
    new Date('2026-11-11T23:59:00Z'),
  );
  expect(result.nearestDeadline?.date.toISOString().slice(0, 10)).toBe(
    '2026-11-11',
  );
});

it('does not treat a negated receipt as confirmation', async () => {
  const user = {
    id: 'user',
    basis: 'USER',
    status: 'UNCONFIRMED',
    text: 'Я отправил выписки',
  } as Claim;
  const cases = {
    state: vi.fn().mockResolvedValue({ claims: [user] }),
    supersedeClaims: vi.fn().mockResolvedValue(undefined),
  };
  const revision = new RevisionService(cases as unknown as CasesService);
  const replacements = await revision.revise('case', [
    {
      id: 'doc',
      basis: 'DOCUMENT',
      status: 'CONFIRMED',
      quote: 'Wir bestätigen den Eingang Ihrer Kontoauszüge nicht.',
    } as Claim,
  ]);
  expect(replacements).toEqual([]);
  expect(cases.supersedeClaims).toHaveBeenCalledWith('case', []);
});

it('routes legal questions to a consultation without a model call', async () => {
  const llm = { call: vi.fn() };
  const cases = { state: vi.fn().mockResolvedValue({ openQuestions: [] }) };
  const result = await new DialogueService(
    llm as unknown as LlmService,
    cases as unknown as CasesService,
  ).handle('case', 'Как обжаловать решение?');
  expect(result.questions[0]).toContain('адвокату');
  expect(llm.call).not.toHaveBeenCalled();
});

it('keeps provider transport inside the gateway and records usage accurately', async () => {
  const transport = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { total_tokens: 25 },
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal('fetch', transport);
  const provider = new OpenAiProvider(
    new ConfigService(
      environmentSchema.parse({
        LLM_MODE: 'openai',
        LLM_API_KEY: 'synthetic-test-key',
      }),
    ),
  );
  expect(
    await provider.complete({
      prompt: 'test',
      promptName: 'extract',
      variables: {},
    }),
  ).toEqual({ content: '{"ok":true}', tokens: 25 });
  expect(transport.mock.calls[0][0]).toBe(
    'https://api.openai.com/v1/chat/completions',
  );
});

it('reports missing local OCR language data without starting a worker', async () => {
  const config = new ConfigService(
    environmentSchema.parse({
      OCR_LANG_PATH: '/tmp/razberemsya-absent-language-data',
    }),
  );
  await expect(
    new OcrService(config).recognize([Buffer.alloc(1)]),
  ).rejects.toMatchObject({ status: 503 });
});
