import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

/**
 * Разбирает адрес PostgreSQL для адаптера pg. Один адрес служит и Prisma CLI (миграции),
 * и серверу, поэтому параметры в формате Prisma переводятся для драйвера pg:
 *
 * - `schema` — схема таблиц: адаптеру отдельно.
 * - `sslmode` (disable | prefer | require | verify-full), `sslcert` (путь к корневому сертификату
 *   сервера, у Supabase — «SSL certificate» в настройках базы), `sslaccept` (strict |
 *   accept_invalid_certs): в объект ssl для pg. С `sslcert` сертификат сервера проверяется
 *   (DB01-S, Supabase); `require` без сертификата шифрует, но сервер не проверяет (как libpq).
 * - `connection_limit` — размер пула соединений (у бесплатного пулера Supabase лимит невелик).
 *
 * Эти параметры убираются из адреса для pg: иначе драйвер прочитает их по-своему.
 */
export interface ParsedDatabaseUrl {
  connectionString: string;
  schema?: string;
  ssl?: { rejectUnauthorized: boolean; ca?: string };
  max?: number;
}

export function parseDatabaseUrl(
  url: string,
  /** папка, от которой считается относительный sslcert: как у Prisma CLI — папка api (prisma.config.ts) */
  baseDir = process.cwd(),
): ParsedDatabaseUrl {
  const parsed = new URL(url);
  const p = parsed.searchParams;
  const schema = p.get('schema') ?? undefined;
  const sslmode = p.get('sslmode');
  const sslcert = p.get('sslcert');
  const sslaccept = p.get('sslaccept');
  const limit = p.get('connection_limit');
  for (const k of ['schema', 'sslmode', 'sslcert', 'sslaccept', 'connection_limit'])
    p.delete(k);

  const result: ParsedDatabaseUrl = { connectionString: parsed.toString(), schema };
  if (sslcert) {
    const path = isAbsolute(sslcert) ? sslcert : resolve(baseDir, sslcert);
    result.ssl = {
      ca: readFileSync(path, 'utf8'),
      rejectUnauthorized: sslaccept !== 'accept_invalid_certs',
    };
  } else if (sslmode === 'verify-full' || sslmode === 'verify-ca') {
    // проверка по общим корневым сертификатам системы
    result.ssl = { rejectUnauthorized: true };
  } else if (sslmode === 'require' || sslmode === 'prefer') {
    result.ssl = { rejectUnauthorized: false };
  }
  if (limit) {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1 || n > 100)
      throw new Error('DATABASE_URL: connection_limit должен быть целым числом от 1 до 100');
    result.max = n;
  }
  return result;
}

/** Хосты локальной базы: этот компьютер и сервис db в docker-compose. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'db']);

export function isLocalDatabase(url: string): boolean {
  return LOCAL_HOSTS.has(new URL(url).hostname);
}

/**
 * DB01-S: тесты и eval создают и удаляют схемы в базе. На внешней базе (Supabase) это
 * засоряло бы её и тратило бесплатный лимит, поэтому они работают только с локальной.
 */
export function assertLocalDatabase(url: string, purpose: string): void {
  if (!isLocalDatabase(url)) {
    const host = new URL(url).hostname;
    throw new Error(
      `${purpose}: база на ${host} не локальная. Тесты и eval создают и удаляют схемы, ` +
        'поэтому работают только с локальным PostgreSQL (pnpm db:up). ' +
        'Задайте TEST_DATABASE_URL=postgresql://jasno:jasno@localhost:5432/jasno.',
    );
  }
}
