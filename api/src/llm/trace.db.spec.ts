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
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const test = createTestDatabase();
    cleanup = test.cleanup;
    db = new PrismaService({ DATABASE_URL: test.url });
    // журнал кабинета пишется только для существующего кабинета (A01)
    await db.cabinet.create({
      data: {
        id: 'cab-1',
        email: 'trace@example.org',
        passwordHash: 'x',
        consentAt: new Date(),
      },
    });
  }, 60000);

  afterAll(async () => {
    await db.$disconnect();
    await cleanup();
  });

  it('кабинет удаляется или удалён: строка журнала не пишется', async () => {
    const trace = new TraceService(db);
    const entry = {
      promptName: 'extract',
      promptVersion: 2,
      provider: 'demo',
      model: 'demo',
      input: 'x',
      output: null,
      ok: true,
      error: null,
      attempts: 1,
      durationMs: 1,
      tokensIn: null,
      tokensOut: null,
    };
    await db.cabinet.create({
      data: {
        id: 'cab-del',
        email: 'trace-del@example.org',
        passwordHash: 'x',
        consentAt: new Date(),
        deletingAt: new Date(),
      },
    });
    expect(
      await trace.record({ ...entry, context: { cabinetId: 'cab-del' } }),
    ).toBeNull();
    expect(
      await trace.record({ ...entry, context: { cabinetId: 'cab-gone' } }),
    ).toBeNull();
    expect(
      await db.llmCall.count({
        where: { cabinetId: { in: ['cab-del', 'cab-gone'] } },
      }),
    ).toBe(0);
    // гость без кабинета пишется как раньше
    expect(
      await trace.record({ ...entry, context: { cabinetId: null } }),
    ).not.toBeNull();
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
      variables: { language: 'русский', lang: 'ru', letterText },
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
      promptVersion: 4, // последняя версия extract (поправка 8)
      provider: 'demo',
      ok: true,
      attempts: 1,
    });
    expect(row.input).toContain('[IBAN_1]');
    expect(row.input).not.toContain('DE89 3704 0044 0532 0130 00');
    expect(row.output).not.toContain('DE89');
  });
});
