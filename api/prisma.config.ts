import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma CLI сама не читает .env: загружаем так же, как сервер (api/.env главнее корневого).
for (const file of [
  resolve(import.meta.dirname, '.env'),
  resolve(import.meta.dirname, '..', '.env'),
]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const url =
  process.env.DATABASE_URL ?? 'postgresql://jasno:jasno@localhost:5432/jasno';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed.mjs',
  },
  datasource: {
    url,
  },
});
