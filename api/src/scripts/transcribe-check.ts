/**
 * pnpm llm:check:photo — live-проверка transcribe.v1 настоящей моделью на синтетических фото.
 * 08_photo.jpg должен читаться (сравнение с эталонным текстом), 11_bad_photo.jpg — нет.
 * Демо-режим по хэшу настоящую транскрипцию не проверяет, поэтому нужен этот прогон.
 * Ключ модели не выводится. Только синтетические письма из fixtures/letters.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from '../app.module.js';
import { ApiError } from '../common/api-error.js';
import { loadEnvFiles } from '../config/load-env-files.js';
import { LlmService } from '../llm/llm.service.js';
import {
  TranscribeSchema,
  checkTranscribe,
} from '../llm/schemas/transcribe.schema.js';

const apiDir = resolve(import.meta.dirname, '..', '..');
loadEnvFiles(apiDir);
const fixtures = resolve(apiDir, '..', 'fixtures', 'letters');

const app = await NestFactory.createApplicationContext(AppModule.forRoot(), {
  logger: ['error', 'warn'],
});
const llm = app.get(LlmService);
const { provider, model } = llm.mode;
console.log(`Модель: ${provider} / ${model}`);
if (provider === 'demo')
  console.log('Внимание: LLM_MODE=demo, это не live-проверка.');

/** Доля строк эталона (без пробелов, без регистра), найденных в распознанном тексте. */
function lineRecall(expected: string, got: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  const text = norm(got);
  const lines = expected
    .split('\n')
    .map(norm)
    .filter((l) => l.length > 3);
  return (
    lines.filter((l) => text.includes(l)).length / Math.max(lines.length, 1)
  );
}

let failed = false;
for (const [id, expectReadable] of [
  ['08_photo', true],
  ['11_bad_photo', false],
] as const) {
  const meta = JSON.parse(
    readFileSync(resolve(fixtures, `${id}.json`), 'utf8'),
  ) as {
    file: string;
    text: string;
  };
  const data = readFileSync(resolve(fixtures, meta.file));
  const started = Date.now();
  try {
    const r = await llm.callWithTrace({
      prompt: 'transcribe',
      version: 1,
      variables: {},
      images: [{ mime: 'image/jpeg', data }],
      schema: TranscribeSchema,
      check: checkTranscribe,
      context: { cabinetId: null },
    });
    const recall = lineRecall(meta.text, r.data.text);
    const ok =
      r.data.readable === expectReadable && (!expectReadable || recall >= 0.8);
    failed ||= !ok;
    console.log(
      `${ok ? 'OK ' : 'НЕТ'} ${id}: readable=${r.data.readable} (ожидалось ${expectReadable}), ` +
        `reason=${r.data.reason}, строк эталона найдено ${Math.round(recall * 100)} %, ` +
        `попыток ${r.attempts}, ${Date.now() - started} мс`,
    );
  } catch (e) {
    failed = true;
    console.log(
      `НЕТ ${id}: ${e instanceof ApiError ? e.code : (e as Error).name}`,
    );
  }
}
await app.close();
process.exit(failed ? 1 : 0);
