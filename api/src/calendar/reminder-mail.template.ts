import type { Language } from '../common/language.js';
import type { MailMessage } from '../mail/mail-transport.js';

/** Форма множественного числа для ru и uk: 1 | 2–4 | 5+ */
function slavic(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  return mod10 === 1 && mod100 !== 11 ? one : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
}

/** 3 → «через 3 дня», 0 → «сегодня» (L07: на языке кабинета) */
export function daysLeftText(n: number, lang: Language = 'ru'): string {
  if (lang === 'uk') {
    if (n <= 0) return 'сьогодні';
    if (n === 1) return 'завтра';
    return `через ${n} ${slavic(n, 'день', 'дні', 'днів')}`;
  }
  if (lang === 'de') {
    if (n <= 0) return 'heute';
    if (n === 1) return 'morgen';
    return `in ${n} Tagen`;
  }
  if (n <= 0) return 'сегодня';
  if (n === 1) return 'завтра';
  return `через ${n} ${slavic(n, 'день', 'дня', 'дней')}`;
}

/** 2026-12-01 → 01.12.2026 */
export function germanDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export interface ReminderMailInput {
  to: string;
  appUrl: string;
  /** YYYY-MM-DD */
  date: string;
  daysLeft: number;
  summary: string;
  caseTitle: string | null;
  link: string;
  lang?: Language;
}

const TEXT: Record<Language, {
  subject: (when: string, date: string) => string;
  hello: string;
  remind: (when: string, date: string) => string;
  case: string;
  open: string;
  check: string;
  off: string;
  legal: string;
}> = {
  ru: {
    subject: (w, d) => `Ja!sno: срок ${w} (${d})`,
    hello: 'Здравствуйте!',
    remind: (w, d) => `Напоминаем о сроке ${w}, ${d}.`,
    case: 'Дело',
    open: 'Открыть в Ja!sno',
    check: 'Проверьте дату по оригиналу письма. Если вы уже ответили, отметьте срок выполненным в деле.',
    off: 'Напоминания можно выключить в кабинете',
    legal: 'Ja!sno не даёт юридических консультаций.',
  },
  uk: {
    subject: (w, d) => `Ja!sno: строк ${w} (${d})`,
    hello: 'Вітаємо!',
    remind: (w, d) => `Нагадуємо про строк ${w}, ${d}.`,
    case: 'Справа',
    open: 'Відкрити в Ja!sno',
    check: 'Перевірте дату за оригіналом листа. Якщо ви вже відповіли, позначте строк виконаним у справі.',
    off: 'Нагадування можна вимкнути в кабінеті',
    legal: 'Ja!sno не надає юридичних консультацій.',
  },
  de: {
    subject: (w, d) => `Ja!sno: Frist ${w} (${d})`,
    hello: 'Hallo!',
    remind: (w, d) => `Wir erinnern an eine Frist: ${w}, am ${d}.`,
    case: 'Vorgang',
    open: 'In Ja!sno öffnen',
    check: 'Prüfen Sie das Datum im Original-Brief. Haben Sie schon geantwortet? Dann markieren Sie die Frist im Vorgang als erledigt.',
    off: 'Erinnerungen können Sie im Konto ausschalten',
    legal: 'Ja!sno ist keine Rechtsberatung.',
  },
};

/*
 * K12: письмо-напоминание о сроке. Без текста письма ведомства и без личных номеров:
 * вид срока, ведомство, название дела, дата и ссылка. L07: на языке кабинета.
 */
export function reminderMail(i: ReminderMailInput): MailMessage {
  const lang = i.lang ?? 'ru';
  const T = TEXT[lang];
  const when = daysLeftText(i.daysLeft, lang);
  const date = germanDate(i.date);
  const base = i.appUrl.replace(/\/+$/, '');
  return {
    to: i.to,
    subject: T.subject(when, date),
    text: [
      T.hello,
      '',
      T.remind(when, date),
      i.summary,
      ...(i.caseTitle ? [`${T.case}: ${i.caseTitle}`] : []),
      '',
      `${T.open}: ${i.link}`,
      '',
      T.check,
      '',
      `${T.off}: ${base}/app#calendar`,
      '',
      T.legal,
    ].join('\n'),
  };
}
