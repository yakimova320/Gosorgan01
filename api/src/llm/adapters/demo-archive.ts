import { EMBEDDING_DIM } from '../llm.types.js';
import { normalize } from '../vector.js';
import type { DemoLang } from './demo.adapter.js';

/*
 * L05 (#81): режим demo для вопросов к архиву, без сети.
 * Векторы: «мешок основ слов» — каждая основа слова (первые 5 букв) кладётся в своё число вектора.
 * Тексты с общими словами оказываются рядом. Смысл слов demo не понимает: «Rente» и «пенсия» не похожи.
 */

const STOP = new Set(
  'как что где когда если меня мне мои мой моих можно нужно надо есть это эти этот такое какие какой какая почему зачем сколько через чтобы ли или для при про над под без от до все мне пришло писали письмо письма der die das und mit von den dem des ein eine einen ihr ihre sie wir uns ist sind für auf bei zum zur nicht wie was wann'.split(
    ' ',
  ),
);

/** Основы слов: нижний регистр, от 3 букв, первые 5 знаков. Числа тоже (номера дел, суммы). */
export function demoStems(text: string): string[] {
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

export function demoEmbed(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  for (const stem of demoStems(text)) v[fnv1a(stem) % EMBEDDING_DIM] += 1;
  return normalize(v);
}

const DEMO_ARCHIVE_TEXT: Record<DemoLang, { found: string; none: string }> = {
  ru: {
    found: 'В ваших письмах об этом сказано',
    none: 'В ваших письмах в Ja!sno ответа на этот вопрос нет. Попробуйте спросить иначе, например названием ведомства или номером дела.',
  },
  uk: {
    found: 'У ваших листах про це сказано',
    none: 'У ваших листах у Ja!sno відповіді на це запитання немає. Спробуйте спитати інакше, наприклад назвою відомства або номером справи.',
  },
  de: {
    found: 'In Ihren Briefen steht dazu',
    none: 'In Ihren Briefen in Ja!sno steht dazu nichts. Fragen Sie anders, zum Beispiel mit dem Namen vom Amt oder dem Aktenzeichen.',
  },
};

export const DEMO_ARCHIVE_NONE = DEMO_ARCHIVE_TEXT.ru.none;

/**
 * Ответ archive.v1 в demo: строка фрагмента, где больше всего общих с вопросом слов.
 * Цитата — целая строка из фрагмента, поэтому всегда есть в тексте письма.
 */
export function demoArchive(
  question: string,
  fragments: string,
  lang: DemoLang = 'ru',
): { answer: string; sources: { fragment: string; quote: string }[] } {
  const L = DEMO_ARCHIVE_TEXT[lang];
  const q = new Set(demoStems(question));
  const hits: { fragment: string; line: string; score: number }[] = [];
  for (const block of fragments.split(/^### /m).slice(1)) {
    const [id, , ...lines] = block.split('\n');
    let best: { line: string; score: number } | null = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const score = new Set(demoStems(line).filter((w) => q.has(w))).size;
      if (score > 0 && (!best || score > best.score)) best = { line, score };
    }
    if (best) hits.push({ fragment: id.trim(), ...best });
  }
  hits.sort((a, b) => b.score - a.score);
  const top = hits.slice(0, 2);
  if (top.length === 0) return { answer: L.none, sources: [] };
  return {
    answer: `${L.found}: «${top[0].line}»`,
    sources: top.map((h) => ({ fragment: h.fragment, quote: h.line })),
  };
}
