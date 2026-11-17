import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ApiError } from '../common/api-error.js';
import { DemoAdapter } from './adapters/demo.adapter.js';
import { OpenAiAdapter } from './adapters/openai.adapter.js';
import {
  AdapterError,
  type AdapterRequest,
  type AdapterResponse,
  type LlmAdapter,
} from './llm.types.js';
import { LlmService, MAX_ATTEMPTS } from './llm.service.js';
import { MaskingService } from './masking.service.js';
import { PromptRegistry } from './prompt-registry.js';
import { ExtractSchema } from './schemas/extract.schema.js';
import {
  TranscribeSchema,
  checkTranscribe,
} from './schemas/transcribe.schema.js';
import type { TraceEntry, TraceService } from './trace.service.js';

const fixture = (name: string) =>
  readFileSync(
    resolve(import.meta.dirname, '..', '..', '..', 'fixtures', 'letters', name),
    'utf8',
  );

/** Адаптер, который отвечает по списку: строка = ответ модели, AdapterError = ошибка провайдера. */
class ScriptedAdapter implements LlmAdapter {
  readonly provider = 'test';
  readonly model = 'test-model';
  readonly requests: AdapterRequest[] = [];
  constructor(private readonly script: (string | AdapterError)[]) {}
  async complete(request: AdapterRequest): Promise<AdapterResponse> {
    this.requests.push(request);
    const next = this.script.shift();
    if (next === undefined) throw new Error('сценарий закончился');
    if (next instanceof AdapterError) throw next;
    return { text: next, tokensIn: 10, tokensOut: 5 };
  }
}

function setup(script: (string | AdapterError)[]) {
  const adapter = new ScriptedAdapter(script);
  const traces: TraceEntry[] = [];
  const trace = {
    record: vi.fn(async (e: TraceEntry) => (traces.push(e), 'call-1')),
  } as unknown as TraceService;
  const service = new LlmService(
    adapter,
    new PromptRegistry(),
    new MaskingService(),
    trace,
  );
  service.sleep = vi.fn(async () => undefined);
  return { adapter, traces, service };
}

const VALID = JSON.stringify({
  authority: {
    value: 'Jobcenter Musterstadt',
    quote: 'Jobcenter Musterstadt',
    page: 1,
  },
  caseNumber: { value: null, quote: null, page: null },
  letterDate: { value: null, quote: null, page: null },
  requirements: [],
  deadlines: [],
  amounts: [],
});
const call = (
  service: LlmService,
  letterText = 'Jobcenter Musterstadt',
  check?: () => string | null,
) =>
  service.callWithTrace({
    prompt: 'extract',
    variables: { letterText },
    schema: ExtractSchema,
    check,
    context: { cabinetId: 'cab-1', letterId: 'let-1' },
  });

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof ApiError ? e.code : String(e);
  }
}

