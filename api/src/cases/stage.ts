/*
 * Статус дела (ТЗ v4 раздел 8, решение 16.6). Чистая функция без базы.
 * Порядок проверок важен: подтверждённый срок важнее непроверенных фактов,
 * просроченный срок важнее будущего. «Сегодня» — календарный день Europe/Berlin (YYYY-MM-DD).
 * Неподтверждённые сроки и сроки без даты на статус не влияют.
 */

export type CaseStage =
  | 'CLOSED'
  | 'OVERDUE'
  | 'DOCUMENTS'
  | 'REPLY'
  | 'NEEDS_CHECK'
  | 'WAITING'
  | 'OPEN';

export interface StageInput {
  status: 'OPEN' | 'CLOSED';
  deadlines: {
    date: string;
    kind: string;
    confirmed: boolean;
    done: boolean;
  }[];
  hasUnconfirmedClaims: boolean;
  /** последний черновик дела отправлен */
  lastDraftSent: boolean;
}

export interface StageResult {
  stage: CaseStage;
  /** срок, по которому определён статус: ближайший просроченный, иначе ближайший будущий */
  nextDeadline: string | null;
}

export function caseStage(input: StageInput, today: string): StageResult {
  const open = input.deadlines
    .filter((d) => d.confirmed && !d.done)
    .sort(
      (a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind),
    );
  const overdue = open.filter((d) => d.date < today);
  const upcoming = open.filter((d) => d.date >= today);
  const next = overdue[0]?.date ?? upcoming[0]?.date ?? null;

  if (input.status === 'CLOSED') return { stage: 'CLOSED', nextDeadline: null };
  if (overdue.length) return { stage: 'OVERDUE', nextDeadline: next };
  if (upcoming.length)
    return {
      stage: upcoming[0].kind === 'DOCUMENTS' ? 'DOCUMENTS' : 'REPLY',
      nextDeadline: next,
    };
  if (input.hasUnconfirmedClaims)
    return { stage: 'NEEDS_CHECK', nextDeadline: null };
  if (input.lastDraftSent) return { stage: 'WAITING', nextDeadline: null };
  return { stage: 'OPEN', nextDeadline: null };
}
