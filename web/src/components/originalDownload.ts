/*
 * E02 (#165): оригинал письма для скачивания. Собирается в браузере из уже расшифрованных файлов.
 * - Один PDF: те же байты, что загрузил человек (подписи и печати ведомства остаются как есть).
 * - Фото страниц: один PDF, по странице на фото. JPEG и PNG встраиваются без пересжатия.
 */

export type OriginalFile = { mime: string; bytes: Uint8Array };

export async function originalPdf(files: OriginalFile[]): Promise<Uint8Array> {
  if (files.length === 1 && files[0]!.mime === 'application/pdf') return files[0]!.bytes;
  // pdf-lib только по нажатию «Скачать»: основной бандл не растёт
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  for (const f of files) {
    const image = f.mime === 'image/png' ? await doc.embedPng(f.bytes) : await doc.embedJpg(f.bytes);
    const page = doc.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }
  return doc.save();
}

/** Имя файла: Jasno_<дата загрузки>_<название письма>.pdf, только безопасные знаки. */
export function originalFileName(title: string | null | undefined, createdAt: string | null | undefined): string {
  const date = createdAt ? createdAt.slice(0, 10) : '';
  const name = (title ?? '')
    .normalize('NFC')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/\s/g, '_');
  return ['Jasno', date, name || 'original'].filter(Boolean).join('_') + '.pdf';
}

export function saveFile(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
