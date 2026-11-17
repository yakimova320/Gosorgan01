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
