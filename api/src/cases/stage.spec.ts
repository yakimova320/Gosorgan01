import { berlinToday, toIsoDate } from '../common/berlin-date.js';
import { caseProgress, caseStage, type StageInput } from './stage.js';

const TODAY = '2026-11-20';
const base: StageInput = {
  status: 'OPEN',
  deadlines: [],
  hasUnconfirmedClaims: false,
  lastDraftSent: false,
};
const dl = (date: string, kind = 'REPLY', confirmed = true, done = false) => ({
  date,
  kind,
  confirmed,
  done,
});

describe('stage дела', () => {
  it('CLOSED важнее всего', () => {
    expect(
      caseStage(
        { ...base, status: 'CLOSED', deadlines: [dl('2026-11-01')] },
        TODAY,
      ).stage,
    ).toBe('CLOSED');
  });

  it('просроченный подтверждённый срок → OVERDUE, даже если есть будущий', () => {
    const r = caseStage(
      { ...base, deadlines: [dl('2026-12-01', 'DOCUMENTS'), dl('2026-11-19')] },
      TODAY,
    );
    expect(r).toEqual({ stage: 'OVERDUE', nextDeadline: '2026-11-19' });
  });

  it('срок сегодня не просрочен; ближайший срок определяет вид', () => {
    expect(
      caseStage(
        { ...base, deadlines: [dl(TODAY, 'DOCUMENTS'), dl('2026-12-10')] },
        TODAY,
      ),
    ).toEqual({
      stage: 'DOCUMENTS',
      nextDeadline: TODAY,
    });
    expect(
      caseStage(
        {
          ...base,
          deadlines: [
            dl('2026-12-10', 'DOCUMENTS'),
            dl('2026-12-01', 'OBJECTION'),
          ],
        },
        TODAY,
      ).stage,
    ).toBe('REPLY');
  });

  it('подтверждённый срок важнее непроверенных фактов', () => {
    expect(
      caseStage(
        {
          ...base,
          hasUnconfirmedClaims: true,
          deadlines: [dl('2026-12-01', 'DOCUMENTS')],
        },
        TODAY,
      ).stage,
    ).toBe('DOCUMENTS');
  });

  it('неподтверждённый или выполненный срок не влияет', () => {
    const r = caseStage(
      {
        ...base,
        hasUnconfirmedClaims: true,
        deadlines: [
          dl('2026-11-01', 'REPLY', false),
          dl('2026-11-02', 'REPLY', true, true),
        ],
      },
      TODAY,
    );
    expect(r).toEqual({ stage: 'NEEDS_CHECK', nextDeadline: null });
  });

  it('отправленный ответ без открытых сроков → WAITING; иначе OPEN', () => {
    expect(caseStage({ ...base, lastDraftSent: true }, TODAY).stage).toBe(
      'WAITING',
    );
    expect(caseStage(base, TODAY).stage).toBe('OPEN');
  });

  it('«сегодня» по Берлину: 23:30 UTC 19.11 — уже 20.11 в Берлине', () => {
    const today = toIsoDate(berlinToday(new Date('2026-11-19T23:30:00Z')));
    expect(today).toBe('2026-11-20');
    expect(
      caseStage({ ...base, deadlines: [dl('2026-11-19')] }, today).stage,
    ).toBe('OVERDUE');
    expect(toIsoDate(berlinToday(new Date('2026-11-19T22:30:00Z')))).toBe(
      '2026-11-19',
    );
  });
});

describe('caseProgress (поправка 14)', () => {
  const base = {
    closed: false,
    hasClaims: true,
    unconfirmed: 0,
    openDeadlines: 1,
    replySent: false,
  };
  it('факты проверены, срок открыт, ответа нет: 1 из 3 · 33 %', () => {
    const p = caseProgress(base);
    expect([p.done, p.total, p.percent]).toEqual([1, 3, 33]);
  });
  it('факты проверены, сроков нет, ответ отправлен: 3 из 3', () => {
    const p = caseProgress({ ...base, openDeadlines: 0, replySent: true });
    expect([p.done, p.percent]).toEqual([3, 100]);
  });
  it('есть непроверенные факты: шаг проверки не сделан', () => {
    const p = caseProgress({ ...base, unconfirmed: 2, openDeadlines: 0 });
    expect(p.steps.map((s) => s.done)).toEqual([false, true, false]);
    expect(p.percent).toBe(33);
  });
  it('без фактов проверять нечего, но шаг не засчитан', () => {
    expect(caseProgress({ ...base, hasClaims: false }).steps[0].done).toBe(false);
  });
  it('завершённое дело: 100 %', () => {
    expect(caseProgress({ ...base, closed: true, unconfirmed: 3 }).percent).toBe(100);
  });
});
