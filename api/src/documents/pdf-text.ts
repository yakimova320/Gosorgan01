import { PDFParse } from 'pdf-parse';
import { ApiError } from '../common/api-error.js';

/*
 * Текст PDF постранично (ТЗ v2 раздел 4: pdf-parse для текстового слоя).
 * Порядок: число страниц → предел страниц → текст. Страница без текстового слоя (скан)
 * не пропускается молча: письмо целиком отклоняется с номерами страниц (Q3).
 */

export const MAX_PDF_PAGES = 20;
export const PDF_TIMEOUT_MS = 20_000;
export const MAX_LETTER_CHARS = 100_000;
/** Меньше стольких букв и цифр на странице: страница считается сканом без текста. */
export const MIN_PAGE_CHARS = 20;

export interface PdfPage {
  n: number;
  text: string;
}

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
  const pages = result.pages.map((p) => ({ n: p.num, text: p.text.trim() }));
  const chars = pages.reduce((sum, p) => sum + p.text.length, 0);
  if (chars > MAX_LETTER_CHARS) {
    throw new ApiError(
      'LETTER_TOO_LARGE',
      { chars, maxChars: MAX_LETTER_CHARS },
      'В PDF слишком много текста для одного письма',
    );
  }
  const scans = pages
    .filter(
      (p) => p.text.replace(/[^\p{L}\p{N}]/gu, '').length < MIN_PAGE_CHARS,
    )
    .map((p) => p.n);
  if (scans.length > 0) {
    const all = scans.length === pages.length;
    throw new ApiError(
      'SCAN_PDF_NOT_SUPPORTED',
      { pages: scans, totalPages: pages.length },
      scanAdvice(scans, pages.length, all),
    );
  }
  return pages;
}

/** Совет с учётом текущего предела: одно фото на письмо (несколько фото: B11). */
export function scanAdvice(
  scans: number[],
  total: number,
  all: boolean,
): string {
  if (all && total === 1)
    return 'В этом PDF нет текста, это скан. Сфотографируйте письмо и загрузите фото';
  if (all)
    return `В этом PDF нет текста, это скан (${total} стр.). Пока можно загрузить одно фото на письмо: если письмо на одной странице, сфотографируйте её. Письма из нескольких фото появятся позже`;
  return `Страницы ${scans.join(', ')} без текста (скан). Ja!sno не сохраняет письмо частично. Загрузите PDF, где весь текст можно выделить, или фото, если письмо на одной странице`;
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
