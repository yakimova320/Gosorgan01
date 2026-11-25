import type { Language } from '../common/language.js';

/*
 * Общий текст срока для файла .ics (B12), ленты календаря и письма-напоминания (K12).
 * Только вид срока и ведомство: текста письма и личных номеров здесь нет. L07: на языке кабинета.
 */

const KIND: Record<Language, Record<string, string>> = {
  ru: { REPLY: 'ответить', DOCUMENTS: 'прислать документы', OBJECTION: 'возражение', FOLLOW_UP: 'напоминание' },
  uk: { REPLY: 'відповісти', DOCUMENTS: 'надіслати документи', OBJECTION: 'заперечення', FOLLOW_UP: 'нагадування' },
  de: { REPLY: 'antworten', DOCUMENTS: 'Unterlagen schicken', OBJECTION: 'Widerspruch', FOLLOW_UP: 'Erinnerung' },
};
const WORD: Record<Language, { deadline: string; fallback: string; case: string; note: string; calendar: string }> = {
  ru: {
    deadline: 'Срок',
    fallback: 'срок',
    case: 'Дело',
    note: 'Срок из письма, подтверждённый в Ja!sno. Проверьте дату по оригиналу письма.',
    calendar: 'Ja!sno — сроки',
  },
  uk: {
    deadline: 'Строк',
    fallback: 'строк',
    case: 'Справа',
    note: 'Строк із листа, підтверджений у Ja!sno. Перевірте дату за оригіналом листа.',
    calendar: 'Ja!sno — строки',
  },
  de: {
    deadline: 'Frist',
    fallback: 'Frist',
    case: 'Vorgang',
    note: 'Frist aus dem Brief, in Ja!sno bestätigt. Prüfen Sie das Datum im Original.',
    calendar: 'Ja!sno – Fristen',
  },
};

export function deadlineWhat(kind: string, lang: Language = 'ru'): string {
  return KIND[lang][kind] ?? WORD[lang].fallback;
}

/** «Срок: ответить — Jobcenter» */
export function deadlineSummary(kind: string, authority?: string | null, lang: Language = 'ru'): string {
  return `${WORD[lang].deadline}: ${deadlineWhat(kind, lang)}${authority ? ` — ${authority}` : ''}`;
}

/** «Дело: …» */
export function caseLine(title: string, lang: Language = 'ru'): string {
  return `${WORD[lang].case}: ${title}`;
}

export function deadlineCheckNote(lang: Language = 'ru'): string {
  return WORD[lang].note;
}

export function calendarName(lang: Language = 'ru'): string {
  return WORD[lang].calendar;
}

export const DEADLINE_CHECK_NOTE = WORD.ru.note;

/** Ссылка на дело, а для письма во входящих — на письмо. */
export function deadlineLink(
  appUrl: string,
  d: { caseId: string | null; letterId: string },
): string {
  const base = appUrl.replace(/\/+$/, '');
  return d.caseId ? `${base}/app/cases/${d.caseId}` : `${base}/app/letters/${d.letterId}`;
}
