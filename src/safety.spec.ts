import { ConfigService } from '@nestjs/config';
import { environmentSchema } from './config/config.module.js';
import { LlmService, LlmValidationError } from './llm/llm.service.js';
import { FakeLlmProvider } from './llm/provider.js';
import { DemoLlmProvider } from './llm/demo.provider.js';
import { PromptRegistry } from './llm/prompt-registry.js';
import { TraceService } from './llm/trace.service.js';
import {
  ExtractionService,
  quoteMatches,
} from './extraction/extraction.service.js';
import { z } from 'zod';
import { DocumentsService } from './documents/documents.service.js';
import { OcrService } from './documents/ocr.service.js';
import { VerificationService } from './drafting/verification.service.js';
import { DraftService } from './drafting/draft.service.js';
import { TimelineService } from './cases/timeline.service.js';
import type { CasesService } from './cases/cases.service.js';
const config = new ConfigService(environmentSchema.parse({}));
const fakeCases = {
  recordCall: vi.fn().mockResolvedValue({}),
  trace: vi.fn().mockResolvedValue([]),
};
const trace = new TraceService(fakeCases as unknown as CasesService);
function llm(responses: (string | Error)[]) {
  const provider = new FakeLlmProvider(responses);
  return {
    provider,
    service: new LlmService(provider, new PromptRegistry(), trace),
  };
}
beforeEach(() => vi.clearAllMocks());
describe('Configuration and prompts', () => {
  it('requires credentials in real mode and refuses demo production', () => {
    expect(environmentSchema.safeParse({ LLM_MODE: 'openai' }).success).toBe(
      false,
    );
    expect(
      environmentSchema.safeParse({ NODE_ENV: 'production' }).success,
    ).toBe(false);
    expect(
      environmentSchema.safeParse({ OCR_MIN_CONFIDENCE: 101 }).success,
    ).toBe(false);
  });
  it('selects immutable prompt versions and rejects traversal', () => {
    const prompts = new PromptRegistry();
    expect(prompts.get('extract').version).toBe(1);
    expect(() => prompts.get('../extract')).toThrow();
    expect(() => prompts.get('extract', 99)).toThrow();
  });
});
describe('LLM gateway and traces', () => {
  it('validates, retries and records every attempt before return', async () => {
    const { service, provider } = llm(['not json', '{"n":"bad"}', '{"n":5}']);
    expect(
      await service.call({
        promptName: 'extract',
        variables: { text: 'test' },
        schema: z.object({ n: z.number() }),
      }),
    ).toEqual({ n: 5 });
    expect(fakeCases.recordCall).toHaveBeenCalledTimes(3);
    expect(fakeCases.recordCall.mock.calls.map((c) => c[0].error)).toEqual([
      true,
      true,
      false,
    ]);
    expect(provider.requests[1].prompt).toContain('Previous validation error');
    expect(fakeCases.recordCall.mock.calls[0][0].promptVersion).toBe(1);
  });
  it('stops after two retries and preserves provider failures in trace', async () => {
    const { service } = llm([new Error('network'), '{}', '{}']);
    await expect(
      service.call({
        promptName: 'extract',
        variables: {},
        schema: z.object({ required: z.string() }),
      }),
    ).rejects.toBeInstanceOf(LlmValidationError);
    expect(fakeCases.recordCall).toHaveBeenCalledTimes(3);
  });
  it('does not return a result when the trace cannot be persisted', async () => {
    fakeCases.recordCall.mockRejectedValueOnce(
      new Error('storage unavailable'),
    );
    const { service } = llm(['{"n":1}']);
    await expect(
      service.call({
        promptName: 'extract',
        variables: {},
        schema: z.object({ n: z.number() }),
      }),
    ).rejects.toThrow('storage unavailable');
  });
});
describe('Extraction evidence guard', () => {
  const text =
    'Jobcenter Musterstadt\nAktenzeichen: JC-123\nDatum: 11.11.2026\nBitte reichen Sie die Kontoauszüge ein.\nBitte antworten Sie bis zum 30.11.2026.';
  async function extracted() {
    return JSON.parse(
      (
        await new DemoLlmProvider().complete({
          promptName: 'extract',
          prompt: '',
          variables: { text },
        })
      ).content,
    );
  }
  it('discards invented quotes, values, dates and wrong page numbers', async () => {
    const data = await extracted();
    data.authority.quote = 'Invented';
    data.caseNumber.value = 'JC-999';
    data.deadlines[0].date = '2099-12-31';
    data.requirements[0].page = 2;
    const { service } = llm([JSON.stringify(data)]);
    const result = await new ExtractionService(service, config).extract(text);
    expect(result.authority.value).toBeNull();
    expect(result.caseNumber.value).toBeNull();
    expect(result.requirements[0].value).toBeNull();
    expect(result.deadlines).toEqual([]);
  });
  it('caps field confidence by the actual OCR page confidence', async () => {
    const data = await extracted();
    const { service } = llm([JSON.stringify(data)]);
    const result = await new ExtractionService(service, config).extract(
      text,
      undefined,
      {
        text,
        pages: [{ text, confidence: 64 }],
        source: 'OCR',
        sourceType: 'IMAGE',
        readable: true,
      },
    );
    expect(result.authority.confidence).toBe(0.64);
    expect(result.deadlines[0].confidence).toBe(0.64);
  });
  it('only normalizes and allows small edit distance for OCR', () => {
    expect(
      quoteMatches('Bitte   senden\nSie', 'Bitte senden Sie', true, 0.03),
    ).toBe(true);
    expect(
      quoteMatches('Bitte   senden\nSie', 'Bitte senden Sie', false, 0.03),
    ).toBe(false);
    expect(
      quoteMatches(
        'Bestätigung der Unterlagen',
        'Bestatigung der Unterlagen',
        true,
        0.05,
      ),
    ).toBe(true);
    expect(quoteMatches('Hallo', 'Falscher Text', true, 0.03)).toBe(false);
  });
});
describe('Document boundary', () => {
  const documents = new DocumentsService(
    { recognize: vi.fn() } as unknown as OcrService,
    config,
  );
  it('rejects empty, oversized, mismatched and spoofed uploads', async () => {
    for (const buffer of [
      Buffer.alloc(0),
      Buffer.alloc(10 * 1024 * 1024 + 1),
      Buffer.from('not a pdf'),
    ])
      await expect(
        documents.parse({
          buffer,
          mimetype: 'application/pdf',
          originalname: 'test.pdf',
        }),
      ).rejects.toMatchObject({ status: 422 });
  });
});
describe('Draft and timeline guards', () => {
  it('rejects fabricated numbers and claim identifiers', () => {
    const report = new VerificationService().verify(
      {
        germanText: 'Aktenzeichen 999999. Bitte bis zum 01.01.2000 antworten.',
        russianExplanation: 'test',
        usedClaimIds: ['unknown'],
      },
      [],
    );
    expect(report.passed).toBe(false);
    expect(
      report.checks.find((c) => c.name === 'numbers-dates-references')?.passed,
    ).toBe(false);
    expect(
      report.checks.find((c) => c.name === 'no-past-future-deadlines')?.passed,
    ).toBe(false);
  });
  it('rejects invented facts without numbers too', () => {
    const report = new VerificationService().verify(
      {
        germanText: 'Ich habe bereits alle Dokumente eingereicht.',
        russianExplanation: 'test',
        usedClaimIds: [],
      },
      [],
    );
    expect(
      report.checks.find((c) => c.name === 'evidence-template')?.passed,
    ).toBe(false);
  });
  it('delegates drafting through the sole model gateway', async () => {
    const gateway = { call: vi.fn().mockResolvedValue({}) };
    await new DraftService(gateway as unknown as LlmService).generate([], {
      caseId: 'test',
    });
    expect(gateway.call.mock.calls[0][0].promptName).toBe('draft');
  });
  it('has no nearest deadline when there are no confirmed future claims', () => {
    const result = new TimelineService().build([], [], [], []);
    expect(result.nearestDeadline).toBeNull();
  });
});
