import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { MailModule } from '../mail/mail.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LoginLimiter } from './login-limiter.js';
import { FORGOT_IP_LIMIT, FORGOT_IP_TTL_MS } from './forgot.throttle.js';
import { PasswordResetService } from './password-reset.service.js';
import { SessionGuard } from './session.guard.js';

@Module({
  imports: [
    MailModule,
    // A03: «Забыли пароль?» не больше 10 запросов в час с одного IP. Общие лимиты: B18.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'forgot', ttl: FORGOT_IP_TTL_MS, limit: FORGOT_IP_LIMIT }],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordResetService,
    LoginLimiter,
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
  exports: [AuthService, LoginLimiter],
})
export class AuthModule {}
