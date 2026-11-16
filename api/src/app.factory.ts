import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { ApiErrorFilter } from './common/error.filter.js';
import { APP_CONFIG } from './config/config.module.js';
import type { Env } from './config/env.schema.js';

/**
 * Собирает приложение одинаково для запуска (main.ts) и для e2e-тестов.
 * logger: false в тестах, чтобы вывод был чистым.
 */
export async function createApp(options?: {
  env?: NodeJS.ProcessEnv;
  logger?: boolean;
}): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(options?.env), {
    logger: options?.logger === false ? false : ['log', 'warn', 'error'],
  });
  const config = app.get<Env>(APP_CONFIG);

  app.enableCors({ origin: config.CORS_ORIGIN, credentials: false });
  app.useGlobalFilters(new ApiErrorFilter());
  app.enableShutdownHooks();

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
