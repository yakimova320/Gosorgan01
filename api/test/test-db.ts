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
  const schema = `test_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const base = new URL(BASE_URL);
  base.searchParams.delete('schema');
  const url = new URL(base);
  url.searchParams.set('schema', schema);

  sweepStaleSchemas(base.toString(), 'test_');
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

/**
 * Удаляет схемы prefix<время>_..., которые старше часа: остатки прогонов, упавших до cleanup.
 * Свежие схемы не трогает, чтобы не мешать параллельному прогону. Работает в фоне.
 */
export function sweepStaleSchemas(baseUrl: string, prefix: string): void {
  void (async () => {
    const client = new pg.Client({ connectionString: baseUrl });
    try {
      await client.connect();
      const { rows } = await client.query<{ name: string }>(
        `SELECT schema_name AS name FROM information_schema.schemata WHERE schema_name LIKE $1`,
        [`${prefix}%`],
      );
      const hourAgo = Date.now() - 60 * 60 * 1000;
      for (const { name } of rows) {
        const started = Number(name.slice(prefix.length).split('_')[0]);
        if (Number.isFinite(started) && started < hourAgo) {
          await client.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
        }
      }
    } catch {
      // Уборка не обязательна: тесты работают и без неё.
    } finally {
      await client.end().catch(() => undefined);
    }
  })();
}
