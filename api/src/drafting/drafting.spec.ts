import type { ConfirmedClaim } from '../claims/claims.service.js';
import { availableQuestions } from './questions.js';
import { buildClarification } from './templates/clarification.js';
import { verifyDraft } from './verification.js';
import {
  availableReplyKinds,
  buildReply,
  extendableDeadlines,
} from './templates/replies.js';

const profile = {
  firstName: 'Anna',
  lastName: 'Muster',
  address: 'Musterstr. 12, 10115 Berlin',
};
const TODAY = '2026-11-17';
const claim = (
  id: string,
  kind: ConfirmedClaim['kind'],
  value: string,
  quote: string | null = value,
): ConfirmedClaim => ({
  id,
  letterId: 'l1',
  kind,
  value,
  quote,
});
const full: ConfirmedClaim[] = [
  claim('a', 'AUTHORITY', 'Jobcenter Musterstadt'),
  claim('n', 'CASE_NUMBER', 'JC-2026-1001', 'Aktenzeichen: JC-2026-1001'),
  claim('d', 'LETTER_DATE', '2026-11-11', 'Datum: 11.11.2026'),
  claim(
    'r',
    'REQUIREMENT',
    'Bitte reichen Sie die Kontoauszüge für September ein.',
  ),
  claim('m1', 'AMOUNT', '120.50', 'Betrag: 120,50 EUR'),
  claim('m2', 'AMOUNT', '1234.00', 'Gesamt: 1.234,00 EUR'),
];

describe('шаблон CLARIFICATION', () => {
  it('полные факты: DE и RU, требование в RU — обозначенная цитата на немецком', () => {
    const d = buildClarification({
      claims: full,
      profile,
      questionId: 'WHICH_DOCUMENTS',
      today: TODAY,
    });
    expect(d.germanText).toContain('Ihr Zeichen: JC-2026-1001');
    expect(d.germanText).toContain(
      'Ihrem Schreiben vom 11.11.2026 schreiben Sie: „Bitte reichen Sie',
    );
    expect(d.russianText).toContain(
      '(цитата из письма на немецком): «Bitte reichen Sie',
    );
    expect(d.russianText).toContain('какие именно документы');
    expect(d.claimIds.sort()).toEqual(['a', 'd', 'n', 'r']);
  });

  it('нет даты письма и ведомства: другая фраза, без пустых мест', () => {
    const d = buildClarification({
      claims: [full[3]],
      profile,
      questionId: 'REASON',
      today: TODAY,
    });
    expect(d.germanText).toContain(
      'Betreff: Bitte um Erläuterung zu Ihrem Schreiben\n',
    );
    expect(d.germanText).not.toMatch(/vom\s*\n|undefined|null|…/);
    expect(
      verifyDraft({ ...d, confirmed: [full[3]], profile, today: TODAY }).passed,
    ).toBe(true);
  });

  it('номера из профиля стоят под адресом в DE и RU и проходят проверку', () => {
    const withNumbers = {
      ...profile,
      numbers: [
        { label: 'Kundennummer', value: '123A456' },
        { label: 'BG-Nummer', value: '98765BG0004321' },
      ],
    };
    const built = buildClarification({
      claims: full,
      profile: withNumbers,
      questionId: 'WHICH_DOCUMENTS',
      today: TODAY,
    });
    for (const text of [built.germanText, built.russianText]) {
      const lines = text.split('\n');
      expect(lines.slice(0, 5)).toEqual([
        'Anna Muster',
        'Musterstr. 12, 10115 Berlin',
        'Kundennummer: 123A456',
        'BG-Nummer: 98765BG0004321',
        '',
      ]);
    }
    expect(
      verifyDraft({ ...built, confirmed: full, profile: withNumbers, today: TODAY })
        .passed,
    ).toBe(true);
    // Без номеров в профиле те же числа — «не из источников»
    expect(
      verifyDraft({ ...built, confirmed: full, profile, today: TODAY }).passed,
    ).toBe(false);
  });

  it('AMOUNT: выбранная сумма, другая сумма письма не попадает', () => {
    const d = buildClarification({
      claims: full,
      profile,
      questionId: 'AMOUNT',
      amountClaimId: 'm2',
      today: TODAY,
    });
    expect(d.germanText).toContain('Betrag von 1.234,00 €');
    expect(d.germanText).not.toContain('120,50');
    expect(d.claimIds).toContain('m2');
    expect(d.claimIds).not.toContain('m1');
  });

  it('доступность вопросов по подтверждённым фактам', () => {
    expect(availableQuestions([full[0]])).toEqual(['DEADLINE', 'REASON']);
    expect(availableQuestions(full)).toEqual([
      'WHICH_DOCUMENTS',
      'DEADLINE',
      'REASON',
      'FORMAT',
      'AMOUNT',
    ]);
  });
});

