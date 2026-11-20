import type { ConfirmedClaim } from '../../claims/claims.service.js';
import type { BuiltDraft, SenderProfile } from './clarification.js';

/*
 * B12: шаблоны DOCUMENTS, EXTENSION, STATUS_REQUEST (ТЗ v3 6.6, ТЗ v4 раздел 11 п. 5). Без модели.
 * Та же рамка письма, что у CLARIFICATION: отправитель, ведомство, дата, номер дела, тема, обращение, подпись.
 * Немецкий текст и русский перевод — парные формулировки; требование письма в русский вариант
 * не переводится, а приводится как обозначенная цитата оригинала. В фиксированных фразах нет чисел и дат.
 */

export type ReplyKind = 'DOCUMENTS' | 'EXTENSION' | 'STATUS_REQUEST';

/** Причина просьбы о продлении: выбирает человек, текст — готовая пара фраз. */
export const EXTENSION_REASONS = {
  DOCUMENTS_PENDING: {
    ru: 'Мне нужно больше времени, чтобы собрать документы',
    de: 'Ich benötige mehr Zeit, um die Unterlagen vollständig zusammenzustellen.',
    ruText: 'Мне нужно больше времени, чтобы полностью собрать документы.',
  },
  ADVICE: {
    ru: 'Я хочу сначала получить консультацию',
    de: 'Ich möchte mich vorher beraten lassen.',
    ruText: 'Я хочу сначала получить консультацию.',
  },
  NONE: {
    ru: 'Без указания причины',
    de: null,
    ruText: null,
  },
} as const;
export type ExtensionReason = keyof typeof EXTENSION_REASONS;

export interface ReplyInput {
  kind: ReplyKind;
  claims: ConfirmedClaim[];
  profile: SenderProfile;
  /** дата создания, YYYY-MM-DD (Europe/Berlin) */
  today: string;
  /** EXTENSION: факт срока, который просим продлить */
  deadlineClaimId?: string;
  extensionReason?: ExtensionReason;
}

const de = (iso: string) => iso.split('-').reverse().join('.');

/** Сроки письма, о продлении которых можно просить: подтверждённые и не прошедшие. */
export function extendableDeadlines(
  claims: ConfirmedClaim[],
  today: string,
): ConfirmedClaim[] {
  return claims.filter(
    (c) =>
      c.kind === 'DEADLINE' && /^\d{4}-\d{2}-\d{2}$/.test(c.value) && c.value >= today,
  );
}

/** Какие виды ответа доступны по подтверждённым фактам письма. */
export function availableReplyKinds(
  claims: ConfirmedClaim[],
  today: string,
): ReplyKind[] {
  const kinds: ReplyKind[] = [];
  if (claims.some((c) => c.kind === 'REQUIREMENT')) kinds.push('DOCUMENTS');
  if (extendableDeadlines(claims, today).length > 0) kinds.push('EXTENSION');
  if (claims.length > 0) kinds.push('STATUS_REQUEST');
  return kinds;
}

