import type { ExtractV2Result } from '../llm/schemas/extract.schema.js';
import {
  findQuote,
  isCalendarDate,
  valueInQuote,
  type CheckedKind,
  type PageText,
} from './claim-check.js';

/** Факт, готовый к записи. Срок без точной даты сохраняется как OTHER без Deadline. */
export interface ClaimDraft {
  kind:
    | 'AUTHORITY'
    | 'CASE_NUMBER'
    | 'LETTER_DATE'
    | 'REQUIREMENT'
    | 'DEADLINE'
    | 'AMOUNT'
    | 'OTHER';
  value: string;
  text: string;
  quote: string;
  page: number;
  deadlineKind?: 'REPLY' | 'DOCUMENTS' | 'OBJECTION';
}

export interface DroppedField {
  field: string;
  reason: string;
}

const DEADLINE_RU = {
  REPLY: 'ответить',
  DOCUMENTS: 'прислать документы',
  OBJECTION: 'возражение (Widerspruch)',
} as const;

/** 2026-11-30 → 30.11.2026 (без часового пояса). */
export function deDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** 1234.5 → 1.234,50 */
export function deAmount(value: string): string {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

/** Русский текст факта собирает код (ТЗ v3 6.3), без модели. */
export function claimText(
  kind: ClaimDraft['kind'] | 'RELATIVE_DEADLINE',
  value: string,
  deadlineKind?: ClaimDraft['deadlineKind'],
): string {
  switch (kind) {
    case 'AUTHORITY':
      return `Ведомство: ${value}`;
    case 'CASE_NUMBER':
      return `Номер дела: ${value}`;
    case 'LETTER_DATE':
      return `Дата письма: ${deDate(value)}`;
    case 'REQUIREMENT':
      return `Требование: ${value}`;
    case 'DEADLINE':
      return `Срок: до ${deDate(value)}${deadlineKind ? ` (${DEADLINE_RU[deadlineKind]})` : ''}`;
    case 'AMOUNT':
      return `Сумма: ${deAmount(value)} €`;
    case 'RELATIVE_DEADLINE':
      return `Срок без точной даты: «${value}». Точную дату нужно уточнить`;
    default:
      return value;
  }
}

/**
 * Ответ extract → факты. Каждое поле проверяется: цитата в тексте (на своей странице),
 * значение в цитате. Не прошло: поле отбрасывается и считается в dropped. Отсутствие значения — не факт.
 */
export function buildClaims(
  result: ExtractV2Result,
  pages: PageText[],
  fuzzy: boolean,
): { claims: ClaimDraft[]; dropped: DroppedField[] } {
  const claims: ClaimDraft[] = [];
  const dropped: DroppedField[] = [];

  const take = (
    field: string,
    kind: CheckedKind,
    item: { value: string | null; quote: string | null; page: number | null },
    extra: Partial<ClaimDraft> = {},
  ) => {
    if (item.value === null && item.quote === null) return; // в письме нет: не факт
    if (item.value === null || item.quote === null) {
      dropped.push({ field, reason: 'нет значения или цитаты' });
      return;
    }
    const match = findQuote(item.quote, pages, item.page, fuzzy);
    if (!match) {
      dropped.push({ field, reason: 'цитаты нет в письме' });
      return;
    }
    const problem = valueInQuote(kind, item.value, item.quote);
    if (problem) {
      dropped.push({ field, reason: problem });
      return;
    }
    const claimKind: ClaimDraft['kind'] =
      kind === 'RELATIVE_DEADLINE' ? 'OTHER' : kind;
    claims.push({
      kind: claimKind,
      value: item.value,
      text: claimText(kind, item.value, extra.deadlineKind),
      quote: item.quote,
      page: match.page,
      ...extra,
    });
  };

  take('authority', 'AUTHORITY', result.authority);
  take('caseNumber', 'CASE_NUMBER', result.caseNumber);
  take('letterDate', 'LETTER_DATE', result.letterDate);
  result.requirements.forEach((r, i) =>
    take(`requirements.${i}`, 'REQUIREMENT', r),
  );
  result.deadlines.forEach((d, i) =>
    take(`deadlines.${i}`, 'DEADLINE', d, { deadlineKind: d.kind }),
  );
  result.amounts.forEach((a, i) => take(`amounts.${i}`, 'AMOUNT', a));
  result.relativeDeadlines.forEach((r, i) =>
    take(`relativeDeadlines.${i}`, 'RELATIVE_DEADLINE', r),
  );

  // Одинаковые факты (одна цитата и значение) не дублируются.
  const seen = new Set<string>();
  const unique = claims.filter((c) => {
    const key = `${c.kind}|${c.value}|${c.quote}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { claims: unique, dropped };
}

/** Значение, которое вводит человек при исправлении: проверка по виду факта. */
export function checkUserValue(kind: string, value: string): string | null {
  const v = value.trim();
  if (v.length === 0) return 'Пустое значение';
  if (v.length > 300) return 'Не больше 300 знаков';
  if ((kind === 'DEADLINE' || kind === 'LETTER_DATE') && !isCalendarDate(v))
    return 'Дата в формате ГГГГ-ММ-ДД, такой день должен существовать';
  if (kind === 'AMOUNT' && !/^\d+(\.\d{1,2})?$/.test(v))
    return 'Сумма числом, например 120.50';
  return null;
}
