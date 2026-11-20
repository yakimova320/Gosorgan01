import {
  isValidIban,
  OUTGOING_TEMPLATES,
  OutgoingSchema,
  type OutgoingTemplateId,
} from '@jasno/shared';
import { describe, expect, it } from 'vitest';
import type { ConfirmedClaim } from '../claims/claims.service.js';
import { outgoingDateErrors } from './drafts.service.js';
import { buildLetterPdf } from './letter-pdf.js';
import { buildOutgoing } from './templates/outgoing.js';
import { verifyDraft } from './verification.js';

/* B16: шесть шаблонов своих писем. Без модели, проверка той же verifyDraft. */

const profile = {
  firstName: 'Anna',
  lastName: 'Muster',
  address: 'Musterstr. 12, 10115 Berlin',
  numbers: [{ label: 'Kundennummer', value: '123A456' }],
};
const TODAY = '2026-11-20';

let n = 0;
const claim = (kind: ConfirmedClaim['kind'], value: string): ConfirmedClaim => ({
  id: `c${++n}`,
  letterId: null,
  kind,
  value,
  quote: null,
  label: `поле: ${value}`,
});

const recipient = {
  'recipient.name': claim('AUTHORITY', 'Jobcenter Berlin Mitte'),
  'recipient.address': claim('OTHER', 'Postfach 1234\n10115 Berlin'),
};

/** Все поля каждого шаблона заполнены: самый длинный вариант текста. */
const FULL: Record<OutgoingTemplateId, Record<string, string>> = {
  KUENDIGUNG: { reference: 'K-2026-77', subject: 'Mitgliedschaft im Sportverein', endDate: '2026-12-31' },
  AENDERUNG: { reference: '123A456789', change: 'JOB_START', date: '2026-12-01', details: 'Arbeitgeber Muster GmbH' },
  NEUES_KONTO: { reference: '123A456789', iban: 'DE89 3704 0044 0532 0130 00', holder: 'Anna Muster', validFrom: '2026-12-01' },
  BESCHWERDE: { reference: '123A456789', reason: 'NO_REPLY', since: '2026-09-01', details: 'Drei Schreiben ohne Antwort' },
  SACHSTANDSANFRAGE: { reference: 'WG-2026-12', subject: 'Antrag auf Wohngeld', submitted: '2026-08-15' },
  FRISTVERLAENGERUNG: { reference: 'JC-2026-1001', letterDate: '2026-11-11', deadline: '2026-11-30', newDate: '2026-12-14', reason: 'DOCUMENTS_PENDING' },
};

function build(templateId: OutgoingTemplateId, fields: Record<string, string>) {
  const claims: Record<string, ConfirmedClaim> = { ...recipient };
  const template = OUTGOING_TEMPLATES.find((t) => t.id === templateId)!;
  for (const f of template.fields)
    if (fields[f.key])
      claims[f.key] = claim(
        f.type === 'reference' ? 'CASE_NUMBER' : 'OTHER',
        fields[f.key],
      );
  const built = buildOutgoing({ templateId, claims, profile, today: TODAY });
  const report = verifyDraft({ ...built, confirmed: Object.values(claims), profile, today: TODAY });
  return { built, report, claims };
}

describe('каталог', () => {
  it('шесть шаблонов из ТЗ, у каждого поля с подписью по-русски', () => {
    expect(OUTGOING_TEMPLATES.map((t) => t.id)).toEqual([
      'KUENDIGUNG',
      'AENDERUNG',
      'NEUES_KONTO',
      'BESCHWERDE',
      'SACHSTANDSANFRAGE',
      'FRISTVERLAENGERUNG',
    ]);
    for (const t of OUTGOING_TEMPLATES) {
      expect(t.titleRu && t.titleDe).toBeTruthy();
      for (const f of t.fields) expect(f.labelRu).toBeTruthy();
    }
  });
});

