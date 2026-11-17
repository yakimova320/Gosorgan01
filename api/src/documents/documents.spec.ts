import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { demoTranscribe } from '../llm/adapters/demo.adapter.js';
import { detectKind, imageSize } from './file-checks.js';
import { readPdfText, withTimeout } from './pdf-text.js';
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

  it('скан: SCAN_PDF_NOT_SUPPORTED с номером страницы и советом про фото', async () => {
    await expect(readPdfText(fixture('09_scan.pdf'))).rejects.toMatchObject({
      code: 'SCAN_PDF_NOT_SUPPORTED',
    });
    try {
      await readPdfText(fixture('09_scan.pdf'));
    } catch (e) {
      const body = (
        e as { getResponse(): { message: string; details: unknown } }
      ).getResponse();
      expect(body.details).toEqual({ pages: [1], totalPages: 1 });
      expect(body.message).toContain('Сфотографируйте');
    }
  });

  it('смешанный PDF: письмо не сохраняется частично, страница скана названа', async () => {
    const pdf = await mixedPdf(fixture('09_scan.png'));
    await expect(readPdfText(pdf)).rejects.toMatchObject({
      code: 'SCAN_PDF_NOT_SUPPORTED',
    });
    try {
      await readPdfText(pdf);
    } catch (e) {
      const body = (
        e as { getResponse(): { message: string; details: unknown } }
      ).getResponse();
      expect(body.details).toEqual({ pages: [2], totalPages: 2 });
      expect(body.message).toContain('Страницы 2');
    }
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
