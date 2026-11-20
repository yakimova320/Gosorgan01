/**
 * pnpm llm:check:explain — live-проверка explain (последняя версия) на синтетических письмах 01, 04, 06.
 * Факты: extract.v2 + проверки кодом, все факты считаются подтверждёнными (как после проверки человеком).
 * Печатает для каждого письма: попытки, прошли ли проверки дат, чисел и запретов, текст объяснения
 * и сроки в сравнении с эталоном. Смысл по оригиналу проверяет человек.
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
import {
  checkExplanation,
  factsForPrompt,
  finalizeExplanation,
  type ExplainFact,
} from '../letters/explain.logic.js';
import { LlmService } from '../llm/llm.service.js';
import { EXPLAIN_PROMPT_VERSION } from '../letters/explain.service.js';
import { ExplainV2Schema } from '../llm/schemas/explain.schema.js';
import { ExtractV2Schema } from '../llm/schemas/extract.schema.js';

const apiDir = resolve(import.meta.dirname, '..', '..');
loadEnvFiles(apiDir);
const fixtures = resolve(apiDir, '..', 'fixtures', 'letters');
const app = await NestFactory.createApplicationContext(AppModule.forRoot(), {
  logger: ['error', 'warn'],
});
const llm = app.get(LlmService);
console.log(`Модель: ${llm.mode.provider} / ${llm.mode.model}\n`);

let failed = false;
const ids = process.argv[2]
  ? [process.argv[2]]
  : ['01_jobcenter_request', '04_buergeramt', '06_multiple_deadlines'];
for (const id of ids) {
  const exp = (
    JSON.parse(readFileSync(resolve(fixtures, `${id}.json`), 'utf8')) as {
      expected: { deadlines: string[] };
    }
  ).expected;
  const pages = await readPdfText(readFileSync(resolve(fixtures, `${id}.pdf`)));
  const { text } = joinPages(pages);
  try {
    const extracted = await llm.call({
      prompt: 'extract',
      version: 2,
      variables: { letterText: text },
      schema: ExtractV2Schema,
      context: { cabinetId: null },
    });
    const facts: ExplainFact[] = buildClaims(
      extracted,
      pages,
      false,
    ).claims.map((c, i) => ({
      id: `c${i + 1}`,
      kind: c.kind,
      value: c.value,
      quote: c.quote,
      status: 'CONFIRMED',
      ...(c.deadlineKind ? { deadlineKind: c.deadlineKind } : {}),
    }));
    const r = await llm.callWithTrace({
      prompt: 'explain',
      version: EXPLAIN_PROMPT_VERSION,
      variables: { facts: factsForPrompt(facts), letterText: text },
      schema: ExplainV2Schema,
      check: (x) => checkExplanation(x, facts),
      context: { cabinetId: null },
    });
    const view = finalizeExplanation(r.data, facts);
    const dates = view.deadlines.map((d) => d.date).join(', ') || '—';
    const want = [...exp.deadlines].sort().join(', ') || '—';
    failed ||= dates !== want;
    console.log(`### ${id}`);
    console.log(
      `попыток: ${r.attempts}; проверки дат, чисел и запретов: пройдены; сроки: ${dates} (эталон ${want}) ${dates === want ? '✓' : '✗'}`,
    );
    console.log(`о письме: ${view.about.text}`);
    view.actions.forEach((a, i) => console.log(`  ${i + 1}. ${a.text}`));
    console.log('');
  } catch (e) {
    failed = true;
    console.log(
      `### ${id}\nОШИБКА: ${e instanceof ApiError ? e.code : (e as Error).name}\n`,
    );
  }
}
await app.close();
process.exit(failed ? 1 : 0);