describe('LlmService: повторы', () => {
  it('неверный JSON повторяется с текстом ошибки и пишется в журнал', async () => {
    const { adapter, traces, service } = setup(['это не json', VALID]);
    const res = await call(service);
    expect(res.attempts).toBe(2);
    expect(adapter.requests[1].user).toContain('ответ не является JSON');
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      ok: true,
      attempts: 2,
      promptName: 'extract',
      promptVersion: 2,
      tokensIn: 20,
    });
  });

  it('ответ не по схеме тоже повторяется', async () => {
    const { adapter, service } = setup(['{"authority": 5}', VALID]);
    await call(service);
    expect(adapter.requests[1].user).toContain('не подходит к схеме');
  });

  it('после 3 неудач: LLM_FAILED, ровно 3 обращения, журнал с ошибкой', async () => {
    const { adapter, traces, service } = setup(['x', 'y', 'z', VALID]);
    expect(await codeOf(call(service))).toBe('LLM_FAILED');
    expect(adapter.requests).toHaveLength(MAX_ATTEMPTS);
    expect(traces[0]).toMatchObject({
      ok: false,
      attempts: 3,
      error: 'ответ не является JSON',
      output: 'z',
    });
  });

  it('проверка check расходует те же 3 попытки (нет вложенных повторов)', async () => {
    const { adapter, service } = setup([VALID, VALID, VALID, VALID]);
    const check = vi.fn(() => 'дата не найдена в цитате');
    expect(await codeOf(call(service, 'Jobcenter Musterstadt', check))).toBe(
      'LLM_FAILED',
    );
    expect(adapter.requests).toHaveLength(3);
    expect(check).toHaveBeenCalledTimes(3);
    expect(adapter.requests[2].user).toContain('дата не найдена в цитате');
  });

  it('неверный ключ не повторяется', async () => {
    const { adapter, traces, service } = setup([
      new AdapterError('AUTH', 'HTTP 401: ключ не подходит'),
      VALID,
    ]);
    expect(await codeOf(call(service))).toBe('LLM_FAILED');
    expect(adapter.requests).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      ok: false,
      attempts: 1,
      error: 'HTTP 401: ключ не подходит',
    });
  });

  it('неизвестная модель не повторяется', async () => {
    const { adapter, service } = setup([
      new AdapterError('MODEL', 'HTTP 404: модель не найдена'),
      VALID,
    ]);
    expect(await codeOf(call(service))).toBe('LLM_FAILED');
    expect(adapter.requests).toHaveLength(1);
  });

  it('429: одна пауза по Retry-After и повтор', async () => {
    const { adapter, service } = setup([
      new AdapterError('QUOTA', 'HTTP 429', 2000),
      VALID,
    ]);
    const res = await call(service);
    expect(res.attempts).toBe(2);
    expect(service.sleep).toHaveBeenCalledWith(2000);
    expect(adapter.requests).toHaveLength(2);
  });

  it('429 дважды: LLM_QUOTA', async () => {
    const { service } = setup([
      new AdapterError('QUOTA', 'HTTP 429', 1000),
      new AdapterError('QUOTA', 'HTTP 429', 1000),
    ]);
    expect(await codeOf(call(service))).toBe('LLM_QUOTA');
  });

  it('429 с долгим Retry-After: сразу LLM_QUOTA без ожидания', async () => {
    const { adapter, service } = setup([
      new AdapterError('QUOTA', 'HTTP 429', 60_000),
    ]);
    expect(await codeOf(call(service))).toBe('LLM_QUOTA');
    expect(service.sleep).not.toHaveBeenCalled();
    expect(adapter.requests).toHaveLength(1);
  });

  it('сбой сети повторяется', async () => {
    const { service } = setup([
      new AdapterError('NETWORK', 'Нет связи с моделью'),
      VALID,
    ]);
    expect((await call(service)).attempts).toBe(2);
  });
});

