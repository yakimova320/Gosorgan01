import { z } from 'zod';
import type { VerificationReport } from './verification.js';

export const QUESTION_IDS = [
  'WHICH_DOCUMENTS',
  'DEADLINE',
  'REASON',
  'FORMAT',
  'AMOUNT',
] as const;

export const EXTENSION_REASON_IDS = [
  'DOCUMENTS_PENDING',
  'ADVICE',
  'NONE',
] as const;

const id = () => z.string().min(1).max(64);

/**
 * Входной вид WIDERSPRUCH допустим и ведёт к LEGAL_REFERRAL (ТЗ v3 6.6).
 * B12: DOCUMENTS, EXTENSION (срок и причина из готового списка), STATUS_REQUEST.
 */
export const CreateDraftSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('CLARIFICATION'),
      letterId: id(),
      questionId: z.enum(QUESTION_IDS),
      amountClaimId: id().optional(),
    })
    .strict(),
  z.object({ kind: z.literal('DOCUMENTS'), letterId: id() }).strict(),
  z
    .object({
      kind: z.literal('EXTENSION'),
      letterId: id(),
      deadlineClaimId: id().optional(),
      reason: z.enum(EXTENSION_REASON_IDS),
    })
    .strict(),
  z.object({ kind: z.literal('STATUS_REQUEST'), letterId: id() }).strict(),
  z.object({ kind: z.literal('WIDERSPRUCH') }).passthrough(),
]);
export type CreateDraftInput = z.infer<typeof CreateDraftSchema>;

export interface DraftView {
  id: string;
  caseId: string;
  letterId: string | null;
  questionId: string | null;
  kind: string;
  /** EXTENSION: причина и срок, который просим продлить */
  reason: string | null;
  deadlineClaimId: string | null;
  germanText: string;
  russianText: string;
  claimIds: string[];
  stale: boolean;
  /** B12: текст изменён человеком и проверен заново */
  edited: boolean;
  status: string;
  sentAt: string | null;
  sentVia: string | null;
  verification: VerificationReport;
  createdAt: string;
}

/** B12: правка черновика. Сохраняется только после повторной проверки обоих текстов. */
export const EditDraftSchema = z
  .object({
    germanText: z.string().trim().min(20).max(10_000),
    russianText: z.string().trim().min(20).max(10_000),
  })
  .strict();
export type EditDraftInput = z.infer<typeof EditDraftSchema>;

export interface DraftQuestions {
  letterId: string;
  caseId: string;
  questions: { id: (typeof QUESTION_IDS)[number]; ru: string }[];
  amounts: { claimId: string; value: string }[];
  /** B12: виды ответа, доступные по подтверждённым фактам письма (CLARIFICATION — если есть вопросы) */
  kinds: ('CLARIFICATION' | 'DOCUMENTS' | 'EXTENSION' | 'STATUS_REQUEST')[];
  /** EXTENSION: подтверждённые и не прошедшие сроки письма */
  deadlines: { claimId: string; date: string }[];
  extensionReasons: { id: (typeof EXTENSION_REASON_IDS)[number]; ru: string }[];
}

/** B12: каналы самостоятельной отправки (ТЗ v2 раздел 8 п. 22). */
export const SENT_VIA = ['post', 'online', 'email', 'in_person', 'other'] as const;

/**
 * «Я отправил(а)» — сообщение пользователя, не подтверждение доставки (ТЗ v3 6.6).
 * Дата не в будущем (проверяет сервер по Europe/Berlin). Срок закрывается только явно выбранный.
 */
export const ReportSentSchema = z
  .object({
    draftId: id().optional(),
    via: z.enum(SENT_VIA),
    date: z.iso.date({ message: 'Дата в формате ГГГГ-ММ-ДД' }),
    closeDeadlineId: id().optional(),
  })
  .strict();
export type ReportSentInput = z.infer<typeof ReportSentSchema>;

export interface ReportSentResult {
  caseId: string;
  draftId: string | null;
  closedDeadlineId: string | null;
}
