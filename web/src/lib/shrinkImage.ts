/*
 * Поправка 9 (23.11): фото с телефона весят 3–8 МБ, на мобильной связи загрузка висит на шаге «Ja!sno читает».
 * Большое фото уменьшается в браузере до 2000 px по длинной стороне (JPEG, качество 0,85) — этого хватает,
 * чтобы прочитать текст. Маленькие файлы и PDF уходят как есть. Любая ошибка: отправляется оригинал.
 */

/** Файлы меньше этого размера не трогаем. */
export const SHRINK_FROM_BYTES = 1_500_000;
export const MAX_SIDE_PX = 2000;
const QUALITY = 0.85;

export async function shrinkImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png)$/.test(file.type) || file.size < SHRINK_FROM_BYTES) return file;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE_PX / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#FFFFFF'; // прозрачный PNG → белый фон, как бумага
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.(png|jpe?g)$/i, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  }
}

export function shrinkAll(files: File[]): Promise<File[]> {
  return Promise.all(files.map(shrinkImage));
}