describe('LlmService: маскирование', () => {
  const letter = [
    'Jobcenter Musterstadt',
    'Bitte überweisen Sie auf DE89 3704 0044 0532 0130 00.',
    'Kontakt: anna.beispiel@example.org, Tel. 030 1234567',
    'Steuer-ID: 12 345 678 901',
  ].join('\n');

  it('IBAN, e-mail, телефон и Steuer-ID не попадают ни в модель, ни в LlmCall.input', async () => {
    const answer = JSON.stringify({
      authority: {
        value: 'Jobcenter Musterstadt',
        quote: 'Jobcenter Musterstadt',
        page: 1,
      },
      caseNumber: { value: null, quote: null, page: null },
      letterDate: { value: null, quote: null, page: null },
      requirements: [
        {
          value: 'Überweisung',
          quote: 'Bitte überweisen Sie auf [IBAN_1].',
          page: 1,
        },
      ],
      deadlines: [],
      amounts: [],
    });
    const { adapter, traces, service } = setup([answer]);
    const res = await call(service, letter);

    const sent = adapter.requests[0].user;
    for (const secret of [
      'DE89 3704 0044 0532 0130 00',
      'anna.beispiel@example.org',
      '030 1234567',
      '12 345 678 901',
    ]) {
      expect(sent).not.toContain(secret);
      expect(traces[0].input).not.toContain(secret);
    }
    expect(sent).toContain('[IBAN_1]');
    expect(sent).toContain('[EMAIL_1]');
    expect(sent).toContain('[PHONE_1]');
    expect(sent).toContain('[TAXID_1]');
    // В ответе метка возвращена обратно: цитата снова совпадает с текстом письма.
    expect(res.data.requirements[0].quote).toBe(
      'Bitte überweisen Sie auf DE89 3704 0044 0532 0130 00.',
    );
  });

  it('даты, Aktenzeichen и почтовый индекс не маскируются', () => {
    const masking = new MaskingService();
    const text =
      'Datum: 11.11.2026\nAktenzeichen: JC-2026-1001\nMusterweg 10, 00000 Musterstadt\nBetrag: 120,50 EUR';
    expect(masking.mask(text, new Map())).toBe(text);
  });

  it('BIC маскируется только рядом со словом BIC, заглавные слова не трогаются', () => {
    const masking = new MaskingService();
    const table = new Map<string, string>();
    expect(masking.mask('BIC: COBADEFFXXX', table)).toBe('BIC: [BIC_1]');
    expect(masking.mask('JOBCENTER MUSTERSTADT', table)).toBe(
      'JOBCENTER MUSTERSTADT',
    );
  });

  it('номер социального страхования и одинаковые значения — одна метка', () => {
    const masking = new MaskingService();
    const table = new Map<string, string>();
    expect(masking.mask('SV-Nr. 12 150385 M 123', table)).toBe(
      'SV-Nr. [SVNR_1]',
    );
    expect(masking.mask('a@b.de und a@b.de', table)).toBe(
      '[EMAIL_1] und [EMAIL_1]',
    );
  });

  it('ответ модели на фото маскируется перед записью в LlmCall.output', async () => {
    const { service, traces } = setup([
      JSON.stringify({
        text: 'Bitte überweisen Sie auf DE89 3704 0044 0532 0130 00. Mail: anna@example.org',
        readable: true,
        reason: null,
      }),
    ]);
    const res = await service.call({
      prompt: 'transcribe',
      variables: {},
      images: [{ mime: 'image/jpeg', data: Buffer.from('x') }],
      schema: TranscribeSchema,
      context: { cabinetId: 'c1', letterId: 'l1' },
    });
    expect(res.text).toContain('DE89 3704 0044 0532 0130 00'); // приложению нужен настоящий текст
    expect(traces[0].output).not.toContain('DE89 3704');
    expect(traces[0].output).not.toContain('anna@example.org');
    expect(traces[0].context).toEqual({ cabinetId: 'c1', letterId: 'l1' });
  });

  it('transcribe: readable true с пустым текстом не принимается', async () => {
    const empty = JSON.stringify({ text: '  ', readable: true, reason: null });
    const { service, adapter } = setup([empty, empty, empty]);
    await expect(
      service.call({
        prompt: 'transcribe',
        variables: {},
        images: [{ mime: 'image/jpeg', data: Buffer.from('x') }],
        schema: TranscribeSchema,
        check: checkTranscribe,
        context: { cabinetId: 'c1' },
      }),
    ).rejects.toMatchObject({ code: 'LLM_FAILED' });
    expect(adapter.requests).toHaveLength(MAX_ATTEMPTS);
  });

  it('фото в журнале только описанием размера', async () => {
    const { traces, service } = setup([VALID]);
    await service.callWithTrace({
      prompt: 'extract',
      variables: { letterText: 'x' },
      images: [{ mime: 'image/jpeg', data: Buffer.alloc(3000) }],
      schema: ExtractSchema,
      context: { cabinetId: null },
    });
    expect(traces[0].input).toContain('image, 3 KB');
    expect(traces[0].context.cabinetId).toBeNull();
  });
});

