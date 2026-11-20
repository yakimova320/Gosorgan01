import {
  ExplainSchema,
  ExplainV2Schema,
} from '../llm/schemas/explain.schema.js';
import { demoExplain, demoRequestRu } from '../llm/adapters/demo.adapter.js';
import {
  checkExplanation,
  datesInAny,
  factsVersion,
  finalizeExplanation,
  numbersIn,
  type ExplainFact,
} from './explain.logic.js';

const facts: ExplainFact[] = [
  {
    id: 'a',
    kind: 'AUTHORITY',
    value: 'Jobcenter Musterstadt',
    quote: 'Jobcenter Musterstadt',
    status: 'CONFIRMED',
  },
  {
    id: 'r',
    kind: 'REQUIREMENT',
    value: 'Bitte reichen Sie die Kontoauszüge ein.',
    quote: 'Bitte reichen Sie die Kontoauszüge ein.',
    status: 'UNCONFIRMED',
  },
  {
    id: 'd1',
    kind: 'DEADLINE',
    value: '2026-12-01',
    quote: 'bis zum 01.12.2026',
    status: 'CONFIRMED',
    deadlineKind: 'DOCUMENTS',
  },
  {
    id: 'd2',
    kind: 'DEADLINE',
    value: '2026-12-10',
    quote: 'bis zum 10.12.2026',
    status: 'CONFIRMED',
    deadlineKind: 'REPLY',
  },
  {
    id: 'm',
    kind: 'AMOUNT',
    value: '1234.50',
    quote: 'Betrag: 1.234,50 EUR',
    status: 'CONFIRMED',
  },
];

const ok = (
  about: string,
  ids: string[],
  actions: { text: string; claimIds: string[] }[] = [],
) => ExplainSchema.parse({ about: { text: about, claimIds: ids }, actions });

describe('даты и числа в объяснении', () => {
  it('немецкий, русский и ISO формат дат', () => {
    expect(datesInAny('до 01.12.2026, 10 декабря 2026 или 2026-12-15')).toEqual(
      ['2026-12-01', '2026-12-10', '2026-12-15'],
    );
  });

  it('числа вне дат с немецкими и русскими разделителями', () => {
    expect(
      numbersIn('Сумма 1.234,50 € или 1 234,50 и 120 — до 01.12.2026'),
    ).toEqual(['1234.50', '1234.50', '120.00']);
  });
});

describe('проверка объяснения', () => {
  it('корректное объяснение проходит', () => {
    const r = ok(
      'Jobcenter Musterstadt просит прислать выписки.',
      ['a', 'r'],
      [
        { text: 'Прислать выписки до 1 декабря 2026.', claimIds: ['r', 'd1'] },
        { text: 'Ответить до 10.12.2026.', claimIds: ['d2'] },
        { text: 'Сумма в письме: 1 234,50 €.', claimIds: ['m'] },
      ],
    );
    expect(checkExplanation(r, facts)).toBeNull();
  });

  it('дата не из фактов этого утверждения отклоняется, даже если она есть в другом факте', () => {
    expect(checkExplanation(ok('Срок до 15.12.2026.', ['d1']), facts)).toMatch(
      /дата 2026-12-15/,
    );
    expect(
      checkExplanation(ok('Ответить до 10.12.2026.', ['d1']), facts),
    ).toMatch(/дата 2026-12-10/);
  });

  it('число не из фактов отклоняется', () => {
    expect(
      checkExplanation(ok('Нужно заплатить 500 €.', ['m']), facts),
    ).toMatch(/число 500/);
  });

  it('неизвестный claimId и пустые claimIds не принимаются', () => {
    expect(checkExplanation(ok('Письмо.', ['zzz']), facts)).toMatch(
      /неизвестные claimIds/,
    );
    expect(
      ExplainSchema.safeParse({
        about: { text: 'x', claimIds: [] },
        actions: [],
      }).success,
    ).toBe(false);
  });

  it('последствия и юридические выводы без основания в цитате отклоняются', () => {
    expect(
      checkExplanation(ok('Иначе вам прекратят выплаты.', ['r']), facts),
    ).toMatch(/последствия/);
    expect(
      checkExplanation(ok('Подайте возражение в суд.', ['r']), facts),
    ).toMatch(/юридические/);
    const withBasis: ExplainFact[] = [
      {
        id: 'w',
        kind: 'OTHER',
        value: 'Widerspruch',
        quote: 'Gegen diesen Bescheid kann Widerspruch erhoben werden.',
        status: 'CONFIRMED',
      },
    ];
    expect(
      checkExplanation(
        ok('В письме сказано, что можно подать возражение.', ['w']),
        withBasis,
      ),
    ).toBeNull();
  });
});

