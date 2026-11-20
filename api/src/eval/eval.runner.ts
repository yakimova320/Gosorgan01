import type { INestApplication } from '@nestjs/common';
import { readFileSync, readdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { extname, resolve } from 'node:path';
import { createApp } from '../app.factory.js';
import { LLM_ADAPTER, type LlmAdapter } from '../llm/llm.types.js';
import { LlmService } from '../llm/llm.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { createSandbox } from './eval-sandbox.js';
import {
  scoreLetter,
  type EvalClaim,
  type EvalDraft,
  type EvalExplanation,
  type Expected,
  type Score,
} from './eval.scoring.js';

/*
 * B14: прогон 15 синтетических писем через настоящий путь API (HTTP: загрузка → факты →
 * подтверждение → дело → объяснение → черновик CLARIFICATION). Своя схема и хранилище (песочница).
 * Предел обращений к модели (включая повторы): при достижении прогон останавливается и
 * сохраняется частичный отчёт; повторный прогон автоматически не запускается.
 */

export const DEFAULT_MAX_CALLS = 50;
/** Письма, где один факт срока остаётся неподтверждённым (Q2). */
const Q2_LETTERS = new Set(['01_jobcenter_request', '04_buergeramt', '06_multiple_deadlines']);
/*
 * Дополнительные варианты файлов: PDF-версии писем с фото и сканами. С B11 скан PDF
 * распознаётся постранично: читаемое письмо должно быть принято, нечитаемое — понятный UNREADABLE.
 */

class CallCapReached extends Error {
  constructor() {
    super('eval: достигнут предел обращений к модели');
  }
}

/** Письмо, на котором прогон остановился по пределу, — без оценки, с потраченным расходом. */
const CAP_ERROR = {
  code: 'CALL_CAP',
  message: 'Прогон остановлен: достигнут предел обращений к модели',
};

export interface Fixture {
  id: string;
  file: string;
  source: 'TEXT_LAYER' | 'OCR';
  readable: boolean;
  expected: Expected;
}

export interface LetterRun {
  id: string;
  file: string;
  kind: 'PDF' | 'PHOTO';
  status: 'OK' | 'REFUSED' | 'FAILED' | 'NOT_RUN';
  expectedRefusal: boolean;
  error: { code: string; message: string } | null;
  refusalClear: boolean | null;
  score: Score | null;
  explanation: 'OK' | string | null;
  draft: { passed: boolean; status: string } | null;
  q2Variant: boolean;
  dropped: number;
  ms: number;
  usage: Usage;
}

export interface Usage {
  calls: number;
  failedCalls: number;
  tokensIn: number;
  tokensOut: number;
  /** обращения, по которым провайдер не прислал данные о токенах */
  unknownUsageCalls: number;
}

export interface EvalResult {
  at: string;
  provider: string;
  model: string;
  promptVersions: Record<string, number[]>;
  maxCalls: number;
  callsUsed: number;
  partial: boolean;
  stoppedAt: string | null;
  letters: LetterRun[];
  variants: LetterRun[];
}

const emptyUsage = (): Usage => ({
  calls: 0,
  failedCalls: 0,
  tokensIn: 0,
  tokensOut: 0,
  unknownUsageCalls: 0,
});

/** Основной файл логического письма: текстовый PDF или одно фото; сканы PDF — варианты. */
export function plan(fixturesDir: string): {
  letters: { fx: Fixture; file: string }[];
  variants: { id: string; file: string; readable: boolean }[];
} {
  const files = readdirSync(fixturesDir);
  const fixtures = files
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(resolve(fixturesDir, f), 'utf8')) as Fixture);
  const letters: { fx: Fixture; file: string }[] = [];
  const variants: { id: string; file: string; readable: boolean }[] = [];
  for (const fx of fixtures) {
    const image = files.find((f) => f.startsWith(`${fx.id}.`) && /\.(jpe?g|png)$/i.test(f));
    const pdf = files.find((f) => f === `${fx.id}.pdf`);
    if (fx.source === 'OCR') {
      if (image) letters.push({ fx, file: image });
      if (pdf) variants.push({ id: fx.id, file: pdf, readable: fx.readable });
    } else letters.push({ fx, file: fx.file });
  }
  return { letters, variants };
}

const MIME: Record<string, string> = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

