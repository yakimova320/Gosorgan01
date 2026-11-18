import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { ApiError } from '../common/api-error.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { Env } from '../config/env.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { LoginInput, RegisterInput } from './auth.schemas.js';
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
    await this.db.cabinet.update({
      where: { id: cabinet.id },
      data: { lastSeenAt: new Date() },
    });
    return { sessionToken: await this.createSession(cabinet.id) };
  }

  async logout(auth: AuthContext): Promise<void> {
    await this.db.session.deleteMany({ where: { id: auth.sessionId } });
  }

  /**
   * Проверяет токен из заголовка Authorization. null: нет сессии, истекла
   * или создана до смены пароля.
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
    if (changedAt && session.createdAt < changedAt) return null;
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

  private async createSession(cabinetId: string): Promise<string> {
    const token = newToken();
    await this.db.session.create({
      data: {
        cabinetId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + this.config.SESSION_TTL_DAYS * DAY_MS),
      },
    });
    return token;
  }
}
