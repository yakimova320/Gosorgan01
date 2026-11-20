/*
 * B12: файл календаря для срока (RFC 5545). Событие на весь день + напоминание за N дней.
 * Без внешних библиотек: формат простой, экранирование и перенос строк по стандарту.
 */

export interface IcsDeadline {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  summary: string;
  description: string;
  remindDaysBefore: number;
  /** время создания файла (DTSTAMP) */
  now: Date;
}

/** Экранирование текста: \ ; , и переводы строк. */
export function icsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Перенос строки длиннее 75 байт UTF-8: продолжение начинается с пробела. Символы не разрезаются. */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf8');
    const limit = out.length === 0 ? 75 : 74; // у продолжения первый байт — пробел
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

const compact = (iso: string) => iso.replace(/-/g, '');

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function buildIcs(d: IcsDeadline): string {
  const stamp = d.now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ja!sno//Fristen//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${d.id}@jasno`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(d.date)}`,
    `DTEND;VALUE=DATE:${compact(nextDay(d.date))}`,
    `SUMMARY:${icsText(d.summary)}`,
    `DESCRIPTION:${icsText(d.description)}`,
    'TRANSP:TRANSPARENT',
    ...(d.remindDaysBefore > 0
      ? [
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          `DESCRIPTION:${icsText(d.summary)}`,
          `TRIGGER:-P${d.remindDaysBefore}D`,
          'END:VALARM',
        ]
      : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
