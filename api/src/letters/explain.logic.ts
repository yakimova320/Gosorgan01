import { createHash } from 'node:crypto';
import type { ExplainResult } from '../llm/schemas/explain.schema.js';
import { datesIn } from './claim-check.js';

/*
 * Объяснение письма (B08): проверки кодом и сборка ответа (ТЗ v2 раздел 9 проверка 3, ТЗ v3 6.5, Q1, Q2).
 * - каждое утверждение ссылается на факты (claimIds), только из переданного списка;
 * - даты и числа утверждения есть в значениях или цитатах именно его фактов (с учётом немецкого и русского формата);
 * - нет новых обязанностей, последствий и юридических выводов, которых нет в цитатах;
 * - сроки и флаги «не подтверждено» ставит код, а не модель.
 */

export interface ExplainFact {
  id: string;
  kind: string;
  value: string;
  quote: string | null;
  status: 'UNCONFIRMED' | 'CONFIRMED';
  deadlineKind?: string;
}

export interface ExplanationView {
  lang: 'ru';
  about: { text: string; claimIds: string[]; unconfirmed: boolean };
  actions: { text: string; claimIds: string[]; unconfirmed: boolean }[];
  /** все сроки письма с датой; confirmed: false — срок ещё не подтверждён */
  deadlines: {
    date: string;
    claimId: string;
    kind: string;
    confirmed: boolean;
  }[];
  /** в объяснении есть факты, которые человек ещё не подтвердил */
  unconfirmed: boolean;
}

/** Версия фактов: меняется при любом изменении статуса или значения действующих фактов. */
export function factsVersion(facts: ExplainFact[]): string {
  const rows = facts.map((f) => `${f.id}|${f.status}|${f.value}`).sort();
  return createHash('sha256')
    .update(rows.join('\n'))
    .digest('hex')
    .slice(0, 32);
}

export function factsForPrompt(facts: ExplainFact[]): string {
  return JSON.stringify(
    facts.map((f) => ({
      id: f.id,
      kind: f.kind,
      status: f.status,
      value: f.value,
      quote: f.quote,
    })),
    null,
    1,
  );
}

// ---------- Даты и числа ----------

const RU_MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

const DATE_PATTERNS = [
  /\b\d{1,2}\.\s?\d{1,2}\.\s?(?:\d{4}|\d{2})\b/g,
  /\b\d{1,2}\.\s*[A-Za-zÄÖÜäöü]+\.?\s+\d{4}\b/g,
  /\b\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+\d{4}\b/giu,
  /\b\d{4}-\d{2}-\d{2}\b/g,
];

/** Календарные даты (YYYY-MM-DD) в тексте: немецкий, русский формат и ISO. */
export function datesInAny(text: string): string[] {
  const out = [...datesIn(text)];
  for (const m of text.matchAll(/\b(\d{1,2})\s+([а-яё]+)\s+(\d{4})\b/giu)) {
    const month = RU_MONTHS.indexOf(m[2].toLowerCase()) + 1;
    if (month > 0)
      out.push(
        `${m[3]}-${String(month).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`,
      );
  }
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.push(m[0]);
  return out;
}

