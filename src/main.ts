import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { ApiErrorFilter } from './workflow/error.filter.js';
const app = await NestFactory.create(AppModule, { bodyParser: true });
app.useGlobalFilters(new ApiErrorFilter());
app.enableShutdownHooks();
const swagger = SwaggerModule.createDocument(
  app,
  new DocumentBuilder()
    .setTitle('Разберёмся API')
    .setDescription(
      'Single-user MVP: review document quotes before confirming facts. No mail sending.',
    )
    .setVersion('1.0')
    .build(),
);
SwaggerModule.setup('docs', app, swagger);
const config = app.get(ConfigService);
await app.listen(
  config.getOrThrow<number>('PORT'),
  config.getOrThrow<string>('HOST'),
);
