import { LANGUAGES, type Language } from '@jasno/shared';
import type { PrismaService } from '../prisma/prisma.service.js';

export { LANGUAGES, type Language };

/*
 * L07 (#83): язык кабинета для ответов ИИ, писем с сайта и календаря.
 * Системные тексты в базе (факты, события) остаются по-русски: их переводит сайт.
 */

/** Название языка для промптов: строка «Язык ответа: …». */
export const LANGUAGE_FOR_PROMPT: Record<Language, string> = {
  ru: 'русский',
  uk: 'украинский (українська мова)',
  de: 'простой немецкий (Einfache Sprache: короткие предложения, простые слова)',
};

export function isLanguage(v: unknown): v is Language {
  return typeof v === 'string' && (LANGUAGES as readonly string[]).includes(v);
}

export function toLanguage(v: unknown): Language {
  return isLanguage(v) ? v : 'ru';
}

export async function cabinetLanguage(
  db: Pick<PrismaService, 'cabinet'>,
  cabinetId: string,
): Promise<Language> {
  const c = await db.cabinet.findUnique({ where: { id: cabinetId }, select: { language: true } });
  return toLanguage(c?.language);
}

/** Переменные языка для LlmService: language — для промпта, lang — код для режима demo. */
export function languageVariables(lang: Language): { language: string; lang: Language } {
  return { language: LANGUAGE_FOR_PROMPT[lang], lang };
}
