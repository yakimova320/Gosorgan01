/** Изображение для модели (фото страницы письма). */
export interface LlmImage {
  mime: string;
  data: Buffer;
}

export interface AdapterRequest {
  promptName: string;
  /** Версия промпта: demo отвечает по схеме этой версии (transcribe v1 и v2). */
  promptVersion?: number;
  system: string;
  user: string;
  /** Уже замаскированные переменные: адаптер demo ищет в них данные письма. */
  variables: Record<string, string>;
  images: LlmImage[];
  /** Другая модель для этого вызова (чат-помощник: LLM_MODEL_ASSISTANT). Нет — модель адаптера. */
  model?: string;
}

export interface AdapterResponse {
  text: string;
  tokensIn?: number;
  tokensOut?: number;
}

/** L05 (#81): длина вектора в LetterChunk.embedding (vector(768)). */
export const EMBEDDING_DIM = 768;

export interface EmbedRequest {
  /** Уже замаскированные тексты: куски писем и вопрос. */
  texts: string[];
}

export interface EmbedResponse {
  /** По вектору длины EMBEDDING_DIM на каждый текст, в том же порядке, длина 1. */
  vectors: number[][];
  tokensIn?: number;
}

/** Адаптер к модели. Импорт SDK и сетевые вызовы к модели только в api/src/llm. */
export interface LlmAdapter {
  readonly provider: string;
  readonly model: string;
  complete(request: AdapterRequest): Promise<AdapterResponse>;
  /** L05: модель векторов для журнала LlmCall. */
  readonly embedModel?: string;
  /** L05: векторы текстов для поиска по архиву. Нет — у адаптера поиска нет (тестовые адаптеры). */
  embed?(request: EmbedRequest): Promise<EmbedResponse>;
}

export const LLM_ADAPTER = Symbol('LLM_ADAPTER');

/**
 * Ошибка провайдера.
 * AUTH (неверный ключ), MODEL (модель не найдена), BAD_REQUEST: повторять бессмысленно.
 * QUOTA (429): пауза по Retry-After, затем LLM_QUOTA.
 * SERVER, TIMEOUT, NETWORK: можно повторить.
 */
export type AdapterErrorKind =
  'AUTH' | 'MODEL' | 'BAD_REQUEST' | 'QUOTA' | 'SERVER' | 'TIMEOUT' | 'NETWORK';

export class AdapterError extends Error {
  constructor(
    readonly kind: AdapterErrorKind,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'AdapterError';
  }

  get retryable(): boolean {
    return (
      this.kind === 'SERVER' ||
      this.kind === 'TIMEOUT' ||
      this.kind === 'NETWORK'
    );
  }
}