describe('проверка черновика (DE и RU)', () => {
  const good = buildClarification({
    claims: full,
    profile,
    questionId: 'WHICH_DOCUMENTS',
    today: TODAY,
  });
  const base = { ...good, confirmed: full, profile, today: TODAY };

  it('шаблон проходит; номер дома и индекс из профиля не считаются «чужими числами»', () => {
    const r = verifyDraft(base);
    expect(r.passed).toBe(true);
    expect(r.note).toContain('не юридическая проверка');
    expect(r.checklist.map((c) => c.claimId).sort()).toEqual([
      'a',
      'd',
      'n',
      'r',
    ]);
  });

  it('неверная дата в немецком или русском тексте ловится', () => {
    expect(
      verifyDraft({
        ...base,
        germanText: good.germanText.replace('11.11.2026', '12.11.2026'),
      }).passed,
    ).toBe(false);
    const ru = verifyDraft({
      ...base,
      russianText: good.russianText.replace('11.11.2026', '12.11.2026'),
    });
    expect(
      ru.checks.find((c) => c.name === 'ru: даты из источников')?.passed,
    ).toBe(false);
  });

  it('другой номер дела и чужое число ловятся', () => {
    expect(
      verifyDraft({
        ...base,
        germanText: good.germanText.replace(
          'Ihr Zeichen: JC-2026-1001',
          'Ihr Zeichen: JC-2026-9999',
        ),
      }).passed,
    ).toBe(false);
    expect(
      verifyDraft({
        ...base,
        germanText: `${good.germanText}\nBitte zahlen Sie 500 €.`,
      }).passed,
    ).toBe(false);
  });

  it('прошедшая дата как будущий срок ловится', () => {
    const past = verifyDraft({
      ...base,
      germanText: `${good.germanText}\nIch antworte bis zum 11.11.2026.`,
    });
    expect(
      past.checks.find((c) => c.name === 'de: нет прошедших сроков как будущих')
        ?.passed,
    ).toBe(false);
  });

  it('неподтверждённый факт (claimId вне списка) и незаполненная метка ловятся', () => {
    expect(
      verifyDraft({ ...base, claimIds: [...good.claimIds, 'x'] }).passed,
    ).toBe(false);
    expect(
      verifyDraft({ ...base, russianText: `${good.russianText} {{name}}` })
        .passed,
    ).toBe(false);
  });

  it('текст вопроса не источник чисел: число только из вопроса не проходит', () => {
    const d = buildClarification({
      claims: full,
      profile,
      questionId: 'AMOUNT',
      amountClaimId: 'm1',
      today: TODAY,
    });
    // сумма m1 разрешена только потому, что m1 в claimIds; без него — не из источников
    expect(
      verifyDraft({ ...d, confirmed: full, profile, today: TODAY }).passed,
    ).toBe(true);
    expect(
      verifyDraft({
        ...d,
        claimIds: d.claimIds.filter((id) => id !== 'm1'),
        confirmed: full,
        profile,
        today: TODAY,
      }).passed,
    ).toBe(false);
  });
});

