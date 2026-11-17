/*
 * Выбранные файлы письма для загрузки. Файлы (File) не попадают в Redux:
 * мутация получает только ключ, сами файлы лежат здесь до отправки.
 */

const pending = new Map<string, File[]>();
let counter = 0;

export function putUploadFiles(files: File[]): string {
  const key = `upload-${++counter}`;
  pending.set(key, files);
  return key;
}

export function takeUploadFiles(key: string): File[] {
  const files = pending.get(key) ?? [];
  pending.delete(key);
  return files;
}

export function clearUploadFiles(): void {
  pending.clear();
}
