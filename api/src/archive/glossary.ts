import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Language } from '../common/language.js';

/** L05 (#81): термин справочника content/glossary.json (тексты пишут и проверяют люди). */
export interface GlossaryTerm {
  id: string;
  term: string;
  text: Record<Language, string>;
  checkedAt: string;
  draft?: boolean;
}

/**
 * Проверенные термины (без draft). Нет файла или он не читается — пустой список:
 * вопросы к архиву работают и без справочника.
 */
export function loadCheckedTerms(contentDir: string): GlossaryTerm[] {
  try {
    const data = JSON.parse(readFileSync(resolve(contentDir, 'glossary.json'), 'utf8')) as {
      terms?: GlossaryTerm[];
    };
    return (data.terms ?? []).filter((t) => !t.draft && t.term && t.text?.ru);
  } catch {
    return [];
  }
}

/** Термины, которые встречаются в тексте (без учёта регистра, и как часть слова: Widerspruchsfrist). */
export function termsIn(text: string, terms: GlossaryTerm[], limit = 5): GlossaryTerm[] {
  const lower = text.toLowerCase();
  return terms.filter((t) => lower.includes(t.term.toLowerCase())).slice(0, limit);
}
