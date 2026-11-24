/*
 * K12: лента календаря (RFC 5545) со всеми действующими сроками кабинета.
 * Календарь телефона (Google, Apple, Outlook) подписывается на адрес и сам его обновляет.
 * UID у события постоянный (id срока): после обновления событие меняется, а не дублируется.
 */
import { foldLine, icsText } from '../deadlines/ics.js';

export interface FeedEvent {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  summary: string;
  description: string;
  /** ссылка на дело или письмо в Ja!sno */
  url: string;
  remindDaysBefore: number;
}

const compact = (iso: string) => iso.replace(/-/g, '');

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function buildFeed(events: FeedEvent[], now: Date): string {
  const dtstamp = stamp(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ja!sno//Fristen//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText('Ja!sno — сроки')}`,
    'X-WR-TIMEZONE:Europe/Berlin',
    // подсказка клиентам, как часто обновлять (Google решает сам)
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@jasno`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${compact(e.date)}`,
      `DTEND;VALUE=DATE:${compact(nextDay(e.date))}`,
      `SUMMARY:${icsText(e.summary)}`,
      `DESCRIPTION:${icsText(`${e.description}\n${e.url}`)}`,
      `URL:${e.url}`,
      'TRANSP:TRANSPARENT',
    );
    if (e.remindDaysBefore > 0)
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${icsText(e.summary)}`,
        `TRIGGER:-P${e.remindDaysBefore}D`,
        'END:VALARM',
      );
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
