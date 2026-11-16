/**
 * pnpm llm:check — один вызов модели из LLM_MODE/LLM_MODEL на синтетическом письме 01.
 * Показывает, что модель отвечает JSON по схеме extract.v1, и пишет строку в LlmCall.
 * Ключ модели не выводится.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from '../app.module.js';
import { ApiError } from '../common/api-error.js';
import { loadEnvFiles } from '../config/load-env-files.js';
import { LlmService } from '../llm/llm.service.js';
import { ExtractSchema } from '../llm/schemas/extract.schema.js';

const apiDir = resolve(import.meta.dirname, '..', '..');
loadEnvFiles(apiDir);

const letterText = readFileSync(
  resolve(apiDir, '..', 'fixtures', 'letters', '01_jobcenter_request.txt'),
  'utf8',
);
const app = await NestFactory.createApplicationContext(AppModule.forRoot(), {
  logger: ['error', 'warn'],
});
const llm = app.get(LlmService);
const { provider, model } = llm.mode;
console.log(`Модель: ${provider} / ${model}`);

try {
  const started = Date.now();
  const result = await llm.callWithTrace({
    prompt: 'extract',
    variables: { letterText },
    schema: ExtractSchema,
    context: { cabinetId: null },
  });
  const d = result.data;
  console.log(
    `OK: JSON по схеме extract.v1, попыток ${result.attempts}, ${Date.now() - started} мс`,
  );
  console.log(`  ведомство: ${d.authority.value}`);
  console.log(`  Aktenzeichen: ${d.caseNumber.value}`);
  console.log(`  дата письма: ${d.letterDate.value}`);
  console.log(
    `  сроки: ${d.deadlines.map((x) => `${x.value} (${x.kind})`).join(', ') || 'нет'}`,
  );
  console.log(
    `Строка в LlmCall: ${result.llmCallId ?? 'не записана'} (pnpm db:studio → LlmCall)`,
  );
  await app.close();
} catch (e) {
  const code =
    e instanceof ApiError ? e.code : e instanceof Error ? e.name : 'ERROR';
  console.error(`ОШИБКА: ${code}. Подробности в таблице LlmCall (поле error).`);
  await app.close();
  process.exit(1);
}
