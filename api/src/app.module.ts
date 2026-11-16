import { Module, type DynamicModule } from '@nestjs/common';
import { AppConfigModule } from './config/config.module.js';
import { HealthController } from './health/health.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({})
export class AppModule {
  /** overrides: значения окружения для тестов */
  static forRoot(overrides?: NodeJS.ProcessEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [AppConfigModule.forRoot(overrides), PrismaModule],
      controllers: [HealthController],
    };
  }
}
