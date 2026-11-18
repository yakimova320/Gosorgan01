import { describe, expect, it } from 'vitest';
import { summarize, toMarkdown } from './eval.report.js';
import type { EvalResult, LetterRun } from './eval.runner.js';

const usage = { calls: 2, failedCalls: 0, tokensIn: 100, tokensOut: 50, unknownUsageCalls: 0 };
const run = (over: Partial<LetterRun>): LetterRun => ({
  id: 'x', file: 'x.pdf', kind: 'PDF', status: 'OK', expectedRefusal: false, error: null, refusalClear: null,
  score: {
    authority: true, caseNumber: true, letterDate: true,
    deadlines: { tp: 1, fp: 0, fn: 0 }, requirements: { tp: 1, fp: 0, fn: 0 },
    quotes: { valid: 4, total: 4 }, inventedDates: [], inventedAmounts: [], unconfirmedAsFact: [], injection: [],
  },
  explanation: 'OK', draft: { passed: true, status: 'PREPARED' }, q2Variant: false, dropped: 0, ms: 1000, usage,
  ...over,
});
const result = (letters: LetterRun[], variants: LetterRun[] = []): EvalResult => ({
  at: '2026-11-18T12:00:00Z', provider: 'openai', model: 'm', promptVersions: { extract: [2] },
  maxCalls: 50, callsUsed: 20, partial: false, stoppedAt: null, letters, variants,
});

describe('B14 отчёт', () => {
  it('перегрузка провайдера (LLM_QUOTA): письмо не выполнено, не в метриках и не в отказах, итог «не оценено»', () => {
    const quota = { code: 'LLM_QUOTA', message: 'Ja!sno сейчас перегружен. Попробуйте позже' };
    const r = result(
      [
        run({ id: '01' }),
        run({ id: '02', file: '02.pdf', status: 'FAILED', error: quota, score: null }),
        run({ id: '11', file: '11.jpg', kind: 'PHOTO', status: 'REFUSED', expectedRefusal: true, error: quota, score: null }),
      ],
      [run({ id: '08', file: '08.pdf', status: 'REFUSED', expectedRefusal: true, error: quota, score: null })],
    );
    const s = summarize(r);
    expect(s.incomplete.providerQuota).toEqual(['02.pdf', '11.jpg', '08.pdf']);
    expect(s.byKind.ALL.authority).toEqual({ ok: 1, of: 1 });
    expect(s.refusals.total).toBe(0);
    expect(new Set(s.rules.map((x) => x.verdict))).toEqual(new Set(['не оценено']));
    const md = toMarkdown(r, s);
    expect(md).toContain('Прогон неполный');
    expect(md).toContain('не выполнено: провайдер перегружен');
  });

  it('неудачная операция модели (LLM_FAILED) — честный неверный ответ в знаменателе', () => {
    const s = summarize(result([
      run({ id: '01' }),
      run({ id: '02', status: 'FAILED', error: { code: 'LLM_FAILED', message: 'x' }, score: null }),
    ]));
    expect(s.byKind.ALL.authority).toEqual({ ok: 1, of: 2 });
    expect(s.byKind.ALL.failed).toBe(1);
    expect(s.incomplete.providerQuota).toEqual([]);
  });

  it('полный прогон без нарушений: «принято»; выдуманная дата — «не принято»', () => {
    const ok = summarize(result([run({ id: '01', q2Variant: true })]));
    expect(ok.rules.find((x) => x.id === 'Q1')!.verdict).toBe('принято');
    const bad = summarize(result([run({ id: '01', q2Variant: true, score: { ...run({}).score!, inventedDates: [{ where: 'draft', what: '2026-12-01' }] } })]));
    expect(bad.rules.find((x) => x.id === 'Q1')!.verdict).toBe('не принято');
    expect(bad.rules.find((x) => x.id === 'П1')!.verdict).toBe('не принято');
  });
});
