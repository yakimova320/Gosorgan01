import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'дата в формате YYYY-MM-DD');
const page = z.number().int().positive().nullable();

const single = <T extends z.ZodType>(value: T) =>
  z.object({ value: value.nullable(), quote: z.string().nullable(), page });

const item = <T extends z.ZodType>(value: T) =>
  z.object({ value, quote: z.string().min(1), page });

/** Ответ промпта extract.v1 (ТЗ v2 раздел 9). Проверка цитат по тексту письма — в B06. */
export const ExtractSchema = z.object({
  authority: single(z.string().min(1)),
  caseNumber: single(z.string().min(1)),
  letterDate: single(isoDate),
  requirements: z.array(item(z.string().min(1))).max(20),
  deadlines: z
    .array(
      item(isoDate).extend({
        kind: z.enum(['REPLY', 'DOCUMENTS', 'OBJECTION']),
      }),
    )
    .max(10),
  amounts: z
    .array(item(z.string().regex(/^\d+(\.\d{1,2})?$/, 'сумма вида 120.50')))
    .max(10),
});

export type ExtractResult = z.infer<typeof ExtractSchema>;

/** Ответ extract.v2: как v1 и сроки без точной даты (не пересчитываются в дату). */
export const ExtractV2Schema = ExtractSchema.extend({
  relativeDeadlines: z.array(item(z.string().min(1))).max(10),
});
export type ExtractV2Result = z.infer<typeof ExtractV2Schema>;
