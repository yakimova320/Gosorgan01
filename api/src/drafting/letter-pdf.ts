import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { ApiError } from '../common/api-error.js';

/*
 * B15: PDF письма для печати (ТЗ v2 раздел 8, ТЗ v3 раздел 8: GET /drafts/:id/pdf).
 * Только немецкий текст проверенного черновика, A4, поля по DIN 5008 (слева 25 мм, справа 20 мм),
 * строка «Betreff» жирным, место для подписи после «Mit freundlichen Grüßen».
 * Шрифт Helvetica (стандартный, кодировка WinAnsi): немецкие буквы, «„“», €. Знаки вне этой
 * кодировки (например, кириллица в адресе) не подменяются молча: 422 PDF_UNSUPPORTED_CHARS.
 * В метаданные не пишутся имя и другие личные данные.
 */

const MM = 72 / 25.4;
const A4 = { width: 210 * MM, height: 297 * MM };
const MARGIN = { left: 25 * MM, right: 20 * MM, top: 20 * MM, bottom: 20 * MM };
const SIZE = 11;
const LEADING = 15;
const GREETING = 'Mit freundlichen Grüßen';
/** Место для подписи: столько точек по высоте между приветствием и именем. */
const SIGNATURE_SPACE = 16 * MM;

export interface LetterPdfInput {
  germanText: string;
}

/** Символы, которых нет в WinAnsi: их нельзя напечатать стандартным шрифтом. */
export function unsupportedChars(font: PDFFont, text: string): string[] {
  const bad = new Set<string>();
  for (const ch of text) {
    if (ch === '\n') continue;
    try {
      font.encodeText(ch);
    } catch {
      bad.add(ch);
    }
  }
  return [...bad];
}

/** Перенос по словам в пределах ширины; слишком длинное слово режется по буквам. */
export function wrap(font: PDFFont, line: string, size: number, maxWidth: number): string[] {
  if (line === '') return [''];
  const out: string[] = [];
  let current = '';
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= maxWidth;
  for (const word of line.split(' ')) {
    const candidate = current ? `${current} ${word}` : word;
    if (fits(candidate)) {
      current = candidate;
      continue;
    }
    if (current) out.push(current);
    if (fits(word)) {
      current = word;
      continue;
    }
    let piece = '';
    for (const ch of word) {
      if (!fits(piece + ch)) {
        out.push(piece);
        piece = '';
      }
      piece += ch;
    }
    current = piece;
  }
  out.push(current);
  return out;
}

export async function buildLetterPdf(input: LetterPdfInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle('Brief');
  doc.setProducer('Ja!sno');
  doc.setCreator('Ja!sno');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const text = input.germanText.replace(/\r\n?/g, '\n').replace(/\t/g, ' ');
  const bad = unsupportedChars(regular, text);
  if (bad.length > 0)
    throw new ApiError(
      'PDF_UNSUPPORTED_CHARS',
      { chars: bad.slice(0, 20) },
      `В тексте есть знаки, которые нельзя напечатать в PDF: ${bad.slice(0, 10).join(' ')}. Напишите их латиницей (например, адрес в профиле) или скопируйте текст`,
    );

  const width = A4.width - MARGIN.left - MARGIN.right;
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const newPage = () => {
    page = doc.addPage([A4.width, A4.height]);
    pages.push(page);
    y = A4.height - MARGIN.top;
  };
  const ensure = (height: number) => {
    if (y - height < MARGIN.bottom + LEADING) newPage();
  };
  const draw = (line: string, font: PDFFont) => {
    for (const part of wrap(font, line, SIZE, width)) {
      ensure(LEADING);
      y -= LEADING;
      if (part) page.drawText(part, { x: MARGIN.left, y, size: SIZE, font, color: rgb(0, 0, 0) });
    }
  };
  const signature = () => {
    ensure(SIGNATURE_SPACE + LEADING * 2);
    y -= SIGNATURE_SPACE;
    page.drawLine({
      start: { x: MARGIN.left, y },
      end: { x: MARGIN.left + 70 * MM, y },
      thickness: 0.5,
      color: rgb(0.4, 0.4, 0.4),
    });
    page.drawText('Unterschrift', {
      x: MARGIN.left,
      y: y - 9,
      size: 8,
      font: regular,
      color: rgb(0.4, 0.4, 0.4),
    });
    y -= 12; // имя печатается под подписью с отступом от «Unterschrift»
  };

  newPage();
  const lines = text.split('\n');
  // Пустые строки в конце не печатаем
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  let signed = false;
  for (const line of lines) {
    draw(line, /^Betreff:/.test(line) ? bold : regular);
    if (!signed && line.trim() === GREETING) {
      signature();
      signed = true;
    }
  }
  if (!signed) signature(); // текст изменён без приветствия: место для подписи всё равно есть

  if (pages.length > 1)
    pages.forEach((p, i) => {
      const label = `Seite ${i + 1} von ${pages.length}`;
      p.drawText(label, {
        x: A4.width - MARGIN.right - regular.widthOfTextAtSize(label, 9),
        y: MARGIN.bottom / 2,
        size: 9,
        font: regular,
        color: rgb(0.4, 0.4, 0.4),
      });
    });

  return Buffer.from(await doc.save());
}
