import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hashToken, newToken } from '../auth/session-token.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { Env } from '../config/env.schema.js';
import { StorageService } from '../documents/storage.service.js';
import { lockActiveCabinet } from '../erasure/cabinet-lock.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MailTransport, mailErrorCode, type MailMessage } from './mail-transport.js';
import { resetMail } from './reset-mail.template.js';

/** Аренда задания: пока она действует, второй обработчик его не берёт. */
const LEASE_MS = 2 * 60 * 1000;
/** Фоновый проход: ожидающие и повторные задания, в том числе после перезапуска. */
const TICK_MS = 60 * 1000;
export const MAX_ATTEMPTS = 3;
/** Пауза перед второй и третьей попыткой. */
const BACKOFF_MS = [60 * 1000, 5 * 60 * 1000];
/** Строки без секрета хранятся сутки: по ним считается лимит писем в час. */
const KEEP_MS = 24 * 60 * 60 * 1000;
const BATCH = 20;

type Prepared =
  | { kind: 'done' }
  | { kind: 'skip' }
  | { kind: 'smtp'; message: MailMessage };

/*
 * A03: задания отправки писем восстановления (таблица PasswordResetMail).
 * Секрета в базе нет: токен создаётся при отправке, в задании только его id.
 * file: токен и файл .eml создаются в одной транзакции под блокировкой кабинета (как загрузка письма, A01),
 *       поэтому после начала удаления аккаунта новых файлов не появляется.
 * smtp: токен создаётся под блокировкой, отправка идёт после транзакции, без блокировки.
 * Сбой: до MAX_ATTEMPTS попыток с паузой, потом FAILED; в lastError только код ошибки.
 */
