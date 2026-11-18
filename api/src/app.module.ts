import { Module, type DynamicModule } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_CONFIG, AppConfigModule } from './config/config.module.js';
import type { Env } from './config/env.schema.js';
import { HealthController } from './health/health.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CabinetModule } from './cabinet/cabinet.module.js';
import { DraftingModule } from './drafting/drafting.module.js';
import { CasesModule } from './cases/cases.module.js';
import { LettersModule } from './letters/letters.module.js';
import { LlmModule } from './llm/llm.module.js';

@Module({})
export class AppModule {
  /** overrides: значения окружения для тестов */
  static forRoot(overrides?: NodeJS.ProcessEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(overrides),
        // B18: лимиты по IP. Значение задаёт каждый маршрут (@IpLimit), здесь только запасное.
        ThrottlerModule.forRootAsync({
          inject: [APP_CONFIG],
          useFactory: (config: Env) => ({
            throttlers: [{ name: 'default', ttl: 60 * 60 * 1000, limit: 100 }],
            // RATE_LIMIT_IP=false только в тестах; в production проверка конфигурации запрещает
            skipIf: () => !config.RATE_LIMIT_IP,
          }),
        }),
        PrismaModule,
        AuthModule,
        CabinetModule,
        LlmModule,
        LettersModule,
        CasesModule,
        DraftingModule,
      ],
      controllers: [HealthController],
    };
  }
}
