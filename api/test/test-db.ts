import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import pg from 'pg';

const API_DIR = resolve(import.meta.dirname, '..');

/** База PostgreSQL для тестов: TEST_DATABASE_URL, иначе DATABASE_URL, иначе локальный docker-compose. */
const BASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://jasno:jasno@localhost:5432/jasno';

/**
 * Отдельная схема PostgreSQL на каждый тестовый файл: test_<случайный id> + все миграции.
 * Параллельные прогоны не мешают друг другу. cleanup удаляет схему целиком.
 */
export function createTestDatabase(): {
  url: string;
  cleanup: () => Promise<void>;
} {
  const schema = `test_${randomBytes(6).toString('hex')}`;
  const base = new URL(BASE_URL);
  base.searchParams.delete('schema');
  const url = new URL(base);
  url.searchParams.set('schema', schema);

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: 'pipe',
  });

  return {
    url: url.toString(),
    cleanup: async () => {
      const client = new pg.Client({ connectionString: base.toString() });
      await client.connect();
      try {
        await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await client.end();
      }
    },
  };
}
