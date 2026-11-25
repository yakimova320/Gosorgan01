import type { CaseStage, ClaimKind, DraftKind } from '../api/types';
import { t } from '../i18n';

/** Текст и цвет статуса дела. Статус передаётся словами, не только цветом. */
export const STAGE: Record<CaseStage, { label: string; tone: 'action' | 'wait' | 'done' | 'check' | 'overdue'; bar: string; progress: number }> = {
  OVERDUE: { label: t('Просрочено'), tone: 'overdue', bar: 'var(--c-orange)', progress: 60 },
  DOCUMENTS: { label: t('Нужны документы'), tone: 'action', bar: 'var(--c-coral)', progress: 55 },
  REPLY: { label: t('Нужен ответ'), tone: 'action', bar: 'var(--c-coral)', progress: 55 },
  NEEDS_CHECK: { label: t('Нужна проверка'), tone: 'check', bar: 'var(--c-mustard)', progress: 25 },
  WAITING: { label: t('Ждём ответа'), tone: 'wait', bar: 'var(--c-mustard)', progress: 80 },
  OPEN: { label: t('Открыто'), tone: 'wait', bar: 'var(--c-mustard)', progress: 40 },
  CLOSED: { label: t('Завершено'), tone: 'done', bar: 'var(--c-teal)', progress: 100 },
};

export const CLAIM_KIND: Record<ClaimKind, string> = {
  AUTHORITY: t('Ведомство'),
  CASE_NUMBER: t('Номер дела'),
  LETTER_DATE: t('Дата письма'),
  REQUIREMENT: t('Что просят'),
  DEADLINE: t('Срок'),
  AMOUNT: t('Сумма'),
  OTHER: t('Другое'),
};

export const DRAFT_KIND: Record<DraftKind, { title: string; text: string; unavailable: string }> = {
  CLARIFICATION: { title: t('Задать вопрос ведомству'), text: t('Если что-то в письме непонятно'), unavailable: t('Нужны подтверждённые факты письма') },
  DOCUMENTS: { title: t('Отправить документы'), text: t('Сопроводительное письмо к документам'), unavailable: t('Нужно подтверждённое требование письма') },
  EXTENSION: { title: t('Попросить продлить срок'), text: t('Если не успеваете к сроку'), unavailable: t('Нужен подтверждённый срок, который ещё не прошёл') },
  STATUS_REQUEST: { title: t('Узнать, как дела'), text: t('Если ведомство долго не отвечает'), unavailable: t('Нужны подтверждённые факты письма') },
};

/** Инициалы ведомства для круглого значка: «Jobcenter Musterstadt» → «JM» */
export function initials(name: string | null): string {
  if (!name) return '?';
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts[0][0] + (parts[1]?.[0] ?? parts[0][1] ?? '')).toUpperCase();
}
