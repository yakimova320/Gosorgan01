import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { lockActiveCabinet } from '../erasure/cabinet-lock.js';
import { ResetMailOutbox } from '../mail/reset-mail.outbox.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertPasswordFits, hashPassword } from './password.js';
import { hashToken } from './session-token.js';

/** Не больше 3 писем в час на адрес (ТЗ v4 раздел 9). */
export const RESET_MAILS_PER_HOUR = 3;
/**
 * Нижняя граница времени ответа forgot. Известный адрес делает чуть больше работы (блокировка,
 * резерв задания), неизвестный почти никакой: без выравнивания по времени можно было бы узнать,
 * зарегистрирован ли адрес. Само письмо отправляется в фоне.
 */
export const FORGOT_MIN_MS = 400;

@Injectable()
export class PasswordResetService {
  /** Подменяется в тестах. */
  minResponseMs = FORGOT_MIN_MS;

  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ResetMailOutbox) private readonly outbox: ResetMailOutbox,
  ) {}

  /** Всегда один и тот же результат: есть ли адрес, наружу не видно. */
  async forgot(email: string): Promise<void> {
    const started = Date.now();
    const cabinet = await this.db.cabinet.findUnique({
      where: { email },
      select: { id: true },
    });
    let queued = false;
    if (cabinet) {
      queued = await this.db.$transaction(async (tx) => {
        // удаляемый аккаунт: письма нет
        if (!(await lockActiveCabinet(tx, cabinet.id))) return false;
        return this.outbox.reserve(tx, cabinet.id, RESET_MAILS_PER_HOUR);
      });
    }
    if (queued) this.outbox.kick();
    const rest = this.minResponseMs - (Date.now() - started);
    if (rest > 0) await new Promise((done) => setTimeout(done, rest));
  }

  /**
   * Проверка ссылки, новый пароль, завершение всех сессий, удаление всех ссылок и отмена писем —
   * одна транзакция. Ошибка до фиксации откатывает всё: ссылка остаётся действительной.
   */
  async reset(token: string, newPassword: string): Promise<void> {
    assertPasswordFits(newPassword);
    const newHash = await hashPassword(newPassword);
    const tokenHash = hashToken(token);

    const result = await this.db.$transaction(async (tx) => {
      const now = new Date();
      const row = await tx.passwordResetToken.findUnique({
        where: { tokenHash },
        select: { id: true, cabinetId: true, expiresAt: true },
      });
      if (!row || row.expiresAt <= now) throw new ApiError('RESET_TOKEN_INVALID');
      // блокировка кабинета: смена пароля, второй сброс, удаление аккаунта идут по очереди
      if (!(await lockActiveCabinet(tx, row.cabinetId)))
        throw new ApiError('RESET_TOKEN_INVALID');
      const { count } = await tx.passwordResetToken.deleteMany({
        where: { id: row.id, expiresAt: { gt: now } },
      });
      // ссылку уже использовал параллельный запрос
      if (count !== 1) throw new ApiError('RESET_TOKEN_INVALID');

      await tx.cabinet.update({
        where: { id: row.cabinetId },
        data: { passwordHash: newHash, passwordChangedAt: now },
      });
      await tx.session.deleteMany({ where: { cabinetId: row.cabinetId } });
      await tx.passwordResetToken.deleteMany({
        where: { cabinetId: row.cabinetId },
      });
      const mailIds = await this.outbox.revoke(tx, row.cabinetId);
      return { cabinetId: row.cabinetId, mailIds };
    });
    // старые письма со ссылками больше не нужны (ссылки в них уже не действуют)
    await this.outbox.removeFiles(result.cabinetId, result.mailIds);
  }
}
