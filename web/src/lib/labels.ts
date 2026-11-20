import type { CaseStage, ClaimKind, DraftKind } from '../api/types';

/** Текст и цвет статуса дела. Статус передаётся словами, не только цветом. */
export const STAGE: Record<CaseStage, { label: string; tone: 'action' | 'wait' | 'done' | 'check' | 'overdue'; bar: string; progress: number }> = {
  OVERDUE: { label: 'Просрочено', tone: 'overdue', bar: 'var(--c-orange)', progress: 60 },
  DOCUMENTS: { label: 'Нужны документы', tone: 'action', bar: 'var(--c-coral)', progress: 55 },
  REPLY: { label: 'Нужен ответ', tone: 'action', bar: 'var(--c-coral)', progress: 55 },
  NEEDS_CHECK: { label: 'Нужна проверка', tone: 'check', bar: 'var(--c-mustard)', progress: 25 },
  WAITING: { label: 'Ждём ответа', tone: 'wait', bar: 'var(--c-mustard)', progress: 80 },
  OPEN: { label: 'Открыто', tone: 'wait', bar: 'var(--c-mustard)', progress: 40 },
  CLOSED: { label: 'Завершено', tone: 'done', bar: 'var(--c-teal)', progress: 100 },
};

export const CLAIM_KIND: Record<ClaimKind, string> = {
  AUTHORITY: 'Ведомство',
  CASE_NUMBER: 'Номер дела',
  LETTER_DATE: 'Дата письма',
  REQUIREMENT: 'Что просят',
  DEADLINE: 'Срок',
  AMOUNT: 'Сумма',
  OTHER: 'Другое',
};

export const DRAFT_KIND: Record<DraftKind, { title: string; text: string; unavailable: string }> = {
  CLARIFICATION: { title: 'Задать вопрос ведомству', text: 'Если что-то в письме непонятно', unavailable: 'Нужны подтверждённые факты письма' },
  DOCUMENTS: { title: 'Отправить документы', text: 'Сопроводительное письмо к документам', unavailable: 'Нужно подтверждённое требование письма' },
  EXTENSION: { title: 'Попросить продлить срок', text: 'Если не успеваете к сроку', unavailable: 'Нужен подтверждённый срок, который ещё не прошёл' },
  STATUS_REQUEST: { title: 'Узнать, как дела', text: 'Если ведомство долго не отвечает', unavailable: 'Нужны подтверждённые факты письма' },
};

/** Инициалы ведомства для круглого значка: «Jobcenter Musterstadt» → «JM» */
export function initials(name: string | null): string {
  if (!name) return '?';
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts[0][0] + (parts[1]?.[0] ?? parts[0][1] ?? '')).toUpperCase();
}
