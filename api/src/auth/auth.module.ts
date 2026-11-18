import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MailModule } from '../mail/mail.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LoginLimiter } from './login-limiter.js';
import { PasswordResetService } from './password-reset.service.js';
import { SessionGuard } from './session.guard.js';

@Module({
  // Лимиты по IP: ThrottlerModule в AppModule (B18), значения в common/ip-limits.ts.
  imports: [MailModule],
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
