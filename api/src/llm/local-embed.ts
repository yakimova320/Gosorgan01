import { EMBEDDING_DIM, type EmbedRequest, type EmbedResponse } from './llm.types.js';
import { normalize } from './vector.js';

/*
 * L05 (#81): векторы без модели и без сети — «мешок основ слов». Каждая основа слова (первые 5 букв)
 * кладётся в своё число вектора, тексты с общими словами оказываются рядом.
 * Смысл слов не понимается («Rente» и «пенсия» не похожи), поэтому при настоящей модели вопрос
 * сначала переводится в немецкие слова писем (промпт archive-query, ArchiveService).
 * Режим по умолчанию (LLM_EMBED_MODE=local): работает с любым провайдером, в том числе с Anthropic,
 * у которого нет /embeddings, и ничего не стоит.
 */

const STOP = new Set(
  'как что где когда если меня мне мои мой моих можно нужно надо есть это эти этот такое какие какой какая почему зачем сколько через чтобы ли или для при про над под без от до все мне пришло писали письмо письма der die das und mit von den dem des ein eine einen ihr ihre sie wir uns ist sind für auf bei zum zur nicht wie was wann'.split(
    ' ',
  ),
);

/** Основы слов: нижний регистр, от 3 букв, первые 5 знаков. Числа тоже (номера дел, суммы). */
export function wordStems(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
    .filter((w) => !STOP.has(w))
    .map((w) => w.slice(0, 5));
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function localEmbed(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  for (const stem of wordStems(text)) v[fnv1a(stem) % EMBEDDING_DIM] += 1;
  return normalize(v);
}


/** Источник векторов для LetterChunk. id входит в textHash куска: смена источника пересчитывает куски. */
export interface Embedder {
  readonly id: string;
  /** true — тексты уходят провайдеру (маскирование, лимиты, журнал LlmCall) */
  readonly remote: boolean;
  embed(request: EmbedRequest): Promise<EmbedResponse>;
}

export const EMBEDDER = Symbol('EMBEDDER');

export class LocalEmbedder implements Embedder {
  readonly id = 'local-v1';
  readonly remote = false;
  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    return { vectors: request.texts.map(localEmbed) };
  }
}
