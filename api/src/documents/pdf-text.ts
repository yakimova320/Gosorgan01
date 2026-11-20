import { PDFParse } from 'pdf-parse';
import { ApiError } from '../common/api-error.js';

/*
 * Текст PDF постранично (ТЗ v2 раздел 4: pdf-parse для текстового слоя).
 * Порядок: число страниц → предел страниц → текст. Страница без текстового слоя (скан)
 * не пропускается молча: она помечается scan и распознаётся как изображение (B11, renderPdfPages).
 */

export const MAX_PDF_PAGES = 20;
export const PDF_TIMEOUT_MS = 20_000;
export const MAX_LETTER_CHARS = 100_000;
/** Меньше стольких букв и цифр на странице: страница считается сканом без текста. */
export const MIN_PAGE_CHARS = 20;

export interface PdfPage {
  n: number;
  text: string;
  /** B11: на странице нет текстового слоя (меньше MIN_PAGE_CHARS букв и цифр) */
  scan: boolean;
}

/** Ширина картинки страницы для распознавания: текст письма читается, файл умеренный (~300 КБ). */
export const RENDER_WIDTH_PX = 1600;

export async function readPdfText(
  data: Buffer,
  options: { timeoutMs?: number } = {},
): Promise<PdfPage[]> {
  const parser = new PDFParse({
    data: new Uint8Array(data),
    stopAtErrors: true,
  });
  try {
    return await withTimeout(read(parser), options.timeoutMs ?? PDF_TIMEOUT_MS);
  } catch (e) {
    throw toApiError(e);
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function read(parser: PDFParse): Promise<PdfPage[]> {
  const { total } = await parser.getInfo();
  if (total < 1) throw new ApiError('FILE_DAMAGED', { reason: 'no-pages' });
  if (total > MAX_PDF_PAGES) {
    throw new ApiError(
      'LETTER_TOO_LARGE',
      { pages: total, maxPages: MAX_PDF_PAGES },
      `В PDF ${total} страниц. Можно не больше ${MAX_PDF_PAGES}`,
    );
  }
  const result = await parser.getText();
  const pages = result.pages.map((p) => {
    const text = p.text.trim();
    return {
      n: p.num,
      text,
      scan: text.replace(/[^\p{L}\p{N}]/gu, '').length < MIN_PAGE_CHARS,
    };
  });
  const chars = pages.reduce((sum, p) => sum + p.text.length, 0);
  if (chars > MAX_LETTER_CHARS) {
    throw new ApiError(
      'LETTER_TOO_LARGE',
      { chars, maxChars: MAX_LETTER_CHARS },
      'В PDF слишком много текста для одного письма',
    );
  }
  return pages;
}

/**
 * B11: страницы PDF-скана как PNG для transcribe. Только указанные страницы, по порядку.
 * Рендер pdf.js (зависимость pdf-parse), тот же предел времени, что и у чтения текста.
 */
export async function renderPdfPages(
  data: Buffer,
  pages: number[],
  options: { timeoutMs?: number } = {},
): Promise<{ n: number; data: Buffer }[]> {
  const parser = new PDFParse({
    data: new Uint8Array(data),
    stopAtErrors: true,
  });
  try {
    const shot = await withTimeout(
      parser.getScreenshot({
        partial: pages,
        desiredWidth: RENDER_WIDTH_PX,
        imageBuffer: true,
        imageDataUrl: false,
      }),
      options.timeoutMs ?? PDF_TIMEOUT_MS,
    );
    return shot.pages.map((p) => ({
      n: p.pageNumber,
      data: Buffer.from(p.data),
    }));
  } catch (e) {
    throw toApiError(e);
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new ApiError(
            'FILE_DAMAGED',
            { reason: 'timeout' },
            'Файл обрабатывается слишком долго. Попробуйте другой файл',
          ),
        ),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  const name = (e as { name?: string }).name ?? '';
  if (name === 'PasswordException') return new ApiError('PDF_ENCRYPTED');
  return new ApiError('FILE_DAMAGED', { reason: 'pdf-structure' });
}
