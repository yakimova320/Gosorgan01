import { Throttle } from '@nestjs/throttler';

/*
 * B18: лимиты по IP (@nestjs/throttler, ТехБрифинг v5 раздел 7). Применяются только на маршрутах
 * с @UseGuards(ThrottlerGuard). IP клиента за прокси — только при TRUST_PROXY.
 * Счётчики в памяти процесса: после перезапуска API начинаются заново и не делятся между
 * несколькими экземплярами API (для нескольких экземпляров нужен общий storage, например Redis).
 */
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

export const IP_LIMITS = {
  /** вход: дополнительно к лимиту 4 неудачных попыток на e-mail */
  login: { limit: 20, ttl: 15 * MIN },
  register: { limit: 5, ttl: HOUR },
  /** «Забыли пароль?» (A03, без изменений) */
  forgot: { limit: 10, ttl: HOUR },
  uploadLetter: { limit: 30, ttl: HOUR },
  /** K12: лента календаря без входа; клиенты календаря обновляют её несколько раз в час */
  calendarFeed: { limit: 120, ttl: HOUR },
} as const;

/** Лимит маршрута по IP. Вместе с @UseGuards(ThrottlerGuard). */
export const IpLimit = (name: keyof typeof IP_LIMITS) =>
  Throttle({ default: IP_LIMITS[name] });
