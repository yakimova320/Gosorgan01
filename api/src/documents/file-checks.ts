import { ApiError } from '../common/api-error.js';

/*
 * Проверка файла по содержимому (ТЗ v4 раздел 9). Сигнатура даёт только предполагаемый тип;
 * исправность изображения проверяется по структуре файла, PDF: при чтении (pdf-text.ts).
 */

export type FileKind = 'pdf' | 'jpeg' | 'png';

export const MIME: Record<FileKind, string> = {
  pdf: 'application/pdf',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

/** Предел размера фото в пикселях: больше модели не нужно, а память и время растут. */
export const MAX_IMAGE_SIDE = 10_000;
export const MAX_IMAGE_PIXELS = 40_000_000;

export function detectKind(buf: Buffer): FileKind | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-')
    return 'pdf';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return 'jpeg';
  if (
    buf.length >= 8 &&
    buf
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'png';
  return null;
}

/** Размер изображения из заголовка. Повреждённый или обрезанный файл: FILE_DAMAGED. */
export function imageSize(
  buf: Buffer,
  kind: 'jpeg' | 'png',
): { width: number; height: number } {
  const size = kind === 'png' ? pngSize(buf) : jpegSize(buf);
  if (!size || size.width <= 0 || size.height <= 0)
    throw new ApiError('FILE_DAMAGED', { reason: 'image-structure' });
  if (
    size.width > MAX_IMAGE_SIDE ||
    size.height > MAX_IMAGE_SIDE ||
    size.width * size.height > MAX_IMAGE_PIXELS
  ) {
    throw new ApiError(
      'FILE_TOO_LARGE',
      { reason: 'image-dimensions', ...size },
      'Фото слишком большое по числу пикселей. Сделайте снимок обычной камерой телефона',
    );
  }
  return size;
}

function pngSize(buf: Buffer): { width: number; height: number } | null {
  // IHDR сразу после сигнатуры, конец файла: чанк IEND.
  if (buf.length < 45) return null;
  if (buf.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  if (
    buf.subarray(buf.length - 8, buf.length - 4).toString('latin1') !== 'IEND'
  )
    return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpegSize(buf: Buffer): { width: number; height: number } | null {
  // Конец файла: маркер EOI (FFD9); размер: первый маркер SOF0..SOF15 (кроме DHT, JPG, DAC).
  const end =
    buf.length >= 2 &&
    buf[buf.length - 2] === 0xff &&
    buf[buf.length - 1] === 0xd9;
  if (!end) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (
      marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7) ||
      marker === 0x01
    ) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof)
      return {
        height: buf.readUInt16BE(i + 5),
        width: buf.readUInt16BE(i + 7),
      };
    i += 2 + len;
  }
  return null;
}
