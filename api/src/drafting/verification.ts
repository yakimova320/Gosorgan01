import type { ConfirmedClaim } from '../claims/claims.service.js';
import { datesInAny, numbersIn } from '../letters/explain.logic.js';
import type { SenderProfile } from './templates/clarification.js';

/*
 * Проверка черновика без модели (ТЗ v2 раздел 10, ТЗ v3 6.6). Для немецкого и русского варианта.
 * «Пройдена» значит: текст соответствует шаблону и источникам. Это не юридическая проверка.
 * Разрешённые источники дат и чисел: подтверждённые факты черновика, поля профиля
 * (адрес, имя, фамилия, номера отправителя), дата создания. Текст вопроса источником не является.
 */

export interface VerificationReport {
  passed: boolean;
  checks: { name: string; passed: boolean; details: string | null }[];
  checklist: { claimId: string; text: string; quote: string | null }[];
  note: string;
}

export interface VerifyInput {
  germanText: string;
  russianText: string;
  claimIds: string[];
  confirmed: ConfirmedClaim[];
  profile: SenderProfile;
  today: string;
}

const LABEL: Record<string, string> = {
  AUTHORITY: 'Ведомство',
  CASE_NUMBER: 'Номер дела',
  LETTER_DATE: 'Дата письма',
  REQUIREMENT: 'Требование',
  AMOUNT: 'Сумма',
};

export function verifyDraft(input: VerifyInput): VerificationReport {
  const byId = new Map(input.confirmed.map((c) => [c.id, c]));
  const used = input.claimIds
    .map((id) => byId.get(id))
    .filter((c): c is ConfirmedClaim => !!c);
  const sources = [
    ...used.flatMap((c) => [c.value, c.quote ?? '']),
    input.profile.address,
    input.profile.firstName,
    input.profile.lastName,
    ...(input.profile.numbers ?? []).flatMap((n) => [n.label, n.value]),
  ].join('\n');
  const allowedDates = new Set([
    ...datesInAny(sources),
    ...used.map((c) => c.value),
    input.today,
  ]);
  const allowedNumbers = new Set([
    ...numbersIn(sources),
    ...[...sources.matchAll(/\d+/g)].map((m) => Number(m[0]).toFixed(2)),
  ]);
  const caseNumber = used.find((c) => c.kind === 'CASE_NUMBER');

  const checks: VerificationReport['checks'] = [];
  const add = (name: string, problem: string | null) =>
    checks.push({ name, passed: !problem, details: problem });

  const unknownIds = input.claimIds.filter((id) => !byId.has(id));
  add(
    'claimIds: только подтверждённые факты',
    unknownIds.length ? `не подтверждены: ${unknownIds.join(', ')}` : null,
  );

  for (const [lang, text] of [
    ['de', input.germanText],
    ['ru', input.russianText],
  ] as const) {
    const badDates = datesInAny(text).filter((d) => !allowedDates.has(d));
    add(
      `${lang}: даты из источников`,
      badDates.length ? `не из источников: ${badDates.join(', ')}` : null,
    );

    const badNumbers = numbersIn(text).filter((n) => !allowedNumbers.has(n));
    add(
      `${lang}: числа из источников`,
      badNumbers.length ? `не из источников: ${badNumbers.join(', ')}` : null,
    );

    const marker =
      lang === 'de' ? /Ihr Zeichen:\s*(.+)/ : /Ваш номер дела:\s*(.+)/;
    const shown = marker.exec(text)?.[1]?.trim();
    add(
      `${lang}: номер дела совпадает`,
      shown && shown !== caseNumber?.value
        ? `в тексте ${shown}, в фактах ${caseNumber?.value ?? 'нет'}`
        : null,
    );

    const pastDeadlines = [
      ...text.matchAll(/\b(?:bis(?: zum)?|до)\s+(\d{1,2}\.\d{1,2}\.\d{4})/gi),
    ]
      .map((m) => datesInAny(m[1])[0])
      .filter((d) => d && d < input.today);
    add(
      `${lang}: нет прошедших сроков как будущих`,
      pastDeadlines.length ? `прошедшие: ${pastDeadlines.join(', ')}` : null,
    );

    add(
      `${lang}: нет незаполненных мест`,
      /\{\{|\}\}|…|\.\.\.|undefined|null/.test(text)
        ? 'в тексте осталась метка'
        : null,
    );
  }

  return {
    passed: checks.every((c) => c.passed),
    checks,
    checklist: used.map((c) => ({
      claimId: c.id,
      text: `${LABEL[c.kind] ?? c.kind}: ${c.value}`,
      quote: c.quote,
    })),
    note: 'Проверка: текст соответствует шаблону и подтверждённым фактам. Это не юридическая проверка.',
  };
}
