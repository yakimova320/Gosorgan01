/**
 * pnpm db:seed — демо-кабинет (B19). Пароль из DEMO_PASSWORD, e-mail из DEMO_EMAIL (по умолчанию demo@example.org).
 * Модель внутри seed всегда demo: без сети и расходов, api/.env не меняется. В production запрещён.
 * Пароль в вывод не попадает.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { resolve } from 'node:path';
import { AppModule } from '../app.module.js';
import { loadEnvFiles } from '../config/load-env-files.js';
import { SEED_ENV_OVERRIDES, SeedError, prepareSeed, seedDemo } from '../seed/demo-seed.js';

const apiDir = resolve(import.meta.dirname, '..', '..');
loadEnvFiles(apiDir);

let prepared;
try {
  // сначала проверки (окружение, пароль, файлы писем), потом любые изменения базы
  prepared = prepareSeed({
    nodeEnv: process.env.NODE_ENV,
    email: process.env.DEMO_EMAIL,
    password: process.env.DEMO_PASSWORD,
    fixturesDir: resolve(apiDir, '..', 'fixtures', 'letters'),
  });
} catch (e) {
  if (e instanceof SeedError) {
    console.error(`Seed не выполнен: ${e.message}`);
    process.exit(1);
  }
  throw e;
}

const app = await NestFactory.createApplicationContext(AppModule.forRoot(SEED_ENV_OVERRIDES), {
  logger: ['error', 'warn'],
});
try {
  const r = await seedDemo(app, prepared);
  console.log(
    `Демо-кабинет ${r.replaced ? 'пересоздан' : 'создан'}: ${r.email}, дел: ${r.cases}, просроченных сроков: ${r.overdueDeadlines}.`,
  );
  console.log('Вход: e-mail выше и пароль из DEMO_PASSWORD (api/.env). Сценарий показа: docs/demo-runbook.md');
} catch (e) {
  if (e instanceof SeedError) {
    console.error(`Seed не выполнен: ${e.message}`);
    process.exitCode = 1;
  } else throw e;
} finally {
  await app.close();
}
