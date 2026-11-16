import type { Cabinet, CaseDetail, Claim, Deadline, Draft, Explanation, Letter } from '../api/types';

/*
 * Примерные данные для режима VITE_DATA_MODE=mock.
 * Основа: синтетические письма fixtures/letters/01, 04, 06. Настоящих людей здесь нет.
 */

const LETTER_01 = `Jobcenter Musterstadt
Musterweg 10, 00000 Musterstadt

An: Alex Beispiel
Beispielallee 12, 00000 Beispielhausen

Datum: 11.11.2026
Aktenzeichen: JC-2026-1001

Betreff: Unterlagen zu Ihrem Antrag

Sehr geehrte Person Beispiel,

Bitte reichen Sie die Kontoauszüge für September ein.
Bitte antworten Sie bis zum 30.11.2026.

Bei Rückfragen nennen Sie bitte das oben angegebene Aktenzeichen.
Diese Mitteilung betrifft ausschließlich die genannten Unterlagen.

Mit freundlichen Grüßen
Ihre Sachbearbeitung`;

const LETTER_04 = LETTER_01.replace('Jobcenter Musterstadt', 'Bürgeramt Beispielhausen')
  .replace('JC-2026-1001', 'BA-2026-2042')
  .replace('Bitte reichen Sie die Kontoauszüge für September ein.', 'Bitte legen Sie den Mietvertrag vor.')
  .replace('30.11.2026', '02.12.2026');

const LETTER_06 = LETTER_01.replace('Jobcenter Musterstadt', 'Finanzamt Beispielhausen')
  .replace('JC-2026-1001', 'FA-2026-5010')
  .replace(
    'Bitte reichen Sie die Kontoauszüge für September ein.\nBitte antworten Sie bis zum 30.11.2026.',
    'Bitte reichen Sie die Einkommensnachweise ein.\nBitte bestätigen Sie Ihre Anschrift.\nBitte antworten Sie bis zum 01.12.2026.\nBitte antworten Sie bis zum 10.12.2026.',
  );

function claim(id: string, kind: Claim['kind'], value: string, text: string, quote: string, status: Claim['status'] = 'CONFIRMED'): Claim {
  return { id, kind, value, text, quote, page: 1, basis: 'DOCUMENT', status };
}

const claims01: Claim[] = [
  claim('c01-auth', 'AUTHORITY', 'Jobcenter Musterstadt', 'Письмо от Jobcenter Musterstadt', 'Jobcenter Musterstadt'),
  claim('c01-num', 'CASE_NUMBER', 'JC-2026-1001', 'Номер дела JC-2026-1001', 'Aktenzeichen: JC-2026-1001'),
  claim('c01-date', 'LETTER_DATE', '2026-11-11', 'Письмо от 11.11.2026', 'Datum: 11.11.2026'),
  claim('c01-req', 'REQUIREMENT', 'Kontoauszüge September', 'Прислать выписки со счёта за сентябрь', 'Bitte reichen Sie die Kontoauszüge für September ein.'),
  claim('c01-dl', 'DEADLINE', '2026-11-30', 'Ответить до 30.11.2026', 'Bitte antworten Sie bis zum 30.11.2026.'),
];

const claims04: Claim[] = [
  claim('c04-auth', 'AUTHORITY', 'Bürgeramt Beispielhausen', 'Письмо от Bürgeramt Beispielhausen', 'Bürgeramt Beispielhausen'),
  claim('c04-num', 'CASE_NUMBER', 'BA-2026-2042', 'Номер дела BA-2026-2042', 'Aktenzeichen: BA-2026-2042'),
  claim('c04-req', 'REQUIREMENT', 'Mietvertrag', 'Показать договор аренды', 'Bitte legen Sie den Mietvertrag vor.'),
  claim('c04-dl', 'DEADLINE', '2026-12-02', 'Ответить до 02.12.2026', 'Bitte antworten Sie bis zum 02.12.2026.'),
];

