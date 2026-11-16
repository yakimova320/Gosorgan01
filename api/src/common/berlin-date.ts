/**
 * «Сегодня» по Europe/Berlin как календарная дата в полночь UTC.
 * Так же хранятся сроки (Deadline.date), поэтому их можно сравнивать напрямую.
 */
export function berlinToday(now: Date = new Date()): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Дата срока для ответа API: 2026-12-01 */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
