import { z } from 'zod';
import type { VerificationReport } from './verification.js';

export const QUESTION_IDS = [
  'WHICH_DOCUMENTS',
  'DEADLINE',
  'REASON',
  'FORMAT',
  'AMOUNT',
] as const;

/** Входной вид WIDERSPRUCH допустим и ведёт к LEGAL_REFERRAL (ТЗ v3 6.6). */
export const CreateDraftSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('CLARIFICATION'),
      letterId: z.string().min(1).max(64),
      questionId: z.enum(QUESTION_IDS),
      amountClaimId: z.string().min(1).max(64).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('WIDERSPRUCH') }).passthrough(),
]);
export type CreateDraftInput = z.infer<typeof CreateDraftSchema>;

export interface DraftView {
  id: string;
  caseId: string;
  letterId: string | null;
  questionId: string | null;
  kind: string;
  germanText: string;
  russianText: string;
  claimIds: string[];
  stale: boolean;
  status: string;
  verification: VerificationReport;
  createdAt: string;
}

export interface DraftQuestions {
  letterId: string;
  caseId: string;
  questions: { id: (typeof QUESTION_IDS)[number]; ru: string }[];
  amounts: { claimId: string; value: string }[];
}
