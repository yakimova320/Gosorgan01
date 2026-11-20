import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  demoTranscribe,
  demoTranscribePages,
  loadScanPages,
} from '../llm/adapters/demo.adapter.js';
import { renderPdfPages as render } from './pdf-text.js';
import { detectKind, imageSize } from './file-checks.js';
import {
  RENDER_WIDTH_PX,
  readPdfText,
  renderPdfPages,
  withTimeout,
} from './pdf-text.js';
import { encryptedPdf, mixedPdf, textPdf } from '../../test/pdf-fixtures.js';

const fixture = (name: string) =>
  readFileSync(
    resolve(import.meta.dirname, '..', '..', '..', 'fixtures', 'letters', name),
  );

describe('тип файла по содержимому', () => {
  it('PDF, JPEG, PNG по сигнатуре; текст под видом PDF: null', () => {
    expect(detectKind(fixture('01_jobcenter_request.pdf'))).toBe('pdf');
    expect(detectKind(fixture('08_photo.jpg'))).toBe('jpeg');
    expect(detectKind(fixture('10_medium_scan.png'))).toBe('png');
    expect(detectKind(fixture('01_jobcenter_request.txt'))).toBeNull();
  });

  it('размер фото из заголовка, обрезанное фото: FILE_DAMAGED', () => {
    const jpg = fixture('08_photo.jpg');
    expect(imageSize(jpg, 'jpeg').width).toBeGreaterThan(0);
    expect(
      imageSize(fixture('10_medium_scan.png'), 'png').height,
    ).toBeGreaterThan(0);
    expect(() => imageSize(jpg.subarray(0, jpg.length / 2), 'jpeg')).toThrow(
      expect.objectContaining({ code: 'FILE_DAMAGED' }),
    );
  });

  it('фото больше 10 000 пикселей по стороне: FILE_TOO_LARGE', () => {
    const png = Buffer.from(fixture('10_medium_scan.png'));
    png.writeUInt32BE(20_000, 16);
    expect(() => imageSize(png, 'png')).toThrow(
      expect.objectContaining({ code: 'FILE_TOO_LARGE' }),
    );
  });
});

describe('текст PDF', () => {
  it('текст по страницам', async () => {
    const pages = await readPdfText(fixture('01_jobcenter_request.pdf'));
    expect(pages).toHaveLength(1);
    expect(pages[0].text).toContain('Jobcenter');
  });

  it('скан (B11): страница без текста помечена scan, PDF не отклоняется', async () => {
    const pages = await readPdfText(fixture('09_scan.pdf'));
    expect(pages).toEqual([{ n: 1, text: expect.any(String), scan: true }]);
  });

  it('смешанный PDF: текстовая страница с текстом, страница скана помечена', async () => {
    const pages = await readPdfText(await mixedPdf(fixture('09_scan.png')));
    expect(pages.map((p) => [p.n, p.scan])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(pages[0].text.length).toBeGreaterThan(20);
  });

  it('рендер страниц скана в PNG: только выбранные страницы, одинаковый результат', async () => {
    const pdf = await mixedPdf(fixture('09_scan.png'));
    const a = await renderPdfPages(pdf, [2]);
    expect(a.map((p) => p.n)).toEqual([2]);
    expect(detectKind(a[0].data)).toBe('png');
    expect(imageSize(a[0].data, 'png').width).toBe(RENDER_WIDTH_PX);
    const b = await renderPdfPages(pdf, [2]);
    expect(b[0].data.equals(a[0].data)).toBe(true);
  });

  it('21 страница: LETTER_TOO_LARGE до чтения текста', async () => {
    await expect(readPdfText(await textPdf(21))).rejects.toMatchObject({
      code: 'LETTER_TOO_LARGE',
    });
  });

  it('повреждённый PDF и PDF с паролем: понятные коды', async () => {
    await expect(
      readPdfText(Buffer.from('%PDF-1.4\n garbage')),
    ).rejects.toMatchObject({
      code: 'FILE_DAMAGED',
    });
    await expect(readPdfText(encryptedPdf())).rejects.toMatchObject({
      code: 'PDF_ENCRYPTED',
    });
  });

  it('чтение дольше предела: FILE_DAMAGED по тайм-ауту', async () => {
    await expect(
      withTimeout(new Promise(() => undefined), 5),
    ).rejects.toMatchObject({
      code: 'FILE_DAMAGED',
    });
  });
});

describe('transcribe в режиме demo', () => {
  it('фото из fixtures читается, плохое не читается, неизвестное честно не читается', () => {
    expect(demoTranscribe([fixture('08_photo.jpg')])).toMatchObject({
      readable: true,
    });
    expect(demoTranscribe([fixture('08_photo.jpg')]).text).toContain(
      'Aktenzeichen',
    );
    expect(demoTranscribe([fixture('11_bad_photo.jpg')])).toEqual({
      text: '',
      readable: false,
      reason: 'BLURRY',
    });
    expect(demoTranscribe([Buffer.from('другое фото')])).toEqual({
      text: '',
      readable: false,
      reason: 'DEMO_UNKNOWN',
    });
  });
});

describe('transcribe.v2 в режиме demo (B11)', () => {
  it('по элементу на каждую страницу, по порядку; страница скана из fixtures узнаётся после рендера', async () => {
    await loadScanPages();
    const [scan] = await render(fixture('09_scan.pdf'), [1]);
    const r = demoTranscribePages([
      fixture('08_photo.jpg'),
      scan.data,
      fixture('11_bad_photo.jpg'),
    ]);
    expect(r.pages.map((p) => [p.readable, p.reason])).toEqual([
      [true, null],
      [true, null],
      [false, 'BLURRY'],
    ]);
    expect(r.pages[1].text).toContain('SA-2026-8810');
  });
});
