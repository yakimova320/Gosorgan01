import { z } from 'zod';

/** Ответ archive.v1 (L05, вопросы к архиву писем). fragment — метка куска из промпта: F1, F2… */
export const ArchiveAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(4000),
  sources: z
    .array(
      z.object({
        fragment: z.string().trim().regex(/^F\d{1,2}$/),
        quote: z.string().trim().min(1).max(600),
      }),
    )
    .max(6)
    .default([]),
});
export type ArchiveAnswer = z.infer<typeof ArchiveAnswerSchema>;
