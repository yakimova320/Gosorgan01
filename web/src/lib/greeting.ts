/** Приветствие по времени в Берлине: кабинет и боковое меню (поправка 5, 23.11). */
export function greeting(): string {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: 'numeric', hour12: false }).format(new Date()));
  if (h < 11) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}
