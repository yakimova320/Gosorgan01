/**
 * pnpm --dir api eval — оценка на 15 синтетических письмах 01–15 (B14). Модель из api/.env (LLM_MODE).
 * --set new — письма 16–30 (#173), --set all — все 30. По умолчанию base (01–15): так результат
 * сравним с fixtures/eval-baseline.demo.json и укладывается в предел 50 обращений.
 * Пишет reports/eval-latest.json и reports/eval-latest.md в корне проекта.
 * Своя временная схема PostgreSQL и хранилище, удаляются и при ошибке. Ключ модели не выводится.
 * Параметры: --max-calls N (предел обращений к модели, по умолчанию 50), --only 01_jobcenter_request,04_buergeramt,
 * --render-only: пересобрать eval-latest.md из сохранённого eval-latest.json без обращений к модели.
 */
import 'reflect-metadata';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFiles } from '../config/load-env-files.js';
import { summarize, toMarkdown } from '../eval/eval.report.js';
import { DEFAULT_MAX_CALLS, LETTER_SETS, runEval, type EvalResult, type LetterSet } from '../eval/eval.runner.js';

const apiDir = resolve(import.meta.dirname, '..', '..');
loadEnvFiles(apiDir);
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const outDir = resolve(apiDir, '..', 'reports');
if (process.argv.includes('--render-only')) {
  const saved = JSON.parse(readFileSync(resolve(outDir, 'eval-latest.json'), 'utf8')) as EvalResult & { summary?: unknown };
  const { summary: _old, ...report } = saved;
  const summary = summarize(report);
  writeFileSync(resolve(outDir, 'eval-latest.json'), JSON.stringify({ ...report, summary }, null, 2) + '\n');
  writeFileSync(resolve(outDir, 'eval-latest.md'), toMarkdown(report, summary));
  for (const r of summary.rules) console.log(`${r.id.padEnd(3)} ${r.verdict.padEnd(11)} ${r.title}: ${r.value}`);
  console.log('\nОтчёт пересобран без обращений к модели: reports/eval-latest.md');
  process.exit(0);
}
const maxCalls = Number(arg('--max-calls') ?? DEFAULT_MAX_CALLS);
if (!Number.isInteger(maxCalls) || maxCalls < 1) throw new Error('--max-calls: целое число больше 0');
const set = (arg('--set') ?? 'base') as LetterSet;
if (!(set in LETTER_SETS)) throw new Error('--set: base, new или all');
const only = arg('--only')?.split(',').map((s) => s.trim()).filter(Boolean);

const result = await runEval({
  baseDatabaseUrl: process.env.DATABASE_URL ?? 'postgresql://jasno:jasno@localhost:5432/jasno',
  fixturesDir: resolve(apiDir, '..', 'fixtures', 'letters'),
  maxCalls,
  only,
  set,
  log: (line) => console.log(line),
});
const { schema: _schema, ...report } = result;
const summary = summarize(report);
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'eval-latest.json'), JSON.stringify({ ...report, summary }, null, 2) + '\n');
writeFileSync(resolve(outDir, 'eval-latest.md'), toMarkdown(report, summary));
console.log(`\nМодель: ${report.provider} / ${report.model}; обращений ${report.callsUsed} из ${report.maxCalls}${report.partial ? ' — ЧАСТИЧНЫЙ ОТЧЁТ' : ''}`);
for (const r of summary.rules) console.log(`${r.id.padEnd(3)} ${r.verdict.padEnd(11)} ${r.title}: ${r.value}`);
console.log(`\nОтчёт: reports/eval-latest.md, reports/eval-latest.json`);
