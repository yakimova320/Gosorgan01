import { Module, type DynamicModule } from '@nestjs/common';
import { AppConfigModule } from './config/config.module.js';
import { HealthController } from './health/health.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CabinetModule } from './cabinet/cabinet.module.js';
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
        PrismaModule,
        AuthModule,
        CabinetModule,
        LlmModule,
        LettersModule,
      ],
      controllers: [HealthController],
    };
  }
}
