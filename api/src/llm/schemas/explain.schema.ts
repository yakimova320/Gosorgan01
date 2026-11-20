import { z } from 'zod';

const statement = (max: number) =>
  z.object({
    text: z.string().trim().min(1).max(max),
    claimIds: z
      .array(z.string().min(1))
      .min(1, 'нужен хотя бы один claimId')
      .max(10),
  });

/** Ответ explain.v1. Сроки модель не возвращает: их берёт код из фактов (все сроки письма). */
export const ExplainSchema = z.object({
  about: statement(400),
  actions: z.array(statement(200)).max(5),
});
export type ExplainResult = z.infer<typeof ExplainSchema>;

/**
 * Ответ explain.v2 (K08, #133): как v1 и русский текст каждого требования ведомства.
 * Немецкий оригинал модель не возвращает: его берёт код из факта.
 */
export const ExplainV2Schema = ExplainSchema.extend({
  requests: z
    .array(
      z.object({
        claimId: z.string().min(1),
        ru: z.string().trim().min(1).max(200),
      }),
    )
    .max(20)
    // модель пропустила поле: объяснение без перевода (сайт покажет немецкий текст)
    .default([]),
});
export type ExplainV2Result = z.infer<typeof ExplainV2Schema>;
