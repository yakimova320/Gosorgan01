import { z } from 'zod';

/** Письмо в ответе API. Без путей и ключей хранения файлов. */
export interface LetterView {
  id: string;
  caseId: string | null;
  sourceType: 'PDF_TEXT' | 'IMAGE';
  text: string;
  pages: { n: number; readable: boolean; chars: number }[];
  files: { n: number; mime: string; bytes: number }[];
  createdAt: string;
}

/** Факт. Даты в value: YYYY-MM-DD. У исправленного человеком факта (USER) цитаты нет. */
export interface ClaimView {
  id: string;
  kind: string;
  value: string;
  text: string;
  quote: string | null;
  page: number | null;
  basis: 'DOCUMENT' | 'USER';
  status: 'UNCONFIRMED' | 'CONFIRMED' | 'REJECTED';
  supersedesId: string | null;
  /** Срок без точной даты («innerhalb von zwei Wochen»): дату нужно уточнить */
  relativeDeadline: boolean;
}

/**
 * Срок письма. date: YYYY-MM-DD (календарный день, без часового пояса).
 * active: true только если факт срока подтверждён; неподтверждённый срок — кандидат.
 */
export interface DeadlineView {
  id: string;
  claimId: string;
  date: string;
  kind: 'REPLY' | 'DOCUMENTS' | 'OBJECTION' | 'FOLLOW_UP';
  active: boolean;
  done: boolean;
}

export interface LetterDetail {
  letter: LetterView;
  claims: ClaimView[];
  deadlines: DeadlineView[];
}

/** Ответ POST /letters (ТЗ v2 раздел 8 пункт 7). */
export interface UploadLetterResponse extends LetterDetail {
  suggestions: { caseId: string; title: string; reason: string }[];
  /** Сколько полей ответа модели отброшено проверкой цитат и значений */
  extraction: { dropped: number };
}

export interface InboxItem {
  id: string;
  createdAt: string;
  sourceType: 'PDF_TEXT' | 'IMAGE';
  authority: string | null;
  caseNumber: string | null;
  unconfirmed: number;
}

const ids = z.array(z.string().min(1).max(64)).max(50);

export const ConfirmClaimsSchema = z
  .object({ confirm: ids.default([]), reject: ids.default([]) })
  .strict()
  .refine((v) => v.confirm.length + v.reject.length > 0, {
    message: 'Нужен хотя бы один факт',
  })
  .refine((v) => !v.confirm.some((id) => v.reject.includes(id)), {
    message: 'Один факт нельзя одновременно подтвердить и отклонить',
  });
export type ConfirmClaimsInput = z.infer<typeof ConfirmClaimsSchema>;

export const CorrectClaimSchema = z
  .object({
    value: z.string().trim().min(1).max(300),
    text: z.string().trim().min(1).max(300).optional(),
  })
  .strict();
export type CorrectClaimInput = z.infer<typeof CorrectClaimSchema>;

/** Только известные режимы: опечатка не должна запускать полное удаление. */
export const DeleteLetterQuerySchema = z
  .object({ mode: z.enum(['inbox']).optional() })
  .strict();

export const ListLettersQuerySchema = z
  .object({ inbox: z.enum(['true', 'false']).optional() })
  .strict();
