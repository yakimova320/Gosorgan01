import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import pg from 'pg';
import { schemaExists } from '../src/eval/eval-sandbox.js';
import { summarize, toMarkdown } from '../src/eval/eval.report.js';
import { runEval } from '../src/eval/eval.runner.js';

/*
 * B14: механизм оценки в demo-режиме (не качество модели): песочница удаляется, предел обращений
 * останавливает прогон с частичным отчётом, итог по правилам собирается.
 */
const BASE = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://jasno:jasno@localhost:5432/jasno';
const FIXTURES = resolve(import.meta.dirname, '..', '..', 'fixtures', 'letters');
const env = { LLM_MODE: 'demo', NODE_ENV: 'test' };

async function evalSchemas(): Promise<string[]> {
  const url = new URL(BASE);
  url.searchParams.delete('schema');
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  try {
    const { rows } = await c.query<{ s: string }>(
      "SELECT schema_name AS s FROM information_schema.schemata WHERE schema_name LIKE 'eval_%'",
    );
    return rows.map((r) => r.s);
  } finally {
    await c.end();
  }
}
const evalDirs = () => readdirSync(tmpdir()).filter((d) => d.startsWith('jasno-eval-'));

describe('Оценка (B14, demo)', () => {
  it('три письма и их варианты: правила, отказы отдельно, песочница удалена', async () => {
    const dirsBefore = evalDirs();
    const r = await runEval({
      baseDatabaseUrl: BASE,
      fixturesDir: FIXTURES,
      env,
      only: ['01_jobcenter_request', '11_bad_photo', '14_prompt_injection', '09_scan'],
    });
    expect(await schemaExists(BASE, r.schema)).toBe(false);
    expect(evalDirs()).toEqual(dirsBefore);
    expect(r.partial).toBe(false);
    expect(r.letters.map((l) => [l.id, l.file, l.status])).toEqual([
      ['01_jobcenter_request', '01_jobcenter_request.pdf', 'OK'],
      ['09_scan', '09_scan.png', 'OK'],
      ['11_bad_photo', '11_bad_photo.jpg', 'REFUSED'],
      ['14_prompt_injection', '14_prompt_injection.pdf', 'OK'],
    ]);
    expect(r.letters[0].q2Variant).toBe(true);
    const s = summarize(r);
    expect(s.extractionLetters).toBe(3); // ожидаемый отказ не в знаменателе
    expect(s.refusals.rows.map((x) => [x.file, x.code, x.clear])).toEqual([
      ['11_bad_photo.jpg', 'UNREADABLE', true],
      ['09_scan.pdf', 'SCAN_PDF_NOT_SUPPORTED', true],
    ]);
    expect(Object.fromEntries(s.rules.map((x) => [x.id, x.verdict]))).toMatchObject({
      Q1: 'принято',
      Q2: 'принято',
      Q3: 'принято',
      Q4: 'принято',
      Q5: 'принято',
      П5: 'принято',
    });
    expect(s.usage.unknownUsageCalls).toBeGreaterThan(0); // demo без usage: явно «неизвестно», не ноль
    const md = toMarkdown(r, s);
    expect(md).toContain('Demo-прогон проверяет механизм оценки');
    expect(md).toContain('цена не задана');
    expect(md).toContain('расход этих обращений неизвестен');
  });

  it('предел обращений: прогон останавливается, отчёт частичный, вердикты «не оценено», песочница удалена', async () => {
    const r = await runEval({
      baseDatabaseUrl: BASE,
      fixturesDir: FIXTURES,
      env,
      maxCalls: 3,
      only: ['01_jobcenter_request', '04_buergeramt', '06_multiple_deadlines'],
    });
    expect(r.partial).toBe(true);
    expect(r.callsUsed).toBe(3);
    expect(r.stoppedAt).toBe('04_buergeramt.pdf');
    expect(r.letters.map((l) => l.status)).toEqual(['OK', 'NOT_RUN', 'NOT_RUN']);
    expect(r.letters[1].error?.code).toBe('CALL_CAP');
    expect(r.letters[1].usage.calls).toBeGreaterThan(0); // расход остановленного письма сохранён
    expect(r.letters[2].usage.calls).toBe(0); // следующее не запускалось
    const s = summarize(r);
    expect(new Set(s.rules.map((x) => x.verdict))).toEqual(new Set(['не оценено']));
    expect(toMarkdown(r, s)).toContain('ЧАСТИЧНЫЙ ОТЧЁТ');
    expect(await schemaExists(BASE, r.schema)).toBe(false);
  });

  it('ошибка прогона: схема и хранилище всё равно удалены', async () => {
    const before = await evalSchemas();
    const dirsBefore = evalDirs();
    await expect(
      runEval({ baseDatabaseUrl: BASE, fixturesDir: resolve(FIXTURES, 'gibt-es-nicht'), env }),
    ).rejects.toThrow();
    expect(await evalSchemas()).toEqual(before);
    expect(evalDirs()).toEqual(dirsBefore);
    expect(existsSync(FIXTURES)).toBe(true);
  });
});
