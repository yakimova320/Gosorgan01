/**
 * pnpm llm:check:extract — live-проверка extract.v2 и проверок кодом на синтетических письмах 01, 04, 06, 14.
 * Печатает таблицу «эталон / получено» для PR. 14_prompt_injection: команды из письма не должны выполняться.
 * Ключ модели не выводится. Только синтетические письма из fixtures/letters.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from '../app.module.js';
import { ApiError } from '../common/api-error.js';
import { loadEnvFiles } from '../config/load-env-files.js';
import { joinPages } from '../documents/documents.service.js';
import { readPdfText } from '../documents/pdf-text.js';
import { buildClaims } from '../letters/claims.builder.js';
import { LlmService } from '../llm/llm.service.js';
import { ExtractV2Schema } from '../llm/schemas/extract.schema.js';

const apiDir = resolve(import.meta.dirname, '..', '..');
loadEnvFiles(apiDir);
const fixtures = resolve(apiDir, '..', 'fixtures', 'letters');

const app = await NestFactory.createApplicationContext(AppModule.forRoot(), {
  logger: ['error', 'warn'],
});
const llm = app.get(LlmService);
console.log(`Модель: ${llm.mode.provider} / ${llm.mode.model}\n`);
console.log('| Письмо | Поле | Эталон | Получено | |');
console.log('|---|---|---|---|---|');

let failed = false;
for (const id of process.argv[2]
  ? [process.argv[2]]
  : [
      '01_jobcenter_request',
      '04_buergeramt',
      '06_multiple_deadlines',
      '14_prompt_injection',
    ]) {
  const exp = (
    JSON.parse(readFileSync(resolve(fixtures, `${id}.json`), 'utf8')) as {
      expected: {
        authority: string;
        caseNumber: string;
        letterDate: string;
        deadlines: string[];
        requirements: string[];
      };
    }
  ).expected;
  const pages = await readPdfText(readFileSync(resolve(fixtures, `${id}.pdf`)));
  const { text } = joinPages(pages);
  try {
    const r = await llm.callWithTrace({
      prompt: 'extract',
      version: 2,
      variables: { letterText: text },
      schema: ExtractV2Schema,
      context: { cabinetId: null },
    });
    const { claims, dropped } = buildClaims(r.data, pages, false);
    const one = (k: string) => claims.find((c) => c.kind === k)?.value ?? '—';
    const many = (k: string) =>
      claims
        .filter((c) => c.kind === k)
        .map((c) => c.value)
        .sort()
        .join(', ') || '—';
    const rows: [string, string, string][] = [
      ['ведомство', exp.authority, one('AUTHORITY')],
      ['номер дела', exp.caseNumber, one('CASE_NUMBER')],
      ['дата письма', exp.letterDate, one('LETTER_DATE')],
      ['сроки', [...exp.deadlines].sort().join(', ') || '—', many('DEADLINE')],
      [
        'требований',
        String(exp.requirements.length),
        String(claims.filter((c) => c.kind === 'REQUIREMENT').length),
      ],
    ];
    for (const [field, want, got] of rows) {
      const ok = want === got;
      failed ||= !ok && field !== 'требований';
      console.log(
        `| ${id} | ${field} | ${want} | ${got} | ${ok ? '✓' : '✗'} |`,
      );
    }
    console.log(
      `| ${id} | отброшено проверкой / попыток | | ${dropped.length} / ${r.attempts} | |`,
    );
  } catch (e) {
    failed = true;
    console.log(
      `| ${id} | ошибка | | ${e instanceof ApiError ? e.code : (e as Error).name} | ✗ |`,
    );
  }
}
await app.close();
process.exit(failed ? 1 : 0);
