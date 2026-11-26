import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { z } from 'zod';
import { ApiError } from '../common/api-error.js';
import {
  AdapterError,
  LLM_ADAPTER,
  type LlmAdapter,
  type LlmImage,
} from './llm.types.js';
import { LlmLimitsService } from './llm-limits.service.js';
import { LlmOperationHandle, MAX_ATTEMPTS } from './llm-operation.js';
import { EMBEDDER, LocalEmbedder, type Embedder } from './local-embed.js';
import { MaskingService, type MaskTable } from './masking.service.js';
import { PromptRegistry, render } from './prompt-registry.js';
import { TraceService, type LlmContext } from './trace.service.js';

export { LlmOperationHandle, MAX_ATTEMPTS } from './llm-operation.js';
/** Пауза при 429 только если провайдер просит подождать не дольше этого. */
export const MAX_QUOTA_WAIT_MS = 5000;

export interface LlmCallOptions<S extends z.ZodType> {
  prompt: string;
  version?: number;
  variables: Record<string, string>;
  images?: LlmImage[];
  schema: S;
  /**
   * Дополнительная проверка кодом (например, даты в объяснении).
   * Вернула текст: ответ не принят, повтор с этим текстом. Повтор входит в те же 3 попытки.
   */
  check?: (result: z.infer<S>) => string | null;
  /**
   * Сколько обращений можно потратить в этом вызове (не больше MAX_ATTEMPTS).
   * Нужен для общего бюджета операции: фото = transcribe + extract, всего не больше 3.
   */
  maxAttempts?: number;
  context: LlmContext;
  /**
   * B18: операция пользователя. Все вызовы одной операции (фото = transcribe + extract) делят
   * общий предел MAX_ATTEMPTS и один резерв лимита. Без неё вызов — отдельная операция.
   */
  operation?: LlmOperationHandle;
  /** Другая модель для этого вызова (чат-помощник). Нет — модель адаптера. В demo не важна. */
  model?: string;
}

export interface LlmEmbedOptions {
  /** Тексты без маскирования: маскирует LlmService. */
  texts: string[];
  context: LlmContext;
  operation?: LlmOperationHandle;
  /** Сколько обращений можно потратить (не больше остатка операции). */
  maxAttempts?: number;
}

export interface LlmCallResult<T> {
  data: T;
  attempts: number;
  llmCallId: string | null;
}

