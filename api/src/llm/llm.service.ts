import { Inject, Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod';
import { ApiError } from '../common/api-error.js';
import {
  AdapterError,
  LLM_ADAPTER,
  type LlmAdapter,
  type LlmImage,
} from './llm.types.js';
import { MaskingService, type MaskTable } from './masking.service.js';
import { PromptRegistry, render } from './prompt-registry.js';
import { TraceService, type LlmContext } from './trace.service.js';

/** ТЗ v4 раздел 10: не больше 3 обращений к модели на одну операцию, включая все проверки. */
export const MAX_ATTEMPTS = 3;
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
  context: LlmContext;
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
  ) {}

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
        model: this.adapter.model,
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
      });

    while (attempts < MAX_ATTEMPTS) {
      attempts++;
      const retryNote = lastError
        ? `\n\nПредыдущий ответ не принят: ${lastError}\nОтветь заново. Только JSON по описанной схеме.`
        : '';

      let text: string;
      try {
        const res = await this.adapter.complete({
          promptName: prompt.name,
          system: prompt.system,
          user: user + retryNote,
          variables,
          images,
        });
        text = res.text;
        tokensIn += res.tokensIn ?? 0;
        tokensOut += res.tokensOut ?? 0;
      } catch (e) {
        if (!(e instanceof AdapterError)) throw e;
        lastError = e.message;
        if (e.kind === 'QUOTA') {
          const wait = e.retryAfterMs ?? 1000;
          if (
            !quotaHit &&
            wait <= MAX_QUOTA_WAIT_MS &&
            attempts < MAX_ATTEMPTS
          ) {
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
      `${prompt.name}.v${prompt.version}: нет верного ответа за ${MAX_ATTEMPTS} попытки`,
    );
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
    return { ok: false, error: 'ответ не является JSON' };
  }
}
