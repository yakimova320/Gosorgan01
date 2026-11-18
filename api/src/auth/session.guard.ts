import {
  createParamDecorator,
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiError } from '../common/api-error.js';
import { AuthService, type AuthContext } from './auth.service.js';

const IS_PUBLIC = 'jasno:isPublic';

const ALLOW_DELETING = 'jasno:allowWhileDeleting';

/** Эндпоинт без входа: /health, /auth/register, /auth/login. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Эндпоинт доступен, пока аккаунт удаляется (только повтор DELETE /cabinet). */
export const AllowWhileDeleting = () => SetMetadata(ALLOW_DELETING, true);

type AuthedRequest = Request & { auth?: AuthContext };

/**
 * Глобальная проверка сессии: всё, кроме @Public(), требует
 * Authorization: Bearer <токен>. Иначе 401 UNAUTHORIZED.
 * Пока аккаунт удаляется: 409 ACCOUNT_DELETING на всё, кроме @AllowWhileDeleting().
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match) throw new ApiError('UNAUTHORIZED');

    const auth = await this.auth.authenticate(match[1]);
    if (!auth) throw new ApiError('UNAUTHORIZED');
    if (
      auth.deleting &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_DELETING, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      throw new ApiError('ACCOUNT_DELETING');
    req.auth = auth;
    return true;
  }
}

/** Текущий кабинет и сессия: @CurrentAuth() auth: AuthContext */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!req.auth) throw new ApiError('UNAUTHORIZED');
    return req.auth;
  },
);
