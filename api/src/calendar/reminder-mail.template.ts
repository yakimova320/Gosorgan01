import type { MailMessage } from '../mail/mail-transport.js';

/** 3 → «через 3 дня», 0 → «сегодня» */
export function daysLeftText(n: number): string {
  if (n <= 0) return 'сегодня';
  if (n === 1) return 'завтра';
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? 'день'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? 'дня'
        : 'дней';
  return `через ${n} ${word}`;
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
}

/*
 * K12: письмо-напоминание о сроке. Без текста письма ведомства и без личных номеров:
 * вид срока, ведомство, название дела, дата и ссылка.
 */
export function reminderMail(i: ReminderMailInput): MailMessage {
  const when = daysLeftText(i.daysLeft);
  const date = germanDate(i.date);
  const base = i.appUrl.replace(/\/+$/, '');
  return {
    to: i.to,
    subject: `Ja!sno: срок ${when} (${date})`,
    text: [
      'Здравствуйте!',
      '',
      `Напоминаем о сроке ${when}, ${date}.`,
      i.summary,
      ...(i.caseTitle ? [`Дело: ${i.caseTitle}`] : []),
      '',
      `Открыть в Ja!sno: ${i.link}`,
      '',
      'Проверьте дату по оригиналу письма. Если вы уже ответили, отметьте срок выполненным в деле.',
      '',
      `Напоминания можно выключить в профиле: ${base}/app/profile`,
      '',
      'Ja!sno не даёт юридических консультаций.',
    ].join('\n'),
  };
}
