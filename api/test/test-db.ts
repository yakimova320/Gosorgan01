import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const API_DIR = resolve(import.meta.dirname, '..');

/**
 * Временная база SQLite для тестов: пустой файл + все миграции из prisma/migrations.
 * Возвращает адрес базы и функцию, которая удаляет файл.
 */
export function createTestDatabase(): { url: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'jasno-db-'));
  const url = `file:${join(dir, 'test.db')}`;
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  return { url, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
