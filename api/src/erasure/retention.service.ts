import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { Env } from '../config/env.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  AccountErasureService,
  type ErasureOutcome,
} from './account-erasure.service.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Раз в сутки; первый прогон через минуту после запуска, чтобы не мешать старту. */
export const RETENTION_INTERVAL_MS = DAY_MS;
const FIRST_RUN_MS = 60 * 1000;
/** За один прогон не больше стольких кабинетов: остальные — в следующий раз. */
export const RETENTION_BATCH = 50;

export interface RetentionResult {
  cabinets: { id: string; outcome: ErasureOutcome }[];
  sessions: number;
  resetTokens: number;
}

/**
 * Автоудаление (B12, ТЗ v4 раздел 14, решение 16.5): раз в сутки удаляются кабинеты без активности
 * дольше CABINET_TTL_DAYS (по lastSeenAt), просроченные сессии и токены восстановления.
 * Кабинет удаляется тем же заданием, что и «Удалить аккаунт» (A01): все строки, файлы, LlmCall.
 * Демо-кабинет (B19) не трогается: его пересоздаёт pnpm db:seed.
 * В логи не пишутся e-mail и идентификаторы — только числа.
 */
@Injectable()
export class RetentionService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger('Retention');
  private timers: NodeJS.Timeout[] = [];
  private running = false;
  /** Часы можно подменить в тестах. */
  now: () => Date = () => new Date();

  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(AccountErasureService)
    private readonly erasure: AccountErasureService,
    @Inject(APP_CONFIG)
    private readonly config: Pick<Env, 'CABINET_TTL_DAYS' | 'NODE_ENV'>,
  ) {}

  onApplicationBootstrap(): void {
    // В тестах прогон вызывается явно (runOnce), без таймеров.
    if (this.config.NODE_ENV === 'test') return;
    const first = setTimeout(() => void this.runOnce(), FIRST_RUN_MS);
    const daily = setInterval(() => void this.runOnce(), RETENTION_INTERVAL_MS);
    first.unref();
    daily.unref();
    this.timers = [first, daily];
  }

  onApplicationShutdown(): void {
    this.timers.forEach((t) => clearTimeout(t));
  }

  async runOnce(): Promise<RetentionResult> {
    const result: RetentionResult = { cabinets: [], sessions: 0, resetTokens: 0 };
    if (this.running) return result; // прогоны не накладываются
    this.running = true;
    try {
      const now = this.now();
      const cutoff = new Date(now.getTime() - this.config.CABINET_TTL_DAYS * DAY_MS);
      const stale = await this.db.cabinet.findMany({
        where: { lastSeenAt: { lt: cutoff }, demo: false, deletingAt: null },
        select: { id: true },
        orderBy: { lastSeenAt: 'asc' },
        take: RETENTION_BATCH,
      });
      for (const { id } of stale) {
        try {
          result.cabinets.push({ id, outcome: await this.erasure.erase(id) });
        } catch (e) {
          // задание удаления остаётся и повторяется фоном (A01)
          this.logger.error(`автоудаление кабинета не завершено: ${(e as Error).name}`);
        }
      }
      result.sessions = (
        await this.db.session.deleteMany({ where: { expiresAt: { lt: now } } })
      ).count;
      result.resetTokens = (
        await this.db.passwordResetToken.deleteMany({
          where: { expiresAt: { lt: now } },
        })
      ).count;
      this.logger.log(
        `автоудаление: кабинетов ${result.cabinets.length}, сессий ${result.sessions}, токенов ${result.resetTokens}`,
      );
    } catch (e) {
      this.logger.error(`автоудаление не удалось: ${(e as Error).name}`);
    } finally {
      this.running = false;
    }
    return result;
  }
}
