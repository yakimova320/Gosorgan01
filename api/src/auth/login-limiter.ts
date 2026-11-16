import { Injectable } from '@nestjs/common';

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** После 4 неудачных попыток пятая и дальше получают 429 (ТЗ v2 раздел 8, пункт 2). */
export const LOGIN_MAX_FAILURES = 4;

/**
 * Неудачные попытки входа по e-mail за последние 15 минут.
 * Хранится в памяти процесса: без Redis (ТЗ v4 раздел 5). После перезапуска сервера счётчик пустой.
 */
@Injectable()
export class LoginLimiter {
  private readonly failures = new Map<string, number[]>();
  /** Часы можно подменить в тестах. */
  now: () => number = () => Date.now();

  isBlocked(email: string): boolean {
    return this.recent(email).length >= LOGIN_MAX_FAILURES;
  }

  recordFailure(email: string): void {
    const list = this.recent(email);
    list.push(this.now());
    this.failures.set(email, list);
    if (this.failures.size > 10_000) this.prune();
  }

  reset(email: string): void {
    this.failures.delete(email);
  }

  private recent(email: string): number[] {
    const since = this.now() - LOGIN_WINDOW_MS;
    const list = (this.failures.get(email) ?? []).filter((t) => t > since);
    if (list.length === 0) this.failures.delete(email);
    return list;
  }

  private prune(): void {
    for (const email of [...this.failures.keys()]) this.recent(email);
  }
}