describe('Адаптер demo', () => {
  it('находит ведомство, Aktenzeichen, дату письма, требование и срок в письме 01', async () => {
    const adapter = new DemoAdapter();
    const res = await adapter.complete({
      promptName: 'extract',
      system: '',
      user: '',
      variables: { letterText: fixture('01_jobcenter_request.txt') },
      images: [],
    });
    const data = ExtractSchema.parse(JSON.parse(res.text));
    expect(data.authority.value).toBe('Jobcenter Musterstadt');
    expect(data.caseNumber.value).toBe('JC-2026-1001');
    expect(data.letterDate.value).toBe('2026-11-11');
    expect(data.requirements.map((r) => r.value)).toEqual([
      'Bitte reichen Sie die Kontoauszüge für September ein.',
    ]);
    expect(data.deadlines).toEqual([
      {
        value: '2026-11-30',
        quote: 'Bitte antworten Sie bis zum 30.11.2026.',
        page: 1,
        kind: 'REPLY',
      },
    ]);
  });

  it('относительный срок не превращается в дату', async () => {
    const res = await new DemoAdapter().complete({
      promptName: 'extract',
      system: '',
      user: '',
      variables: { letterText: fixture('15_relative_deadline.txt') },
      images: [],
    });
    expect(JSON.parse(res.text).deadlines).toEqual([]);
  });

  it('промпт без правил: ошибка BAD_REQUEST', async () => {
    await expect(
      new DemoAdapter().complete({
        promptName: 'unknown',
        system: '',
        user: '',
        variables: {},
        images: [],
      }),
    ).rejects.toMatchObject({ kind: 'BAD_REQUEST' });
  });
});

describe('Адаптер openai', () => {
  const make = (
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ) => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify(body), { status, headers }),
    );
    const adapter = new OpenAiAdapter({
      baseUrl: 'https://llm.example/v1/',
      apiKey: 'secret-key',
      model: 'm',
      timeoutMs: 1000,
      fetchFn,
    });
    return { adapter, fetchFn };
  };
  const req: AdapterRequest = {
    promptName: 'extract',
    system: 's',
    user: 'u',
    variables: {},
    images: [],
  };

  it('просит JSON и возвращает текст и токены', async () => {
    const { adapter, fetchFn } = make(200, {
      choices: [{ message: { content: '{"a":1}' } }],
      usage: { prompt_tokens: 7, completion_tokens: 3 },
    });
    expect(await adapter.complete(req)).toEqual({
      text: '{"a":1}',
      tokensIn: 7,
      tokensOut: 3,
    });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://llm.example/v1/chat/completions');
    expect(JSON.parse(init.body as string).response_format).toEqual({
      type: 'json_object',
    });
  });

  it('401: AUTH, текст ошибки без ключа', async () => {
    const { adapter } = make(401, { error: 'bad key secret-key' });
    const err = (await adapter.complete(req).catch((e) => e)) as AdapterError;
    expect(err.kind).toBe('AUTH');
    expect(err.retryable).toBe(false);
    expect(err.message).not.toContain('secret-key');
  });

  it('400 «Please pass a valid API key» (так отвечает Gemini): тоже AUTH', async () => {
    const { adapter } = make(400, [
      { error: { code: 400, message: 'Please pass a valid API key' } },
    ]);
    expect(await adapter.complete(req).catch((e) => e)).toMatchObject({
      kind: 'AUTH',
    });
  });

  it('429: QUOTA с Retry-After в миллисекундах', async () => {
    const { adapter } = make(429, {}, { 'Retry-After': '3' });
    expect(await adapter.complete(req).catch((e) => e)).toMatchObject({
      kind: 'QUOTA',
      retryAfterMs: 3000,
    });
  });

  it('500: можно повторить', async () => {
    const { adapter } = make(503, {});
    expect(await adapter.complete(req).catch((e) => e)).toMatchObject({
      kind: 'SERVER',
    });
  });
});

describe('PromptRegistry', () => {
  it('находит последнюю версию extract и делит на System и User', () => {
    const p = new PromptRegistry().get('extract');
    expect(p.version).toBe(2);
    expect(p.system).toContain('Отвечай только JSON');
    expect(p.user).toContain('{{letterText}}');
  });

  it('неизвестный промпт — понятная ошибка', () => {
    expect(() => new PromptRegistry().get('nope')).toThrow('Промпт не найден');
  });
});

it('схема Zod отклоняет придуманный формат даты', () => {
  const bad = {
    ...JSON.parse(VALID),
    deadlines: [{ value: '30.11.2026', quote: 'x', page: 1, kind: 'REPLY' }],
  };
  expect(ExtractSchema.safeParse(bad).success).toBe(false);
  expect(z.string().safeParse('x').success).toBe(true);
});
