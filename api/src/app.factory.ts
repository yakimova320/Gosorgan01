import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { ApiErrorFilter } from './common/error.filter.js';
import { APP_CONFIG } from './config/config.module.js';
import type { Env } from './config/env.schema.js';
import { serveWeb } from './web/web-static.js';
import { keyContextMiddleware } from './crypto/key-context.js';

/**
 * Собирает приложение одинаково для запуска (main.ts) и для e2e-тестов.
 * logger: false в тестах, чтобы вывод был чистым.
 */
export async function createApp(options?: {
  env?: NodeJS.ProcessEnv;
  logger?: boolean;
}): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(options?.env), {
    logger: options?.logger === false ? false : ['log', 'warn', 'error'],
  });
  const config = app.get<Env>(APP_CONFIG);
  // IP клиента за доверенным прокси (лимит «Забыли пароль?» по IP). Без настройки заголовок не учитывается.
  if (config.TRUST_PROXY !== undefined) app.set('trust proxy', config.TRUST_PROXY);

  app.enableCors({ origin: config.CORS_ORIGIN, credentials: false });
  // E01: ключи документов из заголовков — только в памяти запроса (AsyncLocalStorage)
  app.use(keyContextMiddleware);
  app.useGlobalFilters(new ApiErrorFilter());
  app.enableShutdownHooks();
  // B13: в Docker API отдаёт и собранный сайт
  if (config.WEB_DIST_DIR) serveWeb(app, config.WEB_DIST_DIR);

  const doc = new DocumentBuilder()
    .setTitle('Ja!sno API')
    .setDescription(
      'Помощник для писем немецких ведомств. Ошибки всегда в виде { code, message, details? }, message по-русски.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc));

  return app;
}