describe('B12: шаблоны DOCUMENTS, EXTENSION, STATUS_REQUEST', () => {
  const withDeadlines: ConfirmedClaim[] = [
    ...full,
    claim('f1', 'DEADLINE', '2026-11-30', 'Bitte antworten Sie bis zum 30.11.2026.'),
    claim('f0', 'DEADLINE', '2026-11-01', 'bis zum 01.11.2026'),
  ];
  const verify = (b: ReturnType<typeof buildReply>, claims = withDeadlines) =>
    verifyDraft({ ...b, confirmed: claims, profile, today: TODAY });

  it('виды доступны по фактам: прошедший срок продлить нельзя', () => {
    expect(availableReplyKinds(withDeadlines, TODAY)).toEqual([
      'DOCUMENTS',
      'EXTENSION',
      'STATUS_REQUEST',
    ]);
    expect(extendableDeadlines(withDeadlines, TODAY).map((c) => c.id)).toEqual(['f1']);
    const onlyAuthority = [claim('a', 'AUTHORITY', 'Jobcenter Musterstadt')];
    expect(availableReplyKinds(onlyAuthority, TODAY)).toEqual(['STATUS_REQUEST']);
    expect(availableReplyKinds([], TODAY)).toEqual([]);
  });

  it('DOCUMENTS: требование — цитата оригинала в RU, проверка проходит', () => {
    const b = buildReply({ kind: 'DOCUMENTS', claims: withDeadlines, profile, today: TODAY });
    expect(b.germanText).toContain('Betreff: Übersendung von Unterlagen zu Ihrem Schreiben vom 11.11.2026');
    expect(b.germanText).toContain('Anbei übersende ich Ihnen die angeforderten Unterlagen.');
    expect(b.germanText).toContain('Ihr Zeichen: JC-2026-1001');
    expect(b.russianText).toContain('(цитата из письма на немецком): «Bitte reichen Sie die Kontoauszüge für September ein.»');
    expect(b.claimIds.sort()).toEqual(['a', 'd', 'n', 'r']);
    expect(verify(b).passed).toBe(true);
  });

  it('EXTENSION: выбранный срок и причина; без причины — только просьба', () => {
    const b = buildReply({
      kind: 'EXTENSION',
      claims: withDeadlines,
      profile,
      today: TODAY,
      deadlineClaimId: 'f1',
      extensionReason: 'DOCUMENTS_PENDING',
    });
    expect(b.germanText).toContain('haben Sie mir eine Frist bis zum 30.11.2026 gesetzt.');
    expect(b.germanText).toContain(
      'Ich benötige mehr Zeit, um die Unterlagen vollständig zusammenzustellen. Ich bitte Sie, die Frist um zwei Wochen zu verlängern.',
    );
    expect(b.russianText).toContain('вы установили мне срок до 30.11.2026.');
    expect(b.claimIds).toContain('f1');
    expect(verify(b).passed).toBe(true);
    const none = buildReply({
      kind: 'EXTENSION',
      claims: withDeadlines,
      profile,
      today: TODAY,
      deadlineClaimId: 'f1',
      extensionReason: 'NONE',
    });
    expect(none.germanText).toContain('\nIch bitte Sie, die Frist um zwei Wochen zu verlängern.\n');
    expect(verify(none).passed).toBe(true);
  });

  it('STATUS_REQUEST без даты письма и ведомства: другая фраза, без пустых мест', () => {
    const claims = [claim('n', 'CASE_NUMBER', 'JC-2026-1001', 'Aktenzeichen: JC-2026-1001')];
    const b = buildReply({ kind: 'STATUS_REQUEST', claims, profile, today: TODAY });
    expect(b.germanText).toContain('Betreff: Sachstandsanfrage zu Ihrem Schreiben\n');
    expect(b.russianText).toContain('Тема: запрос о ходе рассмотрения по вашему письму\n');
    expect(b.germanText).not.toMatch(/\n\n\n/);
    expect(verify(b, claims).passed).toBe(true);
  });

  it('правка с чужой датой или другим номером дела не проходит проверку', () => {
    const b = buildReply({ kind: 'STATUS_REQUEST', claims: withDeadlines, profile, today: TODAY });
    expect(verify({ ...b, germanText: b.germanText + '\nBitte antworten Sie bis zum 24.12.2026.' }).passed).toBe(false);
    expect(
      verify({ ...b, germanText: b.germanText.replace('Ihr Zeichen: JC-2026-1001', 'Ihr Zeichen: XY-1') }).passed,
    ).toBe(false);
    expect(verify({ ...b, russianText: b.russianText + '\nДобавлю свой вопрос.' }).passed).toBe(true);
  });
});
