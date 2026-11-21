import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertLocalDatabase, isLocalDatabase, parseDatabaseUrl } from './database-url.js';

describe('parseDatabaseUrl', () => {
  it('адрес без schema не меняется', () => {
    expect(
      parseDatabaseUrl('postgresql://jasno:jasno@localhost:5432/jasno'),
    ).toEqual({
      connectionString: 'postgresql://jasno:jasno@localhost:5432/jasno',
      schema: undefined,
    });
  });

  it('schema убирается из адреса и возвращается отдельно', () => {
    expect(
      parseDatabaseUrl(
        'postgresql://jasno:jasno@localhost:5432/jasno?schema=test_1&sslmode=disable',
      ),
    ).toEqual({
      // sslmode=disable: без SSL, как и по умолчанию у pg
      connectionString: 'postgresql://jasno:jasno@localhost:5432/jasno',
      schema: 'test_1',
    });
  });
});

describe('DB01-S: SSL, пул и локальная база', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jasno-ca-'));
  const ca = join(dir, 'ca.crt');
  writeFileSync(ca, '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n');
  const pooler = 'postgresql://postgres.abc:secret@aws-0-eu-west-1.pooler.supabase.com:5432/postgres';

  it('sslcert: сертификат читается, сервер проверяется; параметры Prisma убраны из адреса', () => {
    const r = parseDatabaseUrl(`${pooler}?schema=jasno&sslmode=require&sslcert=${ca}&connection_limit=5`);
    expect(r).toEqual({
      connectionString: pooler,
      schema: 'jasno',
      ssl: { ca: readFileSync(ca, 'utf8'), rejectUnauthorized: true },
      max: 5,
    });
  });

  it('относительный sslcert — от переданной папки; accept_invalid_certs отключает проверку', () => {
    const r = parseDatabaseUrl(`${pooler}?sslcert=ca.crt&sslaccept=accept_invalid_certs`, dir);
    expect(r.ssl).toEqual({ ca: readFileSync(ca, 'utf8'), rejectUnauthorized: false });
  });

  it('sslmode без сертификата: require шифрует без проверки, verify-full проверяет', () => {
    expect(parseDatabaseUrl(`${pooler}?sslmode=require`).ssl).toEqual({ rejectUnauthorized: false });
    expect(parseDatabaseUrl(`${pooler}?sslmode=verify-full`).ssl).toEqual({ rejectUnauthorized: true });
    expect(parseDatabaseUrl(`${pooler}?sslmode=disable`).ssl).toBeUndefined();
  });

  it('connection_limit вне 1–100: понятная ошибка', () => {
    expect(() => parseDatabaseUrl(`${pooler}?connection_limit=0`)).toThrow('connection_limit');
  });

  it('локальная база: localhost, 127.0.0.1, ::1, db; Supabase — нет', () => {
    for (const h of ['localhost', '127.0.0.1', '[::1]', 'db'])
      expect(isLocalDatabase(`postgresql://u:p@${h}:5432/x`)).toBe(true);
    expect(isLocalDatabase(pooler)).toBe(false);
    expect(() => assertLocalDatabase(pooler, 'Тесты')).toThrow(/не локальная/);
    // пароль в сообщении не показывается
    expect(() => assertLocalDatabase(pooler, 'Тесты')).not.toThrow(/secret/);
  });
});
