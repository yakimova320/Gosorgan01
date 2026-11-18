import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StorageService } from '../documents/storage.service.js';
import type {
  AccountErasure,
  ErasureStatus,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Сколько живёт аренда задания без продления (обработчик умер — другой подхватит). */
export const LEASE_MS = 2 * 60 * 1000;
/** Фоновый повтор незаконченных заданий. */
export const RECOVERY_MS = 5 * 60 * 1000;
/** Сколько HTTP-запрос ждёт задание, которое уже выполняет другой обработчик. */
const WAIT_MS = 10 * 1000;

/**
 * Итог одного прохода задания:
 * DONE — всё удалено, задания нет; PENDING — база удалена, окончательная очистка повторится;
 * RESTORED — удаление не удалось, данные и файлы на месте, блокировка снята;
 * RESTORE_FAILED — файлы вернуть не удалось, задание и блокировка остаются, повтор в фоне;
 * BUSY — задание выполняет другой обработчик.
 */
export type ErasureOutcome =
  'DONE' | 'PENDING' | 'RESTORED' | 'RESTORE_FAILED' | 'BUSY';

/**
 * Дополнительная очистка по cabinetId на последнем этапе (например, почтовые файлы A03).
 * Должна быть повторяемой: вызывается снова, пока не пройдёт без ошибки.
 */
export interface ErasureCleaner {
  name: string;
  clean(cabinetId: string): Promise<void>;
}

class LeaseLost extends Error {
  override name = 'LeaseLost';
}

/**
 * Полное удаление аккаунта (A01). Задание AccountErasure, одно на кабинет.
 *
 * A. Транзакция: блокировка строки кабинета, deletingAt, задание PREPARING.
 *    Все записи данных пользователя проверяют deletingAt под той же блокировкой (lockActiveCabinet).
 * B. Папка писем → корзина trash/<id задания>. Статус FILES_MOVED.
 * C. Транзакция: LlmCall кабинета и его писем и дел, кабинет (каскадом всё остальное), статус DB_DELETED.
 *    Ошибка на B или C: статус RESTORING, файлы возвращаются; только потом снимается блокировка
 *    и удаляется задание. Не удалось вернуть файлы: задание остаётся, повтор в фоне.
 * D. Корзина, повторная очистка LlmCall, дополнительные очистки. Успех: строка задания удаляется.
 *    Ошибка: задание остаётся DB_DELETED, повтор в фоне.
 *
 * Выполняет задание только держатель аренды (leaseOwner, leaseUntil): HTTP-запрос и фоновый
 * повтор не работают одновременно. Каждый переход статуса проверяет аренду.
 * Файловые шаги решают по фактическому месту файлов, поэтому сбой процесса между переносом
 * и записью статуса не мешает повтору.
 */
@Injectable()
export class AccountErasureService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger('AccountErasure');
  private readonly cleaners: ErasureCleaner[] = [];
  private timer?: NodeJS.Timeout;
  /** Часы можно подменить в тестах. */
  now: () => Date = () => new Date();

  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  registerCleaner(cleaner: ErasureCleaner): void {
    this.cleaners.push(cleaner);
  }

  onApplicationBootstrap(): void {
    void this.recoverAll();
    this.timer = setInterval(() => void this.recoverAll(), RECOVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  /** DELETE /cabinet: этап A и выполнение задания. Повторный запрос использует то же задание. */
  async erase(cabinetId: string): Promise<ErasureOutcome> {
    let job = await this.start(cabinetId);
    if (!job) return 'DONE';
    if (job.status === 'RESTORING') {
      // прошлое удаление не удалось: сначала вернуть файлы, потом начать заново
      const restored = await this.run(job.id);
      if (restored === 'BUSY') return this.waitFor(job);
      if (restored !== 'RESTORED') return restored;
      job = await this.start(cabinetId);
      if (!job) return 'DONE';
    }
    const outcome = await this.run(job.id);
    return outcome === 'BUSY' ? this.waitFor(job) : outcome;
  }

  /** Фоновый повтор: все задания со свободной арендой. */
  async recoverAll(): Promise<ErasureOutcome[]> {
    const outcomes: ErasureOutcome[] = [];
    try {
      const jobs = await this.db.accountErasure.findMany({
        where: this.leaseFree(),
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      for (const job of jobs) outcomes.push(await this.run(job.id));
    } catch (e) {
      this.logger.error(`повтор заданий не удался: ${errorName(e)}`);
    }
    return outcomes;
  }

  /** Этап A. null: кабинета уже нет. */
  private async start(cabinetId: string): Promise<AccountErasure | null> {
    return this.db.$transaction(async (tx) => {
      // UPDATE берёт блокировку строки: ждём транзакции загрузки и записи журнала
      const { count } = await tx.cabinet.updateMany({
        where: { id: cabinetId, deletingAt: null },
        data: { deletingAt: this.now() },
      });
      const existing = await tx.accountErasure.findUnique({
        where: { cabinetId },
      });
      if (existing) return existing;
      if (count === 0) {
        const cabinet = await tx.cabinet.findUnique({
          where: { id: cabinetId },
          select: { id: true },
        });
        if (!cabinet) return null;
      }
      return tx.accountErasure.create({ data: { cabinetId } });
    });
  }

  /** Один проход задания под арендой. */
  async run(jobId: string): Promise<ErasureOutcome> {
    const lease = randomUUID();
    const { count } = await this.db.accountErasure.updateMany({
      where: { id: jobId, ...this.leaseFree() },
      data: {
        leaseOwner: lease,
        leaseUntil: this.leaseEnd(),
        attempts: { increment: 1 },
      },
    });
    if (count === 0) return 'BUSY';
    try {
      return await this.process(jobId, lease);
    } catch (e) {
      if (e instanceof LeaseLost) return 'BUSY';
      throw e;
    } finally {
      await this.db.accountErasure
        .updateMany({
          where: { id: jobId, leaseOwner: lease },
          data: { leaseOwner: null, leaseUntil: null },
        })
        .catch((e) =>
          this.logger.error(`аренда не освобождена: ${errorName(e)}`),
        );
    }
  }

  private async process(jobId: string, lease: string): Promise<ErasureOutcome> {
    for (;;) {
      const job = await this.db.accountErasure.findUnique({
        where: { id: jobId },
      });
      if (!job) return 'DONE';
      switch (job.status) {
        case 'PREPARING':
          try {
            await this.storage.moveCabinetToTrash(job.cabinetId, job.id);
          } catch (e) {
            await this.setStatus(job.id, lease, 'RESTORING', 'files', e);
            continue;
          }
          await this.setStatus(job.id, lease, 'FILES_MOVED');
          continue;

        case 'FILES_MOVED':
          try {
            await this.deleteRows(job, lease);
          } catch (e) {
            if (e instanceof LeaseLost) throw e;
            await this.setStatus(job.id, lease, 'RESTORING', 'database', e);
          }
          continue;

        case 'DB_DELETED':
          try {
            await this.purge(job, lease);
            return 'DONE';
          } catch (e) {
            if (e instanceof LeaseLost) throw e;
            await this.setStatus(job.id, lease, 'DB_DELETED', 'cleanup', e);
            return 'PENDING';
          }

        case 'RESTORING':
          try {
            await this.restore(job, lease);
            this.logger.warn('удаление аккаунта отменено, данные возвращены');
            return 'RESTORED';
          } catch (e) {
            if (e instanceof LeaseLost) throw e;
            await this.setStatus(job.id, lease, 'RESTORING', 'restore', e);
            return 'RESTORE_FAILED';
          }
      }
    }
  }

  /** Этап C: одна транзакция, статус меняется вместе с удалением строк. */
  private async deleteRows(job: AccountErasure, lease: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const moved = await tx.accountErasure.updateMany({
        where: { id: job.id, leaseOwner: lease, status: 'FILES_MOVED' },
        data: {
          status: 'DB_DELETED',
          lastError: null,
          leaseUntil: this.leaseEnd(),
        },
      });
      if (moved.count !== 1) throw new LeaseLost();
      const cabinetId = job.cabinetId;
      const [letters, cases] = await Promise.all([
        tx.letter.findMany({ where: { cabinetId }, select: { id: true } }),
        tx.case.findMany({ where: { cabinetId }, select: { id: true } }),
      ]);
      await tx.llmCall.deleteMany({
        where: {
          OR: [
            { cabinetId },
            { letterId: { in: letters.map((l) => l.id) } },
            { caseId: { in: cases.map((c) => c.id) } },
          ],
        },
      });
      // каскад: сессии, токены восстановления, дела, письма, факты, сроки, события, черновики
      await tx.cabinet.deleteMany({ where: { id: cabinetId } });
    });
  }

  /** Этап D. Все шаги повторяемые. Успех: строка задания удаляется. */
  private async purge(job: AccountErasure, lease: string): Promise<void> {
    await this.storage.purgeErasure(job.cabinetId, job.id);
    await this.db.llmCall.deleteMany({ where: { cabinetId: job.cabinetId } });
    for (const cleaner of this.cleaners) {
      try {
        await cleaner.clean(job.cabinetId);
      } catch (e) {
        throw Object.assign(new Error(cleaner.name), {
          name: `${cleaner.name}/${errorName(e)}`,
        });
      }
    }
    const { count } = await this.db.accountErasure.deleteMany({
      where: { id: job.id, leaseOwner: lease, status: 'DB_DELETED' },
    });
    if (count !== 1) throw new LeaseLost();
  }

  /** Откат: файлы обратно, потом в одной транзакции снять блокировку и удалить задание. */
  private async restore(job: AccountErasure, lease: string): Promise<void> {
    await this.storage.restoreCabinetFromTrash(job.cabinetId, job.id);
    await this.db.$transaction(async (tx) => {
      const { count } = await tx.accountErasure.deleteMany({
        where: { id: job.id, leaseOwner: lease, status: 'RESTORING' },
      });
      if (count !== 1) throw new LeaseLost();
      await tx.cabinet.updateMany({
        where: { id: job.cabinetId },
        data: { deletingAt: null },
      });
    });
  }

  private async setStatus(
    jobId: string,
    lease: string,
    status: ErasureStatus,
    stage?: string,
    error?: unknown,
  ): Promise<void> {
    const lastError = stage ? `${stage}: ${errorName(error)}` : null;
    if (lastError) this.logger.error(`удаление аккаунта, этап ${lastError}`);
    const { count } = await this.db.accountErasure.updateMany({
      where: { id: jobId, leaseOwner: lease },
      data: { status, lastError, leaseUntil: this.leaseEnd() },
    });
    if (count !== 1) throw new LeaseLost();
  }

  /** Задание выполняет другой обработчик: ждём недолго, потом отвечаем «продолжается». */
  private async waitFor(job: AccountErasure): Promise<ErasureOutcome> {
    const until = Date.now() + WAIT_MS;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 200));
      const current = await this.db.accountErasure.findUnique({
        where: { id: job.id },
        select: { status: true },
      });
      if (!current) {
        const cabinet = await this.db.cabinet.findUnique({
          where: { id: job.cabinetId },
          select: { deletingAt: true },
        });
        return cabinet ? 'RESTORED' : 'DONE';
      }
    }
    return 'PENDING';
  }

  private leaseFree() {
    return {
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: this.now() } }],
    };
  }

  private leaseEnd(): Date {
    return new Date(this.now().getTime() + LEASE_MS);
  }
}

/** Для журнала и lastError: только тип ошибки, без путей и персональных данных. */
function errorName(e: unknown): string {
  if (e && typeof e === 'object') {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z0-9_]{2,20}$/.test(code)) return code;
    const name = (e as { name?: unknown }).name;
    if (typeof name === 'string') return name.slice(0, 60);
  }
  return 'Error';
}
