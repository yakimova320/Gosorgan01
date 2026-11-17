import { berlinToday, toIsoDate } from '../common/berlin-date.js';
import { caseStage, type StageInput } from './stage.js';

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