export function buildReply(input: ReplyInput): BuiltDraft {
  const one = (k: ConfirmedClaim['kind']) =>
    input.claims.find((c) => c.kind === k);
  const authority = one('AUTHORITY');
  const caseNumber = one('CASE_NUMBER');
  const letterDate = one('LETTER_DATE');
  const requirement = one('REQUIREMENT');
  const deadline =
    input.kind === 'EXTENSION'
      ? input.claims.find((c) => c.id === input.deadlineClaimId)
      : undefined;
  const name = `${input.profile.firstName} ${input.profile.lastName}`;
  const senderNumbers = (input.profile.numbers ?? []).map(
    (n) => `${n.label}: ${n.value}`,
  );

  // «Ihrem Schreiben vom …» (дательный падеж) / «вашему письму от …»
  const deLetter = letterDate
    ? `Ihrem Schreiben vom ${de(letterDate.value)}`
    : 'Ihrem Schreiben';
  const ruLetterDat = letterDate
    ? `вашему письму от ${de(letterDate.value)}`
    : 'вашему письму';
  const ruIn = letterDate ? `В письме от ${de(letterDate.value)}` : 'В письме';
  const deIn = `In ${deLetter}`;

  let subject: { de: string; ru: string };
  let body: { de: string[]; ru: string[] };
  const used: (ConfirmedClaim | undefined)[] = [authority, caseNumber, letterDate];

  switch (input.kind) {
    case 'DOCUMENTS':
      used.push(requirement);
      subject = {
        de: `Übersendung von Unterlagen zu ${deLetter}`,
        ru: `документы к ${ruLetterDat}`,
      };
      body = {
        de: [
          ...(requirement
            ? [`${deIn} bitten Sie: „${requirement.value}“`]
            : []),
          'Anbei übersende ich Ihnen die angeforderten Unterlagen.',
          'Bitte bestätigen Sie mir den Eingang der Unterlagen.',
        ],
        ru: [
          ...(requirement
            ? [
                `${ruIn} вы просите (цитата из письма на немецком): «${requirement.value}»`,
              ]
            : []),
          'Прилагаю запрошенные документы.',
          'Пожалуйста, подтвердите получение документов.',
        ],
      };
      break;
    case 'EXTENSION': {
      used.push(deadline);
      const reason = EXTENSION_REASONS[input.extensionReason ?? 'NONE'];
      subject = {
        de: `Bitte um Fristverlängerung zu ${deLetter}`,
        ru: `просьба продлить срок по ${ruLetterDat}`,
      };
      body = {
        de: [
          deadline
            ? `${deIn} haben Sie mir eine Frist bis zum ${de(deadline.value)} gesetzt.`
            : `${deIn} haben Sie mir eine Frist gesetzt.`,
          [reason.de, 'Ich bitte Sie, die Frist um zwei Wochen zu verlängern.']
            .filter(Boolean)
            .join(' '),
          'Bitte bestätigen Sie mir die neue Frist.',
        ],
        ru: [
          deadline
            ? `${ruIn} вы установили мне срок до ${de(deadline.value)}.`
            : `${ruIn} вы установили мне срок.`,
          [reason.ruText, 'Прошу продлить срок на две недели.']
            .filter(Boolean)
            .join(' '),
          'Пожалуйста, подтвердите новый срок.',
        ],
      };
      break;
    }
    case 'STATUS_REQUEST':
      subject = {
        de: `Sachstandsanfrage zu ${deLetter}`,
        ru: `запрос о ходе рассмотрения по ${ruLetterDat}`,
      };
      body = {
        de: [
          'Bitte teilen Sie mir den aktuellen Stand der Bearbeitung mit.',
          'Falls Sie noch Unterlagen oder Angaben von mir benötigen, teilen Sie mir das bitte mit.',
        ],
        ru: [
          'Пожалуйста, сообщите, на каком этапе рассмотрение.',
          'Если вам нужны от меня ещё документы или сведения, пожалуйста, сообщите.',
        ],
      };
      break;
  }

  const frame = (lang: 'de' | 'ru') => {
    const t =
      lang === 'de'
        ? {
            date: 'Datum',
            ref: 'Ihr Zeichen',
            subject: `Betreff: ${subject.de}`,
            hello: 'Sehr geehrte Damen und Herren,',
            thanks: 'Vielen Dank im Voraus.',
            bye: 'Mit freundlichen Grüßen',
            paragraphs: body.de,
          }
        : {
            date: 'Дата',
            ref: 'Ваш номер дела',
            subject: `Тема: ${subject.ru}`,
            hello: 'Уважаемые дамы и господа,',
            thanks: 'Заранее спасибо.',
            bye: 'С уважением,',
            paragraphs: body.ru,
          };
    return [
      name,
      input.profile.address,
      ...senderNumbers,
      '',
      ...(authority ? [authority.value, ''] : []),
      `${t.date}: ${de(input.today)}`,
      ...(caseNumber ? [`${t.ref}: ${caseNumber.value}`] : []),
      '',
      t.subject,
      '',
      t.hello,
      '',
      ...t.paragraphs.flatMap((p) => [p, '']),
      t.thanks,
      '',
      t.bye,
      name,
    ].join('\n');
  };

  return {
    germanText: frame('de'),
    russianText: frame('ru'),
    claimIds: used
      .filter((c): c is ConfirmedClaim => !!c)
      .map((c) => c.id),
  };
}
