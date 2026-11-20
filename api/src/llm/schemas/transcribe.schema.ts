import { z } from 'zod';

export const UNREADABLE_REASONS = [
  'BLURRY',
  'DARK',
  'CUT_OFF',
  'NOT_A_LETTER',
  'OTHER',
  /** только режим demo: фото не из fixtures/letters */
  'DEMO_UNKNOWN',
] as const;
export type UnreadableReason = (typeof UNREADABLE_REASONS)[number];

/** Ответ промпта transcribe.v1 (ТЗ v2 раздел 9). Текст модели о причине пользователю не показывается. */
export const TranscribeSchema = z.object({
  text: z.string().max(100_000),
  readable: z.boolean(),
  reason: z.enum(UNREADABLE_REASONS).nullable(),
});
export type TranscribeResult = z.infer<typeof TranscribeSchema>;

/** readable: true с пустым текстом: ответ не принят (повтор в пределах 3 попыток). */
export function checkTranscribe(r: TranscribeResult): string | null {
  if (r.readable && r.text.trim().length === 0)
    return 'readable: true, но text пустой. Если текст не читается, верни readable: false';
  return null;
}

/** B11: transcribe.v2 — несколько страниц одного письма за одно обращение. */
export const MAX_TRANSCRIBE_PAGES = 20;
export const TranscribePagesSchema = z.object({
  pages: z.array(TranscribeSchema).min(1).max(MAX_TRANSCRIBE_PAGES),
});
export type TranscribePagesResult = z.infer<typeof TranscribePagesSchema>;

/** Проверка ответа transcribe.v2: по элементу на каждое изображение, у каждой страницы те же правила, что в v1. */
export function checkTranscribePages(expected: number) {
  return (r: TranscribePagesResult): string | null => {
    if (r.pages.length !== expected)
      return `В pages ${r.pages.length} элементов, а изображений ${expected}. Верни ровно один элемент на каждое изображение, по порядку`;
    for (const [i, page] of r.pages.entries()) {
      const problem = checkTranscribe(page);
      if (problem) return `Страница ${i + 1}: ${problem}`;
    }
    return null;
  };
}
