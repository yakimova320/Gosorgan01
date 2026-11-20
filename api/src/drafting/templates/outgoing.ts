import {
  formatIban,
  outgoingTemplate,
  type OutgoingTemplateId,
} from '@jasno/shared';
import type { ConfirmedClaim } from '../../claims/claims.service.js';
import type { BuiltDraft, SenderProfile } from './clarification.js';
import { EXTENSION_REASONS, type ExtensionReason } from './replies.js';

/*
 * B16: собственные письма по шаблонам (ТЗ v3 6.6). Без модели.
 * Источник данных: подтверждённые факты дела (basis USER), созданные из формы после экрана проверки,
 * и профиль. Та же рамка письма, что у ответов: отправитель, адресат, дата, номер, тема, обращение, подпись.
 * Немецкий текст и русский перевод — парные формулировки. То, что человек написал по-немецки сам,
 * в русский вариант не переводится: оно приводится как обозначенная цитата.
 * В фиксированных фразах нет чисел и дат.
 */

/** Ключ факта в шаблоне: поле формы или адресат. */
export type OutgoingKey = 'recipient.name' | 'recipient.address' | string;

export interface OutgoingBuildInput {
  templateId: OutgoingTemplateId;
  /** факт для каждого заполненного поля, по ключу поля */
  claims: Record<OutgoingKey, ConfirmedClaim>;
  profile: SenderProfile;
  /** дата создания, YYYY-MM-DD (Europe/Berlin) */
  today: string;
}

const de = (iso: string) => iso.split('-').reverse().join('.');

/** Немецкие фразы вариантов выбора: придаточное после «dass» / «weil». */
const CHANGE_DE: Record<string, { de: string; ru: string }> = {
  ADDRESS: {
    de: 'sich meine Anschrift geändert hat',
    ru: 'у меня изменился адрес',
  },
  JOB_START: {
    de: 'ich eine Beschäftigung aufgenommen habe',
    ru: 'я начал(а) работать',
  },
  JOB_END: {
    de: 'meine Beschäftigung beendet ist',
    ru: 'моя работа закончилась',
  },
  INCOME: {
    de: 'sich mein Einkommen geändert hat',
    ru: 'изменился мой доход',
  },
  HOUSEHOLD: {
    de: 'sich die Zusammensetzung meines Haushalts geändert hat',
    ru: 'изменился состав моей семьи',
  },
};

const COMPLAINT_DE: Record<string, { de: string; ru: string }> = {
  NO_REPLY: {
    de: 'ich auf mein Schreiben bzw. meinen Antrag bisher keine Antwort erhalten habe',
    ru: 'я до сих пор не получил(а) ответа на моё письмо или заявление',
  },
  LONG_PROCESSING: {
    de: 'die Bearbeitung meines Anliegens ungewöhnlich lange dauert',
    ru: 'рассмотрение моего вопроса идёт необычно долго',
  },
  CONDUCT: {
    de: 'ich mit der Behandlung durch Ihre Mitarbeitenden nicht einverstanden bin',
    ru: 'я не согласен(на) с тем, как со мной обошлись ваши сотрудники',
  },
};

