/**
 * pnpm --filter jasno-api db:wipe-accounts — разовая очистка аккаунтов. Не часть запуска приложения.
 *
 *   --all                   все кабинеты в выбранной базе
 *   --email anna@example.org (можно несколько раз) только эти кабинеты
 *   --confirm host:port/база/схема   без этого флага ничего не удаляется (только показ)
 *
 * Сначала показывает цель: хост, порт, базу, схему (без пароля), абсолютный путь хранилища
 * и сколько данных будет удалено. Удаляет только при совпадении --confirm с целью.
 * NODE_ENV=production: отказ (дополнительная защита, не доказательство правильной базы).
 */
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { parseEnv } from '../config/env.schema.js';
import { loadEnvFiles } from '../config/load-env-files.js';
import { StorageService } from '../documents/storage.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  describeTarget,
  executeWipe,
  planWipe,
  targetId,
  type Selector,
} from './wipe-accounts.lib.js';

const apiDir = resolve(import.meta.dirname, '..', '..');
loadEnvFiles(apiDir);

const args = process.argv.slice(2);
const emails = args.flatMap((a, i) =>
  a === '--email' && args[i + 1] ? [args[i + 1]] : [],
);
const all = args.includes('--all');
const confirmIdx = args.indexOf('--confirm');
const confirm = confirmIdx >= 0 ? args[confirmIdx + 1] : undefined;

if (process.env.NODE_ENV === 'production') {
  console.error('Отказ: NODE_ENV=production.');
  process.exit(2);
}
if (all === emails.length > 0) {
  console.error('Укажите либо --all, либо один или несколько --email.');
  process.exit(2);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL не задан.');
  process.exit(2);
}
const storageSetting = process.env.STORAGE_DIR ?? './storage';
const storageDir = isAbsolute(storageSetting)
  ? storageSetting
  : resolve(apiDir, storageSetting);
// ST01: при STORAGE_MODE=s3 файлы писем в бакете; адрес и ключи из api/.env проверяются как у сервера.
const storage =
  process.env.STORAGE_MODE === 's3'
    ? new StorageService(parseEnv(process.env))
    : new StorageService({ STORAGE_DIR: storageDir });
const target = describeTarget(databaseUrl, storageDir);
const selector: Selector = all ? { all: true } : { emails };

console.log('Цель очистки:');
console.log(`  база:       ${targetId(target)}`);
console.log(
  `  хранилище:  ${storageDir}${existsSync(storageDir) ? '' : ' (папки нет)'}`,
);
if (storage.remote)
  console.log(`  файлы писем: бакет ${storage.remote.bucket} (S3)`);
console.log(`  кабинеты:   ${all ? 'все' : emails.join(', ')}`);

const db = new PrismaService({ DATABASE_URL: databaseUrl });
try {
  const plan = await planWipe(db, storageDir, selector);
  console.log(`\nНайдено кабинетов: ${plan.cabinets.length}`);
  for (const [k, v] of Object.entries(plan.counts)) console.log(`  ${k}: ${v}`);
  const mailOutbox = resolve(storageDir, 'mail-outbox');
  console.log(
    `  почтовые файлы: ${existsSync(mailOutbox) ? `папка ${mailOutbox} есть, формат файлов задаёт A03 — проверьте вручную` : 'нет (восстановление пароля ещё не подключено)'}`,
  );

  if (plan.cabinets.length === 0) {
    console.log('\nУдалять нечего.');
  } else if (!confirm) {
    console.log(
      `\nНичего не удалено. Чтобы удалить, повторите с --confirm ${targetId(target)}`,
    );
  } else if (confirm !== targetId(target)) {
    console.error(
      `\nОтказ: --confirm ${confirm} не совпадает с целью ${targetId(target)}.`,
    );
    process.exitCode = 2;
  } else {
    const { deleted, pending, failed } = await executeWipe(
      db,
      storageDir,
      plan,
      storage,
    );
    console.log(
      `\nУдалено кабинетов: ${deleted.length}. Повторный запуск должен показать 0.`,
    );
    if (pending.length)
      console.log(
        `База удалена, файлы не дочищены: ${pending.length}. Запустите ещё раз (или их дочистит сервер).`,
      );
    if (failed.length) {
      console.error(
        `Не удалось удалить: ${failed.length}. Данные возвращены, запустите ещё раз.`,
      );
      process.exitCode = 1;
    }
  }
} catch (e) {
  console.error(
    `\nОшибка: ${(e as Error).name}. Уже удалённые кабинеты не вернутся; запустите ещё раз, чтобы удалить остальные.`,
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
