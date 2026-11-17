import { PDFDocument, StandardFonts } from 'pdf-lib';

/* Синтетические PDF для тестов: создаются в памяти, в репозиторий не кладутся. */

const LINE =
  'Bitte reichen Sie die Unterlagen bis zum 30.11.2026 ein. Aktenzeichen JC-2026-0001.';

export async function textPdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Seite ${i}. ${LINE}`, { x: 40, y: 780, size: 10, font });
  }
  return Buffer.from(await doc.save());
}

/** Стр. 1 с текстом, стр. 2 только картинка (скан). */
export async function mixedPdf(png: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([595, 842]).drawText(LINE, { x: 40, y: 780, size: 10, font });
  const image = await doc.embedPng(png);
  doc
    .addPage([595, 842])
    .drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
  return Buffer.from(await doc.save());
}

/** Минимальный PDF со словарём /Encrypt: без пароля не открывается (PasswordException). */
export function encryptedPdf(): Buffer {
  const hex32 = 'ab'.repeat(32);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
    `<< /Filter /Standard /V 1 /R 2 /O <${hex32}> /U <${hex32}> /P -44 >>`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  const id = '0123456789abcdef0123456789abcdef';
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 4 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