/** Единственная дверь к модели (AGENTS.md): промпт → маскирование → модель → Zod → журнал LlmCall. */
@Injectable()
export class LlmService {
  private readonly logger = new Logger('LlmService');
  /** Подменяется в тестах, чтобы не ждать по-настоящему. */
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms));

  constructor(
    @Inject(LLM_ADAPTER) private readonly adapter: LlmAdapter,
    @Inject(PromptRegistry) private readonly prompts: PromptRegistry,
    @Inject(MaskingService) private readonly masking: MaskingService,
    @Inject(TraceService) private readonly trace: TraceService,
    // B18: лимиты и учёт расхода. Нет в скриптах проверки модели (llm-check и т. п.).
    @Optional()
    @Inject(LlmLimitsService)
    private readonly limits?: LlmLimitsService,
    // L05: источник векторов (LLM_EMBED_MODE). Нет — локальные векторы без модели.
    @Optional()
    @Inject(EMBEDDER)
    private readonly embedder: Embedder = new LocalEmbedder(),
  ) {}

  /** L05: какой источник векторов; ArchiveService пересчитывает куски при его смене. */
  get embedderId(): string {
    return this.embedder.id;
  }

  /** L05: векторы считаются локально, без модели (тогда вопрос сначала переводится в слова писем). */
  get embedsLocally(): boolean {
    return !this.embedder.remote;
  }

  /** Учёт расхода не должен ломать ответ пользователю: ошибка записи только в лог. */
  private async recordUsage(
    sample: Parameters<LlmLimitsService['record']>[0],
  ): Promise<void> {
    try {
      await this.limits?.record(sample);
    } catch (e) {
      this.logger.error(`учёт расхода модели не записан: ${(e as Error).name}`);
    }
  }

  /** Новая операция пользователя для лимитов (B18). */
  operation(
    cabinetId: string | null,
    kind: LlmOperationHandle['kind'],
  ): LlmOperationHandle {
    return new LlmOperationHandle(cabinetId, kind);
  }

  get mode(): { provider: string; model: string } {
    return { provider: this.adapter.provider, model: this.adapter.model };
  }

  async call<S extends z.ZodType>(
    options: LlmCallOptions<S>,
  ): Promise<z.infer<S>> {
    return (await this.callWithTrace(options)).data;
  }

  async callWithTrace<S extends z.ZodType>(
    options: LlmCallOptions<S>,
  ): Promise<LlmCallResult<z.infer<S>>> {
    const prompt = this.prompts.get(options.prompt, options.version);
    const table: MaskTable = new Map();
    const variables = Object.fromEntries(
      Object.entries(options.variables).map(([k, v]) => [
        k,
        this.masking.mask(v, table),
      ]),
    );
    const user = render(prompt.user, variables);
    const images = options.images ?? [];
    const input = [
      user,
      ...images.map((img) => `image, ${Math.ceil(img.data.length / 1024)} KB`),
    ].join('\n\n');

    const op =
      options.operation ??
      new LlmOperationHandle(options.context.cabinetId, 'OTHER');
    // общий предел операции: попытки прошлых вызовов той же операции уже потрачены
    const limit = Math.min(
      options.maxAttempts ?? MAX_ATTEMPTS,
      MAX_ATTEMPTS,
      op.remaining,
    );
    if (limit < 1) throw new ApiError('LLM_FAILED');
    const started = Date.now();
    let attempts = 0;
    let lastError: string | null = null;
    let lastOutput: string | null = null;
    let quotaHit = false;
    let tokensIn = 0;
    let tokensOut = 0;

    const finish = async (ok: boolean) =>
      this.trace.record({
        context: options.context,
        promptName: prompt.name,
        promptVersion: prompt.version,
        provider: this.adapter.provider,
        model: options.model ?? this.adapter.model,
        input,
        // Выход тоже маскируется: ответ на фото содержит исходные личные данные.
        output:
          lastOutput === null ? null : this.masking.mask(lastOutput, table),
        ok,
        error: ok ? null : lastError,
        attempts,
        durationMs: Date.now() - started,
        tokensIn: tokensIn || null,
        tokensOut: tokensOut || null,
        operationId: op.id,
      });

    while (attempts < limit) {
      // B18: резерв операции (после проверки файла и кэша: до сюда без модели) и мягкий порог
      // расхода — перед каждым обращением, включая повторы. Ошибка: модель не вызывается.
      try {
        await this.limits?.reserve(op);
        await this.limits?.checkBudget(this.adapter.provider);
      } catch (e) {
        if (attempts > 0) await finish(false);
        throw e;
      }
      attempts++;
      op.used++;
      const retryNote = lastError
        ? `\n\nПредыдущий ответ не принят: ${lastError}\nОтветь заново. Только JSON по описанной схеме.`
        : '';

      let text: string;
      try {
        const res = await this.adapter.complete({
          promptName: prompt.name,
          promptVersion: prompt.version,
          system: prompt.system,
          user: user + retryNote,
          variables,
          images,
          ...(options.model ? { model: options.model } : {}),
        });
        text = res.text;
        tokensIn += res.tokensIn ?? 0;
        tokensOut += res.tokensOut ?? 0;
        await this.recordUsage({
          provider: this.adapter.provider,
          failed: false,
          tokensIn: res.tokensIn,
          tokensOut: res.tokensOut,
          inputChars: prompt.system.length + user.length + retryNote.length,
          outputChars: text.length,
          images: images.length,
        });
      } catch (e) {
        if (!(e instanceof AdapterError)) throw e;
        await this.recordUsage({
          provider: this.adapter.provider,
          failed: true,
          inputChars: 0,
          outputChars: 0,
          images: 0,
        });
        lastError = e.message;
        if (e.kind === 'QUOTA') {
          const wait = e.retryAfterMs ?? 1000;
          if (!quotaHit && wait <= MAX_QUOTA_WAIT_MS && attempts < limit) {
            quotaHit = true;
            await this.sleep(wait);
            continue;
          }
          await finish(false);
          throw new ApiError('LLM_QUOTA');
        }
        if (!e.retryable) {
          this.logger.error(
            `${prompt.name}.v${prompt.version}: ${e.kind}, без повтора`,
          );
          await finish(false);
          throw new ApiError('LLM_FAILED');
        }
        continue;
      }

      lastOutput = text;
      const parsed = parseJson(text);
      if (!parsed.ok) {
        lastError = parsed.error;
        continue;
      }
      const checked = options.schema.safeParse(parsed.value);
      if (!checked.success) {
        lastError = `ответ не подходит к схеме: ${checked.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join('.') || '(корень)'}: ${i.message}`)
          .join('; ')}`;
        continue;
      }
      const data = this.masking.unmask(checked.data as z.infer<S>, table);
      const problem = options.check?.(data) ?? null;
      if (problem) {
        lastError = problem;
        continue;
      }
      const llmCallId = await finish(true);
      return { data, attempts, llmCallId };
    }

    this.logger.warn(
      `${prompt.name}.v${prompt.version}: нет верного ответа за ${limit} попытки`,
    );
    await finish(false);
    throw new ApiError('LLM_FAILED');
  }

  /**
   * L05 (#81): векторы текстов для вопросов к архиву.
   * Локальный источник (LLM_EMBED_MODE=local): без модели, без журнала и без попыток операции.
   * Внешний (api): тексты маскируются перед отправкой.
   * Запись в LlmCall (promptName embed): без самих текстов, только их число и длина. Один вызов
   * собирает куски разных писем, а журнал по письму удаляется вместе с письмом (letterId).
   * Обращения входят в общий предел операции (MAX_ATTEMPTS) и в лимиты B18.
   */
  async embed(options: LlmEmbedOptions): Promise<number[][]> {
    if (options.texts.length === 0) return [];
    if (!this.embedder.remote)
      return (await this.embedder.embed({ texts: options.texts })).vectors;
    const embedFn = this.embedder.embed.bind(this.embedder);
    const texts = options.texts.map((t) => this.masking.mask(t, new Map()));
    const chars = texts.reduce((n, t) => n + t.length, 0);
    const op =
      options.operation ??
      new LlmOperationHandle(options.context.cabinetId, 'OTHER');
    const limit = Math.min(options.maxAttempts ?? MAX_ATTEMPTS, op.remaining);
    if (limit < 1) throw new ApiError('LLM_FAILED');
    const started = Date.now();
    let attempts = 0;
    let lastError: string | null = null;
    let tokensIn = 0;
    const finish = (ok: boolean) =>
      this.trace.record({
        context: options.context,
        promptName: 'embed',
        promptVersion: 1,
        provider: this.adapter.provider,
        model: this.embedder.id,
        input: `embed: ${texts.length} texts, ${chars} chars`,
        output: ok ? `${texts.length} vectors` : null,
        ok,
        error: ok ? null : lastError,
        attempts,
        durationMs: Date.now() - started,
        tokensIn: tokensIn || null,
        tokensOut: null,
        operationId: op.id,
      });

    while (attempts < limit) {
      try {
        await this.limits?.reserve(op);
        await this.limits?.checkBudget(this.adapter.provider);
      } catch (e) {
        if (attempts > 0) await finish(false);
        throw e;
      }
      attempts++;
      op.used++;
      try {
        const res = await embedFn({ texts });
        tokensIn += res.tokensIn ?? 0;
        await this.recordUsage({
          provider: this.adapter.provider,
          failed: false,
          tokensIn: res.tokensIn,
          tokensOut: 0,
          inputChars: chars,
          outputChars: 0,
          images: 0,
        });
        if (res.vectors.length !== texts.length) {
          lastError = 'число векторов не совпадает с числом текстов';
          continue;
        }
        await finish(true);
        return res.vectors;
      } catch (e) {
        if (!(e instanceof AdapterError)) throw e;
        await this.recordUsage({
          provider: this.adapter.provider,
          failed: true,
          inputChars: 0,
          outputChars: 0,
          images: 0,
        });
        lastError = e.message;
        if (e.kind === 'QUOTA') {
          await finish(false);
          throw new ApiError('LLM_QUOTA');
        }
        if (!e.retryable) {
          this.logger.error(`embed: ${e.kind}, без повтора`);
          await finish(false);
          throw new ApiError('LLM_FAILED');
        }
      }
    }
    await finish(false);
    throw new ApiError('LLM_FAILED');
  }
}

/** JSON из ответа. Модели иногда оборачивают его в ```json ... ```. */
export function parseJson(
  text: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    // Модель без режима JSON (Anthropic) иногда пишет фразу перед объектом: берём объект целиком
    const from = trimmed.indexOf('{');
    const to = trimmed.lastIndexOf('}');
    if (from > 0 || (from === 0 && to < trimmed.length - 1)) {
      try {
        return { ok: true, value: JSON.parse(trimmed.slice(from, to + 1)) };
      } catch {
        // ниже общая ошибка
      }
    }
    return { ok: false, error: 'ответ не является JSON' };
  }
}
