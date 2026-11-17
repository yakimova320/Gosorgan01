import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { demoExtract } from '../llm/adapters/demo.adapter.js';
import { ExtractV2Schema } from '../llm/schemas/extract.schema.js';
import {
  amountsIn,
  datesIn,
  findQuote,
  isCalendarDate,
  normalize,
  valueInQuote,
} from './claim-check.js';
import { buildClaims, checkUserValue } from './claims.builder.js';
import { joinPages } from '../documents/documents.service.js';

const fixture = (name: string) =>
  readFileSync(
    resolve(import.meta.dirname, '..', '..', '..', 'fixtures', 'letters', name),
    'utf8',
  );
const fixtureJson = (id: string) =>
  JSON.parse(fixture(`${id}.json`)) as {
    text: string;
    expected: {
      authority: string | null;
      caseNumber: string | null;
      letterDate: string | null;
      requirements: string[];
      deadlines: string[];
    };
  };

const empty = { value: null, quote: null, page: null };
const base = {
  authority: empty,
  caseNumber: empty,
  letterDate: empty,
  requirements: [],
  deadlines: [],
  amounts: [],
  relativeDeadlines: [],
};
const PAGE =
  'Jobcenter Musterstadt\nAktenzeichen: JC-2026-1001\nBitte reichen Sie die Kontoauszüge bis zum 30.11.2026 ein.\nOffener Betrag: 1.234,50 EUR';
const pages = [{ n: 1, text: PAGE }];

describe('нормализация и поиск цитаты', () => {
  it('регистр, пробелы, переносы и дефис переноса', () => {
    expect(normalize('Konto-\n  auszüge   BIS')).toBe('kontoauszüge bis');
    expect(
      findQuote('bitte reichen sie die konto-\nauszüge', pages, null, false),
    ).toEqual({ page: 1 });
  });

  it('страница: указанная должна существовать и содержать цитату', () => {
    const two = [
      { n: 1, text: 'Seite eins Text' },
      { n: 2, text: 'Bitte antworten Sie bis zum 01.12.2026.' },
    ];
    expect(findQuote('Bitte antworten Sie', two, 2, false)).toEqual({
      page: 2,
    });
    expect(findQuote('Bitte antworten Sie', two, 1, false)).toBeNull();
    expect(findQuote('Bitte antworten Sie', two, 3, false)).toBeNull();
  });

  it('фото: опечатка распознавания допускается, другие цифры — нет', () => {
    const quote = 'Bitte reichen Sie die Kontoauszüge bis zum 30.11.2026 ein.';
    expect(
      findQuote(
        quote.replace('Kontoauszüge', 'Kontoauszuge'),
        pages,
        null,
        true,
      ),
    ).toEqual({ page: 1 });
    expect(
      findQuote(quote.replace('30.11', '31.11'), pages, null, true),
    ).toBeNull();
    expect(
      findQuote(
        quote.replace('Kontoauszüge', 'Kontoauszuge'),
        pages,
        null,
        false,
      ),
    ).toBeNull();
  });
});

describe('даты и суммы', () => {
  it('существующие календарные даты в разных форматах', () => {
    expect(isCalendarDate('2026-02-28')).toBe(true);
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(
      datesIn(
        'bis zum 30.11.2026, sonst 3.1.27 oder 15. März 2026, 1. Dez. 2026',
      ),
    ).toEqual(['2026-11-30', '2027-01-03', '2026-03-15', '2026-12-01']);
    expect(datesIn('am 31.02.2026')).toEqual([]);
  });

  it('суммы в немецком формате', () => {
    expect(amountsIn('Betrag: 1.234,50 EUR und 120,00 €')).toEqual([
      '1234.50',
      '120.00',
    ]);
  });
});

