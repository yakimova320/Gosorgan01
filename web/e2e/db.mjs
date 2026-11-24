// Схема PostgreSQL для браузерных тестов: e2e_<время>_<id>, отдельно от схем API-тестов (test_...).
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import pg from 'pg';

export const API_DIR = resolve(import.meta.dirname, '..', '..', 'api');

export function baseDatabaseUrl() {
  const url = new URL(
    process.env.TEST_DATABASE_URL ??
      process.env.DATABASE_URL ??
      'postgresql://jasno:jasno@localhost:5432/jasno',
  );
  url.searchParams.delete('schema');
  return url.toString();
}

export function schemaUrl(schema) {
  const url = new URL(baseDatabaseUrl());
  url.searchParams.set('schema', schema);
  return url.toString();
}

export function migrate(schema) {
  // Prisma CLI через node, а не `pnpm exec`: на Windows Node без оболочки не находит pnpm (ENOENT)
  execFileSync(process.execPath, [resolve(API_DIR, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'], {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL: schemaUrl(schema) },
    stdio: 'pipe',
  });
}

/** Удаляет схему; olderThanMs: удалить все e2e_-схемы старше этого возраста (остатки упавших прогонов). */
export async function dropSchemas({ schema, olderThanMs }) {
  const client = new pg.Client({ connectionString: baseDatabaseUrl() });
  await client.connect();
  try {
    if (schema) await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    if (olderThanMs) {
      const { rows } = await client.query(
        `SELECT schema_name AS name FROM information_schema.schemata WHERE schema_name LIKE 'e2e\\_%'`,
      );
      for (const { name } of rows) {
        const started = Number(name.split('_')[1]);
        if (Number.isFinite(started) && started < Date.now() - olderThanMs) {
          await client.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
        }
      }
    }
  } finally {
    await client.end();
  }
}
