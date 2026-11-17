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