describe('значение подтверждается цитатой', () => {
  it('настоящая цитата с выдуманным номером, суммой или датой отклоняется', () => {
    const q = 'Aktenzeichen: JC-2026-1001';
    expect(valueInQuote('CASE_NUMBER', 'JC-2026-1001', q)).toBeNull();
    expect(valueInQuote('CASE_NUMBER', 'JC-2026-9999', q)).not.toBeNull();
    expect(
      valueInQuote('AMOUNT', '1234.50', 'Offener Betrag: 1.234,50 EUR'),
    ).toBeNull();
    expect(
      valueInQuote('AMOUNT', '1234.60', 'Offener Betrag: 1.234,50 EUR'),
    ).not.toBeNull();
    expect(
      valueInQuote('DEADLINE', '2026-12-30', 'bis zum 30.11.2026'),
    ).not.toBeNull();
    expect(
      valueInQuote('DEADLINE', '2026-02-30', 'bis zum 30.02.2026'),
    ).not.toBeNull();
    expect(
      valueInQuote('AUTHORITY', 'Jobcenter Berlin', 'Jobcenter Musterstadt'),
    ).not.toBeNull();
  });

  it('buildClaims: поле с цитатой не из письма или выдуманным значением отбрасывается', () => {
    const { claims, dropped } = buildClaims(
      {
        ...base,
        authority: {
          value: 'Jobcenter Musterstadt',
          quote: 'Jobcenter Musterstadt',
          page: 1,
        },
        caseNumber: {
          value: 'JC-2026-9999',
          quote: 'Aktenzeichen: JC-2026-1001',
          page: 1,
        },
        requirements: [
          {
            value: 'Bitte zahlen Sie sofort.',
            quote: 'Bitte zahlen Sie sofort.',
            page: 1,
          },
        ],
        deadlines: [
          {
            value: '2026-11-30',
            quote: 'Bitte reichen Sie die Kontoauszüge bis zum 30.11.2026 ein.',
            page: 1,
            kind: 'DOCUMENTS',
          },
        ],
        amounts: [
          { value: '1234.50', quote: 'Offener Betrag: 1.234,50 EUR', page: 1 },
        ],
      },
      pages,
      false,
    );
    expect(claims.map((c) => c.kind)).toEqual([
      'AUTHORITY',
      'DEADLINE',
      'AMOUNT',
    ]);
    expect(claims[1].text).toBe('Срок: до 30.11.2026 (прислать документы)');
    expect(claims[2].text).toBe('Сумма: 1.234,50 €');
    expect(dropped.map((d) => d.field)).toEqual([
      'caseNumber',
      'requirements.0',
    ]);
  });
});

describe('demo extract на эталонах', () => {
  it.each([
    '01_jobcenter_request',
    '04_buergeramt',
    '06_multiple_deadlines',
    '14_prompt_injection',
  ])(
    '%s: ведомство, номер, дата и сроки как в эталоне, ничего не отброшено',
    (id) => {
      const f = fixtureJson(id);
      const result = ExtractV2Schema.parse(demoExtract(f.text));
      const { claims, dropped } = buildClaims(
        result,
        [{ n: 1, text: f.text }],
        false,
      );
      const one = (k: string) =>
        claims.find((c) => c.kind === k)?.value ?? null;
      expect(one('AUTHORITY')).toBe(f.expected.authority);
      expect(one('CASE_NUMBER')).toBe(f.expected.caseNumber);
      expect(one('LETTER_DATE')).toBe(f.expected.letterDate);
      expect(
        claims
          .filter((c) => c.kind === 'DEADLINE')
          .map((c) => c.value)
          .sort(),
      ).toEqual([...f.expected.deadlines].sort());
      expect(dropped).toEqual([]);
    },
  );

  it('15: срок без даты сохраняется как требование без даты, не превращается в дату', () => {
    const f = fixtureJson('15_relative_deadline');
    const result = ExtractV2Schema.parse(demoExtract(f.text));
    const { claims } = buildClaims(result, [{ n: 1, text: f.text }], false);
    expect(claims.filter((c) => c.kind === 'DEADLINE')).toEqual([]);
    const relative = claims.find((c) => c.kind === 'OTHER');
    expect(relative?.value).toBe('innerhalb von zwei Wochen');
    expect(relative?.text).toContain('Срок без точной даты');
    expect(relative?.quote).toContain('innerhalb von zwei Wochen');
  });
});

describe('страницы и ввод человека', () => {
  it('joinPages хранит границы страниц, а не маркеры', () => {
    const { text, pages: meta } = joinPages([
      { n: 1, text: 'eins --- Seite 2 --- im Text' },
      { n: 2, text: 'zwei' },
    ]);
    expect(text.slice(meta[0].start, meta[0].end)).toBe(
      'eins --- Seite 2 --- im Text',
    );
    expect(text.slice(meta[1].start, meta[1].end)).toBe('zwei');
  });

  it('исправленное значение проверяется по виду факта', () => {
    expect(checkUserValue('DEADLINE', '2026-12-05')).toBeNull();
    expect(checkUserValue('DEADLINE', '2026-02-30')).not.toBeNull();
    expect(checkUserValue('DEADLINE', '05.12.2026')).not.toBeNull();
    expect(checkUserValue('AMOUNT', '120,50')).not.toBeNull();
    expect(checkUserValue('CASE_NUMBER', 'JC-1')).toBeNull();
  });
});