@Injectable()
export class ResetMailOutbox
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger('ResetMail');
  private timer?: NodeJS.Timeout;
  /** Текущий проход. Ждём его при остановке сервера, задания при этом остаются в базе. */
  private running: Promise<void> = Promise.resolve();
  /** Часы можно подменить в тестах. */
  now: () => Date = () => new Date();

  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(MailTransport) private readonly transport: MailTransport,
    @Inject(APP_CONFIG) private readonly config: Env,
  ) {}

  onApplicationBootstrap(): void {
    this.kick();
    this.timer = setInterval(() => this.kick(), TICK_MS);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  /**
   * Резерв отправки внутри транзакции вызывающего, после блокировки кабинета.
   * false: за последний час уже limit писем. Проверка и резерв атомарны: параллельные запросы ждут блокировку.
   */
  async reserve(
    tx: Prisma.TransactionClient,
    cabinetId: string,
    limit: number,
  ): Promise<boolean> {
    const since = new Date(this.now().getTime() - 60 * 60 * 1000);
    const sent = await tx.passwordResetMail.count({
      where: { cabinetId, createdAt: { gt: since } },
    });
    if (sent >= limit) return false;
    await tx.passwordResetMail.create({
      data: { cabinetId, createdAt: this.now(), nextAttemptAt: this.now() },
    });
    return true;
  }

  /**
   * После сброса или смены пароля (в той же транзакции): ожидающие задания отменяются.
   * Возвращает id всех заданий кабинета: их файлы удаляются после транзакции.
   */
  async revoke(
    tx: Prisma.TransactionClient,
    cabinetId: string,
  ): Promise<string[]> {
    await tx.passwordResetMail.updateMany({
      where: { cabinetId, status: 'PENDING' },
      data: { status: 'CANCELLED', leaseUntil: null, leaseOwner: null },
    });
    const rows = await tx.passwordResetMail.findMany({
      where: { cabinetId },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Удаляет файлы писем этих заданий. Ошибка в лог без пути: ссылки в них уже не действуют. */
  async removeFiles(cabinetId: string, ids: string[]): Promise<void> {
    if (this.transport.mode !== 'file') return;
    for (const id of ids) {
      await this.storage
        .removeMailFile(`${this.storage.mailDir(cabinetId)}/${id}.eml`)
        .catch((e: unknown) =>
          this.logger.error(`не удалось удалить файл письма: ${mailErrorCode(e)}`),
        );
    }
  }

  /** Запустить проход сейчас. Обещание не теряется: следующий проход и остановка его ждут. */
  kick(): void {
    this.running = this.running.then(() =>
      this.runDue().catch((e: unknown) =>
        this.logger.error(`проход заданий не удался: ${mailErrorCode(e)}`),
      ),
    );
  }

  /** Дождаться текущих проходов (тесты). */
  idle(): Promise<void> {
    return this.running;
  }

  async runDue(): Promise<void> {
    const now = this.now();
    const due = await this.db.passwordResetMail.findMany({
      where: {
        status: 'PENDING',
        nextAttemptAt: { lte: now },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
      select: { id: true },
    });
    for (const { id } of due) await this.process(id);
    await this.db.passwordResetMail.deleteMany({
      where: {
        status: { not: 'PENDING' },
        createdAt: { lt: new Date(now.getTime() - KEEP_MS) },
      },
    });
  }

  /** Одна попытка отправки. 'BUSY': задание у другого обработчика или ещё не пора. */
  async process(id: string): Promise<'SENT' | 'RETRY' | 'FAILED' | 'SKIPPED' | 'BUSY'> {
    const lease = randomBytes(12).toString('hex');
    const now = this.now();
    const { count } = await this.db.passwordResetMail.updateMany({
      where: {
        id,
        status: 'PENDING',
        nextAttemptAt: { lte: now },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      data: {
        leaseOwner: lease,
        leaseUntil: new Date(now.getTime() + LEASE_MS),
      },
    });
    if (count !== 1) return 'BUSY';

    const written: string[] = [];
    try {
      const prepared = await this.db.$transaction(
        async (tx): Promise<Prepared> => {
          const job = await tx.passwordResetMail.findUnique({ where: { id } });
          if (!job) return { kind: 'skip' };
          if (!(await lockActiveCabinet(tx, job.cabinetId))) {
            // аккаунт удаляется: задание отменяется, письма не будет
            await tx.passwordResetMail.updateMany({
              where: { id, leaseOwner: lease },
              data: { status: 'CANCELLED', leaseUntil: null, leaseOwner: null },
            });
            return { kind: 'skip' };
          }
          // под блокировкой перечитываем: задание могли отменить сброс или смена пароля
          const fresh = await tx.passwordResetMail.findUnique({ where: { id } });
          if (!fresh || fresh.status !== 'PENDING' || fresh.leaseOwner !== lease)
            return { kind: 'skip' };
          const cabinet = await tx.cabinet.findUniqueOrThrow({
            where: { id: job.cabinetId },
            select: { email: true },
          });
          if (fresh.tokenId)
            await tx.passwordResetToken.deleteMany({ where: { id: fresh.tokenId } });
          const raw = newToken();
          const token = await tx.passwordResetToken.create({
            data: {
              cabinetId: job.cabinetId,
              tokenHash: hashToken(raw),
              expiresAt: new Date(
                this.now().getTime() + this.config.RESET_TOKEN_TTL_MIN * 60_000,
              ),
            },
          });
          const message = resetMail({
            to: cabinet.email,
            appUrl: this.config.APP_PUBLIC_URL,
            token: raw,
            ttlMin: this.config.RESET_TOKEN_TTL_MIN,
          });
          if (this.transport.mode === 'file') {
            written.push(
              await this.storage.writeMail(
                job.cabinetId,
                id,
                await this.transport.compose(message),
              ),
            );
            await tx.passwordResetMail.update({
              where: { id },
              data: {
                status: 'SENT',
                tokenId: token.id,
                attempts: { increment: 1 },
                lastError: null,
                leaseUntil: null,
                leaseOwner: null,
              },
            });
            return { kind: 'done' };
          }
          await tx.passwordResetMail.update({
            where: { id },
            data: { tokenId: token.id },
          });
          return { kind: 'smtp', message };
        },
      );
      if (prepared.kind === 'skip') return 'SKIPPED';
      if (prepared.kind === 'done') return 'SENT';

      await this.transport.sendSmtp(prepared.message);
      await this.db.passwordResetMail.updateMany({
        where: { id, leaseOwner: lease, status: 'PENDING' },
        data: {
          status: 'SENT',
          attempts: { increment: 1 },
          lastError: null,
          leaseUntil: null,
          leaseOwner: null,
        },
      });
      return 'SENT';
    } catch (e) {
      // транзакция откатилась, но файл мог успеть записаться
      for (const path of written)
        await this.storage.removeMailFile(path).catch(() => undefined);
      return this.failed(id, lease, mailErrorCode(e));
    }
  }

  private async failed(
    id: string,
    lease: string,
    code: string,
  ): Promise<'RETRY' | 'FAILED' | 'SKIPPED'> {
    const job = await this.db.passwordResetMail.findUnique({ where: { id } });
    if (!job || job.leaseOwner !== lease || job.status !== 'PENDING')
      return 'SKIPPED';
    const attempts = job.attempts + 1;
    const last = attempts >= MAX_ATTEMPTS;
    this.logger.error(
      `письмо восстановления: попытка ${attempts} не удалась (${code})${last ? ', больше не повторяем' : ''}`,
    );
    await this.db.$transaction(async (tx) => {
      const { count } = await tx.passwordResetMail.updateMany({
        where: { id, leaseOwner: lease, status: 'PENDING' },
        data: {
          attempts,
          lastError: code,
          status: last ? 'FAILED' : 'PENDING',
          nextAttemptAt: new Date(
            this.now().getTime() + (BACKOFF_MS[attempts - 1] ?? 0),
          ),
          leaseUntil: null,
          leaseOwner: null,
        },
      });
      // ссылка из неотправленного письма никому не нужна
      if (count === 1 && last && job.tokenId)
        await tx.passwordResetToken.deleteMany({ where: { id: job.tokenId } });
    });
    return last ? 'FAILED' : 'RETRY';
  }
}