describe.each(Object.keys(FULL) as OutgoingTemplateId[])('%s', (id) => {
  it('все поля: текст DE и RU проходит проверку, рамка письма на месте', () => {
    const { built, report, claims } = build(id, FULL[id]);
    expect(report.passed, JSON.stringify(report.checks.filter((c) => !c.passed))).toBe(true);
    const de = built.germanText;
    expect(de).toMatch(/^Anna Muster\nMusterstr\. 12, 10115 Berlin\nKundennummer: 123A456\n\nJobcenter Berlin Mitte\nPostfach 1234\n10115 Berlin\n/);
    expect(de).toContain(`Datum: 20.11.2026\nIhr Zeichen: ${FULL[id].reference}`);
    expect(de).toMatch(/\nBetreff: .+\n\nSehr geehrte Damen und Herren,\n\n[a-zäöü]/);
    expect(de.endsWith('Mit freundlichen Grüßen\nAnna Muster')).toBe(true);
    expect(built.russianText).toContain('Уважаемые дамы и господа,');
    expect(built.russianText).not.toMatch(/[äöüß]|Sehr geehrte/);
    // все факты дела — в основаниях черновика
    expect(built.claimIds.sort()).toEqual(Object.values(claims).map((c) => c.id).sort());
  });

  it('только обязательные поля: проверка пройдена, без пустых мест', () => {
    const template = OUTGOING_TEMPLATES.find((t) => t.id === id)!;
    const required = Object.fromEntries(
      Object.entries(FULL[id]).filter(([k]) => template.fields.find((f) => f.key === k)!.required),
    );
    const { built, report } = build(id, required);
    expect(report.passed, JSON.stringify(report.checks.filter((c) => !c.passed))).toBe(true);
    expect(built.germanText).not.toContain('Ihr Zeichen');
  });

  it('немецкий текст печатается в PDF', async () => {
    const { built } = build(id, FULL[id]);
    const pdf = await buildLetterPdf({ germanText: built.germanText });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('схема принимает полный набор полей', () => {
    const r = OutgoingSchema.safeParse({
      templateId: id,
      recipient: { name: 'Jobcenter Berlin Mitte', address: 'Postfach 1234\n10115 Berlin' },
      fields: FULL[id],
    });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });
});

describe('тексты шаблонов', () => {
  it('NEUES_KONTO: IBAN группами по четыре, владелец по умолчанию из профиля', () => {
    const { built } = build('NEUES_KONTO', { iban: 'DE89 3704 0044 0532 0130 00' });
    expect(built.germanText).toContain('Kontoinhaber: Anna Muster\nIBAN: DE89 3704 0044 0532 0130 00');
    expect(built.russianText).toContain('Владелец счёта: Anna Muster\nIBAN: DE89 3704 0044 0532 0130 00');
  });

  it('AENDERUNG ADDRESS: новый адрес из профиля', () => {
    const { built, report } = build('AENDERUNG', { change: 'ADDRESS', date: '2026-11-01' });
    expect(report.passed).toBe(true);
    expect(built.germanText).toContain('dass sich meine Anschrift geändert hat. Die Änderung gilt ab dem 01.11.2026.');
    expect(built.germanText).toContain('Meine neue Anschrift lautet: Musterstr. 12, 10115 Berlin');
  });

  it('немецкий текст человека в переводе — цитата, не перевод', () => {
    const { built } = build('SACHSTANDSANFRAGE', FULL.SACHSTANDSANFRAGE);
    expect(built.russianText).toContain('«Antrag auf Wohngeld» (по-немецки, как вы написали)');
  });

  it('KUENDIGUNG без даты: в ближайший возможный срок', () => {
    const { built } = build('KUENDIGUNG', { subject: 'Mobilfunkvertrag' });
    expect(built.germanText).toContain('zum nächstmöglichen Zeitpunkt wirksam werden');
  });

  it('FRISTVERLAENGERUNG: новая дата и причина из готового списка', () => {
    const { built } = build('FRISTVERLAENGERUNG', FULL.FRISTVERLAENGERUNG);
    expect(built.germanText).toContain('eine Frist bis zum 30.11.2026 gesetzt.');
    expect(built.germanText).toContain('Ich benötige mehr Zeit, um die Unterlagen vollständig zusammenzustellen. Ich bitte Sie, die Frist bis zum 14.12.2026 zu verlängern.');
  });

  it('проверка ловит дату не из полей', () => {
    const { built, claims } = build('SACHSTANDSANFRAGE', FULL.SACHSTANDSANFRAGE);
    const report = verifyDraft({
      ...built,
      germanText: built.germanText.replace('15.08.2026', '16.08.2026'),
      confirmed: Object.values(claims),
      profile,
      today: TODAY,
    });
    expect(report.passed).toBe(false);
  });
});

describe('проверка полей', () => {
  const base = { recipient: { name: 'Jobcenter Berlin Mitte', address: 'Postfach 1234, 10115 Berlin' } };
  const issues = (body: unknown) =>
    (OutgoingSchema.safeParse(body).error?.issues ?? []).map((i) => [i.path.join('.'), i.message]);

  it('обязательные поля, неизвестное поле, кириллица, многоточие', () => {
    expect(issues({ ...base, templateId: 'SACHSTANDSANFRAGE', fields: {} })).toEqual([
      ['fields.subject', 'Заполните поле'],
      ['fields.submitted', 'Заполните поле'],
    ]);
    expect(issues({ ...base, templateId: 'KUENDIGUNG', fields: { subject: 'Vertrag', extra: 'x' } })).toEqual([
      ['fields.extra', 'Такого поля нет в шаблоне'],
    ]);
    expect(issues({ ...base, templateId: 'KUENDIGUNG', fields: { subject: 'договор' } })[0]).toEqual([
      'fields.subject',
      'По-немецки, латинскими буквами',
    ]);
    expect(issues({ ...base, templateId: 'KUENDIGUNG', fields: { subject: 'Vertrag...' } })[0][0]).toBe('fields.subject');
    expect(
      issues({ templateId: 'KUENDIGUNG', recipient: { name: 'Джобцентр', address: 'Berlin 10115' }, fields: { subject: 'Vertrag' } })[0],
    ).toEqual(['recipient.name', 'Название ведомства латиницей, как в его письмах']);
  });

  it('IBAN: контрольная сумма и длина немецкого IBAN', () => {
    expect(isValidIban('DE89 3704 0044 0532 0130 00')).toBe(true);
    expect(isValidIban('DE89 3704 0044 0532 0130 01')).toBe(false);
    expect(isValidIban('DE89 3704 0044 0532 0130')).toBe(false);
    expect(isValidIban('AT61 1904 3002 3457 3201')).toBe(true);
  });

  it('дата: настоящая дата и выбор из списка', () => {
    expect(issues({ ...base, templateId: 'SACHSTANDSANFRAGE', fields: { subject: 'Antrag', submitted: '2026-02-30' } })).toEqual([
      ['fields.submitted', 'Дата в формате ГГГГ-ММ-ДД'],
    ]);
    expect(issues({ ...base, templateId: 'BESCHWERDE', fields: { reason: 'OTHER' } })).toEqual([
      ['fields.reason', 'Выберите вариант'],
    ]);
  });

  it('FRISTVERLAENGERUNG: новая дата позже срока; сервер: срок не прошёл', () => {
    expect(
      issues({ ...base, templateId: 'FRISTVERLAENGERUNG', fields: { deadline: '2026-12-01', newDate: '2026-12-01', reason: 'NONE' } }),
    ).toEqual([['fields.newDate', 'Новая дата должна быть позже текущего срока']]);
    expect(outgoingDateErrors('FRISTVERLAENGERUNG', { deadline: '2026-11-19' }, TODAY)).toEqual({
      'fields.deadline': 'Срок уже прошёл: продлить можно только будущий срок',
    });
    expect(outgoingDateErrors('FRISTVERLAENGERUNG', { deadline: TODAY }, TODAY)).toEqual({});
    expect(outgoingDateErrors('SACHSTANDSANFRAGE', { submitted: '2026-11-21' }, TODAY)).toEqual({
      'fields.submitted': 'Дата подачи не может быть в будущем',
    });
    expect(outgoingDateErrors('KUENDIGUNG', { endDate: '2026-11-19' }, TODAY)).toEqual({
      'fields.endDate': 'Дата расторжения не может быть в прошлом',
    });
  });
});
