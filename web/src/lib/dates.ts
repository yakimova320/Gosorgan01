import { locale, t, tn } from '../i18n';
/*
 * Даты сроков: календарные дни без часового пояса. «Сегодня» считается по Europe/Berlin (ТЗ v3 раздел 6.4).
 */

const MONTHS = [t('янв'), t('фев'), t('мар'), t('апр'), t('мая'), t('июн'), t('июл'), t('авг'), t('сен'), t('окт'), t('нояб'), t('дек')];

/** Сегодняшняя дата в Германии в виде ГГГГ-ММ-ДД. */
export function todayBerlin(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function toUtcDay(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Сколько дней от сегодня до даты. Отрицательное число: срок прошёл. */
export function daysUntil(iso: string, today: string = todayBerlin()): number {
  return Math.round((toUtcDay(iso) - toUtcDay(today)) / 86_400_000);
}

/** 2026-11-30 → 30.11.2026 */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

/** 2026-11-30 → { day: '30', month: 'нояб' } для значка календаря */
export function dayMonth(iso: string): { day: string; month: string } {
  const [, m, d] = iso.slice(0, 10).split('-');
  return { day: String(Number(d)), month: MONTHS[Number(m) - 1] };
}


/** «Ещё 14 дней», «Сегодня последний день», «Срок прошёл 2 дня назад» */
export function deadlineText(iso: string, today?: string): string {
  const n = daysUntil(iso, today);
  if (n > 1) return tn('Ещё {n} день|Ещё {n} дня|Ещё {n} дней', n);
  if (n === 1) return t('Завтра последний день');
  if (n === 0) return t('Сегодня последний день');
  const p = -n;
  return tn('Срок прошёл {n} день назад|Срок прошёл {n} дня назад|Срок прошёл {n} дней назад', p);
}

/** Время события для истории: 14.11.2026, 11:00 по Берлину */
export function formatDateTime(isoDateTime: string): string {
  return new Intl.DateTimeFormat(locale(), {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoDateTime));
}