describe('ответ API', () => {
  it('все сроки письма с датой и флаги «не подтверждено» ставит код', () => {
    const view = finalizeExplanation(
      ok(
        'Письмо от Jobcenter.',
        ['a'],
        [{ text: 'Прислать выписки.', claimIds: ['r'] }],
      ),
      facts,
    );
    expect(view.deadlines.map((d) => [d.date, d.confirmed])).toEqual([
      ['2026-12-01', true],
      ['2026-12-10', true],
    ]);
    expect(view.about.unconfirmed).toBe(false);
    expect(view.actions[0].unconfirmed).toBe(true);
    expect(view.unconfirmed).toBe(true);
  });

  it('версия фактов меняется при смене статуса', () => {
    const changed = facts.map((f) =>
      f.id === 'r' ? { ...f, status: 'CONFIRMED' as const } : f,
    );
    expect(factsVersion(changed)).not.toBe(factsVersion(facts));
    expect(factsVersion([...facts].reverse())).toBe(factsVersion(facts));
  });

  it('demo-объяснение проходит проверку', () => {
    const r = ExplainSchema.parse(demoExplain(JSON.stringify(facts)));
    expect(checkExplanation(r, facts)).toBeNull();
  });
});

describe('K08: что просит ведомство по-русски и по-немецки', () => {
  const base = { about: { text: 'Письмо.', claimIds: ['a'] }, actions: [] };

  it('перевод только для фактов REQUIREMENT, без повторов', () => {
    expect(
      checkExplanation(
        { ...base, requests: [{ claimId: 'a', ru: 'Прислать.' }] },
        facts,
      ),
    ).toMatch(/не факт REQUIREMENT/);
    expect(
      checkExplanation(
        {
          ...base,
          requests: [
            { claimId: 'r', ru: 'Прислать выписки.' },
            { claimId: 'r', ru: 'Ещё раз.' },
          ],
        },
        facts,
      ),
    ).toMatch(/повторяется/);
  });

  it('дата в переводе, которой нет в требовании, отклоняется', () => {
    expect(
      checkExplanation(
        { ...base, requests: [{ claimId: 'r', ru: 'Прислать до 01.12.2026.' }] },
        facts,
      ),
    ).toMatch(/requests\.0: дата/);
  });

  it('немецкий текст берёт код из факта; без перевода ru = null', () => {
    const withRu = finalizeExplanation(
      { ...base, requests: [{ claimId: 'r', ru: 'Прислать выписки со счёта.' }] },
      facts,
    );
    expect(withRu.requests).toEqual([
      {
        claimId: 'r',
        ru: 'Прислать выписки со счёта.',
        de: 'Bitte reichen Sie die Kontoauszüge ein.',
        unconfirmed: true,
      },
    ]);
    const v1 = finalizeExplanation(base, facts);
    expect(v1.requests[0]).toMatchObject({ ru: null, de: facts[1].value });
  });

  it('demo: перевод по словарю, неизвестное требование без перевода', () => {
    expect(demoRequestRu('Bitte reichen Sie die Kontoauszüge für September ein.')).toBe(
      'Прислать: выписки с банковского счёта за сентябрь.',
    );
    expect(demoRequestRu('Bitte legen Sie den Mietvertrag vor.')).toBe(
      'Предъявить: договор аренды.',
    );
    expect(demoRequestRu('Bitte rufen Sie uns an.')).toBeNull();
    const r = ExplainV2Schema.parse(demoExplain(JSON.stringify(facts)));
    expect(r.requests).toHaveLength(1);
    expect(checkExplanation(r, facts)).toBeNull();
  });
});