const claims06: Claim[] = [
  claim('c06-auth', 'AUTHORITY', 'Finanzamt Beispielhausen', 'Письмо от Finanzamt Beispielhausen', 'Finanzamt Beispielhausen'),
  claim('c06-num', 'CASE_NUMBER', 'FA-2026-5010', 'Номер дела FA-2026-5010', 'Aktenzeichen: FA-2026-5010'),
  claim('c06-req1', 'REQUIREMENT', 'Einkommensnachweise', 'Прислать справки о доходах', 'Bitte reichen Sie die Einkommensnachweise ein.', 'UNCONFIRMED'),
  claim('c06-req2', 'REQUIREMENT', 'Anschrift bestätigen', 'Подтвердить адрес', 'Bitte bestätigen Sie Ihre Anschrift.', 'UNCONFIRMED'),
  claim('c06-dl1', 'DEADLINE', '2026-12-01', 'Ответить до 01.12.2026', 'Bitte antworten Sie bis zum 01.12.2026.', 'UNCONFIRMED'),
  claim('c06-dl2', 'DEADLINE', '2026-12-10', 'Ответить до 10.12.2026', 'Bitte antworten Sie bis zum 10.12.2026.', 'UNCONFIRMED'),
];

const deadline = (id: string, claimId: string, date: string, kind: Deadline['kind'] = 'REPLY'): Deadline => ({
  id,
  claimId,
  date,
  kind,
  doneAt: null,
});

const explanation01: Explanation = {
  about:
    'Без паники: это обычный запрос. Jobcenter просит прислать выписки с вашего банковского счёта за сентябрь, чтобы рассмотреть ваше заявление.',
  actions: [
    { text: 'Скачайте или распечатайте выписки со счёта за сентябрь', claimIds: ['c01-req'] },
    { text: 'Отправьте их в Jobcenter, укажите номер дела JC-2026-1001', claimIds: ['c01-num'] },
  ],
  deadline: { date: '2026-11-30', claimId: 'c01-dl' },
  unconfirmed: false,
};

const letter = (id: string, caseId: string | null, rawText: string, claims: Claim[], deadlines: Deadline[], explanation: Explanation | null): Letter => ({
  id,
  caseId,
  sourceType: 'PDF_TEXT',
  rawText,
  pages: [{ n: 1, readable: true, chars: rawText.length }],
  createdAt: '2026-11-12T09:30:00.000Z',
  claims,
  deadlines,
  explanation,
});

const letter01 = letter('l-01', 'case-jc', LETTER_01, claims01, [deadline('d-01', 'c01-dl', '2026-11-30', 'DOCUMENTS')], explanation01);
const letter04 = letter('l-04', 'case-ba', LETTER_04, claims04, [deadline('d-04', 'c04-dl', '2026-12-02', 'DOCUMENTS')], null);
const letter06 = letter('l-06', 'case-fa', LETTER_06, claims06, [], null);

export const DRAFT_01: Draft = {
  id: 'draft-01',
  kind: 'CLARIFICATION',
  germanText: `Alex Beispiel
Beispielallee 12, 00000 Beispielhausen

Jobcenter Musterstadt
Musterweg 10, 00000 Musterstadt

Aktenzeichen: JC-2026-1001

Sehr geehrte Damen und Herren,

in Ihrem Schreiben vom 11.11.2026 zum Aktenzeichen JC-2026-1001 bitten Sie um Kontoauszüge für September.
Ich habe dazu eine Frage: Reichen Kopien der Kontoauszüge aus, oder benötigen Sie die Originale?

Mit freundlichen Grüßen
Alex Beispiel`,
  russianText: `Alex Beispiel
Beispielallee 12, 00000 Beispielhausen

Jobcenter Musterstadt
Musterweg 10, 00000 Musterstadt

Номер дела: JC-2026-1001

Уважаемые дамы и господа,

в вашем письме от 11.11.2026 по делу JC-2026-1001 вы просите выписки со счёта за сентябрь.
У меня вопрос: достаточно ли копий выписок или нужны оригиналы?

С уважением,
Alex Beispiel`,
  claimIds: ['c01-auth', 'c01-num', 'c01-date', 'c01-req'],
  verification: {
    passed: true,
    checks: [
      { name: 'Даты и номера из подтверждённых фактов', passed: true, details: '11.11.2026, JC-2026-1001' },
      { name: 'Номер дела совпадает', passed: true, details: 'JC-2026-1001' },
      { name: 'Нет прошедших дат как будущего срока', passed: true, details: '' },
      { name: 'Нет незаполненных мест', passed: true, details: '' },
    ],
    checklist: [
      { claimId: 'c01-num', text: 'Номер дела JC-2026-1001', quote: 'Aktenzeichen: JC-2026-1001' },
      { claimId: 'c01-date', text: 'Письмо от 11.11.2026', quote: 'Datum: 11.11.2026' },
      { claimId: 'c01-req', text: 'Прислать выписки со счёта за сентябрь', quote: 'Bitte reichen Sie die Kontoauszüge für September ein.' },
    ],
  },
  status: 'PREPARED',
  sentAt: null,
  sentVia: null,
  stale: false,
  createdAt: '2026-11-14T10:00:00.000Z',
};

