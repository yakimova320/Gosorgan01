import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LoginLimiter } from './login-limiter.js';
import { SessionGuard } from './session.guard.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    LoginLimiter,
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
  exports: [AuthService, LoginLimiter],
})
export class AuthModule {}
