import { z } from 'zod';

/** Ответ translate.v1 (поправка 7, 23.11): машинный перевод всего письма на русский. */
export const TranslateSchema = z.object({
  text: z.string().trim().min(1).max(40000),
});
export type TranslateResult = z.infer<typeof TranslateSchema>;
