import { z } from 'zod';
import type { ClaimView, DeadlineView } from '../letters/letters.dto.js';
import type { CaseStage } from './stage.js';

export interface CaseSummary {
  id: string;
  title: string;
  authority: string | null;
  caseNumber: string | null;
  origin: 'INCOMING' | 'OUTGOING';
  status: 'OPEN' | 'CLOSED';
  stage: CaseStage;
  /** YYYY-MM-DD: ближайший просроченный, иначе ближайший будущий подтверждённый срок */
  nextDeadline: string | null;
  counts: { letters: number; unconfirmed: number };
  /** Поправка 14 (23.11): сколько шагов дела сделано, например «2 из 3 · 67 %» */
  progress: CaseProgress;
  updatedAt: string;
}

export interface CaseProgress {
  done: number;
  total: number;
  percent: number;
  steps: { key: 'CHECK' | 'DEADLINES' | 'REPLY'; label: string; done: boolean }[];
}

export interface TimelineItem {
  id: string;
  type: string;
  at: string;
  title: string;
  subtitle?: string;
  letterId?: string;
  draftId?: string;
}

export interface CaseDetail extends CaseSummary {
  letters: {
    id: string;
    createdAt: string;
    sourceType: 'PDF_TEXT' | 'IMAGE' | 'PDF_SCAN';
    title: string | null;
    authority: string | null;
    unconfirmed: number;
  }[];
  claims: ClaimView[];
  deadlines: DeadlineView[];
  drafts: {
    id: string;
    kind: string;
    status: string;
    stale: boolean;
    createdAt: string;
  }[];
  timeline: TimelineItem[];
}

export interface HistoryItem extends TimelineItem {
  caseId: string;
  caseTitle: string;
}

export interface TraceItem {
  id: string;
  letterId: string | null;
  promptName: string;
  promptVersion: number;
  model: string;
  ok: boolean;
  error: string | null;
  attempts: number;
  durationMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  createdAt: string;
  /** уже замаскированные вход и выход */
  input: string;
  output: string | null;
}

export const ListCasesQuerySchema = z
  .object({
    status: z.enum(['active', 'done', 'all']).default('active'),
    q: z.string().trim().max(100).optional(),
  })
  .strict();
export type ListCasesQuery = z.infer<typeof ListCasesQuerySchema>;

export const UpdateCaseSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    status: z.enum(['OPEN', 'CLOSED']).optional(),
  })
  .strict()
  .refine((v) => v.title !== undefined || v.status !== undefined, {
    message: 'Нечего менять',
  });
export type UpdateCaseInput = z.infer<typeof UpdateCaseSchema>;

export const HistoryQuerySchema = z
  .object({
    type: z.enum(['letter', 'case', 'question', 'draft']).optional(),
    cursor: z.string().max(200).optional(),
  })
  .strict();
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>;