export async function runEval(options: {
  baseDatabaseUrl: string;
  fixturesDir: string;
  maxCalls?: number;
  env?: NodeJS.ProcessEnv;
  only?: string[];
  log?: (line: string) => void;
}): Promise<EvalResult & { schema: string }> {
  const maxCalls = options.maxCalls ?? DEFAULT_MAX_CALLS;
  const log = options.log ?? (() => undefined);
  const sandbox = await createSandbox(options.baseDatabaseUrl);
  let app: INestApplication | null = null;
  try {
    app = await createApp({
      env: {
        ...options.env,
        DATABASE_URL: sandbox.databaseUrl,
        STORAGE_DIR: sandbox.storageDir,
        RATE_LIMIT_IP: 'false',
        LLM_DAILY_OPS_PER_CABINET: '0',
        MAIL_MODE: 'file',
      },
      logger: false,
    });
    await app.init();
    // Предел обращений: считается каждая попытка адаптера, включая повторы и неудачные
    const adapter = app.get<LlmAdapter>(LLM_ADAPTER);
    const complete = adapter.complete.bind(adapter);
    let calls = 0;
    let capHit = false;
    adapter.complete = async (req) => {
      if (calls >= maxCalls) {
        capHit = true;
        throw new CallCapReached();
      }
      calls++;
      return complete(req);
    };
    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const api = `http://127.0.0.1:${port}`;
    const db = app.get(PrismaService);
    const mode = app.get(LlmService).mode;

    const result: EvalResult = {
      at: new Date().toISOString(),
      provider: mode.provider,
      model: mode.model,
      promptVersions: {},
      maxCalls,
      callsUsed: 0,
      partial: false,
      stoppedAt: null,
      letters: [],
      variants: [],
    };

    const { letters, variants } = plan(options.fixturesDir);
    const wanted = (id: string) => !options.only || options.only.includes(id);
    let n = 0;

    const register = async () => {
      const res = await fetch(`${api}/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: `eval-${++n}-${Date.now()}@example.org`,
          password: 'eval-Passwort-123',
          consent: true,
          aiConsent: true,
          firstName: 'Anna',
          lastName: 'Muster',
          address: 'Musterstr. 1, 10115 Berlin',
        }),
      });
      return ((await res.json()) as { sessionToken: string }).sessionToken;
    };
    const call = async (token: string, method: string, path: string, body?: unknown) => {
      const res = await fetch(`${api}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
    };
    const uploadFile = async (token: string, file: string) => {
      const form = new FormData();
      const data = readFileSync(resolve(options.fixturesDir, file));
      form.append('files', new Blob([data], { type: MIME[extname(file).toLowerCase()] }), file);
      const res = await fetch(`${api}/letters`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
      return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
    };
    // Письма идут по одному: всё, что записано в журнал с начала письма, — его расход
    // (и у отказа, где строки письма нет, но обращения к модели были)
    const usageOf = async (since: Date): Promise<Usage> => {
      const rows = await db.llmCall.findMany({ where: { createdAt: { gte: since } } });
      const u = emptyUsage();
      for (const r of rows) {
        u.calls += r.attempts;
        if (!r.ok) u.failedCalls += 1;
        u.tokensIn += r.tokensIn ?? 0;
        u.tokensOut += r.tokensOut ?? 0;
        if (r.tokensIn === null && r.tokensOut === null) u.unknownUsageCalls += r.attempts;
        const versions = (result.promptVersions[r.promptName] ??= []);
        if (!versions.includes(r.promptVersion)) versions.push(r.promptVersion);
      }
      return u;
    };
    const isClearRefusal = (err: { code: string; message: string }, expected: string[]) =>
      expected.includes(err.code) && /[а-яё]/i.test(err.message) && err.message.length >= 20;

    const runOne = async (
      id: string,
      file: string,
      fx: Fixture | null,
      variantReadable = false,
    ): Promise<LetterRun> => {
      const started = Date.now();
      const kind = file.endsWith('.pdf') ? 'PDF' : 'PHOTO';
      const expectedRefusal = fx ? !fx.readable : !variantReadable;
      const run: LetterRun = {
        id, file, kind, status: 'FAILED', expectedRefusal, error: null, refusalClear: null,
        score: null, explanation: null, draft: null, q2Variant: false, dropped: 0, ms: 0, usage: emptyUsage(),
      };
      const before = new Date();
      const token = await register();
      const up = await uploadFile(token, file);
      if (up.status !== 201) {
        const err = { code: String(up.body?.code ?? up.status), message: String(up.body?.message ?? '') };
        run.error = err;
        // перегрузка провайдера — не отказ и не ответ сервиса: письмо не выполнено
        const quota = err.code === 'LLM_QUOTA';
        run.status = expectedRefusal && !quota ? 'REFUSED' : 'FAILED';
        if (expectedRefusal && !quota)
          run.refusalClear = isClearRefusal(err, ['UNREADABLE']);
        run.usage = await usageOf(before);
        run.ms = Date.now() - started;
        return run;
      }
      if (!fx) {
        // вариант файла принят (B11: скан PDF распознан постранично): это не отказ и не оценка,
        // дальше по пути не идём, чтобы не тратить обращения к модели
        run.status = 'OK';
        run.expectedRefusal = false;
        run.usage = await usageOf(before);
        run.ms = Date.now() - started;
        return run;
      }
      const letter = up.body as unknown as {
        letter: { id: string; text: string };
        claims: EvalClaim[];
        extraction: { dropped: number };
      };
      run.dropped = letter.extraction.dropped;
      const letterId = letter.letter.id;
      // Q2: в трёх письмах срок оставляем неподтверждённым
      const holdBack = Q2_LETTERS.has(id) ? letter.claims.find((c) => c.kind === 'DEADLINE') : undefined;
      run.q2Variant = !!holdBack;
      const confirm = letter.claims.filter((c) => c.id !== holdBack?.id).map((c) => c.id);
      if (confirm.length) await call(token, 'POST', `/letters/${letterId}/claims/confirm`, { confirm });
      const assigned = await call(token, 'POST', `/letters/${letterId}/assign`, { newCase: {} });
      const caseId = String(assigned.body?.caseId ?? '');

      const ex = await call(token, 'POST', `/letters/${letterId}/explain?lang=ru`);
      const explanation = ex.status === 200 ? (ex.body as unknown as EvalExplanation) : null;
      run.explanation = ex.status === 200 ? 'OK' : String(ex.body?.code ?? ex.status);

      let draft: EvalDraft | null = null;
      const qs = await call(token, 'GET', `/letters/${letterId}/draft-questions`);
      const question = (qs.body?.questions as { id: string }[] | undefined)?.[0];
      if (caseId && question) {
        const dr = await call(token, 'POST', `/cases/${caseId}/draft`, {
          kind: 'CLARIFICATION',
          letterId,
          questionId: question.id,
        });
        if (dr.status === 201 || dr.status === 200) {
          draft = dr.body as unknown as EvalDraft;
          run.draft = { passed: draft.verification.passed, status: draft.status };
        }
      }
      const detail = await call(token, 'GET', `/letters/${letterId}`);
      const claims = ((detail.body?.claims as EvalClaim[] | undefined) ?? letter.claims);
      run.score = scoreLetter({
        expected: fx.expected,
        letterText: letter.letter.text,
        claims,
        explanation,
        draft,
        draftToday: new Date().toISOString().slice(0, 10),
      });
      run.status = 'OK';
      run.usage = await usageOf(before);
      run.ms = Date.now() - started;
      return run;
    };

    const todo: { id: string; file: string; fx: Fixture | null; variant: boolean; readable: boolean }[] = [
      ...letters
        .filter((l) => wanted(l.fx.id))
        .map((l) => ({ id: l.fx.id, file: l.file, fx: l.fx, variant: false, readable: l.fx.readable })),
      ...variants
        .filter((v) => wanted(v.id))
        .map((v) => ({ id: v.id, file: v.file, fx: null, variant: true, readable: v.readable })),
    ];
    for (const item of todo) {
      const target = item.variant ? result.variants : result.letters;
      if (result.partial) {
        target.push(notRun(item.id, item.file, item.fx));
        continue;
      }
      log(`→ ${item.file}`);
      const run = await runOne(item.id, item.file, item.fx, item.readable);
      if (capHit) {
        // предел достигнут во время этого письма: оценки нет, расход сохраняется
        result.partial = true;
        result.stoppedAt = item.file;
        target.push({ ...run, status: 'NOT_RUN', score: null, error: CAP_ERROR, refusalClear: null });
        log(`  предел ${maxCalls} обращений достигнут: прогон остановлен, отчёт частичный`);
        continue;
      }
      target.push(run);
    }
    result.callsUsed = calls;
    return { ...result, schema: sandbox.schema };
  } finally {
    await app?.close().catch(() => undefined);
    await sandbox.cleanup();
  }
}

function notRun(id: string, file: string, fx: Fixture | null): LetterRun {
  return {
    id, file, kind: file.endsWith('.pdf') ? 'PDF' : 'PHOTO', status: 'NOT_RUN',
    expectedRefusal: fx ? !fx.readable : true, error: null, refusalClear: null, score: null,
    explanation: null, draft: null, q2Variant: false, dropped: 0, ms: 0, usage: emptyUsage(),
  };
}
