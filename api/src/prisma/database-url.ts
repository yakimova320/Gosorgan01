import { isAbsolute, resolve } from 'node:path';

/**
 * Относительный путь SQLite (`file:./dev.db`) считается от папки api,
 * чтобы сервер, тесты и Prisma CLI работали с одним файлом, откуда бы их ни запустили.
 * Адреса других баз (postgresql://...) возвращаются без изменений.
 */
export function resolveSqliteUrl(url: string, apiDir: string): string {
  if (!url.startsWith('file:')) return url;
  const path = url.slice('file:'.length);
  if (path === ':memory:' || isAbsolute(path)) return url;
  return `file:${resolve(apiDir, path)}`;
}
