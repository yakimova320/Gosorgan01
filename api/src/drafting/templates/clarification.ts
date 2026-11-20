import type { ConfirmedClaim } from '../../claims/claims.service.js';
import { deAmount, QUESTIONS, type QuestionId } from '../questions.js';

/*
 * Шаблон «запрос уточнения» (ТЗ v2 раздел 10, ТЗ v4 раздел 11). Без модели.
 * Немецкий текст и русский перевод — парные формулировки. Требование письма на немецком
 * в русский вариант не переводится: оно приводится как явно обозначенная цитата оригинала.
 * Отсутствующий факт — другой вариант фразы, а не пустое место.
 */

export interface SenderProfile {
  firstName: string;
  lastName: string;
  address: string;
  /** F05: номера из профиля, под адресом отправителя в обоих вариантах */
  numbers?: { label: string; value: string }[];
}

export interface ClarificationInput {
  claims: ConfirmedClaim[];
  profile: SenderProfile;
  questionId: QuestionId;
  amountClaimId?: string;
  /** дата создания, YYYY-MM-DD (Europe/Berlin) */
  today: string;
}

export interface BuiltDraft {
  germanText: string;
  russianText: string;
  claimIds: string[];
}

const de = (iso: string) => iso.split('-').reverse().join('.');

export function buildClarification(input: ClarificationInput): BuiltDraft {
  const one = (k: ConfirmedClaim['kind']) =>
    input.claims.find((c) => c.kind === k);
  const authority = one('AUTHORITY');
  const caseNumber = one('CASE_NUMBER');
  const letterDate = one('LETTER_DATE');
  const requirement = one('REQUIREMENT');
  const amount = input.amountClaimId
    ? input.claims.find((c) => c.id === input.amountClaimId)
    : undefined;
  const q = QUESTIONS[input.questionId];
  const name = `${input.profile.firstName} ${input.profile.lastName}`;
  const used = [authority, caseNumber, letterDate, requirement, amount].filter(
    (c): c is ConfirmedClaim => !!c,
  );

  // дательный падеж: «zu Ihrem Schreiben»
  const deLetter = letterDate
    ? `Ihrem Schreiben vom ${de(letterDate.value)}`
    : 'Ihrem Schreiben';
  const ruLetter = letterDate
    ? `ваше письмо от ${de(letterDate.value)}`
    : 'ваше письмо';
  const deQuote = requirement
    ? `In ${letterDate ? `Ihrem Schreiben vom ${de(letterDate.value)}` : 'Ihrem Schreiben'} schreiben Sie: „${requirement.value}“`
    : null;
  const ruQuote = requirement
    ? `В ${letterDate ? `письме от ${de(letterDate.value)}` : 'письме'} вы пишете (цитата из письма на немецком): «${requirement.value}»`
    : null;
  const amountText = amount ? deAmount(amount.value) : undefined;
  // Название номера пользователь пишет по-немецки, как в письме ведомства: в обоих вариантах одинаково.
  const senderNumbers = (input.profile.numbers ?? []).map(
    (n) => `${n.label}: ${n.value}`,
  );

  const germanText = [
    name,
    input.profile.address,
    ...senderNumbers,
    '',
    ...(authority ? [authority.value, ''] : []),
    `Datum: ${de(input.today)}`,
    ...(caseNumber ? [`Ihr Zeichen: ${caseNumber.value}`] : []),
    '',
    `Betreff: Bitte um Erläuterung zu ${deLetter}`,
    '',
    'Sehr geehrte Damen und Herren,',
    '',
    ...(deQuote ? [deQuote, ''] : []),
    q.de(amountText),
    '',
    'Vielen Dank im Voraus.',
    '',
    'Mit freundlichen Grüßen',
    name,
  ].join('\n');

  const russianText = [
    name,
    input.profile.address,
    ...senderNumbers,
    '',
    ...(authority ? [authority.value, ''] : []),
    `Дата: ${de(input.today)}`,
    ...(caseNumber ? [`Ваш номер дела: ${caseNumber.value}`] : []),
    '',
    `Тема: просьба пояснить ${ruLetter}`,
    '',
    'Уважаемые дамы и господа,',
    '',
    ...(ruQuote ? [ruQuote, ''] : []),
    q.ru(amountText),
    '',
    'Заранее спасибо.',
    '',
    'С уважением,',
    name,
  ].join('\n');

  return { germanText, russianText, claimIds: used.map((c) => c.id) };
}