/** Числа вне дат: 1.234,50 / 1 234,50 / 120,5 / 120.50 / 2026 → нормализованные строки. */
export function numbersIn(text: string): string[] {
  let rest = text;
  for (const p of DATE_PATTERNS) rest = rest.replace(p, ' ');
  const out: string[] = [];
  for (const m of rest.matchAll(
    /\d{1,3}(?:[.\u00a0 ]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g,
  )) {
    let raw = m[0];
    if (/[.\u00a0 ]\d{3}/.test(raw) && !/^\d+\.\d{1,2}$/.test(raw))
      raw = raw.replace(/[.\u00a0 ]/g, '');
    out.push(Number(raw.replace(',', '.')).toFixed(2));
  }
  return out;
}

// ---------- Запрещённое содержание ----------

/** Слово в объяснении допустимо, только если в цитатах фактов этого утверждения есть основание. */
const FORBIDDEN: { ru: RegExp; basis: RegExp; what: string }[] = [
  {
    ru: /штраф|пен[яи]|санкци/iu,
    basis: /bußgeld|strafe|säumnis|sanktion|zuschlag/iu,
    what: 'санкции',
  },
  {
    ru: /лиш(ат|ит|ение)|прекрат(ят|ит|ятся|ение)|сократ(ят|ит)|отказ(ать|ут|е|ом)/iu,
    basis: /einstell|entzieh|kürz|versag|ablehn|entfall/iu,
    what: 'последствия',
  },
  {
    ru: /суд|адвокат|юрист|незаконн|имеете право|по закону|возражени|widerspruch|einspruch|обжал/iu,
    basis: /widerspruch|einspruch|gericht|rechtsbehelf|klage/iu,
    what: 'юридические выводы',
  },
];

/**
 * Проверка ответа модели. Причина отказа (для повтора) или null.
 * Вызывается внутри LlmService: повторы входят в общие 3 попытки.
 */
export function checkExplanation(
  r: ExplainResult,
  facts: ExplainFact[],
): string | null {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const statements = [
    { name: 'about', ...r.about },
    ...r.actions.map((a, i) => ({ name: `actions.${i}`, ...a })),
  ];
  for (const s of statements) {
    const unknown = s.claimIds.filter((id) => !byId.has(id));
    if (unknown.length)
      return `${s.name}: неизвестные claimIds ${unknown.join(', ')}`;
    const refs = s.claimIds.map((id) => byId.get(id)!);
    const source = refs.map((f) => `${f.value}\n${f.quote ?? ''}`).join('\n');

    const allowedDates = new Set([
      ...datesInAny(source),
      ...refs.map((f) => f.value),
    ]);
    const badDate = datesInAny(s.text).find((d) => !allowedDates.has(d));
    if (badDate)
      return `${s.name}: дата ${badDate} не из фактов этого утверждения`;

    // числа фактов и отдельные числа внутри их дат и номеров (например, год 2026)
    const allowedNumbers = new Set([
      ...numbersIn(source),
      ...[...source.matchAll(/\d+/g)].map((m) => Number(m[0]).toFixed(2)),
    ]);
    const badNumber = numbersIn(s.text).find((n) => !allowedNumbers.has(n));
    if (badNumber)
      return `${s.name}: число ${badNumber} не из фактов этого утверждения`;

    const quotes = refs.map((f) => f.quote ?? '').join('\n');
    for (const rule of FORBIDDEN) {
      if (rule.ru.test(s.text) && !rule.basis.test(quotes))
        return `${s.name}: ${rule.what} без основания в цитатах фактов. Не добавляй обязанностей, последствий и юридических выводов`;
    }
  }
  return null;
}

/** Ответ API: флаги «не подтверждено» и все сроки письма ставит код. */
export function finalizeExplanation(
  r: ExplainResult,
  facts: ExplainFact[],
): ExplanationView {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const unconfirmed = (ids: string[]) =>
    ids.some((id) => byId.get(id)?.status !== 'CONFIRMED');
  const about = { ...r.about, unconfirmed: unconfirmed(r.about.claimIds) };
  const actions = r.actions.map((a) => ({
    ...a,
    unconfirmed: unconfirmed(a.claimIds),
  }));
  const deadlines = facts
    .filter((f) => f.kind === 'DEADLINE' && /^\d{4}-\d{2}-\d{2}$/.test(f.value))
    .map((f) => ({
      date: f.value,
      claimId: f.id,
      kind: f.deadlineKind ?? 'REPLY',
      confirmed: f.status === 'CONFIRMED',
    }))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.claimId.localeCompare(b.claimId),
    );
  return {
    lang: 'ru',
    about,
    actions,
    deadlines,
    unconfirmed:
      about.unconfirmed ||
      actions.some((a) => a.unconfirmed) ||
      deadlines.some((d) => !d.confirmed),
  };
}