export const MOCK_CASES: CaseDetail[] = [
  {
    id: 'case-jc',
    title: 'Jobcenter: выписки со счёта',
    authority: 'Jobcenter Musterstadt',
    caseNumber: 'JC-2026-1001',
    origin: 'INCOMING',
    stage: 'DOCUMENTS',
    nextDeadline: '2026-11-30',
    counts: { letters: 1, unconfirmed: 0 },
    updatedAt: '2026-11-14T10:00:00.000Z',
    letters: [letter01],
    claims: claims01,
    deadlines: letter01.deadlines,
    drafts: [DRAFT_01],
    timeline: [
      { type: 'DRAFT_PREPARED', at: '2026-11-14T10:00:00.000Z', title: 'Черновик ответа готов', subtitle: 'Запрос уточнения', draftId: 'draft-01' },
      { type: 'CLAIM_CONFIRMED', at: '2026-11-12T09:35:00.000Z', title: 'Факты подтверждены', subtitle: '5 из 5' },
      { type: 'LETTER_RECEIVED', at: '2026-11-12T09:30:00.000Z', title: 'Письмо от 11.11.2026', subtitle: 'Запрос выписок со счёта', letterId: 'l-01' },
    ],
  },
  {
    id: 'case-ba',
    title: 'Bürgeramt: договор аренды',
    authority: 'Bürgeramt Beispielhausen',
    caseNumber: 'BA-2026-2042',
    origin: 'INCOMING',
    stage: 'WAITING',
    nextDeadline: null,
    counts: { letters: 1, unconfirmed: 0 },
    updatedAt: '2026-11-13T15:00:00.000Z',
    letters: [{ ...letter04, deadlines: [{ ...letter04.deadlines[0], doneAt: '2026-11-13T15:00:00.000Z' }] }],
    claims: claims04,
    deadlines: [{ ...letter04.deadlines[0], doneAt: '2026-11-13T15:00:00.000Z' }],
    drafts: [],
    timeline: [
      { type: 'USER_REPORTED_SENT', at: '2026-11-13T15:00:00.000Z', title: 'Вы отметили: отправлено', subtitle: 'Почтой' },
      { type: 'LETTER_RECEIVED', at: '2026-11-12T11:00:00.000Z', title: 'Письмо от 11.11.2026', subtitle: 'Договор аренды', letterId: 'l-04' },
    ],
  },
  {
    id: 'case-fa',
    title: 'Finanzamt: справки о доходах',
    authority: 'Finanzamt Beispielhausen',
    caseNumber: 'FA-2026-5010',
    origin: 'INCOMING',
    stage: 'NEEDS_CHECK',
    nextDeadline: null,
    counts: { letters: 1, unconfirmed: 4 },
    updatedAt: '2026-11-15T08:00:00.000Z',
    letters: [letter06],
    claims: claims06,
    deadlines: [],
    drafts: [],
    timeline: [{ type: 'LETTER_RECEIVED', at: '2026-11-15T08:00:00.000Z', title: 'Письмо от 11.11.2026', subtitle: 'Два срока, нужна проверка', letterId: 'l-06' }],
  },
];

export const MOCK_CABINET: Cabinet = {
  email: 'alex@example.org',
  language: 'ru',
  profile: { firstName: 'Alex', lastName: 'Beispiel', address: 'Beispielallee 12, 00000 Beispielhausen', numbers: [] },
  counts: { openTasks: 2, activeCases: 3, inboxLetters: 0 },
  nextDeadline: { date: '2026-11-30', caseId: 'case-jc', title: 'Прислать выписки со счёта' },
};

/** Результат разбора нового письма в демо-режиме: письмо 01 с неподтверждёнными фактами. */
export function mockUploadLetter(): Letter {
  return {
    ...letter01,
    id: `l-new-${Date.now()}`,
    caseId: null,
    explanation: null,
    claims: claims01.map((c) => ({ ...c, status: 'UNCONFIRMED' })),
  };
}
