import { Global, Module, type DynamicModule } from '@nestjs/common';
import { parseEnv, type Env } from './env.schema.js';

/** Токен для внедрения проверенной конфигурации: @Inject(APP_CONFIG) private readonly config: Env */
export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({})
export class AppConfigModule {
  /** Без аргумента читает process.env. В тестах можно передать готовые значения. */
  static forRoot(overrides?: NodeJS.ProcessEnv): DynamicModule {
    const env: Env = parseEnv({ ...process.env, ...overrides });
    return {
      module: AppConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: env }],
      exports: [APP_CONFIG],
    };
  }
}
