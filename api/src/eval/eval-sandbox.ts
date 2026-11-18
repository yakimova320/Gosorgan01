import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';

const API_DIR = resolve(import.meta.dirname, '..', '..');
const PREFIX = 'eval_';

/*
 * B14: изолированная песочница прогона: своя схема PostgreSQL eval_<время>_<случайное> и своё
 * временное хранилище. Данные разработчика не затрагиваются. Изоляция проверяется до миграций:
 * имя схемы с префиксом eval_, схемы ещё нет, адрес не указывает на схему public.
 * cleanup удаляет схему и хранилище и при ошибке прогона.
 */
export interface EvalSandbox {
  databaseUrl: string;
  schema: string;
  storageDir: string;
  cleanup: () => Promise<void>;
}

export async function createSandbox(baseUrl: string): Promise<EvalSandbox> {
  const base = new URL(baseUrl);
  base.searchParams.delete('schema');
  const schema = `${PREFIX}${Date.now()}_${randomBytes(4).toString('hex')}`;
  if (!/^eval_\d+_[0-9a-f]{8}$/.test(schema)) throw new Error('eval: неверное имя схемы');
  const url = new URL(base);
  url.searchParams.set('schema', schema);

  const client = new pg.Client({ connectionString: base.toString() });
  await client.connect();
  try {
    const { rows } = await client.query(
      'SELECT 1 FROM information_schema.schemata WHERE schema_name = $1',
      [schema],
    );
    if (rows.length > 0) throw new Error('eval: схема уже существует, прогон остановлен');
  } finally {
    await client.end();
  }
  if (url.searchParams.get('schema') !== schema || schema === 'public')
    throw new Error('eval: адрес не изолирован');

  const storageDir = mkdtempSync(join(tmpdir(), 'jasno-eval-'));
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    rmSync(storageDir, { recursive: true, force: true });
    const c = new pg.Client({ connectionString: base.toString() });
    await c.connect();
    try {
      await c.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await c.end();
    }
  };

  try {
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: url.toString() },
      stdio: 'pipe',
    });
  } catch (e) {
    await cleanup();
    throw e;
  }
  return { databaseUrl: url.toString(), schema, storageDir, cleanup };
}

/** Есть ли схема (для тестов очистки). */
export async function schemaExists(baseUrl: string, schema: string): Promise<boolean> {
  const base = new URL(baseUrl);
  base.searchParams.delete('schema');
  const client = new pg.Client({ connectionString: base.toString() });
  await client.connect();
  try {
    const { rows } = await client.query(
      'SELECT 1 FROM information_schema.schemata WHERE schema_name = $1',
      [schema],
    );
    return rows.length > 0;
  } finally {
    await client.end();
  }
}
