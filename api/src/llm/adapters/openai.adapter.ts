import {
  AdapterError,
  type AdapterRequest,
  type AdapterResponse,
  type LlmAdapter,
} from '../llm.types.js';

export interface OpenAiAdapterOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** Подменяется в тестах. */
  fetchFn?: typeof fetch;
}

type Content =
  | string
  | (
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    )[];

/**
 * OpenAI-совместимый Chat Completions API (сейчас Google Gemini).
 * Без SDK: обычный fetch, чтобы библиотека не делала своих скрытых повторов.
 * Ключ уходит только в заголовке Authorization и нигде не пишется.
 */
export class OpenAiAdapter implements LlmAdapter {
  readonly provider = 'openai';
  readonly model: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: OpenAiAdapterOptions) {
    this.model = options.model;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async complete(request: AdapterRequest): Promise<AdapterResponse> {
    const user: Content =
      request.images.length === 0
        ? request.user
        : [
            { type: 'text', text: request.user },
            ...request.images.map((img) => ({
              type: 'image_url' as const,
              image_url: {
                url: `data:${img.mime};base64,${img.data.toString('base64')}`,
              },
            })),
          ];

    let res: Response;
    try {
      res = await this.fetchFn(
        `${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.options.apiKey}`,
          },
          body: JSON.stringify({
            model: request.model ?? this.model,
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: user },
            ],
            response_format: { type: 'json_object' },
            temperature: 0,
          }),
          signal: AbortSignal.timeout(this.options.timeoutMs),
        },
      );
    } catch (e) {
      const timeout =
        e instanceof Error &&
        (e.name === 'TimeoutError' || e.name === 'AbortError');
      throw new AdapterError(
        timeout ? 'TIMEOUT' : 'NETWORK',
        timeout ? 'Модель не ответила вовремя' : 'Нет связи с моделью',
      );
    }

    if (!res.ok) throw await toAdapterError(res);

    const body = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    } | null;
    const text = body?.choices?.[0]?.message?.content;
    if (typeof text !== 'string')
      throw new AdapterError('SERVER', 'Пустой ответ модели');
    return {
      text,
      tokensIn: body?.usage?.prompt_tokens,
      tokensOut: body?.usage?.completion_tokens,
    };
  }
}

/** Текст ошибки провайдера обрезается: в нём не должно оказаться ключа или длинного эха запроса. */
async function toAdapterError(res: Response): Promise<AdapterError> {
  const raw = await res.text().catch(() => '');
  const detail = raw.replace(/\s+/g, ' ').slice(0, 200);
  const status = `HTTP ${res.status}`;
  // Gemini отвечает на неверный ключ кодом 400 «Please pass a valid API key».
  if (
    res.status === 401 ||
    res.status === 403 ||
    /api[ _-]?key/i.test(detail)
  ) {
    return new AdapterError('AUTH', `${status}: ключ не подходит`);
  }
  if (res.status === 404)
    return new AdapterError('MODEL', `${status}: модель не найдена`);
  if (res.status === 429) {
    const header = res.headers.get('retry-after');
    const seconds = header ? Number(header) : NaN;
    return new AdapterError(
      'QUOTA',
      `${status}: лимит провайдера`,
      Number.isFinite(seconds) ? seconds * 1000 : undefined,
    );
  }
  if (res.status >= 500)
    return new AdapterError('SERVER', `${status}: ${detail}`);
  if (/model/i.test(detail) && /not found|unsupported|invalid/i.test(detail)) {
    return new AdapterError('MODEL', `${status}: модель не поддерживается`);
  }
  return new AdapterError('BAD_REQUEST', `${status}: ${detail}`);
}