export function buildOutgoing(input: OutgoingBuildInput): BuiltDraft {
  const template = outgoingTemplate(input.templateId);
  if (!template) throw new Error(`unknown template ${input.templateId}`);
  const c = (key: OutgoingKey) => input.claims[key];
  const v = (key: OutgoingKey) => c(key)?.value;
  const name = `${input.profile.firstName} ${input.profile.lastName}`;
  const senderNumbers = (input.profile.numbers ?? []).map(
    (n) => `${n.label}: ${n.value}`,
  );
  const recipient = c('recipient.name');
  const recipientAddress = c('recipient.address');
  const reference = c('reference');
  /** то, что человек написал по-немецки: в переводе как цитата */
  const ruQuote = (s: string) => `«${s}» (по-немецки, как вы написали)`;

  let subject: { de: string; ru: string };
  let body: { de: string[]; ru: string[] };

  switch (input.templateId) {
    case 'KUENDIGUNG': {
      const what = v('subject')!;
      const end = v('endDate');
      subject = { de: `Kündigung: ${what}`, ru: `расторжение: ${ruQuote(what)}` };
      body = {
        de: [
          `hiermit kündige ich den folgenden Vertrag: ${what}.`,
          end
            ? `Die Kündigung soll zum ${de(end)} wirksam werden, hilfsweise zum nächstmöglichen Zeitpunkt.`
            : 'Die Kündigung soll zum nächstmöglichen Zeitpunkt wirksam werden.',
          'Bitte bestätigen Sie mir die Kündigung und das Datum, zu dem sie wirksam wird, schriftlich.',
        ],
        ru: [
          `Настоящим я расторгаю следующий договор: ${ruQuote(what)}.`,
          end
            ? `Расторжение должно вступить в силу с ${de(end)}, а если это невозможно — в ближайший возможный срок.`
            : 'Расторжение должно вступить в силу в ближайший возможный срок.',
          'Пожалуйста, письменно подтвердите расторжение и дату, с которой оно вступает в силу.',
        ],
      };
      break;
    }
    case 'AENDERUNG': {
      const change = CHANGE_DE[v('change')!];
      const date = v('date')!;
      const details = v('details');
      subject = { de: 'Änderungsmitteilung', ru: 'сообщение об изменениях' };
      body = {
        de: [
          `hiermit teile ich Ihnen mit, dass ${change.de}. Die Änderung gilt ab dem ${de(date)}.`,
          ...(v('change') === 'ADDRESS'
            ? [`Meine neue Anschrift lautet: ${input.profile.address}`]
            : []),
          ...(details ? [`Weitere Angaben: ${details}`] : []),
          'Bitte berücksichtigen Sie diese Änderung. Falls Sie dazu Unterlagen benötigen, teilen Sie mir das bitte mit.',
        ],
        ru: [
          `Сообщаю вам, что ${change.ru}. Изменение действует с ${de(date)}.`,
          ...(v('change') === 'ADDRESS'
            ? [`Мой новый адрес: ${input.profile.address}`]
            : []),
          ...(details ? [`Подробности: ${ruQuote(details)}`] : []),
          'Пожалуйста, учтите это изменение. Если вам нужны документы, пожалуйста, сообщите.',
        ],
      };
      break;
    }
    case 'NEUES_KONTO': {
      const iban = formatIban(v('iban')!);
      const holder = v('holder') ?? name;
      const from = v('validFrom');
      subject = { de: 'Neue Bankverbindung', ru: 'новый банковский счёт' };
      body = {
        de: [
          'hiermit teile ich Ihnen meine neue Bankverbindung mit:',
          `Kontoinhaber: ${holder}\nIBAN: ${iban}`,
          from
            ? `Bitte überweisen Sie künftige Zahlungen ab dem ${de(from)} auf dieses Konto.`
            : 'Bitte überweisen Sie künftige Zahlungen auf dieses Konto.',
        ],
        ru: [
          'Сообщаю вам мой новый банковский счёт:',
          `Владелец счёта: ${holder}\nIBAN: ${iban}`,
          from
            ? `Пожалуйста, с ${de(from)} перечисляйте платежи на этот счёт.`
            : 'Пожалуйста, перечисляйте дальнейшие платежи на этот счёт.',
        ],
      };
      break;
    }
    case 'BESCHWERDE': {
      const reason = COMPLAINT_DE[v('reason')!];
      const since = v('since');
      const details = v('details');
      subject = { de: 'Beschwerde', ru: 'жалоба' };
      body = {
        de: [
          `hiermit beschwere ich mich, weil ${reason.de}.`,
          ...(since ? [`Es geht um mein Anliegen vom ${de(since)}.`] : []),
          ...(details ? [`Weitere Angaben: ${details}`] : []),
          'Ich bitte Sie, die Angelegenheit zu prüfen und mir schriftlich zu antworten.',
        ],
        ru: [
          `Настоящим я подаю жалобу, потому что ${reason.ru}.`,
          ...(since ? [`Речь идёт о моём обращении от ${de(since)}.`] : []),
          ...(details ? [`Подробности: ${ruQuote(details)}`] : []),
          'Прошу проверить этот вопрос и ответить мне письменно.',
        ],
      };
      break;
    }
    case 'SACHSTANDSANFRAGE': {
      const what = v('subject')!;
      const submitted = v('submitted')!;
      subject = { de: `Sachstandsanfrage: ${what}`, ru: `запрос о ходе рассмотрения: ${ruQuote(what)}` };
      body = {
        de: [
          `am ${de(submitted)} habe ich bei Ihnen Folgendes eingereicht: ${what}. Bisher habe ich keine Nachricht von Ihnen erhalten.`,
          'Bitte teilen Sie mir den aktuellen Stand der Bearbeitung mit.',
          'Falls Sie noch Unterlagen oder Angaben von mir benötigen, teilen Sie mir das bitte mit.',
        ],
        ru: [
          `${de(submitted)} я подал(а) вам: ${ruQuote(what)}. Пока я не получил(а) от вас ответа.`,
          'Пожалуйста, сообщите, на каком этапе рассмотрение.',
          'Если вам нужны от меня ещё документы или сведения, пожалуйста, сообщите.',
        ],
      };
      break;
    }
    case 'FRISTVERLAENGERUNG': {
      const letterDate = v('letterDate');
      const deadline = v('deadline')!;
      const newDate = v('newDate');
      const reason = EXTENSION_REASONS[(v('reason') ?? 'NONE') as ExtensionReason];
      subject = {
        de: letterDate
          ? `Bitte um Fristverlängerung zu Ihrem Schreiben vom ${de(letterDate)}`
          : 'Bitte um Fristverlängerung',
        ru: letterDate
          ? `просьба продлить срок по вашему письму от ${de(letterDate)}`
          : 'просьба продлить срок',
      };
      body = {
        de: [
          `${letterDate ? `in Ihrem Schreiben vom ${de(letterDate)}` : 'in Ihrem Schreiben'} haben Sie mir eine Frist bis zum ${de(deadline)} gesetzt.`,
          [
            reason.de,
            newDate
              ? `Ich bitte Sie, die Frist bis zum ${de(newDate)} zu verlängern.`
              : 'Ich bitte Sie, die Frist angemessen zu verlängern.',
          ]
            .filter(Boolean)
            .join(' '),
          'Bitte bestätigen Sie mir die neue Frist.',
        ],
        ru: [
          `${letterDate ? `В письме от ${de(letterDate)}` : 'В письме'} вы установили мне срок до ${de(deadline)}.`,
          [
            reason.ruText,
            newDate
              ? `Прошу продлить срок до ${de(newDate)}.`
              : 'Прошу продлить срок на разумное время.',
          ]
            .filter(Boolean)
            .join(' '),
          'Пожалуйста, подтвердите новый срок.',
        ],
      };
      break;
    }
  }

  // «hiermit …», «am …», «in …» после обращения с запятой — со строчной буквы (немецкая норма)
  const frame = (lang: 'de' | 'ru') => {
    const t =
      lang === 'de'
        ? {
            date: 'Datum',
            ref: 'Ihr Zeichen',
            subject: `Betreff: ${subject.de}`,
            hello: 'Sehr geehrte Damen und Herren,',
            bye: 'Mit freundlichen Grüßen',
            paragraphs: body.de,
          }
        : {
            date: 'Дата',
            ref: 'Ваш номер дела',
            subject: `Тема: ${subject.ru}`,
            hello: 'Уважаемые дамы и господа,',
            bye: 'С уважением,',
            paragraphs: body.ru,
          };
    return [
      name,
      input.profile.address,
      ...senderNumbers,
      '',
      ...(recipient ? [recipient.value] : []),
      ...(recipientAddress ? recipientAddress.value.split('\n') : []),
      '',
      `${t.date}: ${de(input.today)}`,
      ...(reference ? [`${t.ref}: ${reference.value}`] : []),
      '',
      t.subject,
      '',
      t.hello,
      '',
      ...t.paragraphs.flatMap((p) => [p, '']),
      t.bye,
      name,
    ].join('\n');
  };

  return {
    germanText: frame('de'),
    russianText: frame('ru'),
    claimIds: Object.values(input.claims).map((claim) => claim.id),
  };
}
