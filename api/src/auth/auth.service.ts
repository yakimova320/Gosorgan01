import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { ApiError } from '../common/api-error.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { Env } from '../config/env.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { lockActiveCabinet } from '../erasure/cabinet-lock.js';
import type {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
} from './auth.schemas.js';
import { LoginLimiter } from './login-limiter.js';
import {
  assertPasswordFits,
  getDummyHash,
  hashPassword,
  verifyPassword,
} from './password.js';
import { hashToken, maskEmail, newToken } from './session-token.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** lastSeenAt обновляем не чаще раза в минуту, чтобы не писать в базу на каждый запрос. */
const SEEN_UPDATE_MS = 60 * 1000;

export interface AuthContext {
  cabinetId: string;
  sessionId: string;
  /** A01: идёт удаление аккаунта, записи запрещены */
  deleting?: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(LoginLimiter) private readonly limiter: LoginLimiter,
    @Inject(APP_CONFIG) private readonly config: Env,
  ) {}

  async register(input: RegisterInput): Promise<{ sessionToken: string }> {
    if (input.consent !== true) throw new ApiError('CONSENT_REQUIRED');
    assertPasswordFits(input.password);

    const passwordHash = await hashPassword(input.password);
    let cabinetId: string;
    try {
      const cabinet = await this.db.cabinet.create({
        data: {
          email: input.email,
          passwordHash,
          consentAt: new Date(),
          // Регистрационные данные: только имя, фамилия и адрес. Писем, дел и демо-данных нет.
          profile: {
            firstName: input.firstName,
            lastName: input.lastName,
            address: input.address,
          },
        },
      });
      cabinetId = cabinet.id;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ApiError('EMAIL_TAKEN');
      }
      throw e;
    }
    this.logger.log(`Новый кабинет: ${maskEmail(input.email)}`);
    return { sessionToken: await this.createSession(cabinetId) };
  }

  async login(input: LoginInput): Promise<{ sessionToken: string }> {
    if (this.limiter.isBlocked(input.email)) throw new ApiError('RATE_LIMITED');

    const cabinet = await this.db.cabinet.findUnique({
      where: { email: input.email },
    });
    // Неизвестный e-mail: та же работа bcrypt и та же ошибка, что при неверном пароле.
    const ok = await verifyPassword(
      input.password,
      cabinet?.passwordHash ?? (await getDummyHash()),
    );
    if (!cabinet || !ok) {
      this.limiter.recordFailure(input.email);
      throw new ApiError('INVALID_CREDENTIALS');
    }
    this.limiter.reset(input.email);
    // Сессия создаётся под блокировкой строки кабинета и только если пароль не сменили,
    // пока шла проверка, и аккаунт не удаляется (A02).
    const now = new Date();
    return this.db.$transaction(async (tx) => {
      const { count } = await tx.cabinet.updateMany({
        where: {
          id: cabinet.id,
          deletingAt: null,
          passwordHash: cabinet.passwordHash,
        },
        data: { lastSeenAt: now },
      });
      if (count !== 1) {
        const current = await tx.cabinet.findUnique({
          where: { id: cabinet.id },
          select: { deletingAt: true },
        });
        if (current?.deletingAt) throw new ApiError('ACCOUNT_DELETING');
        throw new ApiError('INVALID_CREDENTIALS');
      }
      return { sessionToken: await this.createSession(cabinet.id, tx, now) };
    });
  }

  /**
   * A02: смена пароля. Текущая сессия остаётся, остальные сессии и ссылки восстановления
   * аннулируются в той же транзакции. Пароли и тела запросов не логируются.
   */
  async changePassword(
    auth: AuthContext,
    input: ChangePasswordInput,
  ): Promise<void> {
    const key = `change-password:${auth.cabinetId}`;
    if (this.limiter.isBlocked(key)) throw new ApiError('RATE_LIMITED');
    const cabinet = await this.db.cabinet.findUnique({
      where: { id: auth.cabinetId },
      select: { passwordHash: true },
    });
    if (!cabinet) throw new ApiError('UNAUTHORIZED');
    if (!(await verifyPassword(input.oldPassword, cabinet.passwordHash))) {
      this.limiter.recordFailure(key);
      throw wrongOldPassword();
    }
    this.limiter.reset(key);
    const newHash = await hashPassword(input.newPassword);

    await this.db.$transaction(async (tx) => {
      // Блокировка строки: две смены, смена и восстановление, смена и удаление идут по очереди.
      if (!(await lockActiveCabinet(tx, auth.cabinetId))) {
        const exists = await tx.cabinet.count({ where: { id: auth.cabinetId } });
        throw new ApiError(exists ? 'ACCOUNT_DELETING' : 'UNAUTHORIZED');
      }
      // Под блокировкой перечитываем: состояние могло измениться после проверки пароля.
      const locked = await tx.cabinet.findUniqueOrThrow({
        where: { id: auth.cabinetId },
        select: { passwordHash: true, passwordChangedAt: true },
      });
      const now = new Date();
      const session = await tx.session.findUnique({
        where: { id: auth.sessionId },
        select: { cabinetId: true, expiresAt: true, passwordAt: true },
      });
      if (
        !session ||
        session.cabinetId !== auth.cabinetId ||
        session.expiresAt <= now ||
        (locked.passwordChangedAt && session.passwordAt < locked.passwordChangedAt)
      )
        throw new ApiError('UNAUTHORIZED');
      // Пароль уже сменили другим запросом: старый пароль больше не верный.
      if (locked.passwordHash !== cabinet.passwordHash) throw wrongOldPassword();

      await tx.cabinet.update({
        where: { id: auth.cabinetId },
        data: { passwordHash: newHash, passwordChangedAt: now },
      });
      // Тот же момент, что passwordChangedAt: текущая сессия остаётся действительной.
      await tx.session.update({
        where: { id: auth.sessionId },
        data: { passwordAt: now },
      });
      await tx.session.deleteMany({
        where: { cabinetId: auth.cabinetId, id: { not: auth.sessionId } },
      });
      // Ссылки восстановления, выданные до смены, больше не действуют (и для A03).
      await tx.passwordResetToken.deleteMany({
        where: { cabinetId: auth.cabinetId },
      });
    });
  }

  async logout(auth: AuthContext): Promise<void> {
    await this.db.session.deleteMany({ where: { id: auth.sessionId } });
  }

  /**
   * Проверяет токен из заголовка Authorization. null: нет сессии, истекла
   * или подтверждена паролем раньше последней смены пароля.
   */
  async authenticate(token: string): Promise<AuthContext | null> {
    const session = await this.db.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        cabinet: { select: { passwordChangedAt: true, deletingAt: true } },
      },
    });
    if (!session) return null;

    const now = new Date();
    if (session.expiresAt <= now) {
      await this.db.session.deleteMany({ where: { id: session.id } });
      return null;
    }
    const changedAt = session.cabinet.passwordChangedAt;
    if (changedAt && session.passwordAt < changedAt) return null;
    if (session.cabinet.deletingAt)
      return {
        cabinetId: session.cabinetId,
        sessionId: session.id,
        deleting: true,
      };

    if (now.getTime() - session.lastSeenAt.getTime() > SEEN_UPDATE_MS) {
      await this.db.$transaction([
        this.db.session.update({
          where: { id: session.id },
          data: { lastSeenAt: now },
        }),
        this.db.cabinet.update({
          where: { id: session.cabinetId },
          data: { lastSeenAt: now },
        }),
      ]);
    }
    return { cabinetId: session.cabinetId, sessionId: session.id };
  }

  private async createSession(
    cabinetId: string,
    db: Prisma.TransactionClient = this.db,
    now = new Date(),
  ): Promise<string> {
    const token = newToken();
    await db.session.create({
      data: {
        cabinetId,
        tokenHash: hashToken(token),
        createdAt: now,
        passwordAt: now,
        expiresAt: new Date(now.getTime() + this.config.SESSION_TTL_DAYS * DAY_MS),
      },
    });
    return token;
  }
}

/** Неверный текущий пароль при смене: ошибка поля, сессия не завершается. */
function wrongOldPassword(): ApiError {
  return new ApiError(
    'INVALID_CREDENTIALS',
    { fields: { oldPassword: 'Неверный пароль' } },
    'Неверный пароль',
  );
}
