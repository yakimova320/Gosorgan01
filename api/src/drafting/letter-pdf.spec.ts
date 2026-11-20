import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readPdfText } from '../documents/pdf-text.js';
import { buildLetterPdf, wrap } from './letter-pdf.js';

const letter = [
  'Anna Muster',
  'Musterstr. 12, 10115 Berlin',
  'Kundennummer: 123A456',
  '',
  'Jobcenter Musterstadt',
  '',
  'Datum: 17.11.2026',
  'Ihr Zeichen: JC-2026-1001',
  '',
  'Betreff: Bitte um Erläuterung zu Ihrem Schreiben vom 11.11.2026',
  '',
  'Sehr geehrte Damen und Herren,',
  '',
  'In Ihrem Schreiben vom 11.11.2026 schreiben Sie: „Bitte reichen Sie die Kontoauszüge für September ein.“',
  'Bitte erläutern Sie mir, wie sich der Betrag von 1.234,50 € zusammensetzt.',
  '',
  'Mit freundlichen Grüßen',
  'Anna Muster',
].join('\n');

describe('B15: PDF письма для печати', () => {
  it('A4, одна страница, весь немецкий текст с умлаутами, кавычками и €; место для подписи; без личных метаданных', async () => {
    const pdf = await buildLetterPdf({ germanText: letter });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
    expect(doc.getAuthor()).toBeUndefined();
    expect(doc.getTitle()).toBe('Brief');

    const [page] = await readPdfText(pdf);
    for (const s of ['Anna Muster', 'Ihr Zeichen: JC-2026-1001', 'Kontoauszüge', '1.234,50 €', 'Mit freundlichen Grüßen', 'Unterschrift'])
      expect(page.text).toContain(s);
    // подпись между приветствием и именем
    expect(page.text.indexOf('Unterschrift')).toBeGreaterThan(page.text.indexOf('Mit freundlichen Grüßen'));
    expect(page.text.lastIndexOf('Anna Muster')).toBeGreaterThan(page.text.indexOf('Unterschrift'));
  });

  it('кириллица в адресе: 422 PDF_UNSUPPORTED_CHARS со списком знаков, без подмены', async () => {
    await expect(
      buildLetterPdf({ germanText: letter.replace('Musterstr. 12', 'ул. Мира 12') }),
    ).rejects.toMatchObject({ code: 'PDF_UNSUPPORTED_CHARS' });
    try {
      await buildLetterPdf({ germanText: 'Anna\nул. Мира' });
    } catch (e) {
      const body = (e as { getResponse(): { details: { chars: string[] } } }).getResponse();
      expect(body.details.chars).toEqual(['у', 'л', 'М', 'и', 'р', 'а']);
    }
  });

  it('длинный текст: несколько страниц с номерами, строки переносятся по словам', async () => {
    const long = letter.replace(
      'Mit freundlichen Grüßen',
      Array.from({ length: 80 }, (_, i) => `Absatz ${i + 1}: Bitte teilen Sie mir mit, welche Unterlagen genau Sie von mir benötigen.`).join('\n') +
        '\nMit freundlichen Grüßen',
    );
    const pdf = await buildLetterPdf({ germanText: long });
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    const pages = await readPdfText(pdf);
    expect(pages[0].text).toContain(`Seite 1 von ${pages.length}`);

    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    const parts = wrap(font, 'Wort '.repeat(60).trim(), 11, 200);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(font.widthOfTextAtSize(p, 11)).toBeLessThanOrEqual(200);
    expect(wrap(font, 'x'.repeat(300), 11, 100).join('')).toBe('x'.repeat(300));
  });
});
