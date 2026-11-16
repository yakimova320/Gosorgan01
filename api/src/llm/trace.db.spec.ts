import { createTestDatabase } from '../../test/test-db.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DemoAdapter } from './adapters/demo.adapter.js';
import { LlmService } from './llm.service.js';
import { MaskingService } from './masking.service.js';
import { PromptRegistry } from './prompt-registry.js';
import { ExtractSchema } from './schemas/extract.schema.js';
import { TraceService } from './trace.service.js';

describe('LlmCall в базе', () => {
  let db: PrismaService;
  let cleanup: () => void;

  beforeAll(() => {
    const test = createTestDatabase();
    cleanup = test.cleanup;
    db = new PrismaService({ DATABASE_URL: test.url });
  }, 60000);

  afterAll(async () => {
    await db.$disconnect();
    cleanup();
  });

  it('вызов demo пишет строку, IBAN в input только меткой', async () => {
    const llm = new LlmService(
      new DemoAdapter(),
      new PromptRegistry(),
      new MaskingService(),
      new TraceService(db),
    );
    const letterText = [
      'Jobcenter Musterstadt',
      'Datum: 11.11.2026',
      'Aktenzeichen: JC-2026-1001',
      'IBAN: DE89 3704 0044 0532 0130 00',
      'Bitte antworten Sie bis zum 30.11.2026.',
    ].join('\n');

    const res = await llm.callWithTrace({
      prompt: 'extract',
      variables: { letterText },
      schema: ExtractSchema,
      context: { cabinetId: 'cab-1', letterId: 'let-1' },
    });
    expect(res.data.deadlines[0].value).toBe('2026-11-30');

    const row = await db.llmCall.findUniqueOrThrow({
      where: { id: res.llmCallId as string },
    });
    expect(row).toMatchObject({
      cabinetId: 'cab-1',
      letterId: 'let-1',
      promptName: 'extract',
      promptVersion: 1,
      provider: 'demo',
      ok: true,
      attempts: 1,
    });
    expect(row.input).toContain('[IBAN_1]');
    expect(row.input).not.toContain('DE89 3704 0044 0532 0130 00');
    expect(row.output).not.toContain('DE89');
  });
});
