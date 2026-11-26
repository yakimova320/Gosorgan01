import { bestChunks } from './archive.service.js';
import { checkSummary } from './summary-check.js';

describe('E01: обезличенное резюме и куски для ответа', () => {
  const profile = { firstName: 'Anna', lastName: 'Muster', address: 'Musterstr. 1, 10115 Berlin' };
  const ok = { de: 'Schreiben vom Jobcenter. Bitte Kontoauszüge einreichen.', local: 'Jobcenter: выписки со счёта' };

  it('пропускает резюме без личных данных; город и похожие слова не мешают', () => {
    expect(checkSummary(ok, profile)).toEqual(ok);
    expect(
      checkSummary({ ...ok, de: 'Jobcenter Musterstadt in Berlin bittet um Unterlagen.' }, profile),
    ).not.toBeNull();
  });

  it('отклоняет имя, улицу, IBAN, длинные числа и метки', () => {
    expect(checkSummary({ ...ok, de: 'Frau Anna soll Unterlagen senden.' }, profile)).toBeNull();
    expect(checkSummary({ ...ok, local: 'Письмо для Muster' }, profile)).toBeNull();
    expect(checkSummary({ ...ok, de: 'Brief an Musterstr wegen Miete.' }, profile)).toBeNull();
    expect(checkSummary({ ...ok, de: 'Zahlung auf DE89 3704 0044 0532 0130 00.' }, profile)).toBeNull();
    expect(checkSummary({ ...ok, de: 'Aktenzeichen 123456.' }, profile)).toBeNull();
    expect(checkSummary({ ...ok, de: 'Konto [IBAN_1] prüfen.' }, profile)).toBeNull();
    expect(checkSummary(null, profile)).toBeNull();
  });

  it('куски письма для ответа: с общими словами, в порядке письма', () => {
    const text = ['Jobcenter Musterstadt', '', 'Bitte reichen Sie die Kontoauszüge ein.', '', 'Mit freundlichen Grüßen'].join(
      '\n',
    );
    const parts = bestChunks(text, 'Welche Kontoauszüge?', 1);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain('Kontoauszüge');
  });
});
