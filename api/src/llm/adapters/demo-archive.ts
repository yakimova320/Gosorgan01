import { wordStems } from '../local-embed.js';
import type { DemoLang } from './demo.adapter.js';

/* L05 (#81): ответы demo для вопросов к архиву, без сети. Векторы — LocalEmbedder (local-embed.ts). */

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
  const q = new Set(wordStems(question));
  const hits: { fragment: string; line: string; score: number }[] = [];
  for (const block of fragments.split(/^### /m).slice(1)) {
    const [id, , ...lines] = block.split('\n');
    let best: { line: string; score: number } | null = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const score = new Set(wordStems(line).filter((w) => q.has(w))).size;
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

/** archive-query.v1 в demo: вопрос без изменений (векторы demo и так ищут по словам). */
export function demoArchiveQuery(question: string): { query: string } {
  return { query: question };
}
