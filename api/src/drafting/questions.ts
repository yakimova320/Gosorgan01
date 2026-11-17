import type { ConfirmedClaim } from '../claims/claims.service.js';

/*
 * Готовые вопросы для черновика «запрос уточнения» (B10): проверенные пары DE/RU, без свободного текста.
 * Сервер сам решает, какой вопрос доступен: по подтверждённым фактам выбранного письма.
 * В текстах вопросов нет чисел и дат; сумма подставляется только из выбранного подтверждённого факта.
 */

export type QuestionId =
  'WHICH_DOCUMENTS' | 'DEADLINE' | 'REASON' | 'FORMAT' | 'AMOUNT';

export interface Question {
  id: QuestionId;
  de: (amount?: string) => string;
  ru: (amount?: string) => string;
  /** вопрос доступен, только если среди подтверждённых фактов есть факт этого вида */
  requires?: ConfirmedClaim['kind'];
}

export const QUESTIONS: Record<QuestionId, Question> = {
  WHICH_DOCUMENTS: {
    id: 'WHICH_DOCUMENTS',
    requires: 'REQUIREMENT',
    de: () =>
      'Bitte teilen Sie mir mit, welche Unterlagen genau Sie von mir benötigen.',
    ru: () => 'Пожалуйста, сообщите, какие именно документы вам от меня нужны.',
  },
  DEADLINE: {
    id: 'DEADLINE',
    de: () =>
      'Bitte teilen Sie mir mit, bis wann genau ich Ihnen antworten soll.',
    ru: () =>
      'Пожалуйста, сообщите, до какого именно срока мне нужно ответить.',
  },
  REASON: {
    id: 'REASON',
    de: () =>
      'Bitte teilen Sie mir mit, aus welchem Grund Sie diese Angaben benötigen.',
    ru: () => 'Пожалуйста, сообщите, по какой причине вам нужны эти сведения.',
  },
  FORMAT: {
    id: 'FORMAT',
    requires: 'REQUIREMENT',
    de: () =>
      'Bitte teilen Sie mir mit, in welcher Form ich die Unterlagen einreichen soll: per Post, online oder persönlich.',
    ru: () =>
      'Пожалуйста, сообщите, в какой форме прислать документы: по почте, онлайн или лично.',
  },
  AMOUNT: {
    id: 'AMOUNT',
    requires: 'AMOUNT',
    de: (amount) =>
      `Bitte erläutern Sie mir, wie sich der Betrag von ${amount} € zusammensetzt.`,
    ru: (amount) =>
      `Пожалуйста, объясните, из чего складывается сумма ${amount} €.`,
  },
};

/** Доступные вопросы для письма по его подтверждённым фактам. */
export function availableQuestions(claims: ConfirmedClaim[]): QuestionId[] {
  const kinds = new Set(claims.map((c) => c.kind));
  return (Object.values(QUESTIONS) as Question[])
    .filter((q) => !q.requires || kinds.has(q.requires))
    .map((q) => q.id);
}

/** 1234.5 → 1.234,50 */
export function deAmount(value: string): string {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}
