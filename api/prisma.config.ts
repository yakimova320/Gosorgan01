import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';
import { resolveSqliteUrl } from './src/prisma/database-url.js';

// Prisma CLI сама не читает .env: загружаем так же, как сервер (api/.env главнее корневого).
for (const file of [
  resolve(import.meta.dirname, '.env'),
  resolve(import.meta.dirname, '..', '.env'),
]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const url = resolveSqliteUrl(
  process.env.DATABASE_URL ?? 'file:./dev.db',
  import.meta.dirname,
);

// Prisma Studio 7.10 узнаёт SQLite только по адресу вида file://..., остальные команды — по file:...
const isStudio = process.argv.includes('studio');
const datasourceUrl =
  isStudio && url.startsWith('file:')
    ? `file://${url.slice('file:'.length)}`
    : url;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed.mjs',
  },
  datasource: {
    url: datasourceUrl,
  },
});
