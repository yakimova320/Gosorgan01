// Создаёт prisma/schema.postgres.prisma из prisma/schema.prisma (ТЗ v4 раздел 5).
// Отличие только в провайдере базы и в папке клиента; модели и перечисления те же.
//
//   node prisma/gen-postgres.mjs          записать файл (pnpm db:pg)
//   node prisma/gen-postgres.mjs --check  проверить, что файл совпадает (pnpm db:check, CI)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = import.meta.dirname;
const sourcePath = resolve(dir, 'schema.prisma');
const targetPath = resolve(dir, 'schema.postgres.prisma');

const HEADER =
  '// СОЗДАНО АВТОМАТИЧЕСКИ из schema.prisma командой `pnpm db:pg`. Не править руками.\n' +
  '// PostgreSQL-вариант для публикации (ТЗ v4 раздел 5).\n\n';

export function toPostgres(source) {
  const replaced = source
    .replace(/(datasource db \{\s*provider\s*=\s*)"sqlite"/, '$1"postgresql"')
    .replace(
      'output              = "../src/generated/prisma"',
      'output              = "../src/generated/prisma-postgres"',
    );
  if (!replaced.includes('"postgresql"'))
    throw new Error('В schema.prisma не найден provider = "sqlite"');
  return HEADER + replaced;
}

/** Блоки model и enum без комментариев и лишних пробелов: по ним сравниваются схемы. */
export function modelBlocks(schema) {
  const noComments = schema.replace(/\/\/.*$/gm, '');
  const blocks = noComments.match(/^(model|enum)\s+\w+\s*\{[^}]*\}/gm) ?? [];
  return blocks.map((b) => b.replace(/\s+/g, ' ').trim()).sort();
}

const source = readFileSync(sourcePath, 'utf8');
const expected = toPostgres(source);

if (process.argv.includes('--check')) {
  if (!existsSync(targetPath)) {
    console.error('Нет prisma/schema.postgres.prisma. Запустите: pnpm db:pg');
    process.exit(1);
  }
  const actual = readFileSync(targetPath, 'utf8');
  const a = modelBlocks(source);
  const b = modelBlocks(actual);
  const sameModels =
    a.length === b.length && a.every((block, i) => block === b[i]);
  if (!sameModels || actual !== expected) {
    console.error(
      'schema.postgres.prisma не совпадает с schema.prisma. Запустите: pnpm db:pg и закоммитьте файл.',
    );
    process.exit(1);
  }
  console.log(`Схемы совпадают: ${a.length} моделей и перечислений.`);
} else {
  writeFileSync(targetPath, expected);
  console.log('Записан prisma/schema.postgres.prisma');
}
